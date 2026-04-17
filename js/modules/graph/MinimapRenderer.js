export class MinimapRenderer {
    constructor(app) {
        this.app = app;
        this._minimapBounds = null;
        this._minimapDirty = true;
        this._offscreen = null;
    }

    markDirty() { this._minimapDirty = true; }

    _renderOffscreen(nodes, mmW, mmH, innerPad, isDark) {
        if (!this._offscreen) {
            this._offscreen = document.createElement('canvas');
        }
        const oc = this._offscreen;
        oc.width = mmW;
        oc.height = mmH;
        const octx = oc.getContext('2d');
        octx.clearRect(0, 0, mmW, mmH);

        // Background
        octx.beginPath();
        octx.roundRect(0, 0, mmW, mmH, 6);
        octx.fillStyle = isDark ? 'rgba(30,30,35,0.85)' : 'rgba(255,255,255,0.85)';
        octx.fill();

        if (nodes.length === 0) return { rangeX: 1, rangeY: 1, minX: 0, minY: 0 };

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
        const ox = innerPad + (drawW - rangeX * scale) / 2;
        const oy = innerPad + (drawH - rangeY * scale) / 2;

        // Clip
        octx.save();
        octx.beginPath();
        octx.roundRect(0, 0, mmW, mmH, 6);
        octx.clip();

        // Nodes as dots
        nodes.forEach(n => {
            const dx = ox + (n.x - minX) * scale;
            const dy = oy + (n.y - minY) * scale;
            octx.beginPath();
            octx.arc(dx, dy, n.type === 'root' ? 4 : 2.5, 0, Math.PI * 2);
            octx.fillStyle = n.type === 'root' ? '#6366f1' : (isDark ? '#a1a1aa' : '#71717a');
            octx.fill();
        });
        octx.restore();

        return { rangeX, rangeY, minX, minY, scale, ox, oy };
    }

    drawMinimap(ctx, width, height) {
        const nodes = this.app.state.nodes.filter(n => !isNaN(n.x) && !isNaN(n.y) && !n._deleting);
        if (nodes.length === 0) return;

        const mmW = 160, mmH = 100, pad = 12;
        const mmX = width - mmW - pad;
        const mmY = height - mmH - pad;
        const innerPad = 6;

        const isDark = document.body.getAttribute('data-theme') === 'dark';

        // Only re-render node dots when data changed
        let bounds;
        if (this._minimapDirty || !this._offscreen) {
            bounds = this._renderOffscreen(nodes, mmW, mmH, innerPad, isDark);
            this._minimapDirty = false;
        } else {
            // Recompute bounds for viewport mapping (cheap vs re-rendering dots)
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
            const ox = innerPad + (drawW - rangeX * scale) / 2;
            const oy = innerPad + (drawH - rangeY * scale) / 2;
            bounds = { minX, minY, scale, ox, oy };
        }

        // Blit cached offscreen
        ctx.save();
        const dpr = (this.app.graph && this.app.graph.dpr) || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.drawImage(this._offscreen, mmX, mmY);

        // Viewport rect — always drawn fresh since camera changes every frame.
        // Clip to the rounded minimap box so zoomed-out viewports don't spill outside.
        const cam = this.app.state.camera;
        const vpLeft = mmX + bounds.ox + (-cam.x / cam.k - bounds.minX) * bounds.scale;
        const vpTop = mmY + bounds.oy + (-cam.y / cam.k - bounds.minY) * bounds.scale;
        const vpW = (width / cam.k) * bounds.scale;
        const vpH = (height / cam.k) * bounds.scale;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(mmX, mmY, mmW, mmH, 6);
        ctx.clip();
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(vpLeft, vpTop, vpW, vpH);
        ctx.restore();

        // Border
        ctx.strokeStyle = isDark ? '#3f3f46' : '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(mmX, mmY, mmW, mmH, 6);
        ctx.stroke();
        ctx.restore();

        // Store minimap bounds for click handling
        this._minimapBounds = {
            x: mmX, y: mmY, w: mmW, h: mmH,
            minX: bounds.minX, minY: bounds.minY,
            scale: bounds.scale,
            offsetX: mmX + bounds.ox, offsetY: mmY + bounds.oy,
            innerPad
        };
    }

    // [P2-5] Handle minimap click to pan
    handleMinimapClick(screenX, screenY, width, height) {
        const b = this._minimapBounds;
        if (!b) return false;
        if (screenX < b.x || screenX > b.x + b.w || screenY < b.y || screenY > b.y + b.h) return false;
        const worldX = (screenX - b.offsetX) / b.scale + b.minX;
        const worldY = (screenY - b.offsetY) / b.scale + b.minY;
        const cam = this.app.state.camera;
        cam.x = width / 2 - worldX * cam.k;
        cam.y = height / 2 - worldY * cam.k;
        return true;
    }
}
