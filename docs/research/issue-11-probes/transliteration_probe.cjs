// npm install --prefix /tmp/tensho-issue11-transliteration --ignore-scripts --no-audit --no-fund @indic-transliteration/sanscript@1.3.3
// node transliteration_probe.cjs /tmp/tensho-issue11-transliteration/node_modules/@indic-transliteration/sanscript
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(process.argv[2]);
const Sanscript = require(root);
const packageInfo = require(path.join(root, 'package.json'));
assert.equal(packageInfo.version, '1.3.3');
const fixtures = [
  ['धर्मक्षेत्र', 'Darmakzetra', 'dharmakṣetra'],
  ['धर्मक्षेत्रे', 'Darmakzetre', 'dharmakṣetre'],
  ['सेन', 'sena', 'sena'], ['सेना', 'senA', 'senā'],
  ['मा', 'mA', 'mā'], ['मामकास्', 'mAmakAs', 'māmakās'],
  ['पाण्डवास्', 'pARqavAs', 'pāṇḍavās'], ['च', 'ca', 'ca'], ['एव', 'eva', 'eva'],
];
const results = fixtures.map(([original, slp1, iast]) => {
  assert.equal(Sanscript.t(original, 'devanagari', 'slp1'), slp1);
  assert.equal(Sanscript.t(original, 'devanagari', 'iast'), iast);
  assert.equal(Sanscript.t(slp1, 'slp1', 'devanagari'), original);
  assert.equal(Sanscript.t(iast, 'iast', 'devanagari'), original);
  return { original, slp1, iast, roundTrip: true };
});
// A display conversion never establishes a dictionary identity. Keep identifiers
// and provider-original forms outside the conversion function.
const distinct = [1, 2, 3, 4].map(homograph => ({provider: 'controlled-fixture',
  original: 'मा', homograph, display: Sanscript.t('मा', 'devanagari', 'iast')}));
assert.equal(new Set(distinct.map(x => x.homograph)).size, 4);
const decomposed = 'dharmakṣetre'.normalize('NFD');
const normalization = {original: decomposed,
  direct: Sanscript.t(decomposed, 'iast', 'devanagari'),
  nfc: Sanscript.t(decomposed.normalize('NFC'), 'iast', 'devanagari')};
assert.equal(normalization.nfc, 'धर्मक्षेत्रे');
console.log(JSON.stringify({observedAtUTC: new Date().toISOString(),
  node: process.version, package: packageInfo.name, version: packageInfo.version,
  results, distinctControlledHomographs: distinct, normalization,
  scope: 'Node runtime conversion only; no source identity resolution or Edge rendering verified'}, null, 2));
