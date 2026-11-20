const seed = require('../js/pmo-seed-data.js');
const sh11 = seed.find(p => p.sheetId === '11');
console.log('Sh11 items length:', sh11.items.length);
sh11.items.forEach(it => {
    if (it.pmoRayon?.subPoints?.length) {
        console.log(`Rayon: ${it.name}, Subpts: ${it.pmoRayon.subPoints.length}`);
        it.pmoRayon.subPoints.slice(0, 3).forEach(sp => {
            console.log(`  id: ${sp.id}, tsNo: ${sp.tsNo}, coords: ${sp.coords}, cableDoneM: ${sp.cableDoneM}`);
        });
    }
});
