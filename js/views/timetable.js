'use strict';
/* views/timetable.js — timetable auto-generation and the editable weekly grid.
   Part of the EraMaster frontend — loaded after core.js. */

/* ---------------- timetable: auto-generate + editable grid ----------------
   Generation reads "subjects taught in the school" from Subject Allocations
   (grade, subject, teacher, lessons/week) and fills a Mon–Fri grid per class.
   The grid follows the school day in TT_SCHEDULE: rows are shown by time and lesson
   (Lesson 1–9), with assembly, break, lunch, games and revision as fixed bands.
   The generator:
     • never puts a teacher in two classes at the same day/period,
     • spreads each subject across the week (no more than ceil(lessons/5) per
       day, and it avoids back-to-back repeats where it can),
     • keeps each class's day compact (no gaps unless a teacher clash forces one),
     • tries many randomised layouts and keeps the one that places the most lessons.
   Editing: click a slot to change it (clashes are blocked unless you allow
   them), or drag a lesson onto another slot to move / swap it. "By teacher"
   shows any teacher's week; staff without timetable.manage open on their own
   timetable, read-only. Editing and (re)generating are gated on
   canWrite('timetable') — the 'timetable.manage' permission. */
const TT_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
let TIMETABLE_CLASS_ID = null, TIMETABLE_TEACHER_ID = null, TIMETABLE_MODE = 'class', TIMETABLE_LIST_VIEW = false, TT_MODE_INIT = false;
let TT_UNDO = null;      // snapshot of the timetable taken just before the last (re)generation

/* The school day, top to bottom. Rows with a `lesson` number are teaching slots (stored in
   the data as period = lesson number); every other row is a fixed part of the day that is
   shown across the whole week and is never scheduled or edited. */
const TT_SCHEDULE = [
  { start: '8:00',  end: '8:20',  label: 'Assembly / Morning Parade' },
  { start: '8:20',  end: '9:00',  lesson: 1 },
  { start: '9:00',  end: '9:40',  lesson: 2 },
  { start: '9:40',  end: '10:20', lesson: 3 },
  { start: '10:20', end: '10:40', label: 'Break' },
  { start: '10:40', end: '11:20', lesson: 4 },
  { start: '11:20', end: '12:00', lesson: 5 },
  { start: '12:00', end: '12:40', lesson: 6 },
  { start: '12:40', end: '1:40',  label: 'Lunch Break' },
  { start: '1:40',  end: '2:20',  lesson: 7 },
  { start: '2:20',  end: '3:00',  lesson: 8 },
  { start: '3:00',  end: '3:40',  lesson: 9 },
  { start: '3:40',  end: '4:20',  label: 'Games / Creative Activities' },
  { start: '4:20',  end: '5:00',  label: 'Revision / Class Duties / Departure' },
];
const TT_LESSONS = TT_SCHEDULE.filter(r => r.lesson).length;   // 9 lessons a day

/*TT-PURE-START*/
function ttClassKey(c){ return c.grade + '|' + (c.stream || ''); }
function ttEntryClassKey(t){ return t.grade + '|' + (t.stream || ''); }
function ttSlotKey(day, period){ return day + '|' + period; }

// Does putting `cand` (a lesson) in its day/period double-book a teacher or a room
// used by ANOTHER class? Entries of the candidate's own class are ignored — that
// is the slot being replaced/swapped.
function ttClashFor(entries, cand, ignoreId){
  const res = { teacher: null, room: null };
  entries.forEach(t => {
    if (ignoreId && t.id === ignoreId) return;
    if (t.day !== cand.day || String(t.period) !== String(cand.period)) return;
    if (t.kind && t.kind !== 'Lesson') return;
    if (ttEntryClassKey(t) === ttEntryClassKey(cand)) return;
    if (cand.teacherId && t.teacherId === cand.teacherId) res.teacher = t;
    if (cand.room && t.room && String(t.room).toLowerCase() === String(cand.room).toLowerCase()) res.room = t;
  });
  return res;
}
// Every (teacher, day, period) that currently has two or more lessons.
function ttFindClashes(entries){
  const seen = {};
  entries.forEach(t => {
    if (!t.teacherId || (t.kind && t.kind !== 'Lesson')) return;
    const k = t.teacherId + '|' + t.day + '|' + t.period;
    (seen[k] = seen[k] || []).push(t);
  });
  return Object.keys(seen).filter(k => seen[k].length > 1).map(k => seen[k]);
}
// Lessons still to place for one class: what the allocations ask for, minus what is already scheduled.
function ttLessonsNeeded(cls, allocations, existing){
  const placed = {};
  existing.forEach(t => { placed[t.subject] = (placed[t.subject] || 0) + 1; });
  const out = [];
  allocations.filter(a => a.grade === cls.grade).forEach(a => {
    const want = Number(a.periods) || 1;
    const have = Math.min(placed[a.subject] || 0, want);
    placed[a.subject] = (placed[a.subject] || 0) - have;
    if (want - have > 0) out.push({ subject: a.subject, teacherId: a.teacherId || '', count: want - have });
  });
  return out;
}
function ttPlanOnce(classes, allocations, kept, days, periods){
  const busyT = {}, classSlot = {}, dayLoad = {}, subjDay = {}, teachDay = {};
  const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const reg = t => {
    const ck = ttEntryClassKey(t), sk = ttSlotKey(t.day, t.period);
    if (t.teacherId) { (busyT[sk] = busyT[sk] || new Set()).add(t.teacherId); inc(teachDay, t.teacherId + '|' + t.day); }
    classSlot[ck + '|' + sk] = t.subject;
    inc(dayLoad, ck + '|' + t.day);
    inc(subjDay, ck + '|' + t.subject + '|' + t.day);
  };
  kept.forEach(reg);

  const jobs = [], capOf = {}, teacherLoad = {};
  classes.forEach(cls => {
    const ck = ttClassKey(cls);
    const existing = kept.filter(t => ttEntryClassKey(t) === ck);
    const totals = {};
    allocations.filter(a => a.grade === cls.grade).forEach(a => { totals[a.subject] = (totals[a.subject] || 0) + (Number(a.periods) || 1); });
    Object.keys(totals).forEach(s => { capOf[ck + '|' + s] = Math.max(1, Math.ceil(totals[s] / days.length)); });
    ttLessonsNeeded(cls, allocations, existing).forEach(n => {
      for (let i = 0; i < n.count; i++) jobs.push({ cls, ck, subject: n.subject, teacherId: n.teacherId });
      if (n.teacherId) teacherLoad[n.teacherId] = (teacherLoad[n.teacherId] || 0) + n.count;
    });
  });
  // Most-constrained first: lessons of the busiest teachers get first pick of the slots.
  jobs.forEach(j => { j.order = (j.teacherId ? teacherLoad[j.teacherId] : 0) + Math.random() * 3; });
  jobs.sort((a, b) => b.order - a.order);

  const entries = [], unplaced = [];
  jobs.forEach(j => {
    let best = null;
    for (let extra = 0; extra <= 1 && !best; extra++) {       // second pass relaxes the per-day subject cap by one
      const cap = (capOf[j.ck + '|' + j.subject] || 1) + extra;
      days.forEach(day => {
        const sd = subjDay[j.ck + '|' + j.subject + '|' + day] || 0;
        if (sd >= cap) return;
        const load = dayLoad[j.ck + '|' + day] || 0;
        const tLoad = j.teacherId ? (teachDay[j.teacherId + '|' + day] || 0) : 0;
        for (let p = 1; p <= periods; p++) {
          const sk = ttSlotKey(day, p);
          if (classSlot[j.ck + '|' + sk] !== undefined) continue;
          if (j.teacherId && busyT[sk] && busyT[sk].has(j.teacherId)) continue;
          let score = sd * 50 + load * 8 + Math.max(0, p - 1 - load) * 6 + (p - 1) * 0.8 + tLoad * 2 + Math.random() * 4;
          if (classSlot[j.ck + '|' + ttSlotKey(day, p - 1)] === j.subject || classSlot[j.ck + '|' + ttSlotKey(day, p + 1)] === j.subject) score += 15;
          if (!best || score < best.score) best = { day, p, score };
        }
      });
    }
    if (!best) { unplaced.push(j); return; }
    const t = { id: uid('tt'), day: best.day, period: String(best.p), kind: 'Lesson', grade: j.cls.grade, stream: j.cls.stream || '', subject: j.subject, teacherId: j.teacherId || '', room: j.cls.room || '' };
    entries.push(t); reg(t);
  });
  return { entries, unplaced };
}
function ttPlan(classes, allocations, kept, days, periods, attempts){
  let best = null;
  for (let i = 0; i < (attempts || 40); i++) {
    const r = ttPlanOnce(classes, allocations, kept, days, periods);
    if (!best || r.unplaced.length < best.unplaced.length) best = r;
    if (!best.unplaced.length) break;
  }
  return best;
}
/*TT-PURE-END*/

function ttClasses(){ return DB.classes || []; }
function ttClassLabel(c){ return c.grade + (c.stream ? ' ' + c.stream : ''); }
function ttEntryLabel(t){ return t.grade + (t.stream ? ' ' + t.stream : ''); }
function ttEntriesFor(cls){ return (DB.timetable || []).filter(t => ttEntryClassKey(t) === ttClassKey(cls)); }
function ttMaxPeriod(entries){
  const nums = entries.map(t => Number(t.period)).filter(n => !isNaN(n) && n > 0);
  return nums.length ? Math.max(TT_LESSONS, ...nums) : TT_LESSONS;
}
function ttSort(a, b){ return TT_DAYS.indexOf(a.day) - TT_DAYS.indexOf(b.day) || Number(a.period) - Number(b.period); }
function ttClashMessage(cl, rec){
  if (cl.teacher) return `${staffName(rec.teacherId)} is already teaching ${ttEntryLabel(cl.teacher)} on ${rec.day}, ${ttLessonText(rec.period)}.`;
  if (cl.room) return `${rec.room} is already used by ${ttEntryLabel(cl.room)} on ${rec.day}, ${ttLessonText(rec.period)}.`;
  return '';
}

function ttHash(s){ let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
const TT_PALETTE = [
  { c: '#3a5bf0', tint: '#e8edff' },  // blue
  { c: '#e0a30e', tint: '#fff7df' },  // yellow
  { c: '#e07a1e', tint: '#fdead9' },  // orange
  { c: '#8b5cf6', tint: '#f1ebfd' },  // purple
  { c: '#0e9488', tint: '#e1f6f2' },  // teal
  { c: '#d9527a', tint: '#fbe7ee' },  // rose
  { c: '#1f9d55', tint: '#e0f5e7' },  // green
  { c: '#657268', tint: '#f2f4f2' },  // slate (plain)
];
function ttSubjectColor(subject){ return TT_PALETTE[ttHash(String(subject || '')) % TT_PALETTE.length]; }
// Time slot of a lesson, read from TT_SCHEDULE (e.g. lesson 1 -> "8:20 – 9:00").
function ttPeriodTime(p){
  const row = TT_SCHEDULE.find(r => r.lesson === Number(p));
  return row ? row.start + ' – ' + row.end : '';
}
function ttRowTime(r){ return r.start + ' – ' + r.end; }
// "8:20 – 9:00 (Lesson 1)" for dialogs, messages and CSV.
function ttLessonText(p){ const t = ttPeriodTime(p); return 'Lesson ' + p + (t ? ' (' + t + ')' : ''); }
function renderTimetable(el){
  const classes = ttClasses(), teachers = DB.teachers || [];
  if (!classes.length) { el.innerHTML = '<div class="empty"><b>No classes yet</b>Add classes first (School Setup → Classes), then set their subject allocations, and come back here to build the timetable.</div>'; return; }
  const writable = canWrite('timetable');   // true only for HOD / Administrator / Super Admin, per the roles config
  const me = myStaff();
  if (!TT_MODE_INIT) { TT_MODE_INIT = true; if (!writable && me) { TIMETABLE_MODE = 'teacher'; TIMETABLE_TEACHER_ID = me.id; } }
  if (!TIMETABLE_CLASS_ID || !classes.find(c => c.id === TIMETABLE_CLASS_ID)) TIMETABLE_CLASS_ID = classes[0].id;
  if (!TIMETABLE_TEACHER_ID || !teachers.find(t => t.id === TIMETABLE_TEACHER_ID)) TIMETABLE_TEACHER_ID = teachers.length ? teachers[0].id : '';
  if (TIMETABLE_MODE === 'teacher' && !teachers.length) TIMETABLE_MODE = 'class';

  const grades = Array.from(new Set(classes.map(c => c.grade)));
  const classesInGrade = g => classes.filter(c => c.grade === g);
  const curTerm = (DB.terms || []).find(t => t.current);
  const initialGrade = (classes.find(c => c.id === TIMETABLE_CLASS_ID) || classes[0]).grade;

  el.innerHTML = `
    <div class="tt-page-head">
      <div><h2>Timetable</h2><p>Auto-generated weekly class schedule</p></div>
      ${curTerm ? `<span class="tt-term-badge">${esc(curTerm.name)}</span>` : ''}
    </div>
    <div class="tt-toolbar">
      <select id="ttMode" style="max-width:118px"><option value="class" ${TIMETABLE_MODE === 'class' ? 'selected' : ''}>By class</option><option value="teacher" ${TIMETABLE_MODE === 'teacher' ? 'selected' : ''}>By teacher</option></select>
      <select id="ttGrade">${grades.map(g => `<option value="${esc(g)}" ${g === initialGrade ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
      <select id="ttStream">${classesInGrade(initialGrade).map(c => `<option value="${esc(c.id)}" ${c.id === TIMETABLE_CLASS_ID ? 'selected' : ''}>${esc(c.stream || 'All Streams')}</option>`).join('')}</select>
      <select id="ttTeacher">${optionsHtml(teachers.map(t => [t.id, t.name]), TIMETABLE_TEACHER_ID)}</select>
      <div class="spacer"></div>
      ${writable ? `<button class="btn outline-dark" id="ttGenOne">📋 Generate for this Grade</button>
      <button class="btn dark-green" id="ttGenAll">✨ Generate Whole School</button>` : ''}
    </div>
    <div class="tt-subtoolbar">
      <button class="btn ghost tiny" id="ttViewToggle">${TIMETABLE_LIST_VIEW ? 'Grid view' : 'List view'}</button>
      <button class="btn ghost tiny" id="ttPrint">Print</button>
      <button class="btn ghost tiny" id="ttExport">Export CSV</button>
      ${writable && TT_UNDO ? '<button class="btn ghost tiny" id="ttUndo">Undo last generation</button>' : ''}
    </div>
    ${writable ? '<p class="muted" style="font-size:12.5px;margin:-6px 0 14px">Click a slot to edit it, or drag a lesson onto another slot to move or swap it. Clashes (a teacher or room in two places at once) are blocked.</p>'
      : '<p class="muted" style="font-size:12.5px;margin:-6px 0 14px">Only the Head of Department or an Administrator can edit or (re)generate the timetable.</p>'}
    <div id="ttAlert"></div>
    <div id="ttWrap"></div>
    <div id="ttLoad" style="margin-top:16px"></div>`;

  const mode = () => $('ttMode').value;
  const curClass = () => classes.find(c => c.id === $('ttStream').value) || classes[0];
  const curTeacherId = () => $('ttTeacher').value;
  const curEntries = () => mode() === 'teacher' ? (DB.timetable || []).filter(t => t.teacherId === curTeacherId()) : ttEntriesFor(curClass());
  const gridTitle = () => mode() === 'teacher' ? 'Timetable — ' + staffName(curTeacherId()) : 'Timetable — ' + ttClassLabel(curClass());
  const editableGrid = () => writable && mode() === 'class';
  const wrap = $('ttWrap');
  function refreshStreamOptions(){
    const g = $('ttGrade').value, opts = classesInGrade(g);
    $('ttStream').innerHTML = opts.map(c => `<option value="${esc(c.id)}">${esc(c.stream || 'All Streams')}</option>`).join('');
  }

  function lessonCell(list){
    if (!list.length) return '<div class="tt-empty-slot">—</div>';
    const clash = list.length > 1;
    return list.map(t => {
      const col = ttSubjectColor(t.subject);
      const sub = mode() === 'teacher' ? ttEntryLabel(t) : staffName(t.teacherId);
      return `<div class="tt-lesson" style="--c:${col.c};--tint:${col.tint}"><b>${esc(t.subject)}</b><span>${esc(sub)}${t.room ? ' · ' + esc(t.room) : ''}</span></div>`;
    }).join(clash ? '<div style="height:3px"></div>' : '');
  }
  function buildGridHtml(editable){
    const entries = curEntries();
    const byKey = {};
    entries.forEach(t => { const k = ttSlotKey(t.day, t.period); (byKey[k] = byKey[k] || []).push(t); });
    // Old data may use lessons beyond the 9 in the day plan; show them after the last row rather than hide them.
    const extra = [];
    for (let n = TT_LESSONS + 1; n <= ttMaxPeriod(entries); n++) extra.push({ lesson: n, start: '', end: '' });
    const lessonRow = r => {
      const p = String(r.lesson);
      return `<tr><td class="tt-period-cell"><b>${r.start ? esc(ttRowTime(r)) : '—'}</b><span>Lesson ${esc(p)}</span></td>${TT_DAYS.map(day => {
        const list = byKey[ttSlotKey(day, p)] || [];
        const clash = list.length > 1;
        const attrs = editable ? ` class="tt-slot${clash ? ' tt-clash' : ''}" data-day="${esc(day)}" data-period="${esc(p)}" ${list.length ? 'draggable="true" data-has="1"' : ''} style="cursor:pointer"` : (clash ? ' class="tt-clash"' : '');
        return `<td${attrs}>${lessonCell(list)}</td>`;
      }).join('')}</tr>`;
    };
    const fixedRow = r => `<tr class="tt-fixed"><td class="tt-period-cell"><b>${esc(ttRowTime(r))}</b></td><td colspan="${TT_DAYS.length}"><div class="tt-break">${esc(r.label)}</div></td></tr>`;
    return `<div class="tt-grid-wrap"><table class="tt-table"><thead><tr><th>Time / Lesson</th>${TT_DAYS.map(d => `<th>${esc(d)}</th>`).join('')}</tr></thead><tbody>
      ${TT_SCHEDULE.map(r => r.lesson ? lessonRow(r) : fixedRow(r)).join('')}${extra.map(lessonRow).join('')}
    </tbody></table></div>`;
  }
  const LIST_COLS = [['day', 'Day'], ['timeLabel', 'Time'], ['lessonLabel', 'Lesson'], ['kind', 'Kind'], ['grade', 'Class/Grade'], ['stream', 'Stream'], ['subjectLabel', 'Subject'], ['teacherLabel', 'Teacher'], ['room', 'Room']];
  const listRows = () => curEntries().slice().sort(ttSort).map(t => Object.assign({}, t, { timeLabel: ttPeriodTime(t.period) || '—', lessonLabel: 'Lesson ' + t.period, subjectLabel: t.subject, teacherLabel: staffName(t.teacherId) }));
  function drawList(){
    const rows = listRows(), edit = editableGrid();
    wrap.innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr>${LIST_COLS.map(c => `<th>${esc(c[1])}</th>`).join('')}${edit ? '<th></th>' : ''}</tr></thead><tbody>
      ${rows.length ? rows.map(r => `<tr>${LIST_COLS.map(c => `<td>${cellHtml(r[c[0]])}</td>`).join('')}${edit ? `<td class="rowActions"><button class="icon-btn" data-edit-slot="${esc(r.id)}" title="Edit">✎</button> <button class="icon-btn danger" data-del-slot="${esc(r.id)}" title="Delete">🗑</button></td>` : ''}</tr>`).join('') :
      `<tr><td colspan="${LIST_COLS.length + (edit ? 1 : 0)}"><div class="empty"><b>No lessons scheduled yet</b>${writable ? 'Use "Generate Whole School" to build it automatically, or switch to grid view and click a slot to add a lesson.' : ''}</div></td></tr>`}
    </tbody></table></div>`;
  }
  function drawAlert(){
    const clashes = writable ? ttFindClashes(DB.timetable || []) : [];
    $('ttAlert').innerHTML = clashes.length ? `<div class="card" style="padding:10px 14px;margin-bottom:12px;background:var(--amber-100)"><b>⚠ ${clashes.length} teacher clash${clashes.length === 1 ? '' : 'es'} in the timetable</b><div class="muted" style="font-size:12.5px;margin-top:4px">${clashes.slice(0, 4).map(l => `${esc(staffName(l[0].teacherId))} — ${esc(l[0].day)}, ${esc(ttLessonText(l[0].period))}: ${l.map(t => esc(ttEntryLabel(t))).join(' and ')}`).join('<br>')}${clashes.length > 4 ? `<br>…and ${clashes.length - 4} more` : ''}</div></div>` : '';
  }
  // Under the grid: for a class, what the allocations ask for vs what is scheduled; for a teacher, their weekly load.
  function drawLoad(){
    const entries = curEntries();
    if (mode() === 'teacher') {
      const groups = {};
      entries.forEach(t => { const k = ttEntryLabel(t) + '|' + t.subject; groups[k] = (groups[k] || 0) + 1; });
      const keys = Object.keys(groups).sort();
      $('ttLoad').innerHTML = keys.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Class</th><th>Subject</th><th>Lessons / week</th></tr></thead><tbody>
        ${keys.map(k => { const [c, s] = k.split('|'); return `<tr><td>${esc(c)}</td><td>${esc(s)}</td><td>${groups[k]}</td></tr>`; }).join('')}
        <tr><td colspan="2"><b>Total</b></td><td><b>${entries.length}</b></td></tr></tbody></table></div>` : '';
      return;
    }
    const cls = curClass(), want = {}, who = {}, order = [];
    (DB.allocations || []).filter(a => a.grade === cls.grade).forEach(a => {
      if (!(a.subject in want)) { want[a.subject] = 0; who[a.subject] = []; order.push(a.subject); }
      want[a.subject] += Number(a.periods) || 1; who[a.subject].push(staffName(a.teacherId));
    });
    const have = {}; entries.forEach(t => { have[t.subject] = (have[t.subject] || 0) + 1; if (!(t.subject in want)) { want[t.subject] = 0; who[t.subject] = [staffName(t.teacherId)]; order.push(t.subject); } });
    if (!order.length) { $('ttLoad').innerHTML = '<p class="muted" style="font-size:12.5px">No subject allocations for this grade yet — add them under Subject Allocations, then generate.</p>'; return; }
    $('ttLoad').innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Subject</th><th>Teacher</th><th>Required / week</th><th>Scheduled</th><th></th></tr></thead><tbody>
      ${order.map(s => { const w = want[s], h = have[s] || 0; const st = h < w ? `<span class="badge b-amber">Short by ${w - h}</span>` : h > w ? `<span class="badge b-blue">${h - w} extra</span>` : '<span class="badge b-green">OK</span>'; return `<tr><td>${esc(s)}</td><td>${esc(Array.from(new Set(who[s])).join(', '))}</td><td>${w}</td><td>${h}</td><td>${st}</td></tr>`; }).join('')}
    </tbody></table></div>`;
  }
  function draw(){
    const m = mode();
    $('ttGrade').style.display = m === 'class' ? '' : 'none';
    $('ttStream').style.display = m === 'class' ? '' : 'none';
    $('ttTeacher').style.display = m === 'teacher' ? '' : 'none';
    TIMETABLE_MODE = m; TIMETABLE_CLASS_ID = $('ttStream').value; TIMETABLE_TEACHER_ID = $('ttTeacher').value;
    if (TIMETABLE_LIST_VIEW) drawList(); else wrap.innerHTML = buildGridHtml(editableGrid());
    drawAlert(); drawLoad();
  }
  draw();

  $('ttMode').onchange = draw;
  $('ttGrade').onchange = () => { refreshStreamOptions(); draw(); };
  $('ttStream').onchange = draw;
  $('ttTeacher').onchange = draw;
  $('ttViewToggle').onclick = () => { TIMETABLE_LIST_VIEW = !TIMETABLE_LIST_VIEW; $('ttViewToggle').textContent = TIMETABLE_LIST_VIEW ? 'Grid view' : 'List view'; draw(); };
  $('ttPrint').onclick = () => { const t = gridTitle(); printHtml(t, letterhead(t) + buildGridHtml(false)); };
  $('ttExport').onclick = () => { const rows = listRows(); downloadCsv('timetable_' + gridTitle(), LIST_COLS.map(c => c[1]), rows.map(r => LIST_COLS.map(c => r[c[0]]))); };
  if (writable) {
    $('ttGenOne').onclick = () => openGenerateDialog(classes, curClass(), () => renderTimetable(el), 'one');
    $('ttGenAll').onclick = () => openGenerateDialog(classes, curClass(), () => renderTimetable(el), 'all');
    if ($('ttUndo')) $('ttUndo').onclick = async () => {
      DB.timetable = TT_UNDO; TT_UNDO = null;
      if (await persist('timetable')) toast('Timetable restored to how it was before the last generation.');
      renderTimetable(el);
    };
    // Click a slot to edit; list-view buttons edit/delete.
    wrap.onclick = e => {
      const ed = e.target.closest('[data-edit-slot]'), del = e.target.closest('[data-del-slot]'), td = e.target.closest('.tt-slot');
      if (ed) { const t = (DB.timetable || []).find(x => x.id === ed.dataset.editSlot); if (t) openSlotEditor(curClass(), t.day, t.period, t, draw); }
      else if (del) confirmDeleteRecord('timetable', del.dataset.delSlot, draw);
      else if (td) openSlotEditor(curClass(), td.dataset.day, td.dataset.period, ttEntriesFor(curClass()).find(t => t.day === td.dataset.day && String(t.period) === td.dataset.period), draw);
    };
    // Drag a lesson onto another slot of the same class to move it (or swap with what is there).
    let dragFrom = null;
    wrap.ondragstart = e => {
      const td = e.target.closest ? e.target.closest('.tt-slot') : null;
      if (!td || !td.dataset.has) return;
      dragFrom = { day: td.dataset.day, period: td.dataset.period };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'lesson');
    };
    wrap.ondragover = e => { if (dragFrom && e.target.closest('.tt-slot')) e.preventDefault(); };
    wrap.ondrop = async e => {
      const td = e.target.closest('.tt-slot');
      if (!td || !dragFrom) return;
      e.preventDefault();
      const from = dragFrom, to = { day: td.dataset.day, period: td.dataset.period };
      dragFrom = null;
      if (from.day === to.day && from.period === to.period) return;
      await moveLesson(curClass(), from, to);
      draw();
    };
    wrap.ondragend = () => { dragFrom = null; };
  }
}
// Moves the lesson at `from` to `to` in one class's timetable; if `to` already holds a lesson the two swap.
async function moveLesson(cls, from, to){
  const mine = ttEntriesFor(cls);
  const a = mine.find(t => t.day === from.day && String(t.period) === String(from.period));
  const b = mine.find(t => t.day === to.day && String(t.period) === String(to.period));
  if (!a) return;
  const movedA = Object.assign({}, a, { day: to.day, period: String(to.period) });
  const movedB = b ? Object.assign({}, b, { day: from.day, period: String(from.period) }) : null;
  const others = (DB.timetable || []).filter(t => t !== a && t !== b);
  const bad = ttClashMessage(ttClashFor(others, movedA, a.id), movedA) || (movedB ? ttClashMessage(ttClashFor(others, movedB, b.id), movedB) : '');
  if (bad) { toast('Can\u2019t move there — ' + bad); return; }
  a.day = movedA.day; a.period = movedA.period;
  if (b) { b.day = movedB.day; b.period = movedB.period; }
  if (await persist('timetable')) toast(b ? 'Lessons swapped.' : 'Lesson moved.');
}
// Click-to-edit a single day/period slot for one class.
function openSlotEditor(cls, day, period, existing, onDone){
  const subjOpts = subjectsForGrade(cls.grade);
  const allocByS = {}; (DB.allocations || []).filter(a => a.grade === cls.grade).forEach(a => { allocByS[a.subject] = a.teacherId; });
  const teachers = DB.teachers || [];
  const body = `<div class="form-grid">
    <label>Subject</label><select class="sf" id="slotSubject"><option value="">— Free lesson —</option>${subjOpts.map(s => `<option value="${esc(s)}" ${existing && existing.subject === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
    <label>Teacher</label><select class="sf" id="slotTeacher">${teachers.map(t => { const sel = existing ? existing.teacherId === t.id : allocByS[subjOpts[0]] === t.id; return `<option value="${esc(t.id)}" ${sel ? 'selected' : ''}>${esc(t.name)}</option>`; }).join('')}</select>
    <label>Room</label><input class="sf" id="slotRoom" value="${esc(existing ? existing.room : (cls.room || ''))}">
    <label>If it clashes</label><select class="sf" id="slotAllow"><option value="no">Block it</option><option value="yes">Allow it (e.g. combined lesson)</option></select>
  </div>`;
  openModal(`${day} · ${ttLessonText(period)} — ${ttClassLabel(cls)}`, body, async () => {
    DB.timetable = DB.timetable || [];
    const idx = DB.timetable.findIndex(t => existing && t.id === existing.id);
    const subject = $('slotSubject').value;
    if (!subject) {
      if (idx === -1) return true;
      DB.timetable.splice(idx, 1);                       // "Free lesson" clears any existing lesson here
    } else {
      const rec = { id: existing ? existing.id : uid('tt'), day, period: String(period), kind: 'Lesson', grade: cls.grade, stream: cls.stream || '', subject, teacherId: $('slotTeacher').value, room: $('slotRoom').value.trim() };
      if ($('slotAllow').value !== 'yes') {
        const bad = ttClashMessage(ttClashFor(DB.timetable, rec, rec.id), rec);
        if (bad) { toast(bad); return false; }
      }
      if (idx > -1) DB.timetable[idx] = rec; else DB.timetable.push(rec);
    }
    const ok = await persist('timetable');
    if (ok) { toast('Saved.'); onDone && onDone(); }
    return ok;
  });
  // Selecting a subject jumps the teacher dropdown to whoever is allocated to teach it.
  $('slotSubject').onchange = () => { const tid = allocByS[$('slotSubject').value]; if (tid) $('slotTeacher').value = tid; };
}
// The (re)generate dialog: pick a target (this class or the whole school), periods/day,
// and whether to replace existing lessons or only fill the gaps around them.
function openGenerateDialog(classes, cls, onDone, presetTarget){
  const body = `<div class="form-grid">
    <label>Target</label><select class="gf" id="genTarget">
      <option value="one" ${presetTarget !== 'all' ? 'selected' : ''}>This class only — ${esc(ttClassLabel(cls))}</option>
      <option value="all" ${presetTarget === 'all' ? 'selected' : ''}>Every class in the school</option>
    </select>
    <label>Lessons per day</label><input class="gf" id="genPeriods" value="9">
    <label>Existing lessons</label><select class="gf" id="genMode">
      <option value="replace" selected>Replace them — start fresh</option>
      <option value="fill">Keep them — only fill what is missing</option>
    </select>
  </div>
  <p class="muted" style="font-size:12.5px;margin-top:10px">Built from each grade's Subject Allocations (subject, teacher, lessons/week). A teacher is never double-booked, and each subject is spread across the week. You can edit any slot afterwards, and undo the generation if you don't like it.</p>`;
  openModal('Generate timetable', body, async () => {
    const periods = Math.max(1, Math.min(TT_LESSONS, Number($('genPeriods').value) || TT_LESSONS));
    const replace = $('genMode').value === 'replace';
    const targets = $('genTarget').value === 'all' ? classes : [cls];
    const allocations = DB.allocations || [];
    const withAllocs = targets.filter(c => allocations.some(a => a.grade === c.grade));
    const skipped = targets.filter(c => !withAllocs.includes(c)).map(ttClassLabel);
    if (!withAllocs.length) { toast('No subject allocations found for ' + targets.map(ttClassLabel).join(', ') + ' — add them under Subject Allocations first.'); return false; }
    const before = clone(DB.timetable || []);
    const keys = new Set(withAllocs.map(ttClassKey));
    const kept = (DB.timetable || []).filter(t => !(replace && keys.has(ttEntryClassKey(t))));
    const res = ttPlan(withAllocs, allocations, kept, TT_DAYS, periods, 40);
    DB.timetable = kept.concat(res.entries);
    if (!(await persist('timetable'))) return false;
    TT_UNDO = before;
    let msg = `Timetable generated — ${res.entries.length} lesson${res.entries.length === 1 ? '' : 's'} placed.`;
    if (skipped.length) msg += ` No subject allocations for: ${skipped.join(', ')}.`;
    const teacherLoad = {};
    withAllocs.forEach(c => allocations.filter(a => a.grade === c.grade).forEach(a => { if (a.teacherId) teacherLoad[a.teacherId] = (teacherLoad[a.teacherId] || 0) + (Number(a.periods) || 1); }));
    const slots = TT_DAYS.length * periods;
    const overloaded = Object.keys(teacherLoad).filter(t => teacherLoad[t] > slots).map(t => `${staffName(t)} (${teacherLoad[t]})`);
    if (overloaded.length) msg += ` Overloaded: ${overloaded.slice(0, 3).join(', ')} — allocated more lessons than the ${slots} slots in a week.`;
    if (res.unplaced.length) {
      const counts = {}; res.unplaced.forEach(j => { const k = ttClassLabel(j.cls) + ' ' + j.subject; counts[k] = (counts[k] || 0) + 1; });
      const keysU = Object.keys(counts);
      msg += ` ${res.unplaced.length} lesson(s) couldn't be placed without a clash (${keysU.slice(0, 3).join(', ')}${keysU.length > 3 ? '…' : ''}) — add lessons per day or review teacher load.`;
    }
    toast(msg);
    onDone && onDone();
    return true;
  });
}
// Fixed field sets/order for modules that need a specific shape rather than
// "whatever fields the first record happens to have". Modules not listed here
// keep the old dynamic behaviour (fields inferred from the first record).
