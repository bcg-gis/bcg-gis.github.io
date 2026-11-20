const list = require('../js/pmo-seed-data.js');
const p11 = list.find(p => p.sheetId === '11');
console.log('Project 11 name:', p11?.name);
console.log('Project 11 items count:', p11?.items?.length);
const mags = p11?.items?.filter(it => it.isMagistral);
console.log('Magistrals count:', mags?.length);
if (mags && mags.length > 0) {
  console.log('Sample magistral:', JSON.stringify(mags[0], null, 2));
}
