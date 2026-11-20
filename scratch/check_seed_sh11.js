const seed = require('../js/pmo-seed-data.js');
const sh11 = seed.find(p => p.sheetId === '11');
if (sh11) {
    const subPts = sh11.items.flatMap(i => i.pmoRayon?.subPoints || []);
    console.log('Sheet 11 subpoints count:', subPts.length);
    console.log('Sample subpoint:', subPts[0]);
    const withCable = subPts.filter(sp => sp.cableDoneM > 0);
    console.log('Sheet 11 subpoints with cableDoneM:', withCable.length);
} else {
    console.log('Sheet 11 not found');
}
