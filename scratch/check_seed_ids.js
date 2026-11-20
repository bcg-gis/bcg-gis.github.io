const seed = require('../js/pmo-seed-data.js');
for (const p of seed) {
    const subPts = p.items.flatMap(i => i.pmoRayon?.subPoints || []);
    if (subPts.length > 0) {
        console.log(p.sheetId, p.name, 'first pt id:', subPts[0].id, 'sample ids:', subPts.slice(0, 3).map(x => x.id));
    }
}
