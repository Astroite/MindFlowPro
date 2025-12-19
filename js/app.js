/**
 * MindFlow - App Logic (Fully Modularized Phase 3)
 * 版本: 3.2.0
 * 架构：ES Modules + Event Bus + Separation of Concerns
 */

import { config } from './config.js';
import { utils } from './utils.js';
import { EventBus } from './modules/eventBus.js';
import { StorageModule } from './modules/storage.js';
import { GraphModule } from './modules/graph.js';
import { DataModule } from './modules/data.js';
import { UIModule } from './modules/ui.js';

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
        saveTimer: null
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
        this.storage = new StorageModule(this);
        this.graph = new GraphModule(this);
        this.data = new DataModule(this);
        this.ui = new UIModule(this);

        // 3. 模块初始化
        // 顺序很重要：UI 绑定事件 -> Storage 加载数据 -> Graph 准备渲染
        await this.ui.init();
        await this.storage.init();
        await this.graph.init();

        console.log("MindFlow Ready.");
    }
};

// 全局暴露，确保 HTML 中的 onclick="app.ui.xxx()" 能正常工作
window.app = app;
window.onload = () => app.init();
