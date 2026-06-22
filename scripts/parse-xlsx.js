const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function parseSheet(filename) {
  const wb = XLSX.readFile(path.join(root, filename));
  const result = {};
  for (const name of wb.SheetNames) {
    result[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null });
  }
  return result;
}

const stats = parseSheet('estadisticas.xlsx');
const skills = parseSheet('habilidades.xlsx');
const npcs = parseSheet('npcs.xlsx');

console.log('=== estadisticas.xlsx ===');
console.log('Sheets:', Object.keys(stats));
for (const [sheet, rows] of Object.entries(stats)) {
  console.log(`\n--- ${sheet} (${rows.length} rows) ---`);
  console.log(JSON.stringify(rows.slice(0, 3), null, 2));
  if (rows.length > 3) console.log('...');
}

console.log('\n=== habilidades.xlsx ===');
console.log('Sheets:', Object.keys(skills));
for (const [sheet, rows] of Object.entries(skills)) {
  console.log(`\n--- ${sheet} (${rows.length} rows) ---`);
  console.log(JSON.stringify(rows.slice(0, 2), null, 2));
}

console.log('\n=== npcs.xlsx ===');
console.log('Sheets:', Object.keys(npcs));
for (const [sheet, rows] of Object.entries(npcs)) {
  console.log(`\n--- ${sheet} (${rows.length} rows) ---`);
  console.log(JSON.stringify(rows.slice(0, 2), null, 2));
}

const outDir = path.join(root, 'public', 'data');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'estadisticas.json'), JSON.stringify(stats, null, 2));
fs.writeFileSync(path.join(outDir, 'habilidades.json'), JSON.stringify(skills, null, 2));
fs.writeFileSync(path.join(outDir, 'npcs.json'), JSON.stringify(npcs, null, 2));
console.log('\nJSON exported to public/data/');
