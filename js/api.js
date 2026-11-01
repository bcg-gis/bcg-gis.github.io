/* Supabase ilə əlaqə: giriş və məlumat */

const api = (() => {
    const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
    const client = configured ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

    function unwrap({ data, error }) {
        if (error) throw error;
        return data;
    }

    const toSegment = row => ({
        id: row.code, name: row.name, pointA: row.point_a, pointB: row.point_b,
        startDate: row.start_date || "", endDate: row.end_date || "", contractor: row.contractor || "",
        totalKm: Number(row.total_km), doneKm: Number(row.done_km), status: row.status,
        closures: row.closures, manholes: row.manholes, coords: row.coords
    });

    const toProject = row => ({
        id: row.id, name: row.name, status: row.status, imported: row.imported,
        startDate: row.start_date || "", endDate: row.end_date || "",
        items: row.segments.map(toSegment).sort((a, b) => a.id.localeCompare(b.id))
    });

    const toNote = row => ({ id: row.id, userId: row.user_id, author: row.author, text: row.text, date: row.created_at });

    return {
        configured,

        async getUser() {
            const { data } = await client.auth.getSession();
            return data.session ? data.session.user : null;
        },

        async signIn(email, password) {
            const { data, error } = await client.auth.signInWithPassword({ email, password });
            return error ? null : data.user;
        },

        signOut: () => client.auth.signOut(),

        async loadAll(userId) {
            const [profile, projects, contractors, materials, notes] = await Promise.all([
                client.from("profiles").select("role").eq("id", userId).single(),
                client.from("projects").select("*, segments(*)").order("name"),
                client.from("contractors").select("*"),
                client.from("materials").select("*").order("id"),
                client.from("notes").select("*").order("created_at", { ascending: false })
            ].map(query => query.then(unwrap)));

            return {
                role: profile.role,
                projects: projects.map(toProject),
                contractors: Object.fromEntries(contractors.map(c => [c.name, c])),
                materials,
                notes: notes.map(toNote)
            };
        },

        async addNote(text) {
            return toNote(unwrap(await client.from("notes").insert({ text }).select().single()));
        },

        async deleteNote(id) {
            unwrap(await client.from("notes").delete().eq("id", id));
        },

        async saveProject(project) {
            unwrap(await client.from("projects").insert({ id: project.id, name: project.name, status: project.status, imported: true }));
            unwrap(await client.from("segments").insert(project.items.map(r => ({
                project_id: project.id, code: r.id, name: r.name, point_a: r.pointA, point_b: r.pointB,
                total_km: r.totalKm, done_km: r.doneKm, status: r.status, coords: r.coords
            }))));
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

        async saveContractor(name, row) {
            if (!name) {
                unwrap(await client.from("contractors").insert(row));
                return;
            }
            unwrap(await client.from("contractors").update(row).eq("name", name));
            if (row.name !== name) unwrap(await client.from("segments").update({ contractor: row.name }).eq("contractor", name));
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
