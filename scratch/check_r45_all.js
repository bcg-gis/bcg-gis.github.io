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

const sh10 = sheets.find(s => s.name === '10');
const xml = files[sh10.path];
const rowMatches = xml.match(/<row [^>]*>[\s\S]*?<\/row>/g) || [];
const rows = [];
for (const rXml of rowMatches) {
    const rNum = parseInt(rXml.match(/r="(\d+)"/)?.[1], 10);
    const cells = parseRowCells(rXml);
    cells.__rowNum__ = rNum;
    rows.push(cells);
}

console.log('Sheet 10: rows 3, 4, 5 all columns from AD to CT:');
[3, 4, 5].forEach(rn => {
    const r = rows.find(x => x.__rowNum__ === rn) || {};
    const cols = Object.keys(r).filter(k => k !== '__rowNum__').sort();
    console.log(`\nRow ${rn}:`);
    for (const c of cols) {
        if (r[c]) console.log(`  ${c}: "${r[c]}"`);
    }
});
