/**
 * MindFlow - App Logic
 * 更新内容：修复侧边栏资源无法预览的问题，重构 Tooltip 逻辑以支持全局预览
 */

const app = {
    // --- 配置 ---
    config: {
        appVersion: '1.6.1',
        nodeRadius: 40, subRadius: 30, linkDistance: 150, chargeStrength: -800, collideRadius: 55,
        dbName: 'MindFlowDB', storeName: 'projects',
        previewDelay: 50
    },

    // --- 全局状态 ---
    state: {
        currentId: null,
        projectsIndex: [],
        nodes: [], links: [], resources: [],
        camera: { x: 0, y: 0, k: 1 },
        simulation: null, selectedNode: null, tempFileBase64: null, hoverNode: null, tooltipTimer: null,
        editingResId: null,
        expandedFolders: new Set(),
        draggedResId: null
    },

    // --- 模块 1: 存储 (Storage) ---
    storage: {
        init: async function() {
            localforage.config({ name: app.config.dbName, storeName: app.config.storeName });
            await this.loadIndex();
        },

        loadIndex: async function() {
            try {
                const index = await localforage.getItem('__project_index__') || [];
                app.state.projectsIndex = index;
                app.ui.updateProjectSelect();
            } catch (e) { console.error('索引加载失败', e); }
        },

        saveIndex: async function() { await localforage.setItem('__project_index__', app.state.projectsIndex); },

        createProject: async function(name) {
            const id = 'proj_' + Date.now();
            const newProj = {
                id: id, name: name, created: Date.now(),
                nodes: [], links: [], resources: []
            };
            await localforage.setItem(id, newProj);
            app.state.projectsIndex.push({ id: id, name: name });
            await this.saveIndex();
            return id;
        },

        renameProject: async function(id, newName) {
            if (!id || !newName) return;
            try {
                const idx = app.state.projectsIndex.findIndex(p => p.id === id);
                if (idx !== -1) { app.state.projectsIndex[idx].name = newName; await this.saveIndex(); }
                const proj = await localforage.getItem(id);
                if (proj) { proj.name = newName; await localforage.setItem(id, proj); }
                app.ui.updateProjectSelect();
                app.ui.toast('项目重命名成功');
            } catch (e) { app.ui.toast('重命名失败: ' + e.message); }
        },

        deleteProject: async function(id) {
            if (!id) return;
            try {
                await localforage.removeItem(id);
                app.state.projectsIndex = app.state.projectsIndex.filter(p => p.id !== id);
                await this.saveIndex();
                app.ui.toast('项目已删除');
                if (app.state.currentId === id) {
                    app.state.currentId = null;
                    app.state.nodes = []; app.state.links = []; app.state.resources = [];
                    app.graph.updateSimulation();
                    app.ui.renderResourceTree();
                    document.getElementById('projTitleInput').value = '';
                    document.getElementById('saveStatus').innerText = '已就绪';
                }
                app.ui.updateProjectSelect();
            } catch (e) { app.ui.toast('删除失败: ' + e.message); }
        },

        loadProject: async function(id) {
            try {
                const proj = await localforage.getItem(id);
                if (!proj) throw new Error('项目不存在');

                app.state.currentId = id;
                app.state.nodes = JSON.parse(JSON.stringify(proj.nodes || []));
                app.state.links = JSON.parse(JSON.stringify(proj.links || []));
                app.state.resources = (proj.resources || []).map(r => ({ ...r, parentId: r.parentId || null }));

                document.getElementById('projTitleInput').value = proj.name;
                app.graph.resetCamera(); app.graph.imageCache.clear();
                app.ui.renderResourceTree();
                app.ui.toast(`已加载: ${proj.name}`);
                app.graph.updateSimulation();
                document.getElementById('saveStatus').innerText = '已加载';
            } catch (e) { app.ui.toast('加载失败: ' + e.message); }
        },

        forceSave: async function() {
            if (!app.state.currentId) return app.ui.toast('请先创建或选择项目');
            document.getElementById('saveStatus').innerText = '保存中...';
            const currentProjName = document.getElementById('projTitleInput').value || '未命名项目';
            const projData = {
                id: app.state.currentId, name: currentProjName, updated: Date.now(),
                nodes: app.state.nodes.map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, label: n.label, resId: n.resId })),
                links: app.state.links.map(l => ({ source: l.source.id || l.source, target: l.target.id || l.target })),
                resources: app.state.resources
            };
            try {
                await localforage.setItem(app.state.currentId, projData);
                app.ui.toast('保存成功');
                document.getElementById('saveStatus').innerText = '已保存 ' + new Date().toLocaleTimeString();
            } catch (e) { console.error(e); app.ui.toast('保存失败 (可能文件过大)'); }
        },

        importExternalProject: async function(projData) {
            const newId = 'proj_' + Date.now() + '_imp';
            const newName = projData.name + ' (导入)';
            const newProj = {
                id: newId, name: newName, created: Date.now(),
                nodes: projData.nodes || [], links: projData.links || [], resources: projData.resources || []
            };
            await localforage.setItem(newId, newProj);
            app.state.projectsIndex.push({ id: newId, name: newName });
            await this.saveIndex();
            return newId;
        },

        exportProjectToFile: function() {
            if (!app.state.currentId) return app.ui.toast('请先选择项目');
            const currentProjName = document.getElementById('projTitleInput').value || '未命名项目';
            const exportData = {
                meta: { version: app.config.appVersion, type: 'MindFlowProject', exportedAt: Date.now() },
                project: {
                    name: currentProjName,
                    nodes: app.state.nodes.map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, label: n.label, resId: n.resId })),
                    links: app.state.links.map(l => ({ source: l.source.id || l.source, target: l.target.id || l.target })),
                    resources: app.state.resources
                }
            };
            const blob = new Blob([JSON.stringify(exportData, null, 2)], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url;
            const dateStr = new Date().toISOString().split('T')[0];
            a.download = `${currentProjName.replace(/\s+/g, '_')}_${dateStr}.mindflow.json`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
            app.ui.toast('项目已导出');
        },

        importProjectFromFile: function(file) {
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const json = JSON.parse(e.target.result);
                    if (!json.meta || !json.project) throw new Error('无效的文件格式');
                    const newId = await app.storage.importExternalProject(json.project);
                    await app.storage.loadProject(newId);
                    app.ui.updateProjectSelect();
                    app.ui.toast('项目导入成功');
                } catch (err) { app.ui.toast('导入失败: ' + err.message); }
            };
            reader.readAsText(file);
        }
    },

    // --- 模块 2: 图形与物理引擎 (Graph) ---
    graph: {
        canvas: null, ctx: null, width: 0, height: 0,
        imageCache: new Map(), dragSubject: null, isPanning: false, startPan: {x:0, y:0},

        init: function() {
            this.canvas = document.getElementById('mainCanvas');
            this.ctx = this.canvas.getContext('2d');
            const resizeObserver = new ResizeObserver(() => this.resize());
            resizeObserver.observe(document.getElementById('canvasWrapper'));

            app.state.simulation = d3.forceSimulation()
                .force("link", d3.forceLink().id(d => d.id).distance(app.config.linkDistance))
                .force("charge", d3.forceManyBody().strength(app.config.chargeStrength))
                .force("collide", d3.forceCollide().radius(app.config.collideRadius))
                .force("center", d3.forceCenter(0, 0).strength(0.02))
                .on("tick", () => {});

            this.bindEvents();
            requestAnimationFrame(() => this.renderLoop());
        },

        resize: function() {
            const wrapper = document.getElementById('canvasWrapper');
            this.width = wrapper.clientWidth; this.height = wrapper.clientHeight;
            this.canvas.width = this.width; this.canvas.height = this.height;
            if (!app.state.currentId && app.state.nodes.length === 0) this.resetCamera();
            if (app.state.simulation) app.state.simulation.alpha(0.1).restart();
        },

        resetCamera: function() { app.state.camera = { x: this.width / 2, y: this.height / 2, k: 1 }; },

        updateSimulation: function() {
            if (!app.state.simulation) return;
            app.state.simulation.nodes(app.state.nodes);
            app.state.simulation.force("link").links(app.state.links);
            app.state.simulation.alpha(1).restart();
        },

        addRootNode: function() {
            if (!app.state.currentId) return app.ui.toast('请先新建项目');
            if (app.state.nodes.length > 0) return app.ui.toast('根节点已存在');
            app.state.nodes.push({ id: 'n_' + Date.now(), type: 'root', x: 0, y: 0, label: '中心主题' });
            this.updateSimulation(); app.storage.forceSave();
        },

        addChildNode: function(parent) {
            const angle = Math.random() * Math.PI * 2;
            app.state.nodes.push({
                id: 'n_' + Date.now(), type: 'sub',
                x: parent.x + Math.cos(angle) * 10, y: parent.y + Math.sin(angle) * 10, label: '新节点'
            });
            app.state.links.push({ source: parent.id, target: app.state.nodes[app.state.nodes.length-1].id });
            this.updateSimulation(); app.storage.forceSave();
        },

        clearAll: function() {
            if(confirm('确定清空画布吗？')) {
                app.state.nodes = []; app.state.links = [];
                this.updateSimulation(); app.storage.forceSave();
            }
        },

        renderLoop: function() {
            const ctx = this.ctx; const cam = app.state.camera;
            ctx.clearRect(0, 0, this.width, this.height);
            ctx.save();
            ctx.translate(cam.x, cam.y);
            ctx.scale(cam.k, cam.k);

            ctx.beginPath(); ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2;
            app.state.links.forEach(l => {
                const s = l.source, t = l.target;
                if (s.x && t.x) { ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y); }
            });
            ctx.stroke();

            app.state.nodes.forEach(n => {
                const r = n.type === 'root' ? app.config.nodeRadius : app.config.subRadius;

                let fillColor = 'white';
                let hasImg = false;
                const res = n.resId ? app.state.resources.find(r => r.id === n.resId) : null;

                if (res && res.type === 'color') {
                    fillColor = res.content;
                }

                ctx.shadowColor = 'rgba(0,0,0,0.1)'; ctx.shadowBlur = 10;
                ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
                ctx.fillStyle = fillColor; ctx.fill(); ctx.shadowBlur = 0;

                if (res) {
                    if (res.type === 'image') {
                        this.drawImageInNode(n, res, r); hasImg = true;
                    } else if (res.type !== 'color') {
                        let icon = '🔗';
                        if (res.type === 'md') icon = '📝';
                        else if (res.type === 'code') icon = '💻';
                        else if (res.type === 'audio') icon = '🎤';
                        ctx.font = '20px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                        ctx.fillText(icon, n.x, n.y - 5);
                    }
                }

                ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
                ctx.lineWidth = 3;
                ctx.strokeStyle = (app.state.selectedNode === n) ? '#e74c3c' : (n.type === 'root' ? '#2c3e50' : '#667eea');
                ctx.stroke();

                ctx.fillStyle = '#334155'; ctx.font = 'bold 12px Arial';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                const textY = hasImg ? n.y + r + 15 : (n.resId && !hasImg ? n.y + 15 : n.y);
                ctx.fillText(n.label, n.x, textY);

                const btnX = n.x + r * 0.707; const btnY = n.y + r * 0.707;
                ctx.beginPath(); ctx.arc(btnX, btnY, 9, 0, Math.PI * 2);
                ctx.fillStyle = '#22c55e'; ctx.fill();
                ctx.fillStyle = 'white'; ctx.font = 'bold 14px Arial'; ctx.fillText('+', btnX, btnY + 1);
            });

            ctx.restore();
            requestAnimationFrame(() => this.renderLoop());
        },

        drawImageInNode: function(node, res, r) {
            if (!this.imageCache.has(res.id)) {
                const img = new Image(); img.src = res.content;
                img.onload = () => this.imageCache.set(res.id, img);
                this.imageCache.set(res.id, 'loading');
            }
            const img = this.imageCache.get(res.id);
            if (img && img !== 'loading') {
                this.ctx.save(); this.ctx.beginPath();
                this.ctx.arc(node.x, node.y, r - 2, 0, Math.PI * 2); this.ctx.clip();
                const scale = Math.max((r*2)/img.width, (r*2)/img.height);
                this.ctx.drawImage(img, node.x - img.width*scale/2, node.y - img.height*scale/2, img.width*scale, img.height*scale);
                this.ctx.restore();
            }
        },

        bindEvents: function() {
            const canvas = this.canvas;
            const getPos = (e) => {
                const rect = canvas.getBoundingClientRect(); const k = app.state.camera.k;
                const cx = e.touches ? e.touches[0].clientX : e.clientX;
                const cy = e.touches ? e.touches[0].clientY : e.clientY;
                return { x: (cx - rect.left - app.state.camera.x) / k, y: (cy - rect.top - app.state.camera.y) / k, rawX: cx, rawY: cy };
            };

            canvas.addEventListener('dragover', (e) => { e.preventDefault(); });

            canvas.addEventListener('drop', (e) => {
                e.preventDefault();
                const resId = e.dataTransfer.getData('text/plain');
                if (!resId) return;

                const m = getPos(e);
                const hitNode = app.state.nodes.find(n => {
                    const r = n.type === 'root' ? app.config.nodeRadius : app.config.subRadius;
                    return Math.hypot(m.x - n.x, m.y - n.y) < r;
                });

                if (hitNode) {
                    hitNode.resId = resId;
                    app.ui.toast('资源已关联');
                    app.storage.forceSave();
                }
            });

            const handleStart = (e) => {
                const menu = document.getElementById('nodeMenu');
                if (menu.style.display !== 'none') {
                    menu.style.display = 'none';
                }

                if (e.target !== canvas) return;
                const m = getPos(e);
                let hitNode = null;
                for (let i = app.state.nodes.length - 1; i >= 0; i--) {
                    const n = app.state.nodes[i];
                    const r = n.type === 'root' ? app.config.nodeRadius : app.config.subRadius;
                    if (Math.hypot(m.x - (n.x + r*0.707), m.y - (n.y + r*0.707)) < 15) { this.addChildNode(n); return; }
                    if (Math.hypot(m.x - n.x, m.y - n.y) < r) { hitNode = n; break; }
                }
                if (hitNode) {
                    this.dragSubject = hitNode; hitNode.fx = hitNode.x; hitNode.fy = hitNode.y;
                    app.state.simulation.alphaTarget(0.3).restart(); app.state.selectedNode = hitNode;
                } else {
                    this.isPanning = true; this.startPan = { x: m.rawX, y: m.rawY }; app.state.selectedNode = null;
                }
            };

            const handleMove = (e) => {
                if (!e.touches) {
                    const m = getPos(e);
                    let hoverNode = null;
                    for (let i = app.state.nodes.length - 1; i >= 0; i--) {
                        const n = app.state.nodes[i];
                        const r = n.type === 'root' ? app.config.nodeRadius : app.config.subRadius;
                        if (Math.hypot(m.x - n.x, m.y - n.y) < r) { hoverNode = n; break; }
                    }
                    if (hoverNode && hoverNode.resId) app.ui.showTooltip(hoverNode, e.clientX, e.clientY);
                    else app.ui.hideTooltip();
                }
                if (!this.dragSubject && !this.isPanning) return;
                e.preventDefault();
                const m = getPos(e);
                if (this.dragSubject) { this.dragSubject.fx = m.x; this.dragSubject.fy = m.y; }
                else if (this.isPanning) {
                    app.state.camera.x += m.rawX - this.startPan.x; app.state.camera.y += m.rawY - this.startPan.y;
                    this.startPan = { x: m.rawX, y: m.rawY };
                }
            };

            const handleEnd = () => {
                if (this.dragSubject) {
                    this.dragSubject.fx = null; this.dragSubject.fy = null;
                    app.state.simulation.alphaTarget(0); this.dragSubject = null;
                }
                this.isPanning = false;
            };

            canvas.addEventListener('mousedown', handleStart);
            canvas.addEventListener('mousemove', handleMove);
            window.addEventListener('mouseup', handleEnd);
            canvas.addEventListener('touchstart', handleStart, {passive: false});
            canvas.addEventListener('touchmove', handleMove, {passive: false});
            window.addEventListener('touchend', handleEnd);
            canvas.addEventListener('wheel', (e) => {
                e.preventDefault(); const f = e.deltaY < 0 ? 1.1 : 0.9;
                app.state.camera.k = Math.max(0.1, Math.min(5, app.state.camera.k * f));
            });
            canvas.addEventListener('dblclick', (e) => {
                const m = getPos(e);
                const hit = app.state.nodes.find(n => Math.hypot(m.x - n.x, m.y - n.y) < (n.type==='root'?40:30));
                if (hit) app.ui.openNodeMenu(hit, e.clientX, e.clientY);
            });
        }
    },

    // --- 模块 3: 数据处理 (Data) ---
    data: {
        renameProject: function(n) {
            if(!app.state.currentId) { app.ui.toast('请先创建项目'); document.getElementById('projTitleInput').value=''; return; }
            if(n.trim()) app.storage.renameProject(app.state.currentId, n.trim());
        },

        createFolder: function() {
            if(!app.state.currentId) return app.ui.toast('请先创建项目');
            const name = prompt('文件夹名称:');
            if(!name) return;
            const folder = { id: 'folder_' + Date.now(), type: 'folder', name: name, parentId: null };
            app.state.resources.push(folder);
            app.ui.renderResourceTree();
            app.storage.forceSave();
        },

        renameFolder: function(id) {
            const folder = app.state.resources.find(r => r.id === id);
            if (!folder) return;
            const newName = prompt('输入新名称:', folder.name);
            if (newName && newName.trim()) {
                folder.name = newName.trim();
                app.ui.renderResourceTree();
                app.storage.forceSave();
                app.ui.toast('已重命名');
            }
        },

        moveResource: function(resId, parentId) {
            const res = app.state.resources.find(r => r.id === resId);
            if (!res || res.type === 'folder' || res.id === parentId) {
                if (res && res.type === 'folder') app.ui.toast('暂不支持移动文件夹');
                return;
            }
            res.parentId = parentId;
            if (parentId) app.state.expandedFolders.add(parentId);
            app.ui.renderResourceTree();
            app.storage.forceSave();
        },

        saveResource: function() {
            const type = document.getElementById('resType').value;
            const name = document.getElementById('resName').value;
            const parentId = document.getElementById('resParentId').value || null;

            if (!name) return app.ui.toast('请输入名称');

            let content = null;
            if (type === 'image' || type === 'audio') {
                if (app.state.tempFileBase64) content = app.state.tempFileBase64;
                else if (app.state.editingResId) content = app.state.resources.find(r => r.id === app.state.editingResId).content;
                else return app.ui.toast('请上传文件');
            } else if (type === 'color') {
                content = document.getElementById('resColorInput').value;
            } else if (type === 'md' || type === 'code') {
                content = document.getElementById('resTextArea').value;
                if(!content) return app.ui.toast('请输入内容');
            } else {
                content = document.getElementById('resTextInput').value || '#';
            }

            if (app.state.editingResId) {
                const res = app.state.resources.find(r => r.id === app.state.editingResId);
                if (res) {
                    res.name = name; res.type = type; res.content = content; res.parentId = parentId;
                    app.ui.toast('资源已更新');
                }
            } else {
                const newRes = {
                    id: 'res_' + Date.now(),
                    type: type, name: name, content: content, parentId: parentId
                };
                app.state.resources.push(newRes);
                app.ui.toast('资源已添加');
            }

            app.ui.renderResourceTree();
            app.ui.closeModal('resModal');
            app.storage.forceSave();

            app.state.tempFileBase64 = null; app.state.editingResId = null; document.getElementById('resFile').value = '';
        },

        editResource: function(id) {
            const res = app.state.resources.find(r => r.id === id);
            if (!res) return;
            app.state.editingResId = id;
            app.ui.openResModal('Edit', res);
        },

        deleteResource: function(id) {
            if (!confirm('确定删除？')) return;
            const res = app.state.resources.find(r => r.id === id);
            if (res && res.type === 'folder') {
                app.state.resources = app.state.resources.filter(r => r.parentId !== id && r.id !== id);
            } else {
                app.state.resources = app.state.resources.filter(r => r.id !== id);
            }
            app.state.nodes.forEach(n => { if (n.resId === id) n.resId = null; });
            app.ui.renderResourceTree();
            app.storage.forceSave();
            app.ui.toast('已删除');
        },

        saveNodeEdit: function() {
            if (app.state.selectedNode) {
                app.state.selectedNode.label = document.getElementById('nodeLabel').value;
                app.state.selectedNode.resId = document.getElementById('nodeResSelect').value || null;
                app.storage.forceSave(); document.getElementById('nodeMenu').style.display = 'none';
            }
        },

        deleteNode: function() {
            const node = app.state.selectedNode;
            if (!node) return;
            let toDel = new Set([node.id]); let changed = true;
            while(changed) {
                changed = false;
                app.state.links.forEach(l => {
                    const s = l.source.id||l.source; const t = l.target.id||l.target;
                    if(toDel.has(s) && !toDel.has(t)) { toDel.add(t); changed = true; }
                });
            }
            app.state.nodes = app.state.nodes.filter(n => !toDel.has(n.id));
            app.state.links = app.state.links.filter(l => !toDel.has(l.source.id||l.source) && !toDel.has(l.target.id||l.target));
            app.graph.updateSimulation(); app.storage.forceSave();
            document.getElementById('nodeMenu').style.display = 'none';
        },

        importProjectFromFile: function(file) { app.storage.importProjectFromFile(file); },
        exportProjectToFile: function() { app.storage.exportProjectToFile(); }
    },

    // --- 模块 4: UI 交互 (UI) ---
    ui: {
        tooltipEl: null,

        init: function() {
            this.tooltipEl = document.createElement('div');
            this.tooltipEl.id = 'mindflow-tooltip';
            Object.assign(this.tooltipEl.style, {
                position: 'fixed', display: 'none', zIndex: '1000',
                background: 'white', border: '1px solid #ccc', borderRadius: '6px',
                padding: '10px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)',
                maxWidth: '300px', maxHeight: '300px', overflow: 'hidden', pointerEvents: 'auto'
            });
            document.body.appendChild(this.tooltipEl);
            this.tooltipEl.addEventListener('mouseenter', () => clearTimeout(app.state.tooltipTimer));
            this.tooltipEl.addEventListener('mouseleave', () => this.hideTooltip());

            document.getElementById('projSelect').addEventListener('change', async (e) => {
                if (e.target.value === '__new__') {
                    const name = prompt('项目名称:');
                    if (name) { const id = await app.storage.createProject(name); await app.storage.loadProject(id); }
                    else this.updateProjectSelect();
                } else await app.storage.loadProject(e.target.value);
            });

            document.getElementById('resFile').addEventListener('change', (e) => {
                const f = e.target.files[0]; if (!f) return;
                const type = document.getElementById('resType').value;
                const reader = new FileReader();
                reader.onload = ev => app.state.tempFileBase64 = ev.target.result;
                reader.readAsDataURL(f);
            });

            document.getElementById('resColorInput').addEventListener('input', (e) => {
                document.getElementById('resColorValue').innerText = e.target.value;
            });

            const impInput = document.getElementById('importInput');
            if (impInput) impInput.addEventListener('change', (e) => {
                if(e.target.files[0]) { app.data.importProjectFromFile(e.target.files[0]); e.target.value=''; }
            });
        },

        dragStart: function(e, id) {
            e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move';
            app.state.draggedResId = id; e.target.classList.add('dragging');
        },

        dragOver: function(e, parentId) {
            e.preventDefault(); e.stopPropagation();
            const target = e.currentTarget;
            if (!target.classList.contains('drag-over')) {
                document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
                target.classList.add('drag-over');
            }
            e.dataTransfer.dropEffect = 'move';
        },

        dragLeave: function(e) { e.currentTarget.classList.remove('drag-over'); },

        drop: function(e, parentId) {
            e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('drag-over');
            const resId = e.dataTransfer.getData('text/plain');
            if (resId) app.data.moveResource(resId, parentId);
            const dragged = document.querySelector('.dragging'); if(dragged) dragged.classList.remove('dragging');
            app.state.draggedResId = null;
        },

        // --- 核心：通用预览显示逻辑 ---
        displayTooltip: function(resId, x, y) {
            clearTimeout(app.state.tooltipTimer);
            const res = app.state.resources.find(r => r.id === resId);
            if (!res) return;

            let content = '';
            if (res.type === 'image') content = `<img src="${res.content}" style="max-width:100%; max-height:200px; display:block; border-radius:4px;">`;
            else if (res.type === 'md') {
                const html = marked.parse(res.content);
                content = `<div class="md-preview" style="background:#f8f9fa; padding:10px; border-radius:4px; max-height:280px; overflow-y:auto;">${html}</div>`;
            }
            else if (res.type === 'code') content = `<pre style="font-family:monospace; background:#282c34; color:#abb2bf; padding:10px; border-radius:4px; font-size:12px; overflow:auto;">${this.escapeHtml(res.content)}</pre>`;
            else if (res.type === 'color') content = `<div style="width:100px; height:60px; background-color:${res.content}; border-radius:4px; border:1px solid #ddd; margin-bottom:5px;"></div><div style="text-align:center; font-family:monospace; font-weight:bold;">${res.content}</div>`;
            else if (res.type === 'audio') content = `<audio controls src="${res.content}" style="width:250px;"></audio>`;
            else if (res.type === 'link') content = `<div style="font-size:12px; color:#555; margin-bottom:8px; word-break:break-all;">${res.content}</div><a href="${res.content}" target="_blank" style="display:block; text-align:center; background:#667eea; color:white; text-decoration:none; padding:6px; border-radius:4px; font-size:12px;">跳转到链接 🔗</a>`;

            this.tooltipEl.innerHTML = content;
            this.tooltipEl.style.display = 'block';

            const pad = 15; let top = y + pad; let left = x + pad;
            const rect = this.tooltipEl.getBoundingClientRect();
            if (left + rect.width > window.innerWidth) left = x - rect.width - pad;
            if (top + rect.height > window.innerHeight) top = y - rect.height - pad;
            this.tooltipEl.style.top = top + 'px'; this.tooltipEl.style.left = left + 'px';
        },

        showTooltip: function(node, x, y) {
            // 画布节点调用
            if (node.resId) this.displayTooltip(node.resId, x, y);
        },

        showSidebarPreview: function(resId, event) {
            // 侧边栏调用，位置稍微右偏，避免遮挡
            this.displayTooltip(resId, event.clientX + 10, event.clientY);
        },

        hideTooltip: function() {
            clearTimeout(app.state.tooltipTimer);
            app.state.tooltipTimer = setTimeout(() => {
                if (this.tooltipEl) this.tooltipEl.style.display = 'none';
            }, app.config.previewDelay);
        },

        escapeHtml: function(text) { if (!text) return ''; return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); },

        triggerImport: function() { document.getElementById('importInput').click(); },
        confirmDeleteProject: function() { if(app.state.currentId && confirm('确定删除？')) app.storage.deleteProject(app.state.currentId); },

        updateProjectSelect: function() {
            const sel = document.getElementById('projSelect');
            let h = `<option value="" disabled ${!app.state.currentId?'selected':''}>-- 选择项目 --</option>`;
            h += `<option value="__new__" style="color:#667eea; font-weight:bold;">+ 新建项目</option>`;
            app.state.projectsIndex.forEach(p => { h += `<option value="${p.id}" ${p.id===app.state.currentId?'selected':''}>📁 ${p.name}</option>`; });
            sel.innerHTML = h;
        },

        renderResourceTree: function() {
            const container = document.getElementById('resList');
            container.ondragover = (e) => app.ui.dragOver(e, null);
            container.ondrop = (e) => app.ui.drop(e, null);
            container.ondragleave = (e) => app.ui.dragLeave(e);

            const resources = app.state.resources;
            if(!resources.length) { container.innerHTML = '<div class="empty-tip">暂无资源<br><small>拖入文件或点击添加</small></div>'; return; }

            const folders = resources.filter(r => r.type === 'folder');
            const rootFiles = resources.filter(r => !r.parentId && r.type !== 'folder');
            let html = '';

            folders.forEach(folder => {
                const isOpen = app.state.expandedFolders.has(folder.id);
                const children = resources.filter(r => r.parentId === folder.id && r.type !== 'folder');

                html += `
                    <div class="res-folder ${isOpen?'open':''}" 
                         onclick="app.ui.toggleFolder('${folder.id}')"
                         ondragover="app.ui.dragOver(event, '${folder.id}')"
                         ondrop="app.ui.drop(event, '${folder.id}')"
                         ondragleave="app.ui.dragLeave(event)">
                        <div class="folder-icon">▶</div>
                        <div class="res-info"><div class="res-name">${folder.name}</div></div>
                        <div class="res-actions">
                            <div class="btn-res-action" onclick="event.stopPropagation(); app.data.renameFolder('${folder.id}')" title="重命名">✎</div>
                            <div class="btn-res-action del" onclick="event.stopPropagation(); app.data.deleteResource('${folder.id}')">🗑</div>
                        </div>
                    </div>
                    <div class="folder-children ${isOpen?'open':''}">
                        ${children.map(child => this.createResItemHtml(child)).join('')}
                    </div>
                `;
            });

            rootFiles.forEach(file => { html += this.createResItemHtml(file); });
            container.innerHTML = html;
        },

        createResItemHtml: function(r) {
            let icon = '🔗';
            if(r.type==='image') icon='🖼️'; else if(r.type==='md') icon='📝'; else if(r.type==='code') icon='💻'; else if(r.type==='color') icon='🎨'; else if(r.type==='audio') icon='🎤';

            // [新增] 绑定 onmouseenter/onmouseleave 实现侧边栏预览
            return `
                <div class="res-item" 
                     draggable="true" 
                     ondragstart="app.ui.dragStart(event, '${r.id}')"
                     onmouseenter="app.ui.showSidebarPreview('${r.id}', event)"
                     onmouseleave="app.ui.hideTooltip()">
                    <div class="res-icon" onclick="app.ui.viewResource('${r.id}')">${icon}</div>
                    <div class="res-info" onclick="app.ui.viewResource('${r.id}')">
                        <div class="res-name">${r.name}</div>
                    </div>
                    <div class="res-actions">
                        <div class="btn-res-action" onclick="app.data.editResource('${r.id}')" title="编辑">✎</div>
                        <div class="btn-res-action del" onclick="app.data.deleteResource('${r.id}')" title="删除">🗑</div>
                    </div>
                </div>
            `;
        },

        toggleFolder: function(id) {
            if (app.state.expandedFolders.has(id)) app.state.expandedFolders.delete(id);
            else app.state.expandedFolders.add(id);
            this.renderResourceTree();
        },

        viewResource: function(id) {
            const res = app.state.resources.find(r => r.id === id); if(!res) return;
            const n = app.state.nodes.find(n => n.resId === id);
            if(n) {
                app.state.camera.x = app.graph.width/2 - n.x * app.state.camera.k;
                app.state.camera.y = app.graph.height/2 - n.y * app.state.camera.k;
                this.toast('已定位');
            } else {
                if(res.type==='link') window.open(res.content);
                else if(res.type==='image') { const w=window.open(""); w.document.write(`<img src="${res.content}" style="max-width:100%">`); }
                else if(res.type==='md' || res.type==='code') alert(res.content.substring(0,200)+'...');
                else if(res.type==='audio') { const a = new Audio(res.content); a.play(); this.toast('正在播放音频'); }
                else if(res.type==='color') { navigator.clipboard.writeText(res.content); this.toast('色值已复制: '+res.content); }
            }
        },

        openResModal: function(mode, res) {
            if(!app.state.currentId) return this.toast('请先建项目');
            const title = document.getElementById('resModalTitle');
            const typeSel = document.getElementById('resType');
            const parentSel = document.getElementById('resParentId');
            const nameInput = document.getElementById('resName');

            const folders = app.state.resources.filter(r => r.type === 'folder');
            parentSel.innerHTML = '<option value="">(根目录)</option>' +
                folders.map(f => `<option value="${f.id}">📁 ${f.name}</option>`).join('');

            app.state.tempFileBase64 = null;
            document.getElementById('resFile').value = ''; document.getElementById('resTextInput').value = '';
            document.getElementById('resTextArea').value = ''; document.getElementById('resColorInput').value = '#000000';
            document.getElementById('resColorValue').innerText = '#000000';

            if (mode === 'Edit' && res) {
                title.innerText = '编辑资源';
                typeSel.value = res.type; typeSel.disabled = true;
                nameInput.value = res.name;
                parentSel.value = res.parentId || '';

                if (res.type === 'link') document.getElementById('resTextInput').value = res.content;
                else if (res.type === 'md' || res.type === 'code') document.getElementById('resTextArea').value = res.content;
                else if (res.type === 'color') { document.getElementById('resColorInput').value = res.content; document.getElementById('resColorValue').innerText = res.content; }
            } else {
                title.innerText = '添加资源';
                typeSel.disabled = false; app.state.editingResId = null;
                nameInput.value = ''; typeSel.value = 'image'; parentSel.value = '';
            }

            this.toggleResInput();
            document.getElementById('resModal').style.display='flex';
        },

        openModal: function() { this.openResModal('New'); },
        closeModal: function(id) { document.getElementById(id).style.display='none'; },

        openNodeMenu: function(node, x, y) {
            const m = document.getElementById('nodeMenu'); app.state.selectedNode = node;
            document.getElementById('nodeLabel').value = node.label;
            const sel = document.getElementById('nodeResSelect');
            sel.innerHTML = '<option value="">(无)</option>' + app.state.resources.filter(r=>r.type!=='folder').map(r =>
                `<option value="${r.id}" ${r.id===node.resId?'selected':''}>${r.name}</option>`
            ).join('');
            m.style.display = 'block'; m.style.left = Math.min(x,window.innerWidth-260)+'px'; m.style.top = Math.min(y,window.innerHeight-200)+'px';
        },

        toggleSidebar: function() { document.getElementById('sidebar').classList.toggle('closed'); },

        toggleResInput: function() {
            const type = document.getElementById('resType').value;
            const gFile = document.getElementById('groupFile'); const gText = document.getElementById('groupText'); const gColor = document.getElementById('groupColor');
            gFile.style.display = 'none'; gText.style.display = 'none'; gColor.style.display = 'none';
            const fileInput = document.getElementById('resFile');
            const textInput = document.getElementById('resTextInput'); const textArea = document.getElementById('resTextArea');

            if (type === 'image' || type === 'audio') {
                gFile.style.display = 'block'; document.getElementById('fileLabel').innerText = type === 'image' ? '上传图片' : '上传音频';
                fileInput.accept = type === 'image' ? 'image/*' : 'audio/*';
            } else if (type === 'color') { gColor.style.display = 'block'; }
            else {
                gText.style.display = 'block'; document.getElementById('textLabel').innerText = type === 'link' ? '链接地址' : (type === 'code' ? '代码内容' : '文档内容');
                if (type === 'link') { textInput.style.display = 'block'; textArea.style.display = 'none'; }
                else { textInput.style.display = 'none'; textArea.style.display = 'block'; textArea.placeholder = type === 'code' ? '粘贴代码...' : '输入 Markdown...'; }
            }
        },

        toast: function(m) { const t=document.getElementById('toast'); t.innerText=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),3000); }
    },

    init: async function() { await this.storage.init(); this.ui.init(); this.graph.init(); console.log("MindFlow Ready."); }
};

window.onload = () => app.init();