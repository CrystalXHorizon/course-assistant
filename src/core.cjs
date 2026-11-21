'use strict';

const defaults = Object.freeze({ apiKey: '', model: 'deepseek-flash', thinking: false, timeout: 120, rate: 1, unlock: false, autoSubmit: false });
function config(value = {}) {
  return {
    apiKey: typeof value.apiKey === 'string' ? value.apiKey.trim() : '',
    model: typeof value.model === 'string' && /^[\w.-]{1,100}$/.test(value.model) ? value.model : defaults.model,
    thinking: value.thinking === true,
    timeout: Number.isInteger(value.timeout) && value.timeout >= 15 && value.timeout <= 600 ? value.timeout : 120,
    rate: [0.5, 0.75, 1, 1.25, 1.5, 2].includes(value.rate) ? value.rate : 1,
    unlock: value.unlock === true,
    autoSubmit: value.autoSubmit === true
  };
}
function duration(seconds) {
  const n = Math.max(0, Math.ceil(Number(seconds) || 0));
  const pad = v => String(v).padStart(2, '0');
  return (n >= 3600 ? pad(Math.floor(n / 3600)) + ':' : '') + pad(Math.floor(n / 60) % 60) + ':' + pad(n % 60);
}

class RefreshTimer {
  constructor({ read, write, now = Date.now, url, navigation = 'navigate' }) {
    this.write = write; this.now = now; this.reloading = false;
    const blank = { active: false, seconds: 300, limit: 0, count: 0, due: 0, url };
    let saved;
    try { saved = read(); } catch { saved = null; }
    this.state = { ...blank };
    if (saved && Number.isInteger(saved.seconds) && saved.seconds >= 10 && saved.seconds <= 86400 &&
        Number.isInteger(saved.limit) && saved.limit >= 0 && saved.limit <= 1000000 &&
        Number.isInteger(saved.count) && saved.count >= 0 && Number.isFinite(saved.due)) {
      this.state = { ...blank, ...saved, active: saved.active === true && saved.url === url && navigation === 'reload' };
    }
    if (this.state.limit && this.state.count >= this.state.limit) this.state.active = false;
    if (this.state.active) this.state.due = now() + this.state.seconds * 1000;
  }
  persist() {
    try { this.write({ ...this.state }); }
    catch { this.state.active = false; throw Error('无法保存计时状态，刷新已停止。请允许此站点使用会话存储。'); }
  }
  start(seconds, limit, url) {
    if (!Number.isInteger(seconds) || seconds < 10 || seconds > 86400 || !Number.isInteger(limit) || limit < 0 || limit > 1000000) throw Error('间隔须为 10～86400 秒，次数为 0～1000000 的整数。');
    this.state = { active: true, seconds, limit, count: 0, due: this.now() + seconds * 1000, url };
    this.reloading = false; this.persist();
  }
  stop() { this.state.active = false; this.persist(); }
  tick(url) {
    if (!this.state.active || this.reloading) return false;
    if (url !== this.state.url) { this.stop(); return false; }
    if (this.now() < this.state.due) return false;
    this.state.count++;
    if (this.state.limit && this.state.count >= this.state.limit) this.state.active = false;
    this.state.due = this.now() + this.state.seconds * 1000;
    this.persist(); this.reloading = true; return true;
  }
}

const normalize = text => String(text).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
function parseAnswer(text, question) {
  let value;
  try { value = JSON.parse(String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw Error('AI 未返回有效的 JSON 答案，请重试或自行核对。'); }
  if (!value || !Array.isArray(value.answers) || !value.answers.length || value.answers.some(v => typeof v !== 'string' || !v.trim())) throw Error('答案缺少有效的 answers 数组。');
  const answers = value.answers.map(v => v.trim());
  const explanation = typeof value.explanation === 'string' ? value.explanation : '';
  if (question.kind === 'text') {
    if (answers.length !== question.fields) throw Error('答案数量与填空数量不一致。');
    return { answers, explanation };
  }
  const indices = answers.map(answer => {
    const letter = /^[A-Z]$/i.test(answer) ? answer.toUpperCase().charCodeAt(0) - 65 : -1;
    if (letter >= 0 && letter < question.options.length) return letter;
    const matches = question.options.map((option, index) => normalize(option) === normalize(answer) ? index : -1).filter(i => i >= 0);
    if (matches.length !== 1) throw Error('答案无法唯一匹配选项，未自动选择。');
    return matches[0];
  });
  const unique = [...new Set(indices)];
  if (question.kind === 'single' && unique.length !== 1) throw Error('单选题必须有且只有一个答案。');
  return { answers, indices: unique, explanation };
}

function requester(transport, settings) {
  return function request(path, data, signal) {
    if (!['/models', '/chat/completions'].includes(path)) return Promise.reject(Error('不支持的 API 路径。'));
    const cfg = config(settings());
    if (!cfg.apiKey) return Promise.reject(Error('请先在设置中填写 DeepSeek API Key。'));
    return new Promise((resolve, reject) => {
      let handle, finished = false;
      const abortError = () => Object.assign(Error('操作已取消。'), { name: 'AbortError' });
      function finish(error, result) {
        if (finished) return; finished = true;
        signal?.removeEventListener('abort', abort);
        error ? reject(error) : resolve(result);
      }
      function abort() { finish(abortError()); handle?.abort?.(); }
      if (signal?.aborted) { finish(abortError()); return; }
      signal?.addEventListener('abort', abort, { once: true });
      try {
        handle = transport({
          method: data ? 'POST' : 'GET', url: 'https://api.deepseek.com' + path,
          headers: { Authorization: 'Bearer ' + cfg.apiKey, 'Content-Type': 'application/json' },
          anonymous: true, timeout: cfg.timeout * 1000,
          ...(data ? { data: JSON.stringify(data) } : {}),
          onload: response => {
            if (response.status < 200 || response.status >= 300) {
              const errors = { 401: 'API Key 无效', 402: '账户余额不足', 403: '请求被拒绝', 429: '请求过于频繁，请稍后重试' };
              finish(Error(errors[response.status] || `API 请求失败（HTTP ${response.status}）`)); return;
            }
            try { finish(null, JSON.parse(response.responseText)); }
            catch { finish(Error('服务返回了无法解析的数据。')); }
          },
          onerror: () => finish(Error('连接失败，请检查网络与扩展的域名访问权限。')),
          ontimeout: () => finish(Error('请求超时，请稍后重试。')),
          onabort: () => finish(abortError())
        });
        if (signal?.aborted) handle?.abort?.();
      } catch { finish(Error('无法发起 API 请求，请检查脚本管理器。')); }
    });
  };
}
async function complete(request, cfg, messages, signal, json = false) {
  const payload = { model: cfg.model, messages, stream: false, thinking: { type: cfg.thinking ? 'enabled' : 'disabled' } };
  if (json) payload.response_format = { type: 'json_object' };
  const response = await request('/chat/completions', payload, signal);
  const choice = response.choices?.[0];
  if (choice?.finish_reason === 'length') throw Error('回答被截断，请缩短问题后重试。');
  if (choice?.finish_reason && choice.finish_reason !== 'stop') throw Error('服务未正常完成回答，请重试。');
  if (typeof choice?.message?.content !== 'string' || !choice.message.content.trim()) throw Error('没有收到有效回答。');
  return choice.message.content;
}
module.exports = { defaults, config, duration, normalize, RefreshTimer, parseAnswer, requester, complete };
