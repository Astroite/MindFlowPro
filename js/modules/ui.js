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

        this.app.eventBus.on('resources:updated', () => this.renderResourceTree());
        this.app.eventBus.on('nodes:deleted', () => {
            this.app.state.selectedNodes.clear();
            this.app.state.bubbleNode = null;
            this.app.state.editingNode = null;
            this.nodeEditor.hideNodeBubble();
        });
        this.app.eventBus.on('toast', (data) => this.toast(data.msg, data.type));
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
            if (e.target.value === '__new__') {
                const name = await this.promptUser('新建项目', '请输入项目名称');
                if (name) {
                    const id = await this.app.storage.createProject(name);
                    await this.app.storage.loadProject(id);
                } else {
                    this.updateProjectSelect();
                }
            } else {
                await this.app.storage.loadProject(e.target.value);
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

        const resList = this.app.dom.resList;
        resList.ondragover = (e) => this.dragOver(e, null);
        resList.ondrop = (e) => this.drop(e, null);
        resList.ondragleave = (e) => this.dragLeave(e);

        // 绑定全局快捷键：Alt + L 切换飞线显示
        window.addEventListener('keydown', (e) => {
            if (e.altKey && e.code === 'KeyL') {
                this.toggleCrossLinks();
            }
        });

        // [Feature 1] Undo/Redo keyboard shortcuts
        window.addEventListener('keydown', (e) => {
            if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
            if ((e.ctrlKey||e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
                e.preventDefault(); this.app.data.undo();
            }
            if ((e.ctrlKey||e.metaKey) && ((e.shiftKey && e.key.toLowerCase()==='z') || e.key.toLowerCase()==='y')) {
                e.preventDefault(); this.app.data.redo();
            }
            // [P0-2] Ctrl+N — new root node
            if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase() === 'n') {
                e.preventDefault(); this.app.graph.addRootNode();
            }
            // [P0-2] Ctrl+F — focus sidebar search
            if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                const searchInput = document.querySelector('.search-input');
                if (searchInput) { searchInput.focus(); searchInput.select(); }
            }
            // [P0-2] Ctrl+S — force save
            if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault(); this.app.storage.forceSave(); this.toast('已保存');
            }
            // [P0-2] Ctrl+E — export image
            if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase() === 'e') {
                e.preventDefault(); this.exportImage();
            }
            // [P0-2] Tab — add child node for selected node
            if (e.key === 'Tab') {
                e.preventDefault();
                if (this.app.state.selectedNodes.size === 1) {
                    const nodeId = [...this.app.state.selectedNodes][0];
                    const node = this.app.state.nodes.find(n => n.id === nodeId);
                    if (node) this.app.graph.addChildNode(node);
                }
            }
            // [P1-3] F2 — inline edit node label
            if (e.key === 'F2') {
                e.preventDefault();
                if (this.app.state.selectedNodes.size === 1) {
                    const nodeId = [...this.app.state.selectedNodes][0];
                    const node = this.app.state.nodes.find(n => n.id === nodeId);
                    if (node) this.app.graph.inlineEdit(node);
                }
            }
            // [P0-5] Ctrl+C — copy selected nodes
            if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase() === 'c') {
                if (this.app.state.selectedNodes.size > 0) {
                    e.preventDefault(); this.app.data.copySelectedNodes();
                }
            }
            // [P0-5] Ctrl+V — paste nodes
            if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase() === 'v') {
                e.preventDefault(); this.app.data.pasteNodes(30, 30);
            }
            // [P0-5] Ctrl+D — duplicate selected nodes
            if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase() === 'd') {
                if (this.app.state.selectedNodes.size > 0) {
                    e.preventDefault(); this.app.data.duplicateSelectedNodes();
                }
            }
            // [P2-3] ? — show shortcuts help
            if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                this.openModal('shortcutsModal');
            }
            // [P2-2] Ctrl+G — jump to next node search match
            if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase() === 'g') {
                e.preventDefault();
                const bar = document.getElementById('nodeSearchBar');
                if (bar.style.display !== 'none') {
                    this.nodeSearchNext();
                } else {
                    this.toggleNodeSearch();
                }
            }
            // [P2-2] Escape — close open modal or node search bar
            if (e.key === 'Escape') {
                const modals = ['inputModal', 'resModal', 'shortcutsModal', 'viewerModal'];
                let closed = false;
                for (const id of modals) {
                    const el = document.getElementById(id);
                    if (el && el.style.display !== 'none') { this.closeModal(id); closed = true; break; }
                }
                if (!closed) {
                    const bar = document.getElementById('nodeSearchBar');
                    if (bar.style.display !== 'none') {
                        this.toggleNodeSearch();
                    }
                }
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
            h += `<option value="${p.id}" ${isSelected}>  ${p.name}</option>`;
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
        const batchCb = batchMode ? `<input type="checkbox" class="batch-checkbox" id="batch-cb-${folder.id}" ${batchChecked?'checked':''} onclick="event.stopPropagation();app.ui.toggleBatchSelect('${folder.id}')">` : '';
        return `
            <div class="res-folder ${isOpen?'open':''} ${batchChecked?'batch-selected':''}" style="padding-left:${pl}px"
                 aria-expanded="${isOpen}"
                 onclick="app.ui.toggleFolder('${folder.id}')"
                 oncontextmenu="event.preventDefault();app.ui.handleRenameFolder('${folder.id}')"
                 ondragover="app.ui.dragOver(event,'${folder.id}')"
                 ondrop="app.ui.drop(event,'${folder.id}')"
                 ondragleave="app.ui.dragLeave(event)" title="右键点击可快速重命名">
                ${batchCb}
                <div class="folder-icon">▶</div>
                <div class="res-info"><div class="res-name">${this.highlightText(folder.name, keyword)}</div></div>
                <div class="res-actions">
                    <div class="btn-add-resource" onclick="event.stopPropagation();app.ui.openResModal('New',null,'${folder.id}')" title="在此文件夹添加资源">+</div>
                    <div class="btn-res-action" onclick="event.stopPropagation();app.ui.handleCreateFolder('${folder.id}')" title="新建子文件夹"> </div>
                    <div class="btn-res-action" onclick="event.stopPropagation();app.ui.handleRenameFolder('${folder.id}')" title="重命名">✎</div>
                    <div class="btn-res-action del" onclick="event.stopPropagation();app.ui.handleDeleteResource('${folder.id}')" title="删除"> </div>
                </div>
            </div>
            <div class="folder-children ${isOpen?'open':''}">${childHtml}</div>
        `;
    }

    createResItemHtml(r, keyword) {
        let icon = '🔗';
        if(r.type==='image') icon='️'; else if(r.type==='md') icon=''; else if(r.type==='code') icon=''; else if(r.type==='color') icon=''; else if(r.type==='audio') icon='';

        const tagsHtml = r.tags && r.tags.length ? `<div class="res-tags">${r.tags.map(t=>`<span class="res-tag">${this.app.utils.escapeHtml(t)}</span>`).join('')}</div>` : '';

        const batchMode = this.app.state._batchMode;
        const batchChecked = this.app.state._batchSelected && this.app.state._batchSelected.has(r.id);
        const batchCb = batchMode ? `<input type="checkbox" class="batch-checkbox" id="batch-cb-${r.id}" ${batchChecked?'checked':''} onclick="event.stopPropagation();app.ui.toggleBatchSelect('${r.id}')">` : '';

        return `
            <div class="res-item ${batchChecked?'batch-selected':''}"
                 draggable="true"
                 ondragstart="app.ui.dragStart(event, '${r.id}')"
                 onmouseenter="app.ui.showSidebarPreview('${r.id}', event)"
                 onmouseleave="app.ui.hideTooltip()">
                ${batchCb}
                <div class="res-icon" onclick="app.ui.viewResource('${r.id}')">${icon}</div>
                <div class="res-info" onclick="app.ui.viewResource('${r.id}')">
                    <div class="res-name">${this.highlightText(r.name, keyword)}</div>
                    ${tagsHtml}
                </div>
                <div class="res-actions">
                    <div class="btn-res-action" onclick="app.ui.handleEditResource('${r.id}')" title="编辑">✎</div>
                    <div class="btn-res-action del" onclick="app.ui.handleDeleteResource('${r.id}')" title="删除"> </div>
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
        if (activeTag) html += `<div class="tag-chip active" onclick="app.ui.setActiveTag('')">✕ ${this.app.utils.escapeHtml(activeTag)}</div>`;
        allTags.forEach(tag => {
            if (tag !== activeTag) html += `<div class="tag-chip" onclick="app.ui.setActiveTag('${this.app.utils.escapeHtml(tag)}')">${this.app.utils.escapeHtml(tag)}</div>`;
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
        });
    }

    handleRenameFolder(id) {
        const folder = this.app.state.resources.find(r => r.id === id);
        if (!folder) return;
        this.promptUser('重命名', '输入新名称', folder.name).then(newName => {
            if (newName) this.app.data.renameFolder(id, newName);
        });
    }

    async handleDeleteResource(id) {
        const res = this.app.state.resources.find(r => r.id === id);
        if (!res) return;
        const msg = res.type === 'folder' ? '确定删除此文件夹及其所有内容吗？此操作不可恢复。' : '确定删除此资源吗？';
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

    _populateBatchFolderSelect() {
        const sel = document.getElementById('batchFolderSelect');
        const folders = this.app.state.resources.filter(r => r.type === 'folder');
        let html = '<option value="">移到...</option>';
        html += '<option value="__root__">(根目录)</option>';
        const buildOpts = (parentId, depth) => {
            return folders.filter(f => f.parentId === parentId).map(f => {
                const indent = '\u3000'.repeat(depth);
                const childHtml = buildOpts(f.id, depth + 1);
                return `<option value="${f.id}">${indent}  ${this.app.utils.escapeHtml(f.name)}</option>${childHtml}`;
            }).join('');
        };
        html += buildOpts(null, 0);
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
        const buildFolderOptions = (allFolders, parentId, depth) => {
            return allFolders
                .filter(f => f.parentId === parentId)
                .map(f => {
                    const children = buildFolderOptions(allFolders, f.id, depth + 1);
                    const indent = '\u3000'.repeat(depth);
                    return `<option value="${f.id}">${indent}  ${this.app.utils.escapeHtml(f.name)}</option>${children}`;
                }).join('');
        };
        parentSel.innerHTML = '<option value="">(根目录)</option>' + buildFolderOptions(folders, null, 0);

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
                content = await this.app.utils.compressImage(this.app.state.tempFileBase64);
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
            else contentEl.innerHTML = `<img src="${res.content}" alt="${this.app.utils.escapeHtml(res.name)}">`;
        } else if (res.type === 'md') {
            let html = '';
            try { html = marked.parse(res.content || ''); } catch (e) { console.error(e); }
            html = this.app.utils.purifyHTML(html);
            contentEl.innerHTML = `<div class="md-preview">${html}</div>`;
        } else if (res.type === 'code') {
            contentEl.innerHTML = `<pre>${this.app.utils.escapeHtml(res.content || '')}</pre>`;
        } else if (res.type === 'color') {
            contentEl.innerHTML = `<div style="width:160px;height:100px;background:${this.app.utils.escapeHtml(res.content)};border-radius:12px;margin:auto;box-shadow:var(--shadow-md)"></div><p style="text-align:center;margin-top:16px;font-family:monospace;font-size:24px;font-weight:bold;">${this.app.utils.escapeHtml(res.content)}</p>`;
        } else if (res.type === 'audio') {
            if (!this.app.utils.isSafeUrl(res.content)) contentEl.textContent = '不安全的音频来源';
            else contentEl.innerHTML = `<audio controls src="${res.content}" style="margin:auto;"></audio>`;
        } else if (res.type === 'link') {
            const safeUrl = this.app.utils.isSafeUrl(res.content) ? res.content : '#';
            contentEl.innerHTML = `<p style="word-break:break-all;margin-bottom:16px;color:var(--text-sub);">${this.app.utils.escapeHtml(res.content)}</p><a href="${safeUrl}" target="_blank" style="display:inline-block;background:var(--primary);color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">跳转到链接 </a>`;
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
        const el = document.createElement('div');
        el.className = 'toast' + (type ? ' ' + type : '');
        el.textContent = m;
        el.addEventListener('click', () => {
            el.classList.remove('show');
            setTimeout(() => el.remove(), 300);
        });
        container.appendChild(el);
        el.offsetHeight;
        el.classList.add('show');
        setTimeout(() => {
            el.classList.remove('show');
            setTimeout(() => el.remove(), 300);
        }, 3000);
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
            const close = (e) => {
                if (!e.target.closest('.export-dropdown')) {
                    menu.classList.remove('show');
                    if (btn) btn.setAttribute('aria-expanded', 'false');
                    document.removeEventListener('click', close);
                }
            };
            setTimeout(() => document.addEventListener('click', close), 0);
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
