'use strict';

const MAX_COURSES = 200;
const HOLD_MS = 45000;
const HANDOFF_KEY = 'ca-queue-handoff';
const states = new Set(['pending', 'studying', 'done', 'skipped', 'failed']);

function site(value, base) {
  try {
    const url = new URL(value, base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname;
    if (/(^|\.)(chaoxing\.com|xuexi365\.com)$/.test(host)) return { url, platform: 'chaoxing' };
    if (/(^|\.)zhihuishu\.com$/.test(host)) return { url, platform: 'zhihuishu' };
  } catch { /* Ignore malformed links. */ }
  return null;
}

function identify(value) {
  const supported = site(value);
  if (!supported) return '';
  const { platform, url } = supported;
  const params = new URLSearchParams([...url.searchParams].map(([key, value]) => [key.toLowerCase(), value]));
  if (platform === 'chaoxing') {
    const course = params.get('courseid') || (/\/mycourse\/transfer\/?$/i.test(url.pathname) ? params.get('moocid') : null);
    const group = params.get('clazzid') || params.get('classid');
    if (course && group) return `cx:${course}:${group}`;
  } else {
    const shared = params.get('recruitandcourseid');
    if (shared) return `zhs:shared:${shared}`;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] === 'singleCourse' && segments.length >= 4) return `zhs:smart:${segments[2]}:${segments[3]}`;
    if (segments[0] === 'learnPage' && segments.length >= 4) return `zhs:smart:${segments[1]}:${segments[3]}`;
    const flipped = params.get('courseid');
    if (flipped && /studyResource|sourceLearning/i.test(url.pathname)) return `zhs:flip:${flipped}`;
  }
  return '';
}

function courseLink(value, base, platform) {
  const target = site(value, base);
  if (!target || target.platform !== platform) return null;
  const { url } = target;
  const route = platform === 'chaoxing'
    ? /\/(?:stucoursemiddle|stu|studentstudy|transfer)\/?$/i
    : /\/(?:stuStudy|singleCourse|learnPage|studyResource|sourceLearning)(?:\/|$)/i;
  return route.test(url.pathname) && identify(url.href) ? url : null;
}

function text(element) {
  return (element?.getAttribute('title') || element?.textContent || '').replace(/\s+/g, ' ').trim();
}

function readCourses(doc, base, platform) {
  const discovered = new Map();
  const include = (url, title, detail) => {
    if (!url || !title || discovered.size >= MAX_COURSES) return;
    const id = identify(url.href);
    if (!discovered.has(id)) discovered.set(id, { id, url: url.href, title: title.slice(0, 160), detail: detail.slice(0, 160) });
  };
  const cards = doc.querySelectorAll('[data-course-url], [courseid][clazzid], .course-card, .course-item, .course');
  for (const card of cards) {
    const title = text(card.querySelector('[data-course-title], .course-name, .course-title, h2, h3, h4'));
    const detail = text(card.querySelector('.course-info p, .teacher-name, [data-course-detail]'));
    const candidates = [card.getAttribute('data-course-url'), ...Array.from(card.querySelectorAll('a[href]'), link => link.getAttribute('href'))];
    const destination = candidates.map(link => link && courseLink(link, base, platform)).find(Boolean);
    if (destination) {
      include(destination, title || text(card), detail);
      continue;
    }
    // Some Chaoxing cards carry a course/class/student tuple instead of a link.
    if (platform !== 'chaoxing') continue;
    const ids = ['courseid', 'clazzid', 'personid'].map(name => card.getAttribute(name));
    if (!ids.every(id => id && /^\d+$/.test(id))) continue;
    const url = new URL('/mooc-ans/visit/stucoursemiddle', base);
    ['courseid', 'clazzid', 'cpi'].forEach((key, index) => url.searchParams.set(key, ids[index]));
    include(courseLink(url.href, base, platform), title, detail);
  }
  for (const link of doc.querySelectorAll('a[href]')) {
    include(courseLink(link.getAttribute('href'), base, platform), text(link), '');
  }
  return [...discovered.values()];
}

function cleanQueue(value, platform) {
  const items = [];
  const ids = new Set();
  for (const entry of Array.isArray(value?.items) ? value.items.slice(0, MAX_COURSES) : []) {
    const url = courseLink(entry?.url, undefined, platform);
    if (!url || typeof entry.title !== 'string') continue;
    const id = identify(url.href);
    if (ids.has(id)) continue;
    ids.add(id);
    items.push({ id, url: url.href, title: entry.title.slice(0, 160), detail: String(entry.detail || '').slice(0, 160), status: states.has(entry.status) ? entry.status : 'pending', note: String(entry.note || '').slice(0, 240), lastURL: courseLink(entry.lastURL, undefined, platform)?.href || '' });
  }
  const current = items.find(item => item.status === 'studying');
  const status = value?.status === 'running' && current && value.owner ? 'running'
    : items.some(item => item.status === 'pending' || item.status === 'studying') ? 'paused'
    : items.length ? 'finished' : 'idle';
  return {
    items, status, owner: status === 'running' ? String(value.owner) : '',
    lease: Number.isFinite(value?.lease) ? value.lease : 0,
    ticket: typeof value?.ticket === 'string' ? value.ticket : '',
    handoff: typeof value?.handoff === 'string' ? value.handoff : ''
  };
}

function currentCourse(queue) { return queue.items.find(item => item.status === 'studying'); }

function begin(queue, owner, now) {
  const item = currentCourse(queue) || queue.items.find(item => item.status === 'pending');
  if (!item) return null;
  item.status = 'studying';
  Object.assign(queue, { status: 'running', owner, lease: now + HOLD_MS, ticket: '', handoff: '' });
  return item;
}

function pause(queue) {
  if (queue.status === 'running') queue.status = 'paused';
  Object.assign(queue, { owner: '', lease: 0, ticket: '', handoff: '' });
}

function resolve(queue, status, note) {
  if (!['done', 'skipped', 'failed'].includes(status)) return;
  const item = currentCourse(queue);
  if (!item) return;
  item.status = status;
  item.note = note;
  pause(queue);
  if (!queue.items.some(item => item.status === 'pending')) queue.status = 'finished';
}

function mergeLegacy(value, platform) {
  // A link queue is migrated as paused entries only; old playback state is never reused.
  return cleanQueue({ items: value?.items }, platform);
}

function handoffURL(value, ticket) {
  const url = new URL(value);
  // The transfer page navigates to its refer parameter and may discard its own fragment.
  if (url.pathname === '/mycourse/transfer') {
    const study = site(url.searchParams.get('refer'));
    if (study?.url.origin === url.origin && study.url.pathname === '/mycourse/studentstudy' && identify(study.url.href) === identify(url.href)) {
      url.searchParams.set('refer', handoffURL(study.url.href, ticket).href);
      return url;
    }
  }
  url.hash = new URLSearchParams([[HANDOFF_KEY, ticket], ['original', url.hash.slice(1)]]).toString();
  return url;
}

function readHandoff(value) {
  const url = new URL(value);
  const fields = new URLSearchParams(url.hash.slice(1));
  const ticket = fields.get(HANDOFF_KEY);
  if (!ticket || !fields.has('original')) return null;
  url.hash = fields.get('original') || '';
  return { ticket, url };
}

function chapterStatus(element) {
  const explicit = element.getAttribute('data-chapter-status');
  if (explicit === 'complete') return 'done';
  if (explicit === 'pending') return 'pending';
  if (explicit === 'locked' || element.matches('[aria-disabled=true], .catalog_points_sa, .catalog_points_er') || element.querySelector('.catalog_points_sa, .catalog_points_er, [aria-disabled=true]')) return 'locked';
  if (element.querySelector('.icon_yiwanc, .icon_Completed, .zhihuishu-wancheng, .icon-finish, .time_icofinish')) return 'done';
  const counter = element.querySelector('input.knowledgeJobCount, input.jobUnfinishCount');
  const count = (counter?.value || text(element.querySelector('.catalog_points_yi .orangeNew, .catalog_points_yi'))).trim();
  if (/^\d+$/.test(count)) return Number(count) > 0 ? 'pending' : 'done';
  const percent = text(element.querySelector('.progress-num, [data-progress]'));
  if (/^\d+\s*%$/.test(percent)) return parseInt(percent, 10) >= 100 ? 'done' : 'pending';
  return 'unknown';
}

function catalog(docs, visible, directoryOnly = false) {
  const directoryRows = '.chapter_item:has([onclick*="toOld"]), .chapter_item[onclick*="toOld"]';
  const studyAction = '[onclick*="getTeacherAjax"]';
  const selectors = directoryOnly ? directoryRows : ['[data-course-chapter]', '.posCatalog_select:not(.firstLayer)', directoryRows, 'li.video', '.item-content:has(.progress-num)', '.file-item:has(.file-rate)'].join(',');
  for (const doc of docs) {
    // Some study pages put the task count beside the chapter link, with no row class.
    const actions = directoryOnly ? [] : [...doc.querySelectorAll(studyAction)].filter(el => /\bgetTeacherAjax\s*\([^,]+,[^,]+,\s*['"]?\d+/.test(el.getAttribute('onclick')));
    if (actions.length) {
      const current = doc.querySelector('#curChapterId')?.value;
      return actions.map(control => {
        const row = control.closest('.posCatalog_select') || control.parentElement;
        const id = control.getAttribute('onclick').match(/\bgetTeacherAjax\s*\([^,]+,[^,]+,\s*['"]?(\d+)/)[1];
        return { control, title: text(row.querySelector('.posCatalog_name') || control).slice(0, 100),
          active: current ? id === current : row.matches('.posCatalog_active'), status: chapterStatus(row) };
      });
    }
    const rows = [...doc.querySelectorAll(selectors)].filter(row => row.matches(directoryRows) || visible(row));
    if (!rows.length) continue;
    return rows.map(element => {
      const platformAction = '[onclick*="toOld"], [onclick*="getTeacherAjax"]';
      const control = element.matches(platformAction) ? element
        : element.querySelector(platformAction) || (element.matches('button, a[href], [onclick]') ? element : element.querySelector('a[href], button, [role=button], [onclick]') || element);
      const active = element.matches('.posCatalog_active,.current_play,[aria-current="true"],[aria-current="page"],[data-current="true"]');
      return { control, title: text(element.querySelector('[data-chapter-title], .catalogue_title') || control).slice(0, 100), active, status: chapterStatus(element) };
    });
  }
  return [];
}

function isChaoxingHome(currentPage) {
  const page = site(currentPage);
  return page?.platform === 'chaoxing' && /\/(?:mycourse|fanyav3)\/stu\/?$/i.test(page.url.pathname);
}

function chaoxingCatalogURL(home, currentPage, courseId, entryURL) {
  if (!isChaoxingHome(currentPage) || identify(currentPage) !== courseId) return null;
  const url = new URL(currentPage);
  const [, course, group] = courseId.split(':');
  const params = url.searchParams;
  const enc = home.querySelector('#enc')?.value || params.get('stuenc') || params.get('enc');
  const cpi = home.querySelector('#cpi')?.value || params.get('cpi') || site(entryURL)?.url.searchParams.get('cpi');
  if (!enc || !cpi) return null;
  const endpoint = new URL('/mooc2-ans/mycourse/studentcourse', url);
  endpoint.search = new URLSearchParams({ courseid: course, clazzid: group, cpi, stuenc: enc, ut: 's' });
  return endpoint;
}

function chaoxingChapterEntry(control, currentPage, courseId, home, directoryURL, entryURL) {
  const action = control.getAttribute('onclick') || '';
  const chapter = action.match(/\btoOld\s*\([^,()]*,\s*['"]?(\d+)['"]?\s*(?=[,)])/)?.[1];
  if (!chapter) return null;
  const page = site(currentPage);
  const directory = site(directoryURL || control.ownerDocument.URL);
  if (page?.platform !== 'chaoxing' || directory?.platform !== 'chaoxing') return null;
  const [family, course, group] = courseId.split(':');
  if (family !== 'cx' || ![course, group].every(value => /^\d+$/.test(value || ''))) return null;
  if (identify(page.url.href) !== courseId) return null;
  const directoryParams = new URLSearchParams([...directory.url.searchParams].map(([key, value]) => [key.toLowerCase(), value]));
  if ((directoryParams.has('courseid') && directoryParams.get('courseid') !== course) ||
      (directoryParams.has('clazzid') && directoryParams.get('clazzid') !== group)) return null;
  const enc = control.ownerDocument.querySelector('#oldenc')?.value;
  let legacyToken = /^[\w-]+$/.test(enc || '') ? enc : '';
  let cpi = directoryParams.get('cpi') || page.url.searchParams.get('cpi') || control.ownerDocument.querySelector('#cpi')?.value;
  for (const script of control.ownerDocument.querySelectorAll('script:not([src])')) {
    const declaration = script.textContent;
    legacyToken ||= declaration.match(/\b(?:const|let|var)\s+enc\s*=\s*['"]([\w-]+)['"]/)?.[1];
    cpi ||= declaration.match(/\b(?:const|let|var)\s+cpi\s*=\s*['"]?(\d+)\b/)?.[1];
    if (legacyToken && cpi) break;
  }
  legacyToken ||= home?.querySelector('#oldenc')?.value;
  cpi ||= home?.querySelector('#cpi')?.value || site(entryURL)?.url.searchParams.get('cpi');
  if (!legacyToken || !/^\d+$/.test(cpi || '')) return null;
  const studyHost = 'https://mooc1.chaoxing.com';
  const study = new URL('/mycourse/studentstudy', studyHost);
  study.search = new URLSearchParams({ courseId: course, clazzid: group, chapterId: chapter, cpi, enc: legacyToken, mooc2: '1', hidetype: '0', fanyaVersion: '0' });
  const transfer = new URL('/mycourse/transfer', studyHost);
  transfer.search = new URLSearchParams({ moocId: course, clazzid: group, refer: study.href, linkTime: String(Date.now()), ut: 's' });
  return transfer;
}

module.exports = { site, identify, courseLink, readCourses, cleanQueue, currentCourse, begin, pause, resolve, mergeLegacy, handoffURL, readHandoff, catalog, isChaoxingHome, chaoxingCatalogURL, chaoxingChapterEntry, HOLD_MS };
