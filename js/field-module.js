/* ============================================================================
   BCG GIS — SAHƏ MODULU (js/field-module.js)
   - Mövcud PMO/Xəritə sistemindən tam təcrid olunmuş, yandırıb-söndürülə bilən qat
   - Mühəndis: Layihə → Rayon → Nöqtə (və ya GPS Ən Yaxın Nöqtə) + Mərhələlər + Kumulyativ Materiallar
   - Map Marker: BCG (içi boş) / Başqa qurum (içi dolu) nöqtə işarələri + FO 12/24/48 & Qazıntı xətləri
   - Xəritədən materiala 1-klik köçürmə + KMZ/KML Import & Google Earth Pro Export
   - Ofis Nəzarəti: Gündəlik Xülasə (WhatsApp əvəzi), Tarixçə, Geri al (Undo), CSV İxrac
   ============================================================================ */

(() => {
    const SAHA_CFG_KEY = "bcg.saha.config.v1";
    const SAHA_DRAW_KEY = "bcg.saha.drawings.v1";
    const SAHA_JOURNAL_KEY = "bcg.saha.journal.v1";

    const POINT_TYPES = {
        pole:  { label: "Dirək",         hollow: "□", filled: "■", subs: ["6 m", "8 m"],                           defaultSub: "6 m",          color: "#38bdf8" },
        mufta: { label: "Mufta",         hollow: "△", filled: "▲", subs: ["FO-12", "FO-24", "FO-48"],              defaultSub: "FO-24",        color: "#22c55e" },
        quyu:  { label: "Quyu",          hollow: "○", filled: "●", subs: ["KRQ-1", "Beton"],                       defaultSub: "KRQ-1",        color: "#a855f7" },
        trans: { label: "Transformator", hollow: "◇", filled: "◆", subs: [],                                       defaultSub: "",             color: "#f59e0b" },
        ant:   { label: "Antena",        hollow: "☆", filled: "★", subs: ["PTZ", "Fix", "Radar"],                  defaultSub: "PTZ",          color: "#ef4444" },
        exist: { label: "Mövcud nöqtə",  hollow: "◎", filled: "◉", subs: ["Mövcud dirək", "Mövcud quyu", "Qoşulma"], defaultSub: "Qoşulma",     color: "#06b6d4" }
    };

    const LINE_TYPES = {
        fo12:    { label: "FO 12",           color: "#22c55e", kmlColor: "ff5ec522", dashed: false },
        fo24:    { label: "FO 24",           color: "#3b82f6", kmlColor: "fff6823b", dashed: false },
        fo48:    { label: "FO 48",           color: "#ef4444", kmlColor: "ff4444ef", dashed: false },
        elec:    { label: "Elektrik kabeli", color: "#dc2626", kmlColor: "ff2626dc", dashed: false },
        qazinti: { label: "Qazıntı",         color: "#92400e", kmlColor: "ff0e4092", dashed: true  }
    };

    const FALLBACK_MATERIALS = [
        "Dəmir dirək 100x100 H6,5 m",
        "Dəmir dirək 100x100 H8 m",
        "Dəmir dirəyin quraşdırılması (Rabitə dirəyi)",
        "FO 12 kabelin çəkilməsi",
        "FO 24 kabelin çəkilməsi",
        "FO 48 kabelin çəkilməsi",
        "FO kabelin çəkilməsi",
        "FO12 muftanın vurulması",
        "FO24 muftanın vurulması",
        "FO48 muftanın vurulması",
        "KRQ-1 F400 polietilen quyu",
        "KRQ-Polietilen quyunun quraşdırılması",
        "Qazıntı (xəndək) işi (m)",
        "Polietilen boru F50",
        "Polietilen boru F32",
        "Kamera dirəyi (Ətək və montaj lövhəsi ilə birgə)",
        "İP qutu (TŞ tipli, lande)",
        "Elektrik kabeli 2x2.5",
        "Torpaqlama çubuğu",
        "Xəbərdarlıq lenti"
    ];

    const saha = {
        open: false,
        workspaceMode: "status", // "status" | "field" | "home"
        allowedModes: ["home", "status", "field"],
        collapsed: false,
        layerVisible: true,
        activeTab: "map", // field: "map" | "work"; home: "home-edit" | "home-pdf" | "office"
        selectedProjId: "",
        selectedRayonId: "",
        selectedPointId: "",
        stages: { BUNOVRE: false, DIREK: false, OPTIK: false, ELEKTRIK: false },
        materialsCatalog: [], // [{ col, name, plan, done, hasFormula }]
        qtyMap: {},           // { [matName]: number }
        matSearch: "",
        lastGps: "",
        // Map Marker state
        owner: "bcg",         // "bcg" (hollow) | "other" (filled)
        drawTool: null,       // null | "pt:pole" | "pt:mufta" | ... | "ln:fo12" | ...
        fieldEditId: "",      // Sahə xəritəsində redaktə üçün seçilmiş obyekt
        fieldMovingId: "",    // Sahə xəritəsində yeri dəyişdirilən nöqtə
        subChoice: { pole: "6 m", mufta: "FO-24", quyu: "KRQ-1", trans: "", ant: "PTZ", exist: "Qoşulma" },
        draftLine: [],        // [[lat, lng], ...]
        features: [],         // { id, kind:"point"|"line", type, sub, owner, coords, meters, projId, projectName, rayonName, tsNo, engineer, workDate, label, note, photos, createdAt }
        photos: [],           // cari göndəriş üçün çəkilmiş fotolar (base64 dataURL)
        cariName: "",         // "⚡ Cari Tapşırıq" işin adı
        cariPoint: "",        // "⚡ Cari Tapşırıq" nöqtə/ünvan adı
        packets: [],          // Bazaya göndərilmiş paketlər (pending / approved / rejected)
        seenPacketIds: new Set(),
        journal: [],          // synced + local journal rows
        officeDateFilter: "today", // "today" | "all" | "YYYY-MM-DD"
        officeQuery: "",
        // HOME (Google Earth / AutoCAD Ofis) state
        homeQuery: "",
        homeSubView: "folders", // "folders" | "materials" | "pending"
        homeMatFilter: "",      // seçilmiş material qrupu (məs: "pole:6 m", "ln:fo12")
        homeOpenFolders: new Set(),
        homeSelectedId: "",
        homePdfSelected: new Set(),
        config: { webAppUrl: "", token: "" }
    };

    const byId = id => document.getElementById(id);
    const safeEsc = v => typeof esc === "function" ? esc(v) : String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const showToast = (msg, err = false) => { if (typeof toast === "function") toast(msg, err); };
    const isAdminUser = () => typeof isAdmin === "function" && isAdmin();

    function todayIso() {
        const d = new Date();
        const pad = n => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function nowDisplay() {
        const d = new Date();
        const pad = n => String(n).padStart(2, "0");
        return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    /** Boşluqlu koordinatları (məs: "41.417690, 46 927913") avtomatik düzəldir */
    function parseSpaceSafeCoord(raw) {
        let s = String(raw ?? "").trim();
        if (!s) return null;
        s = s.replace(/(\d{2})\s+(\d{4,7})/g, "$1.$2");
        const m = s.match(/(-?\d{1,2}[.,]\d+)\s*[,;\s/]+\s*(-?\d{1,3}[.,]\d+)/);
        if (!m) return null;
        const a = Number(m[1].replace(",", "."));
        const b = Number(m[2].replace(",", "."));
        if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
        if (a >= 38 && a <= 42.5 && b >= 44 && b <= 51.5) return [Number(a.toFixed(6)), Number(b.toFixed(6))];
        if (b >= 38 && b <= 42.5 && a >= 44 && a <= 51.5) return [Number(b.toFixed(6)), Number(a.toFixed(6))];
        return null;
    }

    function haversineMeters(c1, c2) {
        const R = 6371000;
        const rad = x => x * Math.PI / 180;
        const dLat = rad(c2[0] - c1[0]);
        const dLng = rad(c2[1] - c1[1]);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(c1[0])) * Math.cos(rad(c2[0])) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function lineMeters(coords) {
        if (!Array.isArray(coords) || coords.length < 2) return 0;
        let total = 0;
        for (let i = 1; i < coords.length; i++) total += haversineMeters(coords[i - 1], coords[i]);
        return Math.round(total);
    }

    function loadPersisted() {
        try {
            const cfg = JSON.parse(localStorage.getItem(SAHA_CFG_KEY) || "null");
            if (cfg && typeof cfg === "object") saha.config = { webAppUrl: cfg.webAppUrl || "", token: cfg.token || "" };
        } catch {}
        try {
            const dr = JSON.parse(localStorage.getItem(SAHA_DRAW_KEY) || "[]");
            if (Array.isArray(dr)) saha.features = dr;
        } catch {}
        try {
            const jr = JSON.parse(localStorage.getItem(SAHA_JOURNAL_KEY) || "[]");
            if (Array.isArray(jr)) saha.journal = jr;
        } catch {}
        try {
            const pk = JSON.parse(localStorage.getItem(SAHA_PACKETS_KEY) || "[]");
            if (Array.isArray(pk)) {
                saha.packets = pk;
                pk.forEach(p => { if (p?.id) saha.seenPacketIds.add(p.id); });
            }
        } catch {}
    }

    function saveConfig() {
        try { localStorage.setItem(SAHA_CFG_KEY, JSON.stringify(saha.config)); } catch {}
    }
    function saveDrawings() {
        try { localStorage.setItem(SAHA_DRAW_KEY, JSON.stringify(saha.features)); } catch {}
    }
    function saveJournal() {
        try { localStorage.setItem(SAHA_JOURNAL_KEY, JSON.stringify(saha.journal.slice(0, 600))); } catch {}
    }

    /* =========================================================================
       1) PMO LAYİHƏ → RAYON → NÖQTƏ DATA HELPERS (Excel vərəqi/sətir gizlidir)
       ========================================================================= */
    function getPmoProjectsList() {
        const list = (typeof state !== "undefined" && Array.isArray(state.projects)) ? state.projects : [];
        return list.filter(p => p && (p.isPmo || String(p.id).startsWith("pmo_")) && Array.isArray(p.items) && p.items.length > 0);
    }

    function getSelectedProject() {
        return getPmoProjectsList().find(p => p.id === saha.selectedProjId) || null;
    }

    function getRayonsForProject(proj) {
        if (!proj) return [];
        return (proj.items || []).filter(it => it && !it.isMagistral);
    }

    function getSelectedRayon() {
        const proj = getSelectedProject();
        if (!proj) return null;
        return getRayonsForProject(proj).find(r => r.id === saha.selectedRayonId) || null;
    }

    function getPointsForRayon(rayonItem) {
        if (!rayonItem) return [];
        const subs = rayonItem.pmoRayon?.subPoints;
        if (Array.isArray(subs) && subs.length > 0) return subs;
        return [{
            id: rayonItem.id,
            tsNo: rayonItem.name,
            name: rayonItem.name,
            address: rayonItem.name,
            coords: Array.isArray(rayonItem.coords?.[0]) ? rayonItem.coords[0] : null,
            status: rayonItem.status
        }];
    }

    function getSelectedPoint() {
        const ry = getSelectedRayon();
        if (!ry) return null;
        return getPointsForRayon(ry).find(pt => pt.id === saha.selectedPointId) || null;
    }

    function extractPlanRowFromPointId(pt) {
        if (!pt || !pt.id) return 0;
        const m = String(pt.id).match(/_r(\d+)$/i);
        return m ? Number(m[1]) : 0;
    }

    /** Canlı oxunmuş Google Sheets vərəqindən ("Material" sütunundan sağdakı bütün sütunlar) material siyahısını çıxarır */
    function extractMaterialsFromLiveCache(sheetId) {
        const rows = window.__pmoSubSheetCache?.sheets?.[String(sheetId)]?._rawRows;
        if (!Array.isArray(rows) || rows.length < 3) return [];
        let headerRow = null;
        let matColIdx = -1;
        for (let r = 0; r < Math.min(6, rows.length); r++) {
            const row = rows[r] || [];
            const idx = row.findIndex(c => /^material$/i.test(String(c || "").trim()));
            if (idx >= 0) {
                headerRow = row;
                matColIdx = idx;
                break;
            }
        }
        if (!headerRow || matColIdx < 0) return [];
        const out = [];
        for (let c = matColIdx + 1; c < headerRow.length; c++) {
            const name = String(headerRow[c] || "").replace(/\s+/g, " ").trim();
            if (!name || /^\d+$/.test(name)) continue;
            out.push({ col: c + 1, name, plan: 0, done: 0, hasFormula: false });
        }
        return out;
    }

    async function loadMaterialsForCurrentSelection() {
        const proj = getSelectedProject();
        const pt = getSelectedPoint();
        const sheetId = String(proj?.sheetId || proj?.pmoMeta?.sheetId || "").trim();

        // 1) Əvvəlcə lokal Google Sheets GViz keşindən dərhal doldur (0ms)
        let list = sheetId ? extractMaterialsFromLiveCache(sheetId) : [];
        if (list.length === 0) {
            list = FALLBACK_MATERIALS.map(name => ({ col: 0, name, plan: 0, done: 0, hasFormula: false }));
        }
        saha.materialsCatalog = list;
        renderMaterialsList();

        // 2) Apps Script qoşuludursa, cari nöqtənin dəqiq köhnə dəyərlərini və düstur bayraqlarını canlı oxu
        if (saha.config.webAppUrl && sheetId) {
            try {
                const planRow = extractPlanRowFromPointId(pt);
                const q = new URLSearchParams({
                    action: "materials",
                    sheet: sheetId,
                    token: saha.config.token || "",
                    tsNo: pt?.tsNo || pt?.name || "",
                    row: planRow ? String(planRow) : ""
                });
                const res = await fetch(`${saha.config.webAppUrl}?${q.toString()}`, { cache: "no-store" });
                const data = await res.json();
                if (data && data.ok && Array.isArray(data.materials) && data.materials.length > 0) {
                    const ps = data.pointState;
                    saha.materialsCatalog = data.materials.map(m => {
                        const st = ps?.materials?.[m.name];
                        return {
                            col: m.col,
                            name: m.name,
                            plan: st ? st.plan : 0,
                            done: st ? st.done : 0,
                            hasFormula: st ? Boolean(st.hasFormula) : false
                        };
                    });
                    if (ps && ps.stages) {
                        Object.keys(saha.stages).forEach(k => {
                            if (ps.stages[k]) saha.stages[k] = Boolean(ps.stages[k].done);
                        });
                        renderStageButtons();
                    }
                    renderMaterialsList();
                }
            } catch (err) {
                console.warn("Sahə materials fetch xətası:", err);
            }
        }
    }

    /* =========================================================================
       2) MAPLIBRE CUSTOM CANVAS ICONS (İçi boş = BCG, İçi dolu = Başqa qurum)
       ========================================================================= */
    function drawSahaIconCanvas(typeKey, owner) {
        const size = 64;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        const meta = POINT_TYPES[typeKey] || POINT_TYPES.pole;
        const isBcg = owner === "bcg";
        const cx = size / 2;
        const cy = size / 2;
        const r = 19;

        ctx.save();
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.shadowColor = "rgba(0, 0, 0, 0.72)";
        ctx.shadowBlur = 5;

        ctx.beginPath();
        if (typeKey === "pole") {
            // □ / ■ Kvadrat — Dirək
            ctx.rect(cx - 14, cy - 14, 28, 28);
        } else if (typeKey === "mufta") {
            // △ / ▲ Üçbucaq — Mufta
            ctx.moveTo(cx, cy - 17);
            ctx.lineTo(cx + 16, cy + 13);
            ctx.lineTo(cx - 16, cy + 13);
            ctx.closePath();
        } else if (typeKey === "quyu") {
            // ○ / ● Dairə — Quyu
            ctx.arc(cx, cy, 15, 0, Math.PI * 2);
        } else if (typeKey === "trans") {
            // ◇ / ◆ Romb — Transformator
            ctx.moveTo(cx, cy - 18);
            ctx.lineTo(cx + 16, cy);
            ctx.lineTo(cx, cy + 18);
            ctx.lineTo(cx - 16, cy);
            ctx.closePath();
        } else if (typeKey === "ant") {
            // ☆ / ★ Ulduz — Antena
            for (let i = 0; i < 10; i++) {
                const rad = (i % 2 === 0) ? r : r * 0.45;
                const ang = -Math.PI / 2 + (i * Math.PI) / 5;
                const x = cx + Math.cos(ang) * rad;
                const y = cy + Math.sin(ang) * rad;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
        } else if (typeKey === "exist") {
            // ◎ / ◉ İkiqat dairə — Mövcud nöqtə
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.closePath();
            if (isBcg) {
                ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.lineWidth = 5;
                ctx.strokeStyle = meta.color;
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(cx, cy, r * 0.36, 0, Math.PI * 2);
                ctx.fillStyle = meta.color;
                ctx.fill();
            } else {
                ctx.fillStyle = meta.color;
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.lineWidth = 2.6;
                ctx.strokeStyle = "#ffffff";
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(cx, cy, r * 0.34, 0, Math.PI * 2);
                ctx.fillStyle = "#ffffff";
                ctx.fill();
            }
            ctx.restore();
            return canvas;
        }

        if (isBcg) {
            // İçi boş = BCG: Təmiz ağ mərkəz + qalın rəngli çərçivə (bir baxışda içi boş bilinir!)
            ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.lineWidth = 5.5;
            ctx.strokeStyle = meta.color;
            ctx.stroke();
        } else {
            // İçi dolu = Başqa qurum: Tam dolğun rəng + nazik ağ haşiyə
            ctx.fillStyle = meta.color;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.lineWidth = 2.6;
            ctx.strokeStyle = "#ffffff";
            ctx.stroke();
        }
        ctx.restore();
        return canvas;
    }

    function ensureSahaMapIcons() {
        if (!window.map) return;
        Object.keys(POINT_TYPES).forEach(typeKey => {
            ["bcg", "other"].forEach(owner => {
                const iconId = `saha-${typeKey}-${owner}`;
                if (map.hasImage(iconId)) return;
                const canvas = drawSahaIconCanvas(typeKey, owner);
                const ctx = canvas.getContext("2d");
                map.addImage(iconId, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: 2 });
            });
        });
    }

    function ensureSahaMapLayers() {
        if (!window.map || !map.isStyleLoaded?.()) return false;
        ensureSahaMapIcons();
        if (!map.getSource("saha-data")) {
            map.addSource("saha-data", {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] }
            });
        }
        if (!map.getLayer("saha-lines-solid")) {
            map.addLayer({
                id: "saha-lines-solid",
                type: "line",
                source: "saha-data",
                filter: ["all", ["==", ["geometry-type"], "LineString"], ["!=", ["get", "dashed"], true]],
                layout: { "line-cap": "round", "line-join": "round" },
                paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.95 }
            });
        }
        if (!map.getLayer("saha-lines-dashed")) {
            map.addLayer({
                id: "saha-lines-dashed",
                type: "line",
                source: "saha-data",
                filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "dashed"], true]],
                layout: { "line-cap": "butt", "line-join": "round" },
                paint: { "line-color": ["get", "color"], "line-width": 4, "line-dasharray": [3.5, 2.2], "line-opacity": 0.95 }
            });
        }
        if (!map.getLayer("saha-points")) {
            map.addLayer({
                id: "saha-points",
                type: "symbol",
                source: "saha-data",
                filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "kind"], "point"]],
                layout: {
                    "icon-image": ["get", "icon"],
                    "icon-size": 0.92,
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": true
                }
            });
        }
        if (!map.getLayer("saha-point-labels")) {
            map.addLayer({
                id: "saha-point-labels",
                type: "symbol",
                source: "saha-data",
                minzoom: 14,
                filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "kind"], "point"], ["has", "lblImg"]],
                layout: {
                    "icon-image": ["get", "lblImg"],
                    "icon-anchor": "top",
                    "icon-offset": [0, 14],
                    "icon-size": 0.68,
                    "icon-allow-overlap": false,
                    "icon-ignore-placement": false
                }
            });
        }
        if (!map.getLayer("saha-line-labels")) {
            map.addLayer({
                id: "saha-line-labels",
                type: "symbol",
                source: "saha-data",
                minzoom: 13.2,
                filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "kind"], "line-label"], ["has", "lblImg"]],
                layout: {
                    "icon-image": ["get", "lblImg"],
                    "icon-anchor": "center",
                    "icon-size": 0.72,
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": true
                }
            });
        }
        // Sahədə seçilən hədəf nöqtə qatı (Status-dan tam müstəqil!)
        if (!map.getSource("saha-target")) {
            map.addSource("saha-target", {
                type: "geojson",
                data: { type: "FeatureCollection", features: [] }
            });
        }
        if (!map.getLayer("saha-target-halo")) {
            map.addLayer({
                id: "saha-target-halo",
                type: "circle",
                source: "saha-target",
                paint: {
                    "circle-radius": 18,
                    "circle-color": "rgba(245, 158, 11, 0.28)",
                    "circle-stroke-width": 2.5,
                    "circle-stroke-color": "#fbbf24"
                }
            });
        }
        if (!map.getLayer("saha-target-core")) {
            map.addLayer({
                id: "saha-target-core",
                type: "circle",
                source: "saha-target",
                paint: {
                    "circle-radius": 7,
                    "circle-color": "#f59e0b",
                    "circle-stroke-width": 2.5,
                    "circle-stroke-color": "#ffffff"
                }
            });
        }
        if (!map.getLayer("saha-target-label")) {
            map.addLayer({
                id: "saha-target-label",
                type: "symbol",
                source: "saha-target",
                filter: ["has", "lblImg"],
                layout: {
                    "icon-image": ["get", "lblImg"],
                    "icon-anchor": "bottom",
                    "icon-offset": [0, -20],
                    "icon-size": 0.76,
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": true
                }
            });
        }
        return true;
    }

    /** Brauzer şrifti ilə 2x Canvas etiket şəkli (MapLibre glyphs tələb etmir, hər xəritədə kristal görünür) */
    const sahaLabelCache = new Map();
    function ensureSahaLabelImage(text, borderColor = "#38bdf8", bgColor = "rgba(15, 23, 42, 0.92)", textColor = "#ffffff") {
        const clean = String(text || "").trim().slice(0, 42);
        if (!clean || !window.map) return "";
        const key = `saha-lbl:${borderColor}:${bgColor}:${clean}`;
        if (sahaLabelCache.has(key) && map.hasImage(key)) return key;
        try {
            const dpr = 2;
            const c = document.createElement("canvas");
            const ctx = c.getContext("2d");
            ctx.font = `700 ${12 * dpr}px Inter, system-ui, Arial, sans-serif`;
            const tw = Math.ceil(ctx.measureText(clean).width);
            const padX = 9 * dpr;
            const h = 22 * dpr;
            const w = Math.max(36 * dpr, tw + padX * 2);
            c.width = w;
            c.height = h;
            ctx.font = `700 ${12 * dpr}px Inter, system-ui, Arial, sans-serif`;
            const r = 6 * dpr;
            ctx.beginPath();
            ctx.moveTo(r, 1); ctx.lineTo(w - r, 1); ctx.quadraticCurveTo(w - 1, 1, w - 1, r);
            ctx.lineTo(w - 1, h - r); ctx.quadraticCurveTo(w - 1, h - 1, w - r, h - 1);
            ctx.lineTo(r, h - 1); ctx.quadraticCurveTo(1, h - 1, 1, h - r);
            ctx.lineTo(1, r); ctx.quadraticCurveTo(1, 1, r, 1);
            ctx.closePath();
            ctx.fillStyle = bgColor;
            ctx.fill();
            ctx.lineWidth = 2.2;
            ctx.strokeStyle = borderColor;
            ctx.stroke();
            ctx.fillStyle = textColor;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(clean, w / 2, h / 2 + 1);
            if (!map.hasImage(key)) {
                map.addImage(key, ctx.getImageData(0, 0, w, h), { pixelRatio: dpr });
            }
            sahaLabelCache.set(key, true);
            return key;
        } catch {
            return "";
        }
    }

    /** Status rejiminin xəritə qatlarını Sahə/HOME rejimlərindən tam təcrid edir */
    function setStatusLayersVisible(visible) {
        if (!window.map || !map.isStyleLoaded?.()) return;
        const v = visible ? "visible" : "none";
        (map.getStyle()?.layers || []).forEach(l => {
            if (/^(routes|route|pmo)-/i.test(l.id)) {
                try { map.setLayoutProperty(l.id, "visibility", v); } catch {}
            }
        });
    }

    function getMaterialCategoryKey(f) {
        if (!f) return "other";
        if (f.kind === "point") {
            if (f.type === "pole") return String(f.sub || "").includes("8") ? "pole:8m" : "pole:6m";
            if (f.type === "mufta") return `mufta:${f.sub || "FO-24"}`;
            if (f.type === "quyu") return "quyu";
            if (f.type === "trans") return "trans";
            if (f.type === "ant") return "ant";
            if (f.type === "exist") return "exist";
            return "other";
        }
        return `ln:${f.type || "fo24"}`;
    }

    function renderSahaMapLayer() {
        if (!window.map) return;
        if (!ensureSahaMapLayers()) {
            map.once("idle", renderSahaMapLayer);
            return;
        }
        const isStatus = saha.workspaceMode === "status";
        setStatusLayersVisible(isStatus);

        const src = map.getSource("saha-data");
        const tgtSrc = map.getSource("saha-target");
        if (!src) return;

        // Status rejimində Sahə qatları gizlənir — hər pəncərədə öz aktiv datası qalır!
        if (isStatus || !saha.layerVisible) {
            src.setData({ type: "FeatureCollection", features: [] });
            if (tgtSrc) tgtSrc.setData({ type: "FeatureCollection", features: [] });
            return;
        }

        // Sahə rejimində seçilmiş hədəf nöqtəni və ADINI Status-dan asılı olmadan göstər!
        if (tgtSrc) {
            const pt = saha.workspaceMode === "field" && saha.selectedProjId !== "__CARI__" ? getSelectedPoint() : null;
            const c = pt && (Array.isArray(pt.coords) && pt.coords.length === 2 ? pt.coords : parseSpaceSafeCoord(pt.coords));
            if (c) {
                const tName = pt.tsNo && pt.address && pt.tsNo !== pt.address
                    ? `${pt.tsNo} · ${pt.address.slice(0, 22)}`
                    : (pt.tsNo || pt.name || pt.address || "Seçilmiş nöqtə");
                const lblImg = ensureSahaLabelImage(`📍 ${tName}`, "#fbbf24", "rgba(15, 23, 42, 0.94)", "#fef3c7");
                tgtSrc.setData({
                    type: "FeatureCollection",
                    features: [{
                        type: "Feature",
                        geometry: { type: "Point", coordinates: [c[1], c[0]] },
                        properties: { label: tName, lblImg }
                    }]
                });
            } else {
                tgtSrc.setData({ type: "FeatureCollection", features: [] });
            }
        }

        // HOME rejimində material filtr seçilibsə yalnız o materialları göstər
        const list = (saha.workspaceMode === "home" && saha.homeSubView === "materials" && saha.homeMatFilter)
            ? saha.features.filter(f => getMaterialCategoryKey(f) === saha.homeMatFilter)
            : saha.features;

        const geo = [];
        list.forEach(f => {
            if (f.kind === "point" && Array.isArray(f.coords) && f.coords.length === 2) {
                const ptMeta = POINT_TYPES[f.type] || POINT_TYPES.pole;
                const lblImg = ensureSahaLabelImage(f.label || ptMeta.label, ptMeta.color, "rgba(15, 23, 42, 0.9)", "#f8fafc");
                geo.push({
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [f.coords[1], f.coords[0]] },
                    properties: {
                        sahaId: f.id,
                        kind: "point",
                        icon: `saha-${POINT_TYPES[f.type] ? f.type : "pole"}-${f.owner === "other" ? "other" : "bcg"}`,
                        label: f.label || "",
                        lblImg
                    }
                });
            } else if (f.kind === "line" && Array.isArray(f.coords) && f.coords.length >= 2) {
                const lt = LINE_TYPES[f.type] || LINE_TYPES.fo24;
                const m = f.meters || lineMeters(f.coords);
                const lineText = `${lt.label} · ${m} m`;
                geo.push({
                    type: "Feature",
                    geometry: { type: "LineString", coordinates: f.coords.map(([la, ln]) => [ln, la]) },
                    properties: {
                        sahaId: f.id,
                        kind: "line",
                        color: lt.color,
                        dashed: Boolean(lt.dashed),
                        label: lineText
                    }
                });
                // Kabelin orta nöqtəsində lif sayı və metr etiketi!
                const midIdx = Math.floor((f.coords.length - 1) / 2);
                const cA = f.coords[midIdx];
                const cB = f.coords[Math.min(midIdx + 1, f.coords.length - 1)];
                const midCoord = [(cA[0] + cB[0]) / 2, (cA[1] + cB[1]) / 2];
                const lnLblImg = ensureSahaLabelImage(lineText, lt.color, "rgba(255, 255, 255, 0.94)", "#0f172a");
                geo.push({
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [midCoord[1], midCoord[0]] },
                    properties: {
                        sahaId: f.id,
                        kind: "line-label",
                        lblImg: lnLblImg
                    }
                });
            }
        });

        // Aktiv çəkilən xəttin qaralaması
        if (saha.draftLine.length >= 2 && saha.drawTool?.startsWith("ln:")) {
            const ltKey = saha.drawTool.slice(3);
            const lt = LINE_TYPES[ltKey] || LINE_TYPES.fo24;
            geo.push({
                type: "Feature",
                geometry: { type: "LineString", coordinates: saha.draftLine.map(([la, ln]) => [ln, la]) },
                properties: { color: lt.color, dashed: Boolean(lt.dashed), draft: true }
            });
        }

        src.setData({ type: "FeatureCollection", features: geo });
    }
    window.refreshFieldMapLayer = renderSahaMapLayer;

    /* =========================================================================
       3) XƏRİTƏ KLİKİ (SAHƏ: MAP MARKER ÇƏKMƏ · HOME: OBYEKT SEÇ VƏ REDAKTƏ ET)
       ========================================================================= */
    function handleFieldMapClick(e) {
        // 1) Sahədə nöqtənin yerini dəyişmə rejimi aktivdirsə → toxunulan yerə köçür!
        if (saha.workspaceMode === "field" && saha.fieldMovingId) {
            const mf = saha.features.find(f => f.id === saha.fieldMovingId);
            saha.fieldMovingId = "";
            if (window.map) map.getCanvas().style.cursor = "";
            if (mf && mf.kind === "point") {
                mf.coords = [Number(e.lngLat.lat.toFixed(6)), Number(e.lngLat.lng.toFixed(6))];
                saveDrawings();
                renderSahaMapLayer();
                renderFieldQuickEdit();
                showToast(`📍 "${mf.label}" yeni yerinə köçürüldü!`);
                return true;
            }
        }

        // 2) Çəkmə aləti seçili DEYİLSƏ → həm Sahə, həm HOME rejimində xəritədəki obyektə klik → Redaktə aç!
        if ((saha.workspaceMode === "home" || saha.workspaceMode === "field") && window.map && !saha.drawTool) {
            const layers = ["saha-points", "saha-point-labels", "saha-lines-solid", "saha-lines-dashed", "saha-line-labels"].filter(id => map.getLayer(id));
            if (layers.length > 0) {
                const hits = map.queryRenderedFeatures(e.point, { layers });
                if (hits && hits.length > 0) {
                    const fid = hits[0].properties?.sahaId || hits[0].properties?.id;
                    if (fid && saha.features.some(f => f.id === fid)) {
                        if (saha.collapsed) {
                            saha.collapsed = false;
                            byId("sahaDrawer")?.classList.remove("collapsed");
                        }
                        if (saha.workspaceMode === "home") {
                            saha.homeSelectedId = fid;
                            switchTab("home-edit");
                            renderHomeObjectsPanel();
                        } else {
                            saha.fieldEditId = fid;
                            switchTab("map");
                            setFieldDrawerVisible(true);
                            renderFieldQuickEdit();
                        }
                        return true;
                    }
                }
            }
            return false;
        }

        if (!saha.open || !saha.drawTool) return false;
        const lat = Number(e.lngLat.lat.toFixed(6));
        const lng = Number(e.lngLat.lng.toFixed(6));
        const isCari = saha.selectedProjId === "__CARI__";
        const proj = isCari ? null : getSelectedProject();
        const ry = isCari ? null : getSelectedRayon();
        const pt = isCari ? null : getSelectedPoint();
        const projLabel = isCari ? (`⚡ ${saha.cariName.trim() || "Cari Tapşırıq"}`) : (proj?.name || "Ümumi Sahə");
        const tsLabel = isCari ? (saha.cariPoint.trim() || "Cari nöqtə") : (pt?.tsNo || pt?.name || "");
        const engName = (byId("sahaEngineerInput")?.value || state?.user?.name || state?.user?.email?.split("@")[0] || "Mühəndis").trim();
        const wDate = byId("sahaWorkDate")?.value || todayIso();

    /** Qısa, təmiz nöqtə etiketi: 6m, 8m, Quyu, FO-24, Trans., Antena, Mövcud */
    function formatShortPointLabel(typeKey, sub) {
        const s = String(sub || "").trim();
        if (typeKey === "pole") return s.replace(/\s+/g, "") || "6m";
        if (typeKey === "mufta") return s || "Mufta";
        if (typeKey === "quyu") return "Quyu";
        if (typeKey === "trans") return "Trans.";
        if (typeKey === "ant") return s || "Antena";
        if (typeKey === "exist") return "Mövcud";
        return POINT_TYPES[typeKey]?.label || s || "Nöqtə";
    }

        if (saha.drawTool.startsWith("pt:")) {
            const typeKey = saha.drawTool.slice(3);
            const meta = POINT_TYPES[typeKey];
            if (!meta) return false;
            const sub = saha.subChoice[typeKey] || meta.defaultSub || "";
            const shortLbl = formatShortPointLabel(typeKey, sub);
            const feat = {
                id: `sf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                kind: "point",
                type: typeKey,
                sub,
                owner: saha.owner,
                coords: [lat, lng],
                projId: isCari ? "__CARI__" : (proj?.id || ""),
                projectName: projLabel,
                rayonName: ry?.name || "",
                tsNo: tsLabel,
                engineer: engName,
                workDate: wDate,
                label: shortLbl,
                createdAt: nowDisplay()
            };
            saha.features.push(feat);
            saveDrawings();
            renderSahaMapLayer();
            renderDrawingsSummary();
            showToast(`📍 ${feat.label} əlavə olundu`);
            return true;
        }

        if (saha.drawTool.startsWith("ln:")) {
            saha.draftLine.push([lat, lng]);
            renderSahaMapLayer();
            renderDraftBar();
            updateSahaMapBar();
            return true;
        }
        return false;
    }
    window.handleFieldMapClick = handleFieldMapClick;

    function finishDraftLine() {
        if (!saha.drawTool?.startsWith("ln:") || saha.draftLine.length < 2) {
            showToast("Xətt üçün ən azı 2 nöqtəyə toxunun", true);
            return;
        }
        const typeKey = saha.drawTool.slice(3);
        const lt = LINE_TYPES[typeKey] || LINE_TYPES.fo24;
        const meters = lineMeters(saha.draftLine);
        const isCari = saha.selectedProjId === "__CARI__";
        const proj = isCari ? null : getSelectedProject();
        const ry = isCari ? null : getSelectedRayon();
        const pt = isCari ? null : getSelectedPoint();
        const projLabel = isCari ? (`⚡ ${saha.cariName.trim() || "Cari Tapşırıq"}`) : (proj?.name || "Ümumi Sahə");
        const tsLabel = isCari ? (saha.cariPoint.trim() || "Cari nöqtə") : (pt?.tsNo || pt?.name || "");
        const engName = (byId("sahaEngineerInput")?.value || state?.user?.name || state?.user?.email?.split("@")[0] || "Mühəndis").trim();
        const wDate = byId("sahaWorkDate")?.value || todayIso();
        const feat = {
            id: `sf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            kind: "line",
            type: typeKey,
            owner: "bcg",
            coords: saha.draftLine.slice(),
            meters,
            projId: isCari ? "__CARI__" : (proj?.id || ""),
            projectName: projLabel,
            rayonName: ry?.name || "",
            tsNo: tsLabel,
            engineer: engName,
            workDate: wDate,
            label: `${lt.label} (${meters} m)`,
            createdAt: nowDisplay()
        };
        saha.features.push(feat);
        saha.draftLine = [];
        saveDrawings();
        renderSahaMapLayer();
        renderDraftBar();
        renderDrawingsSummary();
        showToast(`〰️ ${feat.label} yadda saxlanıldı`);
    }

    /* =========================================================================
       4) XƏRİTƏDƏN MATERİALA AVTOMATİK KÖÇÜRMƏ
       ========================================================================= */
    function transferMapDrawingsToMaterials() {
        const pt = getSelectedPoint();
        const tsKey = String(pt?.tsNo || pt?.name || "").trim();
        // Seçilmiş nöqtəyə aid (və ya ümumi yeni çəkilmiş) BCG obyektlərini topla
        const relevant = saha.features.filter(f => !tsKey || !f.tsNo || f.tsNo === tsKey);
        if (relevant.length === 0) {
            showToast("Xəritədə hələ Sahə obyekti çəkilməyib", true);
            return;
        }

        const counts = {
            pole6: 0, pole8: 0, poleTotal: 0,
            mufta12: 0, mufta24: 0, mufta48: 0,
            quyu: 0, trans: 0, ant: 0,
            fo12M: 0, fo24M: 0, fo48M: 0, foTotalM: 0, elecM: 0, qazintiM: 0
        };

        relevant.forEach(f => {
            if (f.kind === "point" && f.owner === "bcg") {
                if (f.type === "pole") {
                    counts.poleTotal++;
                    if (String(f.sub).includes("8")) counts.pole8++;
                    else counts.pole6++;
                } else if (f.type === "mufta") {
                    if (String(f.sub).includes("48")) counts.mufta48++;
                    else if (String(f.sub).includes("12")) counts.mufta12++;
                    else counts.mufta24++;
                } else if (f.type === "quyu") counts.quyu++;
                else if (f.type === "trans") counts.trans++;
                else if (f.type === "ant") counts.ant++;
            } else if (f.kind === "line") {
                const m = f.meters || lineMeters(f.coords);
                if (f.type === "fo12") { counts.fo12M += m; counts.foTotalM += m; }
                else if (f.type === "fo24") { counts.fo24M += m; counts.foTotalM += m; }
                else if (f.type === "fo48") { counts.fo48M += m; counts.foTotalM += m; }
                else if (f.type === "elec") counts.elecM += m;
                else if (f.type === "qazinti") counts.qazintiM += m;
            }
        });

        const addToBestMatch = (qty, regexList, fallbackName) => {
            if (!qty || qty <= 0) return false;
            let matched = null;
            for (const re of regexList) {
                matched = saha.materialsCatalog.find(m => !m.hasFormula && re.test(m.name));
                if (matched) break;
            }
            const targetName = matched ? matched.name : fallbackName;
            if (!matched && !saha.materialsCatalog.some(m => m.name === targetName)) {
                saha.materialsCatalog.unshift({ col: 0, name: targetName, plan: 0, done: 0, hasFormula: false });
            }
            saha.qtyMap[targetName] = Math.round(((Number(saha.qtyMap[targetName]) || 0) + qty) * 100) / 100;
            return true;
        };

        let transferred = 0;
        if (addToBestMatch(counts.pole6, [/dir[əe]k.*6/i, /h6/i, /kamera\s*dir[əe]yi(?!.*qol)/i], "Dəmir dirək 100x100 H6,5 m")) transferred++;
        if (addToBestMatch(counts.pole8, [/dir[əe]k.*8/i, /h8/i], "Dəmir dirək 100x100 H8 m")) transferred++;
        if (addToBestMatch(counts.poleTotal, [/dir[əe]yin\s*qura[şs]d/i, /dir[əe]yin\s*montaj/i], "Dəmir dirəyin quraşdırılması (Rabitə dirəyi)")) transferred++;
        if (addToBestMatch(counts.mufta12, [/fo[\s\-]*12.*mufta/i, /mufta.*12/i], "FO12 muftanın vurulması")) transferred++;
        if (addToBestMatch(counts.mufta24, [/fo[\s\-]*24.*mufta/i, /mufta.*24/i], "FO24 muftanın vurulması")) transferred++;
        if (addToBestMatch(counts.mufta48, [/fo[\s\-]*48.*mufta/i, /mufta.*48/i], "FO48 muftanın vurulması")) transferred++;
        if (addToBestMatch(counts.quyu, [/krq.*quyu/i, /polietilen\s*quyu/i], "KRQ-1 F400 polietilen quyu")) transferred++;
        if (addToBestMatch(counts.fo12M, [/fo[\s\-]*12.*kabel/i, /fo[\s\-]*kabel.*[çc][əe]kil/i], "FO 12 kabelin çəkilməsi")) transferred++;
        if (addToBestMatch(counts.fo24M, [/fo[\s\-]*24.*kabel/i, /fo[\s\-]*kabel.*[çc][əe]kil/i], "FO 24 kabelin çəkilməsi")) transferred++;
        if (addToBestMatch(counts.fo48M, [/fo[\s\-]*48.*kabel/i, /fo[\s\-]*kabel.*[çc][əe]kil/i], "FO 48 kabelin çəkilməsi")) transferred++;
        if (addToBestMatch(counts.elecM, [/elektrik.*kabel/i, /kabel.*2x/i], "Elektrik kabeli 2x2.5")) transferred++;
        if (addToBestMatch(counts.qazintiM, [/qaz[ıi]nt[ıi]|x[əe]nd[əe]k/i, /polietilen\s*boru.*qura[şs]/i], "Qazıntı (xəndək) işi (m)")) transferred++;

        if (counts.poleTotal > 0) saha.stages.DIREK = true;
        if (counts.foTotalM > 0 || counts.mufta12 + counts.mufta24 + counts.mufta48 > 0) saha.stages.OPTIK = true;
        if (counts.elecM > 0) saha.stages.ELEKTRIK = true;

        switchTab("work");
        renderStageButtons();
        renderMaterialsList();
        showToast(`⚡ Xəritədən ${transferred} material/iş qeydi avtomatik köçürüldü!`);
    }

    /* =========================================================================
       5) KMZ / KML IMPORT VƏ GOOGLE EARTH PRO EXPORT (BOŞ/DOLU İKONLARLA)
       ========================================================================= */
    async function exportSahaKmz() {
        if (saha.features.length === 0) {
            showToast("İxrac etmək üçün Sahə xəritəsində obyekt yoxdur", true);
            return;
        }
        const ensureZip = window.__pmoEnsureJSZip || (typeof ensureJSZip === "function" ? ensureJSZip : null);
        const JSZipLib = ensureZip ? await ensureZip().catch(() => null) : window.JSZip;
        const xmlEsc = s => String(s ?? "").replace(/[<>&'"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));

        const stylesXml = [];
        Object.keys(POINT_TYPES).forEach(tk => {
            ["bcg", "other"].forEach(ow => {
                stylesXml.push(`
    <Style id="saha_${tk}_${ow}">
      <IconStyle><scale>1.1</scale><Icon><href>icons/saha-${tk}-${ow}.png</href></Icon></IconStyle>
      <LabelStyle><scale>0.85</scale></LabelStyle>
    </Style>`);
            });
        });
        Object.entries(LINE_TYPES).forEach(([lk, lt]) => {
            stylesXml.push(`
    <Style id="saha_ln_${lk}">
      <LineStyle><color>${lt.kmlColor}</color><width>4</width></LineStyle>
    </Style>`);
        });

        const placemarks = saha.features.map(f => {
            if (f.kind === "point" && Array.isArray(f.coords)) {
                return `
    <Placemark>
      <name>${xmlEsc(f.label)}</name>
      <description>${xmlEsc(`Sahib: ${f.owner === "bcg" ? "BCG" : "Başqa qurum"} | TŞ: ${f.tsNo || "-"} | ${f.createdAt || ""}`)}</description>
      <styleUrl>#saha_${f.type}_${f.owner}</styleUrl>
      <Point><coordinates>${f.coords[1]},${f.coords[0]},0</coordinates></Point>
    </Placemark>`;
            }
            if (f.kind === "line" && Array.isArray(f.coords) && f.coords.length >= 2) {
                const coordStr = f.coords.map(([la, ln]) => `${ln},${la},0`).join(" ");
                return `
    <Placemark>
      <name>${xmlEsc(f.label)}</name>
      <description>${xmlEsc(`Uzunluq: ${f.meters || lineMeters(f.coords)} m | TŞ: ${f.tsNo || "-"}`)}</description>
      <styleUrl>#saha_ln_${f.type}</styleUrl>
      <LineString><tessellate>1</tessellate><coordinates>${coordStr}</coordinates></LineString>
    </Placemark>`;
            }
            return "";
        }).join("");

        const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>BCG Sahə İcra Xəritəsi (${todayIso()})</name>
    ${stylesXml.join("")}
    ${placemarks}
  </Document>
</kml>`;

        const dateTag = todayIso();
        if (JSZipLib) {
            const zip = new JSZipLib();
            zip.file("doc.kml", kml);
            const iconsFolder = zip.folder("icons");
            for (const tk of Object.keys(POINT_TYPES)) {
                for (const ow of ["bcg", "other"]) {
                    const canvas = drawSahaIconCanvas(tk, ow);
                    const b64 = canvas.toDataURL("image/png").split(",")[1];
                    iconsFolder.file(`saha-${tk}-${ow}.png`, b64, { base64: true });
                }
            }
            const blob = await zip.generateAsync({ type: "blob" });
            downloadBlob(blob, `BCG_Saha_${dateTag}.kmz`);
            showToast(`✅ Yekun KMZ yükləndi (${saha.features.length} obyekt — Google Earth Pro üçün hazır)`);
        } else {
            downloadBlob(new Blob([kml], { type: "application/vnd.google-earth.kml+xml" }), `BCG_Saha_${dateTag}.kml`);
            showToast(`✅ KML yükləndi (${saha.features.length} obyekt)`);
        }
    }

    async function importSahaKmzFile(file) {
        if (!file) return;
        let kmlText = "";
        if (/\.kmz$/i.test(file.name)) {
            const ensureZip = window.__pmoEnsureJSZip || (typeof ensureJSZip === "function" ? ensureJSZip : null);
            const JSZipLib = ensureZip ? await ensureZip().catch(() => null) : window.JSZip;
            if (!JSZipLib) { showToast("JSZip kitabxanası yüklənmədi", true); return; }
            const zip = await JSZipLib.loadAsync(file);
            const kmlEntry = Object.values(zip.files).find(f => /\.kml$/i.test(f.name) && !f.dir);
            if (!kmlEntry) { showToast("KMZ daxilində KML tapılmadı", true); return; }
            kmlText = await kmlEntry.async("string");
        } else {
            kmlText = await file.text();
        }

        const doc = new DOMParser().parseFromString(kmlText, "text/xml");
        const pms = Array.from(doc.querySelectorAll("Placemark"));
        let added = 0;
        const allCoords = [];
        pms.forEach(pm => {
            const name = String(pm.querySelector("name")?.textContent || "").trim();
            const ptEl = pm.querySelector("Point coordinates");
            const lnEl = pm.querySelector("LineString coordinates");
            if (ptEl) {
                const parts = ptEl.textContent.trim().split(/[\s,]+/).map(Number);
                if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
                    const coord = [Number(parts[1].toFixed(6)), Number(parts[0].toFixed(6))];
                    const lower = name.toLowerCase();
                    const type = /mufta/i.test(lower) ? "mufta" : (/quyu/i.test(lower) ? "quyu" : (/trans|ktp/i.test(lower) ? "trans" : (/ant|ptz|radar/i.test(lower) ? "ant" : "pole")));
                    const owner = /ba[şs]qa|dig[əe]r|other/i.test(lower) ? "other" : "bcg";
                    saha.features.push({
                        id: `sf_imp_${Date.now()}_${added}`,
                        kind: "point",
                        type,
                        sub: POINT_TYPES[type].defaultSub,
                        owner,
                        coords: coord,
                        label: name || POINT_TYPES[type].label,
                        createdAt: nowDisplay()
                    });
                    allCoords.push(coord);
                    added++;
                }
            } else if (lnEl) {
                const coords = lnEl.textContent.trim().split(/\s+/).map(tok => {
                    const p = tok.split(",").map(Number);
                    return (p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) ? [Number(p[1].toFixed(6)), Number(p[0].toFixed(6))] : null;
                }).filter(Boolean);
                if (coords.length >= 2) {
                    const lower = name.toLowerCase();
                    const type = /qaz[ıi]nt|x[əe]nd[əe]k/i.test(lower) ? "qazinti" : (/48/.test(lower) ? "fo48" : (/12/.test(lower) ? "fo12" : "fo24"));
                    const m = lineMeters(coords);
                    saha.features.push({
                        id: `sf_imp_${Date.now()}_${added}`,
                        kind: "line",
                        type,
                        owner: "bcg",
                        coords,
                        meters: m,
                        label: name || `${LINE_TYPES[type].label} (${m} m)`,
                        createdAt: nowDisplay()
                    });
                    allCoords.push(...coords);
                    added++;
                }
            }
        });

        if (added > 0) {
            saveDrawings();
            renderSahaMapLayer();
            renderDrawingsSummary();
            if (typeof flyToCoords === "function" && allCoords.length > 0) flyToCoords(allCoords);
            showToast(`📥 ${added} planlı obyekt Sahə xəritəsinə yükləndi!`);
        } else {
            showToast("Faylda uyğun nöqtə və ya xətt tapılmadı", true);
        }
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    /* =========================================================================
       6) GPS ƏN YAXIN NÖQTƏ + KUMULYATİV GÖNDƏRİŞ + JURNAL / UNDO / CSV
       ========================================================================= */
    function findNearestPointByGps() {
        if (!navigator.geolocation) {
            showToast("Bu cihazda GPS dəstəklənmir", true);
            return;
        }
        const btn = byId("sahaGpsBtn");
        const oldHtml = btn ? btn.innerHTML : "";
        if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> GPS axtarılır...`; }

        navigator.geolocation.getCurrentPosition(pos => {
            if (btn) { btn.disabled = false; btn.innerHTML = oldHtml; }
            const myCoord = [Number(pos.coords.latitude.toFixed(6)), Number(pos.coords.longitude.toFixed(6))];
            saha.lastGps = `${myCoord[0]}, ${myCoord[1]}`;
            if (byId("sahaGpsLabel")) byId("sahaGpsLabel").textContent = `📍 GPS: ${saha.lastGps}`;

            let best = null;
            getPmoProjectsList().forEach(proj => {
                getRayonsForProject(proj).forEach(ry => {
                    getPointsForRayon(ry).forEach(pt => {
                        const c = Array.isArray(pt.coords) && pt.coords.length === 2
                            ? pt.coords
                            : parseSpaceSafeCoord(pt.coords);
                        if (!c) return;
                        const d = haversineMeters(myCoord, c);
                        if (!best || d < best.dist) {
                            best = { proj, ry, pt, coord: c, dist: d };
                        }
                    });
                });
            });

            if (!best) {
                showToast("Koordinatlı layihə nöqtəsi tapılmadı", true);
                return;
            }
            saha.selectedProjId = best.proj.id;
            saha.selectedRayonId = best.ry.id;
            saha.selectedPointId = best.pt.id;
            populateCascadingSelects();
            loadMaterialsForCurrentSelection();
            if (typeof flyToCoords === "function") flyToCoords([best.coord]);
            const distTxt = best.dist >= 1000 ? `${(best.dist / 1000).toFixed(2)} km` : `${Math.round(best.dist)} m`;
            showToast(`📍 Ən yaxın nöqtə: ${best.pt.tsNo || best.pt.name} (${distTxt})`);
        }, err => {
            if (btn) { btn.disabled = false; btn.innerHTML = oldHtml; }
            showToast(`GPS icazəsi alınmadı (${err.message})`, true);
        }, { enableHighAccuracy: true, timeout: 12000 });
    }

    const SAHA_PACKETS_KEY = "bcg.saha.packets.v1";

    function savePacketsLocal() {
        try { localStorage.setItem(SAHA_PACKETS_KEY, JSON.stringify(saha.packets.slice(-200))); } catch {}
    }

    function updatePendingBadges() {
        const pending = saha.packets.filter(p => p.status === "pending").length;
        const cntEl = byId("homePendingCnt");
        if (cntEl) cntEl.textContent = pending ? ` (${pending})` : "";
        const railHome = document.querySelector('#modeRail [data-workspace-mode="home"]');
        if (railHome) {
            let b = railHome.querySelector(".mode-rail-badge");
            if (pending > 0) {
                if (!b) {
                    b = document.createElement("span");
                    b.className = "mode-rail-badge";
                    railHome.appendChild(b);
                }
                b.textContent = String(pending);
            } else if (b) {
                b.remove();
            }
        }
    }

    async function syncFromSahaCloud(isLiveTrigger = false) {
        if (typeof api === "undefined" || typeof api.loadSahaCloudState !== "function") return;
        try {
            const remote = await api.loadSahaCloudState();
            if (!remote) return;
            const remPackets = Array.isArray(remote.packets) ? remote.packets : [];
            const prevIds = new Set(saha.packets.map(p => p.id));
            const mergedMap = new Map();
            saha.packets.forEach(p => { if (p?.id) mergedMap.set(p.id, p); });
            const newlyArrived = [];
            remPackets.forEach(p => {
                if (!p?.id) return;
                const old = mergedMap.get(p.id);
                if (!old || (p.updatedAt || "") >= (old.updatedAt || "")) {
                    mergedMap.set(p.id, p);
                }
                if (!prevIds.has(p.id) && p.status === "pending" && !saha.seenPacketIds.has(p.id)) {
                    newlyArrived.push(p);
                }
                saha.seenPacketIds.add(p.id);
            });
            saha.packets = Array.from(mergedMap.values()).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
            savePacketsLocal();

            // Təsdiqlənmiş obyektləri HOME bazasına birləşdir
            if (Array.isArray(remote.approvedFeatures) && remote.approvedFeatures.length > 0) {
                const fMap = new Map();
                saha.features.forEach(f => { if (f?.id) fMap.set(f.id, f); });
                remote.approvedFeatures.forEach(f => { if (f?.id && !fMap.has(f.id)) fMap.set(f.id, f); });
                saha.features = Array.from(fMap.values());
                saveDrawings();
            }

            updatePendingBadges();
            if (saha.workspaceMode === "home") {
                renderHomeObjectsPanel();
                renderHomePdfPanel();
                renderSahaMapLayer();
            }
            if (isLiveTrigger && newlyArrived.length > 0) {
                const latest = newlyArrived[0];
                showToast(`🔔 Yeni sahə işi: ${latest.engineer} — ${latest.projectName} (${latest.tsNo || "Nöqtə"}) göndərdi! HOME → Təsdiq bölməsində baxın.`);
            }
        } catch {}
    }

    function compressPhotoFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => {
                    const maxSide = 820;
                    let w = img.width, h = img.height;
                    if (w > maxSide || h > maxSide) {
                        if (w > h) { h = Math.round(h * maxSide / w); w = maxSide; }
                        else { w = Math.round(w * maxSide / h); h = maxSide; }
                    }
                    const c = document.createElement("canvas");
                    c.width = w; c.height = h;
                    c.getContext("2d").drawImage(img, 0, 0, w, h);
                    resolve(c.toDataURL("image/jpeg", 0.72));
                };
                img.onerror = reject;
                img.src = reader.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function renderPhotoStrip() {
        const box = byId("sahaPhotoStrip");
        if (!box) return;
        if (!saha.photos.length) {
            box.innerHTML = `<span style="font-size:11px;color:var(--ink-3)">Şəkil əlavə edilməyib</span>`;
            return;
        }
        box.innerHTML = saha.photos.map((src, i) => `
            <div class="saha-photo-thumb">
                <img src="${src}" alt="Foto ${i + 1}" data-zoom-photo="${i}">
                <button type="button" data-del-photo="${i}" title="Sil">×</button>
            </div>`).join("");
    }

    async function submitFieldWork() {
        const isCari = saha.selectedProjId === "__CARI__";
        const proj = isCari ? null : getSelectedProject();
        const ry = isCari ? null : getSelectedRayon();
        const pt = isCari ? null : getSelectedPoint();

        if (!isCari && (!proj || !ry || !pt)) {
            showToast("Əvvəlcə Layihə → Rayon → Nöqtə (və ya Cari Tapşırıq) seçin", true);
            return;
        }
        const cariTitle = (byId("sahaCariName")?.value || saha.cariName || "").trim();
        const cariPt = (byId("sahaCariPoint")?.value || saha.cariPoint || "").trim();
        if (isCari && !cariTitle) {
            showToast("Cari tapşırığın adını yazın", true);
            byId("sahaCariName")?.focus();
            return;
        }

        const selectedMats = Object.entries(saha.qtyMap)
            .map(([name, qty]) => {
                const cat = saha.materialsCatalog.find(m => m.name === name);
                return { name, col: cat?.col || 0, qty: Number(qty) || 0, oldVal: cat?.done || 0 };
            })
            .filter(x => x.qty > 0);
        const anyStage = Object.values(saha.stages).some(Boolean);
        const tsNo = isCari ? (cariPt || "Cari nöqtə") : (pt.tsNo || pt.name || ry.name);
        const projectName = isCari ? `⚡ ${cariTitle}` : proj.name;
        const drawnForPacket = saha.features.filter(f => !f.approved && (!f.tsNo || f.tsNo === tsNo || isCari));

        if (selectedMats.length === 0 && !anyStage && drawnForPacket.length === 0 && saha.photos.length === 0) {
            showToast("Ən azı 1 material, mərhələ, xəritə obyekti və ya şəkil əlavə edin", true);
            return;
        }

        const workDate = byId("sahaWorkDate")?.value || todayIso();
        const engineer = (byId("sahaEngineerInput")?.value || state?.user?.name || state?.user?.email || "Mühəndis").trim();
        const note = (byId("sahaNoteInput")?.value || "").trim();
        const planRow = isCari ? 0 : extractPlanRowFromPointId(pt);
        const packetId = `PKT-${Date.now().toString(36).toUpperCase()}`;

        const btn = byId("sahaSubmitBtn");
        if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Bazaya göndərilir...`; }

        try {
            const stampedFeats = drawnForPacket.map(f => ({
                ...f,
                projectName: f.projectName || projectName,
                rayonName: f.rayonName || ry?.name || "",
                tsNo: f.tsNo || tsNo,
                engineer: f.engineer || engineer,
                workDate: f.workDate || workDate,
                photos: saha.photos.slice(0, 3)
            }));

            const packet = {
                id: packetId,
                status: "pending", // pending -> approved / rejected
                isCari,
                sheetId: isCari ? "" : String(proj.sheetId || proj.pmoMeta?.sheetId || ""),
                projectName,
                rayonName: ry?.name || "",
                tsNo,
                planRow,
                workDate,
                engineer,
                note,
                gps: saha.lastGps || (Array.isArray(pt?.coords) ? `${pt.coords[0]}, ${pt.coords[1]}` : ""),
                stages: { ...saha.stages },
                materials: selectedMats,
                features: stampedFeats,
                photos: saha.photos.slice(0, 4),
                createdAt: nowDisplay(),
                updatedAt: new Date().toISOString()
            };

            saha.packets.unshift(packet);
            saha.seenPacketIds.add(packetId);
            savePacketsLocal();

            // Buluda (Supabase) dərhal yüklə ki ofisdə canlı bildiriş çıxsın!
            let cloudOk = false;
            if (typeof api !== "undefined" && typeof api.saveSahaCloudState === "function") {
                const res = await api.saveSahaCloudState({ packets: saha.packets, approvedFeatures: [] });
                cloudOk = Boolean(res);
            }

            // Formu təmizlə
            saha.qtyMap = {};
            saha.photos = [];
            if (byId("sahaNoteInput")) byId("sahaNoteInput").value = "";
            renderMaterialsList();
            renderPhotoStrip();
            updatePendingBadges();

            showToast(cloudOk
                ? `☁️ Bazaya göndərildi! Ofisə bildiriş getdi — təsdiqdən sonra Excel və Statusa düşəcək.`
                : `✅ Lokal bazaya qeyd olundu (Təsdiq gözləyir).`);
        } catch (err) {
            showToast(`❌ Göndəriş xətası: ${err.message}`, true);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Bazaya Göndər (Təsdiqə)`;
            }
        }
    }

    async function approvePendingPacket(packetId) {
        const pkt = saha.packets.find(p => p.id === packetId);
        if (!pkt || pkt.status === "approved") return;

        let excelSynced = false;
        let skipMsg = "";
        // 1) PMO Excel (Google Sheets) bağlantısı varsa və adi layihədirsə → kumulyativ yaz!
        if (!pkt.isCari && saha.config.webAppUrl && pkt.sheetId && (pkt.materials?.length > 0 || Object.values(pkt.stages || {}).some(Boolean))) {
            try {
                const payload = {
                    action: "submit",
                    token: saha.config.token || "",
                    submissionId: pkt.id,
                    sheetId: pkt.sheetId,
                    projectName: pkt.projectName,
                    planRow: pkt.planRow || 0,
                    tsNo: pkt.tsNo,
                    workDate: pkt.workDate,
                    engineer: pkt.engineer,
                    note: pkt.note,
                    gps: pkt.gps || "",
                    materials: (pkt.materials || []).map(m => ({ name: m.name, col: m.col || 0, qty: m.qty })),
                    stages: pkt.stages || {}
                };
                const res = await fetch(saha.config.webAppUrl, {
                    method: "POST",
                    headers: { "Content-Type": "text/plain;charset=utf-8" },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (!data || !data.ok) throw new Error(data?.error || "Apps Script xətası");
                excelSynced = true;
                if (data.skippedFormulas?.length) skipMsg = ` (${data.skippedFormulas.length} düstur qorundu)`;
            } catch (err) {
                showToast(`⚠️ Excel yazılışı alınmadı (${err.message}), amma HOME bazasına təsdiqlənir`, true);
            }
        }

        // 2) Təsdiqlənmiş obyektləri tam atributlarla HOME bazasına sal
        const approvedFeats = (pkt.features || []).map(f => ({
            ...f,
            approved: true,
            projectName: f.projectName || pkt.projectName,
            rayonName: f.rayonName || pkt.rayonName || "",
            tsNo: f.tsNo || pkt.tsNo,
            engineer: f.engineer || pkt.engineer,
            workDate: f.workDate || pkt.workDate,
            photos: f.photos?.length ? f.photos : (pkt.photos || [])
        }));
        approvedFeats.forEach(af => {
            const idx = saha.features.findIndex(x => x.id === af.id);
            if (idx >= 0) saha.features[idx] = af;
            else saha.features.push(af);
        });
        saveDrawings();

        // 3) Jurnala yaz
        const jItems = [
            ...(pkt.materials || []).map(m => ({ name: m.name, addQty: m.qty, oldVal: m.oldVal || 0, newVal: (m.oldVal || 0) + m.qty })),
            ...Object.entries(pkt.stages || {}).filter(([, on]) => on).map(([k]) => ({ name: `Mərhələ: ${k}`, addQty: 1, oldVal: 0, newVal: 1 }))
        ];
        jItems.forEach(w => {
            saha.journal.unshift({
                submissionId: pkt.id,
                timestamp: nowDisplay(),
                workDate: pkt.workDate,
                engineer: pkt.engineer,
                projectName: pkt.projectName,
                tsNo: pkt.tsNo,
                material: w.name,
                addQty: w.addQty,
                oldVal: w.oldVal,
                newVal: w.newVal,
                note: pkt.note,
                gps: pkt.gps || "",
                undone: "",
                synced: excelSynced
            });
        });
        saveJournal();

        // 4) Paketi təsdiqlə və Supabase-ə yaz
        pkt.status = "approved";
        pkt.approvedAt = nowDisplay();
        pkt.approvedBy = state?.user?.name || state?.user?.email || "Ofis";
        pkt.updatedAt = new Date().toISOString();
        savePacketsLocal();
        if (typeof api !== "undefined" && typeof api.saveSahaCloudState === "function") {
            api.saveSahaCloudState({ packets: saha.packets, approvedFeatures: approvedFeats }).catch(() => {});
        }

        updatePendingBadges();
        renderHomeObjectsPanel();
        renderHomePdfPanel();
        renderOfficePanel();
        renderSahaMapLayer();

        showToast(excelSynced
            ? `✅ Təsdiqləndi! PMO Excel-ə yazıldı${skipMsg} və Status yenilənir.`
            : `✅ Təsdiqləndi və HOME bazasına əlavə olundu!`);

        if (excelSynced && typeof window.__triggerPmoQuickSync === "function") {
            setTimeout(() => window.__triggerPmoQuickSync(), 900);
        }
    }

    async function rejectPendingPacket(packetId) {
        const pkt = saha.packets.find(p => p.id === packetId);
        if (!pkt) return;
        const reason = prompt("Rədd etmə səbəbi (istəyə bağlı):", "") ?? "";
        pkt.status = "rejected";
        pkt.rejectReason = reason.trim();
        pkt.updatedAt = new Date().toISOString();
        savePacketsLocal();
        if (typeof api !== "undefined" && typeof api.saveSahaCloudState === "function") {
            api.saveSahaCloudState({ packets: saha.packets, approvedFeatures: [] }).catch(() => {});
        }
        updatePendingBadges();
        renderHomeObjectsPanel();
        showToast("❌ Göndəriş rədd edildi");
    }

    async function fetchRemoteJournal() {
        if (!saha.config.webAppUrl) return;
        try {
            const q = new URLSearchParams({ action: "journal", token: saha.config.token || "", limit: "300" });
            const res = await fetch(`${saha.config.webAppUrl}?${q.toString()}`, { cache: "no-store" });
            const data = await res.json();
            if (data && data.ok && Array.isArray(data.rows)) {
                saha.journal = data.rows.map(r => ({ ...r, synced: true }));
                saveJournal();
                renderOfficePanel();
            }
        } catch (err) {
            console.warn("Sahə jurnal oxunma xətası:", err);
        }
    }

    async function undoSubmission(submissionId) {
        if (!isAdminUser()) {
            showToast("🔒 Geri al (Undo) yalnız Ofis/Admin üçündür", true);
            return;
        }
        if (!confirm(`"${submissionId}" göndərişini geri almaq istəyirsiniz? Rəqəmlər cədvəldən avtomatik çıxılacaq.`)) return;

        const adminName = state?.user?.name || state?.user?.email || "Admin";
        if (saha.config.webAppUrl) {
            try {
                const res = await fetch(saha.config.webAppUrl, {
                    method: "POST",
                    headers: { "Content-Type": "text/plain;charset=utf-8" },
                    body: JSON.stringify({ action: "undo", token: saha.config.token || "", submissionId, admin: adminName })
                });
                const data = await res.json();
                if (!data || !data.ok) throw new Error(data?.error || "Undo alınmadı");
                showToast(`↩️ Geri alındı (${data.reverted} xana düzəldildi)`);
                await fetchRemoteJournal();
                if (typeof window.__triggerPmoQuickSync === "function") setTimeout(() => window.__triggerPmoQuickSync(), 700);
                return;
            } catch (err) {
                showToast(`❌ Undo xətası: ${err.message}`, true);
                return;
            }
        }

        // Lokal rejimdə undo
        const stamp = `Geri alındı (${adminName} · ${nowDisplay()})`;
        saha.journal.forEach(j => { if (j.submissionId === submissionId && !j.undone) j.undone = stamp; });
        saveJournal();
        renderOfficePanel();
        showToast("↩️ Göndəriş lokal jurnalda geri alındı");
    }

    function exportJournalCsv() {
        const rows = getFilteredJournalRows();
        if (rows.length === 0) { showToast("İxrac etmək üçün jurnal qeydi yoxdur", true); return; }
        const header = ["Göndəriş ID", "Vaxt", "İş tarixi", "Mühəndis", "Layihə", "TŞ nömrə", "Material/İş", "Əlavə miqdar", "Köhnə dəyər", "Yeni dəyər", "Qeyd", "GPS", "Geri alınma"];
        const lines = [header, ...rows.map(r => [
            r.submissionId, r.timestamp, r.workDate, r.engineer, r.projectName, r.tsNo,
            r.material, r.addQty, r.oldVal, r.newVal, r.note, r.gps, r.undone
        ])];
        const csv = "\uFEFF" + lines.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
        downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `BCG_Saha_Jurnal_${todayIso()}.csv`);
        showToast(`📥 ${rows.length} qeyd CSV/Excel kimi yükləndi`);
    }

    /* =========================================================================
       7) UI QURULUŞU VƏ RENDER
       ========================================================================= */
    function buildDrawerDom() {
        if (byId("sahaDrawer")) return;
        const el = document.createElement("aside");
        el.id = "sahaDrawer";
        el.className = "saha-drawer";
        el.hidden = true;
        el.innerHTML = `
            <div class="saha-head">
                <div class="saha-head-title">
                    <i class="fa-solid fa-helmet-safety" id="sahaHeadIcon" style="color:#fbbf24;font-size:15px"></i>
                    <strong id="sahaHeadTitle">Sahə · Map Marker</strong>
                    <span class="saha-conn-pill" id="sahaConnPill">Lokal rejim</span>
                </div>
                <div style="display:flex;align-items:center;gap:4px">
                    <button type="button" class="icon-btn small" id="sahaCollapseBtn" title="Paneli yığ / aç"><i class="fa-solid fa-chevron-left"></i></button>
                    <button type="button" class="icon-btn small" id="sahaLayerToggleBtn" title="Sahə xəritə qatını göstər/gizlət"><i class="fa-solid fa-eye"></i></button>
                    <button type="button" class="icon-btn small" id="sahaCloseBtn" title="Status rejiminə qayıt"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>
            <div class="saha-tabs" id="sahaTabs">
                <!-- Sahə (Mühəndis) tabları -->
                <button type="button" class="saha-tab active" data-saha-tab="map" data-mode-only="field"><i class="fa-solid fa-map-pin"></i> Xəritə</button>
                <button type="button" class="saha-tab" data-saha-tab="work" data-mode-only="field"><i class="fa-solid fa-clipboard-check"></i> İş Qeydi</button>
                <!-- HOME (Google Earth / AutoCAD Ofis) tabları -->
                <button type="button" class="saha-tab" data-saha-tab="home-edit" data-mode-only="home"><i class="fa-solid fa-pen-to-square"></i> Obyektlər</button>
                <button type="button" class="saha-tab" data-saha-tab="home-pdf" data-mode-only="home"><i class="fa-solid fa-file-pdf"></i> PDF Eskiz</button>
                <button type="button" class="saha-tab" data-saha-tab="office" data-mode-only="home"><i class="fa-solid fa-chart-column"></i> Jurnal</button>
            </div>
            <div class="saha-body">
                <!-- TAB 1: İŞ QEYDİ (MÜHƏNDİS) -->
                <div class="saha-pane" data-saha-pane="work">
                    <div class="saha-card">
                        <div class="saha-card-title">
                            <span>1. Nöqtə seçimi</span>
                            <span id="sahaGpsLabel" style="font-size:10px;color:#38bdf8;text-transform:none"></span>
                        </div>
                        <button type="button" class="saha-gps-btn" id="sahaGpsBtn">
                            <i class="fa-solid fa-location-crosshairs"></i> Ən yaxın nöqtə (GPS)
                        </button>
                        <label class="saha-field">
                            <span>Layihə və ya Cari Tapşırıq</span>
                            <select class="input" id="sahaProjSel"></select>
                        </label>
                        <div id="sahaCariBox" hidden style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                            <label class="saha-field">
                                <span>Tapşırıq / İşin adı *</span>
                                <input type="text" class="input" id="sahaCariName" placeholder="Məs: Nərimanov qəza bərpa">
                            </label>
                            <label class="saha-field">
                                <span>Nöqtə / Ünvan</span>
                                <input type="text" class="input" id="sahaCariPoint" placeholder="Məs: Küçə / TŞ">
                            </label>
                        </div>
                        <div id="sahaRayonPointRow" style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                            <label class="saha-field">
                                <span>Rayon</span>
                                <select class="input" id="sahaRayonSel"></select>
                            </label>
                            <label class="saha-field">
                                <span>Nöqtə (TŞ / Ünvan)</span>
                                <select class="input" id="sahaPointSel"></select>
                            </label>
                        </div>
                    </div>

                    <div class="saha-card">
                        <div class="saha-card-title"><span>2. Tamamlanan mərhələlər (1 kimi yazılır)</span></div>
                        <div class="saha-stages" id="sahaStagesBox">
                            <button type="button" class="saha-stage-btn" data-stage="BUNOVRE"><i class="fa-solid fa-cubes"></i> BÜNÖVRƏ</button>
                            <button type="button" class="saha-stage-btn" data-stage="DIREK"><i class="fa-solid fa-tower-broadcast"></i> DİRƏK</button>
                            <button type="button" class="saha-stage-btn" data-stage="OPTIK"><i class="fa-solid fa-network-wired"></i> OPTİK</button>
                            <button type="button" class="saha-stage-btn" data-stage="ELEKTRIK"><i class="fa-solid fa-bolt"></i> ELEKTRİK</button>
                        </div>
                    </div>

                    <div class="saha-card">
                        <div class="saha-card-title">
                            <span>3. Gündəlik Material / İş (Kumulyativ +)</span>
                            <span id="sahaSelectedMatCount" style="color:#fbbf24">0 seçilib</span>
                        </div>
                        <button type="button" class="saha-transfer-btn" id="sahaTransferBtn1">
                            <i class="fa-solid fa-wand-magic-sparkles"></i> Xəritədən materiala avtomatik köçür
                        </button>
                        <input type="search" class="input" id="sahaMatSearch" placeholder="🔍 Material və ya iş axtar (dirək, kabel, mufta...)">
                        <div class="saha-mat-list" id="sahaMatList"></div>
                    </div>

                    <div class="saha-card">
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                            <label class="saha-field">
                                <span>İş tarixi</span>
                                <input type="date" class="input" id="sahaWorkDate">
                            </label>
                            <label class="saha-field">
                                <span>Mühəndis</span>
                                <input type="text" class="input" id="sahaEngineerInput" placeholder="Ad Soyad">
                            </label>
                        </div>
                        <label class="saha-field">
                            <span>Qeyd (ərazi haqqında)</span>
                            <input type="text" class="input" id="sahaNoteInput" placeholder="Məs: 3 dirək basdırıldı, 240m FO24 çəkildi">
                        </label>
                        <div class="saha-photo-bar">
                            <button type="button" class="btn btn-outline" id="sahaPhotoBtn" style="height:36px;font-size:12px;width:100%;border-color:rgba(56,189,248,0.5);color:#38bdf8">
                                <i class="fa-solid fa-camera"></i> Şəkil çək / Əlavə et (Nöqtə fotosu)
                            </button>
                            <input type="file" id="sahaPhotoInput" accept="image/*" capture="environment" multiple hidden>
                            <div class="saha-photo-strip" id="sahaPhotoStrip"></div>
                        </div>
                        <button type="button" class="saha-submit-btn" id="sahaSubmitBtn">
                            <i class="fa-solid fa-cloud-arrow-up"></i> Bazaya Göndər (Təsdiqə)
                        </button>
                    </div>
                </div>

                <!-- TAB 2: XƏRİTƏ ÇƏKMƏ (MAP MARKER) -->
                <div class="saha-pane" data-saha-pane="map" hidden>
                    <div class="saha-card">
                        <div class="saha-card-title"><span>Mülkiyyət qaydası</span></div>
                        <div class="saha-owner-toggle" id="sahaOwnerToggle">
                            <button type="button" class="saha-owner-btn active" data-owner="bcg"><span>□</span> BCG (İçi boş)</button>
                            <button type="button" class="saha-owner-btn" data-owner="other"><span>■</span> Başqa qurum (Dolu)</button>
                        </div>
                    </div>

                    <div class="saha-card">
                        <div class="saha-card-title"><span>Şərti işarələr — Nöqtə qoy</span></div>
                        <div class="saha-tool-grid" id="sahaPointTools"></div>
                        <div class="saha-sub-opts" id="sahaSubOpts" hidden></div>
                    </div>

                    <div class="saha-card">
                        <div class="saha-card-title"><span>Xətt çək (ardıcıl toxun → avtomatik metr)</span></div>
                        <div class="saha-tool-grid" id="sahaLineTools"></div>
                        <div class="saha-draft-bar" id="sahaDraftBar" hidden></div>
                    </div>

                    <div class="saha-card" id="sahaQuickEditCard" hidden>
                        <div class="saha-card-title">
                            <span>✏️ Seçilmiş Obyekti Redaktə Et</span>
                            <button type="button" class="link" id="sahaQuickEditClose" style="font-size:11px">Bağla</button>
                        </div>
                        <div class="home-edit-box" id="sahaQuickEditForm"></div>
                    </div>

                    <div class="saha-card">
                        <div class="saha-card-title">
                            <span>Çəkilmiş obyektlər (redaktə üçün xəritədə klikləyin)</span>
                            <span id="sahaDrawCount">0 obyekt</span>
                        </div>
                        <div id="sahaDrawStats" style="font-size:11.5px;color:var(--ink-2);line-height:1.45"></div>
                        <button type="button" class="saha-transfer-btn" id="sahaTransferBtn2">
                            <i class="fa-solid fa-arrow-right-arrow-left"></i> Xəritədən materiala köçür
                        </button>
                        <div class="saha-btn-row">
                            <button type="button" class="btn btn-outline" id="sahaKmzImportBtn" style="height:34px;font-size:11.5px"><i class="fa-solid fa-file-import"></i> KMZ Yüklə</button>
                            <button type="button" class="btn btn-outline" id="sahaKmzExportBtn" style="height:34px;font-size:11.5px;color:#4ade80;border-color:rgba(34,197,94,0.45)"><i class="fa-solid fa-earth-europe"></i> Yekun KMZ</button>
                            <button type="button" class="btn btn-outline" id="sahaClearDrawBtn" style="height:34px;font-size:11.5px;color:#ef4444;border-color:rgba(239,68,68,0.35)"><i class="fa-solid fa-trash"></i> Təmizlə</button>
                        </div>
                        <input type="file" id="sahaKmzFileInput" accept=".kmz,.kml" hidden>
                    </div>
                </div>

                <!-- TAB 3: OFİS NƏZARƏTİ VƏ JURNAL -->
                <div class="saha-pane" data-saha-pane="office" hidden>
                    <div class="saha-card">
                        <div class="saha-card-title">
                            <span>Gündəlik Xülasə (WhatsApp əvəzi · Bu gün)</span>
                            <button type="button" class="link" id="sahaRefreshJournalBtn" style="font-size:11px"><i class="fa-solid fa-rotate"></i> Yenilə</button>
                        </div>
                        <div class="saha-kpi-grid" id="sahaOfficeKpis"></div>
                    </div>

                    <div class="saha-card">
                        <div class="saha-card-title">
                            <span>Nöqtə / Antena Tarixçəsi &amp; Jurnal</span>
                            <button type="button" class="link" id="sahaCsvExportBtn" style="font-size:11px;color:#4ade80"><i class="fa-solid fa-file-csv"></i> CSV / Excel</button>
                        </div>
                        <div style="display:grid;grid-template-columns:110px 1fr;gap:6px">
                            <select class="input" id="sahaDateFilterSel" style="height:32px;font-size:11.5px">
                                <option value="today">Bu gün</option>
                                <option value="all">Bütün tarixlər</option>
                            </select>
                            <input type="search" class="input" id="sahaJournalSearch" placeholder="TŞ nömrə, mühəndis, material..." style="height:32px;font-size:11.5px">
                        </div>
                        <div class="saha-journal-list" id="sahaJournalList"></div>
                    </div>

                    <div class="saha-card" id="sahaAdminCfgCard">
                        <div class="saha-card-title"><span>⚙️ Google Apps Script Bağlantısı (Admin)</span></div>
                        <label class="saha-field">
                            <span>Web App URL (docs/saha-apps-script.gs)</span>
                            <input type="url" class="input" id="sahaWebAppUrlInp" placeholder="https://script.google.com/macros/s/.../exec">
                        </label>
                        <label class="saha-field">
                            <span>Gizli Token (SAHA_TOKEN)</span>
                            <input type="password" class="input" id="sahaTokenInp" placeholder="BCG-SAHA-2026-SECRET">
                        </label>
                        <div class="saha-btn-row">
                            <button type="button" class="btn btn-primary" id="sahaSaveCfgBtn" style="height:32px;font-size:11.5px">Yadda saxla</button>
                            <button type="button" class="btn btn-outline" id="sahaPingBtn" style="height:32px;font-size:11.5px">Sınaq (Ping)</button>
                        </div>
                    </div>
                </div>

                <!-- HOME TAB 1: LAYİHƏLƏR (ALT FOLDER) · MATERİALLAR · TƏSDİQ -->
                <div class="saha-pane" data-saha-pane="home-edit" hidden>
                    <div class="saha-card">
                        <div class="home-sub-tabs" id="homeSubTabs">
                            <button type="button" class="home-sub-btn active" data-home-sub="folders"><i class="fa-solid fa-folder-tree"></i> Layihələr</button>
                            <button type="button" class="home-sub-btn" data-home-sub="materials"><i class="fa-solid fa-cubes"></i> Materiallar</button>
                            <button type="button" class="home-sub-btn" data-home-sub="pending"><i class="fa-solid fa-bell"></i> Təsdiq<span id="homePendingCnt" style="color:#f59e0b"></span></button>
                        </div>
                        <div class="saha-card-title" style="margin-top:2px">
                            <span id="homeViewTitle">Layihə → Nöqtə (Alt Folder)</span>
                            <span id="homeObjCount" style="color:#38bdf8">0 obyekt</span>
                        </div>
                        <input type="search" class="input" id="homeObjSearch" placeholder="🔍 Layihə, TŞ, 6 m dirək, FO 12, mühəndis..." style="height:32px;font-size:12px">
                        <div class="home-obj-list" id="homeObjList"></div>
                        <div class="saha-btn-row">
                            <button type="button" class="btn btn-outline" id="homeKmzImportBtn" style="height:32px;font-size:11.5px"><i class="fa-solid fa-file-import"></i> KMZ Yüklə</button>
                            <button type="button" class="btn btn-outline" id="homeKmzExportBtn" style="height:32px;font-size:11.5px;color:#4ade80;border-color:rgba(34,197,94,0.45)"><i class="fa-solid fa-earth-europe"></i> Google Earth KMZ</button>
                        </div>
                    </div>
                    <div class="saha-card" id="homeEditCard" hidden>
                        <div class="saha-card-title">
                            <span>✏️ Obyekt Atributları &amp; Redaktə</span>
                            <button type="button" class="link" id="homeEditFlyBtn" style="font-size:11px;color:#38bdf8"><i class="fa-solid fa-crosshairs"></i> Xəritədə göstər</button>
                        </div>
                        <div class="home-edit-box" id="homeEditForm"></div>
                    </div>
                </div>

                <!-- HOME TAB 2: PDF İCRA ESKİZİ (HƏR NÖQTƏ AYRILIQDA + ÜMUMİ) -->
                <div class="saha-pane" data-saha-pane="home-pdf" hidden>
                    <div class="saha-card">
                        <div class="saha-card-title">
                            <span>📄 PDF İcra Eskizi — Nöqtə seçimi</span>
                            <div style="display:flex;gap:8px">
                                <button type="button" class="link" id="homePdfSelectAll" style="font-size:11px;color:#38bdf8">Hamısı</button>
                                <button type="button" class="link" id="homePdfSelectNone" style="font-size:11px">Təmizlə</button>
                            </div>
                        </div>
                        <div style="font-size:11.5px;color:var(--ink-2);line-height:1.45">
                            Hər nöqtənin qarşısındakı <b>📄</b> düyməsi ilə <b>ayrılıqda</b>, yaxud aşağıdakı düymə ilə seçilən nöqtələri <b>ümumi PDF</b> kimi ixrac edin.
                        </div>
                        <div class="home-pdf-checklist" id="homePdfChecklist"></div>
                        <button type="button" class="home-pdf-btn-primary" id="homePdfCombinedBtn">
                            <i class="fa-solid fa-file-pdf"></i> Seçilmişləri Ümumi PDF et
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(el);
        const mapStage = document.querySelector(".map-stage") || document.body;
        // HOME Şərti işarələr — Status-dakı #legend ilə 100% eyni tərtibat, eyni sol-aşağı künc!
        if (!byId("homeLegend")) {
            const leg = document.createElement("section");
            leg.id = "homeLegend";
            leg.className = "legend home-legend";
            leg.innerHTML = `
                <div class="legend-sec-title">Şərti işarələr (HOME)</div>
                <div class="legend-row"><span class="legend-shape-badge" style="color:#38bdf8;font-size:13px">□</span><span>BCG (içi boş)</span></div>
                <div class="legend-row"><span class="legend-shape-badge" style="color:#38bdf8;font-size:13px">■</span><span>Başqa qurum (dolu)</span></div>
                <div class="legend-divider"></div>
                <div class="legend-row"><span class="legend-shape-badge" style="color:#38bdf8">□</span><span>Dirək (6m / 8m)</span></div>
                <div class="legend-row"><span class="legend-shape-badge" style="color:#22c55e">△</span><span>Mufta (FO 12/24/48)</span></div>
                <div class="legend-row"><span class="legend-shape-badge" style="color:#a855f7">○</span><span>Quyu</span></div>
                <div class="legend-row"><span class="legend-shape-badge" style="color:#f59e0b">◇</span><span>Transformator</span></div>
                <div class="legend-row"><span class="legend-shape-badge" style="color:#ef4444">☆</span><span>Antena</span></div>
                <div class="legend-row"><span class="legend-shape-badge" style="color:#06b6d4">◎</span><span>Mövcud nöqtə</span></div>
                <div class="legend-divider"></div>
                <div class="legend-row"><span class="legend-line" style="background:#22c55e"></span><span>FO 12</span></div>
                <div class="legend-row"><span class="legend-line" style="background:#3b82f6"></span><span>FO 24</span></div>
                <div class="legend-row"><span class="legend-line" style="background:#ef4444"></span><span>FO 48</span></div>
                <div class="legend-row"><span class="legend-line" style="background:#dc2626"></span><span>Elektrik kabeli</span></div>
                <div class="legend-row"><span class="legend-line" style="background:repeating-linear-gradient(90deg,#92400e 0 5px,transparent 5px 8px)"></span><span>Qazıntı</span></div>
            `;
            mapStage.appendChild(leg);
        }
        // Sahə — Map Marker tərzi yuxarı-sol kompakt alət çubuğu (xəritəyə 100% geniş yer qalır!)
        if (!byId("sahaMapBar")) {
            const bar = document.createElement("div");
            bar.id = "sahaMapBar";
            bar.className = "saha-map-bar";
            bar.innerHTML = `
                <div class="saha-map-bar-row">
                    <button type="button" class="saha-mm-btn primary" id="sahaBarDrawBtn" title="Dirək, quyu, mufta, kabel əlavə et">
                        <i class="fa-solid fa-plus"></i><span>Çək</span>
                    </button>
                    <button type="button" class="saha-mm-btn" id="sahaBarWorkBtn" title="Nöqtə seç, material yaz, foto çək, bazaya göndər">
                        <i class="fa-solid fa-clipboard-list"></i><span id="sahaBarPointLbl">İş / Nöqtə</span>
                    </button>
                    <button type="button" class="saha-mm-btn icon" id="sahaBarGpsBtn" title="Ən yaxın nöqtə (GPS)">
                        <i class="fa-solid fa-location-crosshairs"></i>
                    </button>
                </div>
                <div class="saha-active-pill" id="sahaActivePill" hidden></div>
            `;
            mapStage.appendChild(bar);
            bar.querySelector("#sahaBarDrawBtn")?.addEventListener("click", () => {
                toggleFieldDrawerSheet("map");
            });
            bar.querySelector("#sahaBarWorkBtn")?.addEventListener("click", () => {
                toggleFieldDrawerSheet("work");
            });
            bar.querySelector("#sahaBarGpsBtn")?.addEventListener("click", findNearestPointByGps);
            bar.querySelector("#sahaActivePill")?.addEventListener("click", e => {
                const act = e.target.closest("[data-pill-act]")?.dataset.pillAct;
                if (!act) return;
                if (act === "undo") { saha.draftLine.pop(); renderDraftBar(); renderSahaMapLayer(); updateSahaMapBar(); }
                else if (act === "finish") { finishDraftLine(); updateSahaMapBar(); }
                else if (act === "stop") {
                    saha.drawTool = null;
                    saha.draftLine = [];
                    saha.fieldMovingId = "";
                    renderMapTools();
                    renderDraftBar();
                    renderSahaMapLayer();
                    updateSahaMapBar();
                }
            });
        }
        bindDrawerEvents();
    }

    function setFieldDrawerVisible(show) {
        const drawer = byId("sahaDrawer");
        if (!drawer) return;
        saha.collapsed = !show;
        drawer.hidden = !show;
        drawer.classList.remove("collapsed");
        document.body.classList.toggle("saha-sheet-open", Boolean(show));
        byId("sahaBarDrawBtn")?.classList.toggle("active", Boolean(show && saha.activeTab === "map"));
        byId("sahaBarWorkBtn")?.classList.toggle("active", Boolean(show && saha.activeTab === "work"));
    }

    function toggleFieldDrawerSheet(tab) {
        const drawer = byId("sahaDrawer");
        if (!drawer) return;
        const isSameOpen = !drawer.hidden && saha.activeTab === tab;
        if (isSameOpen) {
            setFieldDrawerVisible(false);
        } else {
            switchTab(tab);
            setFieldDrawerVisible(true);
        }
    }

    function updateSahaMapBar() {
        const lblEl = byId("sahaBarPointLbl");
        if (lblEl) {
            if (saha.selectedProjId === "__CARI__") {
                lblEl.textContent = (saha.cariName || "Cari İş").slice(0, 14);
            } else {
                const pt = getSelectedPoint();
                lblEl.textContent = pt ? String(pt.tsNo || pt.name || "İş").slice(0, 14) : "İş / Nöqtə";
            }
        }
        const pill = byId("sahaActivePill");
        if (!pill) return;
        if (saha.workspaceMode !== "field") {
            pill.hidden = true;
            return;
        }
        if (saha.fieldMovingId) {
            pill.hidden = false;
            pill.innerHTML = `<span>📍 Yeni yerə toxunun</span><button type="button" data-pill-act="stop">×</button>`;
            return;
        }
        if (!saha.drawTool) {
            pill.hidden = true;
            return;
        }
        pill.hidden = false;
        if (saha.drawTool.startsWith("pt:")) {
            const tk = saha.drawTool.slice(3);
            const meta = POINT_TYPES[tk] || POINT_TYPES.pole;
            const sym = saha.owner === "bcg" ? meta.hollow : meta.filled;
            const shortTxt = formatShortPointLabel(tk, saha.subChoice[tk] || meta.defaultSub);
            pill.innerHTML = `<span><b style="color:${meta.color}">${sym}</b> ${safeEsc(shortTxt)} · Xəritəyə toxun</span><button type="button" data-pill-act="stop" title="Bitir">Bitir</button>`;
        } else if (saha.drawTool.startsWith("ln:")) {
            const lk = saha.drawTool.slice(3);
            const lt = LINE_TYPES[lk] || LINE_TYPES.fo24;
            const m = lineMeters(saha.draftLine);
            pill.innerHTML = `
                <span><b style="color:${lt.color}">━</b> ${safeEsc(lt.label)}: <b>${m}m</b> (${saha.draftLine.length})</span>
                <button type="button" data-pill-act="undo" ${saha.draftLine.length < 1 ? "disabled" : ""}>Geri</button>
                <button type="button" class="ok" data-pill-act="finish" ${saha.draftLine.length < 2 ? "disabled" : ""}>Bitir</button>
                <button type="button" data-pill-act="stop">×</button>`;
        }
    }

    function updateConnBadge() {
        const pill = byId("sahaConnPill");
        if (!pill) return;
        const live = Boolean(saha.config.webAppUrl);
        pill.classList.toggle("live", live);
        pill.textContent = live ? "● Sheets Canlı" : "○ Lokal rejim";
    }

    function populateCascadingSelects() {
        const projs = getPmoProjectsList();
        const pSel = byId("sahaProjSel");
        const rSel = byId("sahaRayonSel");
        const ptSel = byId("sahaPointSel");
        if (!pSel || !rSel || !ptSel) return;

        if (!saha.selectedProjId) saha.selectedProjId = projs.length > 0 ? projs[0].id : "__CARI__";
        const cariOpt = `<option value="__CARI__" ${saha.selectedProjId === "__CARI__" ? "selected" : ""}>⚡ Cari Tapşırıq (Adını özün yaz)</option>`;
        pSel.innerHTML = cariOpt + projs.map(p => `<option value="${safeEsc(p.id)}" ${p.id === saha.selectedProjId ? "selected" : ""}>${safeEsc(p.name)}</option>`).join("");

        const isCari = saha.selectedProjId === "__CARI__";
        if (byId("sahaCariBox")) byId("sahaCariBox").hidden = !isCari;
        if (byId("sahaRayonPointRow")) byId("sahaRayonPointRow").style.display = isCari ? "none" : "grid";
        if (isCari) {
            if (byId("sahaCariName")) byId("sahaCariName").value = saha.cariName || "";
            if (byId("sahaCariPoint")) byId("sahaCariPoint").value = saha.cariPoint || "";
            renderSahaMapLayer();
            return;
        }

        const proj = getSelectedProject();
        const rayons = getRayonsForProject(proj);
        if (!rayons.some(r => r.id === saha.selectedRayonId)) saha.selectedRayonId = rayons[0]?.id || "";
        rSel.innerHTML = rayons.length
            ? rayons.map(r => `<option value="${safeEsc(r.id)}" ${r.id === saha.selectedRayonId ? "selected" : ""}>${safeEsc(r.name)}</option>`).join("")
            : `<option value="">— Rayon yoxdur —</option>`;

        const ry = getSelectedRayon();
        const pts = getPointsForRayon(ry);
        if (!pts.some(pt => pt.id === saha.selectedPointId)) saha.selectedPointId = pts[0]?.id || "";
        ptSel.innerHTML = pts.length
            ? pts.map(pt => {
                const lbl = pt.tsNo && pt.address && pt.tsNo !== pt.address
                    ? `${pt.tsNo} — ${pt.address.slice(0, 32)}`
                    : (pt.tsNo || pt.address || pt.name);
                return `<option value="${safeEsc(pt.id)}" ${pt.id === saha.selectedPointId ? "selected" : ""}>${safeEsc(lbl)}</option>`;
            }).join("")
            : `<option value="">— Nöqtə yoxdur —</option>`;

        // Status-dan tam müstəqil olaraq seçilmiş nöqtəni xəritədə göstər!
        renderSahaMapLayer();
    }

    function renderStageButtons() {
        const box = byId("sahaStagesBox");
        if (!box) return;
        box.querySelectorAll("[data-stage]").forEach(btn => {
            btn.classList.toggle("on", Boolean(saha.stages[btn.dataset.stage]));
        });
    }

    function renderMaterialsList() {
        const box = byId("sahaMatList");
        if (!box) return;
        const q = saha.matSearch.trim().toLowerCase();
        const list = saha.materialsCatalog.filter(m => !q || m.name.toLowerCase().includes(q));
        const selectedCount = Object.values(saha.qtyMap).filter(v => Number(v) > 0).length;
        if (byId("sahaSelectedMatCount")) byId("sahaSelectedMatCount").textContent = `${selectedCount} seçilib`;

        // Seçilmiş materiallar həmişə üstə çıxsın
        const sorted = list.slice().sort((a, b) => {
            const qa = Number(saha.qtyMap[a.name]) || 0;
            const qb = Number(saha.qtyMap[b.name]) || 0;
            if (qa > 0 && qb <= 0) return -1;
            if (qb > 0 && qa <= 0) return 1;
            return 0;
        });

        box.innerHTML = sorted.slice(0, 90).map(m => {
            const val = Number(saha.qtyMap[m.name]) || 0;
            const subInfo = m.hasFormula
                ? "🔒 Düsturlu xana (yazılmır)"
                : (m.plan || m.done ? `İcra: ${m.done} / Plan: ${m.plan}` : "");
            return `
                <div class="saha-mat-row ${val > 0 ? "has-qty" : ""}" data-mat-name="${safeEsc(m.name)}">
                    <div class="saha-mat-name">
                        ${safeEsc(m.name)}
                        ${subInfo ? `<span class="saha-mat-sub">${safeEsc(subInfo)}</span>` : ""}
                    </div>
                    <div class="saha-stepper">
                        <button type="button" data-step="-1" ${m.hasFormula ? "disabled" : ""}>−</button>
                        <input type="number" step="any" min="0" value="${val || ""}" placeholder="0" data-mat-inp ${m.hasFormula ? "disabled" : ""}>
                        <button type="button" data-step="1" ${m.hasFormula ? "disabled" : ""}>+</button>
                    </div>
                </div>`;
        }).join("") || `<div class="empty" style="padding:12px">Uyğun material tapılmadı</div>`;
    }

    function renderMapTools() {
        const ptBox = byId("sahaPointTools");
        const lnBox = byId("sahaLineTools");
        const subBox = byId("sahaSubOpts");
        if (ptBox) {
            ptBox.innerHTML = Object.entries(POINT_TYPES).map(([k, m]) => {
                const toolId = `pt:${k}`;
                const sym = saha.owner === "bcg" ? m.hollow : m.filled;
                const active = saha.drawTool === toolId;
                return `
                    <button type="button" class="saha-tool-btn ${active ? "active" : ""}" data-draw-tool="${toolId}">
                        <span class="saha-sym" style="color:${m.color}">${sym}</span>
                        <span>${safeEsc(m.label)}</span>
                    </button>`;
            }).join("");
        }
        if (lnBox) {
            lnBox.innerHTML = Object.entries(LINE_TYPES).map(([k, lt]) => {
                const toolId = `ln:${k}`;
                const active = saha.drawTool === toolId;
                return `
                    <button type="button" class="saha-tool-btn ${active ? "active" : ""}" data-draw-tool="${toolId}">
                        <span class="saha-line-swatch ${lt.dashed ? "dashed" : ""}" style="background:${lt.color}"></span>
                        <span>${safeEsc(lt.label)}</span>
                    </button>`;
            }).join("");
        }
        if (subBox) {
            if (saha.drawTool?.startsWith("pt:")) {
                const tk = saha.drawTool.slice(3);
                const subs = POINT_TYPES[tk]?.subs || [];
                if (subs.length > 0) {
                    subBox.hidden = false;
                    subBox.innerHTML = subs.map(sv => `
                        <button type="button" class="saha-pill-opt ${saha.subChoice[tk] === sv ? "active" : ""}" data-sub-val="${safeEsc(sv)}">${safeEsc(sv)}</button>
                    `).join("");
                } else {
                    subBox.hidden = true;
                }
            } else {
                subBox.hidden = true;
            }
        }
        if (window.map) {
            map.getCanvas().style.cursor = (saha.open && saha.drawTool) ? "crosshair" : "";
        }
    }

    function renderDraftBar() {
        const bar = byId("sahaDraftBar");
        if (!bar) return;
        if (!saha.drawTool?.startsWith("ln:")) {
            bar.hidden = true;
            return;
        }
        const lt = LINE_TYPES[saha.drawTool.slice(3)] || LINE_TYPES.fo24;
        const m = lineMeters(saha.draftLine);
        bar.hidden = false;
        bar.innerHTML = `
            <span><b>${lt.label}:</b> ${saha.draftLine.length} nöqtə · <b>${m} m</b></span>
            <div style="display:flex;gap:4px">
                <button type="button" class="btn btn-outline" style="height:26px;padding:0 8px;font-size:11px" data-draft-act="undo">Geri</button>
                <button type="button" class="btn btn-primary" style="height:26px;padding:0 10px;font-size:11px" data-draft-act="finish" ${saha.draftLine.length < 2 ? "disabled" : ""}>Bitir</button>
                <button type="button" class="btn btn-outline" style="height:26px;padding:0 8px;font-size:11px" data-draft-act="cancel">Ləğv</button>
            </div>`;
    }

    function renderDrawingsSummary() {
        if (byId("sahaDrawCount")) byId("sahaDrawCount").textContent = `${saha.features.length} obyekt`;
        const box = byId("sahaDrawStats");
        if (!box) return;
        if (saha.features.length === 0) {
            box.textContent = "Xəritəyə toxunaraq BCG (boş) / Başqa qurum (dolu) işarələri və FO xətləri çəkin.";
            return;
        }
        const bcgPoles = saha.features.filter(f => f.kind === "point" && f.owner === "bcg" && f.type === "pole").length;
        const bcgMufta = saha.features.filter(f => f.kind === "point" && f.owner === "bcg" && f.type === "mufta").length;
        const bcgQuyu = saha.features.filter(f => f.kind === "point" && f.owner === "bcg" && f.type === "quyu").length;
        const cableM = saha.features.filter(f => f.kind === "line" && f.type !== "qazinti").reduce((s, f) => s + (f.meters || lineMeters(f.coords)), 0);
        const qazM = saha.features.filter(f => f.kind === "line" && f.type === "qazinti").reduce((s, f) => s + (f.meters || lineMeters(f.coords)), 0);
        box.innerHTML = `BCG Dirək: <b>${bcgPoles}</b> · Mufta: <b>${bcgMufta}</b> · Quyu: <b>${bcgQuyu}</b><br>FO Kabel: <b style="color:#4ade80">${cableM} m</b> · Qazıntı: <b style="color:#fbbf24">${qazM} m</b>`;
    }

    function getFilteredJournalRows() {
        const td = todayIso();
        const q = saha.officeQuery.trim().toLowerCase();
        return saha.journal.filter(r => {
            if (saha.officeDateFilter === "today" && r.workDate !== td) return false;
            if (q) {
                const hay = `${r.projectName} ${r.tsNo} ${r.engineer} ${r.material} ${r.note}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }

    function renderOfficePanel() {
        const td = todayIso();
        const todayRows = saha.journal.filter(r => r.workDate === td && !r.undone);
        const uniqPoints = new Set(todayRows.map(r => `${r.projectName}::${r.tsNo}`).filter(Boolean));
        const cableM = todayRows
            .filter(r => /kabel|fo[\s\-]*(12|24|48)/i.test(r.material) && !/mufta|patch/i.test(r.material))
            .reduce((s, r) => s + (Number(r.addQty) || 0), 0);
        const poles = todayRows
            .filter(r => /dir[əe]k/i.test(r.material) && !/qol|demontaj|restavr|m[əe]rh[əe]l[əe]/i.test(r.material))
            .reduce((s, r) => s + (Number(r.addQty) || 0), 0);

        const kpiBox = byId("sahaOfficeKpis");
        if (kpiBox) {
            kpiBox.innerHTML = `
                <div class="saha-kpi"><small>Bu gün göndəriş</small><b style="color:#38bdf8">${todayRows.length}</b></div>
                <div class="saha-kpi"><small>İşlənən nöqtələr</small><b style="color:#fbbf24">${uniqPoints.size}</b></div>
                <div class="saha-kpi"><small>Çəkilən kabel</small><b style="color:#4ade80">${Math.round(cableM).toLocaleString("az-AZ")} m</b></div>
                <div class="saha-kpi"><small>Basdırılan dirək</small><b style="color:#c084fc">${Math.round(poles)}</b></div>
            `;
        }

        const listBox = byId("sahaJournalList");
        if (listBox) {
            const rows = getFilteredJournalRows();
            if (rows.length === 0) {
                listBox.innerHTML = `<div class="empty" style="padding:14px">Bu filtr üzrə göndəriş yoxdur</div>`;
            } else {
                const canUndo = isAdminUser();
                listBox.innerHTML = rows.slice(0, 120).map(r => `
                    <div class="saha-j-item ${r.undone ? "undone" : ""}">
                        <div class="saha-j-top">
                            <strong>${safeEsc(r.tsNo || "—")} · ${safeEsc(r.material)}</strong>
                            <span style="color:#4ade80;font-weight:800">+${r.addQty}</span>
                        </div>
                        <div class="saha-j-meta">${safeEsc(r.projectName)} · 👷 ${safeEsc(r.engineer)} · ${safeEsc(r.timestamp)}</div>
                        <div class="saha-j-meta">Köhnə: ${r.oldVal} → Yeni: <b>${r.newVal}</b>${r.note ? ` · 💬 ${safeEsc(r.note)}` : ""}</div>
                        ${r.undone ? `<div class="saha-j-meta" style="color:#f87171">${safeEsc(r.undone)}</div>` : (canUndo ? `
                            <div style="display:flex;justify-content:flex-end;margin-top:2px">
                                <button type="button" class="link" data-undo-sub="${safeEsc(r.submissionId)}" style="font-size:11px;color:#f87171"><i class="fa-solid fa-rotate-left"></i> Geri al (Undo)</button>
                            </div>` : "")}
                    </div>
                `).join("");
            }
        }

        const cfgCard = byId("sahaAdminCfgCard");
        if (cfgCard) cfgCard.hidden = !isAdminUser();
        if (byId("sahaWebAppUrlInp")) byId("sahaWebAppUrlInp").value = saha.config.webAppUrl || "";
        if (byId("sahaTokenInp")) byId("sahaTokenInp").value = saha.config.token || "";
        updateConnBadge();
    }

    /* =========================================================================
       8) HOME REJİMİ: SAHƏ OBYEKTLƏRİNƏ BAXIŞ, REDAKTƏ (EDIT) VƏ PDF ESKİZ
       ========================================================================= */
    const HOME_MAT_CATALOG = [
        { key: "pole:6m",      label: "6 m dirək",       icon: "□", color: "#38bdf8", unit: "əd" },
        { key: "pole:8m",      label: "8 m dirək",       icon: "□", color: "#0ea5e9", unit: "əd" },
        { key: "ln:fo12",      label: "FO 12",           icon: "━", color: "#22c55e", unit: "m"  },
        { key: "ln:fo24",      label: "FO 24",           icon: "━", color: "#3b82f6", unit: "m"  },
        { key: "ln:fo48",      label: "FO 48",           icon: "━", color: "#ef4444", unit: "m"  },
        { key: "ln:elec",      label: "Elektrik kabeli", icon: "⚡", color: "#dc2626", unit: "m"  },
        { key: "ln:qazinti",   label: "Qazıntı",         icon: "┅", color: "#92400e", unit: "m"  },
        { key: "mufta:FO-12",  label: "Mufta FO-12",     icon: "△", color: "#22c55e", unit: "əd" },
        { key: "mufta:FO-24",  label: "Mufta FO-24",     icon: "△", color: "#16a34a", unit: "əd" },
        { key: "mufta:FO-48",  label: "Mufta FO-48",     icon: "△", color: "#15803d", unit: "əd" },
        { key: "quyu",         label: "Quyu",            icon: "○", color: "#a855f7", unit: "əd" },
        { key: "trans",        label: "Transformator",   icon: "◇", color: "#f59e0b", unit: "əd" },
        { key: "ant",          label: "Antena",          icon: "☆", color: "#ef4444", unit: "əd" },
        { key: "exist",        label: "Mövcud nöqtə",    icon: "◎", color: "#06b6d4", unit: "əd" }
    ];

    function renderHomeObjectsPanel() {
        const listEl = byId("homeObjList");
        const cntEl = byId("homeObjCount");
        const titleEl = byId("homeViewTitle");
        if (!listEl) return;

        document.querySelectorAll("#homeSubTabs .home-sub-btn").forEach(b => {
            b.classList.toggle("active", b.dataset.homeSub === saha.homeSubView);
        });
        updatePendingBadges();

        const q = (saha.homeQuery || "").trim().toLowerCase();

        // 1) TƏSDİQ GÖZLƏYƏNLƏR (Mühəndislərin bazaya göndərdikləri)
        if (saha.homeSubView === "pending") {
            if (titleEl) titleEl.textContent = "🔔 Təsdiq Gözləyən Sahə İşləri";
            const pendingList = saha.packets.filter(p => {
                if (q) {
                    const hay = `${p.engineer} ${p.projectName} ${p.tsNo} ${p.note || ""}`.toLowerCase();
                    if (!hay.includes(q)) return false;
                }
                return true;
            });
            const pendCnt = pendingList.filter(p => p.status === "pending").length;
            if (cntEl) cntEl.textContent = `${pendCnt} gözləyir`;

            if (pendingList.length === 0) {
                listEl.innerHTML = `<div class="empty" style="padding:14px">Təsdiq gözləyən göndəriş yoxdur.<br><small>Mühəndislər «Bazaya Göndər» basdıqca burada canlı bildiriş çıxacaq.</small></div>`;
            } else {
                listEl.innerHTML = pendingList.map(p => {
                    const stBadge = p.status === "pending"
                        ? `<span style="color:#fbbf24;font-weight:800">⏳ Gözləyir</span>`
                        : (p.status === "approved" ? `<span style="color:#4ade80;font-weight:800">✅ Təsdiqləndi</span>` : `<span style="color:#f87171;font-weight:800">❌ Rədd edildi</span>`);
                    const matsTxt = (p.materials || []).map(m => `${m.name}: +${m.qty}`).join(" · ");
                    const featCnt = (p.features || []).length;
                    const photosHtml = (p.photos || []).length
                        ? `<div class="saha-photo-strip" style="margin-top:4px">${p.photos.map(src => `<div class="saha-photo-thumb"><img src="${src}" data-zoom-src="1"></div>`).join("")}</div>`
                        : "";
                    return `
                        <div class="home-pending-card ${p.status}">
                            <div class="saha-j-top">
                                <strong>${safeEsc(p.projectName)} · ${safeEsc(p.tsNo || "—")}</strong>
                                ${stBadge}
                            </div>
                            <div class="saha-j-meta">👷 <b>${safeEsc(p.engineer)}</b> · 📅 ${safeEsc(p.workDate)} · ${safeEsc(p.createdAt)}</div>
                            <div class="saha-j-meta">📍 ${featCnt} xəritə obyekti${matsTxt ? ` · 🧱 ${safeEsc(matsTxt)}` : ""}</div>
                            ${p.note ? `<div class="saha-j-meta">💬 ${safeEsc(p.note)}</div>` : ""}
                            ${photosHtml}
                            ${p.status === "pending" ? `
                            <div class="saha-btn-row" style="margin-top:6px">
                                <button type="button" class="btn btn-primary" data-pkt-approve="${safeEsc(p.id)}" style="height:30px;font-size:11.5px;background:#16a34a;border:0"><i class="fa-solid fa-check"></i> Okey (Excel &amp; Status)</button>
                                <button type="button" class="btn btn-outline" data-pkt-preview="${safeEsc(p.id)}" style="height:30px;font-size:11px;color:#38bdf8;border-color:rgba(56,189,248,0.45)"><i class="fa-solid fa-eye"></i> Bax</button>
                                <button type="button" class="btn btn-outline" data-pkt-reject="${safeEsc(p.id)}" style="height:30px;font-size:11px;color:#f87171;border-color:rgba(248,113,113,0.4)"><i class="fa-solid fa-xmark"></i></button>
                            </div>` : ""}
                        </div>`;
                }).join("");
            }
            renderHomeEditInspector();
            return;
        }

        // 2) MATERİALLAR KATALOQU (6 m dirək, 8 m dirək, FO 12, Elektrik...) → klikdə bütün atributlar!
        if (saha.homeSubView === "materials") {
            if (titleEl) titleEl.textContent = "🧱 Materiallar üzrə Ümumi Kataloq";
            const matchedAll = saha.features.filter(f => {
                if (!q) return true;
                const hay = `${f.label || ""} ${f.projectName || ""} ${f.tsNo || ""} ${f.engineer || ""} ${f.workDate || ""} ${f.sub || ""}`.toLowerCase();
                return hay.includes(q);
            });
            if (cntEl) cntEl.textContent = `${matchedAll.length} obyekt`;

            const groupsHtml = HOME_MAT_CATALOG.map(cat => {
                const items = matchedAll.filter(f => getMaterialCategoryKey(f) === cat.key);
                if (items.length === 0) return "";
                const totalVal = cat.unit === "m"
                    ? `${Math.round(items.reduce((s, f) => s + (f.meters || lineMeters(f.coords)), 0))} m`
                    : `${items.length} əd`;
                const isOpen = saha.homeMatFilter === cat.key;
                const rowsHtml = isOpen ? items.slice().reverse().map(f => `
                    <div class="home-obj-item ${f.id === saha.homeSelectedId ? "selected" : ""}" data-home-fid="${safeEsc(f.id)}">
                        <div class="home-obj-main">
                            <strong>${safeEsc(f.label || cat.label)} ${f.kind === "line" ? `(${f.meters || lineMeters(f.coords)} m)` : ""}</strong>
                            <small>📁 ${safeEsc(f.projectName || "Ümumi")} · 📍 Nöqtə: <b>${safeEsc(f.tsNo || "—")}</b></small>
                            <small>👷 ${safeEsc(f.engineer || "—")} · 📅 ${safeEsc(f.workDate || f.createdAt || "—")} · ${f.owner === "other" ? "■ Başqa" : "□ BCG"}</small>
                        </div>
                        <button type="button" class="icon-btn small" data-home-fly="${safeEsc(f.id)}" title="Xəritədə göstər"><i class="fa-solid fa-crosshairs"></i></button>
                    </div>`).join("") : "";
                return `
                    <div class="home-mat-group ${isOpen ? "open" : ""}">
                        <button type="button" class="home-mat-head" data-home-mat="${safeEsc(cat.key)}">
                            <span><b style="color:${cat.color};margin-right:6px">${cat.icon}</b>${safeEsc(cat.label)}</span>
                            <span class="home-mat-badge">${totalVal} (${items.length}) <i class="fa-solid fa-chevron-${isOpen ? "down" : "right"}"></i></span>
                        </button>
                        ${isOpen ? `<div class="home-mat-body">${rowsHtml}</div>` : ""}
                    </div>`;
            }).filter(Boolean).join("");

            listEl.innerHTML = groupsHtml || `<div class="empty" style="padding:14px">Uyğun material qeydi tapılmadı.</div>`;
            renderHomeEditInspector();
            return;
        }

        // 3) LAYİHƏLƏR → ALT FOLDER (NÖQTƏ / TŞ) AĞACI
        if (titleEl) titleEl.textContent = "📁 Layihə → Nöqtə (Alt Folder)";
        const filtered = saha.features.filter(f => {
            if (!q) return true;
            const hay = `${f.label || ""} ${f.projectName || ""} ${f.tsNo || ""} ${f.type || ""} ${f.sub || ""} ${f.engineer || ""} ${f.note || ""}`.toLowerCase();
            return hay.includes(q);
        });
        if (cntEl) cntEl.textContent = `${filtered.length} / ${saha.features.length} obyekt`;

        if (filtered.length === 0) {
            listEl.innerHTML = `<div class="empty" style="padding:14px">Sahədən gələn obyekt hələ yoxdur.<br><small>«Sahə» rejimində çəkin, bazaya göndərin və ya KMZ yükləyin.</small></div>`;
        } else {
            // Layihə → Nöqtə (TŞ) qruplaşdırması
            const projMap = new Map();
            filtered.forEach(f => {
                const pName = f.projectName || "Ümumi Sahə";
                const tsName = f.tsNo || "Ümumi nöqtə";
                if (!projMap.has(pName)) projMap.set(pName, new Map());
                const tsMap = projMap.get(pName);
                if (!tsMap.has(tsName)) tsMap.set(tsName, []);
                tsMap.get(tsName).push(f);
            });

            listEl.innerHTML = Array.from(projMap.entries()).map(([pName, tsMap]) => {
                const pOpen = saha.homeOpenFolders.has(`p:${pName}`) || projMap.size === 1 || Boolean(q);
                const totalInProj = Array.from(tsMap.values()).reduce((s, a) => s + a.length, 0);
                const subFoldersHtml = pOpen ? Array.from(tsMap.entries()).map(([tsName, items]) => {
                    const fKey = `t:${pName}::${tsName}`;
                    const tOpen = saha.homeOpenFolders.has(fKey) || tsMap.size === 1 || Boolean(q);
                    const itemsHtml = tOpen ? items.slice().reverse().map(f => {
                        const isPt = f.kind === "point";
                        const meta = isPt ? (POINT_TYPES[f.type] || POINT_TYPES.pole) : (LINE_TYPES[f.type] || LINE_TYPES.fo24);
                        const sym = isPt ? (f.owner === "bcg" ? meta.hollow : meta.filled) : "〰";
                        return `
                            <div class="home-obj-item ${f.id === saha.homeSelectedId ? "selected" : ""}" data-home-fid="${safeEsc(f.id)}">
                                <span style="font-size:15px;color:${meta.color};width:18px;text-align:center;flex:none">${sym}</span>
                                <div class="home-obj-main">
                                    <strong>${safeEsc(f.label || f.type)}</strong>
                                    <small>👷 ${safeEsc(f.engineer || "—")} · 📅 ${safeEsc(f.workDate || f.createdAt || "")}</small>
                                </div>
                                <button type="button" class="icon-btn small" data-home-fly="${safeEsc(f.id)}" title="Xəritədə göstər"><i class="fa-solid fa-crosshairs"></i></button>
                            </div>`;
                    }).join("") : "";
                    return `
                        <div class="home-subfolder">
                            <button type="button" class="home-folder-btn sub" data-home-folder="${safeEsc(fKey)}">
                                <span><i class="fa-solid fa-folder${tOpen ? "-open" : ""}" style="color:#fbbf24;margin-right:5px"></i>${safeEsc(tsName)}</span>
                                <span class="home-mat-badge">${items.length}</span>
                            </button>
                            ${tOpen ? `<div class="home-folder-items">${itemsHtml}</div>` : ""}
                        </div>`;
                }).join("") : "";

                return `
                    <div class="home-folder">
                        <button type="button" class="home-folder-btn" data-home-folder="${safeEsc(`p:${pName}`)}">
                            <span><i class="fa-solid fa-folder${pOpen ? "-open" : ""}" style="color:#38bdf8;margin-right:6px"></i><b>${safeEsc(pName)}</b></span>
                            <span class="home-mat-badge">${tsMap.size} nöqtə · ${totalInProj}</span>
                        </button>
                        ${pOpen ? `<div class="home-folder-body">${subFoldersHtml}</div>` : ""}
                    </div>`;
            }).join("");
        }
        renderHomeEditInspector();
    }

    function renderHomeEditInspector() {
        const card = byId("homeEditCard");
        const form = byId("homeEditForm");
        if (!card || !form) return;
        const feat = saha.features.find(f => f.id === saha.homeSelectedId);
        if (!feat) {
            card.hidden = true;
            return;
        }
        card.hidden = false;
        const isPt = feat.kind === "point";
        const typeOpts = isPt
            ? Object.entries(POINT_TYPES).map(([k, m]) => `<option value="${k}" ${feat.type === k ? "selected" : ""}>${safeEsc(m.label)}</option>`).join("")
            : Object.entries(LINE_TYPES).map(([k, m]) => `<option value="${k}" ${feat.type === k ? "selected" : ""}>${safeEsc(m.label)}</option>`).join("");
        const lat = isPt && Array.isArray(feat.coords) ? feat.coords[0] : "";
        const lng = isPt && Array.isArray(feat.coords) ? feat.coords[1] : "";

        const photosHtml = (feat.photos || []).length
            ? `<div class="saha-photo-strip">${feat.photos.map(src => `<div class="saha-photo-thumb"><img src="${src}" data-zoom-src="1"></div>`).join("")}</div>`
            : "";

        form.innerHTML = `
            <div class="home-attr-meta">
                <span>📁 <b>${safeEsc(feat.projectName || "Ümumi Sahə")}</b></span>
                <span>📍 Nöqtə: <b>${safeEsc(feat.tsNo || "—")}</b></span>
                <span>👷 Kim: <b>${safeEsc(feat.engineer || "—")}</b></span>
                <span>📅 Tarix: <b>${safeEsc(feat.workDate || feat.createdAt || "—")}</b></span>
            </div>
            ${photosHtml}
            <label class="saha-field">
                <span>Ad / Etiket</span>
                <input type="text" class="input" id="heLabel" value="${safeEsc(feat.label || "")}">
            </label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                <label class="saha-field">
                    <span>Növ</span>
                    <select class="input" id="heType">${typeOpts}</select>
                </label>
                ${isPt ? `
                <label class="saha-field">
                    <span>Mülkiyyət</span>
                    <select class="input" id="heOwner">
                        <option value="bcg" ${feat.owner === "bcg" ? "selected" : ""}>□ BCG (İçi boş)</option>
                        <option value="other" ${feat.owner !== "bcg" ? "selected" : ""}>■ Başqa qurum (Dolu)</option>
                    </select>
                </label>` : `
                <label class="saha-field">
                    <span>Uzunluq (m)</span>
                    <input type="number" step="0.1" class="input" id="heMeters" value="${feat.meters || lineMeters(feat.coords)}">
                </label>`}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                <label class="saha-field">
                    <span>Alt-növ (6 m, FO-24...)</span>
                    <input type="text" class="input" id="heSub" value="${safeEsc(feat.sub || "")}">
                </label>
                <label class="saha-field">
                    <span>TŞ / Nöqtə №</span>
                    <input type="text" class="input" id="heTsNo" value="${safeEsc(feat.tsNo || "")}" placeholder="Məs: TŞ-12">
                </label>
            </div>
            ${isPt ? `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                <label class="saha-field">
                    <span>Enlik (Lat)</span>
                    <input type="number" step="0.000001" class="input" id="heLat" value="${lat}">
                </label>
                <label class="saha-field">
                    <span>Uzunluq (Lng)</span>
                    <input type="number" step="0.000001" class="input" id="heLng" value="${lng}">
                </label>
            </div>` : ""}
            <label class="saha-field">
                <span>Qeyd</span>
                <input type="text" class="input" id="heNote" value="${safeEsc(feat.note || "")}" placeholder="Ofis redaktə qeydi...">
            </label>
            <div class="saha-btn-row">
                <button type="button" class="btn btn-primary" id="heSaveBtn" style="height:34px;font-size:12px"><i class="fa-solid fa-check"></i> Yadda saxla</button>
                <button type="button" class="btn btn-outline" id="heDeleteBtn" style="height:34px;font-size:12px;color:#ef4444;border-color:rgba(239,68,68,0.4)"><i class="fa-solid fa-trash"></i> Sil</button>
            </div>
        `;
    }

    function flyToSahaFeature(feat) {
        if (!feat || typeof flyToCoords !== "function") return;
        if (feat.kind === "point" && Array.isArray(feat.coords)) flyToCoords([feat.coords]);
        else if (feat.kind === "line" && Array.isArray(feat.coords) && feat.coords.length) flyToCoords(feat.coords);
    }

    function getHomePdfGroups() {
        const mapByKey = new Map();
        const ensure = key => {
            if (!mapByKey.has(key)) mapByKey.set(key, { key, label: key === "__ALL_UNASSIGNED__" ? "Ümumi / TŞ-siz obyektlər" : key, features: [], journal: [] });
            return mapByKey.get(key);
        };
        saha.features.forEach(f => {
            const k = String(f.tsNo || "").trim() || "__ALL_UNASSIGNED__";
            ensure(k).features.push(f);
        });
        saha.journal.forEach(r => {
            if (r.undone) return;
            const k = String(r.tsNo || "").trim() || "__ALL_UNASSIGNED__";
            ensure(k).journal.push(r);
        });
        return Array.from(mapByKey.values());
    }

    function renderFieldQuickEdit() {
        const card = byId("sahaQuickEditCard");
        const form = byId("sahaQuickEditForm");
        if (!card || !form) return;
        const feat = saha.features.find(f => f.id === saha.fieldEditId);
        if (!feat) {
            card.hidden = true;
            return;
        }
        card.hidden = false;
        const isPt = feat.kind === "point";
        const typeOpts = isPt
            ? Object.entries(POINT_TYPES).map(([k, m]) => `<option value="${k}" ${feat.type === k ? "selected" : ""}>${safeEsc(m.label)}</option>`).join("")
            : Object.entries(LINE_TYPES).map(([k, m]) => `<option value="${k}" ${feat.type === k ? "selected" : ""}>${safeEsc(m.label)}</option>`).join("");
        const isMoving = saha.fieldMovingId === feat.id;

        form.innerHTML = `
            <label class="saha-field">
                <span>Ad / Etiket</span>
                <input type="text" class="input" id="feLabel" value="${safeEsc(feat.label || "")}">
            </label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                <label class="saha-field">
                    <span>Növ</span>
                    <select class="input" id="feType">${typeOpts}</select>
                </label>
                ${isPt ? `
                <label class="saha-field">
                    <span>Mülkiyyət</span>
                    <select class="input" id="feOwner">
                        <option value="bcg" ${feat.owner === "bcg" ? "selected" : ""}>□ BCG (İçi boş)</option>
                        <option value="other" ${feat.owner !== "bcg" ? "selected" : ""}>■ Başqa (Dolu)</option>
                    </select>
                </label>` : `
                <label class="saha-field">
                    <span>Uzunluq (m)</span>
                    <input type="number" step="0.1" class="input" id="feMeters" value="${feat.meters || lineMeters(feat.coords)}">
                </label>`}
            </div>
            <label class="saha-field">
                <span>Alt-növ (6 m, 8 m, FO-24...)</span>
                <input type="text" class="input" id="feSub" value="${safeEsc(feat.sub || "")}">
            </label>
            ${isPt ? `
            <button type="button" class="btn btn-outline" id="feMoveBtn" style="height:34px;font-size:12px;width:100%;border-color:#fbbf24;color:#fbbf24">
                <i class="fa-solid fa-arrows-up-down-left-right"></i> ${isMoving ? "📍 İndi xəritədə yeni yerə toxunun..." : "Yerini dəyiş (Xəritədə toxun)"}
            </button>` : ""}
            <div class="saha-btn-row">
                <button type="button" class="btn btn-primary" id="feSaveBtn" style="height:34px;font-size:12px"><i class="fa-solid fa-check"></i> Yadda saxla</button>
                <button type="button" class="btn btn-outline" id="feDeleteBtn" style="height:34px;font-size:12px;color:#ef4444;border-color:rgba(239,68,68,0.4)"><i class="fa-solid fa-trash"></i> Sil</button>
            </div>`;
    }

    function renderHomePdfPanel() {
        const box = byId("homePdfChecklist");
        if (!box) return;
        const groups = getHomePdfGroups();
        if (groups.length === 0) {
            box.innerHTML = `<div class="empty" style="padding:14px">PDF üçün sahə nöqtəsi və ya qeydi hələ yoxdur.<br><small>«Sahə» rejimində çəkin və ya iş qeydi əlavə edin.</small></div>`;
            return;
        }
        // İlk açılışda hamısı seçili olsun
        if (saha.homePdfSelected.size === 0) groups.forEach(g => saha.homePdfSelected.add(g.key));

        box.innerHTML = groups.map(g => {
            const checked = saha.homePdfSelected.has(g.key);
            const ptCnt = g.features.filter(f => f.kind === "point").length;
            const lnM = Math.round(g.features.filter(f => f.kind === "line").reduce((s, f) => s + (f.meters || lineMeters(f.coords)), 0));
            return `
                <div class="home-pdf-row">
                    <label>
                        <input type="checkbox" data-pdf-key="${safeEsc(g.key)}" ${checked ? "checked" : ""}>
                        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                            <b>${safeEsc(g.label)}</b>
                            <small style="color:var(--ink-3);margin-left:5px">${ptCnt} nöqtə · ${lnM} m · ${g.journal.length} qeyd</small>
                        </span>
                    </label>
                    <button type="button" class="btn btn-outline" data-pdf-single="${safeEsc(g.key)}" title="Bu nöqtəni ayrılıqda PDF et" style="height:26px;padding:0 8px;font-size:11px;color:#38bdf8;border-color:rgba(56,189,248,0.45)">
                        <i class="fa-solid fa-file-pdf"></i> PDF
                    </button>
                </div>`;
        }).join("");
    }

    function buildSchematicSvg(features) {
        const W = 1040, H = 560, PAD = 50;
        const pts = [];
        features.forEach(f => {
            if (f.kind === "point" && Array.isArray(f.coords)) pts.push(f.coords);
            else if (f.kind === "line" && Array.isArray(f.coords)) f.coords.forEach(c => pts.push(c));
        });
        if (pts.length === 0) {
            return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="500" style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px"><text x="${W/2}" y="${H/2}" text-anchor="middle" fill="#64748b" font-size="15" font-family="Inter,sans-serif">Bu seçimdə xəritə obyekti yoxdur</text></svg>`;
        }

        // Dəqiq Web Mercator proyeksiyası (Küçə xəritəsi kafelləri ilə 100% üst-üstə düşür!)
        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
        pts.forEach(([la, ln]) => {
            if (la < minLat) minLat = la; if (la > maxLat) maxLat = la;
            if (ln < minLng) minLng = ln; if (ln > maxLng) maxLng = ln;
        });
        const latToMercY = lat => {
            const rad = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
            return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
        };
        const lngToMercX = lng => (lng + 180) / 360;

        const cLat = (minLat + maxLat) / 2;
        const cLng = (minLng + maxLng) / 2;
        let z = 18;
        for (let tz = 18; tz >= 10; tz--) {
            const world = 256 * Math.pow(2, tz);
            const dx = Math.abs(lngToMercX(maxLng) - lngToMercX(minLng)) * world;
            const dy = Math.abs(latToMercY(minLat) - latToMercY(maxLat)) * world;
            if (dx <= W - PAD * 2 && dy <= H - PAD * 2) {
                z = tz;
                break;
            }
            z = tz;
        }
        const worldSize = 256 * Math.pow(2, z);
        const cxWorld = lngToMercX(cLng) * worldSize;
        const cyWorld = latToMercY(cLat) * worldSize;
        const leftWorld = cxWorld - W / 2;
        const topWorld = cyWorld - H / 2;

        const proj = ([la, ln]) => [
            Number((lngToMercX(ln) * worldSize - leftWorld).toFixed(1)),
            Number((latToMercY(la) * worldSize - topWorld).toFixed(1))
        ];

        // Küçə xəritəsi kafelləri (Carto Voyager / OSM — CORS bloksuz, çapda 100% açılır!)
        const minTx = Math.floor(leftWorld / 256);
        const maxTx = Math.floor((leftWorld + W) / 256);
        const minTy = Math.floor(topWorld / 256);
        const maxTy = Math.floor((topWorld + H) / 256);
        const maxTile = Math.pow(2, z);
        const osmTilesHtml = [];
        const subs = ["a", "b", "c", "d"];
        for (let tx = minTx; tx <= maxTx; tx++) {
            for (let ty = minTy; ty <= maxTy; ty++) {
                if (ty < 0 || ty >= maxTile) continue;
                const wrapTx = ((tx % maxTile) + maxTile) % maxTile;
                const px = Math.round(tx * 256 - leftWorld);
                const py = Math.round(ty * 256 - topWorld);
                const sub = subs[(wrapTx + ty) % subs.length];
                const primaryUrl = `https://${sub}.basemaps.cartocdn.com/rastertiles/voyager/${z}/${wrapTx}/${ty}.png`;
                const fallbackUrl = `https://tile.openstreetmap.org/${z}/${wrapTx}/${ty}.png`;
                osmTilesHtml.push(`<img class="osm-tile" referrerpolicy="no-referrer" src="${primaryUrl}" onerror="if(!this.dataset.fb){this.dataset.fb=1;this.src='${fallbackUrl}';}" style="left:${px}px;top:${py}px">`);
            }
        }

        const linesSvg = features.filter(f => f.kind === "line" && f.coords?.length >= 2).map(f => {
            const lt = LINE_TYPES[f.type] || LINE_TYPES.fo24;
            const xy = f.coords.map(proj);
            const pathD = xy.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
            const midIdx = Math.floor((xy.length - 1) / 2);
            const mid = [
                (xy[midIdx][0] + xy[Math.min(midIdx + 1, xy.length - 1)][0]) / 2,
                (xy[midIdx][1] + xy[Math.min(midIdx + 1, xy.length - 1)][1]) / 2
            ];
            const dash = lt.dashed ? `stroke-dasharray="7 5"` : "";
            const lbl = `${lt.label} · ${f.meters || lineMeters(f.coords)}m`;
            const bw = Math.max(58, lbl.length * 5.6 + 10);
            return `
                <path d="${pathD}" fill="none" stroke="#ffffff" stroke-width="5.4" ${dash} stroke-linecap="round" opacity="0.88"/>
                <path d="${pathD}" fill="none" stroke="${lt.color}" stroke-width="3.2" ${dash} stroke-linecap="round"/>
                <rect x="${mid[0] - bw / 2}" y="${mid[1] - 9}" width="${bw}" height="15" rx="3.5" fill="#ffffff" stroke="${lt.color}" stroke-width="1.2"/>
                <text x="${mid[0]}" y="${mid[1] + 2}" text-anchor="middle" font-size="9" font-weight="800" fill="#0f172a">${safeEsc(lbl)}</text>`;
        }).join("");

        const ptsSvg = features.filter(f => f.kind === "point" && Array.isArray(f.coords)).map((f, idx) => {
            const meta = POINT_TYPES[f.type] || POINT_TYPES.pole;
            const [x, y] = proj(f.coords);
            const fill = f.owner === "bcg" ? "#ffffff" : meta.color;
            const stroke = meta.color;
            const sw = f.owner === "bcg" ? 2.8 : 1.6;
            const stCol = f.owner === "bcg" ? stroke : "#ffffff";
            let shape = "";
            if (f.type === "pole") shape = `<rect x="${x - 6.5}" y="${y - 6.5}" width="13" height="13" fill="${fill}" stroke="${stCol}" stroke-width="${sw}"/>`;
            else if (f.type === "mufta") shape = `<polygon points="${x},${y - 7.5} ${x + 7.5},${y + 6.5} ${x - 7.5},${y + 6.5}" fill="${fill}" stroke="${stCol}" stroke-width="${sw}"/>`;
            else if (f.type === "quyu") shape = `<circle cx="${x}" cy="${y}" r="7" fill="${fill}" stroke="${stCol}" stroke-width="${sw}"/>`;
            else if (f.type === "trans") shape = `<polygon points="${x},${y - 7.5} ${x + 7.5},${y} ${x},${y + 7.5} ${x - 7.5},${y}" fill="${fill}" stroke="${stCol}" stroke-width="${sw}"/>`;
            else if (f.type === "exist") shape = `<circle cx="${x}" cy="${y}" r="7.5" fill="${fill}" stroke="${stCol}" stroke-width="${sw}"/><circle cx="${x}" cy="${y}" r="3" fill="${f.owner === "bcg" ? stroke : "#fff"}"/>`;
            else shape = `<circle cx="${x}" cy="${y}" r="7.5" fill="${fill}" stroke="${stCol}" stroke-width="${sw}"/><text x="${x}" y="${y + 3.2}" text-anchor="middle" font-size="9" fill="${f.owner === "bcg" ? stroke : "#fff"}">★</text>`;
            const lbl = f.label || `#${idx + 1}`;
            const lw = Math.max(28, lbl.length * 5.2 + 8);
            return `
                ${shape}
                <rect x="${x - lw / 2}" y="${y + 9}" width="${lw}" height="13" rx="3" fill="rgba(255,255,255,0.92)" stroke="${stroke}" stroke-width="0.9"/>
                <text x="${x}" y="${y + 18.5}" text-anchor="middle" font-size="8.5" font-weight="800" fill="#0f172a">${safeEsc(lbl)}</text>`;
        }).join("");

        return `
            <div class="osm-map-wrap" style="width:${W}px;height:${H}px">
                <div class="osm-tiles-layer">${osmTilesHtml.join("")}</div>
                <svg class="osm-svg-overlay" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
                    <g transform="translate(${W - 34}, 28)">
                        <circle cx="0" cy="0" r="16" fill="rgba(255,255,255,0.94)" stroke="#334155" stroke-width="1.2"/>
                        <polygon points="0,-12 4,2 0,-1 -4,2" fill="#0f172a"/>
                        <text x="0" y="12" text-anchor="middle" font-size="8" font-weight="800" fill="#0f172a">N</text>
                    </g>
                    ${linesSvg}
                    ${ptsSvg}
                    <rect x="6" y="${H - 22}" width="305" height="16" rx="3" fill="rgba(255,255,255,0.9)"/>
                    <text x="12" y="${H - 11}" font-size="8.5" font-weight="600" fill="#0f172a">Küçə Xəritəsi (Z${z}) · ${minLat.toFixed(5)}..${maxLat.toFixed(5)} N, ${minLng.toFixed(5)}..${maxLng.toFixed(5)} E</text>
                </svg>
            </div>`;
    }

    function generateFieldPdfReport(targetKeys, isCombined) {
        const groups = getHomePdfGroups().filter(g => targetKeys.includes(g.key));
        if (groups.length === 0) {
            showToast("PDF üçün ən azı 1 nöqtə seçin", true);
            return;
        }
        const allFeats = groups.flatMap(g => g.features);
        const title = isCombined
            ? `BCG GIS — Ümumi Sahə Xəritəsi (${groups.length} nöqtə)`
            : `BCG GIS — Sahə Xəritəsi · ${groups[0].label}`;

        const html = `<!DOCTYPE html><html lang="az"><head><meta charset="UTF-8"><title>${safeEsc(title)}</title>
        <style>
            @page { size: A4 landscape; margin: 8mm; }
            body { font-family: Inter, Arial, sans-serif; color: #0f172a; margin: 0; font-size: 11px; }
            .hdr { display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #0f172a; padding-bottom:5px; margin-bottom:8px; }
            .hdr h1 { margin:0; font-size:15px; }
            .legend { display:flex; flex-wrap:wrap; gap:12px; font-size:10px; padding:5px 10px; background:#f1f5f9; border-radius:6px; margin:7px 0; }
            .stamp { margin-top:8px; display:grid; grid-template-columns:2fr 1fr 1fr 1fr; border:1.5px solid #0f172a; }
            .stamp div { padding:5px 8px; border-right:1px solid #0f172a; }
            .stamp div:last-child { border-right:0; }
            .stamp small { display:block; font-size:8.5px; color:#475569; }
            .no-print { text-align:right; margin-bottom:6px; }
            .osm-map-wrap { position:relative; max-width:100%; margin:0 auto; overflow:hidden; border:1.5px solid #64748b; border-radius:6px; background:#e2e8f0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
            .osm-tiles-layer { position:absolute; inset:0; }
            .osm-tile { position:absolute; width:256px; height:256px; display:block; pointer-events:none; }
            .osm-svg-overlay { position:relative; z-index:2; display:block; width:100%; height:100%; }
            @media print { .no-print { display:none; } }
        </style></head><body>
            <div class="no-print"><button onclick="window.print()" style="padding:7px 14px;background:#0284c7;color:#fff;border:0;border-radius:6px;font-weight:700;cursor:pointer">🖨️ PDF kimi yadda saxla / Çap et</button></div>
            <div class="hdr">
                <div><h1>${safeEsc(title)}</h1><small>Baku Communications Group · Küçə Xəritəsi üzərində İcra Eskizi</small></div>
                <div style="text-align:right"><b>Tarix:</b> ${todayIso()}<br><small>Hazırladı: ${safeEsc(state?.user?.name || state?.user?.email || "BCG Ofis")}</small></div>
            </div>
            ${buildSchematicSvg(allFeats)}
            <div class="legend">
                <span><b>Şərti işarələr:</b></span>
                <span>□ BCG (boş) / ■ Başqa (dolu) Dirək</span>
                <span>△ / ▲ Mufta</span>
                <span>○ / ● Quyu</span>
                <span>◇ / ◆ Trans.</span>
                <span>☆ / ★ Antena</span>
                <span>◎ / ◉ Mövcud</span>
                <span style="color:#16a34a"><b>━ FO 12</b></span>
                <span style="color:#2563eb"><b>━ FO 24</b></span>
                <span style="color:#ef4444"><b>━ FO 48</b></span>
                <span style="color:#dc2626"><b>━ Elektrik</b></span>
                <span style="color:#92400e"><b>┅ Qazıntı</b></span>
            </div>
            <div class="stamp">
                <div><small>Təşkilat / Sənəd</small><b>Baku Communications Group — İcra Eskizi</b></div>
                <div><small>İcraçı Mühəndis</small><b>________________</b></div>
                <div><small>Ofis / Yoxladı</small><b>________________</b></div>
                <div><small>Tarix / İmza</small><b>${todayIso()}</b></div>
            </div>
            <script>
                window.addEventListener("load", () => {
                    const imgs = Array.from(document.querySelectorAll("img.osm-tile"));
                    const waits = imgs.map(im => im.complete ? Promise.resolve() : new Promise(r => { im.onload = r; im.onerror = r; }));
                    Promise.race([Promise.all(waits), new Promise(r => setTimeout(r, 3200))]).then(() => setTimeout(() => window.print(), 300));
                });
            <\/script>
        </body></html>`;

        const w = window.open("", "_blank");
        if (!w) {
            showToast("Brauzer yeni pəncərəni (pop-up) blokladı — icazə verib təkrar yoxlayın", true);
            return;
        }
        w.document.open();
        w.document.write(html);
        w.document.close();
    }

    function switchTab(tabName) {
        saha.activeTab = tabName;
        const drawer = byId("sahaDrawer");
        if (!drawer) return;
        drawer.querySelectorAll("[data-saha-tab]").forEach(b => b.classList.toggle("active", b.dataset.sahaTab === tabName));
        drawer.querySelectorAll("[data-saha-pane]").forEach(p => { p.hidden = p.dataset.sahaPane !== tabName; });
        if (tabName === "map") {
            renderMapTools();
            renderDraftBar();
            renderDrawingsSummary();
        } else {
            saha.drawTool = null;
            if (window.map) map.getCanvas().style.cursor = "";
        }
        if (tabName === "office") {
            renderOfficePanel();
            fetchRemoteJournal();
        } else if (tabName === "home-edit") {
            renderHomeObjectsPanel();
        } else if (tabName === "home-pdf") {
            renderHomePdfPanel();
        }
    }

    function setWorkspaceMode(mode) {
        const valid = ["home", "status", "field"];
        if (!valid.includes(mode)) mode = "status";
        if (!saha.allowedModes.includes(mode)) mode = saha.allowedModes[0] || "status";

        saha.workspaceMode = mode;
        document.body.dataset.workspaceMode = mode;

        document.querySelectorAll("#modeRail .mode-rail-btn").forEach(b => {
            b.classList.toggle("active", b.dataset.workspaceMode === mode);
        });
        const topBtn = byId("fieldModeBtn");
        if (topBtn) topBtn.classList.toggle("active", mode === "field");

        if (mode === "status") {
            setSahaOpen(false);
            document.body.classList.remove("saha-sheet-open");
        } else if (mode === "field") {
            setSahaOpen(true);
            const drawer = byId("sahaDrawer");
            if (drawer) drawer.classList.remove("mode-home");
            if (byId("sahaHeadIcon")) { byId("sahaHeadIcon").className = "fa-solid fa-helmet-safety"; byId("sahaHeadIcon").style.color = "#fbbf24"; }
            if (byId("sahaHeadTitle")) byId("sahaHeadTitle").textContent = "Sahə · Map Marker";
            switchTab(saha.activeTab === "work" ? "work" : "map");
            // Map Marker prinsipi: açılışda xəritə 100% tam geniş qalsın, sol-yuxarıdakı ➕/📋 ilə açılsın!
            setFieldDrawerVisible(false);
            updateSahaMapBar();
        } else if (mode === "home") {
            setSahaOpen(true);
            const drawer = byId("sahaDrawer");
            if (drawer) {
                drawer.classList.add("mode-home");
                drawer.hidden = false;
                drawer.classList.remove("collapsed");
            }
            document.body.classList.add("saha-sheet-open");
            if (byId("sahaHeadIcon")) { byId("sahaHeadIcon").className = "fa-solid fa-house"; byId("sahaHeadIcon").style.color = "#38bdf8"; }
            if (byId("sahaHeadTitle")) byId("sahaHeadTitle").textContent = "HOME · Ofis GIS & PDF";
            switchTab(["home-edit", "home-pdf", "office"].includes(saha.activeTab) ? saha.activeTab : "home-edit");
            updateSahaMapBar();
        }

        setTimeout(() => { try { window.map?.resize(); } catch {} }, 65);
    }

    /** Gələcək rol idarəetməsi üçün hazır API: məs. setAllowedModes(["field"]) */
    function setAllowedModes(modes) {
        const list = (Array.isArray(modes) ? modes : []).filter(m => ["home", "status", "field"].includes(m));
        saha.allowedModes = list.length ? list : ["status"];
        document.querySelectorAll("#modeRail .mode-rail-btn").forEach(b => {
            b.hidden = !saha.allowedModes.includes(b.dataset.workspaceMode);
        });
        if (!saha.allowedModes.includes(saha.workspaceMode)) {
            setWorkspaceMode(saha.allowedModes[0]);
        }
    }
    window.BCGWorkspace = {
        setMode: setWorkspaceMode,
        getMode: () => saha.workspaceMode,
        setAllowedModes
    };

    function setSahaOpen(open) {
        saha.open = Boolean(open);
        buildDrawerDom();
        const drawer = byId("sahaDrawer");
        const btn = byId("fieldModeBtn");
        if (drawer) drawer.hidden = !saha.open;
        if (btn) btn.classList.toggle("active", saha.workspaceMode === "field");

        if (saha.open) {
            saha.layerVisible = true;
            if (byId("sahaWorkDate") && !byId("sahaWorkDate").value) byId("sahaWorkDate").value = todayIso();
            if (byId("sahaEngineerInput") && !byId("sahaEngineerInput").value) {
                byId("sahaEngineerInput").value = state?.user?.name || state?.user?.email?.split("@")[0] || "";
            }
            populateCascadingSelects();
            loadMaterialsForCurrentSelection();
            renderStageButtons();
            renderMapTools();
            renderDrawingsSummary();
            renderOfficePanel();
            renderHomeObjectsPanel();
            renderHomePdfPanel();
            renderPhotoStrip();
            renderSahaMapLayer();
            updateConnBadge();
        } else {
            saha.drawTool = null;
            saha.draftLine = [];
            if (window.map) map.getCanvas().style.cursor = "";
            renderSahaMapLayer();
        }
    }

    function bindDrawerEvents() {
        const drawer = byId("sahaDrawer");
        if (!drawer) return;

        byId("sahaCloseBtn")?.addEventListener("click", () => {
            if (saha.workspaceMode === "field") {
                setFieldDrawerVisible(false);
            } else {
                setWorkspaceMode("status");
            }
        });
        byId("sahaCollapseBtn")?.addEventListener("click", () => {
            if (saha.workspaceMode === "field") {
                setFieldDrawerVisible(false);
                return;
            }
            saha.collapsed = !saha.collapsed;
            byId("sahaDrawer")?.classList.toggle("collapsed", saha.collapsed);
            document.body.classList.toggle("saha-sheet-open", !saha.collapsed);
            const ic = byId("sahaCollapseBtn")?.querySelector("i");
            if (ic) ic.className = saha.collapsed ? "fa-solid fa-chevron-right" : "fa-solid fa-chevron-left";
        });

        byId("sahaQuickEditClose")?.addEventListener("click", () => {
            saha.fieldEditId = "";
            saha.fieldMovingId = "";
            if (window.map) map.getCanvas().style.cursor = "";
            renderFieldQuickEdit();
        });
        byId("sahaQuickEditForm")?.addEventListener("click", e => {
            const feat = saha.features.find(x => x.id === saha.fieldEditId);
            if (!feat) return;
            if (e.target.closest("#feMoveBtn")) {
                saha.fieldMovingId = feat.id;
                saha.drawTool = null;
                renderMapTools();
                if (window.map) map.getCanvas().style.cursor = "crosshair";
                renderFieldQuickEdit();
                if (saha.workspaceMode === "field") setFieldDrawerVisible(false);
                updateSahaMapBar();
                showToast("📍 Xəritədə yeni yerə toxunun!");
                return;
            }
            if (e.target.closest("#feSaveBtn")) {
                feat.label = (byId("feLabel")?.value || "").trim() || feat.label;
                feat.type = byId("feType")?.value || feat.type;
                feat.sub = (byId("feSub")?.value || "").trim();
                if (feat.kind === "point") {
                    feat.owner = byId("feOwner")?.value || feat.owner;
                } else {
                    const m = Number(byId("feMeters")?.value);
                    if (Number.isFinite(m) && m > 0) feat.meters = Math.round(m * 10) / 10;
                }
                saveDrawings();
                renderSahaMapLayer();
                renderDrawingsSummary();
                renderFieldQuickEdit();
                showToast("✅ Sahə obyekti yeniləndi");
                return;
            }
            if (e.target.closest("#feDeleteBtn")) {
                if (!confirm(`"${feat.label}" silinsin?`)) return;
                saha.features = saha.features.filter(x => x.id !== feat.id);
                saha.fieldEditId = "";
                saha.fieldMovingId = "";
                saveDrawings();
                renderSahaMapLayer();
                renderDrawingsSummary();
                renderFieldQuickEdit();
                showToast("🗑️ Obyekt silindi");
            }
        });

        // Cari Tapşırıq & Foto events
        byId("sahaCariName")?.addEventListener("input", e => { saha.cariName = e.target.value || ""; });
        byId("sahaCariPoint")?.addEventListener("input", e => { saha.cariPoint = e.target.value || ""; });
        byId("sahaPhotoBtn")?.addEventListener("click", () => byId("sahaPhotoInput")?.click());
        byId("sahaPhotoInput")?.addEventListener("change", async e => {
            const files = Array.from(e.target.files || []).slice(0, 4);
            for (const f of files) {
                if (saha.photos.length >= 6) break;
                try {
                    const dataUrl = await compressPhotoFile(f);
                    saha.photos.push(dataUrl);
                } catch {}
            }
            e.target.value = "";
            renderPhotoStrip();
            if (files.length) showToast(`📸 ${files.length} şəkil əlavə olundu`);
        });
        byId("sahaPhotoStrip")?.addEventListener("click", e => {
            const del = e.target.closest("[data-del-photo]");
            if (del) {
                saha.photos.splice(Number(del.dataset.delPhoto), 1);
                renderPhotoStrip();
                return;
            }
            const img = e.target.closest("img");
            if (img?.src) window.open(img.src, "_blank");
        });

        // HOME Sub-tabs (Layihələr / Materiallar / Təsdiq)
        byId("homeSubTabs")?.addEventListener("click", e => {
            const btn = e.target.closest("[data-home-sub]");
            if (!btn) return;
            saha.homeSubView = btn.dataset.homeSub;
            if (saha.homeSubView !== "materials") saha.homeMatFilter = "";
            renderHomeObjectsPanel();
            renderSahaMapLayer();
        });

        // HOME Obyektlər & Redaktə events
        byId("homeObjSearch")?.addEventListener("input", e => {
            saha.homeQuery = e.target.value || "";
            renderHomeObjectsPanel();
        });
        byId("homeObjList")?.addEventListener("click", e => {
            // Foto böyütmə
            const zoomImg = e.target.closest("img[data-zoom-src]");
            if (zoomImg?.src) { window.open(zoomImg.src, "_blank"); return; }

            // Təsdiq / Rədd / Bax düymələri
            const appBtn = e.target.closest("[data-pkt-approve]");
            if (appBtn) { approvePendingPacket(appBtn.dataset.pktApprove); return; }
            const rejBtn = e.target.closest("[data-pkt-reject]");
            if (rejBtn) { rejectPendingPacket(rejBtn.dataset.pktReject); return; }
            const prevBtn = e.target.closest("[data-pkt-preview]");
            if (prevBtn) {
                const pkt = saha.packets.find(p => p.id === prevBtn.dataset.pktPreview);
                const coords = [];
                (pkt?.features || []).forEach(f => {
                    if (f.kind === "point" && Array.isArray(f.coords)) coords.push(f.coords);
                    else if (f.kind === "line" && Array.isArray(f.coords)) coords.push(...f.coords);
                });
                if (coords.length && typeof flyToCoords === "function") flyToCoords(coords);
                else showToast("Bu göndərişdə xəritə koordinatı yoxdur");
                return;
            }

            // Layihə / Alt Folder aç-bağla
            const fBtn = e.target.closest("[data-home-folder]");
            if (fBtn) {
                const fk = fBtn.dataset.homeFolder;
                if (saha.homeOpenFolders.has(fk)) saha.homeOpenFolders.delete(fk);
                else saha.homeOpenFolders.add(fk);
                renderHomeObjectsPanel();
                return;
            }

            // Material qrupu (6 m dirək, FO 12...) → klikdə atributları aç və xəritədə filtr et!
            const mBtn = e.target.closest("[data-home-mat]");
            if (mBtn) {
                const mk = mBtn.dataset.homeMat;
                saha.homeMatFilter = (saha.homeMatFilter === mk) ? "" : mk;
                renderHomeObjectsPanel();
                renderSahaMapLayer();
                if (saha.homeMatFilter) {
                    const matched = saha.features.filter(f => getMaterialCategoryKey(f) === saha.homeMatFilter);
                    const coords = [];
                    matched.forEach(f => {
                        if (f.kind === "point" && Array.isArray(f.coords)) coords.push(f.coords);
                        else if (f.kind === "line" && Array.isArray(f.coords)) coords.push(...f.coords);
                    });
                    if (coords.length && typeof flyToCoords === "function") flyToCoords(coords);
                }
                return;
            }

            const flyBtn = e.target.closest("[data-home-fly]");
            if (flyBtn) {
                e.stopPropagation();
                const f = saha.features.find(x => x.id === flyBtn.dataset.homeFly);
                flyToSahaFeature(f);
                return;
            }
            const row = e.target.closest("[data-home-fid]");
            if (!row) return;
            saha.homeSelectedId = row.dataset.homeFid;
            renderHomeObjectsPanel();
            const f = saha.features.find(x => x.id === saha.homeSelectedId);
            flyToSahaFeature(f);
        });
        byId("homeEditFlyBtn")?.addEventListener("click", () => {
            const f = saha.features.find(x => x.id === saha.homeSelectedId);
            flyToSahaFeature(f);
        });
        byId("homeEditForm")?.addEventListener("click", e => {
            const saveBtn = e.target.closest("#heSaveBtn");
            const delBtn = e.target.closest("#heDeleteBtn");
            const feat = saha.features.find(x => x.id === saha.homeSelectedId);
            if (!feat) return;
            if (saveBtn) {
                feat.label = (byId("heLabel")?.value || "").trim() || feat.label;
                feat.type = byId("heType")?.value || feat.type;
                feat.sub = (byId("heSub")?.value || "").trim();
                feat.tsNo = (byId("heTsNo")?.value || "").trim();
                feat.note = (byId("heNote")?.value || "").trim();
                if (feat.kind === "point") {
                    feat.owner = byId("heOwner")?.value || feat.owner;
                    const la = Number(byId("heLat")?.value);
                    const ln = Number(byId("heLng")?.value);
                    if (Number.isFinite(la) && Number.isFinite(ln)) feat.coords = [Number(la.toFixed(6)), Number(ln.toFixed(6))];
                } else {
                    const m = Number(byId("heMeters")?.value);
                    if (Number.isFinite(m) && m > 0) feat.meters = Math.round(m * 10) / 10;
                }
                saveDrawings();
                renderSahaMapLayer();
                renderDrawingsSummary();
                renderHomeObjectsPanel();
                renderHomePdfPanel();
                showToast("✅ Obyekt yeniləndi");
            } else if (delBtn) {
                if (!confirm(`"${feat.label}" silinsin?`)) return;
                saha.features = saha.features.filter(x => x.id !== feat.id);
                saha.homeSelectedId = "";
                saveDrawings();
                renderSahaMapLayer();
                renderDrawingsSummary();
                renderHomeObjectsPanel();
                renderHomePdfPanel();
                showToast("🗑️ Obyekt silindi");
            }
        });
        byId("homeKmzImportBtn")?.addEventListener("click", () => byId("sahaKmzFileInput")?.click());
        byId("homeKmzExportBtn")?.addEventListener("click", exportSahaKmz);

        // HOME PDF events
        byId("homePdfSelectAll")?.addEventListener("click", () => {
            getHomePdfGroups().forEach(g => saha.homePdfSelected.add(g.key));
            renderHomePdfPanel();
        });
        byId("homePdfSelectNone")?.addEventListener("click", () => {
            saha.homePdfSelected.clear();
            renderHomePdfPanel();
        });
        byId("homePdfChecklist")?.addEventListener("change", e => {
            const cb = e.target.closest("[data-pdf-key]");
            if (!cb) return;
            if (cb.checked) saha.homePdfSelected.add(cb.dataset.pdfKey);
            else saha.homePdfSelected.delete(cb.dataset.pdfKey);
        });
        byId("homePdfChecklist")?.addEventListener("click", e => {
            const btn = e.target.closest("[data-pdf-single]");
            if (btn) generateFieldPdfReport([btn.dataset.pdfSingle], false);
        });
        byId("homePdfCombinedBtn")?.addEventListener("click", () => {
            generateFieldPdfReport(Array.from(saha.homePdfSelected), true);
        });
        byId("sahaLayerToggleBtn")?.addEventListener("click", () => {
            saha.layerVisible = !saha.layerVisible;
            const icon = byId("sahaLayerToggleBtn")?.querySelector("i");
            if (icon) icon.className = saha.layerVisible ? "fa-solid fa-eye" : "fa-solid fa-eye-slash";
            renderSahaMapLayer();
            showToast(saha.layerVisible ? "👁️ Sahə xəritə qatı açıldı" : "🙈 Sahə xəritə qatı gizlədildi");
        });

        byId("sahaTabs")?.addEventListener("click", e => {
            const b = e.target.closest("[data-saha-tab]");
            if (b) switchTab(b.dataset.sahaTab);
        });

        byId("sahaGpsBtn")?.addEventListener("click", findNearestPointByGps);
        byId("sahaProjSel")?.addEventListener("change", e => {
            saha.selectedProjId = e.target.value;
            saha.selectedRayonId = "";
            saha.selectedPointId = "";
            populateCascadingSelects();
            loadMaterialsForCurrentSelection();
        });
        byId("sahaRayonSel")?.addEventListener("change", e => {
            saha.selectedRayonId = e.target.value;
            saha.selectedPointId = "";
            populateCascadingSelects();
            loadMaterialsForCurrentSelection();
        });
        byId("sahaPointSel")?.addEventListener("change", e => {
            saha.selectedPointId = e.target.value;
            const pt = getSelectedPoint();
            const c = pt && (Array.isArray(pt.coords) && pt.coords.length === 2 ? pt.coords : parseSpaceSafeCoord(pt.coords));
            renderSahaMapLayer();
            updateSahaMapBar();
            if (c && typeof flyToCoords === "function") flyToCoords([c]);
            loadMaterialsForCurrentSelection();
        });

        byId("sahaStagesBox")?.addEventListener("click", e => {
            const b = e.target.closest("[data-stage]");
            if (!b) return;
            const k = b.dataset.stage;
            saha.stages[k] = !saha.stages[k];
            renderStageButtons();
        });

        byId("sahaMatSearch")?.addEventListener("input", e => {
            saha.matSearch = e.target.value || "";
            renderMaterialsList();
        });

        byId("sahaMatList")?.addEventListener("click", e => {
            const stepBtn = e.target.closest("[data-step]");
            if (!stepBtn) return;
            const row = stepBtn.closest("[data-mat-name]");
            if (!row) return;
            const name = row.dataset.matName;
            const delta = Number(stepBtn.dataset.step) || 0;
            const next = Math.max(0, (Number(saha.qtyMap[name]) || 0) + delta);
            if (next === 0) delete saha.qtyMap[name];
            else saha.qtyMap[name] = next;
            renderMaterialsList();
        });

        byId("sahaMatList")?.addEventListener("change", e => {
            if (!e.target.matches("[data-mat-inp]")) return;
            const row = e.target.closest("[data-mat-name]");
            if (!row) return;
            const name = row.dataset.matName;
            const val = Math.max(0, Number(String(e.target.value).replace(",", ".")) || 0);
            if (val === 0) delete saha.qtyMap[name];
            else saha.qtyMap[name] = val;
            renderMaterialsList();
        });

        byId("sahaTransferBtn1")?.addEventListener("click", transferMapDrawingsToMaterials);
        byId("sahaTransferBtn2")?.addEventListener("click", transferMapDrawingsToMaterials);
        byId("sahaSubmitBtn")?.addEventListener("click", submitFieldWork);

        // Map Marker tab events
        byId("sahaOwnerToggle")?.addEventListener("click", e => {
            const b = e.target.closest("[data-owner]");
            if (!b) return;
            saha.owner = b.dataset.owner;
            byId("sahaOwnerToggle").querySelectorAll("[data-owner]").forEach(x => x.classList.toggle("active", x === b));
            renderMapTools();
        });

        const onDrawToolClick = e => {
            const b = e.target.closest("[data-draw-tool]");
            if (!b) return;
            const tId = b.dataset.drawTool;
            saha.draftLine = [];
            saha.drawTool = (saha.drawTool === tId) ? null : tId;
            renderMapTools();
            renderDraftBar();
            renderSahaMapLayer();
            updateSahaMapBar();
            if (saha.drawTool) {
                const hasSubs = saha.drawTool.startsWith("pt:") && (POINT_TYPES[saha.drawTool.slice(3)]?.subs?.length > 1);
                // Alt seçimi olmayan alətlərdə və bütün xətlərdə menyu avtomatik yığılır → 100% tam ekran xəritə!
                if (!hasSubs && saha.workspaceMode === "field") {
                    setFieldDrawerVisible(false);
                }
                showToast(saha.drawTool.startsWith("pt:")
                    ? "📍 Xəritədə işarə qoymaq üçün toxunun"
                    : "〰️ Ardıcıl nöqtələrə toxunun, bitəndə 'Bitir' basın");
            }
        };
        byId("sahaPointTools")?.addEventListener("click", onDrawToolClick);
        byId("sahaLineTools")?.addEventListener("click", onDrawToolClick);

        byId("sahaSubOpts")?.addEventListener("click", e => {
            const b = e.target.closest("[data-sub-val]");
            if (!b || !saha.drawTool?.startsWith("pt:")) return;
            const tk = saha.drawTool.slice(3);
            saha.subChoice[tk] = b.dataset.subVal;
            renderMapTools();
            updateSahaMapBar();
            if (saha.workspaceMode === "field") setFieldDrawerVisible(false);
        });

        byId("sahaDraftBar")?.addEventListener("click", e => {
            const act = e.target.closest("[data-draft-act]")?.dataset.draftAct;
            if (!act) return;
            if (act === "undo") { saha.draftLine.pop(); renderDraftBar(); renderSahaMapLayer(); }
            else if (act === "finish") finishDraftLine();
            else if (act === "cancel") { saha.draftLine = []; saha.drawTool = null; renderMapTools(); renderDraftBar(); renderSahaMapLayer(); }
        });

        byId("sahaKmzImportBtn")?.addEventListener("click", () => byId("sahaKmzFileInput")?.click());
        byId("sahaKmzFileInput")?.addEventListener("change", async e => {
            const f = e.target.files?.[0];
            if (f) await importSahaKmzFile(f);
            e.target.value = "";
        });
        byId("sahaKmzExportBtn")?.addEventListener("click", exportSahaKmz);
        byId("sahaClearDrawBtn")?.addEventListener("click", () => {
            if (saha.features.length === 0) return;
            if (!confirm("Sahə xəritəsindəki bütün çəkilmiş obyektlər silinsin?")) return;
            saha.features = [];
            saha.draftLine = [];
            saveDrawings();
            renderSahaMapLayer();
            renderDrawingsSummary();
            showToast("🗑️ Sahə xəritəsi təmizləndi");
        });

        // Office tab events
        byId("sahaRefreshJournalBtn")?.addEventListener("click", () => {
            fetchRemoteJournal();
            renderOfficePanel();
            showToast("🔄 Sahə jurnalı yeniləndi");
        });
        byId("sahaCsvExportBtn")?.addEventListener("click", exportJournalCsv);
        byId("sahaDateFilterSel")?.addEventListener("change", e => {
            saha.officeDateFilter = e.target.value;
            renderOfficePanel();
        });
        byId("sahaJournalSearch")?.addEventListener("input", e => {
            saha.officeQuery = e.target.value || "";
            renderOfficePanel();
        });
        byId("sahaJournalList")?.addEventListener("click", e => {
            const btn = e.target.closest("[data-undo-sub]");
            if (btn) undoSubmission(btn.dataset.undoSub);
        });

        byId("sahaSaveCfgBtn")?.addEventListener("click", () => {
            saha.config.webAppUrl = (byId("sahaWebAppUrlInp")?.value || "").trim();
            saha.config.token = (byId("sahaTokenInp")?.value || "").trim();
            saveConfig();
            updateConnBadge();
            showToast("✅ Apps Script bağlantısı yadda saxlanıldı");
        });

        byId("sahaPingBtn")?.addEventListener("click", async () => {
            const url = (byId("sahaWebAppUrlInp")?.value || saha.config.webAppUrl || "").trim();
            const token = (byId("sahaTokenInp")?.value || saha.config.token || "").trim();
            if (!url) { showToast("Əvvəlcə Web App URL daxil edin", true); return; }
            try {
                const res = await fetch(`${url}?action=ping&token=${encodeURIComponent(token)}`, { cache: "no-store" });
                const data = await res.json();
                if (data && data.ok) {
                    showToast(`✅ Qoşulma uğurludur! Cədvəl: ${data.spreadsheet}`);
                } else {
                    showToast(`❌ Xəta: ${data?.error || "Token və ya icazə səhvdir"}`, true);
                }
            } catch (err) {
                showToast(`❌ Bağlantı alınmadı: ${err.message}`, true);
            }
        });
    }

    function initFieldModule() {
        loadPersisted();
        document.body.dataset.workspaceMode = "status";
        updatePendingBadges();

        // Real-time bulud sinxronizasiyası (mühəndis göndərən kimi ofisdə bildiriş çıxsın!)
        setTimeout(() => {
            syncFromSahaCloud(false);
            if (typeof api !== "undefined" && typeof api.subscribeSahaCloud === "function") {
                api.subscribeSahaCloud(() => syncFromSahaCloud(true));
            }
            setInterval(() => {
                if (document.visibilityState === "visible") syncFromSahaCloud(true);
            }, 12000);
        }, 1800);

        // Sol 3-düyməli rejim paneli: HOME / Status / Sahə
        byId("modeRail")?.addEventListener("click", e => {
            const btn = e.target.closest("[data-workspace-mode]");
            if (!btn) return;
            setWorkspaceMode(btn.dataset.workspaceMode);
        });

        const toggleBtn = byId("fieldModeBtn");
        toggleBtn?.addEventListener("click", () => {
            byId("topActions")?.classList.remove("open");
            setWorkspaceMode(saha.workspaceMode === "field" ? "status" : "field");
        });
        document.addEventListener("keydown", e => {
            if (e.key === "Escape" && saha.open && !document.querySelector("dialog[open]")) {
                if (saha.drawTool) {
                    saha.drawTool = null;
                    saha.draftLine = [];
                    renderMapTools();
                    renderDraftBar();
                    renderSahaMapLayer();
                } else {
                    setWorkspaceMode("status");
                }
            }
        });
    }

    document.addEventListener("DOMContentLoaded", initFieldModule);
})();
