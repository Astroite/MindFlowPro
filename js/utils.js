export const utils = {
    // 防抖函数：避免高频操作导致数据库写入卡顿
    debounce: (func, wait) => {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), wait);
        };
    },

    // HTML 清洗：防止 Markdown 渲染时的 XSS 攻击
    purifyHTML: (html) => {
        if (!html) return '';
        // 优先使用本地引入的 DOMPurify
        if (window.DOMPurify) {
            return window.DOMPurify.sanitize(html);
        }
        // 降级方案：简单的脚本剥离
        console.warn('DOMPurify not loaded. Using fallback sanitization.');
        return html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "")
            .replace(/on\w+="[^"]*"/g, "");
    },

    // 简单的 HTML 转义（用于非 Markdown 文本）
    escapeHtml: (text) => {
        if (!text) return '';
        return text.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    },

    // 图片压缩：限制最大宽高，转换为 JPEG
    compressImage: (base64Str, maxWidth = 1024, quality = 0.8) => {
        return new Promise((resolve) => {
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
                // 转换为 JPEG 格式以减小体积
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => resolve(base64Str); // 如果压缩失败，返回原图
        });
    }
};