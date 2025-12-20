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
        // 使用 srgb 颜色空间以获得更好的色彩还原
        this.ctx = this.canvas.getContext('2d', {colorSpace: "srgb"});
        const resizeObserver = new ResizeObserver(() => this.resize());
        resizeObserver.observe(this.app.dom.canvasWrapper);

        this.app.state.simulation = d3.forceSimulation()
            .force("link", d3.forceLink().id(d => d.id).distance(config.linkDistance))
            .force("charge", d3.forceManyBody().strength(d => d.type === 'root' ? config.chargeStrength * 3 : config.chargeStrength))
            .force("collide", d3.forceCollide().radius(d => d.type === 'root' ? config.collideRadius * 1.5 : config.collideRadius))
            .force("x", d3.forceX(0).strength(0.01))
            .force("y", d3.forceY(0).strength(0.01))
            .on("tick", () => {});

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
            }
            if (this.app.state.simulation) {
                this.app.state.simulation.alpha(0.3).restart();
            }
        }
    }

    resetCamera() {
        const w = this.width || window.innerWidth;
        const h = this.height || window.innerHeight;
        this.app.state.camera = { x: w / 2, y: h / 2, k: 1 };
    }

    updateSimulation() {
        if (!this.app.state.simulation) return;
        this.app.state.simulation.nodes(this.app.state.nodes);
        this.app.state.simulation.force("link").links(this.app.state.links);
        this.app.state.simulation.alpha(1).restart();
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

    // --- 核心绘制逻辑 ---

    getContrastColor(hexColor) {
        if (!hexColor || !hexColor.startsWith('#')) return config.colors.textMain;
        const r = parseInt(hexColor.substr(1, 2), 16);
        const g = parseInt(hexColor.substr(3, 2), 16);
        const b = parseInt(hexColor.substr(5, 2), 16);
        const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return (yiq >= 128) ? '#000000' : '#ffffff';
    }

    drawLink(ctx, link) {
        const s = link.source, t = link.target;
        if (s && t && !isNaN(s.x) && !isNaN(s.y) && !isNaN(t.x) && !isNaN(t.y)) {
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(t.x, t.y);
        }
    }

    drawNode(ctx, n) {
        if (isNaN(n.x) || isNaN(n.y)) return;

        if (typeof n.scale === 'undefined') n.scale = 1;
        if (n.scale < 1) { n.scale += (1 - n.scale) * 0.15; if (n.scale > 0.99) n.scale = 1; }

        // [Fix] 安全获取颜色配置，防止 colorsDark 未定义导致崩溃
        const isDark = document.body.getAttribute('data-theme') === 'dark';
        const themeColors = isDark ? (config.colorsDark || config.colors) : config.colors;

        const r = (n.type === 'root' ? config.nodeRadius : config.subRadius) * (n.scale || 1);

        let fillColor = themeColors.surface;
        let textColor = themeColors.textMain;
        let hasImg = false;
        let isColorCard = false;

        const res = n.resId ? this.app.state.resources.find(r => r.id === n.resId) : null;

        if (n.type === 'root') {
            fillColor = themeColors.primary;
            // [Fix] 根节点背景色通常较深，强制使用浅色文字，除非你修改了 primary 颜色
            // textColor = config.colors.textLight;
        }

        if (res && res.type === 'color') {
            fillColor = res.content;
            isColorCard = true;
        }

        // 1. 设置阴影
        if (n.type === 'root' && !isColorCard) {
            ctx.shadowColor = 'rgba(0,0,0,0.2)';
            ctx.shadowBlur = 25 * n.scale;
            ctx.shadowOffsetY = 8 * n.scale;
        } else if (!isColorCard) {
            ctx.shadowColor = 'rgba(0,0,0,0.08)';
            ctx.shadowBlur = 12 * n.scale;
            ctx.shadowOffsetY = 4 * n.scale;
        } else {
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetY = 0;
        }
        ctx.shadowOffsetX = 0;

        // 2. 绘制节点背景 (色卡白底修正)
        if (isColorCard) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.restore();
        }

        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = fillColor;
        ctx.fill();

        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

        // 3. 绘制内容
        if (res) {
            if (res.type === 'image') {
                this.drawImageInNode(ctx, n, res, r);
                hasImg = true;
            }
            else if (res.type !== 'color') {
                let icon = '🔗';
                if (res.type === 'md') icon = '📝';
                else if (res.type === 'code') icon = '💻';
                else if (res.type === 'audio') icon = '🎵';

                ctx.fillStyle = (n.type === 'root') ? 'rgba(255,255,255,0.9)' : '#f59e0b';

                // [保留你的修改] 根节点图标更大
                if (n.type === 'root'){
                    ctx.font = `${36 * n.scale}px Arial`;
                } else {
                    ctx.font = `${24 * n.scale}px Arial`;
                }

                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                // [保留你的修改] 图标垂直居中
                ctx.fillText(icon, n.x, n.y);
            }
        }

        // 4. 绘制边框
        if (n.type === 'root') {
            if (!res || res.type !== 'color') {
                ctx.lineWidth = 2;
                ctx.strokeStyle = 'rgba(255,255,255,0.2)';
                ctx.stroke();
            }
        } else if (!res || res.type !== 'color') {
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = themeColors.outline;
            ctx.stroke();
        } else if (res && res.type === 'color') {
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();
        }

        // 5. 选中高亮
        if (this.app.state.selectedNodes.has(n.id)) {
            ctx.beginPath(); ctx.arc(n.x, n.y, r + 5, 0, Math.PI * 2);
            ctx.strokeStyle = themeColors.selection; ctx.lineWidth = 2; ctx.stroke();
        }

        // 6. 绘制文字
        ctx.globalAlpha = n.scale;
        ctx.fillStyle = textColor;


        ctx.font = `${n.type==='root'?'bold':''} ${12 * n.scale}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const textY = n.y + r + 15;
        ctx.fillText(n.label, n.x, textY);

        // 重置状态
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
    }

    drawPlusButton(ctx, n) {
        if (n.scale >= 0.9) {
            const r = (n.type === 'root' ? config.nodeRadius : config.subRadius) * n.scale;
            const btnX = n.x + r * 0.707;
            const btnY = n.y + r * 0.707;
            ctx.beginPath();
            ctx.arc(btnX, btnY, 9, 0, Math.PI * 2);
            ctx.fillStyle = '#22c55e';
            ctx.fill();
            ctx.fillStyle = 'white';
            ctx.font = 'bold 14px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('+', btnX, btnY + 1);
        }
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

        ctx.clearRect(0, 0, this.width, this.height);
        ctx.save();
        ctx.translate(cam.x, cam.y);
        ctx.scale(cam.k, cam.k);

        // 绘制连线
        ctx.beginPath();
        // [Fix] 连线颜色也需要适配深色模式
        const isDark = document.body.getAttribute('data-theme') === 'dark';
        ctx.strokeStyle = isDark && config.colorsDark ? config.colorsDark.link : config.colors.link;
        ctx.lineWidth = 1.5;

        this.app.state.links.forEach(l => {
            const s = l.source.id ? l.source : this.app.state.nodes.find(n => n.id === l.source);
            const t = l.target.id ? l.target : this.app.state.nodes.find(n => n.id === l.target);

            if (s && t && !isNaN(s.x) && !isNaN(s.y) && !isNaN(t.x) && !isNaN(t.y)) {
                if (this.isNodeVisible(s, 500) || this.isNodeVisible(t, 500)) {
                    if (typeof l.source === 'object' && typeof l.target === 'object') {
                        this.drawLink(ctx, l);
                    }
                }
            }
        });
        ctx.stroke();

        this.app.state.nodes.forEach(n => {
            if (isNaN(n.x) || isNaN(n.y)) return;
            if (!this.isNodeVisible(n)) return;

            this.drawNode(ctx, n);
            this.drawPlusButton(ctx, n);
        });

        ctx.restore();

        this.app.ui.updateBubblePosition();

        requestAnimationFrame(() => this.renderLoop());
    }

    exportImage() {
        if (this.app.state.nodes.length === 0) return this.app.ui.toast('画布为空');

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        this.app.state.nodes.forEach(n => {
            if (isNaN(n.x) || isNaN(n.y)) return;
            const r = (n.type === 'root' ? config.nodeRadius : config.subRadius) * (n.scale || 1);
            if (n.x - r < minX) minX = n.x - r;
            if (n.x + r > maxX) maxX = n.x + r;
            if (n.y - r < minY) minY = n.y - r;
            if (n.y + r > maxY) maxY = n.y + r;
        });

        if (!isFinite(minX) || !isFinite(maxX)) return this.app.ui.toast('无法计算导出的边界');

        const padding = 50;
        const width = maxX - minX + padding * 2;
        const height = maxY - minY + padding * 2;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { colorSpace: "srgb" });

        const isDark = document.body.getAttribute('data-theme') === 'dark';
        ctx.fillStyle = isDark ? '#18181b' : '#f3f3f3';
        ctx.fillRect(0, 0, width, height);

        ctx.save();
        ctx.translate(-minX + padding, -minY + padding);

        ctx.beginPath();
        // [Fix] 导出时连线颜色同步
        ctx.strokeStyle = isDark && config.colorsDark ? config.colorsDark.link : config.colors.link;
        ctx.lineWidth = 1.5;
        this.app.state.links.forEach(l => {
            const s = l.source.id ? l.source : this.app.state.nodes.find(n => n.id === l.source);
            const t = l.target.id ? l.target : this.app.state.nodes.find(n => n.id === l.target);

            if (s && t && !isNaN(s.x) && !isNaN(s.y) && !isNaN(t.x) && !isNaN(t.y)) {
                if (typeof l.source === 'object' && typeof l.target === 'object') {
                    this.drawLink(ctx, l);
                }
            }
        });
        ctx.stroke();

        this.app.state.nodes.forEach(n => {
            if (isNaN(n.x) || isNaN(n.y)) return;
            this.drawNode(ctx, n);
        });

        ctx.restore();

        const link = document.createElement('a');
        link.download = `MindFlow_${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        this.app.ui.toast('图片已导出');
    }

    drawImageInNode(ctx, node, res, r) {
        if (!this.imageCache.has(res.id)) {
            const img = new Image(); img.src = res.content;
            img.onload = () => this.imageCache.set(res.id, img);
            this.imageCache.set(res.id, 'loading');
        }
        const img = this.imageCache.get(res.id);
        if (img && img !== 'loading') {
            ctx.save(); ctx.beginPath();
            ctx.arc(node.x, node.y, r - 2, 0, Math.PI * 2); ctx.clip();
            const scale = Math.max((r*2)/img.width, (r*2)/img.height);
            ctx.drawImage(img, node.x - img.width*scale/2, node.y - img.height*scale/2, img.width*scale, img.height*scale);
            ctx.restore();
        }
    }

    // ... (bindEvents, addRootNode 等方法保留) ...
    // 为了完整性，这里可以省略不写，因为逻辑没变，但如果需要完整文件请告知。
    // 上面的 drawNode, renderLoop, exportImage 已经包含了关键修复。
    // 以下是 bindEvents 等方法的占位符，保持你原有的逻辑即可。

    addRootNode() {
        if (!this.app.state.currentId) return this.app.ui.toast('请先新建项目');
        const cam = this.app.state.camera;
        const cx = (this.width / 2 - cam.x) / cam.k;
        const cy = (this.height / 2 - cam.y) / cam.k;
        const node = { id: 'n_' + Date.now(), type: 'root', x: cx + (Math.random() - 0.5) * 50, y: cy + (Math.random() - 0.5) * 50, label: '新主题', scale: 0.1 };
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
        const node = { id: 'n_' + Date.now(), type: 'sub', x: parent.x + Math.cos(angle) * 10, y: parent.y + Math.sin(angle) * 10, label: '新节点', scale: 0.05 };
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
            document.getElementById('nodeMenu').style.display = 'none';

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
                this.isPanning = true;
                this.startPan = { x: m.rawX, y: m.rawY };
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
