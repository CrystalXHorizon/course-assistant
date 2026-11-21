'use strict';

function onScreen(doc, root) {
  while (doc !== root) {
    const frame = doc.defaultView?.frameElement;
    if (!PageDOM.visible(frame) || frame.contentDocument!==doc) return false;
    doc = frame.ownerDocument;
  }
  return true;
}

function locate(doc, root) {
  const url = new URL(doc.URL);
  if (!/\/work\/doHomeWorkNew\/?$/i.test(url.pathname) || !onScreen(doc, root)) return null;
  const form = doc.querySelector('form#form1');
  const button = doc.querySelector('.ZY_sub .btnSubmit, .btnSubmit[onclick*="btnBlueSubmit"]');
  if (!form || !PageDOM.visible(button) || button.textContent.trim() !== '提交' || button.matches(':disabled,[aria-disabled=true]')) return null;
  const status = doc.querySelector('.testTit_status')?.textContent.trim();
  if (status && /已提交|已完成|已批阅|待批阅/.test(status)) return null;
  const id = doc.querySelector('#workAnswerId')?.value || url.searchParams.get('workAnswerId');
  const course = url.searchParams.get('courseId') || url.searchParams.get('courseid') || '';
  const work = url.searchParams.get('workId') || doc.querySelector('#workRelationId')?.value || '';
  const group = url.searchParams.get('classId') || url.searchParams.get('clazzid') || '';
  const key = id || (work && group ? group + '-' + work : '');
  return {doc, form, button, key: key ? 'submitted.' + url.origin + '.' + course + '.' + key : ''};
}

function validate(quiz, questions, requireFilled = false) {
  const {doc, form} = quiz;
  const wrappers = [...form.querySelectorAll('.singleQuesId,.questionLi,.TiMu,.newTiMu')];
  const leaves = wrappers.filter(el => !el.querySelector('.singleQuesId,.questionLi,.TiMu,.newTiMu'));
  const header = doc.querySelector('.ceyan_name')?.textContent.match(/题量\s*[:：]\s*(\d+)/);
  if (!questions.length || (header && Number(header[1]) !== questions.length) ||
      (leaves.length && leaves.some(el => !questions.some(q => el === q.box || el.contains(q.box) || q.box.contains(el)))) ||
      (!header && !leaves.length)) throw Error('题量与平台不一致，已暂停提交。');
  if (!questions.every(q => q.doc === doc && form.contains(q.box) && q.editable && !q.unresolved)) throw Error('测验中有不可编辑或未还原的题目，已暂停提交。');
  if (requireFilled) {
    for (const q of questions) {
      const fresh = QuestionScan.readBox(q.box, q.decode, PageDOM.visible);
      if (!q.answer || !fresh || fresh.text !== q.text || fresh.kind !== q.kind ||
          fresh.controls.length !== q.controls.length || fresh.controls.some((el,i) => el !== q.controls[i]) ||
          fresh.options.some((s,i) => s !== q.options[i])) throw Error('提交前题目已变化，请重新扫描。');
      const matches = q.controls.every((el,i) => q.kind === 'text' ? el.value === q.answer.answers[i]
        : QuestionScan.checked(q,el,i) === q.answer.indices.includes(i));
      if (!matches) throw Error('页面答案与填入结果不一致，已暂停提交。');
      const id = q.controls[0]?.getAttribute('qid');
      const saved = id && doc.getElementById('answer' + id);
      if (saved && form.contains(saved) && q.kind !== 'text') {
        const selected = q.controls.filter((_,i)=>q.answer.indices.includes(i));
        const values = selected.map(el=>el.querySelector('.num_option[data],.num_option_dx[data]')?.getAttribute('data'));
        const comparable = value => q.kind === 'multiple' ? [...value.toLowerCase()].sort().join('') : value.toLowerCase();
        if (values.some(value=>!value) || comparable(saved.value) !== comparable(values.join(''))) {
          throw Error('学习通尚未记录第 ' + q.id + ' 题的选项，已暂停提交。');
        }
      }
    }
  }
}

function confirmButton(quiz, root) {
  const docs = new Set([quiz.doc, root]);
  for (const doc of docs) {
    for (const [box, prompt, action] of [['#workpop','#popcontent','#popok'],['#confirmSubWin','#tipContent','.bluebtn']]) {
      const dialog = doc.querySelector(box);
      if (!PageDOM.visible(dialog)) continue;
      const message = dialog.querySelector(prompt)?.textContent.trim() || '';
      if (!/^确[认定]提交[吗么]?[？?！!。]?$/u.test(message)) throw Error('平台提示：' + (message || '请检查提交窗口。'));
      const button = dialog.querySelector(action);
      if (PageDOM.visible(button) && /^(提交|确定|确认提交)$/.test(button.textContent.trim())) return button;
    }
  }
  return null;
}

module.exports = {locate, validate, confirmButton, onScreen};
