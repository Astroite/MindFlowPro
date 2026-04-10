export class MinimapRenderer {
    constructor(app) {
        this.app = app;
        this._minimapBounds = null;
    }

    drawMinimap(ctx, width, height) {
        const nodes = this.app.state.nodes.filter(n => !isNaN(n.x) && !isNaN(n.y) && !n._deleting);
        if (nodes.length === 0) return;

        const mmW = 160, mmH = 100, pad = 12;
        const mmX = width - mmW - pad;
        const mmY = height - mmH - pad;
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
        const vpW = (width / cam.k) * scale;
        const vpH = (height / cam.k) * scale;
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
