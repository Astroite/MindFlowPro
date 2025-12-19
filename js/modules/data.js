/**
 * Data Module (Robust & Normalized)
 * 职责：纯粹的数据操作 (CRUD)。
 * 优化：增加资源格式规范化和脏数据修复能力。
 */
export class DataModule {
    constructor(app) {
        this.app = app;
    }

    // --- 资源工厂与规范化 (Factory & Normalization) ---

    /**
     * 创建标准化的资源对象
     * @param {Object} data - 原始数据
     * @returns {Object} 标准化后的资源对象
     */
    _createResourceObject(data) {
        const timestamp = Date.now();
        return {
            id: data.id || `res_${timestamp}_${Math.random().toString(36).substr(2, 9)}`,
            type: data.type || 'unknown',
            name: data.name || '未命名资源',
            content: data.content || null,
            parentId: data.parentId || null,
            created: data.created || timestamp,
            updated: timestamp // 每次保存更新时间
        };
    }

    /**
     * 检查并修复资源列表中的脏数据 (Self-Healing)
     */
    normalizeResources() {
        let fixedCount = 0;
        this.app.state.resources = this.app.state.resources.map(res => {
            // 修复 1: 缺少 ID 或 ID 为 null
            if (!res.id) {
                res.id = `res_${Date.now()}_fix_${Math.random().toString(36).substr(2, 5)}`;
                fixedCount++;
            }
            // 修复 2: 确保 parentId 字段存在
            if (res.parentId === undefined) {
                res.parentId = null;
            }
            return res;
        });

        if (fixedCount > 0) {
            console.warn(`[Data] Auto-fixed ${fixedCount} corrupted resources.`);
            this.app.storage.triggerSave(); // 保存修复后的数据
        }
    }

    // --- 资源操作 ---

    createFolder(name) {
        if(!this.app.state.currentId) return;
        const folder = this._createResourceObject({
            type: 'folder',
            name: name,
            id: 'folder_' + Date.now()
        });
        this.app.state.resources.push(folder);

        this._notifyResourceUpdate();
    }

    renameFolder(id, newName) {
        const folder = this.app.state.resources.find(r => r.id === id);
        if (!folder || !newName || newName.trim() === '' || newName === folder.name) return;

        folder.name = newName.trim();
        folder.updated = Date.now();
        this._notifyResourceUpdate('文件夹已重命名');
    }

    moveResource(resId, parentId) {
        const res = this.app.state.resources.find(r => r.id === resId);
        if (!res || res.type === 'folder' || res.id === parentId) {
            if (res && res.type === 'folder') {
                this.app.eventBus.emit('toast', { msg: '暂不支持移动文件夹' });
            }
            return;
        }
        res.parentId = parentId;
        res.updated = Date.now();
        if (parentId) this.app.state.expandedFolders.add(parentId);

        this._notifyResourceUpdate();
    }

    // 添加或更新资源
    saveResource(resourceData) {
        // resourceData: { id (optional/null), type, name, content, parentId }

        // [修复] 显式分离 id，防止 null id 覆盖新生成的 id
        const { id, ...restData } = resourceData;

        if (id) {
            // --- 更新模式 ---
            const res = this.app.state.resources.find(r => r.id === id);
            if (res) {
                // 只更新变动的字段
                Object.assign(res, restData);
                res.updated = Date.now();
                this._notifyResourceUpdate('资源已更新');
            } else {
                // ID 存在但找不到资源？视为新增（极罕见情况）
                this._addNewResource({ id, ...restData });
            }
        } else {
            // --- 新增模式 ---
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

        let idsToDelete = [id];
        if (res.type === 'folder') {
            const children = this.app.state.resources.filter(r => r.parentId === id);
            children.forEach(c => idsToDelete.push(c.id));
        }

        let updateNodes = false;
        this.app.state.nodes.forEach(n => {
            if (n.resId && idsToDelete.includes(n.resId)) {
                n.resId = null;
                updateNodes = true;
            }
        });

        this.app.state.resources = this.app.state.resources.filter(r => !idsToDelete.includes(r.id));

        const msg = idsToDelete.length > 1 ? `已删除文件夹及 ${idsToDelete.length-1} 个文件` : '资源已删除';
        this._notifyResourceUpdate(msg);
    }

    // --- 节点操作 ---

    updateNode(nodeId, data) {
        const node = this.app.state.nodes.find(n => n.id === nodeId);
        if (node) {
            if (data.label !== undefined) node.label = data.label;
            if (data.resId !== undefined) node.resId = data.resId;

            this.app.storage.triggerSave();
            this.app.eventBus.emit('toast', { msg: '节点已保存' });
        }
    }

    deleteNodes(nodeIds) {
        if (!nodeIds || nodeIds.length === 0) return;

        this.app.state.nodes = this.app.state.nodes.filter(n => !nodeIds.includes(n.id));

        const deadNodeSet = new Set(nodeIds);
        const survivingLinks = [];
        const potentialOrphans = new Set();

        this.app.state.links.forEach(l => {
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

        this.app.state.links = survivingLinks;

        potentialOrphans.forEach(orphanId => {
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

    // --- 项目操作 (代理到 storage) ---
    // 虽然重构建议 data 模块只管数据，但 renameProject 属于业务逻辑，放在这里或 Storage 都可以。
    // 为了保持一致性，我们在这里做逻辑校验，然后调用 storage。

    renameProject(name) {
        if(!this.app.state.currentId) {
            this.app.eventBus.emit('toast', { msg: '请先创建项目', type: 'error' });
            return;
        }
        if(name.trim()) {
            this.app.storage.renameProject(this.app.state.currentId, name.trim());
        }
    }

    // --- 内部辅助 ---
    _notifyResourceUpdate(toastMsg) {
        this.app.eventBus.emit('resources:updated');
        this.app.storage.triggerSave();
        if (toastMsg) this.app.eventBus.emit('toast', { msg: toastMsg });
    }
}