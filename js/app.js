/* BCG GIS paneli: vəziyyət, xəritə, panellər */

const AZERBAIJAN_BOUNDS = [[38.39, 44.77], [41.91, 50.63]];

const STATUS_COLORS = { bitmis: "#10B981", icrada: "#F59E0B", tehvil: "#3B82F6", layihe: "#EF4444" };
const STATUSES = Object.keys(STATUS_COLORS);
const MEASURE_COLOR = "#FF7A00";

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
    notes: []
};

let map, routesLayer, measureLayer, currentBase, goToMarker;
let baseLayers = {};

const measure = { active: false, points: [], segments: [], tempLine: null };

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
    renderLayerOptions();
    renderLegend();
    renderChips();
    renderNotes();
    renderMaterials();
    renderAll();
}

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $("themeBtn").querySelector("i").className = `fa-solid ${theme === "light" ? "fa-sun" : "fa-moon"}`;
}

/* GİRİŞ */
const isAdmin = () => state.role === "admin";

function renderRole() {
    $("roleBadge").textContent = isAdmin() ? t("roleAdmin") : t("roleManager");
    $("importBtn").hidden = !isAdmin();
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
    Object.assign(state, { user: null, role: "manager", projects: [], contractors: {}, materials: [], notes: [] });
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

/* XƏRİTƏ */
function initMap() {
    map = L.map("map", {
        minZoom: 5,
        maxZoom: 21,
        zoomSnap: 0.25,
        zoomDelta: 1,
        wheelPxPerZoomLevel: 90,
        zoomControl: false,
        attributionControl: true,
        rotate: true,
        rotateControl: false,
        touchRotate: true,
        shiftKeyRotate: true
    });
    map.attributionControl.setPrefix(false);
    L.control.scale({ position: "bottomright", imperial: false }).addTo(map);

    const esriAttribution = "Imagery &copy; Esri, Maxar, Earthstar Geographics";
    baseLayers = {
        satellite: {
            icon: "fa-satellite", label: "layerSatellite",
            layer: L.layerGroup([
                L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 19, maxZoom: 21, attribution: esriAttribution }),
                L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxNativeZoom: 19, maxZoom: 21 })
            ])
        },
        street: {
            icon: "fa-road", label: "layerStreet",
            layer: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxNativeZoom: 19, maxZoom: 21, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' })
        },
        dark: {
            icon: "fa-moon", label: "layerDark",
            layer: L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { subdomains: "abcd", maxNativeZoom: 20, maxZoom: 21, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>' })
        },
        blank: { icon: "fa-square", label: "layerBlank", layer: L.layerGroup() }
    };

    routesLayer = L.layerGroup().addTo(map);
    measureLayer = L.layerGroup().addTo(map);

    switchBaseLayer("satellite");
    fitHome(false);

    map.on("click", onMapClick);
    map.on("mousemove", e => {
        $("cursorCoords").textContent = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
        updateMeasurePreview(e);
    });
    map.on("rotate", () => {
        $("northIcon").style.transform = `rotate(${-45 - map.getBearing()}deg)`;
    });

    initMouseGestures();
    window.addEventListener("resize", () => map.invalidateSize());
}

/* Görünən sahə üst panelin, sol panelin və alət rayının altında qalmasın */
function mapPadding() {
    if (window.innerWidth <= 760) return { paddingTopLeft: [10, 70], paddingBottomRight: [50, 60] };
    const sidebarOpen = !$("sidebar").hidden;
    return { paddingTopLeft: [sidebarOpen ? 345 : 60, 80], paddingBottomRight: [60, 20] };
}

function fitHome(animate = true) {
    map.fitBounds(AZERBAIJAN_BOUNDS, { ...mapPadding(), animate });
}

function flyToCoords(coords) {
    map.fitBounds(L.latLngBounds(coords), { ...mapPadding(), maxZoom: 13 });
}

function switchBaseLayer(name) {
    if (currentBase) map.removeLayer(baseLayers[currentBase].layer);
    currentBase = name;
    baseLayers[name].layer.addTo(map);
    $("map").classList.toggle("blank-base", name === "blank");
    renderLayerOptions();
}

/* Google Earth tərzi: orta düymə ilə fırlatma, sağ düymə ilə yaxınlaşdırma */
function initMouseGestures() {
    const container = map.getContainer();
    let rotating = false, lastX = 0;
    let zooming = false, lastY = 0, rightMoved = false;

    container.addEventListener("mousedown", e => {
        if (e.button === 1) {
            rotating = true;
            lastX = e.clientX;
            e.preventDefault();
        } else if (e.button === 2) {
            zooming = true;
            rightMoved = false;
            lastY = e.clientY;
        }
    });

    window.addEventListener("mousemove", e => {
        if (rotating) {
            map.setBearing(map.getBearing() + (e.clientX - lastX) * 0.5);
            lastX = e.clientX;
        }
        if (zooming && Math.abs(lastY - e.clientY) >= 12) {
            rightMoved = true;
            map.setZoom(map.getZoom() + (lastY > e.clientY ? 0.25 : -0.25), { animate: false });
            lastY = e.clientY;
        }
    });

    window.addEventListener("mouseup", e => {
        if (e.button === 1) rotating = false;
        if (e.button === 2) zooming = false;
    });

    container.addEventListener("contextmenu", e => {
        e.preventDefault();
        if (measure.active && !rightMoved) undoMeasurePoint();
    });
}

function drawRoutes() {
    routesLayer.clearLayers();
    visibleEntries().forEach(({ item: r }) => {
        if (!r.coords || r.coords.length < 2) return;
        const color = STATUS_COLORS[r.status] || STATUS_COLORS.layihe;

        // Peyk görüntüsü üzərində oxunması üçün altda tünd kontur
        L.polyline(r.coords, { color: "#04101c", weight: 8, opacity: .55, interactive: false }).addTo(routesLayer);
        const line = L.polyline(r.coords, { color, weight: 4.5, opacity: 1 }).addTo(routesLayer);

        line.bindTooltip(`
            <div class="tip-title" style="color:${color}">${esc(r.id)}: ${esc(r.name)}</div>
            <div><b>A ➔ B:</b> ${esc(r.pointA)} ➔ ${esc(r.pointB)}</div>
            <div><b>${t("thContractor")}:</b> ${esc(r.contractor || t("notAssigned"))}</div>
            <div><b>${t("thDone")}:</b> ${formatKm(r.doneKm)} / ${formatKm(r.totalKm)} km</div>
        `, { sticky: true, className: "map-tip" });
        line.on("click", () => { if (!measure.active) flyToCoords(r.coords); });

        const endpoint = (latlng, label) => L.circleMarker(latlng, { radius: 5, color: "#FFFFFF", fillColor: color, fillOpacity: 1, weight: 2 })
            .addTo(routesLayer)
            .bindTooltip(esc(label), { className: "map-tip" });
        endpoint(r.coords[0], `A: ${r.pointA}`);
        endpoint(r.coords[r.coords.length - 1], `B: ${r.pointB}`);
    });
}

function onMapClick(e) {
    $("coordClicked").value = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
    if (measure.active) addMeasurePoint(e.latlng);
}

/* XƏTKEŞ */
function setMeasuring(active) {
    measure.active = active;
    $("rulerBtn").classList.toggle("active", active);
    $("map").classList.toggle("measuring", active);
    $("measureHint").hidden = !active;
    if (active) {
        closePopovers();
        map.doubleClickZoom.disable();
    } else {
        map.doubleClickZoom.enable();
        $("measureTip").hidden = true;
        removeTempLine();
    }
}

function removeTempLine() {
    if (measure.tempLine) {
        measureLayer.removeLayer(measure.tempLine);
        measure.tempLine = null;
    }
}

function pathLength(points) {
    return points.reduce((sum, p, i) => i ? sum + points[i - 1].distanceTo(p) : 0, 0);
}

function updateMeasurePreview(e) {
    if (!measure.active || measure.points.length === 0) return;
    const last = measure.points[measure.points.length - 1];

    const tip = $("measureTip");
    tip.hidden = false;
    tip.style.left = `${e.originalEvent.clientX}px`;
    tip.style.top = `${e.originalEvent.clientY}px`;
    tip.textContent = `${t("measureTotal")}: ${formatDistance(pathLength(measure.points) + last.distanceTo(e.latlng))}`;

    removeTempLine();
    measure.tempLine = L.polyline([last, e.latlng], { color: MEASURE_COLOR, weight: 3, dashArray: "4 4", opacity: .75, interactive: false }).addTo(measureLayer);
}

function addMeasurePoint(latlng) {
    const previous = measure.points[measure.points.length - 1];
    const marker = L.circleMarker(latlng, { radius: 5, color: "#fff", weight: 2, fillColor: MEASURE_COLOR, fillOpacity: 1, interactive: false }).addTo(measureLayer);
    const segment = { marker };

    if (previous) {
        segment.line = L.polyline([previous, latlng], { color: MEASURE_COLOR, weight: 4, opacity: .95, interactive: false }).addTo(measureLayer);
        const middle = L.latLng((previous.lat + latlng.lat) / 2, (previous.lng + latlng.lng) / 2);
        segment.label = L.marker(middle, {
            interactive: false,
            icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<span class="measure-label">${formatDistance(previous.distanceTo(latlng))}</span>` })
        }).addTo(measureLayer);
    }

    measure.points.push(latlng);
    measure.segments.push(segment);
    $("clearRulerBtn").hidden = false;
}

function undoMeasurePoint() {
    const segment = measure.segments.pop();
    if (!segment) return;
    measure.points.pop();
    Object.values(segment).forEach(layer => measureLayer.removeLayer(layer));
    removeTempLine();
    if (measure.points.length === 0) {
        $("measureTip").hidden = true;
        $("clearRulerBtn").hidden = true;
    }
}

function clearMeasurements() {
    measureLayer.clearLayers();
    measure.points = [];
    measure.segments = [];
    measure.tempLine = null;
    $("measureTip").hidden = true;
    $("clearRulerBtn").hidden = true;
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
    if (goToMarker) map.removeLayer(goToMarker);
    goToMarker = L.marker([lat, lng], { icon: L.divIcon({ className: "", html: '<div class="pin"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }) })
        .addTo(map)
        .bindPopup(`${t("coordSearched")}: ${lat}, ${lng}`);
    map.setView([lat, lng], 17);
    goToMarker.openPopup();
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
    $("sidebar").hidden = !open;
    $("sidebarOpen").hidden = open;
}

function setDrawer(open) {
    $("drawer").classList.toggle("open", open);
    $("drawerBody").hidden = !open;
    $("drawerToggle").setAttribute("aria-expanded", open);
    $("drawerArrow").className = `fa-solid ${open ? "fa-chevron-down" : "fa-chevron-up"}`;
    if (open && window.innerWidth <= 760) setSidebar(false);
}

function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
}

function renderLayerOptions() {
    if (!map) return;
    $("layerOptions").innerHTML = Object.entries(baseLayers).map(([name, base]) => `
        <button class="layer-opt ${name === currentBase ? "active" : ""}" data-layer="${name}">
            <i class="fa-solid ${base.icon}"></i> ${t(base.label)}
        </button>
    `).join("");
}

function renderLegend() {
    $("legend").innerHTML = `
        <h3>${t("legendTitle")}</h3>
        ${STATUSES.map(s => `<div class="legend-row"><span class="legend-line" style="background:${STATUS_COLORS[s]}"></span>${t(`status${s}`)}</div>`).join("")}
        <div class="legend-row"><span class="legend-pt"><span></span></span>${t("pointA")} / ${t("pointB")}</div>
    `;
}

function renderChips() {
    const chips = [{ key: "all", label: t("filterAll") }, ...STATUSES.map(s => ({ key: s, label: t(`status${s}`), color: STATUS_COLORS[s] }))];
    $("statusChips").innerHTML = chips.map(c => `
        <button class="chip ${state.statusFilter === c.key ? "active" : ""}" data-status="${c.key}">
            ${c.color ? `<span class="dot" style="background:${c.color}"></span>` : ""}${c.label}
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
    $("projectCount").textContent = `(${shown.length})`;

    $("projectList").innerHTML = shown.length === 0 ? `<div class="empty">${t("noResults")}</div>` : shown.map(p => {
        const visible = state.visibleIds.has(p.id);
        const expanded = state.expandedIds.has(p.id);
        const sum = totals(p.items);
        const pct = percent(sum.done, sum.plan);
        return `
            <div class="project ${visible ? "visible" : ""}" data-id="${esc(p.id)}">
                <div class="project-row">
                    <button class="project-main" data-action="expand" aria-expanded="${expanded}">
                        <span class="dot" style="background:${STATUS_COLORS[p.status] || STATUS_COLORS.layihe}"></span>
                        <strong title="${esc(p.name)}">${esc(p.name)}</strong>
                        <span class="project-pct">${pct}%</span>
                    </button>
                    ${p.imported && isAdmin() ? `<button class="icon-btn small" data-action="delete" title="${t("delete")}"><i class="fa-solid fa-trash"></i></button>` : ""}
                    <button class="icon-btn small" data-action="toggle" title="${t("toggleVisibility")}"><i class="fa-solid ${visible ? "fa-eye" : "fa-eye-slash"}"></i></button>
                </div>
                <div class="progress"><span style="width:${pct}%;background:${STATUS_COLORS[p.status] || STATUS_COLORS.layihe}"></span></div>
                ${expanded ? `<div class="segments">${filteredItems(p).map(r => `
                    <button class="segment" data-action="focus" data-item="${esc(r.id)}">
                        <span class="dot" style="background:${STATUS_COLORS[r.status] || STATUS_COLORS.layihe}"></span>
                        <span title="${esc(r.name)}">${esc(r.name)}</span>
                        <span>${formatKm(r.doneKm)}/${formatKm(r.totalKm)}</span>
                    </button>`).join("")}</div>` : ""}
            </div>`;
    }).join("");
}

function renderTable() {
    const entries = visibleEntries();
    $("drawerCount").textContent = `(${entries.length})`;
    $("tableHead").innerHTML = `<tr>
        <th>${t("thRoute")}</th><th>${t("thDates")}</th><th>${t("thContractor")}</th>
        <th class="num">${t("thTotal")}</th><th class="num">${t("thDone")}</th><th class="num">${t("thLeft")}</th>
        <th>${t("thAssets")}</th><th>${t("thStatus")}</th>
    </tr>`;

    $("tableBody").innerHTML = entries.map(({ project, item: r }, index) => `
        <tr data-index="${index}">
            <td><b>${esc(r.pointA)}</b> ➔ <b>${esc(r.pointB)}</b><small>${esc(project.name)} · ${esc(r.name)}</small></td>
            <td>${formatDate(r.startDate)} ➔ ${formatDate(r.endDate)}</td>
            <td>${esc(r.contractor || t("notAssigned"))}</td>
            <td class="num"><b>${formatKm(r.totalKm)} km</b></td>
            <td class="num c-done">${formatKm(r.doneKm)} km</td>
            <td class="num c-left">${formatKm(Math.max(0, r.totalKm - r.doneKm))} km</td>
            <td>${r.closures || 0} / ${r.manholes || 0}</td>
            <td><span class="status" style="color:${STATUS_COLORS[r.status] || STATUS_COLORS.layihe}"><span class="dot" style="background:currentColor"></span>${t(`status${r.status}`)}</span></td>
        </tr>
    `).join("");

    const sum = totals(entries.map(e => e.item));
    $("tableFoot").innerHTML = entries.length === 0 ? "" : `<tr>
        <td colspan="3">${t("grandTotal")}</td>
        <td class="num">${formatKm(sum.plan)} km</td>
        <td class="num c-done">${formatKm(sum.done)} km</td>
        <td class="num c-left">${formatKm(Math.max(0, sum.plan - sum.done))} km</td>
        <td colspan="2">${sum.closures} ${t("closuresUnit")} / ${sum.manholes} ${t("manholesUnit")}</td>
    </tr>`;
}

function renderContractors() {
    const names = [...new Set(visibleEntries().map(e => e.item.contractor).filter(Boolean))];
    $("contractorList").innerHTML = names.length === 0 ? `<div class="muted">—</div>` : names.map(name => {
        const info = state.contractors[name];
        return `<div class="contractor"><strong>${esc(name)}</strong>${info
            ? `${t("workers")}: ${info.workers} · ${t("machinery")}: ${info.machinery}<br>${t("engineer")}: ${esc(info.engineer)}`
            : t("notAssigned")}</div>`;
    }).join("");
}

function renderMaterials() {
    $("materialsHead").innerHTML = `<tr><th>${t("thProject")}</th><th>${t("thMaterial")}</th><th>${t("thQuantity")}</th><th>${t("thState")}</th></tr>`;
    $("materialsBody").innerHTML = state.materials.map(m => `
        <tr><td>${esc(m.project)}</td><td>${esc(m.material)}</td><td>${esc(m.quantity)}</td><td class="c-done">${t(`state${m.state}`)}</td></tr>
    `).join("");
}

function renderAll() {
    if (!map) return;
    renderKpis();
    renderProjects();
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
            const km = pathLength(line.coords.map(c => L.latLng(c))) / 1000;
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
        applyLanguage(e.target.value);
    });
    $("themeBtn").addEventListener("click", () => {
        const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
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

    $("sidebarToggle").addEventListener("click", () => setSidebar(false));
    $("sidebarOpen").addEventListener("click", () => setSidebar(true));
    $("drawerToggle").addEventListener("click", () => setDrawer(!$("drawer").classList.contains("open")));

    $("searchInput").addEventListener("input", e => {
        state.query = e.target.value.trim().toLocaleLowerCase("az");
        renderAll();
    });
    $("statusChips").addEventListener("click", e => {
        const chip = e.target.closest("[data-status]");
        if (!chip) return;
        state.statusFilter = chip.dataset.status;
        renderChips();
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
            if (state.expandedIds.has(project.id)) {
                state.expandedIds.delete(project.id);
            } else {
                state.expandedIds.add(project.id);
                state.visibleIds.add(project.id);
                flyToCoords(project.items.flatMap(r => r.coords));
            }
        } else if (action === "focus") {
            flyToCoords(project.items.find(r => r.id === button.dataset.item).coords);
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
        if (row) flyToCoords(visibleEntries()[Number(row.dataset.index)].item.coords);
    });

    $("zoomInBtn").addEventListener("click", () => map.zoomIn());
    $("zoomOutBtn").addEventListener("click", () => map.zoomOut());
    $("homeBtn").addEventListener("click", () => {
        map.setBearing(0);
        fitHome();
    });
    $("northBtn").addEventListener("click", () => map.setBearing(0));
    $("fullscreenBtn").addEventListener("click", toggleFullscreen);
    $("layersBtn").addEventListener("click", () => togglePopover("layersPopover", "layersBtn"));
    $("coordBtn").addEventListener("click", () => togglePopover("coordPopover", "coordBtn"));
    $("rulerBtn").addEventListener("click", () => setMeasuring(!measure.active));
    $("clearRulerBtn").addEventListener("click", clearMeasurements);
    $("coordCopy").addEventListener("click", copyCoord);
    $("coordForm").addEventListener("submit", goToCoords);

    $("layerOptions").addEventListener("click", e => {
        const option = e.target.closest("[data-layer]");
        if (!option) return;
        switchBaseLayer(option.dataset.layer);
        closePopovers();
    });

    document.addEventListener("keydown", e => {
        if (e.key === "Escape" && measure.active) setMeasuring(false);
    });
}

async function init() {
    const lang = readStore(STORAGE.lang, "az");
    const language = I18N[lang] ? lang : "az";
    $("langSelect").value = language;
    state.lang = language;
    applyTheme(readStore(STORAGE.theme, "dark"));

    if (window.innerWidth <= 760) setSidebar(false);

    bindEvents();
    initMap();
    applyLanguage(language);

    const user = api.configured ? await api.getUser() : null;
    if (user) await enterApp(user);
    else $("login").hidden = false;
}

document.addEventListener("DOMContentLoaded", init);
