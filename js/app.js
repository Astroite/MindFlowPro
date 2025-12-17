/**
 * MindFlow - App Logic
 * 更新内容：移除视频支持，增加图片/MD/链接的悬浮预览功能 (Tooltip)
 */

const app = {
    // --- 配置 ---
    config: {
        appVersion: '1.1.0',
        nodeRadius: 40,
        subRadius: 30,
        linkDistance: 150,
        chargeStrength: -800,
        collideRadius: 55,
        dbName: 'MindFlowDB',
        storeName: 'projects',
        // 预览框配置
        previewDelay: 200 // 消失延迟，防止鼠标移动到Tooltip过程中消失
    },

    // --- 全局状态 ---
    state: {
        currentId: null,
        projectsIndex: [],
        nodes: [],
        links: [],
        resources: [],
        camera: { x: 0, y: 0, k: 1 },
        simulation: null,
        selectedNode: null,
        tempFileBase64: null, // 临时存储文件内容 (图片或MD文本)
        hoverNode: null,      // 当前悬浮的节点
        tooltipTimer: null    // Tooltip 消失定时器
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

        saveIndex: async function() {
            await localforage.setItem('__project_index__', app.state.projectsIndex);
        },

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
                if (idx !== -1) {
                    app.state.projectsIndex[idx].name = newName;
                    await this.saveIndex();
                }
                const proj = await localforage.getItem(id);
                if (proj) {
                    proj.name = newName;
                    await localforage.setItem(id, proj);
                }
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
                    app.ui.renderResourceList();
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
                app.state.resources = JSON.parse(JSON.stringify(proj.resources || []));

                document.getElementById('projTitleInput').value = proj.name;

                app.graph.resetCamera();
                app.graph.imageCache.clear();
                app.ui.renderResourceList();
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
                nodes: app.state.nodes.map(n => ({
                    id: n.id, type: n.type, x: n.x, y: n.y, label: n.label, resId: n.resId
                })),
                links: app.state.links.map(l => ({
                    source: l.source.id || l.source, target: l.target.id || l.target
                })),
                resources: app.state.resources
            };

            try {
                await localforage.setItem(app.state.currentId, projData);
                app.ui.toast('保存成功');
                document.getElementById('saveStatus').innerText = '已保存 ' + new Date().toLocaleTimeString();
            } catch (e) {
                console.error(e);
                app.ui.toast('保存失败 (可能文件过大)');
            }
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
            const a = document.createElement('a');
            a.href = url;
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

        resetCamera: function() {
            app.state.camera = { x: this.width / 2, y: this.height / 2, k: 1 };
        },

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
                x: parent.x + Math.cos(angle) * 10, y: parent.y + Math.sin(angle) * 10,
                label: '新节点'
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

            // 连线
            ctx.beginPath(); ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2;
            app.state.links.forEach(l => {
                const s = l.source, t = l.target;
                if (s.x && t.x) { ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y); }
            });
            ctx.stroke();

            // 节点
            app.state.nodes.forEach(n => {
                const r = n.type === 'root' ? app.config.nodeRadius : app.config.subRadius;
                ctx.shadowColor = 'rgba(0,0,0,0.1)'; ctx.shadowBlur = 10;
                ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
                ctx.fillStyle = 'white'; ctx.fill(); ctx.shadowBlur = 0;

                let hasImg = false;
                if (n.resId) {
                    const res = app.state.resources.find(r => r.id === n.resId);
                    if (res) {
                        if (res.type === 'image') {
                            this.drawImageInNode(n, res, r);
                            hasImg = true;
                        } else {
                            // MD 或 Link 显示图标
                            const icon = res.type === 'md' ? '📝' : '🔗';
                            ctx.font = '20px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                            ctx.fillText(icon, n.x, n.y - 5);
                        }
                    }
                }

                // 边框
                ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
                ctx.lineWidth = 3;
                ctx.strokeStyle = (app.state.selectedNode === n) ? '#e74c3c' : (n.type === 'root' ? '#2c3e50' : '#667eea');
                ctx.stroke();

                // 文字
                ctx.fillStyle = '#334155'; ctx.font = 'bold 12px Arial';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                const textY = hasImg ? n.y + r + 15 : (n.resId && !hasImg ? n.y + 15 : n.y); // 有图标时文字下移
                ctx.fillText(n.label, n.x, textY);

                // 加号
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

            const handleStart = (e) => {
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
                // 1. 处理悬浮预览逻辑 (仅鼠标)
                if (!e.touches) {
                    const m = getPos(e);
                    let hoverNode = null;
                    for (let i = app.state.nodes.length - 1; i >= 0; i--) {
                        const n = app.state.nodes[i];
                        const r = n.type === 'root' ? app.config.nodeRadius : app.config.subRadius;
                        if (Math.hypot(m.x - n.x, m.y - n.y) < r) { hoverNode = n; break; }
                    }
                    if (hoverNode && hoverNode.resId) {
                        app.ui.showTooltip(hoverNode, e.clientX, e.clientY);
                    } else {
                        app.ui.hideTooltip();
                    }
                }

                // 2. 处理拖拽/平移
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

        addResource: function() {
            const type = document.getElementById('resType').value;
            const name = document.getElementById('resName').value;
            if (!name) return app.ui.toast('请输入名称');

            const res = { id: 'res_' + Date.now(), type: type, name: name, content: null };

            if (type === 'image') {
                if (!app.state.tempFileBase64) return app.ui.toast('请选择图片');
                res.content = app.state.tempFileBase64;
            } else if (type === 'md') {
                if (!app.state.tempFileBase64) return app.ui.toast('请上传MD文件');
                res.content = app.state.tempFileBase64; // 这里存储的是文本内容
            } else {
                res.content = document.getElementById('resContent').value || '#';
            }

            app.state.resources.push(res);
            app.ui.renderResourceList();
            app.ui.closeModal('resModal');
            app.storage.forceSave();

            app.state.tempFileBase64 = null;
            document.getElementById('resFile').value = '';
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
            // 创建 Tooltip DOM
            this.tooltipEl = document.createElement('div');
            this.tooltipEl.id = 'mindflow-tooltip';
            Object.assign(this.tooltipEl.style, {
                position: 'fixed', display: 'none', zIndex: '1000',
                background: 'white', border: '1px solid #ccc', borderRadius: '6px',
                padding: '10px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)',
                maxWidth: '300px', maxHeight: '300px', overflow: 'hidden',
                pointerEvents: 'auto' // 允许点击内部按钮
            });
            document.body.appendChild(this.tooltipEl);

            // 保持 Tooltip 显示的逻辑: 鼠标移入 Tooltip 时清除隐藏定时器
            this.tooltipEl.addEventListener('mouseenter', () => clearTimeout(app.state.tooltipTimer));
            this.tooltipEl.addEventListener('mouseleave', () => this.hideTooltip());

            // 事件绑定
            document.getElementById('projSelect').addEventListener('change', async (e) => {
                if (e.target.value === '__new__') {
                    const name = prompt('项目名称:');
                    if (name) { const id = await app.storage.createProject(name); await app.storage.loadProject(id); }
                    else this.updateProjectSelect();
                } else await app.storage.loadProject(e.target.value);
            });

            // 统一文件输入监听 (支持图片预览和文本读取)
            document.getElementById('resFile').addEventListener('change', (e) => {
                const f = e.target.files[0];
                if (!f) return;
                const type = document.getElementById('resType').value;
                const reader = new FileReader();
                reader.onload = ev => app.state.tempFileBase64 = ev.target.result;
                if (type === 'md') reader.readAsText(f); // MD 读取为文本
                else reader.readAsDataURL(f); // 图片读取为 Base64
            });

            const impInput = document.getElementById('importInput');
            if (impInput) impInput.addEventListener('change', (e) => {
                if(e.target.files[0]) { app.data.importProjectFromFile(e.target.files[0]); e.target.value=''; }
            });
        },

        // --- 悬浮预览核心逻辑 ---
        showTooltip: function(node, x, y) {
            clearTimeout(app.state.tooltipTimer);
            const res = app.state.resources.find(r => r.id === node.resId);
            if (!res) return;

            let content = '';
            if (res.type === 'image') {
                content = `<img src="${res.content}" style="max-width:100%; max-height:200px; display:block; border-radius:4px;">`;
            } else if (res.type === 'md') {
                // 简单的文本截断显示
                const text = res.content.length > 150 ? res.content.substring(0, 150) + '...' : res.content;
                // 转义 HTML 标签防止注入 (简单处理)
                const safeText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
                content = `<div style="white-space:pre-wrap; font-size:12px; line-height:1.4; color:#333; background:#f8f9fa; padding:8px; border-radius:4px;">${safeText}</div>`;
            } else if (res.type === 'link') {
                content = `
                    <div style="font-size:12px; color:#555; margin-bottom:8px; word-break:break-all;">${res.content}</div>
                    <a href="${res.content}" target="_blank" style="display:block; text-align:center; background:#667eea; color:white; text-decoration:none; padding:6px; border-radius:4px; font-size:12px;">跳转到链接 🔗</a>
                `;
            }

            this.tooltipEl.innerHTML = content;
            this.tooltipEl.style.display = 'block';

            // 智能定位：优先显示在右下方，防止溢出屏幕
            const pad = 15;
            let top = y + pad;
            let left = x + pad;
            const rect = this.tooltipEl.getBoundingClientRect();

            if (left + rect.width > window.innerWidth) left = x - rect.width - pad;
            if (top + rect.height > window.innerHeight) top = y - rect.height - pad;

            this.tooltipEl.style.top = top + 'px';
            this.tooltipEl.style.left = left + 'px';
        },

        hideTooltip: function() {
            clearTimeout(app.state.tooltipTimer);
            app.state.tooltipTimer = setTimeout(() => {
                if (this.tooltipEl) this.tooltipEl.style.display = 'none';
            }, app.config.previewDelay);
        },
        // -----------------------

        triggerImport: function() { document.getElementById('importInput').click(); },
        confirmDeleteProject: function() { if(app.state.currentId && confirm('确定删除？')) app.storage.deleteProject(app.state.currentId); },

        updateProjectSelect: function() {
            const sel = document.getElementById('projSelect');
            let h = `<option value="" disabled ${!app.state.currentId?'selected':''}>-- 选择项目 --</option>`;
            h += `<option value="__new__" style="color:#667eea; font-weight:bold;">+ 新建项目</option>`;
            app.state.projectsIndex.forEach(p => {
                h += `<option value="${p.id}" ${p.id===app.state.currentId?'selected':''}>📁 ${p.name}</option>`;
            });
            sel.innerHTML = h;
        },

        renderResourceList: function() {
            const c = document.getElementById('resList'); const list = app.state.resources;
            if(!list.length) { c.innerHTML = '<div class="empty-tip">暂无资源</div>'; return; }
            c.innerHTML = list.map(r => {
                const icon = r.type==='image'?'🖼️':r.type==='md'?'📝':'🔗';
                return `<div class="res-item" onclick="app.ui.viewResource('${r.id}')"><div class="res-icon">${icon}</div><div class="res-info"><div class="res-name">${r.name}</div></div></div>`;
            }).join('');
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
                else alert(res.content.substring(0,200)+'...');
            }
        },

        openModal: function(id) { if(!app.state.currentId) return this.toast('请先建项目'); document.getElementById(id).style.display='flex'; },
        closeModal: function(id) { document.getElementById(id).style.display='none'; },

        openNodeMenu: function(node, x, y) {
            const m = document.getElementById('nodeMenu'); app.state.selectedNode = node;
            document.getElementById('nodeLabel').value = node.label;
            const sel = document.getElementById('nodeResSelect');
            sel.innerHTML = '<option value="">(无)</option>' + app.state.resources.map(r =>
                `<option value="${r.id}" ${r.id===node.resId?'selected':''}>${r.name}</option>`
            ).join('');
            m.style.display = 'block'; m.style.left = Math.min(x,window.innerWidth-260)+'px'; m.style.top = Math.min(y,window.innerHeight-200)+'px';
        },

        toggleSidebar: function() { document.getElementById('sidebar').classList.toggle('closed'); },

        toggleResInput: function() {
            const type = document.getElementById('resType').value;
            const f = document.getElementById('groupFile'); const l = document.getElementById('groupLink');
            if (type === 'image') { f.style.display='block'; l.style.display='none'; document.getElementById('resFile').accept='image/*'; }
            else if (type === 'md') { f.style.display='block'; l.style.display='none'; document.getElementById('resFile').accept='.md,.txt'; }
            else { f.style.display='none'; l.style.display='block'; }
        },

        toast: function(m) { const t=document.getElementById('toast'); t.innerText=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),3000); }
    },

    init: async function() { await this.storage.init(); this.ui.init(); this.graph.init(); console.log("MindFlow Ready."); }
};

window.onload = () => app.init();