/* Supabase ilə əlaqə: giriş və məlumat */

const api = (() => {
    const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
    const client = configured ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

    function unwrap({ data, error }) {
        if (error) throw error;
        return data;
    }

    const toSegment = row => ({
        id: row.code, name: String(row.name || "").replace(/\s*\(Faz-\d+\)/gi, "").trim(),
        pointA: row.point_a || "", pointB: row.point_b || "",
        startDate: row.start_date || "", endDate: row.end_date || "", contractor: row.contractor || "",
        totalKm: Number(row.total_km), doneKm: Number(row.done_km), status: row.status,
        closures: row.closures || 0, manholes: row.manholes || 0, antennas: Number(row.antennas || 0),
        coords: row.coords
    });

    const detectCategory = row => {
        const pt = String(row.project_type || "").toLowerCase();
        const nm = String(row.name || "").trim();
        if (pt === "nim" || /^nim\b|^svetofor/i.test(nm)) return "nim";
        if (pt === "azconnect" || /^azconnect\b|^azcon/i.test(nm)) return "azconnect";
        if (pt === "other" || /^(rm\b|rm-|dendrologiya|digər)/i.test(nm)) return "other";
        return "project";
    };

    const toProject = row => {
        const items = (row.segments || []).map(toSegment).sort((a, b) => a.id.localeCompare(b.id));
        const category = detectCategory(row);
        const isPoints = category === "nim" || (category === "project" && (row.project_type === "points" || items.some(s => s.antennas > 0 || (Array.isArray(s.coords) && s.coords.length === 1))));
        const cleanProjName = String(row.name || "").replace(/\s*-\s*Faz\s*\d+/gi, "").replace(/\s*\(Faz-\d+\)/gi, "").trim();
        return {
            id: row.id, name: cleanProjName, status: row.status, imported: row.imported,
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

    const USERS_STORAGE_KEY = "bcg.admin.users.v1";
    const LOCAL_SESSION_KEY = "bcg.local.session.v1";
    const DB_SNAPSHOT_KEY = "bcg.db.snapshot.v1";

    function getAdminUsersList() {
        try {
            const raw = JSON.parse(localStorage.getItem(USERS_STORAGE_KEY) || "[]");
            return Array.isArray(raw) ? raw : [];
        } catch {
            return [];
        }
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
                id: "proj_magistral", name: "1. Milli Magistral Fiber Optik", status: "icrada", category: "project", type: "lines",
                startDate: "2026-03-01", endDate: "2026-12-15", imported: false,
                items: [
                    { id: "MAG-01", name: "Bakı - Sumqayıt Magistralı", pointA: "Bakı HQ", pointB: "Sumqayıt ATS", startDate: "2026-03-01", endDate: "2026-06-30", contractor: "", totalKm: 45, doneKm: 45, status: "bitmis", closures: 15, manholes: 10, antennas: 0, coords: [[40.4093, 49.8671], [40.45, 49.8], [40.5897, 49.6686]] },
                    { id: "MAG-02", name: "Sumqayıt - Quba Magistralı", pointA: "Sumqayıt ATS", pointB: "Quba Node", startDate: "2026-04-10", endDate: "2026-09-15", contractor: "", totalKm: 120, doneKm: 85, status: "icrada", closures: 30, manholes: 20, antennas: 0, coords: [[40.5897, 49.6686], [41.1, 49.06], [41.3611, 48.5134]] }
                ]
            },
            {
                id: "proj_gpon_north", name: "2. GPON Şimal Bölgəsi", status: "icrada", category: "project", type: "lines",
                startDate: "2026-04-01", endDate: "2026-11-30", imported: false,
                items: [
                    { id: "NOR-01", name: "Quba Şəhər İçi GPON", pointA: "Quba ATS", pointB: "Zərdabi Qəsəbəsi", startDate: "2026-04-01", endDate: "2026-07-30", contractor: "", totalKm: 35, doneKm: 35, status: "bitmis", closures: 8, manholes: 5, antennas: 0, coords: [[41.3611, 48.5134], [41.39, 48.48]] }
                ]
            },
            {
                id: "proj_gpon_west", name: "3. GPON Qərb Bölgəsi", status: "icrada", category: "project", type: "lines",
                startDate: "2026-05-01", endDate: "2026-12-20", imported: false,
                items: [
                    { id: "WES-01", name: "Gəncə Şəhər İçi GPON", pointA: "Gəncə ATS-1", pointB: "Gəncə Mərkəz", startDate: "2026-05-01", endDate: "2026-08-30", contractor: "", totalKm: 65, doneKm: 65, status: "bitmis", closures: 16, manholes: 10, antennas: 0, coords: [[40.6828, 46.3606], [40.72, 46.33]] }
                ]
            },
            {
                id: "proj_absheron", name: "4. Abşeron & Bakı Kəndləri", status: "bitmis", category: "project", type: "lines",
                startDate: "2025-10-01", endDate: "2026-03-30", imported: false,
                items: [
                    { id: "ABS-01", name: "Xırdalan Şəhər İçi", pointA: "Xırdalan ATS", pointB: "Masazır Qəsəbəsi", startDate: "2025-10-01", endDate: "2025-12-15", contractor: "", totalKm: 35, doneKm: 35, status: "bitmis", closures: 9, manholes: 6, antennas: 0, coords: [[40.4481, 49.755], [40.49, 49.7]] }
                ]
            },
            {
                id: "proj_karabakh", name: "5. Qarabağ & Şərqi Zəngəzur", status: "tehvil", category: "project", type: "lines",
                startDate: "2025-05-01", endDate: "2026-02-28", imported: false,
                items: [
                    { id: "KAR-01", name: "Şuşa - Xankəndi Magistralı", pointA: "Şuşa Sub-station", pointB: "Xankəndi Hub", startDate: "2025-05-01", endDate: "2025-09-30", contractor: "", totalKm: 35, doneKm: 35, status: "tehvil", closures: 9, manholes: 6, antennas: 0, coords: [[39.7539, 46.7469], [39.8231, 46.7561]] }
                ]
            }
        ];
    }

    return {
        configured,

        async getUser() {
            try {
                const { data } = await client.auth.getSession();
                if (data?.session?.user) return data.session.user;
            } catch {}
            try {
                const localUser = JSON.parse(localStorage.getItem(LOCAL_SESSION_KEY) || "null");
                if (localUser && localUser.email) return localUser;
            } catch {}
            return null;
        },

        /* { user } və ya { error: "credentials" | "network" } */
        async signIn(email, password) {
            const cleanEmail = String(email || "").trim();
            const localMatch = findAdminPanelUser(cleanEmail, password);

            try {
                const { data, error } = await client.auth.signInWithPassword({ email: cleanEmail, password });
                if (!error && data?.user) {
                    markAdminUserLogin(cleanEmail);
                    if (localMatch) {
                        localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ ...localMatch, id: data.user.id, isLocalUser: false }));
                    } else {
                        localStorage.removeItem(LOCAL_SESSION_KEY);
                    }
                    return { user: data.user };
                }

                // Əgər Supabase Auth-da tapılmadısa, amma Admin Paneldə yaradılıbsa:
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
            try { localStorage.removeItem(LOCAL_SESSION_KEY); } catch {}
            return client.auth.signOut().catch(() => {});
        },

        async loadAll(userId) {
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
                const [profiles, projects, contractors, materials, notes] = await Promise.all([
                    client.from("profiles").select("id, email, role").order("email"),
                    client.from("projects").select("*, segments(*)").order("name"),
                    client.from("contractors").select("*"),
                    client.from("materials").select("*").order("id"),
                    client.from("notes").select("*").order("created_at", { ascending: false })
                ].map(query => query.then(unwrap)));

                const own = profiles.find(p => p.id === userId);
                const ownEmail = (own?.email || localSession?.email || "").toLowerCase();
                const matchedAdminUser = adminUsers.find(u => String(u.email || "").trim().toLowerCase() === ownEmail);

                const mappedProjects = projects.map(toProject);
                const mappedNotes = notes.map(toNote);

                // Əgər bazadan məlumat gəlibsə (məs. Admin sessiyası zamanı), lokal istifadəçilər üçün keşi yenilə
                if (mappedProjects.length > 0) {
                    try {
                        localStorage.setItem(DB_SNAPSHOT_KEY, JSON.stringify({
                            projects: mappedProjects,
                            materials,
                            notes: mappedNotes,
                            users: [...new Set([...profiles.map(p => p.email), ...adminUserEmails])]
                        }));
                    } catch {}
                }

                // Əgər lokal istifadəçi ilə girilibsə və RLS səbəbindən bazadan 0 layihə qayıdıbsa, keşdən götür
                if (mappedProjects.length === 0 && localSession) {
                    const snap = JSON.parse(localStorage.getItem(DB_SNAPSHOT_KEY) || "null");
                    return {
                        role: matchedAdminUser?.role || localSession.role || "viewer",
                        users: snap?.users || adminUserEmails,
                        projects: snap?.projects?.length ? snap.projects : fallbackSeedProjects(),
                        contractors: contractorMap,
                        materials: snap?.materials || [],
                        notes: snap?.notes || []
                    };
                }

                const resolvedRole = matchedAdminUser?.role || (own ? own.role : (localSession?.role || "manager"));

                return {
                    role: resolvedRole,
                    users: [...new Set([...profiles.map(p => p.email), ...adminUserEmails])],
                    projects: mappedProjects,
                    contractors: contractorMap,
                    materials,
                    notes: mappedNotes
                };
            } catch (err) {
                // Lokal Admin Panel istifadəçisi üçün keşdən və ya ehtiyat bazadan yüklə
                if (localSession) {
                    const ownEmail = String(localSession.email || "").trim().toLowerCase();
                    const matchedAdminUser = adminUsers.find(u => String(u.email || "").trim().toLowerCase() === ownEmail);
                    let snap = null;
                    try { snap = JSON.parse(localStorage.getItem(DB_SNAPSHOT_KEY) || "null"); } catch {}
                    return {
                        role: matchedAdminUser?.role || localSession.role || "viewer",
                        users: snap?.users || adminUserEmails,
                        projects: snap?.projects?.length ? snap.projects : fallbackSeedProjects(),
                        contractors: contractorMap,
                        materials: snap?.materials || [],
                        notes: snap?.notes || []
                    };
                }
                throw err;
            }
        },

        async addNote(text, recipient = "all", durationHours = 24) {
            const hours = Number(durationHours) || 0;
            const expires_at = hours > 0 ? new Date(Date.now() + hours * 3600000).toISOString() : null;
            try {
                return toNote(unwrap(await client.from("notes").insert({
                    text, recipient: recipient || "all", duration_hours: hours, expires_at
                }).select().single()));
            } catch (err) {
                let localSession = null;
                try { localSession = JSON.parse(localStorage.getItem(LOCAL_SESSION_KEY) || "null"); } catch {}
                if (localSession) {
                    const noteObj = {
                        id: Date.now(),
                        userId: localSession.id,
                        author: localSession.email,
                        recipient: recipient || "all",
                        durationHours: hours,
                        expiresAt: expires_at,
                        text,
                        date: new Date().toISOString()
                    };
                    try {
                        const snap = JSON.parse(localStorage.getItem(DB_SNAPSHOT_KEY) || "{}");
                        snap.notes = [noteObj, ...(snap.notes || [])];
                        localStorage.setItem(DB_SNAPSHOT_KEY, JSON.stringify(snap));
                    } catch {}
                    return noteObj;
                }
                throw err;
            }
        },

        async deleteNote(id) {
            try {
                unwrap(await client.from("notes").delete().eq("id", id));
            } catch {
                try {
                    const snap = JSON.parse(localStorage.getItem(DB_SNAPSHOT_KEY) || "{}");
                    if (Array.isArray(snap.notes)) {
                        snap.notes = snap.notes.filter(n => n.id !== id);
                        localStorage.setItem(DB_SNAPSHOT_KEY, JSON.stringify(snap));
                    }
                } catch {}
            }
        },

        /* Layihə və seqmentləri bazada saxla. Əgər FK və ya constraint xətası olarsa təhlükəsiz bərpa et */
        async saveProject(project) {
            const pType = ["other", "nim", "azconnect"].includes(project.category) ? project.category : (project.type || "lines");
            unwrap(await client.from("projects").upsert({
                id: project.id, name: project.name, status: project.status || "layihe",
                project_type: pType, imported: true
            }));

            // Podratçıların mövcudluğunu yoxla, xarici podratçılarda FK xətası olmasın deyə
            const buildSegmentPayload = (withContractor = true) => project.items.map(r => {
                const safeCoords = Array.isArray(r.coords) && r.coords.length === 1
                    ? [r.coords[0], r.coords[0]]
                    : (r.coords || []);
                const totalKm = Math.max(0, Number(r.totalKm) || 0);
                const doneKm = Math.min(totalKm, Math.max(0, Number(r.doneKm) || 0));
                return {
                    project_id: project.id, code: r.id, name: r.name || "", point_a: r.pointA || "", point_b: r.pointB || "",
                    contractor: withContractor ? (r.contractor || null) : null,
                    total_km: totalKm, done_km: doneKm, status: r.status || "layihe",
                    antennas: Number(r.antennas) || 0, coords: safeCoords
                };
            });

            let res = await client.from("segments").insert(buildSegmentPayload(true));
            if (res.error) {
                // Əgər contractor FK xətası olarsa, contractor-u null edib təkrar cəhd et
                const retryRes = await client.from("segments").insert(buildSegmentPayload(false));
                if (retryRes.error) {
                    console.warn("saveProject segments insert error:", retryRes.error);
                }
            }
        },

        async deleteProject(id) {
            unwrap(await client.from("projects").delete().eq("id", id));
        },

        async saveProjectRow(id, row) {
            const projId = id || `proj_${Date.now()}`;
            const query = client.from("projects").upsert({ ...row, id: projId });
            unwrap(await query);
        },

        async saveSegment(projectId, code, row) {
            const totalKm = Math.max(0, Number(row.total_km) || 0);
            const doneKm = Math.min(totalKm, Math.max(0, Number(row.done_km) || 0));
            const safeRow = {
                ...row,
                project_id: projectId,
                code: code || row.code,
                total_km: totalKm,
                done_km: doneKm
            };
            let res = await client.from("segments").upsert(safeRow, { onConflict: "project_id,code" });
            if (res.error) {
                // Əgər contractor constraint xətası olarsa, contractor-u null edib yaz
                res = await client.from("segments").upsert({ ...safeRow, contractor: null }, { onConflict: "project_id,code" });
                if (res.error) {
                    console.warn("saveSegment error:", res.error);
                }
            }
        },

        async deleteSegment(projectId, code) {
            unwrap(await client.from("segments").delete().eq("project_id", projectId).eq("code", code));
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
            const query = id ? client.from("materials").update(row).eq("id", id) : client.from("materials").insert(row);
            unwrap(await query);
        },

        async deleteMaterial(id) {
            unwrap(await client.from("materials").delete().eq("id", id));
        },

        async loadShared(token) {
            return unwrap(await client.rpc("get_shared_view", { link: token })).map(toProject);
        },

        async listShares() {
            return unwrap(await client.from("share_links").select("*").order("created_at", { ascending: false }));
        },

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
