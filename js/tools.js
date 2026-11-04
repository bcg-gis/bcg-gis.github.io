/* Ölçmə və çəkmə alətləri: məsafə, sahə, dairə, koordinat, nöqtə, sərbəst xətt, qeyd vərəqi, mətn.
   Hər çizginin öz stili var; seçilmiş çizginin nöqtələri sürüşdürülür. Çəkəndə kursor nöqtələrə və xətlərə yapışır
   (Alt: söndür, Shift: 45° addım, F8: birinci xəttə 90°). Çizgilər bu brauzerdə saxlanır, paylaşma linki ilə gedir. */

const tools = (() => {
    const COLORS = ["#ff7a1a", "#e5262e", "#ffd400", "#2fbf4a", "#1e88e5", "#8e44ff", "#ffffff", "#1b2433"];
    const WIDTHS = { 1: 1.5, 2: 2.5, 3: 4.5 };
    const FILLS = [0, .16, .38];
    const DEFAULT_STYLE = { color: COLORS[0], width: 2, dash: "solid", fill: 1, labels: true };
    const SNAP_PX = 10, SNAP_LINE_PX = 7, SIDE_MIN_PX = 56, HISTORY_MAX = 50;
    const KEYS = { shapes: "bcg.drawings", style: "bcg.drawstyle", snap: "bcg.snap", ortho: "bcg.ortho" };
    const GROUPS = [
        { id: "measure", icon: "fa-solid fa-ruler-combined", tools: [["distance", "fa-solid fa-ruler"], ["area", "fa-solid fa-draw-polygon"], ["circle", "fa-regular fa-circle"], ["coord", "fa-solid fa-crosshairs"]] },
        { id: "draw", icon: "fa-solid fa-pen", tools: [["pin", "fa-solid fa-location-dot"], ["draw", "fa-solid fa-pen"], ["note", "fa-regular fa-note-sticky"], ["text", "fa-solid fa-font"]] }
    ];
    const STYLED = ["distance", "area", "circle", "pin", "draw"];
    const LINE_LAYERS = ["draw-solid", "draw-dash", "draw-dot"];

    const st = {
        tool: null, shapes: [], hidden: false, draft: [], hover: null, picked: null,
        style: { ...DEFAULT_STYLE, ...readStore(KEYS.style, {}) },
        snap: readStore(KEYS.snap, true), ortho: readStore(KEYS.ortho, false),
        history: [], nextId: 1, sessionOnly: false, saving: false, fly: null
    };
    let labelMarkers = [], noteMarkers = [], freehand = false, moving = null, ready = false;

    /* Ölçülər */
    const rad = d => d * Math.PI / 180;
    const dist = (a, b) => new maplibregl.LngLat(a[0], a[1]).distanceTo(new maplibregl.LngLat(b[0], b[1]));
    const lineLength = c => c.reduce((sum, p, i) => i ? sum + dist(c[i - 1], p) : sum, 0);
    function ringArea(c) {
        const R = 6378137;
        const total = c.reduce((sum, p, i) => {
            const q = c[(i + 1) % c.length];
            return sum + rad(q[0] - p[0]) * (2 + Math.sin(rad(p[1])) + Math.sin(rad(q[1])));
        }, 0);
        return Math.abs(total * R * R / 2);
    }
    function circleRing([lng, lat], radius) {
        const d = radius / 6371008, φ = rad(lat), ring = [];
        for (let i = 0; i <= 64; i++) {
            const θ = i / 64 * 2 * Math.PI;
            const φ2 = Math.asin(Math.sin(φ) * Math.cos(d) + Math.cos(φ) * Math.sin(d) * Math.cos(θ));
            const λ2 = rad(lng) + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ), Math.cos(d) - Math.sin(φ) * Math.sin(φ2));
            ring.push([λ2 * 180 / Math.PI, φ2 * 180 / Math.PI]);
        }
        return ring;
    }
    const fmtLen = m => m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 1 : 2)} km` : `${m.toFixed(m >= 100 ? 0 : 1)} m`;
    const fmtArea = m2 => m2 >= 1e6 ? `${(m2 / 1e6).toFixed(2)} km²` : m2 >= 1e4 ? `${(m2 / 1e4).toFixed(2)} ha` : `${m2.toFixed(0)} m²`;
    const fmtCoord = ([lng, lat]) => `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

    function labelOf(s) {
        if (s.tool === "distance" || s.tool === "draw") return fmtLen(lineLength(s.coords));
        if (s.tool === "area") return `${fmtArea(ringArea(s.coords))} · ${fmtLen(lineLength([...s.coords, s.coords[0]]))}`;
        if (s.tool === "circle") return `R ${fmtLen(s.radius)} · ${fmtArea(Math.PI * s.radius ** 2)}`;
        if (s.tool === "coord") return fmtCoord(s.coords[0]);
        return "";
    }

    /* Yaddaş: çizgilər hər istifadəçi üçün ayrıca açarda saxlanır */
    let shapesKey = null;
    const styleOf = s => ({ ...DEFAULT_STYLE, ...s.style });
    function save() {
        if (!st.sessionOnly && shapesKey) writeStore(shapesKey, st.shapes);
    }
    function loadOwnShapes() {
        if (!shapesKey) return [];
        const own = readStore(shapesKey, null);
        if (own) return own;
        // Köhnə ümumi açardakı çizgilər ilk daxil olan istifadəçiyə keçir
        const legacy = readStore(KEYS.shapes, []);
        if (legacy.length) {
            writeStore(shapesKey, legacy);
            localStorage.removeItem(KEYS.shapes);
        }
        return legacy;
    }
    function remember() {
        st.history.push(JSON.stringify(st.shapes));
        if (st.history.length > HISTORY_MAX) st.history.shift();
    }
    function addShape(fields) {
        remember();
        const s = { id: st.nextId++, style: { ...st.style }, ...fields };
        st.shapes.push(s);
        save();
        return s;
    }
    function setShapes(shapes) {
        st.shapes = shapes;
        st.nextId = shapes.reduce((max, s) => Math.max(max, s.id + 1), 1);
        render();
    }

    /* Xəritə qatları */
    function features() {
        const out = [];
        const add = (geometry, props) => out.push({ type: "Feature", geometry, properties: props });
        const shapeFeatures = (s, coords, style, id) => {
            const props = { id, color: style.color, w: WIDTHS[style.width], dash: style.dash, fo: FILLS[style.fill], sel: id === st.picked ? 1 : 0 };
            if (s.tool === "circle" && s.radius) {
                add({ type: "Polygon", coordinates: [circleRing(coords[0], s.radius)] }, props);
            } else if (s.tool === "area" && coords.length > 2) {
                add({ type: "Polygon", coordinates: [[...coords, coords[0]]] }, props);
            } else if (coords.length > 1) {
                add({ type: "LineString", coordinates: coords }, props);
            }
            if (s.tool === "pin" || s.tool === "coord") add({ type: "Point", coordinates: coords[0] }, { ...props, point: 1 });
        };
        if (!st.hidden) {
            st.shapes.filter(s => s.tool !== "note" && s.tool !== "text").forEach(s => {
                shapeFeatures(s, s.coords, styleOf(s), s.id);
                if (s.id === st.picked && s.tool !== "pin" && s.tool !== "coord") {
                    s.coords.forEach((c, vi) => add({ type: "Point", coordinates: c }, { id: s.id, color: "#fff", vi, vertex: 1 }));
                }
            });
        }
        if (st.draft.length) {
            const coords = st.hover && st.tool !== "draw" ? [...st.draft, st.hover] : st.draft;
            const radius = st.tool === "circle" && st.hover ? dist(st.draft[0], st.hover) : 0;
            shapeFeatures({ tool: st.tool, radius }, st.tool === "circle" ? st.draft : coords, st.style, -1);
            st.draft.forEach(c => add({ type: "Point", coordinates: c }, { id: -1, color: st.style.color, draftPoint: 1 }));
        }
        return { type: "FeatureCollection", features: out };
    }

    function layers() {
        const dashes = { "draw-solid": [["solid"], undefined], "draw-dash": [["dash"], [3, 2]], "draw-dot": [["dot"], [1, 1.6]] };
        const list = [
            { id: "draw-fill", type: "fill", source: "draw", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": ["get", "color"], "fill-opacity": ["get", "fo"] } }
        ];
        LINE_LAYERS.forEach(id => {
            const [kinds, dasharray] = dashes[id];
            const paint = { "line-color": ["get", "color"], "line-width": ["case", ["==", ["get", "sel"], 1], ["+", ["get", "w"], 1.5], ["get", "w"]] };
            if (dasharray) paint["line-dasharray"] = dasharray;
            list.push({
                id, type: "line", source: "draw", paint, layout: { "line-cap": "round", "line-join": "round" },
                filter: ["all", ["!=", ["geometry-type"], "Point"], ["==", ["get", "dash"], kinds[0]]]
            });
        });
        list.push({
            id: "draw-points", type: "circle", source: "draw", filter: ["==", ["geometry-type"], "Point"],
            paint: { "circle-radius": ["case", ["has", "vertex"], 6, ["has", "draftPoint"], 4, 7], "circle-color": ["get", "color"], "circle-stroke-color": ["case", ["has", "vertex"], "#1e88e5", "#ffffff"], "circle-stroke-width": 2 }
        });
        return list;
    }

    function renderSource() {
        map.getSource("draw")?.setData(features());
    }

    function labelEl(text, className = "measure-label") {
        const el = document.createElement("span");
        el.className = className;
        el.textContent = text;
        return el;
    }

    function renderLabels() {
        labelMarkers.forEach(m => m.remove());
        labelMarkers = [];
        const place = (at, text, className) => labelMarkers.push(new maplibregl.Marker({ element: labelEl(text, className), anchor: "center" }).setLngLat(at).addTo(map));
        const sides = coords => coords.forEach((c, i) => {
            if (!i) return;
            const a = map.project(coords[i - 1]), b = map.project(c);
            if (Math.hypot(a.x - b.x, a.y - b.y) >= SIDE_MIN_PX) {
                place([(c[0] + coords[i - 1][0]) / 2, (c[1] + coords[i - 1][1]) / 2], fmtLen(dist(coords[i - 1], c)), "measure-label side");
            }
        });
        if (!st.hidden) {
            st.shapes.forEach(s => {
                if (s.tool === "note" || s.tool === "text") return;
                const style = styleOf(s);
                if (s.tool === "pin") {
                    if (s.name) place(s.coords[0], s.name, "pin-label");
                    return;
                }
                if (s.tool === "coord") return place(s.coords[0], s.name || labelOf(s), "pin-label");
                if (!style.labels) return;
                if (s.tool === "distance") sides(s.coords);
                if (s.tool === "area") sides([...s.coords, s.coords[0]]);
                const center = s.coords[s.coords.length - 1];
                place(s.tool === "area" ? polygonCenter(s.coords) : center, s.name || labelOf(s));
            });
        }
        if (st.draft.length > 1 && st.tool !== "draw") sides(st.draft);
    }

    const polygonCenter = c => [c.reduce((n, p) => n + p[0], 0) / c.length, c.reduce((n, p) => n + p[1], 0) / c.length];

    function renderNoteMarkers() {
        noteMarkers.forEach(m => m.remove());
        noteMarkers = [];
        if (st.hidden) return;
        st.shapes.filter(s => s.tool === "note" || s.tool === "text").forEach(s => {
            const el = document.createElement("div");
            el.className = s.tool === "note" ? "sticky" : "map-text";
            const field = document.createElement("textarea");
            field.rows = s.tool === "note" ? 4 : 1;
            field.value = s.name || "";
            field.placeholder = t(s.tool === "note" ? "tool_note" : "tool_text");
            field.addEventListener("input", () => { s.name = field.value; save(); });
            field.addEventListener("mousedown", e => e.stopPropagation());
            const remove = document.createElement("button");
            remove.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            remove.title = t("delete");
            remove.addEventListener("click", e => {
                e.stopPropagation();
                remember();
                st.shapes = st.shapes.filter(x => x !== s);
                save();
                render();
            });
            el.append(field, remove);
            const marker = new maplibregl.Marker({ element: el, draggable: true, anchor: "top-left" }).setLngLat(s.coords[0]).addTo(map);
            marker.on("dragend", () => { remember(); s.coords = [marker.getLngLat().toArray()]; save(); });
            noteMarkers.push(marker);
            if (s.isNew) { delete s.isNew; setTimeout(() => field.focus(), 0); }
        });
    }

    function renderHint() {
        $("toolHint").hidden = !st.tool;
        if (st.tool) $("toolHintText").textContent = t(`hint_${st.tool}`);
        $("toolFinish").hidden = !(st.tool === "distance" && st.draft.length > 1 || st.tool === "area" && st.draft.length > 2);
    }

    function setFly(id) {
        st.fly = id;
        document.querySelectorAll(".fly-group").forEach(group => group.classList.toggle("open", group.dataset.fly === id));
    }

    function renderDock() {
        const count = st.shapes.length;
        const toolGroup = group => {
            const current = group.tools.find(([id]) => id === st.tool);
            const buttons = group.tools.map(([id, icon]) => `<button class="dock-btn ${st.tool === id ? "on" : ""}" data-tool="${id}" title="${t(`tool_${id}`)}"><i class="${icon}"></i></button>`).join("");
            return `<div class="fly-group" data-fly="${group.id}">
                <button class="dock-btn ${current ? "on" : ""}" data-group="${group.id}" title="${t(`group_${group.id}`)}"><i class="${current ? current[1] : group.icon}"></i></button>
                <div class="fly">${buttons}</div>
            </div>`;
        };
        $("toolDock").innerHTML = `
            ${GROUPS.map(toolGroup).join("")}
            <div class="fly-group" data-fly="actions">
                <button class="dock-btn ${st.saving ? "on" : ""}" data-group="actions" title="${t("group_actions")}"><i class="fa-solid fa-ellipsis"></i></button>
                <div class="fly">
                    <button class="dock-btn" data-act="undo" title="${t("undo")}" ${st.history.length || st.draft.length ? "" : "disabled"}><i class="fa-solid fa-rotate-left"></i></button>
                    <button class="dock-btn" data-act="hide" title="${t(st.hidden ? "shapesShow" : "shapesHide")}" ${count ? "" : "disabled"}><i class="fa-solid ${st.hidden ? "fa-eye-slash" : "fa-eye"}"></i></button>
                    <button class="dock-btn ${st.saving ? "on" : ""}" data-act="save" title="${t("saveAs")}"><i class="fa-solid fa-download"></i></button>
                    <button class="dock-btn" id="shareBtn" title="${t("share")}"><i class="fa-solid fa-share-nodes"></i></button>
                    ${count ? `<button class="dock-btn" data-act="clear" title="${t("shapesDelete")}"><i class="fa-regular fa-trash-can"></i></button>` : ""}
                </div>
            </div>
        `;
        $("shareBtn").hidden = !isAdmin();
        $("saveMenu").hidden = !st.saving;
        setFly(st.fly);
    }

    function pickedShape() {
        return st.shapes.find(s => s.id === st.picked) || null;
    }

    function renderPanel() {
        const shape = pickedShape();
        const show = STYLED.includes(st.tool) || (shape && STYLED.includes(shape.tool)) ;
        $("drawPanel").hidden = !show;
        if (!show) return;
        const style = shape ? styleOf(shape) : st.style;
        const on = active => active ? "on" : "";
        const isDrawing = st.tool && st.tool !== "draw";
        $("drawPanel").innerHTML = `
            ${COLORS.map(c => `<button class="swatch ${style.color === c ? "on" : ""}" style="background:${c}" data-style="color" data-value="${c}" aria-label="${c}"></button>`).join("")}
            <span class="dock-sep"></span>
            ${[1, 2, 3].map(w => `<button class="panel-btn ${on(style.width === w)}" data-style="width" data-value="${w}" title="${t("drawWidth")} ${w}"><span class="line-sample" style="height:${WIDTHS[w]}px"></span></button>`).join("")}
            <span class="dock-sep"></span>
            ${["solid", "dash", "dot"].map(d => `<button class="panel-btn ${on(style.dash === d)}" data-style="dash" data-value="${d}" title="${t(`dash_${d}`)}"><span class="dash-sample ${d}"></span></button>`).join("")}
            <span class="dock-sep"></span>
            <button class="panel-btn" data-style="fill" data-value="${(style.fill + 1) % 3}" title="${t("drawFill")}"><i class="fa-solid ${["fa-square-full empty", "fa-circle-half-stroke", "fa-square-full"][style.fill]}"></i></button>
            <button class="panel-btn ${on(style.labels)}" data-style="labels" data-value="${style.labels ? 0 : 1}" title="${t("drawLabels")}"><i class="fa-solid fa-tag"></i></button>
            ${isDrawing ? `<button class="panel-btn ${on(st.snap)}" data-flag="snap" title="${t("drawSnap")}"><i class="fa-solid fa-magnet"></i></button>
            <button class="panel-btn ortho ${on(st.ortho)}" data-flag="ortho" title="${t("drawOrtho")}">90°</button>` : ""}
            ${shape ? `<input class="panel-name" id="shapeName" maxlength="60" value="${esc(shape.name || "")}" placeholder="${esc(labelOf(shape) || t("tool_pin"))}">
            <button class="panel-btn" data-act="deleteShape" title="${t("delete")}"><i class="fa-regular fa-trash-can"></i></button>
            <button class="panel-btn" data-act="unpick" title="${t("close")}"><i class="fa-solid fa-xmark"></i></button>` : ""}
        `;
    }

    function render() {
        if (!ready) return;
        renderSource();
        renderLabels();
        renderNoteMarkers();
        renderHint();
        renderDock();
        renderPanel();
    }

    /* Yapışma */
    function snapPoint(point) {
        const at = map.project(point);
        let best = null, bestPx = SNAP_PX;
        const near = lngLat => {
            const p = map.project(lngLat);
            const px = Math.hypot(p.x - at.x, p.y - at.y);
            if (px < bestPx) { best = lngLat; bestPx = px; }
        };
        const paths = [...st.shapes.filter(s => s.coords.length).map(s => s.tool === "area" ? [...s.coords, s.coords[0]] : s.coords), ...routePaths()];
        paths.forEach(path => path.forEach(near));
        if (best) return best;

        let lineBest = null, linePx = SNAP_LINE_PX;
        paths.forEach(path => path.forEach((c, i) => {
            if (!i) return;
            const a = map.project(path[i - 1]), b = map.project(c);
            const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
            if (!len) return;
            const k = Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / len));
            const q = { x: a.x + k * dx, y: a.y + k * dy };
            const px = Math.hypot(q.x - at.x, q.y - at.y);
            if (px < linePx) { lineBest = map.unproject([q.x, q.y]).toArray(); linePx = px; }
        }));
        return lineBest || point;
    }

    function constrain(point, event) {
        let p = st.snap && !event?.altKey ? snapPoint(point) : point;
        const last = st.draft[st.draft.length - 1];
        const shift = event?.shiftKey;
        if (last && (shift || (st.ortho && st.draft.length > 1))) {
            const a = map.project(last), b = map.project(p);
            let base = 0;
            if (st.ortho && st.draft.length > 1) {
                const f0 = map.project(st.draft[0]), f1 = map.project(st.draft[1]);
                base = Math.atan2(f1.y - f0.y, f1.x - f0.x);
            }
            const step = shift ? Math.PI / 4 : Math.PI / 2;
            const angle = base + Math.round((Math.atan2(b.y - a.y, b.x - a.x) - base) / step) * step;
            const r = Math.hypot(b.x - a.x, b.y - a.y);
            p = map.unproject([a.x + r * Math.cos(angle), a.y + r * Math.sin(angle)]).toArray();
        }
        return p;
    }

    /* Alət axını */
    function setTool(tool) {
        st.tool = tool;
        st.draft = [];
        st.hover = null;
        st.picked = null;
        $("measureTip").hidden = true;
        if (tool) {
            map.doubleClickZoom.disable();
            map.getCanvas().style.cursor = "crosshair";
        } else {
            map.doubleClickZoom.enable();
            map.getCanvas().style.cursor = "";
        }
        render();
    }

    function finish() {
        const needed = st.tool === "area" ? 3 : 2;
        // İkiqat klik eyni nöqtəni iki dəfə əlavə edir
        const coords = st.draft.filter((c, i) => !i || dist(c, st.draft[i - 1]) > .01);
        st.draft = [];
        st.hover = null;
        $("measureTip").hidden = true;
        if (coords.length >= needed) addShape({ tool: st.tool, coords });
        render();
    }

    function addPoint(point, event) {
        const p = constrain(point, event);
        const tool = st.tool;
        if (tool === "distance" || tool === "area") {
            st.draft.push(p);
            render();
        } else if (tool === "circle") {
            if (!st.draft.length) {
                st.draft.push(p);
                render();
                return;
            }
            const center = st.draft[0];
            st.draft = [];
            st.hover = null;
            $("measureTip").hidden = true;
            addShape({ tool, coords: [center], radius: dist(center, p) });
            render();
        } else if (tool === "coord") {
            addShape({ tool, coords: [p] });
            navigator.clipboard?.writeText(fmtCoord(p)).then(() => toast(`${t("copied")}: ${fmtCoord(p)}`)).catch(() => {});
            render();
        } else if (tool === "pin") {
            const s = addShape({ tool, coords: [p] });
            setTool(null);
            st.picked = s.id;
            render();
        } else if (tool === "note" || tool === "text") {
            addShape({ tool, coords: [p], isNew: true });
            setTool(null);
        }
    }

    function undo() {
        if (st.draft.length) {
            st.draft.pop();
        } else if (st.history.length) {
            st.shapes = JSON.parse(st.history.pop());
            st.picked = null;
            save();
        }
        render();
    }

    function hitShape(e) {
        const box = [[e.point.x - 5, e.point.y - 5], [e.point.x + 5, e.point.y + 5]];
        return map.queryRenderedFeatures(box, { layers: ["draw-points", ...LINE_LAYERS, "draw-fill"] })[0] || null;
    }

    function saveKmz() {
        const coordText = c => c.map(p => `${p[0]},${p[1]},0`).join(" ");
        const placemark = s => {
            const name = esc(s.name || labelOf(s) || t(`tool_${s.tool}`));
            if (s.coords.length === 1 && s.tool !== "circle") return `<Placemark><name>${name}</name><Point><coordinates>${coordText(s.coords)}</coordinates></Point></Placemark>`;
            if (s.tool === "area" || s.tool === "circle") {
                const ring = s.tool === "circle" ? circleRing(s.coords[0], s.radius) : [...s.coords, s.coords[0]];
                return `<Placemark><name>${name}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${coordText(ring)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
            }
            return `<Placemark><name>${name}</name><LineString><coordinates>${coordText(s.coords)}</coordinates></LineString></Placemark>`;
        };
        const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${st.shapes.map(placemark).join("")}</Document></kml>`;
        const zip = new JSZip();
        zip.file("doc.kml", kml);
        zip.generateAsync({ type: "blob" }).then(blob => {
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = "bcg-cizgiler.kmz";
            link.click();
            URL.revokeObjectURL(link.href);
        });
    }

    function applyStyle(key, value) {
        const val = key === "width" || key === "fill" ? Number(value) : key === "labels" ? value === "1" : value;
        const shape = pickedShape();
        if (shape) {
            remember();
            shape.style = { ...styleOf(shape), [key]: val };
            save();
        }
        st.style = { ...st.style, [key]: val };
        writeStore(KEYS.style, st.style);
        render();
    }

    function bindUi() {
        document.querySelector(".toolbar").addEventListener("click", e => {
            const button = e.target.closest("button");
            if (!button) return;
            if (button.dataset.group) setFly(st.fly === button.dataset.group ? null : button.dataset.group);
            else if (button.dataset.act !== "undo" && button.dataset.act !== "hide" && !button.closest("#zoomInBtn, #zoomOutBtn")) setFly(null);
        });
        document.addEventListener("click", e => {
            if (!e.target.closest?.(".toolbar")) setFly(null);
        });
        $("toolDock").addEventListener("click", e => {
            const button = e.target.closest("button");
            if (!button || button.id === "shareBtn") return;
            if (button.dataset.tool) {
                setTool(st.tool === button.dataset.tool ? null : button.dataset.tool);
                return;
            }
            const act = button.dataset.act;
            if (act === "undo") undo();
            if (act === "hide") { st.hidden = !st.hidden; render(); }
            if (act === "save") { st.saving = !st.saving; render(); }
            if (act === "clear" && confirm(t("shapesConfirm"))) {
                remember();
                st.shapes = [];
                st.picked = null;
                save();
                render();
            }
        });
        $("drawPanel").addEventListener("click", e => {
            const button = e.target.closest("button");
            if (!button) return;
            if (button.dataset.style) applyStyle(button.dataset.style, button.dataset.value);
            if (button.dataset.flag) {
                st[button.dataset.flag] = !st[button.dataset.flag];
                writeStore(KEYS[button.dataset.flag], st[button.dataset.flag]);
                render();
            }
            if (button.dataset.act === "unpick") { st.picked = null; render(); }
            if (button.dataset.act === "deleteShape") {
                remember();
                st.shapes = st.shapes.filter(s => s.id !== st.picked);
                st.picked = null;
                save();
                render();
            }
        });
        $("drawPanel").addEventListener("change", e => {
            if (e.target.id !== "shapeName") return;
            remember();
            pickedShape().name = e.target.value.trim();
            save();
            renderLabels();
        });
        $("toolFinish").addEventListener("click", finish);
        $("toolClose").addEventListener("click", () => setTool(null));
        $("saveKmz").addEventListener("click", () => { st.saving = false; render(); saveKmz(); });
        $("savePdf").addEventListener("click", () => { st.saving = false; render(); if (window.openPrintCropMode) window.openPrintCropMode(); else window.print(); });
    }

    function bindMap() {
        map.on("mousemove", e => {
            if (moving) {
                const s = st.shapes.find(x => x.id === moving.id);
                s.coords[moving.vi] = e.lngLat.toArray();
                renderSource();
                return;
            }
            if (!st.tool) {
                map.getCanvas().style.cursor = !window.routeHover && hitShape(e) ? "pointer" : "";
                return;
            }
            if (freehand) {
                st.draft.push(e.lngLat.toArray());
                renderSource();
                return;
            }
            st.hover = st.draft.length ? constrain(e.lngLat.toArray(), e.originalEvent) : null;
            renderSource();
            if (st.hover) {
                const last = st.draft[st.draft.length - 1];
                const total = st.tool === "circle" ? `R ${fmtLen(dist(st.draft[0], st.hover))}` :
                    st.tool === "area" && st.draft.length > 1 ? fmtArea(ringArea([...st.draft, st.hover])) : fmtLen(lineLength(st.draft) + dist(last, st.hover));
                const tip = $("measureTip");
                tip.hidden = false;
                tip.style.left = `${e.originalEvent.clientX}px`;
                tip.style.top = `${e.originalEvent.clientY}px`;
                tip.textContent = total;
            }
        });

        map.on("mousedown", e => {
            if (e.originalEvent.button !== 0) return;
            if (st.tool === "draw") {
                e.preventDefault();
                freehand = true;
                st.draft = [e.lngLat.toArray()];
                return;
            }
            if (st.tool || st.picked === null) return;
            const vertex = hitShape(e);
            if (vertex?.properties.vertex) {
                e.preventDefault();
                remember();
                moving = { id: vertex.properties.id, vi: vertex.properties.vi };
            }
        });

        window.addEventListener("mouseup", () => {
            if (freehand) {
                freehand = false;
                const coords = st.draft;
                st.draft = [];
                if (coords.length > 1) addShape({ tool: "draw", coords });
                render();
            }
            if (moving) {
                moving = null;
                save();
                render();
            }
        });

        map.on("dblclick", () => {
            if (st.tool === "distance" || st.tool === "area") finish();
        });
        map.on("zoomend", () => { if (ready) renderLabels(); });

        document.addEventListener("keydown", e => {
            if (e.target.matches?.("input, textarea, select")) return;
            if (document.querySelector("dialog[open], #login:not([hidden])")) return;
            if (e.key === "Escape" && st.tool) setTool(null);
            if (e.key === "Enter" && st.draft.length) finish();
            if (e.key === "F8") {
                e.preventDefault();
                st.ortho = !st.ortho;
                writeStore(KEYS.ortho, st.ortho);
                render();
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") undo();
        });
    }

    return {
        layers,
        /* Xəritə yüklənəndə */
        init() {
            ready = true;
            bindUi();
            bindMap();
            if (!st.sessionOnly) setShapes(loadOwnShapes());
            else render();
        },
        /* Daxil olan / çıxan istifadəçi: həmin istifadəçinin çizgiləri yüklənir */
        setUser(userId) {
            shapesKey = userId ? `${KEYS.shapes}.${userId}` : null;
            if (st.sessionOnly) return;
            st.history = [];
            st.picked = null;
            st.shapes = [];
            if (ready) setShapes(loadOwnShapes());
        },
        /* Klik alət və ya çizgi üçündürsə true qaytarır */
        handleClick(e) {
            if (st.tool) {
                if (st.tool !== "draw") addPoint(e.lngLat.toArray(), e.originalEvent);
                return true;
            }
            const hit = hitShape(e);
            if (hit && hit.properties.id > 0) {
                st.picked = hit.properties.id;
                render();
                return true;
            }
            if (st.picked !== null) { st.picked = null; render(); }
            return false;
        },
        rightClick() {
            if (st.tool) undo();
        },
        isActive: () => Boolean(st.tool),
        shapes: () => st.shapes,
        loadShared(shapes) {
            st.sessionOnly = true;
            st.shapes = shapes;
            st.nextId = shapes.reduce((max, s) => Math.max(max, s.id + 1), 1);
            if (ready) render();
        },
        refresh: render,
        length: coordsLatLng => lineLength(coordsLatLng.map(([lat, lng]) => [lng, lat]))
    };
})();
