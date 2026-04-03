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
| **GraphModule** | `graph.js` | D3.js force-directed graph on HTML Canvas, node/link rendering, camera pan/zoom, drag interactions, image caching, SVG/PNG export |
| **DataModule** | `data.js` | CRUD for nodes/links/resources, undo/redo stack management, data normalization/self-healing |
| **UIModule** | `ui.js` | DOM interactions, modals, sidebar resource tree, tooltips, keyboard shortcuts, theme toggle, toast notifications |

### Other Key Files

- `js/config.js` — App constants (node sizes, force params, DB name, colors, debounce timing)
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
- `undoStack`, `redoStack` — Undo/redo snapshots
- `selectedNodes`, `bubbleNode`, `editingNode` — UI interaction state

### Event Flow

Modules communicate via `app.eventBus`. Key events: `resources:updated`, `nodes:deleted`, `toast`.

## Data Model

- **Project**: `{id, name, created, updated, nodes[], links[], resources[], camera: {x, y, k}}` stored in IndexedDB. Also exportable as `.mindflow.json` files.
- **Node**: `{id, type: 'root'|'sub', x, y, label, resId, color, note, shape: 'circle'|'rounded-rect'|'pill', glass: bool, layout: 'icon'|'card', borderStyle: 'solid'|'glow'|'double'|'gradient', scale}`
- **Link**: `{source, target, type: 'structure'|'cross'}` — 'structure' = parent-child, 'cross' = manual fly-line (zero physical force)
- **Resource**: `{id, type: 'image'|'md'|'code'|'color'|'audio'|'link'|'folder'|'unknown', name, content, parentId, tags[], created, updated}`

## EventBus Events

Key events emitted via `app.eventBus`:

| Event | Emitted By | Consumed By | Purpose |
|-------|-----------|-------------|---------|
| `resources:updated` | DataModule | UIModule | Re-render resource tree |
| `nodes:deleted` | DataModule | GraphModule | Update simulation + selection |
| `toast` | Any | UIModule | Show toast notification |
| `data:changed` | DataModule | StorageModule | Trigger debounced auto-save |

## Canvas Rendering Architecture

The graph renders on a single HTML5 Canvas element (`#mainCanvas`) via `requestAnimationFrame`. The `renderLoop()` in GraphModule checks a `needsRender` flag each frame — this decouples rendering from D3's simulation tick. D3's force simulation runs independently; each tick only sets `needsRender = true`.

- **Camera**: Pan/zoom state `{x, y, k}` is stored in `app.state.camera` and applied via `ctx.setTransform()` before rendering.
- **Image Cache**: GraphModule maintains a `Map`-based `imageCache` for resource thumbnails — clear it when project data changes via `imageCache.clear()`.
- **Hit Detection**: Canvas has no DOM nodes, so node detection uses manual distance/shape math in `findNodeAtPosition()`.

## PWA / Offline Support

The app is installable as a PWA (`manifest.json`). The Service Worker (`sw.js`) uses a **cache-first** strategy for all assets.

**Critical**: When modifying any source file, bump the `CACHE_NAME` version in `sw.js` (e.g., `'mindflow-v3.9'` → `'mindflow-v4.0'`). Otherwise users will continue serving stale cached files.

## TypeScript Support

The project uses JSDoc + `tsconfig.json` for editor type checking (no compilation). `allowJs: true`, `checkJs: true`, `strict: false`. Library types are declared in `globals.d.ts`. The `js/lib/` directory is excluded from type checking.

## Testing

There is no automated test suite. Test manually in Chrome/Edge by opening `http://localhost:8000`.

## Key Development Gotchas

1. **Service Worker cache**: Bump `CACHE_NAME` in `sw.js` on every code change.
2. **Module init order**: `ui.init()` → `storage.init()` → `graph.init()` — this order matters.
3. **Data serialization**: When saving to IndexedDB, nodes/links are cleaned to plain objects (no D3 internals like `vx`/`vy`/`index`). Don't add D3 internal fields to persisted data.
4. **Canvas hit detection**: Any new node shapes require updating the hit detection math in GraphModule.
5. **File System Access API**: Only available in Chrome/Edge. Firefox falls back to download mode.
