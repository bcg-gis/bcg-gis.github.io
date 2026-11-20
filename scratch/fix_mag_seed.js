const fs = require('fs');
const data = require('../js/pmo-seed-data.js');
let fixed = 0;
data.forEach(p => {
    (p.items || []).forEach(it => {
        if (it.isMagistral && it.statusEmoji) {
            const st = it.statusEmoji.includes('🟢') ? 'bitmis' : (it.statusEmoji.includes('🟡') ? 'icrada' : 'layihe');
            if (it.status !== st) {
                console.log('Fixed', it.id, it.name, it.status, '->', st);
                it.status = st;
                fixed++;
            }
        }
    });
});
if (fixed > 0) {
    const out = `// Auto-generated PMO Seed Data - Offline Fallback
(function(root) {
    const data = ${JSON.stringify(data)};
    if (typeof window !== "undefined") {
        window.PMO_SEED_PROJECTS = data;
    }
    if (typeof module !== "undefined" && module.exports) {
        module.exports = data;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
`;
    fs.writeFileSync('js/pmo-seed-data.js', out, 'utf8');
    console.log('Saved js/pmo-seed-data.js with', fixed, 'fixes');
}
