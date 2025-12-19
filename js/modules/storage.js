import { config } from '../config.js';

export class StorageModule {
    constructor(app) {
        this.app = app;
        // 防抖保存函数，将在 init 中初始化
        this._debouncedSave = null;
    }

    async init() {
        try {
            localforage.config({ name: config.dbName, storeName: config.storeName });
            await this.loadIndex();
            // 初始化防抖函数
            this._debouncedSave = this.app.utils.debounce(this.forceSave.bind(this), config.saveDebounceMs);
        } catch (e) {
            console.error('存储初始化失败:', e);
            this.app.ui.toast('存储系统初始化失败，请检查浏览器设置');
        }
    }

    async loadIndex() {
        try {
            const index = await localforage.getItem('__project_index__') || [];
            this.app.state.projectsIndex = Array.isArray(index) ? index : [];
            this.app.ui.updateProjectSelect();
        } catch (e) { console.error('索引加载失败', e); }
    }

    async saveIndex() {
        await localforage.setItem('__project_index__', this.app.state.projectsIndex);
    }

    async createProject(name) {
        const id = 'proj_' + Date.now();
        const newProj = {
            id: id, name: name, created: Date.now(),
            nodes: [], links: [], resources: []
        };
        await localforage.setItem(id, newProj);
        this.app.state.projectsIndex.push({ id: id, name: name });
        await this.saveIndex();
        this.app.state.fileHandle = null;
        return id;
    }

    async renameProject(id, newName) {
        if (!id || !newName) return;
        try {
            const idx = this.app.state.projectsIndex.findIndex(p => p.id === id);
            if (idx !== -1) { this.app.state.projectsIndex[idx].name = newName; await this.saveIndex(); }
            const proj = await localforage.getItem(id);
            if (proj) { proj.name = newName; await localforage.setItem(id, proj); }
            this.app.ui.updateProjectSelect();
            this.app.ui.toast('项目重命名成功');
        } catch (e) { this.app.ui.toast('重命名失败: ' + e.message); }
    }

    async deleteProject(id) {
        if (!id) return;
        try {
            await localforage.removeItem(id);
            this.app.state.projectsIndex = this.app.state.projectsIndex.filter(p => p.id !== id);
            await this.saveIndex();
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
        this.app.graph.updateSimulation();
        this.app.ui.renderResourceTree();
        this.app.dom.projTitleInput.value = '';
        this.app.ui.updateSaveStatus('已就绪');
    }

    async loadProject(id) {
        try {
            const proj = await localforage.getItem(id);
            if (!proj) {
                this.app.state.projectsIndex = this.app.state.projectsIndex.filter(p => p.id !== id);
                await this.saveIndex();
                this.app.ui.updateProjectSelect();
                throw new Error('项目数据丢失');
            }

            this.app.state.currentId = id;
            this.app.state.fileHandle = null;
            this.app.state.nodes = (proj.nodes || []).map(n => ({...n, scale: 1}));
            this.app.state.links = JSON.parse(JSON.stringify(proj.links || []));
            this.app.state.resources = (proj.resources || []).map(r => ({ ...r, parentId: r.parentId || null }));

            this.app.state.selectedNodes.clear();
            this.app.ui.hideNodeBubble();

            this.app.dom.projTitleInput.value = proj.name;
            this.app.graph.resetCamera();
            this.app.graph.imageCache.clear();
            this.app.state.searchKeyword = '';
            this.app.ui.renderResourceTree();
            this.app.ui.toast(`已加载: ${proj.name}`);
            this.app.graph.updateSimulation();
            this.app.ui.updateSaveStatus('已加载');
        } catch (e) { this.app.ui.toast('加载失败: ' + e.message); }
    }

    triggerSave() {
        if (!this.app.state.currentId) return;
        this.app.state.isDirty = true;
        this.app.ui.updateSaveStatus('有未保存修改...');
        if (this._debouncedSave) this._debouncedSave();
    }

    async forceSave() {
        if (!this.app.state.currentId) return this.app.ui.toast('请先创建或选择项目');

        this.app.ui.updateSaveStatus('保存中...');
        const currentProjName = this.app.dom.projTitleInput.value || '未命名项目';

        const cleanNodes = this.app.state.nodes.map(n => ({
            id: n.id, type: n.type, x: n.x, y: n.y, label: n.label, resId: n.resId
        }));
        const cleanLinks = this.app.state.links.map(l => ({
            source: l.source.id || l.source, target: l.target.id || l.target
        }));

        const projData = {
            id: this.app.state.currentId,
            name: currentProjName,
            updated: Date.now(),
            nodes: cleanNodes,
            links: cleanLinks,
            resources: this.app.state.resources
        };

        try {
            await localforage.setItem(this.app.state.currentId, projData);
            this.app.state.isDirty = false;
            this.app.ui.updateSaveStatus('已保存 ' + new Date().toLocaleTimeString());
        } catch (e) {
            console.error(e);
            this.app.ui.toast('保存失败: 空间不足或数据过大');
        }
    }

    async importExternalProject(projData) {
        const newId = 'proj_' + Date.now() + '_imp';
        const newName = (projData.name || '未命名') + ' (导入)';
        const newProj = {
            id: newId, name: newName, created: Date.now(),
            nodes: projData.nodes || [], links: projData.links || [], resources: projData.resources || []
        };
        await localforage.setItem(newId, newProj);
        this.app.state.projectsIndex.push({ id: newId, name: newName });
        await this.saveIndex();
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
                nodes: this.app.state.nodes.map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, label: n.label, resId: n.resId })),
                links: this.app.state.links.map(l => ({ source: l.source.id || l.source, target: l.target.id || l.target })),
                resources: this.app.state.resources
            }
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], {type: 'application/json'});

        try {
            if (this.app.state.fileHandle) {
                const writable = await this.app.state.fileHandle.createWritable();
                await writable.write(blob); await writable.close();
                this.app.ui.toast('已保存到磁盘文件');
            } else {
                if (window.showSaveFilePicker) {
                    const handle = await window.showSaveFilePicker({
                        suggestedName: `${currentProjName}.mindflow.json`,
                        types: [{ description: 'MindFlow Files', accept: { 'application/json': ['.json', '.mindflow'] } }]
                    });
                    const writable = await handle.createWritable();
                    await writable.write(blob); await writable.close();
                    this.app.state.fileHandle = handle;
                    this.app.ui.toast('已另存为本地文件');
                } else {
                    this.fallbackDownload(blob, `${currentProjName}.mindflow.json`);
                }
            }
        } catch (err) {
            if (err.name !== 'AbortError') { console.error(err); this.app.ui.toast('保存到磁盘失败'); }
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
                if (!json.project) throw new Error('无效的项目文件');
                const newId = await this.importExternalProject(json.project);
                await this.loadProject(newId);
            } catch (err) {
                this.app.ui.toast('导入失败: ' + err.message);
            }
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
}