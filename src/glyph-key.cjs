'use strict';

// An outline fingerprint, independent of the page's character codes and glyph order.
module.exports = function glyphKey(glyph) {
  const path = glyph.path.toPathData(2);
  if (!path) return '';
  let first = 2166136261, second = 5381;
  for (let i = 0; i < path.length; i++) {
    const value = path.charCodeAt(i);
    first = Math.imul(first ^ value, 16777619);
    second = Math.imul(second, 33) ^ value;
  }
  return (first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0');
};
