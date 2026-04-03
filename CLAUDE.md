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

- **Project**: `{id, name, created, nodes[], links[], resources[]}` stored in IndexedDB
- **Node**: `{id, type: 'root'|'sub', x, y, label, resId, color, note}`
- **Link**: `{source, target, type: 'structure'|'cross'}` — 'structure' = parent-child, 'cross' = manual fly-line
- **Resource**: `{id, type: 'image'|'md'|'code'|'color'|'audio'|'link'|'folder', name, content, parentId, tags[]}`

## Service Worker

`sw.js` uses cache-first strategy. **Bump `CACHE_NAME` version** whenever any source file changes, or users will see stale code.

## TypeScript Support

The project uses JSDoc + `tsconfig.json` for editor type checking (no compilation). `allowJs: true`, `checkJs: true`, `strict: false`. Library types are declared in `globals.d.ts`.
