# MindFlowPro
My Custom Mind Flow Tools

MindFlow - Visual Asset Mind Map

MindFlow 是一个运行在浏览器端的、本地优先（Local-First）的视觉化思维导图工具。它专为整理图片、视频参考资料和灵感碎片而设计。

✨ 特性

无限画布与物理布局：基于 D3.js 力导向图，节点自动排布，拖拽手感极佳。

本地存储：使用 IndexedDB 技术，支持直接在本地保存大量高清图片，无需上传到云端服务器，保护隐私且速度极快。

资源管理：支持上传图片、视频链接、Markdown 笔记，并将它们关联到导图节点上。

纯静态应用：无后端，无账号系统，即开即用。

🚀 如何运行

本地运行

克隆本仓库或下载代码。

直接使用浏览器打开 index.html 即可使用。

推荐：为了更好的体验（避免部分浏览器的文件协议限制），建议使用 VS Code 的 "Live Server" 插件运行。

部署指南 (Tencent EO Pages)

你可以免费将此应用部署到腾讯云 EdgeOne Pages，实现随时随地访问（数据依然在你的浏览器本地）。

将代码推送到 GitHub 仓库。

登录腾讯云 EdgeOne 控制台，进入 Pages 服务。

新建项目，连接你的 GitHub 仓库。

构建配置：

框架预设：选择 "Static" 或 "None"。

输出目录：. (根目录)。

点击部署，绑定你的自定义域名即可。

🛠️ 技术栈

原生 HTML5 / CSS3

JavaScript (ES6+)

D3.js (物理引擎布局)

LocalForage (IndexedDB 存储封装)

⚠️ 注意事项

数据存储在你的浏览器 IndexedDB 中。如果你清空浏览器缓存或更换设备，数据将会丢失。

建议定期使用浏览器自带的“开发者工具”导出数据（后续版本将增加一键导出功能）。
