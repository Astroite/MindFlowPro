/**
 * Data Module
 * 职责：纯粹的数据操作 (CRUD)。
 */
export class DataModule {
    /**
     * @param {import('../types.js').App} app
     */
    constructor(app) {
        this.app = app;
    }

    // --- 资源工厂与规范化 ---

    _createResourceObject(data) {
        const timestamp = Date.now();
        return {
            id: data.id || `res_${timestamp}_${Math.random().toString(36).substr(2, 9)}`,
            // @ts-ignore
            type: data.type || 'unknown',
            name: data.name || '未命名资源',
            content: data.content || null,
            parentId: data.parentId || null,
            created: data.created || timestamp,
            updated: timestamp,
            tags: data.tags || []
        };
    }

    // 自愈修复
    normalizeResources() {
        let fixedCount = 0;
        this.app.state.resources = this.app.state.resources.map(res => {
            if (!res.id) {
                res.id = `res_${Date.now()}_fix_${Math.random().toString(36).substr(2, 5)}`;
                fixedCount++;
            }
            if (res.parentId === undefined) {
                res.parentId = null;
            }
            if (!res.tags) res.tags = [];
            return res;
        });

        if (fixedCount > 0) {
            console.warn(`[Data] Auto-fixed ${fixedCount} corrupted resources.`);
            this.app.storage.triggerSave();
        }
    }

    // --- [Feature 1] Undo / Redo ---

    _snapshot() {
        if (!this.app.state.currentId) return;
        const snap = JSON.stringify({
            nodes: this.app.state.nodes.map(n => ({
                id: n.id, type: n.type, x: n.x || 0, y: n.y || 0, label: n.label, resId: n.resId, color: n.color, note: n.note
            })),
            links: this.app.state.links.map(l => ({
                source: typeof l.source === 'object' ? l.source.id : l.source,
                target: typeof l.target === 'object' ? l.target.id : l.target,
                type: l.type
            }))
        });
        this.app.state.undoStack.push(snap);
        if (this.app.state.undoStack.length > 50) this.app.state.undoStack.shift();
        this.app.state.redoStack = []; // clear redo on new action
    }

    _restoreSnapshot(snap) {
        const { nodes, links } = JSON.parse(snap);
        this.app.state.nodes = nodes.map(n => ({ ...n, scale: 1 }));
        this.app.state.links = JSON.parse(JSON.stringify(links));
        this.app.state.selectedNodes.clear();
        this.app.state.selectedLink = null;
        this.app.ui.hideNodeBubble();
        this.app.graph.updateSimulation();
        this.app.storage.triggerSave();
    }

    undo() {
        if (this.app.state.undoStack.length === 0) return this.app.eventBus.emit('toast', { msg: '没有可撤销的操作' });
        // Save current as redo
        const current = JSON.stringify({
            nodes: this.app.state.nodes.map(n => ({ id: n.id, type: n.type, x: n.x || 0, y: n.y || 0, label: n.label, resId: n.resId, color: n.color, note: n.note })),
            links: this.app.state.links.map(l => ({ source: typeof l.source === 'object' ? l.source.id : l.source, target: typeof l.target === 'object' ? l.target.id : l.target, type: l.type }))
        });
        this.app.state.redoStack.push(current);
        const snap = this.app.state.undoStack.pop();
        this._restoreSnapshot(snap);
        this.app.eventBus.emit('toast', { msg: '已撤销' });
    }

    redo() {
        if (this.app.state.redoStack.length === 0) return this.app.eventBus.emit('toast', { msg: '没有可重做的操作' });
        const current = JSON.stringify({
            nodes: this.app.state.nodes.map(n => ({ id: n.id, type: n.type, x: n.x || 0, y: n.y || 0, label: n.label, resId: n.resId, color: n.color, note: n.note })),
            links: this.app.state.links.map(l => ({ source: typeof l.source === 'object' ? l.source.id : l.source, target: typeof l.target === 'object' ? l.target.id : l.target, type: l.type }))
        });
        this.app.state.undoStack.push(current);
        const snap = this.app.state.redoStack.pop();
        this._restoreSnapshot(snap);
        this.app.eventBus.emit('toast', { msg: '已重做' });
    }

    // --- 资源操作 ---

    createFolder(name, parentId = null) {
        if (!this.app.state.currentId) return;
        this._snapshot();
        const folder = this._createResourceObject({
            type: 'folder',
            name: name,
            id: 'folder_' + Date.now(),
            parentId
        });
        this.app.state.resources.push(folder);
        this._notifyResourceUpdate();
    }

    renameFolder(id, newName) {
        const folder = this.app.state.resources.find(r => r.id === id);
        if (!folder || !newName || newName.trim() === '' || newName === folder.name) return;

        this._snapshot();
        folder.name = newName.trim();
        folder.updated = Date.now();
        this._notifyResourceUpdate('文件夹已重命名');
    }

    moveResource(resId, parentId) {
        const res = this.app.state.resources.find(r => r.id === resId);
        if (!res || res.id === parentId) return;

        // Cycle check for folders
        if (res.type === 'folder' && parentId) {
            let checkId = parentId;
            while (checkId) {
                if (checkId === resId) {
                    this.app.eventBus.emit('toast', { msg: '不能将文件夹移入其子文件夹' });
                    return;
                }
                const parent = this.app.state.resources.find(r => r.id === checkId);
                checkId = parent ? parent.parentId : null;
            }
        }

        this._snapshot();
        res.parentId = parentId;
        res.updated = Date.now();
        if (parentId) this.app.state.expandedFolders.add(parentId);

        this._notifyResourceUpdate();
    }

    saveResource(resourceData) {
        this._snapshot();
        const { id, ...restData } = resourceData;

        if (id) {
            const res = this.app.state.resources.find(r => r.id === id);
            if (res) {
                Object.assign(res, restData);
                res.updated = Date.now();
                this._notifyResourceUpdate('资源已更新');
            } else {
                this._addNewResource({ id, ...restData });
            }
        } else {
            this._addNewResource(restData);
        }
    }

    _addNewResource(data) {
        const newRes = this._createResourceObject(data);
        this.app.state.resources.push(newRes);
        this._notifyResourceUpdate('资源已添加');
    }

    deleteResource(id) {
        const res = this.app.state.resources.find(r => r.id === id);
        if (!res) return;

        this._snapshot();

        const collectIds = (folderId) => {
            const ids = [folderId];
            this.app.state.resources
                .filter(r => r.parentId === folderId)
                .forEach(c => {
                    if (c.type === 'folder') ids.push(...collectIds(c.id));
                    else ids.push(c.id);
                });
            return ids;
        };

        const idsToDelete = res.type === 'folder' ? collectIds(id) : [id];

        this.app.state.nodes.forEach(n => {
            if (n.resId && idsToDelete.includes(n.resId)) n.resId = null;
        });
        this.app.state.resources = this.app.state.resources.filter(r => !idsToDelete.includes(r.id));

        const msg = idsToDelete.length > 1 ? `已删除文件夹及 ${idsToDelete.length - 1} 个内容` : '资源已删除';
        this._notifyResourceUpdate(msg);
    }

    // --- 节点操作 ---

    updateNode(nodeId, data) {
        this._snapshot();
        const node = this.app.state.nodes.find(n => n.id === nodeId);
        if (node) {
            if (data.label !== undefined) node.label = data.label;
            if (data.resId !== undefined) node.resId = data.resId;
            if (data.color !== undefined) node.color = data.color;
            if (data.note !== undefined) node.note = data.note;

            this.app.graph.needsRender = true;
            this.app.storage.triggerSave();
            this.app.eventBus.emit('toast', { msg: '节点已保存' });
        }
    }

    deleteNodes(nodeIds) {
        if (!nodeIds || nodeIds.length === 0) return;

        this._snapshot();
        this.app.state.nodes = this.app.state.nodes.filter(n => !nodeIds.includes(n.id));

        const deadNodeSet = new Set(nodeIds);
        const survivingLinks = [];
        const potentialOrphans = new Set();

        this.app.state.links.forEach(l => {
            // @ts-ignore
            const sId = l.source.id || l.source;
            // @ts-ignore
            const tId = l.target.id || l.target;

            const sourceIsDead = deadNodeSet.has(sId);
            const targetIsDead = deadNodeSet.has(tId);

            if (sourceIsDead && !targetIsDead) {
                potentialOrphans.add(tId);
            } else if (!sourceIsDead && !targetIsDead) {
                survivingLinks.push(l);
            }
        });

        this.app.state.links = survivingLinks;

        potentialOrphans.forEach(orphanId => {
            // @ts-ignore
            const hasIncoming = this.app.state.links.some(l => (l.target.id || l.target) === orphanId);
            if (!hasIncoming) {
                const orphan = this.app.state.nodes.find(n => n.id === orphanId);
                if (orphan) {
                    orphan.type = 'root';
                    orphan.scale = 1;
                }
            }
        });

        this.app.graph.updateSimulation();
        this.app.storage.triggerSave();

        const msg = nodeIds.length > 1 ? `已删除 ${nodeIds.length} 个节点` : '节点已删除';
        this.app.eventBus.emit('toast', { msg });
        this.app.eventBus.emit('nodes:deleted');
    }

    // --- 连线操作 ---

    addCrossLink(sourceId, targetId) {
        if (sourceId === targetId) return;

        // 检查是否已存在
        const exists = this.app.state.links.some(l => {
            const s = typeof l.source === 'object' ? l.source.id : l.source;
            const t = typeof l.target === 'object' ? l.target.id : l.target;
            return (s === sourceId && t === targetId) || (s === targetId && t === sourceId);
        });

        if (exists) {
            this.app.eventBus.emit('toast', { msg: '连线已存在' });
            return;
        }

        this._snapshot();
        this.app.state.links.push({
            source: sourceId,
            target: targetId,
            type: 'cross'
        });

        this.app.graph.updateSimulation();
        this.app.storage.triggerSave();
        this.app.eventBus.emit('toast', { msg: '飞线已创建' });
    }

    // [New] 删除飞线
    deleteLink(link) {
        if (!link) return;
        this._snapshot();
        this.app.state.links = this.app.state.links.filter(l => l !== link);
        this.app.state.selectedLink = null;
        this.app.graph.updateSimulation();
        this.app.storage.triggerSave();
        this.app.eventBus.emit('toast', { msg: '连线已删除' });
    }

    // --- 项目操作 ---

    renameProject(name) {
        if (!this.app.state.currentId) {
            this.app.eventBus.emit('toast', { msg: '请先创建项目', type: 'error' });
            return;
        }
        if (name.trim()) {
            this.app.storage.renameProject(this.app.state.currentId, name.trim());
        }
    }

    _notifyResourceUpdate(toastMsg) {
        this.app.eventBus.emit('resources:updated');
        this.app.storage.triggerSave();
        if (toastMsg) this.app.eventBus.emit('toast', { msg: toastMsg });
    }
}
