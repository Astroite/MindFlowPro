/**
 * MindFlow - App Logic (Fully Modularized Phase 3)
 * 版本: 3.4.1
 * 架构：ES Modules + Event Bus + Separation of Concerns
 */

import { config } from './config.js';
import { utils } from './utils.js';
import { EventBus } from './modules/eventBus.js';
import { StorageModule } from './modules/storage.js';
import { GraphModule } from './modules/graph.js';
import { DataModule } from './modules/data.js';
import { UIModule } from './modules/ui.js';

// 引入类型定义（不需要在运行时 import，只需在注释中引用）
/** @typedef {import('./types.js').App} App */

/** @type {App} */
const app = {
    // --- 注入依赖 ---
    config,
    utils,

    // --- 子模块 (在 init 中实例化) ---
    eventBus: null,
    storage: null,
    graph: null,
    data: null,
    ui: null,

    // --- DOM 缓存 ---
    dom: {},

    // --- 全局状态 (单一事实来源) ---
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
        saveTimer: null,

        // [New] 飞线相关状态
        showCrossLinks: true,
        isLinking: false,
        linkingSourceNode: null,
        selectedLink: null // 当前选中的连线
    },

    init: async function() {
        console.log("MindFlow initializing...");

        // 1. 初始化 DOM 引用
        this.dom = {
            resList: document.getElementById('resList'),
            projSelect: document.getElementById('projSelect'),
            projTitleInput: document.getElementById('projTitleInput'),
            saveStatus: document.getElementById('saveStatus'),
            canvasWrapper: document.getElementById('canvasWrapper'),
            mainCanvas: document.getElementById('mainCanvas'),
            nodeMenu: document.getElementById('nodeMenu'),
            nodeBubble: document.getElementById('nodeBubble'),
            toast: document.getElementById('toast')
        };

        // 2. 实例化核心模块
        this.eventBus = new EventBus();

        // 注入 this (app) 到所有模块，实现简单的依赖注入
        // @ts-ignore - 初始化时允许传尚未完全构建的 app
        this.storage = new StorageModule(this);
        // @ts-ignore
        this.graph = new GraphModule(this);
        // @ts-ignore
        this.data = new DataModule(this);
        // @ts-ignore
        this.ui = new UIModule(this);

        // 3. 模块初始化
        // 顺序很重要：UI 绑定事件 -> Storage 加载数据 -> Graph 准备渲染
        await this.ui.init();
        await this.storage.init();
        await this.graph.init();

        // [新增] 自动加载上次打开的项目
        const lastProjId = this.storage.getLastOpenedProjectId();
        if (lastProjId) {
            // 检查该 ID 是否依然在索引中存在（防止已被删除）
            const exists = this.state.projectsIndex.some(p => p.id === lastProjId);
            if (exists) {
                await this.storage.loadProject(lastProjId);
                console.log("Auto-loaded project:", lastProjId);
            } else {
                localStorage.removeItem('lastOpenedProjectId');
            }
        }

        console.log("MindFlow Ready.");
    }
};

// 全局暴露
// @ts-ignore
window.app = app;
// @ts-ignore
window.onload = () => app.init();
