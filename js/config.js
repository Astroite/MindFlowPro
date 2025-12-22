export const config = {
    appVersion: '3.3.2', // 版本号提升
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
    },
    colorsDark: {
        primary: '#818cf8',    // 深色模式下稍微亮一点的主色
        surface: '#27272a',    // 深灰色表面
        outline: '#3f3f46',
        textMain: '#f3f4f6',   // 浅色文字
        textLight: '#1f2937',  // 深色文字（用于浅色背景时）
        selection: '#6366f1',
        link: '#52525b'
    }
};