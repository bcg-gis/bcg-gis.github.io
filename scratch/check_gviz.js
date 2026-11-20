const https = require('https');
const sheetKey = '1j01HnJA5axpTpWEf1ciADvzQp6D86z9a9mHOPBL5OpA';

function check(title) {
  return new Promise((resolve) => {
    const url = 'https://docs.google.com/spreadsheets/d/' + sheetKey + '/gviz/tq?tqx=out:csv&headers=0&sheet=' + encodeURIComponent(title);
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('Title:', title, 'Status:', res.statusCode, 'Length:', data.length, 'Preview:', data.slice(0, 120).replace(/\r?\n/g, ' '));
        resolve();
      });
    }).on('error', (err) => {
      console.log('Title:', title, 'Error:', err.message);
      resolve();
    });
  });
}

async function main() {
  await check('D 1');
  await check('D1');
  await check('D 2');
  await check('D2');
  await check('11');
}
main();
