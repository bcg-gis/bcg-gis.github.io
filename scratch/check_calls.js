const fs = require('fs');
const lines = fs.readFileSync('js/app.js', 'utf8').split('\n');
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('renderInfoCard(')) {
        const loc = i >= 7148 ? 'INSIDE IIFE' : 'OUTSIDE IIFE';
        console.log(i + 1, loc, lines[i].trim().slice(0, 70));
    }
}
