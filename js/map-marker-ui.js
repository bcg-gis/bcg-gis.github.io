/* ============================================================================
   BCG GIS — MAP MARKER SAHƏ UI MÜHƏRRİKİ (js/map-marker-ui.js)
   3 ekran vəziyyəti:
   1) Normal Baxış (Sol-üst 5 ikon, Sağ-üst GPS, Sağ-aşağı +📍, Aşağı 2×2 Seçim Zolağı)
   2) Yerləşdirmə Rejimi (Yuxarı-orta Qovluq, Sol Qövs 4 Dairəvi Alət, Mərkəzi Hədəf, Cancel/OK + Canlı Lat/Lng)
   3) Sol Açılan Menyu (#202124 + #8e9094 başlıqlar: Backup, Map, Folders, Help & Feedback)
   ============================================================================ */

(() => {
    const SAHA_DRAW_KEY = "bcg.saha.drawings.v1";
    const MM_FOLDERS_KEY = "bcg.mm.folders.v1";

    const mm = {
        built: false,
        placing: false,
        arcMode: "point",      // "point" | "track" | "line" | "polygon" | "circle"
        owner: "bcg",          // "bcg" (boş) | "other" (dolu)
        ptType: "pole",
        ptSub: "6 m",
        lineType: "fo24",
        draft: [],             // [[lat, lng], ...]
        trackWatchId: null,
        activeFolder: "Default folder",
        folders: [{ name: "Default folder", visible: true }],
        filterFolder: "",      // "" = All
        selectedId: "",
        movingId: "",
        mapTypeLabel: "ESRI Satellite",
        createdStamp: (() => {
            const d = new Date(), p = n => String(n).padStart(2, "0");
            return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} @ ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        })()
    };

    const $m = id => document.getElementById(id);
    const escM = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const msg = (t, err = false) => { if (typeof toast === "function") toast(t, err); };
    const isFieldMode = () => document.body.dataset.workspaceMode === "field";

    function nowStamp() {
        const d = new Date(), p = n => String(n).padStart(2, "0");
        return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} @ ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }

    function hav(a, b) {
        const R = 6371000, r = x => x * Math.PI / 180;
        const dLa = r(b[0] - a[0]), dLn = r(b[1] - a[1]);
        const s = Math.sin(dLa / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLn / 2) ** 2;
        return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
    }

    function totalLen(cs) {
        let t = 0;
        for (let i = 1; i < cs.length; i++) t += hav(cs[i - 1], cs[i]);
        return Math.round(t);
    }

    function loadFeatures() {
        try { return JSON.parse(localStorage.getItem(SAHA_DRAW_KEY) || "[]") || []; } catch { return []; }
    }

    function saveFeatures(list) {
        try { localStorage.setItem(SAHA_DRAW_KEY, JSON.stringify(list)); } catch {}
        // Mövcud Sahə qatını və yaddaşı dərhal yenilə
        if (typeof window.reloadSahaDrawingsFromStorage === "function") window.reloadSahaDrawingsFromStorage();
        else window.refreshFieldMapLayer?.();
    }

    function loadFolders() {
        try {
            const arr = JSON.parse(localStorage.getItem(MM_FOLDERS_KEY) || "null");
            if (Array.isArray(arr) && arr.length) mm.folders = arr;
        } catch {}
        // Mövcud obyektlərdəki layihə/qovluq adlarını da əlavə et
        const feats = loadFeatures();
        feats.forEach(f => {
            const fn = f.projectName || "Default folder";
            if (!mm.folders.some(x => x.name === fn)) mm.folders.push({ name: fn, visible: true });
        });
    }

    function saveFolders() {
        try { localStorage.setItem(MM_FOLDERS_KEY, JSON.stringify(mm.folders)); } catch {}
    }

    /* ---------- DRAFT OVERLAY LAYER FOR POLYLINE / POLYGON / CIRCLE / TRACK ---------- */
    function renderMmDraft() {
        if (!window.map || !map.isStyleLoaded?.()) return;
        if (!map.getSource("mm-draft-src")) {
            map.addSource("mm-draft-src", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
            map.addLayer({ id: "mm-draft-fill", type: "fill", source: "mm-draft-src", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#f59e0b", "fill-opacity": 0.22 } });
            map.addLayer({ id: "mm-draft-line", type: "line", source: "mm-draft-src", paint: { "line-color": "#fbbf24", "line-width": 3.5 } });
        }
        const src = map.getSource("mm-draft-src");
        if (!src) return;
        if (!mm.placing || mm.draft.length < 2) {
            src.setData({ type: "FeatureCollection", features: [] });
            return;
        }
        const feats = [];
        if (mm.arcMode === "polygon" && mm.draft.length >= 3) {
            const ring = [...mm.draft.map(c => [c[1], c[0]]), [mm.draft[0][1], mm.draft[0][0]]];
            feats.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} });
        } else if (mm.arcMode === "circle" && mm.draft.length >= 2) {
            const c = mm.draft[0], rM = hav(c, mm.draft[mm.draft.length - 1]);
            const ring = [];
            for (let a = 0; a <= 360; a += 12) {
                const rad = a * Math.PI / 180;
                ring.push([c[1] + (rM / (111320 * Math.cos(c[0] * Math.PI / 180))) * Math.sin(rad), c[0] + (rM / 111320) * Math.cos(rad)]);
            }
            feats.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} });
        } else {
            feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: mm.draft.map(c => [c[1], c[0]]) }, properties: {} });
        }
        src.setData({ type: "FeatureCollection", features: feats });
    }

    /* ---------- VƏZİYYƏT 2: YERLƏŞDİRMƏ REJİMİ ---------- */
    function enterPlacingMode(movingId = "") {
        mm.placing = true;
        mm.movingId = movingId || "";
        mm.arcMode = "point";
        mm.draft = [];
        document.body.classList.add("mm-placing");
        hideSelectionBar();
        updatePlacingUi();
        updateLiveCoords();
    }

    function exitPlacingMode() {
        stopGpsTrack();
        mm.placing = false;
        mm.movingId = "";
        mm.draft = [];
        document.body.classList.remove("mm-placing");
        renderMmDraft();
    }

    function stopGpsTrack() {
        if (mm.trackWatchId !== null && navigator.geolocation) {
            navigator.geolocation.clearWatch(mm.trackWatchId);
            mm.trackWatchId = null;
        }
    }

    function updateLiveCoords() {
        const box = $m("mmCoordBox");
        if (!box || !window.map) return;
        const c = map.getCenter();
        let extra = "";
        if (mm.draft.length >= 2) {
            if (mm.arcMode === "circle") extra = `\nR: ${hav(mm.draft[0], mm.draft[mm.draft.length - 1]).toFixed(0)} m`;
            else extra = `\nUzunluq: ${totalLen(mm.draft)} m (${mm.draft.length} nöqtə)`;
        }
        box.innerHTML = `Lat: ${c.lat.toFixed(5)}<br>Lng: ${c.lng.toFixed(5)}${extra ? `<br><span style="color:#fbbf24">${extra.trim()}</span>` : ""}`;
    }

    function updatePlacingUi() {
        const fLbl = $m("mmPlaceFolderLbl");
        if (fLbl) fLbl.textContent = mm.activeFolder;
        document.querySelectorAll("#mmArcTools .mm-arc-btn").forEach(b => {
            b.classList.toggle("active", b.dataset.arc === mm.arcMode);
        });
        const subBar = $m("mmPlaceSubbar");
        const addPtBtn = $m("mmPlaceAddPtBtn");
        if (addPtBtn) addPtBtn.hidden = !(mm.arcMode === "line" || mm.arcMode === "polygon" || mm.arcMode === "circle");

        if (!subBar) return;
        if (mm.movingId) {
            subBar.innerHTML = `<span style="font-size:12px;color:#fbbf24;font-weight:700">📍 Hədəfi yeni yerə gətirib OK basın</span>`;
            return;
        }
        if (mm.arcMode === "point") {
            subBar.innerHTML = `
                <button type="button" class="mm-place-chip ${mm.owner === "bcg" ? "active" : ""}" data-mm-own="bcg">□ BCG</button>
                <button type="button" class="mm-place-chip ${mm.owner === "other" ? "active" : ""}" data-mm-own="other">■ Başqa</button>
                <button type="button" class="mm-place-chip ${mm.ptType === "pole" && mm.ptSub === "6 m" ? "active" : ""}" data-mm-pt="pole|6 m">□ 6m</button>
                <button type="button" class="mm-place-chip ${mm.ptType === "pole" && mm.ptSub === "8 m" ? "active" : ""}" data-mm-pt="pole|8 m">□ 8m</button>
                <button type="button" class="mm-place-chip ${mm.ptType === "mufta" ? "active" : ""}" data-mm-pt="mufta|FO-24">△ Mufta</button>
                <button type="button" class="mm-place-chip ${mm.ptType === "quyu" ? "active" : ""}" data-mm-pt="quyu|KRQ-1">○ Quyu</button>
                <button type="button" class="mm-place-chip ${mm.ptType === "trans" ? "active" : ""}" data-mm-pt="trans|">◇ Trans</button>
                <button type="button" class="mm-place-chip ${mm.ptType === "ant" ? "active" : ""}" data-mm-pt="ant|PTZ">★ Ant</button>
            `;
        } else if (mm.arcMode === "line" || mm.arcMode === "track") {
            subBar.innerHTML = `
                <button type="button" class="mm-place-chip ${mm.lineType === "fo12" ? "active" : ""}" data-mm-ln="fo12" style="border-color:#22c55e">FO 12</button>
                <button type="button" class="mm-place-chip ${mm.lineType === "fo24" ? "active" : ""}" data-mm-ln="fo24" style="border-color:#3b82f6">FO 24</button>
                <button type="button" class="mm-place-chip ${mm.lineType === "fo48" ? "active" : ""}" data-mm-ln="fo48" style="border-color:#ef4444">FO 48</button>
                <button type="button" class="mm-place-chip ${mm.lineType === "elec" ? "active" : ""}" data-mm-ln="elec" style="border-color:#dc2626">Elektrik</button>
                <button type="button" class="mm-place-chip ${mm.lineType === "qazinti" ? "active" : ""}" data-mm-ln="qazinti" style="border-color:#92400e">Qazıntı</button>
            `;
        } else if (mm.arcMode === "polygon") {
            subBar.innerHTML = `<span style="font-size:12px;color:#e8eaed">⬟ Poliqon: "+" ilə küncləri əlavə edin, bitəndə OK basın</span>`;
        } else if (mm.arcMode === "circle") {
            subBar.innerHTML = `<span style="font-size:12px;color:#e8eaed">⭕ Dairə: mərkəz (+) → kənar (+) → OK</span>`;
        }
    }

    function confirmPlacement() {
        if (!window.map) return;
        const c = map.getCenter();
        const lat = Number(c.lat.toFixed(6)), lng = Number(c.lng.toFixed(6));
        const feats = loadFeatures();

        // Yerini dəyişmə (Move)
        if (mm.movingId) {
            const target = feats.find(f => f.id === mm.movingId);
            if (target && target.kind === "point") {
                target.coords = [lat, lng];
                saveFeatures(feats);
                exitPlacingMode();
                showSelectionBar(target.id);
                msg(`📍 "${target.label}" yeni yerinə köçürüldü`);
            }
            return;
        }

        // Nöqtə / Marker qoyma
        if (mm.arcMode === "point") {
            const shortMap = { pole: mm.ptSub.replace(/\s+/g, "") || "6m", mufta: mm.ptSub || "FO-24", quyu: "Quyu", trans: "Trans.", ant: "Antena", exist: "Mövcud" };
            const feat = {
                id: `sf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                kind: "point",
                type: mm.ptType,
                sub: mm.ptSub,
                owner: mm.owner,
                coords: [lat, lng],
                projectName: mm.activeFolder,
                tsNo: "",
                engineer: state?.user?.name || state?.user?.email?.split("@")[0] || "Mühəndis",
                workDate: new Date().toISOString().slice(0, 10),
                label: shortMap[mm.ptType] || "Marker",
                createdAt: nowStamp()
            };
            feats.push(feat);
            saveFeatures(feats);
            exitPlacingMode();
            showSelectionBar(feat.id);
            msg(`✅ "${feat.label}" əlavə olundu`);
            return;
        }

        // Xətt / Track / Poliqon / Dairə
        if (mm.draft.length < 2) mm.draft.push([lat, lng]);
        if (mm.draft.length < 2) {
            msg("Ən azı 2 nöqtə üçün '+' basın", true);
            return;
        }
        const lnLabels = { fo12: "FO 12", fo24: "FO 24", fo48: "FO 48", elec: "Elektrik kabeli", qazinti: "Qazıntı" };
        const meters = totalLen(mm.draft);
        const feat = {
            id: `sf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            kind: "line",
            type: mm.lineType,
            owner: "bcg",
            coords: mm.arcMode === "polygon" ? [...mm.draft, mm.draft[0]] : mm.draft.slice(),
            meters,
            projectName: mm.activeFolder,
            tsNo: "",
            engineer: state?.user?.name || state?.user?.email?.split("@")[0] || "Mühəndis",
            workDate: new Date().toISOString().slice(0, 10),
            label: `${lnLabels[mm.lineType] || "FO 24"} (${meters} m)`,
            createdAt: nowStamp()
        };
        feats.push(feat);
        saveFeatures(feats);
        exitPlacingMode();
        showSelectionBar(feat.id);
        msg(`✅ ${feat.label} yadda saxlanıldı`);
    }

    /* ---------- VƏZİYYƏT 1: AŞAĞI SEÇİM ZOLAĞI (2×2 İKONLAR) ---------- */
    function showSelectionBar(featId) {
        const feats = loadFeatures();
        const f = feats.find(x => x.id === featId);
        const bar = $m("mmSelBar");
        if (!f || !bar) return;
        mm.selectedId = f.id;
        const c = f.kind === "point" ? f.coords : f.coords?.[0];
        const gmapHref = Array.isArray(c) && c.length === 2 ? `https://www.google.com/maps/dir/?api=1&destination=${c[0]},${c[1]}` : "#";
        bar.innerHTML = `
            <div class="mm-sel-info">
                <strong>${escM(f.label || f.type)}</strong>
                <small>${escM(f.createdAt || nowStamp())}</small>
            </div>
            <div class="mm-sel-grid">
                <button type="button" id="mmSelEdit" title="Redaktə et"><i class="fa-solid fa-pen"></i></button>
                <button type="button" id="mmSelDup" title="Kopyala / Dublikat"><i class="fa-regular fa-copy"></i></button>
                <a href="${gmapHref}" target="_blank" rel="noopener" title="Google Maps-də yol göstər"><i class="fa-solid fa-diamond-turn-right"></i></a>
                <button type="button" id="mmSelMore" title="Yerini dəyiş, Paylaş, Sil"><i class="fa-solid fa-ellipsis-vertical"></i></button>
            </div>`;
        bar.classList.add("show");
        bar.querySelector("#mmSelEdit")?.addEventListener("click", () => openEditPopup(f.id));
        bar.querySelector("#mmSelDup")?.addEventListener("click", () => {
            const all = loadFeatures();
            const clone = JSON.parse(JSON.stringify(f));
            clone.id = `sf_${Date.now()}_dup`;
            clone.label = `${f.label || "Marker"} (2)`;
            clone.createdAt = nowStamp();
            if (clone.kind === "point" && Array.isArray(clone.coords)) {
                clone.coords = [Number((clone.coords[0] + 0.00012).toFixed(6)), Number((clone.coords[1] + 0.00012).toFixed(6))];
            }
            all.push(clone);
            saveFeatures(all);
            showSelectionBar(clone.id);
            msg("📋 Dublikat yaradıldı");
        });
        bar.querySelector("#mmSelMore")?.addEventListener("click", () => openMorePopup(f.id));
    }

    function hideSelectionBar() {
        mm.selectedId = "";
        $m("mmSelBar")?.classList.remove("show");
    }

    /* ---------- POPUPS (EDIT, MORE, SEARCH, LIST, FILTER, FOLDER PICKER) ---------- */
    function openPopup(title, bodyHtml, onBind) {
        const bg = $m("mmPopupBg");
        if (!bg) return;
        bg.innerHTML = `
            <div class="mm-popup-card">
                <div class="mm-popup-head"><span>${title}</span><button type="button" class="icon-btn small" id="mmPopClose" style="color:#fff"><i class="fa-solid fa-xmark"></i></button></div>
                <div class="mm-popup-body">${bodyHtml}</div>
            </div>`;
        bg.hidden = false;
        bg.querySelector("#mmPopClose")?.addEventListener("click", () => { bg.hidden = true; });
        if (typeof onBind === "function") onBind(bg);
    }

    function openEditPopup(featId) {
        const feats = loadFeatures();
        const f = feats.find(x => x.id === featId);
        if (!f) return;
        const fOpts = mm.folders.map(fl => `<option value="${escM(fl.name)}" ${(f.projectName || "Default folder") === fl.name ? "selected" : ""}>${escM(fl.name)}</option>`).join("");
        openPopup(`✏️ Redaktə — ${escM(f.label)}`, `
            <label class="saha-field"><span>Ad</span><input type="text" class="input" id="mpeName" value="${escM(f.label || "")}"></label>
            <label class="saha-field"><span>Qovluq / Layihə</span><select class="input" id="mpeFolder">${fOpts}</select></label>
            ${f.kind === "point" ? `
            <label class="saha-field"><span>Mülkiyyət</span>
                <select class="input" id="mpeOwn">
                    <option value="bcg" ${f.owner === "bcg" ? "selected" : ""}>□ BCG (içi boş)</option>
                    <option value="other" ${f.owner !== "bcg" ? "selected" : ""}>■ Başqa qurum (dolu)</option>
                </select>
            </label>` : ""}
            <label class="saha-field"><span>Qeyd</span><input type="text" class="input" id="mpeNote" value="${escM(f.note || "")}" placeholder="Ərazi qeydi..."></label>
            <button type="button" class="btn btn-primary" id="mpeSave" style="height:40px">Yadda saxla</button>
        `, bg => {
            bg.querySelector("#mpeSave")?.addEventListener("click", () => {
                f.label = bg.querySelector("#mpeName").value.trim() || f.label;
                f.projectName = bg.querySelector("#mpeFolder").value;
                if (bg.querySelector("#mpeOwn")) f.owner = bg.querySelector("#mpeOwn").value;
                f.note = bg.querySelector("#mpeNote").value.trim();
                saveFeatures(feats);
                bg.hidden = true;
                showSelectionBar(f.id);
                msg("✅ Yeniləndi");
            });
        });
    }

    function openMorePopup(featId) {
        const feats = loadFeatures();
        const f = feats.find(x => x.id === featId);
        if (!f) return;
        openPopup(`⋮ ${escM(f.label)}`, `
            ${f.kind === "point" ? `<button type="button" class="mm-nav-row" id="mpmMove"><i class="fa-solid fa-arrows-up-down-left-right"></i><strong>Yerini dəyiş (Move)</strong></button>` : ""}
            <button type="button" class="mm-nav-row" id="mpmShare"><i class="fa-solid fa-share-nodes"></i><strong>Paylaş (WhatsApp / Link)</strong></button>
            <button type="button" class="mm-nav-row" id="mpmDel" style="color:#f87171"><i class="fa-solid fa-trash" style="color:#f87171"></i><strong>Sil</strong></button>
        `, bg => {
            bg.querySelector("#mpmMove")?.addEventListener("click", () => { bg.hidden = true; enterPlacingMode(f.id); });
            bg.querySelector("#mpmShare")?.addEventListener("click", async () => {
                bg.hidden = true;
                const c = f.kind === "point" ? f.coords : f.coords?.[0];
                const url = Array.isArray(c) ? `https://maps.google.com/?q=${c[0]},${c[1]}` : "";
                const txt = `📍 ${f.label}\n📁 ${f.projectName || "BCG Sahə"}${url ? `\n🗺️ ${url}` : ""}`;
                if (navigator.share) { try { await navigator.share({ title: f.label, text: txt, url }); return; } catch {} }
                window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, "_blank");
            });
            bg.querySelector("#mpmDel")?.addEventListener("click", () => {
                saveFeatures(feats.filter(x => x.id !== f.id));
                bg.hidden = true;
                hideSelectionBar();
                msg("🗑️ Silindi");
            });
        });
    }

    /* ---------- VƏZİYYƏT 3: SOL AÇILAN MENYU (NAVIGATION DRAWER) ---------- */
    function openNavDrawer() {
        loadFolders();
        const bg = $m("mmNavBg");
        const dr = $m("mmNavDrawer");
        if (!bg || !dr) return;
        const feats = loadFeatures();
        const folderRows = mm.folders.map(fl => {
            const cnt = feats.filter(x => (x.projectName || "Default folder") === fl.name).length;
            return `
                <button type="button" class="mm-nav-row" data-mm-fpick="${escM(fl.name)}">
                    <i class="fa-solid fa-folder" style="color:#fbbf24"></i>
                    <div class="mm-nav-row-txt"><strong>${escM(fl.name)}</strong><small>${cnt} marker</small></div>
                    <i class="fa-solid fa-${fl.visible !== false ? "eye" : "eye-slash"}" style="color:${fl.visible !== false ? "#4ade80" : "#64748b"}"></i>
                </button>`;
        }).join("");

        dr.innerHTML = `
            <button type="button" class="mm-nav-row warn" id="mmNavBackup">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <div class="mm-nav-row-txt"><strong>Data backup / Sinxronizasiya</strong><small>PMO Google Sheets &amp; Bazaya göndər</small></div>
            </button>
            <div class="mm-nav-sec-hdr">Map</div>
            <button type="button" class="mm-nav-row" id="mmNavProjFile">
                <i class="fa-solid fa-sd-card"></i>
                <div class="mm-nav-row-txt"><strong>${escM(mm.createdStamp)}</strong><small>Aktiv layihə · ${escM(mm.activeFolder)}</small></div>
            </button>
            <button type="button" class="mm-nav-row" id="mmNavMapType">
                <i class="fa-solid fa-map"></i>
                <div class="mm-nav-row-txt"><strong>Map type</strong><small>${escM(mm.mapTypeLabel)}</small></div>
            </button>
            <div class="mm-nav-sec-hdr">Folders</div>
            <button type="button" class="mm-nav-row" id="mmNavAllFolders">
                <i class="fa-solid fa-layer-group"></i>
                <div class="mm-nav-row-txt"><strong>All</strong><small>${feats.length} markers in ${mm.folders.length} folders</small></div>
            </button>
            ${folderRows}
            <button type="button" class="mm-nav-row" id="mmNavAddFolder">
                <i class="fa-solid fa-folder-plus" style="color:#4ade80"></i>
                <div class="mm-nav-row-txt"><strong>Add folder</strong><small>Yeni qovluq / layihə yarat</small></div>
            </button>
            <div class="mm-nav-sec-hdr">Help &amp; Feedback</div>
            <button type="button" class="mm-nav-row" id="mmNavSettings">
                <i class="fa-solid fa-gear"></i>
                <div class="mm-nav-row-txt"><strong>Settings</strong><small>Mühəndis, Sheets URL, Adlar</small></div>
            </button>
            <button type="button" class="mm-nav-row" id="mmNavAbout">
                <i class="fa-solid fa-circle-info"></i>
                <div class="mm-nav-row-txt"><strong>About</strong><small>BCG GIS · Map Marker Sahə v3.7</small></div>
            </button>
        `;
        bg.hidden = false;

        dr.querySelector("#mmNavBackup")?.addEventListener("click", () => {
            bg.hidden = true;
            // Mövcud İş Qeydi / Bazaya Göndər vərəqini aç
            $m("sahaBarWorkBtn")?.click();
        });
        dr.querySelector("#mmNavProjFile")?.addEventListener("click", () => {
            bg.hidden = true;
            $m("sahaBarWorkBtn")?.click();
        });
        dr.querySelector("#mmNavMapType")?.addEventListener("click", () => {
            const opts = [["esri", "ESRI Satellite"], ["satellite", "Google Satellite"], ["osm", "OSM Küçə"]];
            const idx = (opts.findIndex(o => o[1] === mm.mapTypeLabel) + 1) % opts.length;
            mm.mapTypeLabel = opts[idx][1];
            if (typeof switchBaseLayer === "function") switchBaseLayer(opts[idx][0]);
            openNavDrawer();
            msg(`🗺️ ${mm.mapTypeLabel}`);
        });
        dr.querySelector("#mmNavAllFolders")?.addEventListener("click", () => {
            mm.filterFolder = "";
            bg.hidden = true;
            msg("📂 Bütün qovluqlar göstərilir");
        });
        dr.querySelectorAll("[data-mm-fpick]").forEach(b => {
            b.addEventListener("click", () => {
                mm.activeFolder = b.dataset.mmFpick;
                bg.hidden = true;
                msg(`📁 Aktiv qovluq: ${mm.activeFolder}`);
            });
        });
        dr.querySelector("#mmNavAddFolder")?.addEventListener("click", () => {
            const nm = prompt("Yeni qovluq / layihə adı:", "");
            if (!nm || !nm.trim()) return;
            mm.folders.push({ name: nm.trim(), visible: true });
            mm.activeFolder = nm.trim();
            saveFolders();
            openNavDrawer();
            msg(`📁 "${mm.activeFolder}" yaradıldı`);
        });
        dr.querySelector("#mmNavSettings")?.addEventListener("click", () => {
            bg.hidden = true;
            $m("sahaBarWorkBtn")?.click();
        });
        dr.querySelector("#mmNavAbout")?.addEventListener("click", () => {
            openPopup("ℹ️ Haqqında", `<p style="margin:0;line-height:1.5"><b>BCG GIS — Map Marker Sahə Modulu v3.7</b><br>Baku Communications Group üçün mobil sahə qeydiyyatı, KMZ/KML və PMO Google Sheets inteqrasiyası.</p>`);
        });
    }

    /* ---------- MAP CLICK HANDLER IN FIELD NORMAL MODE ---------- */
    function handleMapMarkerUiClick(e) {
        if (!isFieldMode()) return false;
        if (mm.placing) return true; // Yerləşdirmə rejimində təsadüfi kliklər bloklanır
        if (!window.map) return false;
        const layers = ["saha-points", "saha-point-labels", "saha-lines-solid", "saha-lines-dashed", "saha-line-labels"].filter(id => map.getLayer(id));
        if (layers.length) {
            const hits = map.queryRenderedFeatures(e.point, { layers });
            const fid = hits?.[0]?.properties?.sahaId;
            if (fid) {
                showSelectionBar(fid);
                return true;
            }
        }
        hideSelectionBar();
        return false;
    }
    window.handleMapMarkerUiClick = handleMapMarkerUiClick;

    /* ---------- BUILD DOM ---------- */
    function buildMapMarkerDom() {
        if (mm.built) return;
        mm.built = true;
        const stage = document.querySelector(".map-stage") || document.body;

        // Vəziyyət 1: Sol-üst 5-ikonlu bar
        const topBar = document.createElement("div");
        topBar.id = "mmTopBar";
        topBar.className = "mm-top-bar";
        topBar.innerHTML = `
            <button type="button" class="mm-ic-btn" id="mmMenuBtn" title="Menyu"><i class="fa-solid fa-bars"></i><span class="mm-warn-dot"></span></button>
            <button type="button" class="mm-ic-btn" id="mmFilterBtn" title="Filtr"><i class="fa-solid fa-filter"></i></button>
            <button type="button" class="mm-ic-btn" id="mmListBtn" title="Obyekt siyahısı"><i class="fa-solid fa-list"></i></button>
            <button type="button" class="mm-ic-btn" id="mmSearchBtn" title="Axtarış"><i class="fa-solid fa-magnifying-glass"></i></button>
            <button type="button" class="mm-ic-btn" id="mmShareBtn" title="Paylaş / İxrac (KMZ, WhatsApp)"><i class="fa-solid fa-arrow-up-from-bracket"></i></button>
        `;
        stage.appendChild(topBar);

        // Sağ-üst GPS & Sağ-aşağı +📍
        const gps = document.createElement("button");
        gps.id = "mmGpsFab"; gps.className = "mm-gps-fab"; gps.title = "Mənim konumum (GPS)";
        gps.innerHTML = `<i class="fa-solid fa-location-crosshairs"></i>`;
        stage.appendChild(gps);

        const addFab = document.createElement("button");
        addFab.id = "mmAddFab"; addFab.className = "mm-add-fab"; addFab.title = "Marker / Obyekt əlavə et";
        addFab.innerHTML = `<span>+</span><i class="fa-solid fa-location-dot" style="font-size:16px"></i>`;
        stage.appendChild(addFab);

        // Aşağı Seçim Zolağı
        const sel = document.createElement("div");
        sel.id = "mmSelBar"; sel.className = "mm-sel-bar";
        stage.appendChild(sel);

        // Vəziyyət 2: Yuxarı-orta Qovluq, Sol Qövs 4 Düymə, Mərkəzi Hədəf, Aşağı Təsdiq
        const pf = document.createElement("button");
        pf.id = "mmPlaceFolder"; pf.className = "mm-place-folder";
        pf.innerHTML = `<i class="fa-solid fa-folder" style="color:#fbbf24"></i><span id="mmPlaceFolderLbl">Default folder</span><i class="fa-solid fa-caret-down" style="font-size:11px;opacity:0.7"></i>`;
        stage.appendChild(pf);

        const arc = document.createElement("div");
        arc.id = "mmArcTools"; arc.className = "mm-arc-tools";
        arc.innerHTML = `
            <button type="button" class="mm-arc-btn" data-arc="track" title="GPS Track (gəzərək iz çək)"><i class="fa-solid fa-shoe-prints"></i></button>
            <button type="button" class="mm-arc-btn" data-arc="line" title="Sınıq xətt (FO 12/24/48, Elektrik, Qazıntı)"><i class="fa-solid fa-route"></i></button>
            <button type="button" class="mm-arc-btn" data-arc="polygon" title="Poliqon (qapalı sahə)"><i class="fa-solid fa-draw-polygon"></i></button>
            <button type="button" class="mm-arc-btn" data-arc="circle" title="Dairə (radius zona)"><i class="fa-regular fa-circle"></i></button>
        `;
        stage.appendChild(arc);

        const ret = document.createElement("div");
        ret.id = "mmReticle"; ret.className = "mm-reticle";
        ret.innerHTML = `<span class="mm-ret-circle"></span><span class="mm-ret-h"></span><span class="mm-ret-v"></span><i class="fa-solid fa-location-dot mm-ret-pin"></i>`;
        stage.appendChild(ret);

        const conf = document.createElement("div");
        conf.id = "mmPlaceConfirm"; conf.className = "mm-place-confirm";
        conf.innerHTML = `
            <div class="mm-place-subbar" id="mmPlaceSubbar"></div>
            <div class="mm-place-btns">
                <button type="button" class="mm-confirm-btn" id="mmPlaceCancel">Cancel</button>
                <button type="button" class="mm-confirm-btn addpt" id="mmPlaceAddPtBtn" title="Nöqtə əlavə et" hidden>+</button>
                <button type="button" class="mm-confirm-btn ok" id="mmPlaceOk">OK</button>
            </div>
            <div class="mm-coord-box" id="mmCoordBox">Lat: 40.40930<br>Lng: 49.86710</div>
        `;
        stage.appendChild(conf);

        // Vəziyyət 3: Navigation Drawer & Popup backdrop
        const navBg = document.createElement("div");
        navBg.id = "mmNavBg"; navBg.className = "mm-nav-backdrop"; navBg.hidden = true;
        navBg.innerHTML = `<aside class="mm-nav-drawer" id="mmNavDrawer"></aside>`;
        document.body.appendChild(navBg);

        const popBg = document.createElement("div");
        popBg.id = "mmPopupBg"; popBg.className = "mm-popup-backdrop"; popBg.hidden = true;
        document.body.appendChild(popBg);

        bindMmEvents();
    }

    function bindMmEvents() {
        $m("mmMenuBtn")?.addEventListener("click", openNavDrawer);
        $m("mmNavBg")?.addEventListener("click", e => { if (e.target.id === "mmNavBg") e.target.hidden = true; });
        $m("mmPopupBg")?.addEventListener("click", e => { if (e.target.id === "mmPopupBg") e.target.hidden = true; });

        $m("mmGpsFab")?.addEventListener("click", () => {
            if (!navigator.geolocation) { msg("GPS dəstəklənmir", true); return; }
            navigator.geolocation.getCurrentPosition(pos => {
                const la = pos.coords.latitude, ln = pos.coords.longitude;
                if (window.map) map.flyTo({ center: [ln, la], zoom: Math.max(map.getZoom(), 17), duration: 600 });
                msg(`📍 GPS: ${la.toFixed(5)}, ${ln.toFixed(5)}`);
            }, err => msg(`GPS xətası: ${err.message}`, true), { enableHighAccuracy: true, timeout: 10000 });
        });

        $m("mmAddFab")?.addEventListener("click", () => enterPlacingMode(""));
        $m("mmShareBtn")?.addEventListener("click", () => $m("sahaBarShareBtn")?.click());

        $m("mmSearchBtn")?.addEventListener("click", () => {
            openPopup("🔍 Axtarış", `
                <input type="search" class="input" id="mmPopSearchInp" placeholder="Ad, TŞ nömrəsi və ya 40.4093, 49.8671" style="height:40px;font-size:14px">
                <button type="button" class="btn btn-primary" id="mmPopSearchGo" style="height:40px">Tap</button>
            `, bg => {
                const run = () => {
                    const q = bg.querySelector("#mmPopSearchInp").value.trim();
                    if (!q) return;
                    bg.hidden = true;
                    const inp = $m("sahaQuickSearch");
                    if (inp) { inp.value = q; inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }
                };
                bg.querySelector("#mmPopSearchGo")?.addEventListener("click", run);
                bg.querySelector("#mmPopSearchInp")?.addEventListener("keydown", e => { if (e.key === "Enter") run(); });
                setTimeout(() => bg.querySelector("#mmPopSearchInp")?.focus(), 50);
            });
        });

        $m("mmListBtn")?.addEventListener("click", () => {
            const feats = loadFeatures();
            const rows = feats.length ? feats.slice().reverse().map(f => `
                <button type="button" class="mm-nav-row" data-mml-id="${escM(f.id)}">
                    <i class="fa-solid fa-${f.kind === "line" ? "route" : "location-dot"}" style="color:#fbbf24"></i>
                    <div class="mm-nav-row-txt"><strong>${escM(f.label || f.type)}</strong><small>${escM(f.projectName || "Default folder")} · ${escM(f.createdAt || "")}</small></div>
                </button>`).join("") : `<div style="padding:14px;color:#9aa0a6;text-align:center">Hələ obyekt əlavə edilməyib</div>`;
            openPopup(`📋 Obyektlər (${feats.length})`, rows, bg => {
                bg.querySelectorAll("[data-mml-id]").forEach(b => b.addEventListener("click", () => {
                    const f = feats.find(x => x.id === b.dataset.mmlId);
                    bg.hidden = true;
                    if (f && window.map) {
                        const c = f.kind === "point" ? f.coords : f.coords?.[0];
                        if (Array.isArray(c)) map.flyTo({ center: [c[1], c[0]], zoom: 17, duration: 600 });
                        showSelectionBar(f.id);
                    }
                }));
            });
        });

        $m("mmFilterBtn")?.addEventListener("click", () => {
            loadFolders();
            const rows = `<button type="button" class="mm-nav-row" data-mmf=""><strong>Hamısı (All)</strong></button>` +
                mm.folders.map(fl => `<button type="button" class="mm-nav-row" data-mmf="${escM(fl.name)}"><i class="fa-solid fa-folder" style="color:#fbbf24"></i><strong>${escM(fl.name)}</strong></button>`).join("");
            openPopup("🔽 Qovluq üzrə Filtr", rows, bg => {
                bg.querySelectorAll("[data-mmf]").forEach(b => b.addEventListener("click", () => {
                    mm.filterFolder = b.dataset.mmf;
                    bg.hidden = true;
                    msg(mm.filterFolder ? `🔽 Filtr: ${mm.filterFolder}` : "🔽 Bütün obyektlər");
                }));
            });
        });

        // Vəziyyət 2 events
        $m("mmPlaceFolder")?.addEventListener("click", () => {
            loadFolders();
            const rows = mm.folders.map(fl => `<button type="button" class="mm-nav-row" data-mmpf="${escM(fl.name)}"><i class="fa-solid fa-folder" style="color:#fbbf24"></i><strong>${escM(fl.name)}</strong></button>`).join("") +
                `<button type="button" class="mm-nav-row" id="mmpfNew"><i class="fa-solid fa-folder-plus" style="color:#4ade80"></i><strong>+ Yeni qovluq / layihə</strong></button>`;
            openPopup("📁 Qovluq seçin", rows, bg => {
                bg.querySelectorAll("[data-mmpf]").forEach(b => b.addEventListener("click", () => {
                    mm.activeFolder = b.dataset.mmpf;
                    bg.hidden = true;
                    updatePlacingUi();
                }));
                bg.querySelector("#mmpfNew")?.addEventListener("click", () => {
                    const nm = prompt("Yeni qovluğun adı:", "");
                    if (!nm || !nm.trim()) return;
                    mm.folders.push({ name: nm.trim(), visible: true });
                    mm.activeFolder = nm.trim();
                    saveFolders();
                    bg.hidden = true;
                    updatePlacingUi();
                });
            });
        });

        $m("mmArcTools")?.addEventListener("click", e => {
            const b = e.target.closest("[data-arc]");
            if (!b) return;
            stopGpsTrack();
            const next = b.dataset.arc;
            mm.arcMode = (mm.arcMode === next) ? "point" : next;
            mm.draft = [];
            renderMmDraft();
            updatePlacingUi();
            updateLiveCoords();
            if (mm.arcMode === "track" && navigator.geolocation) {
                msg("👣 GPS Track başladı — ərazidə gəzin, bitəndə OK basın");
                mm.trackWatchId = navigator.geolocation.watchPosition(pos => {
                    const pt = [Number(pos.coords.latitude.toFixed(6)), Number(pos.coords.longitude.toFixed(6))];
                    if (!mm.draft.length || hav(mm.draft[mm.draft.length - 1], pt) >= 3) {
                        mm.draft.push(pt);
                        renderMmDraft();
                        updateLiveCoords();
                    }
                }, () => {}, { enableHighAccuracy: true });
            }
        });

        $m("mmPlaceSubbar")?.addEventListener("click", e => {
            const own = e.target.closest("[data-mm-own]")?.dataset.mmOwn;
            if (own) { mm.owner = own; updatePlacingUi(); return; }
            const pt = e.target.closest("[data-mm-pt]")?.dataset.mmPt;
            if (pt) { const [t, s] = pt.split("|"); mm.ptType = t; mm.ptSub = s; updatePlacingUi(); return; }
            const ln = e.target.closest("[data-mm-ln]")?.dataset.mmLn;
            if (ln) { mm.lineType = ln; updatePlacingUi(); }
        });

        $m("mmPlaceAddPtBtn")?.addEventListener("click", () => {
            if (!window.map) return;
            const c = map.getCenter();
            mm.draft.push([Number(c.lat.toFixed(6)), Number(c.lng.toFixed(6))]);
            renderMmDraft();
            updateLiveCoords();
        });
        $m("mmPlaceCancel")?.addEventListener("click", exitPlacingMode);
        $m("mmPlaceOk")?.addEventListener("click", confirmPlacement);
    }

    function hookMapMove() {
        if (!window.map) { setTimeout(hookMapMove, 400); return; }
        map.on("move", () => { if (mm.placing) updateLiveCoords(); });
    }

    function initMapMarkerUi() {
        loadFolders();
        buildMapMarkerDom();
        hookMapMove();
        const obs = new MutationObserver(() => {
            if (!isFieldMode()) {
                exitPlacingMode();
                hideSelectionBar();
            } else if (typeof switchBaseLayer === "function" && typeof currentBase !== "undefined" && currentBase !== "esri" && mm.mapTypeLabel === "ESRI Satellite") {
                try { switchBaseLayer("esri"); } catch {}
            }
        });
        obs.observe(document.body, { attributes: true, attributeFilter: ["data-workspace-mode"] });
    }

    document.addEventListener("DOMContentLoaded", initMapMarkerUi);
})();
