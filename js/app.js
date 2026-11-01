/* BCG GIS paneli: vəziyyət, xəritə, panellər */

const AZERBAIJAN_BOUNDS = [[38.39, 44.77], [41.91, 50.63]];

const STATUS_COLORS = { bitmis: "#22C55E", icrada: "#F59E0B", tehvil: "#3B82F6", layihe: "#EF4444" };
const ENDPOINT_MIN_ZOOM = 9;
const STATUSES = Object.keys(STATUS_COLORS);

const STORAGE = { lang: "bcg.lang", theme: "bcg.theme" };

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
let namesOn = true;

const $ = id => document.getElementById(id);
const t = key => I18N[state.lang][key] || key;

function esc(value) {
    const div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
}

const formatDate = iso => iso ? iso.split("-").reverse().join(".") : "—";
const formatKm = km => km.toLocaleString("en-US", { maximumFractionDigits: 1 });
const formatDistance = m => m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
const percent = (done, total) => total > 0 ? Math.round(done / total * 100) : 0;

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
    document.querySelectorAll("[data-i18n-title]").forEach(el => {
        el.title = t(el.dataset.i18nTitle);
        el.setAttribute("aria-label", el.title);
    });
    renderRole();
    if (currentBase) renderLayerOptions();
    tools.refresh();
    renderLegend();
    renderNotes();
    renderMaterials();
    renderAll();
}

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $("themeBtn").querySelector("i").className = `fa-solid ${theme === "light" ? "fa-moon" : "fa-sun"}`;
}

/* GİRİŞ */
const isAdmin = () => state.role === "admin";

function renderRole() {
    const email = state.user?.email || "";
    $("roleBadge").textContent = isAdmin() ? t("roleAdmin") : t("roleManager");
    $("userEmail").textContent = email;
    $("userAvatar").textContent = email.charAt(0);
    $("importBtn").hidden = !isAdmin();
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
    const user = await api.signIn(email, password);
    if (!user) {
        $("loginError").textContent = t("loginFailed");
        return;
    }
    $("loginError").textContent = "";
    $("loginPass").value = "";
    await enterApp(user);
}

async function handleLogout() {
    await api.signOut();
    Object.assign(state, { user: null, role: "manager", projects: [], contractors: {}, materials: [], notes: [], selected: null });
    state.visibleIds.clear();
    renderRole();
    renderNotes();
    renderMaterials();
    renderAll();
    $("loginUser").value = "";
    $("login").hidden = false;
    $("topActions").classList.remove("open");
}

async function enterApp(user) {
    state.user = user;
    $("login").hidden = true;
    try {
        Object.assign(state, await api.loadAll(user.id));
    } catch {
        toast(t("loadError"), true);
        return;
    }
    state.projects.forEach(p => state.visibleIds.add(p.id));
    renderRole();
    renderNotes();
    renderMaterials();
    renderAll();
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
    await navigator.clipboard.writeText(shareUrl(token));
    toast(t("shareCopied"));
}

async function createShare(event) {
    event.preventDefault();
    if (state.visibleIds.size === 0) {
        toast(t("shareNothing"), true);
        return;
    }
    try {
        const view = { center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
        const link = await api.createShare([...state.visibleIds], Number($("shareDays").value), tools.shapes(), view);
        await renderShares();
        await copyShare(link.token);
    } catch {
        toast(t("saveError"), true);
    }
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
            { id: "routes-ends", type: "circle", source: "routes", minzoom: ENDPOINT_MIN_ZOOM, filter: ["==", ["geometry-type"], "Point"],
                paint: { "circle-radius": 5, "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } },
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
        attributionControl: { compact: true },
        preserveDrawingBuffer: true
    });
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110 }), "bottom-right");
    routePopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "map-tip", offset: 12, maxWidth: "280px" });

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
    ["routes-hit", "routes-ends"].forEach(layer => {
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
    return latLngPairs.reduce((b, [lat, lng]) => b.extend([lng, lat]), new maplibregl.LngLatBounds());
}

function fitHome(animate = true) {
    map.fitBounds(toLngLatBounds(AZERBAIJAN_BOUNDS), { padding: MAP_PADDING, animate, bearing: 0, pitch: 0 });
}

function flyToCoords(coords) {
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
            // Siçanın 150 px hərəkəti bir zoom səviyyəsidir, basılan nöqtə ətrafında; aşağı yaxınlaşdırır
            move = ev => {
                if (Math.abs(ev.clientY - y0) > 3) rightMoved = true;
                map.zoomTo(zoom0 + (ev.clientY - y0) / 150, { around, duration: 0 });
            };
        } else {
            const bearing0 = map.getBearing(), pitch0 = map.getPitch();
            box.style.cursor = "move";
            // Yana 0.4° fırlanma, yuxarı 0.3° əymə (hər piksel üçün)
            move = ev => map.jumpTo({
                bearing: bearing0 + (ev.clientX - x0) * .4,
                pitch: Math.max(0, Math.min(map.getMaxPitch(), pitch0 - (ev.clientY - y0) * .3))
            });
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
    visibleEntries().forEach(({ project, item: r }) => {
        if (!r.coords || r.coords.length < 2) return;
        const color = statusTone(r.status);
        const line = r.coords.map(([lat, lng]) => [lng, lat]);
        features.push({
            type: "Feature", geometry: { type: "LineString", coordinates: line },
            properties: { color, sel: selected?.item === r, projectId: project.id, itemId: r.id, tip: `<b>${esc(r.name)}</b><small>${esc(r.id)} · ${percent(r.doneKm, r.totalKm)}%</small>` }
        });
        [[line[0], `A: ${r.pointA}`], [line[line.length - 1], `B: ${r.pointB}`]].forEach(([coordinates, label]) => features.push({
            type: "Feature", geometry: { type: "Point", coordinates }, properties: { color, tip: esc(label) }
        }));
    });
    source.setData({ type: "FeatureCollection", features });
}

function routePaths() {
    return visibleEntries().map(({ item }) => item.coords.map(([lat, lng]) => [lng, lat]));
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
    const box = [[e.point.x - 3, e.point.y - 3], [e.point.x + 3, e.point.y + 3]];
    const hit = map.queryRenderedFeatures(box, { layers: ["routes-hit"] })[0];
    if (!hit) return;
    const project = state.projects.find(p => p.id === hit.properties.projectId);
    selectSegment(project, project.items.find(r => r.id === hit.properties.itemId));
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

function setSidebar(open) {
    $("workspace").classList.toggle("sidebar-closed", !open);
    map?.resize();
}

function setDrawer(open) {
    $("drawer").classList.toggle("open", open);
    $("drawerBody").hidden = !open;
    $("drawerToggle").setAttribute("aria-expanded", open);
    $("drawerArrow").className = `fa-solid ${open ? "fa-chevron-down" : "fa-chevron-up"}`;
    map.resize();
}

function setDockTab(tab) {
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
        return `
            <div class="project ${visible ? "" : "hidden-on-map"}" data-id="${esc(p.id)}">
                <div class="project-row">
                    <label class="check" title="${t("toggleVisibility")}"><input type="checkbox" data-action="toggle" ${visible ? "checked" : ""}></label>
                    <button class="project-main" data-action="expand" aria-expanded="${expanded}">
                        <strong title="${esc(p.name)}">${esc(p.name)}</strong>
                        <small>${formatKm(sum.done)} / ${formatKm(sum.plan)} km · ${p.items.length} ${t("segmentsUnit")}</small>
                    </button>
                    <span class="project-pct">${pct}%</span>
                    ${p.imported && isAdmin() ? `<button class="icon-btn" data-action="delete" title="${t("delete")}"><i class="fa-regular fa-trash-can"></i></button>` : ""}
                    <button class="icon-btn" data-action="expand" aria-label="${esc(p.name)}"><i class="fa-solid fa-chevron-right chevron ${expanded ? "open" : ""}"></i></button>
                </div>
                ${expanded ? `<div class="segments">${filteredItems(p).map(r => `
                    <button class="segment ${state.selected?.itemId === r.id && state.selected?.projectId === p.id ? "selected" : ""}" data-action="focus" data-item="${esc(r.id)}">
                        <span class="dot" style="background:${statusTone(r.status)}"></span>
                        <span class="segment-name" title="${esc(r.name)}">${esc(r.name)}</span>
                        <span>${percent(r.doneKm, r.totalKm)}%</span>
                    </button>`).join("")}</div>` : ""}
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
    $("contractorHead").innerHTML = `<tr><th>${t("thContractor")}</th><th class="num">${t("workers")}</th><th class="num">${t("machinery")}</th><th>${t("engineer")}</th></tr>`;
    $("contractorList").innerHTML = names.map(name => {
        const info = state.contractors[name];
        return `<tr>
            <td><b>${esc(name)}</b></td>
            <td class="num">${info ? info.workers : "—"}</td>
            <td class="num">${info ? info.machinery : "—"}</td>
            <td>${info ? esc(info.engineer) : t("notAssigned")}</td>
        </tr>`;
    }).join("");
}

function renderMaterials() {
    $("materialsHead").innerHTML = `<tr><th>${t("thProject")}</th><th>${t("thMaterial")}</th><th>${t("thQuantity")}</th><th>${t("thState")}</th></tr>`;
    $("materialsBody").innerHTML = state.materials.map(m => `
        <tr><td>${esc(m.project)}</td><td>${esc(m.material)}</td><td>${esc(m.quantity)}</td><td class="c-done">${t(`state${m.state}`)}</td></tr>
    `).join("");
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

/* İMPORT: GeoJSON, KML, KMZ */
function linesFromGeoJson(data) {
    const lines = [];
    const addGeometry = (geometry, name) => {
        if (!geometry) return;
        if (geometry.type === "LineString") lines.push({ name, coords: geometry.coordinates.map(c => [c[1], c[0]]) });
        if (geometry.type === "MultiLineString") geometry.coordinates.forEach(part => lines.push({ name, coords: part.map(c => [c[1], c[0]]) }));
        if (geometry.type === "GeometryCollection") geometry.geometries.forEach(g => addGeometry(g, name));
    };
    const features = data.type === "FeatureCollection" ? data.features : data.type === "Feature" ? [data] : [{ geometry: data }];
    features.forEach(f => addGeometry(f.geometry, f.properties?.name));
    return lines;
}

function linesFromKml(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Invalid KML");

    const lines = [];
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
        lines.push({ name: nameNode?.textContent.trim(), coords });
    });
    return lines;
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
    return {
        id, imported: true, status: "layihe", startDate: "", endDate: "",
        name: fileName.replace(/\.[^/.]+$/, ""),
        items: lines.map((line, index) => {
            const km = tools.length(line.coords) / 1000;
            return {
                id: `IMP-${String(index + 1).padStart(2, "0")}`,
                name: line.name || `${t("importedLine")} ${index + 1}`,
                pointA: "A", pointB: "B", startDate: "", endDate: "", contractor: "",
                totalKm: Math.round(km * 10) / 10, doneKm: 0, status: "layihe", closures: 0, manholes: 0,
                coords: line.coords
            };
        })
    };
}

async function handleImport(event) {
    const added = [];
    for (const file of event.target.files) {
        try {
            const lines = (await readLines(file)).filter(line => line.coords.length >= 2);
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
    $("themeBtn").addEventListener("click", () => {
        const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        writeStore(STORAGE.theme, next);
        applyTheme(next);
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
    $("shareList").addEventListener("click", async e => {
        const copy = e.target.closest("[data-copy]");
        const revoke = e.target.closest("[data-revoke]");
        if (copy) await copyShare(copy.dataset.copy);
        if (revoke) {
            await api.revokeShare(revoke.dataset.revoke);
            await renderShares();
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
    $("drawerToggle").addEventListener("click", () => setDrawer(!$("drawer").classList.contains("open")));
    document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => setDockTab(tab.dataset.tab)));
    $("detailView").addEventListener("click", e => {
        const action = e.target.closest("[data-action]")?.dataset.action;
        if (action === "back") clearSelection();
        if (action === "zoom") flyToCoords(selectedEntry().item.coords);
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
        } else if (action === "delete") {
            if (!confirm(t("confirmDelete"))) return;
            try {
                await api.deleteProject(project.id);
            } catch {
                toast(t("saveError"), true);
                return;
            }
            state.projects = state.projects.filter(p => p !== project);
            state.visibleIds.delete(project.id);
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
    applyTheme(readStore(STORAGE.theme, "light"));

    if (window.innerWidth <= 860) setSidebar(false);

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
