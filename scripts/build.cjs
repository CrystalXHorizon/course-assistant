const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const { version } = JSON.parse(read('package.json'));
const metadata = `// ==UserScript==
// @name         课程助手
// @namespace    https://github.com/CrystalXHorizon/course-assistant
// @version      ${version}
// @description  独立实现的课程队列、视频控制、题目与 DeepSeek 辅助、定时刷新工具。所有任务手动启动。
// @author       CrystalXHorizon
// @license      MIT
// @homepageURL  https://github.com/CrystalXHorizon/course-assistant
// @supportURL   https://github.com/CrystalXHorizon/course-assistant/issues
// @updateURL    https://raw.githubusercontent.com/CrystalXHorizon/course-assistant/main/course-assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/CrystalXHorizon/course-assistant/main/course-assistant.user.js
// @match        *://*.chaoxing.com/*
// @match        *://*.xuexi365.com/*
// @match        *://*.zhihuishu.com/*
// @connect      api.deepseek.com
// @connect      chaoxing.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_getTab
// @grant        GM_saveTab
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// @noframes
// ==/UserScript==

// Copyright (c) 2026 CrystalXHorizon. SPDX-License-Identifier: MIT
// Install this single file. Source and tests are available in the repository.
`;
const wrap = (name,file) => `const ${name} = (() => {\nconst module = { exports: {} };\n${read(file)}\nreturn module.exports;\n})();\n`;
const notices = [
  'opentype.js', read('node_modules/opentype.js/LICENSE'),
  'tiny-inflate', read('node_modules/tiny-inflate/LICENSE'),
  'string.prototype.codepointat', read('node_modules/string.prototype.codepointat/LICENSE-MIT.txt'),
  'Glyph fingerprints generated from Source Han Sans CN Normal v1.000. Copyright 2014 Adobe Systems Incorporated.',
  read('docs/Apache-2.0.txt')
].join('\n');
const parser = read('node_modules/opentype.js/dist/opentype.min.js').replace(/^\/\/# sourceMappingURL=.*$/gm, '');
const modules = [
  '/*\n' + notices + '\n*/',
  'const FontParser = (() => {const exports = {}; const module = {exports};\n' + parser + '\nreturn exports;})();',
  'const GLYPH_INDEX = ' + read('src/glyph-index.json') + ';',
  wrap('glyphKey','src/glyph-key.cjs'), wrap('QuestionFont','src/question-font.cjs'),
  wrap('QuestionScan','src/question-scan.cjs'), wrap('Core','src/core.cjs'),
  wrap('PageDOM','src/dom.cjs'), wrap('Quiz','src/quiz-submit.cjs'), wrap('Queue','src/course-queue.cjs'),
  'const VERSION = ' + JSON.stringify(version) + ';',
  'const STYLE = ' + JSON.stringify(read('src/style.css')) + ';',
  read('src/queue-panel.js'), read('src/app.js')
];
const output = metadata + '\n(() => {\n"use strict";\n' + modules.join('\n') + '\n})();\n';
fs.writeFileSync(path.join(root,'course-assistant.user.js'),output);
console.log('Built course-assistant.user.js ('+Buffer.byteLength(output)+' bytes)');
