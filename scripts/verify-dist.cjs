const fs = require('node:fs');
const path = require('node:path');
for (const file of ['module.js', 'plugin.json', 'img/pop-router.svg', 'img/pop-olt.svg', 'img/pop-datacenter.svg']) {
  const filename = path.join(__dirname, '..', 'dist', file);
  if (!fs.existsSync(filename) || !fs.statSync(filename).size) {
    throw new Error(`Build incompleto: ${file}`);
  }
}
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dist/plugin.json'), 'utf8'));
if (manifest.id !== 'jakson-j-topologia-panel') {
  throw new Error('Identidade incorreta.');
}
console.log('j-topologia compilado; identidade, módulo e ícones verificados.');
