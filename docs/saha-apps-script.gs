/**
 * BCG GIS — Sahə Modulu (Google Apps Script Web App)
 * ==================================================
 * Mövcud PMO Google Sheets cədvəlinə kumulyativ (köhnə + yeni) yazılış,
 * mərhələ işarələmə, düstur qoruması, TŞ yoxlaması, LockService kilidi,
 * Sahə_Jurnal qeydiyyatı və Admin "Geri al (Undo)" funksiyası.
 *
 * QURAŞDIRMA (1 dəqiqə):
 * 1. PMO Google Sheets cədvəlində: Extensions → Apps Script açın.
 * 2. Bu faylın bütün mətnini Code.gs içinə yapışdırın və yadda saxlayın.
 * 3. Aşağıdakı `setupSahaToken()` funksiyasını bir dəfə işə salın (öz gizli tokeninizi yazın)
 *    və ya Project Settings → Script Properties → SAHA_TOKEN əlavə edin.
 * 4. Deploy → New deployment → Web app:
 *      - Execute as: Me (cədvəl sahibi)
 *      - Who has access: Anyone
 * 5. Yaranan Web App URL-ni və Tokeni BCG GIS saytında Sahə → Ofis & Jurnal → Bağlantı bölməsinə yazın.
 */

const JOURNAL_SHEET_NAME = "Sahə_Jurnal";
const JOURNAL_HEADERS = [
  "Göndəriş ID",
  "Vaxt",
  "İş tarixi",
  "Mühəndis",
  "Layihə",
  "TŞ nömrə",
  "Material/İş",
  "Əlavə miqdar",
  "Köhnə dəyər",
  "Yeni dəyər",
  "Qeyd",
  "GPS",
  "Geri alınma",
  "Vərəq",
  "Sətir",
  "Sütun"
];

/** Bir dəfəlik token quraşdırma köməkçisi (öz parol/tokeninizi yazın və Run basın) */
function setupSahaToken() {
  const token = "BCG-SAHA-2026-SECRET"; // <-- İstədiyiniz güclü tokenlə əvəz edin
  PropertiesService.getScriptProperties().setProperty("SAHA_TOKEN", token);
  Logger.log("SAHA_TOKEN yadda saxlanıldı.");
}

function getExpectedToken_() {
  return String(PropertiesService.getScriptProperties().getProperty("SAHA_TOKEN") || "").trim();
}

function checkToken_(provided) {
  const expected = getExpectedToken_();
  if (!expected) return true; // Token hələ təyin olunmayıbsa açıqdır (istehsalda mütləq setupSahaToken() işlədin)
  return String(provided || "").trim() === expected;
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Boşluqlu koordinatları (məs: "41.417690, 46 927913") avtomatik düzəldir */
function fixSpaceCoord_(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  s = s.replace(/(\d{2})\s+(\d{4,7})/g, "$1.$2");
  const m = s.match(/(-?\d{1,2}[.,]\d+)\s*[,;\s/]+\s*(-?\d{1,3}[.,]\d+)/);
  if (!m) return s;
  const a = Number(m[1].replace(",", "."));
  const b = Number(m[2].replace(",", "."));
  if (!isFinite(a) || !isFinite(b)) return s;
  if (a >= 38 && a <= 42.5 && b >= 44 && b <= 51.5) return a.toFixed(6) + ", " + b.toFixed(6);
  if (b >= 38 && b <= 42.5 && a >= 44 && a <= 51.5) return b.toFixed(6) + ", " + a.toFixed(6);
  return s;
}

function normStr_(v) {
  return String(v || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function findSheetById_(ss, sheetId) {
  const target = String(sheetId || "").trim();
  if (!target) return null;
  let sh = ss.getSheetByName(target);
  if (sh) return sh;
  const alt = target.replace(/\./g, ",");
  sh = ss.getSheetByName(alt);
  if (sh) return sh;
  const all = ss.getSheets();
  for (let i = 0; i < all.length; i++) {
    const n = all[i].getName().trim();
    if (n === target || n === alt) return all[i];
  }
  return null;
}

/** 3-cü sətirdən "Material" sütunundan sağdakı bütün materialları və mərhələ sütunlarını tapır */
function inspectSheetSchema_(sh) {
  const lastCol = sh.getLastColumn();
  if (lastCol < 5) return { materialCol: -1, materials: [], stages: {}, tsCol: 7 };
  const row3 = sh.getRange(3, 1, 1, lastCol).getDisplayValues()[0];
  let materialCol = -1;
  let tsCol = 7; // G sütunu default
  const stages = {};
  const stageMatchers = [
    { key: "BUNOVRE", re: /^b[üu]n[öo]vr[əe]$/i },
    { key: "DIREK",   re: /^dir[əe]k$/i },
    { key: "OPTIK",   re: /^opt[iı]k$/i },
    { key: "ELEKTRIK", re: /^elektr[iı]k$/i }
  ];

  for (let c = 0; c < row3.length; c++) {
    const h = String(row3[c] || "").replace(/\s+/g, " ").trim();
    if (!h) continue;
    const col1 = c + 1;
    if (/^material$/i.test(h)) {
      materialCol = col1;
    }
    if (/^t[şs]\s*n[öo]mr[əe]/i.test(h)) {
      tsCol = col1;
    }
    // Mərhələ sütunları Material sütunundan soldadır (adətən S, T, U, V)
    if (materialCol === -1 && col1 >= 15) {
      for (let k = 0; k < stageMatchers.length; k++) {
        if (!stages[stageMatchers[k].key] && stageMatchers[k].re.test(h)) {
          stages[stageMatchers[k].key] = { col: col1, name: h };
        }
      }
    }
  }

  const materials = [];
  if (materialCol > 0) {
    for (let c = materialCol; c < row3.length; c++) {
      const h = String(row3[c] || "").replace(/\s+/g, " ").trim();
      if (!h) continue;
      materials.push({ col: c + 1, name: h });
    }
  }
  return { materialCol: materialCol, materials: materials, stages: stages, tsCol: tsCol };
}

/** TŞ nömrəsi və ya sətir nömrəsi ilə Layihə sətrini və altındakı "İcra olunan" sətrini tapır və doğrulayır */
function locatePointRows_(sh, schema, expectedRow, tsNo) {
  const lastRow = sh.getLastRow();
  const tsCol = schema.tsCol || 7;
  const matCol = schema.materialCol > 0 ? schema.materialCol : 31; // AE = 31
  const targetTs = normStr_(tsNo);

  function verifyPair(planRow) {
    if (planRow < 6 || planRow + 1 > lastRow) return null;
    const cellTs = normStr_(sh.getRange(planRow, tsCol).getDisplayValue());
    if (targetTs && cellTs && cellTs !== targetTs && cellTs.indexOf(targetTs) === -1 && targetTs.indexOf(cellTs) === -1) {
      return null;
    }
    const execLabel = normStr_(sh.getRange(planRow + 1, matCol).getDisplayValue());
    if (execLabel && execLabel.indexOf("icra") === -1 && execLabel !== "") {
      // Növbəti sətir başqa nöqtədirsə yazma
      const nextTs = normStr_(sh.getRange(planRow + 1, tsCol).getDisplayValue());
      if (nextTs && nextTs !== cellTs) return null;
    }
    return { planRow: planRow, execRow: planRow + 1, actualTs: sh.getRange(planRow, tsCol).getDisplayValue().trim() };
  }

  // 1) Əvvəlcə gözlənilən sətir nömrəsini yoxla
  if (expectedRow && expectedRow >= 6) {
    const ok = verifyPair(Number(expectedRow));
    if (ok) return ok;
  }

  // 2) Sətir sürüşübsə bütün TŞ sütununda axtar
  if (targetTs) {
    const tsVals = sh.getRange(6, tsCol, Math.max(1, lastRow - 5), 1).getDisplayValues();
    for (let i = 0; i < tsVals.length; i++) {
      const v = normStr_(tsVals[i][0]);
      if (v && v === targetTs) {
        const ok = verifyPair(6 + i);
        if (ok) return ok;
      }
    }
  }
  return null;
}

function ensureJournalSheet_(ss) {
  let jSh = ss.getSheetByName(JOURNAL_SHEET_NAME);
  if (!jSh) {
    jSh = ss.insertSheet(JOURNAL_SHEET_NAME);
    jSh.getRange(1, 1, 1, JOURNAL_HEADERS.length).setValues([JOURNAL_HEADERS]);
    jSh.setFrozenRows(1);
    jSh.getRange(1, 1, 1, JOURNAL_HEADERS.length).setFontWeight("bold");
  }
  return jSh;
}

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (!checkToken_(p.token)) {
      return jsonOut_({ ok: false, error: "Token yanlışdır (Unauthorized)" });
    }
    const action = String(p.action || "ping").trim();
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === "ping") {
      return jsonOut_({ ok: true, spreadsheet: ss.getName(), time: new Date().toISOString() });
    }

    if (action === "materials") {
      const sh = findSheetById_(ss, p.sheet);
      if (!sh) return jsonOut_({ ok: false, error: "Vərəq tapılmadı: " + p.sheet });
      const schema = inspectSheetSchema_(sh);
      const result = {
        ok: true,
        sheet: sh.getName(),
        projectName: String(sh.getRange("A1").getDisplayValue() || "").trim(),
        materialCol: schema.materialCol,
        materials: schema.materials,
        stages: schema.stages,
        pointState: null
      };

      if (p.tsNo || p.row) {
        const loc = locatePointRows_(sh, schema, Number(p.row || 0), p.tsNo || "");
        if (loc) {
          const lastCol = sh.getLastColumn();
          const execVals = sh.getRange(loc.execRow, 1, 1, lastCol).getValues()[0];
          const execFormulas = sh.getRange(loc.execRow, 1, 1, lastCol).getFormulas()[0];
          const planVals = sh.getRange(loc.planRow, 1, 1, lastCol).getValues()[0];
          const curMats = {};
          schema.materials.forEach(function (m) {
            const idx = m.col - 1;
            curMats[m.name] = {
              col: m.col,
              plan: Number(planVals[idx]) || 0,
              done: Number(execVals[idx]) || 0,
              hasFormula: Boolean(execFormulas[idx])
            };
          });
          const curStages = {};
          Object.keys(schema.stages).forEach(function (k) {
            const colIdx = schema.stages[k].col - 1;
            curStages[k] = {
              col: schema.stages[k].col,
              done: Number(execVals[colIdx]) > 0,
              hasFormula: Boolean(execFormulas[colIdx])
            };
          });
          result.pointState = {
            planRow: loc.planRow,
            execRow: loc.execRow,
            tsNo: loc.actualTs,
            coord: fixSpaceCoord_(sh.getRange(loc.planRow, 3).getDisplayValue()),
            materials: curMats,
            stages: curStages
          };
        }
      }
      return jsonOut_(result);
    }

    if (action === "journal") {
      const jSh = ss.getSheetByName(JOURNAL_SHEET_NAME);
      if (!jSh || jSh.getLastRow() < 2) {
        return jsonOut_({ ok: true, rows: [] });
      }
      const limit = Math.min(500, Math.max(20, Number(p.limit || 250)));
      const lastRow = jSh.getLastRow();
      const startRow = Math.max(2, lastRow - limit + 1);
      const vals = jSh.getRange(startRow, 1, lastRow - startRow + 1, JOURNAL_HEADERS.length).getDisplayValues();
      const rows = vals.map(function (r, idx) {
        return {
          journalRow: startRow + idx,
          submissionId: r[0],
          timestamp: r[1],
          workDate: r[2],
          engineer: r[3],
          projectName: r[4],
          tsNo: r[5],
          material: r[6],
          addQty: Number(String(r[7]).replace(",", ".")) || 0,
          oldVal: Number(String(r[8]).replace(",", ".")) || 0,
          newVal: Number(String(r[9]).replace(",", ".")) || 0,
          note: r[10],
          gps: r[11],
          undone: r[12],
          sheetId: r[13],
          execRow: Number(r[14]) || 0,
          col: Number(r[15]) || 0
        };
      }).reverse();
      return jsonOut_({ ok: true, rows: rows });
    }

    return jsonOut_({ ok: false, error: "Naməlum action: " + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const rawBody = (e && e.postData && e.postData.contents) ? e.postData.contents : "{}";
    const body = JSON.parse(rawBody);
    if (!checkToken_(body.token)) {
      return jsonOut_({ ok: false, error: "Token yanlışdır (Unauthorized)" });
    }

    lock.waitLock(25000);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const action = String(body.action || "submit").trim();

    if (action === "submit") {
      const sh = findSheetById_(ss, body.sheetId);
      if (!sh) return jsonOut_({ ok: false, error: "Layihə vərəqi tapılmadı: " + body.sheetId });
      const schema = inspectSheetSchema_(sh);
      const loc = locatePointRows_(sh, schema, Number(body.planRow || 0), body.tsNo || "");
      if (!loc) {
        return jsonOut_({ ok: false, error: "Nöqtə (TŞ nömrə) vərəqdə tapılmadı və ya sətir uyğun gəlmədi: " + (body.tsNo || body.planRow) });
      }

      const submissionId = String(body.submissionId || ("SH-" + Utilities.formatDate(new Date(), "Asia/Baku", "yyyyMMdd-HHmmss") + "-" + Math.floor(Math.random() * 900 + 100)));
      const nowStr = Utilities.formatDate(new Date(), "Asia/Baku", "dd.MM.yyyy HH:mm:ss");
      const workDate = String(body.workDate || Utilities.formatDate(new Date(), "Asia/Baku", "yyyy-MM-dd"));
      const engineer = String(body.engineer || "Mühəndis").trim();
      const projectName = String(body.projectName || sh.getRange("A1").getDisplayValue() || sh.getName()).trim();
      const tsLabel = loc.actualTs || String(body.tsNo || "").trim();
      const note = String(body.note || "").trim();
      const gps = fixSpaceCoord_(body.gps || "");

      const matByName = {};
      schema.materials.forEach(function (m) { matByName[normStr_(m.name)] = m; });

      const jSh = ensureJournalSheet_(ss);
      const written = [];
      const skippedFormulas = [];
      const journalAppend = [];

      // 1) Materiallar: kumulyativ (köhnə + yeni) yazılış, düstur qoruması ilə
      const items = Array.isArray(body.materials) ? body.materials : [];
      items.forEach(function (item) {
        const addQty = Number(item.qty);
        if (!isFinite(addQty) || addQty === 0) return;
        let col = Number(item.col || 0);
        let matName = String(item.name || "").trim();
        if (!col && matName && matByName[normStr_(matName)]) {
          col = matByName[normStr_(matName)].col;
          matName = matByName[normStr_(matName)].name;
        }
        if (!col || col <= schema.materialCol) return;

        const cell = sh.getRange(loc.execRow, col);
        if (cell.getFormula()) {
          skippedFormulas.push(matName);
          return;
        }
        const oldVal = Number(cell.getValue()) || 0;
        const newVal = Math.round((oldVal + addQty) * 100) / 100;
        cell.setValue(newVal);

        written.push({ name: matName, col: col, addQty: addQty, oldVal: oldVal, newVal: newVal });
        journalAppend.push([
          submissionId, nowStr, workDate, engineer, projectName, tsLabel,
          matName, addQty, oldVal, newVal, note, gps, "",
          sh.getName(), loc.execRow, col
        ]);
      });

      // 2) Mərhələlər (BÜNÖVRƏ, DİRƏK, OPTİK, ELEKTRİK): tamamlandıqca 1 kimi işarələnir (düstur varsa toxunmur!)
      const reqStages = body.stages && typeof body.stages === "object" ? body.stages : {};
      Object.keys(reqStages).forEach(function (stKey) {
        if (!reqStages[stKey]) return;
        const stInfo = schema.stages[stKey];
        if (!stInfo) return;
        const cell = sh.getRange(loc.execRow, stInfo.col);
        if (cell.getFormula()) {
          skippedFormulas.push("Mərhələ: " + stInfo.name);
          return;
        }
        const oldVal = Number(cell.getValue()) || 0;
        if (oldVal >= 1) return;
        cell.setValue(1);
        written.push({ name: "Mərhələ: " + stInfo.name, col: stInfo.col, addQty: 1, oldVal: oldVal, newVal: 1 });
        journalAppend.push([
          submissionId, nowStr, workDate, engineer, projectName, tsLabel,
          "Mərhələ: " + stInfo.name, 1, oldVal, 1, note, gps, "",
          sh.getName(), loc.execRow, stInfo.col
        ]);
      });

      if (journalAppend.length > 0) {
        jSh.getRange(jSh.getLastRow() + 1, 1, journalAppend.length, JOURNAL_HEADERS.length).setValues(journalAppend);
      }
      SpreadsheetApp.flush();

      return jsonOut_({
        ok: true,
        submissionId: submissionId,
        planRow: loc.planRow,
        execRow: loc.execRow,
        tsNo: tsLabel,
        written: written,
        skippedFormulas: skippedFormulas
      });
    }

    if (action === "undo") {
      const targetSubId = String(body.submissionId || "").trim();
      const adminName = String(body.admin || "Admin").trim();
      if (!targetSubId) return jsonOut_({ ok: false, error: "submissionId tələb olunur" });

      const jSh = ss.getSheetByName(JOURNAL_SHEET_NAME);
      if (!jSh || jSh.getLastRow() < 2) return jsonOut_({ ok: false, error: "Sahə_Jurnal boşdur" });

      const vals = jSh.getRange(2, 1, jSh.getLastRow() - 1, JOURNAL_HEADERS.length).getValues();
      const nowStr = Utilities.formatDate(new Date(), "Asia/Baku", "dd.MM.yyyy HH:mm");
      let reverted = 0;

      for (let i = 0; i < vals.length; i++) {
        const r = vals[i];
        if (String(r[0]).trim() !== targetSubId) continue;
        if (String(r[12] || "").trim()) continue; // Artıq geri alınıb

        const shName = String(r[13] || "").trim();
        const execRow = Number(r[14]) || 0;
        const col = Number(r[15]) || 0;
        const addQty = Number(r[7]) || 0;
        const tsExpected = normStr_(r[5]);

        const sh = findSheetById_(ss, shName);
        if (sh && execRow >= 7 && col >= 1) {
          const schema = inspectSheetSchema_(sh);
          const actualTs = normStr_(sh.getRange(execRow - 1, schema.tsCol || 7).getDisplayValue());
          if (!tsExpected || !actualTs || actualTs === tsExpected) {
            const cell = sh.getRange(execRow, col);
            if (!cell.getFormula()) {
              const cur = Number(cell.getValue()) || 0;
              const next = Math.max(0, Math.round((cur - addQty) * 100) / 100);
              cell.setValue(next);
            }
          }
        }
        jSh.getRange(i + 2, 13).setValue("Geri alındı (" + adminName + " · " + nowStr + ")");
        reverted++;
      }

      SpreadsheetApp.flush();
      return jsonOut_({ ok: true, submissionId: targetSubId, reverted: reverted });
    }

    return jsonOut_({ ok: false, error: "Naməlum POST action: " + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}
