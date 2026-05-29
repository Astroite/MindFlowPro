import { config } from '../config.js';
import { DataModule } from './data.js';

export class StorageModule {
    /**
     * @param {import('../types.js').App} app
     */
    constructor(app) {
        this.app = app;
        this._isLoading = false;
        this._saving = false;
        this._debouncedSave = this.app.utils.debounce(this.forceSave.bind(this), config.saveDebounceMs);
    }

    _serializeNode(n) {
        return {
            id: n.id, type: n.type, x: n.x, y: n.y, label: n.label, resId: n.resId,
            color: n.color || null, note: n.note || null,
            shape: n.shape || null, texture: n.texture || null,
            layout: n.layout || null, borderStyle: n.borderStyle || null,
            cardRatio: n.cardRatio || null
        };
    }

    /**
     * P0-5: 轻量级 Schema 校验 — 在 loadProject 中使用，检测损坏数据并优雅降级。
     * 返回 { valid: boolean, errors: string[] }
     */
    _validateProject(proj) {
        const errors = [];
        if (!proj || typeof proj !== 'object') {
            return { valid: false, errors: ['项目数据不是有效对象'] };
        }
        if (!Array.isArray(proj.nodes)) errors.push('nodes 不是数组');
        if (!Array.isArray(proj.links)) errors.push('links 不是数组');
        if (!Array.isArray(proj.resources)) errors.push('resources 不是数组');

        // 校验节点基本结构
        if (Array.isArray(proj.nodes)) {
            for (let i = 0; i < proj.nodes.length; i++) {
                const n = proj.nodes[i];
                if (!n || typeof n !== 'object') { errors.push(`nodes[${i}] 无效`); continue; }
                if (!n.id) errors.push(`nodes[${i}] 缺少 id`);
                if (typeof n.x !== 'number' || typeof n.y !== 'number') errors.push(`nodes[${i}] 坐标无效`);
            }
        }

        // 校验连线基本结构
        if (Array.isArray(proj.links)) {
            for (let i = 0; i < proj.links.length; i++) {
                const l = proj.links[i];
                if (!l || typeof l !== 'object') { errors.push(`links[${i}] 无效`); continue; }
                if (!l.source || !l.target) errors.push(`links[${i}] 缺少 source/target`);
            }
        }

        // 校验资源基本结构
        if (Array.isArray(proj.resources)) {
            for (let i = 0; i < proj.resources.length; i++) {
                const r = proj.resources[i];
                if (!r || typeof r !== 'object') { errors.push(`resources[${i}] 无效`); continue; }
                if (!r.id) errors.push(`resources[${i}] 缺少 id`);
            }
        }

        return { valid: errors.length === 0, errors };
    }

    async init() {
        try {
            localforage.config({ name: config.dbName, storeName: config.storeName });
            await this.loadIndex();
            this._bindSaveGuards();
        } catch (e) {
            console.error('存储初始化失败:', e);
            this.app.ui.toast('存储系统初始化失败，请检查浏览器设置');
        }
    }

    /** P0-1/2: 页面关闭或标签页隐藏时强制保存，防止数据丢失 */
    _bindSaveGuards() {
        window.addEventListener('beforeunload', () => {
            if (this.app.state.isDirty && this.app.state.currentId) {
                this._syncSave();
            }
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && this.app.state.isDirty && this.app.state.currentId) {
                this._syncSave();
            }
        });
    }

    /**
     * 同步保存 — 用 navigator.sendBeacon 将数据发到一个假 URL 不可行（IndexedDB 是异步的），
     * 所以我们取消 debounce 立即触发 forceSave，并祈祷浏览器在页面卸载前完成 IndexedDB 写入。
     * 现代浏览器（Chrome 120+、Firefox 115+）在 beforeunload 中会等待 microtask 完成。
     */
    _syncSave() {
        if (this._isLoading) return;
        // 取消 debounce 定时器，避免重复
        if (this._debouncedSave?.cancel) this._debouncedSave.cancel();
        // fire-and-forget：IndexedDB 写入在 beforeunload 中仍可能完成
        this.forceSave();
    }

    async loadIndex() {
        try {
            const index = await localforage.getItem('__project_index__') || [];
            this.app.state.projectsIndex = Array.isArray(index) ? index : [];
            this.app.ui.updateProjectSelect();
        } catch (e) { console.error('索引加载失败', e); }
    }

    async saveIndex() {
        try {
            await localforage.setItem('__project_index__', this.app.state.projectsIndex);
        } catch (e) {
            console.error('项目索引保存失败:', e);
            this.app.ui.toast('保存失败：浏览器存储空间可能已满，请删除部分项目');
        }
    }

    async createProject(name) {
        const id = this.app.config.idPrefix.project + Date.now();
        const newProj = {
            id: id, name: name, created: Date.now(),
            nodes: [], links: [], resources: []
        };
        try {
            await localforage.setItem(id, newProj);
            this.app.state.projectsIndex.push({ id: id, name: name });
            await this.saveIndex();
        } catch (e) {
            console.error('创建项目失败:', e);
            // Rollback: remove from index if it was added
            const idx = this.app.state.projectsIndex.findIndex(p => p.id === id);
            if (idx !== -1) this.app.state.projectsIndex.splice(idx, 1);
            this.app.ui.toast('创建项目失败: ' + e.message, 'error');
            throw e;
        }

        // [修复] 创建后立即刷新下拉列表，确保新项目可见
        this.app.ui.updateProjectSelect();

        this.app.state.fileHandle = null;
        return id;
    }

    async renameProject(id, newName) {
        if (!id || !newName) return;
        const idx = this.app.state.projectsIndex.findIndex(p => p.id === id);
        if (idx === -1) return;
        const oldName = this.app.state.projectsIndex[idx].name;
        try {
            // Write body first; only update index after the body is persisted
            const proj = await localforage.getItem(id);
            if (proj) { proj.name = newName; await localforage.setItem(id, proj); }
            this.app.state.projectsIndex[idx].name = newName;
            await this.saveIndex();
            this.app.ui.updateProjectSelect();
            this.app.ui.toast('项目重命名成功');
        } catch (e) {
            // Roll back in-memory index if we mutated it
            if (this.app.state.projectsIndex[idx]) {
                this.app.state.projectsIndex[idx].name = oldName;
            }
            this.app.ui.toast('重命名失败: ' + e.message);
        }
    }

    async deleteProject(id) {
        if (!id) return;
        try {
            await localforage.removeItem(id);
            this.app.state.projectsIndex = this.app.state.projectsIndex.filter(p => p.id !== id);
            await this.saveIndex();

            // [新增] 如果删除的是最后打开的项目，清除记录
            if (localStorage.getItem('lastOpenedProjectId') === id) {
                localStorage.removeItem('lastOpenedProjectId');
            }

            this.app.ui.toast('项目已删除');
            if (this.app.state.currentId === id) {
                this.unloadProject();
            }
            this.app.ui.updateProjectSelect();
        } catch (e) { this.app.ui.toast('删除失败: ' + e.message); }
    }

    unloadProject() {
        this.app.state.currentId = null;
        this.app.state.nodes = []; this.app.state.links = []; this.app.state.resources = [];
        this.app.state.fileHandle = null;
        this.app.state.selectedNodes.clear();
        this.app.state.undoStack = [];
        this.app.state.redoStack = [];
        if (this.app.data) {
            this.app.data._clipboard = [];
            this.app.data._clipboardLinks = [];
        }
        this.app.graph.updateSimulation();
        this.app.ui.renderResourceTree();
        this.app.dom.projTitleInput.value = '';
        this.app.ui.updateSaveStatus('已就绪');
    }

    /**
     * P3-29: 数据迁移注册表。
     * 每个迁移函数接收项目数据，就地修改并返回。
     * 新迁移追加在末尾，编号从 1 开始。
     */
    static MIGRATIONS = [
        // v1: 无显式版本号的旧数据 → 标准化字段（已在 loadProject 中处理，这里仅标记版本）
        (proj) => {
            // 确保 nodes 有默认字段
            (proj.nodes || []).forEach(n => {
                if (!n.shape) n.shape = 'circle';
                if (!n.layout) n.layout = 'icon';
                if (!n.borderStyle) n.borderStyle = 'solid';
            });
            // 确保 resources 有 parentId 和 tags
            (proj.resources || []).forEach(r => {
                if (!r.parentId) r.parentId = null;
                if (!Array.isArray(r.tags)) r.tags = [];
            });
        },
    ];

    _migrateProject(proj) {
        const currentVersion = proj.dataVersion || 0;
        const targetVersion = config.dataVersion;
        if (currentVersion >= targetVersion) return proj;

        for (let v = currentVersion; v < targetVersion; v++) {
            const migration = StorageModule.MIGRATIONS[v];
            if (migration) {
                migration(proj);
                console.log(`[Migration] Applied v${v} → v${v + 1}`);
            }
        }
        proj.dataVersion = targetVersion;
        return proj;
    }

    async loadProject(id) {
        this._isLoading = true;
        try {
            const proj = await localforage.getItem(id);
            if (!proj) {
                this.app.state.projectsIndex = this.app.state.projectsIndex.filter(p => p.id !== id);
                await this.saveIndex();
                this.app.ui.updateProjectSelect();
                throw new Error('项目数据丢失');
            }

            // P0-5: Schema 校验 — 检测损坏数据
            const validation = this._validateProject(proj);
            if (!validation.valid) {
                console.error('项目数据校验失败:', validation.errors);
                this.app.ui.toast('项目数据已损坏: ' + validation.errors[0], 'error');
                // 仍然尝试加载（降级），让 normalize 逻辑修复能修复的部分
            }

            // P3-29: 数据迁移
            this._migrateProject(proj);

            // Undo/redo and clipboard are scoped to a single project — wipe them
            // so commands from the previous project cannot corrupt this one.
            this.app.state.undoStack = [];
            this.app.state.redoStack = [];
            if (this.app.data) {
                this.app.data._clipboard = [];
                this.app.data._clipboardLinks = [];
            }

            this.app.state.currentId = id;
            this.app.state.fileHandle = null;
            this.app.state.nodes = (proj.nodes || []).map(n => ({
                ...n,
                scale: 1,
                texture: n.texture || (n.glass ? 'glass' : null),
                shape: n.shape === 'pill' ? 'circle' : (n.shape || 'circle'),
                layout: n.layout || 'icon',
                borderStyle: n.borderStyle || 'solid',
                color: n.color || null,
                note: n.note || '',
            }));
            this.app.state.links = JSON.parse(JSON.stringify(proj.links || []));
            this.app.state.resources = (proj.resources || []).map(r => ({
                ...r,
                parentId: r.parentId || null,
                tags: Array.isArray(r.tags) ? r.tags : [],
            }));

            if (this.app.data && this.app.data.normalizeResources) {
                this.app.data.normalizeResources();
            }

            this.app.state.selectedNodes.clear();
            this.app.ui.hideNodeBubble();

            this.app.dom.projTitleInput.value = proj.name;
            if (proj.camera && typeof proj.camera.x === 'number' && typeof proj.camera.y === 'number' && typeof proj.camera.k === 'number') {
                this.app.state.camera = { x: proj.camera.x, y: proj.camera.y, k: proj.camera.k };
            } else {
                this.app.graph.resetCamera();
            }
            this.app.graph.imageCache.clear();
            if (this.app.graph.nodeRenderer && this.app.graph.nodeRenderer.textureCache) {
                this.app.graph.nodeRenderer.textureCache.clear();
            }
            this.app.state.searchKeyword = '';
            this.app.ui.renderResourceTree();
            this.app.ui.toast(`已加载: ${proj.name}`);
            this.app.graph.updateSimulation();
            this.app.ui.updateSaveStatus('已加载');
            this.app.ui.updateProjectSelect();

            localStorage.setItem('lastOpenedProjectId', id);

        } catch (e) {
            this.app.ui.toast('加载失败: ' + e.message);
        } finally {
            this._isLoading = false;
        }
    }

    // [新增] 获取最后一次打开的项目 ID
    getLastOpenedProjectId() {
        return localStorage.getItem('lastOpenedProjectId');
    }

    triggerSave() {
        if (!this.app.state.currentId) return;
        if (this._isLoading) return;
        this.app.state.isDirty = true;
        this.app.ui.updateSaveStatus('有未保存修改...');
        if (this._debouncedSave) this._debouncedSave();
    }

    async forceSave() {
        if (!this.app.state.currentId) return this.app.ui.toast('请先创建或选择项目');
        if (this._isLoading) return;
        if (this._saving) return; // P0-3: 防止并发写入

        this._saving = true;
        this.app.ui.updateSaveStatus('保存中...');
        const currentProjName = this.app.dom.projTitleInput.value || '未命名项目';

        const cleanNodes = this.app.state.nodes
            .filter(n => !n._deleting && !n._removeNow)
            .map(n => this._serializeNode(n));
        const cleanLinks = this.app.state.links.map(l => ({
            source: DataModule.linkEnd(l, 'source'),
            target: DataModule.linkEnd(l, 'target'),
            type: l.type // [Fix] 保存连线类型，防止飞线变回普通连线
        }));

        const cam = this.app.state.camera;
        const projData = {
            id: this.app.state.currentId,
            name: currentProjName,
            updated: Date.now(),
            dataVersion: config.dataVersion,
            nodes: cleanNodes,
            links: cleanLinks,
            resources: this.app.state.resources,
            camera: { x: cam.x, y: cam.y, k: cam.k }
        };

        try {
            await localforage.setItem(this.app.state.currentId, projData);
            this.app.state.isDirty = false;
            this.app.ui.updateSaveStatus('已保存 ' + new Date().toLocaleTimeString());
        } catch (e) {
            console.error(e);
            const msg = (e.name === 'QuotaExceededError') ? '保存失败: 浏览器存储空间已满，请删除部分项目' : '保存失败: ' + (e.message || '未知错误');
            this.app.ui.toast(msg);
        } finally {
            this._saving = false;
        }
    }

    async importExternalProject(projData) {
        // 校验导入数据结构
        if (!projData || typeof projData !== 'object') throw new Error('项目数据无效');
        const nodes = Array.isArray(projData.nodes) ? projData.nodes : [];
        const links = Array.isArray(projData.links) ? projData.links : [];
        const resources = Array.isArray(projData.resources) ? projData.resources : [];
        const MAX_RES_SIZE = config.maxResourceSize;
        for (const r of resources) {
            if (r && typeof r.content === 'string' && r.content.length > MAX_RES_SIZE) {
                throw new Error(`资源 "${r.name || r.id}" 内容超过 10MB 限制`);
            }
        }

        // Regenerate node + resource IDs to prevent collisions with existing data and as
        // defense-in-depth against untrusted IDs ever reaching DOM attributes.
        const genId = (prefix) => this.app.utils.genId(prefix);
        const resIdMap = {};
        const nodeIdMap = {};
        resources.forEach(r => {
            if (!r || !r.id) return;
            const prefix = r.type === 'folder' ? this.app.config.idPrefix.folder : this.app.config.idPrefix.resource;
            const newId = genId(prefix);
            resIdMap[r.id] = newId;
            r.id = newId;
        });
        resources.forEach(r => {
            if (r && r.parentId && resIdMap[r.parentId]) r.parentId = resIdMap[r.parentId];
        });
        nodes.forEach(n => {
            if (!n || !n.id) return;
            const newId = genId(this.app.config.idPrefix.node);
            nodeIdMap[n.id] = newId;
            n.id = newId;
            if (n.resId && resIdMap[n.resId]) n.resId = resIdMap[n.resId];
        });
        links.forEach(l => {
            if (!l) return;
            if (l.source && nodeIdMap[l.source]) l.source = nodeIdMap[l.source];
            if (l.target && nodeIdMap[l.target]) l.target = nodeIdMap[l.target];
        });

        const newId = this.app.config.idPrefix.project + Date.now() + '_imp';
        const newName = (projData.name || '未命名') + ' (导入)';
        const newProj = {
            id: newId, name: newName, created: Date.now(),
            nodes, links, resources,
            camera: projData.camera || null
        };
        try {
            await localforage.setItem(newId, newProj);
            this.app.state.projectsIndex.push({ id: newId, name: newName });
            await this.saveIndex();
        } catch (e) {
            console.error('导入项目失败:', e);
            // Rollback: remove from index if added
            const idx = this.app.state.projectsIndex.findIndex(p => p.id === newId);
            if (idx !== -1) this.app.state.projectsIndex.splice(idx, 1);
            this.app.ui.toast('导入失败: ' + (e.name === 'QuotaExceededError' ? '存储空间已满，请删除部分项目' : e.message), 'error');
            throw e;
        }
        // 导入后也要刷新列表
        this.app.ui.updateProjectSelect();
        return newId;
    }

    async openFileHandle() {
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
            this.app.state.fileHandle = handle;
            this.app.ui.toast('已打开本地文件 (支持直接保存)');
            this.app.dom.projTitleInput.value = file.name.replace('.json', '').replace('.mindflow', '');
        } catch (err) {
            if (err.name !== 'AbortError') { console.error(err); this.app.ui.toast('打开文件失败: ' + err.message); }
        }
    }

    async saveToHandle() {
        if (!this.app.state.currentId) return this.app.ui.toast('无数据可保存');
        const currentProjName = this.app.dom.projTitleInput.value || '未命名项目';
        const exportData = {
            meta: { version: config.appVersion, type: 'MindFlowProject', exportedAt: Date.now() },
            project: {
                name: currentProjName,
                nodes: this.app.state.nodes.map(n => this._serializeNode(n)),
                links: this.app.state.links.map(l => ({
                    source: DataModule.linkEnd(l, 'source'),
                    target: DataModule.linkEnd(l, 'target'),
                    type: l.type // [Fix] 导出文件时同样需要保存类型
                })),
                resources: this.app.state.resources,
                camera: this.app.state.camera
            }
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], {type: 'application/json'});

        try {
            if (this.app.state.fileHandle) {
                const writable = await this.app.state.fileHandle.createWritable();
                await writable.write(blob);
                await writable.close();
                this.app.ui.toast('已保存到磁盘文件');
            } else {
                if (window.showSaveFilePicker) {
                    const handle = await window.showSaveFilePicker({
                        suggestedName: `${currentProjName}.mindflow.json`,
                        types: [{ description: 'MindFlow Files', accept: { 'application/json': ['.json', '.mindflow'] } }]
                    });
                    const writable = await handle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                    this.app.state.fileHandle = handle;
                    this.app.ui.toast('已另存为本地文件');
                } else {
                    this.fallbackDownload(blob, `${currentProjName}.mindflow.json`);
                }
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error(err);
                // Invalidate stale handle so next save re-prompts instead of silently failing
                this.app.state.fileHandle = null;
                this.app.ui.toast('保存到磁盘失败: ' + err.message);
            }
        }
    }

    fallbackDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        this.app.ui.toast('已导出 (下载模式)');
    }

    importProjectFromFile(file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const json = JSON.parse(e.target.result);
                if (!json.project || typeof json.project !== 'object') throw new Error('无效的项目文件');
                const newId = await this.importExternalProject(json.project);
                await this.loadProject(newId);
            } catch (err) {
                this.app.ui.toast('导入失败: ' + err.message);
            }
        };
        reader.onerror = () => {
            this.app.ui.toast('文件读取失败，请重试', 'error');
        };
        reader.readAsText(file);
    }

    async exportProjectToFile() {
        if (!this.app.state.currentId) return this.app.ui.toast('请先创建项目');
        await this.forceSave();
        const tempHandle = this.app.state.fileHandle;
        this.app.state.fileHandle = null;
        await this.saveToHandle();
        this.app.state.fileHandle = tempHandle;
    }

    triggerOpenDisk() {
        if (window.showOpenFilePicker) {
            this.openFileHandle();
        } else {
            this.app.ui.triggerImport();
        }
    }

    triggerSaveDisk() {
        if (window.showSaveFilePicker) {
            this.saveToHandle();
        } else {
            this.exportProjectToFile();
        }
    }

    async duplicateProject(id) {
        const proj = await localforage.getItem(id);
        if (!proj) return this.app.ui.toast('无法复制：找不到项目数据');
        const newId = this.app.config.idPrefix.project + Date.now() + '_dup';
        const newName = proj.name + ' (副本)';
        const newProj = JSON.parse(JSON.stringify(proj));
        newProj.id = newId;
        newProj.name = newName;
        newProj.created = Date.now();
        await localforage.setItem(newId, newProj);
        this.app.state.projectsIndex.push({ id: newId, name: newName });
        await this.saveIndex();
        this.app.ui.updateProjectSelect();
        this.app.ui.toast('项目已复制: ' + newName);
        return newId;
    }
}
