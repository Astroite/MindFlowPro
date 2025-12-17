/**
 * MindFlow - App Logic
 * 更新内容：项目删除功能、ResizeObserver 自适应画布、移动端交互优化
 */

const app = {
    // --- 配置 ---
    config: {
        nodeRadius: 40,
        subRadius: 30,
        linkDistance: 150,
        chargeStrength: -800,
        collideRadius: 55,
        dbName: 'MindFlowDB',
        storeName: 'projects'
    },

    // --- 全局状态 ---
    state: {
        currentId: null,
        projectsIndex: [],
        nodes: [],
        links: [],
        resources: [],
        camera: { x: 0, y: 0, k: 1 },
        isSimulating: false,
        selectedNode: null,
        tempFileBase64: null,
        simulation: null
    },

    // --- 模块 1: 存储 (Storage) ---
    storage: {
        init: async function() {
            localforage.config({
                name: app.config.dbName,
                storeName: app.config.storeName
            });
            await this.loadIndex();
        },

        loadIndex: async function() {
            try {
                const index = await localforage.getItem('__project_index__') || [];
                app.state.projectsIndex = index;
                app.ui.updateProjectSelect();
            } catch (e) {
                console.error('索引加载失败', e);
            }
        },

        saveIndex: async function() {
            await localforage.setItem('__project_index__', app.state.projectsIndex);
        },

        createProject: async function(name) {
            const id = 'proj_' + Date.now();
            const newProj = {
                id: id,
                name: name,
                created: Date.now(),
                nodes: [],
                links: [],
                resources: []
            };

            await localforage.setItem(id, newProj);
            app.state.projectsIndex.push({ id: id, name: name });
            await this.saveIndex();
            return id;
        },

        // [新增] 删除项目
        deleteProject: async function(id) {
            if (!id) return;
            try {
                // 1. 从 IndexedDB 删除项目数据
                await localforage.removeItem(id);

                // 2. 更新索引
                app.state.projectsIndex = app.state.projectsIndex.filter(p => p.id !== id);
                await this.saveIndex();

                app.ui.toast('项目已删除');

                // 3. UI 状态处理
                if (app.state.currentId === id) {
                    app.state.currentId = null;
                    app.state.nodes = [];
                    app.state.links = [];
                    app.state.resources = [];
                    app.graph.updateSimulation();
                    app.ui.renderResourceList();
                    document.getElementById('saveStatus').innerText = '已就绪';
                }

                // 4. 刷新下拉框
                app.ui.updateProjectSelect();

            } catch (e) {
                console.error(e);
                app.ui.toast('删除失败: ' + e.message);
            }
        },

        loadProject: async function(id) {
            try {
                const proj = await localforage.getItem(id);
                if (!proj) throw new Error('项目不存在或已被删除');

                app.state.currentId = id;
                app.state.nodes = JSON.parse(JSON.stringify(proj.nodes || []));
                app.state.links = JSON.parse(JSON.stringify(proj.links || []));
                app.state.resources = JSON.parse(JSON.stringify(proj.resources || []));

                app.graph.resetCamera();
                app.graph.imageCache.clear();
                app.ui.renderResourceList();
                app.ui.toast(`已加载: ${proj.name}`);
                app.graph.updateSimulation();

                document.getElementById('saveStatus').innerText = '已加载';

            } catch (e) {
                app.ui.toast('加载失败: ' + e.message);
                // 如果加载失败（可能索引还在但数据没了），尝试清理索引
                if (e.message.includes('不存在')) {
                    // 可选：自动清理无效索引
                }
            }
        },

        forceSave: async function() {
            if (!app.state.currentId) return app.ui.toast('请先创建或选择项目');

            document.getElementById('saveStatus').innerText = '保存中...';

            const currentProjName = app.state.projectsIndex.find(p => p.id === app.state.currentId)?.name || '未命名项目';

            const projData = {
                id: app.state.currentId,
                name: currentProjName,
                updated: Date.now(),
                nodes: app.state.nodes.map(n => ({
                    id: n.id, type: n.type, x: n.x, y: n.y, label: n.label, resId: n.resId
                })),
                links: app.state.links.map(l => ({
                    source: l.source.id || l.source,
                    target: l.target.id || l.target
                })),
                resources: app.state.resources
            };

            try {
                await localforage.setItem(app.state.currentId, projData);
                app.ui.toast('保存成功');
                document.getElementById('saveStatus').innerText = '已保存 ' + new Date().toLocaleTimeString();
            } catch (e) {
                console.error(e);
                app.ui.toast('保存失败 (可能图片过大)');
            }
        }
    },

    // --- 模块 2: 图形与物理引擎 (Graph) ---
    graph: {
        canvas: null,
        ctx: null,
        width: 0,
        height: 0,
        imageCache: new Map(),
        dragSubject: null,
        isPanning: false,
        startPan: {x:0, y:0},

        init: function() {
            this.canvas = document.getElementById('mainCanvas');
            this.ctx = this.canvas.getContext('2d');

            // [优化] 使用 ResizeObserver 监听容器大小变化
            // 这能完美解决侧边栏收起/展开导致画布拉伸的问题
            const resizeObserver = new ResizeObserver(() => {
                this.resize();
            });
            resizeObserver.observe(document.getElementById('canvasWrapper'));

            app.state.simulation = d3.forceSimulation()
                .force("link", d3.forceLink().id(d => d.id).distance(app.config.linkDistance))
                .force("charge", d3.forceManyBody().strength(app.config.chargeStrength))
                .force("collide", d3.forceCollide().radius(app.config.collideRadius))
                .force("center", d3.forceCenter(0, 0).strength(0.02))
                .on("tick", () => { /* Render logic is in renderLoop */ });

            this.bindEvents();
            requestAnimationFrame(() => this.renderLoop());
        },

        resize: function() {
            const wrapper = document.getElementById('canvasWrapper');
            // 获取容器的真实像素尺寸
            this.width = wrapper.clientWidth;
            this.height = wrapper.clientHeight;

            // 调整 Canvas 分辨率以匹配显示尺寸（防止模糊或拉伸）
            this.canvas.width = this.width;
            this.canvas.height = this.height;

            // 如果是首次初始化，居中相机
            if (!app.state.currentId && app.state.nodes.length === 0) {
                this.resetCamera();
            }
            // 触发一次渲染
            app.state.simulation.alpha(0.1).restart();
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

            const node = { id: 'n_' + Date.now(), type: 'root', x: 0, y: 0, label: '中心主题' };
            app.state.nodes.push(node);
            this.updateSimulation();
            app.storage.forceSave();
        },

        addChildNode: function(parent) {
            const angle = Math.random() * Math.PI * 2;
            const node = {
                id: 'n_' + Date.now(),
                type: 'sub',
                x: parent.x + Math.cos(angle) * 10,
                y: parent.y + Math.sin(angle) * 10,
                label: '新节点'
            };
            app.state.nodes.push(node);
            app.state.links.push({ source: parent.id, target: node.id });
            this.updateSimulation();
            app.storage.forceSave();
        },

        clearAll: function() {
            if(confirm('确定清空画布吗？')) {
                app.state.nodes = [];
                app.state.links = [];
                this.updateSimulation();
                app.storage.forceSave();
            }
        },

        renderLoop: function() {
            const ctx = this.ctx;
            const cam = app.state.camera;

            ctx.clearRect(0, 0, this.width, this.height);
            ctx.save();
            ctx.translate(cam.x, cam.y);
            ctx.scale(cam.k, cam.k);

            // Draw Links
            ctx.beginPath();
            ctx.strokeStyle = '#cbd5e1';
            ctx.lineWidth = 2;
            app.state.links.forEach(l => {
                const s = l.source, t = l.target;
                if (s.x && t.x) {
                    ctx.moveTo(s.x, s.y);
                    ctx.lineTo(t.x, t.y);
                }
            });
            ctx.stroke();

            // Draw Nodes
            app.state.nodes.forEach(n => {
                const r = n.type === 'root' ? app.config.nodeRadius : app.config.subRadius;

                // Shadow
                ctx.shadowColor = 'rgba(0,0,0,0.1)';
                ctx.shadowBlur = 10;

                // Background
                ctx.beginPath();
                ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
                ctx.fillStyle = 'white';
                ctx.fill();
                ctx.shadowBlur = 0;

                // Image/Icon
                let hasImg = false;
                if (n.resId) {
                    const res = app.state.resources.find(r => r.id === n.resId);
                    if (res && res.type === 'image') {
                        this.drawImageInNode(n, res, r);
                        hasImg = true;
                    } else if (res) {
                        ctx.font = '24px Arial';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(res.type==='video'?'🎬':'🔗', n.x, n.y);
                    }
                }

                // Border
                ctx.beginPath();
                ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
                ctx.lineWidth = 3;
                ctx.strokeStyle = (app.state.selectedNode === n) ? '#e74c3c' : (n.type === 'root' ? '#2c3e50' : '#667eea');
                ctx.stroke();

                // Label
                ctx.fillStyle = '#334155';
                ctx.font = 'bold 12px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const textY = hasImg ? n.y + r + 15 : (n.resId && !hasImg ? n.y + r + 15 : n.y);
                if (!hasImg && !n.resId) {
                    ctx.fillText(n.label, n.x, n.y);
                } else {
                    ctx.fillText(n.label, n.x, textY);
                }

                // Add Button (Green Dot)
                const btnX = n.x + r * 0.707;
                const btnY = n.y + r * 0.707;
                ctx.beginPath();
                ctx.arc(btnX, btnY, 9, 0, Math.PI * 2);
                ctx.fillStyle = '#22c55e';
                ctx.fill();
                ctx.fillStyle = 'white';
                ctx.font = 'bold 14px Arial';
                ctx.fillText('+', btnX, btnY + 1);
            });

            ctx.restore();
            requestAnimationFrame(() => this.renderLoop());
        },

        drawImageInNode: function(node, res, r) {
            const ctx = this.ctx;
            if (!this.imageCache.has(res.id)) {
                const img = new Image();
                img.src = res.content;
                img.onload = () => this.imageCache.set(res.id, img);
                this.imageCache.set(res.id, 'loading');
            }

            const img = this.imageCache.get(res.id);
            if (img && img !== 'loading') {
                ctx.save();
                ctx.beginPath();
                ctx.arc(node.x, node.y, r - 2, 0, Math.PI * 2);
                ctx.clip();
                const scale = Math.max((r*2)/img.width, (r*2)/img.height);
                const w = img.width * scale;
                const h = img.height * scale;
                ctx.drawImage(img, node.x - w/2, node.y - h/2, w, h);
                ctx.restore();
            }
        },

        bindEvents: function() {
            const canvas = this.canvas;

            // 支持触摸和鼠标的坐标获取
            const getPos = (e) => {
                const rect = canvas.getBoundingClientRect();
                const k = app.state.camera.k;
                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                return {
                    x: (clientX - rect.left - app.state.camera.x) / k,
                    y: (clientY - rect.top - app.state.camera.y) / k
                };
            };

            // 统一处理 Start 事件 (MouseDown / TouchStart)
            const handleStart = (e) => {
                if (e.target !== canvas) return;
                // e.preventDefault(); // 注意：可能需要阻止默认行为以防止滚动

                const m = getPos(e);
                let hitNode = null;

                for (let i = app.state.nodes.length - 1; i >= 0; i--) {
                    const n = app.state.nodes[i];
                    const r = n.type === 'root' ? app.config.nodeRadius : app.config.subRadius;

                    const btnX = n.x + r * 0.707;
                    const btnY = n.y + r * 0.707;
                    if (Math.hypot(m.x - btnX, m.y - btnY) < 15) {
                        this.addChildNode(n);
                        return;
                    }

                    if (Math.hypot(m.x - n.x, m.y - n.y) < r) {
                        hitNode = n;
                        break;
                    }
                }

                if (hitNode) {
                    this.dragSubject = hitNode;
                    hitNode.fx = hitNode.x;
                    hitNode.fy = hitNode.y;
                    app.state.simulation.alphaTarget(0.3).restart();
                    app.state.selectedNode = hitNode;
                } else {
                    this.isPanning = true;
                    // 兼容触摸和鼠标
                    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                    this.startPan = { x: clientX, y: clientY };
                    app.state.selectedNode = null;
                }
            };

            const handleMove = (e) => {
                if (!this.dragSubject && !this.isPanning) return;
                e.preventDefault();

                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;

                if (this.dragSubject) {
                    const m = getPos(e);
                    this.dragSubject.fx = m.x;
                    this.dragSubject.fy = m.y;
                } else if (this.isPanning) {
                    app.state.camera.x += clientX - this.startPan.x;
                    app.state.camera.y += clientY - this.startPan.y;
                    this.startPan = { x: clientX, y: clientY };
                }
            };

            const handleEnd = () => {
                if (this.dragSubject) {
                    this.dragSubject.fx = null;
                    this.dragSubject.fy = null;
                    app.state.simulation.alphaTarget(0);
                    this.dragSubject = null;
                }
                this.isPanning = false;
            };

            // 鼠标事件
            canvas.addEventListener('mousedown', handleStart);
            canvas.addEventListener('mousemove', handleMove);
            window.addEventListener('mouseup', handleEnd);

            // 触摸事件 (移动端支持)
            canvas.addEventListener('touchstart', handleStart, {passive: false});
            canvas.addEventListener('touchmove', handleMove, {passive: false});
            window.addEventListener('touchend', handleEnd);

            // 滚轮缩放
            canvas.addEventListener('wheel', (e) => {
                e.preventDefault();
                const factor = e.deltaY < 0 ? 1.1 : 0.9;
                app.state.camera.k = Math.max(0.1, Math.min(5, app.state.camera.k * factor));
            });

            // 双击
            canvas.addEventListener('dblclick', (e) => {
                const m = getPos(e);
                const hitNode = app.state.nodes.find(n => {
                    const r = n.type === 'root' ? app.config.nodeRadius : app.config.subRadius;
                    return Math.hypot(m.x - n.x, m.y - n.y) < r;
                });
                if (hitNode) {
                    app.ui.openNodeMenu(hitNode, e.clientX, e.clientY);
                }
            });
        }
    },

    // --- 模块 3: 数据处理 (Data) ---
    data: {
        addResource: function() {
            const type = document.getElementById('resType').value;
            const name = document.getElementById('resName').value;

            if (!name) return app.ui.toast('请输入资源名称');

            const res = {
                id: 'res_' + Date.now(),
                type: type,
                name: name,
                content: null
            };

            if (type === 'image') {
                if (!app.state.tempFileBase64) return app.ui.toast('请选择图片');
                res.content = app.state.tempFileBase64;
            } else {
                res.content = document.getElementById('resContent').value || '无内容';
            }

            app.state.resources.push(res);
            app.ui.renderResourceList();
            app.ui.closeModal('resModal');
            app.storage.forceSave();

            app.state.tempFileBase64 = null;
            document.getElementById('resFile').value = '';
        },

        saveNodeEdit: function() {
            const node = app.state.selectedNode;
            if (node) {
                node.label = document.getElementById('nodeLabel').value;
                node.resId = document.getElementById('nodeResSelect').value || null;
                app.storage.forceSave();
                document.getElementById('nodeMenu').style.display = 'none';
            }
        },

        deleteNode: function() {
            const node = app.state.selectedNode;
            if (!node) return;

            let toDel = new Set([node.id]);
            let changed = true;
            while(changed) {
                changed = false;
                app.state.links.forEach(l => {
                    const sid = l.source.id || l.source;
                    const tid = l.target.id || l.target;
                    if (toDel.has(sid) && !toDel.has(tid)) {
                        toDel.add(tid);
                        changed = true;
                    }
                });
            }

            app.state.nodes = app.state.nodes.filter(n => !toDel.has(n.id));
            app.state.links = app.state.links.filter(l =>
                !toDel.has(l.source.id||l.source) && !toDel.has(l.target.id||l.target)
            );

            app.graph.updateSimulation();
            app.storage.forceSave();
            document.getElementById('nodeMenu').style.display = 'none';
        }
    },

    // --- 模块 4: UI 交互 (UI) ---
    ui: {
        init: function() {
            document.getElementById('projSelect').addEventListener('change', async (e) => {
                const val = e.target.value;
                if (val === '__new__') {
                    const name = prompt('请输入新项目名称:');
                    if (name) {
                        const newId = await app.storage.createProject(name);
                        await app.storage.loadProject(newId);
                    } else {
                        this.updateProjectSelect();
                    }
                } else {
                    await app.storage.loadProject(val);
                }
            });

            document.getElementById('resFile').addEventListener('change', (e) => {
                const f = e.target.files[0];
                if (f) {
                    const reader = new FileReader();
                    reader.onload = ev => app.state.tempFileBase64 = ev.target.result;
                    reader.readAsDataURL(f);
                }
            });
        },

        // [新增] 确认并删除项目
        confirmDeleteProject: function() {
            if (!app.state.currentId) return;
            if (confirm('确定要永久删除当前项目吗？此操作无法撤销。')) {
                app.storage.deleteProject(app.state.currentId);
            }
        },

        updateProjectSelect: function() {
            const sel = document.getElementById('projSelect');
            let html = `<option value="" disabled ${!app.state.currentId?'selected':''}>-- 选择项目 --</option>`;
            html += `<option value="__new__" style="color:#667eea; font-weight:bold;">+ 新建项目</option>`;

            app.state.projectsIndex.forEach(p => {
                const selected = p.id === app.state.currentId ? 'selected' : '';
                html += `<option value="${p.id}" ${selected}>📁 ${p.name}</option>`;
            });
            sel.innerHTML = html;
        },

        renderResourceList: function() {
            const container = document.getElementById('resList');
            const list = app.state.resources;

            if (list.length === 0) {
                container.innerHTML = '<div class="empty-tip">暂无资源</div>';
                return;
            }

            container.innerHTML = list.map(r => {
                const icon = r.type==='image'?'🖼️':r.type==='video'?'🎬':'🔗';
                return `
                    <div class="res-item" onclick="app.ui.viewResource('${r.id}')">
                        <div class="res-icon">${icon}</div>
                        <div class="res-info">
                            <div class="res-name">${r.name}</div>
                        </div>
                    </div>
                `;
            }).join('');
        },

        viewResource: function(id) {
            const res = app.state.resources.find(r => r.id === id);
            if (!res) return;

            const linkedNode = app.state.nodes.find(n => n.resId === id);
            if (linkedNode) {
                app.state.camera.x = app.graph.width/2 - linkedNode.x * app.state.camera.k;
                app.state.camera.y = app.graph.height/2 - linkedNode.y * app.state.camera.k;
                this.toast('已定位到关联节点');
            } else {
                if(res.type === 'image') {
                    const w = window.open("", "_blank");
                    w.document.write(`<img src="${res.content}" style="max-width:100%">`);
                } else if (res.content.startsWith('http')) {
                    window.open(res.content, '_blank');
                } else {
                    alert(res.content);
                }
            }
        },

        openModal: function(id) {
            if (!app.state.currentId) return this.toast('请先创建项目');
            document.getElementById(id).style.display = 'flex';
        },

        closeModal: function(id) {
            document.getElementById(id).style.display = 'none';
        },

        openNodeMenu: function(node, x, y) {
            const menu = document.getElementById('nodeMenu');
            app.state.selectedNode = node;

            document.getElementById('nodeLabel').value = node.label;

            const sel = document.getElementById('nodeResSelect');
            sel.innerHTML = '<option value="">(无)</option>' +
                app.state.resources.map(r =>
                    `<option value="${r.id}" ${r.id===node.resId?'selected':''}>${r.name}</option>`
                ).join('');

            menu.style.display = 'block';
            menu.style.left = Math.min(x, window.innerWidth - 260) + 'px';
            menu.style.top = Math.min(y, window.innerHeight - 200) + 'px';
        },

        toggleSidebar: function() {
            // CSS 会处理动画，app.graph.init 里的 ResizeObserver 会处理画布重绘
            document.getElementById('sidebar').classList.toggle('closed');
        },

        toggleResInput: function() {
            const type = document.getElementById('resType').value;
            document.getElementById('groupFile').style.display = type==='image'?'block':'none';
            document.getElementById('groupLink').style.display = type!=='image'?'block':'none';
        },

        toast: function(msg) {
            const t = document.getElementById('toast');
            t.innerText = msg;
            t.classList.add('show');
            setTimeout(() => t.classList.remove('show'), 3000);
        }
    },

    // --- 启动入口 ---
    init: async function() {
        await this.storage.init();
        this.graph.init();
        this.ui.init();
        console.log("MindFlow Started.");
    }
};

window.onload = () => app.init();