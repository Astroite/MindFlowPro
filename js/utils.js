export const utils = {
    // 防抖函数：避免高频操作导致数据库写入卡顿
    debounce: (func, wait) => {
        let timeout;
        const debounced = function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), wait);
        };
        debounced.cancel = () => clearTimeout(timeout);
        return debounced;
    },

    // HTML 清洗：防止 Markdown 渲染时的 XSS 攻击
    // P0-6: DOMPurify 是硬依赖，移除了可绕过的正则后备
    purifyHTML: (html) => {
        if (!html) return '';
        if (!window.DOMPurify) {
            console.error('DOMPurify 未加载，无法安全清洗 HTML');
            return ''; // 安全降级：返回空字符串而非未清洗的内容
        }
        return window.DOMPurify.sanitize(html);
    },

    // 简单的 HTML 转义（用于非 Markdown 文本）
    escapeHtml: (text) => {
        if (!text) return '';
        return text.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;")
            .replace(/`/g, "&#96;");
    },

    // 生成唯一 ID（优先 crypto.randomUUID，降级为 Date.now + random）
    genId(prefix) {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return prefix + crypto.randomUUID();
        }
        return prefix + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    },

    // URL scheme 白名单校验，防止 javascript: 注入
    isSafeUrl(url) {
        if (typeof url !== 'string') return false;
        const trimmed = url.trim().toLowerCase();
        return trimmed.startsWith('https:') || trimmed.startsWith('data:image/') || trimmed.startsWith('data:audio/') || trimmed.startsWith('blob:');
    },

    // 图片压缩：限制最大宽高，转换为 JPEG。失败时 reject，调用方需处理
    compressImage: (base64Str, maxWidth = 1024, quality = 0.8) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.src = base64Str;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => reject(new Error('图片解码失败，文件可能已损坏'));
        });
    }
};
