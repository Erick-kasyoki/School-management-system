'use strict';
/* views/teacher-marks.js — "Enter Marks".
   1. The exam office (exams.manage) OPENS an exam: CAT, Mid Term Exam or End Term Exam, for chosen classes and a term.
   2. While it is open, teachers pick the exam, their subject, and type the marks (one column per exam type).
   Saving goes to the marks_save endpoint, which only merges that subject — teachers never overwrite each other.
   Loaded after results.js (uses subjectsForGrade, normalizeMarkCell, gradeBand). */

const TM_TYPES = ['CAT', 'Mid Term Exam', 'End Term Exam'];
let TM = { examId: '', subject: '', term: '' };

function tmField(exam){ const t = String((exam && exam.examType) || '').toLowerCase(); return t.includes('cat') ? 'cat1' : t.includes('mid') ? 'midEnd' : 'examMarks'; }
function tmFieldLabel(exam){ const f = tmField(exam); return f === 'cat1' ? 'CAT mark' : f === 'midEnd' ? 'Mid Term mark' : 'End Term mark'; }
function tmIsOpen(e){ return String(e.open || '').toLowerCase() === 'yes' && e.status !== 'In Review' && e.status !== 'Published'; }
function tmClassLabel(e){ return (e.grade || '') + (e.stream ? ' ' + e.stream : ''); }
function tmExamLabel(e){ return `${e.examType} — ${tmClassLabel(e)} (${e.term || ''})`; }
function tmClasses(){
  const out = [], seen = new Set();
  const add = (g, st) => { const k = (g || '') + '|' + (st || ''); if (g && !seen.has(k)) { seen.add(k); out.push({ grade: g, stream: st || '' }); } };
  (DB.classes || []).forEach(c => add(c.grade, c.stream));
  if (!out.length) (DB.students || []).forEach(s => add(s.grade, s.stream));
  return out.sort((a, b) => (a.grade + a.stream).localeCompare(b.grade + b.stream, undefined, { numeric: true }));
}
function tmTerms(){
  const cur = (typeof realCurrentTerm === 'function' && realCurrentTerm()) || null;
  const first = (cur && cur.name) || (DB.settings && DB.settings.term) || '';
  return { all: Array.from(new Set([first].concat((DB.terms || []).map(t => t.name)).filter(Boolean))), first };
}

function renderTeacherMarks(el){
  const manager = can('exams.manage');
  const terms = tmTerms();
  if (!TM.term) TM.term = terms.first;
  el.innerHTML = `<p class="crumb">Academics <span>›</span> Enter Marks</p>
    ${manager ? '<div id="tmControl"></div>' : ''}
    <div id="tmEntry"></div>`;
  if (manager) drawControl();
  drawEntry();

  /* ---------------- exam office: open / close exams ---------------- */
  function drawControl(){
    const classes = tmClasses();
    const box = $('tmControl');
    const mine = (DB.exams || []).filter(e => !TM.term || e.term === TM.term).sort((a, b) => tmExamLabel(a).localeCompare(tmExamLabel(b), undefined, { numeric: true }));
    box.innerHTML = `<div class="card panel" style="margin-bottom:16px">
      <h3 style="margin:0 0 4px">Open an exam for marks entry</h3>
      <div class="muted" style="font-size:12.5px;margin-bottom:12px">Teachers can only enter marks for exams you have opened. Choose the exam and term, tick the classes, then press <b>Open exam</b>. Close it when entry is finished.</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
        <div><label style="display:block;font-size:12px">Exam</label><select id="tcType">${TM_TYPES.map(t => `<option>${esc(t)}</option>`).join('')}</select></div>
        <div><label style="display:block;font-size:12px">Term</label>${terms.all.length ? `<select id="tcTerm">${terms.all.map(t => `<option ${t === TM.term ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : `<input id="tcTerm" value="${esc(TM.term)}" placeholder="e.g. Term 3, ${new Date().getFullYear()}">`}</div>
        <button class="btn primary" id="tcOpen">🔓 Open exam</button>
      </div>
      <div style="margin-top:10px"><label style="font-size:12.5px"><input type="checkbox" id="tcAll" checked> All classes</label>
        <div id="tcClasses" style="display:none;gap:10px;flex-wrap:wrap;margin-top:6px">${classes.map((c, i) => `<label style="font-size:12.5px;margin-right:12px"><input type="checkbox" class="tcCls" value="${i}"> ${esc(tmClassLabel(c))}</label>`).join('')}</div></div>
      <div style="margin-top:14px"><b style="font-size:13px">Exams in ${esc(TM.term || 'this term')}</b></div>
      ${mine.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Exam</th><th>Class</th><th>Marks entry</th><th>Results</th><th></th></tr></thead><tbody>${mine.map(e => `<tr>
        <td>${esc(e.examType)}</td><td>${esc(tmClassLabel(e))}</td>
        <td>${tmIsOpen(e) ? '<span class="badge b-green">Open</span>' : '<span class="badge b-amber">Closed</span>'}</td><td>${badge(e.status || 'Draft')}</td>
        <td>${(e.status === 'In Review' || e.status === 'Published') ? '' : `<button class="btn ghost" data-toggle="${esc(e.id)}">${tmIsOpen(e) ? 'Close' : 'Open'}</button>`}</td></tr>`).join('')}</tbody></table></div>` : '<div class="muted" style="font-size:12.5px;margin-top:4px">No exams yet for this term.</div>'}
    </div>`;
    $('tcAll').onchange = e => { $('tcClasses').style.display = e.target.checked ? 'none' : 'flex'; };
    $('tcTerm').onchange = e => { TM.term = e.target.value.trim(); drawControl(); drawEntry(); };
    $('tcOpen').onclick = async () => {
      const type = $('tcType').value, term = $('tcTerm').value.trim();
      if (!term) { toast('Enter the term first.'); return; }
      TM.term = term;
      const chosen = $('tcAll').checked ? classes : Array.from(document.querySelectorAll('.tcCls:checked')).map(x => classes[Number(x.value)]);
      if (!chosen.length) { toast('Tick at least one class.'); return; }
      const yr = (String(term).match(/\d{4}/) || [String(new Date().getFullYear())])[0];
      let made = 0, opened = 0, skipped = 0;
      chosen.forEach(c => {
        const eq = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
        const ex = (DB.exams || []).find(e => eq(e.grade, c.grade) && eq(e.stream, c.stream) && eq(e.examType, type) && eq(e.term, term));
        if (ex) { if (ex.status === 'In Review' || ex.status === 'Published') { skipped++; return; } if (!tmIsOpen(ex)) { ex.open = 'Yes'; opened++; } return; }
        DB.exams.push({ id: uid('exm'), examType: type, grade: c.grade, stream: c.stream, academicYear: yr, term, examDate: today(), open: 'Yes', status: 'Draft' });
        made++;
      });
      if (!(made + opened)) { toast(skipped ? 'Those exams are already with the reviewers or published.' : 'Those exams are already open.'); return; }
      if (await persist('exams')) { toast(`${type} is now open for marks entry (${made + opened} class${made + opened === 1 ? '' : 'es'}).`); drawControl(); drawEntry(); }
    };
    box.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
      const ex = (DB.exams || []).find(e => e.id === b.dataset.toggle); if (!ex) return;
      ex.open = tmIsOpen(ex) ? 'No' : 'Yes';
      if (await persist('exams')) { toast(`${ex.examType} — ${tmClassLabel(ex)} is now ${ex.open === 'Yes' ? 'open' : 'closed'}.`); drawControl(); drawEntry(); }
    });
  }

  /* ---------------- teachers: enter marks ---------------- */
  function drawEntry(){
    const box = $('tmEntry');
    const usable = (DB.exams || []).filter(e => (manager ? (!TM.term || e.term === TM.term) : tmIsOpen(e)))
      .sort((a, b) => tmExamLabel(a).localeCompare(tmExamLabel(b), undefined, { numeric: true }));
    if (!usable.length) {
      box.innerHTML = `<div class="card panel"><div class="empty"><b>No exam is open for marks entry</b>${manager ? 'Open one above.' : 'The exam office has not opened an exam yet (CAT, Mid Term or End Term). You will be able to enter marks as soon as one is opened.'}</div></div>`;
      return;
    }
    if (!usable.some(e => e.id === TM.examId)) TM.examId = usable[0].id;
    const exam = usable.find(e => e.id === TM.examId);
    const subs = subjectsForGrade(exam.grade);
    if (!subs.includes(TM.subject)) TM.subject = subs[0];
    const locked = !tmIsOpen(exam) && !manager || exam.status === 'In Review' || exam.status === 'Published';
    const students = (DB.students || []).filter(s => s.grade === exam.grade && (!exam.stream || s.stream === exam.stream)).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const f = tmField(exam), marks = (DB.marks || {})[exam.id] || {}, coms = (DB.comments || {})[exam.id] || {};
    box.innerHTML = `<div class="card panel">
      <h3 style="margin:0 0 4px">Enter marks</h3>
      <div class="muted" style="font-size:12.5px;margin-bottom:12px">Pick the exam and the subject you teach, type each learner's mark (0–100) and press <b>Save marks</b>. Only the chosen subject is changed.</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px">
        <div><label style="display:block;font-size:12px">Exam</label><select id="teExam">${usable.map(e => `<option value="${esc(e.id)}" ${e.id === exam.id ? 'selected' : ''}>${esc(tmExamLabel(e))}</option>`).join('')}</select></div>
        <div><label style="display:block;font-size:12px">Subject</label><select id="teSub">${subs.map(s => `<option ${s === TM.subject ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
        ${tmIsOpen(exam) ? '<span class="badge b-green">Open</span>' : '<span class="badge b-amber">Closed</span>'}
        <div style="flex:1"></div><span class="muted" id="teCount" style="font-size:12.5px"></span>
        ${locked ? '' : '<button class="btn primary" id="teSave">💾 Save marks</button>'}
        ${(!locked && manager && (!exam.status || exam.status === 'Draft')) ? '<button class="btn ghost" id="teSubmit">Submit class for review</button>' : ''}
      </div>
      ${locked ? '<div class="row-line" style="margin-bottom:10px"><b>Marks cannot be changed now</b> — the exam is closed or its results are already with the reviewers.</div>' : ''}
      ${students.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>Student</th><th>${esc(tmFieldLabel(exam))}</th><th>Grade</th><th>Comment</th></tr></thead><tbody>
      ${students.map((s, i) => {
        const cell = normalizeMarkCell(((marks[s.id] || {})[TM.subject])), v = cell[f];
        const cm = (coms[s.id] || {}).teacher || '';
        return `<tr data-sid="${esc(s.id)}"><td>${i + 1}</td><td>${nameCell(s.name, s.admNo)}</td>
          <td><input class="te-mark" value="${esc(v)}" inputmode="decimal" autocomplete="off" placeholder="0–100" style="width:90px;text-align:center" ${locked ? 'disabled' : ''}></td>
          <td class="te-grade">${v !== '' && !isNaN(Number(v)) ? badge(gradeBand(Number(v)).code) : ''}</td>
          <td><input class="te-comment" value="${esc(cm)}" style="width:200px" ${locked ? 'disabled' : ''}></td></tr>`;
      }).join('')}</tbody></table></div>` : '<div class="empty">No students in this class.</div>'}
    </div>`;
    $('teExam').onchange = e => { TM.examId = e.target.value; drawEntry(); };
    $('teSub').onchange = e => { TM.subject = e.target.value; drawEntry(); };
    const rows = Array.from(box.querySelectorAll('tr[data-sid]'));
    const count = () => { $('teCount').textContent = rows.filter(r => r.querySelector('.te-mark').value.trim() !== '').length + ' of ' + rows.length + ' have marks'; };
    count();
    const dirty = new Set();
    rows.forEach((tr, i) => {
      tr.addEventListener('input', () => {
        dirty.add(tr.dataset.sid);
        const v = tr.querySelector('.te-mark').value.trim().replace(',', '.');
        tr.querySelector('.te-grade').innerHTML = v !== '' && !isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 100 ? badge(gradeBand(Number(v)).code) : '';
        count();
      });
      tr.addEventListener('keydown', e => {
        if (!['Enter', 'ArrowDown', 'ArrowUp'].includes(e.key) || !e.target.classList.contains('te-mark')) return;
        const n = rows[i + (e.key === 'ArrowUp' ? -1 : 1)];
        if (n) { e.preventDefault(); const t = n.querySelector('.te-mark'); t.focus(); t.select(); }
      });
    });
    async function save(quiet){
      const send = [];
      for (const tr of rows) {
        const inp = tr.querySelector('.te-mark'), v = inp.value.trim().replace(',', '.');
        inp.style.outline = '';
        if (v !== '' && (isNaN(Number(v)) || Number(v) < 0 || Number(v) > 100)) { inp.style.outline = '2px solid var(--rose)'; inp.scrollIntoView({ block: 'center' }); toast('Marks must be numbers from 0 to 100 — check the highlighted box.'); return null; }
        if (dirty.has(tr.dataset.sid) || v !== '') send.push({ studentId: tr.dataset.sid, mark: v, comment: tr.querySelector('.te-comment').value.trim() });
      }
      if (!send.length) { toast('Type at least one mark first.'); return null; }
      const res = await apiPost('marks_save', { examId: exam.id, subject: TM.subject, rows: send });
      if (!res || !res.ok) { toast((res && res.error) || 'Could not save the marks.'); await loadAll(); return null; }
      await loadAll();
      if (!quiet) toast(`Saved ${TM.subject} marks for ${res.saved} learner${res.saved === 1 ? '' : 's'}.`);
      return res;
    }
    if ($('teSave')) $('teSave').onclick = async () => { if (await save()) drawEntry(); };
    if ($('teSubmit')) $('teSubmit').onclick = async () => {
      if (!confirm('Send this class for review? Marks cannot be changed afterwards until it is returned.')) return;
      if (dirty.size && !(await save(true))) return;
      const ok = await requestApproval({
        type: 'exam_results', title: `Publish results — ${exam.examType} · ${tmClassLabel(exam)}`, description: exam.term || '',
        effects: {
          on_create:  [{ key: 'em_exams', op: 'patch', id: exam.id, set: { status: 'In Review' } }],
          on_approve: [{ key: 'em_exams', op: 'patch', id: exam.id, set: { status: 'Published' } }],
          on_reject:  [{ key: 'em_exams', op: 'patch', id: exam.id, set: { status: 'Draft' } }],
        },
      });
      if (ok) { toast('Sent for review.'); renderView(); }
    };
  }
}
