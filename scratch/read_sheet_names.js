const XLSX = require('xlsx');
const wb = XLSX.readFile('scratch/pmo_test.xlsx');
console.log('Sheet names:', wb.SheetNames);
