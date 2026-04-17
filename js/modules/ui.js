import { config } from '../config.js';
import { TooltipManager } from './ui/TooltipManager.js';
import { NodeEditor } from './ui/NodeEditor.js';
import { NodeSearch } from './ui/NodeSearch.js';

export class UIModule {
    /**
     * @param {import('../types.js').App} app
     */
    constructor(app) {
        this.app = app;
        this._promptResolve = null;
        this._promptMode = 'input'; // 'input' | 'confirm'

        // Sub-modules
        this.tooltipManager = new TooltipManager(app);
        this.nodeEditor = new NodeEditor(app);
        this.nodeSearch = new NodeSearch(app);
    }

    init() {
        this.tooltipManager.initTooltip();
        this.bindGlobalEvents();
        this.setupInputModal();
        this.nodeEditor.setupShapeLayoutButtons();
        this._wireResourceTreeEvents();

        this.app.eventBus.on('resources:updated', () => this.renderResourceTree());
        this.app.eventBus.on('nodes:deleted', () => {
            this.app.state.selectedNodes.clear();
            this.app.state.bubbleNode = null;
            this.app.state.editingNode = null;
            this.nodeEditor.hideNodeBubble();
        });
        this.app.eventBus.on('toast', (data) => this.toast(data.msg, data.type));

        // Offline detection
        const updateOnlineStatus = () => {
            const status = document.getElementById('saveStatus');
            if (!navigator.onLine) {
                if (status) status.textContent = '离线模式';
                this.toast('网络已断开，数据保存在本地', 'error');
            } else if (status && status.textContent === '离线模式') {
                status.textContent = '就绪';
            }
        };
        window.addEventListener('offline', updateOnlineStatus);
        window.addEventListener('online', () => {
            const status = document.getElementById('saveStatus');
            if (status && status.textContent === '离线模式') {
                status.textContent = '就绪';
                this.toast('网络已恢复');
            }
        });
    }

    // --- Delegate methods for external callers ---

    showTooltip(node, x, y) { this.tooltipManager.showTooltip(node, x, y); }
    hideTooltip() { this.tooltipManager.hideTooltip(); }
    showSidebarPreview(resId, event) { this.tooltipManager.showSidebarPreview(resId, event); }

    showNodeBubble(node) { this.nodeEditor.showNodeBubble(node); }
    hideNodeBubble() { this.nodeEditor.hideNodeBubble(); }
    updateBubblePosition() { this.nodeEditor.updateBubblePosition(); }
    onBubbleEdit() { this.nodeEditor.onBubbleEdit(); }
    onBubbleDelete() { return this.nodeEditor.onBubbleDelete(); }
    onBubbleLink() { this.nodeEditor.onBubbleLink(); }
    openNodeMenu(node, x, y) { this.nodeEditor.openNodeMenu(node, x, y); }
    handleSaveNodeEdit() { this.nodeEditor.handleSaveNodeEdit(); }

    toggleNodeSearch() { this.nodeSearch.toggleNodeSearch(); }
    searchNodes(keyword) { this.nodeSearch.searchNodes(keyword); }
    nodeSearchPrev() { this.nodeSearch.nodeSearchPrev(); }
    nodeSearchNext() { this.nodeSearch.nodeSearchNext(); }

    // --- Modal / Prompt system ---

    setupInputModal() {
        const confirmBtn = document.getElementById('inputModalConfirm');
        const cancelBtn = document.getElementById('inputModalCancel');
        const input = document.getElementById('inputModalValue');

        const resetModal = () => {
            input.style.display = '';
            this._promptMode = 'input';
            this._promptResolve = null;
        };

        const confirmHandler = () => {
            if (this._promptResolve) {
                if (this._promptMode === 'confirm') {
                    this._promptResolve(true);
                } else {
                    const val = input.value.trim();
                    this._promptResolve(val || null);
                }
            }
            this.closeModal('inputModal');
            resetModal();
        };

        const cancelHandler = () => {
            if (this._promptResolve) {
                this._promptResolve(this._promptMode === 'confirm' ? false : null);
            }
            this.closeModal('inputModal');
            resetModal();
        };

        confirmBtn.onclick = confirmHandler;
        cancelBtn.onclick = cancelHandler;

        input.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') confirmHandler();
            if (e.key === 'Escape') cancelHandler();
        });
    }

    promptUser(title, placeholder = '', defaultValue = '') {
        return new Promise((resolve) => {
            this._promptResolve = resolve;
            this._promptMode = 'input';
            document.getElementById('inputModalTitle').innerText = title;
            const input = document.getElementById('inputModalValue');
            input.style.display = '';
            input.placeholder = placeholder;
            input.value = defaultValue;
            this.openModal('inputModal');
        });
    }

    confirmDialog(msg) {
        return new Promise((resolve) => {
            this._promptResolve = resolve;
            this._promptMode = 'confirm';
            document.getElementById('inputModalTitle').innerText = msg;
            const input = document.getElementById('inputModalValue');
            input.style.display = 'none';
            this.openModal('inputModal');
        });
    }

    // --- Global events ---

    bindGlobalEvents() {
        // Event delegation for data-action buttons
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            const actions = {
                saveDisk: () => this.app.storage.triggerSaveDisk(),
                openDisk: () => this.app.storage.triggerOpenDisk(),
                duplicateProject: () => this.duplicateCurrentProject(),
                deleteProject: () => this.confirmDeleteProject(),
                createFolder: () => this.handleCreateFolder(),
                openResModal: () => this.openResModal(),
                toggleBatchMode: () => this.toggleBatchMode(),
                batchMove: () => this.batchMoveToFolder(),
                batchDelete: () => this.batchDelete(),
                toggleSidebar: () => this.toggleSidebar(),
                addRootNode: () => this.app.graph.addRootNode(),
                resetCamera: () => this.app.graph.resetCamera(),
                toggleExportMenu: () => this.toggleExportMenu(),
                exportPng: () => { this.exportImage(); this.closeExportMenu(); },
                exportSvg: () => { this.app.graph.exportManager.exportSVG(); this.closeExportMenu(); },
                toggleMinimap: () => this.toggleMinimap(),
                toggleTheme: () => this.toggleTheme(),
                toggleNodeSearch: () => this.toggleNodeSearch(),
                openShortcuts: () => this.openModal('shortcutsModal'),
                nodeSearchPrev: () => this.nodeSearchPrev(),
                nodeSearchNext: () => this.nodeSearchNext(),
                bubbleEdit: () => this.onBubbleEdit(),
                bubbleLink: () => this.onBubbleLink(),
                bubbleDelete: () => this.onBubbleDelete(),
                closeModal: () => this.closeModal(btn.dataset.modal),
                closeNodeMenu: () => { document.getElementById('nodeMenu').style.display = 'none'; },
                saveResource: () => this.handleSaveResourceClick(),
                saveNodeEdit: () => this.handleSaveNodeEdit(),
            };
            if (actions[action]) actions[action]();
        });

        // Project title rename on change
        this.app.dom.projTitleInput.addEventListener('change', (e) => {
            this.app.data.renameProject(e.target.value);
        });

        this.app.dom.projSelect.addEventListener('change', async (e) => {
            try {
                if (e.target.value === '__new__') {
                    const name = await this.promptUser('新建项目', '请输入项目名称');
                    if (name) {
                        this.toast('正在创建项目...');
                        const id = await this.app.storage.createProject(name);
                        await this.app.storage.loadProject(id);
                    } else {
                        this.updateProjectSelect();
                    }
                } else {
                    await this.app.storage.loadProject(e.target.value);
                }
            } catch (err) {
                console.error('项目操作失败:', err);
                this.toast('项目操作失败: ' + err.message, 'error');
                this.updateProjectSelect();
            }
        });

        document.getElementById('resFile').addEventListener('change', async (e) => {
            const f = e.target.files[0]; if (!f) return;
            const isImage = f.type.startsWith('image/');
            if (isImage && f.size > config.maxImageSizeMB * 1024 * 1024) {
                const ok = await this.confirmDialog(`图片超过 ${config.maxImageSizeMB}MB，将自动压缩，是否继续？`);
                if (!ok) {
                    e.target.value = '';
                    return;
                }
            }
            const reader = new FileReader();
            reader.onload = ev => this.app.state.tempFileBase64 = ev.target.result;
            reader.readAsDataURL(f);
        });

        document.getElementById('resColorInput').addEventListener('input', (e) => {
            document.getElementById('resColorValue').innerText = e.target.value;
        });

        const impInput = document.getElementById('importInput');
        if (impInput) impInput.addEventListener('change', (e) => {
            if(e.target.files[0]) {
                this.app.storage.importProjectFromFile(e.target.files[0]);
                e.target.value='';
            }
        });

        // Resource tree drag/drop/click/hover are wired in _wireResourceTreeEvents()

        // 绑定全局快捷键：Alt + L 切换飞线显示
        window.addEventListener('keydown', (e) => {
            if (e.altKey && e.code === 'KeyL') {
                this.toggleCrossLinks();
            }
        });

        // Keyboard shortcut registry — replaces long if-else chain
        const _getSelectedNode = () => {
            if (this.app.state.selectedNodes.size !== 1) return null;
            const id = [...this.app.state.selectedNodes][0];
            return this.app.state.nodes.find(n => n.id === id) || null;
        };
        const _isInput = (e) => ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName);
        const _mod = (e) => e.ctrlKey || e.metaKey;

        this._shortcuts = [
            // [Feature 1] Undo/Redo
            { key: 'z', mod: true, shift: false, guard: _isInput, action: () => this.app.data.undo() },
            { key: 'z', mod: true, shift: true, guard: _isInput, action: () => this.app.data.redo() },
            { key: 'y', mod: true, guard: _isInput, action: () => this.app.data.redo() },
            // [P0-2] Core shortcuts
            { key: 'n', mod: true, guard: _isInput, action: () => this.app.graph.addRootNode() },
            { key: 'f', mod: true, guard: _isInput, action: () => {
                const s = document.querySelector('.search-input');
                if (s) { s.focus(); s.select(); }
            }},
            { key: 's', mod: true, guard: _isInput, action: () => this.app.storage.forceSave() },
            { key: 'e', mod: true, guard: _isInput, action: () => this.exportImage() },
            // [P0-2] Tab — add child node
            { key: 'Tab', guard: _isInput, action: () => { const n = _getSelectedNode(); if (n) this.app.graph.addChildNode(n); } },
            // [P1-3] F2 — inline edit
            { key: 'F2', guard: _isInput, action: () => { const n = _getSelectedNode(); if (n) this.app.graph.inlineEdit(n); } },
            // [P0-5] Copy/paste/duplicate
            { key: 'c', mod: true, guard: _isInput, requireSelection: true, action: () => this.app.data.copySelectedNodes() },
            { key: 'v', mod: true, guard: _isInput, action: () => this.app.data.pasteNodes(config.pasteOffset, config.pasteOffset) },
            { key: 'd', mod: true, guard: _isInput, requireSelection: true, action: () => this.app.data.duplicateSelectedNodes() },
            // [P2-3] ? — shortcuts help
            { key: '?', guard: _isInput, action: () => this.openModal('shortcutsModal') },
            // [P2-2] Ctrl+G — node search
            { key: 'g', mod: true, guard: _isInput, action: () => {
                const bar = document.getElementById('nodeSearchBar');
                if (bar.style.display !== 'none') this.nodeSearchNext();
                else this.toggleNodeSearch();
            }},
            // Escape — close modal or search bar
            { key: 'Escape', action: () => {
                const modals = ['inputModal', 'resModal', 'shortcutsModal', 'viewerModal'];
                for (const id of modals) {
                    const el = document.getElementById(id);
                    if (el && el.style.display !== 'none') { this.closeModal(id); return; }
                }
                const bar = document.getElementById('nodeSearchBar');
                if (bar.style.display !== 'none') this.toggleNodeSearch();
            }},
        ];

        window.addEventListener('keydown', (e) => {
            for (const s of this._shortcuts) {
                if (s.key !== e.key) continue;
                if (s.mod && !_mod(e)) continue;
                if (s.shift !== undefined && e.shiftKey !== s.shift) continue;
                if (s.guard && s.guard(e)) return;
                if (s.requireSelection && this.app.state.selectedNodes.size === 0) continue;
                e.preventDefault();
                s.action();
                return;
            }
        });
    }

    updateSaveStatus(text) {
        if (this.app.dom.saveStatus) this.app.dom.saveStatus.innerText = text;
    }

    updateProjectSelect() {
        const sel = this.app.dom.projSelect;
        let h = `<option value="" disabled ${!this.app.state.currentId?'selected':''}>-- 选择项目 --</option>`;
        h += `<option value="__new__" style="color:#667eea; font-weight:bold;">+ 新建项目</option>`;
        this.app.state.projectsIndex.forEach(p => {
            const isSelected = p.id === this.app.state.currentId ? 'selected' : '';
            h += `<option value="${p.id}" ${isSelected}>  ${this.app.utils.escapeHtml(p.name)}</option>`;
        });
        sel.innerHTML = h;
    }

    // --- Resource tree ---

    renderResourceTree() {
        const container = this.app.dom.resList;
        const resources = this.app.state.resources;
        if (!resources.length) {
            container.innerHTML = '<div class="empty-tip">暂无资源<br><small>拖入文件或点击添加</small></div>';
            this._renderTagFilter();
            return;
        }
        const keyword = this.app.state.searchKeyword;
        const activeTag = this.app.state.activeTag || '';
        const rootItems = resources.filter(r => !r.parentId);
        const rootFolders = rootItems.filter(r => r.type === 'folder');
        const rootFiles = this._sortResources(rootItems.filter(r => r.type !== 'folder' && this._resMatchesFilter(r, keyword, activeTag)));
        let html = '';
        rootFolders.forEach(f => { html += this._renderFolderHtml(f, resources, keyword, activeTag, 0); });
        rootFiles.forEach(f => { html += this.createResItemHtml(f, keyword); });
        container.innerHTML = html || '<div class="empty-tip">没有匹配的资源</div>';
        this._renderTagFilter();
    }

    // Delegated listeners for resource tree — bound ONCE on container, survives innerHTML replacement.
    // Replaces inline onclick handlers that were vulnerable to XSS via unescaped IDs/tags.
    _wireResourceTreeEvents() {
        const resList = this.app.dom.resList;
        const tagArea = document.getElementById('tagFilterArea');

        const pickFolder = (e) => {
            const folder = e.target.closest('[data-folder-id]');
            return (folder && resList.contains(folder)) ? folder : null;
        };

        const dispatch = (ra, el) => {
            const id = el.dataset.id;
            const tag = el.dataset.tag;
            switch (ra) {
                case 'viewResource': this.viewResource(id); break;
                case 'editResource': this.handleEditResource(id); break;
                case 'deleteResource': this.handleDeleteResource(id); break;
                case 'folderAddResource': this.openResModal('New', null, id); break;
                case 'folderCreate': this.handleCreateFolder(id); break;
                case 'folderRename': this.handleRenameFolder(id); break;
                case 'batchSelect': this.toggleBatchSelect(id); break;
                case 'setTag': this.setActiveTag(tag || ''); break;
            }
        };

        resList.addEventListener('click', (e) => {
            const raEl = e.target.closest('[data-ra]');
            if (raEl && resList.contains(raEl)) {
                e.stopPropagation();
                dispatch(raEl.dataset.ra, raEl);
                return;
            }
            const folder = pickFolder(e);
            if (folder) this.toggleFolder(folder.dataset.folderId);
        });

        resList.addEventListener('contextmenu', (e) => {
            const folder = pickFolder(e);
            if (folder) {
                e.preventDefault();
                this.handleRenameFolder(folder.dataset.folderId);
            }
        });

        resList.addEventListener('dragstart', (e) => {
            const item = e.target.closest('[data-res-id]');
            if (item && resList.contains(item)) this.dragStart(e, item.dataset.resId);
        });

        resList.addEventListener('dragover', (e) => {
            e.preventDefault(); e.stopPropagation();
            const folder = pickFolder(e);
            const target = folder || resList;
            if (!target.classList.contains('drag-over')) {
                document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
                target.classList.add('drag-over');
            }
            e.dataTransfer.dropEffect = 'move';
        });

        resList.addEventListener('drop', (e) => {
            e.preventDefault(); e.stopPropagation();
            const folder = pickFolder(e);
            (folder || resList).classList.remove('drag-over');
            const resId = e.dataTransfer.getData('text/plain');
            if (resId) this.app.data.moveResource(resId, folder ? folder.dataset.folderId : null);
            const dragged = document.querySelector('.dragging'); if (dragged) dragged.classList.remove('dragging');
            this.app.state.draggedResId = null;
        });

        resList.addEventListener('dragleave', (e) => {
            const folder = pickFolder(e);
            (folder || resList).classList.remove('drag-over');
        });

        // mouseenter/mouseleave don't bubble; use mouseover/mouseout for delegation
        let hoverItem = null;
        resList.addEventListener('mouseover', (e) => {
            const item = e.target.closest('[data-res-id]');
            if (item && resList.contains(item) && item !== hoverItem) {
                hoverItem = item;
                this.showSidebarPreview(item.dataset.resId, e);
            }
        });
        resList.addEventListener('mouseout', (e) => {
            const item = e.target.closest('[data-res-id]');
            if (item && resList.contains(item) && !item.contains(e.relatedTarget)) {
                hoverItem = null;
                this.hideTooltip();
            }
        });

        if (tagArea) {
            tagArea.addEventListener('click', (e) => {
                const el = e.target.closest('[data-ra="setTag"]');
                if (el) this.setActiveTag(el.dataset.tag || '');
            });
        }
    }

    _resMatchesFilter(r, keyword, activeTag) {
        if (r.type === 'folder') return true;
        const matchKw = !keyword || r.name.toLowerCase().includes(keyword);
        const matchTag = !activeTag || (r.tags && r.tags.includes(activeTag));
        return matchKw && matchTag;
    }

    _folderHasMatch(folder, allResources, keyword, activeTag) {
        if (!keyword && !activeTag) return true;
        if (!keyword || folder.name.toLowerCase().includes(keyword)) {
            if (!activeTag) return true;
        }
        const children = allResources.filter(r => r.parentId === folder.id);
        return children.some(r => {
            if (r.type === 'folder') return this._folderHasMatch(r, allResources, keyword, activeTag);
            return this._resMatchesFilter(r, keyword, activeTag);
        });
    }

    _renderFolderHtml(folder, allResources, keyword, activeTag, depth) {
        if (!this._folderHasMatch(folder, allResources, keyword, activeTag)) return '';
        const children = allResources.filter(r => r.parentId === folder.id);
        const childFolders = children.filter(r => r.type === 'folder');
        const childFiles = this._sortResources(children.filter(r => r.type !== 'folder' && this._resMatchesFilter(r, keyword, activeTag)));
        const isOpen = keyword || activeTag ? true : this.app.state.expandedFolders.has(folder.id);
        const pl = 10 + depth * 16;
        let childHtml = '';
        childFolders.forEach(f => { childHtml += this._renderFolderHtml(f, allResources, keyword, activeTag, depth + 1); });
        childFiles.forEach(f => { childHtml += this.createResItemHtml(f, keyword); });
        const batchMode = this.app.state._batchMode;
        const batchChecked = this.app.state._batchSelected && this.app.state._batchSelected.has(folder.id);
        const esId = this.app.utils.escapeHtml(folder.id);
        const batchCb = batchMode ? `<input type="checkbox" class="batch-checkbox" id="batch-cb-${esId}" ${batchChecked?'checked':''} data-ra="batchSelect" data-id="${esId}">` : '';
        return `
            <div class="res-folder ${isOpen?'open':''} ${batchChecked?'batch-selected':''}" style="padding-left:${pl}px"
                 role="treeitem" aria-expanded="${isOpen}"
                 data-folder-id="${esId}" title="右键点击可快速重命名">
                ${batchCb}
                <div class="folder-icon">▶</div>
                <div class="res-info"><div class="res-name">${this.highlightText(folder.name, keyword)}</div></div>
                <div class="res-actions">
                    <div class="btn-add-resource" data-ra="folderAddResource" data-id="${esId}" title="在此文件夹添加资源">+</div>
                    <div class="btn-res-action" data-ra="folderCreate" data-id="${esId}" title="新建子文件夹"> </div>
                    <div class="btn-res-action" data-ra="folderRename" data-id="${esId}" title="重命名">✎</div>
                    <div class="btn-res-action del" data-ra="deleteResource" data-id="${esId}" title="删除"> </div>
                </div>
            </div>
            <div class="folder-children ${isOpen?'open':''}" role="group">${childHtml}</div>
        `;
    }

    createResItemHtml(r, keyword) {
        let icon = '🔗';
        if(r.type==='image') icon='️'; else if(r.type==='md') icon=''; else if(r.type==='code') icon=''; else if(r.type==='color') icon=''; else if(r.type==='audio') icon='';

        const tagsHtml = r.tags && r.tags.length ? `<div class="res-tags">${r.tags.map(t=>`<span class="res-tag">${this.app.utils.escapeHtml(t)}</span>`).join('')}</div>` : '';

        const batchMode = this.app.state._batchMode;
        const batchChecked = this.app.state._batchSelected && this.app.state._batchSelected.has(r.id);
        const esId = this.app.utils.escapeHtml(r.id);
        const batchCb = batchMode ? `<input type="checkbox" class="batch-checkbox" id="batch-cb-${esId}" ${batchChecked?'checked':''} data-ra="batchSelect" data-id="${esId}">` : '';

        return `
            <div class="res-item ${batchChecked?'batch-selected':''}"
                 role="treeitem" tabindex="0"
                 draggable="true"
                 data-res-id="${esId}">
                ${batchCb}
                <div class="res-icon" data-ra="viewResource" data-id="${esId}">${icon}</div>
                <div class="res-info" data-ra="viewResource" data-id="${esId}">
                    <div class="res-name">${this.highlightText(r.name, keyword)}</div>
                    ${tagsHtml}
                </div>
                <div class="res-actions">
                    <div class="btn-res-action" data-ra="editResource" data-id="${esId}" title="编辑">✎</div>
                    <div class="btn-res-action del" data-ra="deleteResource" data-id="${esId}" title="删除"> </div>
                </div>
            </div>
        `;
    }

    highlightText(text, keyword) {
        const safeText = this.app.utils.escapeHtml(text);
        if (!keyword) return safeText;
        const regexSafe = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const htmlSafe = this.app.utils.escapeHtml(regexSafe);
        const reg = new RegExp(`(${htmlSafe})`, 'gi');
        return safeText.replace(reg, '<span class="highlight">$1</span>');
    }

    _renderTagFilter() {
        const area = document.getElementById('tagFilterArea');
        if (!area) return;
        const allTags = new Set();
        this.app.state.resources.forEach(r => {
            if (r.tags) r.tags.forEach(t => allTags.add(t));
        });
        if (allTags.size === 0) { area.innerHTML = ''; return; }
        const activeTag = this.app.state.activeTag || '';
        let html = '';
        if (activeTag) html += `<div class="tag-chip active" data-ra="setTag" data-tag="">✕ ${this.app.utils.escapeHtml(activeTag)}</div>`;
        allTags.forEach(tag => {
            if (tag !== activeTag) {
                const es = this.app.utils.escapeHtml(tag);
                html += `<div class="tag-chip" data-ra="setTag" data-tag="${es}">${es}</div>`;
            }
        });
        area.innerHTML = html;
    }

    setActiveTag(tag) {
        this.app.state.activeTag = tag;
        this.renderResourceTree();
    }

    setSortMode(mode) {
        this.app.state.resSortMode = mode;
        this.renderResourceTree();
    }

    _sortResources(items) {
        const mode = this.app.state.resSortMode || 'created';
        return items.sort((a, b) => {
            if (mode === 'name') return (a.name || '').localeCompare(b.name || '');
            if (mode === 'type') return (a.type || '').localeCompare(b.type || '');
            if (mode === 'updated') return (b.updated || 0) - (a.updated || 0);
            return (b.created || 0) - (a.created || 0);
        });
    }

    // --- Resource CRUD ---

    handleCreateFolder(parentId = null) {
        if(!this.app.state.currentId) return this.toast('请先创建项目');
        this.promptUser('新建文件夹', '输入文件夹名称').then(name => {
            if(name) this.app.data.createFolder(name, parentId);
        }).catch(err => {
            console.error('创建文件夹失败:', err);
            this.toast('创建文件夹失败', 'error');
        });
    }

    handleRenameFolder(id) {
        const folder = this.app.state.resources.find(r => r.id === id);
        if (!folder) return;
        this.promptUser('重命名', '输入新名称', folder.name).then(newName => {
            if (newName) this.app.data.renameFolder(id, newName);
        }).catch(err => {
            console.error('重命名失败:', err);
            this.toast('重命名失败', 'error');
        });
    }

    async handleDeleteResource(id) {
        const res = this.app.state.resources.find(r => r.id === id);
        if (!res) return;
        let msg = res.type === 'folder' ? '确定删除此文件夹及其所有内容吗？此操作不可恢复。' : '确定删除此资源吗？';
        // Check if any nodes reference this resource
        if (res.type !== 'folder') {
            const linkedNodes = this.app.state.nodes.filter(n => n.resId === id);
            if (linkedNodes.length > 0) {
                msg = `有 ${linkedNodes.length} 个节点引用了此资源。${msg}`;
            }
        }
        const confirmed = await this.confirmDialog(msg);
        if (confirmed) this.app.data.deleteResource(id);
    }

    // --- Batch operations ---

    toggleBatchMode() {
        const batchMode = !this.app.state._batchMode;
        this.app.state._batchMode = batchMode;
        this.app.state._batchSelected = new Set();
        document.getElementById('batchBar').style.display = batchMode ? 'flex' : 'none';
        document.getElementById('sidebarFooter').style.display = batchMode ? 'none' : 'flex';
        if (batchMode) this._populateBatchFolderSelect();
        this.renderResourceTree();
    }

    _buildFolderOptionsHtml(folders, parentId = null, depth = 0) {
        return folders
            .filter(f => f.parentId === parentId)
            .map(f => {
                const indent = '　'.repeat(depth);
                const children = this._buildFolderOptionsHtml(folders, f.id, depth + 1);
                return `<option value="${f.id}">${indent}  ${this.app.utils.escapeHtml(f.name)}</option>${children}`;
            }).join('');
    }

    _populateBatchFolderSelect() {
        const sel = document.getElementById('batchFolderSelect');
        const folders = this.app.state.resources.filter(r => r.type === 'folder');
        let html = '<option value="">移到...</option>';
        html += '<option value="__root__">(根目录)</option>';
        html += this._buildFolderOptionsHtml(folders, null, 0);
        sel.innerHTML = html;
    }

    toggleBatchSelect(id) {
        if (this.app.state._batchSelected.has(id)) {
            this.app.state._batchSelected.delete(id);
        } else {
            this.app.state._batchSelected.add(id);
        }
        document.getElementById('batchCount').textContent = `已选 ${this.app.state._batchSelected.size} 项`;
        const checkbox = document.getElementById(`batch-cb-${id}`);
        if (checkbox) checkbox.checked = this.app.state._batchSelected.has(id);
        const item = checkbox ? checkbox.closest('.res-item, .res-folder') : null;
        if (item) item.classList.toggle('batch-selected', this.app.state._batchSelected.has(id));
    }

    async batchDelete() {
        const ids = [...this.app.state._batchSelected];
        if (ids.length === 0) return this.toast('请先选择资源');
        const confirmed = await this.confirmDialog(`确定删除选中的 ${ids.length} 项资源吗？`);
        if (!confirmed) return;
        this.app.data.batchDeleteResources(ids);
        this.app.state._batchSelected.clear();
        document.getElementById('batchCount').textContent = '已选 0 项';
        this.toast(`已删除 ${ids.length} 项`);
    }

    batchMoveToFolder() {
        const targetId = document.getElementById('batchFolderSelect').value;
        if (!targetId) return this.toast('请选择目标文件夹');
        const ids = [...this.app.state._batchSelected];
        if (ids.length === 0) return this.toast('请先选择资源');
        const parentId = targetId === '__root__' ? null : targetId;
        ids.forEach(id => this.app.data.moveResource(id, parentId));
        this.app.state._batchSelected.clear();
        this.renderResourceTree();
        this.toast(`已移动 ${ids.length} 项`);
    }

    handleEditResource(id) {
        const res = this.app.state.resources.find(r => r.id === id);
        if (!res) return;
        this.app.state.editingResId = id;
        this.openResModal('Edit', res);
    }

    // --- Resource modal ---

    openResModal(mode, res, preselectParentId = null) {
        if(!this.app.state.currentId) return this.toast('请先建项目');
        const title = document.getElementById('resModalTitle');
        const typeSel = document.getElementById('resType');
        const parentSel = document.getElementById('resParentId');
        const nameInput = document.getElementById('resName');

        const folders = this.app.state.resources.filter(r => r.type === 'folder');
        parentSel.innerHTML = '<option value="">(根目录)</option>' + this._buildFolderOptionsHtml(folders, null, 0);

        this.app.state.tempFileBase64 = null;
        document.getElementById('resFile').value = '';
        document.getElementById('resTextInput').value = '';
        document.getElementById('resTextArea').value = '';
        document.getElementById('resColorInput').value = '#000000';
        document.getElementById('resColorValue').innerText = '#000000';

        const tagsInput = document.getElementById('resTags');

        if (mode === 'Edit' && res) {
            title.innerText = '✨ 编辑资源';
            typeSel.value = res.type; typeSel.disabled = true;
            nameInput.value = res.name;
            parentSel.value = res.parentId || '';
            if (tagsInput) tagsInput.value = (res && res.tags) ? res.tags.join(', ') : '';

            if (res.type === 'link') document.getElementById('resTextInput').value = res.content;
            else if (res.type === 'md' || res.type === 'code') document.getElementById('resTextArea').value = res.content;
            else if (res.type === 'color') { document.getElementById('resColorInput').value = res.content; document.getElementById('resColorValue').innerText = res.content; }
        } else {
            title.innerText = '✨ 添加资源';
            typeSel.disabled = false; this.app.state.editingResId = null;
            nameInput.value = ''; typeSel.value = 'image';
            parentSel.value = preselectParentId || '';
            if (tagsInput) tagsInput.value = '';
        }

        this.toggleResInput();
        this.openModal('resModal');
    }

    async handleSaveResourceClick() {
        const type = document.getElementById('resType').value;
        const name = document.getElementById('resName').value;
        const parentId = document.getElementById('resParentId').value || null;

        if (!name) return this.toast('请输入名称');

        const tagsRaw = document.getElementById('resTags') ? document.getElementById('resTags').value : '';
        const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

        let content = null;
        if (type === 'image') {
            if (this.app.state.tempFileBase64) {
                this.toast('正在处理图片...');
                try {
                    content = await this.app.utils.compressImage(this.app.state.tempFileBase64);
                } catch (err) {
                    return this.toast('图片处理失败: ' + err.message, 'error');
                }
                if (content && content.length > config.maxImageSizeMB * 1024 * 1024) {
                    this.toast('图片过大，可能影响性能', 'error');
                }
            } else if (this.app.state.editingResId) {
                const old = this.app.state.resources.find(r => r.id === this.app.state.editingResId);
                content = old ? old.content : null;
            } else {
                return this.toast('请上传文件');
            }
        } else if (type === 'audio') {
            if (this.app.state.tempFileBase64) content = this.app.state.tempFileBase64;
            else if (this.app.state.editingResId) {
                const old = this.app.state.resources.find(r => r.id === this.app.state.editingResId);
                content = old ? old.content : null;
            }
            else return this.toast('请上传文件');
        } else if (type === 'color') {
            content = document.getElementById('resColorInput').value;
        } else if (type === 'md' || type === 'code') {
            content = document.getElementById('resTextArea').value;
            if(!content) return this.toast('请输入内容');
        } else {
            content = document.getElementById('resTextInput').value || '#';
        }

        this.app.data.saveResource({
            id: this.app.state.editingResId,
            type, name, content, parentId, tags: tags.length ? tags : []
        });

        this.closeModal('resModal');
        this.app.state.tempFileBase64 = null;
        this.app.state.editingResId = null;
        document.getElementById('resFile').value = '';
    }

    async confirmDeleteProject() {
        if (!this.app.state.currentId) return;
        const confirmed = await this.confirmDialog('确定删除此项目吗？所有数据将永久丢失。');
        if (confirmed) this.app.storage.deleteProject(this.app.state.currentId);
    }

    // --- Modal helpers ---

    closeModal(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = 'none';
        if (el._focusTrapHandler) {
            el.removeEventListener('keydown', el._focusTrapHandler);
            el._focusTrapHandler = null;
        }
        if (el._restoreFocus) { el._restoreFocus.focus(); el._restoreFocus = null; }
    }

    openModal(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el._restoreFocus = document.activeElement;
        el.style.display = 'flex';
        const focusable = el.querySelector('input, button, [tabindex]:not([tabindex="-1"])');
        if (focusable) setTimeout(() => focusable.focus(), 50);

        // Focus trap
        const trapHandler = (e) => {
            if (e.key !== 'Tab') return;
            const focusables = el.querySelectorAll('input, button, select, textarea, [tabindex]:not([tabindex="-1"])');
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault(); last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault(); first.focus();
            }
        };
        el._focusTrapHandler = trapHandler;
        el.addEventListener('keydown', trapHandler);
    }

    // --- Theme ---

    toggleTheme() {
        const body = document.body;
        if (body.hasAttribute('data-theme')) {
            body.removeAttribute('data-theme');
            localStorage.setItem('theme', 'light');
        } else {
            body.setAttribute('data-theme', 'dark');
            localStorage.setItem('theme', 'dark');
        }
        this.tooltipManager._updateTooltipTheme();
        this.app.graph.nodeRenderer.clearTextureCache();
        this.app.graph.needsRender = true;
    }

    // --- Sidebar & misc ---

    triggerImport() {
        document.getElementById('importInput').click();
    }

    filterResources(keyword) {
        this.app.state.searchKeyword = keyword.toLowerCase();
        this.renderResourceTree();
    }

    toggleFolder(id) {
        if (this.app.state.expandedFolders.has(id)) this.app.state.expandedFolders.delete(id);
        else this.app.state.expandedFolders.add(id);
        this.renderResourceTree();
    }

    viewResource(id) {
        const res = this.app.state.resources.find(r => r.id === id); if(!res) return;
        const n = this.app.state.nodes.find(n => n.resId === id);
        if(n) {
            this.app.state.camera.x = this.app.graph.width/2 - n.x * this.app.state.camera.k;
            this.app.state.camera.y = this.app.graph.height/2 - n.y * this.app.state.camera.k;
            this.app.graph.needsRender = true;
            this.toast('已定位');
        } else {
            this.openViewer(id);
        }
    }

    openViewer(resId) {
        const res = this.app.state.resources.find(r => r.id === resId);
        if (!res) return;
        document.getElementById('viewerTitle').textContent = res.name;
        const contentEl = document.getElementById('viewerContent');
        contentEl.querySelectorAll('audio').forEach(a => a.pause());
        if (res.type === 'image') {
            if (!this.app.utils.isSafeUrl(res.content)) contentEl.textContent = '不安全的图片来源';
            else contentEl.innerHTML = `<img src="${this.app.utils.escapeHtml(res.content)}" alt="${this.app.utils.escapeHtml(res.name)}">`;
        } else if (res.type === 'md') {
            let html = '';
            if (typeof marked !== 'undefined') {
                try { html = marked.parse(res.content || ''); } catch (e) { console.error(e); }
            } else {
                html = '<pre>' + this.app.utils.escapeHtml(res.content || '') + '</pre>';
            }
            html = this.app.utils.purifyHTML(html);
            contentEl.innerHTML = `<div class="md-preview">${html}</div>`;
        } else if (res.type === 'code') {
            contentEl.innerHTML = `<pre>${this.app.utils.escapeHtml(res.content || '')}</pre>`;
        } else if (res.type === 'color') {
            contentEl.innerHTML = `<div style="width:160px;height:100px;background:${this.app.utils.escapeHtml(res.content)};border-radius:12px;margin:auto;box-shadow:var(--shadow-md)"></div><p style="text-align:center;margin-top:16px;font-family:monospace;font-size:24px;font-weight:bold;">${this.app.utils.escapeHtml(res.content)}</p>`;
        } else if (res.type === 'audio') {
            if (!this.app.utils.isSafeUrl(res.content)) contentEl.textContent = '不安全的音频来源';
            else contentEl.innerHTML = `<audio controls src="${this.app.utils.escapeHtml(res.content)}" style="margin:auto;"></audio>`;
        } else if (res.type === 'link') {
            const safeUrl = this.app.utils.isSafeUrl(res.content) ? res.content : '#';
            contentEl.innerHTML = `<p style="word-break:break-all;margin-bottom:16px;color:var(--text-sub);">${this.app.utils.escapeHtml(res.content)}</p><a href="${this.app.utils.escapeHtml(safeUrl)}" target="_blank" style="display:inline-block;background:var(--primary);color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">跳转到链接 </a>`;
        }
        if (res.note) {
            contentEl.innerHTML += `<div style="margin-top:20px;padding:12px 16px;background:var(--bg-app);border-radius:8px;border-left:3px solid #f59e0b;"><span style="font-size:12px;color:var(--text-sub);display:block;margin-bottom:4px;">备注</span>${this.app.utils.escapeHtml(res.note)}</div>`;
        }
        this.openModal('viewerModal');
    }

    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        sidebar.classList.toggle('closed');
        const btn = document.querySelector('[data-action="toggleSidebar"]');
        if (btn) btn.setAttribute('aria-expanded', !sidebar.classList.contains('closed'));
    }

    toggleResInput() {
        const type = document.getElementById('resType').value;
        const gFile = document.getElementById('groupFile');
        const gText = document.getElementById('groupText');
        const gColor = document.getElementById('groupColor');

        gFile.style.display = 'none'; gText.style.display = 'none'; gColor.style.display = 'none';

        const textInput = document.getElementById('resTextInput');
        const textArea = document.getElementById('resTextArea');
        const fileInput = document.getElementById('resFile');

        if (type === 'image' || type === 'audio') {
            gFile.style.display = 'block';
            document.getElementById('fileLabel').innerText = type === 'image' ? '上传图片' : '上传音频';
            fileInput.accept = type === 'image' ? 'image/*' : 'audio/*';
        } else if (type === 'color') {
            gColor.style.display = 'block';
        } else {
            gText.style.display = 'block';
            document.getElementById('textLabel').innerText = type === 'link' ? '链接地址' : (type === 'code' ? '代码内容' : '文档内容');
            if (type === 'link') { textInput.style.display = 'block'; textArea.style.display = 'none'; }
            else { textInput.style.display = 'none'; textArea.style.display = 'block'; textArea.placeholder = type === 'code' ? '粘贴代码...' : '输入 Markdown...'; }
        }
    }

    // --- Cross-links & minimap ---

    toggleCrossLinks() {
        this.app.state.showCrossLinks = !this.app.state.showCrossLinks;
        this.app.graph.needsRender = true;
        this.toast(this.app.state.showCrossLinks ? '已显示飞线' : '已隐藏飞线');

        const btn = document.getElementById('btnToggleLinks');
        if (btn) {
            if (!this.app.state.showCrossLinks) btn.classList.add('disabled');
            else btn.classList.remove('disabled');
        }
    }

    toggleMinimap() {
        this.app.graph.showMinimap = !this.app.graph.showMinimap;
        this.app.graph.needsRender = true;
        const btn = document.getElementById('btnToggleMinimap');
        if (btn) btn.classList.toggle('disabled', !this.app.graph.showMinimap);
    }

    // --- Drag & drop ---

    dragStart(e, id) {
        e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move';
        this.app.state.draggedResId = id; e.target.classList.add('dragging');
        e.target.addEventListener('dragend', () => {
            e.target.classList.remove('dragging');
            this.app.state.draggedResId = null;
        }, { once: true });
    }

    dragOver(e, parentId) {
        e.preventDefault(); e.stopPropagation();
        const target = e.currentTarget;
        if (!target.classList.contains('drag-over')) {
            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            target.classList.add('drag-over');
        }
        e.dataTransfer.dropEffect = 'move';
    }

    dragLeave(e) { e.currentTarget.classList.remove('drag-over'); }

    drop(e, parentId) {
        e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('drag-over');
        const resId = e.dataTransfer.getData('text/plain');
        if (resId) this.app.data.moveResource(resId, parentId);
        const dragged = document.querySelector('.dragging'); if(dragged) dragged.classList.remove('dragging');
        this.app.state.draggedResId = null;
    }

    // --- Toast ---

    toast(m, type) {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        // Max visible toasts — FIFO eviction
        const visible = container.querySelectorAll('.toast.show');
        if (visible.length >= config.maxVisibleToasts) {
            const oldest = visible[0];
            oldest.classList.remove('show');
            setTimeout(() => oldest.remove(), config.toastAnimationMs);
        }
        const el = document.createElement('div');
        el.className = 'toast' + (type ? ' ' + type : '');
        el.setAttribute('role', 'alert');
        el.textContent = m;
        el.addEventListener('click', () => {
            el.classList.remove('show');
            setTimeout(() => el.remove(), config.toastAnimationMs);
        });
        container.appendChild(el);
        el.offsetHeight;
        el.classList.add('show');
        setTimeout(() => {
            el.classList.remove('show');
            setTimeout(() => el.remove(), config.toastAnimationMs);
        }, config.toastDuration);
    }

    // --- Export ---

    exportImage() {
        this.app.graph.exportManager.exportImage();
    }

    toggleExportMenu() {
        const menu = document.getElementById('exportMenu');
        menu.classList.toggle('show');
        const btn = document.querySelector('[data-action="toggleExportMenu"]');
        if (btn) btn.setAttribute('aria-expanded', menu.classList.contains('show'));
        if (menu.classList.contains('show')) {
            // Focus first menu item
            const firstBtn = menu.querySelector('button');
            if (firstBtn) firstBtn.focus();
            const close = (e) => {
                if (!e.target.closest('.export-dropdown')) {
                    menu.classList.remove('show');
                    if (btn) btn.setAttribute('aria-expanded', 'false');
                    document.removeEventListener('click', close);
                    document.removeEventListener('keydown', escClose);
                }
            };
            const escClose = (e) => {
                if (e.key === 'Escape') {
                    menu.classList.remove('show');
                    if (btn) btn.setAttribute('aria-expanded', 'false');
                    document.removeEventListener('click', close);
                    document.removeEventListener('keydown', escClose);
                    if (btn) btn.focus();
                }
            };
            setTimeout(() => {
                document.addEventListener('click', close);
                document.addEventListener('keydown', escClose);
            }, 0);
        }
    }

    closeExportMenu() {
        document.getElementById('exportMenu').classList.remove('show');
    }

    // --- Project ---

    async duplicateCurrentProject() {
        if (!this.app.state.currentId) return this.toast('请先选择一个项目');
        await this.app.storage.duplicateProject(this.app.state.currentId);
    }
}
