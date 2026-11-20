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
console.log('Workbook XML:');
const sheetMatches = files['xl/workbook.xml'].match(/<sheet [^>]+>/g) || [];
sheetMatches.forEach(s => console.log(s));
