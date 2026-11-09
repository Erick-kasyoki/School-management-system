'use strict';
/* views/results.js — results/marks entry, class overview, and the exam-results approval flow.
   Part of the EraMaster frontend — loaded after core.js. */

/* ---------------- results / marks entry (grade, and — via the exam_results workflow — publish) ---------------- */
const DEFAULT_SUBJECTS = ['Mathematics', 'English', 'Kiswahili', 'Science', 'Agriculture', 'Social Studies', 'C.R.E', 'Creative Arts'];
function subjectsForGrade(grade){
  const subs = (DB.allocations || []).filter(a => a.grade === grade).map(a => a.subject);
  const uniq = Array.from(new Set(subs));
  return uniq.length ? uniq : DEFAULT_SUBJECTS;
}
let RESULTS_EXAM_ID = null;
// A subject's mark cell holds up to four raw inputs (CAT 1, CAT 2, Mid/End Term,
// Exam Marks) plus the computed average/grade and the date it was entered.
// Older seed data stored a single number per subject — normalize that into the
// same shape (as the "exam marks" component) so old records still display.
function normalizeMarkCell(raw){
  if (raw && typeof raw === 'object') return Object.assign({ cat1: '', cat2: '', midEnd: '', examMarks: '', average: '', gradeCode: '', entryDate: '' }, raw);
  if (raw === 0 || raw) return { cat1: '', cat2: '', midEnd: '', examMarks: raw, average: raw, gradeCode: gradeBand(Number(raw)).code, entryDate: '' };
  return { cat1: '', cat2: '', midEnd: '', examMarks: '', average: '', gradeCode: '', entryDate: '' };
}
function computeCellAverage(cell){
  const parts = [cell.cat1, cell.cat2, cell.midEnd, cell.examMarks].filter(v => v !== '' && v != null && !isNaN(Number(v))).map(Number);
  return parts.length ? Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 10) / 10 : null;
}
const APPROVAL_STATUS_LABEL = { Draft: 'Draft', 'In Review': 'Pending Approval', Published: 'Approved' };

/* ---------------- Results Management (class overview) ----------------
   Landing page for the Results nav item: a class-by-class overview with
   Enter/View/Reports actions, sitting on top of the existing exam-driven
   marks-entry grid (renderResults) which still does the actual entry work. */
let RESULTS_VIEW_MODE = 'overview'; // 'overview' | 'entry'
const GES_GRADE_BANDS = [
  ['A1', '80–100'], ['B2', '70–79'], ['B3', '65–69'], ['C4', '60–64'], ['C5', '55–59'],
  ['C6', '50–54'], ['D7', '45–49'], ['E8', '40–44'], ['F9', '0–39'],
];
function renderResultsManagement(el){
  if (RESULTS_VIEW_MODE === 'entry') { renderResultsEntryScreen(el); return; }
  renderResultsOverview(el);
}
function goToResultsEntry(el, examId, after){
  RESULTS_VIEW_MODE = 'entry';
  if (examId) RESULTS_EXAM_ID = examId;
  renderResultsEntryScreen(el, after);
}
function renderResultsEntryScreen(el, after){
  el.innerHTML = `<button class="btn ghost" id="resBack" style="margin-bottom:14px">← Back to Results Overview</button><div id="resEntryBody"></div>`;
  $('resBack').onclick = () => { RESULTS_VIEW_MODE = 'overview'; renderResultsManagement(el); };
  renderResults($('resEntryBody'));
  if (after) after();
}
// A student "has results" for a class if any subject cell has at least one
// component filled in, across any exam for that grade/stream.
function studentsWithResultsCount(cls){
  const exams = (DB.exams || []).filter(x => x.grade === cls.grade && (!x.stream || !cls.stream || x.stream === cls.stream));
  const ids = new Set();
  exams.forEach(ex => {
    const m = (DB.marks || {})[ex.id] || {};
    Object.keys(m).forEach(sid => {
      const hasAny = Object.values(m[sid] || {}).some(cell => {
        const c = normalizeMarkCell(cell);
        return c.cat1 !== '' || c.cat2 !== '' || c.midEnd !== '' || c.examMarks !== '';
      });
      if (hasAny) ids.add(sid);
    });
  });
  return ids.size;
}
function firstExamForClass(cls){
  return (DB.exams || []).find(x => x.grade === cls.grade && (!x.stream || !cls.stream || x.stream === cls.stream)) || null;
}
function renderResultsOverview(el){
  const canEnter = can('marks.enter');
  const classes = DB.classes || [];
  const curTerm = (DB.terms || []).find(t => t.current);
  el.innerHTML = `
    <p class="crumb">Home <span>›</span> Results</p>
    <div class="tt-page-head">
      <div><h2>Results Management</h2><p>${esc((curTerm && curTerm.year) || '')}${curTerm ? ' — ' + esc(curTerm.name) : ''}</p></div>
      ${curTerm ? `<span class="tt-term-badge">${esc(curTerm.name)}</span>` : ''}
    </div>
    <div class="res-hero-actions">
      ${canEnter ? `<button class="btn primary" id="resHeroEnter">✎ Enter Results</button>` : ''}
      ${canEnter ? `<button class="btn amber-solid" id="resHeroSba">📋 SBA Assessments</button>` : ''}
      <button class="btn outline-dark" id="resHeroCompute">▦ Compute Grades</button>
    </div>
    <div class="res-formula-card">
      <b>GES Grading</b> — Final Score: Continuous Assessment (CA, 50%) + Exam (50%). CA consists of: Project, Group Work, Test 1, Test 2 — scored out of 100 marks and scaled to 50.<br>
      Grade boundaries: ${GES_GRADE_BANDS.map(([code, range]) => `${code} (${range})`).join(', ')}.
    </div>
    <p class="mgmt-section-title">Classes – Results Overview (Current Term)</p>
    <div class="lrn-table-wrap"><table class="lrn-table"><thead><tr>
      <th>Class</th><th>Level</th><th>Students with Results</th><th></th>
    </tr></thead><tbody id="resOverviewBody"></tbody></table></div>`;

  $('resOverviewBody').innerHTML = classes.length ? classes.map(c => {
    const n = studentsWithResultsCount(c);
    const label = c.grade + (c.stream ? ' ' + c.stream : '');
    return `<tr>
      <td><b>${esc(label)}</b></td>
      <td>${esc(c.grade)}</td>
      <td>${n} student${n === 1 ? '' : 's'}</td>
      <td><div class="res-class-actions">
        ${canEnter ? `<button class="btn primary" data-enter="${esc(c.id)}">✎ Enter</button>` : ''}
        <button class="btn outline-dark" data-view="${esc(c.id)}">👁 View</button>
        <button class="btn amber-solid" data-reports="${esc(c.id)}">📁 Reports</button>
      </div></td>
    </tr>`;
  }).join('') : `<tr><td colspan="4"><div class="empty"><b>No classes set up yet</b>Add a class under Classes first.</div></td></tr>`;

  if (canEnter) $('resHeroEnter').onclick = () => goToResultsEntry(el);
  if (canEnter) $('resHeroSba').onclick = () => {
    toast('Continuous assessment (CAT 1 / CAT 2) marks are entered in the same grid — opening Enter Results.');
    goToResultsEntry(el);
  };
  $('resHeroCompute').onclick = () => showComputeGrades();
  $('resOverviewBody').onclick = (e) => {
    const enterId = e.target.dataset.enter, viewId = e.target.dataset.view, reportsId = e.target.dataset.reports;
    const cls = classes.find(c => String(c.id) === (enterId || viewId || reportsId));
    if (!cls) return;
    const exam = firstExamForClass(cls);
    if (!exam) { toast(`No exam set up yet for ${cls.grade}${cls.stream ? ' ' + cls.stream : ''} — create one under Exams first.`); return; }
    if (enterId) goToResultsEntry(el, exam.id);
    if (viewId) goToResultsEntry(el, exam.id, () => { const t = $('resRegisterToggle'); if (t) t.click(); });
    if (reportsId) goToResultsEntry(el, exam.id, () => { const t = $('resReportCards'); if (t) t.click(); });
  };
}
// Grade-distribution summary for the current exam, computed live from the
// same average/grade logic used on the entry grid — no separate scoring engine.
function showComputeGrades(){
  const exams = DB.exams || [];
  if (!exams.length) { toast('No exams yet — create one under Exams first.'); return; }
  const examId = (RESULTS_EXAM_ID && exams.find(x => x.id === RESULTS_EXAM_ID)) ? RESULTS_EXAM_ID : exams[0].id;
  const exam = exams.find(x => x.id === examId);
  const subjects = subjectsForGrade(exam.grade);
  const marks = (DB.marks || {})[exam.id] || {};
  const counts = {}; GES_GRADE_BANDS.forEach(([code]) => counts[code] = 0);
  let total = 0;
  Object.values(marks).forEach(bySubj => {
    subjects.forEach(sub => {
      const cell = normalizeMarkCell(bySubj[sub]);
      const avg = computeCellAverage(cell);
      if (avg === null) return;
      const g = gradeBand(avg);
      if (counts[g.code] !== undefined) counts[g.code]++; else counts[g.code] = (counts[g.code] || 0) + 1;
      total++;
    });
  });
  const rows = Object.keys(counts).map(code => `<tr><td>${esc(code)}</td><td>${counts[code]}</td></tr>`).join('');
  showInfoModal('Compute Grades — ' + exam.examType + ' · ' + exam.grade + (exam.stream ? ' ' + exam.stream : ''), `
    <p class="muted" style="margin-top:0">Grade distribution across ${total} entered subject mark${total === 1 ? '' : 's'}, using the school's current grading scale.</p>
    <table class="lrn-table"><thead><tr><th>Grade</th><th>Count</th></tr></thead><tbody>${rows}</tbody></table>`);
}
function renderResults(el){
  const exams = DB.exams || [];
  if (!exams.length) { el.innerHTML = '<div class="empty"><b>No exams yet</b>Create one from Exams first, then come back here to enter marks.</div>'; return; }
  if (!RESULTS_EXAM_ID || !exams.find(x => x.id === RESULTS_EXAM_ID)) RESULTS_EXAM_ID = exams[0].id;
  const canEnter = can('marks.enter'), canPrincipalComment = can('marks.approve');
  el.innerHTML = `
    <div class="list-toolbar">
      <select id="resExam">${exams.map(x => `<option value="${esc(x.id)}" ${x.id === RESULTS_EXAM_ID ? 'selected' : ''}>${esc(x.examType)} — ${esc(x.grade)}${x.stream ? ' ' + esc(x.stream) : ''} (${esc(x.term)})</option>`).join('')}</select>
      <span id="resStatusBadge"></span>
      <div class="spacer"></div>
      <button class="btn ghost" id="resRegisterToggle">Marks register view</button>
      <button class="btn ghost" id="resRegisterExport">Export CSV</button>
      <button class="btn ghost" id="resRegisterPdf">Export PDF</button>
      <button class="btn ghost" id="resReportCards">Generate report cards</button>
      ${canEnter ? `<button class="btn ghost" id="resImport">Import marks</button><button class="btn ghost" id="resSave">Save as draft</button><button class="btn primary" id="resSubmit">Submit for review</button>` : ''}
    </div>
    <div id="resGridWrap"></div>`;
  let showRegister = false;
  function gradeGroup(exam){
    return (DB.students || []).filter(s => s.grade === exam.grade && (!exam.stream || s.stream === exam.stream));
  }
  // Flat "one row per student per subject" register — Adm No, Full Name, Class,
  // Stream, Academic Year, Term, Exam Type, Subject, CAT 1, CAT 2, Mid/End Term,
  // Exam Marks, Average, Grade, Remarks, Teacher, Entry Date, Approval Status —
  // built from the same marks/comments data as the entry grid, for
  // viewing/printing/exporting rather than for entry.
  function registerRows(exam){
    const subjects = subjectsForGrade(exam.grade);
    const students = gradeGroup(exam);
    const marks = (DB.marks || {})[exam.id] || {};
    const comments = (DB.comments || {})[exam.id] || {};
    const rows = [];
    students.forEach(s => {
      const m = marks[s.id] || {};
      const remark = (comments[s.id] || {}).teacher || '';
      subjects.forEach(sub => {
        const cell = normalizeMarkCell(m[sub]);
        rows.push({
          admNo: s.admNo, name: s.name, grade: exam.grade, stream: exam.stream || '',
          academicYear: exam.academicYear || '', term: exam.term || '', examType: exam.examType || '',
          subject: sub, cat1: cell.cat1, cat2: cell.cat2, midEnd: cell.midEnd, examMarks: cell.examMarks,
          average: cell.average, gradeLetter: cell.gradeCode, remarks: remark,
          teacherName: (S.user && S.user.name) || '', entryDate: cell.entryDate || '',
          approvalStatus: APPROVAL_STATUS_LABEL[exam.status] || exam.status || 'Draft',
        });
      });
    });
    return rows;
  }
  const REGISTER_COLS = [
    ['admNo', 'Adm No'], ['name', 'Full Name'], ['grade', 'Class/Grade'], ['stream', 'Stream'],
    ['academicYear', 'Academic Year'], ['term', 'Term'], ['examType', 'Exam Type'], ['subject', 'Subject'],
    ['cat1', 'CAT 1'], ['cat2', 'CAT 2'], ['midEnd', 'Mid/End Term'], ['examMarks', 'Exam Marks'],
    ['average', 'Average'], ['gradeLetter', 'Grade'], ['remarks', 'Remarks'], ['teacherName', 'Teacher'],
    ['entryDate', 'Entry Date'], ['approvalStatus', 'Approval Status'],
  ];
  function drawRegister(exam){
    const rows = registerRows(exam);
    $('resGridWrap').innerHTML = rows.length ? `<div class="table-wrap"><table class="tbl"><thead><tr>${REGISTER_COLS.map(c => `<th>${esc(c[1])}</th>`).join('')}</tr></thead><tbody>
      ${rows.map(r => `<tr>${REGISTER_COLS.map(c => `<td>${cellHtml(r[c[0]])}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">No students found for this grade/stream.</div>';
  }

  function draw(){
    const exam = exams.find(x => x.id === $('resExam').value);
    if (!exam) return;
    RESULTS_EXAM_ID = exam.id;
    $('resStatusBadge').innerHTML = badge(exam.status) + ((!can(['exams.manage', 'marks.approve']) && String(exam.open || '').toLowerCase() !== 'yes') ? ' <span class="badge b-amber" title="The exam office has not opened this exam for marks entry">Closed for entry</span>' : '');
    const bypassOpen = can(['exams.manage', 'marks.approve']);
    const notOpen = !bypassOpen && String(exam.open || '').toLowerCase() !== 'yes';
    const locked = exam.status === 'Published' || exam.status === 'In Review' || notOpen;
    if ($('resImport')) $('resImport').style.display = locked ? 'none' : '';
    if ($('resSave')) $('resSave').style.display = (locked || showRegister) ? 'none' : '';
    if ($('resSubmit')) $('resSubmit').style.display = (!showRegister && (!exam.status || exam.status === 'Draft')) ? '' : 'none';
    if (showRegister) { drawRegister(exam); return; }
    const subjects = subjectsForGrade(exam.grade);
    const students = gradeGroup(exam);
    DB.marks[exam.id] = DB.marks[exam.id] || {};
    DB.comments[exam.id] = DB.comments[exam.id] || {};
    const dis = (!canEnter || locked) ? 'disabled' : '';
    const midEndLabel = /mid/i.test(exam.examType || '') ? 'Mid Term' : 'End Term';
    $('resGridWrap').innerHTML = students.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Student</th>${subjects.map(s => `<th>${esc(s)}</th>`).join('')}<th>Teacher comment</th>${canPrincipalComment ? '<th>Principal comment</th>' : ''}</tr></thead><tbody>
      ${students.map(s => {
        const m = DB.marks[exam.id][s.id] || {};
        const c = DB.comments[exam.id][s.id] || {};
        return `<tr data-sid="${esc(s.id)}">
          <td>${nameCell(s.name, s.admNo)}</td>
          ${subjects.map(sub => {
            const cell = normalizeMarkCell(m[sub]);
            return `<td class="mark-cell" data-subject="${esc(sub)}">
              <div class="mark-grid">
                <input class="rf-cat1" title="CAT 1" placeholder="CAT1" value="${esc(cell.cat1)}" ${dis}>
                <input class="rf-cat2" title="CAT 2" placeholder="CAT2" value="${esc(cell.cat2)}" ${dis}>
                <input class="rf-midend" title="${esc(midEndLabel)}" placeholder="${esc(midEndLabel)}" value="${esc(cell.midEnd)}" ${dis}>
                <input class="rf-exam" title="Exam Marks" placeholder="Exam" value="${esc(cell.examMarks)}" ${dis}>
              </div>
              <div class="mark-summary"><span class="rf-avg">${cell.average === '' ? '—' : esc(cell.average)}</span>${cell.gradeCode ? badge(cell.gradeCode) : ''}</div>
            </td>`;
          }).join('')}
          <td><input class="rf-tcomment" value="${esc(c.teacher || '')}" style="width:160px" ${dis}></td>
          ${canPrincipalComment ? `<td><input class="rf-pcomment" value="${esc(c.principal || '')}" style="width:160px"></td>` : ''}
        </tr>`;
      }).join('')}
    </tbody></table></div>` : '<div class="empty">No students found for this grade/stream.</div>';
    // Live-update the average/grade shown under each subject cell as marks are typed,
    // without waiting for Save — purely a display convenience, saved values come from saveMarks().
    $('resGridWrap').querySelectorAll('td.mark-cell').forEach(td => {
      td.addEventListener('input', () => {
        const cell = {
          cat1: td.querySelector('.rf-cat1').value.trim(), cat2: td.querySelector('.rf-cat2').value.trim(),
          midEnd: td.querySelector('.rf-midend').value.trim(), examMarks: td.querySelector('.rf-exam').value.trim(),
        };
        const avg = computeCellAverage(cell);
        td.querySelector('.rf-avg').textContent = avg === null ? '—' : avg;
        const gEl = td.querySelector('.mark-summary .badge');
        if (avg !== null) {
          const g = gradeBand(avg);
          if (gEl) gEl.outerHTML = badge(g.code); else td.querySelector('.mark-summary').insertAdjacentHTML('beforeend', badge(g.code));
        } else if (gEl) { gEl.remove(); }
      });
    });
  }
  draw();
  $('resExam').onchange = draw;
  $('resRegisterToggle').onclick = () => {
    showRegister = !showRegister;
    $('resRegisterToggle').textContent = showRegister ? 'Marks entry view' : 'Marks register view';
    draw();
  };
  $('resRegisterExport').onclick = () => {
    const exam = exams.find(x => x.id === RESULTS_EXAM_ID);
    if (!exam) return;
    const rows = registerRows(exam);
    downloadCsv('marks_register', REGISTER_COLS.map(c => c[1]), rows.map(r => REGISTER_COLS.map(c => r[c[0]])));
  };
  $('resRegisterPdf').onclick = () => {
    const exam = exams.find(x => x.id === RESULTS_EXAM_ID);
    if (!exam) return;
    const rows = registerRows(exam);
    const title = `Marks Register — ${exam.examType} · ${exam.grade}${exam.stream ? ' ' + exam.stream : ''}`;
    const table = `<table><thead><tr>${REGISTER_COLS.map(c => `<th>${esc(c[1])}</th>`).join('')}</tr></thead><tbody>
      ${rows.map(r => `<tr>${REGISTER_COLS.map(c => `<td>${esc(r[c[0]] == null ? '' : r[c[0]])}</td>`).join('')}</tr>`).join('')}
    </tbody></table>`;
    printHtml(title, letterhead(title) + table);
  };
  $('resReportCards').onclick = () => {
    const exam = exams.find(x => x.id === RESULTS_EXAM_ID);
    if (!exam) return;
    const students = gradeGroup(exam);
    if (!students.length) { toast('No students found for this grade/stream.'); return; }
    const subjects = subjectsForGrade(exam.grade);
    const marks = (DB.marks || {})[exam.id] || {};
    const comments = (DB.comments || {})[exam.id] || {};
    const cards = students.map((s, i) => {
      const m = marks[s.id] || {};
      const c = comments[s.id] || {};
      const subjRows = subjects.map(sub => { const cell = normalizeMarkCell(m[sub]); return { sub, cell }; });
      const avgVals = subjRows.map(r => r.cell.average).filter(v => v !== '' && v != null);
      const overallAvg = avgVals.length ? Math.round((avgVals.reduce((a, b) => a + Number(b), 0) / avgVals.length) * 10) / 10 : null;
      const overallGrade = overallAvg !== null ? gradeBand(overallAvg) : null;
      return `<div class="hd"><h1>${brandLogoImg(48)}${esc(schoolName())}</h1><h2>Report Card — ${esc(exam.examType)} (${esc(exam.term)})</h2></div>
        <p><b>${esc(s.name)}</b> &nbsp; Adm No: ${esc(s.admNo)} &nbsp; Class: ${esc(exam.grade)}${exam.stream ? ' ' + esc(exam.stream) : ''}</p>
        <table><thead><tr><th>Subject</th><th>CAT 1</th><th>CAT 2</th><th>Mid/End Term</th><th>Exam Marks</th><th>Average</th><th>Grade</th></tr></thead><tbody>
          ${subjRows.map(r => `<tr><td>${esc(r.sub)}</td><td>${esc(r.cell.cat1)}</td><td>${esc(r.cell.cat2)}</td><td>${esc(r.cell.midEnd)}</td><td>${esc(r.cell.examMarks)}</td><td>${esc(r.cell.average)}</td><td>${esc(r.cell.gradeCode)}</td></tr>`).join('')}
          <tr><td><b>Overall</b></td><td></td><td></td><td></td><td></td><td><b>${overallAvg === null ? '—' : overallAvg}</b></td><td><b>${overallGrade ? overallGrade.code : '—'}</b></td></tr>
        </tbody></table>
        <p class="muted">Teacher's comment: ${esc(c.teacher || '—')}</p>
        <p class="muted">Principal's comment: ${esc(c.principal || '—')}</p>
        <p class="muted">Entered by ${esc((S.user && S.user.name) || '')} · ${esc(today())} · Status: ${esc(APPROVAL_STATUS_LABEL[exam.status] || exam.status || 'Draft')}</p>
        <div class="sign"><div>Class Teacher</div><div>Principal</div></div>
        ${i < students.length - 1 ? '<div style="page-break-after:always"></div>' : ''}`;
    }).join('');
    printHtml(`Report Cards — ${exam.examType}`, cards);
  };
  /* ---- import marks from CSV / Excel ---------------------------------------
     Two layouts are understood (headers are matched loosely — case, spaces and
     punctuation don't matter):
       wide: Adm No | Name | Mathematics | English …           (one column per subject = Exam Marks)
             or "Mathematics CAT 1", "Mathematics CAT 2", "Mathematics Mid Term", "Mathematics Exam Marks" …
       long: Adm No | Subject | CAT 1 | CAT 2 | Mid/End Term | Exam Marks   (the Marks Register export)
     An optional "Comment"/"Remarks" column sets the teacher comment. Empty cells
     leave existing marks untouched. */
  const MARK_COMPONENTS = { cat1: ['cat1'], cat2: ['cat2'], midEnd: ['midend', 'midendterm', 'midterm', 'endterm', 'mid', 'end'], examMarks: ['exam', 'exammarks', 'examination', 'mark', 'marks', 'score'] };
  const MARK_INPUT_SEL = { cat1: '.rf-cat1', cat2: '.rf-cat2', midEnd: '.rf-midend', examMarks: '.rf-exam' };
  function markComponent(rest){
    if (rest === '') return 'examMarks';
    return Object.keys(MARK_COMPONENTS).find(k => MARK_COMPONENTS[k].includes(rest)) || null;
  }
  function parseMarksRows(rows, exam){
    const H = normHeader, str = v => v == null ? '' : String(v).trim();
    const subjects = subjectsForGrade(exam.grade);
    const subjNorm = subjects.map(s => [H(s), s]).sort((a, b) => b[0].length - a[0].length);   // longest name first
    const students = gradeGroup(exam);
    const byAdm = {}, byName = {};
    students.forEach(s => { if (s.admNo) byAdm[H(s.admNo)] = s; if (!byName[H(s.name)]) byName[H(s.name)] = s; });
    const headers = Object.keys(rows[0] || {});
    const find = list => headers.find(h => list.includes(H(h)));
    const admH = find(['admno', 'admissionno', 'admissionnumber', 'admission', 'regno', 'adm', 'admnumber']);
    const nameH = find(['name', 'fullname', 'studentname', 'student']);
    const commentH = find(['comment', 'comments', 'teachercomment', 'teacherscomment', 'remarks']);
    const subjH = find(['subject']);
    if (!admH && !nameH) return { fatal: 'Couldn’t find an “Adm No” or “Name” column in the first row of that file.' };
    const special = new Set([admH, nameH, commentH, subjH].filter(Boolean));
    const cols = [], ignored = [];
    headers.forEach(h => {
      if (special.has(h)) return;
      if (subjH) { const comp = markComponent(H(h)); if (comp) cols.push({ header: h, comp }); else ignored.push(h); return; }
      const n = H(h), hit = subjNorm.find(([sn]) => sn && n.startsWith(sn));
      const comp = hit ? markComponent(n.slice(hit[0].length)) : null;
      if (hit && comp) cols.push({ header: h, subject: hit[1], comp }); else ignored.push(h);
    });
    if (!cols.length) return { fatal: subjH ? 'Couldn’t find any mark columns (CAT 1, CAT 2, Mid/End Term, Exam Marks) next to the Subject column.' : `Couldn’t match any column to this class’s subjects (${subjects.join(', ')}). Use “Download template” for the right headings.` };

    const updates = {}, comments = {}, issues = [];
    let cells = 0;
    rows.forEach((raw, i) => {
      const rowNo = i + 2;                                       // +1 for the header row, +1 for 1-based
      if (Object.values(raw).every(v => str(v) === '')) return;
      const adm = admH ? str(raw[admH]) : '', nm = nameH ? str(raw[nameH]) : '';
      const stu = (adm && byAdm[H(adm)]) || (nm && byName[H(nm)]) || null;
      if (!stu) { issues.push(`Row ${rowNo}: ${adm || nm || '(no student)'} isn’t in ${exam.grade}${exam.stream ? ' ' + exam.stream : ''}.`); return; }
      let rowSubject = null;
      if (subjH) {
        const sv = str(raw[subjH]);
        const hit = subjNorm.find(([sn]) => sn === H(sv));
        if (!hit) { issues.push(`Row ${rowNo}: unknown subject “${sv}”.`); return; }
        rowSubject = hit[1];
      }
      cols.forEach(c => {
        const t = str(raw[c.header]).replace(',', '.');
        if (t === '') return;
        const num = Number(t);
        if (isNaN(num) || num < 0 || num > 100) { issues.push(`Row ${rowNo}: “${t}” in ${c.header} isn’t a mark between 0 and 100.`); return; }
        const sub = rowSubject || c.subject;
        const u = updates[stu.id] = updates[stu.id] || {};
        (u[sub] = u[sub] || {})[c.comp] = num;
        cells++;
      });
      if (commentH && str(raw[commentH])) comments[stu.id] = str(raw[commentH]);
    });
    return { updates, comments, cells, students: Object.keys(updates).length, issues, ignored };
  }
  async function readSheetRows(file){
    if (typeof XLSX === 'undefined') { toast('Import needs an internet connection the first time (to load the reader library).'); return null; }
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    } catch (err) { toast('Could not read that file — is it a valid CSV/Excel file?'); return null; }
  }
  // Puts the parsed values into the entry grid (so the live averages/grades update), then saves the draft.
  async function applyMarksImport(parsed){
    if (showRegister) {                                 // only re-draw when leaving the register view, so unsaved typing isn't wiped
      showRegister = false;
      $('resRegisterToggle').textContent = 'Marks register view';
      draw();
    }
    $('resGridWrap').querySelectorAll('tr[data-sid]').forEach(tr => {
      const u = parsed.updates[tr.dataset.sid], cm = parsed.comments[tr.dataset.sid];
      if (u) tr.querySelectorAll('td.mark-cell').forEach(td => {
        const cu = u[td.dataset.subject];
        if (!cu) return;
        Object.keys(cu).forEach(k => { const inp = td.querySelector(MARK_INPUT_SEL[k]); if (inp) inp.value = cu[k]; });
        td.querySelector('.rf-cat1').dispatchEvent(new Event('input', { bubbles: true }));
        td.style.background = 'var(--g-50)';
      });
      if (cm) { const t = tr.querySelector('.rf-tcomment'); if (t) t.value = cm; }
    });
    return saveMarks();
  }
  function openMarksImport(){
    const exam = exams.find(x => x.id === RESULTS_EXAM_ID);
    if (!exam) return;
    if (exam.status === 'Published' || exam.status === 'In Review') { toast('These results are already submitted — marks can’t be imported now.'); return; }
    const subjects = subjectsForGrade(exam.grade), label = `${exam.examType} · ${exam.grade}${exam.stream ? ' ' + exam.stream : ''}`;
    const midEndLabel = /mid/i.test(exam.examType || '') ? 'Mid Term' : 'End Term';
    let parsed = null;
    const body = `<p class="muted" style="font-size:12.5px;margin:0 0 10px">Import marks for <b>${esc(label)}</b> from a CSV or Excel file. Students are matched by <b>Adm No</b> (or name). Use one column per subject, or one row per student per subject — <i>Download template</i> gives you a file already filled with this class’s students. Empty cells leave existing marks as they are.</p>
      <div class="form-grid"><label>Template for</label><select id="impTplSubj"><option value="">All subjects</option>${subjects.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0"><button class="btn ghost" id="impTpl" type="button">Download template</button><input type="file" id="impFile" accept=".xlsx,.xls,.csv"></div>
      <div id="impPreview" style="font-size:13px"></div>`;
    openModal('Import marks', body, async () => {
      if (!parsed || (!parsed.cells && !Object.keys(parsed.comments).length)) { toast('Choose a file with at least one valid mark first.'); return false; }
      const ok = await applyMarksImport(parsed);
      if (ok) toast(`Imported ${parsed.cells} mark${parsed.cells === 1 ? '' : 's'} for ${parsed.students} student${parsed.students === 1 ? '' : 's'} — saved as draft. Review, then “Submit for review”.`);
      return ok;
    }, { wide: true, saveLabel: 'Import & save as draft' });
    $('impTpl').onclick = () => {
      const only = $('impTplSubj').value, chosen = only ? [only] : subjects;
      const marks = (DB.marks || {})[exam.id] || {};
      const head = ['Adm No', 'Name'].concat(chosen.reduce((a, s) => a.concat([`${s} CAT 1`, `${s} CAT 2`, `${s} ${midEndLabel}`, `${s} Exam Marks`]), []));
      const rows = gradeGroup(exam).map(s => [s.admNo, s.name].concat(chosen.reduce((a, sub) => { const c = normalizeMarkCell((marks[s.id] || {})[sub]); return a.concat([c.cat1, c.cat2, c.midEnd, c.examMarks]); }, [])));
      downloadCsv(`marks_template_${exam.grade}${exam.stream ? '_' + exam.stream : ''}_${exam.examType}`, head, rows);
    };
    $('impFile').onchange = async () => {
      parsed = null;
      const box = $('impPreview'), f = $('impFile').files[0];
      if (!f) { box.innerHTML = ''; return; }
      const rows = await readSheetRows(f);
      if (!rows) return;
      if (!rows.length) { box.innerHTML = '<span style="color:var(--rose)">That file has no rows.</span>'; return; }
      const r = parseMarksRows(rows, exam);
      if (r.fatal) { box.innerHTML = `<span style="color:var(--rose)">${esc(r.fatal)}</span>`; return; }
      parsed = r;
      box.innerHTML = `<div><b>${r.cells}</b> mark${r.cells === 1 ? '' : 's'} for <b>${r.students}</b> student${r.students === 1 ? '' : 's'} ready to import.</div>
        ${r.ignored.length ? `<div class="muted" style="margin-top:4px">Ignored columns: ${esc(r.ignored.join(', '))}</div>` : ''}
        ${r.issues.length ? `<div style="margin-top:8px;color:var(--rose)"><b>${r.issues.length} problem${r.issues.length === 1 ? '' : 's'} (those cells are skipped):</b><br>${r.issues.slice(0, 8).map(esc).join('<br>')}${r.issues.length > 8 ? `<br>…and ${r.issues.length - 8} more` : ''}</div>` : ''}`;
    };
  }
  if (canEnter) $('resImport').onclick = openMarksImport;
  async function saveMarks(){
    const exam = exams.find(x => x.id === RESULTS_EXAM_ID);
    if (!exam) return false;
    // Every filled box must be a number from 0 to 100 — otherwise stop and point at the first bad one.
    let badInput = null;
    $('resGridWrap').querySelectorAll('.rf-cat1, .rf-cat2, .rf-midend, .rf-exam').forEach(inp => {
      inp.style.outline = '';
      const v = inp.value.trim();
      if (v === '') return;
      const n = Number(v);
      if (isNaN(n) || n < 0 || n > 100) { inp.style.outline = '2px solid var(--rose)'; badInput = badInput || inp; }
    });
    if (badInput) { toast('Marks must be numbers from 0 to 100 — check the highlighted box.'); badInput.scrollIntoView({ block: 'center' }); return false; }
    $('resGridWrap').querySelectorAll('tr[data-sid]').forEach(tr => {
      const sid = tr.dataset.sid, subjectMarks = {};
      tr.querySelectorAll('td.mark-cell').forEach(td => {
        const sub = td.dataset.subject;
        const cell = {
          cat1: td.querySelector('.rf-cat1').value.trim(), cat2: td.querySelector('.rf-cat2').value.trim(),
          midEnd: td.querySelector('.rf-midend').value.trim(), examMarks: td.querySelector('.rf-exam').value.trim(),
        };
        const hasAny = cell.cat1 !== '' || cell.cat2 !== '' || cell.midEnd !== '' || cell.examMarks !== '';
        const avg = computeCellAverage(cell);
        subjectMarks[sub] = {
          cat1: cell.cat1 === '' ? '' : Number(cell.cat1), cat2: cell.cat2 === '' ? '' : Number(cell.cat2),
          midEnd: cell.midEnd === '' ? '' : Number(cell.midEnd), examMarks: cell.examMarks === '' ? '' : Number(cell.examMarks),
          average: avg === null ? '' : avg, gradeCode: avg === null ? '' : gradeBand(avg).code,
          entryDate: hasAny ? today() : '',
        };
      });
      DB.marks[exam.id][sid] = subjectMarks;
      const tEl = tr.querySelector('.rf-tcomment'), pEl = tr.querySelector('.rf-pcomment');
      const prev = DB.comments[exam.id][sid] || {};
      DB.comments[exam.id][sid] = { teacher: tEl ? tEl.value.trim() : (prev.teacher || ''), principal: pEl ? pEl.value.trim() : (prev.principal || '') };
    });
    return persist('marks', 'comments');
  }
  if (canEnter) {
    $('resSave').onclick = async () => { if (await saveMarks()) toast('Marks saved as draft.'); };
    $('resSubmit').onclick = async () => {
      const exam = exams.find(x => x.id === RESULTS_EXAM_ID);
      if (!exam) return;
      if (!(await saveMarks())) return;
      const ok = await requestApproval({
        type: 'exam_results',
        title: `Publish results — ${exam.examType} · ${exam.grade}${exam.stream ? ' ' + exam.stream : ''}`,
        description: exam.term || '',
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

