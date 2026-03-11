import { config } from '../config.js';

export class UIModule {
    /**
     * @param {import('../types.js').App} app
     */
    constructor(app) {
        this.app = app;
        this.tooltipEl = null;
        this._promptResolve = null;
        this._promptMode = 'input'; // 'input' | 'confirm'
    }

    init() {
        this.initTooltip();
        this.bindGlobalEvents();
        this.setupInputModal();

        this.app.eventBus.on('resources:updated', () => this.renderResourceTree());
        this.app.eventBus.on('nodes:deleted', () => {
            this.app.state.selectedNodes.clear();
            this.app.state.bubbleNode = null;
            this.app.state.editingNode = null;
            this.hideNodeBubble();
        });
        this.app.eventBus.on('toast', (data) => this.toast(data.msg));
    }

    initTooltip() {
        this.tooltipEl = document.createElement('div');
        this.tooltipEl.id = 'mindflow-tooltip';
        Object.assign(this.tooltipEl.style, {
            position: 'fixed', display: 'none', zIndex: '1000',
            background: 'white', border: '1px solid #ccc', borderRadius: '6px',
            padding: '10px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)',
            maxWidth: '300px', maxHeight: '300px', overflow: 'hidden', pointerEvents: 'auto'
        });
        document.body.appendChild(this.tooltipEl);
        this.tooltipEl.addEventListener('mouseenter', () => clearTimeout(this.app.state.tooltipTimer));
        this.tooltipEl.addEventListener('mouseleave', () => this.hideTooltip());
    }

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
            document.getElementById('inputModal').style.display = 'flex';
            setTimeout(() => input.focus(), 100);
        });
    }

    confirmDialog(msg) {
        return new Promise((resolve) => {
            this._promptResolve = resolve;
            this._promptMode = 'confirm';
            document.getElementById('inputModalTitle').innerText = msg;
            const input = document.getElementById('inputModalValue');
            input.style.display = 'none';
            document.getElementById('inputModal').style.display = 'flex';
        });
    }

    bindGlobalEvents() {
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
            h += `<option value="${p.id}" ${isSelected}>📁 ${p.name}</option>`;
        });
        sel.innerHTML = h;
    }

    // [Feature 6] Sub-folder support — full renderResourceTree rewrite
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
        const rootFiles = rootItems.filter(r => r.type !== 'folder' && this._resMatchesFilter(r, keyword, activeTag));
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
        const childFiles = children.filter(r => r.type !== 'folder' && this._resMatchesFilter(r, keyword, activeTag));
        const isOpen = keyword || activeTag ? true : this.app.state.expandedFolders.has(folder.id);
        const pl = 10 + depth * 16;
        let childHtml = '';
        childFolders.forEach(f => { childHtml += this._renderFolderHtml(f, allResources, keyword, activeTag, depth + 1); });
        childFiles.forEach(f => { childHtml += this.createResItemHtml(f, keyword); });
        return `
            <div class="res-folder ${isOpen?'open':''}" style="padding-left:${pl}px"
                 onclick="app.ui.toggleFolder('${folder.id}')"
                 oncontextmenu="event.preventDefault();app.ui.handleRenameFolder('${folder.id}')"
                 ondragover="app.ui.dragOver(event,'${folder.id}')"
                 ondrop="app.ui.drop(event,'${folder.id}')"
                 ondragleave="app.ui.dragLeave(event)" title="右键点击可快速重命名">
                <div class="folder-icon">▶</div>
                <div class="res-info"><div class="res-name">${this.highlightText(folder.name, keyword)}</div></div>
                <div class="res-actions">
                    <div class="btn-add-resource" onclick="event.stopPropagation();app.ui.openResModal('New',null,'${folder.id}')" title="在此文件夹添加资源">+</div>
                    <div class="btn-res-action" onclick="event.stopPropagation();app.ui.handleCreateFolder('${folder.id}')" title="新建子文件夹">📁</div>
                    <div class="btn-res-action" onclick="event.stopPropagation();app.ui.handleRenameFolder('${folder.id}')" title="重命名">✎</div>
                    <div class="btn-res-action del" onclick="event.stopPropagation();app.ui.handleDeleteResource('${folder.id}')" title="删除">🗑</div>
                </div>
            </div>
            <div class="folder-children ${isOpen?'open':''}">${childHtml}</div>
        `;
    }

    createResItemHtml(r, keyword) {
        let icon = '🔗';
        if(r.type==='image') icon='🖼️'; else if(r.type==='md') icon='📝'; else if(r.type==='code') icon='💻'; else if(r.type==='color') icon='🎨'; else if(r.type==='audio') icon='🎤';

        // [Feature 8] Tags
        const tagsHtml = r.tags && r.tags.length ? `<div class="res-tags">${r.tags.map(t=>`<span class="res-tag">${this.app.utils.escapeHtml(t)}</span>`).join('')}</div>` : '';

        return `
            <div class="res-item"
                 draggable="true"
                 ondragstart="app.ui.dragStart(event, '${r.id}')"
                 onmouseenter="app.ui.showSidebarPreview('${r.id}', event)"
                 onmouseleave="app.ui.hideTooltip()">
                <div class="res-icon" onclick="app.ui.viewResource('${r.id}')">${icon}</div>
                <div class="res-info" onclick="app.ui.viewResource('${r.id}')">
                    <div class="res-name">${this.highlightText(r.name, keyword)}</div>
                    ${tagsHtml}
                </div>
                <div class="res-actions">
                    <div class="btn-res-action" onclick="app.ui.handleEditResource('${r.id}')" title="编辑">✎</div>
                    <div class="btn-res-action del" onclick="app.ui.handleDeleteResource('${r.id}')" title="删除">🗑</div>
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

    // [Feature 8] Tag filter rendering
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

    // [Feature 6] handleCreateFolder accepts optional parentId
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

    // [Feature 11] Replace confirm() with confirmDialog
    async handleDeleteResource(id) {
        const res = this.app.state.resources.find(r => r.id === id);
        if (!res) return;
        const msg = res.type === 'folder' ? '确定删除此文件夹及其所有内容吗？此操作不可恢复。' : '确定删除此资源吗？';
        const confirmed = await this.confirmDialog(msg);
        if (confirmed) this.app.data.deleteResource(id);
    }

    handleEditResource(id) {
        const res = this.app.state.resources.find(r => r.id === id);
        if (!res) return;
        this.app.state.editingResId = id;
        this.openResModal('Edit', res);
    }

    // [Feature 6] openResModal updated with hierarchical folder options
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
                    return `<option value="${f.id}">${indent}📁 ${this.app.utils.escapeHtml(f.name)}</option>${children}`;
                }).join('');
        };
        parentSel.innerHTML = '<option value="">(根目录)</option>' + buildFolderOptions(folders, null, 0);

        this.app.state.tempFileBase64 = null;
        document.getElementById('resFile').value = '';
        document.getElementById('resTextInput').value = '';
        document.getElementById('resTextArea').value = '';
        document.getElementById('resColorInput').value = '#000000';
        document.getElementById('resColorValue').innerText = '#000000';

        // [Feature 8] Tags field
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
        document.getElementById('resModal').style.display='flex';
    }

    async handleSaveResourceClick() {
        const type = document.getElementById('resType').value;
        const name = document.getElementById('resName').value;
        const parentId = document.getElementById('resParentId').value || null;

        if (!name) return this.toast('请输入名称');

        // [Feature 8] Read tags
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

    handleSaveNodeEdit() {
        const node = this.app.state.editingNode;
        if (node) {
            const label = document.getElementById('nodeLabel').value;
            const resId = document.getElementById('nodeResSelect').value || null;
            // [Feature 4] Color
            const useColor = document.getElementById('nodeUseColor').checked;
            const color = useColor ? document.getElementById('nodeColor').value : null;
            // [Feature 7] Note
            const note = document.getElementById('nodeNote') ? document.getElementById('nodeNote').value.trim() || null : null;
            this.app.data.updateNode(node.id, { label, resId, color, note });
            document.getElementById('nodeMenu').style.display = 'none';
        }
    }

    // [Feature 11] Replace confirm() with confirmDialog
    async confirmDeleteProject() {
        if (!this.app.state.currentId) return;
        const confirmed = await this.confirmDialog('确定删除此项目吗？所有数据将永久丢失。');
        if (confirmed) this.app.storage.deleteProject(this.app.state.currentId);
    }

    closeModal(id) { document.getElementById(id).style.display='none'; }

    toggleTheme() {
        const body = document.body;
        if (body.hasAttribute('data-theme')) {
            body.removeAttribute('data-theme');
            localStorage.setItem('theme', 'light');
        } else {
            body.setAttribute('data-theme', 'dark');
            localStorage.setItem('theme', 'dark');
        }
    }

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

    // [Feature 3] viewResource — open viewer when no linked node
    viewResource(id) {
        const res = this.app.state.resources.find(r => r.id === id); if(!res) return;
        const n = this.app.state.nodes.find(n => n.resId === id);
        if(n) {
            this.app.state.camera.x = this.app.graph.width/2 - n.x * this.app.state.camera.k;
            this.app.state.camera.y = this.app.graph.height/2 - n.y * this.app.state.camera.k;
            this.app.graph.needsRender = true;
            this.toast('已定位');
        } else {
            // [Feature 12] Audio goes through openViewer
            if (res.type === 'audio') { this.openViewer(id); }
            else { this.openViewer(id); }
        }
    }

    // [Feature 3] Full-screen resource viewer
    openViewer(resId) {
        const res = this.app.state.resources.find(r => r.id === resId);
        if (!res) return;
        document.getElementById('viewerTitle').textContent = res.name;
        const contentEl = document.getElementById('viewerContent');
        // Stop any playing audio first
        contentEl.querySelectorAll('audio').forEach(a => a.pause());
        if (res.type === 'image') {
            contentEl.innerHTML = `<img src="${res.content}" alt="${this.app.utils.escapeHtml(res.name)}">`;
        } else if (res.type === 'md') {
            let html = marked.parse(res.content || '');
            html = this.app.utils.purifyHTML(html);
            contentEl.innerHTML = `<div class="md-preview">${html}</div>`;
        } else if (res.type === 'code') {
            contentEl.innerHTML = `<pre>${this.app.utils.escapeHtml(res.content || '')}</pre>`;
        } else if (res.type === 'color') {
            contentEl.innerHTML = `<div style="width:160px;height:100px;background:${this.app.utils.escapeHtml(res.content)};border-radius:12px;margin:auto;box-shadow:var(--shadow-md)"></div><p style="text-align:center;margin-top:16px;font-family:monospace;font-size:24px;font-weight:bold;">${this.app.utils.escapeHtml(res.content)}</p>`;
        } else if (res.type === 'audio') {
            contentEl.innerHTML = `<audio controls src="${res.content}" style="margin:auto;"></audio>`;
        } else if (res.type === 'link') {
            contentEl.innerHTML = `<p style="word-break:break-all;margin-bottom:16px;color:var(--text-sub);">${this.app.utils.escapeHtml(res.content)}</p><a href="${res.content}" target="_blank" style="display:inline-block;background:var(--primary);color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">跳转到链接 🔗</a>`;
        }
        if (res.note) {
            contentEl.innerHTML += `<div style="margin-top:20px;padding:12px 16px;background:var(--bg-app);border-radius:8px;border-left:3px solid #f59e0b;"><span style="font-size:12px;color:var(--text-sub);display:block;margin-bottom:4px;">备注</span>${this.app.utils.escapeHtml(res.note)}</div>`;
        }
        document.getElementById('viewerModal').style.display = 'flex';
    }

    // [Feature 4] openNodeMenu — populate color fields
    openNodeMenu(node, x, y) {
        const m = this.app.dom.nodeMenu;
        this.app.state.editingNode = node;

        document.getElementById('nodeLabel').value = node.label;
        const sel = document.getElementById('nodeResSelect');
        sel.innerHTML = '<option value="">(无)</option>' + this.app.state.resources.filter(r=>r.type!=='folder').map(r =>
            `<option value="${r.id}" ${r.id===node.resId?'selected':''}>${r.name}</option>`
        ).join('');

        // [Feature 4] Color
        const colorInput = document.getElementById('nodeColor');
        const useColorCb = document.getElementById('nodeUseColor');
        if (colorInput) colorInput.value = node.color || '#6366f1';
        if (useColorCb) useColorCb.checked = !!node.color;

        // [Feature 7] Note
        const noteEl = document.getElementById('nodeNote');
        if (noteEl) noteEl.value = node.note || '';

        if (x !== undefined && y !== undefined) {
            let left = x; let top = y;
            if (left + 320 > window.innerWidth) left = window.innerWidth - 340;
            if (top + 400 > window.innerHeight) top = window.innerHeight - 420;
            if (left < 20) left = 20; if (top < 20) top = 20;

            m.style.left = left + 'px';
            m.style.top = top + 'px';
        }
        m.style.display = 'flex';
    }

    toggleSidebar() {
        document.getElementById('sidebar').classList.toggle('closed');
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

    // [Feature 11] Replace confirm() with confirmDialog
    async onBubbleDelete() {
        const idsToDelete = new Set();
        if (this.app.state.bubbleNode) idsToDelete.add(this.app.state.bubbleNode.id);
        this.app.state.selectedNodes.forEach(id => idsToDelete.add(id));
        if (idsToDelete.size === 0) return;
        const msg = idsToDelete.size > 1 ? `确定要删除选中的 ${idsToDelete.size} 个节点吗？` : '确定要删除这个节点及其连线吗？';
        const confirmed = await this.confirmDialog(msg);
        if (confirmed) this.app.data.deleteNodes(Array.from(idsToDelete));
    }

    // --- 飞线创建按钮点击事件 ---
    onBubbleLink() {
        const node = this.app.state.bubbleNode;
        if (!node) return;

        this.hideNodeBubble();
        this.app.state.isLinking = true;
        this.app.state.linkingSourceNode = node;
        this.toast('请点击另一个节点以建立连接 (ESC取消)');
    }

    // --- 飞线显示切换 ---
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

    showSidebarPreview(resId, event) {
        this.displayTooltip(resId, event.clientX + 10, event.clientY);
    }

    displayTooltip(resId, x, y) {
        clearTimeout(this.app.state.tooltipTimer);
        const res = this.app.state.resources.find(r => r.id === resId);
        if (!res) return;

        let content = '';
        if (res.type === 'image') content = `<img src="${res.content}" style="max-width:100%; max-height:200px; display:block; border-radius:4px;">`;
        else if (res.type === 'md') {
            let html = marked.parse(res.content);
            html = this.app.utils.purifyHTML(html);
            content = `<div class="md-preview" style="background:#f8f9fa; padding:10px; border-radius:4px; max-height:280px; overflow-y:auto;">${html}</div>`;
        }
        else if (res.type === 'code') content = `<pre style="font-family:monospace; background:#282c34; color:#abb2bf; padding:10px; border-radius:4px; font-size:12px; overflow:auto;">${this.app.utils.escapeHtml(res.content)}</pre>`;
        else if (res.type === 'color') content = `<div style="width:100px; height:60px; background-color:${res.content}; border-radius:4px; border:1px solid #ddd; margin-bottom:5px;"></div><div style="text-align:center; font-family:monospace; font-weight:bold;">${res.content}</div>`;
        else if (res.type === 'audio') content = `<audio controls src="${res.content}" style="width:250px;"></audio>`;
        else if (res.type === 'link') content = `<div style="font-size:12px; color:#555; margin-bottom:8px; word-break:break-all;">${this.app.utils.escapeHtml(res.content)}</div><a href="${res.content}" target="_blank" style="display:block; text-align:center; background:#667eea; color:white; text-decoration:none; padding:6px; border-radius:4px; font-size:12px;">跳转到链接 🔗</a>`;

        this.tooltipEl.innerHTML = content;
        this.tooltipEl.style.display = 'block';

        const pad = 15; let top = y + pad; let left = x + pad;
        const rect = this.tooltipEl.getBoundingClientRect();
        if (left + rect.width > window.innerWidth) left = x - rect.width - pad;
        if (top + rect.height > window.innerHeight) top = y - rect.height - pad;
        this.tooltipEl.style.top = top + 'px'; this.tooltipEl.style.left = left + 'px';
    }

    // [Feature 12] Stop audio on tooltip hide
    hideTooltip() {
        clearTimeout(this.app.state.tooltipTimer);
        this.app.state.tooltipTimer = setTimeout(() => {
            if (this.tooltipEl) {
                this.tooltipEl.querySelectorAll('audio').forEach(a => { a.pause(); a.currentTime = 0; });
                this.tooltipEl.style.display = 'none';
            }
        }, config.previewDelay);
    }

    // [Feature 7] showTooltip — supports note tooltip
    showTooltip(node, x, y) {
        if (node.resId) {
            this.displayTooltip(node.resId, x, y);
        } else if (node.note) {
            this.displayNoteTooltip(node.note, x, y);
        }
    }

    // [Feature 7] Note tooltip
    displayNoteTooltip(note, x, y) {
        clearTimeout(this.app.state.tooltipTimer);
        this.tooltipEl.innerHTML = `<div style="font-size:13px;line-height:1.6;white-space:pre-wrap;max-width:260px;">${this.app.utils.escapeHtml(note)}</div>`;
        this.tooltipEl.style.display = 'block';
        const pad = 15;
        let top = y + pad, left = x + pad;
        const rect = this.tooltipEl.getBoundingClientRect();
        if (left + rect.width > window.innerWidth) left = x - rect.width - pad;
        if (top + rect.height > window.innerHeight) top = y - rect.height - pad;
        this.tooltipEl.style.top = top + 'px';
        this.tooltipEl.style.left = left + 'px';
    }

    toast(m) {
        const t = this.app.dom.toast;
        t.innerText = m;
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 3000);
    }

    exportImage() {
        this.app.graph.exportImage();
    }

    // [Feature 9] Duplicate current project
    async duplicateCurrentProject() {
        if (!this.app.state.currentId) return this.toast('请先选择一个项目');
        await this.app.storage.duplicateProject(this.app.state.currentId);
    }
}
