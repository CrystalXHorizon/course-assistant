'use strict';

const containers = 'fieldset,[data-question],[data-question-id],.question,.question-item,.questionItem,.questionLi,.newTiMu,.TiMu,.mark_item,.singleQuesId,[role="group"],article';
const rows = '.Zy_ulTop li,li[qtype],.answerBg,[class*="before-after"],.mark_letter li,[role="option"],.answer-option,.option-item,li:has(.option-result)';
const choiceInput = 'input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"]';
const editors = 'textarea,input[type="text"],input:not([type])';
const titles = '.fontLabel,.qtContent,.question-name,legend,[data-question-title],.question-title,.Zy_TItle,.mark_name,.newZy_TItle,h1,h2,h3,h4';
const marker = /^(?:\d+\s*[.、．]\s*)?[\[【(（〖]?\s*(多项选择题|多选题|不定项选择题|单项选择题|单选题|判断题|是非题|填空题)\s*[\]】)）〗]?/;
const space = text => text.replace(/\s+/g, ' ').trim();

function readNode(node, decode, skip = new Set()) {
  if (skip.has(node)) return '';
  if (node.nodeType === 3) return decode(node.data, node.parentElement);
  if (node.nodeType !== 1 || node.matches('script,style,input,textarea,select,[hidden],[aria-hidden="true"],.colorShallow,.num_option,.option-letter,.mark_score,.analysis,.answer_analysis')) return '';
  if (node.tagName === 'IMG') return node.alt || '';
  if (node.tagName === 'BR') return ' ';
  const text = [...node.childNodes].map(child => readNode(child, decode, skip)).join('');
  return node.matches('div,p,li,legend') ? ' ' + text + ' ' : text;
}

// Match a sequence of A/B/... labels among siblings. The clickable letter may
// sit inside its row or directly beside the text it selects.
function letterChoices(box, decode) {
  const first = [...box.querySelectorAll('span,i,b,div,label,a,button')].find(el =>
    !el.children.length && el.textContent.trim().normalize('NFKC') === 'A');
  if (!first) return [];
  for (let group = first.parentElement; group && group !== box.parentElement; group = group.parentElement) {
    const choices = [];
    for (const node of group.children) {
      const leading = node.firstElementChild || node;
      const letter = space(leading.textContent).normalize('NFKC');
      if (letter === String.fromCharCode(65 + choices.length)) {
        const inline = leading === node ? '' : space(readNode(node, decode, new Set([leading])));
        choices.push({control: node, text: inline, parts: [node]});
      } else if (choices.length && !choices.at(-1).text) {
        choices.at(-1).parts.push(node);
        choices.at(-1).text = space(readNode(node, decode));
      } else if (choices.length) break;
    }
    if (choices.length >= 2 && choices.every(choice => choice.text)) return choices;
  }
  return [];
}

function optionText(row, control, decode) {
  const body = row.querySelector('.fl.after,.answer_p,.option-result,.after') || row;
  const value = space(readNode(body, decode)).replace(/^[A-ZＡ-Ｚ]\s*[.．、:：)）]\s*/u, '');
  const aria = row.getAttribute('aria-label') || control.getAttribute('aria-label') || '';
  return value || aria.replace(/^对选择$/, '正确').replace(/^错选择$/, '错误') || control.value || '';
}

function readBox(box, decode, visible) {
  const nodes = [...box.querySelectorAll(rows)].filter(row => {
    if (row.closest(titles)) return false;
    if (visible(row)) return true;
    // The chapter quiz hides the whole choice list from screen readers even
    // while its options are painted and clickable. Respect actual layout.
    if (!row.matches('li[qtype]') || !row.closest('.Zy_ulTop[aria-hidden="true"]') || row.closest('[hidden]')) return false;
    return row.checkVisibility ? row.checkVisibility({ visibilityProperty: true, opacityProperty: true })
      : row.getClientRects().length > 0 && row.ownerDocument.defaultView.getComputedStyle(row).visibility === 'visible';
  });
  const outer = nodes.filter(el => !nodes.some(other => other !== el && other.contains(el)));
  let choices = outer.map(row => {
    const control = row.querySelector('input[type="radio"],input[type="checkbox"]') || row;
    return { control, text: optionText(row, control, decode), parts: [row] };
  });
  if (!choices.length) {
    for (const control of box.querySelectorAll(choiceInput)) {
      const label = [...(control.labels || [])].find(el => box.contains(el)) || control.closest('label') || control;
      if (visible(label) || visible(control)) choices.push({control, text: optionText(label, control, decode), parts: [label]});
    }
  }
  const typed = marker.test(space(box.textContent).slice(0, 100)) || box.hasAttribute('typename') || box.matches('.TiMu,.newTiMu');
  if (!choices.length && typed) choices = letterChoices(box, decode);
  const controls = choices.length ? choices.map(c => c.control)
    : [...box.querySelectorAll(editors)].filter(el => visible(el) && !el.disabled && !el.readOnly);
  if (box.matches('article') && !typed && !box.querySelector(titles) && !box.hasAttribute('data-question-id')) return null;
  if (!controls.length || choices.length > 26 || choices.some(c => !c.text)) return null;
  if (choices.some(c => c.control.type === 'radio') && new Set(controls.map(c => c.name).filter(Boolean)).size > 1) return null;
  const excluded = new Set(choices.flatMap(c => c.parts));
  for (const tag of box.querySelectorAll('.newZy_TItle,.Zy_TItle > i')) {
    if (tag.matches('i') || !space(tag.textContent).replace(marker, '').trim()) excluded.add(tag);
  }
  const heading = box.querySelector('.fontLabel,.qtContent') || box.querySelector(titles);
  let text = space(readNode(heading && !excluded.has(heading) ? heading : box, decode, excluded));
  text = text.replace(marker, '').trim();
  if (!text || text.length > 12000) return null;
  const code = box.querySelector('input[id^="answertype"],input[name^="answertype"]')?.value || box.getAttribute('data-question-type')
    || box.getAttribute('data') || box.querySelector('[qtype]')?.getAttribute('qtype');
  const tag = box.getAttribute('typename') || box.querySelector('.colorShallow,.newZy_TItle,.question-type')?.textContent || '';
  const type = space(tag).match(marker)?.[1] || space(box.textContent).match(marker)?.[1];
  const kind = !choices.length ? 'text' : code === '1' || /多选|多项|不定项/.test(type || '') || box.matches('.multiple-choice') || controls.some(c => c.type === 'checkbox' || c.getAttribute('role') === 'checkbox') ? 'multiple' : 'single';
  const options = choices.map(choice => choice.text);
  const judgment = kind === 'single' && (code === '3' || /判断|是非/.test(type || '') || (options.length === 2 && options.every(s => /^(对|错|正确|错误|√|×|✓|✗)$/.test(s))));
  return { box, doc: box.ownerDocument, text, controls, options, kind, judgment, fields: choices.length ? 0 : controls.length,
    decode, unresolved: [text,...options].some(s => s.includes('\ufffd')), editable: controls.every(c => !c.disabled && !c.readOnly && !c.closest('[aria-disabled="true"]')) };
}

function scanScope(root, decode, visible) {
  const boxes = new Set(root.querySelectorAll(containers));
  // A bare div layout still has a per-question type marker near its first option.
  for (const el of root.querySelectorAll('span,b,em,strong')) {
    if (el.children.length || !marker.test(space(el.textContent)) || el.closest(containers)) continue;
    for (let parent = el.parentElement; parent && !parent.matches('body,main,form,section'); parent = parent.parentElement) {
      if (parent.querySelector(rows + ',' + choiceInput) || letterChoices(parent, decode).length) { boxes.add(parent); break; }
    }
  }
  const found = [];
  for (const box of boxes) {
    if (!visible(box) || [...box.querySelectorAll(containers)].some(child => boxes.has(child) && child.querySelector(rows + ',' + choiceInput + ',' + editors))) continue;
    const question = readBox(box, decode, visible);
    if (question) found.push(question);
  }
  return found.sort((a,b) => a.box.compareDocumentPosition(b.box) & 2 ? 1 : -1);
}

async function scan(docs, visible) {
  const results = [];
  for (const doc of docs) {
    const decode = await QuestionFont.prepare(doc);
    results.push(...scanScope(doc, decode, visible));
  }
  return results.map((q, i) => ({ ...q, id: i + 1 }));
}

function checked(question, control, index) {
  if ('checked' in control) return control.checked;
  for (const attr of ['aria-checked','aria-selected']) {
    if (control.hasAttribute(attr)) return control.getAttribute(attr) === 'true';
  }
  const saved = question.box.querySelector('input[type="hidden"][name^="answer"]:not([name^="answertype"])');
  const letter = control.querySelector('.num_option[data]')?.getAttribute('data') || String.fromCharCode(65 + index);
  if (saved) return saved.value.toUpperCase().includes(letter.toUpperCase());
  const selected = '.check_answer,.check_answer_dx,.check_answer_duo,.check_answerRight,.selected,.checked,.on';
  return control.matches(selected) || Boolean(control.querySelector(selected));
}

module.exports = { scan, checked, readBox };
