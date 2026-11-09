'use strict';
/* views/reports.js — report cards and bulk report generation.
   Part of the EraMaster frontend — loaded after core.js. */

/* ---------------- Reports ---------------- */
let REPORT_TERM = null, REPORT_GRADE = '', REPORT_STUDENT = '', REPORT_BULK_GRADE = '';
function reportExamFor(grade, stream, termName){
  const exams = (DB.exams || []).filter(e => e.grade === grade && (!stream || e.stream === stream) && (!termName || e.term === termName));
  return exams.find(e => e.status === 'Published') || exams.slice().sort((a, b) => String(b.examDate || '').localeCompare(String(a.examDate || '')))[0] || null;
}
function reportCardHtml(student, grade, stream, exam){
  const subjects = subjectsForGrade(grade);
  const marks = exam ? ((DB.marks || {})[exam.id] || {}) : {};
  const comments = exam ? ((DB.comments || {})[exam.id] || {}) : {};
  const m = marks[student.id] || {};
  const c = comments[student.id] || {};
  const subjRows = subjects.map(sub => { const cell = normalizeMarkCell(m[sub]); return { sub, cell }; });
  const avgVals = subjRows.map(r => r.cell.average).filter(v => v !== '' && v != null);
  const overallAvg = avgVals.length ? Math.round((avgVals.reduce((a, b) => a + Number(b), 0) / avgVals.length) * 10) / 10 : null;
  const overallGrade = overallAvg !== null ? gradeBand(overallAvg) : null;
  return `<div class="hd"><h1>${esc(schoolName())}</h1><h2>Report Card${exam ? ' — ' + esc(exam.examType) : ''} (${esc((exam && exam.term) || termHeaderLabel())})</h2></div>
    <p><b>${esc(student.name)}</b> &nbsp; Adm No: ${esc(student.admNo)} &nbsp; Class: ${esc(grade)}${stream ? ' ' + esc(stream) : ''}</p>
    <table><thead><tr><th>Subject</th><th>CAT 1</th><th>CAT 2</th><th>Mid/End Term</th><th>Exam Marks</th><th>Average</th><th>Grade</th></tr></thead><tbody>
      ${subjRows.map(r => `<tr><td>${esc(r.sub)}</td><td>${esc(r.cell.cat1)}</td><td>${esc(r.cell.cat2)}</td><td>${esc(r.cell.midEnd)}</td><td>${esc(r.cell.examMarks)}</td><td>${esc(r.cell.average)}</td><td>${esc(r.cell.gradeCode)}</td></tr>`).join('')}
      <tr><td><b>Overall</b></td><td></td><td></td><td></td><td></td><td><b>${overallAvg === null ? '—' : overallAvg}</b></td><td><b>${overallGrade ? overallGrade.code : '—'}</b></td></tr>
    </tbody></table>
    <p class="muted">Teacher's comment: ${esc(c.teacher || '—')}</p>
    <p class="muted">Principal's comment: ${esc(c.principal || '—')}</p>
    <p class="muted">Printed by ${esc((S.user && S.user.name) || '')} · ${esc(today())}</p>
    <div class="sign"><div>Class Teacher</div><div>Principal</div></div>`;
}
function renderReports(el){
  const term = currentTerm();
  const classes = DB.classes || [];
  el.innerHTML = `
    <p class="crumb">🏠 Home <span>›</span> Reports</p>
    <div class="tt-page-head">
      <div><h2>Reports</h2><p>${esc(termHeaderLabel())}</p></div>
      ${term ? `<span class="tt-term-badge">${esc(term.name)}</span>` : ''}
    </div>
    <div class="report-tiles">
      <div class="report-tile" id="repAcademic"><div class="icon">📊</div><b>Academic Summary</b><span>Performance overview by class</span></div>
      <div class="report-tile" id="repFees"><div class="icon">🧾</div><b>Fees Report</b><span>Collection and outstanding</span></div>
      <div class="report-tile" id="repAttendance"><div class="icon">🗓️</div><b>Attendance Report</b><span>By class and term</span></div>
    </div>
    <div class="dash-grid">
      <div class="card panel">
        <h3>Generate Individual Report Card</h3>
        <label>Select Class</label>
        <select id="repClass"><option value="">— Select —</option>${classes.map(c => `<option value="${esc(classLabel(c))}">${esc(classLabel(c))}</option>`).join('')}</select>
        <label>Select Student</label>
        <select id="repStudent"><option value="">— Select —</option></select>
        <label>Select Term</label>
        <select id="repTerm">${(DB.terms || []).map(t => `<option value="${esc(t.name)}" ${t.current ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
        <div style="display:flex;gap:10px;margin-top:16px">
          <button class="btn ghost" id="repPreview" style="flex:1">Preview</button>
          <button class="btn primary" id="repGenerate" style="flex:1">Generate PDF</button>
        </div>
      </div>
      <div class="card panel">
        <h3>Bulk Generate (Entire Class)</h3>
        <label>Class</label>
        <select id="repBulkClass"><option value="">— Select Class —</option>${classes.map(c => `<option value="${esc(classLabel(c))}">${esc(classLabel(c))}</option>`).join('')}</select>
        <label>Term</label>
        <select id="repBulkTerm">${(DB.terms || []).map(t => `<option value="${esc(t.name)}" ${t.current ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
        <button class="btn primary" id="repBulkGenerate" style="margin-top:16px;width:100%">📥 Generate All</button>
      </div>
    </div>`;

  function classFromLabel(label){ return classes.find(c => classLabel(c) === label) || null; }
  function fillStudents(){
    const cls = classFromLabel($('repClass').value);
    const list = cls ? (DB.students || []).filter(s => s.grade === cls.grade && (!cls.stream || s.stream === cls.stream)) : [];
    $('repStudent').innerHTML = '<option value="">— Select —</option>' + list.map(s => `<option value="${esc(s.id)}">${esc(s.name)} · ${esc(s.admNo || '—')}</option>`).join('');
  }
  $('repClass').onchange = fillStudents;

  function buildIndividualHtml(){
    const cls = classFromLabel($('repClass').value);
    const student = (DB.students || []).find(s => s.id === $('repStudent').value);
    const termName = $('repTerm').value;
    if (!cls || !student) { toast('Select a class and a student first.'); return null; }
    const exam = reportExamFor(cls.grade, cls.stream, termName);
    return reportCardHtml(student, cls.grade, cls.stream, exam);
  }
  $('repPreview').onclick = () => { const html = buildIndividualHtml(); if (html) printHtml('Report Card Preview', html, false); };
  $('repGenerate').onclick = () => { const html = buildIndividualHtml(); if (html) printHtml('Report Card', html, true); };

  $('repBulkGenerate').onclick = () => {
    const cls = classFromLabel($('repBulkClass').value);
    const termName = $('repBulkTerm').value;
    if (!cls) { toast('Select a class first.'); return; }
    const students = (DB.students || []).filter(s => s.grade === cls.grade && (!cls.stream || s.stream === cls.stream));
    if (!students.length) { toast('No students found in that class.'); return; }
    const exam = reportExamFor(cls.grade, cls.stream, termName);
    const html = students.map((s, i) => reportCardHtml(s, cls.grade, cls.stream, exam) + (i < students.length - 1 ? '<div style="page-break-after:always"></div>' : '')).join('');
    printHtml(`Report Cards — ${classLabel(cls)}`, html, true);
  };

  $('repAcademic').onclick = () => goTo('results');
  $('repFees').onclick = () => goTo('fees');
  $('repAttendance').onclick = () => goTo('attendance');
}

