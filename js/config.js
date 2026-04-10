export const config = {
    appVersion: '4.5',
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

    // Undo/redo
    undoLimit: 50,
    pasteOffset: 30,
    newNodeScale: 0.1,

    // ID prefixes
    idPrefix: { node: 'n_', resource: 'res_', folder: 'folder_', project: 'proj_' },

    // Resource type icons
    resIcons: { md: '📝', code: '💻', audio: '🎵', link: '🔗' },
    resIconsUI: { md: '📝', code: '💻', audio: '🎤', link: '🔗', color: '🎨', image: '🖼️', folder: '📁' },

    // Canvas interaction
    hitRadius: 15,          // plus button hit radius (px)
    visPadding: 500,        // link visibility padding (px)
    selectThreshold: 5,     // min box-selection size (px)
    alphaTarget: 0.3,       // D3 simulation reheat on drag
    cornerRatio: 0.35,      // rounded rect corner / radius
    diagOffset: 0.707,      // cos(45°) for diagonal button placement

    // Camera
    camZoomMin: 0.1,
    camZoomMax: 5,
    zoomInFactor: 1.1,
    zoomOutFactor: 0.9,

    colors: {
        primary: '#6366f1',
        surface: '#ffffff',
        outline: '#e2e8f0',
        textMain: '#1f2937',
        textLight: '#ffffff',
        selection: '#818cf8',
        link: '#cbd5e1',
        cross: '#445252'
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
    colorsDark: {
        primary: '#818cf8',
        surface: '#27272a',
        outline: '#3f3f46',
        textMain: '#f3f4f6',
        textLight: '#1f2937',
        selection: '#6366f1',
        link: '#52525b',
        cross: '#5d7070'
    }
};