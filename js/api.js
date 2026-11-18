/* Supabase ilə əlaqə: giriş və məlumat */

const api = (() => {
    const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
    const client = configured ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

    function unwrap({ data, error }) {
        if (error) throw error;
        return data;
    }

    const META_SEP = " ||BCGMETA|| ";

    function packPointBMeta(rawPointB, metaObj) {
        const base = String(rawPointB || "").split(META_SEP)[0].trim();
        if (!metaObj || typeof metaObj !== "object") return base;
        const clean = {};
        for (const [k, v] of Object.entries(metaObj)) {
            if (v !== undefined && v !== null && v !== "" && v !== false) {
                clean[k] = v;
            } else if (k === "pFill" && v === false) {
                clean[k] = false;
            }
        }
        return Object.keys(clean).length > 0 ? `${base}${META_SEP}${JSON.stringify(clean)}` : base;
    }

    function unpackPointBMeta(rawPointB) {
        const s = String(rawPointB || "");
        const idx = s.indexOf(META_SEP);
        if (idx === -1) return { pointB: s, meta: {} };
        const pointB = s.slice(0, idx).trim();
        try {
            const meta = JSON.parse(s.slice(idx + META_SEP.length));
            return { pointB, meta: meta && typeof meta === "object" ? meta : {} };
        } catch {
            return { pointB, meta: {} };
        }
    }

    const toSegment = row => {
        const { pointB, meta } = unpackPointBMeta(row.point_b);
        let coords = row.coords;
        if (meta.pt1 && Array.isArray(coords) && coords.length === 2 && JSON.stringify(coords[0]) === JSON.stringify(coords[1])) {
            coords = [coords[0]];
        }
        const seg = {
            id: row.code,
            name: String(row.name || "").replace(/\s*\(Faz-\d+\)/gi, "").trim(),
            pointA: row.point_a || "",
            pointB: pointB || "",
            startDate: row.start_date || "",
            endDate: row.end_date || "",
            contractor: meta.ctr !== undefined ? meta.ctr : (row.contractor || ""),
            totalKm: meta.tKm !== undefined ? Number(meta.tKm) : Number(row.total_km),
            doneKm: meta.dKm !== undefined ? Number(meta.dKm) : Number(row.done_km),
            status: meta.st || row.status,
            closures: row.closures || 0,
            manholes: row.manholes || 0,
            antennas: meta.ant !== undefined ? Number(meta.ant) : Number(row.antennas || 0),
            coords
        };
        if (meta.unit) seg.unit = meta.unit;
        if (meta.sum !== undefined) seg.summary = Boolean(meta.sum);
        if (meta.ray) seg.rayon = meta.ray;
        if (meta.pTyp) seg.pointType = meta.pTyp;
        if (meta.eLead) seg.execLead = meta.eLead;
        if (meta.eWrk !== undefined) seg.execWorkers = meta.eWrk;
        if (meta.ePhn) seg.execPhone = meta.ePhn;
        if (meta.fo) seg.fiberCount = meta.fo;
        if (meta.uFo) seg.userSetFiber = true;
        if (meta.col) seg.customColor = meta.col;
        if (meta.fCol) seg.fillColor = meta.fCol;
        if (meta.fOp !== undefined) seg.fillOpacity = Number(meta.fOp);
        if (meta.lw) seg.lineWidth = Number(meta.lw);
        if (meta.poly) seg.isPolygon = true;
        if (meta.pFill !== undefined) seg.polyFilled = Boolean(meta.pFill);
        if (meta.cat) seg._metaCat = meta.cat;
        if (meta.pType) seg._metaProjType = meta.pType;
        if (meta.pSt) seg._metaProjSt = meta.pSt;
        if (meta.nim && typeof meta.nim === "object") seg.nimSpec = meta.nim;
        if (Array.isArray(meta.cf)) seg.customFields = meta.cf;
        return seg;
    };

    const detectCategory = (row, items = []) => {
        const metaCat = items.find(i => i && i._metaCat)?._metaCat;
        if (metaCat && ["project", "nim", "azconnect", "other"].includes(metaCat)) return metaCat;
        const rid = String(row.id || "").toLowerCase();
        if (rid.startsWith("imp_other_") || rid.startsWith("other_")) return "other";
        if (rid.startsWith("imp_azconnect_") || rid.startsWith("azc_")) return "azconnect";
        if (rid.startsWith("imp_nim_") || rid.startsWith("nim_")) return "nim";
        try {
            const pMap = JSON.parse(localStorage.getItem("bcg.proj.meta.v1") || "{}");
            if (row.id && pMap[row.id]?.category) return pMap[row.id].category;
            const imp = JSON.parse(localStorage.getItem("bcg.imported_projects.v2") || "[]");
            const found = Array.isArray(imp) ? imp.find(p => p && p.id === row.id) : null;
            if (found?.category) return found.category;
        } catch {}
        const pt = String(row.project_type || "").toLowerCase();
        const nm = String(row.name || "").trim();
        if (pt === "nim" || /^nim\b|^svetofor/i.test(nm)) return "nim";
        if (pt === "azconnect" || /^azconnect\b|^azcon/i.test(nm)) return "azconnect";
        if (pt === "other" || /^(rm\b|rm-|dendrologiya|digər|xəzər|xezer|caspian|rayon\s*sərhəd)/i.test(nm)) return "other";
        return "project";
    };

    const toProject = row => {
        const items = (row.segments || []).map(toSegment).sort((a, b) => a.id.localeCompare(b.id));
        const category = detectCategory(row, items);
        const metaProjType = items.find(i => i && i._metaProjType)?._metaProjType;
        const metaProjSt = items.find(i => i && i._metaProjSt)?._metaProjSt;
        const isPoints = category === "nim" || (category === "project" && (metaProjType === "points" || row.project_type === "points" || items.some(s => s.antennas > 0 || (Array.isArray(s.coords) && s.coords.length === 1))));
        const cleanProjName = String(row.name || "").replace(/\s*-\s*Faz\s*\d+/gi, "").replace(/\s*\(Faz-\d+\)/gi, "").trim();
        return {
            id: row.id, name: cleanProjName, status: metaProjSt || row.status, imported: row.imported,
            category,
            type: category === "azconnect" || category === "other" ? "lines" : (isPoints ? "points" : "lines"),
            startDate: row.start_date || "", endDate: row.end_date || "",
            items
        };
    };

    const toNote = row => ({
        id: row.id, userId: row.user_id, author: row.author,
        recipient: row.recipient || "all", durationHours: row.duration_hours ?? 24,
        expiresAt: row.expires_at, text: row.text, date: row.created_at
    });

    const toMaterial = row => {
        if (!row) return row;
        const { pointB: cleanQty, meta } = unpackPointBMeta(row.quantity);
        return {
            ...row,
            quantity: cleanQty,
            flow: meta.flow || row.flow || "out",
            category: meta.cat || row.category || "",
            supplier: meta.sup || row.supplier || "",
            qty_num: meta.qty !== undefined ? Number(meta.qty) : (Number(String(cleanQty || "").replace(/[^\d.,]/g, "").replace(",", ".")) || 0),
            unit: meta.unit || row.unit || "",
            invoice_no: meta.inv || row.invoice_no || "",
            issued_qty: meta.iq || row.issued_qty || cleanQty,
            used_qty: meta.uq || row.used_qty || cleanQty,
            note: meta.note || row.note || ""
        };
    };

    const USERS_STORAGE_KEY = "bcg.admin.users.v1";
    const DELETED_USERS_KEY = "bcg.deleted.users.v1";
    const LOCAL_SESSION_KEY = "bcg.local.session.v1";
    const DB_SNAPSHOT_KEY = "bcg.db.snapshot.v1";
    const CLOUD_NOTES_KEY = "bcg.cloud.notes.v1";
    const DELETED_PROJECTS_KEY = "bcg.deleted.projects.v1";
    const DELETED_SEGMENTS_KEY = "bcg.deleted.segments.v1";
    const CLOUD_SYNC_TOKEN = "00000000-0000-4000-8000-00000000bc60";

    const LEGACY_TEMPLATE_EMAILS = new Set([
        "admin@bcg.az",
        "rashad@bcg.az",
        "elvin@bcg.az",
        "orxan@bcg.az",
        "kamran@bcg.az"
    ]);

    function getDeletedUsersSet() {
        try {
            const arr = JSON.parse(localStorage.getItem(DELETED_USERS_KEY) || "[]");
            return new Set(Array.isArray(arr) ? arr.map(e => String(e).trim().toLowerCase()) : []);
        } catch {
            return new Set();
        }
    }

    function isLegacyTemplateUser(u) {
        if (!u || !u.email) return true;
        const em = String(u.email).trim().toLowerCase();
        if (u.customAdded) return false;
        return LEGACY_TEMPLATE_EMAILS.has(em);
    }

    function getDeletedProjectsSet() {
        try {
            const arr = JSON.parse(localStorage.getItem(DELETED_PROJECTS_KEY) || "[]");
            return new Set(Array.isArray(arr) ? arr : []);
        } catch {
            return new Set();
        }
    }

    function getDeletedSegmentsSet() {
        try {
            const arr = JSON.parse(localStorage.getItem(DELETED_SEGMENTS_KEY) || "[]");
            return new Set(Array.isArray(arr) ? arr : []);
        } catch {
            return new Set();
        }
    }

    function filterOutDeleted(projList = []) {
        const delProjs = getDeletedProjectsSet();
        const delSegs = getDeletedSegmentsSet();
        return (Array.isArray(projList) ? projList : [])
            .filter(p => p && !delProjs.has(p.id))
            .map(p => ({
                ...p,
                items: (p.items || []).filter(r => r && !delSegs.has(`${p.id}:${r.id}`))
            }));
    }

    function mergeNoteLists(listA = [], listB = []) {
        const map = new Map();
        [...(Array.isArray(listA) ? listA : []), ...(Array.isArray(listB) ? listB : [])].forEach(n => {
            if (n && n.id !== undefined && n.text) {
                map.set(String(n.id), n);
            }
        });
        return [...map.values()].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
    }

    const DEFAULT_ADMIN_USERS = [
        { id: 1, name: "Turan Bağırov (Admin)", email: "turan.bagirov@bcg.az", role: "admin", authMode: "🔑 Şifrə + Email", customAdded: true }
    ];

    function getAdminUsersList() {
        const delUsers = getDeletedUsersSet();
        let stored = null;
        try {
            const raw = JSON.parse(localStorage.getItem(USERS_STORAGE_KEY) || "null");
            if (Array.isArray(raw)) stored = raw;
        } catch {}
        const byEmail = new Map();
        const sourceList = stored !== null ? stored : DEFAULT_ADMIN_USERS;
        sourceList.forEach(u => {
            if (!u || !u.email) return;
            const k = String(u.email).trim().toLowerCase();
            if (delUsers.has(k) || isLegacyTemplateUser(u)) return;
            byEmail.set(k, { ...u });
        });
        if (byEmail.size === 0 && stored === null) {
            DEFAULT_ADMIN_USERS.forEach(u => {
                const k = String(u.email).trim().toLowerCase();
                if (!delUsers.has(k)) byEmail.set(k, { ...u });
            });
        }
        return [...byEmail.values()];
    }

    // Bulud reyestri bir dəfə yüklənir və 60 saniyə ərzində təkrar istifadə olunur (girişdə 2 dəfə yüklənməsin)
    let registryCache = { promise: null, at: 0 };
    function pullCloudRegistry(force = false) {
        if (!force && registryCache.promise && Date.now() - registryCache.at < 60000) return registryCache.promise;
        registryCache = { promise: pullCloudRegistryRaw(), at: Date.now() };
        return registryCache.promise;
    }

    async function pullCloudRegistryRaw() {
        if (!client) return null;
        try {
            const { data, error } = await client.rpc("get_shared_extras", { link: CLOUD_SYNC_TOKEN });
            if (error || !data || !data.view || typeof data.view !== "object") return null;
            const v = data.view;
            if (Array.isArray(v.deletedUsers)) {
                try {
                    const delSet = getDeletedUsersSet();
                    v.deletedUsers.forEach(em => { if (em) delSet.add(String(em).trim().toLowerCase()); });
                    localStorage.setItem(DELETED_USERS_KEY, JSON.stringify([...delSet]));
                } catch {}
            }
            if (Array.isArray(v.adminUsers)) {
                const delUsers = getDeletedUsersSet();
                const localRaw = JSON.parse(localStorage.getItem(USERS_STORAGE_KEY) || "[]");
                const mergedMap = new Map();
                [...v.adminUsers, ...(Array.isArray(localRaw) ? localRaw : [])].forEach(u => {
                    if (!u || !u.email) return;
                    const k = String(u.email).trim().toLowerCase();
                    if (delUsers.has(k) || isLegacyTemplateUser(u)) return;
                    mergedMap.set(k, { ...(mergedMap.get(k) || {}), ...u });
                });
                if (mergedMap.size === 0 && !delUsers.has("turan.bagirov@bcg.az")) {
                    DEFAULT_ADMIN_USERS.forEach(u => mergedMap.set(String(u.email).toLowerCase(), { ...u }));
                }
                localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify([...mergedMap.values()]));
            }
            if (v.contractors && typeof v.contractors === "object" && !Array.isArray(v.contractors)) {
                const curC = JSON.parse(localStorage.getItem("bcg.admin.contractors.v2") || "{}");
                localStorage.setItem("bcg.admin.contractors.v2", JSON.stringify({ ...v.contractors, ...curC }));
            }
            if (Array.isArray(v.bcgLeads) && v.bcgLeads.length > 0) {
                const curL = JSON.parse(localStorage.getItem("bcg.exec.leads.v1") || "[]");
                const lMap = new Map();
                [...v.bcgLeads, ...(Array.isArray(curL) ? curL : [])].forEach(item => {
                    if (item?.name) lMap.set(String(item.name).trim().toLowerCase(), item);
                });
                localStorage.setItem("bcg.exec.leads.v1", JSON.stringify([...lMap.values()]));
            }
            if (v.snapshot && typeof v.snapshot === "object") {
                localStorage.setItem(DB_SNAPSHOT_KEY, JSON.stringify(v.snapshot));
            }
            let curRole = "";
            try { curRole = JSON.parse(localStorage.getItem(LOCAL_SESSION_KEY) || "null")?.role || ""; } catch {}
            if (v.segMeta && typeof v.segMeta === "object" && !Array.isArray(v.segMeta)) {
                const curS = JSON.parse(localStorage.getItem("bcg.seg.meta.v1") || "{}");
                const mergedS = curRole === "admin" ? { ...v.segMeta, ...curS } : { ...curS, ...v.segMeta };
                localStorage.setItem("bcg.seg.meta.v1", JSON.stringify(mergedS));
            }
            if (v.projMeta && typeof v.projMeta === "object" && !Array.isArray(v.projMeta)) {
                const curP = JSON.parse(localStorage.getItem("bcg.proj.meta.v1") || "{}");
                const mergedP = curRole === "admin" ? { ...v.projMeta, ...curP } : { ...curP, ...v.projMeta };
                localStorage.setItem("bcg.proj.meta.v1", JSON.stringify(mergedP));
            }
            if (Array.isArray(v.cloudNotes)) {
                try {
                    const curNotes = JSON.parse(localStorage.getItem(CLOUD_NOTES_KEY) || "[]");
                    localStorage.setItem(CLOUD_NOTES_KEY, JSON.stringify(mergeNoteLists(v.cloudNotes, curNotes)));
                } catch {}
            }
            if (Array.isArray(v.deletedProjects)) {
                try {
                    const set = getDeletedProjectsSet();
                    v.deletedProjects.forEach(id => { if (id) set.add(id); });
                    localStorage.setItem(DELETED_PROJECTS_KEY, JSON.stringify([...set]));
                } catch {}
            }
            if (Array.isArray(v.deletedSegments)) {
                try {
                    const set = getDeletedSegmentsSet();
                    v.deletedSegments.forEach(k => { if (k) set.add(k); });
                    localStorage.setItem(DELETED_SEGMENTS_KEY, JSON.stringify([...set]));
                } catch {}
            }
            if (Array.isArray(v.customItems) && v.customItems.length > 0) {
                try {
                    const delProjs = getDeletedProjectsSet();
                    const delSegs = getDeletedSegmentsSet();
                    const curCustom = JSON.parse(localStorage.getItem("bcg.custom.items.v1") || "[]");
                    const cMap = new Map();
                    [...v.customItems, ...(Array.isArray(curCustom) ? curCustom : [])].forEach(entry => {
                        if (!entry || !entry.projectId || !entry.item?.id) return;
                        if (delProjs.has(entry.projectId) || delSegs.has(`${entry.projectId}:${entry.item.id}`)) return;
                        cMap.set(`${entry.projectId}:${entry.item.id}`, entry);
                    });
                    localStorage.setItem("bcg.custom.items.v1", JSON.stringify([...cMap.values()]));
                } catch {}
            }
            return v;
        } catch {
            return null;
        }
    }

    let lastCloudUpdatedAt = "";
    let localWriteAt = 0;
    let broadcastTimer = null;
    let liveSyncTimer = null;
    let liveChannel = null;

    function scheduleCloudBroadcast() {
        localWriteAt = Date.now();
        clearTimeout(broadcastTimer);
        broadcastTimer = setTimeout(() => {
            syncCloudRegistry().catch(() => {});
        }, 500);
    }

    async function syncCloudRegistry(extraSnapshot = null) {
        if (!client) return;
        try {
            localWriteAt = Date.now();
            const nowIso = new Date().toISOString();
            lastCloudUpdatedAt = nowIso;
            const adminUsers = getAdminUsersList();
            let contractors = {};
            let bcgLeads = [];
            let segMeta = {};
            let projMeta = {};
            let cloudNotes = [];
            let deletedProjects = [];
            let deletedSegments = [];
            let deletedUsers = [];
            let customItems = [];
            let snapshot = extraSnapshot;
            try { contractors = JSON.parse(localStorage.getItem("bcg.admin.contractors.v2") || "{}"); } catch {}
            try { bcgLeads = JSON.parse(localStorage.getItem("bcg.exec.leads.v1") || "[]"); } catch {}
            try { segMeta = JSON.parse(localStorage.getItem("bcg.seg.meta.v1") || "{}"); } catch {}
            try { projMeta = JSON.parse(localStorage.getItem("bcg.proj.meta.v1") || "{}"); } catch {}
            try { cloudNotes = JSON.parse(localStorage.getItem(CLOUD_NOTES_KEY) || "[]"); } catch {}
            try { deletedProjects = [...getDeletedProjectsSet()]; } catch {}
            try { deletedSegments = [...getDeletedSegmentsSet()]; } catch {}
            try { deletedUsers = [...getDeletedUsersSet()]; } catch {}
            try { customItems = JSON.parse(localStorage.getItem("bcg.custom.items.v1") || "[]"); } catch {}
            if (!snapshot) {
                try { snapshot = JSON.parse(localStorage.getItem(DB_SNAPSHOT_KEY) || "null"); } catch {}
            }
            let projectIds = [];
            try {
                const { data: projRows } = await client.from("projects").select("id");
                if (Array.isArray(projRows) && projRows.length > 0) {
                    projectIds = projRows.map(r => r.id).filter(Boolean);
                }
            } catch {}
            if (projectIds.length === 0 && Array.isArray(snapshot?.projects)) {
                projectIds = snapshot.projects.map(p => p.id).filter(Boolean);
            }
            await client.from("share_links").upsert({
                token: CLOUD_SYNC_TOKEN,
                project_ids: projectIds,
                expires_at: null,
                drawings: [],
                view: {
                    adminUsers,
                    contractors,
                    bcgLeads,
                    segMeta,
                    projMeta,
                    cloudNotes,
                    deletedProjects,
                    deletedSegments,
                    deletedUsers,
                    customItems,
                    snapshot,
                    updatedAt: nowIso
                }
            }, { onConflict: "token" });
        } catch (e) {
            console.warn("syncCloudRegistry xətası:", e);
        }
    }

    async function registerAdminUserInCloud(userObj) {
        if (configured && userObj?.email && userObj?.password && String(userObj.password).length >= 6) {
            try {
                const tempClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
                });
                await tempClient.auth.signUp({
                    email: String(userObj.email).trim(),
                    password: String(userObj.password).trim()
                });
            } catch {}
        }
        await syncCloudRegistry();
    }

    function extractUserPassword(u) {
        if (!u) return "";
        if (typeof u.password === "string" && u.password.trim()) return u.password.trim();
        if (typeof u.passMask === "string" && u.passMask.trim() && u.passMask !== "••••••••" && u.passMask !== "OTP") {
            return u.passMask.trim();
        }
        const mode = String(u.authMode || "");
        const m = mode.match(/\(([^)]+)\)/);
        if (m && m[1] && m[1].toUpperCase() !== "OTP") {
            return m[1].trim();
        }
        return "";
    }

    function findAdminPanelUser(email, password) {
        const cleanEmail = String(email || "").trim().toLowerCase();
        const cleanPass = String(password || "").trim();
        if (!cleanEmail || !cleanPass) return null;

        const list = getAdminUsersList();
        const found = list.find(u => String(u.email || "").trim().toLowerCase() === cleanEmail);
        if (!found) return null;

        const storedPass = extractUserPassword(found);
        const isOtpUser = !storedPass && /otp|email\s*kodu/i.test(String(found.authMode || ""));

        if ((storedPass && storedPass === cleanPass) || isOtpUser) {
            return {
                id: found.supabaseId || `local_user_${found.id || cleanEmail}`,
                email: String(found.email).trim(),
                name: found.name || cleanEmail.split("@")[0],
                role: found.role || "viewer",
                isLocalUser: true
            };
        }
        return null;
    }

    function markAdminUserLogin(email) {
        try {
            const cleanEmail = String(email || "").trim().toLowerCase();
            const list = getAdminUsersList();
            const idx = list.findIndex(u => String(u.email || "").trim().toLowerCase() === cleanEmail);
            if (idx >= 0) {
                const now = new Date();
                const pad = n => String(n).padStart(2, "0");
                list[idx].lastLogin = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
                list[idx].lastAction = "Sistemə daxil oldu";
                localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(list));
            }
        } catch {}
    }

    function fallbackSeedProjects() {
        return [
            {
                id: "proj_magistral", name: "1. BCG — Bakı-Quba-Qusar Magistralı", status: "icrada", category: "project", type: "lines",
                startDate: "2026-03-01", endDate: "2026-12-15", imported: false,
                items: [
                    { id: "MAG-01", name: "Bakı - Sumqayıt Magistralı", pointA: "Bakı HQ", pointB: "Sumqayıt ATS", startDate: "2026-03-01", endDate: "2026-06-30", contractor: "", totalKm: 45, doneKm: 45, status: "bitmis", closures: 15, manholes: 10, antennas: 0, coords: [[40.4093, 49.8671], [40.45, 49.8], [40.5897, 49.6686]] },
                    { id: "MAG-02", name: "Sumqayıt - Quba Magistralı", pointA: "Sumqayıt ATS", pointB: "Quba Node", startDate: "2026-04-10", endDate: "2026-09-15", contractor: "", totalKm: 120, doneKm: 85, status: "icrada", closures: 30, manholes: 20, antennas: 0, coords: [[40.5897, 49.6686], [41.1, 49.06], [41.3611, 48.5134]] }
                ]
            },
            {
                id: "proj_gpon_north", name: "2. BCG — Bakı-Şamaxı-Yevlax Magistralı", status: "icrada", category: "project", type: "lines",
                startDate: "2026-04-01", endDate: "2026-11-30", imported: false,
                items: [
                    { id: "NOR-01", name: "Quba Şəhər İçi GPON", pointA: "Quba ATS", pointB: "Zərdabi Qəsəbəsi", startDate: "2026-04-01", endDate: "2026-07-30", contractor: "", totalKm: 35, doneKm: 35, status: "bitmis", closures: 8, manholes: 5, antennas: 0, coords: [[41.3611, 48.5134], [41.39, 48.48]] }
                ]
            },
            {
                id: "proj_gpon_west", name: "3. BCG — Gəncə-Qazax Magistralı", status: "icrada", category: "project", type: "lines",
                startDate: "2026-05-01", endDate: "2026-12-20", imported: false,
                items: [
                    { id: "WES-01", name: "Gəncə Şəhər İçi GPON", pointA: "Gəncə ATS-1", pointB: "Gəncə Mərkəz", startDate: "2026-05-01", endDate: "2026-08-30", contractor: "", totalKm: 65, doneKm: 65, status: "bitmis", closures: 16, manholes: 10, antennas: 0, coords: [[40.6828, 46.3606], [40.72, 46.33]] }
                ]
            },
            {
                id: "proj_absheron", name: "4. Azconnect — Bakı-Sumqayıt Magistralı", status: "bitmis", category: "azconnect", type: "lines",
                startDate: "2025-10-01", endDate: "2026-03-30", imported: false,
                items: [
                    { id: "ABS-01", name: "Xırdalan Şəhər İçi", pointA: "Xırdalan ATS", pointB: "Masazır Qəsəbəsi", startDate: "2025-10-01", endDate: "2025-12-15", contractor: "", totalKm: 35, doneKm: 35, status: "bitmis", closures: 9, manholes: 6, antennas: 0, coords: [[40.4481, 49.755], [40.49, 49.7]] }
                ]
            },
            {
                id: "proj_karabakh", name: "5. BCG — Cənub və Qərb Antena Layihələri", status: "tehvil", category: "project", type: "lines",
                startDate: "2025-05-01", endDate: "2026-02-28", imported: false,
                items: [
                    { id: "KAR-01", name: "Şuşa - Xankəndi Magistralı", pointA: "Şuşa Sub-station", pointB: "Xankəndi Hub", startDate: "2025-05-01", endDate: "2025-09-30", contractor: "", totalKm: 35, doneKm: 35, status: "tehvil", closures: 9, manholes: 6, antennas: 0, coords: [[39.7539, 46.7469], [39.8231, 46.7561]] }
                ]
            }
        ];
    }

    return {
        configured,

        // Giriş səhifəsi açılan kimi bulud reyestrini öncədən yüklə (istifadəçi şifrəni yazarkən)
        prefetch() {
            if (client) pullCloudRegistry().catch(() => {});
        },

        async getUser() {
            // Əvvəlcə lokal sessiyanı yoxla (telefonda və kompüterdə 0 millisaniyədə dərhal açılır)
            try {
                const localUser = JSON.parse(localStorage.getItem(LOCAL_SESSION_KEY) || "null");
                if (localUser && localUser.email) return localUser;
            } catch {}
            try {
                const { data } = await client.auth.getSession();
                if (data?.session?.user) return data.session.user;
            } catch {}
            return null;
        },

        /* { user } və ya { error: "credentials" | "network" } */
        async signIn(email, password) {
            const cleanEmail = String(email || "").trim();
            // Reyestr (artıq səhifə açılanda öncədən yüklənməyə başlayıb) və giriş sorğusu PARALEL gedir
            const registryPromise = pullCloudRegistry().catch(() => null);
            const authPromise = client.auth.signInWithPassword({ email: cleanEmail, password })
                .catch(err => ({ data: null, error: err || { message: "network" }, thrown: true }));
            const authRes = await authPromise;
            if (!authRes.error && authRes.data?.user) {
                // Uğurlu girişdə reyestri gözləmədən dərhal davam et
                registryPromise.then(() => {
                    const m = findAdminPanelUser(cleanEmail, password);
                    markAdminUserLogin(cleanEmail);
                    if (m) localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ ...m, id: authRes.data.user.id, isLocalUser: false }));
                });
                const m0 = findAdminPanelUser(cleanEmail, password);
                if (m0) localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ ...m0, id: authRes.data.user.id, isLocalUser: false }));
                else localStorage.removeItem(LOCAL_SESSION_KEY);
                return { user: authRes.data.user };
            }
            await registryPromise;
            let localMatch = findAdminPanelUser(cleanEmail, password);

            try {
                const { data, error, thrown } = authRes;
                if (thrown) throw error;
                if (!error && data?.user) {
                    markAdminUserLogin(cleanEmail);
                    if (localMatch) {
                        localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ ...localMatch, id: data.user.id, isLocalUser: false }));
                    } else {
                        localStorage.removeItem(LOCAL_SESSION_KEY);
                    }
                    return { user: data.user };
                }

                // Əgər Supabase Auth-da tapılmadısa, amma Admin Paneldə yaradılıbsa (başqa kompüterdə belə):
                if (!localMatch) {
                    await pullCloudRegistry();
                    localMatch = findAdminPanelUser(cleanEmail, password);
                }
                if (localMatch) {
                    markAdminUserLogin(cleanEmail);
                    localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(localMatch));
                    return { user: localMatch };
                }

                return { error: error.status === 400 || /invalid/i.test(error.message) ? "credentials" : "network" };
            } catch {
                if (localMatch) {
                    markAdminUserLogin(cleanEmail);
                    localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(localMatch));
                    return { user: localMatch };
                }
                return { error: "network" };
            }
        },

        async signOut() {
            this.stopLiveSync();
            try { localStorage.removeItem(LOCAL_SESSION_KEY); } catch {}
            return client.auth.signOut().catch(() => {});
        },

        async loadAll(userId) {
            // Bulud reyestri və əsas cədvəllər PARALEL yüklənir (əvvəl ardıcıl idi → 2x gecikmə)
            const registryPromise = pullCloudRegistry().catch(() => null);
            const queriesPromise = Promise.all([
                client.from("profiles").select("id, email, role").order("email"),
                client.from("projects").select("*, segments(*)").order("name"),
                client.from("contractors").select("*"),
                client.from("materials").select("*").order("id"),
                client.from("notes").select("*").order("created_at", { ascending: false })
            ].map(query => query.then(unwrap)));
            queriesPromise.catch(() => {});
            // Admin Paneldə yaradılmış lokal istifadəçilər üçün paylaşılan görünüşü də ƏVVƏLCƏDƏN paralel yüklə
            let preSession = null;
            try { preSession = JSON.parse(localStorage.getItem(LOCAL_SESSION_KEY) || "null"); } catch {}
            let sharedViewPromise = preSession?.isLocalUser ? client.rpc("get_shared_view", { link: CLOUD_SYNC_TOKEN }).then(r => r, () => ({ data: null })) : null;
            const getSharedView = () => sharedViewPromise || (sharedViewPromise = client.rpc("get_shared_view", { link: CLOUD_SYNC_TOKEN }).then(r => r, () => ({ data: null })));
            await registryPromise;
            let contractorMap = {};
            try {
                const savedAdminContractors = JSON.parse(localStorage.getItem("bcg.admin.contractors.v2") || "{}");
                if (savedAdminContractors && typeof savedAdminContractors === "object" && !Array.isArray(savedAdminContractors)) {
                    contractorMap = savedAdminContractors;
                }
            } catch {}

            let localSession = null;
            try {
                localSession = JSON.parse(localStorage.getItem(LOCAL_SESSION_KEY) || "null");
            } catch {}

            const adminUsers = getAdminUsersList();
            const adminUserEmails = adminUsers.map(u => u.email).filter(Boolean);

            try {
                const [profiles, projects, contractors, materials, notes] = await queriesPromise;

                const own = profiles.find(p => p.id === userId);
                const ownEmail = (own?.email || localSession?.email || "").toLowerCase();
                const matchedAdminUser = adminUsers.find(u => String(u.email || "").trim().toLowerCase() === ownEmail);

                const mappedProjects = filterOutDeleted(projects.map(toProject));
                // Bulud reyestrindən gələn customItems və segMeta-dakı əlavə nöqtələri də birləşdir
                try {
                    const delProjs = getDeletedProjectsSet();
                    const delSegs = getDeletedSegmentsSet();
                    const customList = JSON.parse(localStorage.getItem("bcg.custom.items.v1") || "[]");
                    if (Array.isArray(customList)) {
                        customList.forEach(entry => {
                            if (!entry || !entry.projectId || !entry.item?.id) return;
                            if (delProjs.has(entry.projectId) || delSegs.has(`${entry.projectId}:${entry.item.id}`)) return;
                            let proj = mappedProjects.find(p => p.id === entry.projectId);
                            if (!proj && entry.newProjectMeta) {
                                proj = { ...entry.newProjectMeta, items: [] };
                                mappedProjects.push(proj);
                            }
                            if (proj && !proj.items.some(i => i.id === entry.item.id)) {
                                proj.items.push(entry.item);
                            }
                        });
                    }
                    const sMeta = JSON.parse(localStorage.getItem("bcg.seg.meta.v1") || "{}");
                    if (sMeta && typeof sMeta === "object") {
                        for (const [k, m] of Object.entries(sMeta)) {
                            if (!m || !Array.isArray(m.coords) || m.coords.length === 0) continue;
                            const sepIdx = k.indexOf(":");
                            if (sepIdx <= 0) continue;
                            const pId = k.slice(0, sepIdx);
                            const sId = k.slice(sepIdx + 1);
                            if (delProjs.has(pId) || delSegs.has(k)) continue;
                            const proj = mappedProjects.find(p => p.id === pId);
                            if (proj && !proj.items.some(i => i.id === sId)) {
                                proj.items.push({ id: sId, ...m });
                            }
                        }
                    }
                } catch {}
                let localCloudNotes = [];
                try { localCloudNotes = JSON.parse(localStorage.getItem(CLOUD_NOTES_KEY) || "[]"); } catch {}
                const mappedNotes = mergeNoteLists(notes.map(toNote), localCloudNotes);
                const mappedMaterials = (materials || []).map(toMaterial);

                const delUsersSet = getDeletedUsersSet();
                const cleanUsersList = [...new Set([...profiles.map(p => p.email), ...adminUserEmails])]
                    .filter(em => em && !delUsersSet.has(String(em).trim().toLowerCase()) && !LEGACY_TEMPLATE_EMAILS.has(String(em).trim().toLowerCase()));

                // Əgər bazadan məlumat gəlibsə (məs. Admin sessiyası zamanı), lokal istifadəçilər və digər kompüterlər üçün keşi yenilə
                if (mappedProjects.length > 0) {
                    const snapPayload = {
                        projects: mappedProjects,
                        materials: mappedMaterials,
                        notes: mappedNotes,
                        users: cleanUsersList
                    };
                    try {
                        localStorage.setItem(DB_SNAPSHOT_KEY, JSON.stringify(snapPayload));
                    } catch {}
                    if (own?.role === "admin" || matchedAdminUser?.role === "admin") {
                        // Sinxronizasiya açılışı yavaşlatmasın: 2 saniyə sonra arxa fonda
                        setTimeout(() => syncCloudRegistry().catch(() => {}), 2000);
                    }
                }

                // Əgər lokal istifadəçi ilə başqa kompüterdən girilibsə və RLS səbəbindən bazadan 0 layihə qayıdıbsa, bulud sinxron tokenindən və ya keşdən götür
                if (mappedProjects.length === 0 && localSession) {
                    let sharedProjects = [];
                    try {
                        const sharedRaw = await getSharedView();
                        if (Array.isArray(sharedRaw.data) && sharedRaw.data.length > 0) {
                            sharedProjects = filterOutDeleted(sharedRaw.data.map(toProject));
                        }
                    } catch {}
                    const snap = JSON.parse(localStorage.getItem(DB_SNAPSHOT_KEY) || "null");
                    return {
                        role: matchedAdminUser?.role || localSession.role || "viewer",
                        users: cleanUsersList.length ? cleanUsersList : adminUserEmails,
                        projects: sharedProjects.length ? sharedProjects : filterOutDeleted(snap?.projects?.length ? snap.projects : fallbackSeedProjects()),
                        contractors: contractorMap,
                        materials: snap?.materials || [],
                        notes: mergeNoteLists(localCloudNotes, snap?.notes || [])
                    };
                }

                const resolvedRole = matchedAdminUser?.role || (own ? own.role : (localSession?.role || "manager"));

                return {
                    role: resolvedRole,
                    users: cleanUsersList,
                    projects: mappedProjects,
                    contractors: contractorMap,
                    materials: mappedMaterials,
                    notes: mappedNotes
                };
            } catch (err) {
                // Lokal Admin Panel istifadəçisi üçün buluddan və ya keşdən yüklə
                if (localSession) {
                    const ownEmail = String(localSession.email || "").trim().toLowerCase();
                    const matchedAdminUser = adminUsers.find(u => String(u.email || "").trim().toLowerCase() === ownEmail);
                    let sharedProjects = [];
                    try {
                        const sharedRaw = await getSharedView();
                        if (Array.isArray(sharedRaw.data) && sharedRaw.data.length > 0) {
                            sharedProjects = filterOutDeleted(sharedRaw.data.map(toProject));
                        }
                    } catch {}
                    let snap = null;
                    try { snap = JSON.parse(localStorage.getItem(DB_SNAPSHOT_KEY) || "null"); } catch {}
                    let fallbackCloudNotes = [];
                    try { fallbackCloudNotes = JSON.parse(localStorage.getItem(CLOUD_NOTES_KEY) || "[]"); } catch {}
                    return {
                        role: matchedAdminUser?.role || localSession.role || "viewer",
                        users: snap?.users || adminUserEmails,
                        projects: sharedProjects.length ? sharedProjects : filterOutDeleted(snap?.projects?.length ? snap.projects : fallbackSeedProjects()),
                        contractors: contractorMap,
                        materials: snap?.materials || [],
                        notes: mergeNoteLists(fallbackCloudNotes, snap?.notes || [])
                    };
                }
                throw err;
            }
        },

        async addNote(text, recipient = "all", durationHours = 24) {
            const hours = Number(durationHours) || 0;
            const expires_at = hours > 0 ? new Date(Date.now() + hours * 3600000).toISOString() : null;
            let localSession = null;
            try { localSession = JSON.parse(localStorage.getItem(LOCAL_SESSION_KEY) || "null"); } catch {}
            let noteObj = null;
            try {
                noteObj = toNote(unwrap(await client.from("notes").insert({
                    text, recipient: recipient || "all", duration_hours: hours, expires_at
                }).select().single()));
            } catch {
                // Əgər Supabase notes cədvəli RLS və ya sütun fərqinə görə bloklasa, həm də hamı yaza bilsin deyə:
                let authUser = null;
                try { authUser = (await client.auth.getUser())?.data?.user || null; } catch {}
                const sender = localSession || authUser || { id: "user", email: "istifadeci@bcg.az" };
                noteObj = {
                    id: Date.now(),
                    userId: sender.id,
                    author: sender.email,
                    recipient: recipient || "all",
                    durationHours: hours,
                    expiresAt: expires_at,
                    text,
                    date: new Date().toISOString()
                };
            }
            try {
                const curCloud = JSON.parse(localStorage.getItem(CLOUD_NOTES_KEY) || "[]");
                localStorage.setItem(CLOUD_NOTES_KEY, JSON.stringify(mergeNoteLists([noteObj], curCloud)));
                const snap = JSON.parse(localStorage.getItem(DB_SNAPSHOT_KEY) || "{}");
                snap.notes = mergeNoteLists([noteObj], snap.notes || []);
                localStorage.setItem(DB_SNAPSHOT_KEY, JSON.stringify(snap));
            } catch {}
            syncCloudRegistry().catch(() => {});
            return noteObj;
        },

        async deleteNote(id) {
            try {
                await client.from("notes").delete().eq("id", id);
            } catch {}
            try {
                const curCloud = JSON.parse(localStorage.getItem(CLOUD_NOTES_KEY) || "[]");
                localStorage.setItem(CLOUD_NOTES_KEY, JSON.stringify(curCloud.filter(n => String(n.id) !== String(id))));
                const snap = JSON.parse(localStorage.getItem(DB_SNAPSHOT_KEY) || "{}");
                if (Array.isArray(snap.notes)) {
                    snap.notes = snap.notes.filter(n => String(n.id) !== String(id));
                    localStorage.setItem(DB_SNAPSHOT_KEY, JSON.stringify(snap));
                }
            } catch {}
            syncCloudRegistry().catch(() => {});
        },

        /* Layihə və seqmentləri bazada saxla. Əgər FK və ya constraint xətası olarsa təhlükəsiz bərpa et */
        async saveProject(project) {
            const VALID_DB_STATUSES = ["bitmis", "icrada", "tehvil", "layihe"];
            const dbStatus = VALID_DB_STATUSES.includes(project.status) ? project.status : "layihe";
            const dbType = project.type === "points" ? "points" : "lines";
            let pRes = await client.from("projects").upsert({
                id: project.id,
                name: project.name,
                status: dbStatus,
                project_type: dbType,
                imported: true,
                start_date: project.startDate || null,
                end_date: project.endDate || null
            });
            if (pRes.error) {
                pRes = await client.from("projects").upsert({
                    id: project.id,
                    name: project.name,
                    status: dbStatus,
                    imported: true,
                    start_date: project.startDate || null,
                    end_date: project.endDate || null
                });
            }

            // Podratçıların mövcudluğunu yoxla, xarici podratçılarda FK xətası olmasın deyə
            const buildSegmentPayload = (withContractor = true) => {
                const seenCodes = new Set();
                return (project.items || []).filter(r => r && Array.isArray(r.coords) && r.coords.length >= 1).map((r, idx) => {
                    let segCode = String(r.id || `PT-${idx + 1}`).trim();
                    while (seenCodes.has(segCode)) {
                        segCode = `${segCode}_${idx + 1}`;
                    }
                    seenCodes.add(segCode);
                    r.id = segCode;

                    const isSinglePt = Array.isArray(r.coords) && r.coords.length === 1;
                    const safeCoords = isSinglePt
                        ? [r.coords[0], r.coords[0]]
                        : (r.coords || []);
                    const totalKm = Math.max(0, Number(r.totalKm) || 0);
                    const doneKm = Math.max(0, Number(r.doneKm) || 0);
                    const dbTotalKm = Math.max(totalKm, doneKm);
                    const segDbStatus = VALID_DB_STATUSES.includes(r.status) ? r.status : "layihe";
                    const packedPointB = packPointBMeta(r.pointB || "", {
                        cat: project.category || "project",
                        pType: project.type || "lines",
                        pSt: project.status,
                        st: r.status,
                        tKm: totalKm,
                        dKm: doneKm,
                        fo: r.fiberCount,
                        uFo: r.userSetFiber,
                        col: r.customColor,
                        fCol: r.fillColor,
                        fOp: r.fillOpacity,
                        lw: r.lineWidth,
                        poly: r.isPolygon,
                        pFill: r.polyFilled,
                        unit: r.unit,
                        sum: r.summary,
                        ray: r.rayon,
                        pTyp: r.pointType,
                        ctr: r.contractor || "",
                        eLead: r.execLead,
                        eWrk: r.execWorkers,
                        ePhn: r.execPhone,
                        nim: r.nimSpec,
                        cf: Array.isArray(r.customFields) && r.customFields.length ? r.customFields : undefined,
                        ant: Number(r.antennas) || 0,
                        pt1: isSinglePt
                    });
                    return {
                        project_id: project.id,
                        code: segCode,
                        name: r.name || "",
                        point_a: r.pointA || r.name || "Mərkəz",
                        point_b: packedPointB,
                        contractor: withContractor ? (r.contractor || null) : null,
                        total_km: dbTotalKm,
                        done_km: doneKm,
                        status: segDbStatus,
                        closures: Number(r.closures) || 0,
                        manholes: Number(r.manholes) || 0,
                        coords: safeCoords
                    };
                });
            };

            const payloadWithCtr = buildSegmentPayload(true);
            if (payloadWithCtr.length > 0) {
                let res = await client.from("segments").upsert(payloadWithCtr, { onConflict: "project_id,code" });
                if (res.error) {
                    // Əgər contractor FK xətası olarsa, contractor-u null edib təkrar cəhd et
                    const retryRes = await client.from("segments").upsert(buildSegmentPayload(false), { onConflict: "project_id,code" });
                    if (retryRes.error) {
                        console.warn("saveProject segments upsert error:", retryRes.error);
                    }
                }
            }
            scheduleCloudBroadcast();
        },

        async deleteProject(id) {
            try {
                const delSet = getDeletedProjectsSet();
                delSet.add(id);
                localStorage.setItem(DELETED_PROJECTS_KEY, JSON.stringify([...delSet]));
            } catch {}
            // Əvvəlcə layihəyə aid bütün seqmentləri sil ki, FK (foreign key) xətası verməsin
            try { await client.from("segments").delete().eq("project_id", id); } catch {}
            try { await client.from("projects").delete().eq("id", id); } catch {}
            scheduleCloudBroadcast();
        },

        async saveProjectRow(id, row) {
            const VALID_DB_STATUSES = ["bitmis", "icrada", "tehvil", "layihe"];
            const projId = id || `proj_${Date.now()}`;
            const baseRow = {
                id: projId,
                name: row.name,
                status: VALID_DB_STATUSES.includes(row.status) ? row.status : "layihe",
                imported: true,
                start_date: row.start_date || null,
                end_date: row.end_date || null
            };
            let res = await client.from("projects").upsert({
                ...baseRow,
                project_type: row.project_type === "points" ? "points" : "lines"
            });
            if (res.error) {
                res = await client.from("projects").upsert(baseRow);
            }
            scheduleCloudBroadcast();
        },

        async saveSegment(projectId, code, row, extraMeta = null) {
            const VALID_DB_STATUSES = ["bitmis", "icrada", "tehvil", "layihe"];
            const segCode = code || row.code;
            let basePointB = row.point_b;
            let existingMeta = {};
            if (basePointB !== undefined && String(basePointB).includes(META_SEP)) {
                existingMeta = unpackPointBMeta(basePointB).meta;
            } else if (segCode) {
                try {
                    const { data: ex } = await client.from("segments").select("point_b").eq("project_id", projectId).eq("code", segCode).maybeSingle();
                    if (ex?.point_b !== undefined) {
                        if (basePointB === undefined) basePointB = ex.point_b;
                        existingMeta = unpackPointBMeta(ex.point_b).meta;
                    }
                } catch {}
            }
            const hasTotal = row.total_km !== undefined;
            const hasDone = row.done_km !== undefined;
            const totalKm = hasTotal ? Math.max(0, Number(row.total_km) || 0) : undefined;
            const doneKm = hasDone ? Math.max(0, Number(row.done_km) || 0) : undefined;
            const isSinglePt = Array.isArray(row.coords) && row.coords.length === 1;
            const mergedMeta = {
                ...existingMeta,
                ...(extraMeta || {}),
                ...(hasTotal ? { tKm: totalKm } : {}),
                ...(hasDone ? { dKm: doneKm } : {}),
                ...(row.status ? { st: row.status } : {}),
                ...(row.contractor !== undefined ? { ctr: row.contractor || "" } : {}),
                ...(row.antennas !== undefined ? { ant: Number(row.antennas) || 0 } : {}),
                ...(isSinglePt ? { pt1: true } : {})
            };
            const safeRow = {
                project_id: projectId,
                code: segCode
            };
            if (hasTotal || hasDone) {
                const tVal = totalKm ?? Math.max(0, Number(existingMeta.tKm) || 0);
                const dVal = doneKm ?? Math.max(0, Number(existingMeta.dKm) || 0);
                safeRow.total_km = Math.max(tVal, dVal);
                safeRow.done_km = dVal;
            }
            if (row.name !== undefined) safeRow.name = row.name;
            if (row.point_a !== undefined) safeRow.point_a = row.point_a;
            if (basePointB !== undefined || Object.keys(mergedMeta).length > 0) {
                safeRow.point_b = packPointBMeta(basePointB || "", mergedMeta);
            }
            if (row.start_date !== undefined) safeRow.start_date = row.start_date || null;
            if (row.end_date !== undefined) safeRow.end_date = row.end_date || null;
            if (row.contractor !== undefined) safeRow.contractor = row.contractor || null;
            if (row.closures !== undefined) safeRow.closures = Number(row.closures) || 0;
            if (row.manholes !== undefined) safeRow.manholes = Number(row.manholes) || 0;
            if (row.status !== undefined) {
                safeRow.status = VALID_DB_STATUSES.includes(row.status) ? row.status : "layihe";
            }
            if (Array.isArray(row.coords)) {
                safeRow.coords = isSinglePt ? [row.coords[0], row.coords[0]] : row.coords;
            }
            let res = await client.from("segments").upsert(safeRow, { onConflict: "project_id,code" });
            if (res.error) {
                // Əgər contractor FK xətası olarsa, contractor sütununu null edib point_b meta-sı (ctr) ilə yaz
                res = await client.from("segments").upsert({ ...safeRow, contractor: null }, { onConflict: "project_id,code" });
                if (res.error) {
                    console.warn("saveSegment error:", res.error);
                }
            }
            scheduleCloudBroadcast();
        },

        async deleteSegment(projectId, code) {
            try {
                const delSet = getDeletedSegmentsSet();
                delSet.add(`${projectId}:${code}`);
                localStorage.setItem(DELETED_SEGMENTS_KEY, JSON.stringify([...delSet]));
            } catch {}
            try { await client.from("segments").delete().eq("project_id", projectId).eq("code", code); } catch {}
            scheduleCloudBroadcast();
        },

        /* Ad dəyişəndə seqmentlərdəki ad bazada FK (on update cascade) ilə yenilənir */
        async saveContractor(name, row) {
            const query = name ? client.from("contractors").update(row).eq("name", name) : client.from("contractors").insert(row);
            unwrap(await query);
        },

        async deleteContractor(name) {
            unwrap(await client.from("contractors").delete().eq("name", name));
        },

        async saveMaterial(id, row) {
            const qtyNum = Number(row.qty_num ?? String(row.quantity || row.issued_qty || row.used_qty || "").replace(/[^\d.,]/g, "").replace(",", ".")) || 0;
            const unit = row.unit || (/km\b/i.test(String(row.quantity || "")) ? "km" : (/əd|eded|pcs/i.test(String(row.quantity || "")) ? "əd" : "m"));
            const displayQty = row.quantity || (qtyNum ? `${qtyNum} ${unit}` : "");
            const packedQty = packPointBMeta(displayQty, {
                flow: row.flow || "out",
                cat: row.category || "",
                sup: row.supplier || "",
                qty: qtyNum,
                unit,
                inv: row.invoice_no || "",
                iq: row.issued_qty || displayQty,
                uq: row.used_qty || displayQty,
                note: row.note || ""
            });
            const dbRow = {
                project: row.project || "🏢 Ümumi Anbar",
                material: row.material || "",
                quantity: packedQty,
                state: row.state || (row.flow === "in" ? "in_stock" : (row.flow === "return" ? "in_stock" : "issued")),
                used_date: row.used_date || new Date().toISOString().slice(0, 10)
            };
            const query = id ? client.from("materials").update(dbRow).eq("id", id) : client.from("materials").insert(dbRow);
            unwrap(await query);
            scheduleCloudBroadcast();
        },

        async deleteMaterial(id) {
            unwrap(await client.from("materials").delete().eq("id", id));
            scheduleCloudBroadcast();
        },

        startLiveSync(onRemoteUpdate) {
            this.stopLiveSync();
            if (!client || typeof onRemoteUpdate !== "function") return;
            let running = false;
            const trigger = () => {
                if (running || Date.now() - localWriteAt < 3500) return;
                running = true;
                Promise.resolve(onRemoteUpdate()).catch(() => {}).finally(() => { running = false; });
            };
            try {
                liveChannel = client.channel("bcg-live-sync")
                    .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, trigger)
                    .on("postgres_changes", { event: "*", schema: "public", table: "segments" }, trigger)
                    .on("postgres_changes", { event: "*", schema: "public", table: "materials" }, trigger)
                    .on("postgres_changes", { event: "*", schema: "public", table: "notes" }, trigger)
                    .on("postgres_changes", { event: "*", schema: "public", table: "share_links" }, trigger)
                    .subscribe();
            } catch {}
            liveSyncTimer = setInterval(async () => {
                if (document.visibilityState !== "visible" || running) return;
                if (Date.now() - localWriteAt < 4000) return;
                try {
                    const v = await pullCloudRegistry(true);
                    if (v?.updatedAt) {
                        if (!lastCloudUpdatedAt) {
                            lastCloudUpdatedAt = v.updatedAt;
                        } else if (v.updatedAt !== lastCloudUpdatedAt) {
                            lastCloudUpdatedAt = v.updatedAt;
                            trigger();
                        }
                    }
                } catch {}
            }, 8000);
        },

        stopLiveSync() {
            if (liveSyncTimer) { clearInterval(liveSyncTimer); liveSyncTimer = null; }
            if (liveChannel && client) {
                try { client.removeChannel(liveChannel); } catch {}
                liveChannel = null;
            }
        },

        async loadShared(token) {
            return unwrap(await client.rpc("get_shared_view", { link: token })).map(toProject);
        },

        async listShares() {
            return unwrap(await client.from("share_links").select("*").neq("token", CLOUD_SYNC_TOKEN).order("created_at", { ascending: false }));
        },

        syncCloudRegistry,
        pullCloudRegistry,
        registerAdminUserInCloud,

        async loadSharedExtras(token) {
            return unwrap(await client.rpc("get_shared_extras", { link: token }));
        },

        async createShare(projectIds, days, drawings, view) {
            const expires = days ? new Date(Date.now() + days * 86400000).toISOString() : null;
            return unwrap(await client.from("share_links").insert({ project_ids: projectIds, expires_at: expires, drawings, view }).select().single());
        },

        async revokeShare(token) {
            unwrap(await client.from("share_links").delete().eq("token", token));
        }
    };
})();
