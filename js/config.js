export const config = {
    appVersion: '4.19.0',
    dataVersion: 1, // 项目数据模型版本，用于迁移
    workspaceProjectFile: 'project.mindflow.json',
    workspaceAssetsDir: 'assets',
    nodeRadius: 40,
    subRadius: 30,
    linkDistance: 150,
    chargeStrength: -300,
    collideRadius: 55,
    dbName: 'MindFlowDB',
    storeName: 'projects',
    previewDelay: 50,
    maxImageSizeMB: 5, // 图片上传限制 (MB)
    saveDebounceMs: 1000, // 自动保存防抖时间 (ms)

    // Toast
    toastDuration: 3000,
    toastAnimationMs: 300,
    maxVisibleToasts: 3,

    // Undo/redo
    undoLimit: 50,
    pasteOffset: 30,
    newNodeScale: 0.1,

    // ID prefixes
    idPrefix: { node: 'n_', resource: 'res_', folder: 'folder_', project: 'proj_' },

    // Resource type icon names from icons.js
    resIcons: { md: 'fileText', code: 'code', audio: 'audio', link: 'link' },
    resIconsUI: { md: 'fileText', code: 'code', audio: 'audio', link: 'link', color: 'palette', image: 'image', folder: 'folder' },

    // Canvas interaction
    hitRadius: 15,          // plus button hit radius (px)
    visPadding: 500,        // link visibility padding (px)
    selectThreshold: 5,     // min box-selection size (px)
    alphaTarget: 0.3,       // D3 simulation reheat on drag
    alphaDecay: 0.05,       // D3 simulation cool-down speed (default 0.0228, higher = faster settle)
    velocityDecay: 0.4,     // D3 velocity damping (default 0.4)
    cornerRatio: 0.35,      // rounded rect corner / radius
    diagOffset: 0.707,      // cos(45°) for diagonal button placement
    resizeDebounceMs: 100,  // resize observer debounce (ms)

    // Force simulation multipliers
    rootChargeMultiplier: 3,    // root node charge = chargeStrength * this
    rootCollideMultiplier: 1.5, // root node collide radius = collideRadius * this
    centerForceStrength: 0.01,  // centering force (x/y) strength

    // Rendering
    linkLineWidth: 1.5,     // link stroke width (px)

    // Node creation
    newNodeSpread: 50,      // random offset for new root nodes (px)
    childNodeOffset: 10,    // distance from parent for child nodes (px)
    childNodeScale: 0.05,   // initial scale for child nodes
    dropNodeSpread: 20,     // random offset for drop-created nodes (px)

    // Inline editing
    labelYOffset: 15,       // label Y offset below node (px)
    inlineEditWidth: 120,   // inline edit input width (px)

    // Camera
    camZoomMin: 0.1,
    camZoomMax: 5,
    zoomInFactor: 1.1,
    zoomOutFactor: 0.9,

    colors: {
        primary: '#24566f',
        surface: '#fffaf0',
        outline: '#d6c8a8',
        textMain: '#263239',
        textLight: '#fffaf0',
        selection: '#b88a3d',
        link: '#8ba08a',
        cross: '#b64b38'
    },
    cardWidth: 120,
    cardHeight: 80,
    cardImageRatio: 0.6,
    cardRatios: {
        '1:1':  { w: 100, h: 100 },
        '3:4':  { w: 90,  h: 120 },
        '4:3':  { w: 120, h: 90  },
        '16:9': { w: 128, h: 72  }
    },
    // Bezier cross-link rendering
    bezierOffsetFactor: 0.2,    // curve offset = dist * this
    bezierMaxOffset: 150,       // max curve offset (px)
    bezierSampleMin: 10,        // min hit-test sample points
    bezierSampleMax: 200,       // max hit-test sample points

    // Minimap
    minimapWidth: 160,
    minimapHeight: 100,
    minimapPadding: 12,

    // Export
    exportMaxSize: 16384,       // max export canvas dimension (px)
    exportPadding: 50,          // export canvas padding (px)
    maxResourceSize: 10 * 1024 * 1024, // per-resource content limit (10MB)

    // Node visibility
    visNodePadding: 100,        // off-screen culling padding (px)

    // Canvas fonts
    fontBold: '700 18px "Segoe UI", sans-serif',
    fontNormal: '14px "Segoe UI", sans-serif',

    // Camera animation
    cameraAnimDuration: 300,    // search-result pan animation (ms)

    // Image cache
    imageCacheMaxSize: 100,     // max cached images (LRU eviction)

    colorsDark: {
        primary: '#8fb8c6',
        surface: '#242927',
        outline: '#4f584b',
        textMain: '#f2eadc',
        textLight: '#19201e',
        selection: '#d2aa61',
        link: '#7d8b72',
        cross: '#d57963'
    }
};
