import { config } from '../../config.js';

export class LinkRenderer {
    constructor(app) {
        this.app = app;
    }

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

    drawDragLink(ctx, mousePos) {
        if (!this.app.state.isLinking || !this.app.state.linkingSourceNode) return;

        const s = this.app.state.linkingSourceNode;
        const m = mousePos;

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
}
