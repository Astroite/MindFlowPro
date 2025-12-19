/**
 * MindFlow - App Logic (Modularized)
 * 版本: 3.0.0
 * 架构：ES Modules
 */

import { config } from './config.js';
import { utils } from './utils.js';

const app = {
    // --- 注入依赖 ---
    config,
    utils,

    // --- DOM 缓存 ---
    dom: {},

    // --- 全局状态 ---
    state: {
        currentId: null,
        projectsIndex: [],
        nodes: [], links: [], resources: [],
        camera: { x: 0, y: 0, k: 1 },
        simulation: null,
        selectedNodes: new Set(),
        bubbleNode: null,
        editingNode: null,
        tempFileBase64: null, hoverNode: null, tooltipTimer: null,
        editingResId: null,
        expandedFolders: new Set(),
        draggedResId: null,
        fileHandle: null,
        searchKeyword: '',

        isDirty: false,
        saveTimer: null
    },

    // --- 模块 1: 存储 (Storage) ---
    storage: {
        init: async function() {
            try {
                localforage.config({ name: app.config.dbName, storeName: app.config.storeName });
                await this.loadIndex();
            } catch (e) {
                console.error('存储初始化失败:', e);
                app.ui.toast('存储系统初始化失败，请检查浏览器设置');
            }
        },

        loadIndex: async function() {
            try {
                const index = await localforage.getItem('__project_index__') || [];
                app.state.projectsIndex = Array.isArray(index) ? index : [];
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
            app.state.fileHandle = null;
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
                    this.unloadProject();
                }
                app.ui.updateProjectSelect();
            } catch (e) { app.ui.toast('删除失败: ' + e.message); }
        },

        unloadProject: function() {
            app.state.currentId = null;
            app.state.nodes = []; app.state.links = []; app.state.resources = [];
            app.state.fileHandle = null;
            app.state.selectedNodes.clear();
            app.graph.updateSimulation();
            app.ui.renderResourceTree();
            app.dom.projTitleInput.value = '';
            app.ui.updateSaveStatus('已就绪');
        },

        loadProject: async function(id) {
            try {
                const proj = await localforage.getItem(id);
                if (!proj) {
                    app.state.projectsIndex = app.state.projectsIndex.filter(p => p.id !== id);
                    await this.saveIndex();
                    app.ui.updateProjectSelect();
                    throw new Error('项目数据丢失');
                }

                app.state.currentId = id;
                app.state.fileHandle = null;
                app.state.nodes = (proj.nodes || []).map(n => ({...n, scale: 1}));
                app.state.links = JSON.parse(JSON.stringify(proj.links || []));
                app.state.resources = (proj.resources || []).map(r => ({ ...r, parentId: r.parentId || null }));

                app.state.selectedNodes.clear();
                app.ui.hideNodeBubble();

                app.dom.projTitleInput.value = proj.name;
                app.graph.resetCamera();
                app.graph.imageCache.clear();
                app.state.searchKeyword = '';
                app.ui.renderResourceTree();
                app.ui.toast(`已加载: ${proj.name}`);
                app.graph.updateSimulation();
                app.ui.updateSaveStatus('已加载');
            } catch (e) { app.ui.toast('加载失败: ' + e.message); }
        },

        triggerSave: function() {
            if (!app.state.currentId) return;
            app.state.isDirty = true;
            app.ui.updateSaveStatus('有未保存修改...');
            this._debouncedSave();
        },

        _debouncedSave: null,

        forceSave: async function() {
            if (!app.state.currentId) return app.ui.toast('请先创建或选择项目');

            app.ui.updateSaveStatus('保存中...');
            const currentProjName = app.dom.projTitleInput.value || '未命名项目';

            const cleanNodes = app.state.nodes.map(n => ({
                id: n.id, type: n.type, x: n.x, y: n.y, label: n.label, resId: n.resId
            }));
            const cleanLinks = app.state.links.map(l => ({
                source: l.source.id || l.source, target: l.target.id || l.target
            }));

            const projData = {
                id: app.state.currentId,
                name: currentProjName,
                updated: Date.now(),
                nodes: cleanNodes,
                links: cleanLinks,
                resources: app.state.resources
            };

            try {
                await localforage.setItem(app.state.currentId, projData);
                app.state.isDirty = false;
                app.ui.updateSaveStatus('已保存 ' + new Date().toLocaleTimeString());
            } catch (e) {
                console.error(e);
                app.ui.toast('保存失败: 空间不足或数据过大');
            }
        },

        importExternalProject: async function(projData) {
            const newId = 'proj_' + Date.now() + '_imp';
            const newName = (projData.name || '未命名') + ' (导入)';
            const newProj = {
                id: newId, name: newName, created: Date.now(),
                nodes: projData.nodes || [], links: projData.links || [], resources: projData.resources || []
            };
            await localforage.setItem(newId, newProj);
            app.state.projectsIndex.push({ id: newId, name: newName });
            await this.saveIndex();
            return newId;
        },

        openFileHandle: async function() {
            try {
                const [handle] = await window.showOpenFilePicker({
                    types: [{ description: 'MindFlow Files', accept: { 'application/json': ['.json', '.mindflow'] } }],
                    multiple: false
                });
                const file = await handle.getFile();
                const text = await file.text();
                const json = JSON.parse(text);

                if (!json.project || !Array.isArray(json.project.nodes)) throw new Error('文件格式无效');

                const newId = await this.importExternalProject(json.project);
                await this.loadProject(newId);
                app.state.fileHandle = handle;
                app.ui.toast('已打开本地文件 (支持直接保存)');
                app.dom.projTitleInput.value = file.name.replace('.json', '').replace('.mindflow', '');
            } catch (err) {
                if (err.name !== 'AbortError') { console.error(err); app.ui.toast('打开文件失败: ' + err.message); }
            }
        },

        saveToHandle: async function() {
            if (!app.state.currentId) return app.ui.toast('无数据可保存');
            const currentProjName = app.dom.projTitleInput.value || '未命名项目';
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

            try {
                if (app.state.fileHandle) {
                    const writable = await app.state.fileHandle.createWritable();
                    await writable.write(blob); await writable.close();
                    app.ui.toast('已保存到磁盘文件');
                } else {
                    if (window.showSaveFilePicker) {
                        const handle = await window.showSaveFilePicker({
                            suggestedName: `${currentProjName}.mindflow.json`,
                            types: [{ description: 'MindFlow Files', accept: { 'application/json': ['.json', '.mindflow'] } }]
                        });
                        const writable = await handle.createWritable();
                        await writable.write(blob); await writable.close();
                        app.state.fileHandle = handle;
                        app.ui.toast('已另存为本地文件');
                    } else {
                        this.fallbackDownload(blob, `${currentProjName}.mindflow.json`);
                    }
                }
            } catch (err) {
                if (err.name !== 'AbortError') { console.error(err); app.ui.toast('保存到磁盘失败'); }
            }
        },

        fallbackDownload: function(blob, filename) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
            app.ui.toast('已导出 (下载模式)');
        },

        importProjectFromFile: function(file) {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const json = JSON.parse(e.target.result);
                    if (!json.project) throw new Error('无效的项目文件');
                    const newId = await this.importExternalProject(json.project);
                    await this.loadProject(newId);
                } catch (err) {
                    app.ui.toast('导入失败: ' + err.message);
                }
            };
            reader.readAsText(file);
        },

        exportProjectToFile: async function() {
            if (!app.state.currentId) return app.ui.toast('请先创建项目');
            await this.forceSave();
            const tempHandle = app.state.fileHandle;
            app.state.fileHandle = null;
            await this.saveToHandle();
            app.state.fileHandle = tempHandle;
        }
    },

    // --- 模块 2: 图形与物理引擎 (Graph) ---
    graph: {
        canvas: null, ctx: null, width: 0, height: 0,
        imageCache: new Map(), dragSubject: null, isPanning: false, startPan: {x:0, y:0},
        pinchStartDist: null, pinchStartScale: 1,

        init: function() {
            this.canvas = app.dom.mainCanvas;
            this.ctx = this.canvas.getContext('2d');
            const resizeObserver = new ResizeObserver(() => this.resize());
            resizeObserver.observe(app.dom.canvasWrapper);

            app.state.simulation = d3.forceSimulation()
                .force("link", d3.forceLink().id(d => d.id).distance(app.config.linkDistance))
                .force("charge", d3.forceManyBody().strength(d => d.type === 'root' ? app.config.chargeStrength * 3 : app.config.chargeStrength))
                .force("collide", d3.forceCollide().radius(d => d.type === 'root' ? app.config.collideRadius * 1.5 : app.config.collideRadius))
                .force("x", d3.forceX(0).strength(0.01))
                .force("y", d3.forceY(0).strength(0.01))
                .on("tick", () => {});

            this.bindEvents();
            requestAnimationFrame(() => this.renderLoop());
        },

        resize: function() {
            const wrapper = app.dom.canvasWrapper;
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

        isNodeVisible: function(node, padding = 100) {
            const cam = app.state.camera;
            const r = (node.type === 'root' ? app.config.nodeRadius : app.config.subRadius) * (node.scale || 1);
            const screenX = node.x * cam.k + cam.x;
            const screenY = node.y * cam.k + cam.y;

            return (screenX + r * cam.k > -padding && screenX - r * cam.k < this.width + padding &&
                screenY + r * cam.k > -padding && screenY - r * cam.k < this.height + padding);
        },

        addRootNode: function() {
            if (!app.state.currentId) return app.ui.toast('请先新建项目');

            const cam = app.state.camera;
            const cx = (this.width / 2 - cam.x) / cam.k;
            const cy = (this.height / 2 - cam.y) / cam.k;

            const node = {
                id: 'n_' + Date.now(),
                type: 'root',
                x: cx + (Math.random() - 0.5) * 50,
                y: cy + (Math.random() - 0.5) * 50,
                label: '新主题',
                scale: 0.1
            };
            app.state.nodes.push(node);

            app.state.selectedNodes.clear();
            app.state.selectedNodes.add(node.id);
            app.ui.showNodeBubble(node);

            this.updateSimulation();
            app.storage.triggerSave();
            app.ui.toast('已添加新主题节点');
        },

        addChildNode: function(parent) {
            const angle = Math.random() * Math.PI * 2;
            const node = {
                id: 'n_' + Date.now(), type: 'sub',
                x: parent.x + Math.cos(angle) * 10, y: parent.y + Math.sin(angle) * 10,
                label: '新节点', scale: 0.05
            };
            app.state.nodes.push(node);
            app.state.links.push({ source: parent.id, target: node.id });

            app.state.selectedNodes.clear();
            app.state.selectedNodes.add(node.id);
            app.ui.showNodeBubble(node);

            this.updateSimulation();
            app.storage.triggerSave();
        },

        clearAll: function() {
            if(confirm('确定清空画布吗？')) {
                app.state.nodes = []; app.state.links = [];
                app.state.selectedNodes.clear();
                app.ui.hideNodeBubble();
                this.updateSimulation();
                app.storage.triggerSave();
            }
        },

        renderLoop: function() {
            const ctx = this.ctx; const cam = app.state.camera;
            ctx.clearRect(0, 0, this.width, this.height);
            ctx.save();
            ctx.translate(cam.x, cam.y);
            ctx.scale(cam.k, cam.k);

            ctx.beginPath();
            ctx.strokeStyle = app.config.colors.link;
            ctx.lineWidth = 1.5;
            app.state.links.forEach(l => {
                const s = l.source, t = l.target;
                if (s.x && t.x) {
                    if (this.isNodeVisible(s, 500) || this.isNodeVisible(t, 500)) {
                        ctx.moveTo(s.x, s.y);
                        ctx.lineTo(t.x, t.y);
                    }
                }
            });
            ctx.stroke();

            app.state.nodes.forEach(n => {
                if (!this.isNodeVisible(n)) return;

                if (typeof n.scale === 'undefined') n.scale = 1;
                if (n.scale < 1) { n.scale += (1 - n.scale) * 0.15; if (n.scale > 0.99) n.scale = 1; }

                const r = (n.type === 'root' ? app.config.nodeRadius : app.config.subRadius) * (n.scale || 1);
                let fillColor = app.config.colors.surface;
                let textColor = app.config.colors.textMain;
                let hasImg = false;

                const res = n.resId ? app.state.resources.find(r => r.id === n.resId) : null;

                if (n.type === 'root') {
                    fillColor = app.config.colors.primary;
                    textColor = app.config.colors.textLight;
                }

                if (res && res.type === 'color') { fillColor = res.content; }

                if (n.type === 'root') {
                    ctx.shadowColor = 'rgba(0,0,0,0.2)';
                    ctx.shadowBlur = 25 * (n.scale || 1);
                    ctx.shadowOffsetY = 8 * (n.scale || 1);
                } else {
                    ctx.shadowColor = 'rgba(0,0,0,0.08)';
                    ctx.shadowBlur = 12 * (n.scale || 1);
                    ctx.shadowOffsetY = 4 * (n.scale || 1);
                }
                ctx.shadowOffsetX = 0;

                ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
                ctx.fillStyle = fillColor; ctx.fill();
                ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

                if (res) {
                    if (res.type === 'image') { this.drawImageInNode(n, res, r); hasImg = true; }
                    else if (res.type !== 'color') {
                        let icon = '🔗';
                        if (res.type === 'md') icon = '📝'; else if (res.type === 'code') icon = '💻'; else if (res.type === 'audio') icon = '🎤';
                        ctx.fillStyle = (n.type === 'root') ? 'rgba(255,255,255,0.9)' : '#f59e0b';
                        ctx.font = `${20 * (n.scale||1)}px Arial`;
                        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                        ctx.fillText(icon, n.x, n.y - 5);
                    }
                }

                if (n.type === 'root') {
                    if (!res || res.type !== 'color') {
                        ctx.lineWidth = 2;
                        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
                        ctx.stroke();
                    }
                } else if (!res || res.type !== 'color') {
                    ctx.lineWidth = 1.5; ctx.strokeStyle = app.config.colors.outline; ctx.stroke();
                }

                if (app.state.selectedNodes.has(n.id)) {
                    ctx.beginPath(); ctx.arc(n.x, n.y, r + 5, 0, Math.PI * 2);
                    ctx.strokeStyle = app.config.colors.selection; ctx.lineWidth = 2; ctx.stroke();
                }

                ctx.globalAlpha = n.scale || 1;
                ctx.fillStyle = textColor;
                ctx.font = `${n.type==='root'?'bold':''} ${12 * (n.scale||1)}px "Segoe UI", sans-serif`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                const textY = hasImg ? n.y + r + 15 : (n.resId && !hasImg ? n.y + 15 : n.y);
                ctx.fillText(n.label, n.x, textY);
                ctx.globalAlpha = 1;

                if (n.scale >= 0.9) {
                    const btnX = n.x + r * 0.707; const btnY = n.y + r * 0.707;
                    ctx.beginPath(); ctx.arc(btnX, btnY, 9, 0, Math.PI * 2);
                    ctx.fillStyle = '#22c55e'; ctx.fill();
                    ctx.fillStyle = 'white'; ctx.font = 'bold 14px Arial'; ctx.fillText('+', btnX, btnY + 1);
                }
            });

            ctx.restore();

            app.ui.updateBubblePosition();

            requestAnimationFrame(() => this.renderLoop());
        },

        drawImageInNode: function(node, res, r) {
            let img = this.imageCache.get(res.id);

            if (!img) {
                img = new Image();
                img.src = res.content;
                this.imageCache.set(res.id, { loaded: false, obj: img });
                img.onload = () => {
                    this.imageCache.set(res.id, { loaded: true, obj: img, width: img.width, height: img.height });
                };
                return;
            }

            if (img.loaded) {
                this.ctx.save();
                this.ctx.beginPath();
                this.ctx.arc(node.x, node.y, r - 2, 0, Math.PI * 2);
                this.ctx.clip();
                const scale = Math.max((r*2)/img.width, (r*2)/img.height);
                this.ctx.drawImage(img.obj, node.x - img.width*scale/2, node.y - img.height*scale/2, img.width*scale, img.height*scale);
                this.ctx.restore();
            }
        },

        bindEvents: function() {
            const canvas = this.canvas;
            const getPos = (e) => {
                const rect = canvas.getBoundingClientRect();
                const k = app.state.camera.k;
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
                const hitNode = app.state.nodes.find(n => Math.hypot(m.x - n.x, m.y - n.y) < (n.type==='root'?app.config.nodeRadius:app.config.subRadius));
                if (hitNode) {
                    hitNode.resId = resId;
                    app.ui.toast('资源已关联');
                    app.storage.triggerSave();
                }
            });

            window.addEventListener('keydown', (e) => {
                if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
                if (e.key === 'Delete' || e.key === 'Backspace') {
                    if (app.state.selectedNodes.size > 0) {
                        app.ui.onBubbleDelete();
                    }
                }
            });

            const handleStart = (e) => {
                app.dom.nodeMenu.style.display = 'none';

                if (e.target !== canvas) return;

                if (e.touches && e.touches.length === 2) {
                    const dx = e.touches[0].clientX - e.touches[1].clientX;
                    const dy = e.touches[0].clientY - e.touches[1].clientY;
                    this.pinchStartDist = Math.hypot(dx, dy);
                    this.pinchStartScale = app.state.camera.k;
                    e.preventDefault(); return;
                }

                const m = getPos(e);
                let hitNode = null;
                for (let i = app.state.nodes.length - 1; i >= 0; i--) {
                    const n = app.state.nodes[i];
                    const r = (n.type === 'root' ? app.config.nodeRadius : app.config.subRadius) * (n.scale || 1);
                    if (Math.hypot(m.x - (n.x + r*0.707), m.y - (n.y + r*0.707)) < 15) { this.addChildNode(n); return; }
                    if (Math.hypot(m.x - n.x, m.y - n.y) < r) { hitNode = n; break; }
                }

                if (hitNode) {
                    if (e.ctrlKey || e.metaKey) {
                        if (app.state.selectedNodes.has(hitNode.id)) {
                            app.state.selectedNodes.delete(hitNode.id);
                            app.ui.hideNodeBubble();
                            this.dragSubject = null;
                        } else {
                            app.state.selectedNodes.add(hitNode.id);
                            app.ui.showNodeBubble(hitNode);
                            this.dragSubject = hitNode;
                        }
                    } else {
                        if (!app.state.selectedNodes.has(hitNode.id)) {
                            app.state.selectedNodes.clear();
                            app.state.selectedNodes.add(hitNode.id);
                        }
                        app.ui.showNodeBubble(hitNode);
                        this.dragSubject = hitNode;
                    }

                    if (this.dragSubject) {
                        this.dragSubject.fx = this.dragSubject.x;
                        this.dragSubject.fy = this.dragSubject.y;
                        app.state.simulation.alphaTarget(0.3).restart();
                    }
                } else {
                    if (!e.ctrlKey && !e.metaKey) {
                        app.state.selectedNodes.clear();
                        app.ui.hideNodeBubble();
                    }
                    this.isPanning = true; this.startPan = { x: m.rawX, y: m.rawY };
                }
            };

            const handleMove = (e) => {
                if (e.touches && e.touches.length === 2 && this.pinchStartDist) {
                    const dx = e.touches[0].clientX - e.touches[1].clientX;
                    const dy = e.touches[0].clientY - e.touches[1].clientY;
                    const dist = Math.hypot(dx, dy);
                    let newScale = this.pinchStartScale * (dist / this.pinchStartDist);
                    app.state.camera.k = Math.max(0.1, Math.min(5, newScale));
                    e.preventDefault(); return;
                }

                if (!e.touches) {
                    const m = getPos(e);
                    let hoverNode = null;
                    for (let i = app.state.nodes.length - 1; i >= 0; i--) {
                        const n = app.state.nodes[i];
                        const r = (n.type === 'root' ? app.config.nodeRadius : app.config.subRadius) * (n.scale || 1);
                        if (Math.hypot(m.x - n.x, m.y - n.y) < r) { hoverNode = n; break; }
                    }
                    if (hoverNode && hoverNode.resId) app.ui.showTooltip(hoverNode, e.clientX, e.clientY);
                    else app.ui.hideTooltip();
                }

                if (!this.dragSubject && !this.isPanning) return;
                e.preventDefault();
                const m = getPos(e);

                if (this.dragSubject) {
                    app.ui.hideNodeBubble();
                    this.dragSubject.fx = m.x; this.dragSubject.fy = m.y;
                }
                else if (this.isPanning) {
                    app.ui.hideNodeBubble();
                    app.state.camera.x += m.rawX - this.startPan.x; app.state.camera.y += m.rawY - this.startPan.y;
                    this.startPan = { x: m.rawX, y: m.rawY };
                }
            };

            const handleEnd = (e) => {
                if (e.touches && e.touches.length < 2) this.pinchStartDist = null;
                if (this.dragSubject) {
                    this.dragSubject.fx = null; this.dragSubject.fy = null;
                    app.state.simulation.alphaTarget(0);
                    if (app.state.selectedNodes.size === 1 && app.state.selectedNodes.has(this.dragSubject.id)) {
                        app.ui.showNodeBubble(this.dragSubject);
                    }
                    app.storage.triggerSave();
                    this.dragSubject = null;
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
                app.dom.nodeMenu.style.display = 'none';
                app.ui.hideNodeBubble();
                e.preventDefault(); const f = e.deltaY < 0 ? 1.1 : 0.9;
                app.state.camera.k = Math.max(0.1, Math.min(5, app.state.camera.k * f));
            });
        }
    },

    // --- 模块 3: 数据处理 (Data) ---
    data: {
        renameProject: function(n) {
            if(!app.state.currentId) { app.ui.toast('请先创建项目'); app.dom.projTitleInput.value=''; return; }
            if(n.trim()) app.storage.renameProject(app.state.currentId, n.trim());
        },

        createFolder: function() {
            if(!app.state.currentId) return app.ui.toast('请先创建项目');
            const name = prompt('文件夹名称:');
            if(!name) return;
            const folder = { id: 'folder_' + Date.now(), type: 'folder', name: name, parentId: null };
            app.state.resources.push(folder);
            app.ui.renderResourceTree();
            app.storage.triggerSave();
        },

        renameFolder: function(id) {
            const folder = app.state.resources.find(r => r.id === id);
            if (!folder) return;

            const newName = prompt('输入新文件夹名称:', folder.name);
            if (newName && newName.trim() !== '' && newName !== folder.name) {
                folder.name = newName.trim();
                app.ui.renderResourceTree();
                app.storage.triggerSave();
                app.ui.toast('文件夹已重命名');
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
            app.storage.triggerSave();
        },

        saveResource: async function() {
            const type = document.getElementById('resType').value;
            const name = document.getElementById('resName').value;
            const parentId = document.getElementById('resParentId').value || null;

            if (!name) return app.ui.toast('请输入名称');

            let content = null;
            if (type === 'image') {
                if (app.state.tempFileBase64) {
                    app.ui.toast('正在处理图片...');
                    content = await app.utils.compressImage(app.state.tempFileBase64);
                } else if (app.state.editingResId) {
                    content = app.state.resources.find(r => r.id === app.state.editingResId).content;
                } else {
                    return app.ui.toast('请上传文件');
                }
            } else if (type === 'audio') {
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
            app.storage.triggerSave();

            app.state.tempFileBase64 = null; app.state.editingResId = null; document.getElementById('resFile').value = '';
        },

        editResource: function(id) {
            const res = app.state.resources.find(r => r.id === id);
            if (!res) return;
            app.state.editingResId = id;
            app.ui.openResModal('Edit', res);
        },

        deleteResource: function(id) {
            const res = app.state.resources.find(r => r.id === id);
            if (!res) return;

            let confirmMsg = '确定删除此资源吗？';
            if (res.type === 'folder') confirmMsg = '确定删除此文件夹及其所有内容吗？此操作不可恢复。';
            if (!confirm(confirmMsg)) return;

            let idsToDelete = [id];
            if (res.type === 'folder') {
                const children = app.state.resources.filter(r => r.parentId === id);
                children.forEach(c => idsToDelete.push(c.id));
            }

            let updateNodes = false;
            app.state.nodes.forEach(n => {
                if (n.resId && idsToDelete.includes(n.resId)) {
                    n.resId = null;
                    updateNodes = true;
                }
            });

            app.state.resources = app.state.resources.filter(r => !idsToDelete.includes(r.id));

            app.ui.renderResourceTree();
            app.storage.triggerSave();
            app.ui.toast(idsToDelete.length > 1 ? `已删除文件夹及 ${idsToDelete.length-1} 个文件` : '资源已删除');
        },

        saveNodeEdit: function() {
            const node = app.state.editingNode;
            if (node) {
                node.label = document.getElementById('nodeLabel').value;
                node.resId = document.getElementById('nodeResSelect').value || null;
                app.storage.triggerSave();
                app.dom.nodeMenu.style.display = 'none';
                app.ui.toast('节点已保存');
            }
        },

        deleteNode: function() {
            let nodesToDelete = Array.from(app.state.selectedNodes);
            if (nodesToDelete.length === 0) return;

            app.state.nodes = app.state.nodes.filter(n => !nodesToDelete.includes(n.id));

            const deadNodeSet = new Set(nodesToDelete);
            const survivingLinks = [];
            const potentialOrphans = new Set();

            app.state.links.forEach(l => {
                const sId = l.source.id || l.source;
                const tId = l.target.id || l.target;

                const sourceIsDead = deadNodeSet.has(sId);
                const targetIsDead = deadNodeSet.has(tId);

                if (sourceIsDead && !targetIsDead) {
                    potentialOrphans.add(tId);
                } else if (!sourceIsDead && !targetIsDead) {
                    survivingLinks.push(l);
                }
            });

            app.state.links = survivingLinks;

            potentialOrphans.forEach(orphanId => {
                const hasIncoming = app.state.links.some(l => (l.target.id || l.target) === orphanId);
                if (!hasIncoming) {
                    const orphan = app.state.nodes.find(n => n.id === orphanId);
                    if (orphan) {
                        orphan.type = 'root';
                        orphan.scale = 1;
                    }
                }
            });

            app.state.selectedNodes.clear();
            app.state.bubbleNode = null;
            app.state.editingNode = null;
            app.ui.hideNodeBubble();

            app.graph.updateSimulation();
            app.storage.triggerSave();

            app.ui.toast(nodesToDelete.length > 1 ? `已删除 ${nodesToDelete.length} 个节点` : '节点已删除');
        },

        triggerOpenDisk: function() {
            if (window.showOpenFilePicker) {
                app.storage.openFileHandle();
            } else {
                app.ui.triggerImport();
            }
        },

        triggerSaveDisk: function() {
            if (window.showSaveFilePicker) {
                app.storage.saveToHandle();
            } else {
                app.storage.exportProjectToFile();
            }
        },

        importProjectFromFile: function(file) { app.storage.importProjectFromFile(file); },
        exportProjectToFile: function() { app.storage.exportProjectToFile(); }
    },

    // --- 模块 4: UI 交互 (UI) ---
    ui: {
        tooltipEl: null,

        init: function() {
            app.dom.resList = document.getElementById('resList');
            app.dom.projSelect = document.getElementById('projSelect');
            app.dom.projTitleInput = document.getElementById('projTitleInput');
            app.dom.saveStatus = document.getElementById('saveStatus');
            app.dom.canvasWrapper = document.getElementById('canvasWrapper');
            app.dom.mainCanvas = document.getElementById('mainCanvas');
            app.dom.nodeMenu = document.getElementById('nodeMenu');
            app.dom.nodeBubble = document.getElementById('nodeBubble');
            app.dom.toast = document.getElementById('toast');

            app.storage._debouncedSave = app.utils.debounce(app.storage.forceSave, app.config.saveDebounceMs);

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

            app.dom.projSelect.addEventListener('change', async (e) => {
                if (e.target.value === '__new__') {
                    const name = prompt('项目名称:');
                    if (name) { const id = await app.storage.createProject(name); await app.storage.loadProject(id); }
                    else this.updateProjectSelect();
                } else await app.storage.loadProject(e.target.value);
            });

            document.getElementById('resFile').addEventListener('change', (e) => {
                const f = e.target.files[0]; if (!f) return;

                const isImage = f.type.startsWith('image/');
                if (isImage && f.size > app.config.maxImageSizeMB * 1024 * 1024) {
                    if (!confirm(`图片超过 ${app.config.maxImageSizeMB}MB，将自动压缩，是否继续？`)) {
                        e.target.value = '';
                        return;
                    }
                }

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

        updateSaveStatus: function(text) {
            if (app.dom.saveStatus) app.dom.saveStatus.innerText = text;
        },

        exportImage: function() {
            if (app.state.nodes.length === 0) return this.toast('画布为空');

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            app.state.nodes.forEach(n => {
                const r = (n.type === 'root' ? app.config.nodeRadius : app.config.subRadius) * (n.scale || 1);
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
            ctx.strokeStyle = app.config.colors.link;
            ctx.lineWidth = 1.5;
            app.state.links.forEach(l => {
                const s = l.source, t = l.target;
                if (s.x && t.x) {
                    ctx.moveTo(s.x, s.y);
                    ctx.lineTo(t.x, t.y);
                }
            });
            ctx.stroke();

            app.state.nodes.forEach(n => {
                const r = (n.type === 'root' ? app.config.nodeRadius : app.config.subRadius) * (n.scale || 1);

                ctx.save();
                if (n.type === 'root') {
                    ctx.shadowColor = 'rgba(0,0,0,0.2)';
                    ctx.shadowBlur = 20;
                    ctx.shadowOffsetY = 5;
                }

                ctx.beginPath();
                ctx.arc(n.x, n.y, r, 0, Math.PI * 2);

                let fillColor = n.type === 'root' ? app.config.colors.primary : app.config.colors.surface;
                const res = n.resId ? app.state.resources.find(r => r.id === n.resId) : null;
                if (res && res.type === 'color') fillColor = res.content;

                ctx.fillStyle = fillColor;
                ctx.fill();
                ctx.restore();

                if (res && res.type === 'image') {
                    const imgObj = app.graph.imageCache.get(res.id);
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
                    ctx.strokeStyle = app.config.colors.outline;
                    ctx.stroke();
                }

                ctx.fillStyle = (n.type === 'root') ? app.config.colors.textLight : app.config.colors.textMain;
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
        },

        toggleTheme: function() {
            const body = document.body;
            if (body.hasAttribute('data-theme')) {
                body.removeAttribute('data-theme');
                localStorage.setItem('theme', 'light');
            } else {
                body.setAttribute('data-theme', 'dark');
                localStorage.setItem('theme', 'dark');
            }
        },

        showNodeBubble: function(node) {
            app.state.bubbleNode = node;
            const bubble = app.dom.nodeBubble;
            bubble.style.display = 'flex';
            this.updateBubblePosition();
        },

        hideNodeBubble: function() {
            app.state.bubbleNode = null;
            app.dom.nodeBubble.style.display = 'none';
        },

        updateBubblePosition: function() {
            const node = app.state.bubbleNode;
            if (!node) return;

            const cam = app.state.camera;
            const r = (node.type === 'root' ? app.config.nodeRadius : app.config.subRadius) * (node.scale || 1);

            const canvasRect = app.dom.mainCanvas.getBoundingClientRect();

            const screenX = (node.x * cam.k + cam.x) + canvasRect.left;
            const screenY = (node.y * cam.k + cam.y) + canvasRect.top;
            const screenR = r * cam.k;

            const bubble = app.dom.nodeBubble;
            bubble.style.left = screenX + 'px';
            bubble.style.top = screenY + 'px';
            bubble.style.setProperty('--node-radius', screenR + 'px');
        },

        onBubbleEdit: function() {
            const node = app.state.bubbleNode;
            if (!node) return;
            this.hideNodeBubble();
            const cx = window.innerWidth / 2 - 160;
            const cy = window.innerHeight / 2 - 180;
            this.openNodeMenu(node, cx, cy);
        },

        onBubbleDelete: function() {
            if (!app.state.bubbleNode) return;
            if(confirm('确定要删除这个节点及其连线吗？')) {
                app.data.deleteNode();
            }
        },

        filterResources: function(keyword) {
            app.state.searchKeyword = keyword.toLowerCase();
            this.renderResourceTree();
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

        displayTooltip: function(resId, x, y) {
            clearTimeout(app.state.tooltipTimer);
            const res = app.state.resources.find(r => r.id === resId);
            if (!res) return;

            let content = '';
            if (res.type === 'image') content = `<img src="${res.content}" style="max-width:100%; max-height:200px; display:block; border-radius:4px;">`;
            else if (res.type === 'md') {
                let html = marked.parse(res.content);
                html = app.utils.purifyHTML(html);
                content = `<div class="md-preview" style="background:#f8f9fa; padding:10px; border-radius:4px; max-height:280px; overflow-y:auto;">${html}</div>`;
            }
            else if (res.type === 'code') content = `<pre style="font-family:monospace; background:#282c34; color:#abb2bf; padding:10px; border-radius:4px; font-size:12px; overflow:auto;">${app.utils.escapeHtml(res.content)}</pre>`;
            else if (res.type === 'color') content = `<div style="width:100px; height:60px; background-color:${res.content}; border-radius:4px; border:1px solid #ddd; margin-bottom:5px;"></div><div style="text-align:center; font-family:monospace; font-weight:bold;">${res.content}</div>`;
            else if (res.type === 'audio') content = `<audio controls src="${res.content}" style="width:250px;"></audio>`;
            else if (res.type === 'link') content = `<div style="font-size:12px; color:#555; margin-bottom:8px; word-break:break-all;">${app.utils.escapeHtml(res.content)}</div><a href="${res.content}" target="_blank" style="display:block; text-align:center; background:#667eea; color:white; text-decoration:none; padding:6px; border-radius:4px; font-size:12px;">跳转到链接 🔗</a>`;

            this.tooltipEl.innerHTML = content;
            this.tooltipEl.style.display = 'block';

            const pad = 15; let top = y + pad; let left = x + pad;
            const rect = this.tooltipEl.getBoundingClientRect();
            if (left + rect.width > window.innerWidth) left = x - rect.width - pad;
            if (top + rect.height > window.innerHeight) top = y - rect.height - pad;
            this.tooltipEl.style.top = top + 'px'; this.tooltipEl.style.left = left + 'px';
        },

        showTooltip: function(node, x, y) {
            if (node.resId) this.displayTooltip(node.resId, x, y);
        },

        showSidebarPreview: function(resId, event) {
            this.displayTooltip(resId, event.clientX + 10, event.clientY);
        },

        hideTooltip: function() {
            clearTimeout(app.state.tooltipTimer);
            app.state.tooltipTimer = setTimeout(() => {
                if (this.tooltipEl) this.tooltipEl.style.display = 'none';
            }, app.config.previewDelay);
        },

        triggerImport: function() { document.getElementById('importInput').click(); },
        confirmDeleteProject: function() { if(app.state.currentId && confirm('确定删除？')) app.storage.deleteProject(app.state.currentId); },

        updateProjectSelect: function() {
            const sel = app.dom.projSelect;
            let h = `<option value="" disabled ${!app.state.currentId?'selected':''}>-- 选择项目 --</option>`;
            h += `<option value="__new__" style="color:#667eea; font-weight:bold;">+ 新建项目</option>`;
            app.state.projectsIndex.forEach(p => { h += `<option value="${p.id}" ${p.id===app.state.currentId?'selected':''}>📁 ${p.name}</option>`; });
            sel.innerHTML = h;
        },

        renderResourceTree: function() {
            const container = app.dom.resList;
            container.ondragover = (e) => app.ui.dragOver(e, null);
            container.ondrop = (e) => app.ui.drop(e, null);
            container.ondragleave = (e) => app.ui.dragLeave(e);

            const resources = app.state.resources;
            if(!resources.length) { container.innerHTML = '<div class="empty-tip">暂无资源<br><small>拖入文件或点击添加</small></div>'; return; }

            const keyword = app.state.searchKeyword;
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

                const isOpen = keyword ? true : app.state.expandedFolders.has(folder.id);

                html += `
                    <div class="res-folder ${isOpen?'open':''}" 
                         onclick="app.ui.toggleFolder('${folder.id}')"
                         oncontextmenu="event.preventDefault(); app.data.renameFolder('${folder.id}');"
                         ondragover="app.ui.dragOver(event, '${folder.id}')"
                         ondrop="app.ui.drop(event, '${folder.id}')"
                         ondragleave="app.ui.dragLeave(event)"
                         title="右键点击可快速重命名">
                        <div class="folder-icon">▶</div>
                        <div class="res-info"><div class="res-name">${this.highlightText(folder.name, keyword)}</div></div>
                        <div class="res-actions">
                            <div class="btn-res-action" onclick="event.stopPropagation(); app.data.renameFolder('${folder.id}')" title="重命名">✎</div>
                            <div class="btn-res-action del" onclick="event.stopPropagation(); app.data.deleteResource('${folder.id}')" title="删除文件夹">🗑</div>
                        </div>
                    </div>
                    <div class="folder-children ${isOpen?'open':''}">
                        ${matchChildren.map(child => this.createResItemHtml(child, keyword)).join('')}
                    </div>
                `;
            });

            rootFiles.forEach(file => { html += this.createResItemHtml(file, keyword); });
            container.innerHTML = html;
        },

        createResItemHtml: function(r, keyword) {
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
                        <div class="btn-res-action" onclick="app.data.editResource('${r.id}')" title="编辑">✎</div>
                        <div class="btn-res-action del" onclick="app.data.deleteResource('${r.id}')" title="删除">🗑</div>
                    </div>
                </div>
            `;
        },

        highlightText: function(text, keyword) {
            if (!keyword) return text;
            const reg = new RegExp(`(${keyword})`, 'gi');
            return text.replace(reg, '<span class="highlight">$1</span>');
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
                else if(res.type==='md' || res.type==='code') alert('请在悬浮窗查看内容预览');
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
            const m = app.dom.nodeMenu;
            app.state.editingNode = node;

            document.getElementById('nodeLabel').value = node.label;
            const sel = document.getElementById('nodeResSelect');
            sel.innerHTML = '<option value="">(无)</option>' + app.state.resources.filter(r=>r.type!=='folder').map(r =>
                `<option value="${r.id}" ${r.id===node.resId?'selected':''}>${r.name}</option>`
            ).join('');

            if (x !== undefined && y !== undefined) {
                const rectWidth = 320;
                const rectHeight = 350;

                let left = x;
                let top = y;

                if (left + rectWidth > window.innerWidth) left = window.innerWidth - rectWidth - 20;
                if (top + rectHeight > window.innerHeight) top = window.innerHeight - rectHeight - 20;
                if (left < 20) left = 20;
                if (top < 20) top = 20;

                m.style.left = left + 'px';
                m.style.top = top + 'px';
            }
            m.style.display = 'flex';
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

        toast: function(m) {
            const t = app.dom.toast;
            t.innerText = m;
            t.classList.add('show');
            setTimeout(()=>t.classList.remove('show'), 3000);
        }
    },

    init: async function() {
        this.ui.init();
        await this.storage.init();
        this.graph.init();
        console.log("MindFlow Ready.");
    }
};

window.app = app;
window.onload = () => app.init();
