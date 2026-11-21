'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const opentype = require('opentype.js');
const glyphKey = require('../src/glyph-key.cjs');

// SourceHanSansCN-Normal v1.000, PengXing/fontsub at 427ba55be9137687344729a09f6224baaebd003c.
const bytes = fs.readFileSync(process.argv[2]);
if (crypto.createHash('sha256').update(bytes).digest('hex') !== 'cd1c5b9c6740c570ab7289402d1af2f39437c5e095e83baf81c74d80e56a75ba') throw Error('Unexpected reference font');
const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
const dictionary = Object.create(null);
for (let cp = 0x4e00; cp <= 0x9fff; cp++) {
  const id = font.charToGlyphIndex(String.fromCodePoint(cp));
  if (!id) continue;
  const key = glyphKey(font.glyphs.get(id));
  if (key) dictionary[key] = key in dictionary ? 0 : cp;
}
fs.writeFileSync(path.join(__dirname, '../src/glyph-index.json'), JSON.stringify(dictionary) + '\n');
