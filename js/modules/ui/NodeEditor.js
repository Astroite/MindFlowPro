import { config } from '../../config.js';

export class NodeEditor {
    constructor(app) {
        this.app = app;
        this._colorChanged = false;
        this._colorReset = false;
    }

    setupShapeLayoutButtons() {
        this._colorChanged = false;
        this._colorReset = false;

        // Shape buttons
        document.querySelectorAll('.shape-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.shape-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-checked', 'false'); });
                btn.classList.add('active');
                btn.setAttribute('aria-checked', 'true');
            });
        });
        // Layout buttons — also toggle shape/ratio row
        document.querySelectorAll('.layout-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.layout-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-checked', 'false'); });
                btn.classList.add('active');
                btn.setAttribute('aria-checked', 'true');
                const isCard = btn.dataset.layout === 'card';
                document.getElementById('shapeOptions').style.display = isCard ? 'none' : 'flex';
                document.getElementById('ratioOptions').style.display = isCard ? 'flex' : 'none';
                document.getElementById('shapeRatioLabel').textContent = isCard ? '比例' : '形状';
            });
        });
        // Texture buttons — mutually exclusive toggle (click active to deselect)
        document.querySelectorAll('.texture-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const wasActive = btn.classList.contains('active');
                document.querySelectorAll('.texture-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-checked', 'false'); });
                if (!wasActive) { btn.classList.add('active'); btn.setAttribute('aria-checked', 'true'); }
            });
        });
        // Ratio buttons
        document.querySelectorAll('.ratio-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.ratio-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-checked', 'false'); });
                btn.classList.add('active');
                btn.setAttribute('aria-checked', 'true');
            });
        });
        // Color auto-enable on change
        document.getElementById('nodeColor').addEventListener('input', () => {
            this._colorChanged = true;
            this._colorReset = false;
        });
        // Color reset button
        document.getElementById('nodeColorReset').addEventListener('click', () => {
            this._colorReset = true;
            this._colorChanged = false;
            const isDark = document.body.getAttribute('data-theme') === 'dark';
            document.getElementById('nodeColor').value = isDark ? '#818cf8' : '#6366f1';
        });
    }

    handleSaveNodeEdit() {
        const node = this.app.state.editingNode;
        if (node) {
            const label = document.getElementById('nodeLabel').value;
            const resId = document.getElementById('nodeResSelect').value || null;
            const color = this._colorReset ? null : (this._colorChanged ? document.getElementById('nodeColor').value : node.color);
            const note = document.getElementById('nodeNote') ? document.getElementById('nodeNote').value.trim() || null : null;
            const activeShape = document.querySelector('.shape-btn.active');
            const shape = activeShape ? activeShape.dataset.shape : (node.shape || 'circle');
            const activeLayout = document.querySelector('.layout-btn.active');
            const layout = activeLayout ? activeLayout.dataset.layout : (node.layout || 'icon');
            const activeTexture = document.querySelector('.texture-btn.active');
            const texture = activeTexture ? activeTexture.dataset.texture : null;
            const borderStyle = document.getElementById('nodeBorderStyle') ? document.getElementById('nodeBorderStyle').value : 'solid';
            const activeRatio = document.querySelector('.ratio-btn.active');
            const cardRatio = activeRatio ? activeRatio.dataset.ratio : null;
            this.app.data.updateNode(node.id, { label, resId, color, note, shape, layout, texture, borderStyle, cardRatio });
        }
        this.app.state.editingNode = null;
        document.getElementById('nodeMenu').style.display = 'none';
    }

    openNodeMenu(node, x, y) {
        const m = this.app.dom.nodeMenu;
        this.app.state.editingNode = node;

        document.getElementById('nodeLabel').value = node.label;
        const sel = document.getElementById('nodeResSelect');
        sel.innerHTML = '<option value="">(无)</option>' + this.app.state.resources.filter(r=>r.type!=='folder').map(r =>
            `<option value="${r.id}" ${r.id===node.resId?'selected':''}>${this.app.utils.escapeHtml(r.name)}</option>`
        ).join('');

        // Color
        this._colorChanged = false;
        this._colorReset = false;
        const colorInput = document.getElementById('nodeColor');
        const isDark = document.body.getAttribute('data-theme') === 'dark';
        if (colorInput) colorInput.value = node.color || (isDark ? '#818cf8' : '#6366f1');

        // Note
        const noteEl = document.getElementById('nodeNote');
        if (noteEl) noteEl.value = node.note || '';

        // Shape
        document.querySelectorAll('.shape-btn').forEach(btn => {
            const isActive = btn.dataset.shape === (node.shape || 'circle');
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
        });

        // Texture
        document.querySelectorAll('.texture-btn').forEach(btn => {
            const isActive = btn.dataset.texture === (node.texture || '');
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
        });

        // Layout
        const isCard = (node.layout || 'icon') === 'card';
        document.querySelectorAll('.layout-btn').forEach(btn => {
            const isActive = btn.dataset.layout === (node.layout || 'icon');
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
        });
        document.getElementById('shapeOptions').style.display = isCard ? 'none' : 'flex';
        document.getElementById('ratioOptions').style.display = isCard ? 'flex' : 'none';
        document.getElementById('shapeRatioLabel').textContent = isCard ? '比例' : '形状';

        // Card ratio
        document.querySelectorAll('.ratio-btn').forEach(btn => {
            const isActive = btn.dataset.ratio === (node.cardRatio || '4:3');
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
        });

        // Border style
        const borderSel = document.getElementById('nodeBorderStyle');
        if (borderSel) borderSel.value = node.borderStyle || 'solid';

        if (x !== undefined && y !== undefined) {
            let left = x; let top = y;
            if (left + 320 > window.innerWidth) left = window.innerWidth - 340;
            if (top + 550 > window.innerHeight) top = window.innerHeight - 570;
            if (left < 20) left = 20; if (top < 20) top = 20;

            m.style.left = left + 'px';
            m.style.top = top + 'px';
        }
        m.style.display = 'flex';
    }

    showNodeBubble(node) {
        this.app.state.bubbleNode = node;
        this.app.dom.nodeBubble.style.display = 'flex';
        this.updateBubblePosition();
    }

    hideNodeBubble() {
        this.app.state.bubbleNode = null;
        this.app.dom.nodeBubble.style.display = 'none';
    }

    updateBubblePosition() {
        const node = this.app.state.bubbleNode;
        if (!node) return;

        const cam = this.app.state.camera;
        const r = (node.type === 'root' ? config.nodeRadius : config.subRadius) * (node.scale || 1);
        const canvasRect = this.app.dom.mainCanvas.getBoundingClientRect();

        const screenX = (node.x * cam.k + cam.x) + canvasRect.left;
        const screenY = (node.y * cam.k + cam.y) + canvasRect.top;
        const screenR = r * cam.k;

        const bubble = this.app.dom.nodeBubble;
        bubble.style.left = screenX + 'px';
        bubble.style.top = screenY + 'px';
        bubble.style.setProperty('--node-radius', screenR + 'px');
    }

    onBubbleEdit() {
        const node = this.app.state.bubbleNode;
        if (!node) return;
        this.hideNodeBubble();
        const cx = window.innerWidth / 2 - 160;
        const cy = window.innerHeight / 2 - 200;
        this.openNodeMenu(node, cx, cy);
    }

    async onBubbleDelete() {
        const idsToDelete = new Set();
        if (this.app.state.bubbleNode) idsToDelete.add(this.app.state.bubbleNode.id);
        this.app.state.selectedNodes.forEach(id => idsToDelete.add(id));
        if (idsToDelete.size === 0) return;
        const msg = idsToDelete.size > 1 ? `确定要删除选中的 ${idsToDelete.size} 个节点吗？` : '确定要删除这个节点及其连线吗？';
        const confirmed = await this.app.ui.confirmDialog(msg);
        if (confirmed) this.app.data.deleteNodes(Array.from(idsToDelete));
    }

    onBubbleLink() {
        const node = this.app.state.bubbleNode;
        if (!node) return;

        this.hideNodeBubble();
        this.app.state.isLinking = true;
        this.app.state.linkingSourceNode = node;
        this.app.ui.toast('请点击另一个节点以建立连接 (ESC取消)');
    }
}
