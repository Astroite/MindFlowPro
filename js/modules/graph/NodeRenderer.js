import { config } from '../../config.js';

export class NodeRenderer {
    constructor(app) {
        this.app = app;
        this.imageCache = new Map();
        this._wrapCache = null;
        this.searchMatchNodeId = null;
        this.textureCache = new Map();
    }

    clearTextureCache() {
        this.textureCache.clear();
    }

    _getCachedOffscreen(key, size, drawFn) {
        if (this.textureCache.has(key)) return this.textureCache.get(key);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        drawFn(ctx, size);
        this.textureCache.set(key, canvas);
        return canvas;
    }

    _fillWithPattern(ctx, cx, cy, r, shape, offscreen) {
        const pattern = ctx.createPattern(offscreen, 'no-repeat');
        ctx.save();
        this.drawNodeShape(ctx, cx, cy, r, shape);
        const size = offscreen.width;
        const matrix = new DOMMatrix().translateSelf(cx - size / 2, cy - size / 2);
        pattern.setTransform(matrix);
        ctx.fillStyle = pattern;
        ctx.fill();
        ctx.restore();
    }

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

    // --- Material textures ---

    drawTextureEffect(ctx, cx, cy, r, shape, texture) {
        const isDark = document.body.getAttribute('data-theme') === 'dark';
        if (texture === 'solid') {
            // Pure color — no overlay
        } else if (texture === 'glass') {
            this._drawLiquidGlass(ctx, cx, cy, r, shape, isDark);
        } else if (texture === 'acrylic') {
            this._drawWood(ctx, cx, cy, r, shape, isDark);
        } else if (texture === 'metallic') {
            this._drawBrushedMetal(ctx, cx, cy, r, shape, isDark);
        }
    }

    // --- Liquid Glass ---

    _drawLiquidGlass(ctx, cx, cy, r, shape, isDark) {
        // 1. Bottom depth shadow
        const shadow = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
        shadow.addColorStop(0, 'rgba(0,0,0,0)');
        shadow.addColorStop(0.6, 'rgba(0,0,0,0.04)');
        shadow.addColorStop(1, isDark ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.12)');
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.fillStyle = shadow;
        ctx.fill();

        // 2. Inner glow
        const glow = ctx.createRadialGradient(cx, cy - r * 0.35, 0, cx, cy, r * 0.85);
        glow.addColorStop(0, isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.18)');
        glow.addColorStop(1, 'rgba(255,255,255,0)');
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.fillStyle = glow;
        ctx.fill();

        // 3. Caustic light spots (cached offscreen)
        const cacheKey = `glass-spots-${Math.round(r)}-${isDark ? 'd' : 'l'}`;
        const offscreen = this._getCachedOffscreen(cacheKey, Math.ceil(r * 2 + 8), (octx, size) => {
            const c = size / 2;
            const seed = Math.round(r);
            const spots = [
                { a: -0.52, d: 0.28, s: 0.25 },
                { a: 0.79, d: 0.42, s: 0.30 },
                { a: 2.62, d: 0.60, s: 0.22 },
                { a: -2.09, d: 0.78, s: 0.18 }
            ];
            spots.forEach((sp, i) => {
                const sx = c + Math.cos(sp.a + seed * 0.1) * r * sp.d;
                const sy = c + Math.sin(sp.a + seed * 0.1) * r * sp.d;
                const sr = r * sp.s;
                const g = octx.createRadialGradient(sx, sy, 0, sx, sy, sr);
                g.addColorStop(0, 'rgba(255,255,255,0.22)');
                g.addColorStop(0.3, 'rgba(255,255,255,0.08)');
                g.addColorStop(1, 'rgba(255,255,255,0)');
                octx.fillStyle = g;
                octx.fillRect(0, 0, size, size);
            });
        });
        this._fillWithPattern(ctx, cx, cy, r, shape, offscreen);

        // 4. Bright rim highlight (top arc)
        ctx.save();
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.lineWidth = 2.5;
        const rimGrad = ctx.createLinearGradient(cx, cy - r, cx, cy + r * 0.3);
        rimGrad.addColorStop(0, 'rgba(255,255,255,0.6)');
        rimGrad.addColorStop(0.4, 'rgba(255,255,255,0.15)');
        rimGrad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = rimGrad;
        ctx.stroke();
        ctx.restore();

        // 5. Top specular catch-light
        const spec = ctx.createRadialGradient(cx - r * 0.15, cy - r * 0.5, 0, cx - r * 0.15, cy - r * 0.5, r * 0.35);
        spec.addColorStop(0, 'rgba(255,255,255,0.45)');
        spec.addColorStop(0.5, 'rgba(255,255,255,0.12)');
        spec.addColorStop(1, 'rgba(255,255,255,0)');
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.fillStyle = spec;
        ctx.fill();

        // 6. Frosted tint (soft-light blend)
        ctx.save();
        ctx.globalCompositeOperation = 'soft-light';
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.fillStyle = isDark ? 'rgba(180,190,220,0.08)' : 'rgba(200,210,230,0.12)';
        ctx.fill();
        ctx.restore();
    }

    // --- Wood Grain ---

    _drawWood(ctx, cx, cy, r, shape, isDark) {
        const cacheKey = `wood-${Math.round(r)}-${isDark ? 'd' : 'l'}`;
        const offscreen = this._getCachedOffscreen(cacheKey, Math.ceil(r * 2 + 8), (octx, size) => {
            // Base color
            octx.fillStyle = isDark ? 'rgb(120,85,60)' : 'rgb(194,154,108)';
            octx.fillRect(0, 0, size, size);

            // Grain lines (1D noise via nested sin)
            const grainColor = isDark ? '50,30,15' : '90,60,30';
            const grainAlpha = isDark ? 0.10 : 0.15;
            for (let y = 0; y < size; y++) {
                const noise = Math.sin(y * 0.3 + Math.sin(y * 0.07) * 4) * 0.5 + 0.5;
                octx.globalAlpha = noise * grainAlpha;
                octx.fillStyle = `rgb(${grainColor})`;
                octx.fillRect(0, y, size, 1);
            }
            octx.globalAlpha = 1;

            // Ring knots (2 concentric clusters)
            const seed = Math.round(r);
            const knots = [
                { x: size * (0.3 + (seed % 3) * 0.05), y: size * (0.35 + (seed % 5) * 0.03) },
                { x: size * (0.7 - (seed % 4) * 0.04), y: size * (0.65 + (seed % 3) * 0.04) }
            ];
            knots.forEach(k => {
                for (let ring = 0; ring < 4; ring++) {
                    const rr = r * 0.15 + ring * r * 0.06;
                    const g = octx.createRadialGradient(k.x, k.y, rr - 1, k.x, k.y, rr + 1);
                    g.addColorStop(0, isDark ? 'rgba(50,30,15,0.10)' : 'rgba(80,50,20,0.12)');
                    g.addColorStop(1, 'rgba(80,50,20,0)');
                    octx.fillStyle = g;
                    octx.fillRect(0, 0, size, size);
                }
            });

            // Directional sheen along grain
            const sheen = octx.createLinearGradient(0, 0, size, size * 0.85);
            sheen.addColorStop(0, 'rgba(255,220,160,0.08)');
            sheen.addColorStop(0.5, 'rgba(255,220,160,0)');
            sheen.addColorStop(1, 'rgba(255,220,160,0.05)');
            octx.fillStyle = sheen;
            octx.fillRect(0, 0, size, size);
        });

        // Layer 1: Wood pattern fill
        this._fillWithPattern(ctx, cx, cy, r, shape, offscreen);

        // Layer 2: Top highlight
        const hl = ctx.createLinearGradient(cx, cy - r, cx, cy + r * 0.5);
        hl.addColorStop(0, isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.15)');
        hl.addColorStop(0.4, isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.05)');
        hl.addColorStop(1, 'rgba(255,255,255,0)');
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.fillStyle = hl;
        ctx.fill();

        // Layer 3: Varnish sheen (overlay blend)
        ctx.save();
        ctx.globalCompositeOperation = 'overlay';
        const varnish = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.3, 0, cx - r * 0.2, cy - r * 0.3, r * 0.7);
        varnish.addColorStop(0, isDark ? 'rgba(255,255,200,0.10)' : 'rgba(255,255,200,0.20)');
        varnish.addColorStop(1, 'rgba(255,255,200,0)');
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.fillStyle = varnish;
        ctx.fill();
        ctx.restore();

        // Layer 4: Edge vignette
        const vig = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(0.7, 'rgba(0,0,0,0)');
        vig.addColorStop(1, 'rgba(0,0,0,0.10)');
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.fillStyle = vig;
        ctx.fill();
    }

    // --- Brushed Metal ---

    _drawBrushedMetal(ctx, cx, cy, r, shape, isDark) {
        const cacheKey = `metal-${Math.round(r)}-${isDark ? 'd' : 'l'}`;
        const offscreen = this._getCachedOffscreen(cacheKey, Math.ceil(r * 2 + 8), (octx, size) => {
            // Base color
            octx.fillStyle = isDark ? 'rgb(70,70,75)' : 'rgb(180,180,185)';
            octx.fillRect(0, 0, size, size);

            // Brushed lines (deterministic pseudo-random positions)
            const seed = Math.round(r);
            for (let i = 0; i < 100; i++) {
                const y = (i * 7 + seed * 3 + (i * 13) % 17) % size;
                const isLight = i % 2 === 0;
                if (isDark) {
                    octx.fillStyle = isLight ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.06)';
                } else {
                    octx.fillStyle = isLight ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
                }
                octx.fillRect(0, y, size, 1);
            }

            // Color band (warm/cool shift)
            const cb = octx.createLinearGradient(0, 0, size, size);
            cb.addColorStop(0, 'rgba(180,200,220,0.06)');
            cb.addColorStop(0.4, 'rgba(200,180,160,0.04)');
            cb.addColorStop(0.6, 'rgba(180,200,220,0.06)');
            cb.addColorStop(1, 'rgba(160,160,180,0.04)');
            octx.fillStyle = cb;
            octx.fillRect(0, 0, size, size);
        });

        // Layer 1: Brushed pattern fill
        this._fillWithPattern(ctx, cx, cy, r, shape, offscreen);

        // Layer 2: Anisotropic specular band (sharp plateau in upper third)
        const spec = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
        spec.addColorStop(0, 'rgba(255,255,255,0.08)');
        spec.addColorStop(0.18, 'rgba(255,255,255,0.08)');
        spec.addColorStop(0.22, 'rgba(255,255,255,0.50)');
        spec.addColorStop(0.28, 'rgba(255,255,255,0.50)');
        spec.addColorStop(0.32, 'rgba(255,255,255,0.08)');
        spec.addColorStop(1, 'rgba(0,0,0,0.08)');
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.fillStyle = spec;
        ctx.fill();

        // Layer 3: Bottom reflection
        const refl = ctx.createLinearGradient(cx, cy, cx, cy + r);
        refl.addColorStop(0, 'rgba(0,0,0,0)');
        refl.addColorStop(0.5, 'rgba(0,0,0,0)');
        refl.addColorStop(1, 'rgba(255,255,255,0.06)');
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.fillStyle = refl;
        ctx.fill();

        // Layer 4: Edge bevel (top-left light, bottom-right dark)
        ctx.save();
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.lineWidth = 1.5;
        const bev = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
        bev.addColorStop(0, isDark ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.35)');
        bev.addColorStop(0.5, 'rgba(255,255,255,0.05)');
        bev.addColorStop(1, 'rgba(0,0,0,0.15)');
        ctx.strokeStyle = bev;
        ctx.stroke();
        ctx.restore();

        // Layer 5: Color shift overlay (soft-light blend)
        ctx.save();
        ctx.globalCompositeOperation = 'soft-light';
        const cshift = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
        const a = isDark ? 0.06 : 0.12;
        cshift.addColorStop(0, `rgba(100,140,200,${a})`);
        cshift.addColorStop(0.5, `rgba(200,160,100,${a * 0.67})`);
        cshift.addColorStop(1, `rgba(100,140,200,${a})`);
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.fillStyle = cshift;
        ctx.fill();
        ctx.restore();
    }

    // --- Card layout ---

    drawCardLayout(ctx, n, themeColors, textColor, res, isDark) {
        const { w, h } = this.app.graph.getCardDimensions(n);
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

    // Preload an image resource into the cache (called when resId is assigned)
    preloadImage(resId) {
        const res = this.app.state.resources.find(r => r.id === resId);
        if (!res || res.type !== 'image' || this.imageCache.has(res.id)) return;
        if (!this.app.utils.isSafeUrl(res.content)) return;
        const img = new Image(); img.src = res.content;
        img.onload = () => { this.imageCache.set(res.id, img); this.app.graph.needsRender = true; };
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
}
