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
function scan(root) { return QuestionScan.scan(documents(root), visible); }
function fill(question, answer) {
  const fresh = question.box.isConnected && QuestionScan.readBox(question.box, question.decode, visible);
  if (!fresh || !fresh.editable || fresh.unresolved || fresh.text !== question.text || fresh.kind !== question.kind ||
      fresh.controls.length !== question.controls.length || fresh.controls.some((el,i) => el !== question.controls[i]) ||
      fresh.options.some((text,i) => text !== question.options[i])) throw Error('题目已变化或不可编辑，请重新扫描。');
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
    const current = QuestionScan.checked(question, control, i);
    if (wanted !== current && (wanted || question.kind === 'multiple')) control.click();
  });
  const actual = question.controls.map((control, i) => QuestionScan.checked(question, control, i) ? i : -1).filter(i => i >= 0);
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
