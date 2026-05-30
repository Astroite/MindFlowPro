// [重要] 每次修改了代码想要发布给用户，必须修改这里的版本号！
// 比如改为 'mindflow-v1.2', 'mindflow-v1.3' 等
const CACHE_NAME = 'mindflow-v4.17.0';

const ASSETS_TO_CACHE = [
    './',
    './index.html',

    './css/style.css',

    './js/app.js',
    './js/bootstrap.js',
    './js/config.js',
    './js/utils.js',
    './js/types.js',
    './js/modules/data.js',
    './js/modules/eventBus.js',
    './js/modules/graph.js',
    './js/modules/storage.js',
    './js/modules/ui.js',

    './js/modules/graph/NodeRenderer.js',
    './js/modules/graph/LinkRenderer.js',
    './js/modules/graph/MinimapRenderer.js',
    './js/modules/graph/ExportManager.js',

    './js/modules/ui/NodeEditor.js',
    './js/modules/ui/NodeSearch.js',
    './js/modules/ui/TooltipManager.js',

    './js/lib/d3.v7.min.js',
    './js/lib/localforage.min.js',
    './js/lib/marked.min.js',
    './js/lib/purify.min.js',

    './icons/icon-192.png',
    './icons/icon-512.png'
];

// 安装 SW
self.addEventListener('install', (event) => {
    // @ts-ignore
    self.skipWaiting();

    // @ts-ignore
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            console.log('[SW] Caching assets:', CACHE_NAME);
            // Per-asset add so one missing file doesn't break the whole install
            const results = await Promise.allSettled(
                ASSETS_TO_CACHE.map((u) => cache.add(u))
            );
            const failed = results
                .map((r, i) => r.status === 'rejected' ? ASSETS_TO_CACHE[i] : null)
                .filter(Boolean);
            if (failed.length) console.warn('[SW] Failed to cache:', failed);
        })
    );
});

// 拦截网络请求
self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    const isNavigation = request.mode === 'navigate' || request.destination === 'document';
    const isSW = url.pathname.endsWith('/sw.js') || url.pathname.endsWith('sw.js');

    if (isNavigation || isSW) {
        // Network-first for HTML + SW so version bumps reach users who come online briefly
        // @ts-ignore
        event.respondWith(
            fetch(request).then((resp) => {
                const copy = resp.clone();
                caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => {});
                return resp;
            }).catch(() => caches.match(request))
        );
    } else {
        // Cache-first for static assets
        // @ts-ignore
        event.respondWith(
            caches.match(request).then((response) => response || fetch(request))
        );
    }
});

// 清理旧缓存 & 立即接管
self.addEventListener('activate', (event) => {
    // @ts-ignore
    event.waitUntil(
        Promise.all([
            caches.keys().then((keyList) => {
                return Promise.all(keyList.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log('[SW] Removing old cache:', key);
                        return caches.delete(key);
                    }
                }));
            }),
            // @ts-ignore
            self.clients.claim()
        ])
    );
});

// 监听跳过等待的消息
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        // @ts-ignore
        self.skipWaiting();
    }
});
