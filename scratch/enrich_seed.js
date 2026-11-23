const fs = require('fs');
const zlib = require('zlib');

const buf = fs.readFileSync('C:\\Users\\bagir\\.gemini\\antigravity\\brain\\9f82987f-a383-408b-a13d-6ada61c476bf\\scratch\\pmo_test.xlsx');

function unzip(buffer) {
    const files = {};
    let eocdOffset = -1;
    for (let i = buffer.length - 22; i >= 0; i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) { eocdOffset = i; break; }
    }
    const cdCount = buffer.readUInt16LE(eocdOffset + 10);
    let cdOffset = buffer.readUInt32LE(eocdOffset + 16);
    for (let i = 0; i < cdCount; i++) {
        if (buffer.readUInt32LE(cdOffset) !== 0x02014b50) break;
        const method = buffer.readUInt16LE(cdOffset + 10);
        const compSize = buffer.readUInt32LE(cdOffset + 20);
        const nameLen = buffer.readUInt16LE(cdOffset + 28);
        const extraLen = buffer.readUInt16LE(cdOffset + 30);
        const commentLen = buffer.readUInt16LE(cdOffset + 32);
        const localHeaderOffset = buffer.readUInt32LE(cdOffset + 42);
        const name = buffer.toString('utf8', cdOffset + 46, cdOffset + 46 + nameLen);
        const lNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
        const lExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
        const compData = buffer.subarray(dataStart, dataStart + compSize);
        let content;
        if (method === 0) content = compData;
        else if (method === 8) content = zlib.inflateRawSync(compData);
        if (content) files[name] = content.toString('utf8');
        cdOffset += 46 + nameLen + extraLen + commentLen;
    }
    return files;
}

const files = unzip(buf);
const sst = [];
for (const si of (files['xl/sharedStrings.xml'].match(/<si>[\s\S]*?<\/si>/g) || [])) {
    const tMatches = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    sst.push(tMatches.map(m => m.replace(/<[^>]+>/g, '')).join(''));
}
const relMap = {};
for (const r of (files['xl/_rels/workbook.xml.rels'].match(/<Relationship[^>]+>/g) || [])) {
    relMap[r.match(/Id="([^"]+)"/)?.[1]] = 'xl/' + r.match(/Target="([^"]+)"/)?.[1];
}
const sheets = [];
for (const s of (files['xl/workbook.xml'].match(/<sheet [^>]+>/g) || [])) {
    sheets.push({
        name: s.match(/name="([^"]+)"/)?.[1],
        path: relMap[s.match(/r:id="([^"]+)"/)?.[1]]
    });
}

function parseRowCells(rowXml) {
    const cells = {};
    const cRegex = /<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let m;
    while ((m = cRegex.exec(rowXml)) !== null) {
        const attrs = m[1];
        const body = m[2] || '';
        const ref = attrs.match(/r="([A-Z]+)\d+"/)?.[1];
        const t = attrs.match(/t="([^"]+)"/)?.[1] || 'n';
        const vMatch = body.match(/<v>([\s\S]*?)<\/v>/);
        const isMatch = body.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);
        let val = vMatch ? vMatch[1] : (isMatch ? isMatch[1] : undefined);
        if (t === 's' && val !== undefined) val = sst[parseInt(val, 10)];
        if (val !== undefined && val !== '') cells[ref] = val;
    }
    return cells;
}

const seedData = require('../js/pmo-seed-data.js');
let updatedCount = 0;

for (const p of seedData) {
    const sh = sheets.find(s => s.name === p.sheetId);
    if (!sh) continue;
    const xml = files[sh.path];
    if (!xml) continue;
    const rowMatches = xml.match(/<row [^>]*>[\s\S]*?<\/row>/g) || [];
    const rows = [];
    for (const rXml of rowMatches) {
        const rNum = parseInt(rXml.match(/r="(\d+)"/)?.[1], 10);
        const cells = parseRowCells(rXml);
        cells.__rowNum__ = rNum;
        rows.push(cells);
    }

    const r3 = rows.find(r => r.__rowNum__ === 3 || r.__rowNum__ === 2) || rows[2] || {};
    let cableCol = '';
    for (const [colKey, val] of Object.entries(r3)) {
        if (/FO\s*kabelin\s*çəkilməsi/i.test(String(val || ''))) {
            cableCol = colKey;
            break;
        }
    }
    if (!cableCol) cableCol = (p.sheetId === '11') ? 'CY' : 'CT';

    // Map subpoints by exact row id
    const pointCables = new Map();
    const pointExecs = new Map();

    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.A && (r.A.includes('🟢') || r.A.includes('🟡') || r.A.includes('🔴'))) {
            const nextR = (i + 1 < rows.length) ? rows[i + 1] : {};
            const ptIdExact = `pmo_${p.sheetId}_r${r.__rowNum__}`;
            const ptIdPlus = `pmo_${p.sheetId}_r${r.__rowNum__ + 1}`;
            const cVal = parseFloat(nextR[cableCol]) || parseFloat(r[cableCol]) || 0;
            const bcg = (r.K && r.K !== '-' && r.K !== '0') ? r.K : ((nextR.K && nextR.K !== '-' && nextR.K !== '0') ? nextR.K : '');
            const avi = (r.L && r.L !== '-' && r.L !== '0') ? r.L : ((nextR.L && nextR.L !== '-' && nextR.L !== '0') ? nextR.L : '');
            
            pointCables.set(ptIdExact, cVal);
            pointCables.set(ptIdPlus, cVal);
            if (r.G) pointCables.set(`ts::${r.G.trim()}`, cVal);
            if (r.D) pointCables.set(`addr::${r.D.trim().slice(0, 35)}`, cVal);

            pointExecs.set(ptIdExact, { bcg, avi });
            pointExecs.set(ptIdPlus, { bcg, avi });
            if (r.D) pointExecs.set(`addr::${r.D.trim().slice(0, 35)}`, { bcg, avi });
        }
    }

    for (const item of (p.items || [])) {
        if (item.pmoRayon?.subPoints) {
            for (const sp of item.pmoRayon.subPoints) {
                const cVal = pointCables.get(sp.id)
                    || (sp.tsNo ? pointCables.get(`ts::${sp.tsNo.trim()}`) : 0)
                    || (sp.address ? pointCables.get(`addr::${sp.address.trim().slice(0, 35)}`) : 0)
                    || 0;
                
                if (cVal > 0) {
                    sp.cableDoneM = cVal;
                    updatedCount++;
                }

                const ex = pointExecs.get(sp.id) || (sp.address ? pointExecs.get(`addr::${sp.address.trim().slice(0, 35)}`) : null);
                if (ex) {
                    if (ex.bcg && !sp.bcgExec) sp.bcgExec = ex.bcg;
                    if (ex.avi && !sp.avicomExec) sp.avicomExec = ex.avi;
                }
            }
        }
    }
}

console.log(`Updated ${updatedCount} subpoints with cableDoneM`);

// Write back to js/pmo-seed-data.js
const outJs = `// Auto-generated PMO Seed Data - Offline Fallback
(function(root) {
    const data = ${JSON.stringify(seedData)};
    if (typeof window !== "undefined") {
        window.PMO_SEED_PROJECTS = data;
    }
    if (typeof module !== "undefined" && module.exports) {
        module.exports = data;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
`;

fs.writeFileSync('js/pmo-seed-data.js', outJs, 'utf8');
console.log('Saved to js/pmo-seed-data.js');
