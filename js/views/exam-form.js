'use strict';
/* views/exam-form.js — the Add / Edit Exam form.
   Pickers instead of free text: exam name, grade (one grade or ALL grades), stream (one or ALL),
   academic year (defaults to the current one), term (follows the chosen year, defaults to the current term),
   exam start date and end date from the calendar, marks-entry switch, and status.
   "All grades" saves one exam per grade, because results, marks entry and report cards all work per grade. */

const EXAM_TYPES = ['CAT', 'Mid Term Exam', 'End Term Exam'];
const EXAM_STATUSES = ['Draft', 'Scheduled', 'Ongoing', 'Completed', 'In Review', 'Published'];

function examYears(){
  const set = new Set((DB.years || []).map(y => yearOf(y)));
  const cur = (DB.years || []).find(y => yesNo(y.current) === 'Yes');
  const rt = typeof realCurrentTerm === 'function' ? realCurrentTerm() : null;
  const curYear = cur ? yearOf(cur) : (rt && rt.year ? String(rt.year) : String(new Date().getFullYear()));
  set.add(curYear);
  return { list: Array.from(set).sort(), current: curYear };
}
function examTermsFor(year){
  let names = (DB.terms || []).filter(t => String(t.year || '') === year || String(t.name || '').includes(year)).map(t => t.name);
  if (!names.length) names = [1, 2, 3].map(n => `Term ${n}, ${year}`);
  return names;
}
function examStreamsFor(grade){
  const fromClasses = (DB.classes || []).filter(c => c.stream && (!grade || c.grade === grade)).map(c => c.stream);
  const src = fromClasses.length ? fromClasses : (DB.students || []).filter(s => s.stream && (!grade || s.grade === grade)).map(s => s.stream);
  return Array.from(new Set(src)).sort();
}

function openExamForm(rec, onDone){
  const isNew = !rec;
  const yrs = examYears();
  const rt = typeof realCurrentTerm === 'function' ? realCurrentTerm() : null;
  const d = rec ? Object.assign({}, rec) : {
    examType: EXAM_TYPES[0], grade: '__all', stream: '', academicYear: yrs.current,
    term: (rt && examTermsFor(yrs.current).includes(rt.name)) ? rt.name : examTermsFor(yrs.current)[0],
    examDate: '', endDate: '', open: 'No', status: 'Draft',
  };
  if (!d.academicYear) d.academicYear = yrs.current;
  const grades = distinctGrades().sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const yearList = Array.from(new Set(yrs.list.concat([String(d.academicYear)]))).sort();
  const opt = (v, label, sel) => `<option value="${esc(v)}" ${String(sel) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
  const statusList = EXAM_STATUSES.includes(d.status) ? EXAM_STATUSES : EXAM_STATUSES.concat([d.status]);

  const body = `<div class="form-grid">
    <label>Exam Name</label><select id="exType">${EXAM_TYPES.map(t => opt(t, t, d.examType)).join('')}</select>
    <label>Grade</label><select id="exGrade">${isNew ? opt('__all', 'All grades', d.grade) : ''}${grades.map(g => opt(g, g, d.grade)).join('')}</select>
    <label>Stream</label><select id="exStream"></select>
    <label>Academic Year</label><select id="exYear">${yearList.map(y => opt(y, y + (y === yrs.current ? ' (current)' : ''), d.academicYear)).join('')}</select>
    <label>Term</label><select id="exTerm"></select>
    <label>Exam Date (starts)</label><input type="date" id="exDate" value="${esc(d.examDate || '')}">
    <label>Exam End Date</label><input type="date" id="exEnd" value="${esc(d.endDate || '')}">
    <label>Open for marks entry?</label><select id="exOpen">${opt('No', 'No', yesNo(d.open))}${opt('Yes', 'Yes', yesNo(d.open))}</select>
    <label>Status</label><select id="exStatus">${statusList.map(s => opt(s, s, d.status)).join('')}</select>
  </div>
  <p class="muted" style="font-size:12.5px;margin:10px 0 0">${isNew ? 'Choosing <b>All grades</b> creates one exam for every grade. ' : ''}For a one-day exam, set the end date equal to the exam date.</p>`;

  openModal(isNew ? 'Add — Exam' : 'Edit — Exam', body, async () => {
    const type = $('exType').value, gradeSel = $('exGrade').value, stream = $('exStream').value;
    const year = $('exYear').value, term = $('exTerm').value;
    const date = $('exDate').value, end = $('exEnd').value;
    if (!term) { toast('Choose the term.'); return false; }
    if (!date) { toast('Choose the exam date.'); return false; }
    if (!end) { toast('Choose when the exam ends.'); return false; }
    if (end < date) { toast('The end date cannot be before the exam date.'); return false; }
    const common = { examType: type, academicYear: year, term, examDate: date, endDate: end, open: $('exOpen').value, status: $('exStatus').value };

    if (!isNew) {
      Object.assign(DB.exams.find(r => r.id === rec.id), common, { grade: gradeSel, stream });
      if (!(await persist('exams'))) return false;
      toast('Saved.'); onDone && onDone(); return true;
    }
    const targets = gradeSel === '__all' ? grades : [gradeSel];
    if (!targets.length) { toast('There are no grades yet — add classes or learners first.'); return false; }
    const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    let made = 0, dup = 0;
    targets.forEach(g => {
      // A specific stream only applies to grades that actually have that stream.
      if (stream && gradeSel === '__all' && examStreamsFor(g).length && !examStreamsFor(g).includes(stream)) return;
      if ((DB.exams || []).some(e => same(e.grade, g) && same(e.stream, stream) && same(e.examType, type) && same(e.term, term))) { dup++; return; }
      DB.exams.push(Object.assign({ id: uid('exm'), grade: g, stream }, common));
      made++;
    });
    if (!made) { toast(dup ? 'That exam already exists for the chosen grade(s) and term.' : 'No grade matched that stream.'); return false; }
    if (!(await persist('exams'))) return false;
    toast(`Saved — ${made} exam${made === 1 ? '' : 's'} created${dup ? `, ${dup} already existed` : ''}.`);
    onDone && onDone(); return true;
  });

  const fillStreams = () => {
    const g = $('exGrade').value, cur = $('exStream').value || d.stream || '';
    const list = examStreamsFor(g === '__all' ? '' : g);
    if (cur && !list.includes(cur)) list.push(cur);
    $('exStream').innerHTML = opt('', 'All streams', cur) + list.map(s => opt(s, 'Stream ' + s, cur)).join('');
  };
  const fillTerms = () => {
    const y = $('exYear').value, cur = $('exTerm').value || d.term || '';
    const list = examTermsFor(y);
    const pick = list.includes(cur) ? cur : ((rt && list.includes(rt.name)) ? rt.name : list[0]);
    $('exTerm').innerHTML = list.map(t => opt(t, t, pick)).join('');
  };
  fillStreams(); fillTerms();
  $('exGrade').onchange = () => { $('exStream').value = ''; fillStreams(); };
  $('exYear').onchange = () => { $('exTerm').value = ''; fillTerms(); };
  // Picking the exam date sets a sensible end date and stops the calendar offering earlier days.
  $('exDate').onchange = () => {
    const v = $('exDate').value;
    $('exEnd').min = v || '';
    if (v && (!$('exEnd').value || $('exEnd').value < v)) $('exEnd').value = v;
  };
  if (d.examDate) $('exEnd').min = d.examDate;
}
