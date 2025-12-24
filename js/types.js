/**
 * MindFlow - 核心类型定义文件
 * 包含所有模块共用的数据结构定义
 */

/**
 * 节点对象
 * @typedef {Object} Node
 * @property {string} id - 唯一标识符
 * @property {'root' | 'sub'} type - 节点类型：根节点或子节点
 * @property {number} x - X坐标
 * @property {number} y - Y坐标
 * @property {string} label - 节点显示的文本
 * @property {string|null} resId - 关联的资源ID
 * @property {number} [scale] - 缩放比例 (可选)
 * @property {number} [fx] - D3 力导向图固定 X 坐标 (可选)
 * @property {number} [fy] - D3 力导向图固定 Y 坐标 (可选)
 * @property {number} [vx] - D3 力导向图 X 速度 (可选)
 * @property {number} [vy] - D3 力导向图 Y 速度 (可选)
 * @property {number} [index] - D3 内部索引 (可选)
 */

/**
 * 连线对象
 * @typedef {Object} Link
 * @property {string|Node} source - 源节点 ID 或 对象
 * @property {string|Node} target - 目标节点 ID 或 对象
 * @property {'structure'|'cross'} [type] - 连线类型：structure(父子,默认) 或 cross(飞线)
 * @property {number} [index] - D3 内部索引
 */

/**
 * 资源对象
 * @typedef {Object} Resource
 * @property {string} id - 资源ID
 * @property {'image'|'md'|'code'|'color'|'audio'|'link'|'folder'|'unknown'} type - 资源类型
 * @property {string} name - 资源名称
 * @property {string|null} content - 资源内容 (URL, Base64, 文本等)
 * @property {string|null} parentId - 父文件夹ID
 * @property {number} created - 创建时间戳
 * @property {number} updated - 更新时间戳
 */

/**
 * 全局应用状态
 * @typedef {Object} AppState
 * @property {string|null} currentId - 当前项目ID
 * @property {Array<{id: string, name: string}>} projectsIndex - 项目索引列表
 * @property {Node[]} nodes - 当前画布上的所有节点
 * @property {Link[]} links - 当前画布上的所有连线
 * @property {Resource[]} resources - 当前项目的所有资源
 * @property {{x: number, y: number, k: number}} camera - 摄像机/视口状态
 * @property {any} simulation - D3 Force Simulation 实例
 * @property {Set<string>} selectedNodes - 当前选中的节点ID集合
 * @property {Node|null} bubbleNode - 当前显示气泡菜单的节点
 * @property {Node|null} editingNode - 当前正在编辑的节点
 * @property {string|null} tempFileBase64 - 临时文件数据 (上传时用)
 * @property {Node|null} hoverNode - 当前鼠标悬停的节点
 * @property {number|null} tooltipTimer - 预览框的定时器
 * @property {string|null} editingResId - 当前正在编辑的资源ID
 * @property {Set<string>} expandedFolders - 侧边栏展开的文件夹ID集合
 * @property {string|null} draggedResId - 当前拖拽的资源ID
 * @property {any} fileHandle - File System Access API Handle
 * @property {string} searchKeyword - 资源搜索关键词
 * @property {boolean} isDirty - 是否有未保存的更改
 * @property {any} saveTimer - 自动保存定时器
 * @property {boolean} showCrossLinks - 是否显示飞线 (默认 true)
 * @property {boolean} isLinking - 是否正在创建飞线模式
 * @property {Node|null} linkingSourceNode - 飞线起始节点
 */

/**
 * 核心 App 对象结构
 * @typedef {Object} App
 * @property {import('./config.js').config} config
 * @property {import('./utils.js').utils} utils
 * @property {import('./modules/eventBus.js').EventBus} eventBus
 * @property {import('./modules/storage.js').StorageModule} storage
 * @property {import('./modules/graph.js').GraphModule} graph
 * @property {import('./modules/data.js').DataModule} data
 * @property {import('./modules/ui.js').UIModule} ui
 * @property {Object.<string, HTMLElement>} dom - DOM 元素缓存
 * @property {AppState} state - 全局状态
 * @property {() => Promise<void>} init - 初始化方法
 */

export {}; // 这是一个空导出，为了让这个文件被视为模块（Module），方便其他文件 import
