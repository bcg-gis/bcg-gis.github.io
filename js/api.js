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

    return {
        configured,

        async getUser() {
            const { data } = await client.auth.getSession();
            return data.session ? data.session.user : null;
        },

        /* { user } və ya { error: "credentials" | "network" } */
        async signIn(email, password) {
            try {
                const { data, error } = await client.auth.signInWithPassword({ email, password });
                if (!error) return { user: data.user };
                return { error: error.status === 400 || /invalid/i.test(error.message) ? "credentials" : "network" };
            } catch {
                return { error: "network" };
            }
        },

        signOut: () => client.auth.signOut(),

        async loadAll(userId) {
            const [profiles, projects, contractors, materials, notes] = await Promise.all([
                client.from("profiles").select("id, email, role").order("email"),
                client.from("projects").select("*, segments(*)").order("name"),
                client.from("contractors").select("*"),
                client.from("materials").select("*").order("id"),
                client.from("notes").select("*").order("created_at", { ascending: false })
            ].map(query => query.then(unwrap)));

            const own = profiles.find(p => p.id === userId);
            let contractorMap = {};
            try {
                const savedAdminContractors = JSON.parse(localStorage.getItem("bcg.admin.contractors.v2") || "{}");
                if (savedAdminContractors && typeof savedAdminContractors === "object" && !Array.isArray(savedAdminContractors)) {
                    contractorMap = savedAdminContractors;
                }
            } catch {}
            return {
                role: own ? own.role : "manager",
                users: profiles.map(p => p.email),
                projects: projects.map(toProject),
                contractors: contractorMap,
                materials,
                notes: notes.map(toNote)
            };
        },

        async addNote(text, recipient = "all", durationHours = 24) {
            const hours = Number(durationHours) || 0;
            const expires_at = hours > 0 ? new Date(Date.now() + hours * 3600000).toISOString() : null;
            return toNote(unwrap(await client.from("notes").insert({
                text, recipient: recipient || "all", duration_hours: hours, expires_at
            }).select().single()));
        },

        async deleteNote(id) {
            unwrap(await client.from("notes").delete().eq("id", id));
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
