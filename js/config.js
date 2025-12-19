export const config = {
    appVersion: '3.3.0', // 版本号提升
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
    colors: {
        primary: '#6366f1',
        surface: '#ffffff',
        outline: '#e2e8f0',
        textMain: '#1f2937',
        textLight: '#ffffff',
        selection: '#818cf8',
        link: '#cbd5e1'
    }
};