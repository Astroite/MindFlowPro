import { config } from '../../config.js';

export class ExportManager {
    constructor(app) {
        this.app = app;
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
                    this.app.graph.linkRenderer.drawLink(ctx, l);
                }
            }
        });

        this.app.state.nodes.forEach(n => {
            if (isNaN(n.x) || isNaN(n.y)) return;
            this.app.graph.nodeRenderer.drawNode(ctx, n);
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
}
