import { config } from '../config.js';

export class UIModule {
    // ... existing init and other methods ...
    constructor(app) {
        this.app = app;
        this.tooltipEl = null;
        this._promptResolve = null;
    }

    init() {
        this.initTooltip();
        this.bindGlobalEvents();
        this.setupInputModal(); // 别忘了这个

        this.app.eventBus.on('resources:updated', () => this.renderResourceTree());
        this.app.eventBus.on('nodes:deleted', () => {
            this.app.state.selectedNodes.clear();
            this.app.state.bubbleNode = null;
            this.app.state.editingNode = null;
            this.hideNodeBubble();
        });
        this.app.eventBus.on('toast', (data) => this.toast(data.msg));
    }

    // ... existing initTooltip, setupInputModal, promptUser, bindGlobalEvents, updateSaveStatus, updateProjectSelect ...

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

        const confirmHandler = () => {
            if (this._promptResolve) {
                const val = input.value.trim();
                this._promptResolve(val || null);
            }
            this.closeModal('inputModal');
            this._promptResolve = null;
        };

        const cancelHandler = () => {
            if (this._promptResolve) this._promptResolve(null);
            this.closeModal('inputModal');
            this._promptResolve = null;
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
            document.getElementById('inputModalTitle').innerText = title;
            const input = document.getElementById('inputModalValue');
            input.placeholder = placeholder;
            input.value = defaultValue;
            document.getElementById('inputModal').style.display = 'flex';
            setTimeout(() => input.focus(), 100);
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
                if (!confirm(`图片超过 ${config.maxImageSizeMB}MB，将自动压缩，是否继续？`)) {
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

    renderResourceTree() {
        const container = this.app.dom.resList;
        const resources = this.app.state.resources;

        if(!resources.length) {
            container.innerHTML = '<div class="empty-tip">暂无资源<br><small>拖入文件或点击添加</small></div>';
            return;
        }

        const keyword = this.app.state.searchKeyword;
        const folders = resources.filter(r => r.type === 'folder');
        const rootFiles = resources.filter(r => {
            if (keyword && !r.name.toLowerCase().includes(keyword)) return false;
            return !r.parentId && r.type !== 'folder';
        });

        let html = '';

        folders.forEach(folder => {
            const children = resources.filter(r => r.parentId === folder.id && r.type !== 'folder');
            const matchChildren = children.filter(c => !keyword || c.name.toLowerCase().includes(keyword));

            if (keyword && !folder.name.toLowerCase().includes(keyword) && matchChildren.length === 0) return;

            const isOpen = keyword ? true : this.app.state.expandedFolders.has(folder.id);

            // [新增] 这里的 .btn-add-resource 按钮
            html += `
                <div class="res-folder ${isOpen?'open':''}" 
                     onclick="app.ui.toggleFolder('${folder.id}')"
                     oncontextmenu="event.preventDefault(); app.ui.handleRenameFolder('${folder.id}');"
                     ondragover="app.ui.dragOver(event, '${folder.id}')"
                     ondrop="app.ui.drop(event, '${folder.id}')"
                     ondragleave="app.ui.dragLeave(event)"
                     title="右键点击可快速重命名">
                    <div class="folder-icon">▶</div>
                    <div class="res-info"><div class="res-name">${this.highlightText(folder.name, keyword)}</div></div>
                    <div class="res-actions">
                        <!-- 快速添加资源按钮 -->
                        <div class="btn-add-resource" onclick="event.stopPropagation(); app.ui.openResModal('New', null, '${folder.id}')" title="在此文件夹添加资源">+</div>
                        <div class="btn-res-action" onclick="event.stopPropagation(); app.ui.handleRenameFolder('${folder.id}')" title="重命名">✎</div>
                        <div class="btn-res-action del" onclick="event.stopPropagation(); app.ui.handleDeleteResource('${folder.id}')" title="删除文件夹">🗑</div>
                    </div>
                </div>
                <div class="folder-children ${isOpen?'open':''}">
                    ${matchChildren.map(child => this.createResItemHtml(child, keyword)).join('')}
                </div>
            `;
        });

        rootFiles.forEach(file => { html += this.createResItemHtml(file, keyword); });
        container.innerHTML = html;
    }

    createResItemHtml(r, keyword) {
        let icon = '🔗';
        if(r.type==='image') icon='🖼️'; else if(r.type==='md') icon='📝'; else if(r.type==='code') icon='💻'; else if(r.type==='color') icon='🎨'; else if(r.type==='audio') icon='🎤';

        return `
            <div class="res-item" 
                 draggable="true" 
                 ondragstart="app.ui.dragStart(event, '${r.id}')"
                 onmouseenter="app.ui.showSidebarPreview('${r.id}', event)"
                 onmouseleave="app.ui.hideTooltip()">
                <div class="res-icon" onclick="app.ui.viewResource('${r.id}')">${icon}</div>
                <div class="res-info" onclick="app.ui.viewResource('${r.id}')">
                    <div class="res-name">${this.highlightText(r.name, keyword)}</div>
                </div>
                <div class="res-actions">
                    <div class="btn-res-action" onclick="app.ui.handleEditResource('${r.id}')" title="编辑">✎</div>
                    <div class="btn-res-action del" onclick="app.ui.handleDeleteResource('${r.id}')" title="删除">🗑</div>
                </div>
            </div>
        `;
    }

    highlightText(text, keyword) {
        if (!keyword) return text;
        const reg = new RegExp(`(${keyword})`, 'gi');
        return text.replace(reg, '<span class="highlight">$1</span>');
    }

    // ... handleCreateFolder, handleRenameFolder, handleDeleteResource, handleEditResource ...

    handleCreateFolder() {
        if(!this.app.state.currentId) return this.toast('请先创建项目');
        this.promptUser('新建文件夹', '输入文件夹名称').then(name => {
            if(name) this.app.data.createFolder(name);
        });
    }

    handleRenameFolder(id) {
        const folder = this.app.state.resources.find(r => r.id === id);
        if (!folder) return;
        this.promptUser('重命名', '输入新名称', folder.name).then(newName => {
            if (newName) this.app.data.renameFolder(id, newName);
        });
    }

    handleDeleteResource(id) {
        const res = this.app.state.resources.find(r => r.id === id);
        if (!res) return;
        let confirmMsg = '确定删除此资源吗？';
        if (res.type === 'folder') confirmMsg = '确定删除此文件夹及其所有内容吗？此操作不可恢复。';
        if (confirm(confirmMsg)) {
            this.app.data.deleteResource(id);
        }
    }

    handleEditResource(id) {
        const res = this.app.state.resources.find(r => r.id === id);
        if (!res) return;
        this.app.state.editingResId = id;
        this.openResModal('Edit', res);
    }

    // [修改] 支持传入 parentId 预选文件夹
    openResModal(mode, res, preselectParentId = null) {
        if(!this.app.state.currentId) return this.toast('请先建项目');
        const title = document.getElementById('resModalTitle');
        const typeSel = document.getElementById('resType');
        const parentSel = document.getElementById('resParentId');
        const nameInput = document.getElementById('resName');

        const folders = this.app.state.resources.filter(r => r.type === 'folder');
        parentSel.innerHTML = '<option value="">(根目录)</option>' +
            folders.map(f => `<option value="${f.id}">📁 ${f.name}</option>`).join('');

        this.app.state.tempFileBase64 = null;
        document.getElementById('resFile').value = '';
        document.getElementById('resTextInput').value = '';
        document.getElementById('resTextArea').value = '';
        document.getElementById('resColorInput').value = '#000000';
        document.getElementById('resColorValue').innerText = '#000000';

        if (mode === 'Edit' && res) {
            title.innerText = '✨ 编辑资源';
            typeSel.value = res.type; typeSel.disabled = true;
            nameInput.value = res.name;
            parentSel.value = res.parentId || '';

            if (res.type === 'link') document.getElementById('resTextInput').value = res.content;
            else if (res.type === 'md' || res.type === 'code') document.getElementById('resTextArea').value = res.content;
            else if (res.type === 'color') { document.getElementById('resColorInput').value = res.content; document.getElementById('resColorValue').innerText = res.content; }
        } else {
            title.innerText = '✨ 添加资源';
            typeSel.disabled = false; this.app.state.editingResId = null;
            nameInput.value = ''; typeSel.value = 'image';
            // 如果点击了文件夹旁边的+号，自动选中该文件夹
            parentSel.value = preselectParentId || '';
        }

        this.toggleResInput();
        document.getElementById('resModal').style.display='flex';
    }

    // ... existing handleSaveResourceClick, handleSaveNodeEdit, confirmDeleteProject ...

    async handleSaveResourceClick() {
        const type = document.getElementById('resType').value;
        const name = document.getElementById('resName').value;
        const parentId = document.getElementById('resParentId').value || null;

        if (!name) return this.toast('请输入名称');

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
            type, name, content, parentId
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
            this.app.data.updateNode(node.id, { label, resId });
            document.getElementById('nodeMenu').style.display = 'none';
        }
    }

    confirmDeleteProject() {
        if(this.app.state.currentId && confirm('确定删除？')) {
            this.app.storage.deleteProject(this.app.state.currentId);
        }
    }

    closeModal(id) { document.getElementById(id).style.display='none'; }

    // ... toggleTheme, triggerImport, filterResources, toggleFolder ...

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

    // ... viewResource, openNodeMenu, toggleSidebar, toggleResInput ...

    viewResource(id) {
        const res = this.app.state.resources.find(r => r.id === id); if(!res) return;
        const n = this.app.state.nodes.find(n => n.resId === id);
        if(n) {
            this.app.state.camera.x = this.app.graph.width/2 - n.x * this.app.state.camera.k;
            this.app.state.camera.y = this.app.graph.height/2 - n.y * this.app.state.camera.k;
            this.toast('已定位');
        } else {
            if(res.type==='link') window.open(res.content);
            else if(res.type==='image') { const w=window.open(""); w.document.write(`<img src="${res.content}" style="max-width:100%">`); }
            else if(res.type==='md' || res.type==='code') alert('请在悬浮窗查看内容预览');
            else if(res.type==='audio') { const a = new Audio(res.content); a.play(); this.toast('正在播放音频'); }
            else if(res.type==='color') { navigator.clipboard.writeText(res.content); this.toast('色值已复制: '+res.content); }
        }
    }

    openNodeMenu(node, x, y) {
        const m = this.app.dom.nodeMenu;
        this.app.state.editingNode = node;

        document.getElementById('nodeLabel').value = node.label;
        const sel = document.getElementById('nodeResSelect');
        sel.innerHTML = '<option value="">(无)</option>' + this.app.state.resources.filter(r=>r.type!=='folder').map(r =>
            `<option value="${r.id}" ${r.id===node.resId?'selected':''}>${r.name}</option>`
        ).join('');

        if (x !== undefined && y !== undefined) {
            let left = x; let top = y;
            if (left + 320 > window.innerWidth) left = window.innerWidth - 340;
            if (top + 350 > window.innerHeight) top = window.innerHeight - 370;
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

    // ... showNodeBubble, hideNodeBubble, updateBubblePosition, onBubbleEdit, onBubbleDelete ...

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
        const cy = window.innerHeight / 2 - 180;
        this.openNodeMenu(node, cx, cy);
    }

    onBubbleDelete() {
        const idsToDelete = new Set();
        if (this.app.state.bubbleNode) {
            idsToDelete.add(this.app.state.bubbleNode.id);
        }
        this.app.state.selectedNodes.forEach(id => idsToDelete.add(id));

        if (idsToDelete.size === 0) return;

        const confirmMsg = idsToDelete.size > 1
            ? `确定要删除选中的 ${idsToDelete.size} 个节点吗？`
            : '确定要删除这个节点及其连线吗？';

        if(confirm(confirmMsg)) {
            this.app.data.deleteNodes(Array.from(idsToDelete));
        }
    }

    // ... dragStart, dragOver, dragLeave, drop, showSidebarPreview, displayTooltip, hideTooltip, showTooltip, toast, exportImage ...

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

    hideTooltip() {
        clearTimeout(this.app.state.tooltipTimer);
        this.app.state.tooltipTimer = setTimeout(() => {
            if (this.tooltipEl) this.tooltipEl.style.display = 'none';
        }, config.previewDelay);
    }

    showTooltip(node, x, y) {
        if (node.resId) this.displayTooltip(node.resId, x, y);
    }

    toast(m) {
        const t = this.app.dom.toast;
        t.innerText = m;
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 3000);
    }

    exportImage() {
        if (this.app.state.nodes.length === 0) return this.toast('画布为空');

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        this.app.state.nodes.forEach(n => {
            const r = (n.type === 'root' ? this.app.config.nodeRadius :  this.app.config.subRadius) * (n.scale || 1);
            if (n.x - r < minX) minX = n.x - r;
            if (n.x + r > maxX) maxX = n.x + r;
            if (n.y - r < minY) minY = n.y - r;
            if (n.y + r > maxY) maxY = n.y + r;
        });

        const padding = 50;
        const width = maxX - minX + padding * 2;
        const height = maxY - minY + padding * 2;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        const isDark = document.body.getAttribute('data-theme') === 'dark';
        ctx.fillStyle = isDark ? '#18181b' : '#f3f3f3';
        ctx.fillRect(0, 0, width, height);

        ctx.save();
        ctx.translate(-minX + padding, -minY + padding);

        ctx.beginPath();
        ctx.strokeStyle =  this.app.config.colors.link;
        ctx.lineWidth = 1.5;
        this.app.state.links.forEach(l => {
            const s = l.source, t = l.target;
            if (s.x && t.x) {
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(t.x, t.y);
            }
        });
        ctx.stroke();

        this.app.state.nodes.forEach(n => {
            const r = (n.type === 'root' ?  this.app.config.nodeRadius :  this.app.config.subRadius) * (n.scale || 1);

            ctx.save();
            if (n.type === 'root') {
                ctx.shadowColor = 'rgba(0,0,0,0.2)';
                ctx.shadowBlur = 20;
                ctx.shadowOffsetY = 5;
            }

            ctx.beginPath();
            ctx.arc(n.x, n.y, r, 0, Math.PI * 2);

            let fillColor = n.type === 'root' ?  this.app.config.colors.primary :  this.app.config.colors.surface;
            const res = n.resId ?  this.app.state.resources.find(r => r.id === n.resId) : null;
            if (res && res.type === 'color') fillColor = res.content;

            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.restore();

            if (res && res.type === 'image') {
                const imgObj =  this.app.graph.imageCache.get(res.id);
                if (imgObj && imgObj.loaded) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(n.x, n.y, r - 2, 0, Math.PI * 2);
                    ctx.clip();
                    const scale = Math.max((r*2)/imgObj.width, (r*2)/imgObj.height);
                    ctx.drawImage(imgObj.obj, n.x - imgObj.width*scale/2, n.y - imgObj.height*scale/2, imgObj.width*scale, imgObj.height*scale);
                    ctx.restore();
                }
            } else if (res && res.type !== 'color') {
                let icon = '🔗';
                if (res.type === 'md') icon = '📝';
                else if (res.type === 'code') icon = '💻';
                else if (res.type === 'audio') icon = '🎤';

                ctx.fillStyle = (n.type === 'root') ? 'rgba(255,255,255,0.9)' : '#f59e0b';
                ctx.font = `${20 * (n.scale||1)}px Arial`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(icon, n.x, n.y - 5);
            }

            if (n.type === 'root') {
                if (!res || res.type !== 'color') {
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
                    ctx.stroke();
                }
            } else if (!res || res.type !== 'color') {
                ctx.lineWidth = 1.5;
                ctx.strokeStyle =  this.app.config.colors.outline;
                ctx.stroke();
            }

            ctx.fillStyle = (n.type === 'root') ?  this.app.config.colors.textLight :  this.app.config.colors.textMain;
            ctx.font = `${n.type==='root'?'bold':''} ${12 * (n.scale||1)}px "Segoe UI", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const textY = (res && res.type === 'image') ? n.y + r + 15 : (n.resId && res.type !== 'image' && res.type !== 'color' ? n.y + 15 : n.y);
            ctx.fillText(n.label, n.x, textY);
        });

        ctx.restore();

        const link = document.createElement('a');
        link.download = `MindFlow_${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        this.toast('图片已导出');
    }
}
