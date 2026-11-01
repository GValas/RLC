// Lance les tests du moteur dans Node, sans aucune dépendance : node tests/run-node.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const here = __dirname;
for (const f of ['../js/linalg.js', '../js/circuit.js', '../js/engine.js', '../js/library.js', '../js/guides.js', '../js/devices.js', 'tests.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(here, f), 'utf8'), { filename: f });
}
let failed = 0;
for (const r of globalThis.RLC_TEST_RESULTS) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : '\n     ' + r.msg}`);
  if (!r.ok) failed++;
}
console.log(`\n${globalThis.RLC_TEST_RESULTS.length - failed} réussis, ${failed} échoués`);
process.exit(failed ? 1 : 0);
