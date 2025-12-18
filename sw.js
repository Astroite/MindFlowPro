// [重要] 每次修改了代码想要发布给用户，必须修改这里的版本号！
// 比如改为 'mindflow-v1.2', 'mindflow-v1.3' 等
const CACHE_NAME = 'mindflow-v1.6';

const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './css/style.css',
    './js/app.js',
    './js/lib/d3.v7.min.js',
    './js/lib/localforage.min.js',
    './js/lib/marked.min.js',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

// 安装 SW
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching assets:', CACHE_NAME);
                return cache.addAll(ASSETS_TO_CACHE);
            })
    );
});

// [开发建议] 如果你在开发阶段，觉得缓存很烦，可以使用下面的 "网络优先" 策略
// 拦截网络请求
self.addEventListener('fetch', (event) => {
    event.respondWith(
        // 策略 A: 缓存优先 (Cache First) - 适合生产环境，速度快，离线可用
        // 逻辑：先找缓存，没有再联网
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })

        // 策略 B: 网络优先 (Network First) - 适合开发调试
        // 逻辑：先联网，联网失败(离线)再找缓存。
        // 如果你想在开发时每次刷新都看到最新代码，请注释掉上面的 策略A，解开下面的 策略B
        // fetch(event.request).catch(() => {
        //     return caches.match(event.request);
        // })

    );
});

// 清理旧缓存
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    console.log('[SW] Removing old cache:', key);
                    return caches.delete(key);
                }
            }));
        })
    );
});

// 监听跳过等待的消息 (用于点击"立即刷新"按钮)
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});