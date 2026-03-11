import { config } from '../config.js';

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
        this.imageCache = new Map();
        this.dragSubject = null;
        this.isPanning = false;
        this.startPan = { x: 0, y: 0 };
        this.pinchStartDist = null;
        this.pinchStartScale = 1;
        this.mousePos = { x: 0, y: 0 };
        this.needsRender = true;
    }

    init() {
        this.canvas = this.app.dom.mainCanvas;
        // 使用 srgb 颜色空间以获得更好的色彩还原
        this.ctx = this.canvas.getContext('2d', {colorSpace: "srgb"});
        const resizeObserver = new ResizeObserver(() => this.resize());
        resizeObserver.observe(this.app.dom.canvasWrapper);

        // 初始化力导向图
        this.app.state.simulation = d3.forceSimulation()
            // 连线力：根据连线类型动态调整强度
            // [修改] 方案二：飞线 (cross) 完全不参与物理力 (strength = 0)
            // 它们仅保留数据关系，位置完全由端点决定，不产生拉力
            .force("link", d3.forceLink().id(d => d.id)
                .distance(config.linkDistance)
                .strength(d => d.type === 'cross' ? 0 : 1)
            )
            .force("charge", d3.forceManyBody().strength(d => d.type === 'root' ? config.chargeStrength * 3 : config.chargeStrength))
            .force("collide", d3.forceCollide().radius(d => d.type === 'root' ? config.collideRadius * 1.5 : config.collideRadius))
            .force("x", d3.forceX(0).strength(0.01))
            .force("y", d3.forceY(0).strength(0.01))
            .on("tick", () => { this.needsRender = true; }); // 渲染逻辑独立于 tick，在 renderLoop 中执行

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

    // --- 核心绘制逻辑 ---

    drawLink(ctx, link) {
        if (link.type === 'cross' && !this.app.state.showCrossLinks) return;

        const s = link.source, t = link.target;
        if (s && t && !isNaN(s.x) && !isNaN(s.y) && !isNaN(t.x) && !isNaN(t.y)) {
            // 检查是否选中
            const isSelected = this.app.state.selectedLink === link;

            ctx.beginPath();

            if (link.type === 'cross') {
                // [修改] 飞线绘制逻辑：使用贝塞尔曲线 (Quadratic Bezier Curve)
                ctx.save();

                // 关联节点选中或连线本身选中时，飞线变实
                const isDark = document.body.getAttribute('data-theme') === 'dark';
                const isHighlight = isSelected || this.app.state.selectedNodes.has(s.id) || this.app.state.selectedNodes.has(t.id);

                // 高亮时使用强调色，否则继承当前 ctx 颜色（通常是灰色）
                if (isSelected) {
                    ctx.strokeStyle = config.colors.selection;
                    ctx.lineWidth = 3;
                } else {
                    ctx.lineWidth = 1.5;
                    ctx.strokeStyle = isDark ? config.colorsDark.cross : config.colors.cross;
                    if (isHighlight) ctx.strokeStyle = config.colors.primary;
                }

                ctx.setLineDash(isHighlight ? [5, 3] : [3, 5]); // 高亮实线，普通虚线
                ctx.globalAlpha = isHighlight ? 0.8 : 0.4;

                // --- 计算贝塞尔曲线控制点 ---
                // 简单的策略：控制点位于两点连线的中垂线上，偏离距离与连线长度成正比
                const dx = t.x - s.x;
                const dy = t.y - s.y;
                const dist = Math.sqrt(dx*dx + dy*dy);

                // 偏移系数，距离越远弧度越明显，但有上限
                const offset = Math.min(dist * 0.2, 150);

                // 计算法向量 (-dy, dx) 并归一化
                const nx = -dy / dist;
                const ny = dx / dist;

                // 控制点 (Control Point)
                const cpX = (s.x + t.x) / 2 + nx * offset;
                const cpY = (s.y + t.y) / 2 + ny * offset;

                ctx.moveTo(s.x, s.y);
                ctx.quadraticCurveTo(cpX, cpY, t.x, t.y);
                ctx.stroke();

                // --- 绘制箭头 (沿着曲线切线方向) ---
                // 二次贝塞尔曲线在终点 t=1 处的切线向量为: P2 - P1 (即 目标点 - 控制点)
                const tangentX = t.x - cpX;
                const tangentY = t.y - cpY;
                const angle = Math.atan2(tangentY, tangentX);

                const r = (t.type === 'root' ? config.nodeRadius : config.subRadius) * (t.scale || 1) + 5;
                const arrowX = t.x - r * Math.cos(angle);
                const arrowY = t.y - r * Math.sin(angle);

                ctx.beginPath();
                ctx.moveTo(arrowX, arrowY);
                ctx.lineTo(arrowX - 10 * Math.cos(angle - Math.PI / 6), arrowY - 10 * Math.sin(angle - Math.PI / 6));
                ctx.lineTo(arrowX - 10 * Math.cos(angle + Math.PI / 6), arrowY - 10 * Math.sin(angle + Math.PI / 6));
                ctx.fillStyle = ctx.strokeStyle;
                ctx.fill();

                ctx.restore();
            } else {
                // 普通连线 (实线直线)
                if (isSelected) {
                    ctx.save();
                    ctx.strokeStyle = config.colors.selection;
                    ctx.lineWidth = 3;
                    ctx.moveTo(s.x, s.y);
                    ctx.lineTo(t.x, t.y);
                    ctx.stroke();
                    ctx.restore();
                } else {
                    ctx.moveTo(s.x, s.y);
                    ctx.lineTo(t.x, t.y);
                    ctx.stroke();
                }
            }
        }
    }

    drawDragLink(ctx) {
        if (!this.app.state.isLinking || !this.app.state.linkingSourceNode) return;

        const s = this.app.state.linkingSourceNode;
        const m = this.mousePos;

        const cam = this.app.state.camera;
        const worldMouseX = (m.x - cam.x) / cam.k;
        const worldMouseY = (m.y - cam.y) / cam.k;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(worldMouseX, worldMouseY);
        ctx.strokeStyle = config.colors.primary;
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(worldMouseX, worldMouseY, 4 / cam.k, 0, Math.PI * 2);
        ctx.fillStyle = config.colors.primary;
        ctx.fill();
        ctx.restore();
    }

    drawNode(ctx, n) {
        // ... (保持原样) ...
        if (isNaN(n.x) || isNaN(n.y)) return;

        if (typeof n.scale === 'undefined') n.scale = 1;
        if (n.scale < 1) { n.scale += (1 - n.scale) * 0.15; if (n.scale > 0.99) n.scale = 1; }

        const isDark = document.body.getAttribute('data-theme') === 'dark';
        const themeColors = isDark ? (config.colorsDark || config.colors) : config.colors;

        const r = (n.type === 'root' ? config.nodeRadius : config.subRadius) * (n.scale || 1);

        let fillColor = themeColors.surface;
        let textColor = themeColors.textMain;
        let isColorCard = false;

        const res = n.resId ? this.app.state.resources.find(r => r.id === n.resId) : null;

        if (n.type === 'root') {
            fillColor = themeColors.primary;
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

        // 2. 绘制节点背景
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
            }
            else if (res.type !== 'color') {
                let icon = '🔗';
                if (res.type === 'md') icon = '📝';
                else if (res.type === 'code') icon = '💻';
                else if (res.type === 'audio') icon = '🎵';

                ctx.fillStyle = (n.type === 'root') ? 'rgba(255,255,255,0.9)' : '#f59e0b';

                if (n.type === 'root'){
                    ctx.font = `${36 * n.scale}px Arial`;
                } else {
                    ctx.font = `${24 * n.scale}px Arial`;
                }

                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
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
        if (this.app.state.selectedNodes.has(n.id) || (this.app.state.isLinking && this.app.state.linkingSourceNode && this.app.state.linkingSourceNode.id === n.id)) {
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
        const maxLabelWidth = r * 4;
        let label = n.label || '';
        if (ctx.measureText(label).width > maxLabelWidth) {
            let lo = 0, hi = label.length;
            while (lo < hi) {
                const mid = Math.ceil((lo + hi) / 2);
                if (ctx.measureText(label.slice(0, mid) + '…').width <= maxLabelWidth) {
                    lo = mid;
                } else {
                    hi = mid - 1;
                }
            }
            label = label.slice(0, lo) + '…';
        }
        ctx.fillText(label, n.x, textY);

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

        // Skip drawing if nothing changed; always draw during node-spawn animation or linking mode
        const hasAnimatingNodes = this.app.state.nodes.some(n => n.scale < 1);
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

        // 绘制连线
        this.app.state.links.forEach(l => {
            const s = l.source.id ? l.source : this.app.state.nodes.find(n => n.id === l.source);
            const t = l.target.id ? l.target : this.app.state.nodes.find(n => n.id === l.target);

            if (s && t && !isNaN(s.x) && !isNaN(s.y) && !isNaN(t.x) && !isNaN(t.y)) {
                if (this.isNodeVisible(s, 500) || this.isNodeVisible(t, 500)) {
                    if (typeof l.source === 'object' && typeof l.target === 'object') {
                        ctx.strokeStyle = linkColor;
                        this.drawLink(ctx, l);
                    }
                }
            }
        });

        this.drawDragLink(ctx);

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
        // ... (保持原样)
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

        const linkColor = isDark && config.colorsDark ? config.colorsDark.link : config.colors.link;
        ctx.lineWidth = 1.5;
        this.app.state.links.forEach(l => {
            const s = l.source.id ? l.source : this.app.state.nodes.find(n => n.id === l.source);
            const t = l.target.id ? l.target : this.app.state.nodes.find(n => n.id === l.target);

            if (s && t && !isNaN(s.x) && !isNaN(s.y) && !isNaN(t.x) && !isNaN(t.y)) {
                if (typeof l.source === 'object' && typeof l.target === 'object') {
                    ctx.strokeStyle = linkColor;
                    this.drawLink(ctx, l);
                }
            }
        });

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

    async clearAll() {
        const confirmed = await this.app.ui.confirmDialog('确定清空画布吗？此操作不可恢复。');
        if (confirmed) {
            this.app.state.nodes = []; this.app.state.links = [];
            this.app.state.selectedNodes.clear();
            this.app.ui.hideNodeBubble();
            this.updateSimulation();
            this.app.storage.triggerSave();
        }
    }

    // [New] 计算点击位置是否在连线附近
    getLinkAtPos(mx, my) {
        const camK = this.app.state.camera.k;
        const threshold = 5 / camK; // 增加点击容差
        let closestLink = null;
        let minDistance = threshold;

        for (const link of this.app.state.links) {
            // 只允许选中飞线
            if (link.type !== 'cross' || !this.app.state.showCrossLinks) continue;

            const s = link.source;
            const t = link.target;
            if (!s || !t || isNaN(s.x) || isNaN(t.x)) continue;

            let dist = Infinity;

            if (link.type === 'cross') {
                // [修正] 贝塞尔曲线点击检测 (采样法)
                // 1. 重复 drawLink 中的控制点计算逻辑
                const dx = t.x - s.x;
                const dy = t.y - s.y;
                const len = Math.sqrt(dx*dx + dy*dy);
                const offset = Math.min(len * 0.2, 150);
                const nx = -dy / len;
                const ny = dx / len;
                const cpX = (s.x + t.x) / 2 + nx * offset;
                const cpY = (s.y + t.y) / 2 + ny * offset;

                // 2. 动态采样点数量
                // 根据屏幕上的像素长度估算需要的采样点
                // 曲线长度近似 = 弦长 len
                // 屏幕像素长度 = len * camK
                // 我们希望每隔约 10 个屏幕像素采样一次
                let steps = Math.ceil((len * camK) / 10);

                // 限制采样点数量范围，避免极短或极长导致的性能问题
                steps = Math.max(10, Math.min(steps, 200));

                for (let i = 0; i <= steps; i++) {
                    const stepT = i / steps;
                    const it = 1 - stepT;
                    const bx = it*it*s.x + 2*it*stepT*cpX + stepT*stepT*t.x;
                    const by = it*it*s.y + 2*it*stepT*cpY + stepT*stepT*t.y;

                    const d = Math.hypot(mx - bx, my - by);
                    if (d < dist) dist = d;
                }
            } else {
                // 理论上只有飞线进入此逻辑
            }

            if (dist < minDistance) {
                minDistance = dist;
                closestLink = link;
            }
        }
        return closestLink;
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
                // 删除节点
                if (this.app.state.selectedNodes.size > 0) {
                    this.app.ui.onBubbleDelete();
                }
                // [New] 删除选中的飞线
                else if (this.app.state.selectedLink) {
                    if (confirm('删除这条飞线？')) {
                        this.app.data.deleteLink(this.app.state.selectedLink);
                    }
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

            if (e.touches && e.touches.length === 2) {
                // ... pinch logic ...
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
                if (!this.app.state.isLinking && Math.hypot(m.x - (n.x + r*0.707), m.y - (n.y + r*0.707)) < 15) {
                    this.addChildNode(n); return;
                }
                if (Math.hypot(m.x - n.x, m.y - n.y) < r) { hitNode = n; break; }
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
                this.app.state.selectedLink = null; // 取消选中连线
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
                // [New] 尝试选中飞线
                const hitLink = this.getLinkAtPos(m.x, m.y);
                if (hitLink) {
                    this.app.state.selectedLink = hitLink;
                    this.app.state.selectedNodes.clear(); // 清除节点选中
                    this.app.ui.hideNodeBubble();
                    // 不进行平移
                    return;
                } else {
                    this.app.state.selectedLink = null;
                }

                if (!e.ctrlKey && !e.metaKey) {
                    this.app.state.selectedNodes.clear();
                    this.app.ui.hideNodeBubble();
                }
                this.isPanning = true;
                this.startPan = { x: m.rawX, y: m.rawY };
            }
        };

        const handleMove = (e) => {
            this.needsRender = true;
            getPos(e);

            if (e.touches && e.touches.length === 2 && this.pinchStartDist) {
                // ... pinch logic ...
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.hypot(dx, dy);
                let newScale = this.pinchStartScale * (dist / this.pinchStartDist);
                this.app.state.camera.k = Math.max(0.1, Math.min(5, newScale));
                e.preventDefault(); return;
            }

            if (!e.touches) {
                const m = getPos(e);
                // [New] 如果鼠标在飞线上，显示小手形状
                const hitLink = this.getLinkAtPos(m.x, m.y);
                if (hitLink) {
                    this.canvas.style.cursor = 'pointer';
                } else {
                    this.canvas.style.cursor = 'default';
                }

                let hoverNode = null;
                for (let i = this.app.state.nodes.length - 1; i >= 0; i--) {
                    const n = this.app.state.nodes[i];
                    const r = (n.type === 'root' ? config.nodeRadius : config.subRadius) * (n.scale || 1);
                    if (Math.hypot(m.x - n.x, m.y - n.y) < r) { hoverNode = n; break; }
                }
                if (hoverNode && hoverNode.resId && !this.app.state.isLinking) this.app.ui.showTooltip(hoverNode, e.clientX, e.clientY);
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
            this.needsRender = true;
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
            this.needsRender = true;
            this.app.dom.nodeMenu.style.display = 'none';
            this.app.ui.hideNodeBubble();
            e.preventDefault(); const f = e.deltaY < 0 ? 1.1 : 0.9;
            this.app.state.camera.k = Math.max(0.1, Math.min(5, this.app.state.camera.k * f));
        });
    }
}
