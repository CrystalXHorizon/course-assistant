const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const metadata = `// ==UserScript==
// @name         课程助手
// @namespace    https://github.com/CrystalXHorizon/course-assistant
// @version      1.0.0
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
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// @noframes
// ==/UserScript==

// Copyright (c) 2026 CrystalXHorizon. SPDX-License-Identifier: MIT
// Install this single file. Source and tests are available in the repository.
`;
const wrap = (name,file) => `const ${name} = (() => {\nconst module = { exports: {} };\n${read(file)}\nreturn module.exports;\n})();\n`;
const output=metadata+'\n(() => {\n"use strict";\n'+wrap('Core','src/core.cjs')+wrap('PageDOM','src/dom.cjs')+'const STYLE = '+JSON.stringify(read('src/style.css'))+';\n'+read('src/app.js')+'\n})();\n';
fs.writeFileSync(path.join(root,'course-assistant.user.js'),output);
console.log('Built course-assistant.user.js ('+Buffer.byteLength(output)+' bytes)');
