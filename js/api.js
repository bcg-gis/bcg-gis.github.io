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
            const contractorMap = {
                "BCG (Öz briqadamız)": { name: "BCG (Öz briqadamız)", workers: 38, machinery: 10, engineer: "BCG Daxili Briqada (+994 50 200 10 10)", isOwn: true },
                ...Object.fromEntries(contractors.map(c => [c.name, { ...c, isOwn: /bcg/i.test(c.name) }]))
            };
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

        /* Layihə və seqmentləri. Seqmentlər yazılmasa, layihə geri silinir ki bazada boş layihə qalmasın */
        async saveProject(project) {
            const pType = ["other", "nim", "azconnect"].includes(project.category) ? project.category : (project.type || "lines");
            unwrap(await client.from("projects").insert({
                id: project.id, name: project.name, status: project.status || "layihe",
                project_type: pType, imported: true
            }));
            const { error } = await client.from("segments").insert(project.items.map(r => {
                const safeCoords = Array.isArray(r.coords) && r.coords.length === 1
                    ? [r.coords[0], r.coords[0]]
                    : r.coords;
                return {
                    project_id: project.id, code: r.id, name: r.name, point_a: r.pointA || "", point_b: r.pointB || "",
                    contractor: r.contractor || null,
                    total_km: r.totalKm || 0, done_km: r.doneKm || 0, status: r.status || "layihe",
                    antennas: r.antennas || 0, coords: safeCoords
                };
            }));
            if (error) {
                await client.from("projects").delete().eq("id", project.id);
                throw error;
            }
        },

        async deleteProject(id) {
            unwrap(await client.from("projects").delete().eq("id", id));
        },

        async saveProjectRow(id, row) {
            const query = id ? client.from("projects").update(row).eq("id", id) : client.from("projects").insert({ ...row, id: `proj_${Date.now()}` });
            unwrap(await query);
        },

        async saveSegment(projectId, code, row) {
            const query = code
                ? client.from("segments").update(row).eq("project_id", projectId).eq("code", code)
                : client.from("segments").insert({ ...row, project_id: projectId });
            unwrap(await query);
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
