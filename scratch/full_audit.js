const fs = require('fs');
const data = require('../js/pmo-seed-data.js');

let subFixed = 0, ryFixed = 0, magFixed = 0;

data.forEach(p => {
    (p.items || []).forEach(it => {
        if (it.isMagistral && it.statusEmoji) {
            const st = it.statusEmoji.includes('🟢') ? 'bitmis' : (it.statusEmoji.includes('🟡') ? 'icrada' : 'layihe');
            if (it.status !== st) {
                it.status = st;
                magFixed++;
            }
        }
        if (it.isPmoRayon && it.pmoRayon && Array.isArray(it.pmoRayon.subPoints) && it.pmoRayon.subPoints.length > 0) {
            it.pmoRayon.subPoints.forEach(sp => {
                if (sp.statusEmoji) {
                    const st = sp.statusEmoji.includes('🟢') ? 'bitmis' : (sp.statusEmoji.includes('🟡') ? 'icrada' : 'layihe');
                    if (sp.status !== st) {
                        sp.status = st;
                        subFixed++;
                    }
                }
            });
            const allDone = it.pmoRayon.subPoints.every(sp => sp.status === 'bitmis');
            const anyActive = it.pmoRayon.subPoints.some(sp => sp.status === 'bitmis' || sp.status === 'icrada');
            const expectedRyStatus = allDone ? 'bitmis' : (anyActive ? 'icrada' : 'layihe');
            if (it.status !== expectedRyStatus) {
                console.log(`Rayon status fix [${p.name} -> ${it.name}]: ${it.status} -> ${expectedRyStatus}`);
                it.status = expectedRyStatus;
                ryFixed++;
            }
        }
    });
});

console.log(`Audit fixes: subPoints=${subFixed}, rayons=${ryFixed}, magistrals=${magFixed}`);

if (subFixed > 0 || ryFixed > 0 || magFixed > 0) {
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
    console.log('Saved updated js/pmo-seed-data.js');
}

// Final verification summary
let totalProjects = data.length;
let totalRayons = 0, totalSubPts = 0, totalMags = 0;
let badNames = [];
data.forEach(p => {
    if (/^\d{1,2}\./.test(p.name)) badNames.push(p.name);
    (p.items || []).forEach(it => {
        if (it.isMagistral) totalMags++;
        else if (it.isPmoRayon) {
            totalRayons++;
            totalSubPts += (it.pmoRayon?.subPoints || []).length;
        }
    });
});
console.log(`Summary: ${totalProjects} projects, ${totalRayons} rayons, ${totalSubPts} sub-points, ${totalMags} magistrals, badNames=${badNames.length}`);
