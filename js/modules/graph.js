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
        // [P1-2] Box selection state
        this.isSelecting = false;
        this.selectionRect = null;
        // [P2-2] Node search highlight
        this.searchMatchNodeId = null;
        // [P2-5] Minimap
        this.showMinimap = false;
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

    // [Feature 2] Text wrapping helper
    wrapText(ctx, text, maxWidth, maxLines = 2) {
        if (!text) return [''];
        const font = ctx.font;
        const cacheKey = `${text}|${maxWidth.toFixed(1)}|${maxLines}|${font}`;
        if (this._wrapCache && this._wrapCache.key === cacheKey) return this._wrapCache.lines;
        const lines = [];
        let remaining = text;
        while (remaining.length > 0 && lines.length < maxLines) {
            if (ctx.measureText(remaining).width <= maxWidth) {
                lines.push(remaining);
                remaining = '';
            } else {
                const isLast = lines.length === maxLines - 1;
                const suffix = isLast ? '…' : '';
                let lo = 1, hi = remaining.length;
                while (lo < hi) {
                    const mid = Math.ceil((lo + hi) / 2);
                    if (ctx.measureText(remaining.slice(0, mid) + suffix).width <= maxWidth) lo = mid;
                    else hi = mid - 1;
                }
                lines.push(remaining.slice(0, lo) + suffix);
                remaining = isLast ? '' : remaining.slice(lo);
            }
        }
        const result = lines.length > 0 ? lines : [''];
        this._wrapCache = { key: cacheKey, lines: result };
        return result;
    }

    // --- Node appearance system ---

    /**
     * Draw the shape path for a node (beginPath + path, no fill/stroke)
     */
    drawNodeShape(ctx, cx, cy, r, shape) {
        ctx.beginPath();
        if (shape === 'rounded-rect') {
            ctx.roundRect(cx - r, cy - r, r * 2, r * 2, r * config.cornerRatio);
        } else {
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
        }
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

    drawNode(ctx, n) {
        if (isNaN(n.x) || isNaN(n.y)) return;

        if (typeof n.scale === 'undefined') n.scale = 1;

        // [P0-4] Deleting animation — shrink to 0
        if (n._deleting) {
            n.scale *= 0.8;
            if (n.scale < 0.05) {
                n._removeNow = true;
                return;
            }
        } else if (n.scale < 1) {
            n.scale += (1 - n.scale) * 0.15;
            if (n.scale > 0.99) n.scale = 1;
        }

        const isDark = document.body.getAttribute('data-theme') === 'dark';
        const themeColors = isDark ? (config.colorsDark || config.colors) : config.colors;

        const r = (n.type === 'root' ? config.nodeRadius : config.subRadius) * (n.scale || 1);
        const shape = n.shape || 'circle';

        let fillColor = themeColors.surface;
        let textColor = themeColors.textMain;
        let isColorCard = false;

        const res = n.resId ? this.app.state.resources.find(r => r.id === n.resId) : null;

        if (n.type === 'root') {
            fillColor = themeColors.primary;
        }

        // [Feature 4] Custom node color
        if (n.type === 'root' && n.color) {
            fillColor = n.color;
        }

        if (res && res.type === 'color') {
            fillColor = res.content;
            isColorCard = true;
        }

        // [P0-4] Fade out while deleting
        if (n._deleting) {
            ctx.globalAlpha = Math.max(0, n.scale);
        }

        // --- Card layout mode ---
        if (n.layout === 'card') {
            this.drawCardLayout(ctx, n, themeColors, textColor, res, isDark);
            ctx.globalAlpha = 1;
            return;
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
            this.drawNodeShape(ctx, n.x, n.y, r, shape);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.restore();
        }

        this.drawNodeShape(ctx, n.x, n.y, r, shape);
        ctx.fillStyle = fillColor;
        ctx.fill();

        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

        // 2b. Texture effect overlay
        if (n.texture) {
            this.drawTextureEffect(ctx, n.x, n.y, r, shape, n.texture);
        }

        // 3. 绘制内容
        if (res) {
            if (res.type === 'image') {
                this.drawImageInNode(ctx, n, res, r, shape);
            }
            else if (res.type !== 'color') {
                const icon = config.resIcons[res.type] || '🔗';

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
        const borderStyle = n.borderStyle || 'solid';
        if (borderStyle !== 'solid' && !isColorCard) {
            const borderColor = (n.type === 'root') ? 'rgba(255,255,255,0.4)' : themeColors.outline;
            this.drawBorder(ctx, n.x, n.y, r, shape, borderStyle, borderColor);
        } else {
            // Default solid border
            this.drawNodeShape(ctx, n.x, n.y, r, shape);
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
        }

        // 5. 选中高亮
        if (this.app.state.selectedNodes.has(n.id) || (this.app.state.isLinking && this.app.state.linkingSourceNode && this.app.state.linkingSourceNode.id === n.id)) {
            this.drawNodeShape(ctx, n.x, n.y, r + 5, shape);
            ctx.strokeStyle = themeColors.selection; ctx.lineWidth = 2; ctx.stroke();
        }

        // [P2-2] Search match highlight
        if (this.searchMatchNodeId === n.id) {
            this.drawNodeShape(ctx, n.x, n.y, r + 8, shape);
            ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 3;
            ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
        }

        // 6. 绘制文字 [Feature 2] — text wrapping
        ctx.globalAlpha = n.scale;
        // Textured nodes: force high-contrast text
        if (n.texture) {
            textColor = isDark ? '#f3f4f6' : '#1f2937';
        }
        ctx.fillStyle = textColor;

        ctx.font = `${n.type==='root'?'bold':''} ${12 * n.scale}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const textY = n.y + r + 15;
        const maxLabelWidth = r * 4;
        const lineHeight = 14 * n.scale;
        const lines = this.wrapText(ctx, n.label || '', maxLabelWidth);
        lines.forEach((line, i) => ctx.fillText(line, n.x, textY + i * lineHeight));

        ctx.globalAlpha = 1;

        // [Feature 7] Note indicator — amber dot at upper-left of node
        if (n.note && n.scale >= 0.9) {
            const noteX = n.x - r * config.diagOffset;
            const noteY = n.y - r * config.diagOffset;
            ctx.beginPath();
            ctx.arc(noteX, noteY, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#f59e0b';
            ctx.fill();
        }
    }

    // --- Glass / Acrylic effect ---

    drawTextureEffect(ctx, cx, cy, r, shape, texture) {
        if (texture === 'glass') {
            const grad = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
            grad.addColorStop(0, 'rgba(255,255,255,0.35)');
            grad.addColorStop(0.4, 'rgba(255,255,255,0.12)');
            grad.addColorStop(1, 'rgba(255,255,255,0.03)');
            this.drawNodeShape(ctx, cx, cy, r, shape);
            ctx.fillStyle = grad;
            ctx.fill();
            const hl = ctx.createRadialGradient(cx, cy - r * 0.4, 0, cx, cy - r * 0.4, r * 0.7);
            hl.addColorStop(0, 'rgba(255,255,255,0.25)');
            hl.addColorStop(1, 'rgba(255,255,255,0)');
            this.drawNodeShape(ctx, cx, cy, r, shape);
            ctx.fillStyle = hl;
            ctx.fill();
            const shadow = ctx.createLinearGradient(cx, cy, cx, cy + r);
            shadow.addColorStop(0, 'rgba(0,0,0,0)');
            shadow.addColorStop(1, 'rgba(0,0,0,0.06)');
            this.drawNodeShape(ctx, cx, cy, r, shape);
            ctx.fillStyle = shadow;
            ctx.fill();
        } else if (texture === 'acrylic') {
            // Frosted matte: diffuse soft gradient, lower alpha
            const grad = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
            grad.addColorStop(0, 'rgba(255,255,255,0.20)');
            grad.addColorStop(0.5, 'rgba(255,255,255,0.08)');
            grad.addColorStop(1, 'rgba(255,255,255,0.04)');
            this.drawNodeShape(ctx, cx, cy, r, shape);
            ctx.fillStyle = grad;
            ctx.fill();
            // Broad soft highlight
            const hl = ctx.createRadialGradient(cx, cy - r * 0.2, 0, cx, cy - r * 0.2, r * 0.9);
            hl.addColorStop(0, 'rgba(255,255,255,0.12)');
            hl.addColorStop(1, 'rgba(255,255,255,0)');
            this.drawNodeShape(ctx, cx, cy, r, shape);
            ctx.fillStyle = hl;
            ctx.fill();
            // Matte overlay
            this.drawNodeShape(ctx, cx, cy, r, shape);
            ctx.fillStyle = 'rgba(128,128,128,0.04)';
            ctx.fill();
        } else if (texture === 'metallic') {
            // Sharp specular band across upper third
            const grad = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
            grad.addColorStop(0, 'rgba(255,255,255,0.10)');
            grad.addColorStop(0.25, 'rgba(255,255,255,0.40)');
            grad.addColorStop(0.35, 'rgba(255,255,255,0.10)');
            grad.addColorStop(0.6, 'rgba(0,0,0,0.05)');
            grad.addColorStop(1, 'rgba(0,0,0,0.12)');
            this.drawNodeShape(ctx, cx, cy, r, shape);
            ctx.fillStyle = grad;
            ctx.fill();
            // Subtle edge highlight
            this.drawNodeShape(ctx, cx, cy, r, shape);
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }

    // --- Card layout ---

    drawCardLayout(ctx, n, themeColors, textColor, res, isDark) {
        const { w, h } = this.getCardDimensions(n);
        const x = n.x - w / 2, y = n.y - h / 2;
        const scale = n.scale || 1;
        const cornerR = 8 * scale;
        const imgH = h * config.cardImageRatio;

        // Determine resource icon
        let icon = '';
        if (res) { icon = config.resIcons[res.type] || ''; }

        // Shadow
        ctx.shadowColor = 'rgba(0,0,0,0.1)';
        ctx.shadowBlur = 12 * scale;
        ctx.shadowOffsetY = 4 * scale;
        ctx.shadowOffsetX = 0;

        // Background
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, cornerR);
        ctx.fillStyle = n.color || themeColors.surface;
        ctx.fill();

        // Card border (always drawn so the card is visible)
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, cornerR);
        ctx.strokeStyle = themeColors.outline;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Texture overlay on card
        if (n.texture) {
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, cornerR);
            ctx.clip();
            this.drawTextureEffect(ctx, n.x, n.y, Math.max(w, h) / 2, 'rounded-rect', n.texture);
            ctx.restore();
        }

        // Image / icon area (top 60%)
        if (res && res.type === 'image') {
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(x, y, w, imgH, [cornerR, cornerR, 0, 0]);
            ctx.clip();
            if (!this.imageCache.has(res.id) && this.app.utils.isSafeUrl(res.content)) {
                const img = new Image(); img.src = res.content;
                img.onload = () => this.imageCache.set(res.id, img);
                img.onerror = () => { this.imageCache.set(res.id, 'error'); };
                this.imageCache.set(res.id, 'loading');
            }
            const img = this.imageCache.get(res.id);
            if (img && img !== 'loading') {
                const scaleImg = Math.max(w / img.width, imgH / img.height);
                ctx.drawImage(img, n.x - img.width * scaleImg / 2, y + imgH / 2 - img.height * scaleImg / 2, img.width * scaleImg, img.height * scaleImg);
            }
            ctx.restore();
        } else if (icon) {
            ctx.font = `${24 * scale}px Arial`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = (n.type === 'root') ? 'rgba(255,255,255,0.9)' : '#f59e0b';
            ctx.fillText(icon, n.x, y + imgH / 2);
        } else {
            // Empty state — show a small icon so the card isn't blank
            ctx.font = `${20 * scale}px Arial`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';
            ctx.fillText('💡', n.x, y + imgH / 2);
        }

        // Separator line
        ctx.beginPath();
        ctx.moveTo(x + 8 * scale, y + imgH);
        ctx.lineTo(x + w - 8 * scale, y + imgH);
        ctx.strokeStyle = themeColors.outline;
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // Label area (bottom 40%)
        if (n.texture) {
            textColor = isDark ? '#f3f4f6' : '#1f2937';
        }
        ctx.fillStyle = textColor;
        ctx.font = `${n.type === 'root' ? 'bold ' : ''}${11 * scale}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

        const labelAreaY = y + imgH + (h - imgH) / 2;
        const maxW = w - 12 * scale;
        const lines = this.wrapText(ctx, n.label || '', maxW);
        const lineH = 13 * scale;
        const startY = labelAreaY - ((lines.length - 1) * lineH) / 2;
        lines.forEach((line, i) => ctx.fillText(line, n.x, startY + i * lineH));

        // Selection highlight
        if (this.app.state.selectedNodes.has(n.id)) {
            ctx.beginPath();
            ctx.roundRect(x - 3, y - 3, w + 6, h + 6, cornerR + 2);
            ctx.strokeStyle = themeColors.selection; ctx.lineWidth = 2; ctx.stroke();
        }

        // Search match highlight
        if (this.searchMatchNodeId === n.id) {
            ctx.beginPath();
            ctx.roundRect(x - 5, y - 5, w + 10, h + 10, cornerR + 3);
            ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 3;
            ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
        }

        // Note indicator
        if (n.note && n.scale >= 0.9) {
            ctx.beginPath();
            ctx.arc(x + 6, y + 6, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#f59e0b';
            ctx.fill();
        }
    }

    // --- Advanced border styles ---

    drawBorder(ctx, cx, cy, r, shape, style, color) {
        if (style === 'glow') {
            ctx.save();
            ctx.shadowColor = color;
            ctx.shadowBlur = 15;
            this.drawNodeShape(ctx, cx, cy, r, shape);
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
        } else if (style === 'double') {
            ctx.save();
            this.drawNodeShape(ctx, cx, cy, r, shape);
            ctx.strokeStyle = color;
            ctx.lineWidth = 4;
            ctx.globalAlpha = 0.3;
            ctx.stroke();
            this.drawNodeShape(ctx, cx, cy, r - 2, shape);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.globalAlpha = 1;
            ctx.stroke();
            ctx.restore();
        } else if (style === 'gradient') {
            ctx.save();
            // Use conic gradient for rainbow border effect
            const grad = ctx.createConicGradient(0, cx, cy);
            grad.addColorStop(0, '#6366f1');
            grad.addColorStop(0.25, '#ec4899');
            grad.addColorStop(0.5, '#f59e0b');
            grad.addColorStop(0.75, '#22c55e');
            grad.addColorStop(1, '#6366f1');
            this.drawNodeShape(ctx, cx, cy, r, shape);
            ctx.strokeStyle = grad;
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.restore();
        }
    }

    drawPlusButton(ctx, n) {
        if (n.scale >= 0.9) {
            const r = (n.type === 'root' ? config.nodeRadius : config.subRadius) * n.scale;
            const btnX = n.x + r * config.diagOffset;
            const btnY = n.y + r * config.diagOffset;
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

    // [P2-5] Minimap
    drawMinimap(ctx) {
        const nodes = this.app.state.nodes.filter(n => !isNaN(n.x) && !isNaN(n.y) && !n._deleting);
        if (nodes.length === 0) return;

        const mmW = 160, mmH = 100, pad = 12;
        const mmX = this.width - mmW - pad;
        const mmY = this.height - mmH - pad;
        const innerPad = 6; // padding inside minimap for node dots

        // Compute world bounds
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        nodes.forEach(n => {
            if (n.x < minX) minX = n.x;
            if (n.x > maxX) maxX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.y > maxY) maxY = n.y;
        });
        const rangeX = maxX - minX || 1;
        const rangeY = maxY - minY || 1;
        const drawW = mmW - innerPad * 2;
        const drawH = mmH - innerPad * 2;
        const scale = Math.min(drawW / rangeX, drawH / rangeY);
        const offsetX = mmX + innerPad + (drawW - rangeX * scale) / 2;
        const offsetY = mmY + innerPad + (drawH - rangeY * scale) / 2;

        // Helper: map world → minimap screen
        const mapX = wx => offsetX + (wx - minX) * scale;
        const mapY = wy => offsetY + (wy - minY) * scale;

        ctx.save();
        ctx.resetTransform();

        const isDark = document.body.getAttribute('data-theme') === 'dark';

        // Clip to minimap area so dots don't bleed outside
        ctx.beginPath();
        ctx.roundRect(mmX, mmY, mmW, mmH, 6);
        ctx.clip();

        // Background
        ctx.fillStyle = isDark ? 'rgba(30,30,35,0.85)' : 'rgba(255,255,255,0.85)';
        ctx.fill();

        // Nodes as dots
        nodes.forEach(n => {
            const dx = mapX(n.x);
            const dy = mapY(n.y);
            ctx.beginPath();
            ctx.arc(dx, dy, n.type === 'root' ? 4 : 2.5, 0, Math.PI * 2);
            ctx.fillStyle = n.type === 'root' ? '#6366f1' : (isDark ? '#a1a1aa' : '#71717a');
            ctx.fill();
        });

        // Viewport rect
        const cam = this.app.state.camera;
        const vpLeft = mapX(-cam.x / cam.k);
        const vpTop = mapY(-cam.y / cam.k);
        const vpW = (this.width / cam.k) * scale;
        const vpH = (this.height / cam.k) * scale;
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(vpLeft, vpTop, vpW, vpH);

        // Border (drawn after clip so it's fully visible)
        ctx.restore();
        ctx.save();
        ctx.resetTransform();
        ctx.strokeStyle = isDark ? '#3f3f46' : '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(mmX, mmY, mmW, mmH, 6);
        ctx.stroke();
        ctx.restore();

        // Store minimap bounds for click handling
        this._minimapBounds = { x: mmX, y: mmY, w: mmW, h: mmH, minX, minY, scale, offsetX, offsetY, innerPad };
    }

    // [P2-5] Handle minimap click to pan
    handleMinimapClick(screenX, screenY) {
        const b = this._minimapBounds;
        if (!b) return false;
        if (screenX < b.x || screenX > b.x + b.w || screenY < b.y || screenY > b.y + b.h) return false;
        const worldX = (screenX - b.offsetX) / b.scale + b.minX;
        const worldY = (screenY - b.offsetY) / b.scale + b.minY;
        const cam = this.app.state.camera;
        cam.x = this.width / 2 - worldX * cam.k;
        cam.y = this.height / 2 - worldY * cam.k;
        this.needsRender = true;
        return true;
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
            if (!n._deleting) this.drawPlusButton(ctx, n);
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
            ctx.fillText('点击 🎯 根节点 创建第一个节点', cx, cy - 14);
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
            this.drawMinimap(ctx);
        }

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

    // [Feature 10] Export to SVG
    exportSVG() {
        if (this.app.state.nodes.length === 0) return this.app.ui.toast('画布为空');
        let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
        this.app.state.nodes.forEach(n => {
            if (isNaN(n.x)||isNaN(n.y)) return;
            const r = n.type==='root' ? config.nodeRadius : config.subRadius;
            minX=Math.min(minX,n.x-r); maxX=Math.max(maxX,n.x+r);
            minY=Math.min(minY,n.y-r); maxY=Math.max(maxY,n.y+r);
        });
        const pad=50, w=maxX-minX+pad*2, h=maxY-minY+pad*2;
        const ox=-minX+pad, oy=-minY+pad;
        const isDark = document.body.getAttribute('data-theme')==='dark';
        const colors = isDark ? config.colorsDark : config.colors;
        const escX = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
        const safeColor = c => (/^#[0-9a-fA-F]{3,8}$/.test(c) || /^rgba?\([\d\s.,/%]+\)$/.test(c)) ? c : '#888';
        const parts = [];
        // Links
        this.app.state.links.forEach(l => {
            const s = typeof l.source==='object' ? l.source : this.app.state.nodes.find(n=>n.id===l.source);
            const t = typeof l.target==='object' ? l.target : this.app.state.nodes.find(n=>n.id===l.target);
            if (!s||!t||isNaN(s.x)||isNaN(t.x)) return;
            const sx=s.x+ox, sy=s.y+oy, tx=t.x+ox, ty=t.y+oy;
            if (l.type==='cross') {
                if (!this.app.state.showCrossLinks) return;
                const dx=t.x-s.x, dy=t.y-s.y, dist=Math.sqrt(dx*dx+dy*dy);
                if (dist===0) return;
                const offset=Math.min(dist*0.2,150);
                const nx=-dy/dist, ny=dx/dist;
                const cpx=(sx+tx)/2+nx*offset, cpy=(sy+ty)/2+ny*offset;
                const tr=(t.type==='root'?config.nodeRadius:config.subRadius)+5;
                const angle=Math.atan2(ty-cpy,tx-cpx);
                const ax=tx-tr*Math.cos(angle), ay=ty-tr*Math.sin(angle);
                parts.push(`<path d="M${sx},${sy} Q${cpx},${cpy} ${tx},${ty}" stroke="${colors.cross}" stroke-width="1.5" fill="none" stroke-dasharray="3,5" opacity="0.5"/>`);
                parts.push(`<polygon points="${ax},${ay} ${ax-10*Math.cos(angle-Math.PI/6)},${ay-10*Math.sin(angle-Math.PI/6)} ${ax-10*Math.cos(angle+Math.PI/6)},${ay-10*Math.sin(angle+Math.PI/6)}" fill="${colors.cross}" opacity="0.5"/>`);
            } else {
                parts.push(`<line x1="${sx}" y1="${sy}" x2="${tx}" y2="${ty}" stroke="${colors.link}" stroke-width="1.5"/>`);
            }
        });
        // Nodes
        this.app.state.nodes.forEach(n => {
            if (isNaN(n.x)||isNaN(n.y)) return;
            const nx=n.x+ox, ny=n.y+oy;
            const r=n.type==='root'?config.nodeRadius:config.subRadius;
            const res = n.resId ? this.app.state.resources.find(r=>r.id===n.resId) : null;
            let fill = n.type==='root' ? safeColor(n.color||colors.primary) : colors.surface;
            if (res&&res.type==='color') fill=safeColor(res.content);
            const stroke = n.type==='root' ? 'rgba(255,255,255,0.2)' : colors.outline;
            const sw = n.type==='root' ? 2 : 1.5;
            const shape = n.shape || 'circle';
            if (shape === 'rounded-rect') {
                parts.push(`<rect x="${nx-r}" y="${ny-r}" width="${r*2}" height="${r*2}" rx="${r*0.35}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
            } else {
                parts.push(`<circle cx="${nx}" cy="${ny}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
            }
            // Resource icon
            if (res&&res.type!=='color'&&res.type!=='image') {
                parts.push(`<text x="${nx}" y="${ny}" text-anchor="middle" dominant-baseline="middle" font-size="${n.type==='root'?32:22}">${config.resIcons[res.type]||'🔗'}</text>`);
            }
            // Note dot
            if (n.note) parts.push(`<circle cx="${nx-r*config.diagOffset}" cy="${ny-r*config.diagOffset}" r="5" fill="#f59e0b"/>`);
            // Label - wrap manually for SVG (approximation: 7px per char)
            const label = n.label||'';
            const maxW = r*4;
            const charsPerLine = Math.floor(maxW/7);
            const line1 = label.length<=charsPerLine ? label : label.slice(0,charsPerLine-1)+'…';
            const line2 = label.length>charsPerLine&&label.length<=charsPerLine*2 ? label.slice(charsPerLine) : (label.length>charsPerLine*2?label.slice(charsPerLine,charsPerLine*2-1)+'…':'');
            const textY=ny+r+15;
            const fw=n.type==='root'?'bold':'normal';
            const tc=isDark?'#f3f4f6':'#1f2937';
            parts.push(`<text x="${nx}" y="${textY}" text-anchor="middle" font-family="Segoe UI,sans-serif" font-size="12" font-weight="${fw}" fill="${tc}">${escX(line1)}</text>`);
            if (line2) parts.push(`<text x="${nx}" y="${textY+14}" text-anchor="middle" font-family="Segoe UI,sans-serif" font-size="12" font-weight="${fw}" fill="${tc}">${escX(line2)}</text>`);
        });
        const bg=isDark?'#18181b':'#f3f3f3';
        let svg=`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n<rect width="${w}" height="${h}" fill="${bg}"/>\n${parts.join('\n')}\n</svg>`;
        svg = this.app.utils.purifyHTML(svg);
        const blob=new Blob([svg],{type:'image/svg+xml'});
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a'); a.download=`MindFlow_${Date.now()}.svg`; a.href=url; a.click();
        URL.revokeObjectURL(url);
        this.app.ui.toast('SVG 已导出');
    }

    // Preload an image resource into the cache (called when resId is assigned)
    preloadImage(resId) {
        const res = this.app.state.resources.find(r => r.id === resId);
        if (!res || res.type !== 'image' || this.imageCache.has(res.id)) return;
        if (!this.app.utils.isSafeUrl(res.content)) return;
        const img = new Image(); img.src = res.content;
        img.onload = () => { this.imageCache.set(res.id, img); this.needsRender = true; };
        img.onerror = () => { this.imageCache.set(res.id, 'error'); };
        this.imageCache.set(res.id, 'loading');
    }

    drawImageInNode(ctx, node, res, r, shape) {
        if (!this.imageCache.has(res.id) && this.app.utils.isSafeUrl(res.content)) {
            const img = new Image(); img.src = res.content;
            img.onload = () => this.imageCache.set(res.id, img);
            img.onerror = () => { this.imageCache.set(res.id, 'error'); };
            this.imageCache.set(res.id, 'loading');
        }
        const img = this.imageCache.get(res.id);
        if (img && img !== 'loading') {
            ctx.save();
            this.drawNodeShape(ctx, node.x, node.y, r - 2, shape || 'circle');
            ctx.clip();
            const scale = Math.max((r*2)/img.width, (r*2)/img.height);
            ctx.drawImage(img, node.x - img.width*scale/2, node.y - img.height*scale/2, img.width*scale, img.height*scale);
            ctx.restore();
        }
    }

    addRootNode() {
        if (!this.app.state.currentId) return this.app.ui.toast('请先新建项目');
        this.app.data._snapshot();
        const cam = this.app.state.camera;
        const cx = (this.width / 2 - cam.x) / cam.k;
        const cy = (this.height / 2 - cam.y) / cam.k;
        const node = { id: config.idPrefix.node + Date.now(), type: 'root', x: cx + (Math.random() - 0.5) * 50, y: cy + (Math.random() - 0.5) * 50, label: '新主题', scale: 0.1 };
        this.app.state.nodes.push(node);
        this.app.state.selectedNodes.clear();
        this.app.state.selectedNodes.add(node.id);
        this.app.ui.showNodeBubble(node);
        this.updateSimulation();
        this.app.storage.triggerSave();
        this.app.ui.toast('已添加新主题节点');
    }

    addChildNode(parent) {
        this.app.data._snapshot();
        const angle = Math.random() * Math.PI * 2;
        const node = { id: config.idPrefix.node + Date.now(), type: 'sub', x: parent.x + Math.cos(angle) * 10, y: parent.y + Math.sin(angle) * 10, label: '新节点', scale: 0.05 };
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
            this.app.data._snapshot();
            this.app.state.nodes = []; this.app.state.links = [];
            this.app.state.selectedNodes.clear();
            this.app.ui.hideNodeBubble();
            this.updateSimulation();
            this.app.storage.triggerSave();
        }
    }

    // [New] 计算点击位置是否在连线附近
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
                const dx = t.x - s.x;
                const dy = t.y - s.y;
                const len = Math.sqrt(dx*dx + dy*dy);
                const offset = Math.min(len * 0.2, 150);
                const nx = -dy / len;
                const ny = dx / len;
                const cpX = (s.x + t.x) / 2 + nx * offset;
                const cpY = (s.y + t.y) / 2 + ny * offset;

                let steps = Math.ceil((len * camK) / 10);
                steps = Math.max(10, Math.min(steps, 200));

                for (let i = 0; i <= steps; i++) {
                    const stepT = i / steps;
                    const it = 1 - stepT;
                    const bx = it*it*s.x + 2*it*stepT*cpX + stepT*stepT*t.x;
                    const by = it*it*s.y + 2*it*stepT*cpY + stepT*stepT*t.y;

                    const d = Math.hypot(mx - bx, my - by);
                    if (d < dist) dist = d;
                }
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
        // [Feature 5] Drag resource to empty canvas → create new node
        canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            const resId = e.dataTransfer.getData('text/plain');
            if (!resId) return;
            const m = getPos(e);
            const hitNode = this.app.state.nodes.find(n => n.layout==='card' ? this.hitTestCard(m.x, m.y, n) : this.hitTestNode(m.x, m.y, n));
            if (hitNode) {
                this.app.data._snapshot();
                hitNode.resId = resId;
                this.preloadImage(resId);
                this.app.ui.toast('资源已关联');
                this.app.storage.triggerSave();
                this.app.graph.needsRender = true;
            } else {
                if (!this.app.state.currentId) return;
                const res = this.app.state.resources.find(r => r.id === resId);
                if (!res || res.type === 'folder') return;
                this.app.data._snapshot();
                const node = {
                    id: config.idPrefix.node + Date.now(), type: 'root',
                    x: m.x + (Math.random()-0.5)*20, y: m.y + (Math.random()-0.5)*20,
                    label: res.name, scale: 0.1, resId
                };
                this.app.state.nodes.push(node);
                this.preloadImage(resId);
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
                // 删除节点
                if (this.app.state.selectedNodes.size > 0) {
                    this.app.ui.onBubbleDelete();
                }
                // [Feature 11] 删除选中的飞线 — use confirmDialog
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
            if (this.showMinimap && this._minimapBounds) {
                const rect = canvas.getBoundingClientRect();
                const sx = (e.clientX || (e.touches && e.touches[0].clientX)) - rect.left;
                const sy = (e.clientY || (e.touches && e.touches[0].clientY)) - rect.top;
                if (this.handleMinimapClick(sx, sy)) return;
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
                    this.app.state.simulation.alphaTarget(config.alphaTarget).restart();
                }
            } else {
                // [New] 尝试选中飞线
                const hitLink = this.getLinkAtPos(m.x, m.y);
                if (hitLink) {
                    this.app.state.selectedLink = hitLink;
                    this.app.state.selectedNodes.clear(); // 清除节点选中
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
                    if (n.layout==='card' ? this.hitTestCard(m.x, m.y, n) : this.hitTestNode(m.x, m.y, n)) { hoverNode = n; break; }
                }
                // [Feature 7] Show tooltip for note too
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

                // Only select if the rectangle is large enough (>5px)
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
                // [P1-3] Check if click is on the label area (below the node)
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
