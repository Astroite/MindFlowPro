import { config } from '../config.js';
import { NodeRenderer } from './graph/NodeRenderer.js';
import { LinkRenderer } from './graph/LinkRenderer.js';
import { MinimapRenderer } from './graph/MinimapRenderer.js';
import { ExportManager } from './graph/ExportManager.js';

export class GraphModule {
    /**
     * @param {import('../types.js').App} app
     */
    constructor(app) {
        this.app = app;
        this.canvas = null;
        this.ctx = null;
        this.width = 0;
        this.height = 0;
        this.dragSubject = null;
        this.isPanning = false;
        this.startPan = { x: 0, y: 0 };
        this.pinchStartDist = null;
        this.pinchStartScale = 1;
        this.mousePos = { x: 0, y: 0 };
        this.needsRender = true;
        // [P1-2] Box selection state
        this.isSelecting = false;
        this.selectionRect = null;
        // [P2-2] Node search highlight
        this._searchMatchNodeId = null;
        // [P2-5] Minimap
        this.showMinimap = false;

        // Sub-modules
        this.nodeRenderer = new NodeRenderer(app);
        this.linkRenderer = new LinkRenderer(app);
        this.minimapRenderer = new MinimapRenderer(app);
        this.exportManager = new ExportManager(app);
    }

    // Proxy searchMatchNodeId to nodeRenderer
    get searchMatchNodeId() { return this._searchMatchNodeId; }
    set searchMatchNodeId(v) { this._searchMatchNodeId = v; this.nodeRenderer.searchMatchNodeId = v; }

    // Proxy imageCache from nodeRenderer
    get imageCache() { return this.nodeRenderer.imageCache; }

    init() {
        this.canvas = this.app.dom.mainCanvas;
        this.ctx = this.canvas.getContext('2d', {colorSpace: "srgb"});
        const resizeObserver = new ResizeObserver(() => this.resize());
        resizeObserver.observe(this.app.dom.canvasWrapper);

        // 初始化力导向图
        this.app.state.simulation = d3.forceSimulation()
            .force("link", d3.forceLink().id(d => d.id)
                .distance(config.linkDistance)
                .strength(d => d.type === 'cross' ? 0 : 1)
            )
            .force("charge", d3.forceManyBody().strength(d => d.type === 'root' ? config.chargeStrength * 3 : config.chargeStrength))
            .force("collide", d3.forceCollide().radius(d => d.type === 'root' ? config.collideRadius * 1.5 : config.collideRadius))
            .force("x", d3.forceX(0).strength(0.01))
            .force("y", d3.forceY(0).strength(0.01))
            .on("tick", () => { this.needsRender = true; });

        this.bindEvents();
        this.resize();
        requestAnimationFrame(() => this.renderLoop());
    }

    resize() {
        const wrapper = this.app.dom.canvasWrapper;
        if (!wrapper) return;

        this.width = wrapper.clientWidth;
        this.height = wrapper.clientHeight;

        if (this.width > 0 && this.height > 0) {
            this.canvas.width = this.width;
            this.canvas.height = this.height;

            if (!this.app.state.currentId && this.app.state.nodes.length === 0) {
                this.resetCamera();
            } else if (isNaN(this.app.state.camera.k)) {
                this.resetCamera();
            }
            if (this.app.state.simulation) {
                this.app.state.simulation.alpha(config.alphaTarget).restart();
            }
        }
    }

    resetCamera() {
        const w = this.width || window.innerWidth;
        const h = this.height || window.innerHeight;
        this.app.state.camera = { x: w / 2, y: h / 2, k: 1 };
        this.needsRender = true;
    }

    updateSimulation() {
        if (!this.app.state.simulation) return;
        this.app.state.simulation.nodes(this.app.state.nodes);
        this.app.state.simulation.force("link").links(this.app.state.links);
        this.app.state.simulation.alpha(1).restart();
        this.needsRender = true;
    }

    isNodeVisible(node, padding = 100) {
        if (isNaN(node.x) || isNaN(node.y)) return false;

        const cam = this.app.state.camera;
        const r = (node.type === 'root' ? config.nodeRadius : config.subRadius) * (node.scale || 1);

        const screenX = node.x * cam.k + cam.x;
        const screenY = node.y * cam.k + cam.y;
        const scaledR = r * cam.k;

        return (screenX + scaledR + padding > 0 &&
            screenX - scaledR - padding < this.width &&
            screenY + scaledR + padding > 0 &&
            screenY - scaledR - padding < this.height);
    }

    hitTestNode(px, py, n) {
        const r = (n.type === 'root' ? config.nodeRadius : config.subRadius) * (n.scale || 1);
        const dx = px - n.x, dy = py - n.y;
        const shape = n.shape || 'circle';
        if (shape === 'rounded-rect') return Math.abs(dx) < r && Math.abs(dy) < r;
        return Math.hypot(dx, dy) < r;
    }

    getCardDimensions(n) {
        const ratio = n.cardRatio;
        if (ratio && config.cardRatios && config.cardRatios[ratio]) {
            const dims = config.cardRatios[ratio];
            return { w: dims.w * (n.scale || 1), h: dims.h * (n.scale || 1) };
        }
        return { w: config.cardWidth * (n.scale || 1), h: config.cardHeight * (n.scale || 1) };
    }

    hitTestCard(px, py, n) {
        const { w, h } = this.getCardDimensions(n);
        return Math.abs(px - n.x) < w / 2 && Math.abs(py - n.y) < h / 2;
    }

    renderLoop() {
        const ctx = this.ctx;
        const cam = this.app.state.camera;
        if (!ctx) return;

        if (this.width === 0 || this.height === 0 || isNaN(cam.k)) {
            this.resize();
            if (this.width === 0) {
                requestAnimationFrame(() => this.renderLoop());
                return;
            }
        }

        // Skip drawing if nothing changed; always draw during node-spawn animation or linking mode
        const hasAnimatingNodes = this.app.state.nodes.some(n => n.scale < 1 || n._deleting);
        if (!this.needsRender && !hasAnimatingNodes && !this.app.state.isLinking) {
            requestAnimationFrame(() => this.renderLoop());
            return;
        }
        this.needsRender = false;

        ctx.clearRect(0, 0, this.width, this.height);
        ctx.save();
        ctx.translate(cam.x, cam.y);
        ctx.scale(cam.k, cam.k);

        const isDark = document.body.getAttribute('data-theme') === 'dark';
        const linkColor = isDark && config.colorsDark ? config.colorsDark.link : config.colors.link;
        ctx.lineWidth = 1.5;

        // Build node lookup map for O(1) access
        const nodeMap = new Map(this.app.state.nodes.map(n => [n.id, n]));

        // 绘制连线
        this.app.state.links.forEach(l => {
            const s = l.source.id ? l.source : nodeMap.get(l.source);
            const t = l.target.id ? l.target : nodeMap.get(l.target);

            if (s && t && !isNaN(s.x) && !isNaN(s.y) && !isNaN(t.x) && !isNaN(t.y)) {
                if (this.isNodeVisible(s, config.visPadding) || this.isNodeVisible(t, config.visPadding)) {
                    if (typeof l.source === 'object' && typeof l.target === 'object') {
                        ctx.strokeStyle = linkColor;
                        this.linkRenderer.drawLink(ctx, l);
                    }
                }
            }
        });

        this.linkRenderer.drawDragLink(ctx, this.mousePos);

        this.app.state.nodes.forEach(n => {
            if (isNaN(n.x) || isNaN(n.y)) return;
            if (!this.isNodeVisible(n)) return;

            this.nodeRenderer.drawNode(ctx, n);
            if (!n._deleting) this.nodeRenderer.drawPlusButton(ctx, n);
        });

        // [P0-4] Remove nodes that finished delete animation
        const toRemove = this.app.state.nodes.filter(n => n._removeNow);
        if (toRemove.length > 0) {
            const removeIds = toRemove.map(n => n.id);
            this.app.state.nodes = this.app.state.nodes.filter(n => !n._removeNow);
            // Also remove associated links
            this.app.state.links = this.app.state.links.filter(l => {
                const sId = typeof l.source === 'object' ? l.source.id : l.source;
                const tId = typeof l.target === 'object' ? l.target.id : l.target;
                return !removeIds.includes(sId) && !removeIds.includes(tId);
            });
            // Handle orphan promotion
            this.app.state.nodes.forEach(n => {
                if (n._deleting) return;
                const hasIncoming = this.app.state.links.some(l => {
                    const tId = typeof l.target === 'object' ? l.target.id : l.target;
                    return tId === n.id;
                });
                if (!hasIncoming && n.type === 'sub') {
                    n.type = 'root';
                    n.scale = 1;
                }
            });
            this.updateSimulation();
            this.app.storage.triggerSave();
        }

        // [P1-1] Empty state guidance
        if (this.app.state.nodes.length === 0) {
            ctx.save();
            ctx.resetTransform();
            const cx = this.width / 2;
            const cy = this.height / 2;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.15)';
            ctx.font = '600 18px "Segoe UI", sans-serif';
            ctx.fillText('点击   根节点 创建第一个节点', cx, cy - 14);
            ctx.font = '14px "Segoe UI", sans-serif';
            ctx.fillText('拖拽侧边栏资源到画布快速创建节点', cx, cy + 16);
            ctx.restore();
        }

        // [P1-2] Draw selection rectangle
        if (this.selectionRect) {
            ctx.save();
            ctx.resetTransform();
            const { startX, startY, endX, endY } = this.selectionRect;
            const x = Math.min(startX, endX);
            const y = Math.min(startY, endY);
            const w = Math.abs(endX - startX);
            const h = Math.abs(endY - startY);
            ctx.fillStyle = 'rgba(99, 102, 241, 0.1)';
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.6)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.fillRect(x, y, w, h);
            ctx.strokeRect(x, y, w, h);
            ctx.setLineDash([]);
            ctx.restore();
        }

        // [P2-5] Draw minimap
        if (this.showMinimap && this.app.state.nodes.length > 0) {
            this.minimapRenderer.drawMinimap(ctx, this.width, this.height);
        }

        ctx.restore();
        this.app.ui.updateBubblePosition();
        requestAnimationFrame(() => this.renderLoop());
    }

    addRootNode() {
        if (!this.app.state.currentId) return this.app.ui.toast('请先新建项目');
        const cam = this.app.state.camera;
        const cx = (this.width / 2 - cam.x) / cam.k;
        const cy = (this.height / 2 - cam.y) / cam.k;
        const node = { id: config.idPrefix.node + Date.now(), type: 'root', x: cx + (Math.random() - 0.5) * 50, y: cy + (Math.random() - 0.5) * 50, label: '新主题', scale: 0.1 };
        this.app.data._pushCommand({ type: 'addNode', node: { ...node } });
        this.app.state.nodes.push(node);
        this.app.state.selectedNodes.clear();
        this.app.state.selectedNodes.add(node.id);
        this.app.ui.showNodeBubble(node);
        this.updateSimulation();
        this.app.storage.triggerSave();
        this.app.ui.toast('已添加新主题节点');
    }

    addChildNode(parent) {
        const angle = Math.random() * Math.PI * 2;
        const node = { id: config.idPrefix.node + Date.now(), type: 'sub', x: parent.x + Math.cos(angle) * 10, y: parent.y + Math.sin(angle) * 10, label: '新节点', scale: 0.05 };
        const link = { source: parent.id, target: node.id };
        this.app.data._pushCommand({ type: 'addNode', node: { ...node } });
        this.app.state.nodes.push(node);
        this.app.state.links.push(link);
        this.app.state.selectedNodes.clear();
        this.app.state.selectedNodes.add(node.id);
        this.app.ui.showNodeBubble(node);
        this.updateSimulation();
        this.app.storage.triggerSave();
    }

    async clearAll() {
        const confirmed = await this.app.ui.confirmDialog('确定清空画布吗？此操作不可恢复。');
        if (confirmed) {
            const snapNodes = this.app.state.nodes.map(n => ({ ...n }));
            const snapLinks = this.app.state.links.map(l => ({
                source: typeof l.source === 'object' ? l.source.id : l.source,
                target: typeof l.target === 'object' ? l.target.id : l.target,
                type: l.type
            }));
            this.app.data._pushCommand({ type: 'clearAll', nodes: snapNodes, links: snapLinks });
            this.app.state.nodes = []; this.app.state.links = [];
            this.app.state.selectedNodes.clear();
            this.app.ui.hideNodeBubble();
            this.updateSimulation();
            this.app.storage.triggerSave();
        }
    }

    // [P1-3] Inline edit node label
    inlineEdit(node) {
        const input = document.getElementById('inlineEditInput');
        if (!input) return;
        const cam = this.app.state.camera;
        const r = (node.type === 'root' ? config.nodeRadius : config.subRadius) * (node.scale || 1);
        const labelY = node.y + r + 15;
        const canvasRect = this.canvas.getBoundingClientRect();
        const sx = (node.x * cam.k + cam.x) + canvasRect.left;
        const sy = (labelY * cam.k + cam.y) + canvasRect.top;

        input.value = node.label || '';
        input.style.display = 'block';
        input.style.left = (sx - 60) + 'px';
        input.style.top = (sy - 14) + 'px';
        input.style.width = '120px';
        input.focus();
        input.select();

        const finish = () => {
            input.style.display = 'none';
            input.removeEventListener('blur', onBlur);
            input.removeEventListener('keydown', onKey);
        };
        const save = () => {
            const val = input.value.trim();
            if (val && val !== node.label) {
                this.app.data.updateNode(node.id, { label: val });
            }
            finish();
        };
        const onBlur = () => save();
        const onKey = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            if (e.key === 'Escape') { e.preventDefault(); finish(); }
        };
        input.addEventListener('blur', onBlur);
        input.addEventListener('keydown', onKey);
    }

    bindEvents() {
        const canvas = this.canvas;
        const getPos = (e) => {
            const rect = canvas.getBoundingClientRect();
            const k = this.app.state.camera.k;
            const cx = e.touches ? e.touches[0].clientX : e.clientX;
            const cy = e.touches ? e.touches[0].clientY : e.clientY;
            this.mousePos = { x: cx - rect.left, y: cy - rect.top };
            return { x: (cx - rect.left - this.app.state.camera.x) / k, y: (cy - rect.top - this.app.state.camera.y) / k, rawX: cx, rawY: cy };
        };

        canvas.addEventListener('dragover', (e) => { e.preventDefault(); });
        // [Feature 5] Drag resource to empty canvas → create new node
        canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            const resId = e.dataTransfer.getData('text/plain');
            if (!resId) return;
            const m = getPos(e);
            const hitNode = this.app.state.nodes.find(n => n.layout==='card' ? this.hitTestCard(m.x, m.y, n) : this.hitTestNode(m.x, m.y, n));
            if (hitNode) {
                const beforeResId = hitNode.resId;
                hitNode.resId = resId;
                this.app.data._pushCommand({ type: 'dropNode', nodeId: hitNode.id, beforeResId, afterResId: resId });
                this.nodeRenderer.preloadImage(resId);
                this.app.ui.toast('资源已关联');
                this.app.storage.triggerSave();
                this.needsRender = true;
            } else {
                if (!this.app.state.currentId) return;
                const res = this.app.state.resources.find(r => r.id === resId);
                if (!res || res.type === 'folder') return;
                const node = {
                    id: config.idPrefix.node + Date.now(), type: 'root',
                    x: m.x + (Math.random()-0.5)*20, y: m.y + (Math.random()-0.5)*20,
                    label: res.name, scale: 0.1, resId
                };
                this.app.data._pushCommand({ type: 'addNode', node: { ...node } });
                this.app.state.nodes.push(node);
                this.nodeRenderer.preloadImage(resId);
                this.app.state.selectedNodes.clear();
                this.app.state.selectedNodes.add(node.id);
                this.app.ui.showNodeBubble(node);
                this.updateSimulation();
                this.app.storage.triggerSave();
                this.app.ui.toast('已从资源创建节点');
            }
        });

        window.addEventListener('keydown', (e) => {
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (this.app.state.selectedNodes.size > 0) {
                    this.app.ui.onBubbleDelete();
                }
                else if (this.app.state.selectedLink) {
                    this.app.ui.confirmDialog('删除这条飞线？').then(confirmed => {
                        if (confirmed) this.app.data.deleteLink(this.app.state.selectedLink);
                    });
                }
            }
            if (e.key === 'Escape' && this.app.state.isLinking) {
                this.app.state.isLinking = false;
                this.app.state.linkingSourceNode = null;
                this.app.ui.toast('已取消连线');
            }
        });

        const handleStart = (e) => {
            this.needsRender = true;
            document.getElementById('nodeMenu').style.display = 'none';

            if (e.target !== canvas) return;

            // [P2-5] Minimap click
            if (this.showMinimap && this.minimapRenderer._minimapBounds) {
                const rect = canvas.getBoundingClientRect();
                const sx = (e.clientX || (e.touches && e.touches[0].clientX)) - rect.left;
                const sy = (e.clientY || (e.touches && e.touches[0].clientY)) - rect.top;
                if (this.minimapRenderer.handleMinimapClick(sx, sy, this.width, this.height)) { this.needsRender = true; return; }
            }

            if (e.touches && e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                this.pinchStartDist = Math.hypot(dx, dy);
                this.pinchStartScale = this.app.state.camera.k;
                e.preventDefault(); return;
            }

            const m = getPos(e);
            let hitNode = null;
            for (let i = this.app.state.nodes.length - 1; i >= 0; i--) {
                const n = this.app.state.nodes[i];
                const r = (n.type === 'root' ? config.nodeRadius : config.subRadius) * (n.scale || 1);
                if (!this.app.state.isLinking && Math.hypot(m.x - (n.x + r*config.diagOffset), m.y - (n.y + r*config.diagOffset)) < config.hitRadius) {
                    this.addChildNode(n); return;
                }
                if (n.layout==='card' ? this.hitTestCard(m.x, m.y, n) : this.hitTestNode(m.x, m.y, n)) { hitNode = n; break; }
            }

            // 飞线模式
            if (this.app.state.isLinking) {
                if (hitNode) {
                    this.app.data.addCrossLink(this.app.state.linkingSourceNode.id, hitNode.id);
                    this.app.state.isLinking = false;
                    this.app.state.linkingSourceNode = null;
                } else {
                    this.app.state.isLinking = false;
                    this.app.state.linkingSourceNode = null;
                    this.app.ui.toast('已取消连线');
                }
                return;
            }

            if (hitNode) {
                this.app.state.selectedLink = null;
                if (e.ctrlKey || e.metaKey) {
                    if (this.app.state.selectedNodes.has(hitNode.id)) {
                        this.app.state.selectedNodes.delete(hitNode.id);
                        this.app.ui.hideNodeBubble();
                        this.dragSubject = null;
                    } else {
                        this.app.state.selectedNodes.add(hitNode.id);
                        this.app.ui.showNodeBubble(hitNode);
                        this.dragSubject = hitNode;
                    }
                } else {
                    if (!this.app.state.selectedNodes.has(hitNode.id)) {
                        this.app.state.selectedNodes.clear();
                        this.app.state.selectedNodes.add(hitNode.id);
                    }
                    this.app.ui.showNodeBubble(hitNode);
                    this.dragSubject = hitNode;
                }

                if (this.dragSubject) {
                    this.dragSubject.fx = this.dragSubject.x;
                    this.dragSubject.fy = this.dragSubject.y;
                    this.app.state.simulation.alphaTarget(config.alphaTarget).restart();
                }
            } else {
                const hitLink = this.linkRenderer.getLinkAtPos(m.x, m.y);
                if (hitLink) {
                    this.app.state.selectedLink = hitLink;
                    this.app.state.selectedNodes.clear();
                    this.app.ui.hideNodeBubble();
                    return;
                } else {
                    this.app.state.selectedLink = null;
                }

                if (!e.ctrlKey && !e.metaKey) {
                    this.app.state.selectedNodes.clear();
                    this.app.ui.hideNodeBubble();
                }
                // [P1-2] Plain drag to pan, Shift+drag to box-select
                if (e.shiftKey) {
                    this.isSelecting = true;
                    const rect = canvas.getBoundingClientRect();
                    this.selectionRect = { startX: m.rawX - rect.left, startY: m.rawY - rect.top, endX: m.rawX - rect.left, endY: m.rawY - rect.top };
                } else {
                    this.isPanning = true;
                    this.startPan = { x: m.rawX, y: m.rawY };
                }
            }
        };

        const handleMove = (e) => {
            this.needsRender = true;
            getPos(e);

            if (e.touches && e.touches.length === 2 && this.pinchStartDist) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.hypot(dx, dy);
                let newScale = this.pinchStartScale * (dist / this.pinchStartDist);
                this.app.state.camera.k = Math.max(config.camZoomMin, Math.min(config.camZoomMax, newScale));
                e.preventDefault(); return;
            }

            if (!e.touches) {
                const m = getPos(e);
                const hitLink = this.linkRenderer.getLinkAtPos(m.x, m.y);
                if (hitLink) {
                    this.canvas.style.cursor = 'pointer';
                } else {
                    this.canvas.style.cursor = 'default';
                }

                let hoverNode = null;
                for (let i = this.app.state.nodes.length - 1; i >= 0; i--) {
                    const n = this.app.state.nodes[i];
                    const r = (n.type === 'root' ? config.nodeRadius : config.subRadius) * (n.scale || 1);
                    if (n.layout==='card' ? this.hitTestCard(m.x, m.y, n) : this.hitTestNode(m.x, m.y, n)) { hoverNode = n; break; }
                }
                if (hoverNode && (hoverNode.resId || hoverNode.note) && !this.app.state.isLinking) this.app.ui.showTooltip(hoverNode, e.clientX, e.clientY);
                else this.app.ui.hideTooltip();
            }

            if (!this.dragSubject && !this.isPanning && !this.isSelecting) return;
            e.preventDefault();
            const m = getPos(e);

            if (this.dragSubject) {
                this.app.ui.hideNodeBubble();
                this.dragSubject.fx = m.x; this.dragSubject.fy = m.y;
            }
            else if (this.isSelecting) {
                const rect = canvas.getBoundingClientRect();
                this.selectionRect.endX = m.rawX - rect.left;
                this.selectionRect.endY = m.rawY - rect.top;
            }
            else if (this.isPanning) {
                this.app.ui.hideNodeBubble();
                this.app.state.camera.x += m.rawX - this.startPan.x; this.app.state.camera.y += m.rawY - this.startPan.y;
                this.startPan = { x: m.rawX, y: m.rawY };
            }
        };

        const handleEnd = (e) => {
            this.needsRender = true;
            if (e.touches && e.touches.length < 2) this.pinchStartDist = null;

            // [P1-2] Finalize box selection
            if (this.isSelecting && this.selectionRect) {
                const { startX, startY, endX, endY } = this.selectionRect;
                const minX = Math.min(startX, endX);
                const maxX = Math.max(startX, endX);
                const minY = Math.min(startY, endY);
                const maxY = Math.max(startY, endY);

                if (maxX - minX > 5 || maxY - minY > 5) {
                    const cam = this.app.state.camera;
                    if (!e.shiftKey) this.app.state.selectedNodes.clear();
                    this.app.state.nodes.forEach(n => {
                        if (isNaN(n.x) || isNaN(n.y) || n._deleting) return;
                        const sx = n.x * cam.k + cam.x;
                        const sy = n.y * cam.k + cam.y;
                        if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
                            this.app.state.selectedNodes.add(n.id);
                        }
                    });
                }
                this.isSelecting = false;
                this.selectionRect = null;
            }

            if (this.dragSubject) {
                this.dragSubject.fx = null; this.dragSubject.fy = null;
                this.app.state.simulation.alphaTarget(0);
                if (this.app.state.selectedNodes.size === 1 && this.app.state.selectedNodes.has(this.dragSubject.id)) {
                    this.app.ui.showNodeBubble(this.dragSubject);
                }
                this.app.storage.triggerSave();
                this.dragSubject = null;
            }
            this.isPanning = false;
        };

        // [P0-1] Double-click node to edit label inline
        canvas.addEventListener('dblclick', (e) => {
            if (e.target !== canvas) return;
            const m = getPos(e);
            for (let i = this.app.state.nodes.length - 1; i >= 0; i--) {
                const n = this.app.state.nodes[i];
                const r = (n.type === 'root' ? config.nodeRadius : config.subRadius) * (n.scale || 1);
                const labelY = n.y + r + 15;
                const hit = n.layout==='card' ? this.hitTestCard(m.x, m.y, n) : this.hitTestNode(m.x, m.y, n);
                const labelDist = Math.hypot(m.x - n.x, m.y - labelY);
                if (hit || labelDist < r * 2) {
                    e.preventDefault();
                    this.app.state.selectedNodes.clear();
                    this.app.state.selectedNodes.add(n.id);
                    this.app.ui.showNodeBubble(n);
                    if (labelDist < r * 2) {
                        this.inlineEdit(n);
                    } else {
                        this.app.ui.onBubbleEdit();
                    }
                    return;
                }
            }
        });

        canvas.addEventListener('mousedown', handleStart);
        canvas.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleEnd);
        canvas.addEventListener('touchstart', handleStart, {passive: false});
        canvas.addEventListener('touchmove', handleMove, {passive: false});
        window.addEventListener('touchend', handleEnd);
        canvas.addEventListener('wheel', (e) => {
            this.needsRender = true;
            this.app.dom.nodeMenu.style.display = 'none';
            this.app.ui.hideNodeBubble();
            e.preventDefault(); const f = e.deltaY < 0 ? config.zoomInFactor : config.zoomOutFactor;
            this.app.state.camera.k = Math.max(config.camZoomMin, Math.min(config.camZoomMax, this.app.state.camera.k * f));
        });
    }
}
