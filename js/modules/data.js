/**
 * Data Module
 * 职责：纯粹的数据操作 (CRUD) + 增量 Undo/Redo 命令模式
 */
export class DataModule {
    static linkEnd(link, end) {
        const v = end === 'source' ? link.source : link.target;
        return typeof v === 'object' ? v.id : v;
    }

    _generateId(prefix) {
        return this.app.utils.genId(prefix);
    }

    /**
     * @param {import('../types.js').App} app
     */
    constructor(app) {
        this.app = app;
        this._clipboard = [];
        this._clipboardLinks = [];
    }

    // --- 资源工厂与规范化 ---

    _createResourceObject(data) {
        const timestamp = Date.now();
        return {
            id: data.id || this._generateId(this.app.config.idPrefix.resource),
            // @ts-ignore
            type: data.type || 'unknown',
            name: data.name || '未命名资源',
            content: data.content || null,
            fileRef: data.fileRef || null,
            mime: data.mime || null,
            size: data.size || null,
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
                res.id = this._generateId(this.app.config.idPrefix.resource);
                fixedCount++;
            }
            if (res.parentId === undefined) {
                res.parentId = null;
            }
            if (!res.tags) res.tags = [];
            if (res.fileRef === undefined) res.fileRef = null;
            return res;
        });

        if (fixedCount > 0) {
            console.warn(`[Data] Auto-fixed ${fixedCount} corrupted resources.`);
            this.app.storage.triggerSave();
        }
    }

    // --- Undo / Redo (增量命令模式) ---

    _pushCommand(cmd) {
        if (!this.app.state.currentId) return;
        this.app.state.undoStack.push(cmd);
        if (this.app.state.undoStack.length > this.app.config.undoLimit) this.app.state.undoStack.shift();
        this.app.state.redoStack = [];
    }

    _executeCommand(cmd, isUndo) {
        switch (cmd.type) {
            case 'addNode': {
                if (isUndo) {
                    this.app.state.nodes = this.app.state.nodes.filter(n => n.id !== cmd.node.id);
                    this.app.state.links = this.app.state.links.filter(l => {
                        const sId = DataModule.linkEnd(l, 'source');
                        const tId = DataModule.linkEnd(l, 'target');
                        return sId !== cmd.node.id && tId !== cmd.node.id;
                    });
                } else {
                    this.app.state.nodes.push({ ...cmd.node });
                }
                break;
            }
            case 'deleteNode': {
                if (isUndo) {
                    this.app.state.nodes.push({ ...cmd.node });
                    cmd.links.forEach(l => this.app.state.links.push({ ...l }));
                } else {
                    this.app.state.nodes = this.app.state.nodes.filter(n => n.id !== cmd.node.id);
                    const nodeIds = new Set([cmd.node.id]);
                    this.app.state.links = this.app.state.links.filter(l => {
                        const sId = DataModule.linkEnd(l, 'source');
                        const tId = DataModule.linkEnd(l, 'target');
                        return !nodeIds.has(sId) && !nodeIds.has(tId);
                    });
                }
                break;
            }
            case 'updateNode': {
                const node = this.app.state.nodes.find(n => n.id === cmd.id);
                if (node) {
                    const data = isUndo ? cmd.before : cmd.after;
                    Object.keys(data).forEach(k => { node[k] = data[k]; });
                }
                break;
            }
            case 'moveNodes': {
                cmd.deltas.forEach(d => {
                    const node = this.app.state.nodes.find(n => n.id === d.id);
                    if (node) {
                        if (isUndo) { node.x -= d.dx; node.y -= d.dy; }
                        else { node.x += d.dx; node.y += d.dy; }
                    }
                });
                break;
            }
            case 'batchDelete': {
                if (isUndo) {
                    cmd.nodes.forEach(n => this.app.state.nodes.push({ ...n }));
                    cmd.links.forEach(l => this.app.state.links.push({ ...l }));
                    // Demote orphans back to 'sub' now that their parent chain is restored
                    (cmd.promotedOrphans || []).forEach(o => {
                        const n = this.app.state.nodes.find(x => x.id === o.id);
                        if (n) n.type = o.beforeType;
                    });
                } else {
                    const deadIds = new Set(cmd.nodes.map(n => n.id));
                    this.app.state.nodes = this.app.state.nodes.filter(n => !deadIds.has(n.id));
                    this.app.state.links = this.app.state.links.filter(l => {
                        const sId = DataModule.linkEnd(l, 'source');
                        const tId = DataModule.linkEnd(l, 'target');
                        return !deadIds.has(sId) && !deadIds.has(tId);
                    });
                    // Re-apply orphan promotion on redo
                    (cmd.promotedOrphans || []).forEach(o => {
                        const n = this.app.state.nodes.find(x => x.id === o.id);
                        if (n) { n.type = 'root'; n.scale = 1; }
                    });
                }
                break;
            }
            case 'addLink': {
                if (isUndo) {
                    this.app.state.links = this.app.state.links.filter(l => {
                        const sId = DataModule.linkEnd(l, 'source');
                        const tId = DataModule.linkEnd(l, 'target');
                        return !(sId === cmd.link.source && tId === cmd.link.target);
                    });
                } else {
                    this.app.state.links.push({ ...cmd.link });
                }
                break;
            }
            case 'deleteLink': {
                if (isUndo) {
                    this.app.state.links.push({ ...cmd.link });
                } else {
                    this.app.state.links = this.app.state.links.filter(l => {
                        const sId = DataModule.linkEnd(l, 'source');
                        const tId = DataModule.linkEnd(l, 'target');
                        const cs = cmd.link.source;
                        const ct = cmd.link.target;
                        return !(sId === cs && tId === ct);
                    });
                }
                break;
            }
            case 'addResource': {
                if (isUndo) {
                    this.app.state.resources = this.app.state.resources.filter(r => r.id !== cmd.resource.id);
                } else {
                    this.app.state.resources.push({ ...cmd.resource });
                }
                this.app.eventBus.emit('resources:updated');
                break;
            }
            case 'deleteResource': {
                if (isUndo) {
                    cmd.resources.forEach(r => this.app.state.resources.push({ ...r }));
                } else {
                    const ids = new Set(cmd.resources.map(r => r.id));
                    this.app.state.resources = this.app.state.resources.filter(r => !ids.has(r.id));
                }
                this.app.eventBus.emit('resources:updated');
                break;
            }
            case 'updateResource': {
                const res = this.app.state.resources.find(r => r.id === cmd.id);
                if (res) {
                    const data = isUndo ? cmd.before : cmd.after;
                    const contentChanging = data.content !== undefined && data.content !== res.content;
                    const fileChanging = data.fileRef !== undefined && JSON.stringify(data.fileRef) !== JSON.stringify(res.fileRef || null);
                    Object.keys(data).forEach(k => { res[k] = data[k]; });
                    if ((contentChanging || fileChanging) && res.type === 'image' && this.app.graph && this.app.graph.imageCache) {
                        this.app.graph.imageCache.delete(res.id);
                    }
                    if ((contentChanging || fileChanging) && this.app.storage && this.app.storage.revokeResourceUrl) {
                        this.app.storage.revokeResourceUrl(res.id);
                    }
                }
                this.app.eventBus.emit('resources:updated');
                break;
            }
            case 'clearAll': {
                if (isUndo) {
                    cmd.nodes.forEach(n => this.app.state.nodes.push({ ...n }));
                    cmd.links.forEach(l => this.app.state.links.push({ ...l }));
                } else {
                    this.app.state.nodes = [];
                    this.app.state.links = [];
                }
                break;
            }
            case 'pasteNodes': {
                if (isUndo) {
                    const ids = new Set(cmd.newNodes.map(n => n.id));
                    this.app.state.nodes = this.app.state.nodes.filter(n => !ids.has(n.id));
                    this.app.state.links = this.app.state.links.filter(l => {
                        const sId = DataModule.linkEnd(l, 'source');
                        const tId = DataModule.linkEnd(l, 'target');
                        return !ids.has(sId) && !ids.has(tId);
                    });
                } else {
                    cmd.newNodes.forEach(n => this.app.state.nodes.push({ ...n }));
                    cmd.newLinks.forEach(l => this.app.state.links.push({ ...l }));
                }
                break;
            }
            case 'dropNode': {
                if (isUndo) {
                    const node = this.app.state.nodes.find(n => n.id === cmd.nodeId);
                    if (node) node.resId = cmd.beforeResId;
                } else {
                    const node = this.app.state.nodes.find(n => n.id === cmd.nodeId);
                    if (node) node.resId = cmd.afterResId;
                }
                break;
            }
        }

        this.app.state.selectedNodes.clear();
        this.app.state.selectedLink = null;
        this.app.ui.hideNodeBubble();
        this.app.graph.needsRender = true;
        this.app.graph.updateSimulation();
        this.app.storage.triggerSave();
    }

    undo() {
        if (this.app.state.undoStack.length === 0) return this.app.eventBus.emit('toast', { msg: '没有可撤销的操作' });
        const cmd = this.app.state.undoStack.pop();
        this.app.state.redoStack.push(cmd);
        this._executeCommand(cmd, true);
        this.app.eventBus.emit('toast', { msg: '已撤销' });
    }

    redo() {
        if (this.app.state.redoStack.length === 0) return this.app.eventBus.emit('toast', { msg: '没有可重做的操作' });
        const cmd = this.app.state.redoStack.pop();
        this.app.state.undoStack.push(cmd);
        this._executeCommand(cmd, false);
        this.app.eventBus.emit('toast', { msg: '已重做' });
    }

    // --- 资源操作 ---

    createFolder(name, parentId = null) {
        if (!this.app.state.currentId) return;
        const folder = this._createResourceObject({
            type: 'folder',
            name: name,
            id: this.app.config.idPrefix.folder + Date.now(),
            parentId
        });
        this._pushCommand({ type: 'addResource', resource: { ...folder } });
        this.app.state.resources.push(folder);
        this._notifyResourceUpdate();
    }

    renameFolder(id, newName) {
        const folder = this.app.state.resources.find(r => r.id === id);
        if (!folder || !newName || newName.trim() === '' || newName === folder.name) return;

        const before = { name: folder.name };
        folder.name = newName.trim();
        folder.updated = Date.now();
        this._pushCommand({ type: 'updateResource', id, before, after: { name: folder.name } });
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

        const beforeParentId = res.parentId;
        res.parentId = parentId;
        res.updated = Date.now();
        if (parentId) this.app.state.expandedFolders.add(parentId);
        this._pushCommand({ type: 'updateResource', id: resId, before: { parentId: beforeParentId }, after: { parentId } });
        this._notifyResourceUpdate();
    }

    saveResource(resourceData) {
        const { id, ...restData } = resourceData;

        if (id) {
            const res = this.app.state.resources.find(r => r.id === id);
            if (res) {
                const fields = ['name', 'content', 'fileRef', 'mime', 'size', 'type', 'parentId', 'tags'];
                const before = {};
                const after = {};
                fields.forEach(f => {
                    if (restData[f] !== undefined && JSON.stringify(restData[f]) !== JSON.stringify(res[f])) {
                        before[f] = res[f];
                        after[f] = restData[f];
                    }
                });
                if (Object.keys(after).length === 0) return;
                const contentChanged = after.content !== undefined && after.content !== before.content;
                const fileChanged = after.fileRef !== undefined && JSON.stringify(after.fileRef) !== JSON.stringify(before.fileRef || null);
                const isImage = (after.type || res.type) === 'image';
                Object.assign(res, after);
                res.updated = Date.now();
                // Invalidate image cache so nodes pointing to this resource re-render with new content
                if (isImage && (contentChanged || fileChanged) && this.app.graph && this.app.graph.imageCache) {
                    this.app.graph.imageCache.delete(res.id);
                }
                if ((contentChanged || fileChanged) && this.app.storage && this.app.storage.revokeResourceUrl) {
                    this.app.storage.revokeResourceUrl(res.id);
                }
                this._pushCommand({ type: 'updateResource', id, before, after });
                this._notifyResourceUpdate('资源已更新');
            } else {
                const newRes = this._createResourceObject({ id, ...restData });
                this._pushCommand({ type: 'addResource', resource: { ...newRes } });
                this.app.state.resources.push(newRes);
                this._notifyResourceUpdate('资源已添加');
            }
        } else {
            const newRes = this._createResourceObject(restData);
            this._pushCommand({ type: 'addResource', resource: { ...newRes } });
            this.app.state.resources.push(newRes);
            this._notifyResourceUpdate('资源已添加');
        }
    }

    deleteResource(id) {
        const res = this.app.state.resources.find(r => r.id === id);
        if (!res) return;

        const deletedResources = this._collectResourcesToDelete(id);
        this._pushCommand({ type: 'deleteResource', resources: deletedResources.map(r => ({ ...r })) });
        this._deleteResourceInternal(id);
        this._notifyResourceUpdate('资源已删除');
    }

    batchDeleteResources(ids) {
        if (!ids || ids.length === 0) return;
        const deletedResources = [];
        ids.forEach(id => {
            deletedResources.push(...this._collectResourcesToDelete(id));
        });
        // Deduplicate
        const seen = new Set();
        const unique = deletedResources.filter(r => {
            if (seen.has(r.id)) return false;
            seen.add(r.id);
            return true;
        });
        this._pushCommand({ type: 'deleteResource', resources: unique.map(r => ({ ...r })) });
        let totalDeleted = 0;
        ids.forEach(id => { totalDeleted += this._deleteResourceInternal(id); });
        const msg = totalDeleted > 1 ? `已删除 ${totalDeleted} 项资源` : '资源已删除';
        this._notifyResourceUpdate(msg);
    }

    _collectResourcesToDelete(id) {
        const res = this.app.state.resources.find(r => r.id === id);
        if (!res) return [];
        const collect = (folderId) => {
            const result = [];
            const self = this.app.state.resources.find(r => r.id === folderId);
            if (self) result.push(self);
            this.app.state.resources
                .filter(r => r.parentId === folderId)
                .forEach(c => {
                    if (c.type === 'folder') result.push(...collect(c.id));
                    else result.push(c);
                });
            return result;
        };
        return res.type === 'folder' ? collect(id) : [res];
    }

    // Internal: delete a single resource and its children (no snapshot)
    _deleteResourceInternal(id) {
        const res = this.app.state.resources.find(r => r.id === id);
        if (!res) return 0;

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
        if (this.app.storage && this.app.storage.revokeResourceUrl) {
            idsToDelete.forEach(resId => this.app.storage.revokeResourceUrl(resId));
        }
        this.app.state.resources = this.app.state.resources.filter(r => !idsToDelete.includes(r.id));

        return idsToDelete.length;
    }

    // --- 节点操作 ---

    updateNode(nodeId, data) {
        const node = this.app.state.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const fields = ['label', 'resId', 'color', 'note', 'shape', 'layout', 'texture', 'borderStyle', 'cardRatio'];
        const before = {};
        const after = {};
        fields.forEach(f => {
            if (data[f] !== undefined) {
                before[f] = node[f];
                after[f] = data[f];
            }
        });
        if (Object.keys(after).length === 0) return;

        this._pushCommand({ type: 'updateNode', id: nodeId, before, after });
        Object.assign(node, after);
        if (data.resId !== undefined) this.app.graph.nodeRenderer.preloadImage(data.resId);

        this.app.graph.needsRender = true;
        this.app.storage.triggerSave();
        this.app.eventBus.emit('toast', { msg: '节点已保存' });
    }

    deleteNodes(nodeIds) {
        if (!nodeIds || nodeIds.length === 0) return;

        // Collect nodes and their associated links before deletion
        const deadNodeSet = new Set(nodeIds);
        const deletedNodes = this.app.state.nodes.filter(n => deadNodeSet.has(n.id)).map(n => ({ ...n }));
        const deletedLinks = this.app.state.links.filter(l => {
            const sId = DataModule.linkEnd(l, 'source');
            const tId = DataModule.linkEnd(l, 'target');
            return deadNodeSet.has(sId) || deadNodeSet.has(tId);
        }).map(l => ({
            source: DataModule.linkEnd(l, 'source'),
            target: DataModule.linkEnd(l, 'target'),
            type: l.type
        }));

        // Identify orphans: surviving 'sub' nodes whose only incoming structure parent was deleted.
        const survivingLinks = this.app.state.links.filter(l => {
            const sId = DataModule.linkEnd(l, 'source');
            const tId = DataModule.linkEnd(l, 'target');
            return !deadNodeSet.has(sId) && !deadNodeSet.has(tId);
        });
        const hasStructureParent = new Set();
        survivingLinks.forEach(l => {
            if ((l.type || 'structure') !== 'structure') return;
            hasStructureParent.add(DataModule.linkEnd(l, 'target'));
        });
        const promotedOrphans = this.app.state.nodes
            .filter(n => !deadNodeSet.has(n.id) && n.type === 'sub' && !hasStructureParent.has(n.id))
            .map(n => ({ id: n.id, beforeType: n.type }));

        this._pushCommand({
            type: 'batchDelete',
            nodes: deletedNodes,
            links: deletedLinks,
            promotedOrphans
        });

        // [P0-4] Animate nodes shrinking before removal
        nodeIds.forEach(id => {
            const node = this.app.state.nodes.find(n => n.id === id);
            if (node) node._deleting = true;
        });

        this.app.graph.needsRender = true;

        // Immediately handle link removal + orphan promotion in the data model
        this.app.state.links = survivingLinks;
        promotedOrphans.forEach(o => {
            const n = this.app.state.nodes.find(x => x.id === o.id);
            if (n) { n.type = 'root'; n.scale = 1; }
        });

        const msg = nodeIds.length > 1 ? `已删除 ${nodeIds.length} 个节点` : '节点已删除';
        this.app.eventBus.emit('toast', { msg });
        this.app.eventBus.emit('nodes:deleted');
    }

    // --- 连线操作 ---

    addCrossLink(sourceId, targetId) {
        if (sourceId === targetId) return;

        // 检查是否已存在
        const exists = this.app.state.links.some(l => {
            const s = DataModule.linkEnd(l, 'source');
            const t = DataModule.linkEnd(l, 'target');
            return (s === sourceId && t === targetId) || (s === targetId && t === sourceId);
        });

        if (exists) {
            this.app.eventBus.emit('toast', { msg: '连线已存在' });
            return;
        }

        const link = { source: sourceId, target: targetId, type: 'cross' };
        this._pushCommand({ type: 'addLink', link: { ...link } });
        this.app.state.links.push(link);

        this.app.graph.updateSimulation();
        this.app.storage.triggerSave();
        this.app.eventBus.emit('toast', { msg: '飞线已创建' });
    }

    deleteLink(link) {
        if (!link) return;
        const linkData = {
            source: DataModule.linkEnd(link, 'source'),
            target: DataModule.linkEnd(link, 'target'),
            type: link.type
        };
        this._pushCommand({ type: 'deleteLink', link: linkData });
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

    // [P0-5] Copy selected nodes to clipboard
    copySelectedNodes() {
        if (this.app.state.selectedNodes.size === 0) return;
        const nodesToCopy = this.app.state.nodes.filter(n => this.app.state.selectedNodes.has(n.id));
        if (nodesToCopy.length === 0) return;

        // Store node data (excluding position, which will be offset on paste)
        this._clipboard = nodesToCopy.map(n => ({
            id: n.id, type: n.type, label: n.label, resId: n.resId,
            color: n.color, note: n.note, x: n.x, y: n.y,
            shape: n.shape, texture: n.texture, layout: n.layout,
            borderStyle: n.borderStyle, cardRatio: n.cardRatio
        }));

        // Also store links between copied nodes
        const copiedIds = new Set(nodesToCopy.map(n => n.id));
        this._clipboardLinks = this.app.state.links
            .filter(l => {
                const sId = DataModule.linkEnd(l, 'source');
                const tId = DataModule.linkEnd(l, 'target');
                return copiedIds.has(sId) && copiedIds.has(tId);
            })
            .map(l => ({
                source: DataModule.linkEnd(l, 'source'),
                target: DataModule.linkEnd(l, 'target'),
                type: l.type
            }));

        this.app.eventBus.emit('toast', { msg: `已复制 ${nodesToCopy.length} 个节点` });
    }

    // [P0-5] Paste clipboard nodes at offset position
    pasteNodes(offsetX, offsetY) {
        const off = this.app.config.pasteOffset;
        if (offsetX === undefined) offsetX = off;
        if (offsetY === undefined) offsetY = off;
        if (!this._clipboard || this._clipboard.length === 0) {
            return this.app.eventBus.emit('toast', { msg: '剪贴板为空' });
        }

        // Generate new IDs for pasted nodes
        const idMap = {};
        const newNodes = this._clipboard.map(n => {
            const newId = this._generateId(this.app.config.idPrefix.node);
            idMap[n.id] = newId;
            return {
                id: newId, type: n.type, label: n.label || '未命名',
                resId: n.resId, color: n.color, note: n.note,
                x: (n.x || 0) + offsetX, y: (n.y || 0) + offsetY, scale: 0.1,
                shape: n.shape, texture: n.texture, layout: n.layout,
                borderStyle: n.borderStyle, cardRatio: n.cardRatio
            };
        });

        // Paste links between pasted nodes with new IDs
        const newLinks = (this._clipboardLinks || []).map(l => ({
            source: idMap[l.source] || l.source,
            target: idMap[l.target] || l.target,
            type: l.type
        }));

        this._pushCommand({ type: 'pasteNodes', newNodes: newNodes.map(n => ({ ...n })), newLinks: newLinks.map(l => ({ ...l })) });
        this.app.state.nodes.push(...newNodes);
        this.app.state.links.push(...newLinks);

        // Select the newly pasted nodes
        this.app.state.selectedNodes.clear();
        newNodes.forEach(n => this.app.state.selectedNodes.add(n.id));

        this.app.graph.updateSimulation();
        this.app.storage.triggerSave();
        this.app.eventBus.emit('toast', { msg: `已粘贴 ${newNodes.length} 个节点` });
    }

    // [P0-5] Duplicate selected nodes (copy + paste with offset)
    duplicateSelectedNodes() {
        if (this.app.state.selectedNodes.size === 0) return;
        this.copySelectedNodes();
        this.pasteNodes(30, 30);
    }
}
