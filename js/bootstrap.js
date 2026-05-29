/**
 * MindFlow Bootstrap — 在 app.js 模块加载前执行的初始化逻辑。
 * 从 index.html 内联脚本提取，以支持更严格的 CSP（移除 unsafe-inline）。
 *
 * 注意：此文件在 <head> 中作为普通 <script> 加载（阻塞渲染），用于：
 * 1. 主题初始化（必须在 body 渲染前执行，防止亮→暗闪烁）
 *
 * 其余初始化（侧边栏、事件委托、SW 注册）在 <body> 结束前执行。
 */

// 主题初始化（防止闪烁，在 body 渲染前读取 localStorage）
if (localStorage.getItem('theme') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
}

// DOM 相关初始化（延迟到 DOM 解析完成）
document.addEventListener('DOMContentLoaded', () => {
    // 响应式侧边栏初始状态
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.toggle('closed', window.innerWidth < 768);
    }

    // Skip-link 焦点样式（从内联 onfocus/onblur 迁移）
    const skipLink = document.querySelector('.skip-link');
    if (skipLink) {
        skipLink.addEventListener('focus', () => { skipLink.style.left = '0'; });
        skipLink.addEventListener('blur', () => { skipLink.style.left = '-9999px'; });
    }

    // 事件委托：处理原本在 HTML 中的内联事件处理器
    document.addEventListener('input', (e) => {
        if (e.target.matches('.search-input') && window.app?.ui?.filterResources) {
            app.ui.filterResources(e.target.value);
        }
        if (e.target.matches('#nodeSearchInput') && window.app?.ui?.searchNodes) {
            app.ui.searchNodes(e.target.value);
        }
    });

    document.addEventListener('change', (e) => {
        if (e.target.matches('.sort-select') && window.app?.ui?.setSortMode) {
            app.ui.setSortMode(e.target.value);
        }
        if (e.target.matches('#resType') && window.app?.ui?.toggleResInput) {
            app.ui.toggleResInput();
        }
    });
});

// Service Worker 注册
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(registration => {
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    if (!newWorker) return;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            // 新版本已安装，提示用户刷新
                            if (window.app?.ui?.toast) {
                                app.ui.toast('新版本已就绪，刷新页面以更新', 'success');
                            }
                        }
                    });
                });
            })
            .catch(err => { console.error('SW Registration Failed:', err); });
    });
}
