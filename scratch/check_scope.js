const fs = require('fs');
const content = fs.readFileSync('js/app.js', 'utf8');
const lines = content.split('\n');

let braceDepth = 0;

for (let i = 7145; i < lines.length; i++) {
    const line = lines[i];
    const prev = braceDepth;
    for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
    }
    if (prev > 0 && braceDepth === 0) {
        console.log(`IIFE starting at 7149 ended at line ${i + 1}`);
        break;
    }
}
