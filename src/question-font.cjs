'use strict';

const fonts = new WeakMap();
const family = 'font-cxsecret';
const isFamily = value => String(value).replace(/["']/g, '').trim().toLowerCase() === family;

// Read the stylesheet in the document that owns the question (often a nested frame).
async function prepare(doc) {
  if (!doc.fonts || ![...doc.fonts].some(face => isFamily(face.family))) return text => text;
  const styleCache = new WeakMap();
  const sources = [];
  function visit(rules, base) {
    for (const rule of rules) {
      if (rule.type === 5 && isFamily(rule.style.getPropertyValue('font-family'))) {
        for (const match of rule.style.getPropertyValue('src').matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
          try {
            const url = new URL(match[1], base);
            if (['data:', 'blob:', 'https:', 'http:'].includes(url.protocol)) sources.push(url.href);
          } catch { /* A browser may offer another source in the same declaration. */ }
        }
      } else if (rule.cssRules) visit(rule.cssRules, base);
    }
  }
  for (const sheet of doc.styleSheets) {
    try { visit(sheet.cssRules, sheet.href || doc.baseURI); } catch { /* Cross-origin stylesheet. */ }
  }
  let parsed;
  for (const url of sources) {
    const cached = fonts.get(doc);
    if (cached?.url === url) { parsed = cached; break; }
    try {
      let bytes;
      if (url.startsWith('data:') && /;base64,/i.test(url)) {
        const payload = url.slice(url.indexOf(',') + 1);
        if (payload.length > 32 * 1024 * 1024) continue;
        bytes = Uint8Array.from(atob(payload), ch => ch.charCodeAt(0)).buffer;
      } else {
        const response = await doc.defaultView.fetch(url, { credentials: 'same-origin', signal: AbortSignal.timeout(7000) });
        if (!response.ok) continue;
        bytes = await response.arrayBuffer();
      }
      parsed = { url, font: FontParser.parse(bytes), decoded: new Map() };
      fonts.set(doc, parsed);
      break;
    } catch { /* Try the next declared font format. */ }
  }
  return (text, element) => {
    if (!element || !text.trim()) return text;
    if (!styleCache.has(element)) {
      const first = doc.defaultView.getComputedStyle(element).fontFamily.split(',')[0];
      styleCache.set(element, isFamily(first));
    }
    if (!styleCache.get(element)) return text;
    return Array.from(text, ch => {
      if (!parsed) return /[\u3400-\u9fff\ue000-\ufaff]/u.test(ch) ? '\ufffd' : ch;
      if (!parsed.decoded.has(ch)) {
        const id = parsed.font.charToGlyphIndex(ch);
        let decoded = ch;
        if (id) {
          const code = GLYPH_INDEX[glyphKey(parsed.font.glyphs.get(id))];
          decoded = code ? String.fromCodePoint(code) : '\ufffd';
        }
        parsed.decoded.set(ch, decoded);
      }
      return parsed.decoded.get(ch);
    }).join('');
  };
}

module.exports = { prepare };
