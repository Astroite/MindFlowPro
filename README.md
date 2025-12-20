# MindFlow - 本地优先的视觉化灵感与资源管理工具

MindFlow 是一个专为创作者、设计师和开发者打造的本地优先 (Local-First) 视觉化思维导图工具。它摒弃了传统的树状结构，采用基于 D3.js 物理引擎的网状布局，帮助你以更直观、更有生命力的方式整理图片、代码、文档和灵感碎片。
🚀 v3.2.0 全新架构发布！ 更稳健、更安全、更易扩展。

## 🌟 核心特性

### 🧠 物理仿真的无限画布
* 力导向布局：基于 D3.js 物理引擎，节点之间具有自然的斥力与牵引力，自动避让，拖拽手感顺滑。
* 无限层级：支持创建无限子节点，子节点自动环绕父节点分布。
* 自由视图：支持画布无限平移与缩放，滚轮缩放，双指捏合（触屏）。
* 高清导出：智能计算内容包围盒，一键导出透明背景的高清 PNG 图片。

### 📂 强大的资源管理系统

MindFlow 不仅仅是导图，更是一个私有的灵感素材库。支持多种格式的资源管理：

* 🖼️ 图片 (Image)：支持高清大图上传与预览，悬浮即现缩略图。
* 📝 文档 (Markdown)：内置 Markdown 渲染引擎，悬浮即可预览排版后的富文本内容。
* 💻 代码 (Code)：专为开发者设计的代码块存储，保留代码格式，悬浮预览。
* 🎨 色卡 (Palette)：设计师必备工具，直观展示色块，支持 Hex 色值复制。
* 🎤 音频 (Audio)：支持语音备忘录或音效素材的存储与播放。
* 🔗 链接 (Link)：快速收藏并跳转外部参考网页。

### 🖱️ 流畅的交互体验

* 拖拽归档：支持在侧边栏通过拖拽整理资源，将文件拖入文件夹即可归档，拖入空白处即可移出。
* 拖放关联：直接将侧边栏的资源拖拽到画布上的节点，即可瞬间完成关联。
* 文件夹系统：支持创建文件夹，通过树状视图高效管理海量资源。
* 即时预览：鼠标悬浮在节点或列表项上，即可通过 Tooltip 快速查看资源内容，无需打开。

### 🔒 极致的数据隐私与安全

* 本地存储 (Local-First)：使用浏览器 IndexedDB 技术，所有数据（包括高达数百MB的图片文件）均存储在您的本地设备中，绝不上传任何服务器，彻底杜绝隐私泄露风险。
* 读写磁盘：集成 File System Access API (Chrome/Edge)，支持直接打开和保存本地的 .mindflow.json 文件。
* 无缝同步：将文件保存在 OneDrive/Dropbox/iCloud 目录中，利用网盘自身的同步功能实现跨设备协作。
* 离线可用：基于 Service Worker 技术，断网状态下依然可以全功能使用。
* XSS防护：集成 DOMPurify，防止恶意脚本注入。

### 🛠️ 技术架构 (v3.0+)
本项目采用原生 ES Modules 模块化架构，无打包工具依赖，轻量且高性能。
* Core: js/app.js (入口与组装)
* Modules:
  * StorageModule: 封装 IndexedDB (LocalForage) 与文件 IO。
  * GraphModule: 封装 D3.js 力导向图与 Canvas 渲染循环。
  * DataModule: 负责数据 CRUD、规范化与自愈逻辑。
  * UIModule: 负责 DOM 交互、弹窗与事件绑定。
  * EventBus: 实现模块间的解耦通信。


## 🚀 快速开始

### 在线体验
访问部署地址：[MindFlow 在线版](https://mind.astroite.com/)

### 安装为桌面应用：

1. 在 Chrome 或 Edge 浏览器中打开链接。
2. 点击地址栏右侧出现的“安装 MindFlow”图标。
3. 即可获得独立的桌面应用体验，启动速度更快，且无浏览器干扰。

### 本地部署 (开发者)

如果您希望在本地环境运行或二次开发：

1. 克隆仓库：

```shell
git clone https://github.com/Astroite/MindFlowPro.git
```

2. 确保 js/lib/ 目录下包含依赖库 (D3.js, LocalForage, Marked.js)。
3. 由于使用了 ES Modules 和 Service Worker，请使用静态服务器启动：

```python
# Python 3
python -m http.server 8000

# 或者使用 VS Code 的 "Live Server" 插件
# 或者使用WebStrom，在index.html页面使用调试、
浏览器访问 http://localhost:8000。
```



## 📄 许可证
MIT License © 2023 MindFlow