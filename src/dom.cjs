'use strict';

function documents(root) {
  const result = [], seen = new Set();
  const visit = doc => {
    if (!doc || seen.has(doc)) return;
    seen.add(doc); result.push(doc);
    for (const frame of doc.querySelectorAll('iframe,frame')) {
      try { visit(frame.contentDocument); } catch { /* Cross-origin frames are intentionally untouched. */ }
    }
  };
  visit(root); return result;
}
function visible(element) {
  if (!element?.isConnected || element.closest('[hidden],[aria-hidden="true"]')) return false;
  const view = element.ownerDocument.defaultView;
  const style = view?.getComputedStyle(element);
  return style?.display !== 'none' && style?.visibility !== 'hidden' && element.getClientRects().length > 0;
}
const controlSelector = 'input[type="radio"],input[type="checkbox"],textarea,input[type="text"],input:not([type]),[role="radio"],[role="checkbox"]';
function label(control) {
  const text = [...(control.labels || [])].map(el => el.textContent).join(' ') || control.getAttribute('aria-label') || control.closest('label')?.textContent || control.textContent || control.value || '';
  return text.replace(/^\s*[A-Z][.、:：)）]\s*/i, '').replace(/\s+/g, ' ').trim();
}
function scan(root) {
  const result = [], used = new Set();
  for (const doc of documents(root)) {
    for (const control of doc.querySelectorAll(controlSelector)) {
      if (used.has(control) || !visible(control) || control.disabled || control.readOnly) continue;
      let box = control.closest('fieldset,[data-question],.question,.question-item,.questionItem,.TiMu,[role="group"]');
      if (!box) continue; // Do not mistake login/search/comment forms for questions.
      const controls = [...box.querySelectorAll(controlSelector)].filter(el => visible(el) && !el.disabled && !el.readOnly);
      if (!controls.length) continue;
      const choice = controls.filter(el => ['radio', 'checkbox'].includes(el.type) || ['radio', 'checkbox'].includes(el.getAttribute('role')));
      if (choice.length && choice.length !== controls.length) continue;
      if (choice.length > 26) continue;
      const groups = new Set(choice.map(el => el.name).filter(Boolean));
      if (groups.size > 1 && choice.some(el => el.type === 'radio')) continue;
      const multiple = choice.some(el => el.type === 'checkbox' || el.getAttribute('role') === 'checkbox');
      const copy = box.cloneNode(true);
      for (const el of copy.querySelectorAll('script,style,input,textarea,button,select,[role="radio"],[role="checkbox"],label')) el.remove();
      const heading = box.querySelector('legend,[data-question-title],.question-title,h1,h2,h3,h4');
      const text = (heading?.textContent || copy.textContent).replace(/\s+/g, ' ').trim();
      if (!text || text.length > 12000) continue;
      controls.forEach(el => used.add(el));
      result.push({ id: result.length + 1, text, kind: choice.length ? (multiple ? 'multiple' : 'single') : 'text', options: choice.map(label), fields: choice.length ? 0 : controls.length, controls, box, doc, signature: choice.map(label).join('\n'), textSignature: box.textContent.replace(/\s+/g,' ').trim() });
    }
  }
  return result;
}
function fill(question, answer) {
  if (!question.box.isConnected || question.controls.some(el => !el.isConnected || el.disabled || el.readOnly) || question.box.textContent.replace(/\s+/g,' ').trim() !== question.textSignature || (question.kind !== 'text' && question.controls.map(label).join('\n') !== question.signature)) throw Error('题目已变化或不可编辑，请重新扫描。');
  if (question.kind === 'text') {
    if (answer.answers.length !== question.controls.length) throw Error('填空数量不一致。');
    question.controls.forEach((control, i) => {
      const view = control.ownerDocument.defaultView;
      const prototype = control.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, answer.answers[i]);
      control.dispatchEvent(new view.Event('input', { bubbles: true }));
      control.dispatchEvent(new view.Event('change', { bubbles: true }));
    });
    return;
  }
  if (!answer.indices?.length || answer.indices.some(i => !Number.isInteger(i) || i < 0 || i >= question.controls.length) || (question.kind === 'single' && answer.indices.length !== 1)) throw Error('选项映射无效。');
  question.controls.forEach((control, i) => {
    const wanted = answer.indices.includes(i);
    const current = 'checked' in control ? control.checked : control.getAttribute('aria-checked') === 'true';
    if (wanted !== current && (wanted || question.kind === 'multiple')) control.click();
  });
  const actual = question.controls.map((control, i) => ('checked' in control ? control.checked : control.getAttribute('aria-checked') === 'true') ? i : -1).filter(i => i >= 0);
  if (actual.join(',') !== [...answer.indices].sort((a,b)=>a-b).join(',')) throw Error('页面未接受部分选项，请手动核对。');
}
function copyUnlock(root) {
  const installed = new Map();
  let enabled = false;
  const types = ['copy', 'cut', 'paste', 'contextmenu', 'selectstart', 'keydown'];
  function apply() {
    if (!enabled) return;
    for (const doc of documents(root)) {
      if (installed.has(doc)) continue;
      const stop = event => {
        if (event.type !== 'keydown' || ((event.ctrlKey || event.metaKey) && ['a','c','v','x'].includes(event.key.toLowerCase()))) event.stopImmediatePropagation();
      };
      const style = doc.createElement('style');
      style.textContent = 'body,body *{-webkit-user-select:text!important;user-select:text!important}';
      doc.documentElement.append(style);
      types.forEach(type => doc.addEventListener(type, stop, true));
      installed.set(doc, () => { style.remove(); types.forEach(type => doc.removeEventListener(type, stop, true)); });
    }
    for (const [doc, cleanup] of installed) if (!documents(root).includes(doc)) { cleanup(); installed.delete(doc); }
  }
  return {
    set(value) { enabled = Boolean(value); if (enabled) apply(); else { for (const cleanup of installed.values()) cleanup(); installed.clear(); } },
    tick: apply
  };
}
module.exports = { documents, visible, scan, fill, copyUnlock };
