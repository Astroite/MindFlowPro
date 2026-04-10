export class NodeSearch {
    constructor(app) {
        this.app = app;
    }

    toggleNodeSearch() {
        const bar = document.getElementById('nodeSearchBar');
        const input = document.getElementById('nodeSearchInput');
        if (bar.style.display === 'none') {
            bar.style.display = 'flex';
            input.value = '';
            input.focus();
            this.app.state._searchMatches = [];
            this.app.state._searchIndex = -1;
            this.app.graph.searchMatchNodeId = null;
            document.getElementById('nodeSearchCount').textContent = '';
            this.app.graph.needsRender = true;
        } else {
            bar.style.display = 'none';
            this.app.state._searchMatches = [];
            this.app.state._searchIndex = -1;
            this.app.graph.searchMatchNodeId = null;
            this.app.graph.needsRender = true;
        }
    }

    searchNodes(keyword) {
        if (!keyword) {
            this.app.state._searchMatches = [];
            this.app.state._searchIndex = -1;
            this.app.graph.searchMatchNodeId = null;
            document.getElementById('nodeSearchCount').textContent = '';
            this.app.graph.needsRender = true;
            return;
        }
        const kw = keyword.toLowerCase();
        this.app.state._searchMatches = this.app.state.nodes.filter(
            n => !n._deleting && n.label && n.label.toLowerCase().includes(kw)
        );
        this.app.state._searchIndex = this.app.state._searchMatches.length > 0 ? 0 : -1;
        this._updateSearchUI();
    }

    nodeSearchPrev() {
        const matches = this.app.state._searchMatches;
        if (!matches || matches.length === 0) return;
        this.app.state._searchIndex = (this.app.state._searchIndex - 1 + matches.length) % matches.length;
        this._updateSearchUI();
    }

    nodeSearchNext() {
        const matches = this.app.state._searchMatches;
        if (!matches || matches.length === 0) return;
        this.app.state._searchIndex = (this.app.state._searchIndex + 1) % matches.length;
        this._updateSearchUI();
    }

    _updateSearchUI() {
        const matches = this.app.state._searchMatches;
        const idx = this.app.state._searchIndex;
        const countEl = document.getElementById('nodeSearchCount');
        if (!matches || matches.length === 0) {
            countEl.textContent = '无匹配';
            this.app.graph.searchMatchNodeId = null;
        } else {
            countEl.textContent = `${idx + 1}/${matches.length}`;
            const node = matches[idx];
            this.app.graph.searchMatchNodeId = node.id;
            const cam = this.app.state.camera;
            const targetX = this.app.graph.width / 2 - node.x * cam.k;
            const targetY = this.app.graph.height / 2 - node.y * cam.k;
            this._animateCamera(targetX, targetY, cam.k);
        }
        this.app.graph.needsRender = true;
    }

    _animateCamera(targetX, targetY, targetK) {
        const cam = this.app.state.camera;
        const startX = cam.x, startY = cam.y;
        const duration = 300;
        const start = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - start) / duration);
            const ease = t * (2 - t);
            cam.x = startX + (targetX - startX) * ease;
            cam.y = startY + (targetY - startY) * ease;
            cam.k = targetK;
            this.app.graph.needsRender = true;
            if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }
}
