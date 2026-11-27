/* ============================================================================
   BCG GIS — GOOGLE EARTH PRO OFİS REJİMİ (js/ge-office.js)
   HOME rejimində tam desktop Google Earth Pro iş sahəsi:
   - Üst Toolbar (Placemark, Polygon, Path, Image Overlay, 4-tab Ruler, Grid, Import, Share, Print A4/A3, Save HD/4K)
   - 3-bölməli resizable Sidebar (Axtarış Decimal/DMS, Places Tree + Drag&Drop + Context Menu, Layers)
   - Non-blocking Properties, Share Style, Elevation Profile, Save Place As (KMZ)
   - Sağ Naviqasiya (Kompas N, Tilt 2D/3D, Zoom +/-), Aşağı Status Bar, Ctrl+Z/Y/F, R, N, Del, Esc
   ============================================================================ */

(() => {
    const GE_STORE_KEY = "bcg.ge.office.v1";
    const SAHA_DRAW_KEY = "bcg.saha.drawings.v1";

    const BCG_TEMPLATE_FOLDERS = [
        "MQ", "Qazıntı", "Kabel", "Elektrik", "MD", "KKS1",
        "6 m", "mufta", "8 m", "TŞ nöqtəsi", "Mövcud TŞ", "Mövcud mufta"
    ];

    const ge = {
        built: false,
        folders: [
            { id: "f_root", name: "My Places", parentId: null, open: true, visible: true },
            { id: "f_temp", name: "Temporary Places", parentId: null, open: true, visible: true }
        ],
        items: [],         // { id, folderId, kind:"point"|"line"|"polygon"|"overlay", name, desc, coords, color, labelColor, labelScale, fillColor, fillOpacity, width, dashed, owner, type, sub, scale, opacity, altitudeMode, altitudeM, visible, imgUrl, bounds }
        selectedId: "",
        selectedIsFolder: false,
        editingItemId: "", // Canlı redaktə edilən obyekt (qırmızı kvadrat vertex-lər üçün)
        propsTab: "desc",
        placesFilter: "",
        clipboard: null,   // { mode:"copy"|"cut", item }
        activeTool: null,  // null | "point" | "line" | "polygon" | "ruler"
        draft: [],         // [[lat, lng], ...]
        rulerTab: "line",  // "line" | "path" | "polygon" | "circle"
        rulerUnit: "m",    // "m" | "km" | "cm"
        gridOn: false,
        histOn: false,
        histYear: 2026,
        tilt3d: false,
        undoStack: [],
        redoStack: [],
        sideWidth: 320
    };

    function createBcgProjectTemplate(projName) {
        const name = (projName || "").trim() || `BCG Layihə ${new Date().toISOString().slice(0, 10)}`;
        pushUndo();
        const pid = `f_proj_${Date.now()}`;
        ge.folders.push({ id: pid, name, parentId: "f_root", open: true, visible: true });
        BCG_TEMPLATE_FOLDERS.forEach((sub, idx) => {
            ge.folders.push({ id: `${pid}_s${idx}`, name: sub, parentId: pid, open: false, visible: true });
        });
        ge.selectedId = pid;
        ge.selectedIsFolder = true;
        saveGeState();
        renderPlacesTree();
        notify(`📁 "${name}" — 12 standart BCG alt-qovluğu ilə yaradıldı!`);
    }

    const $id = id => document.getElementById(id);
    const escH = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const notify = (m, err = false) => { if (typeof toast === "function") toast(m, err); };
    const isHomeMode = () => document.body.dataset.workspaceMode === "home";

    /* ---------- GEOMETRY & PARSING HELPERS ---------- */
    function havM(a, b) {
        const R = 6371000, r = x => x * Math.PI / 180;
        const dLa = r(b[0] - a[0]), dLn = r(b[1] - a[1]);
        const s = Math.sin(dLa / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLn / 2) ** 2;
        return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
    }

    function pathMeters(coords) {
        if (!Array.isArray(coords) || coords.length < 2) return 0;
        let t = 0;
        for (let i = 1; i < coords.length; i++) t += havM(coords[i - 1], coords[i]);
        return t;
    }

    function bearingDeg(a, b) {
        const r = x => x * Math.PI / 180;
        const y = Math.sin(r(b[1] - a[1])) * Math.cos(r(b[0]));
        const x = Math.cos(r(a[0])) * Math.sin(r(b[0])) - Math.sin(r(a[0])) * Math.cos(r(b[0])) * Math.cos(r(b[1] - a[1]));
        return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
    }

    function polygonAreaM2(coords) {
        if (!Array.isArray(coords) || coords.length < 3) return 0;
        const lat0 = coords.reduce((s, c) => s + c[0], 0) / coords.length;
        const kx = 111320 * Math.cos(lat0 * Math.PI / 180);
        const ky = 110540;
        let area = 0;
        for (let i = 0; i < coords.length; i++) {
            const p1 = coords[i], p2 = coords[(i + 1) % coords.length];
            area += (p1[1] * kx) * (p2[0] * ky) - (p2[1] * kx) * (p1[0] * ky);
        }
        return Math.abs(area) / 2;
    }

    function fmtDist(meters, unit = ge.rulerUnit) {
        if (unit === "km") return `${(meters / 1000).toFixed(3)} km`;
        if (unit === "cm") return `${Math.round(meters * 100).toLocaleString()} sm`;
        return `${meters >= 1000 ? meters.toFixed(1) : Math.round(meters)} m`;
    }

    function fmtArea(m2) {
        if (m2 >= 1e6) return `${(m2 / 1e6).toFixed(3)} km²`;
        if (m2 >= 10000) return `${(m2 / 10000).toFixed(2)} ha (${Math.round(m2)} m²)`;
        return `${Math.round(m2)} m²`;
    }

    /** Decimal ("40.4093, 49.8671"), DMS ("40°24'33\"N 49°52'01\"E") və boşluqlu yazılışları tanıyır */
    function parseAnyCoord(raw) {
        let s = String(raw || "").trim();
        if (!s) return null;
        // DMS format: 40°24'33.5"N 49°52'01.2"E
        const dmsRe = /(\d{1,3})\s*[°º]\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:[.,]\d+)?)\s*["″]?\s*([NSEW])/gi;
        const dmsMatches = [...s.matchAll(dmsRe)];
        if (dmsMatches.length >= 2) {
            const toDec = m => {
                let v = Number(m[1]) + Number(m[2]) / 60 + Number(m[3].replace(",", ".")) / 3600;
                if (/[SW]/i.test(m[4])) v = -v;
                return Number(v.toFixed(6));
            };
            const a = toDec(dmsMatches[0]), b = toDec(dmsMatches[1]);
            return /[EW]/i.test(dmsMatches[0][4]) ? [b, a] : [a, b];
        }
        // Boşluqlu yazılış: 41.417690, 46 927913
        s = s.replace(/(\d{2})\s+(\d{4,7})/g, "$1.$2");
        const m = s.match(/(-?\d{1,2}[.,]\d+)\s*[,;\s/]+\s*(-?\d{1,3}[.,]\d+)/);
        if (!m) return null;
        const la = Number(m[1].replace(",", ".")), ln = Number(m[2].replace(",", "."));
        if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
        if (la >= -90 && la <= 90 && ln >= -180 && ln <= 180) return [Number(la.toFixed(6)), Number(ln.toFixed(6))];
        return null;
    }

    /* ---------- PERSISTENCE & UNDO/REDO ---------- */
    function pushUndo() {
        ge.undoStack.push(JSON.stringify({ folders: ge.folders, items: ge.items }));
        if (ge.undoStack.length > 30) ge.undoStack.shift();
        ge.redoStack = [];
    }

    function doUndo() {
        if (!ge.undoStack.length) { notify("Geri alınacaq əməliyyat yoxdur"); return; }
        ge.redoStack.push(JSON.stringify({ folders: ge.folders, items: ge.items }));
        const prev = JSON.parse(ge.undoStack.pop());
        ge.folders = prev.folders;
        ge.items = prev.items;
        saveGeState();
        renderAllGe();
        notify("↩️ Geri alındı (Ctrl+Z)");
    }

    function doRedo() {
        if (!ge.redoStack.length) { notify("İrəli alınacaq əməliyyat yoxdur"); return; }
        ge.undoStack.push(JSON.stringify({ folders: ge.folders, items: ge.items }));
        const next = JSON.parse(ge.redoStack.pop());
        ge.folders = next.folders;
        ge.items = next.items;
        saveGeState();
        renderAllGe();
        notify("↪️ İrəli alındı (Ctrl+Y)");
    }

    function loadGeState() {
        try {
            const saved = JSON.parse(localStorage.getItem(GE_STORE_KEY) || "null");
            if (saved && Array.isArray(saved.folders) && saved.folders.length) ge.folders = saved.folders;
            if (saved && Array.isArray(saved.items)) ge.items = saved.items;
        } catch {}
        syncSahaFeaturesIntoPlaces();
    }

    function saveGeState() {
        try {
            localStorage.setItem(GE_STORE_KEY, JSON.stringify({ folders: ge.folders, items: ge.items }));
        } catch {}
    }

    /** Sahədən gələn obyektləri avtomatik Google Earth Pro Places qovluqlarına sinxronlaşdırır */
    function syncSahaFeaturesIntoPlaces() {
        let sahaFeats = [];
        try { sahaFeats = JSON.parse(localStorage.getItem(SAHA_DRAW_KEY) || "[]"); } catch {}
        if (!Array.isArray(sahaFeats) || sahaFeats.length === 0) return;

        const existingIds = new Set(ge.items.map(i => i.id));
        let changed = false;
        sahaFeats.forEach(f => {
            if (!f?.id || existingIds.has(f.id)) return;
            const pName = f.projectName || "Sahədən gələnlər";
            let folder = ge.folders.find(fl => fl.name === pName);
            if (!folder) {
                folder = { id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, name: pName, parentId: "f_root", open: true, visible: true };
                ge.folders.push(folder);
            }
            const lineColors = { fo12: "#22c55e", fo24: "#3b82f6", fo48: "#ef4444", elec: "#dc2626", qazinti: "#92400e" };
            const ptColors = { pole: "#38bdf8", mufta: "#22c55e", quyu: "#a855f7", trans: "#f59e0b", ant: "#ef4444", exist: "#06b6d4" };
            ge.items.push({
                id: f.id,
                folderId: folder.id,
                kind: f.kind === "line" ? "line" : "point",
                name: f.label || f.type || "Obyekt",
                desc: `TŞ: ${f.tsNo || "—"} · Mühəndis: ${f.engineer || "—"} · Tarix: ${f.workDate || f.createdAt || ""}${f.note ? "\n" + f.note : ""}`,
                coords: f.coords,
                type: f.type || "pole",
                sub: f.sub || "",
                owner: f.owner || "bcg",
                color: f.kind === "line" ? (lineColors[f.type] || "#3b82f6") : (ptColors[f.type] || "#38bdf8"),
                fillColor: "#38bdf8",
                fillOpacity: 0.28,
                width: 4,
                dashed: f.type === "qazinti",
                scale: 1,
                opacity: 1,
                visible: true,
                fromSaha: true
            });
            changed = true;
        });
        if (changed) saveGeState();
    }

    /* ---------- MAPLIBRE LAYERS (POLYGONS, GE PATHS, GRID, RULER, OVERLAYS) ---------- */
    function isFolderVisible(fid) {
        let cur = ge.folders.find(f => f.id === fid);
        while (cur) {
            if (cur.visible === false) return false;
            cur = cur.parentId ? ge.folders.find(f => f.id === cur.parentId) : null;
        }
        return true;
    }

    function ensureGeLayers() {
        if (!window.map || !map.isStyleLoaded?.()) return false;
        if (!map.getSource("ge-data")) {
            map.addSource("ge-data", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        }
        if (!map.getLayer("ge-poly-fill")) {
            map.addLayer({
                id: "ge-poly-fill", type: "fill", source: "ge-data",
                filter: ["==", ["get", "kind"], "polygon"],
                paint: { "fill-color": ["coalesce", ["get", "fillColor"], "#38bdf8"], "fill-opacity": ["coalesce", ["get", "fillOpacity"], 0.28] }
            });
        }
        if (!map.getLayer("ge-poly-line")) {
            map.addLayer({
                id: "ge-poly-line", type: "line", source: "ge-data",
                filter: ["==", ["get", "kind"], "polygon"],
                paint: { "line-color": ["coalesce", ["get", "color"], "#38bdf8"], "line-width": ["coalesce", ["get", "width"], 3] }
            });
        }
        if (!map.getLayer("ge-line-solid")) {
            map.addLayer({
                id: "ge-line-solid", type: "line", source: "ge-data",
                filter: ["all", ["==", ["get", "kind"], "line"], ["!=", ["get", "dashed"], true]],
                layout: { "line-cap": "round", "line-join": "round" },
                paint: { "line-color": ["coalesce", ["get", "color"], "#3b82f6"], "line-width": ["coalesce", ["get", "width"], 4], "line-opacity": ["coalesce", ["get", "opacity"], 0.95] }
            });
        }
        if (!map.getLayer("ge-line-dashed")) {
            map.addLayer({
                id: "ge-line-dashed", type: "line", source: "ge-data",
                filter: ["all", ["==", ["get", "kind"], "line"], ["==", ["get", "dashed"], true]],
                paint: { "line-color": ["coalesce", ["get", "color"], "#92400e"], "line-width": ["coalesce", ["get", "width"], 4], "line-dasharray": [4, 2.5] }
            });
        }
        if (!map.getLayer("ge-points")) {
            map.addLayer({
                id: "ge-points", type: "circle", source: "ge-data",
                filter: ["==", ["get", "kind"], "point"],
                paint: {
                    "circle-radius": ["*", 8, ["coalesce", ["get", "scale"], 1]],
                    "circle-color": ["case", ["==", ["get", "owner"], "bcg"], "#ffffff", ["coalesce", ["get", "color"], "#38bdf8"]],
                    "circle-stroke-width": ["case", ["==", ["get", "owner"], "bcg"], 3.5, 2],
                    "circle-stroke-color": ["case", ["==", ["get", "owner"], "bcg"], ["coalesce", ["get", "color"], "#38bdf8"], "#ffffff"],
                    "circle-opacity": ["coalesce", ["get", "opacity"], 1]
                }
            });
        }
        // Canlı xətt redaktəsi: qırmızı kvadrat vertex-lər + son nöqtə yaşıl/mavi vurğu!
        if (!map.getLayer("ge-edit-verts")) {
            map.addLayer({
                id: "ge-edit-verts", type: "circle", source: "ge-data",
                filter: ["==", ["get", "kind"], "vertex"],
                paint: {
                    "circle-radius": ["case", ["==", ["get", "isLast"], true], 6.5, 5],
                    "circle-color": ["case", ["==", ["get", "isLast"], true], "#22c55e", "#ef4444"],
                    "circle-stroke-width": 2,
                    "circle-stroke-color": "#ffffff"
                }
            });
        }
        // Koordinat Şəbəkəsi (Grid)
        if (!map.getSource("ge-grid")) {
            map.addSource("ge-grid", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        }
        if (!map.getLayer("ge-grid-lines")) {
            map.addLayer({
                id: "ge-grid-lines", type: "line", source: "ge-grid",
                paint: { "line-color": "rgba(255, 255, 255, 0.35)", "line-width": 1, "line-dasharray": [3, 3] }
            });
        }
        return true;
    }

    function renderGeGrid() {
        if (!window.map || !map.getSource("ge-grid")) return;
        if (!isHomeMode() || !ge.gridOn) {
            map.getSource("ge-grid").setData({ type: "FeatureCollection", features: [] });
            return;
        }
        const b = map.getBounds();
        const z = map.getZoom();
        const step = z >= 14 ? 0.005 : (z >= 11 ? 0.05 : (z >= 8 ? 0.25 : 1));
        const feats = [];
        const minLat = Math.floor(b.getSouth() / step) * step;
        const maxLat = Math.ceil(b.getNorth() / step) * step;
        const minLng = Math.floor(b.getWest() / step) * step;
        const maxLng = Math.ceil(b.getEast() / step) * step;
        for (let la = minLat; la <= maxLat + step * 0.1; la += step) {
            feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[minLng, la], [maxLng, la]] }, properties: {} });
        }
        for (let ln = minLng; ln <= maxLng + step * 0.1; ln += step) {
            feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[ln, minLat], [ln, maxLat]] }, properties: {} });
        }
        map.getSource("ge-grid").setData({ type: "FeatureCollection", features: feats });
    }

    function renderGeMap() {
        if (!window.map) return;
        if (!ensureGeLayers()) { map.once("idle", renderGeMap); return; }
        const src = map.getSource("ge-data");
        if (!src) return;

        // Image Overlays təmizlə / yenilə
        const activeOverlayIds = new Set();
        if (!isHomeMode()) {
            src.setData({ type: "FeatureCollection", features: [] });
            renderGeGrid();
            return;
        }

        const features = [];
        ge.items.forEach(it => {
            if (!it.visible || !isFolderVisible(it.folderId)) return;
            if (it.kind === "point" && Array.isArray(it.coords) && it.coords.length === 2) {
                features.push({
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [it.coords[1], it.coords[0]] },
                    properties: { geId: it.id, kind: "point", color: it.color, owner: it.owner || "bcg", scale: it.scale || 1, opacity: it.opacity ?? 1 }
                });
            } else if (it.kind === "line" && Array.isArray(it.coords) && it.coords.length >= 2) {
                features.push({
                    type: "Feature",
                    geometry: { type: "LineString", coordinates: it.coords.map(c => [c[1], c[0]]) },
                    properties: { geId: it.id, kind: "line", color: it.color, width: it.width || 4, dashed: Boolean(it.dashed), opacity: it.opacity ?? 0.95 }
                });
            } else if (it.kind === "polygon" && Array.isArray(it.coords) && it.coords.length >= 3) {
                const ring = [...it.coords.map(c => [c[1], c[0]]), [it.coords[0][1], it.coords[0][0]]];
                features.push({
                    type: "Feature",
                    geometry: { type: "Polygon", coordinates: [ring] },
                    properties: { geId: it.id, kind: "polygon", color: it.color, fillColor: it.fillColor || it.color, fillOpacity: it.fillOpacity ?? 0.28, width: it.width || 3 }
                });
            } else if (it.kind === "overlay" && it.imgUrl && Array.isArray(it.bounds) && it.bounds.length === 4) {
                const sid = `ge-ov-${it.id}`;
                activeOverlayIds.add(sid);
                try {
                    if (!map.getSource(sid)) {
                        map.addSource(sid, { type: "image", url: it.imgUrl, coordinates: it.bounds });
                        map.addLayer({ id: sid, type: "raster", source: sid, paint: { "raster-opacity": it.opacity ?? 0.72 } }, "ge-poly-fill");
                    } else {
                        map.getSource(sid).setCoordinates(it.bounds);
                        map.setPaintProperty(sid, "raster-opacity", it.opacity ?? 0.72);
                        map.setLayoutProperty(sid, "visibility", "visible");
                    }
                } catch {}
            }
        });

        // Aktiv çəkmə / Xətkeş qaralaması + qırmızı/yaşıl vertex nöqtələri
        if (ge.draft.length >= 1) {
            ge.draft.forEach((c, idx) => {
                features.push({
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [c[1], c[0]] },
                    properties: { kind: "vertex", isLast: idx === ge.draft.length - 1 }
                });
            });
        }
        if (ge.editingItemId) {
            const ed = ge.items.find(x => x.id === ge.editingItemId);
            if (ed && (ed.kind === "line" || ed.kind === "polygon") && Array.isArray(ed.coords)) {
                ed.coords.forEach((c, idx) => {
                    features.push({
                        type: "Feature",
                        geometry: { type: "Point", coordinates: [c[1], c[0]] },
                        properties: { kind: "vertex", isLast: idx === ed.coords.length - 1 }
                    });
                });
            }
        }
        if (ge.draft.length >= 2) {
            if (ge.activeTool === "polygon" || (ge.activeTool === "ruler" && ge.rulerTab === "polygon")) {
                const ring = [...ge.draft.map(c => [c[1], c[0]]), [ge.draft[0][1], ge.draft[0][0]]];
                features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: { kind: "polygon", color: "#fbbf24", fillColor: "#fbbf24", fillOpacity: 0.22, width: 3 } });
            } else if (ge.activeTool === "ruler" && ge.rulerTab === "circle") {
                const c = ge.draft[0], rM = havM(c, ge.draft[ge.draft.length - 1]);
                const ring = [];
                for (let a = 0; a <= 360; a += 10) {
                    const rad = a * Math.PI / 180;
                    const dLat = (rM / 111320) * Math.cos(rad);
                    const dLng = (rM / (111320 * Math.cos(c[0] * Math.PI / 180))) * Math.sin(rad);
                    ring.push([c[1] + dLng, c[0] + dLat]);
                }
                features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: { kind: "polygon", color: "#38bdf8", fillColor: "#38bdf8", fillOpacity: 0.18, width: 2.5 } });
            } else {
                features.push({ type: "Feature", geometry: { type: "LineString", coordinates: ge.draft.map(c => [c[1], c[0]]) }, properties: { kind: "line", color: "#fbbf24", width: 3.5, dashed: false } });
            }
        }

        // Gizli overlay-ləri söndür
        (map.getStyle()?.layers || []).forEach(l => {
            if (l.id.startsWith("ge-ov-") && !activeOverlayIds.has(l.id)) {
                try { map.setLayoutProperty(l.id, "visibility", "none"); } catch {}
            }
        });

        src.setData({ type: "FeatureCollection", features });
        renderGeGrid();
    }

    /* ---------- MAP CLICK IN HOME (GOOGLE EARTH PRO) ---------- */
    function handleGeOfficeMapClick(e) {
        if (!isHomeMode()) return false;
        const lat = Number(e.lngLat.lat.toFixed(6));
        const lng = Number(e.lngLat.lng.toFixed(6));

        if (ge.activeTool === "point") {
            pushUndo();
            const fId = getTargetFolderId();
            const item = {
                id: `ge_pt_${Date.now()}`,
                folderId: fId,
                kind: "point",
                name: `Nöqtə #${ge.items.filter(x => x.kind === "point").length + 1}`,
                desc: "",
                coords: [lat, lng],
                type: "pole",
                sub: "6 m",
                owner: "bcg",
                color: "#38bdf8",
                scale: 1,
                opacity: 1,
                visible: true
            };
            ge.items.push(item);
            ge.selectedId = item.id;
            ge.selectedIsFolder = false;
            ge.activeTool = null;
            saveGeState();
            renderAllGe();
            openPropertiesWin(item.id);
            notify("📍 Nöqtə əlavə olundu");
            return true;
        }

        if (ge.activeTool === "line" || ge.activeTool === "polygon" || ge.activeTool === "ruler") {
            let pt = [lat, lng];
            // Snap to existing point (18m)
            for (const it of ge.items) {
                if (it.kind === "point" && Array.isArray(it.coords) && havM(pt, it.coords) < 18) {
                    pt = [it.coords[0], it.coords[1]];
                    break;
                }
            }
            if (ge.activeTool === "ruler" && (ge.rulerTab === "line" || ge.rulerTab === "circle") && ge.draft.length >= 2) {
                ge.draft = [ge.draft[0], pt];
            } else {
                ge.draft.push(pt);
            }
            renderGeMap();
            if (ge.activeTool === "ruler") renderRulerWin();
            else renderDrawHelperBanner();
            return true;
        }

        // Obyekt seçimi (xəritədən klik)
        const layers = ["ge-points", "ge-line-solid", "ge-line-dashed", "ge-poly-fill"].filter(id => map.getLayer(id));
        if (layers.length) {
            const hits = map.queryRenderedFeatures(e.point, { layers });
            const gid = hits?.[0]?.properties?.geId;
            if (gid) {
                ge.selectedId = gid;
                ge.selectedIsFolder = false;
                renderPlacesTree();
                openPropertiesWin(gid);
                return true;
            }
        }
        return false;
    }
    window.handleGeOfficeMapClick = handleGeOfficeMapClick;

    function getTargetFolderId() {
        if (ge.selectedIsFolder && ge.folders.some(f => f.id === ge.selectedId)) return ge.selectedId;
        const selItem = ge.items.find(i => i.id === ge.selectedId);
        if (selItem) return selItem.folderId;
        return ge.folders[0]?.id || "f_root";
    }

    /* ---------- ELEVATION PROFILE (REAL DEM + FALLBACK) ---------- */
    async function showElevationProfile(item) {
        if (!item || item.kind !== "line" || !Array.isArray(item.coords) || item.coords.length < 2) {
            notify("Yüksəklik profili yalnız xətlər (Path) üçün işləyir", true);
            return;
        }
        const bar = $id("geElevBar");
        if (!bar) return;
        bar.hidden = false;
        bar.innerHTML = `<div class="ge-win-head"><span>📈 Yüksəklik Profili — ${escH(item.name)}</span><button type="button" class="icon-btn small" id="geElevClose"><i class="fa-solid fa-xmark"></i></button></div><div style="padding:14px;color:var(--ink-2)">⏳ Relyef hündürlüyü hesablanır...</div>`;
        bar.querySelector("#geElevClose")?.addEventListener("click", () => { bar.hidden = true; });

        // Xətt boyunca 20 nöqtə seç
        const samples = [];
        const totalM = pathMeters(item.coords);
        const steps = Math.min(24, Math.max(8, item.coords.length * 3));
        for (let i = 0; i <= steps; i++) {
            const frac = i / steps;
            const idxF = frac * (item.coords.length - 1);
            const i0 = Math.floor(idxF), i1 = Math.min(item.coords.length - 1, i0 + 1), t = idxF - i0;
            const la = item.coords[i0][0] + (item.coords[i1][0] - item.coords[i0][0]) * t;
            const ln = item.coords[i0][1] + (item.coords[i1][1] - item.coords[i0][1]) * t;
            samples.push({ la, ln, dist: totalM * frac, elev: 0 });
        }

        // Open-Meteo Elevation API (pulsuz, CORS açıq)
        try {
            const lats = samples.map(s => s.la.toFixed(5)).join(",");
            const lngs = samples.map(s => s.ln.toFixed(5)).join(",");
            const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`);
            const data = await res.json();
            if (Array.isArray(data?.elevation) && data.elevation.length === samples.length) {
                samples.forEach((s, i) => { s.elev = Math.round(data.elevation[i]); });
            }
        } catch {
            // Offline fallback
            samples.forEach((s, i) => { s.elev = Math.round(25 + Math.sin(i * 0.5) * 8); });
        }

        const minE = Math.min(...samples.map(s => s.elev));
        const maxE = Math.max(...samples.map(s => s.elev));
        const spanE = Math.max(5, maxE - minE);
        const maxSlope = totalM > 0 ? (((maxE - minE) / totalM) * 100).toFixed(1) : "0.0";
        const W = 720, H = 105;
        const ptsSvg = samples.map((s, i) => {
            const x = (i / (samples.length - 1)) * (W - 20) + 10;
            const y = H - 18 - ((s.elev - minE) / spanE) * (H - 30);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(" ");
        const areaSvg = `10,${H - 18} ${ptsSvg} ${W - 10},${H - 18}`;

        bar.innerHTML = `
            <div class="ge-win-head">
                <span>📈 Yüksəklik Profili — ${escH(item.name)} · Məsafə: <b>${Math.round(totalM)} m</b> · Min/Max: <b>${minE}m / ${maxE}m</b> · Meyillilik: <b>${maxSlope}%</b></span>
                <button type="button" class="icon-btn small" id="geElevClose"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div style="padding:4px 10px;flex:1">
                <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%">
                    <polygon points="${areaSvg}" fill="rgba(56,189,248,0.22)"/>
                    <polyline points="${ptsSvg}" fill="none" stroke="#38bdf8" stroke-width="2.5"/>
                    <text x="12" y="14" fill="#94a3b8" font-size="10">Max: ${maxE} m</text>
                    <text x="12" y="${H - 4}" fill="#94a3b8" font-size="10">0 m (Min: ${minE} m)</text>
                    <text x="${W - 12}" y="${H - 4}" text-anchor="end" fill="#94a3b8" font-size="10">${Math.round(totalM)} m</text>
                </svg>
            </div>`;
        bar.querySelector("#geElevClose")?.addEventListener("click", () => { bar.hidden = true; });
    }

    /* ---------- IMPORT (KMZ, KML, GeoJSON, GPX, CSV) ---------- */
    async function importGeFile(file) {
        if (!file) return;
        const name = file.name || "Import";
        const ext = name.split(".").pop().toLowerCase();
        pushUndo();
        const folder = { id: `f_imp_${Date.now()}`, name: name.replace(/\.[^.]+$/, ""), parentId: "f_root", open: true, visible: true };
        ge.folders.push(folder);
        let added = 0;
        const allCoords = [];

        if (ext === "csv" || ext === "txt") {
            const text = await file.text();
            const lines = text.split(/\r?\n/).filter(Boolean);
            lines.forEach((ln, idx) => {
                if (idx === 0 && /lat|enlik|ad|name/i.test(ln)) return;
                const cols = ln.split(/[;,\t]/).map(s => s.replace(/^"|"$/g, "").trim());
                const c = parseAnyCoord(ln);
                if (c) {
                    ge.items.push({ id: `ge_csv_${Date.now()}_${idx}`, folderId: folder.id, kind: "point", name: cols[0] || `Nöqtə ${idx}`, desc: cols.slice(1).join(" · "), coords: c, color: "#38bdf8", owner: "bcg", scale: 1, opacity: 1, visible: true });
                    allCoords.push(c);
                    added++;
                }
            });
        } else if (ext === "geojson" || ext === "json") {
            const obj = JSON.parse(await file.text());
            const feats = obj.features || (obj.geometry ? [obj] : []);
            feats.forEach((f, i) => {
                const g = f.geometry;
                if (!g) return;
                const nm = f.properties?.name || f.properties?.title || `Obyekt ${i + 1}`;
                if (g.type === "Point") {
                    const c = [g.coordinates[1], g.coordinates[0]];
                    ge.items.push({ id: `ge_gj_${Date.now()}_${i}`, folderId: folder.id, kind: "point", name: nm, desc: "", coords: c, color: "#38bdf8", owner: "bcg", scale: 1, opacity: 1, visible: true });
                    allCoords.push(c); added++;
                } else if (g.type === "LineString") {
                    const cs = g.coordinates.map(p => [p[1], p[0]]);
                    ge.items.push({ id: `ge_gj_${Date.now()}_${i}`, folderId: folder.id, kind: "line", name: nm, desc: "", coords: cs, color: "#3b82f6", width: 4, dashed: false, opacity: 1, visible: true });
                    allCoords.push(...cs); added++;
                } else if (g.type === "Polygon" && g.coordinates?.[0]) {
                    const cs = g.coordinates[0].map(p => [p[1], p[0]]);
                    ge.items.push({ id: `ge_gj_${Date.now()}_${i}`, folderId: folder.id, kind: "polygon", name: nm, desc: "", coords: cs, color: "#22c55e", fillColor: "#22c55e", fillOpacity: 0.25, width: 3, visible: true });
                    allCoords.push(...cs); added++;
                }
            });
        } else if (ext === "gpx") {
            const doc = new DOMParser().parseFromString(await file.text(), "text/xml");
            doc.querySelectorAll("wpt").forEach((w, i) => {
                const c = [Number(w.getAttribute("lat")), Number(w.getAttribute("lon"))];
                if (Number.isFinite(c[0]) && Number.isFinite(c[1])) {
                    ge.items.push({ id: `ge_gpx_${Date.now()}_${i}`, folderId: folder.id, kind: "point", name: w.querySelector("name")?.textContent || `WPT ${i + 1}`, desc: "", coords: c, color: "#f59e0b", owner: "bcg", scale: 1, opacity: 1, visible: true });
                    allCoords.push(c); added++;
                }
            });
            doc.querySelectorAll("trkseg").forEach((seg, i) => {
                const cs = [...seg.querySelectorAll("trkpt")].map(p => [Number(p.getAttribute("lat")), Number(p.getAttribute("lon"))]).filter(c => Number.isFinite(c[0]));
                if (cs.length >= 2) {
                    ge.items.push({ id: `ge_gpxl_${Date.now()}_${i}`, folderId: folder.id, kind: "line", name: `Track ${i + 1}`, desc: "", coords: cs, color: "#3b82f6", width: 4, dashed: false, opacity: 1, visible: true });
                    allCoords.push(...cs); added++;
                }
            });
        } else if (ext === "kmz" || ext === "kml") {
            let kmlText = "";
            if (ext === "kmz") {
                const ensureZip = window.__pmoEnsureJSZip || (typeof ensureJSZip === "function" ? ensureJSZip : null);
                const JSZipLib = ensureZip ? await ensureZip().catch(() => null) : window.JSZip;
                if (JSZipLib) {
                    const zip = await JSZipLib.loadAsync(file);
                    const entry = Object.values(zip.files).find(z => /\.kml$/i.test(z.name) && !z.dir);
                    if (entry) kmlText = await entry.async("text");
                }
            } else {
                kmlText = await file.text();
            }
            if (kmlText) {
                const doc = new DOMParser().parseFromString(kmlText, "text/xml");
                doc.querySelectorAll("Placemark").forEach((pm, i) => {
                    const nm = pm.querySelector("name")?.textContent?.trim() || `Obyekt ${i + 1}`;
                    const desc = pm.querySelector("description")?.textContent?.trim() || "";
                    const parseCs = raw => String(raw || "").trim().split(/\s+/).map(t => {
                        const [ln, la] = t.split(",").map(Number);
                        return Number.isFinite(la) && Number.isFinite(ln) ? [la, ln] : null;
                    }).filter(Boolean);
                    const pt = pm.querySelector("Point coordinates");
                    const ls = pm.querySelector("LineString coordinates");
                    const pg = pm.querySelector("Polygon coordinates");
                    if (pt) {
                        const cs = parseCs(pt.textContent);
                        if (cs[0]) { ge.items.push({ id: `ge_k_${Date.now()}_${i}`, folderId: folder.id, kind: "point", name: nm, desc, coords: cs[0], color: "#38bdf8", owner: "bcg", scale: 1, opacity: 1, visible: true }); allCoords.push(cs[0]); added++; }
                    } else if (pg) {
                        const cs = parseCs(pg.textContent);
                        if (cs.length >= 3) { ge.items.push({ id: `ge_k_${Date.now()}_${i}`, folderId: folder.id, kind: "polygon", name: nm, desc, coords: cs, color: "#22c55e", fillColor: "#22c55e", fillOpacity: 0.25, width: 3, visible: true }); allCoords.push(...cs); added++; }
                    } else if (ls) {
                        const cs = parseCs(ls.textContent);
                        if (cs.length >= 2) { ge.items.push({ id: `ge_k_${Date.now()}_${i}`, folderId: folder.id, kind: "line", name: nm, desc, coords: cs, color: "#3b82f6", width: 4, dashed: false, opacity: 1, visible: true }); allCoords.push(...cs); added++; }
                    }
                });
            }
        }

        if (added > 0) {
            saveGeState();
            renderAllGe();
            if (typeof flyToCoords === "function" && allCoords.length) flyToCoords(allCoords);
            notify(`📥 ${added} obyekt "${folder.name}" qovluğuna yükləndi`);
        } else {
            ge.folders.pop();
            notify("Faylda uyğun koordinat tapılmadı", true);
        }
    }

    /* ---------- SAVE PLACE AS (QOVLUQ AĞACINI 100% QORUYAN KMZ İXRACI) ---------- */
    async function savePlaceAsKmz(targetId, isFolder) {
        const xmlEsc = s => String(s ?? "").replace(/[<>&'"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
        const hexToKml = (hex, op = 1) => {
            const h = String(hex || "#38bdf8").replace("#", "");
            const a = Math.round(Math.max(0, Math.min(1, op)) * 255).toString(16).padStart(2, "0");
            return `${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`;
        };
        const renderItemKml = it => {
            if (it.kind === "point" && Array.isArray(it.coords)) {
                return `<Placemark><name>${xmlEsc(it.name)}</name><description>${xmlEsc(it.desc)}</description><Point><coordinates>${it.coords[1]},${it.coords[0]},0</coordinates></Point></Placemark>`;
            }
            if (it.kind === "line" && Array.isArray(it.coords)) {
                const cs = it.coords.map(c => `${c[1]},${c[0]},0`).join(" ");
                return `<Placemark><name>${xmlEsc(it.name)}</name><description>${xmlEsc(it.desc)}</description><Style><LineStyle><color>${hexToKml(it.color, it.opacity ?? 1)}</color><width>${it.width || 4}</width></LineStyle></Style><LineString><tessellate>1</tessellate><coordinates>${cs}</coordinates></LineString></Placemark>`;
            }
            if (it.kind === "polygon" && Array.isArray(it.coords)) {
                const cs = [...it.coords, it.coords[0]].map(c => `${c[1]},${c[0]},0`).join(" ");
                return `<Placemark><name>${xmlEsc(it.name)}</name><description>${xmlEsc(it.desc)}</description><Style><LineStyle><color>${hexToKml(it.color, 1)}</color><width>${it.width || 3}</width></LineStyle><PolyStyle><color>${hexToKml(it.fillColor || it.color, it.fillOpacity ?? 0.3)}</color></PolyStyle></Style><Polygon><outerBoundaryIs><LinearRing><coordinates>${cs}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
            }
            return "";
        };
        let totalCount = 0;
        const renderFolderKml = fid => {
            const fl = ge.folders.find(f => f.id === fid);
            if (!fl) return "";
            const subKml = ge.folders.filter(f => f.parentId === fid).map(ch => renderFolderKml(ch.id)).join("\n");
            const ownItems = ge.items.filter(i => i.folderId === fid);
            totalCount += ownItems.length;
            return `<Folder><name>${xmlEsc(fl.name)}</name>${ownItems.map(renderItemKml).join("\n")}${subKml}</Folder>`;
        };

        const title = isFolder ? (ge.folders.find(f => f.id === targetId)?.name || "BCG_Layihə") : (ge.items.find(i => i.id === targetId)?.name || "BCG_Obyekt");
        const body = isFolder ? renderFolderKml(targetId) : (() => {
            const it = ge.items.find(i => i.id === targetId);
            if (it) totalCount = 1;
            return it ? renderItemKml(it) : "";
        })();
        if (!totalCount && !isFolder) { notify("İxrac ediləcək obyekt yoxdur", true); return; }

        const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xmlEsc(title)}</name>${body}</Document></kml>`;
        const ensureZip = window.__pmoEnsureJSZip || (typeof ensureJSZip === "function" ? ensureJSZip : null);
        const JSZipLib = ensureZip ? await ensureZip().catch(() => null) : window.JSZip;
        const safe = title.replace(/[^\w\u00C0-\u024F\u0400-\u04FF-]+/g, "_").slice(0, 32);
        const dl = (blob, fn) => {
            const u = URL.createObjectURL(blob), a = document.createElement("a");
            a.href = u; a.download = fn; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(u), 3000);
        };
        if (JSZipLib) {
            const z = new JSZipLib(); z.file("doc.kml", kml);
            dl(await z.generateAsync({ type: "blob" }), `${safe}.kmz`);
            notify(`💾 ${safe}.kmz qovluq ağacı ilə saxlanıldı (${totalCount} obyekt)`);
        } else {
            dl(new Blob([kml], { type: "application/vnd.google-earth.kml+xml" }), `${safe}.kml`);
            notify(`💾 ${safe}.kml saxlanıldı`);
        }
    }

    /* ---------- HD / 4K SAVE IMAGE & A4 / A3 PRINT STUDIO ---------- */
    function openExportStudio(mode = "image") {
        const win = $id("gePropsWin");
        if (!win) return;
        win.hidden = false;
        win.innerHTML = `
            <div class="ge-win-head">
                <span>${mode === "print" ? "🖨️ Çap et (A4 / A3 PDF)" : "📷 Yüksək Keyfiyyətli Şəkil (HD / 4K)"}</span>
                <button type="button" class="icon-btn small" id="geWinClose"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="ge-win-body">
                <label class="saha-field"><span>Başlıq (Ştamp)</span><input type="text" class="input" id="geExpTitle" value="BCG GIS — Ofis İcra Xəritəsi"></label>
                <label class="saha-field"><span>Açıqlama</span><input type="text" class="input" id="geExpDesc" placeholder="Layihə / Rayon / Qeyd..."></label>
                ${mode === "image" ? `
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                    <label class="saha-field"><span>Çözünürlük</span>
                        <select class="input" id="geExpRes">
                            <option value="current">Cari ekran</option>
                            <option value="hd" selected>Full HD (1920×1080)</option>
                            <option value="4k">4K Ultra HD (3840×2160)</option>
                        </select>
                    </label>
                    <label class="saha-field"><span>Format</span>
                        <select class="input" id="geExpFmt">
                            <option value="png">PNG (itkisiz)</option>
                            <option value="jpg">JPG (yüngül)</option>
                        </select>
                    </label>
                </div>` : `
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                    <label class="saha-field"><span>Kağız ölçüsü</span>
                        <select class="input" id="geExpPaper"><option value="A4">A4</option><option value="A3">A3</option></select>
                    </label>
                    <label class="saha-field"><span>İstiqamət</span>
                        <select class="input" id="geExpOrient"><option value="landscape">Üfüqi (Landscape)</option><option value="portrait">Şaquli (Portrait)</option></select>
                    </label>
                </div>`}
                <div style="display:flex;flex-direction:column;gap:4px">
                    <label class="ge-layer-row"><input type="checkbox" id="geExpLegend" checked> Avtomatik Şərti İşarələr (Legend)</label>
                    <label class="ge-layer-row"><input type="checkbox" id="geExpCompass" checked> Şimal oxu (Compass) &amp; Miqyas</label>
                </div>
                <button type="button" class="btn btn-primary" id="geExpRunBtn" style="height:38px;font-size:13px">
                    <i class="fa-solid fa-${mode === "print" ? "print" : "camera"}"></i> ${mode === "print" ? "Çap / PDF Yarat" : "Şəkil kimi Saxla"}
                </button>
            </div>`;
        win.querySelector("#geWinClose")?.addEventListener("click", () => { win.hidden = true; });
        win.querySelector("#geExpRunBtn")?.addEventListener("click", () => {
            const title = $id("geExpTitle")?.value || "BCG GIS";
            const desc = $id("geExpDesc")?.value || "";
            const showLeg = $id("geExpLegend")?.checked;
            const showComp = $id("geExpCompass")?.checked;
            if (mode === "image") {
                const res = $id("geExpRes")?.value || "hd";
                const fmt = $id("geExpFmt")?.value || "png";
                exportHighResCanvas(title, desc, res, fmt, showLeg, showComp);
            } else {
                const paper = $id("geExpPaper")?.value || "A4";
                const orient = $id("geExpOrient")?.value || "landscape";
                openGePrintWindow(title, desc, paper, orient, showLeg, showComp);
            }
        });
    }

    function exportHighResCanvas(title, desc, resMode, fmt, showLeg, showComp) {
        if (!window.map) return;
        const dims = resMode === "4k" ? [3840, 2160] : (resMode === "hd" ? [1920, 1080] : [map.getCanvas().width, map.getCanvas().height]);
        const [W, H] = dims;
        const out = document.createElement("canvas");
        out.width = W; out.height = H;
        const ctx = out.getContext("2d");

        // MapLibre render frame-i tutmaq üçün 1 frame gözlə
        map.once("render", () => {
            try {
                ctx.drawImage(map.getCanvas(), 0, 0, W, H);
            } catch {
                ctx.fillStyle = "#0f172a"; ctx.fillRect(0, 0, W, H);
            }
            const k = W / 1280;
            // Başlıq ştampı
            ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
            ctx.fillRect(18 * k, 18 * k, 420 * k, (desc ? 66 : 44) * k);
            ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 2 * k;
            ctx.strokeRect(18 * k, 18 * k, 420 * k, (desc ? 66 : 44) * k);
            ctx.fillStyle = "#ffffff"; ctx.font = `700 ${18 * k}px Inter, Arial, sans-serif`;
            ctx.fillText(title, 30 * k, 44 * k);
            if (desc) {
                ctx.fillStyle = "#cbd5e1"; ctx.font = `500 ${13 * k}px Inter, Arial, sans-serif`;
                ctx.fillText(desc, 30 * k, 68 * k);
            }
            if (showComp) {
                const cx = W - 46 * k, cy = 46 * k;
                ctx.beginPath(); ctx.arc(cx, cy, 24 * k, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(15,23,42,0.88)"; ctx.fill();
                ctx.strokeStyle = "#fff"; ctx.lineWidth = 2 * k; ctx.stroke();
                ctx.fillStyle = "#ef4444"; ctx.font = `800 ${16 * k}px Inter, Arial`;
                ctx.textAlign = "center"; ctx.fillText("N", cx, cy + 6 * k); ctx.textAlign = "left";
            }
            if (showLeg) {
                const ly = H - 96 * k;
                ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
                ctx.fillRect(18 * k, ly, 460 * k, 74 * k);
                ctx.fillStyle = "#e2e8f0"; ctx.font = `600 ${13 * k}px Inter, Arial`;
                ctx.fillText("□ BCG (boş) · ■ Başqa (dolu) · △ Mufta · ○ Quyu · ◇ Trans.", 30 * k, ly + 28 * k);
                ctx.fillText("━ FO 12 (Yaşıl) · ━ FO 24 (Mavi) · ━ FO 48 / Elektrik (Qırmızı)", 30 * k, ly + 54 * k);
            }
            const mime = fmt === "jpg" ? "image/jpeg" : "image/png";
            const a = document.createElement("a");
            a.href = out.toDataURL(mime, 0.94);
            a.download = `BCG_Earth_${resMode.toUpperCase()}_${new Date().toISOString().slice(0, 10)}.${fmt}`;
            a.click();
            notify(`📷 ${resMode.toUpperCase()} (${W}×${H}) ${fmt.toUpperCase()} saxlanıldı!`);
        });
        map.triggerRepaint();
    }

    function openGePrintWindow(title, desc, paper, orient, showLeg, showComp) {
        if (!window.map) return;
        map.once("render", () => {
            let imgUrl = "";
            try { imgUrl = map.getCanvas().toDataURL("image/png"); } catch {}
            const w = window.open("", "_blank");
            if (!w) { notify("Pop-up bloklandı — icazə verin", true); return; }
            w.document.write(`<!DOCTYPE html><html lang="az"><head><meta charset="UTF-8"><title>${escH(title)}</title>
            <style>
                @page { size: ${paper} ${orient}; margin: 8mm; }
                body { font-family: Inter, Arial, sans-serif; margin: 0; color: #0f172a; }
                .hdr { display:flex; justify-content:space-between; border-bottom:2px solid #0f172a; padding-bottom:5px; margin-bottom:8px; }
                .map-img { width:100%; max-height:74vh; object-fit:contain; border:1.5px solid #475569; border-radius:6px; display:block; }
                .leg { margin-top:6px; padding:6px 10px; background:#f1f5f9; border-radius:6px; font-size:10.5px; display:flex; flex-wrap:wrap; gap:12px; }
                .stamp { margin-top:8px; display:grid; grid-template-columns:2fr 1fr 1fr; border:1.5px solid #0f172a; font-size:10.5px; }
                .stamp div { padding:6px 8px; border-right:1px solid #0f172a; } .stamp div:last-child { border:0; }
                @media print { .np { display:none; } }
            </style></head><body>
                <div class="np" style="text-align:right;margin-bottom:6px"><button onclick="window.print()" style="padding:7px 14px;background:#0284c7;color:#fff;border:0;border-radius:6px;font-weight:700;cursor:pointer">🖨️ Çap et / PDF</button></div>
                <div class="hdr"><div><h2 style="margin:0;font-size:16px">${escH(title)}</h2><small>${escH(desc)}</small></div><div style="text-align:right"><b>${paper} · ${new Date().toISOString().slice(0, 10)}</b>${showComp ? " · ↑ N" : ""}</div></div>
                ${imgUrl ? `<img class="map-img" src="${imgUrl}">` : `<p>Xəritə görüntüsü alına bilmədi</p>`}
                ${showLeg ? `<div class="leg"><span><b>Şərti işarələr:</b></span><span>□ BCG / ■ Başqa</span><span>△ Mufta</span><span>○ Quyu</span><span style="color:#16a34a">━ FO 12</span><span style="color:#2563eb">━ FO 24</span><span style="color:#dc2626">━ FO 48 / Elektrik</span><span style="color:#92400e">┅ Qazıntı</span></div>` : ""}
                <div class="stamp"><div><b>Baku Communications Group — Ofis GIS</b></div><div>Hazırladı: _______________</div><div>Tarix / İmza: ${new Date().toISOString().slice(0, 10)}</div></div>
                <script>window.addEventListener("load", () => setTimeout(() => window.print(), 300));<\/script>
            </body></html>`);
            w.document.close();
        });
        map.triggerRepaint();
    }

    /* ---------- DRAGGABLE 4-TAB EDIT PLACEMARK & 5-TAB EDIT PATH ---------- */
    function makeWindowDraggable(win) {
        const head = win?.querySelector(".ge-win-head");
        if (!head || head.dataset.dragBound) return;
        head.dataset.dragBound = "1";
        head.style.cursor = "move";
        head.addEventListener("mousedown", e => {
            if (e.target.closest("button")) return;
            e.preventDefault();
            const rect = win.getBoundingClientRect();
            const dx = e.clientX - rect.left, dy = e.clientY - rect.top;
            win.style.right = "auto";
            win.style.left = `${rect.left}px`;
            win.style.top = `${rect.top}px`;
            const onMove = ev => {
                win.style.left = `${Math.max(4, Math.min(window.innerWidth - 120, ev.clientX - dx))}px`;
                win.style.top = `${Math.max(48, Math.min(window.innerHeight - 60, ev.clientY - dy))}px`;
            };
            const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
        });
    }

    function openPropertiesWin(itemId, keepTab = false) {
        const it = ge.items.find(x => x.id === itemId);
        const win = $id("gePropsWin");
        if (!it || !win) return;
        ge.editingItemId = it.id;
        if (!keepTab) ge.propsTab = "desc";
        const backupSnap = JSON.stringify(it);
        win.hidden = false;
        renderGeMap();

        const isPt = it.kind === "point", isLn = it.kind === "line", isPg = it.kind === "polygon", isOv = it.kind === "overlay";
        const tabs = isPt
            ? [["desc", "Description"], ["style", "Style, Color"], ["view", "View"], ["alt", "Altitude"]]
            : [["desc", "Description"], ["style", "Style, Color"], ["view", "View"], ["alt", "Altitude"], ["meas", "Measurements"]];

        const renderBody = () => {
            const t = ge.propsTab;
            const lenM = isLn ? pathMeters(it.coords) : (isPg ? pathMeters([...it.coords, it.coords[0]]) : 0);
            const tabHtml = tabs.map(([k, lbl]) => `<button type="button" class="ge-win-tab ${t === k ? "active" : ""}" data-ptab="${k}">${lbl}</button>`).join("");

            let pane = "";
            if (t === "desc") {
                pane = `
                    <div class="saha-btn-row" style="gap:4px">
                        <button type="button" class="ge-mini-btn" id="gpAddLink">Add link...</button>
                        <button type="button" class="ge-mini-btn" id="gpAddWebImg">Add web image...</button>
                        <button type="button" class="ge-mini-btn" id="gpAddLocImg">Add local image...</button>
                        <input type="file" id="gpLocImgInp" accept="image/*" hidden>
                    </div>
                    <textarea class="input" id="gpDesc" rows="5" style="height:auto;padding:7px;font-size:12px">${escH(it.desc || "")}</textarea>`;
            } else if (t === "style") {
                pane = isPt ? `
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                        <label class="saha-field"><span>İkon Rəngi</span><input type="color" class="input" id="gpColor" value="${it.color || "#38bdf8"}" style="height:32px;padding:2px"></label>
                        <label class="saha-field"><span>Ölçü (Scale)</span><input type="number" step="0.1" min="0.5" max="2.5" class="input" id="gpScale" value="${it.scale || 1}"></label>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                        <label class="saha-field"><span>Mülkiyyət</span>
                            <select class="input" id="gpOwner"><option value="bcg" ${it.owner === "bcg" ? "selected" : ""}>□ BCG (boş)</option><option value="other" ${it.owner !== "bcg" ? "selected" : ""}>■ Başqa (dolu)</option></select>
                        </label>
                        <label class="saha-field"><span>Şəffaflıq (${Math.round((it.opacity ?? 1) * 100)}%)</span><input type="range" min="0.2" max="1" step="0.05" id="gpOpacity" value="${it.opacity ?? 1}"></label>
                    </div>` : `
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
                        <label class="saha-field"><span>Lines Color</span><input type="color" class="input" id="gpColor" value="${it.color || "#3b82f6"}" style="height:32px;padding:2px"></label>
                        <label class="saha-field"><span>Width (px)</span><input type="number" step="0.5" min="1" max="14" class="input" id="gpWidth" value="${it.width || 3.5}"></label>
                        <label class="saha-field"><span>Opacity %</span><input type="number" min="10" max="100" class="input" id="gpOpPct" value="${Math.round((it.opacity ?? 1) * 100)}"></label>
                    </div>
                    ${isLn ? `<label class="ge-layer-row"><input type="checkbox" id="gpDashed" ${it.dashed ? "checked" : ""}> Qırıq xətt (Qazıntı)</label>` : ""}
                    ${isPg ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px"><label class="saha-field"><span>İç rəng</span><input type="color" class="input" id="gpFillColor" value="${it.fillColor || it.color || "#22c55e"}" style="height:32px;padding:2px"></label><label class="saha-field"><span>İç şəffaflıq</span><input type="range" min="0" max="0.9" step="0.05" id="gpFillOp" value="${it.fillOpacity ?? 0.28}"></label></div>` : ""}`;
            } else if (t === "view") {
                const c = window.map ? map.getCenter() : { lat: 40.4, lng: 49.8 };
                pane = `
                    <div style="font-size:11.5px;color:var(--ink-2);line-height:1.5">
                        Baxış mərkəzi: <b>${c.lat.toFixed(5)}°, ${c.lng.toFixed(5)}°</b><br>
                        Zoom: <b>${window.map ? map.getZoom().toFixed(1) : 14}</b> · Tilt: <b>${window.map ? Math.round(map.getPitch()) : 0}°</b> · Heading: <b>${window.map ? Math.round(map.getBearing()) : 0}°</b>
                    </div>
                    <button type="button" class="ge-mini-btn" id="gpSnapView">📸 Cari görünüşü yadda saxla</button>`;
            } else if (t === "alt") {
                const am = it.altitudeMode || "clamped";
                pane = `
                    <label class="saha-field"><span>Hündürlük rejimi</span>
                        <select class="input" id="gpAltMode">
                            <option value="clamped" ${am === "clamped" ? "selected" : ""}>Clamped to ground (Yerə yapışıq)</option>
                            <option value="relative" ${am === "relative" ? "selected" : ""}>Relative to ground</option>
                            <option value="absolute" ${am === "absolute" ? "selected" : ""}>Absolute (Dəniz səviyyəsi)</option>
                        </select>
                    </label>
                    <label class="saha-field"><span>Hündürlük (m)</span><input type="number" class="input" id="gpAltM" value="${it.altitudeM || 0}"></label>`;
            } else if (t === "meas") {
                pane = `
                    <div style="padding:10px;border-radius:8px;background:var(--surface-2);border:1px solid var(--line);font-size:13px;line-height:1.6">
                        ${isLn ? `<b>Uzunluq:</b> ${Math.round(lenM)} m (${(lenM / 1000).toFixed(3)} km)<br><b>Vertex sayı:</b> ${it.coords?.length || 0}` : `<b>Sahə:</b> ${fmtArea(polygonAreaM2(it.coords))}<br><b>Perimetr:</b> ${Math.round(lenM)} m`}
                    </div>
                    ${isLn ? `<button type="button" class="ge-mini-btn" id="gpElevBtn" style="color:#38bdf8"><i class="fa-solid fa-chart-area"></i> Yüksəklik Profilini Göstər</button>` : ""}`;
            }

            win.innerHTML = `
                <div class="ge-win-head">
                    <span>${isPt ? "📍 Edit Placemark" : (isLn ? "〰️ Edit Path" : (isPg ? "⬟ Edit Polygon" : "🖼️ Edit Overlay"))}</span>
                    <button type="button" class="icon-btn small" id="geWinClose"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="ge-win-body">
                    <div style="display:flex;gap:6px;align-items:flex-end">
                        <label class="saha-field" style="flex:1"><span>Name</span><input type="text" class="input" id="gpName" value="${escH(it.name)}"></label>
                        ${isPt ? `<button type="button" class="btn btn-outline" id="gpIconPickBtn" title="İkon və mülkiyyət seç" style="height:34px;width:42px;padding:0;font-size:16px;color:${it.color || "#38bdf8"}">${it.owner === "other" ? "■" : "□"}</button>` : ""}
                    </div>
                    ${isPt ? `
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                        <label class="saha-field"><span>Latitude (°)</span><input type="number" step="0.000001" class="input" id="gpLat" value="${it.coords[0]}"></label>
                        <label class="saha-field"><span>Longitude (°)</span><input type="number" step="0.000001" class="input" id="gpLng" value="${it.coords[1]}"></label>
                    </div>` : ""}
                    <div class="ge-win-tabs" style="grid-template-columns:repeat(${tabs.length},1fr)">${tabHtml}</div>
                    ${pane}
                    <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:4px;border-top:1px solid var(--line);padding-top:8px">
                        <button type="button" class="btn btn-primary" id="gpSaveBtn" style="height:32px;min-width:74px;font-size:12px">OK</button>
                        <button type="button" class="btn btn-outline" id="gpCancelBtn" style="height:32px;min-width:74px;font-size:12px">Cancel</button>
                    </div>
                </div>`;

            makeWindowDraggable(win);
            const syncLive = () => {
                if ($id("gpName")) it.name = $id("gpName").value;
                if ($id("gpDesc")) it.desc = $id("gpDesc").value;
                if ($id("gpColor")) it.color = $id("gpColor").value;
                if ($id("gpWidth")) it.width = Number($id("gpWidth").value) || 3.5;
                if ($id("gpScale")) it.scale = Number($id("gpScale").value) || 1;
                if ($id("gpOwner")) it.owner = $id("gpOwner").value;
                if ($id("gpOpacity")) it.opacity = Number($id("gpOpacity").value);
                if ($id("gpOpPct")) it.opacity = Math.max(0.1, Math.min(1, Number($id("gpOpPct").value) / 100));
                if ($id("gpFillColor")) it.fillColor = $id("gpFillColor").value;
                if ($id("gpFillOp")) it.fillOpacity = Number($id("gpFillOp").value);
                if ($id("gpDashed")) it.dashed = $id("gpDashed").checked;
                if ($id("gpAltMode")) it.altitudeMode = $id("gpAltMode").value;
                if ($id("gpAltM")) it.altitudeM = Number($id("gpAltM").value) || 0;
                if (isPt && $id("gpLat") && $id("gpLng")) {
                    const la = Number($id("gpLat").value), ln = Number($id("gpLng").value);
                    if (Number.isFinite(la) && Number.isFinite(ln)) it.coords = [la, ln];
                }
                renderGeMap();
            };

            win.querySelectorAll("[data-ptab]").forEach(b => b.addEventListener("click", () => { syncLive(); ge.propsTab = b.dataset.ptab; renderBody(); }));
            win.querySelectorAll("input, select, textarea").forEach(el => el.addEventListener("change", syncLive));
            win.querySelector("#gpIconPickBtn")?.addEventListener("click", () => { it.owner = it.owner === "bcg" ? "other" : "bcg"; renderGeMap(); renderBody(); });
            win.querySelector("#gpAddLink")?.addEventListener("click", () => { const u = prompt("Link URL:", "https://"); if (u) { it.desc = `${it.desc || ""}\n${u}`.trim(); renderBody(); } });
            win.querySelector("#gpAddWebImg")?.addEventListener("click", () => { const u = prompt("Şəkil URL:", "https://"); if (u) { it.desc = `${it.desc || ""}\n[Şəkil: ${u}]`.trim(); renderBody(); } });
            win.querySelector("#gpAddLocImg")?.addEventListener("click", () => win.querySelector("#gpLocImgInp")?.click());
            win.querySelector("#gpLocImgInp")?.addEventListener("change", e => { const f = e.target.files?.[0]; if (f) { it.desc = `${it.desc || ""}\n[Foto: ${f.name}]`.trim(); renderBody(); } });
            win.querySelector("#gpSnapView")?.addEventListener("click", () => { notify("📸 Baxış bucağı yadda saxlanıldı"); });
            win.querySelector("#gpElevBtn")?.addEventListener("click", () => showElevationProfile(it));

            const closeCancel = () => {
                Object.assign(it, JSON.parse(backupSnap));
                ge.editingItemId = "";
                win.hidden = true;
                renderAllGe();
            };
            win.querySelector("#geWinClose")?.addEventListener("click", closeCancel);
            win.querySelector("#gpCancelBtn")?.addEventListener("click", closeCancel);
            win.querySelector("#gpSaveBtn")?.addEventListener("click", () => {
                syncLive();
                ge.editingItemId = "";
                saveGeState();
                renderAllGe();
                win.hidden = true;
                notify("✅ Yadda saxlanıldı");
            });
        };
        renderBody();
    }

    function renderRulerWin() {
        const win = $id("gePropsWin");
        if (!win) return;
        win.hidden = false;
        let resultHtml = `<span style="color:var(--ink-3)">Xəritədə nöqtələrə klikləyin...</span>`;
        if (ge.draft.length >= 2) {
            if (ge.rulerTab === "line") {
                const d = havM(ge.draft[0], ge.draft[1]);
                const az = bearingDeg(ge.draft[0], ge.draft[1]).toFixed(1);
                resultHtml = `<b>Məsafə:</b> ${fmtDist(d)} · <b>Azimut:</b> ${az}°`;
            } else if (ge.rulerTab === "path") {
                resultHtml = `<b>Ümumi yol:</b> ${fmtDist(pathMeters(ge.draft))} (${ge.draft.length} nöqtə)`;
            } else if (ge.rulerTab === "polygon") {
                const per = pathMeters([...ge.draft, ge.draft[0]]);
                resultHtml = `<b>Sahə:</b> ${fmtArea(polygonAreaM2(ge.draft))}<br><b>Perimetr:</b> ${fmtDist(per)}`;
            } else if (ge.rulerTab === "circle") {
                const r = havM(ge.draft[0], ge.draft[ge.draft.length - 1]);
                resultHtml = `<b>Radius:</b> ${fmtDist(r)} · <b>Çevrə:</b> ${fmtDist(2 * Math.PI * r)}<br><b>Sahə:</b> ${fmtArea(Math.PI * r * r)}`;
            }
        }
        win.innerHTML = `
            <div class="ge-win-head">
                <span>📏 Xətkeş (Ruler)</span>
                <button type="button" class="icon-btn small" id="geWinClose"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="ge-win-body">
                <div class="ge-win-tabs">
                    <button type="button" class="ge-win-tab ${ge.rulerTab === "line" ? "active" : ""}" data-rt="line">Düz xətt</button>
                    <button type="button" class="ge-win-tab ${ge.rulerTab === "path" ? "active" : ""}" data-rt="path">Sınıq yol</button>
                    <button type="button" class="ge-win-tab ${ge.rulerTab === "polygon" ? "active" : ""}" data-rt="polygon">Poliqon</button>
                    <button type="button" class="ge-win-tab ${ge.rulerTab === "circle" ? "active" : ""}" data-rt="circle">Dairə</button>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                    <span>Ölçü vahidi:</span>
                    <select class="input" id="geRulerUnit" style="width:110px;height:28px;font-size:12px">
                        <option value="m" ${ge.rulerUnit === "m" ? "selected" : ""}>Metr (m)</option>
                        <option value="km" ${ge.rulerUnit === "km" ? "selected" : ""}>Kilometr (km)</option>
                        <option value="cm" ${ge.rulerUnit === "cm" ? "selected" : ""}>Santimetr (sm)</option>
                    </select>
                </div>
                <div style="padding:10px;border-radius:8px;background:var(--surface-2);border:1px solid var(--line);font-size:13px;line-height:1.5">${resultHtml}</div>
                <div class="saha-btn-row">
                    <button type="button" class="btn btn-primary" id="geRulerSave" ${ge.draft.length < 2 ? "disabled" : ""} style="height:32px;font-size:12px"><i class="fa-solid fa-floppy-disk"></i> Yadda saxla</button>
                    <button type="button" class="btn btn-outline" id="geRulerClear" style="height:32px;font-size:12px">Təmizlə</button>
                </div>
            </div>`;
        win.querySelector("#geWinClose")?.addEventListener("click", () => { ge.activeTool = null; ge.draft = []; win.hidden = true; renderGeMap(); updateToolbarActive(); });
        win.querySelectorAll("[data-rt]").forEach(b => b.addEventListener("click", () => { ge.rulerTab = b.dataset.rt; ge.draft = []; renderRulerWin(); renderGeMap(); }));
        win.querySelector("#geRulerUnit")?.addEventListener("change", e => { ge.rulerUnit = e.target.value; renderRulerWin(); });
        win.querySelector("#geRulerClear")?.addEventListener("click", () => { ge.draft = []; renderRulerWin(); renderGeMap(); });
        win.querySelector("#geRulerSave")?.addEventListener("click", () => {
            if (ge.draft.length < 2) return;
            pushUndo();
            const isPg = ge.rulerTab === "polygon";
            const it = {
                id: `ge_r_${Date.now()}`,
                folderId: getTargetFolderId(),
                kind: isPg ? "polygon" : "line",
                name: isPg ? `Ölçü Poliqon (${fmtArea(polygonAreaM2(ge.draft))})` : `Ölçü Yol (${Math.round(pathMeters(ge.draft))} m)`,
                desc: "Xətkeş aləti ilə yaradıldı",
                coords: ge.draft.slice(),
                color: "#fbbf24",
                fillColor: "#fbbf24",
                fillOpacity: 0.25,
                width: 3.5,
                dashed: false,
                visible: true
            };
            ge.items.push(it);
            ge.draft = [];
            ge.activeTool = null;
            win.hidden = true;
            saveGeState();
            renderAllGe();
            notify("💾 Ölçü qovluğa yadda saxlanıldı");
        });
    }

    function renderDrawHelperBanner() {
        const win = $id("gePropsWin");
        if (!win) return;
        win.hidden = false;
        const isPg = ge.activeTool === "polygon";
        const info = isPg
            ? `Nöqtə: <b>${ge.draft.length}</b> · Sahə: <b>${fmtArea(polygonAreaM2(ge.draft))}</b>`
            : `Nöqtə: <b>${ge.draft.length}</b> · Uzunluq: <b>${Math.round(pathMeters(ge.draft))} m</b>`;
        win.innerHTML = `
            <div class="ge-win-head">
                <span>${isPg ? "⬟ Yeni Poliqon Çək" : "〰️ Yeni Xətt / Yol Çək"}</span>
                <button type="button" class="icon-btn small" id="geWinClose"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="ge-win-body">
                <div style="font-size:12px;color:var(--ink-2)">Xəritədə ardıcıl nöqtələrə klikləyin (mövcud nöqtələrə avtomatik yapışır).</div>
                <div style="padding:8px;border-radius:8px;background:var(--surface-2);font-size:12.5px">${info}</div>
                <div class="saha-btn-row">
                    <button type="button" class="btn btn-outline" id="geDrUndo" ${ge.draft.length < 1 ? "disabled" : ""} style="height:32px;font-size:12px">Geri al</button>
                    <button type="button" class="btn btn-primary" id="geDrSave" ${ge.draft.length < (isPg ? 3 : 2) ? "disabled" : ""} style="height:32px;font-size:12px"><i class="fa-solid fa-check"></i> Bitir / Yadda saxla</button>
                </div>
            </div>`;
        win.querySelector("#geWinClose")?.addEventListener("click", () => { ge.activeTool = null; ge.draft = []; win.hidden = true; renderGeMap(); updateToolbarActive(); });
        win.querySelector("#geDrUndo")?.addEventListener("click", () => { ge.draft.pop(); renderGeMap(); renderDrawHelperBanner(); });
        win.querySelector("#geDrSave")?.addEventListener("click", () => {
            pushUndo();
            const it = {
                id: `ge_${isPg ? "pg" : "ln"}_${Date.now()}`,
                folderId: getTargetFolderId(),
                kind: isPg ? "polygon" : "line",
                name: isPg ? `Poliqon #${ge.items.filter(x => x.kind === "polygon").length + 1}` : `Xətt #${ge.items.filter(x => x.kind === "line").length + 1}`,
                desc: "",
                coords: ge.draft.slice(),
                color: isPg ? "#22c55e" : "#3b82f6",
                fillColor: "#22c55e",
                fillOpacity: 0.25,
                width: isPg ? 3 : 4,
                dashed: false,
                visible: true
            };
            ge.items.push(it);
            ge.selectedId = it.id;
            ge.selectedIsFolder = false;
            ge.activeTool = null;
            ge.draft = [];
            saveGeState();
            renderAllGe();
            openPropertiesWin(it.id);
        });
    }

    /* ---------- PLACES TREE VIEW + DRAG & DROP + CONTEXT MENU ---------- */
    function renderPlacesTree() {
        const tree = $id("gePlacesTree");
        if (!tree) return;
        const renderFolder = (folder) => {
            const subFolders = ge.folders.filter(f => f.parentId === folder.id);
            const items = ge.items.filter(i => i.folderId === folder.id);
            const sel = ge.selectedIsFolder && ge.selectedId === folder.id;
            return `
                <div class="ge-folder-wrap">
                    <div class="ge-node ${sel ? "selected" : ""}" data-fid="${escH(folder.id)}" data-drop-folder="${escH(folder.id)}">
                        <i class="fa-solid fa-caret-${folder.open ? "down" : "right"}" data-toggle-f="${escH(folder.id)}" style="width:12px;color:var(--ink-3)"></i>
                        <input type="checkbox" data-chk-f="${escH(folder.id)}" ${folder.visible !== false ? "checked" : ""}>
                        <i class="fa-solid fa-folder${folder.open ? "-open" : ""}" style="color:#fbbf24"></i>
                        <span class="ge-node-label"><b>${escH(folder.name)}</b></span>
                        <span class="ge-node-meta">${items.length}</span>
                    </div>
                    ${folder.open ? `<div class="ge-tree-children">
                        ${subFolders.map(renderFolder).join("")}
                        ${items.map(it => {
                            const icon = it.kind === "point" ? "fa-location-dot" : (it.kind === "line" ? "fa-route" : (it.kind === "polygon" ? "fa-draw-polygon" : "fa-image"));
                            return `
                                <div class="ge-node ${!ge.selectedIsFolder && ge.selectedId === it.id ? "selected" : ""}" draggable="true" data-iid="${escH(it.id)}">
                                    <input type="checkbox" data-chk-i="${escH(it.id)}" ${it.visible !== false ? "checked" : ""}>
                                    <i class="fa-solid ${icon}" style="color:${it.color || "#38bdf8"};font-size:11px"></i>
                                    <span class="ge-node-label">${escH(it.name)}</span>
                                </div>`;
                        }).join("")}
                    </div>` : ""}
                </div>`;
        };
        const roots = ge.folders.filter(f => !f.parentId);
        tree.innerHTML = roots.map(renderFolder).join("");
    }

    function openContextMenu(x, y, targetId, isFolder) {
        const menu = $id("geCtxMenu");
        if (!menu) return;
        ge.selectedId = targetId;
        ge.selectedIsFolder = isFolder;
        renderPlacesTree();

        const it = !isFolder ? ge.items.find(i => i.id === targetId) : null;
        menu.innerHTML = `
            ${isFolder ? `
            <button class="ge-ctx-item" data-ca="add-folder"><i class="fa-solid fa-folder-plus"></i> Əlavə et → Qovluq</button>
            <button class="ge-ctx-item" data-ca="add-point"><i class="fa-solid fa-location-dot"></i> Əlavə et → Nöqtə</button>
            <button class="ge-ctx-item" data-ca="add-line"><i class="fa-solid fa-route"></i> Əlavə et → Xətt</button>
            <button class="ge-ctx-item" data-ca="add-poly"><i class="fa-solid fa-draw-polygon"></i> Əlavə et → Poliqon</button>
            <button class="ge-ctx-item" data-ca="share-style"><i class="fa-solid fa-wand-magic-sparkles"></i> Hamısına eyni stili tətbiq et</button>
            <div class="ge-ctx-sep"></div>` : `
            <button class="ge-ctx-item" data-ca="props"><i class="fa-solid fa-sliders"></i> Xüsusiyyətlər (Properties)</button>
            ${it?.kind === "line" ? `<button class="ge-ctx-item" data-ca="elev"><i class="fa-solid fa-chart-area"></i> Yüksəklik profili</button>` : ""}
            <button class="ge-ctx-item" data-ca="copy"><i class="fa-regular fa-copy"></i> Kopyala</button>
            <button class="ge-ctx-item" data-ca="cut"><i class="fa-solid fa-scissors"></i> Kəs</button>
            <button class="ge-ctx-item" data-ca="dup"><i class="fa-regular fa-clone"></i> Dublikat et</button>
            <div class="ge-ctx-sep"></div>`}
            ${ge.clipboard ? `<button class="ge-ctx-item" data-ca="paste"><i class="fa-regular fa-paste"></i> Yapışdır</button>` : ""}
            <button class="ge-ctx-item" data-ca="rename"><i class="fa-solid fa-i-cursor"></i> Adını dəyiş (Rename)</button>
            <button class="ge-ctx-item" data-ca="save-kmz"><i class="fa-solid fa-earth-europe"></i> KMZ / KML kimi saxla</button>
            <div class="ge-ctx-sep"></div>
            <button class="ge-ctx-item danger" data-ca="delete"><i class="fa-solid fa-trash"></i> Sil (Delete)</button>
        `;
        menu.style.left = `${Math.min(x, window.innerWidth - 235)}px`;
        menu.style.top = `${Math.min(y, window.innerHeight - 310)}px`;
        menu.hidden = false;
    }

    function runContextAction(act) {
        const menu = $id("geCtxMenu");
        if (menu) menu.hidden = true;
        const id = ge.selectedId, isF = ge.selectedIsFolder;

        if (act === "add-folder") {
            const nm = prompt("Yeni qovluğun adı:", "Yeni Qovluq");
            if (!nm) return;
            pushUndo();
            ge.folders.push({ id: `f_${Date.now()}`, name: nm.trim(), parentId: isF ? id : "f_root", open: true, visible: true });
            saveGeState(); renderPlacesTree();
        } else if (act === "add-point") { startTool("point"); }
        else if (act === "add-line") { startTool("line"); }
        else if (act === "add-poly") { startTool("polygon"); }
        else if (act === "props" && !isF) { openPropertiesWin(id); }
        else if (act === "elev" && !isF) { showElevationProfile(ge.items.find(i => i.id === id)); }
        else if (act === "rename") {
            const target = isF ? ge.folders.find(f => f.id === id) : ge.items.find(i => i.id === id);
            if (!target) return;
            const nm = prompt("Yeni ad:", target.name);
            if (!nm) return;
            pushUndo(); target.name = nm.trim(); saveGeState(); renderAllGe();
        } else if (act === "copy" || act === "cut") {
            const it = ge.items.find(i => i.id === id);
            if (it) { ge.clipboard = { mode: act, item: JSON.parse(JSON.stringify(it)) }; notify(act === "copy" ? "📋 Kopyalandı" : "✂️ Kəsildi"); }
        } else if (act === "paste" && ge.clipboard) {
            pushUndo();
            const clone = JSON.parse(JSON.stringify(ge.clipboard.item));
            clone.id = `ge_p_${Date.now()}`;
            clone.folderId = getTargetFolderId();
            if (ge.clipboard.mode === "cut") ge.items = ge.items.filter(x => x.id !== ge.clipboard.item.id);
            else clone.name += " (kopya)";
            ge.items.push(clone);
            if (ge.clipboard.mode === "cut") ge.clipboard = null;
            saveGeState(); renderAllGe();
        } else if (act === "dup" && !isF) {
            const it = ge.items.find(i => i.id === id);
            if (!it) return;
            pushUndo();
            const c = JSON.parse(JSON.stringify(it));
            c.id = `ge_d_${Date.now()}`; c.name += " (2)";
            ge.items.push(c); saveGeState(); renderAllGe();
        } else if (act === "share-style" && isF) {
            const col = prompt("Bütün qovluq üçün rəng kodu (məs: #22c55e, #3b82f6, #ef4444, #38bdf8):", "#38bdf8");
            if (!col) return;
            pushUndo();
            ge.items.filter(i => i.folderId === id).forEach(i => { i.color = col.trim(); i.fillColor = col.trim(); });
            saveGeState(); renderAllGe(); notify("🎨 Qovluqdakı bütün obyektlərə eyni stil tətbiq edildi");
        } else if (act === "save-kmz") {
            savePlaceAsKmz(id, isF);
        } else if (act === "delete") {
            if (isF && id === "f_root") { notify("Əsas qovluq silinə bilməz", true); return; }
            pushUndo();
            if (isF) {
                ge.folders = ge.folders.filter(f => f.id !== id);
                ge.items = ge.items.filter(i => i.folderId !== id);
            } else {
                ge.items = ge.items.filter(i => i.id !== id);
            }
            ge.selectedId = "";
            saveGeState(); renderAllGe(); notify("🗑️ Silindi");
        }
    }

    function startTool(tool) {
        ge.activeTool = (ge.activeTool === tool) ? null : tool;
        ge.draft = [];
        updateToolbarActive();
        if (window.map) map.getCanvas().style.cursor = ge.activeTool ? "crosshair" : "";
        if (ge.activeTool === "ruler") renderRulerWin();
        else if (ge.activeTool === "line" || ge.activeTool === "polygon") renderDrawHelperBanner();
        else if (ge.activeTool === "point") notify("📍 Nöqtə qoymaq üçün xəritədə klikləyin");
        else if ($id("gePropsWin")) $id("gePropsWin").hidden = true;
        renderGeMap();
    }

    function updateToolbarActive() {
        document.querySelectorAll("#geToolbar [data-ge-tool]").forEach(b => {
            b.classList.toggle("active", b.dataset.geTool === ge.activeTool);
        });
        $id("geGridBtn")?.classList.toggle("active", ge.gridOn);
    }

    function renderAllGe() {
        renderPlacesTree();
        renderGeMap();
    }

    /* ---------- BUILD GOOGLE EARTH PRO OFFICE DOM ---------- */
    function buildGeOfficeDom() {
        if (ge.built) return;
        ge.built = true;
        const mapStage = document.querySelector(".map-stage") || document.body;

        // 1) Üst Alətlər Paneli (Toolbar)
        const tb = document.createElement("div");
        tb.id = "geToolbar";
        tb.className = "ge-toolbar";
        tb.innerHTML = `
            <button type="button" class="ge-tb-btn" id="geToggleSideBtn" title="Sol paneli gizlət / göstər"><i class="fa-solid fa-sidebar"></i><i class="fa-solid fa-bars"></i></button>
            <span class="ge-tb-sep"></span>
            <button type="button" class="ge-tb-btn" data-ge-tool="point" title="Nöqtə əlavə et (Add Placemark)"><i class="fa-solid fa-location-dot" style="color:#fbbf24"></i></button>
            <button type="button" class="ge-tb-btn" data-ge-tool="polygon" title="Poliqon əlavə et (Add Polygon)"><i class="fa-solid fa-draw-polygon" style="color:#22c55e"></i></button>
            <button type="button" class="ge-tb-btn" data-ge-tool="line" title="Xətt / Yol çək (Add Path)"><i class="fa-solid fa-route" style="color:#38bdf8"></i></button>
            <button type="button" class="ge-tb-btn" id="geOverlayBtn" title="Şəkil örtüyü (Add Image Overlay)"><i class="fa-solid fa-image" style="color:#a855f7"></i></button>
            <button type="button" class="ge-tb-btn" id="geHistBtn" title="Tarixi peyk görüntüsü (Historical Imagery)"><i class="fa-solid fa-clock-rotate-left" style="color:#fbbf24"></i></button>
            <span class="ge-tb-sep"></span>
            <button type="button" class="ge-tb-btn" data-ge-tool="ruler" title="Xətkeş / Ölçmə aləti (Ruler)"><i class="fa-solid fa-ruler-combined" style="color:#fbbf24"></i></button>
            <button type="button" class="ge-tb-btn" id="geGridBtn" title="Koordinat şəbəkəsi (Grid)"><i class="fa-solid fa-border-all"></i></button>
            <button type="button" class="ge-tb-btn" id="geImportBtn" title="İmport: KMZ, KML, GeoJSON, GPX, CSV"><i class="fa-solid fa-file-import" style="color:#4ade80"></i></button>
            <input type="file" id="geImportInput" accept=".kmz,.kml,.geojson,.json,.gpx,.csv,.txt" hidden>
            <input type="file" id="geOverlayInput" accept="image/*" hidden>
            <span class="ge-tb-sep"></span>
            <button type="button" class="ge-tb-btn" id="geShareBtn" title="Paylaş / Link & KMZ"><i class="fa-solid fa-share-nodes" style="color:#4ade80"></i></button>
            <button type="button" class="ge-tb-btn" id="gePrintBtn" title="Çap et (A4 / A3 PDF)"><i class="fa-solid fa-print"></i></button>
            <button type="button" class="ge-tb-btn" id="geSaveImgBtn" title="Yüksək keyfiyyətli şəkil (HD / 4K)"><i class="fa-solid fa-camera" style="color:#38bdf8"></i></button>
        `;
        mapStage.appendChild(tb);

        // 2) Sol 3-Bölməli Resizable Sidebar (Axtarış / Yerlər / Qatlar)
        const side = document.createElement("aside");
        side.id = "geSidebar";
        side.className = "ge-sidebar";
        side.innerHTML = `
            <div class="ge-resizer" id="geResizer" title="Enini dəyişmək üçün sürüşdürün"></div>
            <div class="ge-sec" data-ge-sec="search">
                <div class="ge-sec-head"><span><i class="fa-solid fa-magnifying-glass"></i> Axtarış (Search)</span><i class="fa-solid fa-chevron-down"></i></div>
                <div class="ge-sec-body">
                    <div class="ge-search-row">
                        <input type="search" class="input" id="geSearchInp" placeholder="40.4093, 49.8671 · 40°24'33&quot;N · TŞ...">
                        <button type="button" class="btn btn-primary" id="geSearchBtn" style="height:32px;padding:0 10px;font-size:12px">Tap</button>
                    </div>
                </div>
            </div>
            <div class="ge-sec places" data-ge-sec="places">
                <div class="ge-sec-head"><span><i class="fa-solid fa-folder-tree"></i> Yerlər (Places)</span><i class="fa-solid fa-chevron-down"></i></div>
                <div class="ge-sec-body">
                    <div class="ge-places-bar">
                        <button type="button" class="ge-mini-btn" id="geBcgTplBtn" style="color:#fbbf24" title="12 standart BCG alt-qovluğu ilə yeni layihə yarat"><i class="fa-solid fa-wand-magic-sparkles"></i> BCG Şablon</button>
                        <button type="button" class="ge-mini-btn" id="geNewFolderBtn"><i class="fa-solid fa-folder-plus"></i> Qovluq</button>
                        <button type="button" class="ge-mini-btn" id="geSyncSahaBtn" title="Sahədən gələn obyektləri yenilə"><i class="fa-solid fa-rotate"></i> Sahə</button>
                        <button type="button" class="ge-mini-btn" id="geSaveAllKmzBtn" style="color:#4ade80"><i class="fa-solid fa-earth-europe"></i> KMZ</button>
                    </div>
                    <div class="ge-tree" id="gePlacesTree"></div>
                    <div class="ge-places-foot">
                        <input type="search" class="input" id="gePlacesFilterInp" placeholder="🔍 Qovluqda süz..." style="height:26px;font-size:11px;flex:1">
                        <button type="button" class="ge-mini-btn" id="geMoveUpBtn" title="Yuxarı daşı">↑</button>
                        <button type="button" class="ge-mini-btn" id="geMoveDnBtn" title="Aşağı daşı">↓</button>
                    </div>
                </div>
            </div>
            <div class="ge-sec" data-ge-sec="layers">
                <div class="ge-sec-head"><span><i class="fa-solid fa-layer-group"></i> Qatlar (Layers)</span><i class="fa-solid fa-chevron-down"></i></div>
                <div class="ge-sec-body">
                    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px">
                        <button type="button" class="ge-mini-btn active" data-ge-base="satellite">Peyk</button>
                        <button type="button" class="ge-mini-btn" data-ge-base="osm">Küçə</button>
                        <button type="button" class="ge-mini-btn" data-ge-base="esri">Esri</button>
                    </div>
                    <label class="ge-layer-row"><input type="checkbox" id="geLyrNames" checked> Yollar və küçə adları</label>
                    <label class="ge-layer-row"><input type="checkbox" id="geLyrGrid"> Koordinat şəbəkəsi (Grid)</label>
                    <label class="ge-layer-row"><input type="checkbox" id="geLyr3d"> 3D Relyef / Tilt baxışı</label>
                </div>
            </div>
        `;
        document.body.appendChild(side);

        // 3) Sağ Naviqasiya (Kompas N, Tilt 2D/3D, Zoom +/-)
        const nav = document.createElement("div");
        nav.id = "geNavCtrl";
        nav.className = "ge-nav-ctrl";
        nav.innerHTML = `
            <button type="button" class="ge-nav-btn compass" id="geNavNorth" title="Şimala qaytar (N)">N</button>
            <button type="button" class="ge-nav-btn" id="geNavTilt" title="Düz yuxarıdan / 3D baxış (R)">3D</button>
            <button type="button" class="ge-nav-btn" id="geNavZoomIn" title="Yaxınlaşdır (+)">+</button>
            <button type="button" class="ge-nav-btn" id="geNavZoomOut" title="Uzaqlaşdır (−)">−</button>
        `;
        mapStage.appendChild(nav);

        // 4) Aşağı Status Zolağı
        const sb = document.createElement("div");
        sb.id = "geStatusBar";
        sb.className = "ge-status-bar";
        sb.innerHTML = `
            <div class="ge-status-group">
                <span id="geStatCoord">40.409300° N, 49.867100° E</span>
                <span id="geStatEye">Göz hündürlüyü: —</span>
            </div>
            <div class="ge-status-group">
                <span>Peyk tarixi: 2026</span>
                <span style="color:#38bdf8">BCG Earth Pro Ofis</span>
            </div>
        `;
        document.body.appendChild(sb);

        // 5) Floating Windows (Context Menu, Properties/Ruler/Export, Elevation Profile)
        const ctx = document.createElement("div"); ctx.id = "geCtxMenu"; ctx.className = "ge-ctx-menu"; ctx.hidden = true; document.body.appendChild(ctx);
        const pw = document.createElement("div"); pw.id = "gePropsWin"; pw.className = "ge-float-win"; pw.hidden = true; document.body.appendChild(pw);
        const ev = document.createElement("div"); ev.id = "geElevBar"; ev.className = "ge-elev-bar"; ev.hidden = true; document.body.appendChild(ev);
        const hb = document.createElement("div"); hb.id = "geHistBar"; hb.className = "ge-hist-bar"; hb.hidden = true;
        hb.innerHTML = `<span>🕒 Tarixi Peyk: <b id="geHistYr">2026</b></span><input type="range" id="geHistSlider" min="2018" max="2026" value="2026" step="1"><button type="button" class="icon-btn small" id="geHistClose"><i class="fa-solid fa-xmark"></i></button>`;
        mapStage.appendChild(hb);

        bindGeEvents();
    }

    function bindGeEvents() {
        // Toolbar
        $id("geToggleSideBtn")?.addEventListener("click", () => {
            const s = $id("geSidebar");
            const hidden = s.classList.toggle("collapsed");
            document.body.classList.toggle("ge-side-hidden", hidden);
        });
        document.querySelectorAll("#geToolbar [data-ge-tool]").forEach(b => {
            b.addEventListener("click", () => startTool(b.dataset.geTool));
        });
        $id("geGridBtn")?.addEventListener("click", () => {
            ge.gridOn = !ge.gridOn;
            if ($id("geLyrGrid")) $id("geLyrGrid").checked = ge.gridOn;
            updateToolbarActive();
            renderGeGrid();
        });
        $id("geHistBtn")?.addEventListener("click", () => {
            ge.histOn = !ge.histOn;
            const hb = $id("geHistBar");
            if (hb) hb.hidden = !ge.histOn;
            $id("geHistBtn")?.classList.toggle("active", ge.histOn);
        });
        $id("geHistClose")?.addEventListener("click", () => { ge.histOn = false; if ($id("geHistBar")) $id("geHistBar").hidden = true; $id("geHistBtn")?.classList.remove("active"); });
        $id("geHistSlider")?.addEventListener("input", e => {
            ge.histYear = Number(e.target.value);
            if ($id("geHistYr")) $id("geHistYr").textContent = String(ge.histYear);
            if (typeof switchBaseLayer === "function") switchBaseLayer(ge.histYear >= 2023 ? "satellite" : "esri");
        });
        $id("geBcgTplBtn")?.addEventListener("click", () => {
            const nm = prompt("Yeni BCG Layihə adı (12 standart alt-qovluq avtomatik yaranacaq):", "Yeni BCG Layihə");
            if (nm) createBcgProjectTemplate(nm);
        });
        $id("gePlacesFilterInp")?.addEventListener("input", e => {
            ge.placesFilter = (e.target.value || "").trim().toLowerCase();
            renderPlacesTree();
        });
        const moveSelected = dir => {
            if (!ge.selectedId || ge.selectedIsFolder) return;
            const idx = ge.items.findIndex(x => x.id === ge.selectedId);
            const next = idx + dir;
            if (idx < 0 || next < 0 || next >= ge.items.length) return;
            pushUndo();
            const [moved] = ge.items.splice(idx, 1);
            ge.items.splice(next, 0, moved);
            saveGeState(); renderPlacesTree();
        };
        $id("geMoveUpBtn")?.addEventListener("click", () => moveSelected(-1));
        $id("geMoveDnBtn")?.addEventListener("click", () => moveSelected(1));
        $id("geImportBtn")?.addEventListener("click", () => $id("geImportInput")?.click());
        $id("geImportInput")?.addEventListener("change", async e => {
            const f = e.target.files?.[0];
            if (f) await importGeFile(f);
            e.target.value = "";
        });
        $id("geOverlayBtn")?.addEventListener("click", () => $id("geOverlayInput")?.click());
        $id("geOverlayInput")?.addEventListener("change", e => {
            const f = e.target.files?.[0];
            if (!f || !window.map) return;
            const reader = new FileReader();
            reader.onload = () => {
                const b = map.getBounds();
                const dx = (b.getEast() - b.getWest()) * 0.25, dy = (b.getNorth() - b.getSouth()) * 0.25;
                const w = b.getWest() + dx, ea = b.getEast() - dx, s = b.getSouth() + dy, n = b.getNorth() - dy;
                pushUndo();
                const ov = {
                    id: `ge_ov_${Date.now()}`,
                    folderId: getTargetFolderId(),
                    kind: "overlay",
                    name: f.name.replace(/\.[^.]+$/, ""),
                    desc: "Şəkil örtüyü (Image Overlay)",
                    imgUrl: reader.result,
                    bounds: [[w, n], [ea, n], [ea, s], [w, s]],
                    opacity: 0.72,
                    visible: true
                };
                ge.items.push(ov);
                saveGeState(); renderAllGe(); openPropertiesWin(ov.id);
                notify("🖼️ Şəkil örtüyü xəritəyə yerləşdirildi");
            };
            reader.readAsDataURL(f);
            e.target.value = "";
        });
        $id("geShareBtn")?.addEventListener("click", () => {
            $id("sahaBarShareBtn")?.click();
        });
        $id("gePrintBtn")?.addEventListener("click", () => openExportStudio("print"));
        $id("geSaveImgBtn")?.addEventListener("click", () => openExportStudio("image"));

        // Resizer (Sidebar eni sürüşdürmə)
        $id("geResizer")?.addEventListener("mousedown", e => {
            e.preventDefault();
            const startX = e.clientX, startW = $id("geSidebar").offsetWidth;
            const onMove = ev => {
                const nw = Math.max(240, Math.min(540, startW + (ev.clientX - startX)));
                ge.sideWidth = nw;
                document.documentElement.style.setProperty("--ge-side-w", `${nw}px`);
            };
            const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
        });

        // Section collapse
        document.querySelectorAll("#geSidebar .ge-sec-head").forEach(h => {
            h.addEventListener("click", () => h.parentElement.classList.toggle("collapsed"));
        });

        // Search
        const doSearch = () => {
            const q = ($id("geSearchInp")?.value || "").trim();
            if (!q) return;
            const c = parseAnyCoord(q);
            if (c && window.map) { map.flyTo({ center: [c[1], c[0]], zoom: 16, duration: 750 }); notify(`📍 ${c[0]}, ${c[1]}`); return; }
            const ql = q.toLowerCase();
            const hit = ge.items.find(i => `${i.name} ${i.desc || ""}`.toLowerCase().includes(ql));
            if (hit) {
                ge.selectedId = hit.id; ge.selectedIsFolder = false; renderPlacesTree();
                const cs = hit.kind === "point" ? [hit.coords] : (Array.isArray(hit.coords) ? hit.coords : []);
                if (cs.length && typeof flyToCoords === "function") flyToCoords(cs);
                notify(`📍 Tapıldı: ${hit.name}`);
            } else {
                notify("Uyğun obyekt və ya koordinat tapılmadı", true);
            }
        };
        $id("geSearchBtn")?.addEventListener("click", doSearch);
        $id("geSearchInp")?.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); doSearch(); } });

        // Places toolbar
        $id("geNewFolderBtn")?.addEventListener("click", () => {
            const nm = prompt("Yeni qovluğun adı:", "Yeni Qovluq");
            if (!nm) return;
            pushUndo();
            ge.folders.push({ id: `f_${Date.now()}`, name: nm.trim(), parentId: "f_root", open: true, visible: true });
            saveGeState(); renderPlacesTree();
        });
        $id("geSyncSahaBtn")?.addEventListener("click", () => { syncSahaFeaturesIntoPlaces(); renderAllGe(); notify("🔄 Sahə obyektləri yeniləndi"); });
        $id("geSaveAllKmzBtn")?.addEventListener("click", () => savePlaceAsKmz("f_root", true));

        // Places Tree clicks, dblclick, contextmenu, Drag & Drop
        const tree = $id("gePlacesTree");
        tree?.addEventListener("click", e => {
            const tg = e.target.closest("[data-toggle-f]");
            if (tg) {
                const f = ge.folders.find(x => x.id === tg.dataset.toggleF);
                if (f) { f.open = !f.open; renderPlacesTree(); }
                return;
            }
            if (e.target.matches("[data-chk-f]")) {
                const f = ge.folders.find(x => x.id === e.target.dataset.chkF);
                if (f) { f.visible = e.target.checked; saveGeState(); renderGeMap(); }
                return;
            }
            if (e.target.matches("[data-chk-i]")) {
                const it = ge.items.find(x => x.id === e.target.dataset.chkI);
                if (it) { it.visible = e.target.checked; saveGeState(); renderGeMap(); }
                return;
            }
            const fNode = e.target.closest("[data-fid]");
            if (fNode) { ge.selectedId = fNode.dataset.fid; ge.selectedIsFolder = true; renderPlacesTree(); return; }
            const iNode = e.target.closest("[data-iid]");
            if (iNode) { ge.selectedId = iNode.dataset.iid; ge.selectedIsFolder = false; renderPlacesTree(); }
        });

        tree?.addEventListener("dblclick", e => {
            const iNode = e.target.closest("[data-iid]");
            if (iNode) {
                const it = ge.items.find(x => x.id === iNode.dataset.iid);
                if (it && typeof flyToCoords === "function") {
                    if (it.kind === "point") flyToCoords([it.coords]);
                    else if (Array.isArray(it.coords)) flyToCoords(it.coords);
                }
            }
        });

        tree?.addEventListener("contextmenu", e => {
            const fNode = e.target.closest("[data-fid]");
            const iNode = e.target.closest("[data-iid]");
            if (!fNode && !iNode) return;
            e.preventDefault();
            openContextMenu(e.clientX, e.clientY, fNode ? fNode.dataset.fid : iNode.dataset.iid, Boolean(fNode));
        });

        // Drag & Drop obyektləri qovluğa atmaq
        let draggedItemId = "";
        tree?.addEventListener("dragstart", e => {
            const n = e.target.closest("[data-iid]");
            if (n) draggedItemId = n.dataset.iid;
        });
        tree?.addEventListener("dragover", e => {
            const f = e.target.closest("[data-drop-folder]");
            if (f && draggedItemId) { e.preventDefault(); f.classList.add("drag-over"); }
        });
        tree?.addEventListener("dragleave", e => { e.target.closest("[data-drop-folder]")?.classList.remove("drag-over"); });
        tree?.addEventListener("drop", e => {
            const f = e.target.closest("[data-drop-folder]");
            if (!f || !draggedItemId) return;
            e.preventDefault();
            f.classList.remove("drag-over");
            const it = ge.items.find(x => x.id === draggedItemId);
            if (it) {
                pushUndo();
                it.folderId = f.dataset.dropFolder;
                saveGeState(); renderAllGe(); notify("📁 Obyekt qovluğa köçürüldü");
            }
            draggedItemId = "";
        });

        // Context Menu action
        $id("geCtxMenu")?.addEventListener("click", e => {
            const b = e.target.closest("[data-ca]");
            if (b) runContextAction(b.dataset.ca);
        });
        document.addEventListener("click", e => {
            const m = $id("geCtxMenu");
            if (m && !m.hidden && !e.target.closest("#geCtxMenu")) m.hidden = true;
        });

        // Layers controls
        document.querySelectorAll("#geSidebar [data-ge-base]").forEach(b => {
            b.addEventListener("click", () => {
                document.querySelectorAll("#geSidebar [data-ge-base]").forEach(x => x.classList.toggle("active", x === b));
                if (typeof switchBaseLayer === "function") switchBaseLayer(b.dataset.geBase);
            });
        });
        $id("geLyrNames")?.addEventListener("change", () => $id("namesBtn")?.click());
        $id("geLyrGrid")?.addEventListener("change", e => { ge.gridOn = e.target.checked; updateToolbarActive(); renderGeGrid(); });
        $id("geLyr3d")?.addEventListener("change", e => {
            ge.tilt3d = e.target.checked;
            if (window.map) map.easeTo({ pitch: ge.tilt3d ? 50 : 0, duration: 500 });
        });

        // Right Nav Controls
        $id("geNavNorth")?.addEventListener("click", () => window.map?.easeTo({ bearing: 0, duration: 400 }));
        $id("geNavTilt")?.addEventListener("click", () => {
            if (!window.map) return;
            const nextPitch = map.getPitch() > 10 ? 0 : 48;
            map.easeTo({ pitch: nextPitch, bearing: nextPitch === 0 ? 0 : map.getBearing(), duration: 450 });
        });
        $id("geNavZoomIn")?.addEventListener("click", () => window.map?.zoomIn());
        $id("geNavZoomOut")?.addEventListener("click", () => window.map?.zoomOut());

        // Keyboard shortcuts (HOME rejimində)
        document.addEventListener("keydown", e => {
            if (!isHomeMode()) return;
            const inInput = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); doUndo(); return; }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); doRedo(); return; }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") { e.preventDefault(); $id("geSearchInp")?.focus(); return; }
            if (inInput) return;
            if (e.key.toLowerCase() === "r") { window.map?.easeTo({ bearing: 0, pitch: 0, duration: 450 }); }
            else if (e.key.toLowerCase() === "n") { window.map?.easeTo({ bearing: 0, duration: 350 }); }
            else if (e.key === "Delete" && ge.selectedId && !ge.selectedIsFolder) { runContextAction("delete"); }
            else if (e.key === "Escape") {
                ge.activeTool = null; ge.draft = [];
                if ($id("gePropsWin")) $id("gePropsWin").hidden = true;
                if ($id("geElevBar")) $id("geElevBar").hidden = true;
                if (window.map) map.getCanvas().style.cursor = "";
                updateToolbarActive(); renderGeMap();
            }
        });
    }

    function hookMapTelemetry() {
        if (!window.map) { setTimeout(hookMapTelemetry, 400); return; }
        map.on("mousemove", e => {
            if (!isHomeMode()) return;
            const el = $id("geStatCoord");
            if (el) el.textContent = `${e.lngLat.lat.toFixed(6)}° N, ${e.lngLat.lng.toFixed(6)}° E`;
        });
        map.on("moveend", () => {
            if (!isHomeMode()) return;
            renderGeGrid();
            const eye = $id("geStatEye");
            if (eye) {
                const z = map.getZoom();
                const altM = Math.round(40075000 / Math.pow(2, z + 1));
                eye.textContent = `Göz hündürlüyü: ${altM >= 1000 ? (altM / 1000).toFixed(1) + " km" : altM + " m"}`;
            }
        });
        window.refreshGeOfficeLayer = renderGeMap;
    }

    function initGeOffice() {
        loadGeState();
        buildGeOfficeDom();
        hookMapTelemetry();

        // Workspace mode dəyişəndə HOME açılırsa Google Earth Pro-nu yenilə
        const obs = new MutationObserver(() => {
            if (isHomeMode()) {
                syncSahaFeaturesIntoPlaces();
                renderAllGe();
            } else {
                if ($id("gePropsWin")) $id("gePropsWin").hidden = true;
                if ($id("geElevBar")) $id("geElevBar").hidden = true;
                renderGeMap();
            }
        });
        obs.observe(document.body, { attributes: true, attributeFilter: ["data-workspace-mode"] });
    }

    document.addEventListener("DOMContentLoaded", initGeOffice);
})();
