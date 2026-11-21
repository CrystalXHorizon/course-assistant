function createQueuePanel({ element, button, hint, field, row, title, notice, log, read, write, sessionRead, sessionWrite, refresh, media, play, beforeStart, safeAction }) {
  const platform = Queue.site(location.href)?.platform;
  const key = `course-queue.${platform}`;
  const ownerKey = 'course-queue-owner';
  const catalogWait = 25000;
  const statusText = { pending: '等待中', studying: '学习中', done: '已完成', skipped: '已跳过', failed: '处理失败' };
  const listURL = platform === 'zhihuishu' ? 'https://onlineweb.zhihuishu.com/onlinestuh5' : 'https://mooc1-1.chaoxing.com/visit/interaction';
  const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  const legacy = Queue.mergeLegacy(sessionRead('queue', null), platform);
  let queue = Queue.cleanQueue(read(key, legacy), platform);
  let owner = sessionRead(ownerKey, '') || newToken();
  const incoming = Queue.readHandoff(location.href);
  if (incoming) {
    if (queue.status === 'running' && queue.ticket === incoming.ticket && queue.handoff === Queue.currentCourse(queue)?.id && queue.lease > Date.now() && Queue.identify(incoming.url.href) === queue.handoff) {
      owner = queue.owner;
      sessionWrite(ownerKey, owner);
      queue.ticket = '';
      queue.handoff = '';
      write(key, queue);
    }
    history.replaceState(history.state, '', incoming.url.href);
  }
  const isOwner = () => queue.status === 'running' && queue.owner === owner;
  const isLive = () => queue.status === 'running' && queue.lease > Date.now();
  let candidates = [];
  let selected = [];
  let loading = false;
  let loadHint = '先读取课程列表，再按希望的学习顺序点选。';
  let departure = false;
  let viewedURL = location.href;
  let entryTime = Date.now();
  let lastSwitch = 0;
  let switched = null;
  let catalogRequested = false;
  let activeChapter = null;
  let confirmedCompleteAt = 0;
  let attempted = new WeakMap();
  let lastRendered = '';
  const query = element('input', { type: 'search', placeholder: '输入课程名或教师名', oninput: renderCandidates });
  const candidateList = element('div', { class: 'queue-candidates' });
  const listing = element('div', { class: 'queue-picker' });
  const running = element('div', { class: 'queue-run' });
  const progress = element('progress', { value: 0, max: 1, 'aria-label': '队列进度' });
  const current = element('strong', { class: 'queue-current' });
  const runStatus = element('span', { class: 'tag' });
  const summary = element('p', { class: 'hint' });
  const items = element('div', { class: 'stack', id: 'queue-list' });
  const loadingText = hint(loadHint);
  const selectionCount = element('span', { class: 'hint' });
  const readButton = button('读取课程列表', loadCourses);
  const clearSelection = button('取消选择', () => { selected = []; renderCandidates(); });
  const startButton = button('开始学习', start, { class: 'primary' });
  const pauseButton = button('暂停队列', () => stop());
  const continueButton = button('继续队列', resume, { class: 'primary' });
  const skipButton = button('跳过本门', () => finish('skipped', '用户跳过'));
  const resetButton = button('重新选课', reset);
  listing.append(
    row(readButton, element('a', { href: listURL, text: platform === 'zhihuishu' ? '打开在线学堂' : '打开我的课程', class: 'link' })),
    field('搜索课程', query), loadingText, candidateList,
    row(selectionCount, clearSelection, startButton)
  );
  running.append(row(runStatus, current), progress, summary, row(pauseButton, continueButton, skipButton, resetButton), items);
  const view = element('div', {}, [title('课程队列', '按点选顺序排队学习，查看当前课程和完成情况。'), listing, running]);

  function localCourses() {
    const found = new Map();
    for (const doc of PageDOM.documents(document)) {
      const base = Queue.site(doc.baseURI)?.url.href || location.href;
      for (const item of Queue.readCourses(doc, base, platform)) found.set(item.id, item);
    }
    return [...found.values()];
  }

  function officialListPage(value) {
    const target = Queue.site(value, location.href);
    return target?.platform === 'chaoxing' && /^mooc[12](?:-[a-z0-9]+)?\.chaoxing\.com$/i.test(target.url.hostname) && /^\/visit\/interaction\/?$/.test(target.url.pathname) ? target.url : null;
  }

  async function requestCourseHTML(url, body = null) {
    const options = body ? { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body } : { method: 'GET' };
    const allowedResponse = value => {
      const result = Queue.site(value);
      return result?.url.origin === url.origin && result.url.pathname === url.pathname;
    };
    if (url.origin === location.origin) {
      const response = await fetch(url, { ...options, credentials: 'same-origin', signal: AbortSignal.timeout(12000) });
      if (!response.ok || !allowedResponse(response.url || url.href)) return [];
      return Queue.readCourses(new DOMParser().parseFromString(await response.text(), 'text/html'), response.url || url.href, platform);
    }
    return new Promise(resolve => {
      GM_xmlhttpRequest({
        method: options.method, headers: options.headers, data: body || undefined, url: url.href, timeout: 12000,
        onload(response) {
          if (response.status < 200 || response.status >= 300 || !allowedResponse(response.finalUrl || url.href)) return resolve([]);
          try {
            resolve(Queue.readCourses(new DOMParser().parseFromString(response.responseText, 'text/html'), response.finalUrl || url.href, platform));
          } catch { resolve([]); }
        },
        onerror: () => resolve([]), ontimeout: () => resolve([]), onabort: () => resolve([])
      });
    });
  }

  async function fetchList(url) {
    for (const prefix of ['mooc-ans', 'mooc2-ans']) {
      const endpoint = new URL(`/${prefix}/visit/courselistdata`, url);
      const form = new URLSearchParams({ courseType: '1', courseFolderId: '0', baseEducation: '0', superstarClass: '', courseFolderSize: '0' });
      const courses = await requestCourseHTML(endpoint, form.toString()).catch(() => []);
      if (courses.length) return courses;
    }
    return requestCourseHTML(url);
  }

  async function loadCourses() {
    if (loading || queue.items.length) return;
    loading = true;
    renderCandidates();
    try {
      let found = localCourses();
      if (!found.length && platform === 'chaoxing') {
        const embedded = [...document.querySelectorAll('iframe[src], [dataurl]')]
          .map(el => officialListPage(el.getAttribute('src') || el.getAttribute('dataurl'))).find(Boolean);
        const url = embedded || officialListPage(location.href) || new URL(listURL);
        found = await fetchList(url);
      }
      candidates = found;
      const ids = new Set(found.map(item => item.id));
      selected = selected.filter(id => ids.has(id));
      loadHint = found.length ? `已读取 ${found.length} 门，点选顺序即学习顺序。`
        : `没有读到课程。请先登录并打开${platform === 'zhihuishu' ? '在线学堂的课程列表，等课程卡片加载完成' : '学习通「我的课程」'}，再读取。`;
    } catch {
      loadHint = '读取失败。请检查登录状态和课程列表是否加载完成，再试一次。';
    } finally {
      loading = false;
      renderCandidates();
    }
  }

  function renderCandidates() {
    readButton.disabled = loading;
    loadingText.textContent = loading ? '正在读取课程…' : loadHint;
    const pattern = query.value.trim().toLowerCase();
    const shown = candidates.filter(item => `${item.title} ${item.detail}`.toLowerCase().includes(pattern));
    candidateList.replaceChildren(...shown.map(item => {
      const position = selected.indexOf(item.id);
      const control = element('button', { type: 'button', class: 'queue-choice', 'aria-pressed': String(position >= 0), onclick: () => {
        selected = position < 0 ? [...selected, item.id] : selected.filter(id => id !== item.id);
        renderCandidates();
        [...candidateList.children].find(child => child.dataset.course === item.id)?.focus();
      }, 'data-course': item.id }, [
        element('span', { class: 'queue-index', text: position >= 0 ? String(position + 1) : '+' }),
        element('span', {}, [element('strong', { text: item.title }), item.detail && element('small', { text: item.detail })].filter(Boolean))
      ]);
      return control;
    }));
    if (candidates.length && !shown.length) candidateList.append(hint('没有匹配的课程。'));
    selectionCount.textContent = `已选 ${selected.length} / ${candidates.length}`;
    startButton.disabled = !selected.length || loading;
    clearSelection.disabled = !selected.length;
  }

  function render() {
    const course = Queue.currentCourse(queue);
    const live = isLive();
    const signature = JSON.stringify([queue.status, live, isOwner(), queue.items]);
    if (signature === lastRendered) return;
    lastRendered = signature;
    listing.hidden = queue.items.length > 0;
    running.hidden = !queue.items.length;
    if (!queue.items.length) { renderCandidates(); return; }
    const done = queue.items.filter(item => item.status === 'done').length;
    const skipped = queue.items.filter(item => item.status === 'skipped').length;
    const failed = queue.items.filter(item => item.status === 'failed').length;
    progress.max = queue.items.length;
    progress.value = done + skipped + failed;
    current.textContent = course?.title || (queue.status === 'finished' ? '本轮队列已结束' : '待开始');
    runStatus.textContent = live ? (isOwner() ? '运行中' : '在另一标签页运行') : queue.status === 'finished' ? '已结束' : '已暂停';
    summary.textContent = `${done + skipped + failed} / ${queue.items.length} 已处理 · 完成 ${done} · 跳过 ${skipped} · 失败 ${failed}`;
    pauseButton.hidden = !live;
    pauseButton.disabled = !isOwner();
    continueButton.hidden = live || queue.status === 'finished';
    skipButton.hidden = !course || (live && !isOwner());
    resetButton.disabled = live;
    items.replaceChildren(...queue.items.map((item, index) => element('div', { class: `list-item queue-item ${item === course ? 'current' : ''}` }, [
      element('div', { class: 'queue-item-main' }, [element('strong', { text: `${index + 1}. ${item.title}` }), item.note ? hint(item.note) : null]),
      element('span', { class: 'tag', text: item.status === 'studying' && !live ? '已暂停' : statusText[item.status] }),
      item.status === 'pending' && (!live || isOwner()) ? button('移出', () => remove(item.id), { 'aria-label': `移出${item.title}` }) : null
    ])));
  }

  function sync() { queue = Queue.cleanQueue(read(key, queue), platform); }
  function save() { write(key, queue); render(); }
  function remove(id) {
    sync();
    if (isLive() && !isOwner()) throw Error('队列在另一标签页运行。');
    queue.items = queue.items.filter(item => item.id !== id || item.status !== 'pending');
    save();
  }
  function reset() {
    sync();
    if (isLive() || !window.confirm('清空本轮队列和处理结果，重新选择课程？')) return;
    queue = Queue.cleanQueue(null, platform);
    selected = [];
    save();
  }
  function stop(message = '课程队列已暂停。') {
    sync();
    if (!isOwner()) return;
    Queue.pause(queue);
    const item = Queue.currentCourse(queue);
    if (item) item.note = message;
    departure = false;
    for (const player of media()) player.pause();
    save();
    notice(message);
  }
  function start() {
    sync();
    if (queue.items.length || !selected.length) return;
    queue = Queue.cleanQueue({ items: selected.map(id => candidates.find(item => item.id === id)).filter(Boolean) }, platform);
    launch();
  }
  function resume() {
    sync();
    if (isLive()) return;
    launch();
  }
  function launch() {
    refresh.stop();
    beforeStart();
    sessionWrite(ownerKey, owner);
    const course = Queue.begin(queue, owner, Date.now());
    if (!course) return;
    course.note = '';
    save();
    log(`开始学习：${course.title}`);
    route(course.lastURL || course.url);
  }
  function route(target) {
    viewedURL = location.href;
    attempted = new WeakMap();
    entryTime = Date.now();
    catalogRequested = false;
    activeChapter = null;
    switched = null;
    lastSwitch = 0;
    confirmedCompleteAt = 0;
    if (Queue.identify(location.href) === Queue.currentCourse(queue)?.id) return;
    const url = Queue.courseLink(target, location.href, platform);
    if (!url) { stop('课程入口无法识别，请打开课程后继续。'); return; }
    navigateToCourse(url);
  }
  function navigateToCourse(url) {
    const ticket = newToken();
    Object.assign(queue, { ticket, handoff: Queue.identify(url.href), lease: Date.now() + Queue.HOLD_MS });
    save();
    location.assign(Queue.handoffURL(url.href, ticket).href);
    departure = true;
  }
  function finish(status, reason) {
    sync();
    if (!isOwner() && !(status === 'skipped' && !isLive() && Queue.currentCourse(queue))) return;
    const name = Queue.currentCourse(queue)?.title;
    const advancing = isOwner();
    for (const player of media()) player.pause();
    Queue.resolve(queue, status, reason);
    const next = advancing ? Queue.begin(queue, owner, Date.now()) : null;
    save();
    if (name) log(`${name}：${reason}`);
    if (next) route(next.url);
    else notice(queue.status === 'finished' ? '课程队列已结束。' : '课程已跳过。可继续下一门。');
  }

  async function tick() {
    sync();
    render();
    if (departure || !isOwner()) return;
    if (!isLive()) { stop('上次运行已失去连接，请点击继续。'); return; }
    const item = Queue.currentCourse(queue);
    const now = Date.now();
    if (Queue.identify(location.href) !== item.id) {
      if (now - entryTime > catalogWait) stop('当前页不是队列中的课程，请继续队列或检查登录状态。');
      return;
    }
    if (item.lastURL !== location.href || queue.lease - now < Queue.HOLD_MS / 2) {
      item.lastURL = location.href;
      queue.lease = now + Queue.HOLD_MS;
      save();
    }
    if (viewedURL !== location.href) {
      viewedURL = location.href;
      entryTime = now;
      catalogRequested = false;
      switched = null;
    }
    const chapters = Queue.catalog(PageDOM.documents(document), PageDOM.visible);
    if (chapters.length && chapters.every(chapter => chapter.status === 'done')) {
      confirmedCompleteAt ||= now;
      if (now - confirmedCompleteAt > 1800) finish('done', '平台章节均显示已完成');
      return;
    }
    confirmedCompleteAt = 0;
    const chapter = chapters.find(chapter => chapter.active);
    if (chapter && activeChapter !== chapter.control) {
      activeChapter = chapter.control;
      entryTime = now;
      switched = null;
    }
    const players = media();
    for (const player of players) {
      if (player.ended || !player.paused || (attempted.get(player) || 0) > now - 4500) continue;
      if (chapter?.status === 'done') break;
      attempted.set(player, now);
      try { await play(player); } catch { notice('请手动播放当前章节。队列会继续检查平台进度。'); }
      sync();
      if (!isOwner()) { player.pause(); return; }
    }
    const playing = players.some(player => !player.paused && !player.ended);
    if ((!playing || chapter?.status === 'done') && (!chapter || chapter.status === 'done') && now - lastSwitch > 2500) {
      const next = chapters.find(chapter => chapter.status === 'pending' && !chapter.active)
        || (!chapter && platform === 'chaoxing' && chapters.find(row => row.status === 'unknown' && /\btoOld\(/.test(row.control.getAttribute('onclick') || '')));
      if (next && switched !== next.control) {
        switched = next.control;
        lastSwitch = now;
        for (const player of players) player.pause();
        const href = next.control.getAttribute('href');
        const direct = href && Queue.courseLink(href, next.control.ownerDocument.baseURI, platform);
        const link = direct || (platform === 'chaoxing' && Queue.chaoxingChapterEntry(next.control, location.href, item.id));
        const changesPage = link && (link.origin !== location.origin || link.pathname !== location.pathname || link.search !== location.search);
        if (changesPage && Queue.identify(link.href) === item.id) {
          navigateToCourse(link);
        } else if (/\btoOld\(/.test(next.control.getAttribute('onclick') || '')) {
          stop('已找到待学章节，但学习通未提供可用的学习入口。请手动打开这一章后点击继续。');
          return;
        } else {
          next.control.click();
        }
        notice(`正在打开章节：${next.title || '未完成章节'}`);
        return;
      }
    }
    if (!chapters.length && !catalogRequested && !players.length) {
      const nav = [...document.querySelectorAll('button, a, [role=tab], [data-url]')].find(el => PageDOM.visible(el) && (/studentcourse/.test(el.getAttribute('data-url') || '') || /^(章节|课程章节)$/.test(el.textContent.trim())));
      if (nav) { catalogRequested = true; nav.click(); return; }
    }
    if (!playing && now - entryTime > catalogWait && now - lastSwitch > catalogWait) {
      const reason = chapters.some(chapter => chapter.status === 'locked') ? '有未解锁的章节，请处理后继续。'
        : chapter?.status === 'pending' ? '平台仍显示本章未完成。请检查测验或其他任务点后继续。'
        : '无法确认章节任务状态，请打开章节目录或处理本门课程后继续。';
      stop(reason);
    }
  }

  render();
  let ticking = false;
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    safeAction(tick).finally(() => { ticking = false; });
  }, 1250);
  return { view, show: () => { sync(); render(); }, stop, active: () => isOwner() && isLive(), hasRun: () => Boolean(Queue.currentCourse(queue)) };
}
