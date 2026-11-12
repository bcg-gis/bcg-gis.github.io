/* BCG GIS paneli: vəziyyət, xəritə, panellər */

const AZERBAIJAN_BOUNDS = [[38.39, 44.77], [41.91, 50.63]];

const STATUS_COLORS = { bitmis: "#22C55E", icrada: "#F59E0B", tehvil: "#3B82F6", layihe: "#EF4444" };
const ENDPOINT_MIN_ZOOM = 0;
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
    notes: [],
    sidebarCategory: "project",
    activeFolders: new Set(["project"]),
    focusMode: false
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

/* Seçilmiş status filtrinə və axtarışa uyğun seqmentlər (Digər qovluğu status filtrindən təsirlənmir, açıq qalır) */
function matchesFilters(project, item) {
    if (project.category !== "other" && state.statusFilter !== "all" && item.status !== state.statusFilter) return false;
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
    if ($("shareBtn")) $("shareBtn").hidden = !isAdmin();
    if ($("noteForm")) $("noteForm").hidden = !isAdmin();
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
    try { localStorage.setItem("bcg.admin.auth_pass.v1", password); } catch {}
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

const STORAGE_IMPORTED_KEY = "bcg.imported_projects.v2";
const SEG_META_STORE_KEY = "bcg.seg.meta.v1";
const PROJ_META_STORE_KEY = "bcg.proj.meta.v1";
const ADMIN_CONTRACTORS_KEY = "bcg.admin.contractors.v2";

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
    if ((isPlaceholderEnd(rawA) || isPlaceholderEnd(rawB)) && /[-–—➔→/]/.test(projName)) {
        const parts = projName.split(/\s*[-–—➔→/]+\s*/).map(s => s.trim()).filter(s => s && !/^(?:fo|of|f)\s*\d+$/i.test(s));
        if (parts.length >= 2) {
            if (isPlaceholderEnd(rawA)) rawA = parts[0];
            if (isPlaceholderEnd(rawB)) rawB = parts[parts.length - 1];
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

function saveProjectOverride(project) {
    if (!project || !project.id) return;
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
}

function saveSegmentOverride(projectId, item) {
    if (!projectId || !item || !item.id) return;
    const map = readStore(SEG_META_STORE_KEY, {}) || {};
    map[`${projectId}:${item.id}`] = {
        name: item.name,
        pointA: item.pointA,
        pointB: item.pointB,
        status: item.status,
        contractor: item.contractor,
        totalKm: item.totalKm,
        doneKm: item.doneKm,
        antennas: item.antennas,
        summary: item.summary,
        rayon: item.rayon,
        fiberCount: item.fiberCount,
        userSetFiber: item.userSetFiber,
        customColor: item.customColor,
        lineWidth: item.lineWidth,
        isPolygon: item.isPolygon,
        polyFilled: item.polyFilled,
        fillColor: item.fillColor,
        fillOpacity: item.fillOpacity,
        holes: item.holes,
        props: item.props
    };
    writeStore(SEG_META_STORE_KEY, map);
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
    const mergedItems = dbItems.map((dbIt, idx) => {
        const locIt = localById.get(dbIt.id) || localItems[idx];
        if (!locIt) return dbIt;
        return {
            ...locIt,
            ...dbIt,
            name: locIt.name || dbIt.name,
            pointA: (dbIt.pointA && !/^(a|mərkəz)$/i.test(dbIt.pointA)) ? dbIt.pointA : (locIt.pointA || dbIt.pointA),
            pointB: (dbIt.pointB && !/^(b|şəbəkə)$/i.test(dbIt.pointB)) ? dbIt.pointB : (locIt.pointB || dbIt.pointB),
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
        const pMap = readStore(PROJ_META_STORE_KEY, {}) || {};
        const sMap = readStore(SEG_META_STORE_KEY, {}) || {};
        (state.projects || []).forEach(p => {
            if (pMap[p.id]) {
                Object.assign(p, pMap[p.id]);
            }
            (p.items || []).forEach(r => {
                const key = `${p.id}:${r.id}`;
                if (sMap[key]) {
                    Object.assign(r, sMap[key]);
                }
                if (r.contractor) {
                    const matched = findContractorInfo(r.contractor);
                    if (matched) {
                        r.contractor = matched.name;
                    } else if (LEGACY_DEMO_CONTRACTORS.has(String(r.contractor).trim().toLowerCase())) {
                        r.contractor = "";
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
    return readStore(STORAGE_IMPORTED_KEY, []);
}

function saveImportedProjects() {
    try {
        const toSave = (state.projects || []).filter(p =>
            p && (p.imported || p.isLocal || p.category === "other" || String(p.id).startsWith("imp_") || String(p.id).startsWith("proj_custom_") || String(p.id).startsWith("proj_local_"))
        );
        writeStore(STORAGE_IMPORTED_KEY, toSave);
    } catch (e) {
        console.warn("saveImportedProjects error:", e);
    }
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

    // Baza layihələri ilə lokal/idxal olunmuş layihələri birləşdir (fayl atributları, lif sayı, poliqon doluluğu itməsin)
    const storedImported = getStoredImportedProjects();
    storedImported.forEach(localProj => {
        if (!localProj || !localProj.id) return;
        const idx = state.projects.findIndex(p => p.id === localProj.id);
        if (idx >= 0) {
            state.projects[idx] = mergeLocalProjectIntoDb(state.projects[idx], localProj);
        } else {
            state.projects.push(localProj);
        }
    });

    applySavedMetaOverrides();
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
    const knownVisible = new Set(state.visibleIds);

    // Mövcud yaddaşda və lokal depoda olan layihələri qoru
    const localImported = state.projects.filter(p =>
        p && (p.imported || p.isLocal || p.category === "other" || String(p.id).startsWith("imp_") || String(p.id).startsWith("proj_custom_") || String(p.id).startsWith("proj_local_"))
    );
    const storedImported = getStoredImportedProjects();

    const localMap = new Map();
    storedImported.forEach(p => { if (p && p.id) localMap.set(p.id, p); });
    localImported.forEach(p => { if (p && p.id) localMap.set(p.id, p); });

    try {
        const fresh = await api.loadAll(state.user.id);
        const dbProjects = fresh.projects || [];

        const merged = [...dbProjects];
        for (const [id, localProj] of localMap.entries()) {
            const idx = merged.findIndex(p => p.id === id);
            if (idx >= 0) {
                merged[idx] = mergeLocalProjectIntoDb(merged[idx], localProj);
            } else {
                merged.push(localProj);
            }
        }
        state.projects = merged;
        if (fresh.contractors) state.contractors = fresh.contractors;
        if (fresh.materials) state.materials = fresh.materials;
        if (fresh.notes) state.notes = fresh.notes;
    } catch (err) {
        console.warn("api.loadAll xətası, lokal məlumatlar saxlanılır:", err);
    }

    applySavedMetaOverrides();
    state.projects.forEach(p => {
        if (!known.has(p.id) || knownVisible.has(p.id) || p.imported) state.visibleIds.add(p.id);
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
    const isOther = (project?.category || state.sidebarCategory) === "other";
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
            status: project.status,
            project_type: project.type || "lines",
            start_date: project.startDate,
            end_date: project.endDate,
            custom_color: defaultOtherColor,
            line_width: defaultOtherWidth,
            poly_fill: curPolyFill
        } : {
            status: "layihe",
            project_type: "lines",
            custom_color: "#38BDF8",
            line_width: 1.8,
            poly_fill: "auto"
        },
        fields: isOther ? [
            { key: "name", label: t("fieldName"), required: true, wide: true },
            { key: "custom_color", label: "🎨 Rəng seçimi (Xətt / Poliqon rəngi)", type: "color", wide: true },
            { key: "line_width", label: "📏 Sərhəd / Xətt qalınlığı (px)", type: "number", wide: true },
            { key: "poly_fill", label: "🔷 Poliqon görünüşü (İçi dolu / boş)", type: "select", wide: true, options: [
                ["auto", "✨ Fayldakı kimi (Avtomatik)"],
                ["filled", "🟦 İçi dolu (Rəngli sahə — məs: Xəzər dənizi)"],
                ["hollow", "⬜ İçi boş (Yalnız sərhəd xətti — məs: Rayonlar)"]
            ] }
        ] : [
            { key: "name", label: t("fieldName"), required: true, wide: true },
            { key: "project_type", label: "Layihə növü", type: "select", options: [["lines", "〰️ Magistral Xətt layihəsi"], ["points", "📍 Nöqtə / Antena layihəsi"]], wide: true },
            { key: "status", label: t("thStatus"), type: "select", options: statusOptions(), wide: true },
            { key: "start_date", label: t("fieldStart"), type: "date" },
            { key: "end_date", label: t("fieldEnd"), type: "date" }
        ],
        onSave: async row => {
            if (project) {
                project.name = row.name;
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
                    category: state.sidebarCategory || "project",
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
                project = newProj;
            }
            saveProjectOverride(project);
            saveImportedProjects();
            try {
                const dbRow = { ...row };
                delete dbRow.custom_color;
                delete dbRow.line_width;
                delete dbRow.poly_fill;
                await api.saveProjectRow(project.id, dbRow);
            } catch (e) {
                console.warn("api.saveProjectRow xətası (lokal qorunur):", e);
            }
        },
        onDelete: project && (async () => {
            state.projects = state.projects.filter(p => p.id !== project.id);
            state.visibleIds.delete(project.id);
            if (state.selected?.projectId === project.id) state.selected = null;
            saveImportedProjects();
            try {
                await api.deleteProject(project.id);
            } catch (e) {
                console.warn("api.deleteProject xətası:", e);
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
    const contractorNames = [...new Set([...Object.keys(adminMap), ...(item?.contractor ? [item.contractor] : [])])].filter(Boolean);
    const currentFiber = item ? getSegmentFiber(item, project) : "";
    const fiberOpts = currentFiber && !FIBER_OPTIONS.includes(currentFiber) ? [currentFiber, ...FIBER_OPTIONS] : FIBER_OPTIONS;
    openEditor({
        title: t(item ? "editSegment" : "addSegment"),
        values: item ? {
            code: item.id, name: item.name, point_a: item.pointA || "", point_b: item.pointB || "", start_date: item.startDate, end_date: item.endDate,
            contractor: item.contractor || "", total_km: item.totalKm, done_km: item.doneKm, status: item.status || "layihe",
            fiber_count: currentFiber,
            custom_color: item.customColor || item.fillColor || (item.isPolygon ? "#38BDF8" : "#38BDF8"),
            line_width: item.lineWidth || (item.isPolygon ? 1.4 : 2.0),
            poly_fill: item.polyFilled === true ? "filled" : (item.polyFilled === false ? "hollow" : "auto"),
            antennas: item.antennas || 0, coords: coordsToText(item.coords)
        } : {
            code: `${isOther ? "RM" : (isPoints ? "PT" : "SEG")}-${Date.now().toString().slice(-4)}`,
            status: "layihe",
            fiber_count: "",
            custom_color: "#38BDF8",
            line_width: 1.8,
            poly_fill: "auto",
            total_km: 0,
            done_km: 0,
            antennas: 0,
            point_a: isOther ? "" : "Mərkəz",
            point_b: isOther ? "" : "Şəbəkə",
            contractor: ""
        },
        fields: [
            { key: "code", label: t("fieldCode"), required: true, wide: isOther },
            ...(!isOther ? [{ key: "status", label: t("thStatus"), type: "select", options: statusOptions() }] : []),
            ...(!isPoints && !isOther ? [{ key: "fiber_count", label: "🔌 Kabelin lif sayı (FO)", type: "select", wide: true, options: [["", "— Fayldan / Təyin edilməyib —"], ...fiberOpts.map(fo => [fo, `🔌 ${fo}`])] }] : []),
            { key: "name", label: t("fieldName"), required: true, wide: true },
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
                { key: "point_a", label: `📍 ${t("pointA")}`, required: true },
                { key: "point_b", label: `📍 ${t("pointB")}`, required: true },
                { key: "start_date", label: t("fieldStart"), type: "date" },
                { key: "end_date", label: t("fieldEnd"), type: "date" },
                { key: "total_km", label: isPoints ? "1. Nəzərdə tutulan (m)" : `1. Nəzərdə tutulan (km)`, type: "number" },
                { key: "done_km", label: isPoints ? "2. Faktiki iş görülən (m)" : `2. Faktiki iş görülən (km)`, type: "number" },
                ...(isPoints ? [{ key: "antennas", label: "Antena sayı (ədəd)", type: "number", wide: true }] : []),
                { key: "contractor", label: "İş icraçısı (Admin Panel qovluğundan)", type: "select", wide: true, options: [["", t("notAssigned")], ...contractorNames.map(n => [n, `👷 ${n}`])] }
            ] : []),
            { key: "coords", label: t("coordsField"), type: "textarea", wide: true, required: true, placeholder: "41.4205, 46.9242", action: { label: t("useLastDrawing"), run: useLastDrawing } }
        ],
        onSave: async row => {
            const parsedCoords = textToCoords(row.coords, (isPoints || isOther) ? 1 : 2);
            const oldCode = item?.id;
            const foVal = normalizeFiberCount(row.fiber_count ?? item?.fiberCount ?? "", "");
            if (item) {
                item.id = row.code;
                item.name = row.name;
                if (!isOther) {
                    item.pointA = row.point_a;
                    item.pointB = row.point_b;
                    item.status = row.status || item.status;
                    item.fiberCount = foVal;
                    item.userSetFiber = Boolean(foVal);
                    item.totalKm = Number(row.total_km) || 0;
                    item.doneKm = Number(row.done_km) || 0;
                    item.contractor = row.contractor || "";
                    item.startDate = row.start_date || "";
                    item.endDate = row.end_date || "";
                    if (isPoints) item.antennas = Number(row.antennas || 0);
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
            } else {
                const col = isOther ? normalizeColorCode(row.custom_color, "#38BDF8") : "";
                const newSeg = {
                    id: row.code,
                    name: row.name,
                    pointA: row.point_a || row.name || "",
                    pointB: row.point_b || "",
                    status: row.status || "layihe",
                    fiberCount: foVal,
                    customColor: col,
                    fillColor: col,
                    lineWidth: isOther ? normalizeLineWidth(row.line_width, 1.8) : 0,
                    isPolygon: row.poly_fill === "filled" ? true : false,
                    polyFilled: row.poly_fill === "filled" ? true : (row.poly_fill === "hollow" ? false : undefined),
                    totalKm: Number(row.total_km) || 0,
                    doneKm: Number(row.done_km) || 0,
                    contractor: row.contractor || "",
                    startDate: row.start_date || "",
                    endDate: row.end_date || "",
                    antennas: Number(row.antennas || 0),
                    coords: parsedCoords
                };
                if (!project.items) project.items = [];
                project.items.push(newSeg);
                item = newSeg;
            }

            saveSegmentOverride(project.id, item);
            saveImportedProjects();

            try {
                const dbRow = { ...row };
                delete dbRow.fiber_count;
                delete dbRow.custom_color;
                delete dbRow.line_width;
                delete dbRow.poly_fill;
                await api.saveSegment(project.id, oldCode || item?.id, {
                    ...dbRow,
                    point_a: item.pointA || "",
                    point_b: item.pointB || "",
                    antennas: Number(row.antennas || 0),
                    contractor: row.contractor || null,
                    coords: parsedCoords
                });
            } catch (e) {
                console.warn("api.saveSegment xətası (lokal qorunur):", e);
            }

            if (item) state.selected = { projectId: project.id, itemId: row.code };
        },
        onDelete: item && (async () => {
            if (project?.items) {
                project.items = project.items.filter(r => r.id !== item.id);
            }
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

/* Hər nöqtə layihəsi üçün fərqli həndəsi işarə (şərti işarə və xəritə üzərində fərqləndirmə) */
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
    const ptProjects = state.projects.filter(isPointProject);
    const idx = ptProjects.findIndex(p => p.id === project.id);
    if (idx >= 0) return POINT_SHAPES[idx % POINT_SHAPES.length];
    let hash = 0;
    const str = String(project.id || project.name || "");
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return POINT_SHAPES[hash % POINT_SHAPES.length];
}

function registerPointShapeImages() {
    if (!map) return;
    const colors = [...Object.values(STATUS_COLORS), "#38BDF8"];
    const size = 44;
    const half = size / 2;
    const r = 13;

    POINT_SHAPES.forEach(shape => {
        colors.forEach(color => {
            const id = `pt-${shape.id}-${color.replace("#", "").toLowerCase()}`;
            if (map.hasImage(id)) return;
            const canvas = document.createElement("canvas");
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext("2d");

            ctx.save();
            ctx.beginPath();
            if (shape.id === "circle") {
                ctx.arc(half, half, r, 0, Math.PI * 2);
            } else if (shape.id === "diamond") {
                ctx.moveTo(half, half - r - 2);
                ctx.lineTo(half + r + 2, half);
                ctx.lineTo(half, half + r + 2);
                ctx.lineTo(half - r - 2, half);
                ctx.closePath();
            } else if (shape.id === "square") {
                const s = r * 1.65;
                ctx.rect(half - s / 2, half - s / 2, s, s);
            } else if (shape.id === "triangle") {
                const tr = r + 3;
                ctx.moveTo(half, half - tr);
                ctx.lineTo(half + tr * 0.92, half + tr * 0.78);
                ctx.lineTo(half - tr * 0.92, half + tr * 0.78);
                ctx.closePath();
            } else if (shape.id === "hexagon") {
                const hr = r + 1.5;
                for (let i = 0; i < 6; i++) {
                    const ang = (Math.PI / 3) * i - Math.PI / 6;
                    const x = half + hr * Math.cos(ang);
                    const y = half + hr * Math.sin(ang);
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.closePath();
            } else if (shape.id === "star") {
                const outer = r + 3.5;
                const inner = r * 0.5;
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

            ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
            ctx.shadowBlur = 4;
            ctx.fillStyle = color;
            ctx.fill();

            ctx.shadowBlur = 0;
            ctx.lineWidth = 3.2;
            ctx.strokeStyle = "#ffffff";
            ctx.stroke();
            ctx.restore();

            map.addImage(id, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
        });
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
}

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
            osm: raster(["0", "1", "2", "3"].map(s => `https://mt${s}.google.com/vt/lyrs=m&hl=az&x={x}&y={y}&z={z}`), 256, 20, "Xəritə məlumatları &copy; Google"),
            carto: raster(esriTiles("Canvas/World_Dark_Gray_Base"), 256, 19, "Xəritə &copy; Esri"),
            routes: empty,
            "route-labels": empty,
            draw: empty
        },
        layers: [
            { id: "bg", type: "background", paint: { "background-color": "#1c2a30" } },
            rasterLayer("esri"), rasterLayer("esri-transport"), rasterLayer("esri-places"), rasterLayer("osm"), rasterLayer("carto"),
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
            /* Mərhələ 1 (Azərbaycan ümumi baxış: zoom < 7.8): yalnız təmiz rəng statusu nöqtəsi */
            { id: "routes-point-overview", type: "circle", source: "routes", maxzoom: 7.8, filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "isRayonPoint"]],
                paint: {
                    "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3.8, 7.8, 5.4],
                    "circle-color": ["get", "color"],
                    "circle-stroke-width": ["case", ["get", "sel"], 1.5, 0],
                    "circle-stroke-color": "#ffffff",
                    "circle-opacity": ["case", ["get", "dim"], 0.28, 0.96]
                } },
            /* Mərhələ 2 (Orta miqyas: zoom >= 7.8): hər layihənin öz fərqli nöqtə işarəsi (adlar hələ çıxmır) */
            { id: "routes-point-halo", type: "circle", source: "routes", minzoom: 7.8, filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "isRayonPoint"]],
                paint: {
                    "circle-radius": ["case", ["get", "sel"], 13, 9.5],
                    "circle-color": ["get", "color"],
                    "circle-opacity": ["case", ["get", "dim"], 0.12, ["case", ["get", "sel"], 0.38, 0.22]],
                    "circle-stroke-color": ["case", ["get", "sel"], "#ffffff", ["get", "color"]],
                    "circle-stroke-width": ["case", ["get", "sel"], 2.2, 1.2],
                    "circle-stroke-opacity": ["case", ["get", "dim"], 0.25, 0.85]
                } },
            { id: "routes-point-shape", type: "symbol", source: "routes", minzoom: 7.8, filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "isRayonPoint"]],
                layout: {
                    "icon-image": ["get", "shapeIcon"],
                    "icon-size": ["interpolate", ["linear"], ["zoom"], 7.8, ["case", ["get", "sel"], 0.96, 0.76], 13, ["case", ["get", "sel"], 1.15, 0.95]],
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
            { id: "routes-point-name", type: "symbol", source: "route-labels", minzoom: 6, maxzoom: 9.6, filter: ["has", "nameImg"],
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
                    "icon-anchor": "top",
                    "icon-offset": [0, 12],
                    "icon-size": 0.80,
                    "icon-padding": 6,
                    "icon-allow-overlap": false,
                    "icon-ignore-placement": false
                },
                paint: { "icon-opacity": ["case", ["get", "dim"], 0.28, 1] } },
            { id: "routes-point-label-near", type: "symbol", source: "route-labels", minzoom: 11, filter: ["has", "labelImg"],
                layout: {
                    "icon-image": ["get", "labelImg"],
                    "icon-anchor": "top",
                    "icon-offset": [0, 12],
                    "icon-size": 0.80,
                    "icon-padding": 6,
                    "icon-allow-overlap": false,
                    "icon-ignore-placement": false
                },
                paint: { "icon-opacity": ["case", ["get", "dim"], 0.28, 1] } },
            /* Rayon xülasəsi: uzaqdan yalnız status rəngli rayon adı, yaxınlaşanda tam kart (antena, kabel, faiz, icraçı) */
            { id: "routes-summary-name", type: "symbol", source: "route-labels", minzoom: 3.5, maxzoom: 7.6, filter: ["has", "summaryNameImg"],
                layout: {
                    "icon-image": ["get", "summaryNameImg"],
                    "icon-anchor": "top",
                    "icon-offset": [0, 9],
                    "icon-size": 0.80,
                    "icon-padding": 4,
                    "icon-allow-overlap": false,
                    "icon-ignore-placement": false
                },
                paint: { "icon-opacity": ["case", ["get", "dim"], 0.28, 1] } },
            { id: "routes-summary-card", type: "symbol", source: "route-labels", minzoom: 7.6, filter: ["has", "summaryCardImg"],
                layout: {
                    "icon-image": ["get", "summaryCardImg"],
                    "icon-anchor": "left",
                    "icon-offset": [14, 0],
                    "icon-size": 0.80,
                    "icon-padding": 6,
                    "icon-allow-overlap": false,
                    "icon-ignore-placement": false
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
        preserveDrawingBuffer: true
    });
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110 }), "bottom-right");
    routePopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "map-tip", offset: 12, maxWidth: "300px" });

    map.on("load", () => {
        registerPointShapeImages();
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
    ["routes-poly-fill", "routes-poly-line", "routes-other", "routes-hit", "routes-other-line", "routes-other-points", "routes-fo-points", "routes-ends", "routes-ends-label", "routes-point-overview", "routes-point-halo", "routes-point-shape", "routes-point-name", "routes-point-label", "routes-point-label-near", "routes-summary-name", "routes-summary-card"].forEach(layer => {
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
        maxZoom: 15,
        duration: 850
    });
}

function switchBaseLayer(name) {
    const base = BASE_MAPS[name];
    currentBase = name;
    ["esri", "osm", "carto"].forEach(id => map.setLayoutProperty(id, "visibility", id === base.raster ? "visible" : "none"));
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

/* Rayon xülasə nöqtəsi — uzaqdan baxışda rayon adı və statusu (məs: Şəki · İcrada — status rəngində, kontrast haşiyə ilə) */
function ensureSummaryNameImage(text, statusText, color) {
    if (!map || !text) return null;
    const displayText = statusText ? `${text} · ${statusText}` : text;
    const light = isLightBaseMap();
    const key = `sumname_v2:${light ? "l" : "d"}:${color}:${displayText}`;
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

/* Rayon xülasə kartı: status rəngli sol zolaq, status rəngli rayon adı, antena / kabel, faiz zolağı və icraçı */
function ensureSummaryCardImage({ name, color, statusText, antennas, doneKm, totalKm, pct, contractor }) {
    if (!map || !name) return null;
    const light = isLightBaseMap();
    const key = `sumcard_v1:${light ? "l" : "d"}:${color}:${name}:${antennas}:${doneKm}:${totalKm}:${contractor}`;
    if (map.hasImage(key)) return key;

    const ratio = 2;
    const padX = 9;
    const padY = 6;
    const stripe = 4;
    const fTitle = `800 13px ${LABEL_FONT}`;
    const fStatus = `700 10.5px ${LABEL_FONT}`;
    const fBody = `600 11.5px ${LABEL_FONT}`;
    const fSmall = `600 10.5px ${LABEL_FONT}`;
    const bodyText = `${antennas} antena · ${formatKm(doneKm)} / ${formatKm(totalKm)} km`;
    const statusLabel = ` · ${statusText}`;
    const contractorText = contractor ? `İcraçı: ${contractor}` : "";

    const m = document.createElement("canvas").getContext("2d");
    m.font = fTitle; const titleW = m.measureText(name).width;
    m.font = fStatus; const statusW = m.measureText(statusLabel).width;
    m.font = fBody; const bodyW = m.measureText(bodyText).width;
    m.font = fSmall; const pctW = m.measureText("100%").width; const cW = contractorText ? m.measureText(contractorText).width : 0;
    const innerW = Math.max(titleW + statusW, bodyW, cW, 120);
    const W = Math.ceil(stripe + padX * 2 + innerW);
    const rows = [17, 16, 12].concat(contractorText ? [15] : []);
    const H = Math.ceil(padY * 2 + rows.reduce((a, b) => a + b, 0));

    const canvas = document.createElement("canvas");
    canvas.width = W * ratio;
    canvas.height = H * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);

    // Kartın fonu (peyk/tünd xəritədə tünd, açıq xəritədə ağ)
    const r = 6;
    ctx.beginPath();
    ctx.moveTo(r, 0); ctx.lineTo(W - r, 0); ctx.quadraticCurveTo(W, 0, W, r);
    ctx.lineTo(W, H - r); ctx.quadraticCurveTo(W, H, W - r, H);
    ctx.lineTo(r, H); ctx.quadraticCurveTo(0, H, 0, H - r);
    ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fillStyle = light ? "rgba(255,255,255,0.94)" : "rgba(10,16,28,0.82)";
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, stripe, H);
    ctx.restore();

    const x0 = stripe + padX;
    const mainColor = light ? "#0F172A" : "#FFFFFF";
    const subColor = light ? "#334155" : "#CBD5E1";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    let y = padY;

    // 1. Rayon adı (status rəngində) + status adı
    ctx.font = fTitle;
    ctx.fillStyle = color;
    ctx.fillText(name, x0, y + rows[0] / 2);
    ctx.font = fStatus;
    ctx.fillText(statusLabel, x0 + titleW, y + rows[0] / 2 + 0.5);
    y += rows[0];

    // 2. Antena və kabel (çəkilən / verilən)
    ctx.font = fBody;
    ctx.fillStyle = mainColor;
    ctx.fillText(bodyText, x0, y + rows[1] / 2);
    y += rows[1];

    // 3. Faiz zolağı (status rəngində)
    const barW = innerW - pctW - 6;
    const barH = 5;
    const barY = y + (rows[2] - barH) / 2;
    ctx.fillStyle = light ? "rgba(15,23,42,0.12)" : "rgba(255,255,255,0.18)";
    ctx.fillRect(x0, barY, barW, barH);
    ctx.fillStyle = color;
    ctx.fillRect(x0, barY, Math.max(0, Math.min(1, pct / 100)) * barW, barH);
    ctx.font = fSmall;
    ctx.fillStyle = mainColor;
    ctx.textAlign = "right";
    ctx.fillText(`${pct}%`, x0 + innerW, y + rows[2] / 2);
    ctx.textAlign = "left";
    y += rows[2];

    // 4. İcraçı
    if (contractorText) {
        ctx.font = fSmall;
        ctx.fillStyle = subColor;
        ctx.fillText(contractorText, x0, y + rows[3] / 2 + 1);
    }

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

function drawRoutes() {
    if (!map) return;
    const source = map.getSource("routes");
    const labelSource = map.getSource("route-labels");
    if (!source) {
        map.once("load", drawRoutes);
        return;
    }
    registerPointShapeImages();
    const selected = selectedEntry();
    const activeProjId = selected ? selected.project.id : window.__activeProjectId || null;
    const features = [];
    const labelFeatures = [];
    const pointSlots = {};
    const placedEndPoints = [];
    const placedEndLabels = [];
    const placedFoPoints = [];
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
        const coords = rawCoords
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
            : (r.customColor ? normalizeColorCode(r.customColor, statusTone(r.status)) : statusTone(r.status));
        const customLineWidth = normalizeLineWidth(r.lineWidth || project.lineWidth, isPolyItem ? 1.3 : (isOther ? 1.8 : 0));

        const shape = getProjectShape(project);
        const shapeIcon = `pt-${shape.id}-${statusTone(r.status).replace("#", "").toLowerCase()}`;
        const dim = Boolean(state.focusMode && activeProjId && project.id !== activeProjId);
        const isSingleCoord = coords.length === 1 || (coords.length === 2 && coords[0][0] === coords[1][0] && coords[0][1] === coords[1][1]);
        const isPointItem = !isPolyItem && (project.type === "points" || isSingleCoord || (r.antennas || 0) > 0);

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
            const nimProps = {
                isRayonPoint: true,
                isNim: true,
                color,
                shapeIcon,
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

        if (isPointItem && isSummaryItem(r)) {
            // Rayon xülasə nöqtəsi: status rəngli nöqtə + status rəngli rayon adı + antena / kabel kartı
            const [lat, lng] = coords[0];
            const stColor = statusTone(r.status);
            const stText = t(`status${r.status}`);
            const rayonName = String(r.name || r.rayon || "").trim();
            const verilenKm = (Number(r.totalKm) || 0) / 1000;
            const cekilenKm = (Number(r.doneKm) || 0) / 1000;
            const pct = percent(cekilenKm, verilenKm);
            const tip = `<b style="color:${stColor}">${esc(rayonName)}</b><small><b style="color:${stColor}">${esc(stText)}</b> · 📡 ${r.antennas || 0} antena<br>🔌 Kabel: ${formatKm(cekilenKm)} / ${formatKm(verilenKm)} km (${pct}%)${r.contractor ? `<br>👷 İcraçı: <b>${esc(r.contractor)}</b>` : ""}</small>`;
            const sumProps = {
                isRayonPoint: true,
                isSummary: true,
                color: stColor,
                shapeIcon,
                dim,
                sel: Boolean(selected?.item === r),
                projectId: project.id,
                itemId: r.id,
                tip,
                summaryNameImg: ensureSummaryNameImage(rayonName, stText, stColor),
                summaryCardImg: ensureSummaryCardImage({
                    name: rayonName, color: stColor, statusText: stText,
                    antennas: r.antennas || 0, doneKm: cekilenKm, totalKm: verilenKm, pct, contractor: r.contractor || ""
                })
            };
            features.push({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: sumProps });
            labelFeatures.push({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: sumProps });
            return;
        }

        if (isPointItem) {
            const [lat, lng] = coords[0];
            const slotKey = `${lat.toFixed(2)}_${lng.toFixed(2)}`;
            const slot = pointSlots[slotKey] || 0;
            pointSlots[slotKey] = slot + 1;
            const adjLng = lng + slot * 0.022;
            const adjLat = lat + (slot % 2 ? 0.008 : 0);

            const cleanName = String(r.name || "").replace(/\s*\(?\bFaz[-\s]*[12]\b\)?/gi, "").replace(/\s*rayon(u)?(?![a-zəçşğıöü])/gi, "").trim();
            const antCount = Number(r.antennas || 0);
            const antPart = antCount ? `${antCount} ant · ` : "";
            const stText = t(`status${r.status}`);
            const distPart = r.totalKm ? `Kabel: ${formatKm(r.doneKm / 1000)} / ${formatKm(r.totalKm / 1000)} km` : "";
            const label = `${cleanName} · ${stText}\n${antPart}${distPart}`.trim();
            const shortLabel = `${cleanName} · ${stText}${antCount ? ` (${antCount} ant)` : ""}`;
            const tip = `<b>${shape.symbol} ${esc(cleanName)}</b><small>Layihə: <b>${esc(project.name)}</b><br><b style="color:${color}">${esc(stText)}</b>${antCount ? ` · 📡 ${antCount} antena` : ""} · Plan: ${formatKm(r.totalKm)} m / Faktiki: ${formatKm(r.doneKm)} m (${percent(r.doneKm, r.totalKm)}%)${cExtra ? `<br>${cExtra}` : ""}</small>`;

            const ptProps = {
                isRayonPoint: true,
                color,
                shapeIcon,
                dim,
                sel: Boolean(selected?.item === r),
                projectId: project.id,
                itemId: r.id,
                label,
                shortLabel,
                tip
            };
            features.push({ type: "Feature", geometry: { type: "Point", coordinates: [adjLng, adjLat] }, properties: ptProps });
            labelFeatures.push({ type: "Feature", geometry: { type: "Point", coordinates: [adjLng, adjLat] }, properties: ptProps });
        } else if (coords.length >= 2) {
            const line = coords.map(([lat, lng]) => [lng, lat]);
            const foLabel = getSegmentFiber(r, project);
            const foImg = foLabel ? ensureFoBadgeImage(foLabel) : null;
            const { nameA, nameB } = resolveLineEndNames(r, project);
            const stText = t(`status${r.status}`);
            const foTipPart = foLabel ? `🔌 <b>${esc(foLabel)}</b> · ` : "";
            // Mouse xəttə yaxınlaşanda (hover): qısa məlumat pəncərəsi
            const lineTip = `<b>${esc(r.name)}</b><small>${foTipPart}<b style="color:${color}">${esc(stText)}</b> · ${formatKm(r.doneKm)} / ${formatKm(r.totalKm)} km (${percent(r.doneKm, r.totalKm)}%)</small>`;

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

function selectSegment(project, item, shouldFly = false) {
    state.selected = { projectId: project.id, itemId: item.id };
    window.__activeProjectId = project.id;
    state.expandedIds.add(project.id);
    setSidebar(true);
    renderAll();
    if (shouldFly) flyToCoords(item.coords);
}

function clearSelection() {
    state.selected = null;
    renderAll();
}

function onMapClick(e) {
    $("coordClicked").value = `${e.lngLat.lat.toFixed(6)}, ${e.lngLat.lng.toFixed(6)}`;
    if (window.handleMapMarkerClick?.(e)) return;
    if (tools.handleClick(e)) return;
    if (isPhone()) {
        setSidebar(false);
        setDrawer(false);
    }
    const box = [[e.point.x - 5, e.point.y - 5], [e.point.x + 5, e.point.y + 5]];
    const hit = map.queryRenderedFeatures(box, { layers: ["routes-summary-card", "routes-summary-name", "routes-point-overview", "routes-point-halo", "routes-point-shape", "routes-point-label", "routes-point-label-near", "routes-point-name", "routes-ends", "routes-ends-label", "routes-other-points", "routes-other-line", "routes-fo-points", "routes-hit", "routes-other", "routes-poly-line", "routes-poly-fill"] })[0];
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
    const activePointProjects = state.projects.filter(p =>
        state.activeFolders.has(p.category || "project") &&
        state.visibleIds.has(p.id) &&
        isPointProject(p)
    );
    const pointProjectsHtml = activePointProjects.length > 0
        ? `<div class="legend-divider"></div><div class="legend-sec-title">Nöqtə layihələri</div>` +
          activePointProjects.map(p => {
              const shape = getProjectShape(p);
              const cleanProjName = String(p.name || "").replace(/\s*\(?\bFaz[-\s]*[12]\b\)?/gi, "").trim();
              const tone = p.category === "other" ? "#38BDF8" : statusTone(p.status);
              return `<div class="legend-row" title="${esc(cleanProjName)}"><span class="legend-shape-badge" style="color:${tone}">${shape.symbol}</span><span class="legend-proj-name">${esc(cleanProjName)}</span></div>`;
          }).join("")
        : "";

    $("legend").innerHTML = STATUSES.map(s => `<div class="legend-row"><span class="legend-line" style="background:${STATUS_COLORS[s]}"></span>${t(`status${s}`)}</div>`).join("")
        + `<div class="legend-row"><span class="legend-line" style="background:#94A3B8"></span>Lif götürülən kabel</div>`
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
    $("statusChips").innerHTML = chips.map(c => `
        <button class="chip ${state.statusFilter === c.key ? "active" : ""}" data-status="${c.key}">
            ${c.color ? `<span class="dot" style="background:${c.color}"></span>` : ""}${c.label} <b>${count(c.key)}</b>
        </button>
    `).join("");
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
    if ($("statusChips")) $("statusChips").hidden = onlyOtherActive;
    if ($("addProjectBtn")) $("addProjectBtn").hidden = !isAdmin() || state.activeFolders.size === 0;

    const folderMeta = {
        project: { title: "<i class=\"fa-solid fa-building\"></i> BCG", list: projectsOnly },
        nim: { title: "<i class=\"fa-solid fa-traffic-light\" style=\"color:#f59e0b\"></i> NİM (Svetofor Kəsişmələri)", list: nimOnly },
        azconnect: { title: "<i class=\"fa-solid fa-globe\" style=\"color:#06b6d4\"></i> Azconnect Xətləri", list: azcOnly },
        other: { title: "<i class=\"fa-solid fa-folder-tree\" style=\"color:#a855f7\"></i> Digər", list: otherOnly }
    };

    const activeOrder = ["project", "nim", "azconnect", "other"].filter(f => state.activeFolders.has(f));
    if (activeOrder.length === 0) {
        if ($("listHeadTitle")) $("listHeadTitle").textContent = "Qovluq seçilməyib";
        $("projectCount").textContent = "-";
        $("projectList").innerHTML = `<div class="empty">Yuxarıdakı yarım dairədən qovluq seçin (🏢 BCG, 🚦 NİM, 🌐 Azconnect, 🗂️ Digər)</div>`;
        return;
    }

    if ($("listHeadTitle")) {
        $("listHeadTitle").innerHTML = activeOrder.length === 1
            ? folderMeta[activeOrder[0]].title
            : "Seçilmiş qovluqlar";
    }

    const showGroupHead = activeOrder.length > 1;
    const filtering = state.statusFilter !== "all" || state.query;
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
                    <div class="project ${visible ? "" : "hidden-on-map"}" data-id="${esc(p.id)}">
                        <div class="project-row" style="padding:6px 10px">
                            <label class="check" title="${t("toggleVisibility")}"><input type="checkbox" data-action="toggle" ${visible ? "checked" : ""}></label>
                            <button class="project-main" data-action="expand" aria-expanded="${expanded}">
                                <strong title="${esc(cleanOtherTitle)}">${esc(cleanOtherTitle)}</strong>
                            </button>
                            <span class="project-pct" style="color:#38BDF8">${p.items.length}</span>
                            ${isAdmin() ? `<button class="icon-btn" data-action="edit" title="${t("editProject")}"><i class="fa-solid fa-pen"></i></button>` : ""}
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
            const pct = percent(sum.done, sum.plan);
            const isNim = p.category === "nim";
            const isPoints = p.type === "points";
            const shape = isPointProject(p) ? getProjectShape(p) : null;
            const shapeBadge = shape ? `<span style="color:${statusTone(p.status)};margin-right:4px" title="Nöqtə işarəsi: ${shape.name}">${shape.symbol}</span>` : "";
            const totalAnt = p.items.reduce((s, r) => s + (r.antennas || 0), 0);
            const cleanProjName = String(p.name || "").replace(/\s*\(?\bFaz[-\s]*[12]\b\)?/gi, "").trim();
            const donePts = p.items.filter(i => i.status === "bitmis" || i.status === "tehvil").length;
            const isHasSum = isPoints && p.items.some(isSummaryItem);
            const subTitle = isNim
                ? `${p.items.length} svetofor kəsişməsi · Hazır: ${donePts}/${p.items.length}`
                : (isPoints
                    ? (isHasSum
                        ? `📡 ${totalAnt} ant · ${formatKm(sum.done / 1000)} / ${formatKm(sum.plan / 1000)} km`
                        : `📡 ${totalAnt} ant · ${formatKm(sum.plan)} m / ${formatKm(sum.done)} m`)
                    : `〰️ ${formatKm(sum.plan)} / ${formatKm(sum.done)} km · Qalıb: ${formatKm(Math.max(0, sum.plan - sum.done))} km`);
            const rightPct = isNim ? `${p.items.length ? Math.round(donePts / p.items.length * 100) : 0}%` : `${pct}%`;

            return `
                <div class="project ${visible ? "" : "hidden-on-map"}" data-id="${esc(p.id)}">
                    <div class="project-row">
                        <label class="check" title="${t("toggleVisibility")}"><input type="checkbox" data-action="toggle" ${visible ? "checked" : ""}></label>
                        <button class="project-main" data-action="expand" aria-expanded="${expanded}">
                            <strong title="${esc(cleanProjName)}">${shapeBadge}${esc(cleanProjName)}</strong>
                            <small>${subTitle}</small>
                        </button>
                        <span class="project-pct">${rightPct}</span>
                        ${isAdmin() ? `<button class="icon-btn" data-action="edit" title="${t("editProject")}"><i class="fa-solid fa-pen"></i></button>` : ""}
                        <button class="icon-btn" data-action="expand" aria-label="${esc(cleanProjName)}"><i class="fa-solid fa-chevron-right chevron ${expanded ? "open" : ""}"></i></button>
                    </div>
                    ${expanded ? `<div class="segments">${filteredItems(p).map(r => {
                        const cleanName = String(r.name || "").replace(/\s*\(?\bFaz[-\s]*[12]\b\)?/gi, "").replace(/\s*rayon(u)?\b/gi, "").trim();
                        const segFo = (!isNim && !isPoints && Array.isArray(r.coords) && r.coords.length >= 2) ? getSegmentFiber(r, p) : "";
                        const foBadge = segFo
                            ? `<span style="background:rgba(14,165,233,0.16);color:#38BDF8;border:1px solid rgba(56,189,248,0.38);border-radius:6px;padding:1px 5px;font-size:10px;font-weight:700;margin-right:4px">${esc(segFo)}</span>`
                            : "";
                        const isSum = isPoints && isSummaryItem(r);
                        const cBrief = r.contractor ? ` · 👷 ${esc(r.contractor)}` : "";
                        const rightText = isNim
                            ? t(`status${r.status}`)
                            : (isPoints
                                ? (isSum
                                    ? `${r.antennas || 0} ant · ${formatKm(r.doneKm / 1000)} / ${formatKm(r.totalKm / 1000)} km${cBrief}`
                                    : `${r.antennas || 0} ant · ${formatKm(r.totalKm)} / ${formatKm(r.doneKm)} m${cBrief}`)
                                : `${formatKm(r.totalKm)} / ${formatKm(r.doneKm)} km (${percent(r.doneKm, r.totalKm)}%)`);
                        return `
                        <button class="segment ${state.selected?.itemId === r.id && state.selected?.projectId === p.id ? "selected" : ""}" data-action="focus" data-item="${esc(r.id)}">
                            <span class="dot" style="background:${statusTone(r.status)}"></span>
                            <span class="segment-name" title="${esc(cleanName)}">${isNim ? "🚦 " : ""}${foBadge}${esc(cleanName)}</span>
                            <span style="color:${statusTone(r.status)};font-weight:600;white-space:nowrap">${rightText}</span>
                        </button>`;
                    }).join("")}${isAdmin() ? `<button class="link add-seg" data-action="addSegment">+ ${t("addSegment")}</button>` : ""}</div>` : ""}
                </div>`;
        }).join(""));
    });

    $("projectCount").textContent = totalShownCount;
    $("projectList").innerHTML = sectionsHtml.join("");
}

function renderDetail() {
    const entry = selectedEntry();
    $("listView").hidden = Boolean(entry);
    $("detailView").hidden = !entry;
    if (!entry) return;

    const { project, item: r } = entry;
    const tone = statusTone(r.status);
    const pct = percent(r.doneKm, r.totalKm);
    const info = findContractorInfo(r.contractor);
    const isLineSeg = Array.isArray(r.coords) && r.coords.length >= 2 && project.type !== "points" && project.category !== "nim";
    const foText = isLineSeg ? getSegmentFiber(r, project) : "";
    const ends = resolveLineEndNames(r, project);
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
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                    <span class="pill" style="--tone:${tone}"><span class="dot" style="background:${tone}"></span>${t(`status${r.status}`)}</span>
                    ${foText ? `<span class="pill" style="--tone:#0EA5E9;background:rgba(14,165,233,0.16);color:#38BDF8;border:1px solid rgba(56,189,248,0.45)">🔌 ${esc(foText)}</span>` : ""}
                </div>
            </div>
            <div class="route">
                <i class="fa-solid fa-location-dot" style="color:${tone}"></i><strong>${esc(ends.aName || r.name)}</strong>
                <span class="stem"></span><span></span>
                <i class="fa-solid fa-location-dot" style="color:${tone}"></i><strong>${esc(ends.bName || r.name)}</strong>
            </div>
            <div>
                <div class="meter-row"><b>${pct}%</b><span class="muted">${formatKm(r.doneKm)} / ${formatKm(r.totalKm)} km</span></div>
                <div class="progress"><span style="width:${pct}%;background:${tone}"></span></div>
            </div>
            <dl class="spec">
                ${foText ? row("Kabelin lif sayı", `<b>🔌 ${esc(foText)}</b>`) : ""}
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
        return `
        <tr data-index="${index}" class="${selected?.item === r ? "selected" : ""}">
            <td><b>📍 ${esc(ends.aName)} ➔ 📍 ${esc(ends.bName)}</b><small>${esc(project.name)} · ${esc(r.name)}${foBadge}</small></td>
            <td>${formatDate(r.startDate)} – ${formatDate(r.endDate)}</td>
            <td>${esc(r.contractor || t("notAssigned"))}</td>
            <td class="num">${formatKm(r.totalKm)} km</td>
            <td class="num">${formatKm(r.doneKm)} km</td>
            <td class="num">${formatKm(Math.max(0, r.totalKm - r.doneKm))} km</td>
            <td>${r.closures || 0} / ${r.manholes || 0}</td>
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
function normalizeKey(k) {
    return String(k || "")
        .trim()
        .toLowerCase()
        .replace(/[\s_\-\.]+/g, "")
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
        .replace(/ə/g, "e").replace(/ı/g, "i").replace(/ç/g, "c").replace(/ş/g, "s");
    if (s.includes("bit") || s.includes("tamam") || s.includes("done") || s.includes("finish")) return "bitmis";
    if (s.includes("icra") || s.includes("gedir") || s.includes("prog") || s.includes("davam")) return "icrada";
    if (s.includes("tehvil") || s.includes("teslim") || s.includes("ready") || s.includes("hazir")) return "tehvil";
    if (s.includes("layi") || s.includes("plan") || s.includes("proy")) return "layihe";
    if (s.includes("lif") || s.includes("kabel")) return "layihe";
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

function parseDistanceMeters(rawVal, colName = "") {
    if (rawVal === undefined || rawVal === null) return null;
    const str = String(rawVal).trim();
    if (!str || /^(?:<null>|null|none|n\/a|-+|—+)$/i.test(str)) return null;

    const hasKm = /km/i.test(str) || /_km/i.test(colName);
    const hasM = !hasKm && (/m\b/i.test(str) || /_m$/i.test(colName) || colName.toLowerCase() === "m");

    const num = Number(str.replace(/,/g, ".").replace(/[^\d.-]/g, ""));
    if (isNaN(num)) return null;

    if (hasKm) return Math.round(num * 1000);
    if (hasM) return Math.round(num);
    // Vahid yazılmayıbsa: 100-dən böyükdürsə metrdir (məs: 6800, 3500), kiçikdirsə km-dir (məs: 6.8, 3.5)
    return num >= 100 ? Math.round(num) : Math.round(num * 1000);
}

function parseAntennaCount(p, nameVal = "", rawDesc = "") {
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
    const rawVerilen = getPropCaseInsensitive(
        p,
        "kabel_verilen_m", "kabel_verilen_km", "kabel_verilen", "verilen_m", "verilen_km", "verilen",
        "kabel_plan_m", "kabel_plan_km", "kabel_plan", "plan_m", "plan_km", "plan",
        "kabel_m", "kabel_km", "kabel", "mesafe_m", "mesafe_km", "mesafe", "uzunluq_m", "uzunluq_km", "uzunluq",
        "total_m", "total_km", "totalm", "totalkm", "m", "km"
    );
    const rawCekilen = getPropCaseInsensitive(
        p,
        "kabel_cekilen_m", "kabel_çəkilən_m", "kabel_cekilen_km", "kabel_çəkilən_km", "kabel_cekilen", "kabel_çəkilən",
        "cekilen_m", "çəkilən_m", "cekilen_km", "çəkilən_km", "cekilen", "çəkilən",
        "kabel_faktiki_m", "kabel_faktiki_km", "kabel_faktiki", "faktiki_m", "faktiki_km", "faktiki",
        "done_m", "done_km", "done", "icra_m", "icra_km", "icra"
    );

    let planMeters = parseDistanceMeters(rawVerilen);
    let doneMeters = parseDistanceMeters(rawCekilen);

    if (planMeters === null) {
        const combined = `${nameVal || ""} ${rawDesc || ""}`;
        const rangeMatch = combined.match(/(\d+(?:[.,]\d+)?)\s*(km|m)?\s*[-–/]\s*(\d+(?:[.,]\d+)?)\s*(km|m)?/i);
        if (rangeMatch) {
            const v1 = rangeMatch[1];
            const u1 = rangeMatch[2] || rangeMatch[4] || "";
            const v2 = rangeMatch[3];
            const u2 = rangeMatch[4] || rangeMatch[2] || "";
            planMeters = parseDistanceMeters(v1 + u1);
            doneMeters = parseDistanceMeters(v2 + u2);
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

            // 2. İcraçı: icraçı, icraci, contractor — Admin Paneldəki İş İcraçıları qovluğu ilə avtomatik uyğunlaşdırılır
            const rawContractor = getPropCaseInsensitive(p, "icraçı", "icraci", "contractor", "icraci_sirket", "icraci_adi", "podratci", "briqada") || "";
            const matchedContractor = findContractorInfo(rawContractor);
            const contractor = matchedContractor ? matchedContractor.name : rawContractor;

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
                // Rayon / Antena nöqtəsi: Antena_say, Verilən və Çəkilən kabel məsafəsi (metr və ya km), Status, İcraçı
                const rawDesc = p._rawDescription || "";
                const antennas = parseAntennaCount(p, nameVal, rawDesc);
                const { planMeters, doneMeters } = parsePointDistances(p, nameVal, rawDesc);
                const rayonName = getPropCaseInsensitive(p, "Rayon", "rayon_adi", "rayonu", "sheher", "bolge") || nameVal;
                const cleanPointName = String(rayonName || nameVal).replace(/\s*rayon(u)?(?![a-zəçşğıöü])/gi, "").trim();
                const isSummary = Boolean(antennas > 0 || planMeters > 0 || doneMeters > 0);

                return {
                    id: `${isSummary ? "RS" : "PT"}-${String(index + 1).padStart(2, "0")}`,
                    name: cleanPointName,
                    rayon: rayonName,
                    summary: isSummary,
                    pointA: cleanPointName || "Mərkəz",
                    pointB: "Şəbəkə",
                    startDate: "", endDate: "", contractor,
                    totalKm: planMeters,
                    doneKm: doneMeters,
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
            const km = Math.round((tools.length(line.coords) / 1000) * 10) / 10;
            const rawTotalKm = getPropCaseInsensitive(p, "totalKm", "total_km", "totalkm", "plan_km", "planKm", "plan", "uzunluq", "length");
            const rawDoneKm = getPropCaseInsensitive(p, "doneKm", "done_km", "donekm", "faktiki_km", "faktiki", "icra", "done");

            // Əgər totalKm boş və ya "-" olarsa, sayt xəttin GPS koordinatlarından faktiki uzunluğu avtomatik hesablayır
            const totalKm = rawTotalKm !== undefined ? parseAttrNumber(rawTotalKm, km) : km;
            // Əgər doneKm boş və ya "-" olarsa, avtomatik 0 qəbul edilir
            const doneKm = rawDoneKm !== undefined ? parseAttrNumber(rawDoneKm, 0) : 0;

            // Kabelin lif sayı (FO 48, FO 24, FO 12 və s. — birbaşa import edilən faylın atributlarından / adından oxunur; şərti rəqəm atılmır)
            const fiberCount = extractFiberFromProps(p, nameVal, line.name, p._folderName, p._rawDescription, fileName) || "";

            return {
                id: `${isPolygon ? "PLY" : "IMP"}-${String(index + 1).padStart(2, "0")}`,
                name: nameVal,
                pointA, pointB, startDate: "", endDate: "", contractor,
                totalKm, doneKm, status, fiberCount, customColor, fillColor, fillOpacity, lineWidth, isPolygon, polyFilled,
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
    const added = [];
    const cat = isAdmin() ? (targetCategory || pendingImportCategory || "project") : "other";
    const polyFillMode = $("importPolyFillMode")?.value || "auto";
    const catLabels = { project: "📁 Layihələr", nim: "🚦 NİM", azconnect: "🌐 Azconnect", other: "🗂️ Digər" };
    for (const file of fileList) {
        try {
            const lines = (await readLines(file)).filter(line => line.coords.length >= 1);
            if (lines.length === 0) {
                toast(`${file.name}: ${t("importNoLines")}`, true);
                continue;
            }
            const project = projectFromFile(file.name, lines, polyFillMode);
            project.id = project.id || (`imp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
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
            if (state.visibleIds.has(project.id)) state.visibleIds.delete(project.id);
            else state.visibleIds.add(project.id);
        } else if (action === "expand") {
            const clickKey = `expand:${project.id}`;
            if (now - lastListClickTime < 450 && lastListClickKey === clickKey) {
                lastListClickTime = 0;
                state.expandedIds.add(project.id);
                state.visibleIds.add(project.id);
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
                selectSegment(project, item, true);
                return;
            }
            // 1x Sol klik: Xəritədə yaxınlaşdırmadan yalnız status pəncərəsini aç
            lastListClickKey = clickKey;
            lastListClickTime = now;
            selectSegment(project, item, false);
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
    else $("login").hidden = false;
}

document.addEventListener("DOMContentLoaded", init);

/* === YENİLİKLƏR: Yığcam Status Pəncərəsi, Çap/PDF Çərçivə Seçimi, Küçə Görünüşü (Pegman), Mənim Konumum, Fokus İşıqlandırma, İstifadəçilər və Anbar Qaimə Filtrləri === */
(() => {
    let activeProjectId = null;
    let myLocationMarker = null;
    let pegmanActive = false;

    const origRenderAll = window.renderAll;
    function updateLegendVisibility() {
        const legend = $("legend");
        if (legend) legend.hidden = state.activeFolders.size === 0 || visibleEntries().length === 0;
    }

    function executorOptionsHtml(currentExec) {
        const cur = String(currentExec || "").trim();
        if (!isAdmin()) {
            if (!cur) return `<span style="font-size:11.5px;color:var(--ink-3)">— Təyin edilməyib —</span>`;
            const info = findContractorInfo(cur);
            const sub = info ? ` (${info.workers || 0} işçi · ${info.machinery || 0} tex.)` : "";
            return `<b style="font-size:11.5px;color:var(--ink)">👷 ${esc(cur)}${esc(sub)}</b>`;
        }
        const adminMap = syncAdminContractors();
        const names = [...new Set(["", ...Object.keys(adminMap), ...(cur ? [cur] : [])])];
        return `<select class="input" data-exec-select>${names.map(name => {
            if (!name) return `<option value="" ${!cur ? "selected" : ""}>— İcraçı seçilməyib —</option>`;
            const info = findContractorInfo(name);
            const sub = info ? ` (${info.workers || 0} işçi · ${info.machinery || 0} tex.)` : "";
            return `<option value="${esc(name)}" ${name === cur ? "selected" : ""}>👷 ${esc(name)}${esc(sub)}</option>`;
        }).join("")}</select>`;
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

        // 4) Map Marker üslubunda Admin Kənar Əlavəetmə Paneli (Mövcud layihə daxilində yeni Xətt və Nöqtə yaratma)
        const mmDock = document.createElement("div");
        mmDock.id = "mapMarkerDock";
        mmDock.className = "map-marker-dock";
        mmDock.hidden = !isAdmin();
        mmDock.innerHTML = `
            <div class="mm-dock-title"><i class="fa-solid fa-compass-drafting"></i> Layihəyə əlavə et</div>
            <button type="button" class="mm-btn" data-mm-start="point" title="Xəritədə nöqtə qoy və mövcud layihəyə əlavə et">
                <i class="fa-solid fa-location-dot"></i> + Yeni Nöqtə
            </button>
            <button type="button" class="mm-btn" data-mm-start="line" title="Xəritədə xətt çək və mövcud layihəyə əlavə et">
                <i class="fa-solid fa-route"></i> + Yeni Xətt
            </button>
        `;
        stage.appendChild(mmDock);

        mmDock.addEventListener("click", e => {
            const btn = e.target.closest("[data-mm-start]");
            if (!btn) return;
            const mode = btn.dataset.mmStart;
            if (mmCreateState && mmCreateState.mode === mode) {
                cancelMapMarkerCreate();
            } else {
                startMapMarkerCreate(mode);
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
                <form id="mmForm" class="edit-form">
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

        card.addEventListener("click", e => {
            const geomBtn = e.target.closest("[data-geom-edit]");
            if (geomBtn) {
                e.stopPropagation();
                const [projectId, itemId] = geomBtn.dataset.geomEdit.split(":");
                startGeomEdit(projectId, itemId);
                return;
            }
            const pick = e.target.closest("[data-pick-seg]");
            if (pick && !e.target.closest("select") && !e.target.closest("button")) {
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
            if (act === "close") {
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
            const nimSt = e.target.closest("[data-nim-status-select]");
            if (nimSt) {
                const [projectId, itemId] = nimSt.dataset.nimStatusSelect.split(":");
                const proj = state.projects.find(p => p.id === projectId);
                const item = proj?.items.find(r => r.id === itemId);
                if (!proj || !item) return;
                item.status = nimSt.value;
                saveSegmentOverride(proj.id, item);
                saveImportedProjects();
                if (isAdmin() && api.configured) {
                    try { await api.saveSegment(proj.id, item.id, { status: item.status }); } catch {}
                }
                recordAuditLog("Status Dəyişikliyi", "🚦 NİM", item.name, `Svetofor nöqtəsinin statusu '${t("status" + item.status)}' olaraq yeniləndi`);
                renderAll();
                toast(`🚦 ${item.name} statusu yeniləndi: ${t("status" + item.status)}`);
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
                item.fiberCount = normalizeFiberCount(foSel.value, "");
                item.userSetFiber = Boolean(item.fiberCount);
                saveSegmentOverride(proj.id, item);
                saveImportedProjects();
                recordAuditLog("Kabel Lif Sayı", proj.category === "azconnect" ? "🌐 Azconnect" : "🏢 BCG", item.name, `Kabelin lif sayı dəyişdirildi: ${item.fiberCount || "Təyin edilməyib"}`);
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
            item.contractor = sel.value;
            saveSegmentOverride(proj.id, item);
            saveImportedProjects();
            if (isAdmin() && api.configured) {
                try {
                    await api.saveSegment(proj.id, item.id, { contractor: item.contractor });
                } catch { /* lokal olaraq da yenilənir */ }
            }
            recordAuditLog("İcraçı Təyini", proj.category === "nim" ? "🚦 NİM" : (proj.category === "azconnect" ? "🌐 Azconnect" : "📁 Layihələr"), item.name, `İcraçı dəyişdirildi: ${item.contractor}`);
            renderAll();
            toast(`İş icraçısı yeniləndi: ${item.contractor}`);
        });
    }

    const AUDIT_STORE_KEY = "bcg.audit.logs.v1";
    const GEOM_STORE_KEY = "bcg.geom.overrides.v1";
    let geomEditState = null;

    function applySavedGeomOverrides() {
        try {
            const saved = readStore(GEOM_STORE_KEY, null);
            if (!saved || typeof saved !== "object") return;
            state.projects.forEach(p => {
                p.items.forEach(item => {
                    const key = `${p.id}:${item.id}`;
                    if (Array.isArray(saved[key]) && saved[key].length >= 1) {
                        item.coords = saved[key].map(c => [Number(c[0]), Number(c[1])]);
                    }
                });
            });
        } catch {}
    }

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
        const { project, item } = geomEditState;
        const newCoords = item.coords.map(c => [Number(Number(c[0]).toFixed(6)), Number(Number(c[1]).toFixed(6))]);
        item.coords = newCoords;

        // Lokal yaddaşda saxla
        const saved = readStore(GEOM_STORE_KEY, {}) || {};
        saved[`${project.id}:${item.id}`] = newCoords;
        writeStore(GEOM_STORE_KEY, saved);

        // Supabase aktivdirsə bazaya da göndər
        if (api.configured) {
            try {
                await api.saveSegment(project.id, item.id, { coords: newCoords });
            } catch { /* lokal olaraq artıq saxlanılıb */ }
        }

        recordAuditLog(
            "Xəritə Redaktəsi",
            project.category === "nim" ? "🚦 NİM" : (project.category === "azconnect" ? "🌐 Azconnect" : "🏢 BCG"),
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
        const catNames = { project: "🏢 BCG", nim: "🚦 NİM", azconnect: "🌐 Azconnect", other: "🗂️ Digər" };

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

        syncMmFormForProject();
        $("mapMarkerModal")?.showModal();
    }

    async function saveMapMarkerItem(event) {
        event.preventDefault();
        if (!mmCreateState) return;

        const projVal = $("mmProjectSelect").value;
        const itemName = $("mmItemName").value.trim();
        const status = $("mmStatusSelect").value || "layihe";
        const contractor = $("mmContractorSelect").value || "";
        const pointA = $("mmPointA").value.trim() || itemName || "Mərkəz";
        const pointB = $("mmPointB").value.trim() || "Şəbəkə";
        const planVal = Math.max(0, Number($("mmPlanVal").value) || 0);
        const doneVal = Math.min(planVal, Math.max(0, Number($("mmDoneVal").value) || 0));
        const antennas = Math.max(0, Number($("mmAntennasVal").value) || 0);

        if (!itemName) {
            $("mmFormError").textContent = "Adı (Name) daxil edin";
            return;
        }

        let coords;
        try {
            coords = textToCoords($("mmCoordsText").value, mmCreateState.mode === "point" ? 1 : 2);
        } catch {
            $("mmFormError").textContent = t("coordsInvalid");
            return;
        }

        let targetProj = state.projects.find(p => p.id === projVal);
        let newProjectMeta = null;

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
                type: mmCreateState.mode === "point" ? "points" : "lines",
                status,
                startDate: "",
                endDate: ""
            };
            targetProj = { ...newProjectMeta, items: [] };
            state.projects.push(targetProj);
            state.visibleIds.add(targetProj.id);
            state.activeFolders.add(activeCat);
        }

        if (!targetProj) return;

        const newItemId = `${mmCreateState.mode === "point" ? "PT" : "LN"}-${Date.now().toString().slice(-4)}`;
        const fiberCount = normalizeFiberCount($("mmFiberSelect")?.value || "FO 48");
        const isTargetOther = targetProj.category === "other";
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
            status,
            fiberCount,
            customColor,
            lineWidth,
            closures: 0,
            manholes: 0,
            antennas: mmCreateState.mode === "point" ? Math.max(1, antennas) : antennas,
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

        // Supabase aktivdirsə bazaya da göndər
        if (api.configured) {
            try {
                await api.saveSegment(targetProj.id, null, {
                    code: newItem.id,
                    name: newItem.name,
                    point_a: newItem.pointA,
                    point_b: newItem.pointB,
                    start_date: newItem.startDate,
                    end_date: null,
                    contractor: newItem.contractor,
                    total_km: newItem.totalKm,
                    done_km: newItem.doneKm,
                    status: newItem.status,
                    antennas: newItem.antennas,
                    coords: newItem.coords
                });
            } catch { /* lokal olaraq saxlanılıb */ }
        }

        recordAuditLog(
            mmCreateState.mode === "point" ? "Yeni Nöqtə Əlavəsi" : "Yeni Xətt Əlavəsi",
            targetProj.category === "nim" ? "🚦 NİM" : (targetProj.category === "azconnect" ? "🌐 Azconnect" : "🏢 BCG"),
            `${targetProj.name} → ${newItem.name}`,
            `Status: ${t("status" + newItem.status)} · Plan: ${newItem.totalKm} / Faktiki: ${newItem.doneKm}`
        );

        $("mapMarkerModal")?.close();
        cancelMapMarkerCreate(true);
        selectSegment(targetProj, newItem);
        toast(`✅ "${newItem.name}" layihəyə (${targetProj.name}) əlavə olundu!`);
    }

    window.handleMapMarkerClick = handleMapMarkerClick;
    function recordAuditLog(actionType, folder, target, details) {
        try {
            const raw = localStorage.getItem(AUDIT_STORE_KEY);
            const list = raw ? JSON.parse(raw) : [];
            const now = new Date();
            const pad = n => String(n).padStart(2, "0");
            const timeStr = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
            const email = state.user?.email || "admin@bcg.az";
            list.unshift({
                id: Date.now(),
                time: timeStr,
                userName: isAdmin() ? "Bağır (Baş Admin)" : email.split("@")[0],
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
                name: "NİM – Bakı Svetofor Kəsişmələri",
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
                name: "NİM – Sumqayıt və Gəncə Svetoforları",
                category: "nim",
                type: "points",
                status: "icrada",
                items: [
                    { id: "NIM-07", name: "Sumqayıt – Sülh küçəsi mərkəzi kəsişmə", status: "bitmis", contractor: "", totalKm: 1, doneKm: 1, antennas: 1, coords: [[40.5897, 49.6686]] },
                    { id: "NIM-08", name: "Gəncə – Heydər Əliyev pr. mərkəzi svetofor", status: "icrada", contractor: "", totalKm: 1, doneKm: 0.5, antennas: 1, coords: [[40.6828, 46.3606]] }
                ]
            };
            state.projects.push(nim1, nim2);
            state.visibleIds.add(nim1.id);
            state.visibleIds.add(nim2.id);
        }
        if (!state.projects.some(p => p.category === "azconnect")) {
            const azc1 = {
                id: "azc_abseron_ring",
                name: "Azconnect – Bakı-Abşeron Magistral Halqası",
                category: "azconnect",
                type: "lines",
                status: "icrada",
                items: [
                    { id: "AZC-01", name: "Bakı Mərkəz – Xırdalan – Sumqayıt xətti", pointA: "Bakı Mərkəz Qovşaq", pointB: "Sumqayıt Stansiya", status: "bitmis", fiberCount: "FO 48", totalKm: 36.4, doneKm: 36.4, contractor: "", coords: [[40.4093, 49.8671], [40.4520, 49.7550], [40.5897, 49.6686]] },
                    { id: "AZC-02", name: "Bakı – Hövsan – Türkan – Zirə xətti", pointA: "Bakı Şərq Qovşaq", pointB: "Zirə Qovşaq", status: "icrada", fiberCount: "FO 24", totalKm: 42.0, doneKm: 28.5, contractor: "", coords: [[40.3890, 49.9520], [40.3690, 50.0850], [40.3640, 50.2910]] }
                ]
            };
            const azc2 = {
                id: "azc_merkez_west",
                name: "Azconnect – Qərb və Mərkəzi Aran Xətti",
                category: "azconnect",
                type: "lines",
                status: "icrada",
                items: [
                    { id: "AZC-03", name: "Hacıqabul – Kürdəmir – Ucar – Yevlax xətti", pointA: "Hacıqabul Qovşaq", pointB: "Yevlax Qovşaq", status: "icrada", fiberCount: "FO 48", totalKm: 168.0, doneKm: 119.5, contractor: "", coords: [[40.0394, 48.9356], [40.3425, 48.1564], [40.5180, 47.6500], [40.6172, 47.1500]] },
                    { id: "AZC-04", name: "Yevlax – Gəncə – Şəmkir xətti", pointA: "Yevlax Qovşaq", pointB: "Şəmkir Stansiya", status: "tehvil", fiberCount: "FO 12", totalKm: 104.5, doneKm: 104.5, contractor: "", coords: [[40.6172, 47.1500], [40.6828, 46.3606], [40.8297, 46.0178]] }
                ]
            };
            state.projects.push(azc1, azc2);
            state.visibleIds.add(azc1.id);
            state.visibleIds.add(azc2.id);
        }
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
        const cleanProjName = String(proj.name || "").replace(/\s*\(?\bFaz[-\s]*[12]\b\)?/gi, "").trim();

        // 🚦 NİM (Svetofor kəsişmə nöqtələri — nöqtənin adı və birbaşa status seçimi)
        if (proj.category === "nim") {
            const doneCount = proj.items.filter(i => i.status === "bitmis" || i.status === "tehvil").length;
            const inProgCount = proj.items.filter(i => i.status === "icrada").length;
            card.innerHTML = `
                <div class="info-card-head">
                    <div>
                        <small style="display:flex;align-items:center;gap:6px">
                            <span class="dot" style="background:${tone}"></span>
                            <span>🚦 NİM · Svetofor kəsişmə nöqtələri (${proj.items.length})</span>
                        </small>
                        <strong>${esc(cleanProjName)}</strong>
                    </div>
                    <div style="display:flex;align-items:center;gap:4px">
                        ${entry ? `<button class="btn btn-outline" style="height:24px;padding:0 8px;font-size:11px;color:#fff;border-color:rgba(255,255,255,0.25)" data-card-act="showAll">Hamısı</button>` : ""}
                        <button class="icon-btn" data-card-act="close" title="${t("close")}"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>
                <div class="info-card-body">
                    ${!entry ? `<div class="info-grid">
                        <div class="info-stat"><small>Cəmi kəsişmə</small><b>${proj.items.length} nöqtə</b></div>
                        <div class="info-stat"><small>Hazır / Təhvil</small><b style="color:#22C55E">${doneCount} nöqtə</b></div>
                        <div class="info-stat"><small>İcrada</small><b style="color:#F59E0B">${inProgCount} nöqtə</b></div>
                    </div>` : ""}
                    <div class="info-sub-list">
                        ${items.map(r => {
                            const rTone = statusTone(r.status);
                            const cInfo = findContractorInfo(r.contractor) || { workers: "—", machinery: "—", engineer: "—" };
                            return `
                                <div class="info-sub-item" data-pick-seg="${esc(proj.id)}:${esc(r.id)}" style="border-color:${entry?.item === r ? rTone : "var(--line)"}">
                                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                                        <strong style="display:flex;align-items:center;gap:6px">
                                            <span class="dot" style="background:${rTone}"></span>
                                            🚦 ${esc(r.name)}
                                        </strong>
                                        <span class="pill" style="--tone:${rTone}">${t(`status${r.status}`)}</span>
                                    </div>
                                    <div class="info-exec-row">
                                        <span class="muted">Nöqtə statusu:</span>
                                        ${isAdmin() ? `
                                        <select class="input" data-nim-status-select="${esc(proj.id)}:${esc(r.id)}">
                                            ${STATUSES.map(s => `<option value="${s}" ${r.status === s ? "selected" : ""}>${t(`status${s}`)}</option>`).join("")}
                                        </select>
                                        ` : `<b style="font-size:11.5px;color:${rTone}">${t(`status${r.status}`)}</b>`}
                                    </div>
                                    <div class="info-exec-row">
                                        <span class="muted">İcraçı:</span>
                                        ${executorOptionsHtml(r.contractor)}
                                    </div>
                                    <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--ink-2)">
                                        ${r.contractor ? `
                                        <span>👷 İşçi: <b>${esc(cInfo.workers)} nəfər</b> · 🚜 Tex.: <b>${esc(cInfo.machinery ?? 0)}</b></span>
                                        <span>📞 <b>${esc(cInfo.engineer || "—")}</b></span>
                                        ` : `<span class="muted">${isAdmin() ? `<a href="admin.html#contractors" target="_blank" style="color:#38BDF8;text-decoration:none">⚙️ Admin Paneldə İcraçı əlavə et</a>` : ""}</span>`}
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

        // A) NÖQTƏ / ANTENA LAYİHƏSİ
        if (isPoints) {
            const totalAnt = proj.items.reduce((s, i) => s + (i.antennas || 0), 0);
            const isHasSum = proj.items.some(isSummaryItem);
            const pUnit = isHasSum ? "km" : "m";
            const pDiv = isHasSum ? 1000 : 1;
            card.innerHTML = `
                <div class="info-card-head">
                    <div>
                        <small style="display:flex;align-items:center;gap:6px">
                            <span class="dot" style="background:${tone}"></span>
                            <span>${t(`status${proj.status}`)} · 📡 ${totalAnt} antena</span>
                        </small>
                        <strong>${esc(cleanProjName)}</strong>
                    </div>
                    <div style="display:flex;align-items:center;gap:4px">
                        ${entry ? `<button class="btn btn-outline" style="height:24px;padding:0 8px;font-size:11px;color:#fff;border-color:rgba(255,255,255,0.25)" data-card-act="showAll">Hamısı</button>` : ""}
                        <button class="icon-btn" data-card-act="close" title="${t("close")}"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>
                <div class="info-card-body">
                    ${!entry ? `<div class="info-grid">
                        <div class="info-stat"><small>1. Nəzərdə tutulan</small><b>${formatKm(sum.plan / pDiv)} ${pUnit}</b></div>
                        <div class="info-stat"><small>2. Faktiki (${pct}%)</small><b>${formatKm(sum.done / pDiv)} ${pUnit}</b></div>
                        <div class="info-stat"><small>Qalıb</small><b>${formatKm(leftVal / pDiv)} ${pUnit}</b></div>
                    </div>` : ""}
                    <div class="info-sub-list">
                        ${items.map(r => {
                            const rTone = statusTone(r.status);
                            const rLeft = Math.max(0, r.totalKm - r.doneKm);
                            const rPct = percent(r.doneKm, r.totalKm);
                            const rSum = isSummaryItem(r);
                            const rUnit = rSum ? "km" : "m";
                            const rDiv = rSum ? 1000 : 1;
                            const cleanName = String(r.name || "").replace(/\s*\(?\bFaz[-\s]*[12]\b\)?/gi, "").replace(/\s*rayon(u)?\b/gi, "").trim();
                            const cInfo = findContractorInfo(r.contractor) || { workers: "—", machinery: "—", engineer: "—" };
                            return `
                                <div class="info-sub-item" data-pick-seg="${esc(proj.id)}:${esc(r.id)}" style="border-color:${entry?.item === r ? rTone : "var(--line)"}">
                                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                                        <strong style="display:flex;align-items:center;gap:6px">
                                            <span class="dot" style="background:${rTone}"></span>
                                            ${esc(cleanName)} (${r.antennas || 0} ant)
                                        </strong>
                                        <span class="pill" style="--tone:${rTone}">${t(`status${r.status}`)}</span>
                                    </div>
                                    <div style="color:var(--ink-2);font-size:11.5px">
                                        Kabel: Verilən <b>${formatKm(r.totalKm / rDiv)} ${rUnit}</b> · Çəkilən: <b style="color:${rTone}">${formatKm(r.doneKm / rDiv)} ${rUnit} (${rPct}%)</b> · Qalıb: <b>${formatKm(rLeft / rDiv)} ${rUnit}</b>
                                    </div>
                                    <div class="info-exec-row">
                                        <span class="muted">İcraçı:</span>
                                        ${executorOptionsHtml(r.contractor)}
                                    </div>
                                    <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--ink-2)">
                                        ${r.contractor ? `
                                        <span>👷 İşçi: <b>${esc(cInfo.workers)} nəfər</b> · 🚜 Tex.: <b>${esc(cInfo.machinery ?? 0)}</b></span>
                                        <span>📞 <b>${esc(cInfo.engineer || "—")}</b></span>
                                        ` : `<span class="muted">${isAdmin() ? `<a href="admin.html#contractors" target="_blank" style="color:#38BDF8;text-decoration:none">⚙️ Admin Paneldə İcraçı əlavə et</a>` : ""}</span>`}
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
        }
        // B) MAGİSTRAL XƏTT LAYİHƏSİ (Yuxarıda ümumi məsafə bloku olmadan, bir xəttin tam məlumatlarını kəsilmədən və yığcam göstərir)
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
                        ${entry ? `<button class="btn btn-outline" style="height:24px;padding:0 8px;font-size:11px;color:#fff;border-color:rgba(255,255,255,0.25)" data-card-act="showAll">Hamısı</button>` : ""}
                        <button class="icon-btn" data-card-act="close" title="${t("close")}"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>
                <div class="info-card-body">
                    <div class="info-sub-list">
                        ${items.map(r => {
                            const rTone = statusTone(r.status);
                            const rLeft = Math.max(0, r.totalKm - r.doneKm);
                            const rPct = percent(r.doneKm, r.totalKm);
                            const foLabel = getSegmentFiber(r, proj);
                            const ends = resolveLineEndNames(r, proj);
                            const cInfo = findContractorInfo(r.contractor) || { workers: "—", machinery: "—", engineer: "—" };
                            return `
                                <div class="info-sub-item" data-pick-seg="${esc(proj.id)}:${esc(r.id)}" style="border-color:${entry?.item === r ? rTone : "var(--line)"}">
                                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
                                        <b>${esc(r.name)}</b>
                                        <div style="display:flex;align-items:center;gap:5px">
                                            ${foLabel ? `<span class="pill" style="--tone:#0EA5E9;background:rgba(14,165,233,0.16);color:#38BDF8;border:1px solid rgba(56,189,248,0.45)">🔌 ${esc(foLabel)}</span>` : ""}
                                            <span class="pill" style="--tone:${rTone}">${t(`status${r.status}`)}</span>
                                        </div>
                                    </div>
                                    <div style="font-size:11.5px;color:var(--ink-2);display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                                        <span>📍 <b>${esc(ends.aName || r.name)}</b></span>
                                        <span style="opacity:0.6">➔</span>
                                        <span>📍 <b>${esc(ends.bName || r.name)}</b></span>
                                    </div>
                                    <div style="color:var(--ink-2);font-size:11.5px">
                                        Plan: <b>${formatKm(r.totalKm)} km</b> · Faktiki: <b style="color:${rTone}">${formatKm(r.doneKm)} km (${rPct}%)</b> · Qalıb: <b>${formatKm(rLeft)} km</b>
                                    </div>
                                    <div class="info-exec-row">
                                        <span class="muted">Kabel lif sayı:</span>
                                        ${fiberOptionsHtml(foLabel)}
                                    </div>
                                    <div class="info-exec-row">
                                        <span class="muted">İcraçı:</span>
                                        ${executorOptionsHtml(r.contractor)}
                                    </div>
                                    <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--ink-2)">
                                        ${r.contractor ? `
                                        <span>👷 İşçi: <b>${esc(cInfo.workers)} nəfər</b> · 🚜 Tex.: <b>${esc(cInfo.machinery ?? 0)}</b></span>
                                        <span>📞 <b>${esc(cInfo.engineer || "—")}</b></span>
                                        ` : `<span class="muted">${isAdmin() ? `<a href="admin.html#contractors" target="_blank" style="color:#38BDF8;text-decoration:none">⚙️ Admin Paneldə İcraçı əlavə et</a>` : ""}</span>`}
                                        ${isAdmin() ? `<button class="btn btn-outline" style="height:22px;padding:0 7px;font-size:10.5px" data-geom-edit="${esc(proj.id)}:${esc(r.id)}" title="Xəttin qırılma nöqtələrini xəritədə sürüşdür"><i class="fa-solid fa-bezier-curve"></i> Xətti sürüşdür</button>` : ""}
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

        $("myLocationBtn")?.addEventListener("click", () => {
            if (!navigator.geolocation) {
                toast("Cihazınızda GPS dəstəklənmir", true);
                return;
            }
            navigator.geolocation.getCurrentPosition(pos => {
                const { latitude: lat, longitude: lng } = pos.coords;
                myLocationMarker?.remove();
                const el = document.createElement("div");
                el.className = "pin";
                myLocationMarker = new maplibregl.Marker({ element: el })
                    .setLngLat([lng, lat])
                    .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(`<b>🧭 Mənim Konumum</b><br>${lat.toFixed(5)}, ${lng.toFixed(5)}`))
                    .addTo(map);
                map.flyTo({ center: [lng, lat], zoom: 15 });
                myLocationMarker.togglePopup();
            }, () => {
                // Demo/ehtiyat olaraq Bakı mərkəzinə apar
                const lat = 40.4093, lng = 49.8671;
                map.flyTo({ center: [lng, lat], zoom: 13 });
                toast("🧭 Cari mövqeyə yönləndirildi (40.4093, 49.8671)");
            });
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
    function loadUsersRegistry() {
        const stored = readStore(USERS_STORE_KEY, null);
        if (stored && Array.isArray(stored) && stored.length) return stored;
        return [
            { id: 1, name: "Bağır (Baş Admin)", email: state.user?.email || "admin@bcg.az", role: "admin", authMode: "Şifrə + Email", passMask: "••••••••" },
            { id: 2, name: "Rəşad Məmmədov", email: "rashad@bcg.az", role: "editor", authMode: "📧 Email kodu ilə", passMask: "OTP" },
            { id: 3, name: "Elvin Hüseynov", email: "elvin@bcg.az", role: "viewer", authMode: "🔑 Şifrə təyin edilib", passMask: "Bcg#2026" }
        ];
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
        const regEmails = loadUsersRegistry().map(u => u.email);
        const emails = [...new Set([...(state.users || []), ...regEmails, state.user?.email].filter(Boolean))];
        const current = sel.value || "all";
        sel.innerHTML = `<option value="all">Hamıya (All)</option>` + emails.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join("");
        sel.value = emails.includes(current) ? current : "all";
    }

    window.renderAll = function () {
        ensureDefaultNimAndAzconnect();
        applySavedCustomItems();
        applySavedGeomOverrides();
        applySavedMetaOverrides();
        if ($("mapMarkerDock")) $("mapMarkerDock").hidden = !isAdmin();
        origRenderAll();
        updateLegendVisibility();
        renderInfoCard();
        populateNoteRecipients();
    };

    document.addEventListener("DOMContentLoaded", () => {
        ensureMapWidgets();
        initRightTools();

        window.addEventListener("storage", e => {
            if (e.key === ADMIN_CONTRACTORS_KEY) {
                syncAdminContractors();
                renderAll();
            }
        });

        // Sol dibdə Yarım Dairə üzərində 4 Qovluq (🏢 BCG, 🚦 NİM, 🌐 Azconnect, 🗂️ Digər)
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
            const fNames = { project: "🏢 BCG", nim: "🚦 NİM", azconnect: "🌐 Azconnect", other: "🗂️ Digər" };

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
                    state.projects.filter(p => (p.category || "project") === folder).forEach(p => state.visibleIds.add(p.id));
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
        $("userAddForm")?.addEventListener("submit", e => {
            e.preventDefault();
            const name = $("uName")?.value.trim();
            const email = $("uEmail")?.value.trim();
            const pass = $("uPass")?.value.trim();
            const role = $("uRole")?.value || "viewer";
            if (!name || !email) return;
            const cleanEmail = email.toLowerCase();
            const list = loadUsersRegistry().filter(u => String(u.email || "").trim().toLowerCase() !== cleanEmail);
            list.unshift({
                id: Date.now(),
                name,
                email,
                password: pass,
                role,
                authMode: pass ? `🔑 Şifrə (${pass})` : "📧 Email kodu ilə",
                passMask: pass || "OTP",
                lastLogin: "Hələ daxil olmayıb",
                lastAction: "Admin tərəfindən yaradıldı"
            });
            writeStore(USERS_STORE_KEY, list);
            $("uName").value = "";
            $("uEmail").value = "";
            $("uPass").value = "";
            renderUsersModal();
            populateNoteRecipients();
            toast(`✅ İstifadəçi əlavə olundu: ${email}`);
        });
        $("usersTableBody")?.addEventListener("click", e => {
            const del = e.target.closest("[data-del-user]");
            if (!del) return;
            const id = Number(del.dataset.delUser);
            const list = loadUsersRegistry().filter(u => u.id !== id);
            writeStore(USERS_STORE_KEY, list);
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
                activeProjectId = projId;
                window.__activeProjectId = projId;
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

        // Material Reyestrinə Axın növü (Anbardan çıxan / İstifadə olunan), Layihə, Material, Anbar Qaiməsi № və Tarix filtrləri əlavə et
        const matModal = $("materialsModal");
        if (matModal && !$("matFilterBar")) {
            const wrap = matModal.querySelector(".table-wrap");
            const bar = document.createElement("div");
            bar.id = "matFilterBar";
            bar.className = "mat-filters";
            bar.innerHTML = `
                <label>
                    <span>Axın növü:</span>
                    <select class="input" id="matFilterFlow">
                        <option value="all">Hamısı (Anbar + İstifadə)</option>
                        <option value="issued">📦 Yalnız Anbardan çıxan</option>
                        <option value="used">🛠️ Yalnız İstifadə olunan</option>
                    </select>
                </label>
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

            ["matFilterFlow", "matFilterProject", "matFilterType", "matFilterFrom", "matFilterTo"].forEach(id => {
                $(id).addEventListener("change", () => window.renderMaterials());
            });
            $("matFilterInvoice").addEventListener("input", () => window.renderMaterials());
            $("matFilterReset").addEventListener("click", () => {
                $("matFilterFlow").value = "all";
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

    // Material Reyestri: Anbardan çıxan + İstifadə olunan + Anbar Qaiməsi № ilə (Qaimə əlavə etmək yalnız Admin üçündür)
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

        const flowVal = $("matFilterFlow")?.value || "all";
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

        const showIssued = flowVal === "all" || flowVal === "issued";
        const showUsed = flowVal === "all" || flowVal === "used";

        if ($("matSummary")) {
            $("matSummary").innerHTML = `
                <span>Göstərilən qaimə qeydləri: <b>${filtered.length}</b> / ${state.materials.length}</span>
                <span>${isAdmin() ? "👑 Admin: Qaimə əlavə və redaktə aktivdir" : "👁️ Baxış rejimi (Qaiməni yalnız Admin əlavə edə bilər)"}</span>
            `;
        }

        $("materialsHead").innerHTML = `<tr>
            <th>Tarix</th>
            <th>📄 Anbar Qaiməsi №</th>
            <th>${t("thProject")}</th>
            <th>${t("thMaterial")}</th>
            ${showIssued ? "<th>📦 Anbardan çıxan</th>" : ""}
            ${showUsed ? "<th>🛠️ İstifadə olunan</th>" : ""}
            <th>${t("thState")}</th>
            ${isAdmin() ? "<th></th>" : ""}
        </tr>`;

        const colSpan = 5 + (showIssued ? 1 : 0) + (showUsed ? 1 : 0) + (isAdmin() ? 1 : 0);

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
                    ${showIssued ? `<td><b style="color:var(--amber)">📦 ${esc(issued)}</b></td>` : ""}
                    ${showUsed ? `<td><b style="color:var(--green)">🛠️ ${esc(used)}</b></td>` : ""}
                    <td>${esc(materialStateLabel(m.state))}</td>
                    ${isAdmin() ? `<td class="num"><button class="icon-btn" data-edit-material="${m.id}" title="${t("editMaterial")}"><i class="fa-solid fa-pen"></i></button></td>` : ""}
                </tr>
            `;
        }).join("") + (isAdmin() ? `<tr class="row-add"><td colspan="${colSpan}"><button class="link" data-edit-material="">+ ${t("addMaterial")} (📄 Anbar Qaiməsi əlavə et — Yalnız Admin)</button></td></tr>` : "");
    };
})();