# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MindFlow is a local-first visual mind-mapping and resource management tool. It runs entirely in the browser using vanilla JavaScript ES Modules (no bundler). Data is stored in IndexedDB via LocalForage, and the app works offline via Service Worker.

## Running the Project

No build step required. Serve with any static HTTP server:

```bash
python -m http.server 8000
# or use VS Code Live Server extension
```

Open `http://localhost:8000` in Chrome/Edge.

There is no `package.json`, no CLI typecheck, and no automated test suite. `tsconfig.json` exists only for editor type checking via JSDoc; if you want to run it from the CLI, use `npx tsc --noEmit` (not wired up by default).

`README.md` is user-facing documentation in Chinese and contains no additional developer info beyond what is in this file — no need to re-read it for build or architecture questions.

## Architecture

The app follows a modular architecture with dependency injection via a central `app` object.

### Entry Point

- `js/app.js` — Creates the global `app` singleton, instantiates all modules, and calls `init()` on each in order. Exposed as `window.app`.

### Modules (`js/modules/`)

All modules receive the `app` object in their constructor and access shared state via `app.state` and other modules via `app.storage`, `app.graph`, etc.

| Module | File | Responsibility |
|--------|------|----------------|
| **EventBus** | `eventBus.js` | Simple pub/sub (`on`, `off`, `emit`) for inter-module communication |
| **StorageModule** | `storage.js` | IndexedDB persistence via LocalForage, File System Access API (open/save .mindflow.json), debounced auto-save |
| **GraphModule** | `graph.js` | D3.js force simulation, canvas render loop, pan/zoom/drag event binding; delegates rendering to sub-modules |
| **DataModule** | `data.js` | CRUD for nodes/links/resources, undo/redo (incremental command pattern), clipboard, batch ops, data normalization/self-healing |
| **UIModule** | `ui.js` | DOM interactions, modals, sidebar resource tree, keyboard shortcuts, theme toggle, toast notifications; delegates to sub-modules |

#### Sub-modules

GraphModule and UIModule delegate to sub-modules in `js/modules/graph/` and `js/modules/ui/`:

| Sub-module | Parent | Responsibility |
|------------|--------|----------------|
| `NodeRenderer.js` | GraphModule | Node drawing (shapes, textures, images, labels, plus buttons), image cache |
| `LinkRenderer.js` | GraphModule | Link drawing (structure + cross), link hit detection |
| `MinimapRenderer.js` | GraphModule | Minimap overlay and click-to-navigate |
| `ExportManager.js` | GraphModule | PNG and SVG export |
| `NodeEditor.js` | UIModule | Node bubble menu, edit panel, save/delete/link handlers |
| `NodeSearch.js` | UIModule | In-canvas search with prev/next navigation and highlight |
| `TooltipManager.js` | UIModule | Hover tooltips for nodes and sidebar resource previews |

### Other Key Files

- `js/config.js` — App constants (version, D3 physics params, DB name, ID prefixes, colors, zoom limits, card ratios)
- `js/utils.js` — `debounce()`, `purifyHTML()` (DOMPurify wrapper), `escapeHtml()`, `compressImage()`
- `js/types.js` — JSDoc `@typedef` definitions for `Node`, `Link`, `Resource`, `AppState`, `App`
- `js/globals.d.ts` — TypeScript ambient declarations for global libraries (d3, localforage, marked, DOMPurify)

### Libraries (`js/lib/`, loaded via `<script>` tags)

- **D3.js v7** — Force simulation and math utilities
- **LocalForage** — IndexedDB wrapper
- **Marked.js** — Markdown to HTML
- **DOMPurify** — XSS sanitization

### Global State

All mutable state lives in `app.state` (defined in `js/app.js`). Key fields:

- `nodes`, `links`, `resources` — Current project data
- `camera` — Pan/zoom (`{x, y, k}`)
- `simulation` — D3 force simulation instance
- `undoStack`, `redoStack` — Undo/redo command snapshots (incremental command pattern, not full-state copies)
- `selectedNodes` (Set), `bubbleNode`, `editingNode` — UI interaction state
- `currentId` — Active project ID (null when no project is open)

On startup, `app.init()` reads `lastOpenedProjectId` from `localStorage` and auto-loads that project if it still exists in the projects index. This is the only piece of state persisted outside IndexedDB.

### Event Flow

Modules communicate via `app.eventBus`. Key events:

| Event | Emitted By | Consumed By | Purpose |
|-------|-----------|-------------|---------|
| `resources:updated` | DataModule | UIModule | Re-render resource tree |
| `nodes:deleted` | DataModule | GraphModule | Update simulation + clear selection |
| `toast` | Any | UIModule | Show toast notification |
| `data:changed` | DataModule | StorageModule | Trigger debounced auto-save |

## Data Model

- **Project**: `{id, name, created, updated, nodes[], links[], resources[], camera: {x, y, k}}` stored in IndexedDB. Also exportable as `.mindflow.json` files.
- **Node**: `{id, type: 'root'|'sub', x, y, label, resId, color, note, shape: 'circle'|'rounded-rect'|'pill', glass: bool, layout: 'icon'|'card', borderStyle: 'solid'|'glow'|'double'|'gradient', scale}`
- **Link**: `{source, target, type: 'structure'|'cross'}` — 'structure' = parent-child, 'cross' = manual fly-line (zero physical force)
- **Resource**: `{id, type: 'image'|'md'|'code'|'color'|'audio'|'link'|'folder'|'unknown', name, content, parentId, tags[], created, updated}`

## Canvas Rendering Architecture

The graph renders on a single HTML5 Canvas element (`#mainCanvas`) via `requestAnimationFrame`. The `renderLoop()` in GraphModule checks a `needsRender` flag each frame — this decouples rendering from D3's simulation tick. D3's force simulation runs independently; each tick only sets `needsRender = true`.

- **Camera**: Pan/zoom state `{x, y, k}` is stored in `app.state.camera` and applied via `ctx.setTransform()` before rendering.
- **Image Cache**: GraphModule maintains a `Map`-based `imageCache` for resource thumbnails — clear it when project data changes via `imageCache.clear()`.
- **Hit Detection**: Canvas has no DOM nodes, so node detection uses manual distance/shape math in `findNodeAtPosition()`.

## PWA / Offline Support

The app is installable as a PWA (`manifest.json`). The Service Worker (`sw.js`) uses a **cache-first** strategy for all assets.

**Critical**: When modifying any source file:
1. Bump the `CACHE_NAME` version in `sw.js` (e.g., `vX.Y` → `vX.(Y+1)`). Otherwise users will serve stale cached files.
2. If adding new source files, also add them to the `ASSETS_TO_CACHE` array in `sw.js`.

## TypeScript Support

The project uses JSDoc + `tsconfig.json` for editor type checking (no compilation). `allowJs: true`, `checkJs: true`, `strict: false`. Library types are declared in `globals.d.ts`. The `js/lib/` directory is excluded from type checking.

## Testing

There is no automated test suite. Test manually in Chrome/Edge by opening `http://localhost:8000`.

## Key Development Gotchas

1. **Service Worker cache**: Bump `CACHE_NAME` in `sw.js` and add new files to `ASSETS_TO_CACHE` on every code change.
2. **Module init order**: `ui.init()` → `storage.init()` → `graph.init()`. UI binds DOM listeners first, storage then loads project data into `state`, and graph finally starts its render loop against populated state. Reordering will cause listeners to miss events or graph to render against empty state.
3. **Data serialization**: When saving to IndexedDB, nodes/links are cleaned to plain objects (no D3 internals like `vx`/`vy`/`index`). Don't add D3 internal fields to persisted data.
4. **Canvas hit detection**: Any new node shapes require updating the hit detection math in `NodeRenderer.js` / `LinkRenderer.js`.
5. **File System Access API**: Only available in Chrome/Edge. Firefox falls back to download mode.
6. **Library globals**: D3, LocalForage, Marked, and DOMPurify are loaded as `<script defer>` — they are global variables, not ES module imports. App code (`js/`) uses ES modules.
