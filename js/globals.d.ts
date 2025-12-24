/**
 * 全局变量声明文件
 * 用于告诉编辑器这些第三方库已经通过 <script> 标签加载到全局作用域中
 */

// D3.js
// 简单声明为 any，避免复杂的类型体操。如果你需要 D3 的详细补全，需要安装 @types/d3
declare var d3: any;

// LocalForage
declare var localforage: {
    config: (options: any) => void;
    getItem: (key: string) => Promise<any>;
    setItem: (key: string, value: any) => Promise<any>;
    removeItem: (key: string) => Promise<void>;
    // ... 其他你需要的方法，或者直接写 declare var localforage: any;
    [key: string]: any;
};

// Marked.js
declare var marked: {
    parse: (markdown: string) => string;
    [key: string]: any;
};

// DOMPurify
declare var DOMPurify: {
    sanitize: (html: string) => string;
    [key: string]: any;
};

// 如果还有其他全局变量，都在这里声明
// 例如你的 app 实例
declare var app: import('./types.js').App;

// 扩展 Window 接口以包含 File System Access API 和其他自定义属性
interface Window {
    showOpenFilePicker(options?: any): Promise<any[]>;
    showSaveFilePicker(options?: any): Promise<any>;

    // 如果你在 window 上挂载了 app
    app: import('./types.js').App;

    // 如果使用了 DOMPurify
    DOMPurify: typeof DOMPurify;
}

// 扩展 Event 接口，让 e.target 拥有更多通用属性，避免 JS 中频繁报红
// 注意：这在严格 TS 项目中是不推荐的，但在 JS 项目中为了减少波浪线非常有用
interface Event {
    target: EventTarget & {
        tagName: string;
        value: string;
        files?: FileList;
        classList: DOMTokenList;
        result: string;
        // 添加其他你经常访问的属性
    } | null;
}