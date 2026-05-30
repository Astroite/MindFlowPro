const ICON_PATHS = {
    menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
    plus: ['M12 5v14', 'M5 12h14'],
    search: ['M10.5 18a7.5 7.5 0 1 1 5.3-2.2', 'M16 16l4 4'],
    save: ['M6 3h10l3 3v15H5V3h1', 'M8 3v6h8V3', 'M8 21v-7h8v7'],
    open: ['M3 7h7l2 2h9v10.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5V7z', 'M3 10h18'],
    folder: ['M3 7h7l2 2h9v10H3V7z'],
    folderPlus: ['M3 7h7l2 2h9v10H3V7z', 'M12 12v5', 'M9.5 14.5h5'],
    copy: ['M8 8h10v12H8z', 'M5 16H4a1 1 0 0 1-1-1V4h11v1'],
    trash: ['M5 7h14', 'M10 11v6', 'M14 11v6', 'M8 7l1-3h6l1 3', 'M7 7l1 14h8l1-14'],
    checkSquare: ['M5 4h14v16H5z', 'M8.5 12.5l2.5 2.5 4.5-5'],
    target: ['M12 3v3', 'M12 18v3', 'M3 12h3', 'M18 12h3', 'M7 12a5 5 0 1 0 10 0 5 5 0 0 0-10 0z', 'M10 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0z'],
    export: ['M12 3v12', 'M8 7l4-4 4 4', 'M5 13v6h14v-6'],
    image: ['M4 5h16v14H4z', 'M7 15l3-3 3 3 2-2 3 3', 'M8 9h.1'],
    svg: ['M5 5h14v14H5z', 'M8 15l-2-3 2-3', 'M16 15l2-3-2-3', 'M10 16l4-8'],
    map: ['M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2V6z', 'M9 4v14', 'M15 6v14'],
    theme: ['M12 3a8.5 8.5 0 1 0 7.7 12.1A6.5 6.5 0 0 1 12 3z'],
    keyboard: ['M3 6h18v12H3z', 'M7 10h.1', 'M11 10h.1', 'M15 10h.1', 'M19 10h.1', 'M7 14h7', 'M17 14h.1'],
    edit: ['M4 17.5V21h3.5L18.8 9.7l-3.5-3.5L4 17.5z', 'M14 7.5L16.5 5 20 8.5 17.5 11'],
    route: ['M6 18a2 2 0 1 0 0.1 0', 'M18 6a2 2 0 1 0 0.1 0', 'M8 18h3a4 4 0 0 0 0-8h2a4 4 0 0 0 4-4'],
    link: ['M9.5 14.5l5-5', 'M10.5 7.5l1.1-1.1a4 4 0 0 1 5.7 5.7l-1.1 1.1', 'M13.5 16.5l-1.1 1.1a4 4 0 0 1-5.7-5.7l1.1-1.1'],
    fileText: ['M6 3h9l3 3v15H6z', 'M15 3v4h4', 'M9 11h6', 'M9 15h6', 'M9 18h4'],
    code: ['M9 8l-4 4 4 4', 'M15 8l4 4-4 4', 'M13 6l-2 12'],
    palette: ['M12 4a8 8 0 0 0 0 16h1.5a1.8 1.8 0 0 0 0-3.6H12a1.7 1.7 0 0 1 0-3.4h1.5A6.5 6.5 0 0 0 12 4z', 'M8 10h.1', 'M11 8h.1', 'M15 9h.1'],
    audio: ['M5 14V9a4 4 0 0 1 8 0v5a4 4 0 0 1-8 0z', 'M9 18v3', 'M6 21h6', 'M15 11v3a6 6 0 0 1-12 0v-3'],
    archive: ['M4 5h16v4H4z', 'M6 9h12v10H6z', 'M10 13h4'],
    close: ['M6 6l12 12', 'M18 6L6 18'],
    chevronDown: ['M7 10l5 5 5-5'],
    chevronUp: ['M7 14l5-5 5 5'],
    chevronRight: ['M10 7l5 5-5 5'],
    shapeCircle: ['M6 12a6 6 0 1 0 12 0 6 6 0 0 0-12 0z'],
    shapeSquare: ['M6 6h12v12H6z'],
    spark: ['M12 4v5', 'M12 15v5', 'M4 12h5', 'M15 12h5', 'M8 8l-2-2', 'M16 8l2-2', 'M8 16l-2 2', 'M16 16l2 2'],
};

const RESOURCE_ICON_NAMES = {
    image: 'image',
    md: 'fileText',
    code: 'code',
    color: 'palette',
    audio: 'audio',
    link: 'link',
    folder: 'folder',
    unknown: 'archive',
};

function attrsToString(attrs) {
    return Object.entries(attrs)
        .filter(([, value]) => value !== undefined && value !== null && value !== false)
        .map(([key, value]) => `${key}="${String(value).replace(/"/g, '&quot;')}"`)
        .join(' ');
}

export function resourceIconName(type) {
    return RESOURCE_ICON_NAMES[type] || RESOURCE_ICON_NAMES.unknown;
}

export function iconSvg(name, attrs = {}) {
    const paths = ICON_PATHS[name] || ICON_PATHS.archive;
    const className = attrs.className || 'mf-icon';
    const extra = { 'aria-hidden': 'true', ...attrs };
    delete extra.className;
    const attrText = attrsToString({
        class: className,
        viewBox: '0 0 24 24',
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
        ...extra,
    });
    return `<svg ${attrText}>${paths.map(d => `<path d="${d}"/>`).join('')}</svg>`;
}

export function iconSvgForExport(name, cx, cy, size, color) {
    const paths = ICON_PATHS[name] || ICON_PATHS.archive;
    const scale = size / 24;
    const x = cx - size / 2;
    const y = cy - size / 2;
    return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths.map(d => `<path d="${d}"/>`).join('')}</g>`;
}

const PATH_CACHE = new Map();

export function drawCanvasIcon(ctx, name, x, y, size, color, lineWidth = 1.8) {
    const paths = ICON_PATHS[name] || ICON_PATHS.archive;
    ctx.save();
    ctx.translate(x - size / 2, y - size / 2);
    ctx.scale(size / 24, size / 24);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.fillStyle = 'transparent';
    paths.forEach(d => {
        let path = PATH_CACHE.get(d);
        if (!path) {
            path = new Path2D(d);
            PATH_CACHE.set(d, path);
        }
        ctx.stroke(path);
    });
    ctx.restore();
}
