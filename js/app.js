/* BCG GIS paneli: vəziyyət, xəritə, panellər */

const AZERBAIJAN_BOUNDS = [[38.39, 44.77], [41.91, 50.63]];

const STATUS_COLORS = { bitmis: "#22C55E", icrada: "#F59E0B", tehvil: "#3B82F6", layihe: "#EF4444", lif_goturulen: "#94A3B8" };
const ENDPOINT_MIN_ZOOM = 0;
const STATUSES = Object.keys(STATUS_COLORS);
const isLifGoturulen = (r, project) => Boolean(r?.status === "lif_goturulen" || project?.status === "lif_goturulen");

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
    statusFilters: new Set(),
    query: "",
    expandedIds: new Set(),
    selected: null,
    dockTab: "segments",
    notes: [],
    sidebarCategory: "project",
    activeFolders: new Set(),
    focusMode: false,
    quickEditKey: null
};

let map, routePopup, currentBase = "satellite", goToMarker;
let namesOn = false;

const $ = id => document.getElementById(id);
const t = key => I18N[state.lang][key] || key;

/* Mətn və atribut üçün təhlükəsiz HTML: dırnaqlar da qorunur */
const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(value) {
    return (value == null ? "" : String(value)).replace(/[&<>"']/g, ch => ESC_MAP[ch]);
}

function cleanProjectName(name, sheetId) {
    let s = String(name || "").trim();
    if (sheetId) {
        const escId = String(sheetId).trim().replace(/\./g, "\\.");
        s = s.replace(new RegExp(`^${escId}[.)\\s-]+`, "i"), "").trim();
    }
    // Strip any leading numbering prefix like "10.", "11. ", "16.1 ", "15.1.1 ", "10-", etc.
    s = s.replace(/^\d{1,2}\.\d{1,2}(?:\.\d{1,2})*[.)\s-]+/, "").trim();
    s = s.replace(/^\d{1,2}\s*[.)\-]\s*/, "").trim();
    // Specifically handle "10.239" -> "239"
    s = s.replace(/^10\.(?=\s*239)/i, "").trim();
    return s;
}

function getProjectIconHtml(project, tone = "#38bdf8") {
    const name = String(project?.name || "").toLocaleLowerCase("az");
    const cat = project?.category || "project";
    let icon = "fa-diagram-project";
    if (cat === "nim") icon = "fa-traffic-light";
    else if (cat === "azconnect") icon = "fa-tower-cell";
    else if (cat === "other") icon = "fa-layer-group";
    else if (/radar/i.test(name)) icon = "fa-satellite-dish";
    else if (/239|region/i.test(name)) icon = "fa-map-location-dot";
    else if (/avtobus/i.test(name)) icon = "fa-bus";
    else if (/kamera|smart/i.test(name)) icon = "fa-video";
    else if (/magistral|yol/i.test(name)) icon = "fa-road";
    else if (/təmir|bərpa/i.test(name)) icon = "fa-screwdriver-wrench";
    else if (/inventar/i.test(name)) icon = "fa-clipboard-check";
    else if (/dəyişim|deyisim/i.test(name)) icon = "fa-arrows-rotate";
    else if (/sağlamlaşdırma/i.test(name)) icon = "fa-heart-pulse";
    else if (/gəncə|naxçıvan/i.test(name)) icon = "fa-city";
    else if (/layihəsiz/i.test(name)) icon = "fa-location-crosshairs";
    return `<i class="fa-solid ${icon}" style="color:${tone};margin-right:5px;font-size:12px;flex-shrink:0"></i>`;
}

const formatDate = iso => iso ? iso.split("-").reverse().join(".") : "—";
const formatKm = km => {
    const n = Number(km) || 0;
    return Number(n.toFixed(3)).toString();
};
const toKmValue = val => {
    const n = Number(val) || 0;
    if (n <= 0) return 0;
    return n >= 100 ? n / 1000 : n;
};
const normalizePointMetersInput = val => {
    const n = Number(String(val ?? "").replace(/,/g, ".")) || 0;
    if (n <= 0) return 0;
    return n >= 100 ? Math.round(n) : Math.round(n * 1000);
};
function isPointItemRecord(r) {
    if (!r) return false;
    return Boolean(r.summary || r.unit === "m" || (r.antennas || 0) > 0 || (Array.isArray(r.coords) && r.coords.length === 1));
}
function getPointKmPair(r) {
    if (!r) return { planKm: 0, doneKm: 0 };
    const rawPlan = Number(r.totalKm) || 0;
    const rawDone = Number(r.doneKm) || 0;
    if (r.unit === "km") return { planKm: rawPlan, doneKm: rawDone };
    if (r.unit === "m" || rawPlan >= 100 || rawDone >= 100) {
        return { planKm: rawPlan / 1000, doneKm: rawDone / 1000 };
    }
    return { planKm: rawPlan, doneKm: rawDone };
}
function getPointMetersPair(r) {
    if (!r) return { planM: 0, doneM: 0 };
    const rawPlan = Number(r.totalKm) || 0;
    const rawDone = Number(r.doneKm) || 0;
    if (r.unit === "km") return { planM: Math.round(rawPlan * 1000), doneM: Math.round(rawDone * 1000) };
    if (r.unit === "m" || rawPlan >= 100 || rawDone >= 100) {
        return { planM: Math.round(rawPlan), doneM: Math.round(rawDone) };
    }
    return { planM: Math.round(rawPlan * 1000), doneM: Math.round(rawDone * 1000) };
}
const formatDistance = m => m >= 1000 ? `${formatKm(m / 1000)} km` : `${Math.round(m)} m`;
const percent = (done, total) => total > 0 ? Math.min(100, Math.round(done / total * 100)) : 0;

// BRAUZER YADDAŞ LİMİTİNİ (5 MB) GİQABAYTLARA QALDIRAN İNDEXEDDB ADAPTERİ
const IDB_NAME = "bcg_large_storage_v1";
const IDB_STORE = "kv_store";
let idbPromise = null;

function getIDB() {
    if (!window.indexedDB) return Promise.resolve(null);
    if (!idbPromise) {
        idbPromise = new Promise((resolve) => {
            const req = indexedDB.open(IDB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) {
                    db.createObjectStore(IDB_STORE);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        });
    }
    return idbPromise;
}

async function saveToIndexedDB(key, value) {
    try {
        const db = await getIDB();
        if (!db) return false;
        return new Promise((resolve) => {
            const tx = db.transaction(IDB_STORE, "readwrite");
            tx.objectStore(IDB_STORE).put(value, key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        });
    } catch {
        return false;
    }
}

async function getFromIndexedDB(key) {
    try {
        const db = await getIDB();
        if (!db) return null;
        return new Promise((resolve) => {
            const tx = db.transaction(IDB_STORE, "readonly");
            const req = tx.objectStore(IDB_STORE).get(key);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => resolve(null);
        });
    } catch {
        return null;
    }
}

// Brauzerə daimi və geniş disk yaddaşı icazəsi sorğusu (Chrome/Edge Storage Persist)
if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
}

function readStore(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function writeStore(key, value) {
    const str = JSON.stringify(value);
    try {
        localStorage.setItem(key, str);
    } catch (e) {
        try {
            localStorage.removeItem("bcg.db.snapshot.v1");
            localStorage.removeItem("bcg.audit.logs.v1");
            localStorage.setItem(key, str);
        } catch {
            console.warn(`localStorage doldu (${key}), limitsiz IndexedDB-yə yazıldı.`);
        }
        saveToIndexedDB(key, value);
    }
}

const DELETED_PROJ_KEY = "bcg.deleted.projects.v1";
const DELETED_SEG_KEY = "bcg.deleted.segments.v1";

function getDeletedProjectIds() {
    const arr = readStore(DELETED_PROJ_KEY, []);
    return new Set(Array.isArray(arr) ? arr : []);
}

function getDeletedSegmentKeys() {
    const arr = readStore(DELETED_SEG_KEY, []);
    return new Set(Array.isArray(arr) ? arr : []);
}

function markProjectDeleted(projId) {
    if (!projId) return;
    const set = getDeletedProjectIds();
    set.add(projId);
    writeStore(DELETED_PROJ_KEY, [...set]);
}

function markSegmentDeleted(projId, itemId) {
    if (!projId || !itemId) return;
    const set = getDeletedSegmentKeys();
    set.add(`${projId}:${itemId}`);
    writeStore(DELETED_SEG_KEY, [...set]);
}

function purgeDeletedFromState() {
    const delProjs = getDeletedProjectIds();
    const delSegs = getDeletedSegmentKeys();
    if (delProjs.size === 0 && delSegs.size === 0) return;
    state.projects = (state.projects || []).filter(p => p && !delProjs.has(p.id));
    state.projects.forEach(p => {
        if (Array.isArray(p.items)) {
            p.items = p.items.filter(r => r && !delSegs.has(`${p.id}:${r.id}`));
        }
    });
    delProjs.forEach(id => {
        state.visibleIds.delete(id);
        state.expandedIds.delete(id);
    });
}

function getStorageInfo() {
    let totalBytes = 0;
    const details = {};
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            const v = localStorage.getItem(k) || "";
            const bytes = (k.length + v.length) * 2;
            totalBytes += bytes;
            details[k] = Math.round(bytes / 1024);
        }
    } catch {}
    const totalKB = Math.round(totalBytes / 1024);
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
    const pct = Math.min(100, Math.round((totalKB / 5120) * 100));
    return { totalBytes, totalKB, totalMB, pct, details };
}

function cleanAppStorage() {
    let before = 0, after = 0;
    try {
        before = getStorageInfo().totalBytes;
        // 1. Audit jurnalları (köhnə əməliyyat qeydləri)
        localStorage.removeItem("bcg.audit.logs.v1");
        localStorage.removeItem("bcg.audit.v1");

        // 2. Orphaned segment və layihə meta qeydləri
        const validItemIds = new Set();
        (state.projects || []).forEach(p => {
            (p.items || []).forEach(it => {
                validItemIds.add(it.id);
                validItemIds.add(`${p.id}:${it.id}`);
            });
        });

        const segMeta = readStore("bcg.seg.meta.v2", {});
        const cleanedSegMeta = {};
        for (const [k, v] of Object.entries(segMeta || {})) {
            if (validItemIds.has(k)) cleanedSegMeta[k] = v;
        }
        writeStore("bcg.seg.meta.v2", cleanedSegMeta);

        // 3. İstifadə olunmayan köhnə həndəsə qeydləri
        const geom = readStore("bcg.geom.overrides.v1", {});
        const cleanedGeom = {};
        for (const [k, v] of Object.entries(geom || {})) {
            if (validItemIds.has(k)) cleanedGeom[k] = v;
        }
        writeStore("bcg.geom.overrides.v1", cleanedGeom);

        after = getStorageInfo().totalBytes;
    } catch (e) {
        console.warn("cleanAppStorage error:", e);
    }
    return Math.max(0, before - after);
}
window.getStorageInfo = getStorageInfo;
window.cleanAppStorage = cleanAppStorage;

function toast(message, isError = false) {
    const box = $("toasts");
    if (!box) return;
    // Turan bəy: ekranda ən çox son 2-3 əməliyyat görünsün, ekran tutulmasın
    while (box.children.length >= 3) {
        box.removeChild(box.firstElementChild);
    }
    const el = document.createElement("div");
    el.className = `toast${isError ? " error" : ""}`;
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => {
        if (el.parentNode) el.remove();
    }, 3200);
}

function hasActiveStatusFilter() {
    return Boolean(state.statusFilters && state.statusFilters.size > 0);
}

function statusMatchesFilter(status) {
    return !hasActiveStatusFilter() || state.statusFilters.has(status);
}

function statusFilterSignature() {
    return hasActiveStatusFilter() ? [...state.statusFilters].sort().join(",") : "all";
}

/* Seçilmiş status filtrinə (1 və ya bir neçə status) və axtarışa uyğun seqmentlər (Digər qovluğu status filtrindən təsirlənmir, açıq qalır) */
function matchesFilters(project, item) {
    if (project.category !== "other" && hasActiveStatusFilter()) {
        const ownMatch = statusMatchesFilter(item.status);
        if (!ownMatch) {
            const pmoKey = (item?.isPmoRayon && typeof getPmoRayonClusterKey === "function")
                ? getPmoRayonClusterKey(project, item)
                : "";
            const isExp = Boolean(pmoKey && state.expandedRayons && (state.expandedRayons.has(pmoKey) || state.expandedRayons.has(`${project.id}::pmo::${item.id}`)));
            const hasMatchingSub = isExp && Array.isArray(item.pmoRayon?.subPoints) && item.pmoRayon.subPoints.some(sp => statusMatchesFilter(sp.status));
            if (!hasMatchingSub) return false;
        }
    }
    if (!state.query) return true;
    const haystack = [project.name, item.id, item.name, item.pointA, item.pointB, item.contractor].join(" ");
    return haystack.toLocaleLowerCase("az").includes(state.query);
}

const filteredItems = project => project.items.filter(item => matchesFilters(project, item));

function visibleEntries() {
    return state.projects
        .filter(p => state.visibleIds.has(p.id) && state.activeFolders.has(p.category || "project"))
        .flatMap(p => filteredItems(p).map(item => ({ project: p, item })));
}

function totals(items) {
    return (items || []).reduce((sum, r) => {
        const { planKm, doneKm } = isPointItemRecord(r)
            ? getPointKmPair(r)
            : { planKm: Number(r.totalKm) || 0, doneKm: Number(r.doneKm) || 0 };
        return {
            plan: sum.plan + planKm,
            done: sum.done + doneKm,
            closures: sum.closures + (r.closures || 0),
            manholes: sum.manholes + (r.manholes || 0)
        };
    }, { plan: 0, done: 0, closures: 0, manholes: 0 });
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
const isViewer = () => !isAdmin();

function renderRole() {
    const email = state.user?.email || "";
    const roleMap = { admin: "Rol: Admin", editor: "Rol: Redaktor", viewer: "Rol: Baxış", manager: "Rol" };
    $("roleBadge").textContent = roleMap[state.role] || "Rol";
    $("userEmail").textContent = email;
    $("userAvatar").textContent = (state.user?.name || email).charAt(0).toUpperCase();
    $("importBtn").hidden = !isAdmin();
    $("addProjectBtn").hidden = !isAdmin();
    if ($("usersBtn")) $("usersBtn").hidden = !isAdmin();
    if ($("pmoExcelBtn")) $("pmoExcelBtn").hidden = !isAdmin();
    if ($("shareBtn")) $("shareBtn").hidden = !isAdmin();
    if ($("noteForm")) $("noteForm").hidden = false;
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
    const submitBtn = event.submitter || event.target?.querySelector?.('button[type="submit"], button:not([type])');
    const oldBtnHtml = submitBtn ? submitBtn.innerHTML : "";
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Giriş edilir…`;
    }
    const restoreBtn = () => { if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = oldBtnHtml; } };
    const result = await api.signIn(email, password);
    if (result.error) {
        restoreBtn();
        $("loginError").textContent = t(result.error === "credentials" ? "loginFailed" : "loginNetwork");
        return;
    }
    try { localStorage.setItem("bcg.admin.auth_pass.v1", password); } catch {}
    $("loginError").textContent = "";
    $("loginPass").value = "";
    await enterApp(result.user);
    restoreBtn();
}

function resetState() {
    Object.assign(state, { user: null, role: "manager", projects: [], contractors: {}, materials: [], notes: [], selected: null, statusFilter: "all", query: "" });
    state.statusFilters.clear();
    state.visibleIds.clear();
    state.expandedIds.clear();
    state.activeFolders.clear();
    if ($("searchInput")) $("searchInput").value = "";
}

function showLogin(message = "") {
    $("loginError").textContent = message;
    $("loginUser").value = "";
    $("login").hidden = false;
    $("topActions").classList.remove("open");
    if (api.configured) api.prefetch();
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

const STORAGE_IMPORTED_KEY = "bcg.imported_projects.v2";
const SEG_META_STORE_KEY = "bcg.seg.meta.v1";
const PROJ_META_STORE_KEY = "bcg.proj.meta.v1";
const ADMIN_CONTRACTORS_KEY = "bcg.admin.contractors.v2";
const HIDDEN_PROJ_STORE_KEY = "bcg.hidden_projects.v1";

function getHiddenProjectIds() {
    const arr = readStore(HIDDEN_PROJ_STORE_KEY, []);
    return new Set(Array.isArray(arr) ? arr : []);
}

function setProjectHiddenState(projId, isHidden) {
    if (!projId) return;
    const set = getHiddenProjectIds();
    if (isHidden) set.add(projId);
    else set.delete(projId);
    writeStore(HIDDEN_PROJ_STORE_KEY, [...set]);
}

/* === CTRL + Z (Geri Qaytarma / Undo) Sistemi === */
const undoStack = [];
const MAX_UNDO_STEPS = 25;

function pushUndoSnapshot(label = "Son əməliyyat") {
    try {
        undoStack.push({
            label,
            projects: JSON.parse(JSON.stringify(state.projects || [])),
            visibleIds: [...state.visibleIds],
            activeFolders: [...state.activeFolders],
            expandedIds: [...state.expandedIds],
            selected: state.selected ? { ...state.selected } : null,
            stores: {
                [PROJ_META_STORE_KEY]: localStorage.getItem(PROJ_META_STORE_KEY),
                [SEG_META_STORE_KEY]: localStorage.getItem(SEG_META_STORE_KEY),
                [STORAGE_IMPORTED_KEY]: localStorage.getItem(STORAGE_IMPORTED_KEY),
                [HIDDEN_PROJ_STORE_KEY]: localStorage.getItem(HIDDEN_PROJ_STORE_KEY),
                "bcg.geom.overrides.v1": localStorage.getItem("bcg.geom.overrides.v1"),
                "bcg.custom.items.v1": localStorage.getItem("bcg.custom.items.v1")
            }
        });
        if (undoStack.length > MAX_UNDO_STEPS) undoStack.shift();
    } catch (e) {
        console.warn("pushUndoSnapshot xətası:", e);
    }
}
window.pushUndoSnapshot = pushUndoSnapshot;

async function performUndo() {
    if (undoStack.length === 0) {
        toast("ℹ️ Geri qaytarılacaq əməliyyat yoxdur (Ctrl+Z)");
        return;
    }
    const snap = undoStack.pop();
    try {
        for (const [k, v] of Object.entries(snap.stores || {})) {
            if (v === null || v === undefined) localStorage.removeItem(k);
            else localStorage.setItem(k, v);
        }
        state.projects = JSON.parse(JSON.stringify(snap.projects || []));
        state.visibleIds = new Set(snap.visibleIds || []);
        state.activeFolders = new Set(snap.activeFolders || ["project"]);
        state.expandedIds = new Set(snap.expandedIds || []);
        state.selected = snap.selected ? { ...snap.selected } : null;
        state.quickEditKey = null;

        renderAll();
        toast(`↩️ Geri qaytarıldı (Ctrl+Z): ${snap.label}`);

        if (isAdmin() && api.configured) {
            for (const p of state.projects) {
                try { await api.saveProject(p); } catch {}
            }
        }
    } catch (e) {
        console.warn("performUndo xətası:", e);
    }
}
window.performUndo = performUndo;

window.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z") {
        const tag = (e.target?.tagName || "").toUpperCase();
        const type = (e.target?.type || "").toLowerCase();
        const isTextInput = (tag === "INPUT" && type !== "checkbox" && type !== "radio" && type !== "button") || tag === "TEXTAREA" || e.target?.isContentEditable;
        if (isTextInput) return;
        e.preventDefault();
        performUndo();
    }
});

/* === ÇAP (Cari Ekran Zoomu ilə PDF) VƏ KMZ EXPORT === */
function prepareExactPrintSnapshot() {
    try {
        if (!window.map) return;
        const stage = document.querySelector(".map-stage");
        if (!stage) return;
        let img = $("printExactMapImg");
        if (!img) {
            img = document.createElement("img");
            img.id = "printExactMapImg";
            img.className = "print-exact-map-img";
            img.alt = "Xəritə Çap Görünüşü";
            stage.appendChild(img);
        }
        map.triggerRepaint?.();
        const dataUrl = map.getCanvas().toDataURL("image/png");
        if (dataUrl && dataUrl.startsWith("data:image/")) {
            img.src = dataUrl;
        }
    } catch (e) {
        console.warn("prepareExactPrintSnapshot xətası:", e);
    }
}

window.addEventListener("beforeprint", prepareExactPrintSnapshot);
window.addEventListener("afterprint", () => {
    const img = $("printExactMapImg");
    if (img) img.removeAttribute("src");
});

function executePrintExactView() {
    if ($("exportPrintModal")?.open) $("exportPrintModal").close();
    prepareExactPrintSnapshot();
    setTimeout(() => {
        prepareExactPrintSnapshot();
        window.print();
    }, 120);
}
window.executePrintExactView = executePrintExactView;

function escXml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function hexToKmlColor(hex, alphaHex = "ff") {
    const norm = normalizeColorCode(hex, "#38BDF8").replace("#", "");
    if (norm.length !== 6) return `${alphaHex}f8bd38`;
    const r = norm.slice(0, 2).toLowerCase();
    const g = norm.slice(2, 4).toLowerCase();
    const b = norm.slice(4, 6).toLowerCase();
    return `${alphaHex}${b}${g}${r}`;
}

let jszipLoadingPromise = null;
async function ensureJSZip() {
    if (typeof JSZip !== "undefined") return window.JSZip;
    if (jszipLoadingPromise) return jszipLoadingPromise;
    jszipLoadingPromise = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
        s.async = true;
        s.onload = () => resolve(window.JSZip);
        s.onerror = () => {
            jszipLoadingPromise = null;
            reject(new Error("JSZip kitabxanası yüklənə bilmədi"));
        };
        document.head.appendChild(s);
    });
    return jszipLoadingPromise;
}

async function exportActiveToKmz() {
    await ensureJSZip().catch(() => null);
    const activeProjects = state.projects.filter(p =>
        state.visibleIds.has(p.id) && state.activeFolders.has(p.category || "project")
    );
    const projectsWithItems = activeProjects
        .map(p => ({ project: p, items: filteredItems(p) }))
        .filter(g => g.items.length > 0);

    if (projectsWithItems.length === 0) {
        toast("⚠️ Ekranda aktiv layihə və ya obyekt yoxdur!", true);
        return;
    }

    if ($("exportPrintModal")?.open) $("exportPrintModal").close();

    const foldersXml = projectsWithItems.map(({ project: p, items }) => {
        const isPts = p.type === "points" || p.category === "nim";
        const isOther = p.category === "other";
        const placemarksXml = items.map(r => {
            const rawColor = isOther
                ? (r.customColor || p.customColor || "#38BDF8")
                : (r.customColor || statusTone(r.status));
            const kmlLineCol = hexToKmlColor(rawColor, "ff");
            const kmlFillCol = hexToKmlColor(r.fillColor || rawColor, r.polyFilled ? "78" : "00");
            const width = Number(r.lineWidth || p.lineWidth || 2.5);
            const coords = Array.isArray(r.coords) ? r.coords : [];
            if (coords.length === 0) return "";

            const isPointGeom = isPts || coords.length === 1;
            const isPolyGeom = !isPointGeom && Boolean(r.isPolygon) && coords.length >= 3;

            let geomXml = "";
            if (isPointGeom) {
                const [lat, lng] = coords[0];
                geomXml = `<Point><coordinates>${lng},${lat},0</coordinates></Point>`;
            } else if (isPolyGeom) {
                const ring = [...coords];
                if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
                    ring.push(ring[0]);
                }
                const coordStr = ring.map(([lat, lng]) => `${lng},${lat},0`).join(" ");
                geomXml = `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coordStr}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
            } else {
                const coordStr = coords.map(([lat, lng]) => `${lng},${lat},0`).join(" ");
                geomXml = `<LineString><tessellate>1</tessellate><coordinates>${coordStr}</coordinates></LineString>`;
            }

            const { planM, doneM } = isPointGeom ? getPointMetersPair(r) : { planM: 0, doneM: 0 };
            const ptTypeVal = isPointGeom ? (extractPointType(r.props, r) || "") : "";
            const extData = `
                <ExtendedData>
                    <Data name="status"><value>${escXml(r.status || p.status || "layihe")}</value></Data>
                    <Data name="category"><value>${escXml(p.category || "project")}</value></Data>
                    ${ptTypeVal ? `<Data name="noqte_novu"><value>${escXml(ptTypeVal)}</value></Data>` : ""}
                    <Data name="pointA"><value>${escXml(r.pointA || "")}</value></Data>
                    <Data name="pointB"><value>${escXml(r.pointB || "")}</value></Data>
                    <Data name="totalKm"><value>${escXml(isPointGeom ? planM : (r.totalKm ?? 0))}</value></Data>
                    <Data name="doneKm"><value>${escXml(isPointGeom ? doneM : (r.doneKm ?? 0))}</value></Data>
                    <Data name="antennas"><value>${escXml(r.antennas ?? 0)}</value></Data>
                    <Data name="fiberCount"><value>${escXml(r.fiberCount || "")}</value></Data>
                    <Data name="contractor"><value>${escXml(r.contractor || "")}</value></Data>
                    <Data name="customColor"><value>${escXml(normalizeColorCode(rawColor, "#38BDF8"))}</value></Data>
                </ExtendedData>`;

            return `
            <Placemark>
                <name>${escXml(r.name || p.name)}</name>
                <Style>
                    <LineStyle><color>${kmlLineCol}</color><width>${width}</width></LineStyle>
                    <PolyStyle><color>${kmlFillCol}</color><fill>${r.polyFilled ? 1 : 0}</fill><outline>1</outline></PolyStyle>
                    <IconStyle><color>${kmlLineCol}</color><scale>1.1</scale></IconStyle>
                </Style>
                ${extData}
                ${geomXml}
            </Placemark>`;
        }).join("\n");

        return `
        <Folder>
            <name>${escXml(p.name)}</name>
            ${placemarksXml}
        </Folder>`;
    }).join("\n");

    const kmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
    <Document>
        <name>BCG GIS Export</name>
        ${foldersXml}
    </Document>
</kml>`;

    const dateStr = new Date().toISOString().slice(0, 10);
    if (typeof JSZip !== "undefined") {
        const zip = new JSZip();
        zip.file("doc.kml", kmlContent);
        const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `BCG_Export_${dateStr}.kmz`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast(`✅ Aktiv layihələr KMZ olaraq yükləndi (${projectsWithItems.length} layihə)`);
    } else {
        const blob = new Blob([kmlContent], { type: "application/vnd.google-earth.kml+xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `BCG_Export_${dateStr}.kml`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast(`✅ Aktiv layihələr KML olaraq yükləndi`);
    }
}
window.exportActiveToKmz = exportActiveToKmz;

function openExportPrintModal() {
    let modal = $("exportPrintModal");
    if (!modal) {
        modal = document.createElement("dialog");
        modal.id = "exportPrintModal";
        modal.className = "modal";
        modal.style.width = "min(440px, 94vw)";
        modal.innerHTML = `
            <div class="modal-head">
                <div>
                    <h2>🖨️ Çap və Export Seçimi</h2>
                    <p class="muted" id="exportModalSub">Ekranda hazırda aktiv olan layihələr avtomatik ixrac olunur</p>
                </div>
                <button class="icon-btn" type="button" data-exp-close title="Bağla"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div style="padding:14px 18px 18px;display:flex;flex-direction:column;gap:10px">
                <button type="button" class="btn btn-primary" id="expPdfBtn" style="height:46px;justify-content:flex-start;gap:12px;padding:0 16px;font-size:13.5px">
                    <i class="fa-solid fa-file-pdf" style="font-size:18px"></i>
                    <span style="display:flex;flex-direction:column;align-items:flex-start;line-height:1.25">
                        <b>PDF / Çap et (Cari ekran miqyası ilə)</b>
                        <small style="opacity:0.85;font-size:11px;font-weight:400">Əsas ekran hansı zoomdadırsa eynilə o miqyasda çap / PDF edir</small>
                    </span>
                </button>
                <button type="button" class="btn btn-outline" id="expKmzBtn" style="height:46px;justify-content:flex-start;gap:12px;padding:0 16px;font-size:13.5px;border-color:rgba(56,189,248,0.45)">
                    <i class="fa-solid fa-earth-americas" style="font-size:18px;color:#38BDF8"></i>
                    <span style="display:flex;flex-direction:column;align-items:flex-start;line-height:1.25">
                        <b>KMZ Formatında Yüklə (Aktiv layihələr)</b>
                        <small style="color:var(--ink-3);font-size:11px;font-weight:400">Ekranda aktiv olan bütün xətt, nöqtə və poliqonları .kmz kimi endirir</small>
                    </span>
                </button>
            </div>
        `;
        document.body.appendChild(modal);
        modal.addEventListener("click", e => {
            if (e.target === modal || e.target.closest("[data-exp-close]")) modal.close();
        });
        $("expPdfBtn")?.addEventListener("click", executePrintExactView);
        $("expKmzBtn")?.addEventListener("click", exportActiveToKmz);
    }
    const activeProjs = state.projects.filter(p => state.visibleIds.has(p.id) && state.activeFolders.has(p.category || "project"));
    const activeSegs = visibleEntries().length;
    if ($("exportModalSub")) {
        $("exportModalSub").textContent = `Hazırda ekranda ${activeProjs.length} aktiv layihə (${activeSegs} obyekt) seçilib`;
    }
    modal.showModal();
}
window.openExportPrintModal = openExportPrintModal;

const LEGACY_DEMO_CONTRACTORS = new Set([
    "bcg (öz briqadamız)",
    "bcg (oz briqadamiz)",
    "azfibertech mmc",
    "kaspiantelekom",
    "optik inşaat",
    "optik insaat",
    "aztelekom",
    "baktelekom"
]);

const BCG_LEADS_STORE_KEY = "bcg.exec.leads.v1";

function calcPointPct(doneVal, planVal, status) {
    if (status === "bitmis" || status === "tehvil") return 100;
    return percent(doneVal, planVal);
}

function isBcgContractor(name) {
    const s = String(name || "").trim();
    return /^bcg\b/i.test(s);
}

function getSavedBcgLeads() {
    const stored = readStore(BCG_LEADS_STORE_KEY, null);
    const map = {};
    if (Array.isArray(stored)) {
        stored.forEach(entry => {
            if (entry?.name) {
                map[String(entry.name).trim()] = {
                    workers: entry.workers ?? "",
                    phone: entry.phone || ""
                };
            }
        });
    } else if (stored && typeof stored === "object") {
        for (const [k, v] of Object.entries(stored)) {
            if (k && v && typeof v === "object") {
                map[k.trim()] = {
                    workers: v.workers ?? "",
                    phone: v.phone || ""
                };
            }
        }
    }
    (state.projects || []).forEach(p => {
        (p.items || []).forEach(r => {
            const lead = String(r?.execLead || "").trim();
            if (lead && !map[lead]) {
                map[lead] = {
                    workers: r.execWorkers ?? "",
                    phone: r.execPhone || ""
                };
            }
        });
    });
    return Object.entries(map).map(([name, info]) => ({
        name,
        workers: info?.workers ?? "",
        phone: info?.phone || ""
    }));
}

function saveBcgLeadEntry(leadName, workers, phone) {
    const cleanLead = String(leadName || "").trim();
    if (!cleanLead) return;
    const list = getSavedBcgLeads().filter(l => l.name.toLowerCase() !== cleanLead.toLowerCase());
    list.unshift({
        name: cleanLead,
        workers: workers !== undefined && workers !== "" ? Number(workers) || 0 : "",
        phone: String(phone || "").trim()
    });
    writeStore(BCG_LEADS_STORE_KEY, list);
    if (typeof api !== "undefined" && api.syncCloudRegistry) {
        api.syncCloudRegistry().catch(() => {});
    }
}

function extractContractorFromProps(p) {
    if (!p) return "";
    const direct = getPropCaseInsensitive(
        p,
        "icraçı", "icraci", "icracı", "icraçi", "contractor", "podratçı", "podratci", "podrat",
        "icraci_sirket", "icraçı_şirkət", "icraci_sirketi", "icraçı_şirkəti", "icraci_adi", "icraçı_adı",
        "icra_eden", "icraeden", "icra edən", "icracilar", "icraçılar", "briqada", "sirket", "şirkət",
        "operator", "provayder", "qurum", "partnyor", "partner"
    );
    if (direct !== undefined && cleanAttrVal(direct) !== undefined) {
        const str = String(direct).trim();
        if (str && !/^(?:null|<null>|none|yoxdur|-+|—+)$/i.test(str)) return str;
    }
    const pat = findPropByPattern(p, /^(icra|podrat|contract|briqad)/i, /^(icra_status|icrada)/i);
    if (pat && pat.val) {
        const valStr = String(pat.val).trim();
        if (valStr && !/^(layihe|icrada|bitmis|tehvil|plan|hazir|davam)$/i.test(normalizeStatus(valStr))) {
            return valStr;
        }
    }
    return "";
}

function parseContractorAndLead(rawContractor, props) {
    const p = props || {};
    let contractorStr = String(rawContractor || "").trim();
    if (!contractorStr) {
        contractorStr = extractContractorFromProps(p);
    }
    let execLead = String(
        getPropCaseInsensitive(
            p,
            "muhendis", "mühəndis", "briqadir", "kim_isleyib", "kim_işləyib", "kim isleyib", "kim işləyib",
            "mesul", "məsul", "engineer", "lead", "bcg_muhendis", "usta"
        ) || ""
    ).trim();
    const rawWrk = getPropCaseInsensitive(
        p,
        "isci_sayi", "işçi_sayı", "isci sayi", "işçi sayı", "isci", "işçi", "workers", "nece_nefer", "neçə_nəfər"
    );
    const execWorkers = rawWrk !== undefined && cleanAttrVal(rawWrk) !== undefined
        ? Math.max(0, Math.round(parseAttrNumber(rawWrk, 0)))
        : "";
    const execPhone = String(
        getPropCaseInsensitive(
            p,
            "elaqe", "əlaqə", "elaqe_nomresi", "əlaqə_nömrəsi", "telefon", "nomre", "nömrə", "phone", "tel", "mobil"
        ) || ""
    ).trim();

    // Əgər sütunda "BCG - Əli Məmmədov" və ya "BCG / Əli" yazılıbsa avtomatik ayır
    const bcgSplit = contractorStr.match(/^bcg\s*[-–—/:]\s*(.+)$/i);
    if (bcgSplit) {
        contractorStr = "BCG";
        if (!execLead) execLead = bcgSplit[1].trim();
    } else if (/^bcg$/i.test(contractorStr)) {
        contractorStr = "BCG";
    } else if (contractorStr) {
        const matched = findContractorInfo(contractorStr);
        if (matched) contractorStr = matched.name;
    }

    if (execLead) {
        saveBcgLeadEntry(execLead, execWorkers, execPhone);
    }

    return {
        contractor: contractorStr,
        execLead,
        execWorkers,
        execPhone
    };
}

function resolveItemExecDetails(r) {
    if (!r) return { contractor: "", isBcg: false, lead: "", workers: "", phone: "", machinery: "", cardSummary: "" };
    let contractor = String(r.contractor || "").trim();
    let leadFromContractor = "";
    const bcgSplit = contractor.match(/^bcg\s*[-–—/:]\s*(.+)$/i);
    if (bcgSplit) {
        contractor = "BCG";
        leadFromContractor = bcgSplit[1].trim();
    } else if (/^bcg$/i.test(contractor)) {
        contractor = "BCG";
    }
    const isBcg = isBcgContractor(contractor);
    const cInfo = (!isBcg && contractor) ? findContractorInfo(contractor) : null;
    const lead = String(r.execLead || leadFromContractor || "").trim();
    const hasCustomWrk = r.execWorkers !== undefined && r.execWorkers !== null && String(r.execWorkers).trim() !== "";
    const workers = hasCustomWrk
        ? Number(r.execWorkers)
        : (!isBcg && cInfo && cInfo.workers !== undefined ? cInfo.workers : "");
    const phone = String(r.execPhone || (!isBcg && cInfo?.engineer ? cInfo.engineer : "") || "").trim();
    const machinery = !isBcg && cInfo && cInfo.machinery !== undefined ? cInfo.machinery : "";

    let cardSummary = contractor;
    if (contractor && lead) {
        cardSummary = `${contractor} - ${lead}`;
    }
    return { contractor, isBcg, lead, workers, phone, machinery, cardSummary };
}

function syncAdminContractors() {
    const map = readStore(ADMIN_CONTRACTORS_KEY, {}) || {};
    if (map && typeof map === "object" && !Array.isArray(map)) {
        state.contractors = map;
    } else {
        state.contractors = {};
    }
    return state.contractors;
}

/* ArcGIS-də icraçı sütununa yazılan adı Admin Paneldəki İş İcraçıları qovluğu ilə avtomatik uyğunlaşdırır */
function findContractorInfo(rawName) {
    if (!rawName) return null;
    const trimmed = String(rawName).trim();
    if (!trimmed) return null;
    const map = syncAdminContractors();
    if (map[trimmed]) {
        return { name: trimmed, ...map[trimmed] };
    }
    const targetNorm = normalizeKey(trimmed);
    if (!targetNorm) return null;
    for (const [k, info] of Object.entries(map)) {
        if (normalizeKey(k) === targetNorm) {
            return { name: k, ...info };
        }
    }
    return null;
}

/* Kabel lif sayı seçimləri — istəyə uyğun ardıcıllıqla (FO 48, FO 24, FO 12 və s.) */
const FIBER_OPTIONS = [
    "FO 48",
    "FO 24",
    "FO 12",
    "FO 96",
    "FO 72",
    "FO 36",
    "FO 16",
    "FO 8",
    "FO 4",
    "FO 144"
];

const STANDARD_FIBER_NUMS = new Set([2, 4, 6, 8, 12, 16, 24, 32, 36, 48, 64, 72, 96, 128, 144, 216, 288]);

function normalizeFiberCount(val, fallback = "") {
    if (val === undefined || val === null) return fallback;
    const s = String(val).trim().toUpperCase()
        .replace(/Ф/g, "F")
        .replace(/О/g, "O");
    if (!s || s === "-" || s === "—" || s === "YOXDUR" || s === "NONE" || s === "NULL") return fallback;
    const foExplicit = s.match(/\b(?:FO|OF)[-\s_.:/×x*]*(\d+)\b/i)
        || s.match(/\b(\d+)[-\s_.:/×x*]*(?:FO|OF|LİF|LIF|FIBER|FIBRE|CORE|DAMAR|OPTIK|OPTİK|F)\b/i)
        || s.match(/(?:FO|OF)(\d+)/i)
        || s.match(/(\d+)(?:FO|OF)\b/i);
    if (foExplicit) return `FO ${foExplicit[1]}`;
    const numOnly = s.match(/^\s*(\d+)\s*$/);
    if (numOnly) return `FO ${numOnly[1]}`;
    const m = s.match(/(\d+)/);
    if (m) return `FO ${m[1]}`;
    if (s.startsWith("FO")) return s;
    return fallback;
}

function extractFiberFromProps(props, ...textHints) {
    const matchExplicitFo = str => {
        if (!str) return "";
        const s = String(str).replace(/Ф/gi, "F").replace(/О/gi, "O");
        const m = s.match(/\b(?:FO|OF)[-\s_.:/×x*]*(\d+)\b/i)
            || s.match(/\b(\d+)[-\s_.:/×x*]*(?:FO|OF|LİF|LIF|LİFLİ|LIFLI|FIBER|FIBRE|CORE|DAMAR|F)\b/i)
            || s.match(/(?:^|[^A-Za-z0-9])(?:FO|OF)(\d+)(?:$|[^0-9])/i)
            || s.match(/(?:^|[^0-9])(\d+)(?:FO|OF)(?:$|[^A-Za-z0-9])/i);
        return m ? `FO ${m[1]}` : "";
    };

    if (props && typeof props === "object") {
        // 1. Birbaşa lif sayı sütun adlarından oxu
        const direct = getPropCaseInsensitive(
            props,
            "fiber_count", "fiberCount", "fibercount", "fiber", "fo", "fo_sayi", "fo_sayı", "fosayi",
            "lif", "lif_sayi", "lif_sayı", "lifsayi", "lifler", "kabel", "kabel_lif", "kabel_tipi", "kabel_novu",
            "optik_lif", "optik_kabel", "optik", "cable", "cable_type", "cable_size", "tutum", "tutumu",
            "core", "cores", "damar", "damar_sayi", "tip", "type", "marka", "brand", "nov", "novu"
        );
        if (direct !== undefined) {
            const exp = matchExplicitFo(direct);
            if (exp) return exp;
            const norm = normalizeFiberCount(direct, "");
            if (norm) return norm;
        }
        // 2. Sütun adında lif / fo / fiber / kabel / damar / core / tutum / optik sözü varsa
        for (const [k, v] of Object.entries(props)) {
            if (v === undefined || v === null) continue;
            const nk = normalizeKey(k);
            if (/(^fo$|lif|fiber|fibre|kabel|cable|core|damar|tutum|optik)/.test(nk)) {
                const exp = matchExplicitFo(v);
                if (exp) return exp;
                const norm = normalizeFiberCount(v, "");
                if (norm) return norm;
            }
        }
        // 3. İstənilən atribut dəyərində "FO 48", "24 FO", "48F", "12 lif", "FO24" kimi yazılış varsa
        for (const v of Object.values(props)) {
            if (v === undefined || v === null) continue;
            const exp = matchExplicitFo(v);
            if (exp) return exp;
        }
        // 4. Sütun dəyəri birbaşa standart lif sayıdırsa (məs: 12, 24, 48, 72, 96, 144) və məsafə/ID sütunu deyilsə
        for (const [k, v] of Object.entries(props)) {
            if (v === undefined || v === null) continue;
            const nk = normalizeKey(k);
            if (/(^id$|objectid|fid|shape|km|uzunluq|length|plan|done|faktiki|antena|antenna|workers|isci|texnika|machinery|width|qalinliq|opacity|status|coord|lat|lng|lon)/.test(nk)) {
                continue;
            }
            const sv = String(v).trim();
            if (/^\d+$/.test(sv) && STANDARD_FIBER_NUMS.has(Number(sv))) {
                return `FO ${Number(sv)}`;
            }
        }
    }
    // 5. Xəttin adında, qovluq adında və ya fayl adında yazılıbsa
    for (const hint of textHints) {
        const exp = matchExplicitFo(hint);
        if (exp) return exp;
    }
    return "";
}

function getSegmentFiber(r, project) {
    if (!r) return "";
    const fromPropsAndText = extractFiberFromProps(
        r.props,
        r.name,
        r.pointA,
        r.pointB,
        r.props?._folderName,
        r.props?._rawDescription,
        project?.name
    );
    const savedNorm = r.fiberCount ? normalizeFiberCount(r.fiberCount, "") : "";
    // Əgər faylın içində konkret lif sayı varsa və əvvəlki şərti "FO 48" yazılıbsa, fayldakı həqiqi dəyəri götür
    if (fromPropsAndText && (!savedNorm || savedNorm === "FO 48")) {
        return fromPropsAndText;
    }
    if (savedNorm) {
        // Əgər obyekt import olunubsa (r.props var), amma faylda heç bir lif sayı olmayıb və şərti "FO 48" düşübsə, şərti dəyəri atma
        if (savedNorm === "FO 48" && r.props && !fromPropsAndText && !r.userSetFiber) {
            return "";
        }
        return savedNorm;
    }
    return fromPropsAndText || "";
}

function resolveLineEndNames(r, project) {
    if (!r) return { nameA: "", nameB: "", aName: "", bName: "", cleanA: "", cleanB: "" };
    const p = r.props || {};
    const propA = getPropCaseInsensitive(p, "pointA", "point_a", "pointa", "a_noqte", "a_noqtesi", "baslangic", "start_point", "start", "from", "haradan", "noqte_a", "menteqe_a", "a") || "";
    const propB = getPropCaseInsensitive(p, "pointB", "point_b", "pointb", "b_noqte", "b_noqtesi", "son", "end_point", "end", "to", "haraya", "hara", "noqte_b", "menteqe_b", "b") || "";

    const isPlaceholderEnd = s => !s || /^(a|b|mərkəz|merkez|şəbəkə|sebeke|başlanğıc|baslangic|son|start|end|-|—)$/i.test(String(s).trim());

    let rawA = String(r.pointA || "").replace(/^[AB]\s*[:.\-–—]\s*/i, "").trim();
    let rawB = String(r.pointB || "").replace(/^[AB]\s*[:.\-–—]\s*/i, "").trim();
    if (isPlaceholderEnd(rawA) && !isPlaceholderEnd(propA)) rawA = String(propA).trim();
    if (isPlaceholderEnd(rawB) && !isPlaceholderEnd(propB)) rawB = String(propB).trim();

    const segName = String(r.name || "").replace(/^[AB]\s*[:.\-–—]\s*/i, "").replace(/\b(?:FO|OF)[-\s_.:/]*\d+\b/gi, "").trim();
    const projName = String(project?.name || "").replace(/^Digər\s*:\s*/i, "").replace(/\b(?:FO|OF)[-\s_.:/]*\d+\b/gi, "").trim();

    if ((isPlaceholderEnd(rawA) || isPlaceholderEnd(rawB)) && /[-–—➔→/]/.test(segName)) {
        const parts = segName.split(/\s*[-–—➔→/]+\s*/).map(s => s.trim()).filter(s => s && !/^(?:fo|of|f)\s*\d+$/i.test(s));
        if (parts.length >= 2) {
            if (isPlaceholderEnd(rawA)) rawA = parts[0];
            if (isPlaceholderEnd(rawB)) rawB = parts[parts.length - 1];
        }
    }
    if ((isPlaceholderEnd(rawA) && isPlaceholderEnd(rawB)) && /[-–—➔→/]/.test(projName)) {
        const parts = projName.split(/\s*[-–—➔→/]+\s*/).map(s => s.trim()).filter(s => s && !/^(?:fo|of|f)\s*\d+$/i.test(s));
        if (parts.length >= 2) {
            rawA = parts[0];
            rawB = parts[parts.length - 1];
        }
    }

    const isGenericSeg = /^(?:idxal\s*x[əe]tti|imported\s*line|x[əe]tt|line|imp|seg|ln)[-\s_]*\d*$/i.test(segName);
    const fallbackName = !isGenericSeg && segName ? segName : projName;

    const nameA = !isPlaceholderEnd(rawA) ? rawA : (fallbackName || "");
    const nameB = !isPlaceholderEnd(rawB) ? rawB : (fallbackName || "");
    return { nameA, nameB, aName: nameA, bName: nameB, cleanA: nameA, cleanB: nameB };
}

/* Rəng kodu (Hex / RGB / KML aabbggrr / ad) və Xətt qalınlığı çeviriciləri */
function kmlColorToHex(kmlHex) {
    if (!kmlHex) return "";
    const clean = String(kmlHex).trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{8}$/.test(clean)) {
        // KML formatı: aabbggrr -> #rrggbb
        const bb = clean.slice(2, 4);
        const gg = clean.slice(4, 6);
        const rr = clean.slice(6, 8);
        return `#${rr}${gg}${bb}`.toUpperCase();
    }
    return "";
}

function normalizeColorCode(val, fallback = "") {
    if (val === undefined || val === null) return fallback;
    const raw = String(val).trim();
    if (!raw || raw === "-" || /^(?:null|none|yoxdur)$/i.test(raw)) return fallback;

    // 1) Standart #RRGGBB və ya RRGGBB
    const hex6 = raw.match(/^#?([0-9a-fA-F]{6})$/);
    if (hex6) return `#${hex6[1].toUpperCase()}`;

    // 2) Qısa #RGB
    const hex3 = raw.match(/^#([0-9a-fA-F]{3})$/);
    if (hex3) {
        const [r, g, b] = hex3[1].split("");
        return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
    }

    // 3) 8 rəqəmli KML (aabbggrr) və ya #RRGGBBAA
    const hex8 = raw.match(/^#?([0-9a-fA-F]{8})$/);
    if (hex8) {
        if (raw.startsWith("#")) return `#${hex8[1].slice(0, 6).toUpperCase()}`;
        return kmlColorToHex(hex8[1]) || fallback;
    }

    // 4) rgb(r, g, b) və ya "255, 128, 0"
    const rgbMatch = raw.match(/(\d{1,3})\s*[,;\s]\s*(\d{1,3})\s*[,;\s]\s*(\d{1,3})/);
    if (rgbMatch) {
        const toHex = n => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0");
        return `#${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`.toUpperCase();
    }

    // 5) Sözlə yazılmış rəng adları (AZ / EN)
    const named = {
        red: "#EF4444", qirmizi: "#EF4444", "qırmızı": "#EF4444",
        green: "#22C55E", yasil: "#22C55E", "yaşıl": "#22C55E",
        blue: "#3B82F6", mavi: "#3B82F6", goy: "#3B82F6", "göy": "#3B82F6",
        cyan: "#38BDF8", firuzeyi: "#38BDF8", "firuzəyi": "#38BDF8",
        yellow: "#EAB308", sari: "#EAB308", "sarı": "#EAB308",
        orange: "#F97316", narinci: "#F97316", "narıncı": "#F97316",
        purple: "#A855F7", benovseyi: "#A855F7", "bənövşəyi": "#A855F7",
        pink: "#EC4899", cehrayi: "#EC4899", "çəhrayı": "#EC4899",
        white: "#F8FAFC", ag: "#F8FAFC", "ağ": "#F8FAFC",
        gray: "#94A3B8", grey: "#94A3B8", boz: "#94A3B8",
        black: "#1E293B", qara: "#1E293B"
    };
    const key = raw.toLowerCase();
    if (named[key]) return named[key];
    return fallback;
}

function normalizeLineWidth(val, fallback = 0) {
    if (val === undefined || val === null || val === "") return fallback;
    const num = Number(String(val).trim().replace(/,/g, ".").replace(/[^\d.]/g, ""));
    if (isNaN(num) || num <= 0) return fallback;
    return Math.max(0.5, Math.min(12, Math.round(num * 10) / 10));
}

/* Poliqonun həndəsi mərkəzini (Centroid) və sahəsini hesablayır (coords: [[lat, lng], ...]) */
function computePolygonCentroid(coords) {
    if (!Array.isArray(coords) || coords.length === 0) return { center: [47.5, 40.3], area: 0 };
    if (coords.length < 3) {
        const [lat, lng] = coords[0];
        return { center: [lng, lat], area: 0 };
    }
    let area2 = 0;
    let cx = 0;
    let cy = 0;
    const n = coords.length;
    for (let i = 0; i < n; i++) {
        const [lat1, lng1] = coords[i];
        const [lat2, lng2] = coords[(i + 1) % n];
        const cross = lng1 * lat2 - lng2 * lat1;
        area2 += cross;
        cx += (lng1 + lng2) * cross;
        cy += (lat1 + lat2) * cross;
    }
    if (Math.abs(area2) > 1e-9) {
        return {
            center: [cx / (3 * area2), cy / (3 * area2)],
            area: Math.abs(area2) * 0.5
        };
    }
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    coords.forEach(([lat, lng]) => {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
    });
    return {
        center: [(minLng + maxLng) * 0.5, (minLat + maxLat) * 0.5],
        area: (maxLng - minLng) * (maxLat - minLat)
    };
}

let _cloudMetaSyncTimer = null;
function scheduleCloudMetaSync() {
    if (typeof api === "undefined" || !api.configured || typeof isAdmin !== "function" || !isAdmin()) return;
    clearTimeout(_cloudMetaSyncTimer);
    _cloudMetaSyncTimer = setTimeout(() => {
        if (typeof api.syncCloudRegistry === "function") {
            api.syncCloudRegistry().catch(() => {});
        }
    }, 800);
}

const PMO_LIVE_CACHE_KEY = "bcg.pmo.live_cache.v2";

function isPmoProjectId(id) {
    return String(id || "").startsWith("pmo_");
}

function isPmoProjectObj(p) {
    return Boolean(p && (p.isPmo || isPmoProjectId(p.id)));
}

function readPmoLiveCacheSync() {
    try {
        const cached = readStore(PMO_LIVE_CACHE_KEY, null);
        if (cached && Array.isArray(cached.projects) && cached.projects.length > 0) {
            return cached.projects.filter(p => p && p.id && p.isPmo);
        }
    } catch {}
    return null;
}

function savePmoLiveCache(projects) {
    try {
        if (!Array.isArray(projects) || projects.length === 0) return;
        const payload = { savedAt: Date.now(), projects };
        saveToIndexedDB(PMO_LIVE_CACHE_KEY, payload);
        writeStore(PMO_LIVE_CACHE_KEY, payload);
    } catch {}
}
window.savePmoLiveCache = savePmoLiveCache;

function purgeStalePmoLocalPollution() {
    try {
        // Köhnə versiyalardan qalmış pmo_* qeydlərini lokal/IndexedDB override keşlərindən birdəfəlik təmizlə
        const pMap = readStore(PROJ_META_STORE_KEY, null);
        if (pMap && typeof pMap === "object") {
            let dirty = false;
            Object.keys(pMap).forEach(k => { if (isPmoProjectId(k)) { delete pMap[k]; dirty = true; } });
            if (dirty) writeStore(PROJ_META_STORE_KEY, pMap);
        }
        const sMap = readStore(SEG_META_STORE_KEY, null);
        if (sMap && typeof sMap === "object") {
            let dirty = false;
            Object.keys(sMap).forEach(k => { if (isPmoProjectId(k)) { delete sMap[k]; dirty = true; } });
            if (dirty) writeStore(SEG_META_STORE_KEY, sMap);
        }
        const imp = readStore(STORAGE_IMPORTED_KEY, null);
        if (Array.isArray(imp)) {
            const cleanImp = imp.filter(p => p && !isPmoProjectObj(p));
            if (cleanImp.length !== imp.length) writeStore(STORAGE_IMPORTED_KEY, cleanImp);
        }
        const customItems = readStore("bcg.custom.items.v1", null);
        if (Array.isArray(customItems)) {
            const cleanCustom = customItems.filter(e => e && !isPmoProjectId(e.projectId));
            if (cleanCustom.length !== customItems.length) writeStore("bcg.custom.items.v1", cleanCustom);
        }
        getFromIndexedDB(STORAGE_IMPORTED_KEY).then(idbImp => {
            if (Array.isArray(idbImp)) {
                const cleanIdb = idbImp.filter(p => p && !isPmoProjectObj(p));
                if (cleanIdb.length !== idbImp.length) saveToIndexedDB(STORAGE_IMPORTED_KEY, cleanIdb);
            }
        }).catch(() => {});
    } catch {}
}

function saveProjectOverride(project) {
    if (!project || !project.id || isPmoProjectObj(project)) return;
    const map = readStore(PROJ_META_STORE_KEY, {}) || {};
    map[project.id] = {
        name: project.name,
        status: project.status,
        type: project.type,
        category: project.category,
        startDate: project.startDate,
        endDate: project.endDate,
        customColor: project.customColor,
        lineWidth: project.lineWidth,
        polyFilled: project.polyFilled,
        fillColor: project.fillColor,
        fillOpacity: project.fillOpacity
    };
    writeStore(PROJ_META_STORE_KEY, map);
    scheduleCloudMetaSync();
}

function saveSegmentOverride(projectId, item) {
    if (!projectId || !item || !item.id || isPmoProjectId(projectId)) return;
    const map = readStore(SEG_META_STORE_KEY, {}) || {};
    map[`${projectId}:${item.id}`] = {
        id: item.id,
        name: item.name,
        pointA: item.pointA,
        pointB: item.pointB,
        status: item.status,
        contractor: item.contractor,
        execLead: item.execLead,
        execWorkers: item.execWorkers,
        execPhone: item.execPhone,
        nimSpec: item.nimSpec,
        customFields: item.customFields,
        totalKm: item.totalKm,
        doneKm: item.doneKm,
        unit: item.unit,
        antennas: item.antennas,
        summary: item.summary,
        rayon: item.rayon,
        pointType: item.pointType,
        fiberCount: item.fiberCount,
        userSetFiber: item.userSetFiber,
        customColor: item.customColor,
        lineWidth: item.lineWidth,
        isPolygon: item.isPolygon,
        polyFilled: item.polyFilled,
        fillColor: item.fillColor,
        fillOpacity: item.fillOpacity,
        holes: item.holes,
        props: item.props,
        coords: item.coords
    };
    writeStore(SEG_META_STORE_KEY, map);
    scheduleCloudMetaSync();
}

function mergeLocalProjectIntoDb(dbProj, localProj) {
    if (!dbProj) return localProj;
    if (!localProj) return dbProj;
    const merged = {
        ...dbProj,
        ...localProj,
        category: localProj.category || dbProj.category,
        type: localProj.type || dbProj.type
    };
    const dbItems = Array.isArray(dbProj.items) ? dbProj.items : [];
    const localItems = Array.isArray(localProj.items) ? localProj.items : [];
    if (localItems.length === 0) {
        merged.items = dbItems;
        return merged;
    }
    if (dbItems.length === 0) {
        merged.items = localItems;
        return merged;
    }
    const localById = new Map(localItems.map(it => [it.id, it]));
    const mergedItems = dbItems.map((dbIt) => {
        const locIt = localById.get(dbIt.id);
        if (!locIt) return dbIt;
        return {
            ...locIt,
            ...dbIt,
            name: locIt.name || dbIt.name,
            pointA: (dbIt.pointA && !/^(a|mərkəz)$/i.test(dbIt.pointA)) ? dbIt.pointA : (locIt.pointA || dbIt.pointA),
            pointB: (dbIt.pointB && !/^(b|şəbəkə)$/i.test(dbIt.pointB)) ? dbIt.pointB : (locIt.pointB || dbIt.pointB),
            contractor: locIt.contractor || dbIt.contractor || "",
            execLead: locIt.execLead || dbIt.execLead || "",
            execWorkers: locIt.execWorkers ?? dbIt.execWorkers,
            execPhone: locIt.execPhone || dbIt.execPhone || "",
            fiberCount: locIt.fiberCount || dbIt.fiberCount || "",
            userSetFiber: locIt.userSetFiber || dbIt.userSetFiber,
            customColor: locIt.customColor || dbIt.customColor,
            fillColor: locIt.fillColor || dbIt.fillColor,
            fillOpacity: locIt.fillOpacity ?? dbIt.fillOpacity,
            lineWidth: locIt.lineWidth || dbIt.lineWidth,
            isPolygon: locIt.isPolygon ?? dbIt.isPolygon,
            polyFilled: locIt.polyFilled ?? dbIt.polyFilled,
            holes: locIt.holes || dbIt.holes,
            props: locIt.props || dbIt.props,
            coords: Array.isArray(locIt.coords) && locIt.coords.length >= (Array.isArray(dbIt.coords) ? dbIt.coords.length : 0) ? locIt.coords : dbIt.coords
        };
    });
    const dbItemIds = new Set(dbItems.map(it => it.id));
    localItems.forEach(locIt => {
        if (locIt && locIt.id && !dbItemIds.has(locIt.id)) {
            mergedItems.push(locIt);
        }
    });
    merged.items = mergedItems;
    return merged;
}

function applySavedMetaOverrides() {
    try {
        syncAdminContractors();
        const delProjs = getDeletedProjectIds();
        const delSegs = getDeletedSegmentKeys();
        const pMap = readStore(PROJ_META_STORE_KEY, {}) || {};
        const sMap = readStore(SEG_META_STORE_KEY, {}) || {};
        // Əgər sMap-də (bulud reyestrindən gələn) bazaya düşməmiş nöqtə/seqment varsa və koordinatı mövcuddursa, layihəyə əlavə et
        for (const [key, segMeta] of Object.entries(sMap)) {
            if (key.startsWith("pmo_")) continue;
            if (!segMeta || !Array.isArray(segMeta.coords) || segMeta.coords.length === 0) continue;
            const sepIdx = key.indexOf(":");
            if (sepIdx <= 0) continue;
            const projId = key.slice(0, sepIdx);
            const segId = key.slice(sepIdx + 1);
            if (delProjs.has(projId) || delSegs.has(key)) continue;
            let proj = (state.projects || []).find(p => p.id === projId);
            if (!proj && pMap[projId]?.name) {
                proj = {
                    id: projId,
                    name: pMap[projId].name,
                    status: pMap[projId].status || "layihe",
                    type: pMap[projId].type || "points",
                    category: pMap[projId].category || "project",
                    startDate: pMap[projId].startDate || "",
                    endDate: pMap[projId].endDate || "",
                    items: []
                };
                state.projects.push(proj);
            }
            if (proj) {
                if (!Array.isArray(proj.items)) proj.items = [];
                if (!proj.items.some(i => i.id === segId)) {
                    proj.items.push({ id: segId, ...segMeta });
                }
            }
        }
        (state.projects || []).forEach(p => {
            // PMO layihələrində status və bütün məlumatlar yalnız Excel-dən canlı götürülür — lokal köhnə meta üzərinə yazmasın
            if (p.isPmo) return;
            if (pMap[p.id]) {
                Object.assign(p, pMap[p.id]);
            }
            (p.items || []).forEach(r => {
                const key = `${p.id}:${r.id}`;
                if (sMap[key]) {
                    Object.assign(r, sMap[key]);
                }
                // Əgər icraçı yoxdursa və ya faylın atribut sütunlarında (props) varsa dərhal bərpa et
                if (!r.contractor && r.props) {
                    const extracted = extractContractorFromProps(r.props);
                    if (extracted) {
                        r.contractor = extracted;
                    }
                }
                if (r.contractor) {
                    const parsedExec = parseContractorAndLead(r.contractor, r.props);
                    if (parsedExec.execLead && !r.execLead) r.execLead = parsedExec.execLead;
                    if (parsedExec.execWorkers !== "" && r.execWorkers === undefined) r.execWorkers = parsedExec.execWorkers;
                    if (parsedExec.execPhone && !r.execPhone) r.execPhone = parsedExec.execPhone;
                    if (parsedExec.contractor === "BCG") {
                        r.contractor = "BCG";
                    } else {
                        const matched = findContractorInfo(parsedExec.contractor);
                        if (matched) {
                            r.contractor = matched.name;
                        } else if (parsedExec.contractor) {
                            r.contractor = parsedExec.contractor;
                        }
                    }
                }
                if (p.type !== "points" && p.category !== "nim" && p.category !== "other") {
                    const resolvedFo = getSegmentFiber(r, p);
                    r.fiberCount = resolvedFo;
                }
            });
        });
    } catch (e) {
        console.warn("applySavedMetaOverrides error:", e);
    }
}

function getStoredImportedProjects() {
    const delProjs = getDeletedProjectIds();
    const list = readStore(STORAGE_IMPORTED_KEY, []);
    return Array.isArray(list) ? list.filter(p => p && !delProjs.has(p.id) && !isPmoProjectObj(p)) : [];
}

function saveImportedProjects() {
    try {
        const delProjs = getDeletedProjectIds();
        const delSegs = getDeletedSegmentKeys();
        const cleanProjects = (state.projects || [])
            .filter(p => p && !delProjs.has(p.id) && !isPmoProjectObj(p))
            .map(p => ({
                ...p,
                items: (p.items || []).filter(r => r && !delSegs.has(`${p.id}:${r.id}`))
            }));
        const toSave = cleanProjects.filter(p =>
            p.imported || p.isLocal || p.category === "other" || String(p.id).startsWith("imp_") || String(p.id).startsWith("proj_custom_") || String(p.id).startsWith("proj_local_") || String(p.id).startsWith("proj_mm_")
        );
        // Həm limitsiz IndexedDB disk bazasına, həm də kiçikdirsə localStorage-a yaz (PMO layihələri ayrı canlı keşdə saxlanılır)
        saveToIndexedDB(STORAGE_IMPORTED_KEY, toSave);
        writeStore(STORAGE_IMPORTED_KEY, toSave);
        // Bulud snapshot keşini də dərhal yenilə ki digər kompüterlər bütün nöqtələri tam görsün
        try {
            const snap = JSON.parse(localStorage.getItem("bcg.db.snapshot.v1") || "{}") || {};
            snap.projects = cleanProjects;
            localStorage.setItem("bcg.db.snapshot.v1", JSON.stringify(snap));
        } catch {}
    } catch (e) {
        console.warn("saveImportedProjects error:", e);
    }
}

async function syncUnsavedLocalProjectsToCloud(rawDbProjects = []) {
    if (!isAdmin() || !api.configured) return;
    try {
        const delProjs = getDeletedProjectIds();
        const delSegs = getDeletedSegmentKeys();
        const dbById = new Map((Array.isArray(rawDbProjects) ? rawDbProjects : []).map(p => [p.id, p]));
        let syncedAny = false;
        for (const p of (state.projects || [])) {
            // PMO layihələri yalnız Google Sheets-dən canlı idarə olunur — heç vaxt Supabase-ə yazılmasın
            if (!p || !p.id || isPmoProjectObj(p) || delProjs.has(p.id)) continue;
            // Standart demo NİİM / Azconnect layihələrini yalnız dəyişdirilibsə göndər
            if ((p.id === "nim_baki_svetofor" || p.id === "nim_sumqayit_gence" || p.id === "azc_abseron_ring" || p.id === "azc_merkez_west") && !dbById.has(p.id)) {
                continue;
            }
            const dbProj = dbById.get(p.id);
            const validItems = (p.items || []).filter(r => r && !delSegs.has(`${p.id}:${r.id}`));
            const dbItemIds = new Set((dbProj?.items || []).map(r => r.id));
            const hasMissingItems = validItems.some(r => !dbItemIds.has(r.id));
            if (!dbProj || hasMissingItems || validItems.length > (dbProj.items?.length || 0)) {
                try {
                    saveProjectOverride(p);
                    validItems.forEach(r => saveSegmentOverride(p.id, r));
                    await api.saveProject({ ...p, items: validItems });
                    syncedAny = true;
                } catch {}
            }
        }
        if (syncedAny) {
            saveImportedProjects();
            if (typeof api.syncCloudRegistry === "function") {
                await api.syncCloudRegistry().catch(() => {});
            }
        }
    } catch {}
}

async function enterApp(user) {
    state.user = user;
    $("login").hidden = true;
    purgeStalePmoLocalPollution();

    // 1. YALNIZ TƏZƏ MƏLUMAT: köhnə keş ekrana çıxmır; yükləmə ekranı göstərilir, bulud və Google Sheets paralel yüklənir
    const showBootLoader = () => {
        let el = document.getElementById("bootLoader");
        if (!el) {
            el = document.createElement("div");
            el.id = "bootLoader";
            el.style.cssText = "position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#0e1a2b;color:#e2e8f0;font:600 14px Inter,system-ui,sans-serif";
            el.innerHTML = `<img src="favicon.svg" alt="BCG" style="width:56px;height:56px"><div style="width:38px;height:38px;border:4px solid rgba(255,255,255,.15);border-top-color:#4c9bf5;border-radius:50%;animation:bootSpin .8s linear infinite"></div><div>Təzə məlumatlar yüklənir…</div><style>@keyframes bootSpin{to{transform:rotate(360deg)}}</style>`;
            document.body.appendChild(el);
        }
        el.hidden = false;
    };
    const hideBootLoader = () => document.getElementById("bootLoader")?.remove();

    showBootLoader();

    // Google Sheets canlı PMO məlumatını Supabase ilə EYNİ ANDA (paralel) başlat ki ilk açılışda dərhal ən təzə variant görünsün
    const pmoBootPromise = (typeof window.__fetchPmoInitialWorkbook === "function")
        ? window.__fetchPmoInitialWorkbook().catch(() => null)
        : Promise.resolve(null);

    let fresh = null;
    if (api.configured) {
        try {
            fresh = await Promise.race([
                api.loadAll(user.id),
                new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 15000))
            ]);
        } catch (err) {
            console.warn("Buluddan yükləmə alınmadı:", err);
        }
    }

    const rawDbProjectsSnapshot = fresh && Array.isArray(fresh.projects)
        ? JSON.parse(JSON.stringify(fresh.projects.filter(p => p && !isPmoProjectObj(p))))
        : [];

    if (fresh && Array.isArray(fresh.projects)) {
        Object.assign(state, {
            ...fresh,
            projects: fresh.projects.filter(p => p && !isPmoProjectObj(p))
        });
    } else {
        // Yalnız internet tamamilə yoxdursa: son saxlanmış qeyri-PMO məlumatla açılır
        const snap = readStore("bcg.db.snapshot.v1", null);
        if (snap && Array.isArray(snap.projects)) {
            state.projects = snap.projects.filter(p => p && !isPmoProjectObj(p));
            if (snap.materials) state.materials = snap.materials;
            if (snap.notes) state.notes = snap.notes;
            state.role = user.role || snap.role || "viewer";
        }
        if (api.configured) setTimeout(() => toast("⚠️ İnternet bağlantısı yoxdur — son saxlanmış məlumat göstərilir", true), 300);
    }

    // Baza layihələri ilə lokal/idxal olunmuş qeyri-PMO layihələri birləşdir
    const storedImported = getStoredImportedProjects();
    storedImported.forEach(localProj => {
        if (!localProj || !localProj.id || isPmoProjectObj(localProj)) return;
        const idx = state.projects.findIndex(p => p.id === localProj.id);
        if (idx >= 0) {
            state.projects[idx] = mergeLocalProjectIntoDb(state.projects[idx], localProj);
        } else {
            state.projects.push(localProj);
        }
    });

    // Köhnə demo layihələri və kənar/köhnəlmiş pmo_* qalıqlarını təmizlə
    const LEGACY_DEMO_PROJECT_IDS = new Set(["proj_magistral", "proj_gpon_north", "proj_gpon_west", "proj_karabakh"]);
    state.projects = (state.projects || []).filter(p => p && !LEGACY_DEMO_PROJECT_IDS.has(p.id) && !isPmoProjectObj(p) && p.category !== "project");

    // PMO layihələrini yüklə: əvvəlcə canlı Google Sheets-i gözlə (maksimum 6 san); gecikərsə son canlı keş (IndexedDB/LS) və ya seed ilə aç, gələn kimi yenilə
    let liveBootApplied = false;
    const liveWb = await Promise.race([
        pmoBootPromise,
        new Promise(resolve => setTimeout(() => resolve("__pending__"), 6000))
    ]);

    if (liveWb && liveWb !== "__pending__" && typeof window.__applyPmoBootWorkbook === "function") {
        try {
            await window.__applyPmoBootWorkbook(liveWb, true);
            liveBootApplied = state.projects.some(p => isPmoProjectObj(p));
        } catch (err) {
            console.warn("PMO boot apply error:", err);
        }
    }

    if (!liveBootApplied) {
        let cachedPmo = readPmoLiveCacheSync();
        if (!cachedPmo) {
            try {
                const idbCached = await Promise.race([
                    getFromIndexedDB(PMO_LIVE_CACHE_KEY),
                    new Promise(resolve => setTimeout(() => resolve(null), 400))
                ]);
                if (idbCached && Array.isArray(idbCached.projects) && idbCached.projects.length > 0) {
                    cachedPmo = idbCached.projects.filter(p => p && p.id && p.isPmo);
                }
            } catch {}
        }
        const fallbackPmoList = (Array.isArray(cachedPmo) && cachedPmo.length > 0)
            ? cachedPmo
            : (Array.isArray(window.PMO_SEED_PROJECTS) ? window.PMO_SEED_PROJECTS : []);
        fallbackPmoList.forEach(np => {
            if (!np || !np.id) return;
            const idx = state.projects.findIndex(p => p.id === np.id);
            if (idx >= 0) state.projects[idx] = np;
            else state.projects.push(np);
        });
        state.activeFolders.add("project");

        if (liveWb === "__pending__" && typeof window.__applyPmoBootWorkbook === "function") {
            pmoBootPromise.then(wb => {
                if (wb) window.__applyPmoBootWorkbook(wb, false).catch(() => {});
            }).catch(() => {});
        }
    }

    applySavedMetaOverrides();
    if (typeof window.applySavedGeomOverrides === "function") window.applySavedGeomOverrides();
    const hiddenSet = getHiddenProjectIds();
    state.projects.forEach(p => {
        if (!hiddenSet.has(p.id)) state.visibleIds.add(p.id);
    });

    tools.setUser(user.id);
    renderRole();
    renderNotes();
    renderMaterials();
    renderAll();
    hideBootLoader();

    // Canlı PMO Google Sheets 20 san izləməsini açılış tamamlandıqdan sonra başlat (race condition olmadan)
    if (typeof window.__startPmoLiveWatch === "function") {
        window.__startPmoLiveWatch();
    }

    // Əgər bu kompüterdə əlavə edilmiş, lakin bazaya tam düşməmiş qeyri-PMO nöqtələr/layihələr varsa, arxa fonda dərhal buluda yaz
    if (isAdmin() && api.configured) {
        setTimeout(() => syncUnsavedLocalProjectsToCloud(rawDbProjectsSnapshot).catch(() => {}), 600);
    }

    // Canlı sinxronizasiya: başqa cihazdan edilən qeyri-PMO dəyişikliklər səhifəni yeniləmədən avtomatik əks olunur
    if (api.configured && typeof api.startLiveSync === "function") {
        api.startLiveSync(async () => {
            if ($("editModal")?.open || document.activeElement?.closest?.(".info-card, #editModal")) return;
            await reloadData();
            if (typeof window.renderNotes === "function") window.renderNotes();
            else renderNotes();
            if (typeof window.renderMaterials === "function") window.renderMaterials();
            else renderMaterials();
            toast("🔄 Məlumatlar canlı yeniləndi");
        });
    }

    // Əgər localStorage dolubsa və ya qeyri-PMO layihələr limitsiz IndexedDB-də saxlanılıbsa, onları da daxil et
    getFromIndexedDB(STORAGE_IMPORTED_KEY).then(idbProjs => {
        if (Array.isArray(idbProjs) && idbProjs.length > 0) {
            let changed = false;
            idbProjs.forEach(lp => {
                if (!lp || !lp.id || isPmoProjectObj(lp)) return;
                const idx = state.projects.findIndex(p => p.id === lp.id);
                if (idx < 0) {
                    state.projects.push(lp);
                    state.visibleIds.add(lp.id);
                    changed = true;
                } else {
                    const beforeLen = (state.projects[idx].items || []).length;
                    state.projects[idx] = mergeLocalProjectIntoDb(state.projects[idx], lp);
                    if ((state.projects[idx].items || []).length !== beforeLen) changed = true;
                }
            });
            if (changed) {
                renderAll();
                if (isAdmin() && api.configured) {
                    syncUnsavedLocalProjectsToCloud(rawDbProjectsSnapshot).catch(() => {});
                }
            }
        }
    }).catch(() => {});
}

/* REDAKTƏ (admin) */
const statusOptions = () => STATUSES.map(id => [id, t(`status${id}`)]);

async function reloadData() {
    const known = new Set(state.projects.map(p => p.id));
    const knownVisible = new Set(state.visibleIds);

    // Canlı PMO Google Sheets layihələrini TAM QORU — Supabase reload heç vaxt onların üzərinə köhnə seed və ya stripped məlumat yazmasın!
    const livePmoProjects = (state.projects || []).filter(p => isPmoProjectObj(p));

    // Mövcud yaddaşda və lokal depoda olan qeyri-PMO layihələri qoru
    const localImported = state.projects.filter(p =>
        p && !isPmoProjectObj(p) && (p.imported || p.isLocal || p.category === "other" || String(p.id).startsWith("imp_") || String(p.id).startsWith("proj_custom_") || String(p.id).startsWith("proj_local_") || String(p.id).startsWith("proj_mm_"))
    );
    const storedImported = getStoredImportedProjects();

    const localMap = new Map();
    storedImported.forEach(p => { if (p && p.id && !isPmoProjectObj(p)) localMap.set(p.id, p); });
    localImported.forEach(p => { if (p && p.id && !isPmoProjectObj(p)) localMap.set(p.id, p); });

    try {
        const fresh = await api.loadAll(state.user.id);
        const dbProjects = (fresh.projects || []).filter(p => p && !isPmoProjectObj(p));

        let merged = [...dbProjects];
        for (const [id, localProj] of localMap.entries()) {
            const idx = merged.findIndex(p => p.id === id);
            if (idx >= 0) {
                merged[idx] = mergeLocalProjectIntoDb(merged[idx], localProj);
            } else {
                merged.push(localProj);
            }
        }
        const LEGACY_DEMO_PROJECT_IDS = new Set(["proj_magistral", "proj_gpon_north", "proj_gpon_west", "proj_karabakh"]);
        merged = merged.filter(p => p && !LEGACY_DEMO_PROJECT_IDS.has(p.id) && !isPmoProjectObj(p) && p.category !== "project");

        // Canlı PMO layihələrini (subPoints və ən son Google Sheets məlumatları ilə) geri qaytar
        const pmoListToKeep = livePmoProjects.length > 0
            ? livePmoProjects
            : (readPmoLiveCacheSync() || (Array.isArray(window.PMO_SEED_PROJECTS) ? window.PMO_SEED_PROJECTS : []));
        pmoListToKeep.forEach(np => {
            if (!np || !np.id) return;
            const idx = merged.findIndex(p => p.id === np.id);
            if (idx < 0) merged.push(np);
        });

        state.projects = merged;
        if (fresh.contractors) state.contractors = fresh.contractors;
        if (fresh.materials) state.materials = fresh.materials;
        if (fresh.notes) state.notes = fresh.notes;
    } catch (err) {
        console.warn("api.loadAll xətası, lokal məlumatlar saxlanılır:", err);
    }

    applySavedMetaOverrides();
    if (typeof window.applySavedGeomOverrides === "function") window.applySavedGeomOverrides();
    const hiddenSet = getHiddenProjectIds();
    state.visibleIds.clear();
    state.projects.forEach(p => {
        if (known.has(p.id)) {
            if (knownVisible.has(p.id)) state.visibleIds.add(p.id);
        } else if (!hiddenSet.has(p.id)) {
            state.visibleIds.add(p.id);
        }
    });

    saveImportedProjects();
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
    } else if (field.type === "color") {
        const hexVal = normalizeColorCode(value, "#38BDF8");
        control = `<div style="display:flex;align-items:center;gap:8px">
            <input type="color" data-color-picker="${esc(field.key)}" value="${esc(hexVal)}" style="width:42px;height:34px;padding:2px;border-radius:8px;border:1px solid var(--line);background:var(--surface-2);cursor:pointer;flex-shrink:0">
            <input ${attrs} type="text" value="${esc(value || hexVal)}" placeholder="#38BDF8" style="flex:1">
        </div>`;
    } else {
        const step = field.type === "number" ? 'step="any" min="0"' : "";
        const ph = field.placeholder ? `placeholder="${esc(field.placeholder)}"` : "";
        const listId = field.list ? `dl_${field.key}` : "";
        const listAttr = listId ? `list="${listId}"` : "";
        const listEl = listId ? `<datalist id="${listId}">${field.list.map(x => `<option value="${esc(x)}">`).join("")}</datalist>` : "";
        control = `<input ${attrs} type="${field.type || "text"}" ${step} ${ph} ${listAttr} value="${esc(value)}">${listEl}`;
    }
    const after = field.action ? `<button class="link" type="button" data-field-action="${field.key}">${esc(field.action.label)}</button>` : "";
    const bcgAttr = field.bcgOnly ? ` data-bcg-only="1"` : "";
    return `<label class="${field.wide ? "wide" : ""}"${bcgAttr}><span>${esc(field.label)}${field.required ? " *" : ""}</span>${control}${after}</label>`;
}

function openEditor(config) {
    editor = config;
    $("editTitle").textContent = config.title;
    $("editError").textContent = "";
    $("editFields").innerHTML = config.fields.map(f => fieldHtml(f, config.values[f.key] ?? "")).join("");
    if (Array.isArray(config.customFields)) {
        const cfWrap = document.createElement("div");
        cfWrap.className = "wide cf-editor";
        cfWrap.id = "customFieldsEditor";
        const renderCfRows = list => {
            cfWrap.querySelector("#cfRows").innerHTML = list.map((cf, idx) => `
                <div class="cf-row" data-cf-idx="${idx}">
                    <input type="text" class="input cf-lbl" placeholder="Başlıq (özünüz yazın)…" value="${esc(cf.label || "")}">
                    <input type="text" class="input cf-val" placeholder="Məlumat / Dəyər…" value="${esc(cf.value || "")}">
                    <button type="button" class="icon-btn small cf-del" title="Sil"><i class="fa-solid fa-xmark"></i></button>
                </div>
            `).join("");
        };
        cfWrap.innerHTML = `
            <div class="cf-head">
                <span>📝 Sərbəst başlıqlar (öz məlumatlarınız)</span>
                <button type="button" class="link" id="addCustomFieldBtn">+ Yeni başlıq əlavə et</button>
            </div>
            <div class="cf-rows" id="cfRows"></div>
        `;
        $("editFields").appendChild(cfWrap);
        const curList = config.customFields.length ? config.customFields : [];
        renderCfRows(curList);
        cfWrap.addEventListener("click", e => {
            if (e.target.closest("#addCustomFieldBtn")) {
                const existing = [...cfWrap.querySelectorAll(".cf-row")].map(r => ({
                    label: r.querySelector(".cf-lbl").value,
                    value: r.querySelector(".cf-val").value
                }));
                existing.push({ label: "", value: "" });
                renderCfRows(existing);
                cfWrap.querySelector(".cf-row:last-child .cf-lbl")?.focus();
            } else if (e.target.closest(".cf-del")) {
                e.target.closest(".cf-row")?.remove();
            }
        });
    }
    const contractorSel = $("editFields").querySelector('select[name="contractor"]');
    const syncBcgOnlyFields = () => {
        const showBcg = contractorSel && isBcgContractor(contractorSel.value);
        $("editFields").querySelectorAll("[data-bcg-only]").forEach(el => {
            el.style.display = showBcg ? "" : "none";
        });
    };
    if (contractorSel) {
        contractorSel.addEventListener("change", syncBcgOnlyFields);
        syncBcgOnlyFields();
    }
    $("editFields").querySelectorAll("[data-color-picker]").forEach(picker => {
        const key = picker.dataset.colorPicker;
        const textInp = $("editFields").querySelector(`input[name="${key}"]`);
        if (!textInp) return;
        picker.addEventListener("input", () => {
            textInp.value = picker.value.toUpperCase();
        });
        textInp.addEventListener("input", () => {
            const norm = normalizeColorCode(textInp.value, "");
            if (norm) picker.value = norm;
        });
    });
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
    const cfRows = $("editFields").querySelectorAll("#customFieldsEditor .cf-row");
    if (cfRows.length > 0 || Array.isArray(editor.customFields)) {
        values._customFields = [...cfRows].map(r => ({
            label: r.querySelector(".cf-lbl")?.value.trim() || "",
            value: r.querySelector(".cf-val")?.value.trim() || ""
        })).filter(x => x.label || x.value);
    }
    try {
        if (values.start_date && values.end_date && values.end_date < values.start_date) throw new Error("dates");
        pushUndoSnapshot(editor.title || "Redaktə");
        await editor.onSave(values);
    } catch (error) {
        const messages = { coords: "coordsInvalid", dates: "datesInvalid", km: "kmInvalid" };
        $("editError").textContent = t(messages[error.message] || "saveError");
        return;
    }
    $("editModal").close();
    renderMaterials();
    renderAll();
    toast(t("saved"));
}

async function deleteFromEditor() {
    if (!confirm(t("confirmRemove"))) return;
    try {
        pushUndoSnapshot("Silmə əməliyyatı");
        await editor.onDelete();
    } catch {
        $("editError").textContent = t("saveError");
        return;
    }
    $("editModal").close();
    renderMaterials();
    renderAll();
    toast(t("removed"));
}

function editProject(project) {
    const activeCat = [...state.activeFolders][0] || state.sidebarCategory || "project";
    const initCat = project?.category || activeCat;
    const isOther = initCat === "other";
    const firstItem = project?.items?.[0];
    const defaultOtherColor = normalizeColorCode(project?.customColor || firstItem?.customColor || firstItem?.fillColor, firstItem?.isPolygon ? "#38BDF8" : "#38BDF8");
    const defaultOtherWidth = normalizeLineWidth(project?.lineWidth || firstItem?.lineWidth, firstItem?.isPolygon ? 1.4 : 1.8);
    const curPolyFill = project?.polyFilled === true || firstItem?.polyFilled === true
        ? "filled"
        : (project?.polyFilled === false || firstItem?.polyFilled === false ? "hollow" : "auto");

    openEditor({
        title: t(project ? "editProject" : "addProject"),
        values: project ? {
            name: project.name,
            category: project.category || "project",
            status: project.status,
            project_type: project.type || "lines",
            start_date: project.startDate,
            end_date: project.endDate,
            custom_color: defaultOtherColor,
            line_width: defaultOtherWidth,
            poly_fill: curPolyFill
        } : {
            category: initCat,
            status: "layihe",
            project_type: initCat === "nim" ? "points" : "lines",
            custom_color: "#38BDF8",
            line_width: 1.8,
            poly_fill: "auto"
        },
        fields: isOther ? [
            { key: "name", label: t("fieldName"), required: true, wide: true },
            { key: "category", label: "Qovluq", type: "select", wide: true, options: [["project", "🏢 BCG"], ["nim", "🚦 NİİM"], ["azconnect", "🌐 Azərconnect"], ["other", "🗂️ Digər"]] },
            { key: "custom_color", label: "🎨 Rəng seçimi (Xətt / Poliqon rəngi)", type: "color", wide: true },
            { key: "line_width", label: "📏 Sərhəd / Xətt qalınlığı (px)", type: "number", wide: true },
            { key: "poly_fill", label: "🔷 Poliqon görünüşü (İçi dolu / boş)", type: "select", wide: true, options: [
                ["auto", "✨ Fayldakı kimi (Avtomatik)"],
                ["filled", "🟦 İçi dolu (Rəngli sahə — məs: Xəzər dənizi)"],
                ["hollow", "⬜ İçi boş (Yalnız sərhəd xətti — məs: Rayonlar)"]
            ] }
        ] : [
            { key: "name", label: t("fieldName"), required: true, wide: true },
            { key: "category", label: "Qovluq", type: "select", options: [["project", "🏢 BCG"], ["nim", "🚦 NİİM"], ["azconnect", "🌐 Azərconnect"], ["other", "🗂️ Digər"]] },
            { key: "project_type", label: "Layihə növü", type: "select", options: [["lines", "〰️ Kabel / Xətt layihəsi"], ["points", "📍 Nöqtə / Sərbəst Məlumat layihəsi"]] },
            { key: "status", label: t("thStatus"), type: "select", options: statusOptions(), wide: true },
            { key: "start_date", label: t("fieldStart"), type: "date" },
            { key: "end_date", label: t("fieldEnd"), type: "date" }
        ],
        onSave: async row => {
            const chosenCat = row.category || initCat || "project";
            if (project) {
                project.name = row.name;
                project.category = chosenCat;
                if (isOther) {
                    const col = normalizeColorCode(row.custom_color, defaultOtherColor);
                    const wid = normalizeLineWidth(row.line_width, defaultOtherWidth);
                    project.customColor = col;
                    project.lineWidth = wid;
                    if (row.poly_fill === "filled") {
                        project.polyFilled = true;
                        project.fillColor = col;
                    } else if (row.poly_fill === "hollow") {
                        project.polyFilled = false;
                    }
                    (project.items || []).forEach(it => {
                        it.customColor = col;
                        it.fillColor = col;
                        it.lineWidth = wid;
                        if (row.poly_fill === "filled") {
                            it.isPolygon = true;
                            it.polyFilled = true;
                        } else if (row.poly_fill === "hollow") {
                            it.polyFilled = false;
                        }
                        saveSegmentOverride(project.id, it);
                    });
                } else {
                    project.status = row.status || project.status;
                    project.type = row.project_type || project.type;
                    project.startDate = row.start_date || "";
                    project.endDate = row.end_date || "";
                }
            } else {
                const newId = `proj_local_${Date.now()}`;
                const col = isOther ? normalizeColorCode(row.custom_color, "#38BDF8") : "";
                const wid = isOther ? normalizeLineWidth(row.line_width, 1.8) : 0;
                const newProj = {
                    id: newId,
                    name: row.name,
                    status: row.status || "layihe",
                    type: row.project_type || "lines",
                    category: chosenCat,
                    startDate: row.start_date || "",
                    endDate: row.end_date || "",
                    customColor: col,
                    lineWidth: wid,
                    polyFilled: row.poly_fill === "filled" ? true : (row.poly_fill === "hollow" ? false : undefined),
                    items: [],
                    isLocal: true
                };
                state.projects.push(newProj);
                state.visibleIds.add(newId);
                state.activeFolders.add(chosenCat);
                state.expandedIds.add(newId);
                state.statusFilter = "all";
                state.statusFilters.clear();
                project = newProj;
            }
            saveProjectOverride(project);
            saveImportedProjects();
            try {
                const dbRow = { ...row, project_type: project.type || "lines" };
                delete dbRow.custom_color;
                delete dbRow.line_width;
                delete dbRow.poly_fill;
                delete dbRow.category;
                await api.saveProjectRow(project.id, dbRow);
            } catch (e) {
                console.warn("api.saveProjectRow xətası (lokal qorunur):", e);
            }
        },
        onDelete: project && (async () => {
            const delId = project.id;
            markProjectDeleted(delId);
            state.projects = state.projects.filter(p => p.id !== delId);
            state.visibleIds.delete(delId);
            state.expandedIds.delete(delId);
            if (state.selected?.projectId === delId) state.selected = null;
            if (window.__activeProjectId === delId) {
                window.__activeProjectId = null;
                if ($("infoCard")) $("infoCard").hidden = true;
            }
            // Özəl əlavə olunmuş elementlər və meta keşlərindən də tam təmizlə ki geri qayıtmasın
            try {
                const customList = readStore("bcg.custom.items.v1", []);
                if (Array.isArray(customList)) {
                    writeStore("bcg.custom.items.v1", customList.filter(x => x && x.projectId !== delId));
                }
                const pMap = readStore(PROJ_META_STORE_KEY, {});
                if (pMap && pMap[delId]) {
                    delete pMap[delId];
                    writeStore(PROJ_META_STORE_KEY, pMap);
                }
                const snap = JSON.parse(localStorage.getItem("bcg.db.snapshot.v1") || "null");
                if (snap && Array.isArray(snap.projects)) {
                    snap.projects = snap.projects.filter(p => p.id !== delId);
                    localStorage.setItem("bcg.db.snapshot.v1", JSON.stringify(snap));
                }
            } catch {}
            saveImportedProjects();
            if (api.configured) {
                await api.deleteProject(delId).catch(e => console.warn("api.deleteProject xətası:", e));
                if (typeof api.syncCloudRegistry === "function") api.syncCloudRegistry().catch(() => {});
            }
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
    const isOther = project?.category === "other";
    const adminMap = syncAdminContractors();
    const contractorNames = [...new Set(["BCG", ...Object.keys(adminMap), ...(item?.contractor ? [item.contractor] : [])])].filter(Boolean);
    const currentFiber = item ? getSegmentFiber(item, project) : "";
    const fiberOpts = currentFiber && !FIBER_OPTIONS.includes(currentFiber) ? [currentFiber, ...FIBER_OPTIONS] : FIBER_OPTIONS;
    const ptKm = isPoints && item ? getPointKmPair(item) : null;
    const itemExec = item ? resolveItemExecDetails(item) : { contractor: "", lead: "", workers: "", phone: "" };
    openEditor({
        title: t(item ? "editSegment" : "addSegment"),
        isPoints,
        customFields: Array.isArray(item?.customFields) && item.customFields.length
            ? item.customFields
            : (isPoints && project?.category !== "nim" ? [{ label: "", value: "" }] : []),
        values: item ? {
            code: item.id, name: item.name, point_a: item.pointA || "", point_b: item.pointB || "", start_date: item.startDate, end_date: item.endDate,
            contractor: itemExec.contractor || item.contractor || "",
            exec_lead: item.execLead || itemExec.lead || "",
            exec_workers: item.execWorkers !== undefined && item.execWorkers !== "" ? item.execWorkers : "",
            exec_phone: item.execPhone || itemExec.phone || "",
            total_km: isPoints ? Number(formatKm(ptKm.planKm)) : item.totalKm,
            done_km: isPoints ? Number(formatKm(ptKm.doneKm)) : item.doneKm,
            status: item.status || "layihe",
            fiber_count: currentFiber,
            custom_color: item.customColor || item.fillColor || (item.isPolygon ? "#38BDF8" : "#38BDF8"),
            line_width: item.lineWidth || (item.isPolygon ? 1.4 : 2.0),
            poly_fill: item.polyFilled === true ? "filled" : (item.polyFilled === false ? "hollow" : "auto"),
            point_type: extractPointType(item.props, item) || "",
            antennas: item.antennas || 0, coords: coordsToText(item.coords)
        } : {
            code: `${isOther ? "RM" : (isPoints ? "PT" : "SEG")}-${Date.now().toString().slice(-4)}`,
            status: "layihe",
            fiber_count: "",
            custom_color: "#38BDF8",
            line_width: 1.8,
            poly_fill: "auto",
            point_type: "",
            total_km: 0,
            done_km: 0,
            antennas: 0,
            point_a: isOther ? "" : "Mərkəz",
            point_b: isOther ? "" : "Şəbəkə",
            contractor: "",
            exec_lead: "",
            exec_workers: "",
            exec_phone: ""
        },
        fields: [
            { key: "code", label: t("fieldCode"), required: true, wide: isOther },
            ...(!isOther ? [{ key: "status", label: t("thStatus"), type: "select", options: statusOptions() }] : []),
            ...(!isPoints && !isOther ? [{ key: "fiber_count", label: "🔌 Kabelin lif sayı (FO)", type: "select", wide: true, options: [["", "— Fayldan / Təyin edilməyib —"], ...fiberOpts.map(fo => [fo, `🔌 ${fo}`])] }] : []),
            { key: "name", label: t("fieldName"), required: true, wide: true },
            ...(isPoints && !isOther ? [{ key: "point_type", label: "🔷 Nöqtə növü (alt-layihə / fərqli ikon üçün)", wide: true, placeholder: "Məs: Faz-1, Faz-2, GPON, LTE, Növ-1..." }] : []),
            ...(isOther ? [
                { key: "custom_color", label: "🎨 Rəng seçimi (və ya rəng kodu)", type: "color", wide: true },
                { key: "line_width", label: "📏 Xətt / Sərhəd qalınlığı (px)", type: "number", wide: true },
                { key: "poly_fill", label: "🔷 Poliqon görünüşü (İçi dolu / boş)", type: "select", wide: true, options: [
                    ["auto", "✨ Fayldakı kimi (Avtomatik)"],
                    ["filled", "🟦 İçi dolu (Rəngli sahə)"],
                    ["hollow", "⬜ İçi boş (Yalnız sərhəd xətti)"]
                ] }
            ] : []),
            ...(!isOther ? [
                { key: "point_a", label: `📍 ${t("pointA")}`, required: !isPoints },
                { key: "point_b", label: `📍 ${t("pointB")}`, required: !isPoints },
                { key: "start_date", label: t("fieldStart"), type: "date" },
                { key: "end_date", label: t("fieldEnd"), type: "date" },
                { key: "total_km", label: isPoints ? "1. Verilən məsafə (km və ya m)" : `1. Nəzərdə tutulan (km)`, type: "number" },
                { key: "done_km", label: isPoints ? "2. Çəkilən məsafə (km və ya m)" : `2. Faktiki iş görülən (km)`, type: "number" },
                ...(isPoints ? [{ key: "antennas", label: "Antena sayı (ədəd)", type: "number", wide: true }] : []),
                { key: "contractor", label: "İş icraçısı", type: "select", wide: true, options: [["", t("notAssigned")], ...contractorNames.map(n => [n, n === "BCG" ? "🏢 BCG" : `👷 ${n}`])] },
                { key: "exec_lead", label: "👨‍🔧 Kim işləyib (Mühəndis / Briqadir)", placeholder: "Məs: Əli Məmmədov", wide: true, bcgOnly: true },
                { key: "exec_workers", label: "👥 İşçi sayı (neçə nəfər)", type: "number", bcgOnly: true },
                { key: "exec_phone", label: "📞 Əlaqə nömrəsi", placeholder: "Məs: 050-000-00-00", bcgOnly: true }
            ] : []),
            { key: "coords", label: t("coordsField"), type: "textarea", wide: true, required: true, placeholder: "41.4205, 46.9242", action: { label: t("useLastDrawing"), run: useLastDrawing } }
        ],
        onSave: async row => {
            const parsedCoords = textToCoords(row.coords, (isPoints || isOther) ? 1 : 2);
            const oldCode = item?.id;
            const foVal = normalizeFiberCount(row.fiber_count ?? item?.fiberCount ?? "", "");
            const finalTotal = isPoints ? normalizePointMetersInput(row.total_km) : (Number(row.total_km) || 0);
            const finalDone = isPoints ? normalizePointMetersInput(row.done_km) : (Number(row.done_km) || 0);
            const eLeadVal = String(row.exec_lead || "").trim();
            const eWrkVal = row.exec_workers !== undefined && String(row.exec_workers).trim() !== "" && Number(row.exec_workers) > 0 ? Math.round(Number(row.exec_workers)) : "";
            const ePhnVal = String(row.exec_phone || "").trim();
            if (eLeadVal) saveBcgLeadEntry(eLeadVal, eWrkVal, ePhnVal);
            if (item) {
                item.id = row.code;
                item.name = row.name;
                if (!isOther) {
                    item.pointA = row.point_a;
                    item.pointB = row.point_b;
                    item.status = row.status || item.status;
                    item.fiberCount = foVal;
                    item.userSetFiber = Boolean(foVal);
                    item.totalKm = finalTotal;
                    item.doneKm = finalDone;
                    item.contractor = row.contractor || "";
                    item.execLead = eLeadVal;
                    item.execWorkers = eWrkVal;
                    item.execPhone = ePhnVal;
                    item.startDate = row.start_date || "";
                    item.endDate = row.end_date || "";
                    if (isPoints) {
                        item.antennas = Number(row.antennas || 0);
                        item.pointType = String(row.point_type ?? item.pointType ?? "").trim();
                        item.unit = "m";
                        item.summary = true;
                    }
                } else {
                    item.status = row.status || item.status || "layihe";
                    if (row.custom_color) {
                        const col = normalizeColorCode(row.custom_color, item.customColor || "#38BDF8");
                        item.customColor = col;
                        item.fillColor = col;
                    }
                    if (row.line_width) item.lineWidth = normalizeLineWidth(row.line_width, item.lineWidth || 1.8);
                    if (row.poly_fill === "filled") {
                        item.isPolygon = true;
                        item.polyFilled = true;
                    } else if (row.poly_fill === "hollow") {
                        item.polyFilled = false;
                    }
                }
                item.coords = parsedCoords;
                if (Array.isArray(row._customFields)) item.customFields = row._customFields;
                await window.saveGeomOverride?.(project.id, item.id, item.name, parsedCoords);
                if (project.isPmo && !item.isMagistral) {
                    window.pushMapEditToSheet?.({
                        action: "update_item",
                        sheetId: project.sheetId || project.pmoMeta?.sheetId || "",
                        itemId: item.id,
                        name: item.name,
                        status: item.status,
                        contractor: item.contractor,
                        doneM: item.doneKm,
                        planM: item.totalKm
                    });
                }
            } else {
                const col = isOther ? normalizeColorCode(row.custom_color, "#38BDF8") : "";
                const newSeg = {
                    id: row.code,
                    name: row.name,
                    pointA: row.point_a || row.name || "",
                    pointB: row.point_b || "",
                    status: row.status || "layihe",
                    pointType: isPoints ? String(row.point_type || "").trim() : undefined,
                    fiberCount: foVal,
                    customColor: col,
                    fillColor: col,
                    lineWidth: isOther ? normalizeLineWidth(row.line_width, 1.8) : 0,
                    isPolygon: row.poly_fill === "filled" ? true : false,
                    polyFilled: row.poly_fill === "filled" ? true : (row.poly_fill === "hollow" ? false : undefined),
                    totalKm: finalTotal,
                    doneKm: finalDone,
                    unit: isPoints ? "m" : undefined,
                    summary: isPoints ? true : undefined,
                    contractor: row.contractor || "",
                    execLead: eLeadVal,
                    execWorkers: eWrkVal,
                    execPhone: ePhnVal,
                    startDate: row.start_date || "",
                    endDate: row.end_date || "",
                    antennas: Number(row.antennas || 0),
                    customFields: Array.isArray(row._customFields) ? row._customFields : [],
                    coords: parsedCoords
                };
                if (!project.items) project.items = [];
                while (project.items.some(it => it.id === newSeg.id)) {
                    newSeg.id = `${newSeg.id}-${Math.floor(Math.random() * 90 + 10)}`;
                }
                row.code = newSeg.id;
                project.items.push(newSeg);
                item = newSeg;
            }

            saveSegmentOverride(project.id, item);
            try {
                const customList = readStore("bcg.custom.items.v1", []);
                const filteredCustom = (Array.isArray(customList) ? customList : []).filter(
                    x => !(x && x.projectId === project.id && (x.item?.id === oldCode || x.item?.id === item.id))
                );
                filteredCustom.push({ projectId: project.id, item });
                writeStore("bcg.custom.items.v1", filteredCustom);
            } catch {}
            saveImportedProjects();

            if (api.configured) {
                (async () => {
                    try {
                        await api.saveProject(project);
                    } catch (e) {
                        console.warn("api.saveProject xətası (lokal qorunur):", e);
                    }
                })();
            }

            if (item) state.selected = { projectId: project.id, itemId: item.id };
        },
        onDelete: item && (async () => {
            markSegmentDeleted(project.id, item.id);
            if (project?.items) {
                project.items = project.items.filter(r => r.id !== item.id);
            }
            try {
                const customList = readStore("bcg.custom.items.v1", []);
                if (Array.isArray(customList)) {
                    writeStore("bcg.custom.items.v1", customList.filter(x => !(x && x.projectId === project.id && x.item?.id === item.id)));
                }
            } catch {}
            state.selected = null;
            saveImportedProjects();
            try {
                await api.deleteSegment(project.id, item.id);
            } catch (e) {
                console.warn("api.deleteSegment xətası:", e);
            }
        })
    });
}

function editContractor(name) {
    const map = syncAdminContractors();
    const info = name && map[name] ? map[name] : { workers: 0, machinery: 0, engineer: "" };
    openEditor({
        title: t(name ? "editContractor" : "addContractor"),
        values: { ...info, name: name || "" },
        fields: [
            { key: "name", label: t("fieldName"), required: true, wide: true },
            { key: "workers", label: t("workers"), type: "number" },
            { key: "machinery", label: t("machinery"), type: "number" },
            { key: "engineer", label: t("engineer"), wide: true }
        ],
        onSave: async row => {
            const updated = { ...syncAdminContractors() };
            if (name && name !== row.name) delete updated[name];
            updated[row.name] = {
                workers: Number(row.workers) || 0,
                machinery: Number(row.machinery) || 0,
                engineer: row.engineer || ""
            };
            writeStore(ADMIN_CONTRACTORS_KEY, updated);
            state.contractors = updated;
            try { await api.saveContractor(name, row); } catch {}
        },
        onDelete: name && (async () => {
            const updated = { ...syncAdminContractors() };
            delete updated[name];
            writeStore(ADMIN_CONTRACTORS_KEY, updated);
            state.contractors = updated;
            try { await api.deleteContractor(name); } catch {}
        })
    });
}

const MATERIAL_STATES = ["ordered", "instock", "issued", "installed"];
const materialStateLabel = s => I18N[state.lang][`state${s}`] || s;

const LEGACY_PROJECT_RENAME_MAP = {
    "1. Milli Magistral Fiber Optik": "BCG — Bakı-Quba-Qusar Magistralı",
    "Milli Magistral Fiber Optik": "BCG — Bakı-Quba-Qusar Magistralı",
    "2. GPON Şimal Bölgəsi": "BCG — Bakı-Şamaxı-Yevlax Magistralı",
    "GPON Şimal Bölgəsi": "BCG — Bakı-Şamaxı-Yevlax Magistralı",
    "3. GPON Qərb Bölgəsi": "BCG — Gəncə-Qazax Magistralı",
    "GPON Qərb Bölgəsi": "BCG — Gəncə-Qazax Magistralı",
    "4. Abşeron & Bakı Kəndləri": "Azərconnect — Bakı-Sumqayıt Magistralı",
    "Abşeron & Bakı Kəndləri": "Azərconnect — Bakı-Sumqayıt Magistralı",
    "5. Qarabağ & Şərqi Zəngəzur": "BCG — Cənub Antena Layihəsi",
    "Qarabağ & Şərqi Zəngəzur": "BCG — Cənub Antena Layihəsi"
};

const WAREHOUSE_CATALOG = [
    "FO 12", "FO 24", "FO 48", "FO 96", "FO 144", "ADSS 24", "ADSS 48", "Drop Kabel",
    "Mufta 12-lik", "Mufta 24-lük", "Mufta 48-lik", "Mufta 96-lıq", "Mufta 144-lük",
    "Patch Panel 12-port", "Patch Panel 24-port", "Patch Panel 48-port", "Patch Panel 96-port"
];

function detectMaterialCategory(name, explicitCat = "") {
    if (explicitCat && ["kabel", "mufta", "patchpanel", "diger"].includes(explicitCat)) return explicitCat;
    const s = String(name || "").toLowerCase();
    if (/patch|odf|panel/i.test(s)) return "patchpanel";
    if (/mufta|kaset/i.test(s)) return "mufta";
    if (/\bfo\b|fov|kabel|adss|drop|fiber|optik/i.test(s)) return "kabel";
    return "diger";
}

function normalizeMaterialUnitAndQty(rawQty, rawUnit) {
    const q = Math.max(0, Number(String(rawQty ?? "").replace(/[^\d.,]/g, "").replace(",", ".")) || 0);
    if (rawUnit === "km") return { qty: Math.round(q * 1000), unit: "m" };
    if (rawUnit === "əd") return { qty: Math.round(q * 100) / 100, unit: "əd" };
    return { qty: Math.round(q * 100) / 100, unit: rawUnit || "m" };
}

function editMaterial(material, presetFlow = null) {
    const current = material?.state;
    const states = current && !MATERIAL_STATES.includes(current) ? [...MATERIAL_STATES, current] : MATERIAL_STATES;
    const today = new Date().toISOString().slice(0, 10);

    const activeProjectNames = [
        "🏢 Ümumi Anbar",
        ...state.projects.map(p => p.name),
        "BCG — Bakı-Quba-Qusar Magistralı",
        "BCG — Bakı-Şamaxı-Yevlax Magistralı",
        "BCG — Gəncə-Qazax Magistralı",
        "BCG — Cənub Antena Layihəsi",
        "BCG — Qərb Antena Layihəsi",
        "Azərconnect — Bakı-Sumqayıt Magistralı",
        "Azərconnect — Xırdalan-Masazır Xətti",
        "Azərconnect — Ələt-Şirvan Xətti",
        "NİİM — Svetofor və Kəsişmələr (Bakı)"
    ];
    const uniqueProjects = [...new Set(activeProjectNames.filter(Boolean))];

    const flowVal = material?.flow || presetFlow || "out";
    let currentProj = material?.project;
    if (currentProj && LEGACY_PROJECT_RENAME_MAP[currentProj]) {
        currentProj = LEGACY_PROJECT_RENAME_MAP[currentProj];
    }
    if (!currentProj) {
        currentProj = flowVal === "in" ? "🏢 Ümumi Anbar" : (uniqueProjects.find(p => p !== "🏢 Ümumi Anbar") || "BCG — Bakı-Quba-Qusar Magistralı");
    }
    if (!uniqueProjects.includes(currentProj)) uniqueProjects.unshift(currentProj);

    const parsedQty = material
        ? (Number(material.qty_num) || Number(String(material.quantity || material.issued_qty || "").replace(/[^\d.,]/g, "").replace(",", ".")) || "")
        : "";
    const curUnit = material?.unit || (/əd|eded/i.test(String(material?.quantity || "")) ? "əd" : "m");
    const curCat = detectMaterialCategory(material?.material, material?.category);

    openEditor({
        title: material ? t("editMaterial") : "📦 Mal / Qaimə əlavə et",
        values: material ? {
            ...material,
            flow: flowVal,
            project: currentProj,
            invoice_no: material.invoice_no || `QAİMƏ-2026-0${140 + (material.id || 1)}`,
            supplier: material.supplier || "",
            qty_num: parsedQty,
            unit: curUnit,
            used_date: material.used_date || today,
            note: material.note || ""
        } : {
            flow: flowVal,
            project: currentProj,
            invoice_no: `QAİMƏ-2026-${Math.floor(100 + Math.random() * 900)}`,
            supplier: "",
            qty_num: "",
            unit: "m",
            used_date: today,
            note: ""
        },
        fields: [
            {
                key: "flow",
                label: "Əməliyyat",
                type: "select",
                required: true,
                wide: true,
                options: [
                    ["in", "📥 Anbara gəlib (Mədaxil / Alış)"],
                    ["out", "📤 Layihəyə gedib (Məxaric)"],
                    ["return", "↩️ Layihədən qayıdıb (Qaytarma)"]
                ]
            },
            {
                key: "material",
                label: "Material (FO, Mufta, Patch Panel)",
                required: true,
                wide: true,
                placeholder: "Məs: FO 48, Mufta 48-lik, Patch Panel 24-port",
                list: WAREHOUSE_CATALOG
            },
            { key: "qty_num", label: "Miqdar", type: "number", required: true, placeholder: "Məs: 40000" },
            {
                key: "unit",
                label: "Vahid",
                type: "select",
                required: true,
                options: [
                    ["m", "m (metr)"],
                    ["km", "km"],
                    ["əd", "əd (ədəd)"]
                ]
            },
            {
                key: "project",
                label: "Layihə / Anbar",
                type: "select",
                required: true,
                wide: true,
                options: uniqueProjects.map(p => [p, p])
            },
            { key: "supplier", label: "Kimdən / Kimə", placeholder: "Məs: Bakcable / Podratçı" },
            { key: "used_date", label: "Tarix", type: "date", required: true },
            { key: "invoice_no", label: "📄 Qaimə №", required: true },
            { key: "note", label: "Qeyd (istəyə bağlı)", placeholder: "Məs: Baraban №4" }
        ],
        onSave: async row => {
            const norm = normalizeMaterialUnitAndQty(row.qty_num, row.unit);
            const displayQty = `${norm.qty} ${norm.unit}`;
            const autoState = row.flow === "in" || row.flow === "return" ? "in_stock" : "issued";
            await api.saveMaterial(material?.id, {
                ...row,
                category: detectMaterialCategory(row.material, material?.category),
                state: material?.state || autoState,
                qty_num: norm.qty,
                unit: norm.unit,
                quantity: displayQty,
                issued_qty: row.flow === "out" ? displayQty : "",
                used_qty: row.flow === "return" ? displayQty : ""
            });
            await reloadData();
        },
        onDelete: material && (async () => { await api.deleteMaterial(material.id); await reloadData(); })
    });
    const flowSel = $("editFields")?.querySelector('select[name="flow"]');
    const projSel = $("editFields")?.querySelector('select[name="project"]');
    const unitSel = $("editFields")?.querySelector('select[name="unit"]');
    const matInp = $("editFields")?.querySelector('input[name="material"]');
    if (flowSel && projSel) {
        flowSel.addEventListener("change", () => {
            if (flowSel.value === "in") {
                projSel.value = "🏢 Ümumi Anbar";
            } else if (projSel.value === "🏢 Ümumi Anbar") {
                const firstProj = uniqueProjects.find(p => p !== "🏢 Ümumi Anbar");
                if (firstProj) projSel.value = firstProj;
            }
        });
    }
    if (matInp && unitSel) {
        matInp.addEventListener("change", () => {
            const cat = detectMaterialCategory(matInp.value);
            if (cat === "mufta" || cat === "patchpanel") unitSel.value = "əd";
            else if (cat === "kabel" && unitSel.value === "əd") unitSel.value = "m";
        });
    }
}
window.editMaterial = editMaterial;

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
    projects.forEach(p => {
        state.visibleIds.add(p.id);
        state.activeFolders.add(p.category || "project");
    });
    renderAll();
    const extras = await api.loadSharedExtras(token).catch(() => null);
    if (extras?.drawings) tools.loadShared(extras.drawings);
    if (extras?.view) map.jumpTo(extras.view);

    // Paylaşılan linkdə də canlı yenilənmə aktiv olsun
    if (api.configured && typeof api.startLiveSync === "function") {
        api.startLiveSync(async () => {
            try {
                const fresh = await api.loadShared(token);
                if (Array.isArray(fresh) && fresh.length > 0) {
                    const known = new Set(state.projects.map(p => p.id));
                    state.projects = fresh;
                    fresh.forEach(p => {
                        if (!known.has(p.id)) state.visibleIds.add(p.id);
                    });
                    renderAll();
                    toast("🔄 Məlumatlar canlı yeniləndi");
                }
            } catch {}
        });
    }
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
        if (isAdmin() && api.configured) {
            const visibleProjs = state.projects.filter(p => state.visibleIds.has(p.id) && (p.imported || p.category === "other" || p.category === "azconnect" || p.category === "nim"));
            for (const p of visibleProjs) {
                try { await api.saveProject(p); } catch {}
            }
        }
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
    satellite: { icon: "fa-satellite", label: "layerSatellite", raster: "googleSat", bg: "#1c2a30", names: true },
    street: { icon: "fa-road", label: "layerStreet", raster: "osm", bg: "#dfe6ea" },
    dark: { icon: "fa-moon", label: "layerDark", raster: "carto", bg: "#0e1a2b" },
    blank: { icon: "fa-square", label: "layerBlank", bg: "#ffffff" }
};
const NAME_LAYERS = ["esri-transport", "esri-places"];

/* Hər nöqtə layihəsi üçün içi rəngli dolu həndəsi fiqurlar */
const POINT_SHAPES = [
    { id: "circle", symbol: "●", name: "Dairə" },
    { id: "diamond", symbol: "◆", name: "Romb" },
    { id: "square", symbol: "■", name: "Kvadrat" },
    { id: "triangle", symbol: "▲", name: "Üçbucaq" },
    { id: "hexagon", symbol: "⬢", name: "Altıbucaqlı" },
    { id: "star", symbol: "★", name: "Ulduz" }
];

function isPointProject(p) {
    if (!p) return false;
    if (p.type === "points" || p.category === "nim") return true;
    return Array.isArray(p.items) && p.items.length > 0 && p.items.every(r => (r.coords?.length === 1) || (r.antennas || 0) > 0);
}

function getProjectShape(project) {
    if (!project) return POINT_SHAPES[0];
    const pool = project.category === "nim"
        ? state.projects.filter(p => p.category === "nim")
        : state.projects.filter(p => isPointProject(p) && p.category !== "nim");
    const idx = pool.findIndex(p => p.id === project.id);
    if (idx >= 0) return POINT_SHAPES[idx % POINT_SHAPES.length];
    let hash = 0;
    const str = String(project.id || project.name || "");
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return POINT_SHAPES[hash % POINT_SHAPES.length];
}

/* Faylda / obyektdə "nöqtə növü" (noqte_novu, point_type, tip, növ və s.) sütununu oxuyur */
function extractPointType(props, item) {
    if (item && typeof item.pointType === "string" && item.pointType.trim()) {
        return item.pointType.trim();
    }
    const p = props || item?.props;
    if (!p || typeof p !== "object") return "";
    const direct = getPropCaseInsensitive(
        p,
        "nöqtə növü", "noqte novu", "nöqtə_növü", "noqte_novu", "noqte_nov", "nöqtənövü", "noqtenovu",
        "point_type", "pointtype", "pointType", "nov", "növ", "novu", "növü", "tip", "tipi",
        "alt_layihe", "alt_layihə", "sub_project", "layihe_novu", "layihə_növü"
    );
    if (direct !== undefined && cleanAttrVal(direct)) {
        return String(cleanAttrVal(direct)).trim();
    }
    for (const [k, v] of Object.entries(p)) {
        if (v === undefined || v === null) continue;
        const nk = normalizeKey(k);
        if (/(noqte_?nov|point_?type|^nov$|^novu$|^tip$|^tipi$|alt_?layi|layihe_?nov)/.test(nk)) {
            const cleaned = cleanAttrVal(v);
            if (cleaned) return String(cleaned).trim();
        }
    }
    return "";
}

function formatPointAntLabel(antennas, pointType) {
    const cnt = Number(antennas) || 0;
    const pt = String(pointType || "").trim();
    return pt ? `${pt}-${cnt} ədəd` : `${cnt} antena`;
}

function getProjectPointTypes(project) {
    if (!project || !Array.isArray(project.items)) return [];
    const seen = new Set();
    const list = [];
    project.items.forEach(r => {
        const pt = extractPointType(r?.props, r);
        if (!pt) return;
        const key = pt.toLocaleLowerCase("az");
        if (!seen.has(key)) {
            seen.add(key);
            list.push(pt);
        }
    });
    return list;
}

/* Nöqtə növünə (nöqtə_növü) görə fərqli həndəsi fiqur ikonu qaytarır */
function getItemShape(project, item) {
    const baseShape = getProjectShape(project);
    if (!project || !item) return baseShape;
    const baseIdx = Math.max(0, POINT_SHAPES.indexOf(baseShape));
    const pt = extractPointType(item.props, item);
    if (pt) {
        const types = getProjectPointTypes(project);
        const tIdx = types.findIndex(x => x.toLocaleLowerCase("az") === pt.toLocaleLowerCase("az"));
        if (tIdx >= 0) {
            return POINT_SHAPES[(baseIdx + tIdx) % POINT_SHAPES.length];
        }
        let hash = 0;
        for (let i = 0; i < pt.length; i++) hash = (hash * 31 + pt.charCodeAt(i)) >>> 0;
        return POINT_SHAPES[hash % POINT_SHAPES.length];
    }
    // Əgər eyni layihədə eyni rayonda 2+ nöqtə varsa və nöqtə növü yazılmayıbsa, yenə də ikonları fərqləndir
    if (Array.isArray(project.items) && project.items.length > 1) {
        const rName = String(item.name || item.rayon || "").replace(/\s*rayon(u)?\b/gi, "").trim().toLocaleLowerCase("az");
        if (rName) {
            const sameRayon = project.items.filter(it =>
                String(it.name || it.rayon || "").replace(/\s*rayon(u)?\b/gi, "").trim().toLocaleLowerCase("az") === rName
            );
            if (sameRayon.length > 1) {
                const subIdx = sameRayon.indexOf(item);
                if (subIdx > 0) return POINT_SHAPES[(baseIdx + subIdx) % POINT_SHAPES.length];
            }
        }
    }
    return baseShape;
}

/* Bütün PMO layihələrində (Muğanlı, Gəncə 2027, 239 Region, Dəyişim 2026, Layihəsiz 15.1, Naxçıvan və s.)
   nöqtə və alt-nöqtələrin növünə görə fərqli xəritə ikonu, nişan və şərti işarə qaytarır */
function resolvePmoPointVisual(project, r, sp) {
    const baseShape = getProjectShape(project);
    if (!project) {
        return { key: "base", label: "", iconPrefix: `pt-${baseShape.id}`, shapeObj: baseShape, pillColor: "", pillText: "", legendType: "shape" };
    }
    const sheetId = String(project.sheetId || project.pmoMeta?.sheetId || "");
    const groupName = String(r?.name || r?.rayon || sp?.rayon || "").trim();
    const tsStr = String(sp?.tsNo || "").trim();
    const addrStr = String(sp?.address || "").trim();
    const ptText = `${groupName} ${tsStr} ${addrStr} ${sp?.name || ""}`.trim();

    // 1. RPŞ / Polis obyektləri
    if (/\brp[şs]\b|\bşp[şs]\b|\brpi\b|polis/i.test(ptText)) {
        return { key: "rps", label: "RPŞ (Polis)", iconPrefix: "pt-rps", shapeObj: null, pillColor: "#38bdf8", pillText: "🛡️ RPŞ (Polis)", legendType: "rps" };
    }
    // 2. Cərimə meydançası / Dayanacaq
    if (/c[əe]rim[əe]\s*meydan|\bdayanacaq\b/i.test(ptText)) {
        return { key: "cerime", label: "Cərimə meydançası", iconPrefix: "pt-cerime", shapeObj: null, pillColor: "#f59e0b", pillText: "🅿️ Cərimə meydançası", legendType: "cerime" };
    }
    // 3. Üztanıma kamerası
    if (/[üu]ztan[ıi]ma/i.test(ptText)) {
        return { key: "face", label: "Üztanıma kamerası", iconPrefix: "pt-face", shapeObj: null, pillColor: "#ec4899", pillText: "👤 Üztanıma kamerası", legendType: "face" };
    }
    // 4. Smart kamera / PTZ kamera
    if ((/smart\s*kamera|\bptz\b/i.test(ptText)) && sheetId !== "16") {
        const lbl = /\bptz\b/i.test(groupName) ? "PTZ kamera" : "Smart kamera";
        return { key: "cam", label: lbl, iconPrefix: "pt-cam", shapeObj: null, pillColor: "#06b6d4", pillText: `📷 ${lbl}`, legendType: "cam" };
    }
    // 5. Radar nöqtəsi (qarışıq layihələrdə və ya radar qrupunda)
    if ((sp?.ptKind === "radar" || /\bradar\b|ekin/i.test(ptText)) && sheetId !== "11") {
        return { key: "radar", label: "Radar", iconPrefix: "pt-radar", shapeObj: null, pillColor: "#38bdf8", pillText: "📡 Radar", legendType: "radar" };
    }
    // 6. Yeraltı piyada keçidi
    if (/yeralt[ıi]|piyada\s*ke[çc]id/i.test(ptText)) {
        const sh = POINT_SHAPES.find(s => s.id === "diamond") || baseShape;
        return { key: "underpass", label: "Yeraltı piyada keçidi", iconPrefix: `pt-${sh.id}`, shapeObj: sh, pillColor: "#fbbf24", pillText: "🚶 Yeraltı keçid", legendType: "shape" };
    }
    // 7. Ticarət Mərkəzi / Otel / Hava Limanı / Xəstəxana (TŞ kodu olmayan strateji obyektlər)
    const hasExplicitTsCode = /\b\d*t[şs][-\s]?\d+\b|\bat[şs][-\s]?\d+\b|\bgt[şs][-\s]?\d+\b/i.test(tsStr);
    if (!hasExplicitTsCode && /ticar[əe]t\s*m[əe]rk[əe]z|univermaq|\bmall\b|\botel(inin)?\b|\bhotel\b|hava\s*liman|x[əe]st[əe]xana/i.test(ptText)) {
        const sh = POINT_SHAPES.find(s => s.id === "star") || baseShape;
        const lbl = /ticar[əe]t|univermaq|\bmall\b/i.test(ptText) ? "Ticarət Mərkəzi" : (/otel|hotel/i.test(ptText) ? "Otel / Obyekt" : "Strateji Obyekt");
        return { key: `obj_${lbl}`, label: lbl, iconPrefix: `pt-${sh.id}`, shapeObj: sh, pillColor: "#f43f5e", pillText: `🏢 ${lbl}`, legendType: "shape" };
    }
    // 8. Mövcud nöqtələr (Gəncə 2027 və s.)
    if (/m[öo]vcud\s*n[öo]qt/i.test(groupName)) {
        const sh = POINT_SHAPES.find(s => s.id === "hexagon") || baseShape;
        return { key: "existing", label: "Mövcud nöqtələr", iconPrefix: `pt-${sh.id}`, shapeObj: sh, pillColor: "#94a3b8", pillText: "📍 Mövcud nöqtə", legendType: "shape" };
    }
    // 9. TŞ nöqtəsi (qarışıq layihələrdə: Muğanlı 12, Dəyişim 14, Gəncə 17, Layihəsiz 15.1, Naxçıvan 18, 239 Region 10)
    const isMixedSheet = ["10", "12", "14", "15.1", "17", "18"].includes(sheetId) || /mu[ğg]anl[ıi]|d[əe]yi[şs]im|g[əe]nc[əe]|layih[əe]siz|nax[çc][ıi]van/i.test(String(project.name || ""));
    if (isMixedSheet && (sp?.ptKind === "ts" || hasExplicitTsCode || /\bt[şs]\b/i.test(groupName))) {
        return { key: "ts", label: "TŞ nöqtəsi", iconPrefix: "pt-ts", shapeObj: null, pillColor: "#a855f7", pillText: "📹 TŞ nöqtəsi", legendType: "ts" };
    }
    // 10. Təmir - Bərpa (Vərəq 15.3) RM-ləri üçün fərqli həndəsi fiqur
    if (r && !r.isMagistral && Array.isArray(project.items) && project.items.length > 1) {
        const nonMagItems = project.items.filter(it => !it.isMagistral);
        if (sheetId === "15.3") {
            const cIdx = Math.max(0, nonMagItems.findIndex(it => it.id === r.id || it.name === r.name));
            const baseIdx = Math.max(0, POINT_SHAPES.indexOf(baseShape));
            const sh = POINT_SHAPES[(baseIdx + cIdx) % POINT_SHAPES.length] || baseShape;
            return { key: `cat_${groupName}`, label: groupName, iconPrefix: `pt-${sh.id}`, shapeObj: sh, pillColor: "#38bdf8", pillText: `🔹 ${groupName}`, legendType: "shape" };
        }
    }
    return { key: "base", label: cleanProjectName(project.name, sheetId), iconPrefix: `pt-${baseShape.id}`, shapeObj: baseShape, pillColor: "", pillText: "", legendType: "base" };
}

let pointShapesRegistered = false;

function registerPointShapeImages() {
    if (!map || pointShapesRegistered) return;
    pointShapesRegistered = true;
    const colors = [...Object.values(STATUS_COLORS), "#38BDF8"];
    const size = 48;
    const half = size / 2;
    const r = 12.5;

    POINT_SHAPES.forEach(shape => {
        colors.forEach(color => {
            const id = `pt-${shape.id}-${color.replace("#", "").toLowerCase()}`;
            if (map.hasImage(id)) map.removeImage(id);
            const canvas = document.createElement("canvas");
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext("2d");

            ctx.save();
            ctx.beginPath();
            if (shape.id === "circle") {
                ctx.arc(half, half, r, 0, Math.PI * 2);
            } else if (shape.id === "diamond") {
                const dr = r + 3.5;
                ctx.moveTo(half, half - dr);
                ctx.lineTo(half + dr, half);
                ctx.lineTo(half, half + dr);
                ctx.lineTo(half - dr, half);
                ctx.closePath();
            } else if (shape.id === "square") {
                const s = r * 1.72;
                ctx.rect(half - s / 2, half - s / 2, s, s);
            } else if (shape.id === "triangle") {
                const tr = r + 4;
                ctx.moveTo(half, half - tr);
                ctx.lineTo(half + tr * 0.96, half + tr * 0.80);
                ctx.lineTo(half - tr * 0.96, half + tr * 0.80);
                ctx.closePath();
            } else if (shape.id === "hexagon") {
                const hr = r + 2.2;
                for (let i = 0; i < 6; i++) {
                    const ang = (Math.PI / 3) * i - Math.PI / 6;
                    const x = half + hr * Math.cos(ang);
                    const y = half + hr * Math.sin(ang);
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.closePath();
            } else if (shape.id === "star") {
                const outer = r + 4.5;
                const inner = r * 0.48;
                for (let i = 0; i < 10; i++) {
                    const rad = i % 2 === 0 ? outer : inner;
                    const ang = (Math.PI / 5) * i - Math.PI / 2;
                    const x = half + rad * Math.cos(ang);
                    const y = half + rad * Math.sin(ang);
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.closePath();
            }

            // İçi tam rəngli dolu həndəsi fiqur (əvvəlki tərz, bir az yığcam ölçüdə)
            ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
            ctx.shadowBlur = 4;
            ctx.fillStyle = color;
            ctx.fill();

            ctx.shadowBlur = 0;
            ctx.lineWidth = 2.0;
            ctx.strokeStyle = "#ffffff";
            ctx.stroke();
            ctx.restore();

            map.addImage(id, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
        });
    });

    // 🛡️ RPŞ (Polis) nöqtələri üçün xüsusi Polis Qalxanı + Ulduz ikonu
    colors.forEach(color => {
        const id = `pt-rps-${color.replace("#", "").toLowerCase()}`;
        if (map.hasImage(id)) map.removeImage(id);
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");

        ctx.save();
        // Polis qalxanı forması
        ctx.beginPath();
        ctx.moveTo(half, 6);
        ctx.lineTo(size - 9, 12);
        ctx.quadraticCurveTo(size - 8, 28, half, size - 6);
        ctx.quadraticCurveTo(8, 28, 9, 12);
        ctx.closePath();

        ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
        ctx.shadowBlur = 4;
        ctx.fillStyle = color;
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();

        // Daxildə tünd göy polis zolağı + ağ ulduz
        ctx.beginPath();
        ctx.arc(half, half - 1, 7.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(15, 23, 42, 0.78)";
        ctx.fill();

        ctx.beginPath();
        const spikes = 5, outerR = 5.4, innerR = 2.4, cy = half - 1;
        for (let i = 0; i < spikes * 2; i++) {
            const rad = (i % 2 === 0) ? outerR : innerR;
            const ang = (i * Math.PI) / spikes - Math.PI / 2;
            const sx = half + Math.cos(ang) * rad;
            const sy = cy + Math.sin(ang) * rad;
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
        ctx.fillStyle = "#FACC15";
        ctx.fill();
        ctx.restore();

        map.addImage(id, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
    });

    // 📡 Radar nöqtələri üçün xüsusi Radar dalğası ikonu (Muğanlı və s.)
    colors.forEach(color => {
        const id = `pt-radar-${color.replace("#", "").toLowerCase()}`;
        if (map.hasImage(id)) map.removeImage(id);
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");

        ctx.save();
        // Altıguşəli / dairəvi radar lövhəsi
        ctx.beginPath();
        ctx.arc(half, half, 15, 0, Math.PI * 2);
        ctx.shadowColor = "rgba(0,0,0,0.65)";
        ctx.shadowBlur = 4;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();

        // Daxildə tünd dairə + ağ radar dalğaları
        ctx.beginPath();
        ctx.arc(half, half, 10, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(15, 23, 42, 0.80)";
        ctx.fill();

        ctx.strokeStyle = "#38BDF8";
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(half - 2, half + 2, 5.2, -Math.PI * 0.65, 0.15);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(half - 2, half + 2, 8.6, -Math.PI * 0.65, 0.15);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(half - 2, half + 2, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = "#FACC15";
        ctx.fill();
        ctx.restore();

        map.addImage(id, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
    });

    // 📹 TŞ (Təhlükəsiz Şəhər) nöqtələri üçün xüsusi TŞ nişanı ikonu
    colors.forEach(color => {
        const id = `pt-ts-${color.replace("#", "").toLowerCase()}`;
        if (map.hasImage(id)) map.removeImage(id);
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");

        ctx.save();
        const pad = 8;
        const w = size - pad * 2;
        const rad = 7;
        ctx.beginPath();
        ctx.moveTo(pad + rad, pad);
        ctx.lineTo(pad + w - rad, pad);
        ctx.quadraticCurveTo(pad + w, pad, pad + w, pad + rad);
        ctx.lineTo(pad + w, pad + w - rad);
        ctx.quadraticCurveTo(pad + w, pad + w, pad + w - rad, pad + w);
        ctx.lineTo(pad + rad, pad + w);
        ctx.quadraticCurveTo(pad, pad + w, pad, pad + w - rad);
        ctx.lineTo(pad, pad + rad);
        ctx.quadraticCurveTo(pad, pad, pad + rad, pad);
        ctx.closePath();

        ctx.shadowColor = "rgba(0,0,0,0.65)";
        ctx.shadowBlur = 4;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();

        ctx.fillStyle = "#0F172A";
        ctx.fillRect(pad + 3, half - 7, w - 6, 14);

        ctx.fillStyle = "#FFFFFF";
        ctx.font = "900 10.5px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("TŞ", half, half + 0.5);
        ctx.restore();

        map.addImage(id, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
    });

    // 🅿️ Cərimə meydançası / Dayanacaq nöqtələri üçün xüsusi "P" nişanı ikonu
    colors.forEach(color => {
        const id = `pt-cerime-${color.replace("#", "").toLowerCase()}`;
        if (map.hasImage(id)) map.removeImage(id);
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");

        ctx.save();
        const pad = 8;
        const w = size - pad * 2;
        const rad = 8;
        ctx.beginPath();
        ctx.moveTo(pad + rad, pad);
        ctx.lineTo(pad + w - rad, pad);
        ctx.quadraticCurveTo(pad + w, pad, pad + w, pad + rad);
        ctx.lineTo(pad + w, pad + w - rad);
        ctx.quadraticCurveTo(pad + w, pad + w, pad + w - rad, pad + w);
        ctx.lineTo(pad + rad, pad + w);
        ctx.quadraticCurveTo(pad, pad + w, pad, pad + w - rad);
        ctx.lineTo(pad, pad + rad);
        ctx.quadraticCurveTo(pad, pad, pad + rad, pad);
        ctx.closePath();

        ctx.shadowColor = "rgba(0,0,0,0.65)";
        ctx.shadowBlur = 4;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(half, half, 9.5, 0, Math.PI * 2);
        ctx.fillStyle = "#0F172A";
        ctx.fill();

        ctx.fillStyle = "#FACC15";
        ctx.font = "900 13px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("P", half, half + 0.8);
        ctx.restore();

        map.addImage(id, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
    });

    // 📷 Smart kamera / PTZ nöqtələri üçün xüsusi Kamera ikonu
    colors.forEach(color => {
        const id = `pt-cam-${color.replace("#", "").toLowerCase()}`;
        if (map.hasImage(id)) map.removeImage(id);
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");

        ctx.save();
        ctx.beginPath();
        ctx.arc(half, half, 15, 0, Math.PI * 2);
        ctx.shadowColor = "rgba(0,0,0,0.65)";
        ctx.shadowBlur = 4;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();

        // Kamera gövdəsi və linza
        ctx.fillStyle = "#0F172A";
        ctx.fillRect(half - 8, half - 5.5, 16, 11.5);
        ctx.fillRect(half - 3.5, half - 8, 7, 3);
        ctx.beginPath();
        ctx.arc(half, half + 0.3, 4.2, 0, Math.PI * 2);
        ctx.strokeStyle = "#38BDF8";
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(half, half + 0.3, 1.6, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.restore();

        map.addImage(id, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
    });

    // 👤 Üztanıma kamerası nöqtələri üçün xüsusi Viewfinder / Face ID ikonu
    colors.forEach(color => {
        const id = `pt-face-${color.replace("#", "").toLowerCase()}`;
        if (map.hasImage(id)) map.removeImage(id);
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");

        ctx.save();
        ctx.beginPath();
        ctx.arc(half, half, 15, 0, Math.PI * 2);
        ctx.shadowColor = "rgba(0,0,0,0.65)";
        ctx.shadowBlur = 4;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(half, half, 10.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        ctx.fill();

        // Baş və çiyin silueti
        ctx.fillStyle = "#F472B6";
        ctx.beginPath();
        ctx.arc(half, half - 2.6, 3.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(half, half + 6.5, 5.8, Math.PI * 1.15, Math.PI * 1.85);
        ctx.fill();
        ctx.restore();

        map.addImage(id, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
    });

    // 🚦 NİİM Svetofor Kəsişmələri üçün 3D effektli, günlüklü (kozeroklu) 3 lampalı svetofor ikonları
    const nimW = 40;
    const nimH = 72;
    const nimConfigs = [
        { key: "layihe", lit: 0, fill: "#EF4444", rim: "#FCA5A5" },
        { key: "icrada", lit: 1, fill: "#FACC15", rim: "#FEF08A" },
        { key: "bitmis", lit: 2, fill: "#22C55E", rim: "#86EFAC" }
    ];
    const drawRoundRect = (g, x, y, w, h, rad) => {
        g.beginPath();
        g.moveTo(x + rad, y);
        g.lineTo(x + w - rad, y);
        g.quadraticCurveTo(x + w, y, x + w, y + rad);
        g.lineTo(x + w, y + h - rad);
        g.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
        g.lineTo(x + rad, y + h);
        g.quadraticCurveTo(x, y + h, x, y + h - rad);
        g.lineTo(x, y + rad);
        g.quadraticCurveTo(x, y, x + rad, y);
        g.closePath();
    };
    nimConfigs.forEach(cfg => {
        const imgId = `nim-tl-${cfg.key}`;
        if (map.hasImage(imgId)) map.removeImage(imgId);
        const c = document.createElement("canvas");
        c.width = nimW;
        c.height = nimH;
        const g = c.getContext("2d");

        const bx = 6, by = 3, bw = 25, bh = 57, br = 7;
        const cx = bx + bw / 2;

        g.save();
        // 1) 3D yan/alt qalınlıq (extrusion) + yer kölgəsi
        g.shadowColor = "rgba(0,0,0,0.7)";
        g.shadowBlur = 5;
        g.shadowOffsetX = 2;
        g.shadowOffsetY = 2;
        g.fillStyle = "#090f1a";
        drawRoundRect(g, bx + 3, by + 2.5, bw, bh, br);
        g.fill();
        g.shadowBlur = 0;
        g.shadowOffsetX = 0;
        g.shadowOffsetY = 0;

        // 2) Ön metal korpus (3D işıq-kölgə qradienti)
        const bodyGrad = g.createLinearGradient(bx, by, bx + bw, by + bh);
        bodyGrad.addColorStop(0, "#475569");
        bodyGrad.addColorStop(0.35, "#283548");
        bodyGrad.addColorStop(1, "#0f172a");
        g.fillStyle = bodyGrad;
        drawRoundRect(g, bx, by, bw, bh, br);
        g.fill();

        // Sol-üst işıqlı metal kənar (bevel)
        g.lineWidth = 1.4;
        g.strokeStyle = "#cbd5e1";
        g.stroke();

        // 3) 3D silindrik dirək (aşağıda)
        const poleGrad = g.createLinearGradient(cx - 2.6, 0, cx + 2.6, 0);
        poleGrad.addColorStop(0, "#475569");
        poleGrad.addColorStop(0.45, "#e2e8f0");
        poleGrad.addColorStop(1, "#334155");
        g.fillStyle = poleGrad;
        g.fillRect(cx - 2.6, by + bh - 1, 5.2, 8);

        // 4) 3 Lampa: sönülü yuvalar neytral tünd boz, yalnız aktiv status lampası təmiz parlaq rəngdə yanır
        const ys = [14.5, 31.5, 48.5];
        ys.forEach((ly, idx) => {
            // Dərin yuva
            g.beginPath();
            g.arc(cx, ly, 7.2, 0, Math.PI * 2);
            g.fillStyle = "#090d14";
            g.fill();

            if (cfg.lit === idx) {
                // Təmiz, dolğun aktiv lampa
                g.beginPath();
                g.arc(cx, ly, 6.5, 0, Math.PI * 2);
                g.fillStyle = cfg.fill;
                g.fill();

                // İncə üst parıltı qövsü (3D şüşə effekti)
                g.beginPath();
                g.arc(cx, ly, 5.1, Math.PI * 1.15, Math.PI * 1.85);
                g.lineWidth = 1.4;
                g.strokeStyle = cfg.rim;
                g.stroke();
            } else {
                // Sönülü lampa (tünd neytral boz — aktiv lampa ilə qarışmasın)
                g.beginPath();
                g.arc(cx, ly, 5.8, 0, Math.PI * 2);
                g.fillStyle = "#2b3340";
                g.fill();
            }

            // Üst günlük / Kozerok (3D forma)
            g.beginPath();
            g.arc(cx, ly + 0.5, 7.6, Math.PI * 1.08, Math.PI * 1.92);
            g.lineWidth = 2.3;
            g.strokeStyle = "#94a3b8";
            g.stroke();
        });
        g.restore();
        map.addImage(imgId, g.getImageData(0, 0, nimW, nimH), { pixelRatio: 2 });
    });

    // A və B başlanğıc/son nöqtələri üçün Qırmızı Sorma Konfet (Lollipop) ikonu: yuxarısı bütöv qırmızı dairə (içi ağ deyil), aşağıya düz xətt
    const pinW = 30;
    const pinH = 44;
    const cx = pinW / 2;
    const cy = 12;
    const pr = 8.2;
    const allPinSpecs = [
        ["pin-standard", "#EF4444"],
        ...colors.map(c => [`pin-${c.replace("#", "").toLowerCase()}`, c])
    ];
    allPinSpecs.forEach(([pinId, color]) => {
        if (map.hasImage(pinId)) map.removeImage(pinId);
        const canvas = document.createElement("canvas");
        canvas.width = pinW;
        canvas.height = pinH;
        const ctx = canvas.getContext("2d");

        ctx.save();
        // 1. Aşağıya düz şaquli xətt (çubuq) — bütöv qırmızı
        ctx.beginPath();
        ctx.moveTo(cx, cy + pr - 1);
        ctx.lineTo(cx, pinH - 2);
        ctx.lineCap = "round";
        ctx.lineWidth = 3.0;
        ctx.strokeStyle = color;
        ctx.stroke();

        // 2. Yuxarı hissədə bütöv qırmızı dairə (içi və haşiyəsi tam qırmızı, heç bir ağ rəng yoxdur)
        ctx.beginPath();
        ctx.arc(cx, cy, pr, 0, Math.PI * 2);
        ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
        ctx.shadowBlur = 3;
        ctx.shadowOffsetY = 1.5;
        ctx.fillStyle = color;
        ctx.fill();

        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = "#B91C1C";
        ctx.stroke();
        ctx.restore();

        map.addImage(pinId, ctx.getImageData(0, 0, pinW, pinH), { pixelRatio: 2 });
    });

    registerPulsingBeacon();
}

function registerPulsingBeacon() {
    if (!map) return;
    const beaconId = "pulsing-beacon-icrada";
    if (map.hasImage(beaconId)) return;
    const size = 96;
    let lastBeaconRepaint = 0;
    let beaconTimer = null;
    const scheduleBeaconTick = () => {
        if (beaconTimer) return;
        beaconTimer = setTimeout(() => {
            beaconTimer = null;
            if (!document.hidden && map && !map.isMoving()) {
                map.triggerRepaint();
            }
        }, 140);
    };
    const pulsingDot = {
        width: size,
        height: size,
        data: new Uint8Array(size * size * 4),
        onAdd: function() {
            const canvas = document.createElement("canvas");
            canvas.width = this.width;
            canvas.height = this.height;
            this.context = canvas.getContext("2d", { willReadFrequently: true });
        },
        render: function() {
            // Arxa fonda və ya xəritə sürüşdürülərkən GPU-nu bloklama
            if (document.hidden) return false;
            if (map && map.isMoving()) return false;

            const now = performance.now();
            if (now - lastBeaconRepaint < 130) {
                scheduleBeaconTick();
                return false;
            }
            lastBeaconRepaint = now;

            const duration = 1600;
            const t = (now % duration) / duration;
            const radius = (size / 2) * 0.26;
            const outerRadius = (size / 2) * 0.82 * t + radius;
            const ctx = this.context;
            ctx.clearRect(0, 0, size, size);

            // 1. Genişlənən xarici dalğa halqası
            ctx.beginPath();
            ctx.arc(size / 2, size / 2, outerRadius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(245, 158, 11, ${(1 - t) * 0.60})`;
            ctx.fill();

            // 2. İkinci orta parıltı dalğası
            const midRadius = (size / 2) * 0.50 * t + radius;
            ctx.beginPath();
            ctx.arc(size / 2, size / 2, midRadius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(251, 191, 36, ${(1 - t) * 0.82})`;
            ctx.fill();

            // 3. Mərkəzi parlaq pulsasiya edən işıq halqası
            const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
            ctx.beginPath();
            ctx.arc(size / 2, size / 2, radius + 2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(245, 158, 11, ${0.45 + 0.45 * pulse})`;
            ctx.fill();
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.75 + 0.25 * pulse})`;
            ctx.lineWidth = 2.2;
            ctx.stroke();

            this.data = ctx.getImageData(0, 0, size, size).data;
            scheduleBeaconTick();
            return true;
        }
    };
    try { map.addImage(beaconId, pulsingDot, { pixelRatio: 2 }); } catch {}
}

function mapStyle() {
    const raster = (tiles, tileSize, maxzoom, attribution = "") => ({ type: "raster", tiles, tileSize, maxzoom, attribution });
    const empty = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
    const rasterLayer = id => ({ id, type: "raster", source: id, layout: { visibility: "none" } });
    return {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
            googleSat: raster(["0", "1", "2", "3"].map(s => `https://mt${s}.google.com/vt/lyrs=s&hl=az&x={x}&y={y}&z={z}`), 256, 20, "Peyk &copy; Google"),
            esri: raster(esriTiles("World_Imagery"), 256, 18, "Imagery &copy; Esri, Maxar, Earthstar Geographics"),
            "esri-transport": raster(esriTiles("Reference/World_Transportation"), 256, 18),
            "esri-places": raster(esriTiles("Reference/World_Boundaries_and_Places"), 256, 18),
            osm: raster(["0", "1", "2", "3"].map(s => `https://mt${s}.google.com/vt/lyrs=m&hl=az&x={x}&y={y}&z={z}`), 256, 20, "Xəritə məlumatları &copy; Google"),
            carto: raster(esriTiles("Canvas/World_Dark_Gray_Base"), 256, 18, "Xəritə &copy; Esri"),
            routes: empty,
            "route-labels": empty,
            draw: empty
        },
        layers: [
            { id: "bg", type: "background", paint: { "background-color": "#1c2a30" } },
            rasterLayer("googleSat"), rasterLayer("esri"), rasterLayer("esri-transport"), rasterLayer("esri-places"), rasterLayer("osm"), rasterLayer("carto"),
            /* ALT QAT (Underlay): Poliqon sahələri (məs: Xəzər dənizi), poliqon sərhədləri (rayon sərhədləri) və Digər qovluğunun xətləri — bütün magistral xətlər və nöqtələr bunların üzərinə düşür */
            { id: "routes-poly-fill", type: "fill", source: "routes", filter: ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "polyFilled"], true]],
                paint: {
                    "fill-color": ["coalesce", ["get", "fillColor"], ["get", "color"]],
                    "fill-opacity": ["case", ["get", "dim"], 0.14, ["coalesce", ["get", "fillOpacity"], 0.48]]
                } },
            { id: "routes-poly-casing", type: "line", source: "routes", filter: ["has", "isPolygon"], layout: { "line-cap": "round", "line-join": "round" },
                paint: {
                    "line-color": "#ffffff",
                    "line-width": ["+", ["coalesce", ["get", "lineWidth"], 1.3], 1.2],
                    "line-opacity": ["case", ["get", "sel"], 0.95, 0]
                } },
            { id: "routes-poly-line", type: "line", source: "routes", filter: ["has", "isPolygon"], layout: { "line-cap": "round", "line-join": "round" },
                paint: {
                    "line-color": ["get", "color"],
                    "line-width": ["case", ["get", "sel"], ["+", ["coalesce", ["get", "lineWidth"], 1.3], 0.8], ["coalesce", ["get", "lineWidth"], 1.3]],
                    "line-opacity": ["case", ["get", "dim"], 0.22, 0.82]
                } },
            { id: "routes-other", type: "line", source: "routes", filter: ["all", ["==", ["geometry-type"], "LineString"], ["has", "isOther"], ["!", ["has", "isPolygon"]]], layout: { "line-cap": "round", "line-join": "round" },
                paint: {
                    "line-color": ["get", "color"],
                    "line-width": ["case", ["get", "sel"], ["+", ["coalesce", ["get", "lineWidth"], 1.3], 0.8], ["coalesce", ["get", "lineWidth"], 1.3]],
                    "line-opacity": ["case", ["get", "dim"], 0.25, 0.88]
                } },
            /* Alt qatın mərkəz adları (Rayon adları və Digər qovluğunun mərkəz yazıları — sakit, gözə çarpmayan üslubda): sabit 10 km ölçüsü, üst-üstə düşmür */
            { id: "routes-poly-label", type: "symbol", source: "route-labels", minzoom: 3.5, filter: ["has", "subtleCenterImg"],
                layout: {
                    "icon-image": ["get", "subtleCenterImg"],
                    "icon-anchor": "center",
                    "icon-size": 0.80,
                    "icon-padding": 8,
                    "icon-allow-overlap": false,
                    "icon-ignore-placement": false
                },
                paint: {
                    "icon-opacity": ["case", ["get", "dim"], 0.22, 0.82]
                } },
            /* ƏSAS ÜST QAT: Magistral kabellər, FO nişanları, Konum (A/B) ikonları və Layihə nöqtələri */
            /* Kənarlarında heç bir qara xətt yoxdur: yalnız seçildikdə zərif ağ kontur saçır, normal halda 0 */
            { id: "routes-casing", type: "line", source: "routes", filter: ["all", ["==", ["geometry-type"], "LineString"], ["!", ["has", "isOther"]], ["!", ["has", "isPolygon"]]], layout: { "line-cap": "round", "line-join": "round" },
                paint: {
                    "line-color": "#ffffff",
                    "line-width": ["interpolate", ["linear"], ["zoom"], 5, 2.8, 14, 3.8],
                    "line-opacity": ["case", ["get", "sel"], 0.95, 0]
                } },
            /* Xətt özü bütöv rənglidir — qalınlığı azaldılmış, xəritədə az yer tutan zərif xətt */
            { id: "routes-line", type: "line", source: "routes", filter: ["all", ["==", ["geometry-type"], "LineString"], ["!", ["has", "isOther"]], ["!", ["has", "isPolygon"]]], layout: { "line-cap": "round", "line-join": "round" },
                paint: {
                    "line-color": ["get", "color"],
                    "line-width": ["interpolate", ["linear"], ["zoom"], 5, ["case", ["get", "sel"], 2.6, 1.5], 11, ["case", ["get", "sel"], 3.0, 1.8], 15, ["case", ["get", "sel"], 3.6, 2.2]],
                    "line-opacity": ["case", ["get", "dim"], 0.25, 1]
                } },
            { id: "routes-hit", type: "line", source: "routes", filter: ["all", ["==", ["geometry-type"], "LineString"], ["!", ["has", "isPolygon"]]], paint: { "line-color": "#000", "line-width": 14, "line-opacity": 0 } },
            /* Digər (RM və köməkçi xətlər): adları xətt boyu çıxır, sabit ölçü, toqquşma yoxdur */
            { id: "routes-other-line", type: "symbol", source: "routes", minzoom: 3.5, filter: ["all", ["==", ["geometry-type"], "LineString"], ["has", "otherLineImg"]],
                layout: {
                    "symbol-placement": "line",
                    "symbol-spacing": 380,
                    "icon-image": ["get", "otherLineImg"],
                    "icon-rotation-alignment": "map",
                    "icon-keep-upright": true,
                    "icon-size": 0.80,
                    "icon-allow-overlap": false,
                    "icon-ignore-placement": false
                },
                paint: {
                    "icon-opacity": ["case", ["get", "dim"], 0.28, 1]
                } },
            { id: "routes-other-points", type: "symbol", source: "route-labels", minzoom: 3.5, filter: ["has", "otherPointImg"],
                layout: {
                    "icon-image": ["get", "otherPointImg"],
                    "icon-rotate": ["get", "iconRotate"],
                    "icon-rotation-alignment": "map",
                    "icon-size": 0.80,
                    "icon-padding": 12,
                    "icon-allow-overlap": false,
                    "icon-ignore-placement": false
                },
                paint: {
                    "icon-opacity": ["case", ["get", "dim"], 0.28, 1]
                } },
            /* Kabel üzərində lif sayı (FO 48, FO 24, FO 12): sabit 10 km ölçüsü (0.80), üst-üstə girmir */
            { id: "routes-fo-points", type: "symbol", source: "route-labels", minzoom: 3.5, filter: ["has", "foPointImg"],
                layout: {
                    "icon-image": ["get", "foPointImg"],
                    "icon-rotate": ["get", "iconRotate"],
                    "icon-rotation-alignment": "map",
                    "icon-keep-upright": true,
                    "icon-offset": [0, -6],
                    "icon-size": 0.80,
                    "icon-padding": 12,
                    "icon-allow-overlap": false,
                    "icon-ignore-placement": false
                },
                paint: {
                    "icon-opacity": ["case", ["get", "dim"], 0.28, 1]
                } },
            /* A və B nöqtələri: Bütöv Qırmızı Sorma Konfet (Lollipop) ikonu */
            { id: "routes-ends", type: "symbol", source: "routes", minzoom: 3.5, filter: ["all", ["==", ["geometry-type"], "Point"], ["!", ["has", "isRayonPoint"]], ["has", "pinIcon"]],
                layout: {
                    "icon-image": ["get", "pinIcon"],
                    "icon-anchor": "bottom",
                    "icon-size": 0.68,
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": true
                },
                paint: {
                    "icon-opacity": ["case", ["get", "dim"], 0.28, 1]
                } },
            /* İcrada olan layihə nöqtələri üçün yanıb-sönən işıq / radar mayakı (bütün miqyaslarda fərqlənir) */
            { id: "routes-point-pulse", type: "symbol", source: "routes", minzoom: 3, maxzoom: 10.2, filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "isRayonPoint"], ["==", ["get", "isIcrada"], true], ["!", ["has", "splitOnly"]]],
                layout: {
                    "icon-image": "pulsing-beacon-icrada",
                    "icon-size": ["interpolate", ["linear"], ["zoom"], 4, 0.45, 8, 0.70, 10, 0.90],
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": true
                },
                paint: {
                    "icon-opacity": ["case", ["get", "dim"], 0.28, 1]
                } },
            { id: "routes-point-pulse-split", type: "symbol", source: "routes", minzoom: 10.2, filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "isRayonPoint"], ["==", ["get", "isIcrada"], true], ["!", ["has", "mergedOnly"]]],
                layout: {
                    "icon-image": "pulsing-beacon-icrada",
                    "icon-size": ["interpolate", ["linear"], ["zoom"], 10.2, 0.90, 14, 1.25],
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": true
                },
                paint: {
                    "icon-opacity": ["case", ["get", "dim"], 0.28, 1]
                } },
            /* Layihə nöqtələri: əvvəlki vəziyyət, bir az yığcam ölçüdə */
            { id: "routes-point-halo", type: "circle", source: "routes", minzoom: 3, maxzoom: 10.2, filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "isRayonPoint"], ["!", ["has", "splitOnly"]]],
                paint: {
                    "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, ["case", ["get", "sel"], 7.5, 5.5], 8, ["case", ["get", "sel"], 11, 8]],
                    "circle-color": ["get", "color"],
                    "circle-opacity": ["case", ["get", "dim"], 0.12, ["case", ["get", "sel"], 0.38, 0.22]],
                    "circle-stroke-color": ["case", ["get", "sel"], "#ffffff", ["get", "color"]],
                    "circle-stroke-width": ["case", ["get", "sel"], 2.0, 1.2],
                    "circle-stroke-opacity": ["case", ["get", "dim"], 0.25, 0.85]
                } },
            { id: "routes-point-shape", type: "symbol", source: "routes", minzoom: 3, maxzoom: 10.2, filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "isRayonPoint"], ["!", ["has", "splitOnly"]]],
                layout: {
                    "icon-image": ["get", "shapeIcon"],
                    "icon-size": ["interpolate", ["linear"], ["zoom"], 4, ["case", ["get", "sel"], 0.65, 0.50], 8, ["case", ["get", "sel"], 0.86, 0.70]],
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": true
                },
                paint: {
                    "icon-opacity": ["case", ["get", "dim"], 0.28, 1]
                } },
            /* Yaxınlaşanda (zoom >= 10.2) eyni rayondakı nöqtələr bir-birindən ayrılır */
            { id: "routes-point-halo-split", type: "circle", source: "routes", minzoom: 10.2, filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "isRayonPoint"], ["!", ["has", "mergedOnly"]]],
                paint: {
                    "circle-radius": ["case", ["get", "sel"], 11.5, 8.8],
                    "circle-color": ["get", "color"],
                    "circle-opacity": ["case", ["get", "dim"], 0.12, ["case", ["get", "sel"], 0.38, 0.22]],
                    "circle-stroke-color": ["case", ["get", "sel"], "#ffffff", ["get", "color"]],
                    "circle-stroke-width": ["case", ["get", "sel"], 2.0, 1.2],
                    "circle-stroke-opacity": ["case", ["get", "dim"], 0.25, 0.85]
                } },
            { id: "routes-point-shape-split", type: "symbol", source: "routes", minzoom: 10.2, filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "isRayonPoint"], ["!", ["has", "mergedOnly"]]],
                layout: {
                    "icon-image": ["get", "shapeIcon"],
                    "icon-size": ["interpolate", ["linear"], ["zoom"], 10.2, ["case", ["get", "sel"], 0.90, 0.74], 14, ["case", ["get", "sel"], 1.04, 0.85]],
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": true
                },
                paint: {
                    "icon-opacity": ["case", ["get", "dim"], 0.28, 1]
                } },
            /* A və B nöqtə adları: sabit 10 km ölçüsü (0.80), icon-allow-overlap: false ilə bir-birinin içinə girmir */
            { id: "routes-ends-label", type: "symbol", source: "route-labels", minzoom: 3.5, filter: ["has", "endLabelImg"],
                layout: {
                    "icon-image": ["get", "endLabelImg"],
                    "icon-anchor": "bottom",
                    "icon-offset": ["get", "endOffset"],
                    "icon-size": 0.80,
                    "icon-padding": 8,
                    "icon-allow-overlap": false,
                    "icon-ignore-placement": false
                },
                paint: {
                    "icon-opacity": ["case", ["get", "dim"], 0.28, 1]
                } },
            /* Nöqtə adları brauzer şrifti ilə: sabit 10 km ölçüsü (0.80), üst-üstə düşmür */
            { id: "routes-point-name", type: "symbol", source: "route-labels", minzoom: 4.5, maxzoom: 9.6, filter: ["has", "nameImg"],
                layout: {
                    "icon-image": ["get", "nameImg"],
                    "icon-anchor": "top",
                    "icon-offset": [0, 11],
                    "icon-size": 0.80,
                    "icon-padding": 6,
                    "icon-allow-overlap": false,
                    "icon-ignore-placement": false
                },
                paint: { "icon-opacity": ["case", ["get", "dim"], 0.28, 1] } },
            { id: "routes-point-label", type: "symbol", source: "route-labels", minzoom: 9.6, maxzoom: 11, filter: ["has", "labelImg"],
                layout: {
                    "icon-image": ["get", "labelImg"],
                    "icon-anchor": ["coalesce", ["get", "lblAnchor"], "top"],
                    "icon-offset": ["coalesce", ["get", "lblOffset"], ["literal", [0, 12]]],
                    "icon-size": 0.80,
                    "icon-padding": 3,
                    "icon-allow-overlap": false,
                    "icon-ignore-placement": false
                },
                paint: { "icon-opacity": ["case", ["get", "dim"], 0.28, 1] } },
            { id: "routes-point-label-near", type: "symbol", source: "route-labels", minzoom: 11, filter: ["has", "labelImg"],
                layout: {
                    "icon-image": ["get", "labelImg"],
                    "icon-anchor": ["coalesce", ["get", "lblAnchor"], "top"],
                    "icon-offset": ["coalesce", ["get", "lblOffset"], ["literal", [0, 12]]],
                    "icon-size": 0.80,
                    "icon-padding": 2,
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": false
                },
                paint: { "icon-opacity": ["case", ["get", "dim"], 0.28, 1] } },
            /* Rayon xülasəsi:
               1) Ümumi Azərbaycan görünüşü (zoom < 8.0): heç bir status pəncərəsi yoxdur, yalnız nöqtələr və rayon adları görünür
               2) Yaxınlaşanda (8.0 <= zoom < 10.2): eyni rayondakı layihələr bir pəncərədə açılır
               3) Daha yaxın miqyasda (zoom >= 10.2): ayrı-ayrı rayon pəncərələri açılır */
            { id: "routes-summary-name", type: "symbol", source: "route-labels", minzoom: 3.5, maxzoom: 8.0, filter: ["has", "summaryNameImg"],
                layout: {
                    "icon-image": ["get", "summaryNameImg"],
                    "icon-anchor": ["get", "nameAnchor"],
                    "icon-offset": ["get", "nameOffset"],
                    "icon-size": ["interpolate", ["linear"], ["zoom"], 5.0, 0.72, 7.0, 0.82, 8.0, (isPhone() ? 0.90 : 0.85)],
                    "icon-padding": 3,
                    "icon-allow-overlap": false,
                    "icon-ignore-placement": false
                },
                paint: { "icon-opacity": ["case", ["get", "dim"], 0.28, 1] } },
            { id: "routes-summary-card-merged", type: "symbol", source: "route-labels", minzoom: 8.0, maxzoom: 10.2, filter: ["has", "mergedCardImg"],
                layout: {
                    "icon-image": ["get", "mergedCardImg"],
                    "icon-anchor": ["get", "cardAnchor"],
                    "icon-offset": ["get", "cardOffset"],
                    "icon-size": ["interpolate", ["linear"], ["zoom"], 8.0, 0.58, 9.2, 0.68, 10.2, (isPhone() ? 0.88 : 0.76)],
                    "icon-padding": 2,
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": true
                },
                paint: { "icon-opacity": ["case", ["get", "dim"], 0.28, 1] } },
            { id: "routes-summary-card", type: "symbol", source: "route-labels", minzoom: 10.2, filter: ["has", "summaryCardImg"],
                layout: {
                    "icon-image": ["get", "summaryCardImg"],
                    "icon-anchor": ["get", "cardAnchor"],
                    "icon-offset": ["get", "cardOffset"],
                    "icon-size": isPhone() ? 0.90 : 0.78,
                    "icon-padding": 2,
                    "icon-allow-overlap": true,
                    "icon-ignore-placement": true
                },
                paint: { "icon-opacity": ["case", ["get", "dim"], 0.28, 1] } },
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
        // Hardware double-buffering aktiv olsun (GPU və RAM yükünü kəskin azaldır, donmanı aradan qaldırır)
        preserveDrawingBuffer: false
    });
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110 }), "bottom-right");
    routePopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "map-tip", offset: 12, maxWidth: "300px" });

    map.on("load", () => {
        registerPointShapeImages();
        switchBaseLayer("satellite");
        tools.init();
    });
    map.on("click", onMapClick);
    map.on("dblclick", onMapDblClick);
    map.on("rotate", () => {
        $("northIcon").style.transform = `rotate(${-45 - map.getBearing()}deg)`;
    });

    const HOVER_LAYERS = ["routes-poly-fill", "routes-poly-line", "routes-other", "routes-hit", "routes-other-line", "routes-other-points", "routes-fo-points", "routes-ends", "routes-ends-label", "routes-point-pulse", "routes-point-halo", "routes-point-shape", "routes-point-pulse-split", "routes-point-halo-split", "routes-point-shape-split", "routes-point-name", "routes-point-label", "routes-point-label-near", "routes-summary-name", "routes-summary-card-merged", "routes-summary-card"];
    let lastHoverCheck = 0;
    let lastCoordUpdate = 0;
    const cursorCoordsEl = $("cursorCoords");
    map.on("mousemove", e => {
        const now = performance.now();
        if (cursorCoordsEl && now - lastCoordUpdate > 60) {
            lastCoordUpdate = now;
            cursorCoordsEl.textContent = `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`;
        }
        if (map.isMoving() || tools.isActive() || now - lastHoverCheck < 90) return;
        lastHoverCheck = now;
        const activeLayers = HOVER_LAYERS.filter(id => map.getLayer(id));
        if (!activeLayers.length) return;
        const hits = map.queryRenderedFeatures(e.point, { layers: activeLayers });
        const hit = hits.length > 0;
        if (window.routeHover !== hit) {
            window.routeHover = hit;
            map.getCanvas().style.cursor = hit ? "pointer" : "";
            if (!hit && routePopup) routePopup.remove();
        }
    });

    initMouseGestures();
}

const MAP_PADDING = { top: 24, left: 24, right: 60, bottom: 24 };

function toLngLatBounds(latLngPairs) {
    const valid = (latLngPairs || []).filter(p => Array.isArray(p) && p.length === 2);
    if (valid.length === 1) {
        const [lat, lng] = valid[0];
        return new maplibregl.LngLatBounds([lng - 0.015, lat - 0.015], [lng + 0.015, lat + 0.015]);
    }
    return valid.reduce((b, [lat, lng]) => b.extend([lng, lat]), new maplibregl.LngLatBounds());
}

function fitHome(animate = true) {
    map.fitBounds(toLngLatBounds(AZERBAIJAN_BOUNDS), { padding: MAP_PADDING, animate, bearing: 0, pitch: 0 });
}

function flyToCoords(coords) {
    if (!coords || coords.length === 0 || !map) return;
    const valid = coords.filter(p => Array.isArray(p) && p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1]));
    if (valid.length === 0) return;
    map.fitBounds(toLngLatBounds(valid), {
        padding: { top: 65, left: 65, right: 90, bottom: 65 },
        maxZoom: 18,
        duration: 850
    });
}

function switchBaseLayer(name) {
    const base = BASE_MAPS[name];
    currentBase = name;
    ["googleSat", "esri", "osm", "carto"].forEach(id => map.setLayoutProperty(id, "visibility", id === base.raster ? "visible" : "none"));
    map.setPaintProperty("bg", "background-color", base.bg);

    applyNames();
    renderLayerOptions();
    drawRoutes();
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

/* WebGL PBF şriftlər yalnız BMP (<= 0xFFFF) simvolları dəstəkləyir; emojiləri silirik ki 404 PBF xətası olmasın */
const cleanGlText = str => String(str || "").replace(/[\uD800-\uDFFF]/g, "").trim();

/* Nöqtə yazıları brauzer şrifti ilə canvas-da çəkilib xəritəyə şəkil kimi verilir.
   Beləliklə ə, ş, ç, ğ, ı, ö, ü hərfləri itmir və yazı xəritə qatına uyğun rəngdə olur. */
const LABEL_FONT = '"Inter", "Segoe UI", Arial, sans-serif';
function isLightBaseMap() {
    return currentBase === "street" || currentBase === "blank";
}

function ensureLabelImage(text) {
    if (!map || !text) return null;
    const light = isLightBaseMap();
    const key = `lbl_v2:${light ? "l" : "d"}:${text}`;
    if (map.hasImage(key)) return key;

    const lines = String(text).split("\n");
    const sizes = lines.map((_, i) => (i === 0 ? 13.5 : 12));
    const weights = lines.map((_, i) => (i === 0 ? 700 : 600));
    const lineH = s => Math.round(s * 1.32);
    const ratio = 2;
    const pad = 4;
    const measure = document.createElement("canvas").getContext("2d");
    let textW = 0;
    lines.forEach((ln, i) => {
        measure.font = `${weights[i]} ${sizes[i]}px ${LABEL_FONT}`;
        textW = Math.max(textW, measure.measureText(ln).width);
    });
    const W = Math.ceil(textW + pad * 2);
    const H = Math.ceil(lines.reduce((s, _, i) => s + lineH(sizes[i]), 0) + pad * 2);

    const canvas = document.createElement("canvas");
    canvas.width = W * ratio;
    canvas.height = H * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineJoin = "round";

    const mainColor = light ? "#090D16" : "#FFFFFF";
    const subColor = light ? "#1E293B" : "#E2E8F0";
    const haloColor = light ? "rgba(255, 255, 255, 0.98)" : "rgba(3, 7, 18, 0.96)";
    let y = pad;
    lines.forEach((ln, i) => {
        ctx.font = `${weights[i]} ${sizes[i]}px ${LABEL_FONT}`;
        ctx.lineWidth = 3.6;
        ctx.strokeStyle = haloColor;
        ctx.strokeText(ln, W / 2, y);
        ctx.fillStyle = i === 0 ? mainColor : subColor;
        ctx.fillText(ln, W / 2, y);
        y += lineH(sizes[i]);
    });
    map.addImage(key, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: ratio });
    return key;
}

/* Rayon xülasə nöqtəsi — uzaqdan baxışda rayon adı (yalnız status rəngində, status sözü olmadan) */
function ensureSummaryNameImage(text, color) {
    if (!map || !text) return null;
    const displayText = String(text).trim();
    const light = isLightBaseMap();
    const key = `sumname_v3:${light ? "l" : "d"}:${color}:${displayText}`;
    if (map.hasImage(key)) return key;
    const ratio = 2;
    const fontSize = 12.5;
    const pad = 4;
    const measure = document.createElement("canvas").getContext("2d");
    measure.font = `800 ${fontSize}px ${LABEL_FONT}`;
    const W = Math.ceil(measure.measureText(displayText).width + pad * 2);
    const H = Math.ceil(fontSize * 1.3 + pad * 2);
    const canvas = document.createElement("canvas");
    canvas.width = W * ratio;
    canvas.height = H * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.font = `800 ${fontSize}px ${LABEL_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3.6;
    ctx.strokeStyle = light ? "rgba(255,255,255,0.98)" : "rgba(3,7,18,0.95)";
    ctx.strokeText(displayText, W / 2, H / 2 + 0.5);
    ctx.fillStyle = color;
    ctx.fillText(displayText, W / 2, H / 2 + 0.5);
    map.addImage(key, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: ratio });
    return key;
}

/* Rayon xülasə kartı (tək layihə və ya yaxınlaşanda ayrılmış pəncərə): məsafə metr (m) ilə göstərilir */
function ensureSummaryCardImage({ name, color, shapeSymbol, folderName, antennas, pointType, doneM, totalM, pct, contractor }) {
    if (!map || !name) return null;
    const light = isLightBaseMap();
    const folder = folderName || "";
    const sym = shapeSymbol || "";
    const antLabel = formatPointAntLabel(antennas, pointType);
    const key = `sumcard_v9:${light ? "l" : "d"}:${color}:${sym}:${name}:${folder}:${antLabel}:${doneM}:${totalM}:${pct}:${contractor}`;
    if (map.hasImage(key)) return key;

    const ratio = 2;
    const padX = 7;
    const padY = 4;
    const stripe = 3.5;
    const fFolder = `700 9.5px ${LABEL_FONT}`;
    const fTitle = `800 11.5px ${LABEL_FONT}`;
    const fBody = `600 10.5px ${LABEL_FONT}`;
    const fSmall = `600 9px ${LABEL_FONT}`;
    const bodyText = `${antLabel} - ${totalM} / ${doneM} m`;
    const folderText = folder ? `${sym ? sym + " " : ""}${String(folder).trim()}` : "";
    const contractorText = contractor ? `👷 ${contractor}` : "";

    const m = document.createElement("canvas").getContext("2d");
    m.font = fTitle; const titleW = m.measureText(name).width;
    m.font = fBody; const bodyW = m.measureText(bodyText).width;
    m.font = fFolder; const folderW = folderText ? m.measureText(folderText).width : 0;
    m.font = fSmall; const pctW = m.measureText("100%").width; const cW = contractorText ? m.measureText(contractorText).width : 0;
    const innerW = Math.max(titleW, bodyW, folderW, cW, 92);
    const W = Math.ceil(stripe + padX * 2 + innerW);
    const rows = (folderText ? [11] : []).concat([14, 13, 10]).concat(contractorText ? [11] : []);
    const H = Math.ceil(padY * 2 + rows.reduce((a, b) => a + b, 0));

    const canvas = document.createElement("canvas");
    canvas.width = W * ratio;
    canvas.height = H * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);

    const r = 5;
    ctx.beginPath();
    ctx.moveTo(r, 0); ctx.lineTo(W - r, 0); ctx.quadraticCurveTo(W, 0, W, r);
    ctx.lineTo(W, H - r); ctx.quadraticCurveTo(W, H, W - r, H);
    ctx.lineTo(r, H); ctx.quadraticCurveTo(0, H, 0, H - r);
    ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fillStyle = light ? "rgba(255,255,255,0.96)" : "rgba(11,18,32,0.95)";
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = light ? "rgba(15,23,42,0.18)" : "rgba(226,232,240,0.45)";
    ctx.stroke();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, stripe, H);
    ctx.restore();

    const x0 = stripe + padX;
    const mainColor = light ? "#0F172A" : "#F8FAFC";
    const subColor = light ? "#475569" : "#CBD5E1";
    const folderColor = light ? "#334155" : "#E2E8F0";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    let y = padY;
    let rIdx = 0;

    if (folderText) {
        ctx.font = fFolder;
        ctx.fillStyle = folderColor;
        ctx.fillText(folderText, x0, y + rows[rIdx] / 2);
        y += rows[rIdx];
        rIdx++;
    }

    ctx.font = fTitle;
    ctx.fillStyle = color;
    ctx.fillText(name, x0, y + rows[rIdx] / 2);
    y += rows[rIdx];
    rIdx++;

    ctx.font = fBody;
    ctx.fillStyle = mainColor;
    ctx.fillText(bodyText, x0, y + rows[rIdx] / 2);
    y += rows[rIdx];
    rIdx++;

    const barW = innerW - pctW - 5;
    const barH = 4;
    const barY = y + (rows[rIdx] - barH) / 2;
    ctx.fillStyle = light ? "rgba(15,23,42,0.12)" : "rgba(255,255,255,0.18)";
    ctx.fillRect(x0, barY, barW, barH);
    ctx.fillStyle = color;
    ctx.fillRect(x0, barY, Math.max(0, Math.min(1, pct / 100)) * barW, barH);
    ctx.font = fSmall;
    ctx.fillStyle = mainColor;
    ctx.textAlign = "right";
    ctx.fillText(`${pct}%`, x0 + innerW, y + rows[rIdx] / 2);
    ctx.textAlign = "left";
    y += rows[rIdx];
    rIdx++;

    if (contractorText) {
        ctx.font = fSmall;
        ctx.fillStyle = subColor;
        ctx.fillText(contractorText, x0, y + rows[rIdx] / 2);
    }

    map.addImage(key, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: ratio });
    return key;
}

/* PMO D2 Rayon Xülasə Kartı: Ümumi faiz, BCG və Avicom ayrı-ayrı, Qoşulma tipləri */
function ensurePmoRayonCardImage({ name, color, shapeSymbol, folderName, pmoRayon }) {
    if (!map || !name || !pmoRayon) return null;
    const light = isLightBaseMap();
    const sym = shapeSymbol || "●";
    const pct = Math.max(0, Math.min(100, Math.round(Number(pmoRayon.pct) || 0)));
    const tm = pmoRayon.temirMeta;
    const isTemirCard = Boolean(tm?.isTemirRm || /t[əe]mir[\s\-]*b[əe]rpa/i.test(String(folderName || "")));
    let seedTm = null;
    if (isTemirCard && (!tm || tm.regLead === "—" || !tm.rayonBreakdown?.length) && Array.isArray(window.PMO_SEED_PROJECTS)) {
        const seedP = window.PMO_SEED_PROJECTS.find(p => p.sheetId === "15.3");
        const normCardRm = s => String(s || "").toLocaleLowerCase("az").replace(/[^a-z0-9əıöüçşğ]/gi, "");
        const rk = normCardRm(name);
        const seedIt = seedP?.items?.find(it => normCardRm(it.name) === rk);
        seedTm = seedIt?.pmoRayon?.temirMeta || null;
        if ((!pmoRayon.subPoints || pmoRayon.subPoints.length === 0) && Array.isArray(seedIt?.pmoRayon?.subPoints)) {
            pmoRayon.subPoints = seedIt.pmoRayon.subPoints;
        }
    }
    const temirTotal = tm?.totalCount || pmoRayon.totalPlan || seedTm?.totalCount || 0;
    const temirDone = tm?.doneCount ?? pmoRayon.totalDone ?? seedTm?.doneCount ?? 0;
    const temirLead = (tm?.regLead && tm.regLead !== "—") ? tm.regLead : (seedTm?.regLead || "—");
    const temirRayonCnt = (Array.isArray(tm?.rayonBreakdown) && tm.rayonBreakdown.length > 0)
        ? tm.rayonBreakdown.length
        : (Array.isArray(seedTm?.rayonBreakdown) ? seedTm.rayonBreakdown.length : (Array.isArray(pmoRayon.subPoints) ? pmoRayon.subPoints.length : 0));
    const bcgLine = isTemirCard
        ? `Nöqtə sayı: ${temirDone} / ${temirTotal}`
        : `BCG: ${pmoRayon.bcgDone}/${pmoRayon.bcgPlan} (${pmoRayon.bcgPct}%)`;
    const aviLine = isTemirCard
        ? `Rəhbər: ${temirLead}`
        : `Avicom: ${pmoRayon.avicomDone}/${pmoRayon.avicomPlan} (${pmoRayon.avicomPct}%)`;
    const c = pmoRayon.conn || {};
    const connParts = [];
    if (Number(c.fo) > 0) connParts.push(`FO:${c.fo}`);
    if (Number(c.g3) > 0) connParts.push(`3G:${c.g3}`);
    if (Number(c.ant) > 0) connParts.push(`Ant:${c.ant}`);
    if (Number(c.gpon) > 0) connParts.push(`GPON:${c.gpon}`);
    const connLine = isTemirCard
        ? (temirRayonCnt > 0 ? `Rayonlar: ${temirRayonCnt} rayon` : "")
        : (connParts.length ? `Qoşulma: ${connParts.join(" · ")}` : "");
    const subCnt = Array.isArray(pmoRayon.subPoints) ? pmoRayon.subPoints.filter(sp => sp.coords).length : 0;
    const hintLine = subCnt > 0 ? (isTemirCard ? `2x klik: ${subCnt} rayona payla` : `2x klik: ${subCnt} nöqtəni parçala`) : "";
    const folderText = folderName ? `${sym} ${String(folderName).trim()}` : "";

    const key = `pmorayon_v2:${light ? "l" : "d"}:${color}:${name}:${folderText}:${pct}:${bcgLine}:${aviLine}:${connLine}:${hintLine}`;
    if (map.hasImage(key)) return key;

    const ratio = 2;
    const padX = 8;
    const padY = 5;
    const stripe = 3.5;
    const fFolder = `700 9.5px ${LABEL_FONT}`;
    const fTitle = `800 11.5px ${LABEL_FONT}`;
    const fBody = `600 9.8px ${LABEL_FONT}`;
    const fSmall = `600 8.8px ${LABEL_FONT}`;

    const m = document.createElement("canvas").getContext("2d");
    m.font = fTitle; const titleW = m.measureText(name).width + 36;
    m.font = fFolder; const folderW = folderText ? m.measureText(folderText).width : 0;
    m.font = fBody; const bW = m.measureText(bcgLine).width; const aW = m.measureText(aviLine).width;
    m.font = fSmall; const cnW = connLine ? m.measureText(connLine).width : 0; const hW = hintLine ? m.measureText(hintLine).width : 0;
    const innerW = Math.max(titleW, folderW, bW, aW, cnW, hW, 118);
    const W = Math.ceil(stripe + padX * 2 + innerW);

    const rows = [];
    if (folderText) rows.push(11);
    rows.push(14);
    rows.push(8);
    rows.push(12);
    rows.push(12);
    if (connLine) rows.push(11);
    if (hintLine) rows.push(11);
    const H = Math.ceil(padY * 2 + rows.reduce((a, b) => a + b, 0));

    const canvas = document.createElement("canvas");
    canvas.width = W * ratio;
    canvas.height = H * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);

    const rad = 5.5;
    ctx.beginPath();
    ctx.moveTo(rad, 0); ctx.lineTo(W - rad, 0); ctx.quadraticCurveTo(W, 0, W, rad);
    ctx.lineTo(W, H - rad); ctx.quadraticCurveTo(W, H, W - rad, H);
    ctx.lineTo(rad, H); ctx.quadraticCurveTo(0, H, 0, H - rad);
    ctx.lineTo(0, rad); ctx.quadraticCurveTo(0, 0, rad, 0);
    ctx.closePath();
    ctx.fillStyle = light ? "rgba(255,255,255,0.97)" : "rgba(11,18,32,0.95)";
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = light ? "rgba(15,23,42,0.20)" : "rgba(56,189,248,0.45)";
    ctx.stroke();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, stripe, H);
    ctx.restore();

    const x0 = stripe + padX;
    const mainColor = light ? "#0F172A" : "#F8FAFC";
    const subColor = light ? "#475569" : "#CBD5E1";
    const folderColor = light ? "#334155" : "#94A3B8";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    let y = padY;
    let rIdx = 0;

    if (folderText) {
        ctx.font = fFolder;
        ctx.fillStyle = folderColor;
        ctx.fillText(folderText, x0, y + rows[rIdx] / 2);
        y += rows[rIdx++];
    }

    ctx.font = fTitle;
    ctx.fillStyle = color;
    ctx.fillText(name, x0, y + rows[rIdx] / 2);
    ctx.textAlign = "right";
    ctx.fillStyle = mainColor;
    ctx.fillText(`${pct}%`, x0 + innerW, y + rows[rIdx] / 2);
    ctx.textAlign = "left";
    y += rows[rIdx++];

    const barH = 3.8;
    const barY = y + (rows[rIdx] - barH) / 2;
    ctx.fillStyle = light ? "rgba(15,23,42,0.12)" : "rgba(255,255,255,0.18)";
    ctx.fillRect(x0, barY, innerW, barH);
    ctx.fillStyle = color;
    ctx.fillRect(x0, barY, Math.max(0, Math.min(1, pct / 100)) * innerW, barH);
    y += rows[rIdx++];

    ctx.font = fBody;
    ctx.fillStyle = light ? "#0369A1" : "#38BDF8";
    ctx.fillText(bcgLine, x0, y + rows[rIdx] / 2);
    y += rows[rIdx++];

    ctx.font = fBody;
    ctx.fillStyle = light ? "#15803D" : "#4ADE80";
    ctx.fillText(aviLine, x0, y + rows[rIdx] / 2);
    y += rows[rIdx++];

    if (connLine) {
        ctx.font = fSmall;
        ctx.fillStyle = subColor;
        ctx.fillText(connLine, x0, y + rows[rIdx] / 2);
        y += rows[rIdx++];
    }
    if (hintLine) {
        ctx.font = fSmall;
        ctx.fillStyle = light ? "#B45309" : "#FBBF24";
        ctx.fillText(hintLine, x0, y + rows[rIdx] / 2);
    }

    map.addImage(key, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: ratio });
    return key;
}

/* Eyni rayonda 2+ nöqtə layihəsi olduqda miqyas kiçiləndə bir pəncərədə qovuşan kart (hər layihənin öz adı və öz məlumatları yerində qalır) */
function ensureMergedSummaryCardImage(rayonName, entries) {
    if (!map || !rayonName || !Array.isArray(entries) || entries.length === 0) return null;
    if (entries.length === 1) {
        const e = entries[0];
        return ensureSummaryCardImage({
            name: rayonName,
            color: e.stColor || e.color,
            shapeSymbol: e.shapeSymbol,
            folderName: e.projTitle || e.folderName,
            antennas: e.antennas,
            pointType: e.pointType,
            doneM: e.doneM,
            totalM: e.planM ?? e.totalM,
            pct: e.pct,
            contractor: e.contractor
        });
    }
    const light = isLightBaseMap();
    const sig = entries.map(e => `${e.shapeSymbol}:${e.projTitle || e.folderName}:${e.stColor || e.color}:${e.antennas}:${e.pointType || ""}:${e.planM ?? e.totalM}:${e.doneM}:${e.pct}:${e.contractor}`).join("|");
    const key = `summerged_v4:${light ? "l" : "d"}:${rayonName}:${sig}`;
    if (map.hasImage(key)) return key;

    const ratio = 2;
    const padX = 8;
    const padY = 5;
    const fHead = `800 11.5px ${LABEL_FONT}`;
    const fProj = `700 9.5px ${LABEL_FONT}`;
    const fBody = `600 10px ${LABEL_FONT}`;
    const fSmall = `600 9px ${LABEL_FONT}`;

    const headText = rayonName;
    const m = document.createElement("canvas").getContext("2d");
    m.font = fHead;
    let maxW = m.measureText(headText).width;
    m.font = fSmall;
    const pctW = m.measureText("100%").width;

    const prepared = entries.map(e => {
        const stColor = e.stColor || e.color || "#38BDF8";
        const titleStr = e.projTitle || e.folderName || "Layihə";
        const planM = e.planM ?? e.totalM ?? 0;
        const antLabel = formatPointAntLabel(e.antennas, e.pointType);
        const projLine = `${e.shapeSymbol || "●"} ${titleStr}`;
        const bodyLine = (e.isPmo && e.pmoRayon)
            ? `BCG: ${e.pmoRayon.bcgDone ?? 0}/${e.pmoRayon.bcgPlan ?? 0} · Avi: ${e.pmoRayon.avicomDone ?? 0}/${e.pmoRayon.avicomPlan ?? 0}`
            : `${antLabel} - ${planM} / ${e.doneM} m`;
        const cLine = (e.isPmo && e.pmoRayon)
            ? `Nöqtə: ${e.pmoRayon.totalDone ?? 0}/${e.pmoRayon.totalPlan ?? 0}`
            : (e.contractor ? `👷 ${e.contractor}` : "");
        m.font = fProj; const pw = m.measureText(projLine).width;
        m.font = fBody; const bw = m.measureText(bodyLine).width;
        m.font = fSmall; const cw = cLine ? m.measureText(cLine).width : 0;
        maxW = Math.max(maxW, pw + 8, bw + 8, cw + 8, 98);
        const blockH = 12 + 12 + 9 + (cLine ? 11 : 0) + 4;
        return { ...e, stColor, projLine, bodyLine, cLine, blockH };
    });

    const W = Math.ceil(padX * 2 + maxW);
    const headH = 16;
    const totalBlocksH = prepared.reduce((s, b) => s + b.blockH, 0) + (prepared.length - 1) * 4;
    const H = Math.ceil(padY * 2 + headH + totalBlocksH);

    const canvas = document.createElement("canvas");
    canvas.width = W * ratio;
    canvas.height = H * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);

    const r = 6;
    ctx.beginPath();
    ctx.moveTo(r, 0); ctx.lineTo(W - r, 0); ctx.quadraticCurveTo(W, 0, W, r);
    ctx.lineTo(W, H - r); ctx.quadraticCurveTo(W, H, W - r, H);
    ctx.lineTo(r, H); ctx.quadraticCurveTo(0, H, 0, H - r);
    ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fillStyle = light ? "rgba(255,255,255,0.96)" : "rgba(10,16,28,0.92)";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = light ? "rgba(15,23,42,0.16)" : "rgba(148,163,184,0.28)";
    ctx.stroke();

    const mainColor = light ? "#0F172A" : "#FFFFFF";
    const subColor = light ? "#475569" : "#94A3B8";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    let y = padY;
    ctx.font = fHead;
    ctx.fillStyle = mainColor;
    ctx.fillText(headText, padX, y + headH / 2 - 1);
    y += headH;

    prepared.forEach((b, idx) => {
        if (idx > 0) {
            ctx.fillStyle = light ? "rgba(15,23,42,0.10)" : "rgba(255,255,255,0.12)";
            ctx.fillRect(padX, y + 1, W - padX * 2, 1);
            y += 4;
        }
        // Sol rəngli status zolağı (hər layihənin öz status rəngi)
        ctx.fillStyle = b.stColor;
        ctx.fillRect(padX, y + 1.5, 3, b.blockH - 4);

        const bx = padX + 7;
        const innerBW = maxW - 7;

        ctx.font = fProj;
        ctx.fillStyle = b.stColor;
        ctx.fillText(b.projLine, bx, y + 6);
        y += 12;

        ctx.font = fBody;
        ctx.fillStyle = mainColor;
        ctx.fillText(b.bodyLine, bx, y + 6);
        y += 12;

        const barW = innerBW - pctW - 5;
        const barH = 3.8;
        const barY = y + 2.5;
        ctx.fillStyle = light ? "rgba(15,23,42,0.12)" : "rgba(255,255,255,0.18)";
        ctx.fillRect(bx, barY, barW, barH);
        ctx.fillStyle = b.stColor;
        ctx.fillRect(bx, barY, Math.max(0, Math.min(1, b.pct / 100)) * barW, barH);

        ctx.font = fSmall;
        ctx.fillStyle = mainColor;
        ctx.textAlign = "right";
        ctx.fillText(`${b.pct}%`, bx + innerBW, y + 4.5);
        ctx.textAlign = "left";
        y += 9;

        if (b.cLine) {
            ctx.font = fSmall;
            ctx.fillStyle = subColor;
            ctx.fillText(b.cLine, bx, y + 5.5);
            y += 11;
        }
        y += 4;
    });

    map.addImage(key, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: ratio });
    return key;
}

/* A və B Konum nöqtələrinin adı: aktiv xəritəyə görə rənglənir (ağ fonda qara mətn, peyk/tünd fonda ağ mətn) */
function ensureEndLabelImage(text) {
    if (!map || !text) return null;
    const light = isLightBaseMap();
    const key = `endlbl_v2:${light ? "l" : "d"}:${text}`;
    if (map.hasImage(key)) return key;

    const ratio = 2;
    const fontSize = 12.5;
    const padX = 5;
    const padY = 3;
    const measure = document.createElement("canvas").getContext("2d");
    measure.font = `700 ${fontSize}px ${LABEL_FONT}`;
    const textW = measure.measureText(text).width;
    const W = Math.ceil(textW + padX * 2 + 2);
    const H = Math.ceil(fontSize + padY * 2 + 2);

    const canvas = document.createElement("canvas");
    canvas.width = W * ratio;
    canvas.height = H * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);

    ctx.font = `700 ${fontSize}px ${LABEL_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";

    ctx.lineWidth = 3.6;
    ctx.strokeStyle = light ? "rgba(255, 255, 255, 0.98)" : "rgba(3, 7, 18, 0.95)";
    ctx.strokeText(text, W / 2, H / 2 + 0.5);

    ctx.fillStyle = light ? "#090D16" : "#FFFFFF";
    ctx.fillText(text, W / 2, H / 2 + 0.5);

    map.addImage(key, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: ratio });
    return key;
}

/* Kabelin üzərində yazılan lif sayı (FO 48, FO 24, FO 12 və s.) — aktiv xəritəyə uyğun (ağ fonda qara, peykdə ağ) oxunaqlı mətn */
function ensureFoBadgeImage(foText) {
    if (!map || !foText) return null;
    const cleanFo = normalizeFiberCount(foText, "");
    if (!cleanFo) return null;
    const light = isLightBaseMap();
    const key = `fo_v2:${light ? "l" : "d"}:${cleanFo}`;
    if (map.hasImage(key)) return key;

    const ratio = 2;
    const fontSize = 11.5;
    const padX = 4;
    const padY = 2.5;
    const measure = document.createElement("canvas").getContext("2d");
    measure.font = `700 ${fontSize}px ${LABEL_FONT}`;
    const textW = measure.measureText(cleanFo).width;
    const W = Math.ceil(textW + padX * 2 + 2);
    const H = Math.ceil(fontSize + padY * 2 + 2);

    const canvas = document.createElement("canvas");
    canvas.width = W * ratio;
    canvas.height = H * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);

    ctx.font = `700 ${fontSize}px ${LABEL_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";

    ctx.lineWidth = 3.4;
    ctx.strokeStyle = light ? "rgba(255, 255, 255, 0.98)" : "rgba(3, 7, 18, 0.95)";
    ctx.strokeText(cleanFo, W / 2, H / 2 + 0.5);

    ctx.fillStyle = light ? "#090D16" : "#FFFFFF";
    ctx.fillText(cleanFo, W / 2, H / 2 + 0.5);

    map.addImage(key, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: ratio });
    return key;
}

/* Lif götürülən kabel üzərində lif sayı əvəzinə "name" hissəsindəki mətni xətt boyu çıxarır */
function ensureLineTextBadgeImage(rawText) {
    if (!map || !rawText) return null;
    const text = cleanGlText(String(rawText).trim());
    if (!text) return null;
    const light = isLightBaseMap();
    const key = `lntxt_v1:${light ? "l" : "d"}:${text}`;
    if (map.hasImage(key)) return key;

    const ratio = 2;
    const fontSize = 11.5;
    const padX = 5;
    const padY = 2.5;
    const measure = document.createElement("canvas").getContext("2d");
    measure.font = `700 ${fontSize}px ${LABEL_FONT}`;
    const textW = measure.measureText(text).width;
    const W = Math.ceil(textW + padX * 2 + 2);
    const H = Math.ceil(fontSize + padY * 2 + 2);

    const canvas = document.createElement("canvas");
    canvas.width = W * ratio;
    canvas.height = H * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);

    ctx.font = `700 ${fontSize}px ${LABEL_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";

    ctx.lineWidth = 3.4;
    ctx.strokeStyle = light ? "rgba(255, 255, 255, 0.98)" : "rgba(3, 7, 18, 0.95)";
    ctx.strokeText(text, W / 2, H / 2 + 0.5);

    ctx.fillStyle = light ? "#090D16" : "#FFFFFF";
    ctx.fillText(text, W / 2, H / 2 + 0.5);

    map.addImage(key, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: ratio });
    return key;
}

/* Digər qovluğundakı RM və köməkçi xətlərin üzərində (xətt boyu) çıxan ad etiketi */
function ensureOtherLineNameImage(text, color = "#38BDF8") {
    if (!map || !text) return null;
    const light = isLightBaseMap();
    const key = `otherln:${light ? "l" : "d"}:${color}:${text}`;
    if (map.hasImage(key)) return key;

    const ratio = 2;
    const fontSize = 11.5;
    const padX = 6;
    const padY = 2.5;
    const measure = document.createElement("canvas").getContext("2d");
    measure.font = `700 ${fontSize}px ${LABEL_FONT}`;
    const textW = measure.measureText(text).width;
    const W = Math.ceil(textW + padX * 2 + 4);
    const H = Math.ceil(fontSize + padY * 2 + 4);

    const canvas = document.createElement("canvas");
    canvas.width = W * ratio;
    canvas.height = H * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);

    ctx.beginPath();
    ctx.roundRect(1.5, 1.5, W - 3, H - 3, 5);
    ctx.fillStyle = light ? "rgba(255, 255, 255, 0.94)" : "rgba(8, 17, 32, 0.88)";
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = color;
    ctx.stroke();

    ctx.font = `700 ${fontSize}px ${LABEL_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = light ? "#090D16" : "#FFFFFF";
    ctx.fillText(text, W / 2, H / 2 + 0.5);

    map.addImage(key, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: ratio });
    return key;
}

/* Poliqon (rayon sərhədləri) və Digər qovluğu üçün mərkəzdə çıxan sakit, gözə çarpmayan ad etiketi */
function ensureSubtleCenterLabelImage(text, color = "#94A3B8") {
    if (!map || !text) return null;
    const light = isLightBaseMap();
    const key = `subcenter_v2:${light ? "l" : "d"}:${color}:${text}`;
    if (map.hasImage(key)) return key;

    const ratio = 2;
    const fontSize = 11.5;
    const padX = 6;
    const padY = 3;
    const measure = document.createElement("canvas").getContext("2d");
    measure.font = `600 ${fontSize}px ${LABEL_FONT}`;
    const textW = measure.measureText(text).width;
    const W = Math.ceil(textW + padX * 2 + 4);
    const H = Math.ceil(fontSize + padY * 2 + 4);

    const canvas = document.createElement("canvas");
    canvas.width = W * ratio;
    canvas.height = H * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);

    ctx.font = `600 ${fontSize}px ${LABEL_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";

    ctx.lineWidth = 2.8;
    ctx.strokeStyle = light ? "rgba(255, 255, 255, 0.85)" : "rgba(6, 12, 22, 0.78)";
    ctx.strokeText(text, W / 2, H / 2 + 0.5);

    ctx.fillStyle = light ? "rgba(15, 23, 42, 0.82)" : "rgba(241, 245, 249, 0.78)";
    ctx.fillText(text, W / 2, H / 2 + 0.5);

    map.addImage(key, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: ratio });
    return key;
}

function computeLineAngleDeg(lng1, lat1, lng2, lat2) {
    const dx = (lng2 - lng1) * Math.cos(((lat1 + lat2) * 0.5 * Math.PI) / 180);
    const dy = lat2 - lat1;
    let deg = Math.atan2(-dy, dx) * (180 / Math.PI);
    if (deg > 90) deg -= 180;
    if (deg < -90) deg += 180;
    return Math.round(deg);
}

/* Xəttin qırılmaları boyunca verilmiş nisbətlərdə (məs: 3-4 yerdə) nöqtə və xətt bucağını çıxarır */
function sampleSegmentsAtFractions(segs, totalLen, fractions) {
    if (!Array.isArray(segs) || segs.length === 0 || totalLen <= 0) return [];
    const pts = [];
    fractions.forEach(f => {
        const target = totalLen * f;
        const seg = segs.find(s => target >= s.start && target <= s.start + s.len) || segs[segs.length - 1];
        const t = seg.len > 0 ? Math.max(0, Math.min(1, (target - seg.start) / seg.len)) : 0.5;
        const lng = seg.x1 + (seg.x2 - seg.x1) * t;
        const lat = seg.y1 + (seg.y2 - seg.y1) * t;
        const angle = computeLineAngleDeg(seg.x1, seg.y1, seg.x2, seg.y2);
        pts.push({ coord: [lng, lat], angle, seg });
    });
    return pts;
}

function isSummaryItem(r) {
    if (!r) return false;
    if (r.summary) return true;
    if ((r.antennas || 0) > 0) return true;
    if (r.totalKm > 0 || r.doneKm > 0) return true;
    const p = r.props || {};
    return Object.keys(p).some(k => /^(kabel_?verilen|kabel_?cekilen|antena|verilen|cekilen|plan|faktiki|m$)/i.test(k.replace(/[\s_\-\.]+/g, "_")));
}

function sliceLineByDistance(lineCoords, doneKm, totalKm) {
    if (!Array.isArray(lineCoords) || lineCoords.length < 2) return [];
    const dKm = Number(doneKm) || 0;
    const tKm = Number(totalKm) || 0;
    if (dKm <= 0) return [];

    let totalMeters = 0;
    const segs = [];
    for (let i = 0; i < lineCoords.length - 1; i++) {
        const p1 = lineCoords[i];
        const p2 = lineCoords[i + 1];
        let segDist = 0;
        try {
            segDist = new maplibregl.LngLat(p1[0], p1[1]).distanceTo(new maplibregl.LngLat(p2[0], p2[1]));
        } catch {
            const dx = (p2[0] - p1[0]) * Math.cos(((p1[1] + p2[1]) * 0.5 * Math.PI) / 180) * 111320;
            const dy = (p2[1] - p1[1]) * 111320;
            segDist = Math.hypot(dx, dy);
        }
        if (segDist > 0) {
            segs.push({ p1, p2, len: segDist, start: totalMeters });
            totalMeters += segDist;
        }
    }
    if (totalMeters <= 0 || segs.length === 0) return lineCoords;

    let targetMeters = totalMeters;
    if (tKm > 0) {
        const fraction = Math.min(1.0, Math.max(0.005, dKm / tKm));
        targetMeters = totalMeters * fraction;
    } else {
        targetMeters = Math.min(totalMeters, dKm * 1000);
    }

    if (targetMeters >= totalMeters - 1) {
        return lineCoords;
    }

    const sliced = [lineCoords[0]];
    for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (targetMeters >= s.start + s.len - 0.5) {
            sliced.push(s.p2);
        } else if (targetMeters > s.start) {
            const ratio = (targetMeters - s.start) / s.len;
            const cutLng = s.p1[0] + (s.p2[0] - s.p1[0]) * ratio;
            const cutLat = s.p1[1] + (s.p2[1] - s.p1[1]) * ratio;
            sliced.push([cutLng, cutLat]);
            break;
        } else {
            break;
        }
    }
    return sliced.length >= 2 ? sliced : [];
}

function drawRoutes() {
    if (!map) return;
    const source = map.getSource("routes");
    const labelSource = map.getSource("route-labels");
    if (!source) {
        map.once("load", drawRoutes);
        return;
    }
    const selected = selectedEntry();
    const activeProjId = selected ? selected.project.id : window.__activeProjectId || null;
    const features = [];
    const labelFeatures = [];
    const pointSlots = {};
    const placedEndPoints = [];
    const placedEndLabels = [];
    const placedFoPoints = [];
    const placedSubPoints = [];
    const SUB_LABEL_SLOTS = [
        { anchor: "top", offset: [0, 12] },
        { anchor: "bottom", offset: [0, -12] },
        { anchor: "left", offset: [13, 0] },
        { anchor: "right", offset: [-13, 0] },
        { anchor: "top-left", offset: [10, 10] },
        { anchor: "bottom-right", offset: [-10, -10] },
        { anchor: "top-right", offset: [-10, 10] },
        { anchor: "bottom-left", offset: [10, -10] }
    ];
    const polygonCenterGroups = {};

    function pushLineEndpoint(coordinates, labelText, color, dim, project, r, tipHtml) {
        if (!Array.isArray(coordinates) || coordinates.length < 2) return;
        const lng = Number(coordinates[0]);
        const lat = Number(coordinates[1]);
        if (isNaN(lng) || isNaN(lat)) return;

        const cleanText = cleanGlText(String(labelText || "").replace(/^[AB]\s*[:.\-–—]\s*/i, "").trim());
        const validLabel = cleanText && !/^(a|b|mərkəz|merkez|şəbəkə|sebeke|-|—)$/i.test(cleanText) ? cleanText : "";
        const nameKey = validLabel ? validLabel.toLocaleLowerCase("az") : "";

        // 1. Qırmızı Sorma Konfet (Lollipop) ikonu: yalnız eyni qovşaqda (< ~250m) təkrar üst-üstə düşməsin
        const pinIcon = "pin-standard";
        const hasNearbyPin = placedEndPoints.some(p => Math.hypot(p.lng - lng, p.lat - lat) < 0.0025);
        if (!hasNearbyPin) {
            placedEndPoints.push({ lng, lat });
            features.push({
                type: "Feature",
                geometry: { type: "Point", coordinates: [lng, lat] },
                properties: {
                    color,
                    dim,
                    pinIcon,
                    projectId: project.id,
                    itemId: r.id,
                    tip: tipHtml
                }
            });
        }

        // 2. Nöqtə adı (A və B məntəqə adı): hətta əvvəlki xətt həmin qovşağa adsız pin qoyubsa belə, adı mütləq göstər!
        if (validLabel) {
            const hasNearbySameLabel = placedEndLabels.some(p =>
                (p.nameKey === nameKey && Math.hypot(p.lng - lng, p.lat - lat) < 0.055)
                || Math.hypot(p.lng - lng, p.lat - lat) < 0.0055
            );
            if (!hasNearbySameLabel) {
                const endLabelImg = ensureEndLabelImage(validLabel);
                if (endLabelImg) {
                    placedEndLabels.push({ lng, lat, nameKey });
                    labelFeatures.push({
                        type: "Feature",
                        geometry: { type: "Point", coordinates: [lng, lat] },
                        properties: {
                            color,
                            dim,
                            endLabelImg,
                            endOffset: [0, -18],
                            projectId: project.id,
                            itemId: r.id,
                            tip: tipHtml
                        }
                    });
                }
            }
        }
    }

    visibleEntries().forEach(({ project, item: r }) => {
        const rawCoords = Array.isArray(r.coords) ? r.coords : [];
        let coords = rawCoords
            .map(c => Array.isArray(c) && c.length >= 2 ? [Number(c[0]), Number(c[1])] : null)
            .filter(c => c && !isNaN(c[0]) && !isNaN(c[1]));
        if (coords.length === 0) return;

        const isOther = project.category === "other";
        const isClosedRing = coords.length >= 4 && Math.hypot(coords[0][0] - coords[coords.length - 1][0], coords[0][1] - coords[coords.length - 1][1]) < 0.003;
        const isPolyItem = Boolean(r.isPolygon || (isOther && isClosedRing));
        const isWaterPoly = isPolyItem && /(x[əe]z[əe]r|caspian|d[əe]niz|g[öo]l|su\s*h[öo]vz|sea|lake|water)/i.test(`${r.name || ""} ${project.name || ""}`);

        const defaultOtherColor = isWaterPoly ? "#0284C7" : (isPolyItem ? "#94A3B8" : "#38BDF8");
        const color = isOther
            ? normalizeColorCode(r.customColor || project.customColor, defaultOtherColor)
            : (r.isMagistral ? statusTone(r.status) : (r.customColor ? normalizeColorCode(r.customColor, statusTone(r.status)) : statusTone(r.status)));
        const customLineWidth = normalizeLineWidth(r.lineWidth || project.lineWidth, isPolyItem ? 1.3 : (isOther ? 1.8 : 0));

        const isSingleCoord = coords.length === 1 || (coords.length === 2 && coords[0][0] === coords[1][0] && coords[0][1] === coords[1][1]);
        const isPointItem = !isPolyItem && !r.isMagistral && (project.type === "points" || isSingleCoord || (r.antennas || 0) > 0);
        const shape = isPointItem ? getItemShape(project, r) : getProjectShape(project);
        const isRpsItem = /rp[şs]/i.test(String(r.name || r.rayon || ""));
        const shapeIcon = isRpsItem
            ? `pt-rps-${statusTone(r.status).replace("#", "").toLowerCase()}`
            : `pt-${shape.id}-${statusTone(r.status).replace("#", "").toLowerCase()}`;
        const dim = Boolean(state.focusMode && activeProjId && project.id !== activeProjId);

        // 1) POLİQON (məs: Xəzər dənizi — içi dolu və ya Rayon sərhədləri — içi boş sərhəd xətti)
        if (isPolyItem && coords.length >= 3) {
            const rawPolyName = String(r.name || "").trim();
            const isGenericPoly = /^(?:idxal\s*x[əe]tti|imported\s*line|x[əe]tt|line|imp|poly|poliqon)[-\s]*\d*$/i.test(rawPolyName);
            const projCleanName = String(project.name || "").replace(/^Digər\s*:\s*/i, "").trim();
            const displayPolyName = (!isGenericPoly && rawPolyName) ? rawPolyName : (projCleanName || rawPolyName);
            const cleanPolyName = cleanGlText(displayPolyName);
            const onlyNameTip = `<b>${esc(displayPolyName)}</b>`;

            const ringCoords = coords.map(([lat, lng]) => [lng, lat]);
            const firstPt = ringCoords[0];
            const lastPt = ringCoords[ringCoords.length - 1];
            if (firstPt[0] !== lastPt[0] || firstPt[1] !== lastPt[1]) {
                ringCoords.push([firstPt[0], firstPt[1]]);
            }

            const polyFilled = r.polyFilled !== undefined
                ? Boolean(r.polyFilled)
                : (project.polyFilled !== undefined ? Boolean(project.polyFilled) : Boolean(isWaterPoly));
            const fillColor = normalizeColorCode(r.fillColor || r.customColor || project.fillColor || project.customColor, color);
            const fillOpacity = Number(r.fillOpacity || project.fillOpacity) > 0
                ? Math.max(0.08, Math.min(0.92, Number(r.fillOpacity || project.fillOpacity)))
                : (isWaterPoly ? 0.52 : 0.45);

            const holeRings = Array.isArray(r.holes)
                ? r.holes.map(h => {
                    const hr = h.map(([lat, lng]) => [lng, lat]);
                    if (hr.length >= 3 && (hr[0][0] !== hr[hr.length - 1][0] || hr[0][1] !== hr[hr.length - 1][1])) {
                        hr.push([hr[0][0], hr[0][1]]);
                    }
                    return hr;
                }).filter(hr => hr.length >= 4)
                : [];

            features.push({
                type: "Feature",
                geometry: polyFilled
                    ? { type: "Polygon", coordinates: [ringCoords, ...holeRings] }
                    : { type: "LineString", coordinates: ringCoords },
                properties: {
                    isPolygon: true,
                    isOther: Boolean(isOther),
                    polyFilled,
                    color,
                    fillColor,
                    fillOpacity,
                    lineWidth: customLineWidth || 1.3,
                    dim,
                    sel: Boolean(selected?.item === r),
                    projectId: project.id,
                    itemId: r.id,
                    tip: onlyNameTip
                }
            });

            if (cleanPolyName) {
                const { center, area } = computePolygonCentroid(coords);
                const grpKey = `${project.id}:${cleanPolyName.toLocaleLowerCase("az")}`;
                if (!polygonCenterGroups[grpKey] || area > polygonCenterGroups[grpKey].area) {
                    polygonCenterGroups[grpKey] = {
                        center,
                        area,
                        cleanName: cleanPolyName,
                        color,
                        dim,
                        projectId: project.id,
                        itemId: r.id,
                        tip: onlyNameTip
                    };
                }
            }
            return;
        }

        // 2) 🗂️ Digər bölməsi (xətlər və nöqtələr — rəng kodu, qalınlıq və mərkəzdə sakit ad ilə)
        if (isOther) {
            const rawOtherName = String(r.name || "").trim();
            const isGenericOther = /^(?:idxal\s*x[əe]tti|imported\s*line|x[əe]tt|line|imp)[-\s]*\d*$/i.test(rawOtherName);
            const projCleanName = String(project.name || "").replace(/^Digər\s*:\s*/i, "").trim();
            const displayOtherName = (!isGenericOther && rawOtherName) ? rawOtherName : (projCleanName || rawOtherName);
            const cleanOtherName = cleanGlText(displayOtherName);
            const onlyNameTip = `<b>${esc(displayOtherName)}</b>`;

            if (isPointItem) {
                const [lat, lng] = coords[0];
                const subtleImg = ensureSubtleCenterLabelImage(cleanOtherName, color);
                const ptProps = {
                    isRayonPoint: true,
                    isOther: true,
                    color,
                    shapeIcon,
                    dim,
                    sel: Boolean(selected?.item === r),
                    projectId: project.id,
                    itemId: r.id,
                    subtleCenterImg: subtleImg,
                    tip: onlyNameTip
                };
                features.push({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: ptProps });
                if (subtleImg) labelFeatures.push({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: ptProps });
            } else {
                const line = coords.map(([lat, lng]) => [lng, lat]);
                features.push({
                    type: "Feature",
                    geometry: { type: "LineString", coordinates: line },
                    properties: {
                        isOther: true,
                        color,
                        lineWidth: customLineWidth || 1.8,
                        dim,
                        sel: Boolean(selected?.item === r),
                        projectId: project.id,
                        itemId: r.id,
                        tip: onlyNameTip
                    }
                });
                if (cleanOtherName) {
                    const segs = [];
                    let totalLen = 0;
                    for (let i = 0; i < line.length - 1; i++) {
                        const [x1, y1] = line[i];
                        const [x2, y2] = line[i + 1];
                        const len = Math.hypot(x2 - x1, y2 - y1);
                        if (len > 0) {
                            segs.push({ x1, y1, x2, y2, len, start: totalLen });
                            totalLen += len;
                        }
                    }
                    const midSample = sampleSegmentsAtFractions(segs, totalLen, [0.5])[0];
                    if (midSample) {
                        const grpKey = `${project.id}:${cleanOtherName.toLocaleLowerCase("az")}`;
                        if (!polygonCenterGroups[grpKey] || totalLen > polygonCenterGroups[grpKey].area) {
                            polygonCenterGroups[grpKey] = {
                                center: midSample.coord,
                                area: totalLen,
                                cleanName: cleanOtherName,
                                color,
                                dim,
                                projectId: project.id,
                                itemId: r.id,
                                tip: onlyNameTip
                            };
                        }
                    }
                }
            }
            return;
        }

        const cInfo = findContractorInfo(r.contractor) || { workers: "—", machinery: "—", engineer: "—" };
        const cExtra = r.contractor ? `👷 İcraçı: <b>${esc(r.contractor)}</b> · 👥 İşçi: <b>${esc(cInfo.workers)} nəfər</b> · 🚜 Texnika: <b>${esc(cInfo.machinery ?? 0)}</b><br>📞 Əlaqə: <b>${esc(cInfo.engineer || "—")}</b>` : "";

        if (project.category === "nim") {
            const [lat, lng] = coords[0];
            const cleanName = String(r.name || "").trim();
            const stText = t(`status${r.status}`);
            const label = `${cleanName}\n${stText}`;
            const tip = `<b>${shape.symbol} 🚦 ${esc(r.name)}</b><small>Layihə: <b>${esc(project.name)}</b><br>Status: <b style="color:${color}">${esc(stText)}</b>${cExtra ? `<br>${cExtra}` : ""}</small>`;
            const nimStKey = (r.status === "bitmis" || r.status === "tehvil") ? "bitmis" : (r.status === "icrada" ? "icrada" : "layihe");
            const nimProps = {
                isRayonPoint: true,
                isNim: true,
                isIcrada: nimStKey === "icrada",
                color: STATUS_COLORS[nimStKey] || color,
                shapeIcon: `nim-tl-${nimStKey}`,
                dim,
                sel: Boolean(selected?.item === r),
                projectId: project.id,
                itemId: r.id,
                label,
                shortLabel: cleanName,
                tip
            };
            features.push({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: nimProps });
            labelFeatures.push({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: nimProps });
            return;
        }

        if (isPointItem) {
            if (!state.expandedRayons) state.expandedRayons = new Set();

            // PMO D2 Rayon Xülasəsi və 2x Kliklə Parçalanan Alt-Nöqtələr (TŞ nömrəsi)
            if (r.isPmoRayon && r.pmoRayon) {
                const isTemirProj = String(project.sheetId || project.pmoMeta?.sheetId || "") === "15.3" || /t[əe]mir[\s\-]*b[əe]rpa/i.test(String(project.name || ""));
                if (isTemirProj && typeof window.findRmPolygonCentroid === "function") {
                    const rmCent = window.findRmPolygonCentroid(r.name);
                    if (Array.isArray(rmCent) && rmCent.length === 2) {
                        r.coords = [rmCent];
                        coords = [rmCent];
                    }
                }
                const pmoClusterKey = getPmoRayonClusterKey(project, r);
                const allSubPtsWithCoords = (r.pmoRayon.subPoints || []).filter(sp => Array.isArray(sp.coords) && sp.coords.length === 2);
                const subPtsWithCoords = hasActiveStatusFilter()
                    ? allSubPtsWithCoords.filter(sp => statusMatchesFilter(sp.status))
                    : allSubPtsWithCoords;
                const isExpandedPmo = (state.expandedRayons.has(pmoClusterKey) || state.expandedRayons.has(`${project.id}::pmo::${r.id}`)) && allSubPtsWithCoords.length > 0;
                const rawProjBase = cleanProjectName(project.name, project.sheetId || project.pmoMeta?.sheetId);
                const compactProjName = rawProjBase.length > 32 ? `${rawProjBase.slice(0, 31).trim()}…` : rawProjBase;

                if (isExpandedPmo) {
                    // PARÇALANMIŞ REJİM: Hər alt-nöqtə öz koordinatında, "A" sütunundakı rəngi və növünə uyğun ikonu ilə çıxır
                    const isMuganliProj = String(project.sheetId || project.pmoMeta?.sheetId || "") === "12" || /mu[ğg]anl[ıi]/i.test(String(project.name || ""));
                    subPtsWithCoords.forEach((sp, spIdx) => {
                        let [spLat, spLng] = sp.coords;
                        if (spLat >= 43.5 && spLng <= 42.5) {
                            [spLat, spLng] = [spLng, spLat];
                        }
                        // Yaxın alt-nöqtələr (məs: Gəncə 2027-də eyni kəsişmədə olan nöqtələr) üst-üstə düşməsin deyə bir az arala və yazı istiqamətini növbələ
                        let nearCount = 0;
                        for (let k = 0; k < placedSubPoints.length; k++) {
                            if (Math.hypot(placedSubPoints[k].lat - spLat, placedSubPoints[k].lng - spLng) < 0.0014) {
                                nearCount++;
                            }
                        }
                        if (nearCount > 0) {
                            const angle = nearCount * 2.399963;
                            const rad = 0.0011 * Math.sqrt(nearCount);
                            spLat = Number((spLat + Math.sin(angle) * rad * 0.82).toFixed(6));
                            spLng = Number((spLng + Math.cos(angle) * rad).toFixed(6));
                        }
                        placedSubPoints.push({ lat: spLat, lng: spLng });
                        const lblSlot = SUB_LABEL_SLOTS[(nearCount > 0 ? nearCount : spIdx) % SUB_LABEL_SLOTS.length];

                        const spColor = statusTone(sp.status);
                        const colorHex = spColor.replace("#", "").toLowerCase();
                        const vis = resolvePmoPointVisual(project, r, sp);
                        const spIcon = `${vis.iconPrefix}-${colorHex}`;
                        const tsEqualRayon = sp.tsNo && (sp.tsNo.toLowerCase() === String(sp.rayon || "").toLowerCase() || sp.tsNo.toLowerCase() === String(r.name || "").toLowerCase());
                        const rawSubLabel = ((isMuganliProj || tsEqualRayon) && sp.address)
                            ? sp.address
                            : (sp.tsNo || sp.address || sp.name || `#${sp.idx || ""}`);
                        const tsLabel = cleanGlText(rawSubLabel);
                        const isSelSub = Boolean(selected?.item === r && state.selected?.pmoSubId === sp.id);
                        const execSummary = [sp.bcgExec, sp.avicomExec].filter(Boolean).join(" / ");
                        const isSeedUnstarted = sp.cablePlanM === undefined && sp.status === "layihe";
                        const planMVal = isSeedUnstarted ? (Number(sp.cableDoneM) || 0) : (Number(sp.cablePlanM) || 0);
                        const doneMVal = isSeedUnstarted ? 0 : (Number(sp.cableDoneM) || 0);
                        const cablePlanText = (planMVal > 0) ? `${planMVal.toLocaleString("az-AZ")} m` : "-";
                        const cableDoneText = (doneMVal > 0) ? `${doneMVal.toLocaleString("az-AZ")} m` : "-";
                        const showTipAddr = sp.address && cleanGlText(sp.address) !== tsLabel;
                        const spTip = sp.isTemirRayon
                            ? `<b>${esc(sp.rayon || tsLabel)}</b><small>Region (RM): <b>${esc(r.name)}</b>${sp.regLead ? `<br>Regional rəhbər: <b style="color:#38bdf8">${esc(sp.regLead)}</b>` : ""}<br>Nöqtə sayı: <b style="color:#4ade80">${sp.totalCount || 1} nöqtə</b>${sp.doneCount !== undefined ? ` (Bərpa edilib: ${sp.doneCount})` : ""}</small>`
                            : `<b>${esc(tsLabel)}</b><small>${vis.pillText ? `${esc(vis.pillText)}<br>` : ""}${showTipAddr ? `${esc(sp.address)}<br>` : ""}${sp.pole ? `Dirək: <b>${esc(sp.pole)}</b><br>` : ""}${execSummary ? `İcraçı: <b>${esc(execSummary)}</b><br>` : ""}Layihə kabeli: <b>${esc(cablePlanText)}</b><br>Faktiki çəkilən: <b style="color:#4ade80">${esc(cableDoneText)}</b>${sp.connType ? `<br>Qoşulma: <b>${esc(sp.connType)}</b>` : ""}</small>`;
                        const spProps = {
                            isRayonPoint: true,
                            isPmoSubPoint: true,
                            isIcrada: sp.status === "icrada",
                            color: spColor,
                            shapeIcon: spIcon,
                            dim,
                            sel: isSelSub,
                            projectId: project.id,
                            itemId: r.id,
                            pmoSubId: sp.id,
                            clusterKey: pmoClusterKey,
                            shortLabel: tsLabel,
                            label: tsLabel,
                            lblAnchor: lblSlot.anchor,
                            lblOffset: lblSlot.offset,
                            tip: spTip
                        };
                        features.push({ type: "Feature", geometry: { type: "Point", coordinates: [spLng, spLat] }, properties: spProps });
                        labelFeatures.push({ type: "Feature", geometry: { type: "Point", coordinates: [spLng, spLat] }, properties: spProps });
                    });
                    return;
                }

                // ÜMUMİ RAYON REJİMİ (D2): Eyni rayonda 2-3 layihə və ya eyni şəhərdə bir neçə kateqoriya (məs: Gəncə 2027) aktiv olduqda bir qrupda birləşir
                const [lat, lng] = coords[0];
                const stColor = statusTone(r.status);
                const rColorHex = stColor.replace("#", "").toLowerCase();
                const rVis = resolvePmoPointVisual(project, r, null);
                const rShape = rVis.shapeObj || shape;
                const rShapeIcon = `${rVis.iconPrefix}-${rColorHex}`;
                const pSheetId = String(project.sheetId || project.pmoMeta?.sheetId || "");
                const isGenceProj = pSheetId === "17" || /^g[əe]nc[əe]\b/i.test(rawProjBase);
                const cleanRayKey = isGenceProj
                    ? "gəncə"
                    : String(r.name || r.rayon || "")
                        .replace(/\s*rayon(u)?\b/gi, "")
                        .replace(/\s*şəhər(i)?\b/gi, "")
                        .trim()
                        .toLocaleLowerCase("az");
                const slotDisplayName = isGenceProj ? "Gəncə" : r.name;
                const normKey = cleanRayKey || `pmo::${project.id}::${r.id}`;
                if (!pointSlots[normKey]) {
                    pointSlots[normKey] = {
                        rayonName: slotDisplayName,
                        clusterKey: subPtsWithCoords.length > 0 ? pmoClusterKey : "",
                        latSum: 0,
                        lngSum: 0,
                        entries: []
                    };
                }
                if (!pointSlots[normKey].clusterKey && subPtsWithCoords.length > 0) {
                    pointSlots[normKey].clusterKey = pmoClusterKey;
                }
                pointSlots[normKey].latSum += lat;
                pointSlots[normKey].lngSum += lng;
                pointSlots[normKey].entries.push({
                    project,
                    r,
                    lat,
                    lng,
                    stColor,
                    shape: rShape,
                    shapeIcon: rShapeIcon,
                    dim,
                    sel: Boolean(selected?.item === r),
                    rayonName: r.name,
                    rawProjName: rawProjBase,
                    compactProjName,
                    ptType: "",
                    antCount: Number(r.pmoRayon.totalPlan) || 0,
                    antLabel: `${r.pmoRayon.totalPlan || 0} nöqtə`,
                    execSummary: `BCG ${r.pmoRayon.bcgDone}/${r.pmoRayon.bcgPlan} · Avicom ${r.pmoRayon.avicomDone}/${r.pmoRayon.avicomPlan}`,
                    verilenM: Number(r.pmoRayon.totalPlan) || 0,
                    cekilenM: Number(r.pmoRayon.totalDone) || 0,
                    pct: Number(r.pmoRayon.pct) || 0,
                    pmoRayon: r.pmoRayon,
                    clusterKey: subPtsWithCoords.length > 0 ? pmoClusterKey : ""
                });
                return;
            }

            const distinctPtCoords = coords.filter((c, idx) => idx === 0 || c[0] !== coords[idx - 1][0] || c[1] !== coords[idx - 1][1]);
            const ptsToDraw = distinctPtCoords.length > 0 ? distinctPtCoords : [coords[0]];
            const stColor = statusTone(r.status);
            const ptType = extractPointType(r.props, r);
            const rawRayonProp = String(r.rayon || getPropCaseInsensitive(r.props, "Rayon", "rayon_adi", "rayonu", "sheher", "bolge") || "").replace(/\s*rayon(u)?(?![a-zəçşğıöü])/gi, "").trim();
            const rawRayonName = String(r.name || rawRayonProp || "").replace(/\s*\(?\bFaz[-\s]*[12]\b\)?/gi, "").replace(/\s*rayon(u)?(?![a-zəçşğıöü])/gi, "").trim();
            const baseRayonName = rawRayonName || String(r.name || "").trim();
            const { planM: verilenM, doneM: cekilenM } = getPointMetersPair(r);
            const pct = calcPointPct(cekilenM, verilenM, r.status);
            const rawProjBase = cleanProjectName(project.name, project.sheetId || project.pmoMeta?.sheetId).replace(/\s*\(?\bFaz[-\s]*[12]\b\)?/gi, "").trim();
            const rawProjName = rawProjBase;
            const compactProjName = rawProjBase.length > 32 ? `${rawProjBase.slice(0, 31).trim()}…` : rawProjBase;
            const antCount = Number(r.antennas || 0);
            const antLabel = formatPointAntLabel(antCount, ptType);
            const execDet = resolveItemExecDetails(r);

            // Eyni layihədə eyni rayona aid bir neçə anten/nöqtə varsa (məs: Şamaxı — 6 anten):
            const rayonGroupLabel = rawRayonProp || (ptsToDraw.length > 1 ? baseRayonName : "");
            const rayonGroupNorm = rayonGroupLabel ? rayonGroupLabel.toLocaleLowerCase("az").replace(/\s+/g, " ").trim() : "";
            const sameRayonCount = rayonGroupNorm
                ? (project.items || []).filter(it => {
                    const itR = String(it.rayon || getPropCaseInsensitive(it.props, "Rayon", "rayon_adi", "rayonu", "sheher", "bolge") || "").replace(/\s*rayon(u)?(?![a-zəçşğıöü])/gi, "").trim().toLocaleLowerCase("az").replace(/\s+/g, " ").trim();
                    return itR === rayonGroupNorm;
                }).length
                : 0;
            const isClusterableRayon = Boolean(rayonGroupNorm && (sameRayonCount > 1 || ptsToDraw.length > 1));
            const clusterKey = isClusterableRayon ? `${project.id}::${rayonGroupNorm}` : "";
            const isExpandedRayon = Boolean(clusterKey && state.expandedRayons.has(clusterKey));

            if (isClusterableRayon && !isExpandedRayon) {
                // ÜMUMİ RAYON REJİMİ: Həmin rayondakı bütün antenləri (məs: 6 anten) 1 ümumi nöqtədə cəmlə
                const normKey = `cluster::${clusterKey}`;
                if (!pointSlots[normKey]) {
                    pointSlots[normKey] = {
                        rayonName: rayonGroupLabel,
                        clusterKey,
                        latSum: 0,
                        lngSum: 0,
                        coordCount: 0,
                        subItems: [],
                        entries: []
                    };
                }
                const slot = pointSlots[normKey];
                ptsToDraw.forEach(([lat, lng]) => {
                    slot.latSum += lat;
                    slot.lngSum += lng;
                    slot.coordCount += 1;
                });
                slot.subItems.push({ r, verilenM, cekilenM, antCount: Math.max(1, antCount), ptType, execSummary: execDet.cardSummary, coords: ptsToDraw });

                const totalAnt = slot.subItems.reduce((s, x) => s + (ptsToDraw.length > 1 && slot.subItems.length === 1 ? Math.max(ptsToDraw.length, x.antCount) : x.antCount), 0);
                const totalPlanM = slot.subItems.reduce((s, x) => s + x.verilenM, 0);
                const totalDoneM = slot.subItems.reduce((s, x) => s + x.cekilenM, 0);
                const allDone = slot.subItems.every(x => x.r.status === "bitmis" || x.r.status === "tehvil");
                const anyIcrada = slot.subItems.some(x => x.r.status === "icrada" || x.r.status === "bitmis" || x.r.status === "tehvil");
                const aggStatus = allDone ? "bitmis" : (anyIcrada ? "icrada" : "layihe");
                const aggColor = statusTone(aggStatus);
                const aggPct = calcPointPct(totalDoneM, totalPlanM, aggStatus);
                const aggShapeIcon = `pt-${shape.id}-${aggColor.replace("#", "").toLowerCase()}`;

                slot.entries = [{
                    project,
                    r,
                    lat: slot.latSum / Math.max(1, slot.coordCount),
                    lng: slot.lngSum / Math.max(1, slot.coordCount),
                    stColor: aggColor,
                    shape,
                    shapeIcon: aggShapeIcon,
                    dim,
                    sel: Boolean(selected?.project === project && slot.subItems.some(x => x.r === selected?.item)),
                    rayonName: `${rayonGroupLabel} (${slot.subItems.length > 1 ? slot.subItems.length : ptsToDraw.length} nöqtə)`,
                    rawProjName,
                    compactProjName,
                    ptType,
                    antCount: totalAnt,
                    antLabel: formatPointAntLabel(totalAnt, ptType),
                    execSummary: execDet.cardSummary,
                    verilenM: totalPlanM,
                    cekilenM: totalDoneM,
                    pct: aggPct,
                    cExtra,
                    clusterKey
                }];
                return;
            }

            ptsToDraw.forEach(([lat, lng], ptIdx) => {
                const rayonName = ptsToDraw.length > 1 ? `${baseRayonName} #${ptIdx + 1}` : baseRayonName;
                const normKey = `${project.id}:${r.id}:${ptIdx}`;
                if (!pointSlots[normKey]) {
                    pointSlots[normKey] = {
                        rayonName,
                        clusterKey,
                        latSum: 0,
                        lngSum: 0,
                        entries: []
                    };
                }
                pointSlots[normKey].latSum += lat;
                pointSlots[normKey].lngSum += lng;
                pointSlots[normKey].entries.push({
                    project,
                    r,
                    lat,
                    lng,
                    stColor,
                    shape,
                    shapeIcon,
                    dim,
                    sel: Boolean(selected?.item === r),
                    rayonName,
                    rawProjName,
                    compactProjName,
                    ptType,
                    antCount: ptsToDraw.length > 1 ? 1 : antCount,
                    antLabel: formatPointAntLabel(ptsToDraw.length > 1 ? 1 : antCount, ptType),
                    execSummary: execDet.cardSummary,
                    verilenM: ptsToDraw.length > 1 ? Math.round(verilenM / ptsToDraw.length) : verilenM,
                    cekilenM: ptsToDraw.length > 1 ? Math.round(cekilenM / ptsToDraw.length) : cekilenM,
                    pct,
                    cExtra,
                    clusterKey
                });
            });
            return;
        } else if (coords.length >= 2) {
            const line = coords.map(([lat, lng]) => [lng, lat]);
            const isLifLine = isLifGoturulen(r, project);
            const rawPropName = getPropCaseInsensitive(
                r.props,
                "Name", "name", "kabel", "kabel_adi", "xett_adi", "xett", "LineName", "title", "ad", "marsrut", "route", "label"
            );
            const isGen = /^(?:idxal\s*x[əe]tti|imported\s*line|x[əe]tt|line|imp)[-\s]*\d*$/i.test(String(r.name || "").trim());
            const lineDisplayName = (!isGen && r.name) ? String(r.name).trim() : String(rawPropName || r.name || project.name || "").trim();
            const foLabel = r.isMagistral ? (r.fiber || "FO") : (isLifLine ? "" : getSegmentFiber(r, project));
            const foImg = isLifLine
                ? ensureLineTextBadgeImage(lineDisplayName)
                : (foLabel ? ensureFoBadgeImage(foLabel) : null);
            const { nameA, nameB } = resolveLineEndNames(r, project);
            const stText = t(`status${r.status}`);
            const foTipPart = foLabel ? `🔌 <b>${esc(foLabel)}</b> · ` : "";
            const routePart = (nameA || nameB) ? `<br>📍 <b>${esc(nameA || "—")}</b> ➔ 📍 <b>${esc(nameB || "—")}</b>` : "";
            // Mouse xəttə yaxınlaşanda (hover):
            const lineTip = r.isMagistral
                ? `<b>${esc(lineDisplayName)}</b><small>🔌 <b>${esc(foLabel)}</b> · <b style="color:${color}">${esc(stText)}</b><br>📏 Layihə (U): <b>${(r.planM || 0).toLocaleString("az-AZ")} m</b> · İcra olunan: <b>${(r.doneM || 0).toLocaleString("az-AZ")} m</b>${r.contractor ? `<br>👷 İcraçı: <b>${esc(r.contractor)}</b>` : ""}${r.endDate ? ` · 📅 ${esc(r.endDate)}` : ""}</small>`
                : (isLifLine
                    ? `<b>${esc(lineDisplayName)}</b><small><b style="color:${color}">${esc(stText)}</b>${routePart}</small>`
                    : `<b>${esc(lineDisplayName)}</b><small>${foTipPart}<b style="color:${color}">${esc(stText)}</b> · ${formatKm(r.doneKm)} / ${formatKm(r.totalKm)} km (${percent(r.doneKm, r.totalKm)}%)</small>`);

            features.push({
                type: "Feature", geometry: { type: "LineString", coordinates: line },
                properties: {
                    color,
                    dim,
                    sel: Boolean(selected?.item === r),
                    projectId: project.id,
                    itemId: r.id,
                    tip: lineTip
                }
            });

            // Kabel üzərində FO lif sayı (yalnız faylda/obyektdə lif sayı varsa göstərilir — şərti rəqəm atılmır)
            if (foImg) {
                const itemSegs = [];
                let segTotalLen = 0;
                for (let i = 0; i < line.length - 1; i++) {
                    const [x1, y1] = line[i];
                    const [x2, y2] = line[i + 1];
                    const len = Math.hypot(x2 - x1, y2 - y1);
                    if (len > 0) {
                        itemSegs.push({ x1, y1, x2, y2, len, start: segTotalLen, item: r, tip: lineTip, color, dim, foImg });
                        segTotalLen += len;
                    }
                }
                if (itemSegs.length > 0 && segTotalLen > 0) {
                    const foFractions = segTotalLen < 0.14 ? [0.50] : (segTotalLen < 0.48 ? [0.33, 0.67] : [0.22, 0.50, 0.78]);
                    sampleSegmentsAtFractions(itemSegs, segTotalLen, foFractions).forEach(({ coord, angle, seg }) => {
                        const tooCloseFo = placedFoPoints.some(p => Math.hypot(p.lng - coord[0], p.lat - coord[1]) < 0.035);
                        if (tooCloseFo) return;
                        placedFoPoints.push({ lng: coord[0], lat: coord[1] });
                        labelFeatures.push({
                            type: "Feature",
                            geometry: { type: "Point", coordinates: coord },
                            properties: {
                                color: seg.color,
                                dim: seg.dim,
                                foPointImg: seg.foImg,
                                iconRotate: angle,
                                projectId: project.id,
                                itemId: seg.item.id,
                                tip: seg.tip
                            }
                        });
                    });
                }
            }

            // Hər kabel xəttinin başlanğıc (A) və son (B) nöqtələrində qırmızı sorma konfet ikonu və məntəqə adı göstərilir
            const startPt = line[0];
            const endPt = line[line.length - 1];
            const tipA = nameA ? `📍 <b>${esc(nameA)}</b>` : lineTip;
            const tipB = nameB ? `📍 <b>${esc(nameB)}</b>` : lineTip;
            pushLineEndpoint(startPt, nameA, color, dim, project, r, tipA);
            pushLineEndpoint(endPt, (nameB && nameB !== nameA) ? nameB : (Math.hypot(endPt[0] - startPt[0], endPt[1] - startPt[1]) > 0.06 ? nameB : ""), color, dim, project, r, tipB);
        }
    });

    // Rayon nöqtə layihələrinin qruplaşdırılması:
    // - Uzaqlaşanda (zoom < 10.2): eyni rayondakı nöqtə layihələri bir pəncərədə qovuşur (hər birinin öz məlumatı qalır)
    // - Yaxınlaşanda (zoom >= 10.2): nöqtələr və pəncərələri sağa-sola ayrılır və məsafələr metr (m) ilə göstərilir
    // Yaxın nöqtələrin kartları üst-üstə düşməsin deyə coğrafi yaxınlığa görə künclərə (yuxarı / aşağı) payla
    const CORNER_SLOTS = [
        { anchor: "bottom-left", offset: [10, -8] },   // Yuxarı sağ künc
        { anchor: "top-left", offset: [10, 8] },       // Aşağı sağ künc
        { anchor: "bottom-right", offset: [-10, -8] }, // Yuxarı sol künc
        { anchor: "top-right", offset: [-10, 8] }      // Aşağı sol künc
    ];
    const groupList = Object.values(pointSlots).filter(g => g.entries.length > 0).map(g => ({
        ...g,
        centerLat: g.latSum / g.entries.length,
        centerLng: g.lngSum / g.entries.length,
        cornerIdx: 0
    })).sort((a, b) => b.centerLat - a.centerLat || a.centerLng - b.centerLng);

    for (let i = 0; i < groupList.length; i++) {
        const usedSlots = new Set();
        for (let j = 0; j < i; j++) {
            const dLat = Math.abs(groupList[i].centerLat - groupList[j].centerLat);
            const dLng = Math.abs(groupList[i].centerLng - groupList[j].centerLng);
            if (dLat < 0.26 && dLng < 0.48) {
                usedSlots.add(groupList[j].cornerIdx);
            }
        }
        let chosen = 0;
        while (usedSlots.has(chosen) && chosen < CORNER_SLOTS.length - 1) chosen++;
        if (usedSlots.has(chosen)) chosen = i % CORNER_SLOTS.length;
        groupList[i].cornerIdx = chosen;
    }

    const SPLIT_RING_LAYOUTS = [
        // idx 0: Yuxarı sol
        { dLng: -0.028, dLat: 0.018, anchor: "bottom-right", offset: [-10, -8] },
        // idx 1: Yuxarı sağ
        { dLng: 0.028, dLat: 0.018, anchor: "bottom-left", offset: [10, -8] },
        // idx 2: Aşağı sol
        { dLng: -0.028, dLat: -0.018, anchor: "top-right", offset: [-10, 8] },
        // idx 3: Aşağı sağ
        { dLng: 0.028, dLat: -0.018, anchor: "top-left", offset: [10, 8] },
        // idx 4: Orta sol (kənara)
        { dLng: -0.044, dLat: 0.000, anchor: "right", offset: [-12, 0] },
        // idx 5: Orta sağ (kənara)
        { dLng: 0.044, dLat: 0.000, anchor: "left", offset: [12, 0] },
        // idx 6: Tam yuxarı
        { dLng: 0.000, dLat: 0.030, anchor: "bottom", offset: [0, -10] },
        // idx 7: Tam aşağı
        { dLng: 0.000, dLat: -0.030, anchor: "top", offset: [0, 10] }
    ];

    groupList.forEach(grp => {
        const n = grp.entries.length;
        const { centerLat, centerLng } = grp;
        const first = grp.entries[0];
        const grpCorner = CORNER_SLOTS[grp.cornerIdx] || CORNER_SLOTS[0];
        const distinctProjIds = new Set(grp.entries.map(e => e.project.id));
        const allSameProject = distinctProjIds.size === 1;

        const mergedTip = n > 1
            ? `<b>📍 ${esc(grp.rayonName)}</b><br>` + grp.entries.map(e => {
                const rowTitle = (e.rayonName && e.rayonName.toLocaleLowerCase("az") !== grp.rayonName.toLocaleLowerCase("az"))
                    ? (allSameProject ? e.rayonName : `${e.rawProjName} · ${e.rayonName}`)
                    : e.rawProjName;
                return `<small><span style="color:${e.stColor}">${e.shape.symbol}</span> <b>${esc(rowTitle)}:</b> 📡 ${esc(e.antLabel)} - ${e.verilenM} / ${e.cekilenM} m (${e.pct}%)${e.execSummary ? ` · 👷 ${esc(e.execSummary)}` : ""}</small>`;
            }).join("<br>")
            : `<b style="color:${first.stColor}">${first.shape.symbol} ${esc(grp.rayonName)}</b><small>${first.rawProjName ? `<span style="opacity:0.9">${esc(first.rawProjName)}</span><br>` : ""}📡 ${esc(first.antLabel)} - ${first.verilenM} / ${first.cekilenM} m (${first.pct}%)${first.execSummary ? `<br>👷 İcraçı: <b>${esc(first.execSummary)}</b>` : ""}</small>`;

        const mergedHeaderTitle = (n > 1 && allSameProject)
            ? `${first.compactProjName} (${grp.rayonName})`
            : grp.rayonName;

        const mergedCardImg = n > 1
            ? ensureMergedSummaryCardImage(mergedHeaderTitle, grp.entries.map(e => {
                const subNameDiff = e.rayonName && e.rayonName.toLocaleLowerCase("az") !== grp.rayonName.toLocaleLowerCase("az");
                const entryFolderTitle = subNameDiff
                    ? (allSameProject ? e.rayonName : `${e.compactProjName} · ${e.rayonName}`)
                    : e.compactProjName;
                return {
                    color: e.stColor,
                    shapeSymbol: e.shape.symbol,
                    folderName: entryFolderTitle,
                    antennas: e.antCount,
                    pointType: e.ptType,
                    totalM: e.verilenM,
                    doneM: e.cekilenM,
                    pct: e.pct,
                    contractor: e.execSummary || "",
                    isPmo: Boolean(e.pmoRayon),
                    pmoRayon: e.pmoRayon || null
                };
            }))
            : (first.pmoRayon
                ? ensurePmoRayonCardImage({
                    name: grp.rayonName,
                    color: first.stColor,
                    shapeSymbol: first.shape.symbol,
                    folderName: first.compactProjName,
                    pmoRayon: first.pmoRayon
                })
                : ensureSummaryCardImage({
                    name: grp.rayonName,
                    color: first.stColor,
                    shapeSymbol: first.shape.symbol,
                    folderName: first.compactProjName,
                    antennas: first.antCount,
                    pointType: first.ptType,
                    totalM: first.verilenM,
                    doneM: first.cekilenM,
                    pct: first.pct,
                    contractor: first.execSummary || ""
                }));

        // 1) Uzaq miqyas (zoom < 10.2) üçün qovuşmuş kart + yan-yana fərqli ikonlar
        const hasIcrada = grp.entries.some(e => e.r.status === "icrada");
        const clusterEntries = grp.entries.filter(e => e.clusterKey);
        const primaryClusterEntry = clusterEntries[0] || first;
        const allClusterKeys = [...new Set(clusterEntries.map(e => e.clusterKey))].join("|");
        labelFeatures.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [centerLng, centerLat] },
            properties: {
                isRayonPoint: true,
                isSummary: true,
                isMultiRayon: n > 1,
                isIcrada: hasIcrada,
                centerLng,
                centerLat,
                color: first.stColor,
                dim: grp.entries.every(e => e.dim),
                projectId: primaryClusterEntry.project.id,
                itemId: primaryClusterEntry.r.id,
                clusterKey: primaryClusterEntry.clusterKey || "",
                allClusterKeys,
                tip: mergedTip,
                cardAnchor: grpCorner.anchor,
                cardOffset: grpCorner.offset,
                nameAnchor: "top",
                nameOffset: [0, 10],
                summaryNameImg: ensureSummaryNameImage(grp.rayonName, first.stColor),
                mergedCardImg
            }
        });

        grp.entries.forEach((e, idx) => {
            const singleTip = `<b style="color:${e.stColor}">${e.shape.symbol} ${esc(e.rayonName)}</b><small>${e.rawProjName ? `<span style="opacity:0.9">${esc(e.rawProjName)}</span><br>` : ""}📡 ${esc(e.antLabel)} - ${e.verilenM} / ${e.cekilenM} m (${e.pct}%)${e.execSummary ? `<br>👷 İcraçı: <b>${esc(e.execSummary)}</b>` : ""}</small>`;

            // Zoom < 10.2: eyni rayonda 2+ layihə və ya kateqoriya olduqda ikonlar yan-yana düzülür ki üst-üstə düşməsin
            const stepLng = n > 4 ? 0.015 : 0.022;
            const mergedLng = n === 1 ? e.lng : centerLng + (idx - (n - 1) / 2) * stepLng;
            const mergedLat = n === 1 ? e.lat : centerLat;
            features.push({
                type: "Feature",
                geometry: { type: "Point", coordinates: [mergedLng, mergedLat] },
                properties: {
                    isRayonPoint: true,
                    isSummary: true,
                    mergedOnly: true,
                    isMultiRayon: n > 1,
                    isIcrada: e.r.status === "icrada",
                    centerLng,
                    centerLat,
                    color: e.stColor,
                    shapeIcon: e.shapeIcon,
                    dim: e.dim,
                    sel: e.sel,
                    projectId: e.project.id,
                    itemId: e.r.id,
                    clusterKey: e.clusterKey || primaryClusterEntry.clusterKey || "",
                    allClusterKeys,
                    tip: n > 1 ? mergedTip : singleTip
                }
            });

            // 2) Yaxın miqyas (zoom >= 10.2) üçün geniş aralı ayrılmış nöqtələr və kənara açılan fərdi kartlar
            let splitLng = e.lng;
            let splitLat = e.lat;
            let cardAnchor = grpCorner.anchor;
            let cardOffset = grpCorner.offset;

            if (n >= 2) {
                const ringSlot = SPLIT_RING_LAYOUTS[idx % SPLIT_RING_LAYOUTS.length];
                const ringTier = Math.floor(idx / SPLIT_RING_LAYOUTS.length) + 1;
                cardAnchor = ringSlot.anchor;
                cardOffset = ringSlot.offset;
                splitLng = centerLng + ringSlot.dLng * ringTier;
                splitLat = centerLat + ringSlot.dLat * ringTier;
            }

            const singleCardImg = e.pmoRayon
                ? ensurePmoRayonCardImage({
                    name: e.rayonName,
                    color: e.stColor,
                    shapeSymbol: e.shape.symbol,
                    folderName: e.compactProjName,
                    pmoRayon: e.pmoRayon
                })
                : ensureSummaryCardImage({
                    name: e.rayonName,
                    color: e.stColor,
                    shapeSymbol: e.shape.symbol,
                    folderName: e.compactProjName,
                    antennas: e.antCount,
                    pointType: e.ptType,
                    totalM: e.verilenM,
                    doneM: e.cekilenM,
                    pct: e.pct,
                    contractor: e.execSummary || ""
                });

            const splitProps = {
                isRayonPoint: true,
                isSummary: true,
                splitOnly: true,
                isIcrada: e.r.status === "icrada",
                color: e.stColor,
                shapeIcon: e.shapeIcon,
                dim: e.dim,
                sel: e.sel,
                projectId: e.project.id,
                itemId: e.r.id,
                clusterKey: e.clusterKey || "",
                tip: singleTip,
                cardAnchor,
                cardOffset,
                summaryCardImg: singleCardImg
            };

            features.push({
                type: "Feature",
                geometry: { type: "Point", coordinates: [splitLng, splitLat] },
                properties: splitProps
            });
            labelFeatures.push({
                type: "Feature",
                geometry: { type: "Point", coordinates: [splitLng, splitLat] },
                properties: splitProps
            });
        });
    });

    // Poliqon (rayon sərhədləri) və Digər qovluğu obyektlərinin mərkəzdəki sakit adları
    Object.values(polygonCenterGroups).forEach(g => {
        const subtleCenterImg = ensureSubtleCenterLabelImage(g.cleanName, g.color);
        if (!subtleCenterImg) return;
        labelFeatures.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: g.center },
            properties: {
                color: g.color,
                dim: g.dim,
                subtleCenterImg,
                projectId: g.projectId,
                itemId: g.itemId,
                tip: g.tip
            }
        });
    });
    if (Array.isArray(window.__mmDraftCoords) && window.__mmDraftCoords.length >= 2) {
        features.push({
            type: "Feature",
            geometry: {
                type: "LineString",
                coordinates: window.__mmDraftCoords.map(([lat, lng]) => [lng, lat])
            },
            properties: {
                color: "#3B82F6",
                dim: false,
                sel: true,
                tip: "<b>Yeni çəkilən xətt</b>"
            }
        });
    }
    source.setData({ type: "FeatureCollection", features });
    labelFeatures.forEach(f => {
        const p = f.properties;
        if (p.label) p.labelImg = ensureLabelImage(p.label);
        if (p.shortLabel) p.nameImg = ensureLabelImage(p.shortLabel);
    });
    if (labelSource) labelSource.setData({ type: "FeatureCollection", features: labelFeatures });
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

function selectSegment(project, item, shouldFly = false, pmoSubId = null) {
    state.selected = { projectId: project.id, itemId: item.id, pmoSubId: pmoSubId || null };
    window.__activeProjectId = project.id;
    state.expandedIds.add(project.id);
    setSidebar(true);
    renderAll();
    if (shouldFly) {
        if (pmoSubId && item?.pmoRayon?.subPoints) {
            const sp = item.pmoRayon.subPoints.find(x => x.id === pmoSubId);
            if (sp?.coords) { flyToCoords([sp.coords]); return; }
        }
        flyToCoords(item.coords);
    }
}

function clearSelection() {
    state.selected = null;
    renderAll();
}

function getPmoRayonClusterKey(project, item) {
    if (!project || !item) return "";
    const normName = String(item.name || item.rayon || item.id || "")
        .toLocaleLowerCase("az")
        .replace(/\s*rayon(u)?\b/gi, "")
        .replace(/\s*şəhər(i)?\b/gi, "")
        .replace(/[^a-z0-9əıöüçşğ]/gi, "")
        .trim();
    return `${project.id}::pmo::${normName || item.id}`;
}
window.getPmoRayonClusterKey = getPmoRayonClusterKey;

function resolvePmoClusterTarget(clusterKey, fallbackProject = null, fallbackItem = null) {
    if (!clusterKey || !String(clusterKey).includes("::pmo::")) {
        return { project: fallbackProject, item: fallbackItem };
    }
    const [projId, , tail] = String(clusterKey).split("::");
    const project = (state.projects || []).find(p => p.id === projId) || fallbackProject;
    if (!project) return { project: null, item: null };
    const item = (project.items || []).find(it =>
        getPmoRayonClusterKey(project, it) === clusterKey || it.id === tail
    ) || fallbackItem;
    return { project, item };
}

let _lastRayonToggleSig = "";
let _lastRayonToggleAt = 0;

function toggleRayonClusterExpand(clusterKey, project, item, opts = {}) {
    if (!clusterKey) return false;
    const now = Date.now();
    // Eyni 2x klikdə onMapClick + onMapDblClick ardıcıl düşüb açılan rayonu 1ms sonra bağlamasın!
    if (!opts.bypassDebounce && clusterKey === _lastRayonToggleSig && (now - _lastRayonToggleAt) < 480) {
        return true;
    }
    const resolved = resolvePmoClusterTarget(clusterKey, project, item);
    const targetProj = resolved.project || project;
    const targetItem = resolved.item || item;
    if (!targetProj) return false;

    const stableKey = (targetItem?.isPmoRayon) ? getPmoRayonClusterKey(targetProj, targetItem) : clusterKey;
    const legacyKey = targetItem ? `${targetProj.id}::pmo::${targetItem.id}` : "";
    _lastRayonToggleSig = clusterKey;
    _lastRayonToggleAt = now;

    if (!state.expandedRayons) state.expandedRayons = new Set();
    if (state.expandedRayons.has(stableKey) || (legacyKey && state.expandedRayons.has(legacyKey)) || state.expandedRayons.has(clusterKey)) {
        state.expandedRayons.delete(stableKey);
        if (legacyKey) state.expandedRayons.delete(legacyKey);
        state.expandedRayons.delete(clusterKey);
        if (state.selected?.pmoSubId) state.selected.pmoSubId = null;
        if (!opts.silentRender) {
            renderAll();
            toast("📍 Rayon nöqtələri ümumi status altında birləşdirildi");
        }
        return true;
    }

    if (targetItem?.isPmoRayon && targetItem?.pmoRayon) {
        // Əgər hansısa səbəbdən subPoints boşdursa, seed-dən avtomatik bərpa et
        if ((!Array.isArray(targetItem.pmoRayon.subPoints) || targetItem.pmoRayon.subPoints.length === 0) && Array.isArray(window.PMO_SEED_PROJECTS)) {
            const seedP = window.PMO_SEED_PROJECTS.find(p => p.id === targetProj.id || (targetProj.sheetId && p.sheetId === targetProj.sheetId));
            const seedIt = seedP?.items?.find(it => getPmoRayonClusterKey(targetProj, it) === stableKey);
            if (Array.isArray(seedIt?.pmoRayon?.subPoints) && seedIt.pmoRayon.subPoints.length > 0) {
                targetItem.pmoRayon.subPoints = seedIt.pmoRayon.subPoints;
            }
        }
        const subCoords = (targetItem.pmoRayon.subPoints || [])
            .filter(sp => Array.isArray(sp.coords) && sp.coords.length === 2)
            .map(sp => (sp.coords[0] >= 43.5 && sp.coords[1] <= 42.5) ? [sp.coords[1], sp.coords[0]] : sp.coords);
        if (subCoords.length === 0) {
            if (!opts.silentRender) {
                toast(`ℹ️ ${targetItem.name} üzrə koordinatlı alt-nöqtə qeyd olunmayıb`);
            }
            return false;
        }
        state.expandedRayons.add(stableKey);
        if (!opts.silentRender) {
            renderAll();
            flyToCoords(subCoords);
            const isTemir = Boolean(targetItem.pmoRayon.temirMeta?.isTemirRm || String(targetProj.sheetId || "") === "15.3");
            toast(isTemir
                ? `📍 ${targetItem.name} üzrə ${subCoords.length} rayon xəritədə paylandı!`
                : `📍 ${targetItem.name} rayonu üzrə ${subCoords.length} nöqtə öz koordinatlarına parçalandı!`);
        }
        return { expanded: true, coords: subCoords, count: subCoords.length, name: targetItem.name };
    }

    state.expandedRayons.add(stableKey);
    const rayonNorm = stableKey.split("::")[1] || "";
    const clusterCoords = (targetProj.items || [])
        .filter(it => String(it.rayon || "").replace(/\s*rayon(u)?(?![a-zəçşğıöü])/gi, "").trim().toLocaleLowerCase("az") === rayonNorm)
        .flatMap(it => it.coords || []);
    if (!opts.silentRender) {
        renderAll();
        flyToCoords(clusterCoords.length ? clusterCoords : (targetItem?.coords || []));
        toast("📍 Rayon üzrə alt-nöqtələr xəritədə öz koordinatlarına paylandı!");
    }
    return { expanded: true, coords: clusterCoords.length ? clusterCoords : (targetItem?.coords || []) };
}
window.toggleRayonClusterExpand = toggleRayonClusterExpand;

function toggleMergedRayonClusters(allKeysStr, singleKey, project, item) {
    const keys = String(allKeysStr || "").split("|").map(s => s.trim()).filter(Boolean);
    if (keys.length <= 1) {
        return toggleRayonClusterExpand(keys[0] || singleKey, project, item);
    }
    const sig = keys.join("|");
    const now = Date.now();
    if (sig === _lastRayonToggleSig && (now - _lastRayonToggleAt) < 480) {
        return true;
    }
    _lastRayonToggleSig = sig;
    _lastRayonToggleAt = now;
    if (!state.expandedRayons) state.expandedRayons = new Set();

    const anyNotExpanded = keys.some(k => !state.expandedRayons.has(k));
    const allCoords = [];
    let totalPts = 0;
    keys.forEach(k => {
        const res = resolvePmoClusterTarget(k);
        if (!res.project || !res.item) return;
        if (anyNotExpanded) {
            if (!state.expandedRayons.has(k)) {
                const r = toggleRayonClusterExpand(k, res.project, res.item, { silentRender: true, bypassDebounce: true });
                if (r && Array.isArray(r.coords)) {
                    allCoords.push(...r.coords);
                    totalPts += r.count || r.coords.length;
                }
            }
        } else {
            state.expandedRayons.delete(k);
        }
    });
    renderAll();
    if (anyNotExpanded && allCoords.length > 0) {
        flyToCoords(allCoords);
        toast(`📍 ${item?.name || "Rayon"} üzrə ${totalPts} nöqtə öz koordinatlarına parçalandı!`);
    } else if (!anyNotExpanded) {
        if (state.selected?.pmoSubId) state.selected.pmoSubId = null;
        toast("📍 Rayon nöqtələri ümumi status altında birləşdirildi");
    }
    return true;
}

const MAP_HIT_LAYERS = ["routes-summary-card", "routes-summary-card-merged", "routes-summary-name", "routes-point-halo-split", "routes-point-shape-split", "routes-point-halo", "routes-point-shape", "routes-point-label", "routes-point-label-near", "routes-point-name", "routes-ends", "routes-ends-label", "routes-other-points", "routes-other-line", "routes-fo-points", "routes-hit", "routes-other", "routes-poly-line", "routes-poly-fill"];

function pickBestMapHit(point, preferCluster = false) {
    if (!map || !point) return null;
    const activeLayers = MAP_HIT_LAYERS.filter(id => map.getLayer(id));
    if (activeLayers.length === 0) return null;

    const scoreHit = f => {
        const p = f?.properties || {};
        if (!p.projectId) return -1;
        let s = 0;
        if (p.isPmoSubPoint) s += 110;
        if (p.isSummary || p.isRayonPoint) s += 90;
        if (p.clusterKey || p.allClusterKeys) s += (preferCluster ? 160 : 50);
        if (p.isPolygon) s -= 60;
        if (p.isOther) s -= 40;
        return s;
    };

    const radii = preferCluster ? [16, 36] : [14, 30];
    for (const r of radii) {
        const box = [[point.x - r, point.y - r], [point.x + r, point.y + r]];
        const hits = map.queryRenderedFeatures(box, { layers: activeLayers });
        if (hits && hits.length > 0) {
            const ranked = hits.slice().sort((a, b) => scoreHit(b) - scoreHit(a));
            if (!preferCluster || scoreHit(ranked[0]) > 40 || r === radii[radii.length - 1]) {
                return ranked[0];
            }
        }
    }
    return null;
}

let lastMapPtClickTime = 0;
let lastMapPtClickKey = "";
let lastMapPtClusterKey = "";
let lastMapPtAllClusterKeys = "";
let lastMapPtPoint = null;
let _multiRayonFlyTimer = null;

function onMapDblClick(e) {
    if (tools.isActive()) return;
    if (_multiRayonFlyTimer) { clearTimeout(_multiRayonFlyTimer); _multiRayonFlyTimer = null; }
    // Əgər onMapClick 2-ci klikdə rayonu artıq parçalayıbsa, MapLibre-in doubleClickZoom hərəkətini blokla və təkrar bağlama!
    if ((Date.now() - _lastRayonToggleAt) < 520) {
        e.preventDefault();
        return;
    }
    const hit = pickBestMapHit(e.point, true);
    if (!hit) return;
    const project = state.projects.find(p => p.id === hit.properties.projectId);
    const item = project?.items.find(r => r.id === hit.properties.itemId);
    const clusterKey = hit.properties?.clusterKey || (item?.isPmoRayon && item?.pmoRayon?.subPoints?.some(sp => sp.coords) ? getPmoRayonClusterKey(project, item) : "");
    const allKeys = hit.properties?.allClusterKeys || "";
    if ((clusterKey || allKeys) && project) {
        e.preventDefault();
        lastMapPtClickTime = 0;
        if (allKeys && hit.properties?.isMultiRayon && map.getZoom() < 10.2) {
            toggleMergedRayonClusters(allKeys, clusterKey, project, item);
        } else {
            toggleRayonClusterExpand(clusterKey || allKeys.split("|")[0], project, item);
        }
    }
}

function onMapClick(e) {
    $("coordClicked").value = `${e.lngLat.lat.toFixed(6)}, ${e.lngLat.lng.toFixed(6)}`;
    if (window.handleMapMarkerClick?.(e)) return;
    if (tools.handleClick(e)) return;
    if (isPhone()) {
        setSidebar(false);
        setDrawer(false);
    }
    const hit = pickBestMapHit(e.point, false);
    if (!hit) return;
    const project = state.projects.find(p => p.id === hit.properties.projectId);
    const item = project?.items.find(r => r.id === hit.properties.itemId);
    const pmoSubId = hit.properties?.pmoSubId || null;
    const clusterKey = hit.properties?.clusterKey || (item?.isPmoRayon && item?.pmoRayon?.subPoints?.some(sp => sp.coords) ? getPmoRayonClusterKey(project, item) : "");
    const allKeys = hit.properties?.allClusterKeys || "";
    const clickKey = clusterKey || `${hit.properties?.projectId}:${hit.properties?.itemId}`;
    const now = Date.now();

    // 2x Klik detektoru: Rayon nöqtəsinin/kartının yaxınlığına (48px) 2 dəfə ardıcıl vurduqda dərhal parçala
    const distToLast = lastMapPtPoint ? Math.hypot(e.point.x - lastMapPtPoint.x, e.point.y - lastMapPtPoint.y) : 999;
    if (now - lastMapPtClickTime < 650 && distToLast < 48 && project) {
        if (_multiRayonFlyTimer) { clearTimeout(_multiRayonFlyTimer); _multiRayonFlyTimer = null; }
        lastMapPtClickTime = 0;
        const effKey = clusterKey || (lastMapPtClusterKey && lastMapPtClusterKey.includes(project.id) ? lastMapPtClusterKey : "");
        const effAllKeys = allKeys || lastMapPtAllClusterKeys || "";
        if (effAllKeys && hit.properties?.isMultiRayon && map.getZoom() < 10.2) {
            toggleMergedRayonClusters(effAllKeys, effKey, project, item);
            return;
        }
        if (effKey || effAllKeys) {
            toggleRayonClusterExpand(effKey || effAllKeys.split("|")[0], project, item);
            return;
        }
        if (item?.coords) {
            flyToCoords(item.coords);
            return;
        }
    }
    lastMapPtClickTime = now;
    lastMapPtClickKey = clickKey;
    lastMapPtClusterKey = clusterKey;
    lastMapPtAllClusterKeys = allKeys;
    lastMapPtPoint = { x: e.point.x, y: e.point.y };

    if (_multiRayonFlyTimer) { clearTimeout(_multiRayonFlyTimer); _multiRayonFlyTimer = null; }
    if (hit.properties?.isMultiRayon && map.getZoom() < 10.2) {
        const cLng = Number(hit.properties.centerLng) || e.lngLat.lng;
        const cLat = Number(hit.properties.centerLat) || e.lngLat.lat;
        // Tək klikdə 2-ci klik gəlmirsə (340ms sonra) zoom et — beləliklə 2x kliklə parçalanma heç vaxt pozulmur!
        _multiRayonFlyTimer = setTimeout(() => {
            _multiRayonFlyTimer = null;
            map.flyTo({ center: [cLng, cLat], zoom: 10.6, duration: 650 });
        }, 340);
    }
    if (project && item) selectSegment(project, item, false, pmoSubId);
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
    const activePointProjects = state.projects.filter(p =>
        p.category !== "other" &&
        state.activeFolders.has(p.category || "project") &&
        state.visibleIds.has(p.id) &&
        isPointProject(p)
    );
    const legendRpsSvg = color => `<svg viewBox="0 0 20 20" width="14" height="14" style="display:block"><path d="M10 1.5L17 4.2V9.8C17 14 14 17 10 18.7C6 17 3 14 3 9.8V4.2L10 1.5Z" fill="${color}" stroke="#fff" stroke-width="1.6"/><polygon points="10,6.2 11.1,8.6 13.7,8.9 11.8,10.7 12.3,13.2 10,11.9 7.7,13.2 8.2,10.7 6.3,8.9 8.9,8.6" fill="#fff"/></svg>`;
    const legendRadarSvg = color => `<svg viewBox="0 0 20 20" width="14" height="14" style="display:block"><circle cx="10" cy="10" r="8.5" fill="${color}" stroke="#fff" stroke-width="1.5"/><path d="M6.8 6.8 A4.8 4.8 0 0 1 13.2 6.8" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><path d="M4.8 4.8 A7.6 7.6 0 0 1 15.2 4.8" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/><circle cx="10" cy="11.5" r="2" fill="#fff"/></svg>`;
    const legendTsBadge = color => `<span style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:14px;border-radius:3px;background:${color};border:1.3px solid #fff;color:#fff;font-size:7.5px;font-weight:800;line-height:1;letter-spacing:-0.3px">TŞ</span>`;
    const legendCerimeBadge = color => `<span style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:14px;border-radius:3px;background:${color};border:1.3px solid #fff;color:#FACC15;font-size:8.5px;font-weight:900;line-height:1">P</span>`;
    const legendCamSvg = color => `<svg viewBox="0 0 20 20" width="14" height="14" style="display:block"><circle cx="10" cy="10" r="8.5" fill="${color}" stroke="#fff" stroke-width="1.5"/><rect x="5.5" y="7" width="9" height="6.5" rx="1.2" fill="#0F172A"/><circle cx="10" cy="10.2" r="2.2" fill="none" stroke="#fff" stroke-width="1.3"/></svg>`;
    const legendFaceSvg = color => `<svg viewBox="0 0 20 20" width="14" height="14" style="display:block"><circle cx="10" cy="10" r="8.5" fill="${color}" stroke="#fff" stroke-width="1.5"/><circle cx="10" cy="8.2" r="2.2" fill="#fff"/><path d="M6.5 14.2 A3.8 3.8 0 0 1 13.5 14.2" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`;
    const renderVisBadgeHtml = (vis, tone) => {
        const c = vis.pillColor || tone;
        if (vis.legendType === "rps") return legendRpsSvg(c);
        if (vis.legendType === "radar") return legendRadarSvg(c);
        if (vis.legendType === "ts") return legendTsBadge(c);
        if (vis.legendType === "cerime") return legendCerimeBadge(c);
        if (vis.legendType === "cam") return legendCamSvg(c);
        if (vis.legendType === "face") return legendFaceSvg(c);
        const sym = vis.shapeObj?.symbol || "●";
        return `<span style="color:${c}">${sym}</span>`;
    };

    const pointProjectsHtml = activePointProjects.length > 0
        ? `<div class="legend-divider"></div><div class="legend-sec-title">Nöqtə layihələri</div>` +
          activePointProjects.map(p => {
              const cleanProjName = cleanProjectName(p.name, p.sheetId || p.pmoMeta?.sheetId).replace(/\s*\(?\bFaz[-\s]*[12]\b\)?/gi, "").trim();
              const tone = statusTone(p.status);
              const ptTypes = getProjectPointTypes(p);
              if (ptTypes.length > 0) {
                  return ptTypes.map(pt => {
                      const sampleItem = p.items.find(it => extractPointType(it.props, it).toLocaleLowerCase("az") === pt.toLocaleLowerCase("az"));
                      const sh = sampleItem ? getItemShape(p, sampleItem) : getProjectShape(p);
                      const stTone = sampleItem ? statusTone(sampleItem.status) : tone;
                      const label = `${cleanProjName} (${pt})`;
                      return `<div class="legend-row" title="${esc(label)}"><span class="legend-shape-badge" style="color:${stTone}">${sh.symbol}</span><span class="legend-proj-name">${esc(pt)}</span></div>`;
                  }).join("");
              }
              const shape = getProjectShape(p);
              const rows = [`<div class="legend-row" title="${esc(cleanProjName)}"><span class="legend-shape-badge" style="color:${tone}">${shape.symbol}</span><span class="legend-proj-name">${esc(cleanProjName)}</span></div>`];

              // Layihə daxilində fərqli ikonlu nöqtə növlərini (Radar, TŞ, RPŞ, Cərimə meydançası, Smart kamera, Üztanıma, Obyekt və s.) avtomatik topla və şərti işarədə göstər
              const subVisMap = new Map();
              (p.items || []).forEach(it => {
                  if (it.isMagistral) return;
                  const rVis = resolvePmoPointVisual(p, it, null);
                  if (rVis.key !== "base" && !subVisMap.has(rVis.key)) {
                      subVisMap.set(rVis.key, rVis);
                  }
                  (it.pmoRayon?.subPoints || []).forEach(sp => {
                      const spVis = resolvePmoPointVisual(p, it, sp);
                      if (spVis.key !== "base" && !subVisMap.has(spVis.key)) {
                          subVisMap.set(spVis.key, spVis);
                      }
                  });
              });

              for (const vis of subVisMap.values()) {
                  rows.push(`<div class="legend-row" style="padding-left:14px;opacity:.94" title="${esc(cleanProjName)} — ${esc(vis.label)}"><span class="legend-shape-badge">${renderVisBadgeHtml(vis, tone)}</span><span class="legend-proj-name">${esc(vis.label)}</span></div>`);
              }
              return rows.join("");
          }).join("")
        : "";

    // 🗂️ Digər qovluğu: yalnız RM xətlərinin rəngləri və adları (Xəzər dənizi, Rayon sərhədləri və digərləri daxil edilmir)
    const otherProjects = state.projects.filter(p =>
        p.category === "other" &&
        state.activeFolders.has("other") &&
        state.visibleIds.has(p.id)
    );
    const isRmText = str => /\brm\b|\brm[-\s_\d]|\d+[-\s_]*rm\b/i.test(String(str || ""));
    const rmItems = [];
    const seenRm = new Set();
    otherProjects.forEach(p => {
        const projClean = String(p.name || "").replace(/^Digər\s*:\s*/i, "").trim();
        const projIsRm = isRmText(projClean);
        (p.items || []).forEach(r => {
            const rawOtherName = String(r.name || "").replace(/^Digər\s*:\s*/i, "").trim();
            const isGenericOther = /^(?:idxal\s*x[əe]tti|imported\s*line|x[əe]tt|line|imp|ply|poliqon)[-\s]*\d*$/i.test(rawOtherName);
            const displayName = (!isGenericOther && rawOtherName) ? rawOtherName : (projClean || rawOtherName);
            if (!displayName) return;
            if (!isRmText(displayName) && !projIsRm) return;
            if (/(x[əe]z[əe]r|caspian|d[əe]niz|rayon\s*s[əe]rh[əe]d)/i.test(displayName)) return;
            const color = normalizeColorCode(r.customColor || p.customColor, "#38BDF8");
            const key = `${displayName.toLocaleLowerCase("az")}_${color}`;
            if (!seenRm.has(key)) {
                seenRm.add(key);
                rmItems.push({ name: displayName, color });
            }
        });
    });

    const focusedProjId = state.selected?.projectId || window.__activeProjectId || null;
    const focusedProj = focusedProjId ? state.projects.find(p => p.id === focusedProjId && state.activeFolders.has(p.category || "project")) : null;
    const onlyOtherActive = state.activeFolders.size === 1 && state.activeFolders.has("other");

    if (onlyOtherActive || focusedProj?.category === "other") {
        $("legend").innerHTML = rmItems.map(rm =>
            `<div class="legend-row"><span class="legend-line" style="background:${rm.color}"></span><span>${esc(rm.name)}</span></div>`
        ).join("");
        return;
    }

    const rmHtml = rmItems.length > 0
        ? `<div class="legend-divider"></div>`
          + rmItems.map(rm => `<div class="legend-row"><span class="legend-line" style="background:${rm.color}"></span><span>${esc(rm.name)}</span></div>`).join("")
        : "";

    $("legend").innerHTML = STATUSES.filter(s => s !== "tehvil").map(s => `<div class="legend-row"><span class="legend-line" style="background:${STATUS_COLORS[s]}"></span>${t(`status${s}`)}</div>`).join("")
        + rmHtml
        + pointProjectsHtml;
}

function statusTone(status) {
    return STATUS_COLORS[status] || STATUS_COLORS.layihe;
}

function renderChips() {
    const noFolderActive = state.activeFolders.size === 0;
    const focusedProjId = state.selected?.projectId || window.__activeProjectId || null;
    const focusedProj = focusedProjId ? state.projects.find(p => p.id === focusedProjId && state.activeFolders.has(p.category || "project")) : null;

    let poolProjects = [];
    let showDashes = false;

    if (noFolderActive) {
        showDashes = true;
    } else if (focusedProj) {
        if (focusedProj.category === "other") showDashes = true;
        else poolProjects = [focusedProj];
    } else {
        poolProjects = state.projects.filter(p => state.activeFolders.has(p.category || "project") && p.category !== "other" && state.visibleIds.has(p.id));
        if (poolProjects.length === 0) showDashes = true;
    }

    const items = poolProjects.flatMap(p => p.items);
    const count = key => showDashes ? "-" : (key === "all" ? items.length : items.filter(r => r.status === key).length);
    const chips = [{ key: "all", label: t("filterAll") }, ...STATUSES.map(s => ({ key: s, label: t(`status${s}`), color: STATUS_COLORS[s] }))];
    const hasFilter = hasActiveStatusFilter();
    $("statusChips").innerHTML = chips.map(c => {
        const isActive = c.key === "all" ? !hasFilter : state.statusFilters.has(c.key);
        const toneStyle = c.color ? `style="--chip-tone:${c.color}"` : "";
        const tipText = c.key === "all" ? c.label : `${c.label} (bir neçə statusu eyni anda seçmək olar)`;
        return `
        <button class="chip ${isActive ? "active" : ""}" data-status="${c.key}" ${toneStyle} title="${esc(tipText)}" aria-pressed="${isActive}">
            ${c.color ? `<span class="dot" style="background:${c.color}"></span>` : `${esc(c.label)} `}<b>${count(c.key)}</b>
        </button>`;
    }).join("");
}

function renderKpis() {
    const sum = totals(visibleEntries().filter(e => e.project.category !== "other").map(e => e.item));
    const left = Math.max(0, sum.plan - sum.done);
    const pct = percent(sum.done, sum.plan);
    const kpi = (label, value, unit) => `<div class="kpi"><small>${label}</small><b>${value}<em>${unit}</em></b></div>`;

    $("kpis").innerHTML = kpi(t("kpiTotal"), formatKm(sum.plan), "km") + kpi(t("kpiDone"), formatKm(sum.done), "km")
        + kpi(t("kpiLeft"), formatKm(left), "km") + kpi(t("kpiProgress"), pct, "%");
    $("totalProgress").style.width = `${pct}%`;
    $("drawerSummary").textContent = `${formatKm(sum.done)} / ${formatKm(sum.plan)} km · ${pct}%`;
}

function renderProjects() {
    const projectsOnly = state.projects.filter(p => (p.category || "project") === "project");
    const nimOnly = state.projects.filter(p => p.category === "nim");
    const azcOnly = state.projects.filter(p => p.category === "azconnect");
    const otherOnly = state.projects.filter(p => p.category === "other");

    if ($("tabProjectsCount")) $("tabProjectsCount").textContent = projectsOnly.length;
    if ($("tabNimCount")) $("tabNimCount").textContent = nimOnly.length;
    if ($("tabAzconnectCount")) $("tabAzconnectCount").textContent = azcOnly.length;
    if ($("tabOtherCount")) $("tabOtherCount").textContent = otherOnly.length;

    document.querySelectorAll("[data-folder-tab]").forEach(btn => {
        const f = btn.dataset.folderTab;
        btn.classList.toggle("active", state.activeFolders.has(f));
    });
    // Fiber optik kabel: hər qovluğun lifi qovluqla birlikdə aktiv/passiv olur
    document.querySelectorAll("[data-fo-group], [data-fo-core], [data-fo-led]").forEach(el => {
        const f = el.dataset.foGroup || el.dataset.foCore || el.dataset.foLed;
        el.classList.toggle("active", state.activeFolders.has(f));
    });
    $("foStatusCoupler")?.classList.toggle("active", state.activeFolders.size > 0);
    document.querySelector("#listView .filters")?.classList.toggle("fo-fed", state.activeFolders.size > 0);

    const onlyOtherActive = state.activeFolders.size === 1 && state.activeFolders.has("other");
    const hasNonOtherActive = [...state.activeFolders].some(f => f !== "other");
    const filtersBox = document.querySelector("#listView .filters");
    if (filtersBox) filtersBox.hidden = !hasNonOtherActive;
    if ($("statusChips")) $("statusChips").hidden = onlyOtherActive || !hasNonOtherActive;
    if ($("addProjectBtn")) $("addProjectBtn").hidden = !isAdmin() || state.activeFolders.size === 0;

    const folderMeta = {
        project: { title: "<i class=\"fa-solid fa-building\"></i> BCG", list: projectsOnly },
        nim: { title: "<i class=\"fa-solid fa-traffic-light\" style=\"color:#f59e0b\"></i> NİİM (Svetofor Kəsişmələri)", list: nimOnly },
        azconnect: { title: "<i class=\"fa-solid fa-globe\" style=\"color:#06b6d4\"></i> Azərconnect Xətləri", list: azcOnly },
        other: { title: "<i class=\"fa-solid fa-folder-tree\" style=\"color:#a855f7\"></i> Digər", list: otherOnly }
    };

    const activeOrder = ["project", "nim", "azconnect", "other"].filter(f => state.activeFolders.has(f));
    const FOLDER_FIBER_COLORS = { project: "#38bdf8", nim: "#f59e0b", azconnect: "#06b6d4", other: "#a855f7" };
    $("listView")?.classList.toggle("has-active-fibers", state.activeFolders.size > 0);
    if (activeOrder.length === 0) {
        if ($("listHeadTitle")) $("listHeadTitle").textContent = "Qovluq seçilməyib";
        $("projectCount").textContent = "-";
        $("projectList").innerHTML = `<div class="empty">Yuxarıdakı yarım dairədən qovluq seçin (🏢 BCG, 🚦 NİİM, 🌐 Azərconnect, 🗂️ Digər)</div>`;
        if (typeof window.refreshProjectRoller === "function") {
            window.refreshProjectRoller({ empty: true, sig: "" });
        }
        return;
    }

    if ($("listHeadTitle")) {
        $("listHeadTitle").innerHTML = activeOrder.length === 1
            ? folderMeta[activeOrder[0]].title
            : "Layihələr";
    }
    if ($("addProjectBtn")) { $("addProjectBtn").textContent = "+ Yeni"; $("addProjectBtn").title = t("addProject"); }
    if ($("showAllBtn")) { $("showAllBtn").textContent = "Göstər"; $("showAllBtn").title = t("showAll"); }
    if ($("hideAllBtn")) { $("hideAllBtn").textContent = "Gizlət"; $("hideAllBtn").title = t("hideAll"); }

    const showGroupHead = activeOrder.length > 1;
    const filtering = hasActiveStatusFilter() || Boolean(state.query);
    let totalShownCount = 0;
    const sectionsHtml = [];

    activeOrder.forEach(folderKey => {
        const pool = folderMeta[folderKey].list;
        if (folderKey === "other") {
            const shownOther = pool.filter(p => !state.query || p.name.toLocaleLowerCase("az").includes(state.query) || p.items.some(i => String(i.name || "").toLocaleLowerCase("az").includes(state.query)));
            totalShownCount += shownOther.length;
            if (showGroupHead) {
                sectionsHtml.push(`<div class="folder-group-head"><span>${folderMeta[folderKey].title}</span><span>${shownOther.length}</span></div>`);
            }
            if (shownOther.length === 0) {
                sectionsHtml.push(`<div class="empty">${t("noResults")}</div>`);
                return;
            }
            sectionsHtml.push(shownOther.map(p => {
                const visible = state.visibleIds.has(p.id);
                const expanded = state.expandedIds.has(p.id);
                const cleanOtherTitle = String(p.name || "").replace(/^Digər\s*:\s*/i, "").trim();
                return `
                    <div class="project fiber-linked ${visible ? "" : "hidden-on-map"} ${expanded ? "expanded" : ""}" data-id="${esc(p.id)}" style="--proj-tone:#a855f7;--fiber-tone:${FOLDER_FIBER_COLORS.other}">
                        <div class="project-row" style="padding:6px 10px">
                            <label class="check" title="${t("toggleVisibility")}"><input type="checkbox" data-action="toggle" ${visible ? "checked" : ""}></label>
                            <button class="project-main" data-action="expand" aria-expanded="${expanded}">
                                <strong title="${esc(cleanOtherTitle)}">${esc(cleanOtherTitle)}</strong>
                            </button>
                            <span class="project-pct" style="color:#38BDF8">${p.items.length}</span>
                            ${isAdmin() && !p.isPmo ? `<button class="icon-btn" data-action="edit" title="${t("editProject")}"><i class="fa-solid fa-pen"></i></button>` : ""}
                            <button class="icon-btn" data-action="expand" aria-label="${esc(cleanOtherTitle)}"><i class="fa-solid fa-chevron-right chevron ${expanded ? "open" : ""}"></i></button>
                        </div>
                        ${expanded ? `<div class="segments">${p.items.map(r => `
                            <div class="segment ${state.selected?.itemId === r.id && state.selected?.projectId === p.id ? "selected" : ""}" style="display:flex;align-items:center;gap:6px;padding-right:6px">
                                <button type="button" style="flex:1;display:flex;align-items:center;gap:8px;background:none;border:0;color:inherit;text-align:left;cursor:pointer;padding:0;min-width:0" data-action="focus" data-item="${esc(r.id)}">
                                    <span class="dot" style="background:${esc(normalizeColorCode(r.customColor || p.customColor, "#38BDF8"))}"></span>
                                    <span class="segment-name" title="${esc(r.name)}">${esc(r.name)}</span>
                                </button>
                                ${isAdmin() ? `<button type="button" class="icon-btn small" data-action="editSeg" data-item="${esc(r.id)}" title="Redaktə et"><i class="fa-solid fa-pen"></i></button>` : ""}
                            </div>
                        `).join("")}${isAdmin() ? `<button class="link add-seg" data-action="addSegment">+ ${t("addSegment")}</button>` : ""}</div>` : ""}
                    </div>`;
            }).join(""));
            return;
        }

        const shown = pool.filter(p => !filtering || filteredItems(p).length > 0);
        totalShownCount += shown.length;
        if (showGroupHead) {
            sectionsHtml.push(`<div class="folder-group-head"><span>${folderMeta[folderKey].title}</span><span>${shown.length}</span></div>`);
        }
        if (shown.length === 0) {
            sectionsHtml.push(`<div class="empty">${t("noResults")}</div>`);
            return;
        }

        sectionsHtml.push(shown.map(p => {
            const visible = state.visibleIds.has(p.id);
            const expanded = state.expandedIds.has(p.id);
            const sum = totals(p.items);
            const isNim = p.category === "nim";
            const isPoints = p.type === "points";
            const allPtsDone = isPoints && p.items.length > 0 && p.items.every(i => i.status === "bitmis" || i.status === "tehvil");
            const pct = isPoints
                ? calcPointPct(sum.done, sum.plan, (p.status === "bitmis" || p.status === "tehvil" || allPtsDone) ? "bitmis" : p.status)
                : percent(sum.done, sum.plan);
            const shape = isPointProject(p) ? getProjectShape(p) : null;
            const shapeBadge = shape ? `<span style="color:${statusTone(p.status)};margin-right:5px;font-size:13px" title="Nöqtə işarəsi: ${shape.name}">${shape.symbol}</span>` : "";
            const totalAnt = p.items.reduce((s, r) => s + (r.antennas || 0), 0);
            const cleanProjName = cleanProjectName(p.name, p.sheetId || p.pmoMeta?.sheetId).replace(/\s*\(?\bFaz[-\s]*[12]\b\)?/gi, "").trim();
            const donePts = p.items.filter(i => i.status === "bitmis" || i.status === "tehvil").length;
            const totalPlanM = Math.round(sum.plan * 1000);
            const totalDoneM = Math.round(sum.done * 1000);
            const isAllLifGoturulen = !isNim && !isPoints && (p.status === "lif_goturulen" || (p.items.length > 0 && p.items.every(it => isLifGoturulen(it, p))));
            let subTitle = isNim
                ? `${p.items.length} svetofor kəsişməsi · Hazır: ${donePts}/${p.items.length}`
                : (isPoints
                    ? `📡 ${totalAnt} antena - ${totalPlanM} / ${totalDoneM} m`
                    : (isAllLifGoturulen
                        ? `〰️ ${t("statuslif_goturulen")} (${p.items.length})`
                        : `〰️ ${formatKm(sum.plan)} / ${formatKm(sum.done)} km · Qalıb: ${formatKm(Math.max(0, sum.plan - sum.done))} km`));
            let rightPct = isNim ? `${p.items.length ? Math.round(donePts / p.items.length * 100) : 0}%` : (isAllLifGoturulen ? "" : `${pct}%`);
            let pmoExactCableHtml = "";
            let pmoInstalledHtml = "";
            let pmoConnHtml = "";

            if (p.isPmo && p.pmoMeta) {
                const pm = p.pmoMeta;
                rightPct = `${pm.overallPct}%`;

                // 1. Dəqiq verilən (Layihə) və icra olunan (çəkilən) kabel — təqribi yox, excel-də nə yazılıbsa o
                if (pm.cablePlanM > 0 || pm.cableDoneM > 0) {
                    pmoExactCableHtml = `<div style="font-weight:600;font-size:10.5px;color:#cbd5e1;margin-top:2px;line-height:1.25" title="Layihə (Verilən) / İcra olunan kabel">🔌 Kabel: ${Number(pm.cablePlanM || 0).toLocaleString("az-AZ")} / <b style="color:#4ade80">${Number(pm.cableDoneM || 0).toLocaleString("az-AZ")}</b> m</div>`;
                }

                // 2. İcra olunan nöqtə sayı
                pmoInstalledHtml = `
                    <div style="font-size:10.5px;color:var(--ink-2);margin-top:2px;display:flex;align-items:center;gap:4px 7px;flex-wrap:wrap;line-height:1.25">
                        <span style="color:var(--ink-3)">İcra olunan:</span>
                        <span style="color:#38bdf8">BCG: <b>${pm.bcgDone}</b>/${pm.bcgPlan}</span> ·
                        <span style="color:#4ade80">Avicom: <b>${pm.avicomDone}</b>/${pm.avicomPlan}</span>
                        <span style="color:var(--ink-3)">(Cəmi: <b>${pm.totalDone}</b>/${pm.totalPlan})</span>
                    </div>
                `;

                // 3. Quraşdırılma tipi
                const connParts = [];
                if (Number(pm.conn?.fo) > 0) connParts.push(`🌐 FO: <b>${pm.conn.fo}</b>`);
                if (Number(pm.conn?.g3) > 0) connParts.push(`📶 3G: <b>${pm.conn.g3}</b>`);
                if (Number(pm.conn?.ant) > 0) connParts.push(`📡 Anten: <b>${pm.conn.ant}</b>`);
                if (Number(pm.conn?.gpon) > 0) connParts.push(`GPON: <b>${pm.conn.gpon}</b>`);
                const connStr = connParts.length ? connParts.join(" · ") : "FO: 0";
                pmoConnHtml = `
                    <div style="font-size:10px;color:var(--ink-3);margin-top:1px;line-height:1.2">
                        <span>Qoşulma:</span> ${connStr}
                    </div>
                `;
            }

            const pTone = statusTone(p.status);
            const fTone = FOLDER_FIBER_COLORS[folderKey] || "#38bdf8";
            return `
                <div class="project fiber-linked ${visible ? "" : "hidden-on-map"} ${expanded ? "expanded" : ""}" data-id="${esc(p.id)}" style="--proj-tone:${pTone};--fiber-tone:${fTone}">
                    <div class="project-row">
                        <label class="check" title="${t("toggleVisibility")}"><input type="checkbox" data-action="toggle" ${visible ? "checked" : ""}></label>
                        <button class="project-main" data-action="expand" aria-expanded="${expanded}">
                            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;width:100%">
                                <span title="${esc(cleanProjName)}" style="flex:1 1 auto;min-width:0;font-weight:700;font-size:12px;line-height:1.28;white-space:normal;word-break:break-word;overflow-wrap:break-word;color:var(--ink)">
                                    ${getProjectIconHtml(p, pTone)}${esc(cleanProjName)}
                                </span>
                                ${rightPct ? `<span class="project-pct-mid" style="flex:0 0 auto;font-size:11px;font-weight:800;color:${pTone};background:rgba(255,255,255,0.07);padding:1px 6px;border-radius:5px;white-space:nowrap;text-align:center;margin-top:1px">${rightPct}</span>` : ""}
                            </div>
                            ${pmoExactCableHtml}
                            ${pmoInstalledHtml || `<small>${subTitle}</small>`}
                            ${pmoConnHtml}
                        </button>
                        ${isAdmin() && !p.isPmo ? `<button class="icon-btn" data-action="edit" title="${t("editProject")}"><i class="fa-solid fa-pen"></i></button>` : ""}
                        <button class="icon-btn" data-action="expand" aria-label="${esc(cleanProjName)}"><i class="fa-solid fa-chevron-right chevron ${expanded ? "open" : ""}"></i></button>
                    </div>
                    ${expanded ? `<div class="segments">${filteredItems(p).map(r => {
                        const rawPropName = getPropCaseInsensitive(
                            r.props,
                            "Name", "name", "kabel", "kabel_adi", "xett_adi", "xett", "LineName", "title", "ad", "marsrut", "route", "label"
                        );
                        const isGen = /^(?:idxal\s*x[əe]tti|imported\s*line|x[əe]tt|line|imp)[-\s]*\d*$/i.test(String(r.name || "").trim());
                        const cleanName = isPoints
                            ? String(r.name || "").replace(/\s*\(?\bFaz[-\s]*[12]\b\)?/gi, "").replace(/\s*rayon(u)?\b/gi, "").trim()
                            : ((!isGen && r.name) ? String(r.name).trim() : String(rawPropName || r.name || p.name || "").trim());
                        const itemShape = isPoints ? getItemShape(p, r) : shape;
                        const ptType = isPoints ? extractPointType(r.props, r) : "";
                        const ptTypeBadge = ptType
                            ? `<span style="background:rgba(56,189,248,0.14);color:#38BDF8;border:1px solid rgba(56,189,248,0.35);border-radius:5px;padding:0 5px;font-size:10px;font-weight:700;margin-left:4px;flex-shrink:0">${esc(ptType)}</span>`
                            : "";
                        const isLifSeg = !isNim && !isPoints && isLifGoturulen(r, p);
                        const segFo = (!isNim && !isPoints && !isLifSeg && Array.isArray(r.coords) && r.coords.length >= 2) ? getSegmentFiber(r, p) : "";
                        const foBadge = segFo
                            ? `<span style="background:rgba(14,165,233,0.16);color:#38BDF8;border:1px solid rgba(56,189,248,0.38);border-radius:6px;padding:1px 5px;font-size:10px;font-weight:700;margin-right:4px;flex-shrink:0">${esc(segFo)}</span>`
                            : "";
                        const execInfo = resolveItemExecDetails(r);
                        const cBrief = r.contractor
                            ? ` · 👷 ${esc(r.contractor)}${execInfo.lead ? ` (${esc(execInfo.lead)})` : ""}`
                            : "";
                        const { planM: rPlanM, doneM: rDoneM } = isPoints ? getPointMetersPair(r) : { planM: 0, doneM: 0 };
                        const segEnds = isLifSeg ? resolveLineEndNames(r, p) : null;
                        const isTemirItem = r.isPmoRayon && (r.pmoRayon?.temirMeta?.isTemirRm || String(p.sheetId || p.pmoMeta?.sheetId || "") === "15.3");
                        const rightText = isTemirItem
                            ? `${r.pmoRayon.pct}% · ${Number(r.pmoRayon.totalDone || 0).toLocaleString("az-AZ")} / ${Number(r.pmoRayon.totalPlan || 0).toLocaleString("az-AZ")}`
                            : (r.isPmoRayon && r.pmoRayon
                                ? `${r.pmoRayon.pct}% · BCG ${r.pmoRayon.bcgDone}/${r.pmoRayon.bcgPlan} · Avi ${r.pmoRayon.avicomDone}/${r.pmoRayon.avicomPlan}`
                                : (r.isMagistral
                                    ? `${r.fiber || "FO"} · ${(r.doneM || 0).toLocaleString("az-AZ")}/${(r.planM || 0).toLocaleString("az-AZ")} m`
                                    : (isNim
                                        ? t(`status${r.status}`)
                                        : (isPoints
                                            ? `${formatPointAntLabel(r.antennas, ptType)} - ${rPlanM} / ${rDoneM} m${cBrief}`
                                            : (isLifSeg
                                                 ? `📍 ${esc(segEnds.aName)} ➔ ${esc(segEnds.bName)}`
                                                 : `${formatKm(r.doneKm)} / ${formatKm(r.totalKm)} km${cBrief}`)))));
                        const qKey = `${p.id}:${r.id}`;
                        const isQuickOpen = isPoints && isAdmin() && state.quickEditKey === qKey;
                        const qContractors = [...new Set(["BCG", ...Object.keys(syncAdminContractors()), ...(r.contractor ? [r.contractor] : [])])];
                        const qSavedLeads = getSavedBcgLeads();
                        return `
                        <div class="segment-wrap" data-seg-wrap="${esc(r.id)}">
                            <div class="segment ${state.selected?.itemId === r.id && state.selected?.projectId === p.id ? "selected" : ""}" style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding-right:6px">
                                <button type="button" style="flex:1;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px 8px;background:none;border:0;color:inherit;text-align:left;cursor:pointer;padding:3px 0;min-width:0" data-action="focus" data-item="${esc(r.id)}">
                                    <span style="display:flex;align-items:center;gap:6px;min-width:0;flex:1 1 auto">
                                        ${(!isNim && !itemShape) ? `<span class="dot" style="background:${statusTone(r.status)};flex-shrink:0"></span>` : ""}
                                        <span class="segment-name" style="min-width:0;white-space:normal;word-break:break-word;line-height:1.25;font-weight:600;color:var(--ink)" title="${esc(cleanName)}">${isNim ? "🚦 " : (/rp[şs]/i.test(cleanName) ? `<i class="fa-solid fa-shield-halved" style="color:${statusTone(r.status)};margin-right:5px" title="RPŞ (Polis)"></i>` : (itemShape ? `<span style="color:${statusTone(r.status)};margin-right:4px">${itemShape.symbol}</span>` : ""))}${foBadge}${esc(cleanName)}${ptTypeBadge}</span>
                                    </span>
                                    <span style="color:${statusTone(r.status)};font-weight:600;white-space:nowrap;font-size:11px;flex-shrink:0;margin-left:auto">${rightText}</span>
                                </button>
                                ${(r.isMagistral || (Array.isArray(r.coords) && r.coords.length >= 2)) ? `
                                    <button type="button" class="icon-btn small" style="flex-shrink:0;margin-left:2px;color:#38BDF8" data-action="geomEditSeg" data-item="${esc(r.id)}" title="Xətti xəritədə redaktə et (sürüşdür / nöqtə əlavə et)"><i class="fa-solid fa-bezier-curve"></i></button>
                                ` : ""}
                                ${isAdmin() && !p.isPmo ? `
                                    <button type="button" class="icon-btn small" style="flex-shrink:0;margin-left:2px;${isQuickOpen ? "color:#38BDF8;background:rgba(56,189,248,0.16)" : ""}" data-action="${isPoints ? "quickEditSeg" : "editSeg"}" data-item="${esc(r.id)}" title="${isPoints ? "Nöqtəni redaktə et" : "Xətti və icraçını redaktə et"}"><i class="fa-solid fa-pen"></i></button>
                                ` : ""}
                            </div>
                            ${isQuickOpen ? `
                            <div class="seg-quick-box" style="margin:4px 8px 8px 18px;padding:8px;border-radius:9px;background:rgba(15,23,42,0.55);border:1px solid rgba(56,189,248,0.28);display:flex;flex-direction:column;gap:6px">
                                <div style="display:grid;grid-template-columns:0.75fr 1fr 1fr 1.1fr;gap:5px;align-items:end">
                                    <label style="display:flex;flex-direction:column;gap:2px;font-size:10px;color:var(--ink-2)">
                                        <span>Antena</span>
                                        <input class="input" type="number" step="1" min="0" data-q-ant value="${r.antennas || 0}" style="height:26px;padding:0 6px;font-size:11.5px">
                                    </label>
                                    <label style="display:flex;flex-direction:column;gap:2px;font-size:10px;color:var(--ink-2)">
                                        <span>Verilən (m)</span>
                                        <input class="input" type="number" step="any" min="0" data-q-plan value="${rPlanM}" style="height:26px;padding:0 6px;font-size:11.5px">
                                    </label>
                                    <label style="display:flex;flex-direction:column;gap:2px;font-size:10px;color:var(--ink-2)">
                                        <span>Çəkilən (m)</span>
                                        <input class="input" type="number" step="any" min="0" data-q-done value="${rDoneM}" style="height:26px;padding:0 6px;font-size:11.5px">
                                    </label>
                                    <label style="display:flex;flex-direction:column;gap:2px;font-size:10px;color:var(--ink-2)">
                                        <span>Status</span>
                                        <select class="input" data-q-status style="height:26px;padding:0 4px;font-size:11px">
                                            ${STATUSES.map(s => `<option value="${s}" ${r.status === s ? "selected" : ""}>${t("status" + s)}</option>`).join("")}
                                        </select>
                                    </label>
                                </div>
                                <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;align-items:end">
                                    <label style="display:flex;flex-direction:column;gap:2px;font-size:10px;color:var(--ink-2)">
                                        <span>Nöqtə növü:</span>
                                        <input class="input" type="text" data-q-pttype value="${esc(ptType)}" placeholder="Məs: GPON, Faz-1..." style="height:25px;padding:0 6px;font-size:11px">
                                    </label>
                                    <label style="display:flex;flex-direction:column;gap:2px;font-size:10px;color:var(--ink-2)">
                                        <span>İcraçı:</span>
                                        <select class="input" data-q-exec style="height:25px;padding:0 4px;font-size:11px">
                                            <option value="">— Seçilməyib —</option>
                                            ${qContractors.map(cName => `<option value="${esc(cName)}" ${r.contractor === cName ? "selected" : ""}>${cName === "BCG" ? "🏢 BCG" : esc(cName)}</option>`).join("")}
                                        </select>
                                    </label>
                                </div>
                                <div data-q-bcg-box style="display:${isBcgContractor(r.contractor) ? "grid" : "none"};grid-template-columns:1.25fr 0.65fr 1fr;gap:5px;align-items:end;padding:5px 6px;border-radius:7px;background:rgba(14,165,233,0.08);border:1px dashed rgba(56,189,248,0.3)">
                                    <label style="display:flex;flex-direction:column;gap:2px;font-size:10px;color:#38BDF8">
                                        <span>👷 Kim işləyib (Mühəndis)</span>
                                        <input class="input" type="text" list="qLeadList_${esc(r.id)}" data-q-lead value="${esc(r.execLead || "")}" placeholder="Ad Soyad..." style="height:24px;padding:0 5px;font-size:11px">
                                        <datalist id="qLeadList_${esc(r.id)}">
                                            ${qSavedLeads.map(l => `<option value="${esc(l.name)}">${l.workers ? `${esc(l.workers)} nəfər` : ""}${l.phone ? ` · ${esc(l.phone)}` : ""}</option>`).join("")}
                                        </datalist>
                                    </label>
                                    <label style="display:flex;flex-direction:column;gap:2px;font-size:10px;color:#38BDF8">
                                        <span>👥 Neçə nəfər</span>
                                        <input class="input" type="number" min="0" step="1" data-q-wrk value="${esc(r.execWorkers || "")}" placeholder="Say" style="height:24px;padding:0 5px;font-size:11px">
                                    </label>
                                    <label style="display:flex;flex-direction:column;gap:2px;font-size:10px;color:#38BDF8">
                                        <span>📞 Əlaqə nömrəsi</span>
                                        <input class="input" type="text" data-q-phone value="${esc(r.execPhone || "")}" placeholder="+994..." style="height:24px;padding:0 5px;font-size:11px">
                                    </label>
                                </div>
                                <div style="display:flex;align-items:center;justify-content:space-between;gap:5px;flex-wrap:wrap">
                                    <div style="display:flex;gap:4px">
                                        <button type="button" class="btn btn-outline" style="height:25px;padding:0 8px;font-size:11px" data-action="geomEditSeg" data-item="${esc(r.id)}" title="Nöqtəni xəritədə sürüşdür">
                                            <i class="fa-solid fa-arrows-up-down-left-right"></i> Sürüşdür
                                        </button>
                                        <button type="button" class="btn btn-outline" style="height:25px;padding:0 8px;font-size:11px" data-action="editSeg" data-item="${esc(r.id)}" title="Tam redaktə pəncərəsi">
                                            <i class="fa-solid fa-sliders"></i> Ətraflı
                                        </button>
                                    </div>
                                    <div style="display:flex;gap:5px">
                                        <button type="button" class="btn btn-outline" style="height:25px;padding:0 8px;font-size:11px" data-action="quickEditSeg" data-item="${esc(r.id)}">Bağla</button>
                                        <button type="button" class="btn btn-primary" style="height:25px;padding:0 10px;font-size:11px" data-action="saveQuickSeg" data-item="${esc(r.id)}">
                                            <i class="fa-solid fa-check"></i> Saxla
                                        </button>
                                    </div>
                                </div>
                            </div>` : ""}
                        </div>`;
                    }).join("")}${isAdmin() ? `<button class="link add-seg" data-action="addSegment">+ ${t("addSegment")}</button>` : ""}</div>` : ""}
                </div>`;
        }).join(""));
    });

    $("projectCount").textContent = totalShownCount;
    const listEl = $("projectList");
    const prevScrollTop = listEl ? listEl.scrollTop : 0;
    const rollerSig = `${activeOrder.join(",")}|${statusFilterSignature()}|${state.query || ""}`;
    if (listEl) {
        listEl.innerHTML = `<div class="fiber-bus-wrap">${sectionsHtml.join("")}</div>`;
    }
    if (typeof window.refreshProjectRoller === "function") {
        window.refreshProjectRoller({ empty: totalShownCount === 0, sig: rollerSig, prevScrollTop });
    }
}

const NIM_SPEC_FIELDS = [
    { key: "poleA", label: "A-tipli dirək", unit: "əd", step: 1, icon: "fa-ruler-vertical" },
    { key: "poleL", label: "L-tipli dirək", unit: "əd", step: 1, icon: "fa-turn-up" },
    { key: "pedSig", label: "Piyada işıqforu", unit: "əd", step: 1, icon: "fa-person-walking" },
    { key: "vehSig", label: "Nəqliyyat işıqforu", unit: "əd", step: 1, icon: "fa-traffic-light" },
    { key: "opticM", label: "Optik çəkiliş", unit: "m", step: 10, icon: "fa-wave-square" },
    { key: "elecM", label: "Elektrik çəkilişi", unit: "m", step: 10, icon: "fa-bolt" }
];

const NIM_STAGES = [
    { key: "bunovre", label: "Bünövrə" },
    { key: "cekilis", label: "Optik / Elektrik" },
    { key: "direk", label: "Dirəklər (A/L)" },
    { key: "qurasdirma", label: "İşıqfor / Kontroller" },
    { key: "tehvil", label: "Test / Təhvil" }
];

const NIM_CTRL_LABELS = {
    yoxdur: "Yoxdur",
    bunovre: "Bünövrə",
    montaj: "Montaj olunub",
    qosulub: "Qoşulub (Hazır)"
};

function normalizeNimSpec(r) {
    const raw = (r && r.nimSpec && typeof r.nimSpec === "object") ? r.nimSpec : {};
    const pair = k => {
        const p = raw[k] && typeof raw[k] === "object" ? raw[k] : {};
        return {
            plan: Math.max(0, Number(p.plan) || 0),
            done: Math.max(0, Number(p.done) || 0)
        };
    };
    const st = raw.stages && typeof raw.stages === "object" ? raw.stages : {};
    return {
        poleA: pair("poleA"),
        poleL: pair("poleL"),
        pedSig: pair("pedSig"),
        vehSig: pair("vehSig"),
        opticM: pair("opticM"),
        elecM: pair("elecM"),
        controller: NIM_CTRL_LABELS[raw.controller] ? raw.controller : "yoxdur",
        stages: {
            bunovre: Boolean(st.bunovre),
            cekilis: Boolean(st.cekilis),
            direk: Boolean(st.direk),
            qurasdirma: Boolean(st.qurasdirma),
            tehvil: Boolean(st.tehvil)
        },
        note: String(raw.note || "")
    };
}

function calcNimProgress(r) {
    const spec = normalizeNimSpec(r);
    const doneStages = NIM_STAGES.filter(s => spec.stages[s.key]).length;
    let planSum = 0;
    let doneSum = 0;
    NIM_SPEC_FIELDS.forEach(f => {
        const p = spec[f.key];
        if (p.plan > 0) {
            planSum += 1;
            doneSum += Math.min(1, p.done / p.plan);
        }
    });
    const hasData = doneStages > 0 || planSum > 0 || spec.controller !== "yoxdur";
    if (!hasData) {
        const fallback = (r?.status === "bitmis" || r?.status === "tehvil") ? 100 : (r?.status === "icrada" ? 35 : 0);
        return { pct: fallback, doneStages, totalStages: NIM_STAGES.length, hasData: false };
    }
    const stageRatio = doneStages / NIM_STAGES.length;
    const equipRatio = planSum > 0 ? (doneSum / planSum) : stageRatio;
    const pct = Math.min(100, Math.round((stageRatio * 0.5 + equipRatio * 0.5) * 100));
    return { pct, doneStages, totalStages: NIM_STAGES.length, hasData: true };
}

function summarizeNimItems(items) {
    const sum = {
        poleA: { plan: 0, done: 0 },
        poleL: { plan: 0, done: 0 },
        pedSig: { plan: 0, done: 0 },
        vehSig: { plan: 0, done: 0 },
        opticM: { plan: 0, done: 0 },
        elecM: { plan: 0, done: 0 },
        ctrlReady: 0
    };
    (items || []).forEach(r => {
        const s = normalizeNimSpec(r);
        NIM_SPEC_FIELDS.forEach(f => {
            sum[f.key].plan += s[f.key].plan;
            sum[f.key].done += s[f.key].done;
        });
        if (s.controller === "qosulub") sum.ctrlReady += 1;
    });
    return sum;
}

function formatNimCompactSummary(r) {
    const s = normalizeNimSpec(r);
    const parts = [];
    if (s.poleA.plan || s.poleA.done) parts.push(`A:${s.poleA.done}/${s.poleA.plan}`);
    if (s.poleL.plan || s.poleL.done) parts.push(`L:${s.poleL.done}/${s.poleL.plan}`);
    if (s.pedSig.plan || s.pedSig.done) parts.push(`Piy:${s.pedSig.done}/${s.pedSig.plan}`);
    if (s.vehSig.plan || s.vehSig.done) parts.push(`Nəq:${s.vehSig.done}/${s.vehSig.plan}`);
    if (s.opticM.plan || s.opticM.done) parts.push(`Opt:${s.opticM.done}/${s.opticM.plan}m`);
    if (s.elecM.plan || s.elecM.done) parts.push(`Elk:${s.elecM.done}/${s.elecM.plan}m`);
    return parts.join(" · ");
}

async function persistNimItem(proj, item) {
    if (!proj || !item) return;
    saveSegmentOverride(proj.id, item);
    saveImportedProjects();
    if (isAdmin() && api.configured) {
        try {
            await api.saveSegment(proj.id, item.dbId || item.id, { status: item.status }, { nim: item.nimSpec });
        } catch {}
    }
}

function renderDetail() {
    const entry = selectedEntry();
    $("listView").hidden = Boolean(entry);
    $("detailView").hidden = !entry;
    if (!entry) return;

    const { project, item: r } = entry;
    const tone = statusTone(r.status);
    const { planKm: dPlanKm, doneKm: dDoneKm } = isPointItemRecord(r) ? getPointKmPair(r) : { planKm: r.totalKm, doneKm: r.doneKm };
    const pct = percent(dDoneKm, dPlanKm);
    const info = findContractorInfo(r.contractor);
    const isLineSeg = Array.isArray(r.coords) && r.coords.length >= 2 && project.type !== "points" && project.category !== "nim";
    const isLifSeg = isLineSeg && isLifGoturulen(r, project);
    const foText = (isLineSeg && !isLifSeg) ? getSegmentFiber(r, project) : "";
    const ends = resolveLineEndNames(r, project);
    const rawPropName = getPropCaseInsensitive(
        r.props,
        "Name", "name", "kabel", "kabel_adi", "xett_adi", "xett", "LineName", "title", "ad", "marsrut", "route", "label"
    );
    const isGen = /^(?:idxal\s*x[əe]tti|imported\s*line|x[əe]tt|line|imp)[-\s]*\d*$/i.test(String(r.name || "").trim());
    const displayName = (!isGen && r.name) ? String(r.name).trim() : String(rawPropName || r.name || project.name || "").trim();
    const row = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;

    $("detailView").innerHTML = `
        <div class="detail-head">
            <button class="icon-btn" data-action="back" title="${t("backToList")}"><i class="fa-solid fa-arrow-left"></i></button>
            <span>${t("backToList")}</span>
        </div>
        <div class="detail-body">
            <div class="detail-title">
                <small>${esc(r.id)} · ${esc(project.name)}</small>
                <h2>${esc(displayName)}</h2>
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                    <span class="pill" style="--tone:${tone}"><span class="dot" style="background:${tone}"></span>${t(`status${r.status}`)}</span>
                    ${foText ? `<span class="pill" style="--tone:#0EA5E9;background:rgba(14,165,233,0.16);color:#38BDF8;border:1px solid rgba(56,189,248,0.45)">🔌 ${esc(foText)}</span>` : ""}
                </div>
            </div>
            <div class="route">
                <i class="fa-solid fa-location-dot" style="color:${tone}"></i><strong>${esc(ends.aName || displayName)}</strong>
                <span class="stem"></span><span></span>
                <i class="fa-solid fa-location-dot" style="color:${tone}"></i><strong>${esc(ends.bName || displayName)}</strong>
            </div>
            ${project.category === "nim" ? (() => {
                const ns = normalizeNimSpec(r);
                const np = calcNimProgress(r);
                const doneStageNames = NIM_STAGES.filter(s => ns.stages[s.key]).map(s => s.label);
                return `
            <div>
                <div class="meter-row"><b>${np.pct}%</b><span class="muted">${np.doneStages} / ${np.totalStages} mərhələ</span></div>
                <div class="progress"><span style="width:${np.pct}%;background:${tone}"></span></div>
            </div>
            <dl class="spec">
                ${row("A-tipli dirək", `${ns.poleA.done} / ${ns.poleA.plan} əd`)}
                ${row("L-tipli dirək", `${ns.poleL.done} / ${ns.poleL.plan} əd`)}
                ${row("Piyada işıqforu", `${ns.pedSig.done} / ${ns.pedSig.plan} əd`)}
                ${row("Nəqliyyat işıqforu", `${ns.vehSig.done} / ${ns.vehSig.plan} əd`)}
                ${row("Optik çəkiliş", `${ns.opticM.done} / ${ns.opticM.plan} m`)}
                ${row("Elektrik çəkilişi", `${ns.elecM.done} / ${ns.elecM.plan} m`)}
                ${row("Kontroller şkafı", esc(NIM_CTRL_LABELS[ns.controller] || "Yoxdur"))}
                ${doneStageNames.length ? row("Hazır mərhələlər", esc(doneStageNames.join(", "))) : ""}
                ${ns.note ? row("Qeyd", esc(ns.note)) : ""}
            </dl>
            <dl class="spec">
                ${row(t("thContractor"), esc(r.contractor || t("notAssigned")))}
                ${info ? row(t("workers"), info.workers) + row(t("machinery"), info.machinery) + row(t("engineer"), esc(info.engineer)) : ""}
            </dl>`;
            })() : (isLifSeg ? "" : `
            <div>
                <div class="meter-row"><b>${pct}%</b><span class="muted">${formatKm(dPlanKm)} / ${formatKm(dDoneKm)} km</span></div>
                <div class="progress"><span style="width:${pct}%;background:${tone}"></span></div>
            </div>
            <dl class="spec">
                ${foText ? row("Kabelin lif sayı", `<b>🔌 ${esc(foText)}</b>`) : ""}
                ${row(t("thLeft"), `${formatKm(Math.max(0, dPlanKm - dDoneKm))} km`)}
                ${row(t("thDates"), `${formatDate(r.startDate)} – ${formatDate(r.endDate)}`)}
                ${row(t("closures"), r.closures || 0)}
                ${row(t("manholes"), r.manholes || 0)}
            </dl>
            <dl class="spec">
                ${row(t("thContractor"), esc(r.contractor || t("notAssigned")))}
                ${info ? row(t("workers"), info.workers) + row(t("machinery"), info.machinery) + row(t("engineer"), esc(info.engineer)) : ""}
                ${Array.isArray(r.customFields) ? r.customFields.filter(cf => cf && (cf.label || cf.value)).map(cf => row(esc(cf.label || "Məlumat"), esc(cf.value || "—"))).join("") : ""}
            </dl>`)}
            <button class="btn btn-outline" data-action="zoom"><i class="fa-solid fa-crosshairs"></i> ${t("zoomTo")}</button>
            ${isAdmin() ? `<button class="btn btn-primary" data-action="edit"><i class="fa-solid fa-pen"></i> ${t("editSegment")}</button>` : ""}
        </div>
    `;
}

function renderTable() {
    const entries = visibleEntries().filter(e => e.project.category !== "other");
    const selected = selectedEntry();
    $("drawerCount").textContent = entries.length;
    $("tableHead").innerHTML = `<tr>
        <th>${t("thRoute")}</th><th>${t("thDates")}</th><th>${t("thContractor")}</th>
        <th class="num">${t("thTotal")}</th><th class="num">${t("thDone")}</th><th class="num">${t("thLeft")}</th>
        <th>${t("thAssets")}</th><th>${t("thStatus")}</th>
    </tr>`;

    $("tableBody").innerHTML = entries.map(({ project, item: r }, index) => {
        const ends = resolveLineEndNames(r, project);
        const isLineSeg = Array.isArray(r.coords) && r.coords.length >= 2 && project.type !== "points" && project.category !== "nim";
        const segFo = isLineSeg ? getSegmentFiber(r, project) : "";
        const foBadge = segFo ? ` · <b style="color:#38BDF8">🔌 ${esc(segFo)}</b>` : "";
        const { planKm: tPlanKm, doneKm: tDoneKm } = isPointItemRecord(r) ? getPointKmPair(r) : { planKm: r.totalKm, doneKm: r.doneKm };
        const nimAssets = project.category === "nim" ? (formatNimCompactSummary(r) || "—") : `${r.closures || 0} / ${r.manholes || 0}`;
        return `
        <tr data-index="${index}" class="${selected?.item === r ? "selected" : ""}">
            <td><b>📍 ${esc(ends.aName)} ➔ 📍 ${esc(ends.bName)}</b><small>${esc(project.name)} · ${esc(r.name)}${foBadge}</small></td>
            <td>${formatDate(r.startDate)} – ${formatDate(r.endDate)}</td>
            <td>${esc(r.contractor || t("notAssigned"))}</td>
            <td class="num">${project.category === "nim" ? `${calcNimProgress(r).pct}%` : `${formatKm(tPlanKm)} km`}</td>
            <td class="num">${project.category === "nim" ? esc(NIM_CTRL_LABELS[normalizeNimSpec(r).controller] || "Yoxdur") : `${formatKm(tDoneKm)} km`}</td>
            <td class="num">${project.category === "nim" ? "—" : `${formatKm(Math.max(0, tPlanKm - tDoneKm))} km`}</td>
            <td>${esc(nimAssets)}</td>
            <td><span class="pill" style="--tone:${statusTone(r.status)}">${t(`status${r.status}`)}</span></td>
        </tr>`;
    }).join("");

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
    if (!$("materialsHead") || !$("materialsBody")) return;
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
    renderLegend();
    drawRoutes();
}

/* QEYDLƏR */
function renderNotes() {
    if ($("notesList")) {
        $("notesList").innerHTML = state.notes.length === 0
            ? `<div class="empty">${t("notesEmpty")}</div>`
            : state.notes.map(n => `
                <div class="note">
                    <p>${esc(n.text)}<small>${esc(n.author)} · ${new Date(n.date).toLocaleString(state.lang)}</small></p>
                    ${isAdmin() || n.userId === state.user?.id ? `<button class="icon-btn small" data-id="${n.id}" title="${t("delete")}"><i class="fa-solid fa-trash"></i></button>` : ""}
                </div>`).join("");
    }
    if ($("notesCount")) {
        $("notesCount").hidden = state.notes.length === 0;
        $("notesCount").textContent = state.notes.length;
    }
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
function normalizeKey(k) {
    return String(k || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9əıöüçşğƏİÖÜÇŞĞ]/gi, "")
        .replace(/ə/g, "e")
        .replace(/ı/g, "i")
        .replace(/ç/g, "c")
        .replace(/ş/g, "s")
        .replace(/ğ/g, "g")
        .replace(/ö/g, "o")
        .replace(/ü/g, "u");
}

function normalizeStatus(val) {
    if (!val) return "layihe";
    const s = String(val).trim().toLowerCase()
        .replace(/ə/g, "e").replace(/ı/g, "i").replace(/ç/g, "c").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ö/g, "o").replace(/ü/g, "u");
    if (s.includes("lif") || s.includes("gotur") || s.includes("icar")) return "lif_goturulen";
    if (s.includes("bit") || s.includes("tamam") || s.includes("done") || s.includes("finish")) return "bitmis";
    if (s.includes("icra") || s.includes("gedir") || s.includes("prog") || s.includes("davam")) return "icrada";
    if (s.includes("tehvil") || s.includes("teslim") || s.includes("ready") || s.includes("hazir")) return "tehvil";
    if (s.includes("layi") || s.includes("plan") || s.includes("proy")) return "layihe";
    if (s.includes("kabel")) return "layihe";
    return STATUSES.includes(s) ? s : "layihe";
}

function cleanAttrVal(val) {
    if (val === undefined || val === null) return undefined;
    const s = String(val).trim();
    if (s === "" || /^(?:<null>|null|none|yoxdur|n\/a|-+|—+)$/i.test(s)) return undefined;
    return s;
}

function parseAttrNumber(val, fallback = 0) {
    const s = cleanAttrVal(val);
    if (!s) return fallback;
    const num = Number(s.replace(/,/g, ".").replace(/[^\d.-]/g, ""));
    return isNaN(num) ? fallback : num;
}

function getPropCaseInsensitive(props, ...aliases) {
    if (!props) return undefined;
    const normMap = {};
    for (const [k, v] of Object.entries(props)) {
        normMap[normalizeKey(k)] = v;
    }
    for (const a of aliases) {
        const cleaned = cleanAttrVal(normMap[normalizeKey(a)]);
        if (cleaned !== undefined) return cleaned;
    }
    return undefined;
}

function findPropByPattern(props, pattern, excludePattern = null) {
    if (!props) return undefined;
    for (const [k, v] of Object.entries(props)) {
        if (k.startsWith("_")) continue;
        const cleaned = cleanAttrVal(v);
        if (cleaned === undefined) continue;
        const normK = normalizeKey(k);
        if (excludePattern && (excludePattern.test(normK) || excludePattern.test(k))) continue;
        if (pattern.test(normK) || pattern.test(k)) {
            return { val: cleaned, colName: k };
        }
    }
    return undefined;
}

function parseDistanceMeters(rawVal, colName = "") {
    if (rawVal === undefined || rawVal === null) return null;
    const str = String(rawVal).trim();
    if (!str || /^(?:<null>|null|none|n\/a|-+|—+)$/i.test(str)) return null;

    const normCol = normalizeKey(colName);
    const hasKm = /km/i.test(str) || /km/i.test(normCol);
    const hasM = !hasKm && (/m\b/i.test(str) || normCol.endsWith("m") || normCol === "m" || /metr/i.test(normCol));

    const num = Number(str.replace(/,/g, ".").replace(/[^\d.-]/g, ""));
    if (isNaN(num)) return null;

    if (hasKm) return Math.round(num * 1000);
    if (hasM) {
        if (num > 0 && num < 20 && !Number.isInteger(num)) {
            return Math.round(num * 1000);
        }
        return Math.round(num);
    }
    // Vahid yazılmayıbsa: 100-dən böyükdürsə metrdir (məs: 6800, 3500), kiçikdirsə km-dir (məs: 6.8, 3.5)
    return num >= 100 ? Math.round(num) : Math.round(num * 1000);
}

function parseAntennaCount(p, nameVal = "", rawDesc = "") {
    const matchAnt = findPropByPattern(p, /(antena|antenna|say|bts|^ant$|antsay)/i);
    if (matchAnt) {
        const n = parseInt(String(matchAnt.val).replace(/[^\d]/g, ""), 10);
        if (!isNaN(n)) return n;
    }
    const raw = getPropCaseInsensitive(
        p,
        "antena_say", "antena_sayi", "antena_sayı", "antenasay", "antenasayi",
        "antenna_count", "antennas", "antena", "antenna", "say", "sayi", "sayı",
        "ant_say", "antsay", "ant", "bts"
    );
    if (raw !== undefined) {
        const n = parseInt(String(raw).replace(/[^\d]/g, ""), 10);
        if (!isNaN(n)) return n;
    }
    const combined = `${nameVal || ""} ${rawDesc || ""}`;
    const m = combined.match(/(?:^|[^\d])(\d+)\s*(?:antena|antenna|ant\b|bts\b)/i);
    if (m) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n)) return n;
    }
    return 0;
}

function parsePointDistances(p, nameVal = "", rawDesc = "") {
    // 1. ArcGIS Pro sütun adları / Shapefile 10 simvol qısaltmaları üçün pattern axtarışı (məs: Kabel_veri, Kabel_ceki, Kabel_verilen_km, Kabel_verilen_m və s.)
    const matchVerilen = findPropByPattern(p, /(veril|plan|total|mesafe|uzunluq|kabelv|kabelp|kabelm|^m$|^km$|^veri|kabelveri)/i, /([çc]ekil|faktiki|done|icra|ceki)/i);
    const matchCekilen = findPropByPattern(p, /([çc]ekil|faktiki|done|icra|kabelc|kabelf|kabeld|^ceki|kabelceki)/i, /(veril|plan|total|veri)/i);

    let planMeters = matchVerilen ? parseDistanceMeters(matchVerilen.val, matchVerilen.colName) : null;
    let doneMeters = matchCekilen ? parseDistanceMeters(matchCekilen.val, matchCekilen.colName) : null;

    // 2. Dəqiq ləqəblər üzrə fallback
    if (planMeters === null) {
        const rawVerilen = getPropCaseInsensitive(
            p,
            "kabel_verilen_m", "kabel_verilen_km", "kabel_verilen", "kabel_veri", "verilen_m", "verilen_km", "verilen",
            "kabel_plan_m", "kabel_plan_km", "kabel_plan", "plan_m", "plan_km", "plan",
            "kabel_m", "kabel_km", "kabel", "mesafe_m", "mesafe_km", "mesafe", "uzunluq_m", "uzunluq_km", "uzunluq",
            "total_m", "total_km", "totalm", "totalkm", "m", "km"
        );
        if (rawVerilen !== undefined) planMeters = parseDistanceMeters(rawVerilen);
    }
    if (doneMeters === null) {
        const rawCekilen = getPropCaseInsensitive(
            p,
            "kabel_cekilen_m", "kabel_çəkilən_m", "kabel_cekilen_km", "kabel_çəkilən_km", "kabel_cekilen", "kabel_çəkilən",
            "kabel_ceki", "cekilen_m", "çəkilən_m", "cekilen_km", "çəkilən_km", "cekilen", "çəkilən",
            "kabel_faktiki_m", "kabel_faktiki_km", "kabel_faktiki", "faktiki_m", "faktiki_km", "faktiki",
            "done_m", "done_km", "done", "icra_m", "icra_km", "icra"
        );
        if (rawCekilen !== undefined) doneMeters = parseDistanceMeters(rawCekilen);
    }

    // 3. Əgər sütunlarda tapılmazsa: ad və ya description daxilindəki mətni oxu (məs: "6.8 km - 3.5 km" və ya "6800 - 3500")
    if (planMeters === null || doneMeters === null) {
        const combined = `${nameVal || ""} ${rawDesc || ""}`;
        const rangeMatch = combined.match(/(\d+(?:[.,]\d+)?)\s*(km|m)?\s*[-–/]\s*(\d+(?:[.,]\d+)?)\s*(km|m)?/i);
        if (rangeMatch) {
            const v1 = rangeMatch[1];
            const u1 = rangeMatch[2] || rangeMatch[4] || "";
            const v2 = rangeMatch[3];
            const u2 = rangeMatch[4] || rangeMatch[2] || "";
            if (planMeters === null) planMeters = parseDistanceMeters(v1 + u1);
            if (doneMeters === null) doneMeters = parseDistanceMeters(v2 + u2);
        }
        if (planMeters === null) {
            const mv = combined.match(/(?:veril[^\d:=]*|plan[^\d:=]*|kabel[^\d:=]*veril[^\d:=]*)[:=\s]+(\d+(?:[.,]\d+)?)\s*(km|m)?/i);
            if (mv) planMeters = parseDistanceMeters(mv[1] + (mv[2] || ""));
        }
        if (doneMeters === null) {
            const mc = combined.match(/(?:[çc]ekil[^\d:=]*|faktiki[^\d:=]*|kabel[^\d:=]*[çc]ekil[^\d:=]*|icra[^\d:=]*)[:=\s]+(\d+(?:[.,]\d+)?)\s*(km|m)?/i);
            if (mc) doneMeters = parseDistanceMeters(mc[1] + (mc[2] || ""));
        }
    }

    return {
        planMeters: planMeters !== null ? planMeters : 0,
        doneMeters: doneMeters !== null ? doneMeters : 0
    };
}

function linesFromGeoJson(data) {
    const items = [];
    const addGeometry = (geometry, props = {}) => {
        if (!geometry) return;
        const name = getPropCaseInsensitive(
            props,
            "Name", "name", "xett_adi", "xett", "title", "ad", "rayon", "rayon_adi",
            "NAME_1", "NAME_2", "NAME_AZ", "ADM2_AZ", "ADM2_EN", "ADM1_AZ", "sheher", "bolge", "label", "layihe_adi"
        ) || "";
        if (geometry.type === "Point") {
            const [lng, lat] = geometry.coordinates;
            items.push({ isPoint: true, isPolygon: false, name, props, coords: [[lat, lng]] });
        } else if (geometry.type === "MultiPoint") {
            geometry.coordinates.forEach(([lng, lat]) => items.push({ isPoint: true, isPolygon: false, name, props, coords: [[lat, lng]] }));
        } else if (geometry.type === "LineString") {
            items.push({ isPoint: false, isPolygon: false, name, props, coords: geometry.coordinates.map(c => [c[1], c[0]]) });
        } else if (geometry.type === "MultiLineString") {
            geometry.coordinates.forEach(part => items.push({ isPoint: false, isPolygon: false, name, props, coords: part.map(c => [c[1], c[0]]) }));
        } else if (geometry.type === "Polygon") {
            const outerRing = geometry.coordinates?.[0];
            const holeRings = (geometry.coordinates || []).slice(1).map(r => r.map(c => [c[1], c[0]]));
            if (Array.isArray(outerRing) && outerRing.length >= 3) {
                items.push({ isPoint: false, isPolygon: true, name, props, holes: holeRings, coords: outerRing.map(c => [c[1], c[0]]) });
            }
        } else if (geometry.type === "MultiPolygon") {
            (geometry.coordinates || []).forEach(poly => {
                const outerRing = poly?.[0];
                const holeRings = (poly || []).slice(1).map(r => r.map(c => [c[1], c[0]]));
                if (Array.isArray(outerRing) && outerRing.length >= 3) {
                    items.push({ isPoint: false, isPolygon: true, name, props, holes: holeRings, coords: outerRing.map(c => [c[1], c[0]]) });
                }
            });
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

    // KML daxilindəki <Style> və <StyleMap> rəng / qalınlıq / poliqon doluluq məlumatlarını oxu
    const styleById = {};
    const styleMapById = {};

    function parseKmlColorAlpha(kmlHex) {
        if (!kmlHex) return { hex: "", opacity: 0 };
        const clean = String(kmlHex).trim().replace(/^#/, "");
        if (/^[0-9a-fA-F]{8}$/.test(clean)) {
            const aa = parseInt(clean.slice(0, 2), 16) / 255;
            const bb = clean.slice(2, 4);
            const gg = clean.slice(4, 6);
            const rr = clean.slice(6, 8);
            return { hex: `#${rr}${gg}${bb}`.toUpperCase(), opacity: Math.round(aa * 100) / 100 };
        }
        return { hex: normalizeColorCode(kmlHex, ""), opacity: 0.5 };
    }

    function extractStyleFromNode(styleNode) {
        if (!styleNode) return { color: "", width: 0, fillColor: "", fillOpacity: 0, polyFilled: undefined };
        let color = "";
        let width = 0;
        let fillColor = "";
        let fillOpacity = 0;
        let polyFilled = undefined;

        const lineStyle = styleNode.getElementsByTagName("LineStyle")[0];
        if (lineStyle) {
            const cNode = lineStyle.getElementsByTagName("color")[0];
            const wNode = lineStyle.getElementsByTagName("width")[0];
            if (cNode?.textContent) color = kmlColorToHex(cNode.textContent.trim());
            if (wNode?.textContent) width = normalizeLineWidth(wNode.textContent.trim(), 0);
        }
        const polyStyle = styleNode.getElementsByTagName("PolyStyle")[0];
        if (polyStyle) {
            const fillNode = polyStyle.getElementsByTagName("fill")[0];
            const fillTagVal = fillNode?.textContent?.trim();
            const cNode = polyStyle.getElementsByTagName("color")[0];
            if (cNode?.textContent) {
                const parsed = parseKmlColorAlpha(cNode.textContent.trim());
                fillColor = parsed.hex;
                fillOpacity = parsed.opacity;
                if (!color) color = fillColor;
            }
            if (fillTagVal === "0" || fillTagVal === "false") {
                polyFilled = false;
            } else if (fillTagVal === "1" || fillTagVal === "true") {
                polyFilled = cNode?.textContent ? fillOpacity > 0.02 : true;
            } else if (cNode?.textContent) {
                polyFilled = fillOpacity > 0.02;
            }
        }
        return { color, width, fillColor, fillOpacity, polyFilled };
    }

    Array.from(doc.getElementsByTagName("Style")).forEach(st => {
        const id = st.getAttribute("id");
        if (id) styleById[`#${id}`] = extractStyleFromNode(st);
    });
    Array.from(doc.getElementsByTagName("StyleMap")).forEach(sm => {
        const id = sm.getAttribute("id");
        if (!id) return;
        const pairs = Array.from(sm.getElementsByTagName("Pair"));
        let normalUrl = "";
        for (const p of pairs) {
            const k = p.getElementsByTagName("key")[0]?.textContent?.trim();
            const u = p.getElementsByTagName("styleUrl")[0]?.textContent?.trim();
            if (k === "normal" && u) {
                normalUrl = u;
                break;
            }
            if (!normalUrl && u) normalUrl = u;
        }
        if (normalUrl) styleMapById[`#${id}`] = normalUrl;
    });

    function resolvePlacemarkStyle(placemark) {
        if (!placemark) return { color: "", width: 0, fillColor: "", fillOpacity: 0, polyFilled: undefined };
        const inlineStyle = Array.from(placemark.childNodes).find(n => n.nodeType === 1 && /(^|:)style$/i.test(n.nodeName || ""));
        if (inlineStyle) {
            const inline = extractStyleFromNode(inlineStyle);
            if (inline.color || inline.width || inline.fillColor || inline.polyFilled !== undefined) return inline;
        }
        let sUrl = placemark.getElementsByTagName("styleUrl")[0]?.textContent?.trim() || "";
        if (sUrl && !sUrl.startsWith("#") && sUrl.includes("#")) {
            sUrl = sUrl.slice(sUrl.indexOf("#"));
        }
        if (styleMapById[sUrl]) sUrl = styleMapById[sUrl];
        if (sUrl && !sUrl.startsWith("#") && sUrl.includes("#")) {
            sUrl = sUrl.slice(sUrl.indexOf("#"));
        }
        return styleById[sUrl] || { color: "", width: 0, fillColor: "", fillOpacity: 0, polyFilled: undefined };
    }

    function findPlacemark(node) {
        let curr = node ? node.parentNode : null;
        while (curr && curr.nodeType === 1) {
            const tag = (curr.localName || curr.nodeName || "").toLowerCase();
            if (tag === "placemark" || tag.endsWith(":placemark")) return curr;
            curr = curr.parentNode;
        }
        return null;
    }

    function parseProps(placemark) {
        const props = {};
        if (!placemark) return props;

        // 1. ExtendedData daxilində SimpleData və Data teqlərini oxu
        const allEls = placemark.getElementsByTagName("*");
        for (let i = 0; i < allEls.length; i++) {
            const el = allEls[i];
            const tag = (el.localName || el.nodeName || "").toLowerCase();
            if (tag === "simpledata" || tag.endsWith(":simpledata")) {
                const k = el.getAttribute("name");
                const v = el.textContent?.trim();
                if (k && v !== undefined && props[k] === undefined) props[k] = v;
            } else if (tag === "data" || tag.endsWith(":data")) {
                const k = el.getAttribute("name");
                let v = "";
                const valNode = el.getElementsByTagName("value")[0] || Array.from(el.childNodes).find(n => /(^|:)value$/i.test(n.nodeName || ""));
                if (valNode) v = valNode.textContent?.trim();
                if (k && v !== undefined && props[k] === undefined) props[k] = v;
            }
        }

        // 2. ArcGIS Pro "Layer to KML" zamanı <description> daxilində yaranan cədvəli və ya düz mətni oxu
        const descNode = placemark.getElementsByTagName("description")[0]
            || Array.from(placemark.childNodes).find(n => /(^|:)description$/i.test(n.nodeName || ""));
        if (descNode && descNode.textContent) {
            const descHtml = descNode.textContent;
            props._rawDescription = descHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            // 2a. DOMParser ilə iç-içə (nested) ArcGIS HTML cədvəllərindəki bütün <tr> sətirlərini dəqiq oxu
            try {
                const htmlDoc = new DOMParser().parseFromString(descHtml, "text/html");
                htmlDoc.querySelectorAll("tr").forEach(tr => {
                    if (tr.querySelector("tr")) return;
                    const cells = Array.from(tr.querySelectorAll("th, td")).map(c => (c.textContent || "").trim());
                    if (cells.length >= 2) {
                        const k = cells[0].replace(/[:=]+$/, "").trim();
                        const v = cells.slice(1).join(" ").trim();
                        if (k && v && props[k] === undefined) props[k] = v;
                    }
                });
            } catch {}
            // 2b. Açar: Dəyər və ya <b>Açar:</b> Dəyər formatı
            const lineMatches = descHtml.matchAll(/(?:^|<br\s*\/?>|\n)\s*(?:<[^>]+>)*([A-Za-z0-9əıöüçşğƏİÖÜÇŞĞ_\s-]+?)(?:<\/[^>]+>)*\s*[:=]\s*(?:<[^>]+>)*(.*?)(?:<\/[^>]+>)*(?=(?:<br\s*\/?>|\n|$))/gi);
            for (const m of lineMatches) {
                const k = m[1].trim();
                const v = m[2].replace(/<[^>]+>/g, "").trim();
                if (k && v && props[k] === undefined) props[k] = v;
            }
        }

        // 3. Yuxarı qovluq və sənəd (<Folder><name> / <Document><name>) adlarını da saxla (əgər lif sayı və ya marşrut adı qovluqda yazılıbsa)
        const folderNames = [];
        let pNode = placemark.parentNode;
        while (pNode && pNode.nodeType === 1) {
            const pTag = (pNode.localName || pNode.nodeName || "").toLowerCase();
            if (pTag === "folder" || pTag.endsWith(":folder") || pTag === "document" || pTag.endsWith(":document")) {
                const fNameNode = Array.from(pNode.childNodes).find(n => n.nodeType === 1 && /(^|:)name$/i.test(n.nodeName || ""));
                if (fNameNode && fNameNode.textContent) {
                    folderNames.push(fNameNode.textContent.trim());
                }
            }
            pNode = pNode.parentNode;
        }
        if (folderNames.length > 0) {
            props._folderName = folderNames.join(" / ");
        }
        return props;
    }

    function resolveName(placemark, props) {
        // 1. ArcGIS atribut cədvəlindən sütun adı (Name, name, xett_adi, rayon_adi və s.)
        const propName = getPropCaseInsensitive(
            props,
            "Name", "name", "xett_adi", "xett", "LineName", "title", "ad", "rayon", "rayon_adi",
            "NAME_1", "NAME_2", "NAME_AZ", "ADM2_AZ", "ADM2_EN", "ADM1_AZ", "sheher", "bolge", "label", "layihe_adi"
        );
        if (propName) return propName;

        // 2. Placemark daxilində birbaşa <name> teqi
        let directName = "";
        if (placemark) {
            for (let i = 0; i < placemark.childNodes.length; i++) {
                const ch = placemark.childNodes[i];
                if (ch.nodeType === 1 && /(^|:)name$/i.test(ch.nodeName || "")) {
                    directName = ch.textContent?.trim() || "";
                    break;
                }
            }
            if (!directName) {
                const nEl = placemark.getElementsByTagName("name")[0];
                if (nEl) directName = nEl.textContent?.trim() || "";
            }
        }
        if (directName && !/^(?:id[xs]?\d+|line\s*\d+|xett\s*\d+|placemark\s*\d+)$/i.test(directName)) {
            return directName;
        }

        return directName || "";
    }

    const items = [];
    Array.from(doc.getElementsByTagName("LineString")).forEach(node => {
        const coordsNode = node.getElementsByTagName("coordinates")[0];
        if (!coordsNode) return;
        const coords = coordsNode.textContent.trim().split(/\s+/).map(tuple => {
            const [lng, lat] = tuple.split(",").map(Number);
            return [lat, lng];
        }).filter(c => !isNaN(c[0]) && !isNaN(c[1]));

        const placemark = findPlacemark(node);
        const props = parseProps(placemark);
        const name = resolveName(placemark, props);
        const st = resolvePlacemarkStyle(placemark);
        items.push({ isPoint: false, isPolygon: false, name, props, styleColor: st.color, styleWidth: st.width, coords });
    });

    // Poliqon dəstəyi (məs: Xəzər dənizi — içi dolu poliqon və ya Rayon Sərhədləri — sərhəd poliqonu)
    Array.from(doc.getElementsByTagName("Polygon")).forEach(node => {
        const outer = node.getElementsByTagName("outerBoundaryIs")[0] || node;
        const coordsNode = outer.getElementsByTagName("coordinates")[0] || node.getElementsByTagName("coordinates")[0];
        if (!coordsNode) return;
        const coords = coordsNode.textContent.trim().split(/\s+/).map(tuple => {
            const [lng, lat] = tuple.split(",").map(Number);
            return [lat, lng];
        }).filter(c => !isNaN(c[0]) && !isNaN(c[1]));
        if (coords.length < 3) return;

        const holes = Array.from(node.getElementsByTagName("innerBoundaryIs")).map(inner => {
            const cn = inner.getElementsByTagName("coordinates")[0];
            if (!cn) return [];
            return cn.textContent.trim().split(/\s+/).map(tuple => {
                const [lng, lat] = tuple.split(",").map(Number);
                return [lat, lng];
            }).filter(c => !isNaN(c[0]) && !isNaN(c[1]));
        }).filter(h => h.length >= 3);

        const placemark = findPlacemark(node);
        const props = parseProps(placemark);
        const name = resolveName(placemark, props);
        const st = resolvePlacemarkStyle(placemark);
        items.push({
            isPoint: false,
            isPolygon: true,
            name,
            props,
            styleColor: st.color,
            styleWidth: st.width,
            styleFillColor: st.fillColor,
            styleFillOpacity: st.fillOpacity,
            styleFilled: st.polyFilled,
            holes,
            coords
        });
    });

    Array.from(doc.getElementsByTagName("Point")).forEach(node => {
        const coordsNode = node.getElementsByTagName("coordinates")[0];
        if (!coordsNode) return;
        const [lng, lat] = coordsNode.textContent.trim().split(",").map(Number);
        if (isNaN(lat) || isNaN(lng)) return;

        const placemark = findPlacemark(node);
        const props = parseProps(placemark);
        const name = resolveName(placemark, props).replace(/\s*rayon(u)?\b/gi, "").trim();
        const st = resolvePlacemarkStyle(placemark);
        items.push({ isPoint: true, isPolygon: false, name, props, styleColor: st.color, styleWidth: st.width, coords: [[lat, lng]] });
    });

    return items;
}

/* KMZ, KML və GeoJSON fayllarını oxuyan əsas funksiya */
async function readLines(file) {
    const extension = file.name.split(".").pop().toLowerCase();
    if (extension === "kmz") {
        if (typeof JSZip === "undefined") {
            await ensureJSZip().catch(() => null);
        }
        if (typeof JSZip === "undefined") {
            throw new Error("JSZip kitabxanası yüklənməyib");
        }
        const zip = await JSZip.loadAsync(file);
        const kmlFile = Object.values(zip.files).find(f => !f.dir && /\.kml$/i.test(f.name));
        if (!kmlFile) return [];
        const kmlText = await kmlFile.async("string");
        return linesFromKml(kmlText);
    }
    const text = await file.text();
    if (extension === "kml") {
        return linesFromKml(text);
    }
    return linesFromGeoJson(JSON.parse(text));
}

function projectFromFile(fileName, lines, polyFillMode = "auto") {
    const id = `proj_custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const hasPoints = lines.every(l => l.isPoint || l.coords.length === 1);
    const cleanFileName = fileName.replace(/\.[^/.]+$/, "");
    return {
        id, imported: true, type: hasPoints ? "points" : "lines", status: "layihe", startDate: "", endDate: "",
        name: cleanFileName,
        polyFilled: polyFillMode === "filled" ? true : (polyFillMode === "hollow" ? false : undefined),
        items: lines.map((line, index) => {
            const p = line.props || {};

            // 1. Status: İcrada, təhvil, lahiyə, bitmiş
            const rawStatus = getPropCaseInsensitive(p, "status", "Status", "STATUS") || line.props?.status || "layihe";
            const status = normalizeStatus(rawStatus);

            // 2. İcraçı: icraçı, icraci, contractor — həm "BCG - Mühəndis", həm də ayrı sütunlar dəstəklənir
            const rawContractor = extractContractorFromProps(p);
            const parsedExec = parseContractorAndLead(rawContractor, p);
            const matchedContractor = findContractorInfo(parsedExec.contractor || rawContractor);
            const contractor = isBcgContractor(parsedExec.contractor)
                ? "BCG"
                : (matchedContractor ? matchedContractor.name : (parsedExec.contractor || rawContractor));
            const execLead = parsedExec.execLead || "";
            const execWorkers = parsedExec.execWorkers || "";
            const execPhone = parsedExec.execPhone || "";
            if (contractor === "BCG" && execLead) {
                saveBcgLeadEntry(execLead, execWorkers, execPhone);
            }

            // 3. Name: Ağsu-Şamaxı, Şamaxı-İsmayıllı, Rayon adı, Xəzər dənizi və s.
            let nameVal = (line.name && line.name.trim())
                || getPropCaseInsensitive(
                    p,
                    "Name", "name", "xett_adi", "xett", "LineName", "title", "ad", "rayon", "rayon_adi",
                    "NAME_1", "NAME_2", "NAME_AZ", "ADM2_AZ", "ADM2_EN", "ADM1_AZ", "sheher", "bolge", "label", "layihe_adi"
                );

            // 3b. Rəng kodu, Doluluq (Fill) və Qalınlıq (ArcGIS atribut sütunlarından və ya KML stilindən)
            const rawColorAttr = getPropCaseInsensitive(
                p,
                "reng_kodu", "rəng_kodu", "rengkodu", "reng", "rəng", "color", "color_code", "colorcode",
                "hex", "stroke", "line_color", "linecolor", "xett_rengi", "serhed_rengi", "rgb"
            );
            const rawFillColorAttr = getPropCaseInsensitive(
                p,
                "fill_color", "fillcolor", "fill", "dolu_reng", "sahe_rengi", "poliqon_rengi"
            );
            const rawWidthAttr = getPropCaseInsensitive(
                p,
                "qalinliq", "qalınlıq", "width", "thickness", "line_width", "linewidth",
                "stroke_width", "strokewidth", "xett_qalinligi", "qalinligi", "size", "weight"
            );
            const rawFillModeAttr = getPropCaseInsensitive(
                p,
                "ici_dolu", "icidolu", "filled", "poly_fill", "polyfill", "gorunus"
            );

            const isClosedRing = Array.isArray(line.coords) && line.coords.length >= 4
                && Math.hypot(line.coords[0][0] - line.coords[line.coords.length - 1][0], line.coords[0][1] - line.coords[line.coords.length - 1][1]) < 0.003;
            const isPolygon = Boolean(line.isPolygon || (polyFillMode === "filled" && isClosedRing));

            const combinedTitle = `${nameVal || ""} ${cleanFileName}`;
            const isWaterName = /(x[əe]z[əe]r|caspian|d[əe]niz|g[öo]l|su\s*h[öo]vz|sea|lake|water)/i.test(combinedTitle);
            const isBorderName = /(s[əe]rh[əe]d|rayon|border|boundary)/i.test(combinedTitle) && !isWaterName;

            let polyFilled = false;
            if (isPolygon) {
                if (polyFillMode === "filled") {
                    polyFilled = true;
                } else if (polyFillMode === "hollow") {
                    polyFilled = false;
                } else if (rawFillModeAttr !== undefined) {
                    polyFilled = /^(1|true|yes|beli|bəli|dolu|filled)$/i.test(String(rawFillModeAttr).trim());
                } else if (isWaterName) {
                    polyFilled = true;
                } else if (isBorderName) {
                    polyFilled = false;
                } else if (line.styleFilled !== undefined) {
                    polyFilled = Boolean(line.styleFilled);
                } else {
                    polyFilled = true;
                }
            }

            const defaultWaterColor = isWaterName ? "#0284C7" : "";
            const customColor = normalizeColorCode(rawColorAttr, line.styleColor || line.styleFillColor || defaultWaterColor);
            const fillColor = normalizeColorCode(rawFillColorAttr || rawColorAttr, line.styleFillColor || line.styleColor || customColor || defaultWaterColor);
            const fillOpacity = Number(line.styleFillOpacity) > 0 ? Number(line.styleFillOpacity) : (isWaterName ? 0.52 : 0.45);
            const lineWidth = normalizeLineWidth(rawWidthAttr, line.styleWidth || 0);

            // 4. pointA & pointB (birbaşa faylın atributlarından oxunur)
            let pointA = getPropCaseInsensitive(p, "pointA", "point_a", "pointa", "a_noqte", "a_noqtesi", "baslangic", "start_point", "from", "a") || "";
            let pointB = getPropCaseInsensitive(p, "pointB", "point_b", "pointb", "b_noqte", "b_noqtesi", "son", "end_point", "to", "b") || "";

            // Əgər pointA / pointB boşdursa və name-də tire varsa (məs: Ağsu-Şamaxı), avtomatik ayır
            if ((!pointA || !pointB) && nameVal && /[-–—]/.test(nameVal)) {
                const parts = nameVal.split(/[-–—]/).map(s => s.trim()).filter(Boolean);
                if (parts.length >= 2) {
                    if (!pointA) pointA = parts[0];
                    if (!pointB) pointB = parts[parts.length - 1];
                }
            }
            if (!nameVal && pointA && pointB) {
                nameVal = `${pointA} – ${pointB}`;
            }
            if (!nameVal) {
                nameVal = `${t("importedLine")} ${index + 1}`;
            }
            if (!pointA) pointA = "A";
            if (!pointB) pointB = "B";

            if (line.isPoint || line.coords.length === 1) {
                // Rayon / Antena nöqtəsi: Antena_say, Verilən və Çəkilən kabel məsafəsi (metr və ya km), Nöqtə növü, Status, İcraçı
                const rawDesc = p._rawDescription || "";
                const antennas = parseAntennaCount(p, nameVal, rawDesc);
                const { planMeters, doneMeters } = parsePointDistances(p, nameVal, rawDesc);
                const pointType = extractPointType(p) || "";
                const rayonName = getPropCaseInsensitive(p, "Rayon", "rayon_adi", "rayonu", "sheher", "bolge") || nameVal;
                const cleanPointName = String(rayonName || nameVal).replace(/\s*rayon(u)?(?![a-zəçşğıöü])/gi, "").trim();
                const isSummary = Boolean(antennas > 0 || planMeters > 0 || doneMeters > 0 || pointType);

                return {
                    id: `${isSummary ? "RS" : "PT"}-${String(index + 1).padStart(2, "0")}`,
                    name: cleanPointName,
                    rayon: rayonName,
                    pointType,
                    summary: isSummary,
                    pointA: cleanPointName || "Mərkəz",
                    pointB: "Şəbəkə",
                    startDate: "", endDate: "", contractor,
                    execLead, execWorkers, execPhone,
                    totalKm: planMeters,
                    doneKm: doneMeters,
                    unit: "m",
                    status,
                    customColor: "",
                    lineWidth,
                    isPolygon: false,
                    closures: 0,
                    manholes: 0,
                    antennas,
                    props: p,
                    coords: line.coords
                };
            }

            // Xətt və ya Poliqon layihəsi: totalKm və doneKm birbaşa ArcGIS sütunlarından
            const isLifStatus = status === "lif_goturulen" || /(?:lif\s*g[öo]t[üu]r|lif_goturulen)/i.test(`${nameVal || ""} ${cleanFileName || ""}`);
            const finalStatus = isLifStatus ? "lif_goturulen" : status;
            const km = Math.round((tools.length(line.coords) / 1000) * 10) / 10;
            const rawTotalKm = getPropCaseInsensitive(p, "totalKm", "total_km", "totalkm", "plan_km", "planKm", "plan", "uzunluq", "length");
            const rawDoneKm = getPropCaseInsensitive(p, "doneKm", "done_km", "donekm", "faktiki_km", "faktiki", "icra", "done");

            // Lif götürülən kabeldə məsafələr boş (0) saxlanılır; digər xətlərdə GPS və ya atribut oxunur
            const totalKm = finalStatus === "lif_goturulen"
                ? 0
                : (rawTotalKm !== undefined ? parseAttrNumber(rawTotalKm, km) : km);
            const doneKm = finalStatus === "lif_goturulen"
                ? 0
                : (rawDoneKm !== undefined ? parseAttrNumber(rawDoneKm, 0) : 0);

            // Kabelin lif sayı (FO 48, FO 24, FO 12 və s. — birbaşa import edilən faylın atributlarından / adından oxunur; şərti rəqəm atılmır)
            const fiberCount = finalStatus === "lif_goturulen"
                ? ""
                : (extractFiberFromProps(p, nameVal, line.name, p._folderName, p._rawDescription, fileName) || "");

            return {
                id: `${isPolygon ? "PLY" : "IMP"}-${String(index + 1).padStart(2, "0")}`,
                name: nameVal,
                pointA, pointB, startDate: "", endDate: "", contractor,
                execLead, execWorkers, execPhone,
                totalKm, doneKm, status: finalStatus, fiberCount, customColor, fillColor, fillOpacity, lineWidth, isPolygon, polyFilled,
                holes: line.holes || [],
                closures: 0, manholes: 0, antennas: 0,
                props: p,
                coords: line.coords
            };
        })
    };
}

let pendingImportCategory = "other";

async function handleImportFiles(fileList, targetCategory) {
    if (fileList && fileList.length > 0) pushUndoSnapshot("Fayl idxalı");
    const added = [];
    const cat = isAdmin() ? (targetCategory || pendingImportCategory || "project") : "other";
    const polyFillMode = $("importPolyFillMode")?.value || "auto";
    const catLabels = { project: "📁 Layihələr", nim: "🚦 NİİM", azconnect: "🌐 Azərconnect", other: "🗂️ Digər" };
    for (const file of fileList) {
        try {
            const lines = (await readLines(file)).filter(line => line.coords.length >= 1);
            if (lines.length === 0) {
                toast(`${file.name}: ${t("importNoLines")}`, true);
                continue;
            }
            const project = projectFromFile(file.name, lines, polyFillMode);
            if (Array.isArray(project.items) && project.items.length > 0 && project.items.every(it => it.status === "lif_goturulen")) {
                project.status = "lif_goturulen";
            }
            project.id = (`imp_${cat}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
            project.imported = true;
            project.category = cat;
            const forcedType = $("importGeomType")?.value;
            if (cat === "nim") project.type = "points";
            else if (cat === "azconnect" || cat === "other") project.type = "lines";
            else if (forcedType === "lines" || forcedType === "points") project.type = forcedType;
            if (cat === "other") {
                project.name = `Digər: ${project.name.replace(/^Digər:\s*/i, "")}`;
            }
            saveProjectOverride(project);
            (project.items || []).forEach(it => saveSegmentOverride(project.id, it));
            try {
                await api.saveProject(project);
            } catch (err) {
                console.warn("api.saveProject xətası (lokal qorunur):", err);
            }
            state.projects.push(project);
            state.visibleIds.add(project.id);
            added.push(project);
            saveImportedProjects();
            toast(`${t("importOk")}: ${project.name} (${catLabels[cat] || "📁 Layihələr"})`);
        } catch {
            toast(`${file.name}: ${t("importError")}`, true);
        }
    }
    if ($("importModal")?.open) $("importModal").close();
    if (added.length === 0) return;
    state.sidebarCategory = cat;
    state.activeFolders.add(cat);
    renderAll();
    flyToCoords(added.flatMap(p => p.items.flatMap(r => r.coords)));
}

async function handleImport(event) {
    await handleImportFiles(event.target.files, pendingImportCategory);
    event.target.value = "";
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

    $("notesBtn")?.addEventListener("click", () => $("notesModal")?.showModal());
    $("quickGuideBtn")?.addEventListener("click", () => {
        $("topActions")?.classList.remove("open");
        $("quickGuideModal")?.showModal();
    });
    $("quickGuideModal")?.addEventListener("click", e => {
        if (e.target === $("quickGuideModal")) $("quickGuideModal").close();
    });
    $("materialsBtn")?.addEventListener("click", () => $("materialsModal")?.showModal());
    $("printBtn").addEventListener("click", () => openExportPrintModal());

    function updateStorageModalUI() {
        const info = getStorageInfo();
        if ($("storageUsageVal")) {
            $("storageUsageVal").textContent = `${info.totalMB} MB / 5.0 MB (${info.pct}%)`;
        }
        if ($("storageProgressBar")) {
            $("storageProgressBar").style.width = `${info.pct}%`;
            $("storageProgressBar").style.background = info.pct > 75 ? "#EF4444" : (info.pct > 40 ? "#F59E0B" : "#22C55E");
        }
        if ($("storageStatusText")) {
            if (info.pct > 75) {
                $("storageStatusText").innerHTML = `<span style="color:#EF4444;font-weight:600">⚠️ Yaddaş dolmaq üzrədir!</span> Saytın sürətlənməsi üçün təmizləyin.`;
            } else if (info.pct > 40) {
                $("storageStatusText").innerHTML = `<span style="color:#F59E0B;font-weight:600">ℹ️ Yaddaş orta səviyyədədir.</span> Ehtiyac olduqda təmizləyə bilərsiniz.`;
            } else {
                $("storageStatusText").innerHTML = `<span style="color:#22C55E;font-weight:600">✅ Yaddaş əla vəziyyətdədir.</span> Sayt yüngül və sürətli işləyir.`;
            }
        }
    }

    $("cleanStorageBtn")?.addEventListener("click", () => {
        updateStorageModalUI();
        $("storageModal")?.showModal();
    });

    $("cleanCacheBtn")?.addEventListener("click", () => {
        cleanAppStorage();
        updateStorageModalUI();
        toast("🧹 Yaddaş və köhnə keş təmizləndi! Sayt optimallaşdırıldı.");
    });
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
    $("materialsBody")?.addEventListener("click", e => {
        const button = e.target.closest("[data-edit-material]");
        if (!button) return;
        if (!isAdmin()) {
            toast("🔒 Anbar Qaiməsi əlavə etmək və redaktə yalnız Admin üçündür!", true);
            return;
        }
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
    $("importBtn").addEventListener("click", () => {
        if ($("importModal")) {
            if ($("adminImportChoiceWrap")) $("adminImportChoiceWrap").hidden = !isAdmin();
            if ($("userAutoOtherNotice")) $("userAutoOtherNotice").hidden = isAdmin();
            if ($("importRoleSubtitle")) {
                $("importRoleSubtitle").innerHTML = isAdmin()
                    ? '<i class="fa-solid fa-user-shield" style="color:#22c55e"></i> <b>Admin:</b> Faylın hansı qovluğa (BCG, NİM, Azconnect, Digər) düşəcəyini seçin'
                    : '<i class="fa-solid fa-circle-info" style="color:#38bdf8"></i> <b>İstifadəçi:</b> Yüklənən fayl avtomatik <b>Digər</b> qovluğuna əlavə olunur';
            }
            $("importModal").showModal();
        } else {
            $("importFile").click();
        }
    });
    $("importModalForm")?.addEventListener("submit", async e => {
        e.preventDefault();
        const fileInput = $("importModalFile");
        if (!fileInput || !fileInput.files.length) return;
        const picked = document.querySelector('input[name="importCategory"]:checked')?.value || "project";
        pendingImportCategory = isAdmin() ? picked : "other";
        await handleImportFiles(fileInput.files, pendingImportCategory);
        fileInput.value = "";
    });
    $("importFile").addEventListener("change", handleImport);
    $("noteForm").addEventListener("submit", e => window.addNote(e));
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

    $("searchInput")?.addEventListener("input", e => {
        state.query = e.target.value.trim().toLocaleLowerCase("az");
        renderAll();
    });
    $("statusChips").addEventListener("click", e => {
        const chip = e.target.closest("[data-status]");
        if (!chip) return;
        const key = chip.dataset.status;
        if (key === "all") {
            state.statusFilters.clear();
        } else {
            if (state.statusFilters.has(key)) {
                state.statusFilters.delete(key);
            } else {
                state.statusFilters.add(key);
                if (state.statusFilters.size >= STATUSES.length) {
                    state.statusFilters.clear();
                }
            }
        }
        state.statusFilter = statusFilterSignature();
        renderAll();
    });
    $("showAllBtn").addEventListener("click", () => {
        pushUndoSnapshot("Hamısını göstər");
        writeStore(HIDDEN_PROJ_STORE_KEY, []);
        state.projects.forEach(p => state.visibleIds.add(p.id));
        renderAll();
    });
    $("hideAllBtn").addEventListener("click", () => {
        pushUndoSnapshot("Hamısını gizlət");
        state.visibleIds.clear();
        writeStore(HIDDEN_PROJ_STORE_KEY, state.projects.map(p => p.id));
        renderAll();
    });

    let lastListClickKey = "";
    let lastListClickTime = 0;

    $("projectList").addEventListener("click", async e => {
        const button = e.target.closest("[data-action]");
        if (!button) return;
        const projEl = button.closest(".project");
        if (!projEl) return;
        const project = state.projects.find(p => p.id === projEl.dataset.id);
        if (!project) return;
        const action = button.dataset.action;
        const now = Date.now();

        if (action === "toggle") {
            pushUndoSnapshot(`Layihə görünüşü (${project.name})`);
            if (state.visibleIds.has(project.id)) {
                state.visibleIds.delete(project.id);
                setProjectHiddenState(project.id, true);
            } else {
                state.visibleIds.add(project.id);
                setProjectHiddenState(project.id, false);
            }
        } else if (action === "expand") {
            const clickKey = `expand:${project.id}`;
            if (now - lastListClickTime < 450 && lastListClickKey === clickKey) {
                lastListClickTime = 0;
                state.expandedIds.add(project.id);
                state.visibleIds.add(project.id);
                setProjectHiddenState(project.id, false);
                renderAll();
                flyToCoords(project.items.flatMap(i => i.coords));
                return;
            }
            lastListClickKey = clickKey;
            lastListClickTime = now;
            if (state.expandedIds.has(project.id)) state.expandedIds.delete(project.id);
            else state.expandedIds.add(project.id);
        } else if (action === "focus") {
            const item = project.items.find(r => r.id === button.dataset.item);
            if (!item) return;
            const clickKey = `focus:${project.id}:${item.id}`;
            if (now - lastListClickTime < 450 && lastListClickKey === clickKey) {
                // 2x Sol klik: Xəritədə həmin xəttə / nöqtəyə yaxınlaş və göstər
                lastListClickTime = 0;
                state.visibleIds.add(project.id);
                setProjectHiddenState(project.id, false);
                selectSegment(project, item, true);
                return;
            }
            // 1x Sol klik: Xəritədə yaxınlaşdırmadan yalnız status pəncərəsini aç
            lastListClickKey = clickKey;
            lastListClickTime = now;
            selectSegment(project, item, false);
            return;
        } else if (action === "quickEditSeg") {
            if (!isAdmin()) return;
            const item = project.items.find(r => r.id === button.dataset.item);
            if (!item) return;
            const qKey = `${project.id}:${item.id}`;
            state.quickEditKey = state.quickEditKey === qKey ? null : qKey;
            renderProjects();
            return;
        } else if (action === "geomEditSeg") {
            if (!isAdmin()) return;
            const item = project.items.find(r => r.id === button.dataset.item);
            if (!item) return;
            window.startGeomEdit?.(project.id, item.id);
            return;
        } else if (action === "saveQuickSeg") {
            if (!isAdmin()) return;
            const item = project.items.find(r => r.id === button.dataset.item);
            if (!item) return;
            const wrap = button.closest("[data-seg-wrap]");
            if (!wrap) return;
            pushUndoSnapshot(`Nöqtə redaktəsi (${item.name})`);
            const isPts = project.type === "points";
            const isNim = project.category === "nim";
            const antInp = wrap.querySelector("[data-q-ant]");
            const planInp = wrap.querySelector("[data-q-plan]");
            const doneInp = wrap.querySelector("[data-q-done]");
            const stSel = wrap.querySelector("[data-q-status]");
            const ptTypeInp = wrap.querySelector("[data-q-pttype]");
            const execSel = wrap.querySelector("[data-q-exec]");
            const leadInp = wrap.querySelector("[data-q-lead]");
            const wrkInp = wrap.querySelector("[data-q-wrk]");
            const phoneInp = wrap.querySelector("[data-q-phone]");

            if (isPts && antInp) {
                item.antennas = Math.max(0, Math.round(Number(antInp.value) || 0));
            }
            if (isPts && ptTypeInp) {
                item.pointType = ptTypeInp.value.trim();
            }
            if (execSel) {
                item.contractor = execSel.value.trim();
            }
            if (leadInp) {
                item.execLead = leadInp.value.trim();
            }
            if (wrkInp) {
                item.execWorkers = wrkInp.value.trim();
            }
            if (phoneInp) {
                item.execPhone = phoneInp.value.trim();
            }
            if (item.execLead && (!item.contractor || isBcgContractor(item.contractor))) {
                if (!item.contractor) item.contractor = "BCG";
                saveBcgLeadEntry(item.execLead, item.execWorkers, item.execPhone);
            }
            if (!isNim && planInp && doneInp) {
                if (isPts) {
                    const toKmFromMetersInput = raw => {
                        const s = String(raw ?? "").trim().replace(",", ".");
                        const n = Math.max(0, Number(s) || 0);
                        return (n > 0 && n < 25 && s.includes("."))
                            ? Number(n.toFixed(4))
                            : Number((n / 1000).toFixed(4));
                    };
                    item.totalKm = toKmFromMetersInput(planInp.value);
                    item.doneKm = toKmFromMetersInput(doneInp.value);
                    delete item.swappedKmFixed;
                } else {
                    item.totalKm = Math.max(0, Number(String(planInp.value).replace(",", ".")) || 0);
                    item.doneKm = Math.max(0, Number(String(doneInp.value).replace(",", ".")) || 0);
                }
            }
            if (stSel && stSel.value) {
                item.status = stSel.value;
            }
            saveSegmentOverride(project.id, item);
            saveImportedProjects();
            if (api.configured) {
                api.saveProject(project).catch(() => {});
            }
            state.quickEditKey = null;
            renderAll();
            toast(`✅ "${item.name}" yeniləndi`);
            return;
        } else if (action === "editSeg") {
            if (!isAdmin()) return;
            editSegment(project, project.items.find(r => r.id === button.dataset.item));
            return;
        } else if (action === "edit") {
            if (!isAdmin()) return;
            editProject(project);
            return;
        } else if (action === "addSegment") {
            if (!isAdmin()) return;
            editSegment(project, null);
            return;
        }
        renderAll();
    });

    $("projectList").addEventListener("change", e => {
        const qExec = e.target.closest("[data-q-exec]");
        if (qExec) {
            const box = qExec.closest(".seg-quick-box")?.querySelector("[data-q-bcg-box]");
            if (box) box.style.display = isBcgContractor(qExec.value) ? "grid" : "none";
            return;
        }
        const qLead = e.target.closest("[data-q-lead]");
        if (qLead) {
            const matched = getSavedBcgLeads().find(l => l.name.toLowerCase() === qLead.value.trim().toLowerCase());
            if (matched) {
                const box = qLead.closest(".seg-quick-box");
                const wrkInp = box?.querySelector("[data-q-wrk]");
                const phnInp = box?.querySelector("[data-q-phone]");
                if (wrkInp && !wrkInp.value && matched.workers) wrkInp.value = matched.workers;
                if (phnInp && !phnInp.value && matched.phone) phnInp.value = matched.phone;
            }
        }
    });

    $("tableBody").addEventListener("click", e => {
        const row = e.target.closest("tr");
        if (!row) return;
        const entries = visibleEntries().filter(ent => ent.project.category !== "other");
        const entry = entries[Number(row.dataset.index)];
        if (entry) selectSegment(entry.project, entry.item);
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
    else {
        $("login").hidden = false;
        if (api.configured) api.prefetch();
    }
}

document.addEventListener("DOMContentLoaded", init);

/* === YENİLİKLƏR: Yığcam Status Pəncərəsi, Çap/PDF Çərçivə Seçimi, Küçə Görünüşü (Pegman), Mənim Konumum, Fokus İşıqlandırma, İstifadəçilər və Anbar Qaimə Filtrləri === */
(() => {
    let activeProjectId = null;
    let myLocationMarker = null;
    let pegmanActive = false;

    const origRenderAll = window.renderAll;
    function updateLegendVisibility() {
        renderLegend();
        const legend = $("legend");
        if (legend) legend.hidden = state.activeFolders.size === 0 || visibleEntries().length === 0 || !legend.innerHTML.trim();
    }

    function executorOptionsHtml(currentExec, item) {
        const cur = String(currentExec || "").trim();
        const details = item ? resolveItemExecDetails(item) : null;
        if (!isAdmin()) {
            if (!cur) return `<span style="font-size:11.5px;color:var(--ink-3)">— Təyin edilməyib —</span>`;
            const leadTxt = details?.lead ? ` · ${details.lead}` : "";
            const wrkTxt = details?.workers ? ` (${details.workers} nəfər)` : "";
            return `<b style="font-size:11.5px;color:var(--ink)">👷 ${esc(cur)}${esc(leadTxt)}${esc(wrkTxt)}</b>`;
        }
        const adminMap = syncAdminContractors();
        const names = [...new Set(["", "BCG", ...Object.keys(adminMap), ...(cur ? [cur] : [])])];
        return `<select class="input" data-exec-select>${names.map(name => {
            if (!name) return `<option value="" ${!cur ? "selected" : ""}>— İcraçı seçilməyib —</option>`;
            if (isBcgContractor(name)) {
                return `<option value="BCG" ${isBcgContractor(cur) ? "selected" : ""}>🏢 BCG (Mühəndis / Briqadir seçimi)</option>`;
            }
            const info = findContractorInfo(name);
            const sub = info && (info.workers || info.machinery) ? ` (${info.workers || 0} işçi · ${info.machinery || 0} tex.)` : "";
            return `<option value="${esc(name)}" ${name === cur ? "selected" : ""}>👷 ${esc(name)}${esc(sub)}</option>`;
        }).join("")}</select>`;
    }

    function renderExecDetailBlockHtml(r, proj, allowInlineEdit = true) {
        const execInfo = resolveItemExecDetails(r);
        const savedLeads = getSavedBcgLeads();
        const isBcg = isBcgContractor(r.contractor);
        const showSummary = Boolean(r.contractor || execInfo.lead || execInfo.workers || execInfo.phone);

        const summaryHtml = showSummary ? `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;font-size:10.5px;color:var(--ink-2)">
                <span>👷 <b>${esc(r.contractor || t("notAssigned"))}</b>${execInfo.lead ? ` · <b style="color:#38BDF8">${esc(execInfo.lead)}</b>` : ""}</span>
                <span>
                    ${execInfo.workers ? `👥 <b>${esc(execInfo.workers)} nəf.</b>` : ""}
                    ${!isBcg && execInfo.machinery ? ` · 🚜 <b>${esc(execInfo.machinery)}</b>` : ""}
                    ${execInfo.phone ? `${execInfo.workers || (!isBcg && execInfo.machinery) ? " · " : ""}📞 <b>${esc(execInfo.phone)}</b>` : ""}
                </span>
            </div>
        ` : `<div style="font-size:10.5px;color:var(--ink-3)">👷 İcraçı: <b>${esc(t("notAssigned"))}</b></div>`;

        if (!isAdmin() || !isBcg || !allowInlineEdit) {
            return summaryHtml;
        }

        return `
            ${summaryHtml}
            <div class="bcg-inline-exec-box" style="margin-top:3px;padding:5px 7px;border-radius:7px;background:rgba(14,165,233,0.08);border:1px dashed rgba(56,189,248,0.35);display:flex;flex-direction:column;gap:4px">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:5px;flex-wrap:wrap">
                    <span style="font-size:10px;font-weight:700;color:#38BDF8">🏢 BCG — Kim işləyib:</span>
                    ${savedLeads.length > 0 ? `
                    <select class="input" data-exec-lead-pick style="height:21px;padding:0 5px;font-size:10px;max-width:175px">
                        <option value="">— Siyahıdan mühəndis seç —</option>
                        ${savedLeads.map(l => `<option value="${esc(l.name)}" data-wrk="${esc(l.workers || "")}" data-phn="${esc(l.phone || "")}" ${r.execLead === l.name ? "selected" : ""}>👷 ${esc(l.name)}${l.workers ? ` (${esc(l.workers)} nəf.)` : ""}</option>`).join("")}
                    </select>` : ""}
                </div>
                <div style="display:grid;grid-template-columns:1.2fr 0.6fr 0.95fr auto;gap:4px;align-items:center">
                    <input class="input" type="text" data-exec-lead-inp value="${esc(r.execLead || "")}" placeholder="Kim işləyib" style="height:22px;padding:0 5px;font-size:10.5px">
                    <input class="input" type="number" min="0" step="1" data-exec-wrk-inp value="${esc(r.execWorkers || "")}" placeholder="Nəfər" style="height:22px;padding:0 5px;font-size:10.5px">
                    <input class="input" type="text" data-exec-phn-inp value="${esc(r.execPhone || "")}" placeholder="Əlaqə nömrəsi" style="height:22px;padding:0 5px;font-size:10.5px">
                    <button type="button" class="btn btn-primary" data-save-exec-detail="${esc(proj.id)}:${esc(r.id)}" style="height:22px;padding:0 7px;font-size:10px;white-space:nowrap" title="Mühəndis / İşçi sayı / Əlaqə nömrəsini yadda saxla">
                        <i class="fa-solid fa-check"></i> Saxla
                    </button>
                </div>
            </div>
        `;
    }

    function fiberOptionsHtml(currentFo) {
        const norm = normalizeFiberCount(currentFo || "", "");
        if (!isAdmin()) {
            if (!norm) return `<span style="font-size:11.5px;color:var(--ink-3)">— Təyin edilməyib —</span>`;
            return `<b style="font-size:11.5px;color:#38BDF8">🔌 ${esc(norm)}</b>`;
        }
        const opts = norm && !FIBER_OPTIONS.includes(norm) ? [norm, ...FIBER_OPTIONS] : FIBER_OPTIONS;
        return `<select class="input" data-fo-select>
            <option value="" ${!norm ? "selected" : ""}>— Fayldan / Təyin edilməyib —</option>
            ${opts.map(fo => `<option value="${esc(fo)}" ${fo === norm ? "selected" : ""}>🔌 ${esc(fo)}</option>`).join("")}
        </select>`;
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

        // 2) Yığcam məlumat pəncərəsi
        const card = document.createElement("div");
        card.id = "infoCard";
        card.className = "info-card";
        card.hidden = true;
        stage.appendChild(card);

        // 3) Admin üçün Xəritə üzərində Xətt və Nöqtə Sürüşdürmə / Redaktə Paneli
        const geomBar = document.createElement("div");
        geomBar.id = "geomEditBar";
        geomBar.className = "geom-edit-bar";
        geomBar.hidden = true;
        stage.appendChild(geomBar);

        geomBar.addEventListener("click", e => {
            const act = e.target.closest("[data-geom-act]")?.dataset.geomAct;
            if (act === "save") saveGeomEdit();
            else if (act === "cancel") cancelGeomEdit();
            else if (act === "mmFinish") openMapMarkerModal();
            else if (act === "mmUndo") undoMapMarkerVertex();
            else if (act === "mmCancel") cancelMapMarkerCreate();
        });

        // 4) Map Marker üslubunda yığcam "+" düyməsi (klikləyəndə Yeni Nöqtə / Yeni Xətt seçimi açılır — yalnız Admin)
        const mmDock = document.createElement("div");
        mmDock.id = "mapMarkerDock";
        mmDock.className = "map-marker-dock";
        mmDock.hidden = !isAdmin();
        mmDock.innerHTML = `
            <div class="mm-fab-menu" id="mmFabMenu" hidden>
                <div class="mm-dock-title"><i class="fa-solid fa-compass-drafting"></i> Nə əlavə edək?</div>
                <button type="button" class="mm-btn" data-mm-start="point" title="Xəritədə nöqtə qoy və layihəyə əlavə et">
                    <i class="fa-solid fa-location-dot"></i> Yeni Nöqtə
                </button>
                <button type="button" class="mm-btn" data-mm-start="line" title="Xəritədə xətt çək və layihəyə əlavə et">
                    <i class="fa-solid fa-route"></i> Yeni Xətt
                </button>
            </div>
            <button type="button" class="mm-fab-btn" id="mmFabToggle" title="Layihəyə yeni nöqtə və ya xətt əlavə et" aria-expanded="false">
                <i class="fa-solid fa-plus"></i>
            </button>
        `;
        stage.appendChild(mmDock);

        const setMmMenuOpen = open => {
            const menu = mmDock.querySelector("#mmFabMenu");
            const fab = mmDock.querySelector("#mmFabToggle");
            if (menu) menu.hidden = !open;
            mmDock.classList.toggle("open", open);
            if (fab) fab.setAttribute("aria-expanded", String(open));
        };

        mmDock.addEventListener("click", e => {
            e.stopPropagation();
            if (e.target.closest("#mmFabToggle")) {
                if (mmCreateState) {
                    cancelMapMarkerCreate();
                    setMmMenuOpen(false);
                    return;
                }
                setMmMenuOpen(!mmDock.classList.contains("open"));
                return;
            }
            const btn = e.target.closest("[data-mm-start]");
            if (!btn) return;
            const mode = btn.dataset.mmStart;
            setMmMenuOpen(false);
            if (mmCreateState && mmCreateState.mode === mode) {
                cancelMapMarkerCreate();
            } else {
                startMapMarkerCreate(mode);
            }
        });

        document.addEventListener("click", e => {
            if (mmDock.classList.contains("open") && !e.target.closest("#mapMarkerDock")) {
                setMmMenuOpen(false);
            }
        });

        // 5) Map Marker — Mövcud Layihəyə Əlavə Et və Atributları Doldur Modalı
        if (!$("mapMarkerModal")) {
            const modal = document.createElement("dialog");
            modal.id = "mapMarkerModal";
            modal.className = "modal";
            modal.style.width = "min(560px, 95vw)";
            modal.innerHTML = `
                <div class="modal-head">
                    <div>
                        <h2 id="mmModalTitle">📍 Mövcud Layihəyə Əlavə Et</h2>
                        <p class="muted" id="mmModalSub">Xəritədə çəkilmiş obyekti aktiv qovluqdakı layihəyə əlavə edin və atributlarını doldurun</p>
                    </div>
                    <button class="icon-btn" type="button" data-mm-close title="Bağla"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <form id="mmForm" class="edit-form" novalidate>
                    <div class="edit-fields" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                        <label class="wide" style="grid-column:1 / -1">
                            <span>Aktiv qovluqdakı Layihəni seçin *</span>
                            <select class="input" id="mmProjectSelect" required></select>
                        </label>
                        <label class="wide" id="mmNewProjWrap" style="grid-column:1 / -1" hidden>
                            <span>Yeni layihənin adı *</span>
                            <input class="input" type="text" id="mmNewProjName" placeholder="Məs: Qəbələ əlavə şəbəkə layihəsi">
                        </label>
                        <label class="wide" style="grid-column:1 / -1">
                            <span>Adı (Name / Məntəqə və ya Xətt adı) *</span>
                            <input class="input" type="text" id="mmItemName" required placeholder="Məs: Göyçay Mərkəz əlavə xətt / Svetofor #12">
                        </label>
                        <label id="mmStatusWrap">
                            <span>Status *</span>
                            <select class="input" id="mmStatusSelect"></select>
                        </label>
                        <label id="mmContractorWrap">
                            <span>İş icraçısı</span>
                            <select class="input" id="mmContractorSelect"></select>
                        </label>
                        <label class="wide" id="mmFiberWrap" style="grid-column:1 / -1">
                            <span>🔌 Kabelin lif sayı (FO 48, FO 24, FO 12...) *</span>
                            <select class="input" id="mmFiberSelect"></select>
                        </label>
                        <div class="wide" id="mmOtherStyleWrap" style="grid-column:1 / -1;display:grid;grid-template-columns:1fr 1fr;gap:10px" hidden>
                            <label>
                                <span>🎨 Rəng seçimi</span>
                                <span style="display:flex;align-items:center;gap:6px">
                                    <input type="color" id="mmColorPicker" value="#38BDF8" style="width:38px;height:34px;padding:2px;border-radius:8px;border:1px solid var(--line);background:var(--surface-2);cursor:pointer;flex-shrink:0">
                                    <input class="input" type="text" id="mmCustomColor" value="#38BDF8" placeholder="#38BDF8">
                                </span>
                            </label>
                            <label>
                                <span>📏 Xətt qalınlığı (px)</span>
                                <input class="input" type="number" step="0.2" min="0.5" max="12" id="mmLineWidth" value="1.8">
                            </label>
                        </div>
                        <label id="mmPointAWrap">
                            <span>📍 Başlanğıc nöqtə (A Konum)</span>
                            <input class="input" type="text" id="mmPointA" value="Mərkəz">
                        </label>
                        <label id="mmPointBWrap">
                            <span>📍 Son nöqtə (B Konum)</span>
                            <input class="input" type="text" id="mmPointB" value="Şəbəkə">
                        </label>
                        <label id="mmPlanWrap">
                            <span id="mmPlanLabel">1. Nəzərdə tutulan məsafə (km)</span>
                            <input class="input" type="number" step="any" min="0" id="mmPlanVal" value="0">
                        </label>
                        <label id="mmDoneWrap">
                            <span id="mmDoneLabel">2. Faktiki çəkilən məsafə (km)</span>
                            <input class="input" type="number" step="any" min="0" id="mmDoneVal" value="0">
                        </label>
                        <label class="wide" id="mmAntennasWrap" style="grid-column:1 / -1">
                            <span>Antena sayı (ədəd)</span>
                            <input class="input" type="number" step="1" min="0" id="mmAntennasVal" value="1">
                        </label>
                        <label class="wide" style="grid-column:1 / -1">
                            <span>Xəritədə seçilmiş koordinatlar</span>
                            <textarea class="input mono" id="mmCoordsText" rows="3" required></textarea>
                        </label>
                        <div class="wide cf-editor" id="mmCustomFieldsWrap" style="grid-column:1 / -1">
                            <div class="cf-head">
                                <span>📝 Sərbəst başlıqlar (öz məlumatlarınız)</span>
                                <button type="button" class="link" id="mmAddCfBtn">+ Yeni başlıq əlavə et</button>
                            </div>
                            <div class="cf-rows" id="mmCfRows"></div>
                        </div>
                    </div>
                    <p class="form-error" id="mmFormError" role="alert"></p>
                    <div class="edit-actions">
                        <button class="btn btn-outline" type="button" id="mmBackToMapBtn"><i class="fa-solid fa-map"></i> Xəritədə düzəliş et</button>
                        <button class="btn btn-outline" type="button" data-mm-close>Ləğv et</button>
                        <button class="btn btn-primary" type="submit"><i class="fa-solid fa-check"></i> Layihəyə əlavə et</button>
                    </div>
                </form>
            `;
            document.body.appendChild(modal);

            modal.addEventListener("click", e => {
                if (e.target === modal || e.target.closest("[data-mm-close]")) {
                    modal.close();
                    return;
                }
                if (e.target.closest("#mmAddCfBtn")) {
                    const rowsEl = $("mmCfRows");
                    if (!rowsEl) return;
                    const row = document.createElement("div");
                    row.className = "cf-row";
                    row.innerHTML = `<input type="text" class="input cf-lbl" placeholder="Başlıq (özünüz yazın)…"><input type="text" class="input cf-val" placeholder="Məlumat / Dəyər…"><button type="button" class="icon-btn small cf-del" title="Sil"><i class="fa-solid fa-xmark"></i></button>`;
                    rowsEl.appendChild(row);
                    row.querySelector(".cf-lbl")?.focus();
                    return;
                }
                if (e.target.closest(".cf-del")) {
                    e.target.closest(".cf-row")?.remove();
                }
            });
            $("mmBackToMapBtn")?.addEventListener("click", () => {
                modal.close();
                toast("Xəritədə nöqtələri sürüşdürün və ya əlavə edin, sonra '✔ Tamamla' basın");
            });
            $("mmProjectSelect")?.addEventListener("change", syncMmFormForProject);
            $("mmColorPicker")?.addEventListener("input", () => {
                if ($("mmCustomColor")) $("mmCustomColor").value = $("mmColorPicker").value.toUpperCase();
            });
            $("mmCustomColor")?.addEventListener("input", () => {
                const norm = normalizeColorCode($("mmCustomColor").value, "");
                if (norm && $("mmColorPicker")) $("mmColorPicker").value = norm;
            });
            $("mmStatusSelect")?.addEventListener("change", () => {
                const st = $("mmStatusSelect").value;
                if (st === "bitmis" || st === "tehvil") {
                    $("mmDoneVal").value = $("mmPlanVal").value;
                }
            });
            $("mmForm")?.addEventListener("submit", saveMapMarkerItem);
        }

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

        async function quickSavePointRow(rowEl) {
            if (!isAdmin() || !rowEl) return;
            const [projectId, itemId] = (rowEl.dataset.pickSeg || "").split(":");
            const proj = state.projects.find(p => p.id === projectId);
            const item = proj?.items.find(r => r.id === itemId);
            if (!proj || !item) return;
            pushUndoSnapshot(`Nöqtə redaktəsi (${item.name})`);

            const antInp = rowEl.querySelector("[data-pt-ant]");
            const planInp = rowEl.querySelector("[data-pt-plan]");
            const doneInp = rowEl.querySelector("[data-pt-done]");
            const stSel = rowEl.querySelector("[data-pt-status]");

            if (antInp) item.antennas = Math.max(0, parseInt(antInp.value, 10) || 0);
            if (planInp) item.totalKm = normalizePointMetersInput(planInp.value);
            if (doneInp) item.doneKm = normalizePointMetersInput(doneInp.value);
            if (stSel && stSel.value) item.status = stSel.value;
            item.unit = "m";
            item.summary = true;

            saveSegmentOverride(proj.id, item);
            saveImportedProjects();
            if (api.configured) {
                try {
                    await api.saveSegment(proj.id, item.id, {
                        code: item.id,
                        name: item.name,
                        point_a: item.pointA || item.name || "",
                        point_b: item.pointB || "Şəbəkə",
                        total_km: item.totalKm,
                        done_km: item.doneKm,
                        antennas: item.antennas,
                        status: item.status,
                        contractor: item.contractor || null,
                        coords: item.coords
                    });
                } catch {}
            }
            const { planKm, doneKm } = getPointKmPair(item);
            recordAuditLog("Nöqtə Məsafə Redaktəsi", "🏢 BCG", `${proj.name} → ${item.name}`, `${item.antennas} antena - ${formatKm(planKm)} / ${formatKm(doneKm)} km (${t("status" + item.status)})`);
            renderAll();
            renderInfoCard();
            toast(`✅ ${item.name}: ${item.antennas} antena - ${formatKm(planKm)} / ${formatKm(doneKm)} km`);
        }

        card.addEventListener("keydown", e => {
            if (e.key === "Enter" && e.target.closest(".pt-quick-edit")) {
                e.preventDefault();
                e.stopPropagation();
                quickSavePointRow(e.target.closest("[data-pick-seg]"));
            }
        });

        card.addEventListener("click", async e => {
            if (e.target.closest(".nim-spec-box input, .nim-spec-box select")) {
                e.stopPropagation();
                return;
            }
            const nimStepBtn = e.target.closest("[data-nim-step]");
            if (nimStepBtn) {
                e.stopPropagation();
                if (!isAdmin()) return;
                const [projectId, itemId, fieldKey, deltaStr] = nimStepBtn.dataset.nimStep.split(":");
                const proj = state.projects.find(p => p.id === projectId);
                const item = proj?.items.find(r => r.id === itemId);
                if (!proj || !item || !fieldKey) return;
                const ns = normalizeNimSpec(item);
                const delta = Number(deltaStr) || 0;
                ns[fieldKey].done = Math.max(0, (ns[fieldKey].done || 0) + delta);
                if (ns[fieldKey].done > ns[fieldKey].plan) ns[fieldKey].plan = ns[fieldKey].done;
                item.nimSpec = ns;
                renderInfoCard();
                renderDetail();
                renderTable();
                await persistNimItem(proj, item);
                return;
            }
            const nimStageBtn = e.target.closest("[data-nim-stage]");
            if (nimStageBtn) {
                e.stopPropagation();
                if (!isAdmin()) return;
                const [projectId, itemId, stageKey] = nimStageBtn.dataset.nimStage.split(":");
                const proj = state.projects.find(p => p.id === projectId);
                const item = proj?.items.find(r => r.id === itemId);
                if (!proj || !item || !stageKey) return;
                const ns = normalizeNimSpec(item);
                ns.stages[stageKey] = !ns.stages[stageKey];
                item.nimSpec = ns;
                renderInfoCard();
                renderDetail();
                renderTable();
                await persistNimItem(proj, item);
                return;
            }
            const quickSaveBtn = e.target.closest("[data-pt-quick-save]");
            if (quickSaveBtn) {
                e.stopPropagation();
                quickSavePointRow(quickSaveBtn.closest("[data-pick-seg]"));
                return;
            }
            const saveExecBtn = e.target.closest("[data-save-exec-detail]");
            if (saveExecBtn) {
                e.stopPropagation();
                if (!isAdmin()) return;
                const [projectId, itemId] = saveExecBtn.dataset.saveExecDetail.split(":");
                const proj = state.projects.find(p => p.id === projectId);
                const item = proj?.items.find(r => r.id === itemId);
                const rowEl = saveExecBtn.closest("[data-pick-seg]");
                if (!proj || !item || !rowEl) return;
                pushUndoSnapshot(`İcraçı məlumatı (${item.name})`);
                const leadVal = (rowEl.querySelector("[data-exec-lead-inp]")?.value || "").trim();
                const wrkVal = (rowEl.querySelector("[data-exec-wrk-inp]")?.value || "").trim();
                const phnVal = (rowEl.querySelector("[data-exec-phn-inp]")?.value || "").trim();
                item.execLead = leadVal;
                item.execWorkers = wrkVal;
                item.execPhone = phnVal;
                if (!item.contractor && (leadVal || wrkVal || phnVal)) {
                    item.contractor = "BCG";
                }
                if (leadVal && isBcgContractor(item.contractor)) {
                    saveBcgLeadEntry(leadVal, wrkVal, phnVal);
                }
                saveSegmentOverride(proj.id, item);
                saveImportedProjects();
                if (api.configured) {
                    try {
                        await api.saveSegment(proj.id, item.dbId || item.id, { contractor: item.contractor || "" }, {
                            ctr: item.contractor || "",
                            eLead: item.execLead || "",
                            eWrk: item.execWorkers || "",
                            ePhn: item.execPhone || ""
                        });
                    } catch {}
                }
                recordAuditLog("İcraçı / Mühəndis Yenilənməsi", "🏢 BCG", `${proj.name} → ${item.name}`, `${item.contractor || "BCG"}: ${leadVal || "—"} (${wrkVal || 0} nəfər · ${phnVal || "—"})`);
                renderAll();
                toast(`✅ İcraçı məlumatı yadda saxlanıldı: ${leadVal || item.contractor}`);
                return;
            }
            const editSegBtn = e.target.closest("[data-edit-seg]");
            if (editSegBtn) {
                e.stopPropagation();
                if (!isAdmin()) return;
                const [projectId, itemId] = editSegBtn.dataset.editSeg.split(":");
                const proj = state.projects.find(p => p.id === projectId);
                const item = proj?.items.find(r => r.id === itemId);
                if (proj && item) editSegment(proj, item);
                return;
            }
            const pmoSplitBtn = e.target.closest("[data-pmo-split]");
            if (pmoSplitBtn) {
                e.stopPropagation();
                const [clusterKey, projectId, itemId] = pmoSplitBtn.dataset.pmoSplit.split("|");
                const proj = state.projects.find(p => p.id === projectId);
                const item = proj?.items.find(r => r.id === itemId);
                if (clusterKey && proj && item) {
                    toggleRayonClusterExpand(clusterKey, proj, item);
                }
                return;
            }
            const geomBtn = e.target.closest("[data-geom-edit]");
            if (geomBtn) {
                e.stopPropagation();
                const [projectId, itemId] = geomBtn.dataset.geomEdit.split(":");
                startGeomEdit(projectId, itemId);
                return;
            }
            const pick = e.target.closest("[data-pick-seg]");
            if (pick && !e.target.closest("select") && !e.target.closest("button") && !e.target.closest("input") && !e.target.closest("label") && !e.target.closest(".pt-quick-edit")) {
                const [projectId, itemId] = pick.dataset.pickSeg.split(":");
                const proj = state.projects.find(p => p.id === projectId);
                const item = proj?.items.find(r => r.id === itemId);
                if (proj && item) {
                    activeProjectId = proj.id;
                    window.__activeProjectId = proj.id;
                    selectSegment(proj, item);
                }
                return;
            }
            const act = e.target.closest("[data-card-act]")?.dataset.cardAct;
            if (act === "minimize") {
                card.classList.toggle("minimized");
                const isMin = card.classList.contains("minimized");
                const minBtn = card.querySelector('[data-card-act="minimize"] i');
                if (minBtn) minBtn.className = isMin ? "fa-solid fa-plus" : "fa-solid fa-minus";
                return;
            } else if (act === "close") {
                state.selected = null;
                activeProjectId = null;
                window.__activeProjectId = null;
                card.hidden = true;
                renderChips();
                updateLegendVisibility();
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
            } else if (act === "geomEdit") {
                const entry = selectedEntry();
                if (entry) {
                    startGeomEdit(entry.project.id, entry.item.id);
                } else if (activeProjectId) {
                    const proj = state.projects.find(p => p.id === activeProjectId);
                    if (proj && proj.items[0]) startGeomEdit(proj.id, proj.items[0].id);
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
            if (!isAdmin()) return;
            const leadPick = e.target.closest("[data-exec-lead-pick]");
            if (leadPick) {
                const rowEl = leadPick.closest("[data-pick-seg]");
                if (!rowEl) return;
                const opt = leadPick.selectedOptions[0];
                const leadInp = rowEl.querySelector("[data-exec-lead-inp]");
                const wrkInp = rowEl.querySelector("[data-exec-wrk-inp]");
                const phnInp = rowEl.querySelector("[data-exec-phn-inp]");
                if (leadInp && leadPick.value) leadInp.value = leadPick.value;
                if (wrkInp && opt?.dataset.wrk !== undefined && opt.dataset.wrk !== "") wrkInp.value = opt.dataset.wrk;
                if (phnInp && opt?.dataset.phn !== undefined && opt.dataset.phn !== "") phnInp.value = opt.dataset.phn;
                return;
            }
            if (e.target.closest("[data-pt-status]")) {
                await quickSavePointRow(e.target.closest("[data-pick-seg]"));
                return;
            }
            const nimSt = e.target.closest("[data-nim-status-select]");
            if (nimSt) {
                const [projectId, itemId] = nimSt.dataset.nimStatusSelect.split(":");
                const proj = state.projects.find(p => p.id === projectId);
                const item = proj?.items.find(r => r.id === itemId);
                if (!proj || !item) return;
                pushUndoSnapshot(`Status dəyişikliyi (${item.name})`);
                item.status = nimSt.value;
                saveSegmentOverride(proj.id, item);
                saveImportedProjects();
                if (isAdmin() && api.configured) {
                    try { await api.saveSegment(proj.id, item.dbId || item.id, { status: item.status }, item.nimSpec ? { nim: item.nimSpec } : null); } catch {}
                }
                recordAuditLog("Status Dəyişikliyi", "🚦 NİİM", item.name, `Svetofor nöqtəsinin statusu '${t("status" + item.status)}' olaraq yeniləndi`);
                renderAll();
                toast(`🚦 ${item.name} statusu yeniləndi: ${t("status" + item.status)}`);
                return;
            }
            const nimInp = e.target.closest("[data-nim-inp]");
            if (nimInp) {
                const [projectId, itemId, fieldKey, part] = nimInp.dataset.nimInp.split(":");
                const proj = state.projects.find(p => p.id === projectId);
                const item = proj?.items.find(r => r.id === itemId);
                if (!proj || !item || !fieldKey || !part) return;
                const ns = normalizeNimSpec(item);
                ns[fieldKey][part] = Math.max(0, Number(nimInp.value) || 0);
                item.nimSpec = ns;
                renderInfoCard();
                renderDetail();
                renderTable();
                await persistNimItem(proj, item);
                return;
            }
            const nimCtrl = e.target.closest("[data-nim-ctrl]");
            if (nimCtrl) {
                const [projectId, itemId] = nimCtrl.dataset.nimCtrl.split(":");
                const proj = state.projects.find(p => p.id === projectId);
                const item = proj?.items.find(r => r.id === itemId);
                if (!proj || !item) return;
                const ns = normalizeNimSpec(item);
                ns.controller = nimCtrl.value;
                item.nimSpec = ns;
                renderInfoCard();
                renderDetail();
                renderTable();
                await persistNimItem(proj, item);
                return;
            }
            const nimNote = e.target.closest("[data-nim-note]");
            if (nimNote) {
                const [projectId, itemId] = nimNote.dataset.nimNote.split(":");
                const proj = state.projects.find(p => p.id === projectId);
                const item = proj?.items.find(r => r.id === itemId);
                if (!proj || !item) return;
                const ns = normalizeNimSpec(item);
                ns.note = nimNote.value.trim();
                item.nimSpec = ns;
                renderDetail();
                await persistNimItem(proj, item);
                toast("📝 Qeyd yadda saxlanıldı");
                return;
            }
            const lineSt = e.target.closest("[data-line-status-select]");
            if (lineSt) {
                const [projectId, itemId] = lineSt.dataset.lineStatusSelect.split(":");
                const proj = state.projects.find(p => p.id === projectId);
                const item = proj?.items.find(r => r.id === itemId);
                if (!proj || !item) return;
                pushUndoSnapshot(`Status dəyişikliyi (${item.name})`);
                item.status = lineSt.value;
                if (item.status === "lif_goturulen") {
                    item.totalKm = 0;
                    item.doneKm = 0;
                }
                if (proj.items.length === 1) {
                    proj.status = item.status;
                    saveProjectOverride(proj);
                }
                saveSegmentOverride(proj.id, item);
                saveImportedProjects();
                if (isAdmin() && api.configured) {
                    try { await api.saveSegment(proj.id, item.id, { status: item.status, totalKm: item.totalKm, doneKm: item.doneKm }); } catch {}
                }
                recordAuditLog("Status Dəyişikliyi", proj.category === "azconnect" ? "🌐 Azərconnect" : "📁 Layihələr", item.name, `Kabel statusu '${t("status" + item.status)}' olaraq yeniləndi`);
                renderAll();
                toast(`〰️ ${item.name} statusu yeniləndi: ${t("status" + item.status)}`);
                return;
            }
            const foSel = e.target.closest("[data-fo-select]");
            if (foSel) {
                const rowEl = foSel.closest("[data-pick-seg]");
                if (!rowEl) return;
                const [projectId, itemId] = rowEl.dataset.pickSeg.split(":");
                const proj = state.projects.find(p => p.id === projectId);
                const item = proj?.items.find(r => r.id === itemId);
                if (!proj || !item) return;
                pushUndoSnapshot(`Kabel lif sayı (${item.name})`);
                item.fiberCount = normalizeFiberCount(foSel.value, "");
                item.userSetFiber = Boolean(item.fiberCount);
                saveSegmentOverride(proj.id, item);
                saveImportedProjects();
                recordAuditLog("Kabel Lif Sayı", proj.category === "azconnect" ? "🌐 Azərconnect" : "🏢 BCG", item.name, `Kabelin lif sayı dəyişdirildi: ${item.fiberCount || "Təyin edilməyib"}`);
                renderAll();
                toast(`🔌 ${item.name} kabel lif sayı yeniləndi: ${item.fiberCount || "Təyin edilməyib"}`);
                return;
            }
            const sel = e.target.closest("[data-exec-select]");
            if (!sel) return;
            const rowEl = sel.closest("[data-pick-seg]");
            if (!rowEl) return;
            const [projectId, itemId] = rowEl.dataset.pickSeg.split(":");
            const proj = state.projects.find(p => p.id === projectId);
            const item = proj?.items.find(r => r.id === itemId);
            if (!proj || !item) return;
            pushUndoSnapshot(`İcraçı dəyişikliyi (${item.name})`);
            const prevWasBcg = isBcgContractor(item.contractor);
            item.contractor = sel.value;
            if (isBcgContractor(item.contractor) && !prevWasBcg) {
                // BCG seçiləndə mühəndis / işçi sayı / nömrə xanaları boş açılır ki Admin özü daxil etsin
                item.execLead = item.execLead || "";
                item.execWorkers = item.execWorkers || "";
                item.execPhone = item.execPhone || "";
            }
            saveSegmentOverride(proj.id, item);
            saveImportedProjects();
            if (isAdmin() && api.configured) {
                try {
                    await api.saveSegment(proj.id, item.dbId || item.id, { contractor: item.contractor || "" }, {
                        ctr: item.contractor || "",
                        eLead: item.execLead || "",
                        eWrk: item.execWorkers || "",
                        ePhn: item.execPhone || ""
                    });
                } catch { /* lokal olaraq da yenilənir */ }
            }
            recordAuditLog("İcraçı Təyini", proj.category === "nim" ? "🚦 NİİM" : (proj.category === "azconnect" ? "🌐 Azərconnect" : "📁 Layihələr"), item.name, `İcraçı dəyişdirildi: ${item.contractor}`);
            renderAll();
            toast(`İş icraçısı yeniləndi: ${item.contractor}`);
        });
    }

    const AUDIT_STORE_KEY = "bcg.audit.logs.v1";
    const GEOM_STORE_KEY = "bcg.geom.overrides.v1";
    let geomEditState = null;
    let geomOverridesCache = readStore(GEOM_STORE_KEY, {}) || {};

    // IndexedDB-dən də daimi xətt/nöqtə koordinatlarını yüklə (localStorage dolsa belə itməsin)
    getFromIndexedDB(GEOM_STORE_KEY).then(idbData => {
        if (idbData && typeof idbData === "object") {
            geomOverridesCache = { ...idbData, ...geomOverridesCache };
            applySavedGeomOverrides();
            if (typeof drawRoutes === "function") drawRoutes();
        }
    }).catch(() => {});

    function applySavedGeomOverrides() {
        try {
            const ls = readStore(GEOM_STORE_KEY, null);
            if (ls && typeof ls === "object") {
                geomOverridesCache = { ...geomOverridesCache, ...ls };
            }
            const saved = geomOverridesCache;
            if (!saved || typeof saved !== "object") return;
            state.projects.forEach(p => {
                p.items.forEach(item => {
                    const keyById = `${p.id}:${item.id}`;
                    const keyByName = item.name ? `${p.id}::name::${String(item.name).trim()}` : "";
                    const coordsArr = (Array.isArray(saved[keyById]) && saved[keyById].length >= 1)
                        ? saved[keyById]
                        : ((keyByName && Array.isArray(saved[keyByName]) && saved[keyByName].length >= 1) ? saved[keyByName] : null);
                    if (coordsArr) {
                        item.coords = coordsArr.map(c => [Number(c[0]), Number(c[1])]);
                    }
                });
            });
        } catch {}
    }
    window.applySavedGeomOverrides = applySavedGeomOverrides;

    function clearGeomHandles() {
        if (!geomEditState) return;
        (geomEditState.vertexMarkers || []).forEach(m => m.remove());
        (geomEditState.midMarkers || []).forEach(m => m.remove());
        geomEditState.vertexMarkers = [];
        geomEditState.midMarkers = [];
    }

    function rebuildGeomHandles() {
        if (!geomEditState || !window.map) return;
        clearGeomHandles();
        const { item } = geomEditState;
        const coords = item.coords;
        if (!Array.isArray(coords) || coords.length === 0) return;
        const isLine = coords.length >= 2;

        // Hər qırılma nöqtəsi (və ya tək nöqtə) üçün sürüşdürülə bilən tutacaq
        coords.forEach(([lat, lng], idx) => {
            const el = document.createElement("div");
            el.className = "geom-vertex-handle";
            el.title = isLine
                ? `Qırılma nöqtəsi #${idx + 1} — Sürüşdürün (sağ klik: nöqtəni sil)`
                : `${item.name} — Yeni mövqeyə sürüşdürün`;

            const marker = new maplibregl.Marker({ element: el, draggable: true })
                .setLngLat([lng, lat])
                .addTo(map);

            marker.on("drag", () => {
                const pos = marker.getLngLat();
                item.coords[idx] = [Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6))];
                drawRoutes();
            });
            marker.on("dragend", () => {
                const pos = marker.getLngLat();
                item.coords[idx] = [Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6))];
                drawRoutes();
                rebuildGeomHandles();
            });

            el.addEventListener("contextmenu", ev => {
                ev.preventDefault();
                ev.stopPropagation();
                if (item.coords.length <= 2) {
                    toast("Xəttin ən azı 2 nöqtəsi qalmalıdır", true);
                    return;
                }
                item.coords.splice(idx, 1);
                drawRoutes();
                rebuildGeomHandles();
            });

            geomEditState.vertexMarkers.push(marker);
        });

        // Xətt seqmentlərinin ortasında "+" tutacağı: dartdıqda yeni qırılma nöqtəsi əlavə edir
        if (isLine) {
            for (let i = 0; i < coords.length - 1; i++) {
                const [lat1, lng1] = coords[i];
                const [lat2, lng2] = coords[i + 1];
                const midLat = (lat1 + lat2) / 2;
                const midLng = (lng1 + lng2) / 2;

                const midEl = document.createElement("div");
                midEl.className = "geom-mid-handle";
                midEl.textContent = "+";
                midEl.title = "Yeni qırılma nöqtəsi əlavə etmək üçün tutub çəkin";

                const midMarker = new maplibregl.Marker({ element: midEl, draggable: true })
                    .setLngLat([midLng, midLat])
                    .addTo(map);

                let insertedIdx = null;
                midMarker.on("dragstart", () => {
                    const pos = midMarker.getLngLat();
                    insertedIdx = i + 1;
                    item.coords.splice(insertedIdx, 0, [Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6))]);
                });
                midMarker.on("drag", () => {
                    if (insertedIdx == null) return;
                    const pos = midMarker.getLngLat();
                    item.coords[insertedIdx] = [Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6))];
                    drawRoutes();
                });
                midMarker.on("dragend", () => {
                    drawRoutes();
                    rebuildGeomHandles();
                });

                geomEditState.midMarkers.push(midMarker);
            }
        }
    }

    function startGeomEdit(projectId, itemId) {
        if (!isAdmin()) {
            toast("🔒 Xətt və nöqtələrin xəritədə redaktəsi yalnız Admin üçündür!", true);
            return;
        }
        const proj = state.projects.find(p => p.id === projectId);
        const item = proj?.items.find(r => r.id === itemId);
        if (!proj || !item) return;

        if (geomEditState) cancelGeomEdit(true);

        const origCoords = (item.coords || []).map(c => [Number(c[0]), Number(c[1])]);
        geomEditState = {
            project: proj,
            item,
            origCoords,
            vertexMarkers: [],
            midMarkers: []
        };

        state.selected = { projectId: proj.id, itemId: item.id };
        activeProjectId = proj.id;
        window.__activeProjectId = proj.id;

        const bar = $("geomEditBar");
        if (bar) {
            const isLine = origCoords.length >= 2;
            bar.innerHTML = `
                <span><i class="fa-solid fa-bezier-curve"></i> <b>${esc(item.name)}</b> — ${isLine ? "Qırılma nöqtələrini tutub sağa-sola çəkin ('+' ilə yeni əyilmə əlavə edin)" : "Nöqtəni tutub yeni yerə sürüşdürün"}</span>
                <button class="btn btn-primary" style="height:28px;padding:0 12px;font-size:12px" data-geom-act="save"><i class="fa-solid fa-check"></i> Yadda saxla</button>
                <button class="btn btn-outline" style="height:28px;padding:0 10px;font-size:12px;color:#fff;border-color:rgba(255,255,255,0.28)" data-geom-act="cancel">Ləğv et</button>
            `;
            bar.hidden = false;
        }

        flyToCoords(item.coords);
        drawRoutes();
        rebuildGeomHandles();
        toast("📐 Xəritədə redaktə aktivdir: nöqtələri tutub sürüşdürün");
    }

    async function saveGeomEdit() {
        if (!geomEditState) return;
        const { project, item, origCoords } = geomEditState;
        const newCoords = item.coords.map(c => [Number(Number(c[0]).toFixed(6)), Number(Number(c[1]).toFixed(6))]);
        // Ctrl+Z üçün əvvəlki koordinatlarla snapshot saxla
        item.coords = (origCoords || []).map(c => [c[0], c[1]]);
        pushUndoSnapshot(`Xəritədə sürüşdürmə (${item.name})`);
        item.coords = newCoords;

        // Vizual xətt / nöqtə koordinatlarını 3 qatda saxla: RAM + localStorage + IndexedDB (Excelə köçürmür, yalnız xəritədə saxlayır)
        const lsSaved = readStore(GEOM_STORE_KEY, {}) || {};
        geomOverridesCache = { ...geomOverridesCache, ...lsSaved };
        geomOverridesCache[`${project.id}:${item.id}`] = newCoords;
        if (item.name) {
            geomOverridesCache[`${project.id}::name::${String(item.name).trim()}`] = newCoords;
        }
        writeStore(GEOM_STORE_KEY, geomOverridesCache);
        try { await saveToIndexedDB(GEOM_STORE_KEY, geomOverridesCache); } catch {}

        // Yalnız Supabase-də olan (PMO olmayan) layihələr üçün bazaya göndər
        if (api.configured && !project.isPmo && !item.isMagistral) {
            try {
                await api.saveSegment(project.id, item.id, { coords: newCoords });
            } catch { /* lokal olaraq artıq saxlanılıb */ }
        }

        recordAuditLog(
            "Xəritə Redaktəsi",
            project.category === "nim" ? "🚦 NİİM" : (project.category === "azconnect" ? "🌐 Azərconnect" : "🏢 BCG"),
            item.name,
            `Koordinatlar xəritə üzərində sürüşdürülərək yeniləndi (${newCoords.length} nöqtə)`
        );

        clearGeomHandles();
        geomEditState = null;
        if ($("geomEditBar")) $("geomEditBar").hidden = true;
        renderAll();
        toast(`✅ "${item.name}" koordinatları yadda saxlanıldı!`);
    }

    function cancelGeomEdit(silent = false) {
        if (!geomEditState) return;
        geomEditState.item.coords = geomEditState.origCoords.map(c => [c[0], c[1]]);
        clearGeomHandles();
        geomEditState = null;
        if ($("geomEditBar")) $("geomEditBar").hidden = true;
        drawRoutes();
        if (!silent) toast("Redaktə ləğv edildi");
    }

    window.startGeomEdit = startGeomEdit;
    window.saveGeomOverride = async function (projectId, itemId, itemName, coords) {
        if (!Array.isArray(coords) || coords.length === 0) return;
        const cleanCoords = coords.map(c => [Number(Number(c[0]).toFixed(6)), Number(Number(c[1]).toFixed(6))]);
        const lsSaved = readStore(GEOM_STORE_KEY, {}) || {};
        geomOverridesCache = { ...geomOverridesCache, ...lsSaved };
        geomOverridesCache[`${projectId}:${itemId}`] = cleanCoords;
        if (itemName) geomOverridesCache[`${projectId}::name::${String(itemName).trim()}`] = cleanCoords;
        writeStore(GEOM_STORE_KEY, geomOverridesCache);
        try { await saveToIndexedDB(GEOM_STORE_KEY, geomOverridesCache); } catch {}
    };

    // 🧭 Map Marker Üslubunda Mövcud Layihə Daxilində Yeni Xətt və Nöqtə Yaratma (Yalnız Admin)
    const CUSTOM_ITEMS_STORE_KEY = "bcg.custom.items.v1";
    let mmCreateState = null;

    function calcCoordsMeters(coords) {
        if (!Array.isArray(coords) || coords.length < 2) return 0;
        if (window.tools && typeof tools.length === "function") {
            return tools.length(coords);
        }
        let sum = 0;
        const R = 6371000;
        const rad = d => d * Math.PI / 180;
        for (let i = 1; i < coords.length; i++) {
            const [lat1, lng1] = coords[i - 1];
            const [lat2, lng2] = coords[i];
            const dLat = rad(lat2 - lat1);
            const dLng = rad(lng2 - lng1);
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
            sum += 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }
        return sum;
    }

    function applySavedCustomItems() {
        try {
            const list = readStore(CUSTOM_ITEMS_STORE_KEY, []);
            if (!Array.isArray(list) || list.length === 0) return;
            list.forEach(entry => {
                if (!entry || !entry.projectId || !entry.item) return;
                let proj = state.projects.find(p => p.id === entry.projectId);
                if (!proj && entry.newProjectMeta) {
                    proj = {
                        ...entry.newProjectMeta,
                        items: []
                    };
                    state.projects.push(proj);
                    state.visibleIds.add(proj.id);
                }
                if (!proj) return;
                const exists = proj.items.some(i => i.id === entry.item.id);
                if (!exists) {
                    proj.items.push(entry.item);
                }
            });
        } catch {}
    }

    function clearMmMarkers() {
        if (!mmCreateState) return;
        (mmCreateState.markers || []).forEach(m => m.remove());
        mmCreateState.markers = [];
    }

    function rebuildMmMarkers() {
        if (!mmCreateState || !window.map) return;
        clearMmMarkers();
        window.__mmDraftCoords = mmCreateState.mode === "line" ? mmCreateState.coords : null;
        drawRoutes();

        mmCreateState.coords.forEach(([lat, lng], idx) => {
            const el = document.createElement("div");
            el.className = "geom-vertex-handle";
            el.title = `Nöqtə #${idx + 1} — yerini dəyişmək üçün sürüşdürün`;

            const marker = new maplibregl.Marker({ element: el, draggable: true })
                .setLngLat([lng, lat])
                .addTo(map);

            marker.on("drag", () => {
                const pos = marker.getLngLat();
                mmCreateState.coords[idx] = [Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6))];
                window.__mmDraftCoords = mmCreateState.mode === "line" ? mmCreateState.coords : null;
                drawRoutes();
                updateMmBar();
            });
            marker.on("dragend", () => {
                const pos = marker.getLngLat();
                mmCreateState.coords[idx] = [Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6))];
                updateMmBar();
            });

            mmCreateState.markers.push(marker);
        });
    }

    function updateMmBar() {
        const bar = $("geomEditBar");
        if (!bar || !mmCreateState) return;
        const { mode, coords } = mmCreateState;
        if (mode === "point") {
            if (coords.length === 0) {
                bar.innerHTML = `
                    <span><i class="fa-solid fa-location-dot"></i> <b>Yeni Nöqtə:</b> Xəritədə nöqtənin yerinə klikləyin</span>
                    <button class="btn btn-outline" style="height:28px;padding:0 10px;font-size:12px;color:#fff;border-color:rgba(255,255,255,0.28)" data-geom-act="mmCancel">Ləğv et</button>
                `;
            } else {
                const [lat, lng] = coords[0];
                bar.innerHTML = `
                    <span><i class="fa-solid fa-location-dot"></i> <b>Nöqtə (${lat.toFixed(5)}, ${lng.toFixed(5)}):</b> Sürüşdürüb dəqiqləşdirin və ya təsdiqləyin</span>
                    <button class="btn btn-primary" style="height:28px;padding:0 12px;font-size:12px" data-geom-act="mmFinish"><i class="fa-solid fa-check"></i> Layihəyə əlavə et</button>
                    <button class="btn btn-outline" style="height:28px;padding:0 10px;font-size:12px;color:#fff;border-color:rgba(255,255,255,0.28)" data-geom-act="mmCancel">Ləğv et</button>
                `;
            }
        } else {
            const lenM = calcCoordsMeters(coords);
            bar.innerHTML = `
                <span><i class="fa-solid fa-route"></i> <b>Yeni Xətt:</b> ${coords.length} nöqtə ${coords.length >= 2 ? `· Uzunluq: <b>${formatDistance(lenM)}</b>` : "(Xəritədə ardıcıl nöqtələrə klikləyin)"}</span>
                ${coords.length > 0 ? `<button class="btn btn-outline" style="height:28px;padding:0 10px;font-size:12px;color:#fff;border-color:rgba(255,255,255,0.28)" data-geom-act="mmUndo"><i class="fa-solid fa-rotate-left"></i> Geri</button>` : ""}
                ${coords.length >= 2 ? `<button class="btn btn-primary" style="height:28px;padding:0 12px;font-size:12px" data-geom-act="mmFinish"><i class="fa-solid fa-check"></i> Tamamla & Layihəyə əlavə et</button>` : ""}
                <button class="btn btn-outline" style="height:28px;padding:0 10px;font-size:12px;color:#fff;border-color:rgba(255,255,255,0.28)" data-geom-act="mmCancel">Ləğv et</button>
            `;
        }
        bar.hidden = false;
    }

    function startMapMarkerCreate(mode) {
        if (!isAdmin()) {
            toast("🔒 Bu funksiya yalnız Admin üçündür!", true);
            return;
        }
        if (geomEditState) cancelGeomEdit(true);
        if (mmCreateState) cancelMapMarkerCreate(true);

        mmCreateState = {
            mode,
            coords: [],
            markers: []
        };
        document.querySelectorAll("[data-mm-start]").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.mmStart === mode);
        });
        $("mmFabToggle")?.classList.add("active");
        if (window.map) map.getCanvas().style.cursor = "crosshair";
        updateMmBar();
        toast(mode === "point"
            ? "📍 Xəritədə yeni nöqtənin yerinə klikləyin"
            : "〰️ Xəritədə ardıcıl klikləyərək xətti çəkin, bitirdikdə 'Tamamla' basın");
    }

    function handleMapMarkerClick(e) {
        if (!mmCreateState) return false;
        const lat = Number(e.lngLat.lat.toFixed(6));
        const lng = Number(e.lngLat.lng.toFixed(6));

        if (mmCreateState.mode === "point") {
            mmCreateState.coords = [[lat, lng]];
            rebuildMmMarkers();
            updateMmBar();
            openMapMarkerModal();
            return true;
        } else {
            mmCreateState.coords.push([lat, lng]);
            rebuildMmMarkers();
            updateMmBar();
            return true;
        }
    }

    function undoMapMarkerVertex() {
        if (!mmCreateState || mmCreateState.coords.length === 0) return;
        mmCreateState.coords.pop();
        rebuildMmMarkers();
        updateMmBar();
    }

    function cancelMapMarkerCreate(silent = false) {
        if (!mmCreateState) return;
        clearMmMarkers();
        mmCreateState = null;
        window.__mmDraftCoords = null;
        document.querySelectorAll("[data-mm-start]").forEach(btn => btn.classList.remove("active"));
        $("mmFabToggle")?.classList.remove("active");
        if ($("geomEditBar")) $("geomEditBar").hidden = true;
        if ($("mapMarkerModal")?.open) $("mapMarkerModal").close();
        if (window.map) map.getCanvas().style.cursor = "";
        drawRoutes();
        if (!silent) toast("Əlavəetmə ləğv edildi");
    }

    function syncMmFormForProject() {
        const sel = $("mmProjectSelect");
        if (!sel || !mmCreateState) return;
        const val = sel.value;
        const isNewProj = val === "__new__";
        if ($("mmNewProjWrap")) $("mmNewProjWrap").hidden = !isNewProj;

        const proj = state.projects.find(p => p.id === val);
        const activeCat = [...state.activeFolders][0] || "project";
        const isOther = proj ? proj.category === "other" : (isNewProj && activeCat === "other");
        const isPointMode = mmCreateState.mode === "point" || (proj && (proj.type === "points" || proj.category === "nim"));
        const isNim = proj?.category === "nim";

        if ($("mmStatusWrap")) $("mmStatusWrap").hidden = isOther;
        if ($("mmContractorWrap")) $("mmContractorWrap").hidden = isOther;
        if ($("mmOtherStyleWrap")) $("mmOtherStyleWrap").hidden = !isOther;
        if ($("mmPlanWrap")) $("mmPlanWrap").hidden = isOther;
        if ($("mmDoneWrap")) $("mmDoneWrap").hidden = isOther;
        if ($("mmPointAWrap")) $("mmPointAWrap").hidden = isOther || mmCreateState.mode === "point";
        if ($("mmPointBWrap")) $("mmPointBWrap").hidden = isOther || mmCreateState.mode === "point";
        if ($("mmFiberWrap")) $("mmFiberWrap").hidden = isOther || mmCreateState.mode === "point";
        if ($("mmAntennasWrap")) $("mmAntennasWrap").hidden = isOther || !(isPointMode && !isNim);

        const lenM = calcCoordsMeters(mmCreateState.coords);
        if (isPointMode) {
            if ($("mmPlanLabel")) $("mmPlanLabel").textContent = "1. Nəzərdə tutulan məsafə (m)";
            if ($("mmDoneLabel")) $("mmDoneLabel").textContent = "2. Faktiki çəkilən məsafə (m)";
            if (mmCreateState.coords.length >= 2) {
                $("mmPlanVal").value = Math.round(lenM);
            } else if (Number($("mmPlanVal").value) <= 100) {
                $("mmPlanVal").value = isNim ? 1 : 5000;
            }
        } else {
            if ($("mmPlanLabel")) $("mmPlanLabel").textContent = "1. Nəzərdə tutulan məsafə (km)";
            if ($("mmDoneLabel")) $("mmDoneLabel").textContent = "2. Faktiki çəkilən məsafə (km)";
            const km = Math.max(0.1, Math.round((lenM / 1000) * 100) / 100);
            $("mmPlanVal").value = km;
        }
    }

    function openMapMarkerModal() {
        if (!mmCreateState) return;
        if (mmCreateState.mode === "line" && mmCreateState.coords.length < 2) {
            toast("Xətt üçün ən azı 2 nöqtə klikləyin", true);
            return;
        }
        if (mmCreateState.mode === "point" && mmCreateState.coords.length < 1) {
            toast("Xəritədə nöqtənin yerinə klikləyin", true);
            return;
        }

        const activeCats = state.activeFolders.size > 0
            ? [...state.activeFolders]
            : ["project", "nim", "azconnect", "other"];
        const catNames = { project: "🏢 BCG", nim: "🚦 NİİM", azconnect: "🌐 Azərconnect", other: "🗂️ Digər" };

        const candidateProjects = state.projects.filter(p => activeCats.includes(p.category || "project"));
        const pool = candidateProjects.length > 0 ? candidateProjects : state.projects;

        const projSel = $("mmProjectSelect");
        const curProjId = state.selected?.projectId || activeProjectId || pool[0]?.id || "";
        projSel.innerHTML = pool.map(p => {
            const cat = p.category || "project";
            const cleanTitle = String(p.name || "").replace(/^Digər\s*:\s*/i, "").trim();
            return `<option value="${esc(p.id)}" ${p.id === curProjId ? "selected" : ""}>[${catNames[cat] || "BCG"}] ${esc(cleanTitle)}</option>`;
        }).join("") + `<option value="__new__">➕ Aktiv qovluqda yeni layihə yarat...</option>`;

        $("mmStatusSelect").innerHTML = STATUSES.map(s => `<option value="${s}">${t("status" + s)}</option>`).join("");
        $("mmStatusSelect").value = "icrada";

        if ($("mmFiberSelect")) {
            $("mmFiberSelect").innerHTML = FIBER_OPTIONS.map(fo => `<option value="${esc(fo)}">🔌 ${esc(fo)}</option>`).join("");
            $("mmFiberSelect").value = "FO 48";
        }

        const contractorNames = Object.keys(syncAdminContractors());
        $("mmContractorSelect").innerHTML = `<option value="">— İcraçı seçilməyib —</option>` + contractorNames.map(n => `<option value="${esc(n)}">👷 ${esc(n)}</option>`).join("");

        $("mmModalTitle").textContent = mmCreateState.mode === "point"
            ? "📍 Yeni Nöqtəni Layihəyə Əlavə Et"
            : "〰️ Yeni Xətti Layihəyə Əlavə Et";
        $("mmItemName").value = "";
        $("mmDoneVal").value = 0;
        $("mmCoordsText").value = mmCreateState.coords.map(c => `${c[0]}, ${c[1]}`).join("\n");
        $("mmFormError").textContent = "";
        if ($("mmCfRows")) {
            $("mmCfRows").innerHTML = mmCreateState.mode === "point"
                ? `<div class="cf-row"><input type="text" class="input cf-lbl" placeholder="Başlıq (özünüz yazın)…"><input type="text" class="input cf-val" placeholder="Məlumat / Dəyər…"><button type="button" class="icon-btn small cf-del" title="Sil"><i class="fa-solid fa-xmark"></i></button></div>`
                : "";
        }

        syncMmFormForProject();
        $("mapMarkerModal")?.showModal();
    }

    async function saveMapMarkerItem(event) {
        event.preventDefault();
        if (!mmCreateState) return;
        const currentMode = mmCreateState.mode || "point";

        const projVal = $("mmProjectSelect").value;
        const itemName = $("mmItemName").value.trim();
        const status = $("mmStatusSelect").value || "layihe";
        const contractor = $("mmContractorSelect").value || "";
        const pointA = $("mmPointA").value.trim() || itemName || "Mərkəz";
        const pointB = $("mmPointB").value.trim() || "Şəbəkə";
        const planVal = Math.max(0, Number($("mmPlanVal").value) || 0);
        const doneVal = Math.max(0, Number($("mmDoneVal").value) || 0);
        const antennas = Math.max(0, Number($("mmAntennasVal").value) || 0);
        const customFields = [...document.querySelectorAll("#mmCfRows .cf-row")].map(r => ({
            label: r.querySelector(".cf-lbl")?.value.trim() || "",
            value: r.querySelector(".cf-val")?.value.trim() || ""
        })).filter(x => x.label || x.value);

        if (!itemName) {
            $("mmFormError").textContent = "Adı (Name) daxil edin";
            return;
        }

        let coords;
        try {
            coords = textToCoords($("mmCoordsText").value, currentMode === "point" ? 1 : 2);
        } catch {
            $("mmFormError").textContent = t("coordsInvalid");
            return;
        }

        let targetProj = state.projects.find(p => p.id === projVal);
        let newProjectMeta = null;

        pushUndoSnapshot(`Yeni obyekt əlavəsi (${itemName})`);

        if (projVal === "__new__") {
            const newProjName = $("mmNewProjName").value.trim();
            if (!newProjName) {
                $("mmFormError").textContent = "Yeni layihənin adını daxil edin";
                return;
            }
            const activeCat = [...state.activeFolders][0] || "project";
            const newId = `proj_mm_${Date.now()}`;
            newProjectMeta = {
                id: newId,
                name: newProjName,
                category: activeCat,
                type: currentMode === "point" ? "points" : "lines",
                status,
                startDate: "",
                endDate: ""
            };
            targetProj = { ...newProjectMeta, items: [] };
            state.projects.push(targetProj);
            state.visibleIds.add(targetProj.id);
            state.activeFolders.add(activeCat);
            saveProjectOverride(targetProj);
        }

        if (!targetProj) {
            $("mmFormError").textContent = "Layihə seçilməyib";
            return;
        }
        if (!Array.isArray(targetProj.items)) targetProj.items = [];

        let newItemId = `${currentMode === "point" ? "PT" : "LN"}-${Date.now().toString().slice(-4)}`;
        while (targetProj.items.some(it => it.id === newItemId)) {
            newItemId = `${currentMode === "point" ? "PT" : "LN"}-${Date.now().toString().slice(-4)}-${Math.floor(Math.random() * 90 + 10)}`;
        }
        const fiberCount = normalizeFiberCount($("mmFiberSelect")?.value || "FO 48");
        const isTargetOther = targetProj.category === "other";
        const isPointProj = currentMode === "point" || targetProj.type === "points" || targetProj.category === "nim";
        const customColor = isTargetOther ? normalizeColorCode($("mmCustomColor")?.value || $("mmColorPicker")?.value, "#38BDF8") : "";
        const lineWidth = isTargetOther ? normalizeLineWidth($("mmLineWidth")?.value, 1.8) : 0;
        const newItem = {
            id: newItemId,
            name: itemName,
            pointA: isTargetOther ? "" : pointA,
            pointB: isTargetOther ? "" : pointB,
            startDate: new Date().toISOString().slice(0, 10),
            endDate: "",
            contractor: isTargetOther ? "" : contractor,
            totalKm: planVal,
            doneKm: doneVal,
            unit: isPointProj ? "m" : undefined,
            summary: isPointProj ? true : undefined,
            status,
            fiberCount,
            customColor,
            lineWidth,
            closures: 0,
            manholes: 0,
            antennas: currentMode === "point" ? Math.max(1, antennas) : antennas,
            customFields,
            coords
        };

        targetProj.items.push(newItem);
        saveSegmentOverride(targetProj.id, newItem);
        saveImportedProjects();
        state.visibleIds.add(targetProj.id);
        state.expandedIds.add(targetProj.id);
        state.activeFolders.add(targetProj.category || "project");

        // Lokal yaddaşda saxla ki səhifə yenilənəndə itməsin
        const savedList = readStore(CUSTOM_ITEMS_STORE_KEY, []);
        savedList.push({
            projectId: targetProj.id,
            newProjectMeta,
            item: newItem
        });
        writeStore(CUSTOM_ITEMS_STORE_KEY, savedList);

        // Pəncərəni DƏRHAL bağla və xəritədə göstər (şəbəkə gözləmədən!)
        $("mapMarkerModal")?.close();
        cancelMapMarkerCreate(true);
        selectSegment(targetProj, newItem);
        toast(`✅ "${newItem.name}" layihəyə (${targetProj.name}) əlavə olundu!`);

        try {
            recordAuditLog(
                currentMode === "point" ? "Yeni Nöqtə Əlavəsi" : "Yeni Xətt Əlavəsi",
                targetProj.category === "nim" ? "🚦 NİİM" : (targetProj.category === "azconnect" ? "🌐 Azərconnect" : "🏢 BCG"),
                `${targetProj.name} → ${newItem.name}`,
                `Status: ${t("status" + newItem.status)} · Plan: ${newItem.totalKm} / Faktiki: ${newItem.doneKm}`
            );
        } catch {}

        // Supabase aktivdirsə arxa fonda bütün layihə və nöqtələrini bazaya yaz
        if (api.configured) {
            (async () => {
                try {
                    await api.saveProject(targetProj);
                } catch {}
            })();
        }
    }

    window.handleMapMarkerClick = handleMapMarkerClick;
    function recordAuditLog(actionType, folder, target, details) {
        try {
            const raw = localStorage.getItem(AUDIT_STORE_KEY);
            const list = raw ? JSON.parse(raw) : [];
            const now = new Date();
            const pad = n => String(n).padStart(2, "0");
            const timeStr = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
            const email = state.user?.email || "turan.bagirov@bcg.az";
            const displayUser = state.user?.name || (isAdmin() ? "Turan Bağırov (Admin)" : email.split("@")[0]);
            list.unshift({
                id: Date.now(),
                time: timeStr,
                userName: displayUser,
                userEmail: email,
                role: state.role || "admin",
                ip: "185.18.244.12 · Chrome",
                actionType,
                folder,
                target,
                details
            });
            localStorage.setItem(AUDIT_STORE_KEY, JSON.stringify(list.slice(0, 120)));
        } catch {}
    }

    function ensureDefaultNimAndAzconnect() {
        if (!state.projects.some(p => p.category === "nim")) {
            const nim1 = {
                id: "nim_baki_svetofor",
                name: "NİİM – Bakı Svetofor Kəsişmələri",
                category: "nim",
                type: "points",
                status: "icrada",
                items: [
                    { id: "NIM-01", name: "28 May – Rəşid Behbudov kəsişməsi", status: "bitmis", contractor: "", totalKm: 1, doneKm: 1, antennas: 1, coords: [[40.3798, 49.8486]] },
                    { id: "NIM-02", name: "Heydər Əliyev pr. – Koroğlu qovşağı", status: "icrada", contractor: "", totalKm: 1, doneKm: 0.6, antennas: 1, coords: [[40.4209, 49.9182]] },
                    { id: "NIM-03", name: "Tbilisi pr. – 20 Yanvar dairəsi", status: "icrada", contractor: "", totalKm: 1, doneKm: 0.7, antennas: 1, coords: [[40.4098, 49.8085]] },
                    { id: "NIM-04", name: "Babək pr. – Xalqlar Dostluğu kəsişməsi", status: "tehvil", contractor: "", totalKm: 1, doneKm: 1, antennas: 1, coords: [[40.3972, 49.9531]] },
                    { id: "NIM-05", name: "Ziya Bünyadov pr. – Karl Marks dairəsi", status: "layihe", contractor: "", totalKm: 1, doneKm: 0, antennas: 1, coords: [[40.4152, 49.8538]] },
                    { id: "NIM-06", name: "Nobel pr. – Ağ Şəhər svetofor qovşağı", status: "bitmis", contractor: "", totalKm: 1, doneKm: 1, antennas: 1, coords: [[40.3774, 49.8920]] }
                ]
            };
            const nim2 = {
                id: "nim_sumqayit_gence",
                name: "NİİM – Sumqayıt və Gəncə Svetoforları",
                category: "nim",
                type: "points",
                status: "icrada",
                items: [
                    { id: "NIM-07", name: "Sumqayıt – Sülh küçəsi mərkəzi kəsişmə", status: "bitmis", contractor: "", totalKm: 1, doneKm: 1, antennas: 1, coords: [[40.5897, 49.6686]] },
                    { id: "NIM-08", name: "Gəncə – Heydər Əliyev pr. mərkəzi svetofor", status: "icrada", contractor: "", totalKm: 1, doneKm: 0.5, antennas: 1, coords: [[40.6828, 46.3606]] }
                ]
            };
            state.projects.push(nim1, nim2);
            const hiddenSet = getHiddenProjectIds();
            if (!hiddenSet.has(nim1.id)) state.visibleIds.add(nim1.id);
            if (!hiddenSet.has(nim2.id)) state.visibleIds.add(nim2.id);
        }
        if (!state.projects.some(p => p.category === "azconnect")) {
            const azc1 = {
                id: "azc_abseron_ring",
                name: "Azərconnect – Bakı-Abşeron Magistral Halqası",
                category: "azconnect",
                type: "lines",
                status: "icrada",
                items: [
                    { id: "AZC-01", name: "Bakı Mərkəz – Xırdalan – Sumqayıt xətti", pointA: "Bakı Mərkəz Qovşaq", pointB: "Sumqayıt Stansiya", status: "bitmis", fiberCount: "FO 48", totalKm: 36.4, doneKm: 36.4, contractor: "Azərconnect", coords: [[40.4093, 49.8671], [40.4520, 49.7550], [40.5897, 49.6686]] },
                    { id: "AZC-02", name: "Bakı – Hövsan – Türkan – Zirə xətti", pointA: "Bakı Şərq Qovşaq", pointB: "Zirə Qovşaq", status: "icrada", fiberCount: "FO 24", totalKm: 42.0, doneKm: 28.5, contractor: "BCG", execLead: "Samir Əliyev", execWorkers: 5, execPhone: "+994502221100", coords: [[40.3890, 49.9520], [40.3690, 50.0850], [40.3640, 50.2910]] }
                ]
            };
            const azc2 = {
                id: "azc_merkez_west",
                name: "Azərconnect – Qərb və Mərkəzi Aran Xətti",
                category: "azconnect",
                type: "lines",
                status: "icrada",
                items: [
                    { id: "AZC-03", name: "Hacıqabul – Kürdəmir – Ucar – Yevlax xətti", pointA: "Hacıqabul Qovşaq", pointB: "Yevlax Qovşaq", status: "icrada", fiberCount: "FO 48", totalKm: 168.0, doneKm: 119.5, contractor: "Azərconnect", coords: [[40.0394, 48.9356], [40.3425, 48.1564], [40.5180, 47.6500], [40.6172, 47.1500]] },
                    { id: "AZC-04", name: "Yevlax – Gəncə – Şəmkir xətti", pointA: "Yevlax Qovşaq", pointB: "Şəmkir Stansiya", status: "tehvil", fiberCount: "FO 12", totalKm: 104.5, doneKm: 104.5, contractor: "BCG", execLead: "Rəşad Quliyev", execWorkers: 6, execPhone: "+994503332211", coords: [[40.6172, 47.1500], [40.6828, 46.3606], [40.8297, 46.0178]] }
                ]
            };
            state.projects.push(azc1, azc2);
            const hiddenSet = getHiddenProjectIds();
            if (!hiddenSet.has(azc1.id)) state.visibleIds.add(azc1.id);
            if (!hiddenSet.has(azc2.id)) state.visibleIds.add(azc2.id);
        } else {
            // Əvvəllər yaddaşda qalmış Azconnect xətlərində icraçıları sütunlardan (props) və ya defaultdan bərpa et
            state.projects.filter(p => p.category === "azconnect").forEach(p => {
                (p.items || []).forEach(r => {
                    if (!r.contractor && r.props) {
                        const extracted = extractContractorFromProps(r.props);
                        if (extracted) {
                            const parsed = parseContractorAndLead(extracted, r.props);
                            r.contractor = parsed.contractor || extracted;
                            if (parsed.execLead && !r.execLead) r.execLead = parsed.execLead;
                            if (parsed.execWorkers !== "" && r.execWorkers === undefined) r.execWorkers = parsed.execWorkers;
                            if (parsed.execPhone && !r.execPhone) r.execPhone = parsed.execPhone;
                        }
                    }
                    if (!r.contractor) {
                        if (r.id === "AZC-01" || r.id === "AZC-03") r.contractor = "Azconnect";
                        else if (r.id === "AZC-02") { r.contractor = "BCG"; r.execLead = r.execLead || "Samir Əliyev"; r.execWorkers = r.execWorkers || 5; }
                        else if (r.id === "AZC-04") { r.contractor = "BCG"; r.execLead = r.execLead || "Rəşad Quliyev"; r.execWorkers = r.execWorkers || 6; }
                    }
                });
            });
        }
    }

    function renderInfoCard() {
        ensureMapWidgets();
        const card = $("infoCard");
        if (!card) return;

        $("listView").hidden = false;
        $("detailView").hidden = true;

        const entry = selectedEntry();
        // Aktiv layihə adına klikləyəndə sol yuxarı küncdə ümumi status pəncərəsi açılmasın — yalnız konkret obyekt / rayon / nöqtə seçildikdə göstərilsin
        if (!entry) {
            card.hidden = true;
            return;
        }
        const proj = entry.project;
        if (!proj || !state.visibleIds.has(proj.id) || !state.activeFolders.has(proj.category || "project")) {
            card.hidden = true;
            return;
        }
        card.hidden = false;
        // Əvvəlki ölçüləri sıfırla ki pəncərə altında boş yer qalmasın
        card.style.width = "";
        card.style.height = "";

        const isOtherProj = proj.category === "other"
            || /^Digər\s*:/i.test(String(proj.name || ""))
            || Boolean(entry?.item?.isPolygon);

        // 🗂️ Digər bölməsi üçün kiçik, yığcam pəncərə (boş yer qalmadan)
        if (isOtherProj) {
            proj.category = "other";
            card.classList.add("compact-other");
            card.classList.remove("single-seg");
            const rawLabel = entry ? entry.item.name : proj.name;
            const labelText = String(rawLabel || "").replace(/^Digər\s*:\s*/i, "").trim() || rawLabel;
            const dotColor = normalizeColorCode(entry?.item?.customColor || proj.customColor, "#38BDF8");
            card.innerHTML = `
                <div class="info-card-head" style="border-radius:20px;padding:6px 12px;gap:10px">
                    <strong style="display:flex;align-items:center;gap:7px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">
                        <span class="dot" style="background:${esc(dotColor)}"></span>
                        ${esc(labelText)}
                    </strong>
                    <div style="display:flex;align-items:center;gap:3px;flex-shrink:0">
                        <button class="icon-btn" data-card-act="zoom" title="${t("zoomTo")}"><i class="fa-solid fa-crosshairs"></i></button>
                        ${isAdmin() ? `<button class="icon-btn" data-card-act="geomEdit" title="Xəritədə sürüşdür / Redaktə et"><i class="fa-solid fa-bezier-curve"></i></button>` : ""}
                        ${isAdmin() ? `<button class="icon-btn" data-card-act="edit" title="Adı / Rəngi / Qalınlığı redaktə et"><i class="fa-solid fa-pen"></i></button>` : ""}
                        <button class="icon-btn" data-card-act="close" title="${t("close")}"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>
            `;
            return;
        }
        card.classList.remove("compact-other");
        card.classList.toggle("single-seg", Boolean(entry));

        const isPoints = proj.type === "points";
        const items = entry ? [entry.item] : proj.items;
        const sum = totals(proj.items);
        const pct = percent(sum.done, sum.plan);
        const leftVal = Math.max(0, sum.plan - sum.done);
        const tone = statusTone(proj.status);
        const cleanProjName = cleanProjectName(proj.name, proj.sheetId || proj.pmoMeta?.sheetId).replace(/\s*\(?\bFaz[-\s]*[12]\b\)?/gi, "").trim();

        // 🚦 NİİM (Svetofor kəsişmə nöqtələri — dirəklər, işıqforlar, optik/elektrik çəkilişi, mərhələlər)
        if (proj.category === "nim") {
            const doneCount = proj.items.filter(i => i.status === "bitmis" || i.status === "tehvil").length;
            const inProgCount = proj.items.filter(i => i.status === "icrada").length;
            const nimTot = summarizeNimItems(proj.items);
            card.innerHTML = `
                <div class="info-card-head">
                    <div>
                        <small style="display:flex;align-items:center;gap:6px">
                            <span class="dot" style="background:${tone}"></span>
                            <span>🚦 NİİM · Svetofor kəsişmə nöqtələri (${proj.items.length})</span>
                        </small>
                        <strong>${esc(cleanProjName)}</strong>
                    </div>
                    <div style="display:flex;align-items:center;gap:4px">
                        <button class="icon-btn" data-card-act="close" title="${t("close")}"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>
                <div class="info-card-body">
                    ${!entry ? `<div class="info-grid">
                        <div class="info-stat"><small>Cəmi kəsişmə</small><b>${proj.items.length} nöqtə</b></div>
                        <div class="info-stat"><small>Hazır / Təhvil</small><b style="color:#22C55E">${doneCount} nöqtə</b></div>
                        <div class="info-stat"><small>İcrada</small><b style="color:#F59E0B">${inProgCount} nöqtə</b></div>
                    </div>
                    <div class="nim-tot-bar">
                        <span>A-dirək: <b>${nimTot.poleA.done}/${nimTot.poleA.plan}</b></span>
                        <span>L-dirək: <b>${nimTot.poleL.done}/${nimTot.poleL.plan}</b></span>
                        <span>Piyada: <b>${nimTot.pedSig.done}/${nimTot.pedSig.plan}</b></span>
                        <span>Nəqliyyat: <b>${nimTot.vehSig.done}/${nimTot.vehSig.plan}</b></span>
                        <span>Optik: <b>${nimTot.opticM.done}/${nimTot.opticM.plan}m</b></span>
                        <span>Elektrik: <b>${nimTot.elecM.done}/${nimTot.elecM.plan}m</b></span>
                    </div>` : ""}
                    <div class="info-sub-list">
                        ${items.map(r => {
                            const rTone = statusTone(r.status);
                            const ns = normalizeNimSpec(r);
                            const np = calcNimProgress(r);
                            return `
                                <div class="info-sub-item" data-pick-seg="${esc(proj.id)}:${esc(r.id)}" style="border-color:${entry?.item === r ? rTone : "var(--line)"}">
                                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                                        <strong style="display:flex;align-items:center;gap:6px;min-width:0">
                                            <span class="dot" style="background:${rTone}"></span>
                                            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">🚦 ${esc(r.name)}</span>
                                        </strong>
                                        <div style="display:flex;align-items:center;gap:6px;flex:none">
                                            <span class="nim-pct-badge" style="color:${rTone}">${np.pct}%</span>
                                            <span class="pill" style="--tone:${rTone}">${t(`status${r.status}`)}</span>
                                        </div>
                                    </div>
                                    <div class="progress" style="margin:2px 0 4px"><span style="width:${np.pct}%;background:${rTone}"></span></div>
                                    <div class="info-exec-row">
                                        <span class="muted">Nöqtə statusu:</span>
                                        ${isAdmin() ? `
                                        <select class="input" data-nim-status-select="${esc(proj.id)}:${esc(r.id)}">
                                            ${["bitmis", "icrada", "layihe"].map(s => `<option value="${s}" ${(r.status === s || (s === "bitmis" && r.status === "tehvil")) ? "selected" : ""}>${t(`status${s}`)}</option>`).join("")}
                                        </select>
                                        ` : `<b style="font-size:11.5px;color:${rTone}">${t(`status${r.status}`)}</b>`}
                                    </div>
                                    <div class="info-exec-row">
                                        <span class="muted">İcraçı:</span>
                                        ${executorOptionsHtml(r.contractor, r)}
                                    </div>
                                    ${renderExecDetailBlockHtml(r, proj)}
                                    <div class="nim-spec-box">
                                        <div class="nim-spec-title"><span>📋 Dirəklər, İşıqforlar və Çəkilişlər</span><span class="muted">${np.doneStages}/${np.totalStages} mərhələ</span></div>
                                        <div class="nim-spec-grid">
                                            ${NIM_SPEC_FIELDS.map(f => {
                                                const val = ns[f.key];
                                                return `
                                                <div class="nim-spec-row">
                                                    <span class="nim-spec-lbl"><i class="fa-solid ${f.icon}"></i> ${f.label}</span>
                                                    ${isAdmin() ? `
                                                    <div class="nim-spec-ctrl">
                                                        <button type="button" class="nim-step-btn" data-nim-step="${esc(proj.id)}:${esc(r.id)}:${f.key}:-${f.step}">−</button>
                                                        <input type="number" min="0" class="nim-num-inp" value="${val.done}" title="Quraşdırılıb / Çəkilib" data-nim-inp="${esc(proj.id)}:${esc(r.id)}:${f.key}:done">
                                                        <span class="muted">/</span>
                                                        <input type="number" min="0" class="nim-num-inp" value="${val.plan}" title="Plan" data-nim-inp="${esc(proj.id)}:${esc(r.id)}:${f.key}:plan">
                                                        <button type="button" class="nim-step-btn" data-nim-step="${esc(proj.id)}:${esc(r.id)}:${f.key}:${f.step}">+</button>
                                                        <small class="muted">${f.unit}</small>
                                                    </div>
                                                    ` : `<b class="nim-spec-val">${val.done} / ${val.plan} ${f.unit}</b>`}
                                                </div>`;
                                            }).join("")}
                                        </div>
                                        <div class="info-exec-row" style="margin-top:6px">
                                            <span class="muted">Kontroller şkafı:</span>
                                            ${isAdmin() ? `
                                            <select class="input" data-nim-ctrl="${esc(proj.id)}:${esc(r.id)}">
                                                ${Object.entries(NIM_CTRL_LABELS).map(([k, lbl]) => `<option value="${k}" ${ns.controller === k ? "selected" : ""}>${lbl}</option>`).join("")}
                                            </select>
                                            ` : `<b>${esc(NIM_CTRL_LABELS[ns.controller] || "Yoxdur")}</b>`}
                                        </div>
                                        <div class="nim-stages-row">
                                            ${NIM_STAGES.map(st => {
                                                const on = Boolean(ns.stages[st.key]);
                                                return isAdmin()
                                                    ? `<button type="button" class="nim-stage-pill ${on ? "on" : ""}" data-nim-stage="${esc(proj.id)}:${esc(r.id)}:${st.key}">${on ? "✓ " : ""}${st.label}</button>`
                                                    : `<span class="nim-stage-pill ${on ? "on" : ""}">${on ? "✓ " : ""}${st.label}</span>`;
                                            }).join("")}
                                        </div>
                                        ${isAdmin() ? `
                                        <input type="text" class="input nim-note-inp" placeholder="Qeyd (məs: Asfalt icazəsi gözlənilir)…" value="${esc(ns.note)}" data-nim-note="${esc(proj.id)}:${esc(r.id)}">
                                        ` : (ns.note ? `<div class="nim-note-view">📝 ${esc(ns.note)}</div>` : "")}
                                    </div>
                                    <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--ink-2)">
                                        <span class="muted">${!r.contractor && isAdmin() ? `<a href="admin.html#contractors" target="_blank" style="color:#38BDF8;text-decoration:none">⚙️ Admin Paneldə İcraçı əlavə et</a>` : ""}</span>
                                        ${isAdmin() ? `<button class="btn btn-outline" style="height:22px;padding:0 7px;font-size:10.5px" data-geom-edit="${esc(proj.id)}:${esc(r.id)}" title="Nöqtəni xəritədə sürüşdür"><i class="fa-solid fa-arrows-up-down-left-right"></i> Sürüşdür</button>` : ""}
                                    </div>
                                </div>
                            `;
                        }).join("")}
                    </div>
                    <div style="display:flex;gap:6px;padding-top:2px">
                        <button class="btn btn-outline" style="flex:1;height:28px;font-size:12px" data-card-act="zoom"><i class="fa-solid fa-crosshairs"></i> ${t("zoomTo")}</button>
                        ${isAdmin() ? `<button class="btn btn-outline" style="height:28px;font-size:12px" data-card-act="geomEdit" title="Xəritədə sürüşdür / Redaktə et"><i class="fa-solid fa-arrows-up-down-left-right"></i> Xəritədə redaktə</button>` : ""}
                        ${isAdmin() ? `<button class="btn btn-primary" style="height:28px;font-size:12px" data-card-act="edit"><i class="fa-solid fa-pen"></i></button>` : ""}
                    </div>
                </div>
            `;
            return;
        }

        // 0) PMO GOOGLE SHEET LAYİHƏSİ (D1 / D2 / Nömrələnmiş Vərəqlər — Parçalanan Alt-Nöqtələr)
        if (proj.isPmo && proj.pmoMeta) {
            const pm = proj.pmoMeta;
            const projShape = getProjectShape(proj);
            const selSubId = state.selected?.pmoSubId || null;
            const selItem = entry?.item || null;
            const selSub = (selItem?.pmoRayon?.subPoints && selSubId)
                ? selItem.pmoRayon.subPoints.find(sp => sp.id === selSubId)
                : null;

            // 1. Magistral xətt seçilibsə (93 Radar — marşrut, A-B, lif sayı, U layihə və icra olunan, icraçı, bitmə vaxtı)
            if (selItem && selItem.isMagistral) {
                const magTone = statusTone(selItem.status);
                const magStatusText = selItem.status === "bitmis" ? "🟢 Tamamlanıb (100%)" : (selItem.status === "icrada" ? "🟡 İcrada" : "🔴 Layihə (Başlanmayıb)");
                const pct = selItem.planM > 0 ? Math.round((selItem.doneM / selItem.planM) * 100) : (selItem.status === "bitmis" ? 100 : 0);
                card.innerHTML = `
                    <div class="info-card-head">
                        <div>
                            <small style="display:flex;align-items:center;gap:6px">
                                <span style="color:${magTone};font-size:13px">〰️</span>
                                <span>${esc(cleanProjName)} · Magistral xətt</span>
                            </small>
                            <strong>${esc(selItem.name)}</strong>
                        </div>
                        <div style="display:flex;align-items:center;gap:4px">
                            <button class="btn btn-outline" style="height:24px;padding:0 8px;font-size:11px;color:#fff;border-color:rgba(255,255,255,0.25)" data-card-act="showAll">Hamısı</button>
                            <button class="icon-btn" data-card-act="close" title="${t("close")}"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                    </div>
                    <div class="info-card-body">
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
                            <span class="pill" style="--tone:${magTone}">${magStatusText}</span>
                            <span class="pill" style="--tone:#38bdf8">🔌 ${esc(selItem.fiber || "FO")}</span>
                            <b style="color:${magTone};font-size:13px">${pct}%</b>
                        </div>
                        <div class="progress" style="height:5px;margin-bottom:8px">
                            <span style="width:${Math.min(100, pct)}%;background:${magTone}"></span>
                        </div>
                        <div class="info-grid" style="grid-template-columns:1fr 1fr;margin-bottom:6px">
                            <div class="info-stat"><small>U: Layihə məsafəsi</small><b>${Number(selItem.planM || 0).toLocaleString("az-AZ")} m</b></div>
                            <div class="info-stat"><small>U: İcra olunan</small><b style="color:#4ade80">${Number(selItem.doneM || 0).toLocaleString("az-AZ")} m</b></div>
                        </div>
                        <dl class="info-kv" style="margin:0 0 8px 0">
                            <dt>Marşrut</dt><dd><b>${esc(selItem.pointA || "A")} ➔ ${esc(selItem.pointB || "B")}</b></dd>
                            <dt>Lif sayı (Region)</dt><dd><b>${esc(selItem.fiber || "—")}</b></dd>
                            ${selItem.contractor ? `<dt>İş icraçısı</dt><dd><b>${esc(selItem.contractor)}</b></dd>` : ""}
                            ${selItem.endDate ? `<dt>Bitmə vaxtı</dt><dd><b style="color:#38bdf8">${esc(selItem.endDate)}</b></dd>` : ""}
                        </dl>
                        <div style="display:flex;gap:6px;padding-top:4px">
                            <button class="btn btn-primary" style="flex:1;height:28px;font-size:12px" data-card-act="zoom">
                                <i class="fa-solid fa-crosshairs"></i> Yaxınlaş
                            </button>
                            <button class="btn btn-outline" style="flex:1;height:28px;font-size:12px;border-color:rgba(56,189,248,0.55);color:#38bdf8" data-card-act="geomEdit" title="Xətti xəritədə redaktə et (nöqtələri sürüşdür, + ilə əlavə et)">
                                <i class="fa-solid fa-bezier-curve"></i> Xəritədə redaktə
                            </button>
                        </div>
                    </div>
                `;
                return;
            }

            // 2. Parçalanmış fərdi nöqtə seçilibsə (TŞ nömrəsi, Dirək, İş icraçıları, Qoşulma tipi)
            card.classList.toggle("single-subpoint", Boolean(selSub));
            if (selItem && selSub) {
                const spTone = statusTone(selSub.status);
                const spStatusText = selSub.status === "bitmis" ? "🟢 Tamamlanıb (100%)" : (selSub.status === "icrada" ? "🟡 İcrada" : "🔴 Başlanmayıb");
                const clusterKey = `${proj.id}::pmo::${selItem.id}`;
                const execParts = [];
                if (selSub.bcgExec) execParts.push(`BCG: <b>${esc(selSub.bcgExec)}</b>`);
                if (selSub.avicomExec) execParts.push(`Avicom: <b>${esc(selSub.avicomExec)}</b>`);
                const execHtml = execParts.length ? execParts.join(" · ") : "—";
                const isMin = card.classList.contains("minimized");
                const is239Rps = (String(proj.sheetId || proj.pmoMeta?.sheetId || "") === "10" || /239/i.test(cleanProjName))
                    && /rp[şs]/i.test(String(selItem.name || selSub.rayon || ""));
                const isMuganli = String(proj.sheetId || proj.pmoMeta?.sheetId || "") === "12" || /mu[ğg]anl[ıi]/i.test(cleanProjName);
                const subVis = resolvePmoPointVisual(proj, selItem, selSub);
                const muganliBadge = subVis.pillText
                    ? `<span class="pill" style="--tone:${subVis.pillColor || "#38bdf8"};font-size:10px">${esc(subVis.pillText)}</span>`
                    : "";
                const tsEqualRayon = selSub.tsNo && (selSub.tsNo.toLowerCase() === String(selSub.rayon || "").toLowerCase() || selSub.tsNo.toLowerCase() === String(selItem.name || "").toLowerCase());
                const subTitle = ((isMuganli || tsEqualRayon) && selSub.address)
                    ? selSub.address
                    : (selSub.tsNo || selSub.name || "Nöqtə");

                const isSeedUnstarted = selSub.cablePlanM === undefined && selSub.status === "layihe";
                const subPlanM = isSeedUnstarted ? (Number(selSub.cableDoneM) || 0) : (Number(selSub.cablePlanM) || 0);
                const subDoneM = isSeedUnstarted ? 0 : (Number(selSub.cableDoneM) || 0);
                const subPlanText = subPlanM > 0 ? `${subPlanM.toLocaleString("az-AZ")} m` : "-";
                const subDoneText = subDoneM > 0 ? `${subDoneM.toLocaleString("az-AZ")} m` : "-";
                const subDetailsHtml = selSub.isTemirRayon
                    ? `
                        <dl class="info-kv" style="margin:0;font-size:11px">
                            <dt>Rayon</dt><dd><b>${esc(selSub.rayon || selSub.name || "—")}</b></dd>
                            <dt>Region (RM)</dt><dd><b>${esc(selItem.name)}</b></dd>
                            <dt>Regional rəhbər</dt><dd><b style="color:#38bdf8">${esc(selSub.regLead || selItem.pmoRayon?.temirMeta?.regLead || "—")}</b></dd>
                            <dt>Rayon üzrə nöqtə sayı</dt><dd><b style="color:#4ade80">${selSub.totalCount || 1} nöqtə</b>${selSub.doneCount !== undefined ? ` <small style="color:var(--ink-2)">(Bərpa: ${selSub.doneCount})</small>` : ""}</dd>
                        </dl>
                    `
                    : `
                        <dl class="info-kv" style="margin:0;font-size:11px">
                            ${(selSub.address && selSub.address.trim() !== String(subTitle || "").trim()) ? `<dt>Ünvan</dt><dd><b>${esc(selSub.address)}</b></dd>` : ""}
                            <dt>Dirək</dt><dd><b>${esc(selSub.pole || "—")}</b></dd>
                            <dt>İş icraçısı</dt><dd>${execHtml}</dd>
                            <dt>Layihə üzrə kabel</dt><dd><b>${esc(subPlanText)}</b></dd>
                            <dt>Faktiki çəkilən kabel</dt><dd><b style="color:${subDoneM > 0 ? "#4ade80" : "var(--ink-2)"}">${esc(subDoneText)}</b></dd>
                            <dt>Qoşulma tipi</dt><dd><b>${esc(selSub.connType || "—")}</b></dd>
                        </dl>
                    `;

                card.innerHTML = `
                    <div class="info-card-head" style="gap:6px">
                        <div style="flex:1;min-width:0;overflow:hidden">
                            <small style="display:flex;align-items:center;gap:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                                <span style="color:${spTone};font-size:12px">${projShape.symbol}</span>
                                <span>${esc(cleanProjName)} · ${esc(selItem.name)}</span>
                            </small>
                            <strong style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px" title="${esc(subTitle)}">${esc(subTitle)}</strong>
                        </div>
                        <div style="display:flex;align-items:center;gap:3px;flex-shrink:0">
                            <button class="icon-btn" data-card-act="minimize" title="${isMin ? "Böyüt" : "Yığcam et / Kiçilt"}"><i class="fa-solid ${isMin ? "fa-plus" : "fa-minus"}"></i></button>
                            <button class="icon-btn" data-card-act="close" title="${t("close")}"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                    </div>
                    <div class="info-card-body" style="padding:6px 10px">
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:5px;flex-wrap:wrap">
                            <span class="pill" style="--tone:${spTone};font-size:10px">${spStatusText}</span>
                            ${muganliBadge}
                            ${selSub.pct ? `<b style="color:${spTone};font-size:11px">${selSub.pct}%</b>` : ""}
                        </div>
                        ${subDetailsHtml}
                        <div style="display:flex;gap:4px;padding-top:6px">
                            <button class="btn btn-outline" style="flex:1;height:24px;font-size:10.5px;padding:0 4px" data-pmo-split="${esc(clusterKey)}|${esc(proj.id)}|${esc(selItem.id)}">
                                <i class="fa-solid fa-compress"></i> Birləşdir
                            </button>
                            <button class="btn btn-outline" style="height:24px;padding:0 7px;font-size:10.5px" data-card-act="zoom" title="Yaxınlaş">
                                <i class="fa-solid fa-crosshairs"></i>
                            </button>
                        </div>
                    </div>
                `;
                return;
            }

            // 2. PMO Rayon Xülasəsi (D2) və ya Ümumi Layihə (D1)
            const connBadgeHtml = cObj => {
                const c = cObj || {};
                const parts = [];
                if (Number(c.fo) > 0) parts.push(`<span class="pill" style="--tone:#38bdf8">🌐 FO: ${c.fo}</span>`);
                if (Number(c.g3) > 0) parts.push(`<span class="pill" style="--tone:#a855f7">📶 3G: ${c.g3}</span>`);
                if (Number(c.ant) > 0) parts.push(`<span class="pill" style="--tone:#f59e0b">📡 Anten: ${c.ant}</span>`);
                if (Number(c.gpon) > 0) parts.push(`<span class="pill" style="--tone:#22c55e">GPON: ${c.gpon}</span>`);
                return parts.length ? parts.join(" ") : `<span class="muted">Qoşulma: 0</span>`;
            };

            const cableBlockHtml = (!entry && (pm.cablePlanM > 0 || pm.cableDoneM > 0)) ? `
                <div class="info-grid" style="grid-template-columns:1fr 1fr;margin-bottom:6px">
                    <div class="info-stat"><small>🔌 Kabel (Layihə)</small><b>${Math.round(pm.cablePlanM).toLocaleString("az-AZ")} m</b></div>
                    <div class="info-stat"><small>✅ Kabel (İcra olunan)</small><b style="color:#4ade80">${Math.round(pm.cableDoneM).toLocaleString("az-AZ")} m</b></div>
                </div>
            ` : "";

            card.innerHTML = `
                <div class="info-card-head">
                    <div>
                        <small style="display:flex;align-items:center;gap:6px">
                            <span style="color:${tone};font-size:13px">${projShape.symbol}</span>
                            <span>PMO Canlı · Ümumi icra: ${pm.overallPct}%</span>
                        </small>
                        <strong>${esc(cleanProjName)}</strong>
                    </div>
                    <div style="display:flex;align-items:center;gap:4px">
                        <button class="icon-btn" data-card-act="close" title="${t("close")}"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>
                <div class="info-card-body">
                    ${!entry ? `
                    <div class="info-grid" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:6px">
                        <div class="info-stat"><small>Ümumi faiz</small><b style="color:${tone}">${pm.overallPct}%</b></div>
                        <div class="info-stat"><small>BCG (İcra/Verilən)</small><b style="color:#38bdf8">${pm.bcgDone} / ${pm.bcgPlan}</b></div>
                        <div class="info-stat"><small>Avicom (İcra/Verilən)</small><b style="color:#4ade80">${pm.avicomDone} / ${pm.avicomPlan}</b></div>
                    </div>
                    ${cableBlockHtml}
                    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">${connBadgeHtml(pm.conn)}</div>
                    ` : ""}
                    <div class="info-sub-list">
                        ${items.map(r => {
                            if (r.isMagistral) {
                                const rTone = statusTone(r.status);
                                const pct = r.planM > 0 ? Math.round((r.doneM / r.planM) * 100) : (r.status === "bitmis" ? 100 : 0);
                                return `
                                    <div class="info-sub-item" data-pick-seg="${esc(proj.id)}:${esc(r.id)}" style="border-color:${entry?.item === r ? rTone : "var(--line)"}">
                                        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                                            <strong style="display:flex;align-items:center;gap:6px">
                                                <span style="color:${rTone}">〰️</span>
                                                ${esc(r.name)}
                                            </strong>
                                            <span class="pill" style="--tone:${rTone}">${esc(t("status" + r.status))} · ${pct}%</span>
                                        </div>
                                        <div class="progress" style="height:4px;margin:3px 0"><span style="width:${Math.min(100, pct)}%;background:${rTone}"></span></div>
                                        <div style="display:flex;justify-content:space-between;gap:8px;font-size:11.5px;margin-top:2px">
                                            <span>🔌 <b>${esc(r.fiber || "FO")}</b> · U: <b>${(r.doneM || 0).toLocaleString("az-AZ")}</b> / ${(r.planM || 0).toLocaleString("az-AZ")} m</span>
                                            ${r.contractor ? `<span style="color:#38bdf8">👷 ${esc(r.contractor)}</span>` : ""}
                                        </div>
                                        ${r.endDate ? `<div style="font-size:11px;color:var(--ink-2);margin-top:2px">📅 Bitmə tarixi: ${esc(r.endDate)}</div>` : ""}
                                        <div style="margin-top:5px;display:flex;justify-content:flex-end">
                                            <button type="button" class="btn btn-outline" style="height:22px;padding:0 8px;font-size:10.5px;border-color:rgba(56,189,248,0.45);color:#38bdf8" data-geom-edit="${esc(proj.id)}:${esc(r.id)}" title="Xətti xəritədə redaktə et">
                                                <i class="fa-solid fa-bezier-curve"></i> Xəritədə redaktə
                                            </button>
                                        </div>
                                    </div>
                                `;
                            }
                            const pr = r.pmoRayon || {};
                            const rTone = statusTone(r.status);
                            const subCnt = (pr.subPoints || []).filter(sp => sp.coords).length;
                            const clusterKey = getPmoRayonClusterKey(proj, r);
                            const isExp = Boolean(state.expandedRayons?.has(clusterKey) || state.expandedRayons?.has(`${proj.id}::pmo::${r.id}`));
                            const tm = pr.temirMeta;
                            const isTemir153 = Boolean(tm?.isTemirRm || String(proj.sheetId || proj.pmoMeta?.sheetId || "") === "15.3");
                            if (isTemir153) {
                                let seedIt = null;
                                if (Array.isArray(window.PMO_SEED_PROJECTS)) {
                                    const seedP = window.PMO_SEED_PROJECTS.find(p => p.sheetId === "15.3");
                                    const rk = normalizeRmKey(r.name) || normMatchName(r.name);
                                    seedIt = seedP?.items?.find(it => (normalizeRmKey(it.name) || normMatchName(it.name)) === rk) || null;
                                }
                                const seedTm = seedIt?.pmoRayon?.temirMeta;
                                const rmTotal = tm?.totalCount || pr.totalPlan || seedTm?.totalCount || 0;
                                const rmDone = tm?.doneCount ?? pr.totalDone ?? seedTm?.doneCount ?? 0;
                                const rmLead = (tm?.regLead && tm.regLead !== "—") ? tm.regLead : (seedTm?.regLead || "—");
                                const rBreak = (Array.isArray(tm?.rayonBreakdown) && tm.rayonBreakdown.length > 0)
                                    ? tm.rayonBreakdown
                                    : (Array.isArray(seedTm?.rayonBreakdown) ? seedTm.rayonBreakdown : []);
                                if ((!pr.subPoints || pr.subPoints.length === 0) && Array.isArray(seedIt?.pmoRayon?.subPoints) && seedIt.pmoRayon.subPoints.length > 0) {
                                    pr.subPoints = seedIt.pmoRayon.subPoints;
                                }
                                const effSubCnt = (pr.subPoints || []).filter(sp => sp.coords).length;
                                const rayonPillsHtml = rBreak.length > 0
                                    ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px">${rBreak.map(rb => `<span class="pill" style="--tone:#38bdf8;font-size:10.5px">${esc(rb.name)}: <b>${rb.count}</b></span>`).join("")}</div>`
                                    : "";
                                return `
                                    <div class="info-sub-item" data-pick-seg="${esc(proj.id)}:${esc(r.id)}" style="border-color:${entry?.item === r ? rTone : "var(--line)"}">
                                        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                                            <strong style="display:flex;align-items:center;gap:6px">
                                                <span style="color:${rTone}">${projShape.symbol}</span>
                                                ${esc(r.name)}
                                            </strong>
                                            <span class="pill" style="--tone:${rTone}">${pr.pct ?? 0}%</span>
                                        </div>
                                        <div class="progress" style="height:4px;margin:3px 0"><span style="width:${Math.min(100, pr.pct || 0)}%;background:${rTone}"></span></div>
                                        <dl class="info-kv" style="margin:4px 0 0;font-size:11px">
                                            <dt>Nöqtə sayı (Bərpa / Cəmi)</dt><dd><b style="color:#4ade80">${rmDone.toLocaleString("az-AZ")}</b> / <b>${rmTotal.toLocaleString("az-AZ")}</b></dd>
                                            <dt>Regional rəhbər</dt><dd><b style="color:#38bdf8">${esc(rmLead)}</b></dd>
                                            ${rBreak.length > 0 ? `<dt>Rayonlar (${rBreak.length})</dt><dd><b>${rBreak.reduce((s, x) => s + (x.count || 0), 0)} nöqtə</b></dd>` : ""}
                                        </dl>
                                        ${rayonPillsHtml}
                                        ${effSubCnt > 0 ? `
                                        <div style="margin-top:6px">
                                            <button type="button" class="btn btn-outline" style="width:100%;height:26px;font-size:11px;border-color:rgba(251,191,36,0.45);color:#fbbf24" data-pmo-split="${esc(clusterKey)}|${esc(proj.id)}|${esc(r.id)}">
                                                <i class="fa-solid ${isExp ? "fa-compress" : "fa-expand"}"></i> ${isExp ? "RM üzrə birləşdir" : `Rayonlar üzrə xəritədə payla (${effSubCnt} rayon · 2x klik)`}
                                            </button>
                                        </div>` : ""}
                                    </div>
                                `;
                            }
                            return `
                                <div class="info-sub-item" data-pick-seg="${esc(proj.id)}:${esc(r.id)}" style="border-color:${entry?.item === r ? rTone : "var(--line)"}">
                                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                                        <strong style="display:flex;align-items:center;gap:6px">
                                            <span style="color:${rTone}">${projShape.symbol}</span>
                                            ${esc(r.name)}
                                        </strong>
                                        <span class="pill" style="--tone:${rTone}">${pr.pct ?? 0}%</span>
                                    </div>
                                    <div class="progress" style="height:4px;margin:3px 0"><span style="width:${Math.min(100, pr.pct || 0)}%;background:${rTone}"></span></div>
                                    <div style="display:flex;justify-content:space-between;gap:8px;font-size:11.5px;margin-top:2px">
                                        <span style="color:#38bdf8">BCG: <b>${pr.bcgDone ?? 0}</b> / ${pr.bcgPlan ?? 0} (${pr.bcgPct ?? 0}%)</span>
                                        <span style="color:#4ade80">Avicom: <b>${pr.avicomDone ?? 0}</b> / ${pr.avicomPlan ?? 0} (${pr.avicomPct ?? 0}%)</span>
                                    </div>
                                    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px">${connBadgeHtml(pr.conn)}</div>
                                    ${subCnt > 0 ? `
                                    <div style="margin-top:6px">
                                        <button type="button" class="btn btn-outline" style="width:100%;height:26px;font-size:11px;border-color:rgba(251,191,36,0.45);color:#fbbf24" data-pmo-split="${esc(clusterKey)}|${esc(proj.id)}|${esc(r.id)}">
                                            <i class="fa-solid ${isExp ? "fa-compress" : "fa-expand"}"></i> ${isExp ? "Rayon üzrə birləşdir" : `Nöqtələri xəritədə parçala (${subCnt} nöqtə · 2x klik)`}
                                        </button>
                                    </div>` : ""}
                                </div>
                            `;
                        }).join("")}
                    </div>
                    <div style="display:flex;gap:6px;padding-top:2px">
                        <button class="btn btn-outline" style="flex:1;height:28px;font-size:12px" data-card-act="zoom"><i class="fa-solid fa-crosshairs"></i> ${t("zoomTo")}</button>
                    </div>
                </div>
            `;
            return;
        }

        // A) NÖQTƏ / ANTENA LAYİHƏSİ
        if (isPoints) {
            const totalAnt = proj.items.reduce((s, i) => s + (i.antennas || 0), 0);
            const planMVal = Math.round(sum.plan * 1000);
            const doneMVal = Math.round(sum.done * 1000);
            const leftMVal = Math.max(0, planMVal - doneMVal);
            const allPtsDone = proj.items.length > 0 && proj.items.every(i => i.status === "bitmis" || i.status === "tehvil");
            const sumPct = calcPointPct(doneMVal, planMVal, (proj.status === "bitmis" || proj.status === "tehvil" || allPtsDone) ? "bitmis" : proj.status);
            const projShape = getProjectShape(proj);
            card.innerHTML = `
                <div class="info-card-head">
                    <div>
                        <small style="display:flex;align-items:center;gap:6px">
                            <span style="color:${tone};font-size:13px">${projShape.symbol}</span>
                            <span>📡 ${totalAnt} antena - ${planMVal} / ${doneMVal} m</span>
                        </small>
                        <strong>${esc(cleanProjName)}</strong>
                    </div>
                    <div style="display:flex;align-items:center;gap:4px">
                        <button class="icon-btn" data-card-act="close" title="${t("close")}"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>
                <div class="info-card-body">
                    ${!entry ? `<div class="info-grid">
                        <div class="info-stat"><small>1. Verilən kabel</small><b>${planMVal} m</b></div>
                        <div class="info-stat"><small>2. Çəkilən (${sumPct}%)</small><b>${doneMVal} m</b></div>
                        <div class="info-stat"><small>Qalıb</small><b>${leftMVal} m</b></div>
                    </div>` : ""}
                    <div class="info-sub-list">
                        ${items.map(r => {
                            const rTone = statusTone(r.status);
                            const rShape = getItemShape(proj, r);
                            const rPtType = extractPointType(r.props, r);
                            const rPtBadge = rPtType
                                ? `<span style="background:rgba(56,189,248,0.14);color:#38BDF8;border:1px solid rgba(56,189,248,0.35);border-radius:5px;padding:0 5px;font-size:10px;font-weight:700">${esc(rPtType)}</span>`
                                : "";
                            const { planM: rVerilenM, doneM: rCekilenM } = getPointMetersPair(r);
                            const rLeftM = Math.max(0, rVerilenM - rCekilenM);
                            const rPct = calcPointPct(rCekilenM, rVerilenM, r.status);
                            const cleanName = String(r.name || "").replace(/\s*\(?\bFaz[-\s]*[12]\b\)?/gi, "").replace(/\s*rayon(u)?\b/gi, "").trim();
                            return `
                                <div class="info-sub-item" data-pick-seg="${esc(proj.id)}:${esc(r.id)}" style="border-color:${entry?.item === r ? rTone : "var(--line)"}">
                                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
                                        <strong style="display:flex;align-items:center;gap:6px">
                                            <span style="color:${rTone}">${rShape.symbol}</span>
                                            ${esc(cleanName)}
                                            ${rPtBadge}
                                        </strong>
                                        <span class="pill" style="--tone:${rTone}">${t(`status${r.status}`)}</span>
                                    </div>
                                    <div style="color:var(--ink-2);font-size:11px">
                                        📡 <b style="color:var(--ink)">${esc(formatPointAntLabel(r.antennas, rPtType))} - ${rVerilenM} / ${rCekilenM} m</b> <span style="color:${rTone};font-weight:700">(${rPct}%)</span> · Qalıb: <b>${rLeftM} m</b>
                                    </div>
                                    <div class="progress" style="height:4px;margin:1px 0"><span style="width:${rPct}%;background:${rTone}"></span></div>
                                    ${isAdmin() && entry ? `
                                    <div class="info-exec-row">
                                        <span class="muted">İcraçı:</span>
                                        ${executorOptionsHtml(r.contractor, r)}
                                    </div>` : ""}
                                    ${renderExecDetailBlockHtml(r, proj, Boolean(entry))}
                                    ${Array.isArray(r.customFields) && r.customFields.some(cf => cf && (cf.label || cf.value)) ? `
                                    <dl class="info-kv" style="margin-top:4px">
                                        ${r.customFields.filter(cf => cf && (cf.label || cf.value)).map(cf => `<dt>${esc(cf.label || "Məlumat")}</dt><dd>${esc(cf.value || "—")}</dd>`).join("")}
                                    </dl>` : ""}
                                </div>
                            `;
                        }).join("")}
                    </div>
                    <div style="display:flex;gap:6px;padding-top:2px">
                        <button class="btn btn-outline" style="flex:1;height:28px;font-size:12px" data-card-act="zoom"><i class="fa-solid fa-crosshairs"></i> ${t("zoomTo")}</button>
                    </div>
                </div>
            `;
        }
        // B) MAGİSTRAL XƏTT LAYİHƏSİ (Xətlər üçün status panelində edit və xəritədə sürüşdürmə aktivdir)
        else {
            card.innerHTML = `
                <div class="info-card-head">
                    <div>
                        <small style="display:flex;align-items:center;gap:6px">
                            <span class="dot" style="background:${tone}"></span>
                            <span>${t(`status${proj.status}`)} · 〰️ Magistral layihə</span>
                        </small>
                        <strong>${esc(cleanProjName)}</strong>
                    </div>
                    <div style="display:flex;align-items:center;gap:4px">
                        <button class="icon-btn" data-card-act="close" title="${t("close")}"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>
                <div class="info-card-body">
                    <div class="info-sub-list">
                        ${items.map(r => {
                            const rTone = statusTone(r.status);
                            const isLifSeg = isLifGoturulen(r, proj);
                            const rLeft = Math.max(0, r.totalKm - r.doneKm);
                            const rPct = percent(r.doneKm, r.totalKm);
                            const foLabel = isLifSeg ? "" : getSegmentFiber(r, proj);
                            const ends = resolveLineEndNames(r, proj);
                            const cInfo = findContractorInfo(r.contractor) || { workers: "—", machinery: "—", engineer: "—" };
                            const rawPropName = getPropCaseInsensitive(
                                r.props,
                                "Name", "name", "kabel", "kabel_adi", "xett_adi", "xett", "LineName", "title", "ad", "marsrut", "route", "label"
                            );
                            const isGen = /^(?:idxal\s*x[əe]tti|imported\s*line|x[əe]tt|line|imp)[-\s]*\d*$/i.test(String(r.name || "").trim());
                            const lineDisplayName = (!isGen && r.name) ? String(r.name).trim() : String(rawPropName || r.name || proj.name || "").trim();
                            return `
                                <div class="info-sub-item" data-pick-seg="${esc(proj.id)}:${esc(r.id)}" style="border-color:${entry?.item === r ? rTone : "var(--line)"}">
                                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
                                        <b>${esc(lineDisplayName)}</b>
                                        <div style="display:flex;align-items:center;gap:5px">
                                            ${foLabel ? `<span class="pill" style="--tone:#0EA5E9;background:rgba(14,165,233,0.16);color:#38BDF8;border:1px solid rgba(56,189,248,0.45)">🔌 ${esc(foLabel)}</span>` : ""}
                                            <span class="pill" style="--tone:${rTone}">${t(`status${r.status}`)}</span>
                                        </div>
                                    </div>
                                    <div style="font-size:11.5px;color:var(--ink-2);display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                                        <span>📍 <b>${esc(ends.aName || lineDisplayName)}</b></span>
                                        <span style="opacity:0.6">➔</span>
                                        <span>📍 <b>${esc(ends.bName || lineDisplayName)}</b></span>
                                    </div>
                                    ${isLifSeg ? "" : `
                                    <div style="color:var(--ink-2);font-size:11.5px">
                                        Plan: <b>${formatKm(r.totalKm)} km</b> · Faktiki: <b style="color:${rTone}">${formatKm(r.doneKm)} km (${rPct}%)</b> · Qalıb: <b>${formatKm(rLeft)} km</b>
                                    </div>
                                    <div class="info-exec-row">
                                        <span class="muted">Kabel lif sayı:</span>
                                        ${fiberOptionsHtml(foLabel)}
                                    </div>
                                    <div class="info-exec-row">
                                        <span class="muted">İcraçı:</span>
                                        ${executorOptionsHtml(r.contractor, r)}
                                    </div>`}
                                    ${isAdmin() ? `
                                    <div class="info-exec-row">
                                        <span class="muted">Status:</span>
                                        <select class="info-exec-select" data-line-status-select="${esc(proj.id)}:${esc(r.id)}">
                                            ${STATUSES.map(st => `<option value="${st}" ${r.status === st ? "selected" : ""}>${t("status" + st)}</option>`).join("")}
                                        </select>
                                    </div>` : ""}
                                    ${!isLifSeg ? renderExecDetailBlockHtml(r, proj) : ""}
                                    ${Array.isArray(r.customFields) && r.customFields.some(cf => cf && (cf.label || cf.value)) ? `
                                    <dl class="info-kv" style="margin-top:4px">
                                        ${r.customFields.filter(cf => cf && (cf.label || cf.value)).map(cf => `<dt>${esc(cf.label || "Məlumat")}</dt><dd>${esc(cf.value || "—")}</dd>`).join("")}
                                    </dl>` : ""}
                                    <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--ink-2)">
                                        <span class="muted">${!isLifSeg && !r.contractor && isAdmin() ? `<a href="admin.html#contractors" target="_blank" style="color:#38BDF8;text-decoration:none">⚙️ Admin Paneldə İcraçı əlavə et</a>` : ""}</span>
                                        ${isAdmin() ? `<div style="display:flex;gap:4px">
                                            <button class="btn btn-outline" style="height:22px;padding:0 7px;font-size:10.5px" data-edit-seg="${esc(proj.id)}:${esc(r.id)}" title="Xətti redaktə et"><i class="fa-solid fa-pen"></i> Redaktə</button>
                                            <button class="btn btn-outline" style="height:22px;padding:0 7px;font-size:10.5px" data-geom-edit="${esc(proj.id)}:${esc(r.id)}" title="Xəttin qırılma nöqtələrini xəritədə sürüşdür"><i class="fa-solid fa-bezier-curve"></i> Xətti sürüşdür</button>
                                        </div>` : ""}
                                    </div>
                                </div>
                            `;
                        }).join("")}
                    </div>

                    <div style="display:flex;gap:6px;padding-top:2px">
                        <button class="btn btn-outline" style="flex:1;height:28px;font-size:12px" data-card-act="zoom"><i class="fa-solid fa-crosshairs"></i> ${t("zoomTo")}</button>
                        ${isAdmin() ? `<button class="btn btn-outline" style="height:28px;font-size:12px" data-card-act="geomEdit" title="Xəttin qırılma nöqtələrini xəritədə sürüşdür"><i class="fa-solid fa-bezier-curve"></i> Xəritədə redaktə</button>` : ""}
                        ${isAdmin() ? `<button class="btn btn-primary" style="height:28px;font-size:12px" data-card-act="edit"><i class="fa-solid fa-pen"></i></button>` : ""}
                    </div>
                </div>
            `;
        }
    }

    // 🖨️ Çap və PDF üçün İnteraktiv Çərçivə (Area Crop) seçimi
    function initPrintCropTool() {
        const overlay = $("printCropOverlay");
        const box = $("cropBox");
        if (!overlay || !box) return;

        let rect = { left: 140, top: 80, width: 560, height: 360 };
        function applyRect() {
            box.style.left = `${rect.left}px`;
            box.style.top = `${rect.top}px`;
            box.style.width = `${rect.width}px`;
            box.style.height = `${rect.height}px`;
            if ($("cropSizeLabel")) $("cropSizeLabel").textContent = `Çap sahəsi (${Math.round(rect.width)} × ${Math.round(rect.height)} px)`;
        }

        window.openPrintCropMode = function () {
            const stage = document.querySelector(".map-stage");
            if (stage) {
                const w = stage.clientWidth;
                const h = stage.clientHeight;
                rect = {
                    left: Math.round(w * 0.14),
                    top: Math.round(h * 0.14),
                    width: Math.round(w * 0.72),
                    height: Math.round(h * 0.70)
                };
                applyRect();
            }
            overlay.hidden = false;
            toast("🖨️ Çap / PDF sahəsini çərçivə ilə tənzimləyin və 'Çap et / PDF' basın");
        };

        ($("cancelCropPrintBtn") || $("printCancelBtn"))?.addEventListener("click", () => { overlay.hidden = true; });
        $("cropFullBtn")?.addEventListener("click", () => {
            const stage = document.querySelector(".map-stage");
            if (!stage) return;
            rect = { left: 16, top: 52, width: stage.clientWidth - 32, height: stage.clientHeight - 68 };
            applyRect();
        });
        ($("confirmCropPrintBtn") || $("printConfirmBtn"))?.addEventListener("click", () => {
            if (window.map && rect.width > 40 && rect.height > 40) {
                const p1 = map.unproject([rect.left, rect.top]);
                const p2 = map.unproject([rect.left + rect.width, rect.top + rect.height]);
                const b = new maplibregl.LngLatBounds(
                    [Math.min(p1.lng, p2.lng), Math.min(p1.lat, p2.lat)],
                    [Math.max(p1.lng, p2.lng), Math.max(p1.lat, p2.lat)]
                );
                map.fitBounds(b, { padding: 16, animate: false });
            }
            overlay.hidden = true;
            setTimeout(() => window.print(), 180);
        });

        box.addEventListener("mousedown", e => {
            e.stopPropagation();
            const handle = e.target.closest("[data-dir], [data-crop-dir]");
            const dir = handle ? (handle.dataset.dir || handle.dataset.cropDir) : "move";
            const startX = e.clientX;
            const startY = e.clientY;
            const r0 = { ...rect };

            const onMove = ev => {
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                if (dir === "move") {
                    rect.left = Math.max(10, r0.left + dx);
                    rect.top = Math.max(10, r0.top + dy);
                } else {
                    if (dir.includes("e")) rect.width = Math.max(120, r0.width + dx);
                    if (dir.includes("s")) rect.height = Math.max(90, r0.height + dy);
                    if (dir.includes("w")) {
                        const nw = Math.max(120, r0.width - dx);
                        rect.left = r0.left + (r0.width - nw);
                        rect.width = nw;
                    }
                    if (dir.includes("n")) {
                        const nh = Math.max(90, r0.height - dy);
                        rect.top = r0.top + (r0.height - nh);
                        rect.height = nh;
                    }
                }
                applyRect();
            };
            const onUp = () => {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
        });

        overlay.addEventListener("mousedown", e => {
            if (e.target.closest(".print-crop-bar") || e.target.closest("#cropBox")) return;
            const stageRect = overlay.getBoundingClientRect();
            const x0 = e.clientX - stageRect.left;
            const y0 = e.clientY - stageRect.top;
            const onMove = ev => {
                const x1 = ev.clientX - stageRect.left;
                const y1 = ev.clientY - stageRect.top;
                rect = {
                    left: Math.min(x0, x1),
                    top: Math.min(y0, y1),
                    width: Math.max(80, Math.abs(x1 - x0)),
                    height: Math.max(60, Math.abs(y1 - y0))
                };
                applyRect();
            };
            const onUp = () => {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
        });
    }

    // 🧍 Küçə Görünüşü (Pegman Street View) + 🧭 Mənim Konumum + 💡 Fokus İşıqlandırma
    function openStreetViewAt(lat, lng) {
        const modal = $("streetViewModal");
        if (!modal) return;
        const coordsText = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        if ($("svCoords")) $("svCoords").textContent = coordsText;
        if ($("svCoordsLabel")) $("svCoordsLabel").textContent = coordsText;
        if ($("svExternalLink")) {
            $("svExternalLink").href = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
        }
        const frame = $("svIframe") || $("svFrame");
        if (frame) {
            frame.src = `https://maps.google.com/maps?q=${lat},${lng}&layer=c&cbll=${lat},${lng}&cbp=11,0,0,0,0&output=svembed`;
        }
        modal.showModal();
    }

    function initRightTools() {
        $("focusToggleBtn")?.addEventListener("click", () => {
            state.focusMode = !state.focusMode;
            $("focusToggleBtn").classList.toggle("active", state.focusMode);
            drawRoutes();
            toast(state.focusMode ? "💡 Fokus işıqlandırma aktivdir" : "💡 Fokus işıqlandırma söndürüldü");
        });

        const MY_CUSTOM_LOC_KEY = "bcg.my.custom.loc.v1";
        let myLocWatchId = null;

        function placeMyLocationOnMap(lat, lng, subTitle = "", zoomLevel = 15, isCoarse = false) {
            if (!window.map) return;
            myLocationMarker?.remove();
            const el = document.createElement("div");
            el.className = "my-loc-marker";
            el.title = "Cari məkanınızı dəqiqləşdirmək üçün tutub sürüşdürə bilərsiniz";
            el.style.cssText = "width:22px;height:22px;border-radius:50%;background:#0EA5E9;border:3px solid #FFFFFF;box-shadow:0 0 0 7px rgba(14,165,233,0.32),0 2px 8px rgba(0,0,0,0.55);cursor:grab";

            const hasSavedCustom = Boolean(readStore(MY_CUSTOM_LOC_KEY, null));
            const buildPopupHtml = (cLat, cLng, noteText) => `
                <div style="padding:3px 5px;line-height:1.4;min-width:195px">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
                        <b>🧭 Cari Məkanım</b>
                        <span class="mono" style="font-size:10.5px;color:#38BDF8">${cLat.toFixed(5)}, ${cLng.toFixed(5)}</span>
                    </div>
                    ${noteText ? `<small style="display:block;color:var(--ink-2);margin-top:2px">${esc(noteText)}</small>` : ""}
                    ${isCoarse ? `<small style="display:block;color:#F59E0B;margin-top:3px;font-size:10.5px">⚠️ Kompüterdə GPS çipi olmadığı üçün provayder ünvanı göstərilir. Nöqtəni sürüşdürüb dəqiq yerinizi qeyd edə bilərsiniz.</small>` : `<small style="display:block;color:var(--ink-3);margin-top:2px;font-size:10px">💡 Nöqtəni sürüşdürərək dəqiq yerinizi düzəldə bilərsiniz</small>`}
                    <div style="display:flex;gap:5px;margin-top:6px">
                        <button type="button" class="btn btn-outline" id="pickExactMyLocBtn" style="height:22px;padding:0 7px;font-size:10.5px;flex:1">📌 Xəritədə kliklə seç</button>
                        ${hasSavedCustom ? `<button type="button" class="btn btn-outline" id="resetMyLocGpsBtn" style="height:22px;padding:0 7px;font-size:10.5px">🔄 Canlı GPS</button>` : ""}
                    </div>
                </div>
            `;

            myLocationMarker = new maplibregl.Marker({ element: el, draggable: true })
                .setLngLat([lng, lat])
                .setPopup(new maplibregl.Popup({ offset: 14, closeButton: true }).setHTML(buildPopupHtml(lat, lng, subTitle)))
                .addTo(map);

            myLocationMarker.on("dragend", () => {
                const pos = myLocationMarker.getLngLat();
                const nLat = Number(pos.lat.toFixed(6));
                const nLng = Number(pos.lng.toFixed(6));
                writeStore(MY_CUSTOM_LOC_KEY, { lat: nLat, lng: nLng });
                placeMyLocationOnMap(nLat, nLng, "📌 Sizin təyin etdiyiniz dəqiq məkan", map.getZoom(), false);
                toast(`✅ Dəqiq məkanınız yadda saxlanıldı (${nLat.toFixed(5)}, ${nLng.toFixed(5)})`);
            });

            map.flyTo({ center: [lng, lat], zoom: zoomLevel });
            myLocationMarker.togglePopup();

            setTimeout(() => {
                $("pickExactMyLocBtn")?.addEventListener("click", () => {
                    toast("📌 Xəritədə olduğunuz dəqiq nöqtəyə 1 dəfə klikləyin");
                    map.getCanvas().style.cursor = "crosshair";
                    const oncePick = ev => {
                        map.getCanvas().style.cursor = "";
                        const pLat = Number(ev.lngLat.lat.toFixed(6));
                        const pLng = Number(ev.lngLat.lng.toFixed(6));
                        writeStore(MY_CUSTOM_LOC_KEY, { lat: pLat, lng: pLng });
                        placeMyLocationOnMap(pLat, pLng, "📌 Sizin təyin etdiyiniz dəqiq məkan", Math.max(map.getZoom(), 16), false);
                        toast(`✅ Dəqiq məkanınız qeyd olundu (${pLat.toFixed(5)}, ${pLng.toFixed(5)})`);
                    };
                    map.once("click", oncePick);
                });
                $("resetMyLocGpsBtn")?.addEventListener("click", () => {
                    localStorage.removeItem(MY_CUSTOM_LOC_KEY);
                    toast("🔄 Canlı GPS axtarılır...");
                    requestLiveGpsLocation(true);
                });
            }, 80);
        }

        async function fallbackIpLocation() {
            const savedLoc = readStore(MY_CUSTOM_LOC_KEY, null);
            if (savedLoc && Number.isFinite(savedLoc.lat) && Number.isFinite(savedLoc.lng)) {
                placeMyLocationOnMap(savedLoc.lat, savedLoc.lng, "📌 Yadda saxlanılmış dəqiq məkanınız", 16, false);
                toast(`🧭 Cari məkanınız göstərildi (${savedLoc.lat.toFixed(5)}, ${savedLoc.lng.toFixed(5)})`);
                return;
            }
            const urls = [
                "https://ipwho.is/",
                "https://get.geojs.io/v1/ip/geo.json",
                "https://ipapi.co/json/"
            ];
            for (const url of urls) {
                try {
                    const res = await fetch(url, { cache: "no-store" });
                    if (!res.ok) continue;
                    const data = await res.json();
                    const lat = Number(data.latitude);
                    const lng = Number(data.longitude);
                    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) > 0.1 && Math.abs(lng) > 0.1) {
                        const city = data.city || data.region || "";
                        placeMyLocationOnMap(lat, lng, city ? `İnternet provayder mövqeyi (${city})` : "İnternet provayder mövqeyi", 14, true);
                        toast(`🧭 Təxmini şəbəkə mövqeyi göstərildi — Dəqiqləşdirmək üçün nöqtəni sürüşdürün`);
                        return;
                    }
                } catch {}
            }
            const lat = 40.4093, lng = 49.8671;
            placeMyLocationOnMap(lat, lng, "Bakı (GPS icazəsi bağlıdır)", 13, true);
            toast("🧭 GPS icazəsi bağlıdır — nöqtəni sürüşdürərək dəqiq yerinizi seçə bilərsiniz");
        }

        function requestLiveGpsLocation(ignoreSaved = false) {
            const savedLoc = !ignoreSaved ? readStore(MY_CUSTOM_LOC_KEY, null) : null;
            if (savedLoc && Number.isFinite(savedLoc.lat) && Number.isFinite(savedLoc.lng)) {
                placeMyLocationOnMap(savedLoc.lat, savedLoc.lng, "📌 Yadda saxlanılmış dəqiq məkanınız", 16, false);
                return;
            }
            if (!navigator.geolocation) {
                fallbackIpLocation();
                return;
            }
            if (myLocWatchId !== null) {
                navigator.geolocation.clearWatch(myLocWatchId);
                myLocWatchId = null;
            }
            toast("🧭 Dəqiq GPS koordinatınız müəyyən edilir...");
            let bestAcc = Infinity;
            let settled = false;

            const stopWatch = () => {
                if (myLocWatchId !== null) {
                    navigator.geolocation.clearWatch(myLocWatchId);
                    myLocWatchId = null;
                }
            };

            myLocWatchId = navigator.geolocation.watchPosition(
                pos => {
                    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
                    const acc = Number(accuracy) || 9999;
                    if (acc < bestAcc || !settled) {
                        bestAcc = acc;
                        settled = true;
                        const isCoarsePc = acc > 1200;
                        const accText = isCoarsePc
                            ? `Təxmini provayder/Wi-Fi mövqeyi (±${Math.round(acc)} m)`
                            : `Canlı GPS dəqiqliyi: ±${Math.round(acc)} m`;
                        placeMyLocationOnMap(lat, lng, accText, isCoarsePc ? 14 : 16, isCoarsePc);
                    }
                    if (acc <= 35) {
                        stopWatch();
                    }
                },
                () => {
                    stopWatch();
                    if (!settled) fallbackIpLocation();
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
            setTimeout(stopWatch, 8000);
        }

        $("myLocationBtn")?.addEventListener("click", () => {
            requestLiveGpsLocation(false);
        });

        const pegBtn = $("pegmanBtn");
        const hint = $("pegmanDropHint");
        if (pegBtn) {
            pegBtn.addEventListener("click", () => {
                pegmanActive = !pegmanActive;
                pegBtn.classList.toggle("active", pegmanActive);
                if (hint) hint.hidden = !pegmanActive;
                if (window.map) map.getCanvas().style.cursor = pegmanActive ? "crosshair" : "";
            });

            pegBtn.addEventListener("mousedown", e => {
                if (e.button !== 0) return;
                let moved = false;
                let ghost = null;
                const onMove = ev => {
                    if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 6) {
                        moved = true;
                        if (hint) hint.hidden = false;
                        ghost = document.createElement("div");
                        ghost.className = "pegman-drag-ghost";
                        ghost.innerHTML = `<i class="fa-solid fa-street-view"></i>`;
                        document.body.appendChild(ghost);
                    }
                    if (ghost) {
                        ghost.style.left = `${ev.clientX}px`;
                        ghost.style.top = `${ev.clientY}px`;
                    }
                };
                const onUp = ev => {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                    if (ghost) ghost.remove();
                    if (!moved) return;
                    if (hint) hint.hidden = true;
                    pegmanActive = false;
                    pegBtn.classList.remove("active");
                    const box = map.getCanvasContainer().getBoundingClientRect();
                    if (ev.clientX >= box.left && ev.clientX <= box.right && ev.clientY >= box.top && ev.clientY <= box.bottom) {
                        const lngLat = map.unproject([ev.clientX - box.left, ev.clientY - box.top]);
                        openStreetViewAt(lngLat.lat, lngLat.lng);
                    }
                };
                window.addEventListener("mousemove", onMove);
                window.addEventListener("mouseup", onUp);
            });
        }
    }

    // 👥 Admin İstifadəçilər Pəncərəsi (Şifrə / Email OTP və Səlahiyyət)
    const USERS_STORE_KEY = "bcg.admin.users.v1";
    const DELETED_USERS_STORE_KEY = "bcg.deleted.users.v1";
    const TEMPLATE_EMAIL_SET = new Set(["admin@bcg.az", "rashad@bcg.az", "elvin@bcg.az", "orxan@bcg.az", "kamran@bcg.az"]);

    function getDeletedUsersEmailSet() {
        const arr = readStore(DELETED_USERS_STORE_KEY, []);
        return new Set(Array.isArray(arr) ? arr.map(e => String(e).trim().toLowerCase()) : []);
    }

    function loadUsersRegistry() {
        const delSet = getDeletedUsersEmailSet();
        const stored = readStore(USERS_STORE_KEY, null);
        if (stored && Array.isArray(stored)) {
            const filtered = stored.filter(u => {
                if (!u || !u.email) return false;
                const em = String(u.email).trim().toLowerCase();
                if (delSet.has(em)) return false;
                if (!u.customAdded && TEMPLATE_EMAIL_SET.has(em)) return false;
                return true;
            });
            if (filtered.length !== stored.length) {
                writeStore(USERS_STORE_KEY, filtered);
            }
            if (filtered.length > 0 || stored.length === 0) return filtered;
        }
        const defEmail = state.user?.email || "turan.bagirov@bcg.az";
        if (delSet.has(String(defEmail).toLowerCase())) return [];
        const initList = [
            { id: 1, name: "Turan Bağırov (Admin)", email: defEmail, role: "admin", authMode: "🔑 Şifrə + Email", passMask: "••••••••", customAdded: true }
        ];
        writeStore(USERS_STORE_KEY, initList);
        return initList;
    }

    function renderUsersModal() {
        const body = $("usersTableBody");
        if (!body) return;
        const list = loadUsersRegistry();
        const roleLabels = {
            admin: `<span class="pill" style="--tone:#22C55E">👑 Admin (Tam icazə)</span>`,
            editor: `<span class="pill" style="--tone:#F59E0B">✏️ Redaktə (Status / Qeyd)</span>`,
            viewer: `<span class="pill" style="--tone:#3B82F6">👁️ Yalnız Baxış</span>`
        };
        body.innerHTML = list.map(u => `
            <tr>
                <td><b>${esc(u.name)}</b></td>
                <td class="mono">${esc(u.email)}</td>
                <td><span class="invoice-pill">${esc(u.authMode)}</span></td>
                <td>${roleLabels[u.role] || esc(u.role)}</td>
                <td class="num">
                    <button class="icon-btn small" data-del-user="${u.id}" title="Sil"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `).join("");
    }

    function populateNoteRecipients() {
        const sel = $("noteRecipient");
        if (!sel) return;
        const delSet = getDeletedUsersEmailSet();
        const regEmails = loadUsersRegistry().map(u => u.email);
        const emails = [...new Set([...(state.users || []), ...regEmails, state.user?.email].filter(Boolean))]
            .filter(e => {
                const low = String(e).trim().toLowerCase();
                return !delSet.has(low) && !TEMPLATE_EMAIL_SET.has(low);
            });
        const current = sel.value || "all";
        sel.innerHTML = `<option value="all">Hamıya (All)</option>` + emails.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join("");
        sel.value = emails.includes(current) ? current : "all";
    }

    window.renderAll = function () {
        ensureDefaultNimAndAzconnect();
        applySavedCustomItems();
        purgeDeletedFromState();
        applySavedGeomOverrides();
        applySavedMetaOverrides();
        (state.projects || []).forEach(p => {
            if (p && p.name && p.category !== "other") {
                p.name = cleanProjectName(p.name, p.sheetId || p.pmoMeta?.sheetId);
            }
        });
        if ($("mapMarkerDock")) $("mapMarkerDock").hidden = !isAdmin();
        origRenderAll();
        updateLegendVisibility();
        renderInfoCard();
        populateNoteRecipients();
    };

    document.addEventListener("DOMContentLoaded", () => {
        ensureMapWidgets();
        initRightTools();

        if ("serviceWorker" in navigator) {
            navigator.serviceWorker.register("sw.js").catch(() => {});
        }
        let deferredPwaPrompt = null;
        window.addEventListener("beforeinstallprompt", e => {
            e.preventDefault();
            deferredPwaPrompt = e;
            if ($("installPwaBtn")) $("installPwaBtn").hidden = false;
        });
        $("installPwaBtn")?.addEventListener("click", async () => {
            if (!deferredPwaPrompt) {
                toast("📲 Telefonda brauzer menyusundan 'Əsas ekrana əlavə et' (Add to Home Screen) seçin");
                return;
            }
            deferredPwaPrompt.prompt();
            await deferredPwaPrompt.userChoice.catch(() => {});
            deferredPwaPrompt = null;
            if ($("installPwaBtn")) $("installPwaBtn").hidden = true;
        });

        window.addEventListener("storage", e => {
            if (e.key === ADMIN_CONTRACTORS_KEY) {
                syncAdminContractors();
                renderAll();
            }
        });

        // Sol dibdə Yarım Dairə üzərində 4 Qovluq (🏢 BCG, 🚦 NİİM, 🌐 Azərconnect, 🗂️ Digər)
        // 1x Sol klik: Qovluğu aktiv/deaktiv et · 2x Sol klik: Bütün qovluqları və layihələri söndür
        let lastFolderLeftClick = 0;
        let folderSingleClickTimer = null;

        $("sideCatTabs")?.addEventListener("click", e => {
            const now = Date.now();
            if (now - lastFolderLeftClick < 280) {
                clearTimeout(folderSingleClickTimer);
                lastFolderLeftClick = 0;
                state.activeFolders.clear();
                state.visibleIds.clear();
                state.selected = null;
                activeProjectId = null;
                window.__activeProjectId = null;
                if ($("infoCard")) $("infoCard").hidden = true;
                if (geomEditState) cancelGeomEdit(true);
                renderAll();
                toast("2x Sol klik: Bütün qovluqlar və layihələr söndürüldü");
                return;
            }
            lastFolderLeftClick = now;

            const btn = e.target.closest("[data-folder-tab]");
            if (!btn) return;
            const folder = btn.dataset.folderTab;
            const fNames = { project: "🏢 BCG", nim: "🚦 NİİM", azconnect: "🌐 Azərconnect", other: "🗂️ Digər" };

            clearTimeout(folderSingleClickTimer);
            folderSingleClickTimer = setTimeout(() => {
                if (state.activeFolders.has(folder)) {
                    state.activeFolders.delete(folder);
                    const curProjId = state.selected?.projectId || activeProjectId;
                    const curProj = state.projects.find(p => p.id === curProjId);
                    if (curProj && (curProj.category || "project") === folder) {
                        state.selected = null;
                        activeProjectId = null;
                        window.__activeProjectId = null;
                    }
                    toast(`${fNames[folder]} söndürüldü`);
                } else {
                    state.activeFolders.add(folder);
                    state.sidebarCategory = folder;
                    const hiddenSet = getHiddenProjectIds();
                    state.projects.filter(p => (p.category || "project") === folder).forEach(p => {
                        if (!hiddenSet.has(p.id)) state.visibleIds.add(p.id);
                    });
                    toast(`${fNames[folder]} aktiv edildi`);
                }
                recordAuditLog("Qovluq Seçimi", fNames[folder] || folder, "Yarım dairə menyu", `${fNames[folder]} qovluğu ${state.activeFolders.has(folder) ? "aktiv edildi" : "deaktiv edildi"}`);
                renderAll();
            }, 220);
        });

        // İdxal seçim pəncərəsi
        $("impChooseFileBtn")?.addEventListener("click", () => {
            const picked = document.querySelector('input[name="impTarget"]:checked')?.value || "other";
            pendingImportCategory = isAdmin() ? picked : "other";
            $("importFile").click();
        });

        // Admin İstifadəçilər pəncərəsi
        $("usersBtn")?.addEventListener("click", () => {
            if (!isAdmin()) return;
            renderUsersModal();
            $("usersModal")?.showModal();
        });
        $("uGenPassBtn")?.addEventListener("click", () => {
            const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#";
            let pass = "Bcg#";
            for (let i = 0; i < 6; i++) pass += chars[Math.floor(Math.random() * chars.length)];
            if ($("uPass")) $("uPass").value = pass;
        });
        $("uCopyBtn")?.addEventListener("click", async () => {
            const email = $("uEmail")?.value.trim() || "user@bcg.az";
            const pass = $("uPass")?.value.trim();
            const text = `BCG GIS Giriş: Email: ${email} | ${pass ? "Şifrə: " + pass : "Giriş üsulu: Email birdəfəlik OTP kodu ilə"}`;
            try { await navigator.clipboard.writeText(text); } catch {}
            toast("📋 Giriş məlumatları kopyalandı!");
        });
        ($("userAddForm") || $("addUserForm"))?.addEventListener("submit", e => {
            e.preventDefault();
            const name = ($("uName") || $("newUserName"))?.value.trim();
            const email = ($("uEmail") || $("newUserEmail"))?.value.trim();
            const pass = ($("uPass") || $("newUserPass"))?.value.trim();
            const rawRole = ($("uRole") || $("newUserPerm"))?.value || "viewer";
            const role = rawRole === "view" ? "viewer" : (rawRole === "edit" ? "editor" : rawRole);
            if (!name || !email) return;
            const cleanEmail = email.toLowerCase();
            const delSet = getDeletedUsersEmailSet();
            delSet.delete(cleanEmail);
            writeStore(DELETED_USERS_STORE_KEY, [...delSet]);
            const list = loadUsersRegistry().filter(u => String(u.email || "").trim().toLowerCase() !== cleanEmail);
            const newUserObj = {
                id: Date.now(),
                name,
                email,
                password: pass,
                role,
                authMode: pass ? `🔑 Şifrə (${pass})` : "📧 Email kodu ilə",
                passMask: pass || "OTP",
                lastLogin: "Hələ daxil olmayıb",
                lastAction: "Admin tərəfindən yaradıldı",
                customAdded: true
            };
            list.unshift(newUserObj);
            writeStore(USERS_STORE_KEY, list);
            if (typeof api !== "undefined" && api.registerAdminUserInCloud) {
                api.registerAdminUserInCloud(newUserObj).catch(() => {});
            }
            if ($("uName")) $("uName").value = "";
            if ($("newUserName")) $("newUserName").value = "";
            if ($("uEmail")) $("uEmail").value = "";
            if ($("newUserEmail")) $("newUserEmail").value = "";
            if ($("uPass")) $("uPass").value = "";
            if ($("newUserPass")) $("newUserPass").value = "";
            renderUsersModal();
            populateNoteRecipients();
            toast(`✅ İstifadəçi əlavə olundu və bulud bazasına sinxronlaşdırıldı: ${email}`);
        });
        $("usersTableBody")?.addEventListener("click", e => {
            const del = e.target.closest("[data-del-user]");
            if (!del) return;
            const id = Number(del.dataset.delUser);
            const curList = loadUsersRegistry();
            const target = curList.find(u => u.id === id);
            if (target?.email) {
                const delSet = getDeletedUsersEmailSet();
                delSet.add(String(target.email).trim().toLowerCase());
                writeStore(DELETED_USERS_STORE_KEY, [...delSet]);
            }
            const list = curList.filter(u => u.id !== id);
            writeStore(USERS_STORE_KEY, list);
            if (typeof api !== "undefined" && api.syncCloudRegistry) {
                api.syncCloudRegistry().catch(() => {});
            }
            renderUsersModal();
            populateNoteRecipients();
            toast("🗑️ İstifadəçi silindi");
        });

        $("projectList").addEventListener("click", e => {
            const projEl = e.target.closest(".project");
            if (!projEl) return;
            const projId = projEl.dataset.id;
            const btn = e.target.closest("[data-action]");
            if (btn && (btn.dataset.action === "expand" || btn.dataset.action === "toggle")) {
                const projObj = state.projects.find(p => p.id === projId);
                const isProjVisible = Boolean(projObj && state.visibleIds.has(projId) && state.activeFolders.has(projObj.category || "project"));
                if (isProjVisible) {
                    activeProjectId = projId;
                    window.__activeProjectId = projId;
                } else {
                    activeProjectId = null;
                    window.__activeProjectId = null;
                }
                state.selected = null;
                renderInfoCard();
                renderChips();
                updateLegendVisibility();
                drawRoutes();
            }
        });

        // Xəritə klik və 1x / 2x sağ klik davranışı
        const bindMapEnhancements = () => {
            if (!window.map) { setTimeout(bindMapEnhancements, 150); return; }

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
                        window.__activeProjectId = null;
                        if ($("infoCard")) $("infoCard").hidden = true;
                        closePopovers();
                        renderChips();
                        updateLegendVisibility();
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

        // Anbar & Material Reyestri: 3 Tab (Ümumi Anbar Qalığı, Layihə üzrə Qalıq, Qaimələr Jurnalı)
        const matModal = $("materialsModal");
        if (matModal && !$("matFilterBar")) {
            const wrap = matModal.querySelector(".table-wrap");
            const nav = document.createElement("div");
            nav.id = "matTabsBar";
            nav.className = "mat-tabs-bar";
            nav.innerHTML = `
                <div class="mat-tabs">
                    <button type="button" class="mat-tab active" data-mat-tab="stock">📊 Ümumi Anbar Qalığı</button>
                    <button type="button" class="mat-tab" data-mat-tab="projects">📁 Layihə üzrə Qalıq</button>
                    <button type="button" class="mat-tab" data-mat-tab="journal">📋 Qaimələr (Jurnal)</button>
                </div>
                <div class="mat-quick-acts">
                    <button type="button" class="btn btn-primary" data-mat-add="in" id="matAddBtn" hidden>+ Mal / Qaimə əlavə et</button>
                    <button type="button" class="btn btn-outline" id="matExportCsvBtn" title="CSV (Excel) ixrac"><i class="fa-solid fa-file-csv"></i> Excel</button>
                </div>
            `;
            const bar = document.createElement("div");
            bar.id = "matFilterBar";
            bar.className = "mat-filters";
            bar.innerHTML = `
                <label>
                    <span>Hərəkət:</span>
                    <select class="input" id="matFilterFlow">
                        <option value="all">Hamısı</option>
                        <option value="in">📥 Anbara gəlib (Mədaxil)</option>
                        <option value="out">📤 Layihəyə gedib (Məxaric)</option>
                        <option value="return">↩️ Layihədən qayıdıb (Qaytarma)</option>
                    </select>
                </label>
                <label>
                    <span>Kateqoriya:</span>
                    <select class="input" id="matFilterCat">
                        <option value="all">Hamısı</option>
                        <option value="kabel">🔌 Kabel (FO)</option>
                        <option value="mufta">🔗 Mufta</option>
                        <option value="patchpanel">🗄️ Patch Panel</option>
                    </select>
                </label>
                <label>
                    <span>Layihə:</span>
                    <select class="input" id="matFilterProject"><option value="all">Bütün layihələr</option></select>
                </label>
                <label style="flex:1;min-width:140px">
                    <span>Axtar (Material, Qaimə, Firma):</span>
                    <input class="input" type="search" id="matFilterInvoice" placeholder="Məs: FO 48, Bakcable, 0145…">
                </label>
                <button class="btn btn-outline" type="button" id="matMoreFilterBtn" title="Tarix və material filtrləri">⚙️ Tarix</button>
                <button class="btn btn-outline" type="button" id="matFilterReset">Sıfırla</button>
                <div class="mat-extra-filters" id="matExtraFilters" hidden>
                    <label>
                        <span>Material:</span>
                        <select class="input" id="matFilterType"><option value="all">Bütün materiallar</option></select>
                    </label>
                    <label>
                        <span>Başlanğıc tarix:</span>
                        <input class="input" type="date" id="matFilterFrom">
                    </label>
                    <label>
                        <span>Son tarix:</span>
                        <input class="input" type="date" id="matFilterTo">
                    </label>
                </div>
            `;
            const summary = document.createElement("div");
            summary.id = "matSummary";
            summary.className = "mat-summary";
            matModal.insertBefore(nav, wrap);
            matModal.insertBefore(bar, wrap);
            matModal.insertBefore(summary, wrap);

            $("matMoreFilterBtn")?.addEventListener("click", () => {
                const extra = $("matExtraFilters");
                if (extra) extra.hidden = !extra.hidden;
            });

            nav.addEventListener("click", e => {
                const tabBtn = e.target.closest("[data-mat-tab]");
                if (tabBtn) {
                    window._matActiveTab = tabBtn.dataset.matTab;
                    nav.querySelectorAll("[data-mat-tab]").forEach(b => b.classList.toggle("active", b === tabBtn));
                    window.renderMaterials();
                    return;
                }
                const addBtn = e.target.closest("[data-mat-add]");
                if (addBtn && isAdmin()) {
                    window.editMaterial(null, addBtn.dataset.matAdd);
                }
            });

            $("matExportCsvBtn")?.addEventListener("click", () => window.exportMaterialsCsv?.());

            ["matFilterFlow", "matFilterCat", "matFilterProject", "matFilterType", "matFilterFrom", "matFilterTo"].forEach(id => {
                $(id)?.addEventListener("change", () => window.renderMaterials());
            });
            $("matFilterInvoice").addEventListener("input", () => window.renderMaterials());
            $("matFilterReset").addEventListener("click", () => {
                if ($("matFilterFlow")) $("matFilterFlow").value = "all";
                $("matFilterCat").value = "all";
                $("matFilterProject").value = "all";
                if ($("matFilterType")) $("matFilterType").value = "all";
                $("matFilterInvoice").value = "";
                if ($("matFilterFrom")) $("matFilterFrom").value = "";
                if ($("matFilterTo")) $("matFilterTo").value = "";
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
        const myEmail = String(state.user?.email || "").trim().toLowerCase();
        const active = state.notes.filter(n => !n.expiresAt || new Date(n.expiresAt).getTime() > now);
        const visibleForMe = active.filter(n => {
            const rec = String(n.recipient || "all").trim().toLowerCase();
            const auth = String(n.author || "").trim().toLowerCase();
            return isAdmin() || !rec || rec === "all" || (myEmail && (rec === myEmail || auth === myEmail));
        });

        if ($("notesList")) {
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
                            ${isAdmin() || n.userId === state.user?.id || (myEmail && String(n.author || "").trim().toLowerCase() === myEmail) ? `<button class="icon-btn small" data-id="${n.id}" title="${t("delete")}"><i class="fa-solid fa-trash"></i></button>` : ""}
                        </div>`;
                }).join("");
        }
        if ($("notesCount")) {
            $("notesCount").hidden = visibleForMe.length === 0;
            $("notesCount").textContent = visibleForMe.length;
        }

        const incoming = visibleForMe.find(n => {
            const rec = String(n.recipient || "all").trim().toLowerCase();
            return ((myEmail && rec === myEmail) || rec === "all") && !notifiedIds.has(n.id);
        });
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

    const MAT_CAT_LABELS = {
        kabel: "🔌 Kabel",
        mufta: "🔗 Mufta",
        patchpanel: "🗄️ Patch Panel",
        diger: "📦 Digər"
    };
    const MAT_FLOW_LABELS = {
        in: "📥 Mədaxil",
        out: "📤 Məxaric",
        return: "↩️ Qaytarma"
    };

    function parseMaterialRecord(m) {
        const cleanName = String(m.material || "").replace(/\bFOV\b/gi, "FO").trim();
        const cat = detectMaterialCategory(cleanName, m.category);
        const flow = m.flow || (m.state === "in_stock" && /anbar/i.test(String(m.project || "")) ? "in" : "out");
        let unit = m.unit || (/əd|eded/i.test(String(m.quantity || "")) ? "əd" : "m");
        let qty = Number(m.qty_num);
        if (!Number.isFinite(qty) || qty <= 0) {
            const rawStr = String(m.quantity || m.issued_qty || m.used_qty || "");
            const num = Number(rawStr.replace(/[^\d.,]/g, "").replace(",", ".")) || 0;
            if (/km\b/i.test(rawStr)) {
                qty = Math.round(num * 1000);
                unit = "m";
            } else {
                qty = num;
            }
        }
        return { ...m, cleanName, cat, flow, qty, unit };
    }

    function calcMapActualForProject(projName, matName, cat) {
        const proj = (state.projects || []).find(p => p.name === projName);
        if (!proj) return { val: 0, matched: false };
        if (cat === "mufta") {
            const sumCl = (proj.items || []).reduce((s, r) => s + (Number(r.closures) || 0), 0);
            return { val: sumCl, matched: true };
        }
        if (cat !== "kabel") return { val: 0, matched: false };
        const foMatch = matName.match(/\bFO\s*[-–]?\s*(\d+)\b/i);
        const targetFo = foMatch ? Number(foMatch[1]) : 0;
        let doneM = 0;
        let hasFoMatch = false;
        (proj.items || []).forEach(r => {
            const segFoStr = typeof getSegmentFiber === "function" ? getSegmentFiber(r, proj) : (r.fiberCount || "");
            const segFoNum = Number(String(segFoStr || "").replace(/[^\d]/g, "")) || 0;
            if (!targetFo || segFoNum === targetFo) {
                if (targetFo && segFoNum === targetFo) hasFoMatch = true;
                doneM += Math.round((Number(r.doneKm) || 0) * 1000);
            }
        });
        return { val: Math.round(doneM), matched: hasFoMatch || !targetFo };
    }

    function formatMatQty(val, unit) {
        const n = Math.round((Number(val) || 0) * 100) / 100;
        return `${n.toLocaleString("az-AZ")} ${unit || "m"}`;
    }

    // Anbar & Material Reyestri: Ümumi Anbar Qalığı + Layihə üzrə Kabel Qalığı + Qaimələr Jurnalı
    window.renderMaterials = function () {
        if (!$("materialsHead") || !$("materialsBody")) return;
        let changed = false;
        (state.materials || []).forEach(m => {
            if (m.project && LEGACY_PROJECT_RENAME_MAP[m.project]) {
                m.project = LEGACY_PROJECT_RENAME_MAP[m.project];
                changed = true;
                if (isAdmin() && api.configured && m.id) {
                    api.saveMaterial(m.id, { ...m, project: m.project }).catch(() => {});
                }
            }
        });
        if (changed) {
            try {
                const snap = JSON.parse(localStorage.getItem("bcg.db.snapshot.v1") || "null");
                if (snap) {
                    snap.materials = state.materials;
                    localStorage.setItem("bcg.db.snapshot.v1", JSON.stringify(snap));
                }
            } catch {}
        }

        if ($("matAddBtn")) $("matAddBtn").hidden = !isAdmin();

        const parsed = (state.materials || []).map(parseMaterialRecord);

        const projSel = $("matFilterProject");
        const typeSel = $("matFilterType");
        if (projSel && typeSel) {
            const pCur = projSel.value || "all";
            const tCur = typeSel.value || "all";
            const projects = [...new Set([
                "🏢 Ümumi Anbar",
                ...state.projects.filter(p => p.category !== "other").map(p => p.name),
                ...parsed.map(m => m.project),
                "BCG — Bakı-Quba-Qusar Magistralı",
                "BCG — Bakı-Şamaxı-Yevlax Magistralı",
                "BCG — Gəncə-Qazax Magistralı",
                "BCG — Cənub Antena Layihəsi",
                "BCG — Qərb Antena Layihəsi",
                "Azərconnect — Bakı-Sumqayıt Magistralı"
            ])].filter(Boolean);
            const types = [...new Set(parsed.map(m => m.cleanName))].filter(Boolean);
            projSel.innerHTML = `<option value="all">Bütün layihələr</option>` + projects.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
            typeSel.innerHTML = `<option value="all">Bütün materiallar</option>` + types.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
            projSel.value = projects.includes(pCur) ? pCur : "all";
            typeSel.value = types.includes(tCur) ? tCur : "all";
        }

        const activeTab = window._matActiveTab || "stock";
        const flowVal = $("matFilterFlow")?.value || "all";
        const catVal = $("matFilterCat")?.value || "all";
        const pVal = projSel?.value || "all";
        const mVal = typeSel?.value || "all";
        const invVal = ($("matFilterInvoice")?.value || "").trim().toLowerCase();
        const dFrom = $("matFilterFrom")?.value || "";
        const dTo = $("matFilterTo")?.value || "";

        const filtered = parsed.filter(m => {
            const mDate = m.used_date || "";
            const inv = (m.invoice_no || `QAİMƏ-2026-0${140 + (m.id || 1)}`).toLowerCase();
            const sup = (m.supplier || "").toLowerCase();
            if (flowVal !== "all" && m.flow !== flowVal) return false;
            if (catVal !== "all" && m.cat !== catVal) return false;
            if (pVal !== "all" && m.project !== pVal) return false;
            if (mVal !== "all" && m.cleanName !== mVal) return false;
            if (invVal && !inv.includes(invVal) && !sup.includes(invVal) && !m.cleanName.toLowerCase().includes(invVal)) return false;
            if (dFrom && mDate < dFrom) return false;
            if (dTo && mDate > dTo) return false;
            return true;
        });

        // 1) Ümumi Anbar Qalığı (Material üzrə: Mədaxil - Məxaric + Qaytarma)
        const stockMap = new Map();
        filtered.forEach(m => {
            const key = `${m.cat}::${m.cleanName.toLowerCase()}`;
            if (!stockMap.has(key)) {
                stockMap.set(key, { cat: m.cat, name: m.cleanName, unit: m.unit, inQty: 0, outQty: 0, retQty: 0, suppliers: new Set() });
            }
            const row = stockMap.get(key);
            if (m.flow === "in") {
                row.inQty += m.qty;
                if (m.supplier) row.suppliers.add(m.supplier);
            } else if (m.flow === "return") {
                row.retQty += m.qty;
            } else {
                row.outQty += m.qty;
            }
        });
        const stockRows = [...stockMap.values()].sort((a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));

        // 2) Layihə üzrə Qalıq (Layihə + Material)
        const projMatMap = new Map();
        filtered.filter(m => m.flow !== "in" && m.project && m.project !== "🏢 Ümumi Anbar").forEach(m => {
            const key = `${m.project}::${m.cleanName.toLowerCase()}`;
            if (!projMatMap.has(key)) {
                projMatMap.set(key, { project: m.project, cat: m.cat, name: m.cleanName, unit: m.unit, outQty: 0, retQty: 0 });
            }
            const row = projMatMap.get(key);
            if (m.flow === "return") row.retQty += m.qty;
            else row.outQty += m.qty;
        });
        const projRows = [...projMatMap.values()].map(r => {
            const actual = calcMapActualForProject(r.project, r.name, r.cat);
            const netIssued = Math.max(0, r.outQty - r.retQty);
            const mapUsed = actual.val;
            const remain = r.outQty - r.retQty - mapUsed;
            return { ...r, mapUsed, netIssued, remain };
        }).sort((a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name));

        // Kritik limit yoxlaması (bütün anbar üzrə: kabel < 3000m, mufta/patchpanel < 5 əd)
        const allStockMap = new Map();
        parsed.forEach(m => {
            const k = `${m.cat}::${m.cleanName.toLowerCase()}`;
            if (!allStockMap.has(k)) allStockMap.set(k, { cat: m.cat, name: m.cleanName, unit: m.unit, inQty: 0, outQty: 0, retQty: 0 });
            const r = allStockMap.get(k);
            if (m.flow === "in") r.inQty += m.qty;
            else if (m.flow === "return") r.retQty += m.qty;
            else r.outQty += m.qty;
        });
        const isCriticalRow = r => {
            const rem = r.inQty - r.outQty + r.retQty;
            const limit = r.unit === "m" ? 3000 : 5;
            return (r.inQty > 0 && rem < limit) || rem < 0;
        };
        const criticalItems = [...allStockMap.values()].filter(isCriticalRow);
        if ($("materialsAlertCount")) {
            $("materialsAlertCount").hidden = criticalItems.length === 0;
            $("materialsAlertCount").textContent = criticalItems.length;
            $("materialsAlertCount").title = criticalItems.map(r => `${r.name}: ${formatMatQty(r.inQty - r.outQty + r.retQty, r.unit)}`).join(", ");
        }

        if ($("matSummary")) {
            const kabelIn = stockRows.filter(r => r.cat === "kabel").reduce((s, r) => s + r.inQty, 0);
            const kabelOut = stockRows.filter(r => r.cat === "kabel").reduce((s, r) => s + r.outQty, 0);
            const kabelRet = stockRows.filter(r => r.cat === "kabel").reduce((s, r) => s + r.retQty, 0);
            const kabelRem = kabelIn - kabelOut + kabelRet;
            const critHtml = criticalItems.length > 0
                ? `<span style="color:var(--red);font-weight:600">🚨 Kritik qalıq (${criticalItems.length}): ${criticalItems.slice(0, 3).map(r => `${esc(r.name)} (${formatMatQty(r.inQty - r.outQty + r.retQty, r.unit)})`).join(", ")}</span>`
                : `<span>${isAdmin() ? "👑 Admin" : "👁️ Baxış"} · Qaimə: <b>${filtered.length}</b></span>`;
            $("matSummary").innerHTML = `
                <span>🔌 Ümumi Kabel: <b>Gələn ${kabelIn.toLocaleString("az-AZ")} m</b> · <b>Verilən ${kabelOut.toLocaleString("az-AZ")} m</b> · <b>Qayıdan ${kabelRet.toLocaleString("az-AZ")} m</b> · <b style="color:${kabelRem >= 0 ? "var(--green)" : "var(--red)"}">Anbar Qalığı: ${kabelRem.toLocaleString("az-AZ")} m</b></span>
                ${critHtml}
            `;
        }

        if (activeTab === "stock") {
            window._matLastCsv = [
                ["Kateqoriya", "Material", "Anbara Gələn", "Layihələrə Verilən", "Anbara Qaytarılan", "Anbarda Qalıq", "Təchizatçı"],
                ...stockRows.map(r => [MAT_CAT_LABELS[r.cat], r.name, formatMatQty(r.inQty, r.unit), formatMatQty(r.outQty, r.unit), formatMatQty(r.retQty, r.unit), formatMatQty(r.inQty - r.outQty + r.retQty, r.unit), [...r.suppliers].join("; ")])
            ];
            $("materialsHead").innerHTML = `<tr>
                <th>Kateqoriya</th>
                <th>Material</th>
                <th class="num">📥 Anbara Gələn</th>
                <th class="num">📤 Layihələrə Verilən</th>
                <th class="num">↩️ Qaytarılan</th>
                <th class="num">📦 Anbarda Qalıq</th>
                <th>Təchizatçı</th>
            </tr>`;
            $("materialsBody").innerHTML = stockRows.length === 0
                ? `<tr><td colspan="7" class="empty">Anbar qeydi tapılmadı</td></tr>`
                : stockRows.map(r => {
                    const rem = r.inQty - r.outQty + r.retQty;
                    const crit = isCriticalRow(r);
                    const remColor = rem <= 0 ? "var(--red)" : (crit ? "var(--amber)" : "var(--green)");
                    return `<tr>
                        <td>${MAT_CAT_LABELS[r.cat] || r.cat}</td>
                        <td><b>${esc(r.name)}</b>${crit ? ` <span class="pill" style="--tone:var(--red);margin-left:4px">⚠️ Kritik</span>` : ""}</td>
                        <td class="num" style="color:var(--green)"><b>${formatMatQty(r.inQty, r.unit)}</b></td>
                        <td class="num" style="color:var(--amber)"><b>${formatMatQty(r.outQty, r.unit)}</b></td>
                        <td class="num" style="color:var(--blue)">${formatMatQty(r.retQty, r.unit)}</td>
                        <td class="num"><b style="color:${remColor}">${formatMatQty(rem, r.unit)}</b></td>
                        <td>${esc([...r.suppliers].join(", ") || "—")}</td>
                    </tr>`;
                }).join("");
            return;
        }

        if (activeTab === "projects") {
            window._matLastCsv = [
                ["Layihə", "Kateqoriya", "Material", "Layihəyə Verilən", "Xəritədə Çəkilən", "Anbara Qaytarılan", "Layihədə Qalıq"],
                ...projRows.map(r => [r.project, MAT_CAT_LABELS[r.cat], r.name, formatMatQty(r.outQty, r.unit), formatMatQty(r.mapUsed, r.unit), formatMatQty(r.retQty, r.unit), formatMatQty(r.remain, r.unit)])
            ];
            $("materialsHead").innerHTML = `<tr>
                <th>Layihə</th>
                <th>Material</th>
                <th class="num">📤 Verilən</th>
                <th class="num">🗺️ Xəritədə Çəkilən</th>
                <th class="num">↩️ Qaytarılan</th>
                <th class="num">⚖️ Layihədə Qalıq</th>
            </tr>`;
            $("materialsBody").innerHTML = projRows.length === 0
                ? `<tr><td colspan="6" class="empty">Layihələrə material çıxışı qeyd olunmayıb</td></tr>`
                : projRows.map(r => {
                    const remColor = r.remain > 0 ? "var(--amber)" : (r.remain < 0 ? "var(--red)" : "var(--green)");
                    return `<tr>
                        <td><b>${esc(r.project)}</b></td>
                        <td>${MAT_CAT_LABELS[r.cat] || ""} · <b>${esc(r.name)}</b></td>
                        <td class="num"><b>${formatMatQty(r.outQty, r.unit)}</b></td>
                        <td class="num" style="color:var(--blue)">${formatMatQty(r.mapUsed, r.unit)}</td>
                        <td class="num" style="color:var(--green)">${formatMatQty(r.retQty, r.unit)}</td>
                        <td class="num"><b style="color:${remColor}">${formatMatQty(r.remain, r.unit)}</b></td>
                    </tr>`;
                }).join("");
            return;
        }

        // 3) Qaimələr Jurnalı
        window._matLastCsv = [
            ["Tarix", "Hərəkət", "Qaimə №", "Kateqoriya", "Material", "Miqdar", "Layihə / Anbar", "Təchizatçı / İcraçı", "Qeyd"],
            ...filtered.map(m => [formatDate(m.used_date), MAT_FLOW_LABELS[m.flow] || m.flow, m.invoice_no || `QAİMƏ-2026-0${140 + (m.id || 1)}`, MAT_CAT_LABELS[m.cat] || m.cat, m.cleanName, formatMatQty(m.qty, m.unit), m.project, m.supplier || "", m.note || ""])
        ];
        $("materialsHead").innerHTML = `<tr>
            <th>Tarix</th>
            <th>Hərəkət</th>
            <th>📄 Qaimə №</th>
            <th>Material</th>
            <th class="num">Miqdar</th>
            <th>Layihə / Anbar</th>
            <th>Kimdən / Kimə</th>
            ${isAdmin() ? "<th></th>" : ""}
        </tr>`;
        const colSpan = isAdmin() ? 8 : 7;
        $("materialsBody").innerHTML = filtered.map(m => {
            const invoiceNo = m.invoice_no || `QAİMƏ-2026-0${140 + (m.id || 1)}`;
            const flowColor = m.flow === "in" ? "var(--green)" : (m.flow === "return" ? "var(--blue)" : "var(--amber)");
            return `
                <tr>
                    <td class="mono">${formatDate(m.used_date)}</td>
                    <td><span class="pill" style="--tone:${flowColor}">${MAT_FLOW_LABELS[m.flow] || "📤 Məxaric"}</span></td>
                    <td><span class="invoice-pill">📄 ${esc(invoiceNo)}</span></td>
                    <td><b>${esc(m.cleanName)}</b><small>${MAT_CAT_LABELS[m.cat] || ""}${m.note ? ` · ${esc(m.note)}` : ""}</small></td>
                    <td class="num"><b style="color:${flowColor}">${formatMatQty(m.qty, m.unit)}</b></td>
                    <td>${esc(m.project)}</td>
                    <td>${esc(m.supplier || "—")}</td>
                    ${isAdmin() ? `<td class="num"><button class="icon-btn" data-edit-material="${m.id}" title="${t("editMaterial")}"><i class="fa-solid fa-pen"></i></button></td>` : ""}
                </tr>
            `;
        }).join("") + (isAdmin() ? `<tr class="row-add"><td colspan="${colSpan}"><button class="link" data-edit-material="">+ ${t("addMaterial")} (📄 Anbar Qaiməsi əlavə et — Yalnız Admin)</button></td></tr>` : "");
    };

    window.exportMaterialsCsv = function () {
        const rows = window._matLastCsv;
        if (!Array.isArray(rows) || rows.length <= 1) {
            toast("⚠️ İxrac etmək üçün məlumat yoxdur", true);
            return;
        }
        const csv = "\uFEFF" + rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `BCG_Anbar_${window._matActiveTab || "stock"}_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast("✅ Anbar hesabatı Excel (CSV) olaraq yükləndi");
    };

    /* === 📊 PMO EXCEL CANLI SİNXRONİZASİYA (D1 / D2 / NÖMRƏLƏNMİŞ VƏRƏQLƏR) + CANLI BİLDİRİŞLƏR === */
    const DEFAULT_PMO_SHEET_URL = "https://docs.google.com/spreadsheets/d/1j01HnJA5axpTpWEf1ciADvzQp6D86z9a9mHOPBL5OpA/edit?usp=sharing";
    const PMO_CONFIG_KEY = "bcg.pmo.config.v1";
    const PMO_NOTIFS_KEY = "bcg.pmo.notifs.v1";
    const PMO_KNOWN_KEY = "bcg.pmo.known.v1";
    let xlsxLoadingPromise = null;
    let pmoWorkbook = null;
    let pmoLiveFileHandle = null;
    let pmoLastFileModified = 0;
    let pmoLastContentHash = "";
    let pmoLiveTimer = null;
    let pmoSourceType = ""; // "url" | "file"
    let pmoSourceName = "";
    let pmoNotifFilter = "all";

    const AZ_RAYON_COORDS = {
        "bakı": [40.4093, 49.8671], "abşeron": [40.4530, 49.7540], "sumqayıt": [40.5897, 49.6686],
        "gəncə": [40.6828, 46.3606], "mingəçevir": [40.7640, 47.0595], "şirvan": [39.9378, 48.9290],
        "naftalan": [40.5067, 46.8250], "ağcabədi": [40.0502, 47.4594], "ağdam": [39.9911, 46.9274],
        "ağdaş": [40.6470, 47.4738], "ağdərə": [40.2150, 46.8120], "ağsu": [40.5703, 48.4009],
        "astara": [38.4560, 48.8750], "babək": [39.1510, 45.4430], "balakən": [41.7263, 46.4048],
        "beyləqan": [39.7756, 47.6186], "bərdə": [40.3758, 47.1262], "biləsuvar": [39.4583, 48.5450],
        "cəbrayıl": [39.4000, 47.0260], "cəlilabad": [39.2096, 48.4919], "culfa": [38.9558, 45.6308],
        "daşkəsən": [40.5202, 46.0779], "füzuli": [39.6003, 47.1431], "gədəbəy": [40.5700, 45.8123],
        "goranboy": [40.6103, 46.7897], "göyçay": [40.6506, 47.7406], "göygöl": [40.5858, 46.3189],
        "hacıqabul": [40.0394, 48.9356], "imişli": [39.8709, 48.0600], "ismayıllı": [40.7871, 48.1519],
        "kəlbəcər": [40.1067, 46.0383], "kəngərli": [39.3872, 45.1636], "kürdəmir": [40.3425, 48.1564],
        "laçın": [39.6383, 46.5469], "lerik": [38.7739, 48.4150], "lənkəran": [38.7543, 48.8506],
        "masallı": [39.0353, 48.6654], "naxçıvan": [39.2089, 45.4122], "neftçala": [39.3768, 49.2470],
        "oğuz": [41.0713, 47.4653], "ordubad": [38.9096, 46.0227], "qax": [41.4183, 46.9204],
        "qazax": [41.0925, 45.3656], "qəbələ": [40.9814, 47.8458], "qobustan": [40.5336, 48.9282],
        "quba": [41.3611, 48.5134], "qubadlı": [39.3444, 46.5819], "qusar": [41.4275, 48.4302],
        "qarabağ": [39.8153, 46.7519], "saatlı": [39.9321, 48.3689], "sabirabad": [40.0087, 48.4770],
        "salyan": [39.5962, 48.9848], "samux": [40.7649, 46.4087], "sədərək": [39.7142, 44.8864],
        "siyəzən": [41.0761, 49.1139], "şabran": [41.2012, 48.9871], "şahbuz": [39.4072, 45.5739],
        "şamaxı": [40.6314, 48.6414], "şəki": [41.1919, 47.1706], "şəmkir": [40.8297, 46.0178],
        "şərur": [39.5528, 44.9799], "şuşa": [39.7601, 46.7499], "tərtər": [40.3420, 46.9316],
        "tovuz": [40.9925, 45.6284], "ucar": [40.5180, 47.6500], "xaçmaz": [41.4643, 48.8056],
        "xankəndi": [39.8153, 46.7519], "xızı": [40.9085, 49.0748], "xocalı": [39.9130, 46.7903],
        "xocavənd": [39.7915, 47.1101], "yardımlı": [38.9077, 48.2405], "yevlax": [40.6183, 47.1501],
        "zaqatala": [41.6316, 46.6448], "zəngilan": [39.0857, 46.6525], "zərdab": [40.2184, 47.7121],
        "mazımçay": [41.7875, 46.3150], "zəngəzur": [38.8650, 46.1400],
        "türkiyə": [39.6550, 44.8030], "ermənistan": [39.7450, 44.8650],
        "nəsimi": [40.3890, 49.8390], "xətai": [40.3780, 49.9520], "xəzər": [40.4850, 50.1250],
        "suraxanı": [40.4220, 50.0080], "yasamal": [40.3820, 49.8050], "binəqədi": [40.4550, 49.8220],
        "səbail": [40.3520, 49.8320], "sabunçu": [40.4480, 49.9480], "nərimanov": [40.4080, 49.8680],
        "nizami": [40.4090, 49.9320], "pirallahı": [40.4720, 50.3250], "qaradağ": [40.2850, 49.5850],
        "əsgəran": [39.9360, 46.8320],
        "rpş": [40.4093, 49.8671]
    };

    function findKnownAzRayonCoord(name) {
        const clean = String(name || "")
            .replace(/\s*rayon(u)?\b/gi, "")
            .replace(/\s*şəhər(i)?\b/gi, "")
            .trim()
            .toLocaleLowerCase("az");
        if (!clean || clean === "rpş") return null;
        if (AZ_RAYON_COORDS[clean]) return [...AZ_RAYON_COORDS[clean]];
        for (const [k, v] of Object.entries(AZ_RAYON_COORDS)) {
            if (k === "rpş") continue;
            if (clean === k || clean.startsWith(k + " ") || clean.startsWith(k + "-") || clean.includes(k)) {
                return [...v];
            }
        }
        return null;
    }

    function lookupAzRayonCoord(name, fallbackIdx = 0) {
        const known = findKnownAzRayonCoord(name);
        if (known) return known;
        const rmCent = findRmPolygonCentroid(name);
        if (rmCent) return rmCent;
        const clean = String(name || "").trim().toLocaleLowerCase("az");
        if (AZ_RAYON_COORDS[clean]) return [...AZ_RAYON_COORDS[clean]];
        return [40.35 + ((fallbackIdx % 7) * 0.045), 47.55 + (Math.floor(fallbackIdx / 7) * 0.06)];
    }

    // Dəyişim 2026 (Vərəq 14) üçün əsas "D" sütunundakı rayon/ünvan adına, "G" sütunundakı TŞ/kod prefiksinə və ya "C" koordinatına görə rayonu dəqiq təyin et
    const AZ_PLATE_RAYON_MAP = {
        "01": "Abşeron", "02": "Ağdam", "03": "Ağdaş", "04": "Ağcabədi", "05": "Ağstafa", "06": "Ağsu",
        "07": "Astara", "08": "Balakən", "09": "Bərdə", "11": "Beyləqan", "12": "Biləsuvar", "14": "Cəbrayıl",
        "15": "Cəlilabad", "16": "Daşkəsən", "17": "Şabran", "18": "Şirvan", "19": "Füzuli", "20": "Gəncə",
        "21": "Gədəbəy", "22": "Goranboy", "23": "Göyçay", "24": "Hacıqabul", "25": "Göygöl", "26": "Xankəndi",
        "27": "Xaçmaz", "28": "Xocavənd", "29": "Xızı", "30": "İmişli", "31": "İsmayıllı", "32": "Kəlbəcər",
        "33": "Kürdəmir", "34": "Qax", "35": "Qazax", "36": "Qəbələ", "37": "Qobustan", "38": "Qusar",
        "39": "Qubadlı", "40": "Quba", "41": "Laçın", "42": "Lənkəran", "43": "Lerik", "44": "Masallı",
        "45": "Mingəçevir", "46": "Naftalan", "47": "Neftçala", "48": "Oğuz", "49": "Saatlı", "50": "Sumqayıt",
        "51": "Samux", "52": "Salyan", "53": "Siyəzən", "54": "Sabirabad", "55": "Şəki", "56": "Şamaxı",
        "57": "Şəmkir", "58": "Şuşa", "59": "Tərtər", "60": "Tovuz", "61": "Ucar", "62": "Zaqatala",
        "63": "Zərdab", "64": "Zəngilan", "65": "Yardımlı", "66": "Yevlax", "70": "Naxçıvan", "75": "Naxçıvan", "85": "Naxçıvan"
    };
    const BAKU_TS_RAYON_MAP = {
        "1": "Səbail", "2": "Yasamal", "3": "Nəsimi", "4": "Nizami", "5": "Xətai", "6": "Nərimanov",
        "7": "Xəzər", "8": "Binəqədi", "9": "Sabunçu", "10": "Suraxanı", "11": "Qaradağ", "12": "Pirallahı"
    };
    const DEYISIM_RAYON_PATTERNS = [
        [/pirallah[ıi]|g[üu]rgan/i, "Pirallahı"],
        [/qarada[ğg]|l[öoəe]kbatan|meyv[əe]li|s[əe]ng[əe][çc]al|[əe]l[əe]t(?![\s\-]+astara)/i, "Qaradağ"],
        [/suraxan[ıi]|[əe]mircan|h[öo]vsan|b[üu]lb[üu]l[əe]|qara[çc]uxur|yeni\s*g[üu]n[əe][şs]li/i, "Suraxanı"],
        [/sabun[çc]u|zabrat|k[üu]rd[əe]xan[ıi]|ma[şs]ta[ğg]a|bak[ıi]xanov|ramana|nardaran|bilg[əe]h|pir[şs]a[ğg][ıi]|r[əe]him[əe]\s*xan[ıi]m/i, "Sabunçu"],
        [/x[əe]z[əe]r|m[əe]rd[əe]kan|zir[əe]|[şs][üu]v[əe]lan|d[üu]b[əe]ndi|buzovna|\bqala\b|t[üu]rkan|[şs]a[ğg]an|bin[əe]\s*q[əe]s/i, "Xəzər"],
        [/bin[əe]q[əe]di|bil[əe]c[əe]ri|sulut[əe]p[əe]|xoc[əe]s[əe]n|r[əe]sulzad[əe]|elit\s*tm|d[əe]rn[əe]g[üu]l/i, "Binəqədi"],
        [/nizami\s*rayon|atletl[əe]r|gimnastika|ginastika|nga_|koro[ğg]lu\s*(?!r[əe]himov)|neft[çc]il[əe]r\s*(?!pr)|qara\s*qarayev|xalqlar\s*dostlu[ğg]u/i, "Nizami"],
        [/n[əe]rimanov\s*rayon|t[əe]briz\s*k[üu][çc]|konqres|koro[ğg]lu\s*r[əe]himov|akademik\s*h[əe]s[əe]n\s*[əe]liyev|ya[şs][ıi]l.*bazar|g[əe]nclik|ziya\s*b[üu]nyadov/i, "Nərimanov"],
        [/x[əe]tai|xocal[ıi]\s*pr|ukrayna\s*dair[əe]|[əe]hm[əe]dli|h[əe]zi\s*aslanov|37-ci\s*polis|a[ğg]\s*[şs][əe]h[əe]r|bab[əe]k\s*pr/i, "Xətai"],
        [/n[əe]simi|28\s*may|azadl[ıi]q\s*pr|cavadxan|vaqif\s*pr|memar\s*[əe]c[əe]mi|h\.?[əe]liyev.*m[əe]mm[əe]dyarov|qa[şs]qay/i, "Nəsimi"],
        [/yasamal|20\s*yanvar|[şs][əe]rifzad[əe]|[şs][əe]fa[əe]t\s*mehdiyev|[şs]\.mehdiyev|in[şs]aat[çc][ıi]lar|elml[əe]r|b[əe][şs]ir\s*s[əe]f[əe]ro[ğg]lu/i, "Yasamal"],
        [/s[əe]bail|[şs][əe]hidl[əe]r|filarmoniya|badamdar|bay[ıi]l|sahil\s*ba[ğg]|i[çc][əe]ri[şs][əe]h[əe]r|neft[çc]il[əe]r\s*pr|saat\s*q[üu]ll[əe]|h[əe]s[əe]n\s*seyidb[əe]yli|parlament/i, "Səbail"],
        [/ab[şs]eron|x[ıi]rdalan|masaz[ıi]r|saray\s*q[əe]s|novxan[ıi]|mehdiabad|digah/i, "Abşeron"],
        [/sumqay[ıi]t/i, "Sumqayıt"], [/g[əe]nc[əe]/i, "Gəncə"], [/\bquba\b/i, "Quba"], [/qusar/i, "Qusar"],
        [/xa[çc]maz/i, "Xaçmaz"], [/q[əe]b[əe]l[əe]/i, "Qəbələ"], [/[şs]amax[ıi]/i, "Şamaxı"], [/qazax/i, "Qazax"],
        [/[şs][əe]mkir/i, "Şəmkir"], [/tovuz/i, "Tovuz"], [/o[ğg]uz/i, "Oğuz"], [/[şs][əe]ki/i, "Şəki"],
        [/ismay[ıi]ll[ıi]/i, "İsmayıllı"], [/\bqax\b/i, "Qax"], [/zaqatala/i, "Zaqatala"], [/balak[əe]n/i, "Balakən"],
        [/yevlax/i, "Yevlax"], [/b[əe]rd[əe]/i, "Bərdə"], [/ming[əe][çc]evir/i, "Mingəçevir"], [/a[ğg]cab[əe]di/i, "Ağcabədi"],
        [/a[ğg]dam/i, "Ağdam"], [/a[ğg]da[şs]/i, "Ağdaş"], [/a[ğg]stafa/i, "Ağstafa"], [/a[ğg]su/i, "Ağsu"],
        [/g[öo]y[çc]ay/i, "Göyçay"], [/k[üu]rd[əe]mir/i, "Kürdəmir"], [/ucar/i, "Ucar"], [/z[əe]rdab/i, "Zərdab"],
        [/hac[ıi]qabul/i, "Hacıqabul"], [/saatl[ıi]/i, "Saatlı"], [/sabirabad/i, "Sabirabad"], [/[şs]irvan/i, "Şirvan"],
        [/salyan/i, "Salyan"], [/neft[çc]ala/i, "Neftçala"], [/bil[əe]suvar/i, "Biləsuvar"], [/c[əe]lilabad/i, "Cəlilabad"],
        [/masall[ıi]/i, "Masallı"], [/l[əe]nk[əe]ran/i, "Lənkəran"], [/astara/i, "Astara"], [/lerik/i, "Lerik"],
        [/yard[ıi]ml[ıi]/i, "Yardımlı"], [/imi[şs]li/i, "İmişli"], [/beyl[əe]qan/i, "Beyləqan"], [/f[üu]zuli/i, "Füzuli"],
        [/[əe]sg[əe]ran/i, "Əsgəran"], [/xank[əe]ndi/i, "Xankəndi"], [/[şs]u[şs]a/i, "Şuşa"], [/la[çc][ıi]n/i, "Laçın"],
        [/k[əe]lb[əe]c[əe]r/i, "Kəlbəcər"], [/t[əe]rt[əe]r/i, "Tərtər"], [/goranboy/i, "Goranboy"], [/g[öo]yg[öo]l/i, "Göygöl"],
        [/samux/i, "Samux"], [/da[şs]k[əe]s[əe]n/i, "Daşkəsən"], [/g[əe]d[əe]b[əe]y/i, "Gədəbəy"], [/qobustan/i, "Qobustan"],
        [/[şs]abran/i, "Şabran"], [/siy[əe]z[əe]n/i, "Siyəzən"], [/x[ıi]z[ıi]/i, "Xızı"], [/nax[çc][ıi]van/i, "Naxçıvan"]
    ];

    function findNearestAzRayonByCoord(coords) {
        if (!Array.isArray(coords) || coords.length !== 2) return "";
        const [lat, lng] = coords;
        let bestKey = "";
        let bestDist = Infinity;
        for (const [k, c] of Object.entries(AZ_RAYON_COORDS)) {
            if (k === "rpş" || k === "bakı" || k === "qarabağ" || k === "mazımçay" || k === "zəngəzur" || k === "türkiyə" || k === "ermənistan") continue;
            const d = Math.hypot(lat - c[0], lng - c[1]);
            if (d < bestDist) {
                bestDist = d;
                bestKey = k;
            }
        }
        if (!bestKey) return "";
        return bestKey.charAt(0).toLocaleUpperCase("az") + bestKey.slice(1);
    }

    function resolveDeyisimRayon(colD, colG, coords) {
        const dStr = String(colD || "").trim();
        const gStr = String(colG || "").trim();
        // 1. Əsas "D" sütununda rayon / şəhər / qəsəbə adı axtar
        if (dStr) {
            for (const [re, rName] of DEYISIM_RAYON_PATTERNS) {
                if (re.test(dStr)) return rName;
            }
        }
        // 2. "G" və ya "D" sütunundakı TŞ / seriya koduna görə (məs: 40TŞ → Quba, TŞ5 → Xətai, GTŞ → Gəncə)
        const combined = `${gStr} ${dStr}`;
        const plateM = combined.match(/\b(\d{2})\s*(?:T[ŞS]|NTS)\b/i);
        if (plateM && AZ_PLATE_RAYON_MAP[plateM[1]]) return AZ_PLATE_RAYON_MAP[plateM[1]];
        const bakuM = combined.match(/\b(?:T[ŞS]|NTS)[\-\s]*(\d{1,2})\-/i);
        if (bakuM && BAKU_TS_RAYON_MAP[bakuM[1]]) return BAKU_TS_RAYON_MAP[bakuM[1]];
        if (/\bGT[ŞS]/i.test(combined)) return "Gəncə";
        if (/\bST[ŞS]/i.test(combined)) return "Sumqayıt";
        if (/\bAT[ŞS]/i.test(combined)) return "Abşeron";
        if (/\bQT[ŞS]/i.test(combined)) return "Quba";
        // 3. Koordinat ("C" sütunu) varsa ən yaxın rayonu tap
        if (Array.isArray(coords) && coords.length === 2) {
            const near = findNearestAzRayonByCoord(coords);
            if (near) return near;
        }
        if (/bak[ıi]/i.test(dStr)) return "Bakı (Ümumi)";
        return "Bakı (Ümumi)";
    }

    // RM Region mərkəzləri ("Digər" qovluğundakı RM poliqonlarının həndəsi mərkəzi + coğrafi ehtiyat mərkəzlər)
    const AZ_RM_PRESET_CENTROIDS = {
        "bakı rm1": [40.4180, 49.8250],
        "bakı rm2": [40.4480, 50.0250],
        "cənub rm": [38.9800, 48.5800],
        "qarabağ rm": [39.9200, 46.8500],
        "qərb rm": [40.7500, 45.9500],
        "şimal rm": [41.3200, 48.6800],
        "şimal-qərb rm": [41.3200, 46.9500],
        "mərkəz rm": [40.2500, 48.2000],
        "naxçıvan rm": [39.2500, 45.4500]
    };

    const AZ_RAYON_TO_RM = {
        // Bakı RM1
        "bakı": "Bakı RM1", "binəqədi": "Bakı RM1", "qaradağ": "Bakı RM1", "nərimanov": "Bakı RM1",
        "nəsimi": "Bakı RM1", "səbail": "Bakı RM1", "yasamal": "Bakı RM1", "abşeron": "Bakı RM1", "sumqayıt": "Bakı RM1",
        // Bakı RM2
        "xətai": "Bakı RM2", "nizami": "Bakı RM2", "sabunçu": "Bakı RM2", "suraxanı": "Bakı RM2",
        "xəzər": "Bakı RM2", "pirallahı": "Bakı RM2",
        // Cənub RM
        "astara": "Cənub RM", "biləsuvar": "Cənub RM", "cəlilabad": "Cənub RM", "lerik": "Cənub RM",
        "lənkəran": "Cənub RM", "masallı": "Cənub RM", "yardımlı": "Cənub RM", "salyan": "Cənub RM", "neftçala": "Cənub RM",
        // Qarabağ RM
        "xankəndi": "Qarabağ RM", "şuşa": "Qarabağ RM", "ağdam": "Qarabağ RM", "ağdərə": "Qarabağ RM",
        "ağcabədi": "Qarabağ RM", "beyləqan": "Qarabağ RM", "bərdə": "Qarabağ RM", "cəbrayıl": "Qarabağ RM",
        "füzuli": "Qarabağ RM", "xocalı": "Qarabağ RM", "xocavənd": "Qarabağ RM", "kəlbəcər": "Qarabağ RM",
        "laçın": "Qarabağ RM", "qubadlı": "Qarabağ RM", "tərtər": "Qarabağ RM", "zəngilan": "Qarabağ RM", "qarabağ": "Qarabağ RM",
        // Qərb RM
        "gəncə": "Qərb RM", "ağstafa": "Qərb RM", "daşkəsən": "Qərb RM", "gədəbəy": "Qərb RM",
        "goranboy": "Qərb RM", "göygöl": "Qərb RM", "naftalan": "Qərb RM", "qazax": "Qərb RM",
        "samux": "Qərb RM", "şəmkir": "Qərb RM", "tovuz": "Qərb RM",
        // Şimal RM
        "quba": "Şimal RM", "qusar": "Şimal RM", "xaçmaz": "Şimal RM", "şabran": "Şimal RM",
        "siyəzən": "Şimal RM", "xızı": "Şimal RM",
        // Şimal-qərb RM
        "şəki": "Şimal-qərb RM", "qax": "Şimal-qərb RM", "zaqatala": "Şimal-qərb RM", "balakən": "Şimal-qərb RM",
        "oğuz": "Şimal-qərb RM", "qəbələ": "Şimal-qərb RM", "ismayıllı": "Şimal-qərb RM",
        "ağsu": "Şimal-qərb RM", "şamaxı": "Şimal-qərb RM", "qobustan": "Şimal-qərb RM",
        "kürdəmir": "Qarabağ RM", "zərdab": "Qarabağ RM", "ucar": "Qarabağ RM", "göyçay": "Qarabağ RM",
        "ağdaş": "Qərb RM", "yevlax": "Qərb RM", "mingəçevir": "Qərb RM",
        "imişli": "Qarabağ RM", "saatlı": "Cənub RM", "sabirabad": "Cənub RM", "şirvan": "Cənub RM", "hacıqabul": "Bakı RM1"
    };

    function normalizeRmKey(raw) {
        const s = String(raw || "")
            .replace(/^Digər\s*:\s*/i, "")
            .replace(/\s+/g, " ")
            .trim()
            .toLocaleLowerCase("az");
        if (!s) return "";
        if (/rm\s*1\b/.test(s)) return "bakı rm1";
        if (/rm\s*2\b/.test(s)) return "bakı rm2";
        if (/c[əe]nub/.test(s)) return "cənub rm";
        if (/qaraba[ğg]/.test(s)) return "qarabağ rm";
        if (/^[şs]imal[\s\-]*q[əe]rb|simal[\s\-]*qerb/.test(s)) return "şimal-qərb rm";
        if (/q[əe]rb/.test(s)) return "qərb rm";
        if (/[şs]imal/.test(s)) return "şimal rm";
        if (/m[əe]rk[əe]z/.test(s)) return "mərkəz rm";
        if (/nax[çc][ıi]van/.test(s)) return "naxçıvan rm";
        return /\brm\b/.test(s) ? s : "";
    }

    function computePolyAreaCentroid(ring) {
        if (!Array.isArray(ring) || ring.length === 0) return null;
        if (ring.length < 3) return [...ring[0]];
        let area2 = 0, cx = 0, cy = 0;
        for (let i = 0; i < ring.length; i++) {
            const [y0, x0] = ring[i];
            const [y1, x1] = ring[(i + 1) % ring.length];
            const cross = (x0 * y1) - (x1 * y0);
            area2 += cross;
            cx += (x0 + x1) * cross;
            cy += (y0 + y1) * cross;
        }
        if (Math.abs(area2) > 1e-9) {
            const factor = 1 / (3 * area2);
            const lat = cy * factor;
            const lng = cx * factor;
            if (lat >= 38 && lat <= 42.5 && lng >= 44 && lng <= 51.5) {
                return [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
            }
        }
        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
        for (const [lat, lng] of ring) {
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
        }
        return [Number(((minLat + maxLat) / 2).toFixed(6)), Number(((minLng + maxLng) / 2).toFixed(6))];
    }

    function isCoordInRing(pt, ring) {
        if (!pt || !Array.isArray(ring) || ring.length < 3) return false;
        const [py, px] = pt;
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [iy, ix] = ring[i];
            const [jy, jx] = ring[j];
            const intersect = ((iy > py) !== (jy > py)) && (px < ((jx - ix) * (py - iy)) / ((jy - iy) || 1e-12) + ix);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    function getOtherRmPolygons() {
        const mapByRm = new Map();
        const otherProjs = (state?.projects || []).filter(p => p && p.category === "other");
        for (const p of otherProjs) {
            const pKey = normalizeRmKey(p.name);
            for (const it of (p.items || [])) {
                const coords = Array.isArray(it?.coords) ? it.coords.filter(c => Array.isArray(c) && c.length >= 2 && !isNaN(c[0]) && !isNaN(c[1])) : [];
                if (coords.length < 3) continue;
                const itKey = normalizeRmKey(it.name) || pKey;
                if (!itKey) continue;
                if (!mapByRm.has(itKey)) {
                    mapByRm.set(itKey, { rmKey: itKey, displayName: String(it.name || p.name || "").replace(/^Digər\s*:\s*/i, "").trim(), rings: [] });
                }
                mapByRm.get(itKey).rings.push(coords);
            }
        }
        for (const entry of mapByRm.values()) {
            // Ən böyük halqanın sahə mərkəzini götür
            let bestRing = entry.rings[0];
            for (const rg of entry.rings) {
                if (rg.length > bestRing.length) bestRing = rg;
            }
            entry.centroid = computePolyAreaCentroid(bestRing);
        }
        return mapByRm;
    }

    function findRmPolygonCentroid(rmName) {
        const key = normalizeRmKey(rmName);
        if (!key) return null;
        const polyMap = getOtherRmPolygons();
        const polyEntry = polyMap.get(key);
        if (polyEntry && Array.isArray(polyEntry.centroid)) {
            return [...polyEntry.centroid];
        }
        if (AZ_RM_PRESET_CENTROIDS[key]) {
            return [...AZ_RM_PRESET_CENTROIDS[key]];
        }
        return null;
    }

    function canonicalRmDisplayName(rmKey) {
        const map = {
            "bakı rm1": "Bakı RM1",
            "bakı rm2": "Bakı RM2",
            "cənub rm": "Cənub RM",
            "qarabağ rm": "Qarabağ RM",
            "qərb rm": "Qərb RM",
            "şimal rm": "Şimal RM",
            "şimal-qərb rm": "Şimal-qərb RM",
            "mərkəz rm": "Mərkəz RM",
            "naxçıvan rm": "Naxçıvan RM"
        };
        return map[rmKey] || rmKey;
    }

    function resolveRmForRayon(rayonName, explicitRmText = "") {
        const expKey = normalizeRmKey(explicitRmText);
        if (expKey) return canonicalRmDisplayName(expKey);
        const rayKey = normalizeRmKey(rayonName);
        if (rayKey) return canonicalRmDisplayName(rayKey);

        const rayCoord = findKnownAzRayonCoord(rayonName);
        const polyMap = getOtherRmPolygons();
        if (rayCoord && polyMap.size > 0) {
            for (const entry of polyMap.values()) {
                if (entry.rings.some(rg => isCoordInRing(rayCoord, rg))) {
                    return canonicalRmDisplayName(entry.rmKey);
                }
            }
        }
        const cleanRay = String(rayonName || "")
            .replace(/\s*rayon(u)?\b/gi, "")
            .replace(/\s*şəhər(i)?\b/gi, "")
            .trim()
            .toLocaleLowerCase("az");
        if (AZ_RAYON_TO_RM[cleanRay]) return AZ_RAYON_TO_RM[cleanRay];
        for (const [k, rmVal] of Object.entries(AZ_RAYON_TO_RM)) {
            if (cleanRay && (cleanRay === k || cleanRay.startsWith(k + " ") || cleanRay.includes(k))) {
                return rmVal;
            }
        }
        if (rayCoord && polyMap.size > 0) {
            let bestKey = "", bestDist = Infinity;
            for (const entry of polyMap.values()) {
                if (!entry.centroid) continue;
                const d = Math.hypot(rayCoord[0] - entry.centroid[0], rayCoord[1] - entry.centroid[1]);
                if (d < bestDist) {
                    bestDist = d;
                    bestKey = entry.rmKey;
                }
            }
            if (bestKey) return canonicalRmDisplayName(bestKey);
        }
        return "";
    }
    window.findRmPolygonCentroid = findRmPolygonCentroid;
    window.resolveRmForRayon = resolveRmForRayon;
    window.findKnownAzRayonCoord = findKnownAzRayonCoord;

    function loadPmoNotifs() {
        const arr = readStore(PMO_NOTIFS_KEY, []);
        return Array.isArray(arr) ? arr : [];
    }

    function savePmoNotifs(list) {
        writeStore(PMO_NOTIFS_KEY, (list || []).slice(0, 150));
    }

    function renderPmoNotifsUI() {
        const list = loadPmoNotifs();
        const unreadCount = list.filter(n => n.unread).length;
        const badge = $("pmoNotifCount");
        const notifBtn = $("pmoNotifBtn");
        if (badge) {
            badge.hidden = unreadCount === 0;
            badge.textContent = String(unreadCount);
        }
        if (notifBtn) {
            notifBtn.classList.toggle("has-unread", unreadCount > 0);
        }
        // Filtr düymələrində canlı sayları göstər
        const tabs = $("pmoNotifFilterTabs");
        if (tabs) {
            const cntAll = list.length;
            const cntComp = list.filter(n => n.type === "completed").length;
            const cntNew = list.filter(n => n.type === "new_project").length;
            const cntErr = list.filter(n => n.type === "error").length;
            const lblMap = {
                all: `Hamısı (${cntAll})`,
                completed: `🟢 Bitən nöqtələr (${cntComp})`,
                new_project: `🆕 Yeni layihələr (${cntNew})`,
                error: `⚠️ Xətalı məlumatlar (${cntErr})`
            };
            tabs.querySelectorAll("[data-notif-filter]").forEach(btn => {
                const k = btn.dataset.notifFilter;
                if (lblMap[k]) btn.textContent = lblMap[k];
            });
        }
        const box = $("pmoNotifList");
        if (!box) return;
        const filtered = pmoNotifFilter === "all" ? list : list.filter(n => n.type === pmoNotifFilter);
        if (filtered.length === 0) {
            box.innerHTML = `<div class="empty">Hələ qeyd olunmuş bildiriş yoxdur. PMO cədvəlində nöqtə 100% (yaşıl 🟢) olduqda, yeni layihə əlavə edildikdə və ya standarta uyğun olmayan xətalı layihə aşkarlandıqda burada görünəcək.</div>`;
            return;
        }
        box.innerHTML = filtered.map(n => {
            const isError = n.type === "error";
            const isNewProj = n.type === "new_project";
            const tone = isError ? "#ef4444" : (isNewProj ? "#38bdf8" : "#22c55e");
            const icon = isError ? "⚠️" : (isNewProj ? "🆕" : "🟢");
            return `
                <div class="note" data-notif-jump="${esc(n.id)}" style="cursor:pointer;border-left:3px solid ${tone};background:${isError ? "rgba(239,68,68,0.09)" : (n.unread ? "rgba(34,197,94,0.08)" : "var(--surface-2)")};padding:10px 12px;border-radius:8px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
                    <div style="flex:1;min-width:0">
                        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
                            <span style="font-weight:700;font-size:12.5px;color:${tone}">${icon} ${esc(n.title)}</span>
                            ${n.unread ? `<span class="pill" style="--tone:${tone};font-size:9.5px">${isError ? "Xəta" : "Yeni"}</span>` : ""}
                        </div>
                        <div style="font-size:12px;color:var(--ink)">${esc(n.detail)}</div>
                        <small style="color:var(--ink-3);font-size:10.5px">${esc(n.time || "")}</small>
                    </div>
                    <i class="fa-solid fa-location-arrow" style="color:var(--ink-3);font-size:11px;margin-top:4px" title="Xəritədə göstər"></i>
                </div>
            `;
        }).join("");
    }

    function pushPmoNotif(entry, showToastNow = true) {
        const list = loadPmoNotifs();
        // Eyni xəta/standart bildirişi 20 san yeniləmədə təkrar yazılmasın
        if (entry.dedupeKey && list.some(n => n.dedupeKey === entry.dedupeKey)) {
            return false;
        }
        const now = new Date();
        const pad = x => String(x).padStart(2, "0");
        const timeStr = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const item = {
            id: `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            time: timeStr,
            unread: entry.unread !== undefined ? Boolean(entry.unread) : true,
            ...entry
        };
        list.unshift(item);
        savePmoNotifs(list);
        renderPmoNotifsUI();
        if (showToastNow) {
            const isErr = entry.type === "error";
            const icon = isErr ? "⚠️" : (entry.type === "new_project" ? "🆕" : "✅");
            toast(`${icon} ${entry.title}: ${entry.detail}`, isErr);
        }
        return true;
    }

    function loadPmoConfig() {
        const saved = readStore(PMO_CONFIG_KEY, null);
        return {
            url: DEFAULT_PMO_SHEET_URL,
            webhookUrl: "",
            useDomainAuth: false,
            pollInterval: 20,
            sheetName: "",
            headerRow: 1,
            targetFolder: "project",
            targetProject: "__auto__",
            syncMode: "both",
            unit: "auto",
            map: {},
            extraCols: [],
            ...(saved || {}),
            pollInterval: (saved && Number(saved.pollInterval) >= 20) ? Number(saved.pollInterval) : 20,
            url: (saved && saved.url) ? saved.url : DEFAULT_PMO_SHEET_URL
        };
    }

    function savePmoConfig(cfg) {
        writeStore(PMO_CONFIG_KEY, cfg);
    }

    // Xəritədə edilən dəyişiklikləri Google Sheets-ə geri yazmaq üçün (Apps Script Web App URL qoşulduqda)
    async function pushMapEditToSheet(payload) {
        const cfg = loadPmoConfig();
        const hook = String(cfg.webhookUrl || "").trim();
        if (!hook) return false;
        try {
            await fetch(hook, {
                method: "POST",
                mode: "no-cors",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify(payload)
            });
            return true;
        } catch (err) {
            console.warn("Google Sheets write webhook error:", err);
            return false;
        }
    }
    window.pushMapEditToSheet = pushMapEditToSheet;

    function normalizePmoUrl(rawUrl) {
        const u = String(rawUrl || "").trim();
        if (!u) return "";
        const gsMatch = u.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
        if (gsMatch) {
            return `https://docs.google.com/spreadsheets/d/${gsMatch[1]}/export?format=xlsx`;
        }
        if (/sharepoint\.com|onedrive\.live\.com/i.test(u) && !/[?&]download=1/i.test(u)) {
            return u + (u.includes("?") ? "&download=1" : "?download=1");
        }
        return u;
    }

    function normSheetId(raw) {
        const s = String(raw ?? "").trim();
        if (!s) return "";
        if (/^\d+\.0+$/.test(s)) return s.replace(/\.0+$/, "");
        if (/^\d+(?:\.\d+)*$/.test(s)) return s;
        return "";
    }

    function parsePmoNum(val) {
        if (val === null || val === undefined) return 0;
        if (typeof val === "number") return Number.isFinite(val) ? Math.round(val) : 0;
        let s = String(val).trim();
        if (!s || s === "-" || s === "—") return 0;
        s = s.replace(/\s+/g, "");
        // Minlik ayırıcı vergüldürsə (məs: "279,623" və ya "187,506.0") — vergülü sil, nöqtəyə çevirmə!
        if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) {
            s = s.replace(/,/g, "");
        } else if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(s)) {
            // Minlik ayırıcı nöqtədirsə (məs: "279.623" və ya "279.623,5")
            s = s.replace(/\./g, "").replace(",", ".");
        } else {
            s = s.replace(",", ".");
        }
        const n = Number(s);
        return Number.isFinite(n) ? Math.round(n) : 0;
    }

    function parsePmoPct(val) {
        if (val === null || val === undefined) return 0;
        const s = String(val).trim();
        if (!s || s === "-" || s === "—") return 0;
        const pctM = s.match(/(\d+(?:[.,]\d+)?)\s*%/);
        if (pctM) return Math.round(Number(pctM[1].replace(",", ".")));
        const n = Number(s.replace(",", "."));
        if (!Number.isFinite(n)) return 0;
        if (n > 0 && n <= 1.55) return Math.round(n * 100);
        return Math.round(n);
    }

    function parseCoordStr(raw) {
        const s = String(raw ?? "").trim();
        if (!s) return null;
        const m = s.match(/(-?\d{1,2}[.,]\d+)\s*[,;\s/]+\s*(-?\d{1,3}[.,]\d+)/);
        if (!m) return null;
        const lat = Number(m[1].replace(",", "."));
        const lng = Number(m[2].replace(",", "."));
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        if (lat >= 38 && lat <= 42.5 && lng >= 44 && lng <= 51.5) {
            return [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
        }
        if (lng >= 38 && lng <= 42.5 && lat >= 44 && lat <= 51.5) {
            return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
        }
        return null;
    }

    function cleanExecName(raw) {
        const s = String(raw ?? "").trim();
        if (!s || s === "-" || s === "—" || s === "0" || s === "1" || /^\d+(?:\.\d+)?$/.test(s)) return "";
        return s;
    }

    function parseExcelDate(serial) {
        if (!serial) return "";
        const n = Number(serial);
        if (!isNaN(n) && n > 30000 && n < 60000) {
            const utc_days = Math.floor(n - 25569);
            const date_info = new Date(utc_days * 86400 * 1000);
            return date_info.toLocaleDateString("az-AZ");
        }
        return String(serial).trim();
    }

    const MAGISTRAL_PRESET_COORDS = {
        "mag_93_1": [[41.1189, 45.4539], [41.1620, 45.3850], [41.2200, 45.2900], [41.2850, 45.1800], [41.3420, 45.0850]],
        "mag_93_2": [[39.0342, 48.6653], [39.0750, 48.6250], [39.1172, 48.5833]],
        "mag_93_3": [[39.7500, 47.9500], [39.7620, 47.7850], [39.7756, 47.6186]],
        "mag_93_4": [[40.6103, 46.7897], [40.5580, 46.8080], [40.5067, 46.8250]],
        "mag_93_5": [[40.6828, 46.3606], [40.7220, 46.3850], [40.7628, 46.4089]],
        "mag_93_6": [[41.0783, 49.1119], [41.0150, 49.0950], [40.9650, 49.0850], [40.9108, 49.0783]],
        "mag_93_7": [[41.7200, 48.6300], [41.6800, 48.5300], [41.6400, 48.4300]],
        "mag_93_8": [[40.3758, 47.1261], [40.2150, 47.2920], [40.0519, 47.4589]],
        "mag_93_9": [[40.0519, 47.4589], [40.1350, 47.5860], [40.2186, 47.7144]],
        "mag_93_10": [[40.2186, 47.7144], [40.2810, 47.9370], [40.3436, 48.1608]],
        "mag_93_11": [[40.3436, 48.1608], [40.4570, 48.2800], [40.5703, 48.4009]],
        "mag_93_12": [[41.4636, 48.8061], [41.4810, 48.7435], [41.4989, 48.6811]],
        "mag_93_13": [[41.4989, 48.6811], [41.6280, 48.6780], [41.7583, 48.6750]],
        "mag_93_14": [[41.7583, 48.6750], [41.7390, 48.6525], [41.7200, 48.6300]]
    };

    function normalizeConnLabel(raw) {
        const s = String(raw ?? "").trim();
        if (!s || s === "-" || s === "0") return "";
        if (s.includes("📶")) return "3G";
        if (s.includes("📡")) return "Anten";
        if (s.includes("🌐")) return "FO";
        return s;
    }

    function isStructuredPmoWorkbook(wb) {
        if (!wb || !Array.isArray(wb.SheetNames)) return false;
        const hasD1 = wb.SheetNames.some(n => /^d\s*1$/i.test(n.trim()));
        const hasD2 = wb.SheetNames.some(n => /^d\s*2$/i.test(n.trim()));
        return hasD1 && hasD2;
    }

    function colToLetter(idx) {
        let s = "";
        let n = idx;
        while (n >= 0) {
            s = String.fromCharCode((n % 26) + 65) + s;
            n = Math.floor(n / 26) - 1;
        }
        return s;
    }

    function getSheetARows(wb, sheetName) {
        if (!wb || !sheetName || !wb.Sheets?.[sheetName]) return [];
        const sh = wb.Sheets[sheetName];
        if (Array.isArray(sh._rawRows)) {
            return sh._rawRows.map((row, rIdx) => {
                const obj = { __rowNum__: rIdx + 1 };
                if (Array.isArray(row)) {
                    row.forEach((val, cIdx) => {
                        obj[colToLetter(cIdx)] = String(val ?? "").trim();
                    });
                }
                return obj;
            });
        }
        if (typeof XLSX !== "undefined" && XLSX.utils) {
            return XLSX.utils.sheet_to_json(sh, { header: "A", defval: "", raw: true });
        }
        return [];
    }

    function parseNumberedPmoSheet(wb, sheetId) {
        const sheetName = wb.SheetNames.find(n => n.trim() === sheetId || normSheetId(n.trim()) === sheetId);
        if (!sheetName || !wb.Sheets?.[sheetName]) {
            if (Array.isArray(window.PMO_SEED_PROJECTS)) {
                const spProj = window.PMO_SEED_PROJECTS.find(p => p.sheetId === sheetId);
                if (spProj) {
                    const allSubPts = spProj.items.flatMap(it => it.pmoRayon?.subPoints || []);
                    const mags = spProj.items.filter(it => it.isMagistral);
                    const seedTemirRows = [];
                    if (sheetId === "15.3") {
                        spProj.items.forEach(it => {
                            const tm = it.pmoRayon?.temirMeta;
                            const rLead = tm?.regLead || "";
                            (tm?.rayonBreakdown || []).forEach((rb, rIdx) => {
                                seedTemirRows.push({
                                    id: `seed_15_3_${it.id}_${rIdx}`,
                                    rmName: it.name,
                                    regLead: rLead,
                                    rayon: rb.name,
                                    ptCount: rb.count,
                                    status: (rb.doneCount >= rb.count) ? "bitmis" : "icrada",
                                    coords: null
                                });
                            });
                        });
                    }
                    return {
                        cablePlanM: spProj.pmoMeta?.cablePlanM || 0,
                        cableDoneM: spProj.pmoMeta?.cableDoneM || 0,
                        points: allSubPts,
                        magistrals: mags,
                        temirRows: seedTemirRows,
                        sheetMissing: true,
                        foundCableCol: false,
                        missingColARows: 0
                    };
                }
            }
            return { cablePlanM: 0, cableDoneM: 0, points: [], magistrals: [], temirRows: [], sheetMissing: true, foundCableCol: false, missingColARows: 0 };
        }
        const rows = getSheetARows(wb, sheetName);
        if (!Array.isArray(rows) || rows.length === 0) {
            return { cablePlanM: 0, cableDoneM: 0, points: [], magistrals: [], temirRows: [], sheetMissing: true, foundCableCol: false, missingColARows: 0 };
        }

        // 1. Kabel məsafəsi: bütün layihələrdə başlıq eynidir — "FO kabelin çəkilməsi" (sütun hərfi vərəqdən vərəqə fərqlənir: CT, CY, DU və s.)
        const topRows = rows.slice(0, 15);
        let cableCol = "";
        let looseCableCol = "";
        let radarCol = "AC";
        let addrCol = "D";
        for (const hr of topRows) {
            for (const [colKey, val] of Object.entries(hr)) {
                if (colKey === "__rowNum__") continue;
                const txt = String(val || "").replace(/\s+/g, " ").trim();
                if (!txt) continue;
                if (!cableCol && /^(?:\d+\s+)?FO[\s\-]*kabel(?:in(?:in)?)?\s*[çc][əe]kilm[əe]si$/i.test(txt)) {
                    cableCol = colKey;
                } else if (!looseCableCol && /FO[\s\-]*kabel(?:in(?:in)?)?\s*[çc][əe]kilm[əe]si/i.test(txt)) {
                    looseCableCol = colKey;
                }
                if (/^(?:\d+\s+)?radar$/i.test(txt)) {
                    radarCol = colKey;
                }
                if (/^(?:\d+\s+)?[üu]nvan$/i.test(txt)) {
                    addrCol = colKey;
                }
            }
            if (cableCol) break;
        }
        const foundCableCol = Boolean(cableCol || looseCableCol);
        if (!cableCol) {
            cableCol = looseCableCol || (sheetId === "11" ? "CY" : (sheetId === "12" ? "DU" : "CT"));
        }

        // İstənilən vərəqdə "magistral" sözü olan sətri aşkarla ("Ünvan" sütunundakı "avtomagistralı" sözünə qarışmadan)
        const MAG_PRIORITY_COLS = ["H", "G", "I", "F", "E", "J", "P"];
        const colLetterToIdx = col => {
            let n = 0;
            for (let k = 0; k < col.length; k++) n = n * 26 + (col.charCodeAt(k) - 64);
            return n - 1;
        };
        const findMagistralCell = row => {
            if (!row || typeof row !== "object") return null;
            for (const ck of MAG_PRIORITY_COLS) {
                if (ck === addrCol) continue;
                const v = String(row[ck] ?? "").trim();
                if (/\bmagistral\b/i.test(v)) {
                    const nextKey = colToLetter(colLetterToIdx(ck) + 1);
                    return { colKey: ck, text: v, nextColText: String(row[nextKey] ?? "").trim() };
                }
            }
            for (const [ck, val] of Object.entries(row)) {
                if (ck === "__rowNum__" || ck === "A" || ck === "B" || ck === "C" || ck === addrCol || MAG_PRIORITY_COLS.includes(ck)) continue;
                const v = String(val ?? "").trim();
                if (/\bmagistral\b/i.test(v)) {
                    const nextKey = colToLetter(colLetterToIdx(ck) + 1);
                    return { colKey: ck, text: v, nextColText: String(row[nextKey] ?? "").trim() };
                }
            }
            return null;
        };
        const normAe = v => String(v || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
        const rowHasLabel = (row, re) => {
            if (re.test(normAe(row.AE))) return true;
            return Object.entries(row).some(([k, v]) => k !== "__rowNum__" && re.test(normAe(v)));
        };
        const layIdx = topRows.findIndex(r => rowHasLabel(r, /^layih[əe]$/i));
        const rLay = (layIdx >= 0 ? topRows[layIdx] : null)
            || rows.find(r => r.__rowNum__ === 4) || rows[3] || {};
        const rIcra = topRows.find(r => rowHasLabel(r, /^[iı]cra\s*olunan$/i))
            || (layIdx >= 0 && rows[layIdx + 1] ? rows[layIdx + 1] : null)
            || rows.find(r => r.__rowNum__ === 5) || rows[4] || {};

        const cablePlanM = parsePmoNum(rLay[cableCol]) || 0;
        const cableDoneM = parsePmoNum(rIcra[cableCol]) || 0;

        // QIZIL QAYDA 2: Bütün layihələrdə xətt və ya nöqtə statusu ANCAQ VƏ ANCAQ "A" sütunundan götürülür!
        const parseStatusFromColA = rawA => {
            const s = String(rawA ?? "").trim();
            if (!s) return "";
            if (s.includes("❌") || /l[əe][ğg]v/i.test(s)) return "__cancelled__";
            if (s.includes("🟢") || /tamamlan|bitmi|haz[ıi]r|b[əe]rpa\s*edil/i.test(s)) return "bitmis";
            if (s.includes("🟡") || s.includes("🟠") || /icra/i.test(s)) return "icrada";
            if (s.includes("🔵") || /t[əe]hvil/i.test(s)) return "tehvil";
            if (s.includes("🔴") || /ba[şs]lan|layih|t[əe]xir/i.test(s)) return "layihe";
            return "";
        };

        // 2. Fərdi nöqtələr (status ANCAQ "A" sütunundan — 🟢/🟡/🔴/🔵)
        const points = [];
        let missingColARows = 0;
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const rn = r.__rowNum__ ?? (i + 1);
            const aStr = String(r.A ?? "").trim();
            const status = parseStatusFromColA(aStr);
            if (!status) {
                // Standart yoxlaması: 6-cı sətirdən aşağıda koordinat və ya ünvan+TŞ var, amma A sütununda status yoxdursa qeyd et
                if (rn >= 7 && String(sheetId) !== "15.3") {
                    const prevR = i > 0 ? rows[i - 1] : null;
                    const prevHadStatus = prevR && Boolean(parseStatusFromColA(prevR.A));
                    const dCheck = String(r[addrCol] ?? r.D ?? "").trim();
                    const cCheck = parseCoordStr(r.C);
                    const gCheck = String(r.G ?? "").trim();
                    if (!prevHadStatus && (cCheck || (dCheck && gCheck)) && !/^(?:[üu]nvan|layih[əe]|[iı]cra|c[əe]mi|[üu]mumi)/i.test(dCheck)) {
                        missingColARows++;
                    }
                }
                continue;
            }
            if (status === "__cancelled__") continue;

            // 15.2 (Layihəsiz Magistral) bütün sətirləri magistral xəttdir — fərdi nöqtələrə düşməsin
            if (String(sheetId) === "15.2") continue;

            // Magistral sətridirsə fərdi nöqtələrə deyil, aşağıdakı magistral bölməsinə düşsün
            const rawAddrCheck = String(r[addrCol] ?? r.D ?? "").trim();
            if (/^(?:[üu]nvan|layih[əe]|[iı]cra\s*olunan)$/i.test(rawAddrCheck)) continue;
            if (findMagistralCell(r) && rawAddrCheck) continue;

            // Növbəti sətir (i + 1) növbəti nöqtə deyilsə, icra olunan detallarını (FO kabelin çəkilməsi və s.) saxlayır
            const rawNext = (i + 1 < rows.length) ? rows[i + 1] : null;
            const nextIsAnotherPt = rawNext && /[🟢🟡🔴]/.test(String(rawNext.A || ""));
            const nextR = (rawNext && !nextIsAnotherPt) ? rawNext : {};

            const coords = parseCoordStr(r.C);
            const rawAddr = rawAddrCheck;
            const rawPole = String(r.E ?? "").trim();
            const rawTs = String(r.G ?? "").trim();
            const rawRegion = String(r.H ?? "").trim();
            const bcgExec = cleanExecName(r.K) || cleanExecName(nextR.K);
            const avicomExec = cleanExecName(r.L) || cleanExecName(nextR.L);
            const connType = normalizeConnLabel(r.P);
            const pct = status === "bitmis" ? 100 : parsePmoPct(r.R);
            const idxNum = parsePmoNum(r.B) || (points.length + 1);

            // Layihə üzrə verilən kabel (əsas sətir: r) və Faktiki çəkilən kabel (alt-sətir: nextR) ayrı-ayrı oxunur
            const hasSubRow = Boolean(rawNext && !nextIsAnotherPt);
            const ptCablePlanM = hasSubRow
                ? (parsePmoNum(r[cableCol]) || 0)
                : (status === "layihe" ? (parsePmoNum(r[cableCol]) || 0) : 0);
            const ptCableDoneM = hasSubRow
                ? (parsePmoNum(nextR[cableCol]) || 0)
                : (status === "layihe" ? 0 : (parsePmoNum(r[cableCol]) || 0));

            // Nöqtə növü (Radar vs TŞ — Muğanlı və qarışıq layihələr üçün fərqli ikon)
            const radarCount = parsePmoNum(r[radarCol]) || parsePmoNum(nextR[radarCol]);
            const combinedLabel = `${rawTs} ${rawAddr} ${rawRegion}`;
            const ptKind = (radarCount > 0 || /\bradar\b|ekin/i.test(combinedLabel))
                ? "radar"
                : ((/t[şs]/i.test(rawTs) || parsePmoNum(r.W) > 0 || parsePmoNum(r.X) > 0) ? "ts" : "");

            // Xəritədə çıxacaq ad: Muğanlı (Vərəq 12) üçün "Ünvan" (D sütunu), Dəyişim 2026 (Vərəq 14) və digərləri üçün "G" sütunu (TŞ nömrə / ad)
            let tsNo = (String(sheetId) === "12" && rawAddr) ? rawAddr : rawTs;
            if (!tsNo || tsNo.toLowerCase() === rawRegion.toLowerCase()) {
                tsNo = rawAddr
                    ? (rawAddr.length > 36 ? `${rawAddr.slice(0, 35).trim()}…` : rawAddr)
                    : `#${idxNum}`;
            }

            // Boş/şablon sətirləri keç
            if (!coords && !rawAddr && !rawTs && !rawRegion) continue;
            const resolvedRayon = String(sheetId) === "14"
                ? resolveDeyisimRayon(rawAddr, rawTs, coords)
                : rawRegion;
            if (!coords && (rawAddr || rawTs) && String(r.C || "").trim().length > 0) {
                // Yalnız C sütununda nəsə yazılıb amma koordinat kimi oxunmursa (yalnış format) xəta kimi qeyd et
                const errKey = `err_coord_${sheetId}_r${rn}`;
                pushPmoNotif({
                    dedupeKey: errKey,
                    type: "error",
                    title: "Koordinat xətası",
                    detail: `Vərəq ${sheetId}, Sətir ${rn}: ${tsNo || "Nöqtə"} koordinatı yalnışdır (${String(r.C).trim()})`,
                    projectId: `pmo_sheet_${String(sheetId).replace(/\./g, "_")}`
                }, false);
            }

            points.push({
                id: `pmo_${sheetId}_r${rn}`,
                idx: idxNum,
                tsNo,
                name: tsNo,
                address: rawAddr,
                pole: rawPole,
                rayon: resolvedRayon,
                bcgExec,
                avicomExec,
                connType,
                cablePlanM: ptCablePlanM,
                cableDoneM: ptCableDoneM,
                ptKind,
                status,
                statusEmoji: aStr,
                pct,
                coords
            });
        }

        // 3. Bütün layihələr üzrə Magistral Xətləri: hansı sətirdə "magistral" sözü varsa (və ya vərəq 15.2dirsə) magistraldır; status ANCAQ "A" sütunundan götürülür!
        const headerFoMatch = topRows
            .flatMap(hr => Object.values(hr))
            .map(v => String(v || "").match(/FO[\s\-]*(\d+)/i))
            .find(Boolean);
        const sheetHeaderFiber = headerFoMatch ? `FO ${headerFoMatch[1]}` : "";
        const isPureMagSheet = String(sheetId) === "15.2";

        const magistrals = [];
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const magHit = findMagistralCell(r);
            const dVal = String(r[addrCol] ?? r.D ?? "").trim();
            if (!dVal || /^(?:\d+\s+)?(?:[üu]nvan|layih[əe]|[iı]cra\s*olunan|rayon|region|m[öo]vcud)$/i.test(dVal)) continue;
            if (!magHit && !isPureMagSheet) continue;

            const rawNext = (i + 1 < rows.length) ? rows[i + 1] : null;
            const nextIsAnother = rawNext && (Boolean(parseStatusFromColA(rawNext.A)) || Boolean(findMagistralCell(rawNext)));
            const nextR = (rawNext && !nextIsAnother) ? rawNext : {};

            // QIZIL QAYDA 2: Xətt statusu ANCAQ VƏ ANCAQ "A" sütunundan götürülür!
            const aStr = String(r.A ?? "").trim() || String(nextR.A ?? "").trim();
            const status = parseStatusFromColA(aStr);
            if (!status || status === "__cancelled__") continue;

            const planM = parsePmoNum(r[cableCol]) || parsePmoNum(r.I) || parsePmoNum(r.U);
            const doneM = parsePmoNum(nextR[cableCol]) || parsePmoNum(nextR.I) || parsePmoNum(nextR.U);

            const foSources = [magHit?.text, magHit?.nextColText, r.H, r.G, r.P, dVal, r.F, r.I, r.E, nextR.H, nextR.G, nextR.P]
                .map(v => String(v ?? "").trim())
                .filter(Boolean);
            let fiber = "";
            for (const src of foSources) {
                const m1 = src.match(/FO[\s\-]*(\d+)/i);
                if (m1) { fiber = `FO ${m1[1]}`; break; }
                const m2 = src.match(/\b(\d{1,3})\s*(?:lif|fo\b|f\b)/i);
                if (m2) { fiber = `FO ${m2[1]}`; break; }
                const m3 = src.match(/magistral[^\d]{0,12}(\d{1,3})\b/i);
                if (m3) { fiber = `FO ${m3[1]}`; break; }
            }
            if (!fiber && magHit) {
                const mPlain = `${magHit.text} ${magHit.nextColText}`.match(/\(?\b(4|8|12|16|24|36|48|72|96|144|288)\b\)?/);
                if (mPlain) fiber = `FO ${mPlain[1]}`;
            }
            if (!fiber) {
                fiber = sheetHeaderFiber || (isPureMagSheet ? "FO 48" : "FO 12");
            }

            const contractor = isPureMagSheet
                ? (cleanExecName(r.H) || cleanExecName(nextR.H) || cleanExecName(r.K) || cleanExecName(nextR.K))
                : (cleanExecName(r.K) || cleanExecName(nextR.K));
            const rawDate = isPureMagSheet ? (nextR.H || r.H || nextR.K || r.K) : (nextR.K || r.K);
            const endDate = parseExcelDate(rawDate);

            const parts = dVal.split(/\s*(?:[-–—]|->|→)\s*/).filter(Boolean);
            const pointA = (parts[0] || dVal).trim();
            const pointB = parts.slice(1).join(" - ").trim();
            const magIdx = magistrals.length + 1;
            const magId = (sheetId === "11")
                ? `mag_93_${magIdx}`
                : `mag_${String(sheetId).replace(/\./g, "_")}_${magIdx}`;

            let coords = MAGISTRAL_PRESET_COORDS[magId] || null;
            if (!coords) {
                const cA = findKnownAzRayonCoord(pointA) || parseCoordStr(r.C);
                const cB = findKnownAzRayonCoord(pointB);
                if (cA && cB) {
                    coords = [cA, cB];
                } else if (cA) {
                    coords = [cA, [Number((cA[0] + 0.045).toFixed(6)), Number((cA[1] + 0.065).toFixed(6))]];
                } else if (cB) {
                    coords = [[Number((cB[0] + 0.035).toFixed(6)), Number((cB[1] + 0.045).toFixed(6))], cB];
                } else {
                    const sheetTitle = String(rows[0]?.A || rows[0]?.B || "").trim();
                    const titleCoord = findKnownAzRayonCoord(sheetTitle);
                    const ptCoords = points.filter(pt => Array.isArray(pt.coords) && pt.coords.length === 2).map(pt => pt.coords);
                    let basePt = titleCoord;
                    if (!basePt && ptCoords.length > 0) {
                        const avgLat = ptCoords.reduce((s, c) => s + c[0], 0) / ptCoords.length;
                        const avgLng = ptCoords.reduce((s, c) => s + c[1], 0) / ptCoords.length;
                        basePt = [Number(avgLat.toFixed(6)), Number(avgLng.toFixed(6))];
                    }
                    if (basePt) {
                        coords = [
                            [Number((basePt[0] - 0.025).toFixed(6)), Number((basePt[1] - 0.038).toFixed(6))],
                            basePt,
                            [Number((basePt[0] + 0.025).toFixed(6)), Number((basePt[1] + 0.038).toFixed(6))]
                        ];
                    } else {
                        const fbA = lookupAzRayonCoord(pointA || dVal, magIdx);
                        const fbB = lookupAzRayonCoord(pointB || `${dVal}_b`, magIdx + 1);
                        coords = [fbA, fbB];
                    }
                }
            }

            magistrals.push({
                id: magId,
                name: dVal,
                pointA,
                pointB,
                fiber,
                fiberCount: fiber,
                status,
                statusEmoji: aStr || (status === "bitmis" ? "🟢" : (status === "icrada" ? "🟡" : "🔴")),
                planM,
                doneM,
                totalKm: Math.round(planM / 1000),
                doneKm: Math.round(doneM / 1000),
                contractor,
                endDate,
                isMagistral: true,
                coords
            });
        }
        if (sheetId === "11" && magistrals.length === 0 && Array.isArray(window.PMO_SEED_PROJECTS)) {
            const spProj = window.PMO_SEED_PROJECTS.find(p => p.sheetId === "11");
            if (spProj) {
                const fallbackMags = spProj.items.filter(it => it.isMagistral);
                magistrals.push(...fallbackMags);
            }
        }

        // 4. Təmir - Bərpa xidməti (Vərəq 15.3): I = Regional mərkəz (RM), J = Regional rəhbər, K = Rayon, G = Nöqtə sayı
        const temirRows = [];
        if (sheetId === "15.3") {
            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                const aStr = String(r.A ?? "").trim();
                const colI = String(r.I ?? "").trim(); // Regional mərkəz (RM)
                const colJ = cleanExecName(r.J);       // Regional rəhbər
                const colK = String(r.K ?? "").trim(); // Rayon
                if (!colI || /^(?:\d+\s+)?(?:regional\s*m[əe]rk[əe]z|rm|layih[əe]|[iı]cra\s*olunan)$/i.test(colI)) continue;
                if (/^(?:\d+\s+)?(?:rayon|layih[əe]|[iı]cra\s*olunan)$/i.test(colK)) continue;

                // QIZIL QAYDA 2: Status ANCAQ VƏ ANCAQ "A" sütunundan götürülür (L və ya başqa sütundan yox!)
                const st = parseStatusFromColA(aStr);
                if (!st || st === "__cancelled__") continue;

                const ptCount = Math.max(1, parsePmoNum(r.G) || 1);
                temirRows.push({
                    id: `pmo_15_3_r${r.__rowNum__ ?? (i + 1)}`,
                    rmName: colI,
                    regLead: colJ,
                    rayon: colK,
                    ptCount,
                    status: st,
                    coords: parseCoordStr(r.C)
                });
            }
        }

        return { cablePlanM, cableDoneM, points, magistrals, temirRows, sheetMissing: false, foundCableCol, missingColARows };
    }

    function applyStructuredPmoWorkbook(wb, silent = false) {
        const d1Name = wb.SheetNames.find(n => /^d\s*1$/i.test(n.trim()));
        const d2Name = wb.SheetNames.find(n => /^d\s*2$/i.test(n.trim()));
        if (!d1Name || !d2Name) return { updated: 0, added: 0 };

        const d1Rows = getSheetARows(wb, d1Name);
        const d2Rows = getSheetARows(wb, d2Name);

        // 1. D1-dən layihələri oxu (sol panel — 🏢 BCG qovluğu üçün)
        const findSeedSheetIdByTitle = title => {
            if (!title || !Array.isArray(window.PMO_SEED_PROJECTS)) return "";
            const nk = normMatchName(title);
            if (!nk) return "";
            const m = window.PMO_SEED_PROJECTS.find(p => normMatchName(p.name) === nk);
            return m?.sheetId ? String(m.sheetId) : "";
        };
        const projectsMap = new Map();
        const stdErrorQueue = [];
        for (const r of d1Rows) {
            let sid = normSheetId(r.A);
            const rawName = String(r.B ?? "").trim();
            if (!rawName) continue;
            if (!sid) {
                const recoveredSid = findSeedSheetIdByTitle(rawName);
                if (recoveredSid) sid = recoveredSid;
            }
            if (!sid) {
                // D1-də layihə adı və plan/faiz yazılıb, amma A sütununda standart nömrə yoxdursa xəta kimi qeyd et
                const isHdrOrTotal = /^(?:#|№|layih[əe]|c[əe]mi|[üu]mumi|m[öo]vcud|yeni|status|rayon|region|pmo|bcg|avicom|d1|d2|icra)/i.test(rawName);
                const hasProjectData = (parsePmoNum(r.F) > 0 || /%/.test(String(r.D || "")));
                if (!isHdrOrTotal && hasProjectData && rawName.length >= 3) {
                    stdErrorQueue.push({
                        dedupeKey: `err_std_d1_noid_${normMatchName(rawName)}`,
                        type: "error",
                        title: "Standarta uyğun deyil — Layihə nömrəsi yoxdur",
                        detail: `D1 (${rawName}): 'A' sütununda standart layihə/vərəq nömrəsi qeyd olunmayıb`
                    });
                }
                continue;
            }
            const name = cleanProjectName(rawName, sid);

            const hasExplicitDPct = /\d/.test(String(r.D || ""));
            let overallPct = parsePmoPct(r.D);
            if (!hasExplicitDPct && r.C && (r.C.includes("%") || /^\d+$/.test(r.C.trim()))) overallPct = parsePmoPct(r.C);
            if (!hasExplicitDPct && !overallPct && r.E && (r.E.includes("%") || /^\d+$/.test(r.E.trim()))) overallPct = parsePmoPct(r.E);
            if (!hasExplicitDPct && (/bitmi|tamam/i.test(String(r.C || "")) || /bitmi|tamam/i.test(String(r.D || "")) || /🟢/.test(String(r.A || "") + String(r.B || "") + String(r.C || "")))) overallPct = 100;
            const totalPlan = parsePmoNum(r.F);
            const totalDone = parsePmoNum(r.G);
            if (!hasExplicitDPct && totalPlan > 0 && totalDone >= totalPlan) overallPct = 100;

            const bcgPlan = parsePmoNum(r.K);
            const bcgDone = parsePmoNum(r.L);
            let bcgPct = parsePmoPct(r.M);
            if (!bcgPct && bcgPlan > 0 && bcgDone >= bcgPlan) bcgPct = 100;

            const avicomPlan = totalPlan || parsePmoNum(r.N) || parsePmoNum(r.F);
            const avicomDone = parsePmoNum(r.O);
            let avicomPct = parsePmoPct(r.Q);
            if (!avicomPct && avicomPlan > 0 && avicomDone >= avicomPlan) avicomPct = 100;

            if (!hasExplicitDPct && overallPct === 0 && (bcgPct >= 100 || (totalPlan > 0 && totalDone >= totalPlan))) overallPct = 100;

            const conn = {
                fo: parsePmoNum(r.S),
                g3: parsePmoNum(r.T),
                ant: parsePmoNum(r.U),
                gpon: parsePmoNum(r.V)
            };
            projectsMap.set(sid, {
                sheetId: sid,
                name,
                overallPct,
                totalPlan,
                totalDone,
                bcgPlan,
                bcgDone,
                bcgPct,
                avicomPlan,
                avicomDone,
                avicomPct,
                conn,
                cablePlanM: 0,
                cableDoneM: 0,
                rayons: []
            });
        }

        // 2. D2-dən hər layihənin rayon sətirlərini oxu (xəritə nöqtələri üçün)
        let currentD2Sid = "";
        for (const r of d2Rows) {
            let rawSid = normSheetId(r.A);
            const rawB = String(r.B ?? "").trim();
            const rayonName = String(r.C ?? "").trim();
            // Google GViz rəqəmli "A" sütununda 2 nöqtəli mətn ID-ləri (məs: "15.1.1") boş (null) qaytara bilir — B sütunundan layihəni tanı!
            if (!rawSid && rawB && !rayonName) {
                const isHdrOrTotal = /^(?:#|№|layih[əe]\s*ad|c[əe]mi|[üu]mumi|status|rayon|region|pmo|bcg|avicom|d1|d2|icra)/i.test(rawB);
                const curProj = currentD2Sid ? projectsMap.get(currentD2Sid) : null;
                const sameAsCur = curProj && normMatchName(curProj.name) === normMatchName(rawB);
                if (!isHdrOrTotal && !sameAsCur) {
                    const seedSid = findSeedSheetIdByTitle(rawB);
                    if (seedSid) {
                        rawSid = seedSid;
                    } else if (currentD2Sid && (parsePmoNum(r.F) > 0 || parsePmoNum(r.G) > 0 || /%/.test(String(r.D || "")))) {
                        let subIdx = 1;
                        let candidate = `${currentD2Sid}.${subIdx}`;
                        while (projectsMap.has(candidate)) { subIdx++; candidate = `${currentD2Sid}.${subIdx}`; }
                        rawSid = candidate;
                    }
                }
            }
            if (rawSid) currentD2Sid = rawSid;
            const sid = rawSid || currentD2Sid;
            if (!sid) continue;
            const projTitle = cleanProjectName(rawB, sid);
            if (projTitle && !rayonName) {
                if (!projectsMap.has(sid)) {
                    // D2-də olub D1-də olmayan nömrələnmiş layihə (məs: 15.1)
                    const totalPlan = parsePmoNum(r.F);
                    const totalDone = parsePmoNum(r.G);
                    let overallPct = r.D ? parsePmoPct(r.D) : (totalPlan > 0 ? Math.round((totalDone / totalPlan) * 100) : 0);
                    if (!overallPct && r.C && r.C.includes("%")) overallPct = parsePmoPct(r.C);
                    if (!overallPct && r.E && r.E.includes("%")) overallPct = parsePmoPct(r.E);
                    if (/bitmi|tamam/i.test(String(r.D || "")) || /🟢/.test(String(r.A || "") + String(r.B || "") + String(r.D || ""))) overallPct = 100;
                    if (totalPlan > 0 && totalDone >= totalPlan) overallPct = 100;

                    projectsMap.set(sid, {
                        sheetId: sid,
                        name: projTitle,
                        overallPct,
                        totalPlan,
                        totalDone,
                        bcgPlan: parsePmoNum(r.K),
                        bcgDone: parsePmoNum(r.L),
                        bcgPct: parsePmoPct(r.M),
                        avicomPlan: totalPlan,
                        avicomDone: parsePmoNum(r.O),
                        avicomPct: parsePmoPct(r.Q),
                        conn: { fo: parsePmoNum(r.S), g3: parsePmoNum(r.T), ant: parsePmoNum(r.U), gpon: parsePmoNum(r.V) },
                        cablePlanM: 0,
                        cableDoneM: 0,
                        rayons: []
                    });
                }
                continue;
            }
            if (!rayonName || !projectsMap.has(sid)) continue;
            if (/^magistral\b/i.test(rayonName)) continue; // Magistral kabel ümumi layihə altında göstərilir

            const totalPlan = parsePmoNum(r.F);
            const totalDone = parsePmoNum(r.G);
            const bcgPlan = parsePmoNum(r.K);
            const bcgDone = parsePmoNum(r.L);
            const bcgPct = parsePmoPct(r.M);
            const avicomPlan = totalPlan || bcgPlan;
            const avicomDone = parsePmoNum(r.O);
            const avicomPct = parsePmoPct(r.Q);
            let pct = r.D ? parsePmoPct(r.D) : (totalPlan > 0 ? Math.round((totalDone / totalPlan) * 100) : bcgPct);
            if (!pct && r.C && r.C.includes("%")) pct = parsePmoPct(r.C);
            if (!pct && r.E && r.E.includes("%")) pct = parsePmoPct(r.E);
            if (/bitmi|tamam/i.test(String(r.D || "")) || /🟢/.test(String(r.A || "") + String(r.B || "") + String(r.D || ""))) pct = 100;
            if (totalPlan > 0 && totalDone >= totalPlan) pct = 100;

            const conn = {
                fo: parsePmoNum(r.S),
                g3: parsePmoNum(r.T),
                ant: parsePmoNum(r.U),
                gpon: parsePmoNum(r.V)
            };
            projectsMap.get(sid).rayons.push({
                name: rayonName,
                pct,
                totalPlan,
                totalDone,
                bcgPlan,
                bcgDone,
                bcgPct,
                avicomPlan,
                avicomDone,
                avicomPct,
                conn,
                d2Cols: {
                    I: String(r.I ?? "").trim(),
                    J: String(r.J ?? "").trim(),
                    K: String(r.K ?? "").trim()
                },
                subPoints: []
            });
        }

        // 3. Hər layihənin nömrələnmiş vərəqindən alt-nöqtələri (koordinat, A rəngi, TŞ nömrəsi, Dirək, İcraçı, Qoşulma) və CT kabel məsafəsini oxu
        const parsedProjects = [];
        const currentPointStates = {};
        const currentProjectIds = [];
        let completedSnapshot = [];

        const summarizeColValues = (vals) => {
            const clean = vals.map(v => String(v ?? "").trim()).filter(v => v && v !== "-" && v !== "—" && v !== "0");
            if (clean.length === 0) return "—";
            const allNums = clean.every(v => /^-?\d+(?:[.,]\d+)?%?$/.test(v));
            if (allNums && clean.length > 1) {
                const isPct = clean.some(v => v.includes("%"));
                if (isPct) return clean[0];
                const sum = clean.reduce((acc, v) => acc + parsePmoNum(v), 0);
                return sum.toLocaleString("az-AZ");
            }
            const uniq = [...new Set(clean)];
            return uniq.slice(0, 5).join(", ");
        };

        for (const pData of projectsMap.values()) {
            const detail = parseNumberedPmoSheet(wb, pData.sheetId);
            pData.cablePlanM = detail.cablePlanM;
            pData.cableDoneM = detail.cableDoneM;

            // Xüsusi emal: 15.3 Təmir - Bərpa xidməti (RM poliqon mərkəzləri: RM üzrə nöqtə sayı, Regional rəhbər (J), klikləyəndə Rayonlar (K) üzrə xəritədə paylanma)
            if (pData.sheetId === "15.3") {
                const rmByNormKey = new Map();
                pData.rayons.forEach(ry => {
                    const rk = normalizeRmKey(ry.name) || normMatchName(ry.name);
                    rmByNormKey.set(rk, ry);
                    ry._temirList = [];
                });

                (detail.temirRows || []).forEach(tr => {
                    const rk = normalizeRmKey(tr.rmName) || normalizeRmKey(resolveRmForRayon(tr.rayon, tr.rmName));
                    const targetRm = rk ? rmByNormKey.get(rk) : null;
                    if (targetRm) {
                        targetRm._temirList.push(tr);
                    }
                });

                pData.rayons.forEach(ry => {
                    const list = ry._temirList || [];
                    const regLeads = [...new Set(list.map(x => x.regLead).filter(Boolean))];
                    const regLead = regLeads.join(", ") || "—";

                    // K sütununda qeyd olunmuş rayonlar üzrə qruplaşdır
                    const rayonMap = new Map();
                    let sumTotal = 0;
                    let sumDone = 0;
                    list.forEach(tr => {
                        const c = Math.max(1, Number(tr.ptCount) || 1);
                        sumTotal += c;
                        if (tr.status === "bitmis") sumDone += c;
                        const rName = String(tr.rayon || "").trim();
                        if (!rName) return;
                        const rKey = normMatchName(rName);
                        if (!rayonMap.has(rKey)) {
                            rayonMap.set(rKey, {
                                name: rName,
                                count: 0,
                                doneCount: 0,
                                layiheCount: 0,
                                icradaCount: 0
                            });
                        }
                        const grp = rayonMap.get(rKey);
                        grp.count += c;
                        if (tr.status === "bitmis") grp.doneCount += c;
                        else if (tr.status === "layihe") grp.layiheCount += c;
                        else grp.icradaCount += c;
                    });

                    const rayonBreakdown = [...rayonMap.values()].sort((a, b) => b.count - a.count);
                    const rmCenter = findRmPolygonCentroid(ry.name) || findKnownAzRayonCoord(ry.name) || [40.3, 47.5];

                    let subPts = rayonBreakdown.map((grp, idx) => {
                        const baseCoord = findKnownAzRayonCoord(grp.name);
                        let coords = baseCoord ? [baseCoord[0], baseCoord[1]] : null;
                        if (!coords) {
                            const angle = (idx * 2 * Math.PI) / Math.max(1, rayonBreakdown.length);
                            coords = [rmCenter[0] + Math.sin(angle) * 0.11, rmCenter[1] + Math.cos(angle) * 0.14];
                        }
                        const st = grp.doneCount === grp.count
                            ? "bitmis"
                            : (grp.doneCount === 0 && grp.layiheCount === grp.count ? "layihe" : "icrada");
                        const pct = grp.count > 0 ? Math.round((grp.doneCount / grp.count) * 100) : ry.pct;
                        const labelText = `${grp.name} (${grp.count} nöqtə)`;
                        return {
                            id: `pmo_15_3_${normMatchName(ry.name)}_${normMatchName(grp.name)}_${idx + 1}`,
                            idx: idx + 1,
                            isTemirRayon: true,
                            tsNo: labelText,
                            name: labelText,
                            rayon: grp.name,
                            rmName: ry.name,
                            regLead,
                            totalCount: grp.count,
                            doneCount: grp.doneCount,
                            status: st,
                            pct,
                            coords
                        };
                    });

                    let finalRegLead = regLead;
                    let finalBreakdown = rayonBreakdown;
                    if ((finalRegLead === "—" || finalBreakdown.length === 0) && Array.isArray(window.PMO_SEED_PROJECTS)) {
                        const seedP153 = window.PMO_SEED_PROJECTS.find(p => p.sheetId === "15.3");
                        const rk = normalizeRmKey(ry.name) || normMatchName(ry.name);
                        const seedIt = seedP153?.items?.find(it => (normalizeRmKey(it.name) || normMatchName(it.name)) === rk);
                        const seedTm = seedIt?.pmoRayon?.temirMeta;
                        if (seedTm) {
                            if (finalRegLead === "—" && seedTm.regLead) finalRegLead = seedTm.regLead;
                            if (finalBreakdown.length === 0 && Array.isArray(seedTm.rayonBreakdown)) finalBreakdown = seedTm.rayonBreakdown;
                            if (subPts.length === 0 && Array.isArray(seedIt.pmoRayon?.subPoints)) subPts = seedIt.pmoRayon.subPoints;
                        }
                    }

                    const totalCount = ry.totalPlan > 0 ? ry.totalPlan : sumTotal;
                    const doneCount = ry.totalPlan > 0 ? ry.totalDone : sumDone;

                    ry.subPoints = subPts;
                    ry.temirMeta = {
                        isTemirRm: true,
                        totalCount,
                        doneCount,
                        regLead: finalRegLead,
                        rayonBreakdown: finalBreakdown
                    };
                });
            }

            // Xüsusi emal: 14 (Dəyişim 2026) — D2-də avadanlıq növləri əvəzinə "D" sütununa görə Rayonlar üzrə qruplaşdır, koordinatı olanları "G" adı ilə parçala
            if (pData.sheetId === "14") {
                const livePts = Array.isArray(detail.points) ? detail.points : [];
                if (livePts.length > 0) {
                    const rMap = new Map();
                    livePts.forEach(sp => {
                        const rName = sp.rayon || resolveDeyisimRayon(sp.address, sp.tsNo, sp.coords);
                        const rKey = normMatchName(rName);
                        if (!rMap.has(rKey)) {
                            rMap.set(rKey, {
                                name: rName,
                                pct: 0,
                                totalPlan: 0,
                                totalDone: 0,
                                bcgPlan: 0,
                                bcgDone: 0,
                                bcgPct: 0,
                                avicomPlan: 0,
                                avicomDone: 0,
                                avicomPct: 0,
                                conn: { fo: 0, g3: 0, ant: 0, gpon: 0 },
                                _allCount: 0,
                                _doneCount: 0,
                                _layiheCount: 0,
                                subPoints: []
                            });
                        }
                        const ry = rMap.get(rKey);
                        ry.totalPlan += 1;
                        ry._allCount += 1;
                        if (sp.status === "bitmis") { ry.totalDone += 1; ry._doneCount += 1; }
                        else if (sp.status === "layihe") { ry._layiheCount += 1; }
                        if (sp.bcgExec) {
                            ry.bcgPlan += 1;
                            if (sp.status === "bitmis") ry.bcgDone += 1;
                        }
                        if (sp.avicomExec) {
                            ry.avicomPlan += 1;
                            if (sp.status === "bitmis") ry.avicomDone += 1;
                        }
                        const ct = String(sp.connType || "").toUpperCase();
                        if (ct.includes("FO")) ry.conn.fo += 1;
                        else if (ct.includes("3G")) ry.conn.g3 += 1;
                        else if (ct.includes("ANT")) ry.conn.ant += 1;
                        else if (ct.includes("GPON")) ry.conn.gpon += 1;
                        // Yalnız koordinatı ("C" sütunu) olan nöqtələr parçalananda xəritəyə çıxsın
                        if (Array.isArray(sp.coords) && sp.coords.length === 2) {
                            ry.subPoints.push({ ...sp, rayon: rName });
                        }
                    });
                    pData.rayons = [...rMap.values()]
                        .map(ry => {
                            ry.pct = ry.totalPlan > 0 ? Math.round((ry.totalDone / ry.totalPlan) * 100) : 0;
                            ry.bcgPct = ry.bcgPlan > 0 ? Math.round((ry.bcgDone / ry.bcgPlan) * 100) : 0;
                            ry.avicomPct = ry.avicomPlan > 0 ? Math.round((ry.avicomDone / ry.avicomPlan) * 100) : 0;
                            return ry;
                        })
                        .sort((a, b) => b.totalPlan - a.totalPlan);
                } else if (Array.isArray(window.PMO_SEED_PROJECTS)) {
                    const seed14 = window.PMO_SEED_PROJECTS.find(p => p.sheetId === "14");
                    if (seed14 && Array.isArray(seed14.items) && seed14.items.length > 0) {
                        pData.rayons = seed14.items.map(it => ({
                            name: it.name,
                            pct: it.pmoRayon?.pct || 0,
                            totalPlan: it.pmoRayon?.totalPlan || 0,
                            totalDone: it.pmoRayon?.totalDone || 0,
                            bcgPlan: it.pmoRayon?.bcgPlan || 0,
                            bcgDone: it.pmoRayon?.bcgDone || 0,
                            bcgPct: it.pmoRayon?.bcgPct || 0,
                            avicomPlan: it.pmoRayon?.avicomPlan || 0,
                            avicomDone: it.pmoRayon?.avicomDone || 0,
                            avicomPct: it.pmoRayon?.avicomPct || 0,
                            conn: it.pmoRayon?.conn || { fo: 0, g3: 0, ant: 0, gpon: 0 },
                            subPoints: it.pmoRayon?.subPoints || []
                        }));
                    }
                }
            }

            // Alt-nöqtələri rayonlara uyğunlaşdır
            const rayonByNorm = new Map();
            pData.rayons.forEach(ry => {
                rayonByNorm.set(normMatchName(ry.name), ry);
            });

            if (pData.sheetId !== "15.3" && pData.sheetId !== "14") detail.points.forEach(sp => {
                const ptKey = `${pData.sheetId}::${sp.id}`;
                currentPointStates[ptKey] = sp.status;
                if (sp.status === "bitmis") {
                    completedSnapshot.push({
                        key: ptKey,
                        sheetId: pData.sheetId,
                        projName: pData.name,
                        rayon: sp.rayon || "Ümumi",
                        tsNo: sp.tsNo,
                        subId: sp.id
                    });
                }

                const spRayNorm = normMatchName(sp.rayon);
                let targetRy = spRayNorm ? rayonByNorm.get(spRayNorm) : null;
                if (!targetRy && spRayNorm) {
                    for (const [k, ry] of rayonByNorm.entries()) {
                        if (k && (k.includes(spRayNorm) || spRayNorm.includes(k))) {
                            targetRy = ry;
                            break;
                        }
                    }
                }
                if (!targetRy && (sp.rayon || sp.coords)) {
                    // D2-də filtr/gizlətmə səbəbindən görünməyən rayonları nömrəli vərəqin öz nöqtələrindən avtomatik yarat
                    const inferredRayon = (sp.rayon && !/^magistral/i.test(sp.rayon))
                        ? sp.rayon.trim()
                        : (sp.address.match(/^([A-ZƏÖÜÇŞĞİ][a-zəöüçşğı]+)\s+rayon/i)?.[1] || pData.name).trim();
                    const arNorm = normMatchName(inferredRayon);
                    if (arNorm && !rayonByNorm.has(arNorm)) {
                        const newRy = {
                            name: inferredRayon,
                            pct: 0,
                            totalPlan: 0,
                            totalDone: 0,
                            bcgPlan: 0,
                            bcgDone: 0,
                            bcgPct: 0,
                            avicomPlan: 0,
                            avicomDone: 0,
                            avicomPct: 0,
                            conn: { fo: 0, g3: 0, ant: 0, gpon: 0 },
                            subPoints: [],
                            _autoBuilt: true
                        };
                        pData.rayons.push(newRy);
                        rayonByNorm.set(arNorm, newRy);
                    }
                    targetRy = arNorm ? rayonByNorm.get(arNorm) : null;
                }
                if (targetRy && targetRy._autoBuilt) {
                    targetRy.totalPlan += 1;
                    targetRy.bcgPlan += 1;
                    targetRy.avicomPlan += 1;
                    if (sp.status === "bitmis") {
                        targetRy.totalDone += 1;
                        targetRy.bcgDone += 1;
                        targetRy.avicomDone += 1;
                    } else if (sp.status === "icrada") {
                        targetRy.bcgDone += 1;
                    }
                    const ct = String(sp.connType || "").toUpperCase();
                    if (ct.includes("FO")) targetRy.conn.fo += 1;
                    else if (ct.includes("3G")) targetRy.conn.g3 += 1;
                    else if (ct.includes("ANT")) targetRy.conn.ant += 1;
                    else if (ct.includes("GPON")) targetRy.conn.gpon += 1;
                    targetRy.pct = targetRy.totalPlan > 0 ? Math.round((targetRy.totalDone / targetRy.totalPlan) * 100) : 0;
                    targetRy.bcgPct = targetRy.bcgPlan > 0 ? Math.round((targetRy.bcgDone / targetRy.bcgPlan) * 100) : 0;
                    targetRy.avicomPct = targetRy.avicomPlan > 0 ? Math.round((targetRy.avicomDone / targetRy.avicomPlan) * 100) : 0;
                }
                if (targetRy) {
                    targetRy.subPoints.push(sp);
                }
            });

            // Hash yoxlaması və layihə obyektini yaratma
            const projId = `pmo_sheet_${pData.sheetId.replace(/\./g, "_")}`;
            currentProjectIds.push(projId);
            const projStatus = pData.overallPct >= 100 ? "bitmis" : (pData.overallPct > 0 ? "icrada" : "layihe");

            let items = pData.rayons.map((ry, rIdx) => {
                const validSubCoords = ry.subPoints.filter(sp => Array.isArray(sp.coords) && sp.coords.length === 2).map(sp => sp.coords);
                let centerCoord = (pData.sheetId === "15.3")
                    ? findRmPolygonCentroid(ry.name)
                    : findKnownAzRayonCoord(ry.name);
                if (!centerCoord) {
                    if (validSubCoords.length > 0) {
                        const avgLat = validSubCoords.reduce((s, c) => s + c[0], 0) / validSubCoords.length;
                        const avgLng = validSubCoords.reduce((s, c) => s + c[1], 0) / validSubCoords.length;
                        centerCoord = [Number(avgLat.toFixed(6)), Number(avgLng.toFixed(6))];
                    } else {
                        centerCoord = lookupAzRayonCoord(ry.name, rIdx);
                    }
                }
                // Rayon statusunu da alt-nöqtələrin "A" sütunundakı statusuna görə təyin et (bütün layihələr üzrə vahid qayda)
                let ryStatus = ry.pct >= 100 ? "bitmis" : (ry.pct > 0 ? "icrada" : "layihe");
                if (ry._allCount > 0) {
                    ryStatus = ry._doneCount === ry._allCount
                        ? "bitmis"
                        : (ry._layiheCount === ry._allCount ? "layihe" : "icrada");
                } else if (Array.isArray(ry.subPoints) && ry.subPoints.length > 0) {
                    const allDone = ry.subPoints.every(sp => sp.status === "bitmis");
                    const anyActive = ry.subPoints.some(sp => sp.status === "bitmis" || sp.status === "icrada");
                    ryStatus = allDone ? "bitmis" : (anyActive ? "icrada" : "layihe");
                }
                return {
                    id: `pmo_${pData.sheetId}_ry_${rIdx + 1}`,
                    name: ry.name,
                    rayon: ry.name,
                    isPmoRayon: true,
                    pmoRayon: {
                        pct: ry.pct,
                        totalPlan: ry.totalPlan || ry.subPoints.length,
                        totalDone: ry.totalDone,
                        bcgPlan: ry.bcgPlan,
                        bcgDone: ry.bcgDone,
                        bcgPct: ry.bcgPct,
                        avicomPlan: ry.avicomPlan,
                        avicomDone: ry.avicomDone,
                        avicomPct: ry.avicomPct,
                        conn: ry.conn,
                        temirMeta: ry.temirMeta || undefined,
                        subPoints: ry.subPoints
                    },
                    status: ryStatus,
                    totalKm: ry.totalPlan || 0,
                    doneKm: ry.totalDone || 0,
                    antennas: ry.totalPlan || ry.subPoints.length || 1,
                    summary: true,
                    coords: [centerCoord]
                };
            });

            if (Array.isArray(detail.magistrals) && detail.magistrals.length > 0) {
                // Əgər vərəqdəki bütün sətirlər magistraldırsa (məs: 15.2 Layihəsiz Magistral), boş rayon nöqtələrini deyil, birbaşa magistral xətlərini göstər
                if (detail.points.length === 0) {
                    items = [...detail.magistrals];
                } else {
                    items.push(...detail.magistrals);
                }
            }

            const cleanName = cleanProjectName(pData.name, pData.sheetId);

            // Standart uyğunluq yoxlaması: bizim BCG PMO standartlarına uyğun gəlməyən layihələri Xəta bildirişinə yaz
            const isSpecialTemir = String(pData.sheetId) === "15.3";
            const isSpecial1511 = String(pData.sheetId) === "15.1.1";
            if (detail.sheetMissing && items.length === 0) {
                stdErrorQueue.push({
                    dedupeKey: `err_std_nosheet_${pData.sheetId}`,
                    type: "error",
                    title: "Standarta uyğun deyil — Vərəq yoxdur",
                    detail: `Vərəq ${pData.sheetId} (${cleanName}): D1-də qeyd olunub, amma standart nömrəli vərəqi tapılmadı və xəritə məlumatı boşdur`,
                    projectId: projId
                });
            } else if (!detail.sheetMissing && !isSpecialTemir && !isSpecial1511) {
                if (items.length === 0) {
                    stdErrorQueue.push({
                        dedupeKey: `err_std_empty_${pData.sheetId}`,
                        type: "error",
                        title: "Standarta uyğun deyil — Xəritə məlumatı yoxdur",
                        detail: `Vərəq ${pData.sheetId} (${cleanName}): Nə D2-də rayon bölgüsü, nə də vərəqdə standart A-sütunu / koordinatlı nöqtə tapılmadı`,
                        projectId: projId
                    });
                } else if (detail.missingColARows > 0) {
                    stdErrorQueue.push({
                        dedupeKey: `err_std_cola_${pData.sheetId}_${detail.missingColARows}`,
                        type: "error",
                        title: "Standart xətası — A sütununda status yoxdur",
                        detail: `Vərəq ${pData.sheetId} (${cleanName}): ${detail.missingColARows} sətirdə 'A' sütununda status dairəsi (🟢/🟡/🔴) qoyulmayıb`,
                        projectId: projId
                    });
                }
                if (!detail.foundCableCol && (detail.points.length > 0 || detail.magistrals.length > 0)) {
                    stdErrorQueue.push({
                        dedupeKey: `err_std_cablecol_${pData.sheetId}`,
                        type: "error",
                        title: "Standart xətası — Kabel sütunu tapılmadı",
                        detail: `Vərəq ${pData.sheetId} (${cleanName}): Başlıqlarda 'FO kabelin çəkilməsi' standart sütunu tapılmadı`,
                        projectId: projId
                    });
                }
            }

            parsedProjects.push({
                id: projId,
                sheetId: pData.sheetId,
                name: cleanName,
                category: "project",
                type: "points",
                status: projStatus,
                isPmo: true,
                pmoMeta: {
                    sheetId: pData.sheetId,
                    overallPct: pData.overallPct,
                    totalPlan: pData.totalPlan,
                    totalDone: pData.totalDone,
                    bcgPlan: pData.bcgPlan,
                    bcgDone: pData.bcgDone,
                    bcgPct: pData.bcgPct,
                    avicomPlan: pData.avicomPlan,
                    avicomDone: pData.avicomDone,
                    avicomPct: pData.avicomPct,
                    conn: pData.conn,
                    cablePlanM: pData.cablePlanM,
                    cableDoneM: pData.cableDoneM,
                    magistralCount: detail.magistrals ? detail.magistrals.length : 0
                },
                items
            });
        }

        // Standarta uyğun gəlməyən layihə xətalarını bildiriş siyahısına əlavə et (təkrarsız, qırmızı sayğacla)
        if (stdErrorQueue.length > 0) {
            let newErrAdded = 0;
            stdErrorQueue.forEach(errItem => {
                if (pushPmoNotif(errItem, false)) newErrAdded++;
            });
            if (newErrAdded > 0 && !silent) {
                toast(`⚠️ ${newErrAdded} layihədə standart uyğunsuzluğu aşkarlandı — yuxarıdakı Bildirişlər bölməsinə baxın`, true);
            }
        }

        // Dəyişiklik olub-olmadığını yoxla: bütün sətirlərin bütün sahələri (ad, lif sayı, status, ünvan, məsafə, icraçı və s.) tam müqayisə olunur
        const newHash = JSON.stringify(parsedProjects);
        const stateAlreadyHasAllLivePmo = parsedProjects.length > 0 && parsedProjects.every(np => {
            const cur = (state.projects || []).find(p => p.id === np.id && p.isPmo);
            return cur && Array.isArray(cur.items) && cur.items.length === np.items.length;
        });
        if (silent && newHash === pmoLastContentHash && stateAlreadyHasAllLivePmo) {
            return { updated: 0, added: 0, unchanged: true };
        }
        pmoLastContentHash = newHash;

        // 4. Bildirişləri yoxla: 100% (yaşıl 🟢) olan nöqtələr və yeni layihələr
        const known = readStore(PMO_KNOWN_KEY, null);
        const isFirstSync = !known || !known.seeded;
        const prevProjects = new Set(Array.isArray(known?.projects) ? known.projects : []);
        const prevPoints = (known && typeof known.points === "object") ? known.points : {};

        if (isFirstSync) {
            // İlk açılışda son bitmiş (100% 🟢) nöqtələrdən nümunə siyahı doldur (toast spamsız)
            const initialNotifs = loadPmoNotifs();
            if (initialNotifs.length === 0) {
                const seedList = completedSnapshot.slice(0, 25).map(c => {
                    const pObj = parsedProjects.find(p => p.sheetId === c.sheetId);
                    const ryItem = pObj?.items.find(it => (it.pmoRayon?.subPoints || []).some(sp => sp.id === c.subId));
                    return {
                        id: `seed_${c.key}`,
                        type: "completed",
                        title: "Nöqtə tamamlandı (100% 🟢)",
                        detail: `${c.tsNo} — ${c.rayon} (${c.projName})`,
                        projectId: pObj?.id || "",
                        itemId: ryItem?.id || "",
                        pmoSubId: c.subId,
                        time: "PMO Canlı",
                        unread: false
                    };
                });
                savePmoNotifs(seedList);
                renderPmoNotifsUI();
            }
        } else {
            // Yeni layihə əlavə olunubsa bildiriş çıxar
            const newProjects = parsedProjects.filter(p => !prevProjects.has(p.id));
            if (newProjects.length > 0) {
                if (newProjects.length <= 2) {
                    newProjects.forEach(p => {
                        pushPmoNotif({
                            type: "new_project",
                            title: "Yeni layihə əlavə olundu",
                            detail: p.name,
                            projectId: p.id
                        }, true);
                    });
                } else {
                    newProjects.forEach(p => {
                        pushPmoNotif({
                            type: "new_project",
                            title: "Yeni layihə əlavə olundu",
                            detail: p.name,
                            projectId: p.id
                        }, false);
                    });
                    toast(`🆕 ${newProjects.length} yeni layihə əlavə olundu`);
                }
            }

            // Hər hansı nöqtə 100% (yaşıl 🟢) olubsa bildiriş çıxar
            const newlyCompleted = completedSnapshot.filter(c => prevPoints[c.key] !== "bitmis");
            if (newlyCompleted.length > 0) {
                if (newlyCompleted.length <= 2) {
                    newlyCompleted.forEach(c => {
                        const pObj = parsedProjects.find(p => p.sheetId === c.sheetId);
                        const ryItem = pObj?.items.find(it => (it.pmoRayon?.subPoints || []).some(sp => sp.id === c.subId));
                        pushPmoNotif({
                            type: "completed",
                            title: "Nöqtə tamamlandı (100% 🟢)",
                            detail: `${c.tsNo} — ${c.rayon} (${c.projName})`,
                            projectId: pObj?.id || "",
                            itemId: ryItem?.id || "",
                            pmoSubId: c.subId
                        }, true);
                    });
                } else {
                    // 99+ bildiriş spamının qarşısını al: hamısını siyahıya yaz, amma ekranda yalnız 1 xülasə göstər
                    newlyCompleted.forEach(c => {
                        const pObj = parsedProjects.find(p => p.sheetId === c.sheetId);
                        const ryItem = pObj?.items.find(it => (it.pmoRayon?.subPoints || []).some(sp => sp.id === c.subId));
                        pushPmoNotif({
                            type: "completed",
                            title: "Nöqtə tamamlandı (100% 🟢)",
                            detail: `${c.tsNo} — ${c.rayon} (${c.projName})`,
                            projectId: pObj?.id || "",
                            itemId: ryItem?.id || "",
                            pmoSubId: c.subId
                        }, false);
                    });
                    toast(`✅ ${newlyCompleted.length} nöqtə 100% tamamlandı (🟢)`);
                }
            }
        }
        writeStore(PMO_KNOWN_KEY, { seeded: true, projects: currentProjectIds, points: currentPointStates });

        // 5. state.projects içinə yaz (köhnə demo layihələri sil, D1 PMO layihələrini yerləşdir)
        const LEGACY_DEMO_PROJECT_IDS = new Set(["proj_magistral", "proj_gpon_north", "proj_gpon_west", "proj_karabakh"]);
        state.projects = (state.projects || []).filter(p => p && !LEGACY_DEMO_PROJECT_IDS.has(p.id) && !(p.category === "project" && !p.isPmo && !String(p.id).startsWith("pmo_")));

        let updatedCount = 0;
        let addedCount = 0;
        const hiddenSet = getHiddenProjectIds();
        parsedProjects.forEach(np => {
            const idx = state.projects.findIndex(p => p.id === np.id);
            if (idx >= 0) {
                const prev = state.projects[idx];
                // Qismən / timeout olmuş Google Sheets sorğusu mövcud rayonları və alt-nöqtələri silməsin
                if (prev && Array.isArray(prev.items) && prev.items.length > 0) {
                    if (!Array.isArray(np.items) || np.items.length === 0) {
                        np.items = prev.items;
                    } else {
                        // Mövcud alt-nöqtələri qoruyub saxla (əgər nömrəli vərəq həmin 10 san sorğuda gecikibsə)
                        const prevByName = new Map(prev.items.map(it => [String(it.name || it.id).trim().toLowerCase(), it]));
                        np.items.forEach(it => {
                            if (it.isPmoRayon && it.pmoRayon) {
                                const oldIt = prevByName.get(String(it.name || it.id).trim().toLowerCase());
                                if ((!it.pmoRayon.subPoints || it.pmoRayon.subPoints.length === 0) && oldIt?.pmoRayon?.subPoints?.length > 0) {
                                    it.pmoRayon.subPoints = oldIt.pmoRayon.subPoints;
                                }
                                if (oldIt?.pmoRayon?.temirMeta && (!it.pmoRayon.temirMeta || it.pmoRayon.temirMeta.regLead === "—" || !it.pmoRayon.temirMeta.rayonBreakdown?.length)) {
                                    it.pmoRayon.temirMeta = {
                                        ...oldIt.pmoRayon.temirMeta,
                                        totalCount: it.pmoRayon.totalPlan || oldIt.pmoRayon.temirMeta.totalCount,
                                        doneCount: it.pmoRayon.totalDone ?? oldIt.pmoRayon.temirMeta.doneCount
                                    };
                                }
                            }
                        });
                        // D2-də filtr/gizlətmə/gecikmə səbəbindən bəzi rayonlar gəlməyibsə, mövcud rayonları HEÇ VAXT silmə!
                        const prevRayons = prev.items.filter(it => it.isPmoRayon && !it.isMagistral);
                        const newRayons = np.items.filter(it => it.isPmoRayon && !it.isMagistral);
                        const isPureMagistralProj = newRayons.length === 0 && np.items.some(it => it.isMagistral);
                        if (!isPureMagistralProj && prevRayons.length > 1 && newRayons.length < prevRayons.length) {
                            const newNormNames = new Set(newRayons.map(it => normMatchName(it.name || it.rayon)));
                            const missingRayons = prevRayons.filter(it => !newNormNames.has(normMatchName(it.name || it.rayon)));
                            if (missingRayons.length > 0) {
                                const projNorm = normMatchName(np.name);
                                np.items = np.items.filter(it => !(it.isPmoRayon && !it.isMagistral && normMatchName(it.name) === projNorm && newRayons.length === 1));
                                np.items.unshift(...missingRayons);
                            }
                        }
                        // Magistral xətlər gecikməyə görə düşməyibsə köhnələri saxla
                        const hasNewMags = np.items.some(it => it.isMagistral);
                        if (!hasNewMags) {
                            const oldMags = prev.items.filter(it => it.isMagistral);
                            if (oldMags.length > 0) np.items.push(...oldMags);
                        }
                    }
                }
                if (state.selected?.projectId === np.id && state.selected.itemId && !np.items.some(it => it.id === state.selected.itemId)) {
                    const oldSel = prev?.items?.find(it => it.id === state.selected.itemId);
                    if (oldSel) {
                        const oldNorm = normMatchName(oldSel.name || oldSel.rayon);
                        const matchedNew = np.items.find(it => normMatchName(it.name || it.rayon) === oldNorm);
                        if (matchedNew) state.selected.itemId = matchedNew.id;
                    }
                }
                state.projects[idx] = np;
                updatedCount++;
            } else {
                state.projects.push(np);
                if (!hiddenSet.has(np.id)) state.visibleIds.add(np.id);
                addedCount++;
            }
        });
        state.activeFolders.add("project");
        if (typeof applySavedGeomOverrides === "function") applySavedGeomOverrides();
        if (typeof window.savePmoLiveCache === "function") {
            window.savePmoLiveCache(state.projects.filter(p => p && p.isPmo));
        }

        renderAll();
        renderPmoNotifsUI();
        return { updated: updatedCount, added: addedCount };
    }

    async function ensureXLSX() {
        if (typeof XLSX !== "undefined") return window.XLSX;
        if (xlsxLoadingPromise) return xlsxLoadingPromise;
        xlsxLoadingPromise = new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
            s.async = true;
            s.onload = () => resolve(window.XLSX);
            s.onerror = () => {
                xlsxLoadingPromise = null;
                reject(new Error("XLSX kitabxanası yüklənə bilmədi"));
            };
            document.head.appendChild(s);
        });
        return xlsxLoadingPromise;
    }

    function parseCsvFallbackToWorkbook(text) {
        const sep = text.includes("\t") && !text.includes(";") ? "\t" : (text.split(";").length > text.split(",").length ? ";" : ",");
        const rows = text.split(/\r?\n/).filter(l => l.trim().length > 0).map(line => {
            const out = [];
            let cur = "", inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (ch === '"') {
                    inQuotes = !inQuotes;
                } else if (ch === sep && !inQuotes) {
                    out.push(cur.trim());
                    cur = "";
                } else {
                    cur += ch;
                }
            }
            out.push(cur.trim());
            return out;
        });
        return {
            SheetNames: ["PMO_Data"],
            Sheets: { PMO_Data: { _rawRows: rows } }
        };
    }

    function getSheet2DRows(wb, sheetName) {
        if (!wb || !sheetName || !wb.Sheets?.[sheetName]) return [];
        const sh = wb.Sheets[sheetName];
        if (Array.isArray(sh._rawRows)) return sh._rawRows;
        if (typeof XLSX !== "undefined" && XLSX.utils) {
            return XLSX.utils.sheet_to_json(sh, { header: 1, defval: "", raw: false });
        }
        return [];
    }

    function detectBestHeaderRow(rows2D) {
        let bestRow = 1;
        let maxNonEmptyText = 0;
        const limit = Math.min(10, rows2D.length);
        for (let r = 0; r < limit; r++) {
            const row = rows2D[r] || [];
            const score = row.filter(c => {
                const s = String(c ?? "").trim();
                return s.length > 0 && isNaN(Number(s));
            }).length;
            if (score > maxNonEmptyText) {
                maxNonEmptyText = score;
                bestRow = r + 1;
            }
        }
        return bestRow;
    }

    function extractHeadersAndObjects(wb, sheetName, headerRowNum = 1) {
        const rows2D = getSheet2DRows(wb, sheetName);
        if (rows2D.length === 0) return { headers: [], records: [] };
        const hIdx = Math.max(0, Math.min(rows2D.length - 1, (Number(headerRowNum) || 1) - 1));
        const rawHeaders = rows2D[hIdx] || [];
        const headers = [];
        const colIndices = [];
        rawHeaders.forEach((h, idx) => {
            const clean = String(h ?? "").replace(/\s+/g, " ").trim();
            const label = clean || `Sütun_${idx + 1}`;
            if (clean || rows2D.slice(hIdx + 1, hIdx + 15).some(r => String(r?.[idx] ?? "").trim() !== "")) {
                const uniqLabel = headers.includes(label) ? `${label} (${idx + 1})` : label;
                headers.push(uniqLabel);
                colIndices.push({ label: uniqLabel, idx });
            }
        });
        const records = [];
        for (let r = hIdx + 1; r < rows2D.length; r++) {
            const row = rows2D[r];
            if (!Array.isArray(row)) continue;
            const obj = {};
            let nonEmptyCount = 0;
            colIndices.forEach(({ label, idx }) => {
                const val = String(row[idx] ?? "").trim();
                obj[label] = val;
                if (val !== "") nonEmptyCount++;
            });
            if (nonEmptyCount > 0) records.push(obj);
        }
        return { headers, records };
    }

    function autoGuessColumn(headers, savedCol, pattern, excludePattern = null) {
        if (savedCol && headers.includes(savedCol)) return savedCol;
        for (const h of headers) {
            const norm = normalizeKey(h);
            if (excludePattern && (excludePattern.test(h) || excludePattern.test(norm))) continue;
            if (pattern.test(h) || pattern.test(norm)) return h;
        }
        return "";
    }

    function populatePmoTargetProjects() {
        const folder = $("pmoTargetFolder")?.value || "project";
        const sel = $("pmoTargetProject");
        if (!sel) return;
        const cfg = loadPmoConfig();
        const projs = (state.projects || []).filter(p => (p.category || "project") === folder);
        sel.innerHTML = `<option value="__auto__">✨ Excel-dəki Layihə adına görə (və ya PMO Ümumi)</option>`
            + projs.map(p => `<option value="${esc(p.id)}">📁 ${esc(p.name)}</option>`).join("");
        if (cfg.targetProject && (cfg.targetProject === "__auto__" || projs.some(p => p.id === cfg.targetProject))) {
            sel.value = cfg.targetProject;
        }
    }

    function populatePmoMappingDropdowns(headers) {
        const cfg = loadPmoConfig();
        const savedMap = cfg.map || {};
        const makeOpts = (selectedVal, allowEmpty = true) => {
            const emptyOpt = allowEmpty ? `<option value="">— Seçilməyib —</option>` : "";
            return emptyOpt + headers.map(h => `<option value="${esc(h)}" ${h === selectedVal ? "selected" : ""}>${esc(h)}</option>`).join("");
        };

        const guessed = {
            name: autoGuessColumn(headers, savedMap.name, /(məntəqə|menteqe|obyekt|xətt|xett|nöqtə|noqte|kəsişmə|kesisme|ünvan|unvan|\bad\b|adı|adi|name|route|marşrut|marsrut|site|location|məkan)/i, /(layihə|layihe|project|icraçı|icraci|podrat|rayon)/i) || headers[0] || "",
            rayon: autoGuessColumn(headers, savedMap.rayon, /(rayon|şəhər|seher|bölgə|bolge|region|district)/i),
            project: autoGuessColumn(headers, savedMap.project, /(layihə|layihe|proyekt|project|pmo|paket|istiqamət|istiqamet)/i),
            status: autoGuessColumn(headers, savedMap.status, /(status|vəziyyət|veziyyet|state|icra\s*vəziyyəti|mərhələ|merhele|faiz|%)/i),
            plan: autoGuessColumn(headers, savedMap.plan, /(plan|nəzərdə|nezerde|verilən|verilen|ümumi|umumi|total|uzunluq|məsafə|mesafe|layihə\s*uzun)/i, /(faktiki|çəkilən|cekilen|icra|done|hazır)/i),
            done: autoGuessColumn(headers, savedMap.done, /(faktiki|çəkilən|cekilen|icra\b|gorulen|görülən|done|completed|bitmiş\s*m)/i, /(plan|verilən|verilen|nəzərdə)/i),
            contractor: autoGuessColumn(headers, savedMap.contractor, /(icraçı|icraci|podratçı|podratci|contractor|subcontractor|şirkət|sirket|briqada)/i),
            lead: autoGuessColumn(headers, savedMap.lead, /(mühəndis|muhendis|briqadir|məsul|mesul|rəhbər|rehber|engineer|lead|kim\s*işləyib)/i),
            workers: autoGuessColumn(headers, savedMap.workers, /(işçi|isci|nəfər|nefer|worker|heyət|heyet)/i),
            antennas: autoGuessColumn(headers, savedMap.antennas, /(antena|antenna|bts|cihaz|sayı|sayi)/i, /(işçi|isci|lif|fiber)/i),
            typeOrFo: autoGuessColumn(headers, savedMap.typeOrFo, /(lif|fiber|\bfo\b|kabel\s*növ|nöqtə\s*növ|noqte\s*nov|tip|type)/i),
            lat: autoGuessColumn(headers, savedMap.lat, /(enlik|\blat\b|latitude|koordinat|coord|gps|x_coord)/i),
            lng: autoGuessColumn(headers, savedMap.lng, /(uzunluq|\blng\b|\blon\b|longitude|y_coord)/i)
        };

        if ($("pmoMapName")) $("pmoMapName").innerHTML = makeOpts(guessed.name, false);
        if ($("pmoMapRayon")) $("pmoMapRayon").innerHTML = makeOpts(guessed.rayon);
        if ($("pmoMapProject")) $("pmoMapProject").innerHTML = makeOpts(guessed.project);
        if ($("pmoMapStatus")) $("pmoMapStatus").innerHTML = makeOpts(guessed.status);
        if ($("pmoMapPlan")) $("pmoMapPlan").innerHTML = makeOpts(guessed.plan);
        if ($("pmoMapDone")) $("pmoMapDone").innerHTML = makeOpts(guessed.done);
        if ($("pmoMapContractor")) $("pmoMapContractor").innerHTML = makeOpts(guessed.contractor);
        if ($("pmoMapLead")) $("pmoMapLead").innerHTML = makeOpts(guessed.lead);
        if ($("pmoMapWorkers")) $("pmoMapWorkers").innerHTML = makeOpts(guessed.workers);
        if ($("pmoMapAntennas")) $("pmoMapAntennas").innerHTML = makeOpts(guessed.antennas);
        if ($("pmoMapTypeOrFo")) $("pmoMapTypeOrFo").innerHTML = makeOpts(guessed.typeOrFo);
        if ($("pmoMapLat")) $("pmoMapLat").innerHTML = makeOpts(guessed.lat);
        if ($("pmoMapLng")) $("pmoMapLng").innerHTML = makeOpts(guessed.lng);

        const extraBox = $("pmoExtraColsList");
        if (extraBox) {
            const savedExtras = new Set(Array.isArray(cfg.extraCols) ? cfg.extraCols : []);
            extraBox.innerHTML = headers.map(h => `
                <label style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:6px;background:var(--surface-2);border:1px solid var(--line);font-size:11px;cursor:pointer">
                    <input type="checkbox" data-pmo-extra-col="${esc(h)}" ${savedExtras.has(h) ? "checked" : ""}>
                    <span>${esc(h)}</span>
                </label>
            `).join("");
        }
    }

    function getCurrentPmoMappingFromUI() {
        return {
            name: $("pmoMapName")?.value || "",
            rayon: $("pmoMapRayon")?.value || "",
            project: $("pmoMapProject")?.value || "",
            status: $("pmoMapStatus")?.value || "",
            plan: $("pmoMapPlan")?.value || "",
            done: $("pmoMapDone")?.value || "",
            contractor: $("pmoMapContractor")?.value || "",
            lead: $("pmoMapLead")?.value || "",
            workers: $("pmoMapWorkers")?.value || "",
            antennas: $("pmoMapAntennas")?.value || "",
            typeOrFo: $("pmoMapTypeOrFo")?.value || "",
            lat: $("pmoMapLat")?.value || "",
            lng: $("pmoMapLng")?.value || ""
        };
    }

    function getSelectedPmoExtraCols() {
        return [...document.querySelectorAll("[data-pmo-extra-col]:checked")].map(el => el.dataset.pmoExtraCol);
    }

    function normMatchName(str) {
        return String(str || "")
            .toLocaleLowerCase("az")
            .replace(/\s*\(?\bFaz[-\s]*[12]\b\)?/gi, "")
            .replace(/\s*rayon(u)?\b/gi, "")
            .replace(/[^a-z0-9əıöüçşğ]/gi, "")
            .trim();
    }

    function parsePmoCoords(row, latCol, lngCol) {
        if (!latCol) return null;
        const rawLat = String(row[latCol] ?? "").trim();
        if (!rawLat) return null;
        if (!lngCol || !String(row[lngCol] ?? "").trim()) {
            // Birləşmiş koordinat: "40.4093, 49.8671"
            const parts = rawLat.split(/[,;\s/]+/).map(s => Number(s.replace(",", "."))).filter(n => !isNaN(n));
            if (parts.length >= 2 && Math.abs(parts[0]) <= 90 && Math.abs(parts[1]) <= 180) {
                return [[Number(parts[0].toFixed(6)), Number(parts[1].toFixed(6))]];
            }
            return null;
        }
        const lat = Number(rawLat.replace(",", "."));
        const lng = Number(String(row[lngCol] ?? "").trim().replace(",", "."));
        if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (Math.abs(lat) > 0.1 || Math.abs(lng) > 0.1)) {
            return [[Number(lat.toFixed(6)), Number(lng.toFixed(6))]];
        }
        return null;
    }

    function resolvePmoStatus(rawStatus, planVal, doneVal) {
        const s = String(rawStatus ?? "").trim();
        if (s) {
            if (s.includes("🟢")) return "bitmis";
            if (s.includes("🟡") || s.includes("🟠")) return "icrada";
            if (s.includes("🔵")) return "tehvil";
            if (s.includes("🔴")) return "layihe";
            const pctMatch = s.match(/^(\d+(?:[.,]\d+)?)\s*%?$/);
            if (pctMatch) {
                const p = Number(pctMatch[1].replace(",", "."));
                if (p >= 100) return "bitmis";
                if (p > 0) return "icrada";
                return "layihe";
            }
            return normalizeStatus(s);
        }
        return "layihe";
    }

    function renderPmoPreview() {
        if (!pmoWorkbook) return;
        const sheetName = $("pmoSheetSelect")?.value || pmoWorkbook.SheetNames[0];
        const headerRow = Number($("pmoHeaderRow")?.value) || 1;
        const { headers, records } = extractHeadersAndObjects(pmoWorkbook, sheetName, headerRow);
        const m = getCurrentPmoMappingFromUI();

        let matchedCount = 0;
        let newCount = 0;
        const allMapItems = (state.projects || []).flatMap(p => (p.items || []).map(item => ({
            proj: p,
            item,
            key: normMatchName(item.name),
            idKey: normMatchName(item.id)
        })));

        records.forEach(r => {
            const nameVal = String(r[m.name] ?? "").trim();
            if (!nameVal) return;
            const nk = normMatchName(nameVal);
            const found = allMapItems.find(x => x.key === nk || x.idKey === nk || (nk.length >= 4 && (x.key.includes(nk) || nk.includes(x.key))));
            if (found) matchedCount++;
            else newCount++;
        });

        if ($("pmoPreviewStats")) {
            $("pmoPreviewStats").innerHTML = `📊 Vərəqdə <b>${records.length}</b> sətir tapıldı · Xəritədə uyğun gələn mövcud obyekt: <b style="color:#38bdf8">${matchedCount}</b> · Yeni əlavə olunacaq sətir: <b style="color:#f59e0b">${newCount}</b>`;
        }
        if ($("pmoApplySyncBtn")) {
            $("pmoApplySyncBtn").disabled = records.length === 0 || !m.name;
        }

        const previewEl = $("pmoPreviewTable");
        if (previewEl) {
            const sample = records.slice(0, 5);
            const colsToShow = [m.name, m.project, m.status, m.plan, m.done, m.contractor].filter(Boolean);
            const finalCols = colsToShow.length > 0 ? [...new Set(colsToShow)] : headers.slice(0, 6);
            previewEl.innerHTML = `
                <thead><tr>${finalCols.map(c => `<th>${esc(c)}</th>`).join("")}<th>Xəritə Uyğunluğu</th></tr></thead>
                <tbody>${sample.map(r => {
                    const nk = normMatchName(r[m.name]);
                    const found = nk ? allMapItems.find(x => x.key === nk || x.idKey === nk || (nk.length >= 4 && (x.key.includes(nk) || nk.includes(x.key)))) : null;
                    const badge = found
                        ? `<span class="pill" style="--tone:#22c55e">✔ Mövcud (${esc(found.proj.name)})</span>`
                        : `<span class="pill" style="--tone:#f59e0b">➕ Yeni sətir</span>`;
                    return `<tr>${finalCols.map(c => `<td>${esc(r[c] ?? "—")}</td>`).join("")}<td>${badge}</td></tr>`;
                }).join("")}</tbody>
            `;
        }
    }

    function loadWorkbookIntoModal(wb, sourceLabel) {
        pmoWorkbook = wb;
        const cfg = loadPmoConfig();
        const sheetSel = $("pmoSheetSelect");
        if (sheetSel) {
            sheetSel.innerHTML = wb.SheetNames.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
            if (cfg.sheetName && wb.SheetNames.includes(cfg.sheetName)) {
                sheetSel.value = cfg.sheetName;
            }
        }
        const activeSheet = sheetSel?.value || wb.SheetNames[0];
        const rows2D = getSheet2DRows(wb, activeSheet);
        const bestHeader = cfg.headerRow || detectBestHeaderRow(rows2D);
        if ($("pmoHeaderRow")) $("pmoHeaderRow").value = bestHeader;
        if ($("pmoTargetFolder") && cfg.targetFolder) $("pmoTargetFolder").value = cfg.targetFolder;
        if ($("pmoSyncMode") && cfg.syncMode) $("pmoSyncMode").value = cfg.syncMode;
        if ($("pmoMapUnit") && cfg.unit) $("pmoMapUnit").value = cfg.unit;

        populatePmoTargetProjects();
        const { headers } = extractHeadersAndObjects(wb, activeSheet, bestHeader);
        populatePmoMappingDropdowns(headers);
        if ($("pmoMappingSection")) $("pmoMappingSection").hidden = false;
        renderPmoPreview();

        if ($("pmoStatusText")) {
            $("pmoStatusText").innerHTML = `<i class="fa-solid fa-circle-check" style="color:#22c55e"></i> Qoşuldu: <b>${esc(sourceLabel)}</b> (${wb.SheetNames.length} vərəq, ${headers.length} sütun)`;
        }
    }

    async function applyPmoDataToMap(wb, silent = false) {
        if (!wb) return { updated: 0, added: 0 };
        if (isStructuredPmoWorkbook(wb)) {
            return applyStructuredPmoWorkbook(wb, silent);
        }
        const cfg = loadPmoConfig();
        const sheetName = ($("pmoSheetSelect")?.value || cfg.sheetName || wb.SheetNames[0]);
        const headerRow = Number($("pmoHeaderRow")?.value || cfg.headerRow || 1);
        const targetFolder = $("pmoTargetFolder")?.value || cfg.targetFolder || "project";
        const targetProjectVal = $("pmoTargetProject")?.value || cfg.targetProject || "__auto__";
        const syncMode = $("pmoSyncMode")?.value || cfg.syncMode || "both";
        const unitPref = $("pmoMapUnit")?.value || cfg.unit || "auto";
        const m = $("pmoMapName")?.options?.length ? getCurrentPmoMappingFromUI() : (cfg.map || {});
        const extraCols = $("pmoExtraColsList")?.children?.length ? getSelectedPmoExtraCols() : (cfg.extraCols || []);

        const { records } = extractHeadersAndObjects(wb, sheetName, headerRow);
        if (!m.name || records.length === 0) return { updated: 0, added: 0 };

        const rawHash = JSON.stringify(records);
        if (silent && rawHash === pmoLastContentHash) {
            return { updated: 0, added: 0, unchanged: true };
        }
        pmoLastContentHash = rawHash;

        let updatedCount = 0;
        let addedCount = 0;
        const touchedProjects = new Set();

        records.forEach((row, idx) => {
            const itemName = String(row[m.name] ?? "").trim();
            if (!itemName) return;
            const nk = normMatchName(itemName);
            if (!nk) return;

            const rawProjName = m.project ? String(row[m.project] ?? "").trim() : "";
            const rawRayonVal = m.rayon ? String(row[m.rayon] ?? "").trim() : "";
            const rawPlan = m.plan ? parseAttrNumber(row[m.plan], null) : null;
            const rawDone = m.done ? parseAttrNumber(row[m.done], null) : null;
            const rawCtr = m.contractor ? String(row[m.contractor] ?? "").trim() : "";
            const rawLead = m.lead ? String(row[m.lead] ?? "").trim() : "";
            const rawWrk = m.workers ? String(row[m.workers] ?? "").trim() : "";
            const rawAnt = m.antennas ? parseInt(String(row[m.antennas] ?? "").replace(/[^\d]/g, ""), 10) : NaN;
            const rawTypeFo = m.typeOrFo ? String(row[m.typeOrFo] ?? "").trim() : "";
            const parsedCoords = parsePmoCoords(row, m.lat, m.lng);

            // 1. Mövcud xəritə obyektlərində axtar
            let matchedProj = null;
            let matchedItem = null;
            const searchPool = targetProjectVal !== "__auto__"
                ? state.projects.filter(p => p.id === targetProjectVal)
                : state.projects;

            for (const p of searchPool) {
                if (rawProjName && normMatchName(p.name) && !normMatchName(p.name).includes(normMatchName(rawProjName)) && !normMatchName(rawProjName).includes(normMatchName(p.name))) {
                    continue;
                }
                const hit = (p.items || []).find(it => {
                    const ik = normMatchName(it.name);
                    const idK = normMatchName(it.id);
                    return ik === nk || idK === nk || (nk.length >= 4 && (ik.includes(nk) || nk.includes(ik)));
                });
                if (hit) {
                    matchedProj = p;
                    matchedItem = hit;
                    break;
                }
            }
            if (!matchedItem && rawProjName) {
                for (const p of searchPool) {
                    const hit = (p.items || []).find(it => {
                        const ik = normMatchName(it.name);
                        return ik === nk || (nk.length >= 4 && (ik.includes(nk) || nk.includes(ik)));
                    });
                    if (hit) {
                        matchedProj = p;
                        matchedItem = hit;
                        break;
                    }
                }
            }

            const buildCustomFields = existingCf => {
                const cfMap = new Map();
                (Array.isArray(existingCf) ? existingCf : []).forEach(x => {
                    if (x?.label) cfMap.set(x.label, x.value);
                });
                extraCols.forEach(col => {
                    const v = String(row[col] ?? "").trim();
                    if (v) cfMap.set(col, v);
                });
                return [...cfMap.entries()].map(([label, value]) => ({ label, value }));
            };

            if (matchedItem && matchedProj && syncMode !== "import_all") {
                const isPts = matchedProj.type === "points" || matchedProj.category === "nim" || isPointItemRecord(matchedItem);
                if (rawPlan !== null) {
                    if (isPts) {
                        matchedItem.totalKm = unitPref === "km" ? Math.round(rawPlan * 1000) : (unitPref === "m" ? Math.round(rawPlan) : normalizePointMetersInput(rawPlan));
                        matchedItem.unit = "m";
                    } else {
                        matchedItem.totalKm = unitPref === "m" ? Number((rawPlan / 1000).toFixed(3)) : rawPlan;
                    }
                }
                if (rawDone !== null) {
                    if (isPts) {
                        matchedItem.doneKm = unitPref === "km" ? Math.round(rawDone * 1000) : (unitPref === "m" ? Math.round(rawDone) : normalizePointMetersInput(rawDone));
                        matchedItem.unit = "m";
                    } else {
                        matchedItem.doneKm = unitPref === "m" ? Number((rawDone / 1000).toFixed(3)) : rawDone;
                    }
                }
                if (m.status && String(row[m.status] ?? "").trim() !== "") {
                    matchedItem.status = resolvePmoStatus(row[m.status], matchedItem.totalKm, matchedItem.doneKm);
                }
                if (rawRayonVal) matchedItem.rayon = rawRayonVal;
                if (rawCtr) matchedItem.contractor = rawCtr;
                if (rawLead) matchedItem.execLead = rawLead;
                if (rawWrk) matchedItem.execWorkers = rawWrk;
                if (!isNaN(rawAnt)) matchedItem.antennas = rawAnt;
                if (rawTypeFo) {
                    if (isPts) matchedItem.pointType = rawTypeFo;
                    else matchedItem.fiberCount = normalizeFiberCount(rawTypeFo, rawTypeFo);
                }
                if (parsedCoords) matchedItem.coords = parsedCoords;
                if (extraCols.length > 0) {
                    matchedItem.customFields = buildCustomFields(matchedItem.customFields);
                }
                saveSegmentOverride(matchedProj.id, matchedItem);
                touchedProjects.add(matchedProj);
                updatedCount++;
                return;
            }

            if (syncMode === "update_only") return;

            // 2. Yeni sətirdirsə uyğun layihəni tap və ya yarat
            let destProj = targetProjectVal !== "__auto__"
                ? state.projects.find(p => p.id === targetProjectVal)
                : null;
            if (!destProj && rawProjName) {
                destProj = state.projects.find(p => normMatchName(p.name) === normMatchName(rawProjName));
            }
            if (!destProj) {
                const projTitle = rawProjName || `PMO — ${pmoSourceName || sheetName}`;
                destProj = state.projects.find(p => normMatchName(p.name) === normMatchName(projTitle));
                if (!destProj) {
                    const newProjId = `proj_pmo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                    destProj = {
                        id: newProjId,
                        name: projTitle,
                        category: targetFolder,
                        type: "points",
                        status: "icrada",
                        imported: true,
                        items: []
                    };
                    state.projects.push(destProj);
                    state.visibleIds.add(destProj.id);
                    state.activeFolders.add(targetFolder);
                    saveProjectOverride(destProj);
                }
            }

            const isDestPts = destProj.type === "points" || destProj.category === "nim";
            const planNum = rawPlan !== null ? (isDestPts ? (unitPref === "km" ? Math.round(rawPlan * 1000) : Math.round(rawPlan)) : (unitPref === "m" ? Number((rawPlan / 1000).toFixed(3)) : rawPlan)) : 0;
            const doneNum = rawDone !== null ? (isDestPts ? (unitPref === "km" ? Math.round(rawDone * 1000) : Math.round(rawDone)) : (unitPref === "m" ? Number((rawDone / 1000).toFixed(3)) : rawDone)) : 0;
            const st = resolvePmoStatus(m.status ? row[m.status] : "", planNum, doneNum);
            const fallbackCoord = [[40.4093 + (idx * 0.004), 49.8671 + (idx * 0.005)]];
            const newItem = {
                id: `PMO-${idx + 1}-${Date.now().toString().slice(-3)}`,
                name: itemName,
                rayon: rawRayonVal || undefined,
                pointA: itemName,
                pointB: "Şəbəkə",
                status: st,
                contractor: rawCtr || "",
                execLead: rawLead || "",
                execWorkers: rawWrk || "",
                totalKm: planNum,
                doneKm: doneNum,
                unit: isDestPts ? "m" : undefined,
                summary: isDestPts ? true : undefined,
                antennas: !isNaN(rawAnt) ? rawAnt : (isDestPts ? 1 : 0),
                pointType: isDestPts ? rawTypeFo : undefined,
                fiberCount: !isDestPts ? normalizeFiberCount(rawTypeFo, "") : undefined,
                customFields: buildCustomFields([]),
                coords: parsedCoords || fallbackCoord
            };
            destProj.items.push(newItem);
            saveSegmentOverride(destProj.id, newItem);
            touchedProjects.add(destProj);
            addedCount++;
        });

        if (updatedCount > 0 || addedCount > 0) {
            saveImportedProjects();
            renderAll();
            if (isAdmin() && api.configured) {
                for (const p of touchedProjects) {
                    api.saveProject(p).catch(() => {});
                }
            }
        }
        return { updated: updatedCount, added: addedCount };
    }

    function parseCsvTo2D(csvText) {
        const rows = [];
        let curRow = [];
        let curCell = "";
        let inQuotes = false;
        for (let i = 0; i < csvText.length; i++) {
            const ch = csvText[i];
            const next = csvText[i + 1];
            if (ch === '"') {
                if (inQuotes && next === '"') {
                    curCell += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === ',' && !inQuotes) {
                curRow.push(curCell);
                curCell = "";
            } else if ((ch === '\r' || ch === '\n') && !inQuotes) {
                if (ch === '\r' && next === '\n') i++;
                curRow.push(curCell);
                curCell = "";
                if (curRow.some(c => c.trim().length > 0)) {
                    rows.push(curRow);
                }
                curRow = [];
            } else {
                curCell += ch;
            }
        }
        if (curCell.length > 0 || curRow.length > 0) {
            curRow.push(curCell);
            if (curRow.some(c => c.trim().length > 0)) {
                rows.push(curRow);
            }
        }
        return rows;
    }

    function gvizTableTo2DRows(table) {
        if (!table || !Array.isArray(table.rows)) return [];
        const rows = [];
        for (const r of table.rows) {
            const cells = r.c || [];
            const rowArr = [];
            for (let i = 0; i < cells.length; i++) {
                const cell = cells[i];
                if (!cell || cell.v === null || cell.v === undefined) {
                    rowArr.push("");
                } else {
                    const fStr = (cell.f !== undefined && cell.f !== null) ? String(cell.f).trim() : "";
                    const val = (typeof cell.v === "number" && (!fStr || (!fStr.includes("%") && !/[/:]/.test(fStr))))
                        ? String(cell.v)
                        : (fStr || String(cell.v).trim());
                    rowArr.push(val);
                }
            }
            if (rowArr.some(c => c.length > 0)) {
                rows.push(rowArr);
            }
        }
        return rows;
    }

    function fetchGvizViaJsonp(sheetKey, sheetTitle, headerRows = 0) {
        return new Promise((resolve, reject) => {
            if (typeof document === "undefined") return reject(new Error("No DOM"));
            const cbName = `__gviz_cb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const script = document.createElement("script");
            let timeoutId = null;

            window[cbName] = (resp) => {
                cleanup();
                if (resp && resp.status === "ok" && resp.table) {
                    const dataRows = gvizTableTo2DRows(resp.table);
                    let rows2D = dataRows;
                    // Nömrəli vərəqlərdə (headers=3) rəqəmli sütunların (DU, CT, CY və s.) başlıqları table.cols[].label-da gəlir
                    if (headerRows > 0 && Array.isArray(resp.table.cols)) {
                        const headerLabels = resp.table.cols.map(c => String(c?.label || "").replace(/\s+/g, " ").trim());
                        const padRows = Array.from({ length: Math.max(0, headerRows - 1) }, () => []);
                        rows2D = [...padRows, headerLabels, ...dataRows];
                    }
                    if (rows2D && rows2D.length > 0) {
                        resolve(rows2D);
                        return;
                    }
                }
                reject(new Error(resp?.errors?.[0]?.message || "GViz table empty"));
            };

            function cleanup() {
                if (timeoutId) clearTimeout(timeoutId);
                try { delete window[cbName]; } catch {}
                if (script.parentNode) script.parentNode.removeChild(script);
            }

            timeoutId = setTimeout(() => {
                cleanup();
                reject(new Error("GViz JSONP timeout"));
            }, 12000);

            script.onerror = () => {
                cleanup();
                reject(new Error("GViz JSONP script error"));
            };

            script.src = `https://docs.google.com/spreadsheets/d/${sheetKey}/gviz/tq?tqx=responseHandler:${cbName}&headers=${headerRows}&sheet=${encodeURIComponent(sheetTitle)}&_t=${Date.now()}`;
            document.head.appendChild(script);
        });
    }

    async function fetchGoogleSheetViaGviz(sheetKey) {
        const fetchRows = async (sheetTitle, headerRows = 0) => {
            const candidates = [sheetTitle];
            if (/^d\s*1$/i.test(sheetTitle)) candidates.unshift("D1", "D 1", "d1");
            else if (/^d\s*2$/i.test(sheetTitle)) candidates.unshift("D2", "D 2", "d2");
            else if (String(sheetTitle).includes(".")) {
                candidates.push(String(sheetTitle).replace(/\./g, ","));
            }

            for (const title of candidates) {
                // 1. JSONP (Brauzerdə CORS qadağasını tam aşaraq birbaşa canlı oxuyur)
                try {
                    const rows2D = await fetchGvizViaJsonp(sheetKey, title, headerRows);
                    if (rows2D && rows2D.length > 0 && rows2D.some(row => row.some(cell => cell && String(cell).trim().length > 0))) {
                        return { title, rows2D };
                    }
                } catch {}

                // 2. Birbaşa CSV sorğusu (fallback)
                const u = `https://docs.google.com/spreadsheets/d/${sheetKey}/gviz/tq?tqx=out:csv&headers=0&sheet=${encodeURIComponent(title)}&_t=${Date.now()}`;
                try {
                    const res = await fetch(u, { cache: "no-store", credentials: "omit" });
                    if (!res.ok) continue;
                    const text = await res.text();
                    if (!text || text.includes("google.visualization.Query.setResponse") || text.includes("<html") || text.includes("<!DOCTYPE") || text.includes("invalid_query")) {
                        continue;
                    }
                    const rows2D = parseCsvTo2D(text);
                    if (rows2D && rows2D.length > 0 && rows2D.some(row => row.some(cell => cell && String(cell).trim().length > 0))) {
                        return { title, rows2D };
                    }
                } catch {}
            }
            throw new Error(`Sheet not found: ${sheetTitle}`);
        };

        const [d1Res, d2Res] = await Promise.all([
            fetchRows("D1", 0),
            fetchRows("D2", 0)
        ]);

        const sheets = {
            [d1Res.title]: { _rawRows: d1Res.rows2D },
            [d2Res.title]: { _rawRows: d2Res.rows2D },
            D1: { _rawRows: d1Res.rows2D },
            D2: { _rawRows: d2Res.rows2D }
        };
        const sheetNames = Array.from(new Set([d1Res.title, d2Res.title, "D1", "D2", "D 1", "D 2"]));

        // Həm D1-dən, həm D2-dən, həm də məlum layihə vərəqlərindən (məs: 15.1, 15.2, 16.1, 18.1) nömrəli vərəqləri aşkarla
        const numberedIds = [];
        const addNumberedId = raw => {
            const sid = normSheetId(raw);
            if (sid && !numberedIds.includes(sid)) numberedIds.push(sid);
        };
        d1Res.rows2D.forEach(r => addNumberedId(r[0]));
        d2Res.rows2D.forEach(r => addNumberedId(r[0]));
        if (Array.isArray(window.PMO_SEED_PROJECTS)) {
            window.PMO_SEED_PROJECTS.forEach(p => addNumberedId(p.sheetId || p.pmoMeta?.sheetId));
        }

        // Hər yeniləmədə bütün nömrəli vərəqləri (10, 11, 12, ...) təzədən oxu ki, magistral adı, lif sayı, məsafə və s. dərhal yenilənsin.
        // __pmoSubSheetCache yalnız hansısa vərəq müvəqqəti timeout olarsa itməsin deyə ehtiyat kimi saxlanır.
        if (!window.__pmoSubSheetCache) window.__pmoSubSheetCache = { hash: "", ts: 0, sheets: {} };
        for (let i = 0; i < numberedIds.length; i += 4) {
            const batch = numberedIds.slice(i, i + 4);
            await Promise.allSettled(batch.map(async sid => {
                try {
                    const subRes = await fetchRows(sid, 3);
                    if (subRes && subRes.rows2D && subRes.rows2D.length > 0) {
                        window.__pmoSubSheetCache.sheets[sid] = { _rawRows: subRes.rows2D };
                    }
                } catch {}
            }));
        }
        window.__pmoSubSheetCache.ts = Date.now();

        // Bütün vərəqləri birləşdir (təzə oxunanlar + timeout olarsa əvvəlki ehtiyat)
        for (const sid of numberedIds) {
            if (window.__pmoSubSheetCache.sheets[sid]) {
                sheets[sid] = window.__pmoSubSheetCache.sheets[sid];
                if (!sheetNames.includes(sid)) sheetNames.push(sid);
            }
        }

        return { SheetNames: sheetNames, Sheets: sheets };
    }

    async function fetchPmoWorkbookFromUrl(rawUrl, useDomainAuth = false) {
        const gsMatch = (rawUrl || "").match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
        if (gsMatch) {
            try {
                const wb = await fetchGoogleSheetViaGviz(gsMatch[1]);
                if (wb && wb.SheetNames && wb.SheetNames.length > 0) {
                    return wb;
                }
            } catch (gvizErr) {
                console.warn("GViz canlı sinxronizasiya xətası, XLSX yoxlanılır:", gvizErr);
            }
        }

        await ensureXLSX().catch(() => null);
        const finalUrl = normalizePmoUrl(rawUrl);
        if (!finalUrl) throw new Error("URL boşdur");
        const isGoogleSheet = /docs\.google\.com\/spreadsheets/i.test(finalUrl);
        const sep = finalUrl.includes("?") ? "&" : "?";
        const bustUrl = `${finalUrl}${sep}_t=${Date.now()}`;
        let res = null;
        const attempts = isGoogleSheet
            ? [
                () => fetch(bustUrl, { credentials: "omit", cache: "no-store" }),
                () => fetch(`https://corsproxy.io/?${encodeURIComponent(finalUrl)}`, { credentials: "omit", cache: "no-store" })
            ]
            : [
                () => fetch(bustUrl, { credentials: useDomainAuth ? "include" : "omit", cache: "no-store" }),
                () => fetch(bustUrl, { credentials: "omit", cache: "no-store" })
            ];
        let lastErr = null;
        for (const fn of attempts) {
            try {
                const r = await fn();
                if (r && r.ok) { res = r; break; }
                lastErr = new Error(`HTTP ${r?.status || 0}`);
            } catch (e) {
                lastErr = e;
            }
        }
        if (!res) throw lastErr || new Error("Link oxunmadı");
        const buf = await res.arrayBuffer();
        if (typeof XLSX !== "undefined") {
            return XLSX.read(buf, { type: "array" });
        }
        const text = new TextDecoder("utf-8").decode(buf);
        return parseCsvFallbackToWorkbook(text);
    }

    async function readPmoWorkbookFromFile(file) {
        await ensureXLSX().catch(() => null);
        const buf = await file.arrayBuffer();
        if (typeof XLSX !== "undefined") {
            return XLSX.read(buf, { type: "array" });
        }
        const text = new TextDecoder("utf-8").decode(buf);
        return parseCsvFallbackToWorkbook(text);
    }

    function updatePmoLiveIndicators(active, label = "") {
        if ($("pmoLiveBadge")) $("pmoLiveBadge").hidden = !active;
        if ($("pmoRefreshNowBtn")) $("pmoRefreshNowBtn").hidden = !active && !pmoWorkbook;
        if ($("pmoStopLiveBtn")) $("pmoStopLiveBtn").hidden = !active;
        if (active && $("pmoStatusText")) {
            const nowStr = new Date().toLocaleTimeString("az-AZ");
            $("pmoStatusText").innerHTML = `<span style="color:#22c55e;font-weight:700">🟢 Canlı Sinxronizasiya Aktivdir:</span> <b>${esc(label)}</b> · Son yoxlama: <span class="mono">${nowStr}</span>`;
        }
    }

    function stopPmoLiveWatch(silent = false) {
        if (pmoLiveTimer) {
            clearInterval(pmoLiveTimer);
            pmoLiveTimer = null;
        }
        updatePmoLiveIndicators(false);
        if (!silent) toast("⏹️ PMO Excel canlı izləmə dayandırıldı");
    }

    function startPmoLiveWatch() {
        if (pmoLiveTimer) clearInterval(pmoLiveTimer);
        const cfg = loadPmoConfig();

        if (pmoSourceType === "file" && pmoLiveFileHandle) {
            updatePmoLiveIndicators(true, `Fayl: ${pmoSourceName}`);
            pmoLiveTimer = setInterval(async () => {
                try {
                    const file = await pmoLiveFileHandle.getFile();
                    if (file.lastModified !== pmoLastFileModified) {
                        pmoLastFileModified = file.lastModified;
                        const wb = await readPmoWorkbookFromFile(file);
                        pmoWorkbook = wb;
                        const res = await applyPmoDataToMap(wb, true);
                        updatePmoLiveIndicators(true, `Fayl: ${pmoSourceName}`);
                        if (!res.unchanged && (res.updated > 0 || res.added > 0)) {
                            toast(`📊 PMO Excel faylında dəyişiklik aşkarlandı: ${res.updated} yeniləndi, ${res.added} əlavə olundu`);
                        }
                    }
                } catch {}
            }, 6000);
            return;
        }

        if (cfg.url && Number(cfg.pollInterval) > 0) {
            const sec = Math.max(20, Number(cfg.pollInterval) || 20);
            let pmoPollInFlight = false;
            updatePmoLiveIndicators(true, cfg.url);
            pmoLiveTimer = setInterval(async () => {
                if (pmoPollInFlight || document.hidden || geomEditState || (window.map && window.map.isMoving())) return;
                pmoPollInFlight = true;
                try {
                    const wb = await fetchPmoWorkbookFromUrl(cfg.url, cfg.useDomainAuth);
                    pmoWorkbook = wb;
                    const res = await applyPmoDataToMap(wb, true);
                    updatePmoLiveIndicators(true, cfg.url);
                    if (!res.unchanged && (res.updated > 0 || res.added > 0)) {
                        toast(`📊 PMO Excel canlı yeniləndi: ${res.updated} obyekt yeniləndi`);
                    }
                } catch (err) {
                    console.warn("PMO live poll error:", err);
                } finally {
                    pmoPollInFlight = false;
                }
            }, sec * 1000);
        }
    }

    function initPmoExcelIntegration() {
        const modal = $("pmoExcelModal");
        if (!modal) return;

        $("pmoQuickSyncBtn")?.addEventListener("click", async () => {
            const btn = $("pmoQuickSyncBtn");
            const icon = btn?.querySelector("i");
            if (icon) icon.classList.add("fa-spin");
            toast("🔄 PMO Google Sheets yoxlanılır...");
            try {
                const cfg = loadPmoConfig();
                const targetUrl = cfg.url || DEFAULT_PMO_SHEET_URL;
                const wb = await fetchPmoWorkbookFromUrl(targetUrl, cfg.useDomainAuth);
                pmoWorkbook = wb;
                pmoLastContentHash = "";
                const res = await applyPmoDataToMap(wb, false);
                updatePmoLiveIndicators(true, "PMO Google Sheets");
                toast(`✅ PMO canlı yeniləndi (${res.updated} layihə yeniləndi, ${res.added} əlavə olundu)`);
            } catch (err) {
                toast(`⚠️ Yeniləmə xətası: ${err.message}`, true);
            } finally {
                if (icon) icon.classList.remove("fa-spin");
            }
        });

        $("pmoExcelBtn")?.addEventListener("click", () => {
            if (modal && typeof modal.showModal === "function" && isAdmin()) {
                const cfg = loadPmoConfig();
                if ($("pmoExcelUrl")) $("pmoExcelUrl").value = cfg.url || "";
                if ($("pmoWebhookUrl")) $("pmoWebhookUrl").value = cfg.webhookUrl || "";
                if ($("pmoUseDomainAuth")) $("pmoUseDomainAuth").checked = cfg.useDomainAuth !== false;
                if ($("pmoPollInterval")) $("pmoPollInterval").value = String(cfg.pollInterval ?? 20);
                if ($("pmoTargetFolder")) $("pmoTargetFolder").value = cfg.targetFolder || [...state.activeFolders][0] || "project";
                populatePmoTargetProjects();
                modal.showModal();
            } else {
                $("pmoQuickSyncBtn")?.click();
            }
        });

        $("pmoWebhookUrl")?.addEventListener("change", () => {
            const cfg = loadPmoConfig();
            cfg.webhookUrl = $("pmoWebhookUrl").value.trim();
            savePmoConfig(cfg);
            toast(cfg.webhookUrl ? "✅ Xəritə → Excel geri yazma linki yadda saxlanıldı" : "ℹ️ Geri yazma linki təmizləndi");
        });

        $("pmoTargetFolder")?.addEventListener("change", populatePmoTargetProjects);

        $("pmoFetchUrlBtn")?.addEventListener("click", async () => {
            const rawUrl = $("pmoExcelUrl")?.value.trim();
            if (!rawUrl) {
                toast("⚠️ Daxili domen və ya Excel linkini daxil edin", true);
                return;
            }
            const btn = $("pmoFetchUrlBtn");
            const oldHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Oxunur...`;
            try {
                const useAuth = $("pmoUseDomainAuth")?.checked !== false;
                const wb = await fetchPmoWorkbookFromUrl(rawUrl, useAuth);
                pmoSourceType = "url";
                pmoSourceName = rawUrl.split("/").pop().split("?")[0] || "PMO_Link";
                loadWorkbookIntoModal(wb, rawUrl);
                toast("✅ PMO Excel linki uğurla oxundu!");
            } catch (err) {
                toast(`❌ Link oxunmadı (${err.message}). Faylı birbaşa seçə və ya şəbəkə icazəsini yoxlaya bilərsiniz.`, true);
            } finally {
                btn.disabled = false;
                btn.innerHTML = oldHtml;
            }
        });

        $("pmoPickLiveFileBtn")?.addEventListener("click", async () => {
            if (window.showOpenFilePicker) {
                try {
                    const [handle] = await window.showOpenFilePicker({
                        types: [{
                            description: "PMO Excel Faylları",
                            accept: {
                                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
                                "application/vnd.ms-excel": [".xls"],
                                "text/csv": [".csv", ".tsv"]
                            }
                        }],
                        multiple: false
                    });
                    if (handle) {
                        pmoLiveFileHandle = handle;
                        const file = await handle.getFile();
                        pmoLastFileModified = file.lastModified;
                        pmoSourceType = "file";
                        pmoSourceName = file.name.replace(/\.[^/.]+$/, "");
                        const wb = await readPmoWorkbookFromFile(file);
                        loadWorkbookIntoModal(wb, `${file.name} (Canlı fayl izləmə hazır)`);
                        toast(`✅ "${file.name}" seçildi — sütunları yoxlayıb təsdiqləyin`);
                        return;
                    }
                } catch (err) {
                    if (err?.name === "AbortError") return;
                }
            }
            $("pmoFileInput")?.click();
        });

        $("pmoFileInput")?.addEventListener("change", async e => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                pmoLiveFileHandle = null;
                pmoSourceType = "file";
                pmoSourceName = file.name.replace(/\.[^/.]+$/, "");
                const wb = await readPmoWorkbookFromFile(file);
                loadWorkbookIntoModal(wb, file.name);
                toast(`✅ "${file.name}" oxundu`);
            } catch {
                toast("❌ Excel faylı oxuna bilmədi", true);
            }
            e.target.value = "";
        });

        ["pmoSheetSelect", "pmoHeaderRow"].forEach(id => {
            $(id)?.addEventListener("change", () => {
                if (!pmoWorkbook) return;
                const sheetName = $("pmoSheetSelect").value;
                const headerRow = Number($("pmoHeaderRow").value) || 1;
                const { headers } = extractHeadersAndObjects(pmoWorkbook, sheetName, headerRow);
                populatePmoMappingDropdowns(headers);
                renderPmoPreview();
            });
        });

        ["pmoMapName", "pmoMapProject", "pmoMapStatus", "pmoMapPlan", "pmoMapDone", "pmoMapUnit", "pmoMapContractor", "pmoMapLead", "pmoMapWorkers", "pmoMapAntennas", "pmoMapTypeOrFo", "pmoMapLat", "pmoMapLng", "pmoSyncMode", "pmoTargetProject"].forEach(id => {
            $(id)?.addEventListener("change", renderPmoPreview);
        });
        $("pmoExtraColsList")?.addEventListener("change", renderPmoPreview);

        $("pmoApplySyncBtn")?.addEventListener("click", async () => {
            if (!pmoWorkbook) return;
            const cfg = {
                url: $("pmoExcelUrl")?.value.trim() || "",
                useDomainAuth: $("pmoUseDomainAuth")?.checked !== false,
                pollInterval: Number($("pmoPollInterval")?.value ?? 20),
                sheetName: $("pmoSheetSelect")?.value || "",
                headerRow: Number($("pmoHeaderRow")?.value) || 1,
                targetFolder: $("pmoTargetFolder")?.value || "project",
                targetProject: $("pmoTargetProject")?.value || "__auto__",
                syncMode: $("pmoSyncMode")?.value || "both",
                unit: $("pmoMapUnit")?.value || "auto",
                map: getCurrentPmoMappingFromUI(),
                extraCols: getSelectedPmoExtraCols()
            };
            savePmoConfig(cfg);
            pmoLastContentHash = "";
            const res = await applyPmoDataToMap(pmoWorkbook, false);
            startPmoLiveWatch();
            modal.close();
            toast(`✅ PMO Excel tətbiq edildi: ${res.updated} obyekt yeniləndi, ${res.added} yeni obyekt əlavə olundu!`);
        });

        $("pmoRefreshNowBtn")?.addEventListener("click", async () => {
            try {
                const cfg = loadPmoConfig();
                if (pmoSourceType === "file" && pmoLiveFileHandle) {
                    const file = await pmoLiveFileHandle.getFile();
                    pmoWorkbook = await readPmoWorkbookFromFile(file);
                } else if (cfg.url) {
                    pmoWorkbook = await fetchPmoWorkbookFromUrl(cfg.url, cfg.useDomainAuth);
                }
                pmoLastContentHash = "";
                const res = await applyPmoDataToMap(pmoWorkbook, false);
                updatePmoLiveIndicators(Boolean(pmoLiveTimer), pmoSourceName || cfg.url);
                toast(`🔄 PMO Excel yeniləndi (${res.updated} yeniləndi, ${res.added} əlavə olundu)`);
            } catch {
                toast("⚠️ Yeniləmə zamanı mənbəyə qoşulmaq mümkün olmadı", true);
            }
        });

        $("pmoStopLiveBtn")?.addEventListener("click", () => stopPmoLiveWatch(false));

        // 🔔 Canlı Bildirişlər Pəncərəsi (100% Yaşıl nöqtələr, yeni layihələr və standart xətaları)
        $("pmoNotifBtn")?.addEventListener("click", () => {
            renderPmoNotifsUI();
            $("pmoNotifModal")?.showModal();
        });
        $("pmoNotifModal")?.addEventListener("close", () => {
            const list = loadPmoNotifs();
            if (list.some(n => n.unread)) {
                savePmoNotifs(list.map(n => ({ ...n, unread: false })));
                renderPmoNotifsUI();
            }
        });
        $("pmoNotifFilterTabs")?.addEventListener("click", e => {
            const btn = e.target.closest("[data-notif-filter]");
            if (!btn) return;
            pmoNotifFilter = btn.dataset.notifFilter || "all";
            $("pmoNotifFilterTabs").querySelectorAll("[data-notif-filter]").forEach(b => b.classList.toggle("active", b === btn));
            renderPmoNotifsUI();
        });
        $("pmoNotifMarkReadBtn")?.addEventListener("click", () => {
            const list = loadPmoNotifs().map(n => ({ ...n, unread: false }));
            savePmoNotifs(list);
            renderPmoNotifsUI();
            toast("✅ Bütün bildirişlər oxunmuş kimi işarələndi");
        });
        $("pmoNotifClearBtn")?.addEventListener("click", () => {
            savePmoNotifs([]);
            renderPmoNotifsUI();
            toast("🗑️ Bildirişlər təmizləndi");
        });
        $("pmoNotifList")?.addEventListener("click", e => {
            const row = e.target.closest("[data-notif-jump]");
            if (!row) return;
            const list = loadPmoNotifs();
            const n = list.find(x => x.id === row.dataset.notifJump);
            if (!n) return;
            n.unread = false;
            savePmoNotifs(list);
            renderPmoNotifsUI();
            $("pmoNotifModal")?.close();

            if (n.projectId) {
                const proj = state.projects.find(p => p.id === n.projectId);
                if (proj) {
                    state.activeFolders.add(proj.category || "project");
                    state.visibleIds.add(proj.id);
                    state.expandedIds.add(proj.id);
                    const item = n.itemId ? proj.items.find(it => it.id === n.itemId) : null;
                    if (item && n.pmoSubId) {
                        if (!state.expandedRayons) state.expandedRayons = new Set();
                        const ck = typeof window.getPmoRayonClusterKey === "function"
                            ? window.getPmoRayonClusterKey(proj, item)
                            : `${proj.id}::pmo::${item.id}`;
                        state.expandedRayons.add(ck);
                        selectSegment(proj, item, true, n.pmoSubId);
                    } else if (item) {
                        selectSegment(proj, item, true);
                    } else {
                        window.__activeProjectId = proj.id;
                        renderAll();
                        flyToCoords(proj.items.flatMap(it => it.coords || []));
                    }
                }
            }
        });
        renderPmoNotifsUI();
    }

    // Açılışda race condition olmaması üçün boot hook-ları sinxron olaraq window-a çıxarılır (enterApp paralel çağırır)
    let pmoInitialFetchPromise = null;
    window.__fetchPmoInitialWorkbook = () => {
        if (pmoInitialFetchPromise) return pmoInitialFetchPromise;
        const cfg = loadPmoConfig();
        const targetUrl = cfg.url || DEFAULT_PMO_SHEET_URL;
        if (!targetUrl) return Promise.resolve(null);
        pmoSourceType = "url";
        pmoSourceName = "PMO Google Sheets";
        pmoInitialFetchPromise = fetchPmoWorkbookFromUrl(targetUrl, cfg.useDomainAuth)
            .then(wb => {
                pmoWorkbook = wb;
                return wb;
            })
            .catch(err => {
                console.warn("PMO boot initial fetch error:", err);
                pmoInitialFetchPromise = null;
                return null;
            });
        return pmoInitialFetchPromise;
    };

    window.__applyPmoBootWorkbook = async (wb, silent = true) => {
        if (!wb) return { updated: 0, added: 0 };
        pmoWorkbook = wb;
        pmoLastContentHash = "";
        const res = await applyPmoDataToMap(wb, silent);
        updatePmoLiveIndicators(true, "PMO Google Sheets");
        return res;
    };

    window.__startPmoLiveWatch = () => {
        startPmoLiveWatch();
    };

    document.addEventListener("DOMContentLoaded", initPmoExcelIntegration);
})();

/* === 🎡 3D FİBER BARABAN / ROLİK (SİLİNDİRİK LAYİHƏ ÇARXI) === */
(() => {
    const ROLLER_MODE_KEY = "bcg.list.roller.v1";
    let rollerEnabled = true;
    try {
        rollerEnabled = localStorage.getItem(ROLLER_MODE_KEY) !== "list";
    } catch {}

    let lastSig = "";
    let frontIdx = 0;
    let frontProjectId = "";
    let targetScroll = 0;
    let animRaf = null;
    let scrollRaf = null;
    let snapTimer = null;
    let isProgrammaticAnim = false;
    let wheelTargetIdx = 0;
    let wheelLastTime = 0;

    const elById = id => document.getElementById(id);

    function getLayoutOffsetTop(el, container) {
        let top = 0;
        let cur = el;
        while (cur && cur !== container) {
            top += cur.offsetTop;
            cur = cur.offsetParent;
        }
        return top;
    }

    function getCards(listEl) {
        if (!listEl) return [];
        return Array.from(listEl.querySelectorAll(".project"));
    }

    function isDesktopRollerEligible(listEl, cards) {
        if (!rollerEnabled || !listEl) return false;
        if (window.innerWidth <= 860) return false;
        return cards.length >= 3;
    }

    function updateModeButtonUI() {
        const btn = elById("rollerModeBtn");
        if (!btn) return;
        btn.classList.toggle("active", rollerEnabled);
        btn.innerHTML = rollerEnabled
            ? `<i class="fa-solid fa-circle-notch"></i><span>Qövs</span>`
            : `<i class="fa-solid fa-list"></i><span>Siyahı</span>`;
        btn.title = rollerEnabled
            ? "Fiber Optik Qövs Çarxı aktivdir · Standart siyahıya keçmək üçün klikləyin"
            : "Standart siyahı aktivdir · Fiber Optik Qövs Çarxı rejiminə keçmək üçün klikləyin";
    }

    function getCenterScrollForCard(listEl, card) {
        if (!listEl || !card) return 0;
        const viewH = listEl.clientHeight;
        const cardTop = getLayoutOffsetTop(card, listEl);
        const cardH = card.offsetHeight;
        const maxScroll = Math.max(0, listEl.scrollHeight - viewH);
        const desired = cardTop + (cardH / 2) - (viewH / 2);
        return Math.max(0, Math.min(maxScroll, desired));
    }

    function hasAnyExpandedCard(cards) {
        return cards.some(c => c.classList.contains("expanded"));
    }

    function stopRollerAnim() {
        if (animRaf) {
            cancelAnimationFrame(animRaf);
            animRaf = null;
        }
        isProgrammaticAnim = false;
    }

    function clearCardInlineTransforms(cards) {
        cards.forEach(c => {
            c.style.transform = "";
            c.style.opacity = "";
            c.style.filter = "";
            c.classList.remove("roller-front");
        });
    }

    function syncRailAndHud(cards) {
        const rail = elById("rollerRail");
        const hud = elById("rollerHud");
        const counter = elById("rollerCounter");
        if (counter) {
            counter.textContent = cards.length > 0 ? `${Math.min(frontIdx + 1, cards.length)} / ${cards.length}` : "0 / 0";
        }
        if (rail) {
            const ticks = rail.querySelectorAll(".roller-tick");
            ticks.forEach((tk, idx) => tk.classList.toggle("active", idx === frontIdx));
        }
        if (hud) {
            hud.hidden = cards.length < 3;
        }
    }

    function buildRail(cards) {
        const rail = elById("rollerRail");
        if (!rail) return;
        if (cards.length < 3) {
            rail.hidden = true;
            rail.innerHTML = "";
            return;
        }
        rail.hidden = false;
        rail.innerHTML = cards.map((card, idx) => {
            const tone = card.style.getPropertyValue("--proj-tone") || "#38bdf8";
            const titleEl = card.querySelector(".project-main [title], .project-main strong");
            const title = (titleEl?.getAttribute("title") || titleEl?.textContent || `Layihə #${idx + 1}`).trim();
            const pctEl = card.querySelector(".project-pct-mid, .project-pct");
            const pctTxt = pctEl ? ` · ${pctEl.textContent.trim()}` : "";
            const isHidden = card.classList.contains("hidden-on-map");
            const safeTip = `${idx + 1}. ${title}${pctTxt}`.replace(/"/g, "&quot;");
            return `<button type="button" class="roller-tick ${idx === frontIdx ? "active" : ""} ${isHidden ? "hidden-proj" : ""}" data-roller-idx="${idx}" data-tip="${safeTip}" style="--tick-tone:${tone}" aria-label="${safeTip}"></button>`;
        }).join("");
    }

    function applyRollerTransforms() {
        const stage = elById("projectListStage");
        const listEl = elById("projectList");
        if (!stage || !listEl) return;
        const cards = getCards(listEl);
        if (!stage.classList.contains("roller-on") || cards.length < 3) {
            clearCardInlineTransforms(cards);
            return;
        }

        const viewH = listEl.clientHeight;
        if (viewH < 120) return;

        const midY = listEl.scrollTop + viewH / 2;
        let bestIdx = 0;
        let bestDist = Infinity;
        let anyExpanded = false;

        cards.forEach((card, idx) => {
            const isExp = card.classList.contains("expanded");
            if (isExp) anyExpanded = true;
            const cardTop = getLayoutOffsetTop(card, listEl);
            const cardH = card.offsetHeight;
            const cardMid = cardTop + cardH / 2;
            const dist = cardMid - midY;
            const absDist = Math.abs(dist);
            if (absDist < bestDist) {
                bestDist = absDist;
                bestIdx = idx;
            }

            if (isExp) {
                card.style.transform = "";
                card.style.opacity = "";
                card.style.filter = "";
                return;
            }

            const norm = dist / (viewH * 0.44);
            const c = Math.max(-1.18, Math.min(1.18, norm));
            const absC = Math.abs(c);

            // 🌀 Normal simmetrik Fiber Optik Yarım-Dairə Qövs Çarxı
            const arcX = -(c * c) * 17;
            const yPull = -Math.sign(c) * Math.pow(absC, 1.5) * 10;
            const fanDeg = c * 1.6;
            const scale = Math.max(0.89, 1.01 - absC * 0.09);
            const baseOpacity = Math.max(0.56, 1 - Math.pow(absC, 1.12) * 0.38);
            const isHidden = card.classList.contains("hidden-on-map");
            const opacity = isHidden ? Math.max(0.36, baseOpacity * 0.72) : baseOpacity;

            card.style.transform = `translate3d(${arcX.toFixed(1)}px, ${yPull.toFixed(1)}px, 0) rotateZ(${fanDeg.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
            card.style.opacity = opacity.toFixed(3);
            card.style.filter = "";
        });

        stage.classList.toggle("has-expanded", anyExpanded);
        frontIdx = bestIdx;
        frontProjectId = cards[bestIdx]?.dataset?.id || "";

        cards.forEach((card, idx) => {
            card.classList.toggle("roller-front", idx === bestIdx);
        });
        syncRailAndHud(cards);
    }

    function animateScrollTo(destScroll) {
        const listEl = elById("projectList");
        if (!listEl) return;
        const maxScroll = Math.max(0, listEl.scrollHeight - listEl.clientHeight);
        targetScroll = Math.max(0, Math.min(maxScroll, Math.round(destScroll)));
        isProgrammaticAnim = true;

        if (animRaf) return;
        let frames = 0;
        const step = () => {
            frames++;
            const cur = listEl.scrollTop;
            const diff = targetScroll - cur;
            if (Math.abs(diff) <= 1.2 || frames > 90) {
                listEl.scrollTop = targetScroll;
                animRaf = null;
                isProgrammaticAnim = false;
                applyRollerTransforms();
                return;
            }
            // Minimum 1px addım (brauzer scrollTop tam ədəd yuvarlaqlaşdırmasına ilişib qalmasın!)
            const delta = Math.sign(diff) * Math.max(1, Math.round(Math.abs(diff) * 0.24));
            const prevTop = listEl.scrollTop;
            listEl.scrollTop = prevTop + delta;
            if (listEl.scrollTop === prevTop) {
                animRaf = null;
                isProgrammaticAnim = false;
                applyRollerTransforms();
                return;
            }
            applyRollerTransforms();
            animRaf = requestAnimationFrame(step);
        };
        animRaf = requestAnimationFrame(step);
    }

    function rollToIndex(idx, instant = false) {
        const listEl = elById("projectList");
        if (!listEl) return;
        const cards = getCards(listEl);
        if (cards.length === 0) return;
        const clampedIdx = Math.max(0, Math.min(cards.length - 1, idx));
        wheelTargetIdx = clampedIdx;
        const dest = getCenterScrollForCard(listEl, cards[clampedIdx]);
        if (instant) {
            stopRollerAnim();
            listEl.scrollTop = dest;
            targetScroll = dest;
            applyRollerTransforms();
        } else {
            animateScrollTo(dest);
        }
    }

    function scheduleMagneticSnap(delayMs = 170) {
        if (snapTimer) clearTimeout(snapTimer);
        snapTimer = setTimeout(() => {
            const stage = elById("projectListStage");
            const listEl = elById("projectList");
            if (!stage || !listEl || !stage.classList.contains("roller-on")) return;
            const cards = getCards(listEl);
            if (cards.length < 3 || hasAnyExpandedCard(cards)) return;
            rollToIndex(frontIdx, false);
        }, delayMs);
    }

    function refreshProjectRoller(opts = {}) {
        const stage = elById("projectListStage");
        const listEl = elById("projectList");
        const rail = elById("rollerRail");
        const hud = elById("rollerHud");
        const tip = elById("rollerRailTip");
        updateModeButtonUI();
        if (!stage || !listEl) return;

        const cards = getCards(listEl);
        const eligible = !opts.empty && isDesktopRollerEligible(listEl, cards);
        stage.classList.toggle("roller-on", eligible);

        if (!eligible) {
            stopRollerAnim();
            stage.classList.remove("has-expanded");
            clearCardInlineTransforms(cards);
            if (rail) { rail.hidden = true; rail.innerHTML = ""; }
            if (hud) hud.hidden = true;
            if (tip) tip.hidden = true;
            if (typeof opts.prevScrollTop === "number" && opts.sig === lastSig) {
                listEl.scrollTop = opts.prevScrollTop;
            }
            if (opts.sig !== undefined) lastSig = opts.sig;
            return;
        }

        // Normal simmetrik qövs + yuxarıda artıq boşluq yaratmayan yığcam məsafə
        const wrap = listEl.querySelector(".fiber-bus-wrap");
        const viewH = listEl.clientHeight || 360;
        const firstCardH = cards[0]?.offsetHeight || 68;
        const padTop = Math.min(62, Math.max(24, Math.round((viewH - firstCardH) * 0.22)));
        const padBottom = Math.min(76, Math.max(36, Math.round((viewH - firstCardH) * 0.28)));
        if (wrap) {
            wrap.style.setProperty("--drum-pad-top", `${padTop}px`);
            wrap.style.setProperty("--drum-pad-bottom", `${padBottom}px`);
        }

        const sigChanged = opts.sig !== undefined && opts.sig !== lastSig;
        if (opts.sig !== undefined) lastSig = opts.sig;

        buildRail(cards);

        if (sigChanged) {
            frontIdx = 0;
            wheelTargetIdx = 0;
            rollToIndex(0, true);
        } else if (opts.recenterOnFront && frontProjectId) {
            const matchIdx = cards.findIndex(c => c.dataset.id === frontProjectId);
            rollToIndex(matchIdx >= 0 ? matchIdx : Math.min(frontIdx, cards.length - 1), true);
        } else if (typeof opts.prevScrollTop === "number") {
            const maxScroll = Math.max(0, listEl.scrollHeight - listEl.clientHeight);
            const hasExp = cards.some(c => c.classList.contains("expanded"));
            if (!hasExp && opts.prevScrollTop === 0 && !frontProjectId) {
                rollToIndex(0, true);
            } else {
                listEl.scrollTop = Math.max(0, Math.min(maxScroll, opts.prevScrollTop));
                targetScroll = listEl.scrollTop;
                applyRollerTransforms();
                wheelTargetIdx = frontIdx;
            }
        } else {
            applyRollerTransforms();
            wheelTargetIdx = frontIdx;
        }
    }

    window.refreshProjectRoller = refreshProjectRoller;

    function initProjectRoller() {
        const stage = elById("projectListStage");
        const listEl = elById("projectList");
        const modeBtn = elById("rollerModeBtn");
        const rail = elById("rollerRail");
        const tip = elById("rollerRailTip");
        const hud = elById("rollerHud");
        if (!stage || !listEl) return;

        updateModeButtonUI();

        modeBtn?.addEventListener("click", () => {
            rollerEnabled = !rollerEnabled;
            try { localStorage.setItem(ROLLER_MODE_KEY, rollerEnabled ? "roller" : "list"); } catch {}
            updateModeButtonUI();
            refreshProjectRoller({ recenterOnFront: rollerEnabled });
            if (typeof toast === "function") {
                toast(rollerEnabled ? "🌀 Fiber Optik Qövs Çarxı aktivdir" : "📋 Standart siyahı rejiminə keçildi");
            }
        });

        // Maus təkəri: yumşaq inersiyalı qövs çarxı fırlanması (açıq layihə olduqda sərbəst scroll işləyir, heç vaxt ilişmir)
        listEl.addEventListener("wheel", e => {
            if (!stage.classList.contains("roller-on")) return;
            const cards = getCards(listEl);
            if (cards.length < 3) return;
            // Açıq layihə varsa və ya rayon siyahısı üzərindədirsə, animasiyanı dərhal dayandır və sərbəst scroll ver
            if (e.target.closest(".segments") || hasAnyExpandedCard(cards)) {
                stopRollerAnim();
                if (snapTimer) clearTimeout(snapTimer);
                return;
            }

            e.preventDefault();
            if (snapTimer) clearTimeout(snapTimer);

            const now = performance.now();
            const isDiscreteWheel = e.deltaMode === 1 || Math.abs(e.deltaY) >= 40;
            if (isDiscreteWheel) {
                const dir = e.deltaY > 0 ? 1 : -1;
                if (now - wheelLastTime > 260) {
                    wheelTargetIdx = frontIdx;
                }
                wheelLastTime = now;
                wheelTargetIdx = Math.max(0, Math.min(cards.length - 1, wheelTargetIdx + dir));
                animateScrollTo(getCenterScrollForCard(listEl, cards[wheelTargetIdx]));
            } else {
                const base = isProgrammaticAnim ? targetScroll : listEl.scrollTop;
                animateScrollTo(base + e.deltaY * 1.15);
                scheduleMagneticSnap(180);
            }
        }, { passive: false });

        // Normal scroll / toxunuş zamanı 60fps qövs yeniləmə
        listEl.addEventListener("pointerdown", () => {
            stopRollerAnim();
        }, { passive: true });
        listEl.addEventListener("scroll", () => {
            if (!stage.classList.contains("roller-on")) return;
            if (!scrollRaf) {
                scrollRaf = requestAnimationFrame(() => {
                    scrollRaf = null;
                    applyRollerTransforms();
                });
            }
            if (!isProgrammaticAnim) {
                scheduleMagneticSnap(190);
            }
        }, { passive: true });

        // Klaviatura ↑ / ↓ ilə çarxı fırlatma
        listEl.addEventListener("keydown", e => {
            if (!stage.classList.contains("roller-on")) return;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                const cards = getCards(listEl);
                if (cards.length < 3 || hasAnyExpandedCard(cards)) return;
                e.preventDefault();
                rollToIndex(frontIdx + (e.key === "ArrowDown" ? 1 : -1), false);
            }
        });

        // Layihəyə kliklədikdə: açılıbsa rahat mövqeyə gətir, bağlanıbsa mərkəz qövsə qaytar
        listEl.addEventListener("click", e => {
            if (!stage.classList.contains("roller-on")) return;
            if (e.target.closest("input, .segments, [data-action='edit']")) return;
            const card = e.target.closest(".project");
            if (!card) return;
            const projId = card.dataset.id;
            stopRollerAnim();
            if (snapTimer) clearTimeout(snapTimer);
            setTimeout(() => {
                const freshCards = getCards(listEl);
                const freshCard = freshCards.find(c => c.dataset.id === projId);
                if (!freshCard) return;
                if (freshCard.classList.contains("expanded")) {
                    const cardTop = getLayoutOffsetTop(freshCard, listEl);
                    const targetTop = Math.max(0, cardTop - 16);
                    animateScrollTo(targetTop);
                } else {
                    animateScrollTo(getCenterScrollForCard(listEl, freshCard));
                }
            }, 40);
        });

        // Sağ kənar Fiber İndikatoru: üstünə gələndə ad göstər, klikləyəndə açıq kartı bağlayıb həmin layihəyə fırlan
        rail?.addEventListener("mousemove", e => {
            const tk = e.target.closest(".roller-tick");
            if (!tk || !tip) return;
            tip.textContent = tk.dataset.tip || "";
            const stageRect = stage.getBoundingClientRect();
            const tkRect = tk.getBoundingClientRect();
            const relTop = Math.max(18, Math.min(stageRect.height - 24, (tkRect.top + tkRect.height / 2) - stageRect.top));
            tip.style.top = `${relTop}px`;
            tip.hidden = false;
        });
        rail?.addEventListener("mouseleave", () => {
            if (tip) tip.hidden = true;
        });
        rail?.addEventListener("click", e => {
            const tk = e.target.closest(".roller-tick");
            if (!tk) return;
            const idx = Number(tk.dataset.rollerIdx);
            if (!Number.isFinite(idx)) return;
            if (typeof state !== "undefined" && state.expandedIds && state.expandedIds.size > 0) {
                state.expandedIds.clear();
                if (typeof renderProjects === "function") renderProjects();
            }
            rollToIndex(idx, false);
        });

        // Aşağı sağ HUD ▲ / ▼ düymələri: açıq layihə varsa bağlayıb növbəti layihəyə keç
        hud?.addEventListener("click", e => {
            const btn = e.target.closest("[data-roller-step]");
            if (!btn) return;
            const step = Number(btn.dataset.rollerStep) || 0;
            const targetIdx = frontIdx + step;
            if (typeof state !== "undefined" && state.expandedIds && state.expandedIds.size > 0) {
                state.expandedIds.clear();
                if (typeof renderProjects === "function") renderProjects();
            }
            rollToIndex(targetIdx, false);
        });

        // Pəncərə ölçüsü dəyişəndə baraban mərkəzini yenidən hesabla
        if (typeof ResizeObserver !== "undefined") {
            const ro = new ResizeObserver(() => {
                refreshProjectRoller({ recenterOnFront: false });
            });
            ro.observe(stage);
        } else {
            window.addEventListener("resize", () => refreshProjectRoller({ recenterOnFront: false }));
        }

        // İlk açılışda artıq render olunmuş layihələr varsa barabanı işə sal
        setTimeout(() => refreshProjectRoller({ recenterOnFront: false }), 120);
    }

    document.addEventListener("DOMContentLoaded", initProjectRoller);
})();
