/* BCG GIS paneli: vəziyyət, xəritə, panellər */

const AZERBAIJAN_BOUNDS = [[38.39, 44.77], [41.91, 50.63]];

const STATUS_COLORS = { bitmis: "#22C55E", icrada: "#F59E0B", tehvil: "#3B82F6", layihe: "#EF4444" };
const ENDPOINT_MIN_ZOOM = 9;
const STATUSES = Object.keys(STATUS_COLORS);

const STORAGE = { lang: "bcg.lang", theme: "bcg.theme" };

/* Rənglər: üst panel, səth, əsas rəng */
const THEMES = {
    light: ["#0e1a2b", "#ffffff", "#0b63ce"],
    dark: ["#0e1a2b", "#141e2b", "#4c9bf5"],
    ocean: ["#0b3a53", "#f2f8fb", "#0e7fa8"],
    forest: ["#12372a", "#f4f8f5", "#1f8a5b"],
    graphite: ["#18191b", "#232427", "#e0a030"]
};

const state = {
    lang: "az",
    user: null,
    role: "manager",
    projects: [],
    contractors: {},
    materials: [],
    visibleIds: new Set(),
    statusFilter: "all",
    query: "",
    expandedIds: new Set(),
    selected: null,
    dockTab: "segments",
    notes: []
};

let map, routePopup, currentBase, goToMarker;
let namesOn = false;

const $ = id => document.getElementById(id);
const t = key => I18N[state.lang][key] || key;

/* Mətn və atribut üçün təhlükəsiz HTML: dırnaqlar da qorunur */
const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(value) {
    return (value == null ? "" : String(value)).replace(/[&<>"']/g, ch => ESC_MAP[ch]);
}

const formatDate = iso => iso ? iso.split("-").reverse().join(".") : "—";
const formatKm = km => km.toLocaleString("en-US", { maximumFractionDigits: 1 });
const formatDistance = m => m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
const percent = (done, total) => total > 0 ? Math.min(100, Math.round(done / total * 100)) : 0;

function readStore(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function writeStore(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        toast(t("storageFull"), true);
    }
}

function toast(message, isError = false) {
    const el = document.createElement("div");
    el.className = `toast${isError ? " error" : ""}`;
    el.textContent = message;
    $("toasts").appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

/* Seçilmiş status filtrinə və axtarışa uyğun seqmentlər */
function matchesFilters(project, item) {
    if (state.statusFilter !== "all" && item.status !== state.statusFilter) return false;
    if (!state.query) return true;
    const haystack = [project.name, item.id, item.name, item.pointA, item.pointB, item.contractor].join(" ");
    return haystack.toLocaleLowerCase("az").includes(state.query);
}

const filteredItems = project => project.items.filter(item => matchesFilters(project, item));

function visibleEntries() {
    return state.projects
        .filter(p => state.visibleIds.has(p.id))
        .flatMap(p => filteredItems(p).map(item => ({ project: p, item })));
}

function totals(items) {
    return items.reduce((sum, r) => ({
        plan: sum.plan + r.totalKm,
        done: sum.done + r.doneKm,
        closures: sum.closures + (r.closures || 0),
        manholes: sum.manholes + (r.manholes || 0)
    }), { plan: 0, done: 0, closures: 0, manholes: 0 });
}

/* DİL VƏ MÖVZU */
function applyLanguage(lang) {
    state.lang = lang;
    document.documentElement.lang = lang;
    document.title = t("pageTitle");
    document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    document.querySelectorAll("[data-i18n-aria]").forEach(el => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
    document.querySelectorAll("[data-i18n-title]").forEach(el => {
        el.title = t(el.dataset.i18nTitle);
        el.setAttribute("aria-label", el.title);
    });
    renderRole();
    if (currentBase) renderLayerOptions();
    tools.refresh();
    renderThemeMenu();
    renderLegend();
    renderNotes();
    renderMaterials();
    renderAll();
}

function applyTheme(theme) {
    document.documentElement.dataset.theme = THEMES[theme] ? theme : "dark";
    renderThemeMenu();
}

function renderThemeMenu() {
    const current = document.documentElement.dataset.theme;
    $("themeMenu").innerHTML = Object.entries(THEMES).map(([id, colors]) => `
        <button class="theme-opt ${id === current ? "on" : ""}" data-theme-id="${id}">
            <span class="theme-swatch">${colors.map(c => `<span style="background:${c}"></span>`).join("")}</span>
            <span>${t(`theme_${id}`)}</span>
            ${id === current ? '<i class="fa-solid fa-check"></i>' : ""}
        </button>
    `).join("");
}

function setThemeMenu(open) {
    $("themeMenu").hidden = !open;
    $("themeBtn").setAttribute("aria-expanded", open);
}

/* GİRİŞ */
const isAdmin = () => state.role === "admin";

function renderRole() {
    const email = state.user?.email || "";
    $("roleBadge").textContent = isAdmin() ? t("roleAdmin") : t("roleManager");
    $("userEmail").textContent = email;
    $("userAvatar").textContent = email.charAt(0);
    $("importBtn").hidden = !isAdmin();
    $("addProjectBtn").hidden = !isAdmin();
    tools.refresh();
}

async function handleLogin(event) {
    event.preventDefault();
    const email = $("loginUser").value.trim();
    const password = $("loginPass").value;
    if (!api.configured) {
        $("loginError").textContent = t("notConfigured");
        return;
    }
    if (!email || !password) {
        $("loginError").textContent = t("loginRequired");
        return;
    }
    const result = await api.signIn(email, password);
    if (result.error) {
        $("loginError").textContent = t(result.error === "credentials" ? "loginFailed" : "loginNetwork");
        return;
    }
    $("loginError").textContent = "";
    $("loginPass").value = "";
    await enterApp(result.user);
}

function resetState() {
    Object.assign(state, { user: null, role: "manager", projects: [], contractors: {}, materials: [], notes: [], selected: null, statusFilter: "all", query: "" });
    state.visibleIds.clear();
    state.expandedIds.clear();
    $("searchInput").value = "";
}

function showLogin(message = "") {
    $("loginError").textContent = message;
    $("loginUser").value = "";
    $("login").hidden = false;
    $("topActions").classList.remove("open");
}

async function handleLogout() {
    await api.signOut().catch(() => {});
    resetState();
    tools.setUser(null);
    renderRole();
    renderNotes();
    renderMaterials();
    renderAll();
    showLogin();
}

async function enterApp(user) {
    state.user = user;
    let data;
    try {
        data = await api.loadAll(user.id);
    } catch {
        // Məlumat gəlmədisə boş paneldə qalmırıq: sessiyanı bağlayıb girişə qayıdırıq
        await api.signOut().catch(() => {});
        resetState();
        showLogin(t("loadError"));
        return;
    }
    $("login").hidden = true;
    Object.assign(state, data);
    state.projects.forEach(p => state.visibleIds.add(p.id));
    tools.setUser(user.id);
    renderRole();
    renderNotes();
    renderMaterials();
    renderAll();
}

/* REDAKTƏ (admin) */
const statusOptions = () => STATUSES.map(id => [id, t(`status${id}`)]);

async function reloadData() {
    const known = new Set(state.projects.map(p => p.id));
    Object.assign(state, await api.loadAll(state.user.id));
    state.projects.forEach(p => { if (!known.has(p.id)) state.visibleIds.add(p.id); });
    renderMaterials();
    renderAll();
}

let editor = null;

function fieldHtml(field, value) {
    const attrs = `name="${field.key}" class="input"`;
    let control;
    if (field.type === "select") {
        const options = field.options.map(([id, label]) => `<option value="${esc(id)}" ${String(value) === id ? "selected" : ""}>${esc(label)}</option>`).join("");
        control = `<select ${attrs}>${options}</select>`;
    } else if (field.type === "textarea") {
        control = `<textarea ${attrs} rows="5" placeholder="${esc(field.placeholder || "")}">${esc(value)}</textarea>`;
    } else {
        const step = field.type === "number" ? 'step="any" min="0"' : "";
        control = `<input ${attrs} type="${field.type || "text"}" ${step} value="${esc(value)}">`;
    }
    const after = field.action ? `<button class="link" type="button" data-field-action="${field.key}">${esc(field.action.label)}</button>` : "";
    return `<label class="${field.wide ? "wide" : ""}"><span>${esc(field.label)}${field.required ? " *" : ""}</span>${control}${after}</label>`;
}

function openEditor(config) {
    editor = config;
    $("editTitle").textContent = config.title;
    $("editError").textContent = "";
    $("editFields").innerHTML = config.fields.map(f => fieldHtml(f, config.values[f.key] ?? "")).join("");
    $("editDelete").hidden = !config.onDelete;
    $("editModal").showModal();
}

async function submitEditor(event) {
    event.preventDefault();
    const data = new FormData($("editForm"));
    const values = {};
    for (const field of editor.fields) {
        const raw = String(data.get(field.key) ?? "").trim();
        if (field.required && !raw) {
            $("editError").textContent = `${field.label}: ${t("required")}`;
            return;
        }
        if (field.type === "number") values[field.key] = Number(raw) || 0;
        else if (field.type === "date") values[field.key] = raw || null;
        else values[field.key] = raw;
    }
    try {
        if (values.start_date && values.end_date && values.end_date < values.start_date) throw new Error("dates");
        if ("done_km" in values && values.done_km > values.total_km) throw new Error("km");
        await editor.onSave(values);
        await reloadData();
    } catch (error) {
        const messages = { coords: "coordsInvalid", dates: "datesInvalid", km: "kmInvalid" };
        $("editError").textContent = t(messages[error.message] || "saveError");
        return;
    }
    $("editModal").close();
    toast(t("saved"));
}

async function deleteFromEditor() {
    if (!confirm(t("confirmRemove"))) return;
    try {
        await editor.onDelete();
        await reloadData();
    } catch {
        $("editError").textContent = t("saveError");
        return;
    }
    $("editModal").close();
    toast(t("removed"));
}

function editProject(project) {
    openEditor({
        title: t(project ? "editProject" : "addProject"),
        values: project ? { name: project.name, status: project.status, project_type: project.type || "lines", start_date: project.startDate, end_date: project.endDate } : { status: "layihe", project_type: "lines" },
        fields: [
            { key: "name", label: t("fieldName"), required: true, wide: true },
            { key: "project_type", label: "Layihə növü", type: "select", options: [["lines", "〰️ Magistral Xətt layihəsi"], ["points", "📍 Nöqtə / Antena layihəsi"]], wide: true },
            { key: "status", label: t("thStatus"), type: "select", options: statusOptions(), wide: true },
            { key: "start_date", label: t("fieldStart"), type: "date" },
            { key: "end_date", label: t("fieldEnd"), type: "date" }
        ],
        onSave: row => api.saveProjectRow(project?.id, row),
        onDelete: project && (async () => {
            await api.deleteProject(project.id);
            state.visibleIds.delete(project.id);
            if (state.selected?.projectId === project.id) state.selected = null;
        })
    });
}

const coordsToText = coords => (coords || []).map(c => c.join(", ")).join("\n");

function textToCoords(text, minPoints = 1) {
    const coords = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => line.split(",").map(Number));
    const valid = coords.length >= minPoints && coords.every(c => c.length === 2 && Math.abs(c[0]) <= 90 && Math.abs(c[1]) <= 180 && !c.some(isNaN));
    if (!valid) throw new Error("coords");
    return coords;
}

function useLastDrawing() {
    const shape = [...tools.shapes()].reverse().find(s => s.coords.length >= 1);
    if (!shape) {
        $("editError").textContent = t("noDrawing");
        return;
    }
    $("editForm").elements.coords.value = shape.coords.map(([lng, lat]) => `${lat}, ${lng}`).join("\n");
}

function editSegment(project, item) {
    const isPoints = project?.type === "points";
    const contractorNames = [...new Set(["BCG (Öz briqadamız)", ...Object.keys(state.contractors)])];
    openEditor({
        title: t(item ? "editSegment" : "addSegment"),
        values: item ? {
            code: item.id, name: item.name, point_a: item.pointA, point_b: item.pointB, start_date: item.startDate, end_date: item.endDate,
            contractor: item.contractor, total_km: item.totalKm, done_km: item.doneKm, status: item.status,
            antennas: item.antennas || 0, coords: coordsToText(item.coords)
        } : { status: "layihe", total_km: 0, done_km: 0, antennas: 0, point_a: "Mərkəz", point_b: "Şəbəkə", contractor: "BCG (Öz briqadamız)" },
        fields: [
            { key: "code", label: t("fieldCode"), required: true },
            { key: "status", label: t("thStatus"), type: "select", options: statusOptions() },
            { key: "name", label: t("fieldName"), required: true, wide: true },
            { key: "point_a", label: t("pointA"), required: true },
            { key: "point_b", label: t("pointB"), required: true },
            { key: "start_date", label: t("fieldStart"), type: "date" },
            { key: "end_date", label: t("fieldEnd"), type: "date" },
            { key: "total_km", label: isPoints ? "1. Nəzərdə tutulan (m)" : `1. Nəzərdə tutulan (km)`, type: "number" },
            { key: "done_km", label: isPoints ? "2. Faktiki iş görülən (m)" : `2. Faktiki iş görülən (km)`, type: "number" },
            ...(isPoints ? [{ key: "antennas", label: "Antena sayı (ədəd)", type: "number", wide: true }] : []),
            { key: "contractor", label: "İş icraçısı (BCG və ya Podratçı)", type: "select", wide: true, options: [["", t("notAssigned")], ...contractorNames.map(n => [n, /bcg/i.test(n) ? `🏢 ${n}` : `👷 Podratçı: ${n}`])] },
            { key: "coords", label: t("coordsField"), type: "textarea", wide: true, required: true, placeholder: "41.4205, 46.9242", action: { label: t("useLastDrawing"), run: useLastDrawing } }
        ],
        onSave: async row => {
            await api.saveSegment(project.id, item?.id, {
                ...row,
                antennas: Number(row.antennas || 0),
                contractor: row.contractor || null,
                coords: textToCoords(row.coords, isPoints ? 1 : 2)
            });
            if (item) state.selected = { projectId: project.id, itemId: row.code };
        },
        onDelete: item && (async () => {
            await api.deleteSegment(project.id, item.id);
            state.selected = null;
        })
    });
}

function editContractor(name) {
    const info = name ? state.contractors[name] : { workers: 0, machinery: 0 };
    openEditor({
        title: t(name ? "editContractor" : "addContractor"),
        values: { ...info, name: name || "" },
        fields: [
            { key: "name", label: t("fieldName"), required: true, wide: true },
            { key: "workers", label: t("workers"), type: "number" },
            { key: "machinery", label: t("machinery"), type: "number" },
            { key: "engineer", label: t("engineer"), wide: true }
        ],
        onSave: row => api.saveContractor(name, row),
        onDelete: name && (() => api.deleteContractor(name))
    });
}

const MATERIAL_STATES = ["ordered", "instock", "issued", "installed"];
const materialStateLabel = s => I18N[state.lang][`state${s}`] || s;

function editMaterial(material) {
    const current = material?.state;
    const states = current && !MATERIAL_STATES.includes(current) ? [...MATERIAL_STATES, current] : MATERIAL_STATES;
    const today = new Date().toISOString().slice(0, 10);
    openEditor({
        title: t(material ? "editMaterial" : "addMaterial"),
        values: material ? {
            ...material,
            invoice_no: material.invoice_no || `QAİMƏ-2026-0${140 + (material.id || 1)}`,
            issued_qty: material.issued_qty || material.quantity || "",
            used_qty: material.used_qty || material.quantity || "",
            used_date: material.used_date || today
        } : {
            invoice_no: `QAİMƏ-2026-${Math.floor(100 + Math.random() * 900)}`,
            state: "issued",
            used_date: today
        },
        fields: [
            { key: "invoice_no", label: "📄 Anbar Qaiməsi №", required: true, wide: true },
            { key: "project", label: t("thProject"), required: true, wide: true },
            { key: "material", label: t("thMaterial"), required: true, wide: true },
            { key: "issued_qty", label: "📦 Anbardan verilən (göndərilən)", required: true },
            { key: "used_qty", label: "🛠️ İstifadə olunan (faktiki sərf)", required: true },
            { key: "used_date", label: "Tarix", type: "date", required: true },
            { key: "state", label: t("thState"), type: "select", required: true, options: states.map(s => [s, materialStateLabel(s)]) }
        ],
        onSave: row => api.saveMaterial(material?.id, { ...row, quantity: row.used_qty || row.issued_qty }),
        onDelete: material && (() => api.deleteMaterial(material.id))
    });
}

/* LİNKLƏ PAYLAŞMA */
const shareUrl = token => `${location.origin}${location.pathname}?share=${token}`;

async function enterSharedView(token) {
    document.body.classList.add("shared");
    let projects = [];
    try {
        projects = await api.loadShared(token);
    } catch { /* Xarab token etibarsız link kimi göstərilir */ }
    if (projects.length === 0) {
        $("linkError").hidden = false;
        return;
    }
    state.projects = projects;
    projects.forEach(p => state.visibleIds.add(p.id));
    renderAll();
    const extras = await api.loadSharedExtras(token).catch(() => null);
    if (extras?.drawings) tools.loadShared(extras.drawings);
    if (extras?.view) map.jumpTo(extras.view);
}

async function renderShares() {
    $("shareHint").textContent = `${t("shareHint")} (${state.visibleIds.size})`;
    const links = await api.listShares();
    $("shareList").innerHTML = links.map(l => `
        <div class="note">
            <p><a class="link share-url" href="${shareUrl(l.token)}" target="_blank" rel="noopener">${shareUrl(l.token)}</a>
                <small>${l.project_ids.length} ${t("projectsUnit")} · ${l.expires_at ? new Date(l.expires_at).toLocaleDateString(state.lang) : t("daysNever")}</small></p>
            <button class="icon-btn" data-copy="${l.token}" title="${t("copy")}"><i class="fa-regular fa-copy"></i></button>
            <button class="icon-btn" data-revoke="${l.token}" title="${t("shareRevoke")}"><i class="fa-regular fa-trash-can"></i></button>
        </div>
    `).join("");
}

async function copyShare(token) {
    try {
        await navigator.clipboard.writeText(shareUrl(token));
        toast(t("shareCopied"));
    } catch {
        // Brauzer kopyalamağa icazə vermədisə link siyahıda görünür, əl ilə kopyalanır
        toast(t("shareCreated"));
    }
}

async function createShare(event) {
    event.preventDefault();
    if (state.visibleIds.size === 0) {
        toast(t("shareNothing"), true);
        return;
    }
    let link;
    try {
        const view = { center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
        link = await api.createShare([...state.visibleIds], Number($("shareDays").value), tools.shapes(), view);
    } catch {
        toast(t("saveError"), true);
        return;
    }
    await renderShares().catch(() => {});
    await copyShare(link.token);
}

/* XƏRİTƏ */
const esriTiles = path => [`https://server.arcgisonline.com/ArcGIS/rest/services/${path}/MapServer/tile/{z}/{y}/{x}`];

const BASE_MAPS = {
    satellite: { icon: "fa-satellite", label: "layerSatellite", raster: "esri", bg: "#1c2a30", names: true },
    street: { icon: "fa-road", label: "layerStreet", raster: "osm", bg: "#dfe6ea" },
    dark: { icon: "fa-moon", label: "layerDark", raster: "carto", bg: "#0e1a2b" },
    blank: { icon: "fa-square", label: "layerBlank", bg: "#ffffff" }
};
const NAME_LAYERS = ["esri-transport", "esri-places"];

function mapStyle() {
    const raster = (tiles, tileSize, maxzoom, attribution = "") => ({ type: "raster", tiles, tileSize, maxzoom, attribution });
    const empty = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
    const rasterLayer = id => ({ id, type: "raster", source: id, layout: { visibility: "none" } });
    return {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
            esri: raster(esriTiles("World_Imagery"), 256, 19, "Imagery &copy; Esri, Maxar, Earthstar Geographics"),
            "esri-transport": raster(esriTiles("Reference/World_Transportation"), 256, 19),
            "esri-places": raster(esriTiles("Reference/World_Boundaries_and_Places"), 256, 19),
            osm: raster(["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], 256, 19, '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'),
            carto: raster(["a", "b", "c", "d"].map(s => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png`), 256, 20, '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'),
            routes: empty,
            draw: empty
        },
        layers: [
            { id: "bg", type: "background", paint: { "background-color": "#1c2a30" } },
            rasterLayer("esri"), rasterLayer("esri-transport"), rasterLayer("esri-places"), rasterLayer("osm"), rasterLayer("carto"),
            { id: "routes-casing", type: "line", source: "routes", filter: ["==", ["geometry-type"], "LineString"], layout: { "line-cap": "round", "line-join": "round" },
                paint: { "line-color": ["case", ["get", "sel"], "#ffffff", "#04101c"], "line-width": ["case", ["get", "sel"], 10, 7], "line-opacity": ["case", ["get", "sel"], 1, .5] } },
            { id: "routes-line", type: "line", source: "routes", filter: ["==", ["geometry-type"], "LineString"], layout: { "line-cap": "round", "line-join": "round" },
                paint: { "line-color": ["get", "color"], "line-width": ["case", ["get", "sel"], 6, 4] } },
            { id: "routes-hit", type: "line", source: "routes", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#000", "line-width": 16, "line-opacity": 0 } },
            { id: "routes-ends", type: "circle", source: "routes", minzoom: ENDPOINT_MIN_ZOOM, filter: ["all", ["==", ["geometry-type"], "Point"], ["!", ["has", "isRayonPoint"]]],
                paint: { "circle-radius": 5, "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } },
            { id: "routes-point-halo", type: "circle", source: "routes", filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "isRayonPoint"]],
                paint: {
                    "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, ["case", ["get", "sel"], 15, 11], 14, ["case", ["get", "sel"], 10, 7.5]],
                    "circle-color": ["get", "color"],
                    "circle-opacity": 0.28,
                    "circle-stroke-color": ["case", ["get", "sel"], "#ffffff", ["get", "color"]],
                    "circle-stroke-width": ["case", ["get", "sel"], 2.8, 1.8]
                } },
            { id: "routes-point-core", type: "circle", source: "routes", filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "isRayonPoint"]],
                paint: {
                    "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 5.5, 14, 4],
                    "circle-color": ["get", "color"],
                    "circle-stroke-color": "#ffffff",
                    "circle-stroke-width": 1.8
                } },
            { id: "routes-point-label", type: "symbol", source: "routes", filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "isRayonPoint"]],
                layout: {
                    "text-field": ["get", "label"],
                    "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
                    "text-size": ["interpolate", ["linear"], ["zoom"], 6, 11.8, 10, 10.4, 14, 9.0, 18, 7.8],
                    "text-variable-anchor": ["top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"],
                    "text-radial-offset": ["interpolate", ["linear"], ["zoom"], 6, 1.05, 14, 0.75],
                    "text-padding": 4,
                    "text-allow-overlap": false,
                    "text-ignore-placement": false
                },
                paint: {
                    "text-color": "#ffffff",
                    "text-halo-color": "#0b1524",
                    "text-halo-width": 2.2,
                    "text-halo-blur": 0.4
                } },
            ...tools.layers()
        ]
    };
}

function initMap() {
    map = new maplibregl.Map({
        container: "map",
        style: mapStyle(),
        bounds: toLngLatBounds(AZERBAIJAN_BOUNDS),
        fitBoundsOptions: { padding: MAP_PADDING },
        minZoom: 3,
        maxZoom: 23,
        maxPitch: 80,
        // Sağ düymə yalnız yaxınlaşdırır, orta düymə fırladır və əyir
        dragRotate: false,
        attributionControl: false,
        preserveDrawingBuffer: true
    });
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110 }), "bottom-right");
    routePopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "map-tip", offset: 12, maxWidth: "300px" });

    map.on("load", () => {
        switchBaseLayer("satellite");
        tools.init();
        drawRoutes();
    });
    map.on("click", onMapClick);
    map.on("mousemove", e => {
        $("cursorCoords").textContent = `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`;
    });
    map.on("rotate", () => {
        $("northIcon").style.transform = `rotate(${-45 - map.getBearing()}deg)`;
    });
    ["routes-hit", "routes-ends", "routes-point-halo", "routes-point-core", "routes-point-label"].forEach(layer => {
        map.on("mousemove", layer, e => {
            if (tools.isActive()) return;
            window.routeHover = true;
            map.getCanvas().style.cursor = "pointer";
            routePopup.setLngLat(e.lngLat).setHTML(e.features[0].properties.tip).addTo(map);
        });
        map.on("mouseleave", layer, () => {
            window.routeHover = false;
            map.getCanvas().style.cursor = tools.isActive() ? "crosshair" : "";
            routePopup.remove();
        });
    });

    initMouseGestures();
}

const MAP_PADDING = { top: 24, left: 24, right: 60, bottom: 24 };

function toLngLatBounds(latLngPairs) {
    const valid = (latLngPairs || []).filter(p => Array.isArray(p) && p.length === 2);
    if (valid.length === 1) {
        const [lat, lng] = valid[0];
        return new maplibregl.LngLatBounds([lng - 0.08, lat - 0.08], [lng + 0.08, lat + 0.08]);
    }
    return valid.reduce((b, [lat, lng]) => b.extend([lng, lat]), new maplibregl.LngLatBounds());
}

function fitHome(animate = true) {
    map.fitBounds(toLngLatBounds(AZERBAIJAN_BOUNDS), { padding: MAP_PADDING, animate, bearing: 0, pitch: 0 });
}

function flyToCoords(coords) {
    if (!coords || coords.length === 0) return;
    map.fitBounds(toLngLatBounds(coords), { padding: MAP_PADDING, maxZoom: 13 });
}

function switchBaseLayer(name) {
    const base = BASE_MAPS[name];
    currentBase = name;
    ["esri", "osm", "carto"].forEach(id => map.setLayoutProperty(id, "visibility", id === base.raster ? "visible" : "none"));
    map.setPaintProperty("bg", "background-color", base.bg);
    applyNames();
    renderLayerOptions();
}

function applyNames() {
    const visible = namesOn && BASE_MAPS[currentBase].names;
    NAME_LAYERS.forEach(id => map.setLayoutProperty(id, "visibility", visible ? "visible" : "none"));
    $("namesBtn").classList.toggle("active", namesOn);
}

/* Google Earth tərzi: sağ düymə yuxarı-aşağı yaxınlaşdırır, orta düymə fırladır və əyir */
function initMouseGestures() {
    const box = map.getCanvasContainer();
    let rightMoved = false;

    box.addEventListener("mousedown", e => {
        if (e.button !== 1 && e.button !== 2) return;
        e.preventDefault();
        map.stop();
        const x0 = e.clientX, y0 = e.clientY;
        let move;

        if (e.button === 2) {
            const rect = box.getBoundingClientRect();
            const around = map.unproject([x0 - rect.left, y0 - rect.top]);
            const zoom0 = map.getZoom();
            rightMoved = false;
            move = ev => {
                if (window.__scaleFrozen) return;
                if (Math.abs(ev.clientY - y0) > 3) rightMoved = true;
                map.zoomTo(zoom0 + (ev.clientY - y0) / 150, { around, duration: 0 });
            };
        } else {
            const bearing0 = map.getBearing(), pitch0 = map.getPitch();
            box.style.cursor = "move";
            move = ev => {
                if (window.__scaleFrozen) return;
                map.jumpTo({
                    bearing: bearing0 + (ev.clientX - x0) * .4,
                    pitch: Math.max(0, Math.min(map.getMaxPitch(), pitch0 - (ev.clientY - y0) * .3))
                });
            };
        }
        const up = () => {
            box.style.cursor = "";
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    });

    box.addEventListener("contextmenu", e => {
        e.preventDefault();
        if (!rightMoved) tools.rightClick();
    });
    box.addEventListener("auxclick", e => { if (e.button === 1) e.preventDefault(); });
}

function drawRoutes() {
    const source = map.getSource("routes");
    if (!source) return;
    const selected = selectedEntry();
    const features = [];
    const pointSlots = {};

    visibleEntries().forEach(({ project, item: r }) => {
        if (!r.coords || r.coords.length === 0) return;
        const color = statusTone(r.status);
        const isPointItem = project.type === "points" || r.coords.length === 1 || (r.antennas || 0) > 0;

        if (isPointItem) {
            const [lat, lng] = r.coords[0];
            const slotKey = `${lat.toFixed(2)}_${lng.toFixed(2)}`;
            const slot = pointSlots[slotKey] || 0;
            pointSlots[slotKey] = slot + 1;
            const adjLng = lng + slot * 0.022;
            const adjLat = lat + (slot % 2 ? 0.008 : 0);

            const cleanName = String(r.name || "").replace(/\s*rayon(u)?\b/gi, "").trim();
            const antPart = r.antennas ? `${r.antennas} ant · ` : "";
            // 1-ci Nəzərdə tutulan, 2-ci Faktiki iş görülən
            const label = `${cleanName}: ${antPart}${formatKm(r.totalKm)} / ${formatKm(r.doneKm)} m`;
            const tip = `<b>${esc(cleanName)}</b><small>📡 ${r.antennas || 0} antena · Plan: ${formatKm(r.totalKm)} m – Faktiki: ${formatKm(r.doneKm)} m (${percent(r.doneKm, r.totalKm)}%)<br>İş icraçısı: ${esc(r.contractor || "BCG (Öz briqadamız)")}</small>`;

            features.push({
                type: "Feature",
                geometry: { type: "Point", coordinates: [adjLng, adjLat] },
                properties: {
                    isRayonPoint: true,
                    color,
                    sel: selected?.item === r,
                    projectId: project.id,
                    itemId: r.id,
                    label,
                    tip
                }
            });
        } else if (r.coords.length >= 2) {
            const line = r.coords.map(([lat, lng]) => [lng, lat]);
            features.push({
                type: "Feature", geometry: { type: "LineString", coordinates: line },
                properties: {
                    color,
                    sel: selected?.item === r,
                    projectId: project.id,
                    itemId: r.id,
                    tip: `<b>${esc(r.name)}</b><small>${esc(r.id)} · Plan: ${formatKm(r.totalKm)} km / Faktiki: ${formatKm(r.doneKm)} km (${percent(r.doneKm, r.totalKm)}%)</small>`
                }
            });
            [[line[0], `A: ${r.pointA}`], [line[line.length - 1], `B: ${r.pointB}`]].forEach(([coordinates, label]) => features.push({
                type: "Feature", geometry: { type: "Point", coordinates }, properties: { color, tip: esc(label) }
            }));
        }
    });
    source.setData({ type: "FeatureCollection", features });
}

function routePaths() {
    return visibleEntries().filter(({ item }) => item.coords?.length >= 2).map(({ item }) => item.coords.map(([lat, lng]) => [lng, lat]));
}

function selectedEntry() {
    if (!state.selected) return null;
    const project = state.projects.find(p => p.id === state.selected.projectId);
    const item = project?.items.find(r => r.id === state.selected.itemId);
    return item ? { project, item } : null;
}

function selectSegment(project, item) {
    state.selected = { projectId: project.id, itemId: item.id };
    state.expandedIds.add(project.id);
    setSidebar(true);
    renderAll();
    flyToCoords(item.coords);
}

function clearSelection() {
    state.selected = null;
    renderAll();
}

function onMapClick(e) {
    $("coordClicked").value = `${e.lngLat.lat.toFixed(6)}, ${e.lngLat.lng.toFixed(6)}`;
    if (tools.handleClick(e)) return;
    if (isPhone()) {
        setSidebar(false);
        setDrawer(false);
    }
    const box = [[e.point.x - 5, e.point.y - 5], [e.point.x + 5, e.point.y + 5]];
    const hit = map.queryRenderedFeatures(box, { layers: ["routes-point-halo", "routes-point-core", "routes-point-label", "routes-hit"] })[0];
    if (!hit) return;
    const project = state.projects.find(p => p.id === hit.properties.projectId);
    if (project) selectSegment(project, project.items.find(r => r.id === hit.properties.itemId));
}

/* KOORDİNAT */
function goToCoords(event) {
    event.preventDefault();
    const parts = $("coordGoTo").value.split(",").map(s => parseFloat(s));
    const [lat, lng] = parts;
    if (parts.length !== 2 || isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        toast(t("coordInvalid"), true);
        return;
    }
    goToMarker?.remove();
    const pin = document.createElement("div");
    pin.className = "pin";
    goToMarker = new maplibregl.Marker({ element: pin })
        .setLngLat([lng, lat])
        .setPopup(new maplibregl.Popup({ offset: 12 }).setText(`${t("coordSearched")}: ${lat}, ${lng}`))
        .addTo(map);
    map.flyTo({ center: [lng, lat], zoom: 17 });
    goToMarker.togglePopup();
}

async function copyCoord() {
    const value = $("coordClicked").value;
    if (!value) return;
    try {
        await navigator.clipboard.writeText(value);
    } catch {
        $("coordClicked").select();
        document.execCommand("copy");
    }
    toast(`${t("copied")}: ${value}`);
}

/* PANELLƏR */
function closePopovers(except) {
    [["layersPopover", "layersBtn"], ["coordPopover", "coordBtn"]].forEach(([popover, button]) => {
        if (popover === except) return;
        $(popover).hidden = true;
        $(button).classList.remove("active");
    });
}

function togglePopover(popover, button) {
    closePopovers(popover);
    const opening = $(popover).hidden;
    $(popover).hidden = !opening;
    $(button).classList.toggle("active", opening);
}

const isPhone = () => window.innerWidth <= 860;

/* Telefonda sol panel və cədvəl aşağıda eyni yeri tutur: eyni anda biri açıqdır */
function setSidebar(open) {
    $("workspace").classList.toggle("sidebar-closed", !open);
    if (isPhone()) {
        $("drawer").classList.toggle("sheet", open);
        if (open && $("drawer").classList.contains("open")) setDrawer(false);
        updateDockArrow();
    }
    map?.resize();
}

function updateDockArrow() {
    const open = $("drawer").classList.contains("open") || $("drawer").classList.contains("sheet");
    $("drawerArrow").className = `fa-solid ${open ? "fa-chevron-down" : "fa-chevron-up"}`;
}

function setDrawer(open) {
    $("drawer").classList.toggle("open", open);
    $("drawerBody").hidden = !open;
    $("drawerToggle").setAttribute("aria-expanded", open);
    if (open && isPhone()) setSidebar(false);
    updateDockArrow();
    map.resize();
}

function setDockTab(tab) {
    if (tab === "projects") {
        setSidebar(true);
        return;
    }
    state.dockTab = tab;
    document.querySelectorAll(".tab").forEach(el => el.classList.toggle("active", el.dataset.tab === tab));
    $("segmentsPane").hidden = tab !== "segments";
    $("contractorsPane").hidden = tab !== "contractors";
    setDrawer(true);
}

function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
}

function renderLayerOptions() {
    $("layerOptions").innerHTML = Object.entries(BASE_MAPS).map(([name, base]) => `
        <button class="layer-opt ${name === currentBase ? "active" : ""}" data-layer="${name}">
            <i class="fa-solid ${base.icon}"></i> ${t(base.label)}
        </button>
    `).join("");
}

function renderLegend() {
    $("legend").innerHTML = STATUSES.map(s => `<div class="legend-row"><span class="legend-line" style="background:${STATUS_COLORS[s]}"></span>${t(`status${s}`)}</div>`).join("");
}

function statusTone(status) {
    return STATUS_COLORS[status] || STATUS_COLORS.layihe;
}

function renderChips() {
    const items = state.projects.flatMap(p => p.items);
    const count = key => key === "all" ? items.length : items.filter(r => r.status === key).length;
    const chips = [{ key: "all", label: t("filterAll") }, ...STATUSES.map(s => ({ key: s, label: t(`status${s}`), color: STATUS_COLORS[s] }))];
    $("statusChips").innerHTML = chips.map(c => `
        <button class="chip ${state.statusFilter === c.key ? "active" : ""}" data-status="${c.key}">
            ${c.color ? `<span class="dot" style="background:${c.color}"></span>` : ""}${c.label} <b>${count(c.key)}</b>
        </button>
    `).join("");
}

function renderKpis() {
    const sum = totals(visibleEntries().map(e => e.item));
    const left = Math.max(0, sum.plan - sum.done);
    const pct = percent(sum.done, sum.plan);
    const kpi = (label, value, unit) => `<div class="kpi"><small>${label}</small><b>${value}<em>${unit}</em></b></div>`;

    $("kpis").innerHTML = kpi(t("kpiTotal"), formatKm(sum.plan), "km") + kpi(t("kpiDone"), formatKm(sum.done), "km")
        + kpi(t("kpiLeft"), formatKm(left), "km") + kpi(t("kpiProgress"), pct, "%");
    $("totalProgress").style.width = `${pct}%`;
    $("drawerSummary").textContent = `${formatKm(sum.done)} / ${formatKm(sum.plan)} km · ${pct}%`;
}

function renderProjects() {
    const filtering = state.statusFilter !== "all" || state.query;
    const shown = state.projects.filter(p => !filtering || filteredItems(p).length > 0);
    $("projectCount").textContent = shown.length;

    $("projectList").innerHTML = shown.length === 0 ? `<div class="empty">${t("noResults")}</div>` : shown.map(p => {
        const visible = state.visibleIds.has(p.id);
        const expanded = state.expandedIds.has(p.id);
        const sum = totals(p.items);
        const pct = percent(sum.done, sum.plan);
        const isPoints = p.type === "points";
        const totalAnt = p.items.reduce((s, r) => s + (r.antennas || 0), 0);
        // 1-ci Nəzərdə tutulan, 2-ci Faktiki iş görülən ("rayon" sözü olmadan)
        const subTitle = isPoints
            ? `📡 ${totalAnt} ant · ${formatKm(sum.plan)} m / ${formatKm(sum.done)} m`
            : `〰️ ${formatKm(sum.plan)} / ${formatKm(sum.done)} km · Qalıb: ${formatKm(Math.max(0, sum.plan - sum.done))} km`;

        return `
            <div class="project ${visible ? "" : "hidden-on-map"}" data-id="${esc(p.id)}">
                <div class="project-row">
                    <label class="check" title="${t("toggleVisibility")}"><input type="checkbox" data-action="toggle" ${visible ? "checked" : ""}></label>
                    <button class="project-main" data-action="expand" aria-expanded="${expanded}">
                        <strong title="${esc(p.name)}">${esc(p.name)}</strong>
                        <small>${subTitle}</small>
                    </button>
                    <span class="project-pct">${pct}%</span>
                    ${isAdmin() ? `<button class="icon-btn" data-action="edit" title="${t("editProject")}"><i class="fa-solid fa-pen"></i></button>` : ""}
                    <button class="icon-btn" data-action="expand" aria-label="${esc(p.name)}"><i class="fa-solid fa-chevron-right chevron ${expanded ? "open" : ""}"></i></button>
                </div>
                ${expanded ? `<div class="segments">${filteredItems(p).map(r => {
                    const cleanName = String(r.name || "").replace(/\s*rayon(u)?\b/gi, "").trim();
                    const rightText = isPoints
                        ? `${r.antennas || 0} ant · ${formatKm(r.totalKm)} / ${formatKm(r.doneKm)} m`
                        : `${formatKm(r.totalKm)} / ${formatKm(r.doneKm)} km (${percent(r.doneKm, r.totalKm)}%)`;
                    return `
                    <button class="segment ${state.selected?.itemId === r.id && state.selected?.projectId === p.id ? "selected" : ""}" data-action="focus" data-item="${esc(r.id)}">
                        <span class="dot" style="background:${statusTone(r.status)}"></span>
                        <span class="segment-name" title="${esc(cleanName)}">${esc(cleanName)}</span>
                        <span style="color:${statusTone(r.status)};font-weight:600;white-space:nowrap">${rightText}</span>
                    </button>`;
                }).join("")}${isAdmin() ? `<button class="link add-seg" data-action="addSegment">+ ${t("addSegment")}</button>` : ""}</div>` : ""}
            </div>`;
    }).join("");
}

function renderDetail() {
    const entry = selectedEntry();
    $("listView").hidden = Boolean(entry);
    $("detailView").hidden = !entry;
    if (!entry) return;

    const { project, item: r } = entry;
    const tone = statusTone(r.status);
    const pct = percent(r.doneKm, r.totalKm);
    const info = state.contractors[r.contractor];
    const row = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;

    $("detailView").innerHTML = `
        <div class="detail-head">
            <button class="icon-btn" data-action="back" title="${t("backToList")}"><i class="fa-solid fa-arrow-left"></i></button>
            <span>${t("backToList")}</span>
        </div>
        <div class="detail-body">
            <div class="detail-title">
                <small>${esc(r.id)} · ${esc(project.name)}</small>
                <h2>${esc(r.name)}</h2>
                <span class="pill" style="--tone:${tone}"><span class="dot" style="background:${tone}"></span>${t(`status${r.status}`)}</span>
            </div>
            <div class="route">
                <i class="fa-solid fa-circle"></i><strong>${esc(r.pointA)}</strong>
                <span class="stem"></span><span></span>
                <i class="fa-solid fa-circle"></i><strong>${esc(r.pointB)}</strong>
            </div>
            <div>
                <div class="meter-row"><b>${pct}%</b><span class="muted">${formatKm(r.doneKm)} / ${formatKm(r.totalKm)} km</span></div>
                <div class="progress"><span style="width:${pct}%;background:${tone}"></span></div>
            </div>
            <dl class="spec">
                ${row(t("thLeft"), `${formatKm(Math.max(0, r.totalKm - r.doneKm))} km`)}
                ${row(t("thDates"), `${formatDate(r.startDate)} – ${formatDate(r.endDate)}`)}
                ${row(t("closures"), r.closures || 0)}
                ${row(t("manholes"), r.manholes || 0)}
            </dl>
            <dl class="spec">
                ${row(t("thContractor"), esc(r.contractor || t("notAssigned")))}
                ${info ? row(t("workers"), info.workers) + row(t("machinery"), info.machinery) + row(t("engineer"), esc(info.engineer)) : ""}
            </dl>
            <button class="btn btn-outline" data-action="zoom"><i class="fa-solid fa-crosshairs"></i> ${t("zoomTo")}</button>
            ${isAdmin() ? `<button class="btn btn-primary" data-action="edit"><i class="fa-solid fa-pen"></i> ${t("editSegment")}</button>` : ""}
        </div>
    `;
}

function renderTable() {
    const entries = visibleEntries();
    const selected = selectedEntry();
    $("drawerCount").textContent = entries.length;
    $("tableHead").innerHTML = `<tr>
        <th>${t("thRoute")}</th><th>${t("thDates")}</th><th>${t("thContractor")}</th>
        <th class="num">${t("thTotal")}</th><th class="num">${t("thDone")}</th><th class="num">${t("thLeft")}</th>
        <th>${t("thAssets")}</th><th>${t("thStatus")}</th>
    </tr>`;

    $("tableBody").innerHTML = entries.map(({ project, item: r }, index) => `
        <tr data-index="${index}" class="${selected?.item === r ? "selected" : ""}">
            <td><b>${esc(r.pointA)} ➔ ${esc(r.pointB)}</b><small>${esc(project.name)} · ${esc(r.name)}</small></td>
            <td>${formatDate(r.startDate)} – ${formatDate(r.endDate)}</td>
            <td>${esc(r.contractor || t("notAssigned"))}</td>
            <td class="num">${formatKm(r.totalKm)} km</td>
            <td class="num">${formatKm(r.doneKm)} km</td>
            <td class="num">${formatKm(Math.max(0, r.totalKm - r.doneKm))} km</td>
            <td>${r.closures || 0} / ${r.manholes || 0}</td>
            <td><span class="pill" style="--tone:${statusTone(r.status)}">${t(`status${r.status}`)}</span></td>
        </tr>
    `).join("");

    const sum = totals(entries.map(e => e.item));
    $("tableFoot").innerHTML = entries.length === 0 ? "" : `<tr>
        <td colspan="3">${t("grandTotal")}</td>
        <td class="num">${formatKm(sum.plan)} km</td>
        <td class="num">${formatKm(sum.done)} km</td>
        <td class="num">${formatKm(Math.max(0, sum.plan - sum.done))} km</td>
        <td colspan="2">${sum.closures} ${t("closuresUnit")} / ${sum.manholes} ${t("manholesUnit")}</td>
    </tr>`;
}

function renderContractors() {
    const names = [...new Set(visibleEntries().map(e => e.item.contractor).filter(Boolean))];
    $("contractorCount").textContent = names.length;
    $("contractorHead").innerHTML = `<tr><th>${t("thContractor")}</th><th class="num">${t("workers")}</th><th class="num">${t("machinery")}</th><th>${t("engineer")}</th>${isAdmin() ? "<th></th>" : ""}</tr>`;
    if (isAdmin()) names.push(...Object.keys(state.contractors).filter(n => !names.includes(n)));
    $("contractorList").innerHTML = names.map(name => {
        const info = state.contractors[name];
        return `<tr>
            <td><b>${esc(name)}</b></td>
            <td class="num">${info ? info.workers : "—"}</td>
            <td class="num">${info ? info.machinery : "—"}</td>
            <td>${info ? esc(info.engineer) : t("notAssigned")}</td>
            ${isAdmin() ? `<td class="num"><button class="icon-btn" data-edit-contractor="${esc(name)}" title="${t("editContractor")}"><i class="fa-solid fa-pen"></i></button></td>` : ""}
        </tr>`;
    }).join("") + (isAdmin() ? `<tr class="row-add"><td colspan="5"><button class="link" data-edit-contractor="">+ ${t("addContractor")}</button></td></tr>` : "");
}

function renderMaterials() {
    $("materialsHead").innerHTML = `<tr><th>${t("thProject")}</th><th>${t("thMaterial")}</th><th>${t("thQuantity")}</th><th>${t("thState")}</th>${isAdmin() ? "<th></th>" : ""}</tr>`;
    $("materialsBody").innerHTML = state.materials.map(m => `
        <tr><td>${esc(m.project)}</td><td>${esc(m.material)}</td><td>${esc(m.quantity)}</td><td>${esc(materialStateLabel(m.state))}</td>
            ${isAdmin() ? `<td class="num"><button class="icon-btn" data-edit-material="${m.id}" title="${t("editMaterial")}"><i class="fa-solid fa-pen"></i></button></td>` : ""}</tr>
    `).join("") + (isAdmin() ? `<tr class="row-add"><td colspan="5"><button class="link" data-edit-material="">+ ${t("addMaterial")}</button></td></tr>` : "");
}

function renderAll() {
    renderKpis();
    renderChips();
    renderProjects();
    renderDetail();
    renderTable();
    renderContractors();
    drawRoutes();
}

/* QEYDLƏR */
function renderNotes() {
    $("notesList").innerHTML = state.notes.length === 0
        ? `<div class="empty">${t("notesEmpty")}</div>`
        : state.notes.map(n => `
            <div class="note">
                <p>${esc(n.text)}<small>${esc(n.author)} · ${new Date(n.date).toLocaleString(state.lang)}</small></p>
                ${isAdmin() || n.userId === state.user?.id ? `<button class="icon-btn small" data-id="${n.id}" title="${t("delete")}"><i class="fa-solid fa-trash"></i></button>` : ""}
            </div>`).join("");
    $("notesCount").hidden = state.notes.length === 0;
    $("notesCount").textContent = state.notes.length;
}

async function addNote(event) {
    event.preventDefault();
    const text = $("noteInput").value.trim();
    if (!text) return;
    try {
        state.notes.unshift(await api.addNote(text));
    } catch {
        toast(t("saveError"), true);
        return;
    }
    $("noteInput").value = "";
    renderNotes();
    toast(t("noteAdded"));
}

async function deleteNote(id) {
    try {
        await api.deleteNote(id);
    } catch {
        toast(t("saveError"), true);
        return;
    }
    state.notes = state.notes.filter(n => n.id !== id);
    renderNotes();
}

/* İMPORT: GeoJSON, KML, KMZ (həm Xətt, həm də Nöqtə layihələri üçün ArcGIS Pro atribut dəstəyi ilə) */
function linesFromGeoJson(data) {
    const items = [];
    const addGeometry = (geometry, props = {}) => {
        if (!geometry) return;
        const name = String(props.name || props.NAME || props.rayon || props.RAYON || "").replace(/\s*rayon(u)?\b/gi, "").trim();
        if (geometry.type === "Point") {
            const [lng, lat] = geometry.coordinates;
            items.push({ isPoint: true, name, props, coords: [[lat, lng]] });
        } else if (geometry.type === "MultiPoint") {
            geometry.coordinates.forEach(([lng, lat]) => items.push({ isPoint: true, name, props, coords: [[lat, lng]] }));
        } else if (geometry.type === "LineString") {
            items.push({ isPoint: false, name, props, coords: geometry.coordinates.map(c => [c[1], c[0]]) });
        } else if (geometry.type === "MultiLineString") {
            geometry.coordinates.forEach(part => items.push({ isPoint: false, name, props, coords: part.map(c => [c[1], c[0]]) }));
        } else if (geometry.type === "GeometryCollection") {
            geometry.geometries.forEach(g => addGeometry(g, props));
        }
    };
    const features = data.type === "FeatureCollection" ? data.features : data.type === "Feature" ? [data] : [{ geometry: data }];
    features.forEach(f => addGeometry(f.geometry, f.properties || {}));
    return items;
}

function linesFromKml(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Invalid KML");

    const items = [];
    Array.from(doc.getElementsByTagName("LineString")).forEach(node => {
        const coordsNode = node.getElementsByTagName("coordinates")[0];
        if (!coordsNode) return;
        const coords = coordsNode.textContent.trim().split(/\s+/).map(tuple => {
            const [lng, lat] = tuple.split(",").map(Number);
            return [lat, lng];
        }).filter(c => !isNaN(c[0]) && !isNaN(c[1]));

        let placemark = node.parentNode;
        while (placemark && placemark.nodeName !== "Placemark") placemark = placemark.parentNode;
        const nameNode = placemark && Array.from(placemark.children).find(el => el.nodeName === "name");
        items.push({ isPoint: false, name: nameNode?.textContent.trim(), props: {}, coords });
    });
    Array.from(doc.getElementsByTagName("Point")).forEach(node => {
        const coordsNode = node.getElementsByTagName("coordinates")[0];
        if (!coordsNode) return;
        const [lng, lat] = coordsNode.textContent.trim().split(",").map(Number);
        if (isNaN(lat) || isNaN(lng)) return;
        let placemark = node.parentNode;
        while (placemark && placemark.nodeName !== "Placemark") placemark = placemark.parentNode;
        const nameNode = placemark && Array.from(placemark.children).find(el => el.nodeName === "name");
        items.push({ isPoint: true, name: String(nameNode?.textContent.trim() || "").replace(/\s*rayon(u)?\b/gi, "").trim(), props: {}, coords: [[lat, lng]] });
    });
    return items;
}

async function readLines(file) {
    const extension = file.name.split(".").pop().toLowerCase();
    if (extension === "kmz") {
        const zip = await JSZip.loadAsync(file);
        const kml = Object.values(zip.files).find(f => /\.kml$/i.test(f.name));
        if (!kml) return [];
        return linesFromKml(await kml.async("string"));
    }
    const text = await file.text();
    return extension === "kml" ? linesFromKml(text) : linesFromGeoJson(JSON.parse(text));
}

function projectFromFile(fileName, lines) {
    const id = `proj_custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const hasPoints = lines.some(l => l.isPoint || l.coords.length === 1);
    return {
        id, imported: true, type: hasPoints ? "points" : "lines", status: "layihe", startDate: "", endDate: "",
        name: fileName.replace(/\.[^/.]+$/, ""),
        items: lines.map((line, index) => {
            const p = line.props || {};
            const rawStatus = String(p.status || p.STATUS || "layihe").toLowerCase();
            const status = STATUSES.includes(rawStatus) ? rawStatus : "layihe";
            const contractor = p.contractor || p.CONTRACTOR || p.icraci || "BCG (Öz briqadamız)";
            if (line.isPoint || line.coords.length === 1) {
                const planM = Number(p.plan_m ?? p.planM ?? p.total_m ?? p.total_km ?? 10000);
                const doneM = Math.min(planM, Number(p.done_m ?? p.doneM ?? p.done_km ?? 0));
                const antennas = Number(p.antennas ?? p.antena ?? p.ANTENNAS ?? 10);
                return {
                    id: `PT-${String(index + 1).padStart(2, "0")}`,
                    name: line.name || `Məntəqə ${index + 1}`,
                    pointA: line.name || "Mərkəz", pointB: "Şəbəkə", startDate: "", endDate: "", contractor,
                    totalKm: planM, doneKm: doneM, status, closures: 0, manholes: 0, antennas,
                    coords: line.coords
                };
            }
            const km = tools.length(line.coords) / 1000;
            const totalKm = Number(p.total_km ?? p.totalKm ?? Math.round(km * 10) / 10);
            const doneKm = Math.min(totalKm, Number(p.done_km ?? p.doneKm ?? 0));
            return {
                id: `IMP-${String(index + 1).padStart(2, "0")}`,
                name: line.name || `${t("importedLine")} ${index + 1}`,
                pointA: p.point_a || "A", pointB: p.point_b || "B", startDate: "", endDate: "", contractor,
                totalKm, doneKm, status, closures: 0, manholes: 0, antennas: 0,
                coords: line.coords
            };
        })
    };
}

async function handleImport(event) {
    const added = [];
    for (const file of event.target.files) {
        try {
            const lines = (await readLines(file)).filter(line => line.coords.length >= 1);
            if (lines.length === 0) {
                toast(`${file.name}: ${t("importNoLines")}`, true);
                continue;
            }
            const project = projectFromFile(file.name, lines);
            await api.saveProject(project);
            state.projects.push(project);
            state.visibleIds.add(project.id);
            added.push(project);
            toast(`${t("importOk")}: ${project.name}`);
        } catch {
            toast(`${file.name}: ${t("importError")}`, true);
        }
    }
    event.target.value = "";
    if (added.length === 0) return;
    renderAll();
    flyToCoords(added.flatMap(p => p.items.flatMap(r => r.coords)));
}

/* HADİSƏLƏR */
function bindEvents() {
    $("loginForm").addEventListener("submit", handleLogin);
    $("logoutBtn").addEventListener("click", handleLogout);

    $("langSelect").addEventListener("change", e => {
        writeStore(STORAGE.lang, e.target.value);
        $("loginLang").value = e.target.value;
        applyLanguage(e.target.value);
    });
    $("themeBtn").addEventListener("click", e => {
        e.stopPropagation();
        setThemeMenu($("themeMenu").hidden);
    });
    $("themeMenu").addEventListener("click", e => {
        const option = e.target.closest("[data-theme-id]");
        if (!option) return;
        writeStore(STORAGE.theme, option.dataset.themeId);
        applyTheme(option.dataset.themeId);
        setThemeMenu(false);
    });
    document.addEventListener("click", e => {
        if (!e.target.closest("#themeMenu")) setThemeMenu(false);
    });
    $("menuBtn").addEventListener("click", () => {
        const open = $("topActions").classList.toggle("open");
        $("menuBtn").setAttribute("aria-expanded", open);
    });

    $("notesBtn").addEventListener("click", () => $("notesModal").showModal());
    $("materialsBtn").addEventListener("click", () => $("materialsModal").showModal());
    $("printBtn").addEventListener("click", () => window.print());
    $("toolDock").addEventListener("click", async e => {
        if (!e.target.closest("#shareBtn")) return;
        $("shareModal").showModal();
        try {
            await renderShares();
        } catch {
            toast(t("loadError"), true);
        }
    });
    $("shareForm").addEventListener("submit", createShare);
    $("addProjectBtn").addEventListener("click", () => editProject(null));
    $("editForm").addEventListener("submit", submitEditor);
    $("editDelete").addEventListener("click", deleteFromEditor);
    $("editFields").addEventListener("click", e => {
        const key = e.target.closest("[data-field-action]")?.dataset.fieldAction;
        if (key) editor.fields.find(f => f.key === key).action.run();
    });
    $("contractorList").addEventListener("click", e => {
        const button = e.target.closest("[data-edit-contractor]");
        if (button) editContractor(button.dataset.editContractor);
    });
    $("materialsBody").addEventListener("click", e => {
        const button = e.target.closest("[data-edit-material]");
        if (!button) return;
        const id = Number(button.dataset.editMaterial);
        editMaterial(state.materials.find(m => m.id === id));
    });
    $("shareList").addEventListener("click", async e => {
        const copy = e.target.closest("[data-copy]");
        const revoke = e.target.closest("[data-revoke]");
        if (copy) await copyShare(copy.dataset.copy);
        if (revoke) {
            if (!confirm(t("shareRevokeConfirm"))) return;
            try {
                await api.revokeShare(revoke.dataset.revoke);
                await renderShares();
                toast(t("removed"));
            } catch {
                toast(t("saveError"), true);
            }
        }
    });
    $("importBtn").addEventListener("click", () => $("importFile").click());
    $("importFile").addEventListener("change", handleImport);
    $("noteForm").addEventListener("submit", addNote);
    $("notesList").addEventListener("click", e => {
        const button = e.target.closest("[data-id]");
        if (button) deleteNote(Number(button.dataset.id));
    });

    document.querySelectorAll("dialog").forEach(dialog => {
        dialog.addEventListener("click", e => {
            if (e.target === dialog || e.target.closest("[data-close]")) dialog.close();
        });
    });

    $("sidebarToggle").addEventListener("click", () => setSidebar($("workspace").classList.contains("sidebar-closed")));
    $("drawerToggle").addEventListener("click", () => {
        if ($("drawer").classList.contains("sheet")) setSidebar(false);
        else setDrawer(!$("drawer").classList.contains("open"));
    });
    document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => setDockTab(tab.dataset.tab)));
    $("detailView").addEventListener("click", e => {
        const action = e.target.closest("[data-action]")?.dataset.action;
        if (action === "back") clearSelection();
        if (action === "zoom") flyToCoords(selectedEntry().item.coords);
        if (action === "edit") editSegment(selectedEntry().project, selectedEntry().item);
    });
    $("loginLang").addEventListener("change", e => {
        $("langSelect").value = e.target.value;
        $("langSelect").dispatchEvent(new Event("change"));
    });

    $("searchInput").addEventListener("input", e => {
        state.query = e.target.value.trim().toLocaleLowerCase("az");
        renderAll();
    });
    $("statusChips").addEventListener("click", e => {
        const chip = e.target.closest("[data-status]");
        if (!chip) return;
        state.statusFilter = chip.dataset.status;
        renderAll();
    });
    $("showAllBtn").addEventListener("click", () => {
        state.projects.forEach(p => state.visibleIds.add(p.id));
        renderAll();
    });
    $("hideAllBtn").addEventListener("click", () => {
        state.visibleIds.clear();
        renderAll();
    });

    $("projectList").addEventListener("click", async e => {
        const button = e.target.closest("[data-action]");
        if (!button) return;
        const project = state.projects.find(p => p.id === button.closest(".project").dataset.id);
        const action = button.dataset.action;

        if (action === "toggle") {
            if (state.visibleIds.has(project.id)) state.visibleIds.delete(project.id);
            else state.visibleIds.add(project.id);
        } else if (action === "expand") {
            if (state.expandedIds.has(project.id)) state.expandedIds.delete(project.id);
            else state.expandedIds.add(project.id);
        } else if (action === "focus") {
            selectSegment(project, project.items.find(r => r.id === button.dataset.item));
            return;
        } else if (action === "edit") {
            editProject(project);
            return;
        } else if (action === "addSegment") {
            editSegment(project, null);
            return;
        }
        renderAll();
    });

    $("tableBody").addEventListener("click", e => {
        const row = e.target.closest("tr");
        if (!row) return;
        const { project, item } = visibleEntries()[Number(row.dataset.index)];
        selectSegment(project, item);
    });

    $("zoomInBtn").addEventListener("click", () => map.zoomIn());
    $("zoomOutBtn").addEventListener("click", () => map.zoomOut());
    $("homeBtn").addEventListener("click", () => fitHome());
    $("northBtn").addEventListener("click", () => map.easeTo({ bearing: 0, pitch: 0 }));
    $("namesBtn").addEventListener("click", () => {
        namesOn = !namesOn;
        applyNames();
    });
    $("fullscreenBtn").addEventListener("click", toggleFullscreen);
    $("layersBtn").addEventListener("click", () => togglePopover("layersPopover", "layersBtn"));
    $("coordBtn").addEventListener("click", () => togglePopover("coordPopover", "coordBtn"));
    $("coordCopy").addEventListener("click", copyCoord);
    $("coordForm").addEventListener("submit", goToCoords);

    $("layerOptions").addEventListener("click", e => {
        const option = e.target.closest("[data-layer]");
        if (!option) return;
        switchBaseLayer(option.dataset.layer);
        closePopovers();
    });
}

async function init() {
    const lang = readStore(STORAGE.lang, "az");
    const language = I18N[lang] ? lang : "az";
    $("langSelect").value = language;
    $("loginLang").value = language;
    state.lang = language;
    applyTheme(readStore(STORAGE.theme, "dark"));

    if (isPhone()) setSidebar(false);

    bindEvents();
    initMap();
    applyLanguage(language);

    const shareToken = new URLSearchParams(location.search).get("share");
    if (shareToken) {
        await enterSharedView(shareToken);
        return;
    }

    const user = api.configured ? await api.getUser() : null;
    if (user) await enterApp(user);
    else $("login").hidden = false;
}

document.addEventListener("DOMContentLoaded", init);

/* === YENİLİKLƏR: Kvadrat Status Pəncərəsi, Nöqtə/Xətt Rejimləri, BCG/Podratçı Seçimi, Miqyas Dondurma, 1x/2x Sağ Klik, Anbar Qaiməli Materiallar === */
(() => {
    let activeProjectId = null;
    let frozenScale = null;

    const origRenderAll = window.renderAll;
    function updateLegendVisibility() {
        const legend = $("legend");
        if (legend) legend.hidden = state.visibleIds.size === 0;
    }

    function executorOptionsHtml(currentExec) {
        const names = [...new Set(["BCG (Öz briqadamız)", ...Object.keys(state.contractors)])];
        return `<select class="input" data-exec-select>${names.map(name => {
            const isOwn = /bcg/i.test(name);
            return `<option value="${esc(name)}" ${name === (currentExec || "BCG (Öz briqadamız)") ? "selected" : ""}>${isOwn ? "🏢 " + esc(name) : "👷 Podratçı: " + esc(name)}</option>`;
        }).join("")}</select>`;
    }

    function updateScaleBarUI() {
        if (!window.map || !$("currentScaleLabel")) return;
        const z = map.getZoom().toFixed(2);
        $("currentScaleLabel").innerHTML = `🔍 Miqyas: <b>${z}x</b>`;
        const hasFrozen = Boolean(frozenScale);
        $("frozenScaleChip").hidden = !hasFrozen;
        $("lockScaleBtn").textContent = hasFrozen ? "🔒 Yeni miqyası dondur" : "🔒 Miqyası dondur";
        if (hasFrozen) {
            $("frozenScaleBadge").textContent = `🔒 ${frozenScale.zoom.toFixed(2)}x dondurulub`;
        }
    }

    function setMapZoomLock(locked) {
        window.__scaleFrozen = locked;
        if (!window.map) return;
        const method = locked ? "disable" : "enable";
        map.scrollZoom?.[method]();
        map.boxZoom?.[method]();
        map.doubleClickZoom?.[method]();
        map.touchZoomRotate?.[method]();
    }

    function ensureMapWidgets() {
        const stage = document.querySelector(".map-stage");
        if (!stage || $("infoCard")) return;

        // 1) Sol panel bağlı olanda yenidən açmaq üçün düymə
        const reopen = document.createElement("button");
        reopen.id = "reopenSidebarBtn";
        reopen.className = "reopen-sidebar-btn";
        reopen.innerHTML = `<i class="fa-solid fa-layer-group"></i> <span>Layihələr panelini aç</span>`;
        reopen.addEventListener("click", () => setSidebar(true));
        stage.appendChild(reopen);

        // 2) Miqyası dondur və sil paneli
        const scaleBar = document.createElement("div");
        scaleBar.id = "scaleControlBar";
        scaleBar.className = "scale-control-bar";
        scaleBar.innerHTML = `
            <span id="currentScaleLabel">🔍 Miqyas: <b>7.00x</b></span>
            <button class="btn btn-outline" type="button" id="lockScaleBtn" style="height:26px;padding:0 8px;font-size:11.5px">🔒 Miqyası dondur</button>
            <div class="scale-frozen-chip" id="frozenScaleChip" hidden>
                <span class="scale-frozen-badge" id="frozenScaleBadge">🔒 7.00x dondurulub</span>
                <button class="btn btn-outline" type="button" id="restoreScaleBtn" style="height:26px;padding:0 8px;font-size:11.5px" title="Dondurulmuş miqyasa qayıt">🎯 Qayıt</button>
                <button class="btn btn-danger" type="button" id="deleteScaleBtn" style="height:26px;padding:0 8px;font-size:11.5px" title="Dondurulmuş miqyası sil">🗑️ Sil</button>
            </div>
        `;
        stage.appendChild(scaleBar);

        $("lockScaleBtn").addEventListener("click", () => {
            if (!window.map) return;
            frozenScale = {
                center: map.getCenter().toArray(),
                zoom: map.getZoom(),
                bearing: map.getBearing(),
                pitch: map.getPitch()
            };
            setMapZoomLock(true);
            updateScaleBarUI();
            toast(`🔒 Cari miqyas (${frozenScale.zoom.toFixed(2)}x) donduruldu!`);
        });
        $("restoreScaleBtn").addEventListener("click", () => {
            if (!frozenScale || !window.map) return;
            map.jumpTo(frozenScale);
            updateScaleBarUI();
            toast(`🎯 Dondurulmuş miqyasa (${frozenScale.zoom.toFixed(2)}x) qayıdıldı`);
        });
        $("deleteScaleBtn").addEventListener("click", () => {
            frozenScale = null;
            setMapZoomLock(false);
            updateScaleBarUI();
            toast("🗑️ Dondurulmuş miqyas silindi — miqyas kilidi açıldı");
        });

        // 3) Kvadrat məlumat pəncərəsi
        const card = document.createElement("div");
        card.id = "infoCard";
        card.className = "info-card";
        card.hidden = true;
        stage.appendChild(card);

        let drag = null;
        card.addEventListener("mousedown", e => {
            const head = e.target.closest(".info-card-head");
            if (!head || e.target.closest("button")) return;
            e.preventDefault();
            drag = { x: e.clientX - card.offsetLeft, y: e.clientY - card.offsetTop };
            const onMove = ev => {
                if (!drag) return;
                card.style.left = `${Math.max(8, ev.clientX - drag.x)}px`;
                card.style.top = `${Math.max(8, ev.clientY - drag.y)}px`;
            };
            const onUp = () => {
                drag = null;
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
        });

        card.addEventListener("click", e => {
            const pick = e.target.closest("[data-pick-seg]");
            if (pick && !e.target.closest("select") && !e.target.closest("button")) {
                const [projectId, itemId] = pick.dataset.pickSeg.split(":");
                const proj = state.projects.find(p => p.id === projectId);
                const item = proj?.items.find(r => r.id === itemId);
                if (proj && item) {
                    activeProjectId = proj.id;
                    selectSegment(proj, item);
                }
                return;
            }
            const act = e.target.closest("[data-card-act]")?.dataset.cardAct;
            if (act === "close") {
                state.selected = null;
                activeProjectId = null;
                card.hidden = true;
                drawRoutes();
                renderProjects();
            } else if (act === "showAll") {
                state.selected = null;
                renderInfoCard();
                drawRoutes();
                renderProjects();
            } else if (act === "zoom") {
                const entry = selectedEntry();
                if (entry) flyToCoords(entry.item.coords);
                else if (activeProjectId) {
                    const proj = state.projects.find(p => p.id === activeProjectId);
                    if (proj) flyToCoords(proj.items.flatMap(i => i.coords));
                }
            } else if (act === "edit") {
                const entry = selectedEntry();
                if (entry) editSegment(entry.project, entry.item);
                else if (activeProjectId) {
                    const proj = state.projects.find(p => p.id === activeProjectId);
                    if (proj) editProject(proj);
                }
            }
        });

        card.addEventListener("change", async e => {
            const sel = e.target.closest("[data-exec-select]");
            if (!sel) return;
            const rowEl = sel.closest("[data-pick-seg]");
            if (!rowEl) return;
            const [projectId, itemId] = rowEl.dataset.pickSeg.split(":");
            const proj = state.projects.find(p => p.id === projectId);
            const item = proj?.items.find(r => r.id === itemId);
            if (!proj || !item) return;
            item.contractor = sel.value;
            if (isAdmin() && api.configured) {
                try {
                    await api.saveSegment(proj.id, item.id, { contractor: item.contractor });
                } catch { /* lokal olaraq da yenilənir */ }
            }
            renderAll();
            toast(`İş icraçısı yeniləndi: ${item.contractor}`);
        });
    }

    function renderInfoCard() {
        ensureMapWidgets();
        const card = $("infoCard");
        if (!card) return;

        $("listView").hidden = false;
        $("detailView").hidden = true;

        const entry = selectedEntry();
        const proj = entry ? entry.project : state.projects.find(p => p.id === activeProjectId);
        if (!proj) {
            card.hidden = true;
            return;
        }
        card.hidden = false;

        const isPoints = proj.type === "points";
        const items = entry ? [entry.item] : proj.items;
        const sum = totals(proj.items);
        const pct = percent(sum.done, sum.plan);
        const leftVal = Math.max(0, sum.plan - sum.done);
        const tone = statusTone(proj.status);

        // A) NÖQTƏ / ANTENA LAYİHƏSİ (1-ci Nəzərdə tutulan m, 2-ci Faktiki iş görülən m + İş icraçısı: BCG / Podratçı)
        if (isPoints) {
            const totalAnt = proj.items.reduce((s, i) => s + (i.antennas || 0), 0);
            card.innerHTML = `
                <div class="info-card-head">
                    <div>
                        <small>📍 Plan: ${formatKm(sum.plan)} m · Faktiki: ${formatKm(sum.done)} m (${pct}%)</small>
                        <strong>${esc(proj.name)}</strong>
                    </div>
                    <div style="display:flex;align-items:center;gap:4px">
                        ${entry ? `<button class="btn btn-outline" style="height:24px;padding:0 8px;font-size:11px;color:#fff;border-color:rgba(255,255,255,0.25)" data-card-act="showAll">Hamısını göstər</button>` : ""}
                        <button class="icon-btn" data-card-act="close" title="${t("close")}"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>
                <div class="info-card-body">
                    <div class="info-grid">
                        <div class="info-stat"><small>Cəmi Antena</small><b>${totalAnt} ədəd</b></div>
                        <div class="info-stat"><small>1. Nəzərdə tutulan</small><b>${formatKm(sum.plan)} m</b></div>
                        <div class="info-stat"><small>2. Faktiki (${pct}%)</small><b>${formatKm(sum.done)} m</b></div>
                    </div>
                    <div style="font-weight:600;color:var(--ink-2)">Məntəqələr üzrə məsafə (Plan / Faktiki) və İcraçı (${items.length}):</div>
                    <div class="info-sub-list">
                        ${items.map(r => {
                            const rTone = statusTone(r.status);
                            const rLeft = Math.max(0, r.totalKm - r.doneKm);
                            const rPct = percent(r.doneKm, r.totalKm);
                            const cleanName = String(r.name || "").replace(/\s*rayon(u)?\b/gi, "").trim();
                            const cInfo = state.contractors[r.contractor || "BCG (Öz briqadamız)"];
                            return `
                                <div class="info-sub-item" data-pick-seg="${esc(proj.id)}:${esc(r.id)}" style="border-color:${entry?.item === r ? rTone : "var(--line)"}">
                                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                                        <strong style="display:flex;align-items:center;gap:6px">
                                            <span class="dot" style="background:${rTone}"></span>
                                            ${esc(cleanName)} — <span style="color:var(--ink-2)">${formatKm(r.totalKm)} m</span> / <span style="color:${rTone}">${formatKm(r.doneKm)} m</span>
                                        </strong>
                                        <span class="pill" style="--tone:${rTone}">${t(`status${r.status}`)}</span>
                                    </div>
                                    <div class="info-sub-box">
                                        📡 <b>${r.antennas || 0} antena</b> &nbsp;/&nbsp; 📏 <b>${formatKm(r.totalKm)} m</b> <span class="muted">(nəzərdə tutulub)</span> – <b style="color:${rTone}">${formatKm(r.doneKm)} m</b> <span class="muted">(faktiki görülən)</span>
                                        <div style="display:flex;justify-content:space-between;margin-top:4px;color:var(--ink-2)">
                                            <span>Qalıb: <b>${formatKm(rLeft)} m</b></span>
                                            <span>İcra: <b>${rPct}%</b></span>
                                        </div>
                                    </div>
                                    <div class="info-exec-row">
                                        <span class="muted">İş icraçısı:</span>
                                        ${executorOptionsHtml(r.contractor)}
                                        <span class="muted">${cInfo ? `${cInfo.workers} işçi · ${cInfo.machinery} tex.` : ""}</span>
                                    </div>
                                </div>
                            `;
                        }).join("")}
                    </div>
                    <div style="display:flex;gap:6px;margin-top:auto;padding-top:4px">
                        <button class="btn btn-outline" style="flex:1;height:28px;font-size:12px" data-card-act="zoom"><i class="fa-solid fa-crosshairs"></i> ${t("zoomTo")}</button>
                        ${isAdmin() ? `<button class="btn btn-primary" style="height:28px;font-size:12px" data-card-act="edit"><i class="fa-solid fa-pen"></i></button>` : ""}
                    </div>
                </div>
                <div class="info-card-foot">
                    <span>↘ Küncdən tutub ölçüsünü dəyişin</span>
                    <span>Başlıqdan sürüşdürün</span>
                </div>
            `;
        }
        // B) MAGİSTRAL XƏTT LAYİHƏSİ (Mufta/quyu çıxarıldı, Seqmentlər + İş icraçıları birbaşa bu pəncərədə!)
        else {
            const contractorNames = [...new Set(items.map(i => i.contractor || "BCG (Öz briqadamız)"))];
            card.innerHTML = `
                <div class="info-card-head">
                    <div>
                        <small>〰️ Plan: ${formatKm(sum.plan)} km · Faktiki: ${formatKm(sum.done)} km (${pct}%)</small>
                        <strong>${esc(proj.name)}</strong>
                    </div>
                    <div style="display:flex;align-items:center;gap:4px">
                        ${entry ? `<button class="btn btn-outline" style="height:24px;padding:0 8px;font-size:11px;color:#fff;border-color:rgba(255,255,255,0.25)" data-card-act="showAll">Bütün seqmentlər</button>` : ""}
                        <button class="icon-btn" data-card-act="close" title="${t("close")}"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>
                <div class="info-card-body">
                    <div class="info-grid">
                        <div class="info-stat"><small>1. Nəzərdə tutulan</small><b>${formatKm(sum.plan)} km</b></div>
                        <div class="info-stat"><small>2. Faktiki görülən</small><b>${formatKm(sum.done)} km (${pct}%)</b></div>
                        <div class="info-stat"><small>${t("thLeft")}</small><b>${formatKm(leftVal)} km</b></div>
                    </div>
                    <div class="progress" style="margin:0"><span style="width:${pct}%;background:${tone}"></span></div>

                    <div style="font-weight:600;color:var(--ink-2)">Seqmentlər (${items.length}):</div>
                    <div class="info-sub-list">
                        ${items.map(r => {
                            const rTone = statusTone(r.status);
                            const rLeft = Math.max(0, r.totalKm - r.doneKm);
                            const rPct = percent(r.doneKm, r.totalKm);
                            return `
                                <div class="info-sub-item" data-pick-seg="${esc(proj.id)}:${esc(r.id)}" style="border-color:${entry?.item === r ? rTone : "var(--line)"}">
                                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                                        <b>${esc(r.pointA)} ➔ ${esc(r.pointB)} <span class="muted">(${esc(r.id)})</span></b>
                                        <span class="pill" style="--tone:${rTone}">${t(`status${r.status}`)}</span>
                                    </div>
                                    <div style="color:var(--ink-2)">
                                        Nəzərdə tutulan: <b>${formatKm(r.totalKm)} km</b> · Faktiki görülən: <b>${formatKm(r.doneKm)} km (${rPct}%)</b> · Qalıb: <b>${formatKm(rLeft)} km</b>
                                    </div>
                                    <div class="info-exec-row">
                                        <span class="muted">İş icraçısı:</span>
                                        ${executorOptionsHtml(r.contractor)}
                                        <span class="muted">📅 ${formatDate(r.startDate)} – ${formatDate(r.endDate)}</span>
                                    </div>
                                </div>
                            `;
                        }).join("")}
                    </div>

                    <div style="font-weight:600;color:var(--ink-2)">İş icraçıları (${contractorNames.length}):</div>
                    <div class="info-sub-list">
                        ${contractorNames.map(name => {
                            const c = state.contractors[name] || { workers: "—", machinery: "—", engineer: "—" };
                            const isOwn = /bcg/i.test(name);
                            return `
                                <div class="info-sub-item" style="cursor:default;flex-direction:row;align-items:center;justify-content:space-between">
                                    <div>
                                        <b>${isOwn ? "🏢 " + esc(name) : "👷 Podratçı: " + esc(name)}</b>
                                        <div class="muted">Məsul: ${esc(c.engineer || "—")}</div>
                                    </div>
                                    <div style="text-align:right;font-weight:600">
                                        <div>${c.workers} işçi</div>
                                        <div class="muted">${c.machinery} texnika</div>
                                    </div>
                                </div>
                            `;
                        }).join("")}
                    </div>

                    <div style="display:flex;gap:6px;margin-top:auto;padding-top:4px">
                        <button class="btn btn-outline" style="flex:1;height:28px;font-size:12px" data-card-act="zoom"><i class="fa-solid fa-crosshairs"></i> ${t("zoomTo")}</button>
                        ${isAdmin() ? `<button class="btn btn-primary" style="height:28px;font-size:12px" data-card-act="edit"><i class="fa-solid fa-pen"></i></button>` : ""}
                    </div>
                </div>
                <div class="info-card-foot">
                    <span>↘ Küncdən tutub ölçüsünü dəyişin</span>
                    <span>Başlıqdan sürüşdürün</span>
                </div>
            `;
        }
    }

    function populateNoteRecipients() {
        const sel = $("noteRecipient");
        if (!sel) return;
        const emails = [...new Set([...(state.users || []), state.user?.email].filter(Boolean))];
        const current = sel.value || "all";
        sel.innerHTML = `<option value="all">Hamıya (All)</option>` + emails.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join("");
        sel.value = emails.includes(current) ? current : "all";
    }

    window.renderAll = function () {
        origRenderAll();
        updateLegendVisibility();
        renderInfoCard();
        populateNoteRecipients();
        updateScaleBarUI();
    };

    document.addEventListener("DOMContentLoaded", () => {
        ensureMapWidgets();

        $("projectList").addEventListener("click", e => {
            const projEl = e.target.closest(".project");
            if (!projEl) return;
            const projId = projEl.dataset.id;
            const btn = e.target.closest("[data-action]");
            if (btn && (btn.dataset.action === "expand" || btn.dataset.action === "toggle")) {
                activeProjectId = projId;
                state.selected = null;
                renderInfoCard();
            }
        });

        // Xəritədə miqyas dəyişdikcə göstəricini yenilə və 1x / 2x sağ klik qaydasını qoş
        const bindMapEnhancements = () => {
            if (!window.map) { setTimeout(bindMapEnhancements, 150); return; }
            map.on("zoom", updateScaleBarUI);
            updateScaleBarUI();

            // Zoom düymələrinə dondurulmuş miqyas yoxlaması
            $("zoomInBtn").addEventListener("click", e => {
                if (frozenScale) {
                    e.stopImmediatePropagation();
                    toast(`🔒 Miqyas ${frozenScale.zoom.toFixed(2)}x üzərində dondurulub! Dəyişmək üçün "Sil" basın.`);
                }
            }, true);
            $("zoomOutBtn").addEventListener("click", e => {
                if (frozenScale) {
                    e.stopImmediatePropagation();
                    toast(`🔒 Miqyas ${frozenScale.zoom.toFixed(2)}x üzərində dondurulub! Dəyişmək üçün "Sil" basın.`);
                }
            }, true);

            // 1x Sağ klik: Yalnız status pəncərəsini bağla (Layihələr sütunu açıq qalsın)
            // 2x Ard-arda sağ klik: Sol Layihələr sütununu da bağla
            const box = map.getCanvasContainer();
            let downPos = null;
            let lastRightClickTime = 0;
            let singleClickTimer = null;

            box.addEventListener("mousedown", e => {
                if (e.button === 2) downPos = { x: e.clientX, y: e.clientY };
            }, true);

            box.addEventListener("contextmenu", e => {
                e.preventDefault();
                const moved = downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 4;
                if (moved || tools.isActive()) return;

                const now = Date.now();
                if (now - lastRightClickTime < 360) {
                    clearTimeout(singleClickTimer);
                    lastRightClickTime = 0;
                    setSidebar(false);
                    toast("2x Sağ klik: Layihələr sütunu bağlandı");
                } else {
                    lastRightClickTime = now;
                    singleClickTimer = setTimeout(() => {
                        state.selected = null;
                        activeProjectId = null;
                        if ($("infoCard")) $("infoCard").hidden = true;
                        closePopovers();
                        drawRoutes();
                        renderProjects();
                        toast("1x Sağ klik: Status pəncərəsi bağlandı");
                    }, 250);
                }
            });
        };
        bindMapEnhancements();

        // Qeydlər pəncərəsinə Kimə (All / İstifadəçi) və Vaxt (24 / 36 saat) seçimi əlavə et
        const noteForm = $("noteForm");
        if (noteForm && !$("noteRecipient")) {
            const meta = document.createElement("div");
            meta.className = "note-meta-grid";
            meta.innerHTML = `
                <label>
                    <span>Kimə (Alıcı / Bildiriş):</span>
                    <select class="input" id="noteRecipient">
                        <option value="all">Hamıya (All)</option>
                    </select>
                </label>
                <label>
                    <span>Vaxt (Qalma müddəti):</span>
                    <select class="input" id="noteHours">
                        <option value="24">24 saat</option>
                        <option value="36">36 saat</option>
                        <option value="0">Müddətsiz</option>
                    </select>
                </label>
            `;
            noteForm.insertBefore(meta, noteForm.firstChild);
        }

        // Material Reyestrinə Layihə, Material növü, Anbar Qaiməsi № və Təqvim (tarix) filtrləri əlavə et
        const matModal = $("materialsModal");
        if (matModal && !$("matFilterBar")) {
            const wrap = matModal.querySelector(".table-wrap");
            const bar = document.createElement("div");
            bar.id = "matFilterBar";
            bar.className = "mat-filters";
            bar.innerHTML = `
                <label>
                    <span>Layihə:</span>
                    <select class="input" id="matFilterProject"><option value="all">Bütün layihələr</option></select>
                </label>
                <label>
                    <span>Material növü:</span>
                    <select class="input" id="matFilterType"><option value="all">Bütün materiallar</option></select>
                </label>
                <label>
                    <span>📄 Anbar Qaiməsi №:</span>
                    <input class="input" type="search" id="matFilterInvoice" placeholder="QAİMƏ-2026...">
                </label>
                <label>
                    <span>Başlanğıc tarix:</span>
                    <input class="input" type="date" id="matFilterFrom">
                </label>
                <label>
                    <span>Son tarix:</span>
                    <input class="input" type="date" id="matFilterTo">
                </label>
                <button class="btn btn-outline" type="button" id="matFilterReset">Sıfırla</button>
            `;
            const summary = document.createElement("div");
            summary.id = "matSummary";
            summary.className = "mat-summary";
            matModal.insertBefore(bar, wrap);
            matModal.insertBefore(summary, wrap);

            ["matFilterProject", "matFilterType", "matFilterFrom", "matFilterTo"].forEach(id => {
                $(id).addEventListener("change", () => window.renderMaterials());
            });
            $("matFilterInvoice").addEventListener("input", () => window.renderMaterials());
            $("matFilterReset").addEventListener("click", () => {
                $("matFilterProject").value = "all";
                $("matFilterType").value = "all";
                $("matFilterInvoice").value = "";
                $("matFilterFrom").value = "";
                $("matFilterTo").value = "";
                window.renderMaterials();
            });
        }
    });

    function remainingHours(expiresAt) {
        if (!expiresAt) return "Müddətsiz";
        const diff = new Date(expiresAt).getTime() - Date.now();
        if (diff <= 0) return "Vaxtı bitib";
        return `${Math.max(1, Math.round(diff / 3600000))} saat qalıb`;
    }

    let notifiedIds = new Set();

    window.renderNotes = function () {
        populateNoteRecipients();
        const now = Date.now();
        const myEmail = state.user?.email;
        const active = state.notes.filter(n => !n.expiresAt || new Date(n.expiresAt).getTime() > now);
        const visibleForMe = active.filter(n => isAdmin() || !n.recipient || n.recipient === "all" || n.recipient === myEmail || n.author === myEmail);

        $("notesList").innerHTML = visibleForMe.length === 0
            ? `<div class="empty">${t("notesEmpty")}</div>`
            : visibleForMe.map(n => {
                const toLabel = !n.recipient || n.recipient === "all" ? "Hamıya (All)" : n.recipient;
                const timeBadge = n.durationHours ? `${n.durationHours}s · ${remainingHours(n.expiresAt)}` : "Müddətsiz";
                return `
                    <div class="note">
                        <div style="flex:1;min-width:0">
                            <div class="note-badges">
                                <span class="note-badge"><i class="fa-solid fa-bell"></i> Kimə: ${esc(toLabel)}</span>
                                <span class="note-badge time"><i class="fa-regular fa-clock"></i> ${esc(timeBadge)}</span>
                            </div>
                            <p>${esc(n.text)}<small>${esc(n.author)} · ${new Date(n.date).toLocaleString(state.lang)}</small></p>
                        </div>
                        ${isAdmin() || n.userId === state.user?.id ? `<button class="icon-btn small" data-id="${n.id}" title="${t("delete")}"><i class="fa-solid fa-trash"></i></button>` : ""}
                    </div>`;
            }).join("");
        $("notesCount").hidden = visibleForMe.length === 0;
        $("notesCount").textContent = visibleForMe.length;

        const incoming = visibleForMe.find(n => (n.recipient === myEmail || n.recipient === "all") && !notifiedIds.has(n.id));
        if (incoming && myEmail) {
            visibleForMe.forEach(n => notifiedIds.add(n.id));
            showNoteNotification(incoming);
        }
    };

    window.addNote = async function (event) {
        event.preventDefault();
        const text = $("noteInput").value.trim();
        if (!text) return;
        const recipient = $("noteRecipient")?.value || "all";
        const hours = Number($("noteHours")?.value ?? 24);
        let saved;
        try {
            saved = await api.addNote(text, recipient, hours);
            state.notes.unshift(saved);
            notifiedIds.add(saved.id);
        } catch {
            toast(t("saveError"), true);
            return;
        }
        $("noteInput").value = "";
        window.renderNotes();
        toast(`${t("noteAdded")} (${recipient === "all" ? "Hamıya" : recipient})`);
        showNoteNotification(saved);
    };

    function showNoteNotification(note) {
        const old = document.querySelector(".notif-toast");
        if (old) old.remove();
        const box = document.createElement("div");
        box.className = "notif-toast";
        const target = !note.recipient || note.recipient === "all" ? "Hamıya (All)" : note.recipient;
        box.innerHTML = `
            <strong><i class="fa-solid fa-bell"></i> Qeyd Bildirişi (${esc(target)})</strong>
            <div>${esc(note.text)}</div>
            <small style="display:block;margin-top:4px;color:var(--ink-3)">Göndərən: ${esc(note.author)} · Müddət: ${note.durationHours ? note.durationHours + " saat" : "Müddətsiz"}</small>
        `;
        document.body.appendChild(box);
        setTimeout(() => box.remove(), 4500);
    }

    // Material Reyestri: Anbardan verilən + İstifadə olunan + Anbar Qaiməsi № ilə
    window.renderMaterials = function () {
        const projSel = $("matFilterProject");
        const typeSel = $("matFilterType");
        if (projSel && typeSel) {
            const pCur = projSel.value || "all";
            const tCur = typeSel.value || "all";
            const projects = [...new Set(state.materials.map(m => m.project))];
            const types = [...new Set(state.materials.map(m => m.material))];
            projSel.innerHTML = `<option value="all">Bütün layihələr</option>` + projects.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
            typeSel.innerHTML = `<option value="all">Bütün materiallar</option>` + types.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
            projSel.value = projects.includes(pCur) ? pCur : "all";
            typeSel.value = types.includes(tCur) ? tCur : "all";
        }

        const pVal = projSel?.value || "all";
        const mVal = typeSel?.value || "all";
        const invVal = ($("matFilterInvoice")?.value || "").trim().toLowerCase();
        const dFrom = $("matFilterFrom")?.value || "";
        const dTo = $("matFilterTo")?.value || "";

        const filtered = state.materials.filter(m => {
            const mDate = m.used_date || "";
            const inv = (m.invoice_no || `QAİMƏ-2026-0${140 + (m.id || 1)}`).toLowerCase();
            if (pVal !== "all" && m.project !== pVal) return false;
            if (mVal !== "all" && m.material !== mVal) return false;
            if (invVal && !inv.includes(invVal)) return false;
            if (dFrom && mDate < dFrom) return false;
            if (dTo && mDate > dTo) return false;
            return true;
        });

        if ($("matSummary")) {
            $("matSummary").innerHTML = `
                <span>Göstərilən qaimə qeydləri: <b>${filtered.length}</b> / ${state.materials.length}</span>
                <span>📦 Anbardan verilən və 🛠️ İstifadə olunan uçotu aktivdir</span>
            `;
        }

        $("materialsHead").innerHTML = `<tr>
            <th>Tarix</th>
            <th>📄 Anbar Qaiməsi №</th>
            <th>${t("thProject")}</th>
            <th>${t("thMaterial")}</th>
            <th>📦 Anbardan verilən</th>
            <th>🛠️ İstifadə olunan</th>
            <th>${t("thState")}</th>
            ${isAdmin() ? "<th></th>" : ""}
        </tr>`;

        $("materialsBody").innerHTML = filtered.map(m => {
            const invoiceNo = m.invoice_no || `QAİMƏ-2026-0${140 + (m.id || 1)}`;
            const issued = m.issued_qty || m.quantity || "—";
            const used = m.used_qty || m.quantity || "—";
            return `
                <tr>
                    <td class="mono">${formatDate(m.used_date)}</td>
                    <td><span class="invoice-pill">📄 ${esc(invoiceNo)}</span></td>
                    <td>${esc(m.project)}</td>
                    <td>${esc(m.material)}</td>
                    <td><b style="color:var(--amber)">📦 ${esc(issued)}</b></td>
                    <td><b style="color:var(--green)">🛠️ ${esc(used)}</b></td>
                    <td>${esc(materialStateLabel(m.state))}</td>
                    ${isAdmin() ? `<td class="num"><button class="icon-btn" data-edit-material="${m.id}" title="${t("editMaterial")}"><i class="fa-solid fa-pen"></i></button></td>` : ""}
                </tr>
            `;
        }).join("") + (isAdmin() ? `<tr class="row-add"><td colspan="8"><button class="link" data-edit-material="">+ ${t("addMaterial")} (Anbar qaiməsi ilə)</button></td></tr>` : "");
    };
})();
