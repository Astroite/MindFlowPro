import { config } from '../config.js';

export class GraphModule {
    constructor(app) {
        this.app = app;
        this.canvas = null;
        this.ctx = null;
        this.width = 0;
        this.height = 0;
        this.imageCache = new Map();
        this.dragSubject = null;
        this.isPanning = false;
        this.startPan = { x: 0, y: 0 };
        this.pinchStartDist = null;
        this.pinchStartScale = 1;
    }

    init() {
        this.canvas = this.app.dom.mainCanvas;
        this.ctx = this.canvas.getContext('2d');
        const resizeObserver = new ResizeObserver(() => this.resize());
        resizeObserver.observe(this.app.dom.canvasWrapper);

        this.app.state.simulation = d3.forceSimulation()
            .force("link", d3.forceLink().id(d => d.id).distance(config.linkDistance))
            .force("charge", d3.forceManyBody().strength(d => d.type === 'root' ? config.chargeStrength * 3 : config.chargeStrength))
            .force("collide", d3.forceCollide().radius(d => d.type === 'root' ? config.collideRadius * 1.5 : config.collideRadius))
            .force("x", d3.forceX(0).strength(0.01))
            .force("y", d3.forceY(0).strength(0.01))
            .on("tick", () => {}); // Tick logic empty, using requestAnimationFrame

        this.bindEvents();
        requestAnimationFrame(() => this.renderLoop());
    }

    resize() {
        const wrapper = this.app.dom.canvasWrapper;
        this.width = wrapper.clientWidth;
        this.height = wrapper.clientHeight;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        if (!this.app.state.currentId && this.app.state.nodes.length === 0) this.resetCamera();
        if (this.app.state.simulation) this.app.state.simulation.alpha(0.1).restart();
    }

    resetCamera() {
        this.app.state.camera = { x: this.width / 2, y: this.height / 2, k: 1 };
    }

    updateSimulation() {
        if (!this.app.state.simulation) return;
        this.app.state.simulation.nodes(this.app.state.nodes);
        this.app.state.simulation.force("link").links(this.app.state.links);
        this.app.state.simulation.alpha(1).restart();
    }

    isNodeVisible(node, padding = 100) {
        const cam = this.app.state.camera;
        const r = (node.type === 'root' ? config.nodeRadius : config.subRadius) * (node.scale || 1);
        const screenX = node.x * cam.k + cam.x;
        const screenY = node.y * cam.k + cam.y;

        return (screenX + r * cam.k > -padding && screenX - r * cam.k < this.width + padding &&
            screenY + r * cam.k > -padding && screenY - r * cam.k < this.height + padding);
    }

    addRootNode() {
        if (!this.app.state.currentId) return this.app.ui.toast('请先新建项目');

        const cam = this.app.state.camera;
        const cx = (this.width / 2 - cam.x) / cam.k;
        const cy = (this.height / 2 - cam.y) / cam.k;

        const node = {
            id: 'n_' + Date.now(),
            type: 'root',
            x: cx + (Math.random() - 0.5) * 50,
            y: cy + (Math.random() - 0.5) * 50,
            label: '新主题',
            scale: 0.1
        };
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
        const node = {
            id: 'n_' + Date.now(), type: 'sub',
            x: parent.x + Math.cos(angle) * 10, y: parent.y + Math.sin(angle) * 10,
            label: '新节点', scale: 0.05
        };
        this.app.state.nodes.push(node);
        this.app.state.links.push({ source: parent.id, target: node.id });

        this.app.state.selectedNodes.clear();
        this.app.state.selectedNodes.add(node.id);
        this.app.ui.showNodeBubble(node);

        this.updateSimulation();
        this.app.storage.triggerSave();
    }

    clearAll() {
        if(confirm('确定清空画布吗？')) {
            this.app.state.nodes = []; this.app.state.links = [];
            this.app.state.selectedNodes.clear();
            this.app.ui.hideNodeBubble();
            this.updateSimulation();
            this.app.storage.triggerSave();
        }
    }

    renderLoop() {
        const ctx = this.ctx;
        const cam = this.app.state.camera;
        if (!ctx) return; // 安全检查

        ctx.clearRect(0, 0, this.width, this.height);
        ctx.save();
        ctx.translate(cam.x, cam.y);
        ctx.scale(cam.k, cam.k);

        ctx.beginPath();
        ctx.strokeStyle = config.colors.link;
        ctx.lineWidth = 1.5;
        this.app.state.links.forEach(l => {
            const s = l.source, t = l.target;
            if (s.x && t.x) {
                if (this.isNodeVisible(s, 500) || this.isNodeVisible(t, 500)) {
                    ctx.moveTo(s.x, s.y);
                    ctx.lineTo(t.x, t.y);
                }
            }
        });
        ctx.stroke();

        this.app.state.nodes.forEach(n => {
            if (!this.isNodeVisible(n)) return;

            if (typeof n.scale === 'undefined') n.scale = 1;
            if (n.scale < 1) { n.scale += (1 - n.scale) * 0.15; if (n.scale > 0.99) n.scale = 1; }

            const r = (n.type === 'root' ? config.nodeRadius : config.subRadius) * (n.scale || 1);
            let fillColor = config.colors.surface;
            let textColor = config.colors.textMain;
            let hasImg = false;
            let isColorCard = false;

            const res = n.resId ? this.app.state.resources.find(r => r.id === n.resId) : null;

            if (n.type === 'root') {
                fillColor = config.colors.primary;
                textColor = config.colors.textLight;
            }

            if (res && res.type === 'color') {
                fillColor = res.content;
                isColorCard = true;
            }

            if (n.type === 'root' && !isColorCard) {
                ctx.shadowColor = 'rgba(0,0,0,0.2)';
                ctx.shadowBlur = 25 * (n.scale || 1);
                ctx.shadowOffsetY = 8 * (n.scale || 1);
            } else if (!isColorCard) {
                ctx.shadowColor = 'rgba(0,0,0,0.08)';
                ctx.shadowBlur = 12 * (n.scale || 1);
                ctx.shadowOffsetY = 4 * (n.scale || 1);
            } else {
                // 色卡不使用模糊阴影，或使用更锐利的边框以突显颜色
                ctx.shadowColor = 'rgba(0,0,0,0.1)';
                ctx.shadowBlur = 2 * (n.scale || 1);
                ctx.shadowOffsetY = 1 * (n.scale || 1);
            }
            ctx.shadowOffsetX = 0;

            ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
            ctx.fillStyle = fillColor; ctx.fill();

            // 色卡不显示普通的阴影，避免颜色偏差
            if (isColorCard) {
                ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
            } else {
                // 重置阴影，准备绘制边框或其他内容
                ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
            }

            if (res) {
                if (res.type === 'image') { this.drawImageInNode(n, res, r); hasImg = true; }
                else if (res.type !== 'color') {
                    let icon = '🔗';
                    if (res.type === 'md') icon = '📝'; else if (res.type === 'code') icon = '💻'; else if (res.type === 'audio') icon = '🎤';
                    ctx.fillStyle = (n.type === 'root') ? 'rgba(255,255,255,0.9)' : '#f59e0b';
                    ctx.font = `${20 * (n.scale||1)}px Arial`;
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillText(icon, n.x, n.y - 5);
                }
            }

            if (n.type === 'root') {
                if (!res || res.type !== 'color') {
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
                    ctx.stroke();
                }
            } else if (!res || res.type !== 'color') {
                ctx.lineWidth = 1.5; ctx.strokeStyle = config.colors.outline; ctx.stroke();
            } else if (res && res.type === 'color') {
                // 为色卡添加一个细微的边框，以防颜色太浅看不见
                ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.stroke();
            }

            if (this.app.state.selectedNodes.has(n.id)) {
                ctx.beginPath(); ctx.arc(n.x, n.y, r + 5, 0, Math.PI * 2);
                ctx.strokeStyle = config.colors.selection; ctx.lineWidth = 2; ctx.stroke();
            }

            ctx.globalAlpha = n.scale || 1;

            // 如果是色卡，需要根据背景亮度自动选择黑/白文字，或者不显示文字避免遮挡
            // 这里我们选择简单处理：如果是色卡，文字显示在节点下方，或者通过亮度判断
            // 但为了保持一致性，我们暂时还是显示文字，只是如果颜色太深，文字颜色需要调整
            // 这里简化逻辑，色卡节点通常文字颜色为 textMain 除非它是 root

            if (isColorCard) {
                // 简单的亮度判断逻辑可以加在这里，目前暂且使用默认
                ctx.fillStyle = config.colors.textMain; // 色卡上文字统一用深色，或者根据亮度计算反色
                // 更高级做法是计算 fillColor 的亮度
            } else {
                ctx.fillStyle = textColor;
            }

            ctx.font = `${n.type==='root'?'bold':''} ${12 * (n.scale||1)}px "Segoe UI", sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const textY = hasImg ? n.y + r + 15 : (n.resId && !hasImg ? n.y + 15 : n.y);

            // 色卡的情况下，文字显示在节点下方，避免遮挡颜色
            if (isColorCard) {
                ctx.fillText(n.label, n.x, n.y + r + 15);
            } else {
                ctx.fillText(n.label, n.x, textY);
            }

            ctx.globalAlpha = 1;

            if (n.scale >= 0.9) {
                const btnX = n.x + r * 0.707; const btnY = n.y + r * 0.707;
                ctx.beginPath(); ctx.arc(btnX, btnY, 9, 0, Math.PI * 2);
                ctx.fillStyle = '#22c55e'; ctx.fill();
                ctx.fillStyle = 'white'; ctx.font = 'bold 14px Arial'; ctx.fillText('+', btnX, btnY + 1);
            }
        });

        ctx.restore();

        this.app.ui.updateBubblePosition();

        requestAnimationFrame(() => this.renderLoop());
    }

    drawImageInNode(node, res, r) {
        let img = this.imageCache.get(res.id);

        if (!img) {
            img = new Image();
            img.src = res.content;
            this.imageCache.set(res.id, { loaded: false, obj: img });
            img.onload = () => {
                this.imageCache.set(res.id, { loaded: true, obj: img, width: img.width, height: img.height });
            };
            return;
        }

        if (img.loaded) {
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.arc(node.x, node.y, r - 2, 0, Math.PI * 2);
            this.ctx.clip();
            const scale = Math.max((r*2)/img.width, (r*2)/img.height);
            this.ctx.drawImage(img.obj, node.x - img.width*scale/2, node.y - img.height*scale/2, img.width*scale, img.height*scale);
            this.ctx.restore();
        }
    }

    bindEvents() {
        const canvas = this.canvas;
        const getPos = (e) => {
            const rect = canvas.getBoundingClientRect();
            const k = this.app.state.camera.k;
            const cx = e.touches ? e.touches[0].clientX : e.clientX;
            const cy = e.touches ? e.touches[0].clientY : e.clientY;
            return { x: (cx - rect.left - this.app.state.camera.x) / k, y: (cy - rect.top - this.app.state.camera.y) / k, rawX: cx, rawY: cy };
        };

        canvas.addEventListener('dragover', (e) => { e.preventDefault(); });
        canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            const resId = e.dataTransfer.getData('text/plain');
            if (!resId) return;
            const m = getPos(e);
            const hitNode = this.app.state.nodes.find(n => Math.hypot(m.x - n.x, m.y - n.y) < (n.type==='root'?config.nodeRadius:config.subRadius));
            if (hitNode) {
                hitNode.resId = resId;
                this.app.ui.toast('资源已关联');
                this.app.storage.triggerSave();
            }
        });

        window.addEventListener('keydown', (e) => {
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (this.app.state.selectedNodes.size > 0) {
                    this.app.ui.onBubbleDelete();
                }
            }
        });

        const handleStart = (e) => {
            this.app.dom.nodeMenu.style.display = 'none';

            if (e.target !== canvas) return;

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
                if (Math.hypot(m.x - (n.x + r*0.707), m.y - (n.y + r*0.707)) < 15) { this.addChildNode(n); return; }
                if (Math.hypot(m.x - n.x, m.y - n.y) < r) { hitNode = n; break; }
            }

            if (hitNode) {
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
                    this.app.state.simulation.alphaTarget(0.3).restart();
                }
            } else {
                if (!e.ctrlKey && !e.metaKey) {
                    this.app.state.selectedNodes.clear();
                    this.app.ui.hideNodeBubble();
                }
                this.isPanning = true; this.startPan = { x: m.rawX, y: m.rawY };
            }
        };

        const handleMove = (e) => {
            if (e.touches && e.touches.length === 2 && this.pinchStartDist) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.hypot(dx, dy);
                let newScale = this.pinchStartScale * (dist / this.pinchStartDist);
                this.app.state.camera.k = Math.max(0.1, Math.min(5, newScale));
                e.preventDefault(); return;
            }

            if (!e.touches) {
                const m = getPos(e);
                let hoverNode = null;
                for (let i = this.app.state.nodes.length - 1; i >= 0; i--) {
                    const n = this.app.state.nodes[i];
                    const r = (n.type === 'root' ? config.nodeRadius : config.subRadius) * (n.scale || 1);
                    if (Math.hypot(m.x - n.x, m.y - n.y) < r) { hoverNode = n; break; }
                }
                if (hoverNode && hoverNode.resId) this.app.ui.showTooltip(hoverNode, e.clientX, e.clientY);
                else this.app.ui.hideTooltip();
            }

            if (!this.dragSubject && !this.isPanning) return;
            e.preventDefault();
            const m = getPos(e);

            if (this.dragSubject) {
                this.app.ui.hideNodeBubble();
                this.dragSubject.fx = m.x; this.dragSubject.fy = m.y;
            }
            else if (this.isPanning) {
                this.app.ui.hideNodeBubble();
                this.app.state.camera.x += m.rawX - this.startPan.x; this.app.state.camera.y += m.rawY - this.startPan.y;
                this.startPan = { x: m.rawX, y: m.rawY };
            }
        };

        const handleEnd = (e) => {
            if (e.touches && e.touches.length < 2) this.pinchStartDist = null;
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

        canvas.addEventListener('mousedown', handleStart);
        canvas.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleEnd);
        canvas.addEventListener('touchstart', handleStart, {passive: false});
        canvas.addEventListener('touchmove', handleMove, {passive: false});
        window.addEventListener('touchend', handleEnd);
        canvas.addEventListener('wheel', (e) => {
            this.app.dom.nodeMenu.style.display = 'none';
            this.app.ui.hideNodeBubble();
            e.preventDefault(); const f = e.deltaY < 0 ? 1.1 : 0.9;
            this.app.state.camera.k = Math.max(0.1, Math.min(5, this.app.state.camera.k * f));
        });
    }
}