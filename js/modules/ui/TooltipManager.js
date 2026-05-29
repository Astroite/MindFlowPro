import { config } from '../../config.js';

export class TooltipManager {
    constructor(app) {
        this.app = app;
        this.tooltipEl = null;
    }

    initTooltip() {
        this.tooltipEl = document.createElement('div');
        this.tooltipEl.className = 'mindflow-tooltip';
        Object.assign(this.tooltipEl.style, {
            position: 'fixed', display: 'none', zIndex: '1000',
            borderRadius: '6px',
            padding: '10px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)',
            maxWidth: '300px', maxHeight: '300px', overflow: 'hidden', pointerEvents: 'auto'
        });
        document.body.appendChild(this.tooltipEl);
        this.tooltipEl.addEventListener('mouseenter', () => clearTimeout(this.app.state.tooltipTimer));
        this.tooltipEl.addEventListener('mouseleave', () => this.hideTooltip());
        this._updateTooltipTheme();
    }

    _updateTooltipTheme() {
        if (!this.tooltipEl) return;
        const cs = getComputedStyle(document.documentElement);
        this.tooltipEl.style.background = cs.getPropertyValue('--bg-surface-solid').trim();
        this.tooltipEl.style.border = '1px solid ' + cs.getPropertyValue('--border-color').trim();
        this.tooltipEl.style.color = cs.getPropertyValue('--text-main').trim();
    }

    showSidebarPreview(resId, event) {
        this.displayTooltip(resId, event.clientX + 10, event.clientY);
    }

    displayTooltip(resId, x, y) {
        clearTimeout(this.app.state.tooltipTimer);
        const res = this.app.state.resources.find(r => r.id === resId);
        if (!res) return;

        this._updateTooltipTheme();
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

        let content = '';
        if (res.type === 'image') {
            content = this.app.utils.isSafeUrl(res.content) ? `<img src="${this.app.utils.escapeHtml(res.content)}" style="max-width:100%; max-height:200px; display:block; border-radius:4px;">` : '不安全的图片来源';
        }
        else if (res.type === 'md') {
            let html = '';
            if (typeof marked !== 'undefined') {
                try { html = marked.parse(res.content); } catch (e) { console.error(e); }
            } else {
                html = '<pre>' + this.app.utils.escapeHtml(res.content || '') + '</pre>';
            }
            html = this.app.utils.purifyHTML(html);
            const mdBg = isDark ? 'rgba(30,30,30,0.8)' : 'rgba(248,249,250,0.9)';
            content = `<div class="md-preview" style="background:${mdBg}; padding:10px; border-radius:4px; max-height:280px; overflow-y:auto;">${html}</div>`;
        }
        else if (res.type === 'code') {
            const codeBg = isDark ? '#1e1e1e' : '#282c34';
            const codeColor = isDark ? '#d4d4d4' : '#abb2bf';
            content = `<pre style="font-family:monospace; background:${codeBg}; color:${codeColor}; padding:10px; border-radius:4px; font-size:12px; overflow:auto;">${this.app.utils.escapeHtml(res.content)}</pre>`;
        }
        else if (res.type === 'color') {
            const borderC = isDark ? '#3f3f46' : '#ddd';
            content = `<div style="width:100px; height:60px; background-color:${this.app.utils.escapeHtml(res.content)}; border-radius:4px; border:1px solid ${borderC}; margin-bottom:5px;"></div><div style="text-align:center; font-family:monospace; font-weight:bold;">${this.app.utils.escapeHtml(res.content)}</div>`;
        }
        else if (res.type === 'audio') {
            content = this.app.utils.isSafeUrl(res.content) ? `<audio controls src="${this.app.utils.escapeHtml(res.content)}" style="width:250px;"></audio>` : '不安全的音频来源';
        }
        else if (res.type === 'link') {
            const linkSub = isDark ? '#a1a1aa' : '#555';
            const safeUrl = this.app.utils.isSafeUrl(res.content) ? res.content : '#';
            content = `<div style="font-size:12px; color:${linkSub}; margin-bottom:8px; word-break:break-all;">${this.app.utils.escapeHtml(res.content)}</div><a href="${this.app.utils.escapeHtml(safeUrl)}" target="_blank" style="display:block; text-align:center; background:#667eea; color:white; text-decoration:none; padding:6px; border-radius:4px; font-size:12px;">跳转到链接 </a>`;
        }

        this.tooltipEl.innerHTML = content;
        this.tooltipEl.style.display = 'block';
        this._positionTooltip(x, y);
    }

    _positionTooltip(x, y) {
        const pad = 15;
        let top = y + pad, left = x + pad;
        const rect = this.tooltipEl.getBoundingClientRect();
        if (left + rect.width > window.innerWidth) left = x - rect.width - pad;
        if (top + rect.height > window.innerHeight) top = y - rect.height - pad;
        this.tooltipEl.style.top = top + 'px';
        this.tooltipEl.style.left = left + 'px';
    }

    hideTooltip() {
        clearTimeout(this.app.state.tooltipTimer);
        this.app.state.tooltipTimer = setTimeout(() => {
            if (this.tooltipEl) {
                this.tooltipEl.querySelectorAll('audio').forEach(a => { a.pause(); a.currentTime = 0; });
                this.tooltipEl.style.display = 'none';
            }
        }, config.previewDelay);
    }

    showTooltip(node, x, y) {
        if (node.resId) {
            this.displayTooltip(node.resId, x, y);
        } else if (node.note) {
            this.displayNoteTooltip(node.note, x, y);
        }
    }

    displayNoteTooltip(note, x, y) {
        clearTimeout(this.app.state.tooltipTimer);
        this.tooltipEl.innerHTML = `<div style="font-size:13px;line-height:1.6;white-space:pre-wrap;max-width:260px;">${this.app.utils.escapeHtml(note)}</div>`;
        this.tooltipEl.style.display = 'block';
        this._positionTooltip(x, y);
    }
}
