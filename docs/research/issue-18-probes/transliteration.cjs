// Offline: node transliteration.cjs /path/to/node_modules/@indic-transliteration/sanscript
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(process.argv[2]);
const s = require(root);
const pkg = require(path.join(root, 'package.json'));
assert.equal(pkg.version, '1.3.3');
const fixtures = [
 ['धर्मक्षेत्र','Darmakzetra','dharmakṣetra'],['धर्मक्षेत्रे','Darmakzetre','dharmakṣetre'],
 ['सेन','sena','sena'],['सेना','senA','senā'],['मा','mA','mā'],
 ['मामकास्','mAmakAs','māmakās'],['पाण्डवास्','pARqavAs','pāṇḍavās'],['च','ca','ca'],['एव','eva','eva'],
 ['ऋ','f','ṛ'],['ॠ','F','ṝ'],['ऌ','x','ḷ'],['ॡ','X','ḹ'],
 ['ङ','Na','ṅa'],['ञ','Ya','ña'],['ण','Ra','ṇa'],['श','Sa','śa'],['ष','za','ṣa'],
 ['अं','aM','aṃ'],['अः','aH','aḥ'],['अँ','a~','a~'],['ऽ',"'","'"],
 ['ॐ','AUM','oṃ'],['।','.','|'],['॥','..','||'],['ऴ','L0a','ḻa'],
];
const results = fixtures.map(([original,slp1,iast]) => {
 assert.equal(s.t(original,'devanagari','slp1'),slp1);
 assert.equal(s.t(original,'devanagari','iast'),iast);
 assert.equal(s.t(slp1,'slp1','devanagari'),original);
 assert.equal(s.t(iast,'iast','devanagari'),original);
 const nfd = iast.normalize('NFD');
 const nfdDirect = s.t(nfd,'iast','devanagari');
 assert.equal(s.t(nfd.normalize('NFC'),'iast','devanagari'),original);
 return {original,slp1,iast,roundTrip:true,nfdDirect,nfdDirectRoundTrip:nfdDirect===original,
         nfdAfterNfcRoundTrip:true};
});
const uncommon = ['क़','क्‍ष','अ॑','ᳵ','ᳶ'].map(original => ({original,
 iast:s.t(original,'devanagari','iast'),slp1:s.t(original,'devanagari','slp1')}));
// Identity metadata is removed only from a conversion copy, never the original.
const original = 'मा#२';
const [,base,suffix] = /^(.*?)(#[०-९0-9]+)$/.exec(original);
const identity = {provider:'sanskrit_parser',original,base,suffix,stableLemmaId:null,
 iast:s.t(base,'devanagari','iast'),slp1:s.t(base,'devanagari','slp1')};
assert.equal(identity.original,'मा#२');assert.equal(identity.suffix,'#२');
assert.equal(identity.iast,'mā');assert.equal(identity.slp1,'mA');
assert.equal(s.t(original,'devanagari','iast'),'mā#2'); // Why whole-string conversion is unsafe.
console.log(JSON.stringify({observedAtUTC:new Date().toISOString(),node:process.version,
 package:pkg.name,version:pkg.version,results,uncommon,identity,
 scope:'Offline Node spelling conversion only; uncommon pass-through is not complete IAST/SLP1 support; no lexical identity or Edge rendering proved'},null,2));
