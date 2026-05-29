import { config } from '../../config.js';

export class NodeRenderer {
    constructor(app) {
        this.app = app;
        this.imageCache = new Map();
        this._wrapCacheMap = new Map();
        this._wrapCacheMax = 64;
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
        if (this._wrapCacheMap.has(cacheKey)) {
            // Move to end (most recently used)
            const cached = this._wrapCacheMap.get(cacheKey);
            this._wrapCacheMap.delete(cacheKey);
            this._wrapCacheMap.set(cacheKey, cached);
            return cached;
        }
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
        this._wrapCacheMap.set(cacheKey, result);
        if (this._wrapCacheMap.size > this._wrapCacheMax) {
            // Evict oldest (first) entry
            this._wrapCacheMap.delete(this._wrapCacheMap.keys().next().value);
        }
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

    drawNode(ctx, n, isDark) {
        if (isNaN(n.x) || isNaN(n.y)) return;
        if (typeof n.scale === 'undefined') n.scale = 1;

        // Scale animation
        if (n._deleting) {
            n.scale *= 0.8;
            if (n.scale < 0.05) { n._removeNow = true; return; }
        } else if (n.scale < 1) {
            n.scale += (1 - n.scale) * 0.15;
            if (n.scale > 0.99) n.scale = 1;
        }

        if (typeof isDark !== 'boolean') isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const themeColors = isDark ? (config.colorsDark || config.colors) : config.colors;
        const r = (n.type === 'root' ? config.nodeRadius : config.subRadius) * (n.scale || 1);
        const shape = n.shape || 'circle';
        const res = n.resId ? (this._resourceMap && this._resourceMap.get(n.resId)) || this.app.state.resources.find(r => r.id === n.resId) : null;

        let { fillColor, textColor, isColorCard } = this._resolveNodeAppearance(n, res, themeColors);

        if (n._deleting) ctx.globalAlpha = Math.max(0, n.scale);

        if (n.layout === 'card') {
            this.drawCardLayout(ctx, n, themeColors, textColor, res, isDark);
            ctx.globalAlpha = 1;
            return;
        }

        this._drawNodeVisuals(ctx, n, r, shape, fillColor, isColorCard, isDark);
        this._drawNodeOverlays(ctx, n, r, shape, res, themeColors, textColor, isDark, isColorCard);
    }

    _resolveNodeAppearance(n, res, themeColors) {
        let fillColor = n.type === 'root' ? themeColors.surface : themeColors.surface;
        let textColor = themeColors.textMain;
        let isColorCard = false;

        if (n.type === 'root') fillColor = themeColors.primary;
        if (n.type === 'root' && n.color) fillColor = n.color;
        if (res && res.type === 'color') { fillColor = res.content; isColorCard = true; }

        return { fillColor, textColor, isColorCard };
    }

    _drawNodeVisuals(ctx, n, r, shape, fillColor, isColorCard, isDark) {
        // Shadow
        if (n.type === 'root' && !isColorCard) {
            ctx.shadowColor = 'rgba(0,0,0,0.2)'; ctx.shadowBlur = 25 * n.scale; ctx.shadowOffsetY = 8 * n.scale;
        } else if (!isColorCard) {
            ctx.shadowColor = 'rgba(0,0,0,0.08)'; ctx.shadowBlur = 12 * n.scale; ctx.shadowOffsetY = 4 * n.scale;
        } else {
            ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        }
        ctx.shadowOffsetX = 0;

        // Background
        if (isColorCard) {
            ctx.save(); this.drawNodeShape(ctx, n.x, n.y, r, shape);
            ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.restore();
        }
        this.drawNodeShape(ctx, n.x, n.y, r, shape);
        ctx.fillStyle = fillColor; ctx.fill();
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

        // Texture
        if (n.texture) this.drawTextureEffect(ctx, n.x, n.y, r, shape, n.texture, isDark);

        // Content icon
        const res = n.resId ? (this._resourceMap && this._resourceMap.get(n.resId)) : null;
        if (res && res.type !== 'image' && res.type !== 'color') {
            const icon = config.resIcons[res.type] || '🔗';
            ctx.fillStyle = (n.type === 'root') ? 'rgba(255,255,255,0.9)' : '#f59e0b';
            ctx.font = `${(n.type === 'root' ? 36 : 24) * n.scale}px Arial`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(icon, n.x, n.y);
        } else if (res && res.type === 'image') {
            this.drawImageInNode(ctx, n, res, r, shape);
        }
    }

    _drawNodeOverlays(ctx, n, r, shape, res, themeColors, textColor, isDark, isColorCard) {
        // Border
        const borderStyle = n.borderStyle || 'solid';
        if (borderStyle !== 'solid' && !isColorCard) {
            const borderColor = (n.type === 'root') ? 'rgba(255,255,255,0.4)' : themeColors.outline;
            this.drawBorder(ctx, n.x, n.y, r, shape, borderStyle, borderColor);
        } else {
            this.drawNodeShape(ctx, n.x, n.y, r, shape);
            if (n.type === 'root') {
                if (!res || res.type !== 'color') { ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.stroke(); }
            } else if (!res || res.type !== 'color') {
                ctx.lineWidth = 1.5; ctx.strokeStyle = themeColors.outline; ctx.stroke();
            } else if (res && res.type === 'color') {
                ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff'; ctx.stroke();
            }
        }

        // Selection highlight
        if (this.app.state.selectedNodes.has(n.id) || (this.app.state.isLinking && this.app.state.linkingSourceNode?.id === n.id)) {
            this.drawNodeShape(ctx, n.x, n.y, r + 5, shape);
            ctx.strokeStyle = themeColors.selection; ctx.lineWidth = 2; ctx.stroke();
        }
        // Search highlight
        if (this.searchMatchNodeId === n.id) {
            this.drawNodeShape(ctx, n.x, n.y, r + 8, shape);
            ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 3;
            ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
        }

        // Label text
        ctx.globalAlpha = n.scale;
        if (n.texture) textColor = isDark ? '#f3f4f6' : '#1f2937';
        ctx.fillStyle = textColor;
        ctx.font = `${n.type === 'root' ? 'bold' : ''} ${12 * n.scale}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const textY = n.y + r + 15;
        const lines = this.wrapText(ctx, n.label || '', r * 4);
        lines.forEach((line, i) => ctx.fillText(line, n.x, textY + i * 14 * n.scale));
        ctx.globalAlpha = 1;

        // Note indicator
        if (n.note && n.scale >= 0.9) {
            ctx.beginPath();
            ctx.arc(n.x - r * config.diagOffset, n.y - r * config.diagOffset, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#f59e0b'; ctx.fill();
        }
    }

    // --- Material textures ---

    drawTextureEffect(ctx, cx, cy, r, shape, texture, isDark) {
        if (typeof isDark !== 'boolean') isDark = document.documentElement.getAttribute('data-theme') === 'dark';
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
        // 1. Bottom depth gradient — subtle darkening at the base gives a sense of form
        const depth = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
        depth.addColorStop(0, 'rgba(255,255,255,0)');
        depth.addColorStop(0.55, 'rgba(0,0,0,0)');
        depth.addColorStop(1, isDark ? 'rgba(0,0,0,0.25)' : 'rgba(10,20,40,0.12)');
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.fillStyle = depth;
        ctx.fill();

        // 2. Large diffuse top-left glow — main key light
        const lightX = cx - r * 0.32, lightY = cy - r * 0.42;
        const glow = ctx.createRadialGradient(lightX, lightY, 0, lightX, lightY, r * 1.15);
        glow.addColorStop(0, isDark ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.42)');
        glow.addColorStop(0.35, isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.14)');
        glow.addColorStop(1, 'rgba(255,255,255,0)');
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.fillStyle = glow;
        ctx.fill();

        // 3. Sharp catch-light — tiny specular dot where the key light peaks
        const spec = ctx.createRadialGradient(lightX, lightY, 0, lightX, lightY, r * 0.22);
        spec.addColorStop(0, 'rgba(255,255,255,0.85)');
        spec.addColorStop(0.55, 'rgba(255,255,255,0.15)');
        spec.addColorStop(1, 'rgba(255,255,255,0)');
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.fillStyle = spec;
        ctx.fill();

        // 4. Fresnel rim — bright top, soft bottom return (refraction at the edge)
        ctx.save();
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.lineWidth = 1.2;
        const rim = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
        rim.addColorStop(0, 'rgba(255,255,255,0.85)');
        rim.addColorStop(0.45, 'rgba(255,255,255,0.05)');
        rim.addColorStop(0.7, 'rgba(255,255,255,0)');
        rim.addColorStop(1, isDark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.28)');
        ctx.strokeStyle = rim;
        ctx.stroke();
        ctx.restore();

        // 5. Cool tint (soft-light preserves underlying color)
        ctx.save();
        ctx.globalCompositeOperation = 'soft-light';
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.fillStyle = isDark ? 'rgba(180,210,255,0.22)' : 'rgba(210,225,255,0.28)';
        ctx.fill();
        ctx.restore();
    }

    // --- Wood Grain ---

    _drawWood(ctx, cx, cy, r, shape, isDark) {
        const cacheKey = `wood-v2-${Math.round(r)}-${isDark ? 'd' : 'l'}`;
        const offscreen = this._getCachedOffscreen(cacheKey, Math.ceil(r * 2 + 8), (octx, size) => {
            // Warm diagonal base — gives depth without flat look
            const base = octx.createLinearGradient(0, 0, size, size);
            if (isDark) {
                base.addColorStop(0, 'rgb(108,76,48)');
                base.addColorStop(1, 'rgb(72,48,28)');
            } else {
                base.addColorStop(0, 'rgb(198,152,102)');
                base.addColorStop(1, 'rgb(166,122,82)');
            }
            octx.fillStyle = base;
            octx.fillRect(0, 0, size, size);

            // Organic grain — layered sines give fine + coarse variation
            const seed = Math.round(r) * 0.13;
            const darkHex = isDark ? '40,22,8' : '84,54,26';
            const lightHex = isDark ? '170,118,74' : '235,198,150';
            for (let y = 0; y < size; y++) {
                const n = Math.sin(y * 0.18 + seed) * 0.45
                        + Math.sin(y * 0.07 + seed * 2.3) * 0.35
                        + Math.sin(y * 0.41 + seed * 4.1) * 0.20;
                const v = (n + 1) / 2; // 0..1
                if (v < 0.34) {
                    const a = (0.12 + (0.34 - v) * 0.55).toFixed(3);
                    octx.fillStyle = `rgba(${darkHex},${a})`;
                    octx.fillRect(0, y, size, 1);
                } else if (v > 0.72) {
                    const a = (0.04 + (v - 0.72) * 0.28).toFixed(3);
                    octx.fillStyle = `rgba(${lightHex},${a})`;
                    octx.fillRect(0, y, size, 1);
                }
            }

            // Vertical micro-streaks add plank grain
            for (let x = 2; x < size; x += 2 + ((x * 7 + seed * 19) | 0) % 4) {
                octx.fillStyle = isDark ? 'rgba(0,0,0,0.035)' : 'rgba(0,0,0,0.028)';
                octx.fillRect(x, 0, 1, size);
            }
        });

        // Layer 1: Wood pattern fill
        this._fillWithPattern(ctx, cx, cy, r, shape, offscreen);

        // Layer 2: Warm top light
        const hl = ctx.createLinearGradient(cx, cy - r, cx, cy + r * 0.2);
        hl.addColorStop(0, isDark ? 'rgba(255,220,180,0.22)' : 'rgba(255,240,210,0.32)');
        hl.addColorStop(1, 'rgba(255,220,180,0)');
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.fillStyle = hl;
        ctx.fill();

        // Layer 3: Polished varnish reflection
        ctx.save();
        ctx.globalCompositeOperation = 'overlay';
        const varnish = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.4, 0, cx - r * 0.25, cy - r * 0.4, r * 0.85);
        varnish.addColorStop(0, isDark ? 'rgba(255,240,200,0.22)' : 'rgba(255,245,215,0.30)');
        varnish.addColorStop(0.55, 'rgba(255,240,200,0.04)');
        varnish.addColorStop(1, 'rgba(255,240,200,0)');
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.fillStyle = varnish;
        ctx.fill();
        ctx.restore();

        // Layer 4: Edge vignette — warm brown at light mode, deep shadow in dark
        const vig = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r * 1.02);
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(0.75, 'rgba(0,0,0,0)');
        vig.addColorStop(1, isDark ? 'rgba(0,0,0,0.35)' : 'rgba(60,30,10,0.22)');
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.fillStyle = vig;
        ctx.fill();
    }

    // --- Brushed Metal ---

    _drawBrushedMetal(ctx, cx, cy, r, shape, isDark) {
        const cacheKey = `metal-v2-${Math.round(r)}-${isDark ? 'd' : 'l'}`;
        const offscreen = this._getCachedOffscreen(cacheKey, Math.ceil(r * 2 + 8), (octx, size) => {
            // Vertical base gradient (sky highlight top, ground shadow bottom)
            const base = octx.createLinearGradient(0, 0, 0, size);
            if (isDark) {
                base.addColorStop(0, 'rgb(138,140,146)');
                base.addColorStop(0.5, 'rgb(72,74,80)');
                base.addColorStop(1, 'rgb(42,44,48)');
            } else {
                base.addColorStop(0, 'rgb(236,238,242)');
                base.addColorStop(0.5, 'rgb(172,174,182)');
                base.addColorStop(1, 'rgb(130,132,140)');
            }
            octx.fillStyle = base;
            octx.fillRect(0, 0, size, size);

            // Fine horizontal brushing — hash-based per row, both lighter and darker
            const seed = Math.round(r) * 17 + 1;
            for (let y = 0; y < size; y++) {
                const h = (Math.sin(y * 12.9898 + seed) * 43758.5453);
                const v = h - Math.floor(h); // pseudo-random 0..1
                if (v < 0.5) {
                    octx.fillStyle = `rgba(0,0,0,${(0.015 + v * 0.10).toFixed(3)})`;
                } else {
                    octx.fillStyle = `rgba(255,255,255,${(0.015 + (v - 0.5) * 0.11).toFixed(3)})`;
                }
                octx.fillRect(0, y, size, 1);
            }
        });

        // Layer 1: Brushed pattern fill
        this._fillWithPattern(ctx, cx, cy, r, shape, offscreen);

        // Layer 2: Soft anisotropic highlight band (top 40%)
        const spec = ctx.createLinearGradient(cx, cy - r, cx, cy + r * 0.2);
        spec.addColorStop(0, 'rgba(255,255,255,0.38)');
        spec.addColorStop(0.5, 'rgba(255,255,255,0.10)');
        spec.addColorStop(1, 'rgba(255,255,255,0)');
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.fillStyle = spec;
        ctx.fill();

        // Layer 3: Bottom environment shadow
        const btm = ctx.createLinearGradient(cx, cy + r * 0.15, cx, cy + r);
        btm.addColorStop(0, 'rgba(0,0,0,0)');
        btm.addColorStop(1, isDark ? 'rgba(0,0,0,0.38)' : 'rgba(0,0,0,0.20)');
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.fillStyle = btm;
        ctx.fill();

        // Layer 4: Chrome-like horizontal color shift (soft-light)
        ctx.save();
        ctx.globalCompositeOperation = 'soft-light';
        const cshift = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
        cshift.addColorStop(0, isDark ? 'rgba(120,150,210,0.22)' : 'rgba(180,205,235,0.28)');
        cshift.addColorStop(0.5, 'rgba(255,255,255,0)');
        cshift.addColorStop(1, isDark ? 'rgba(220,180,140,0.22)' : 'rgba(235,205,170,0.28)');
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.fillStyle = cshift;
        ctx.fill();
        ctx.restore();

        // Layer 5: Two-tone polished bevel
        ctx.save();
        this.drawNodeShape(ctx, cx, cy, r, shape);
        ctx.lineWidth = 1;
        const bev = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
        bev.addColorStop(0, 'rgba(255,255,255,0.65)');
        bev.addColorStop(0.45, 'rgba(255,255,255,0.08)');
        bev.addColorStop(1, isDark ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.25)');
        ctx.strokeStyle = bev;
        ctx.stroke();
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
            if (img && img !== 'loading' && img !== 'error' && img.width) {
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
        img.onerror = () => {
            this.imageCache.set(res.id, 'error');
            // Clear the error entry after 30s so a later retry (e.g. transient data URL parse) can succeed
            setTimeout(() => {
                if (this.imageCache.get(res.id) === 'error') this.imageCache.delete(res.id);
            }, 30000);
        };
        this.imageCache.set(res.id, 'loading');
    }

    drawImageInNode(ctx, node, res, r, shape) {
        if (!this.imageCache.has(res.id)) this.preloadImage(res.id);
        const img = this.imageCache.get(res.id);
        if (img && img !== 'loading' && img !== 'error' && img.width) {
            ctx.save();
            this.drawNodeShape(ctx, node.x, node.y, r - 2, shape || 'circle');
            ctx.clip();
            const scale = Math.max((r*2)/img.width, (r*2)/img.height);
            ctx.drawImage(img, node.x - img.width*scale/2, node.y - img.height*scale/2, img.width*scale, img.height*scale);
            ctx.restore();
        }
    }
}
