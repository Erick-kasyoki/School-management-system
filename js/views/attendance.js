'use strict';
/* views/attendance.js — student attendance and staff attendance screens.
   Part of the EraMaster frontend — loaded after core.js. */

/* ---------------- student attendance (em_attendance is a map: "date|session" -> studentId -> {s,n}) ---------------- */
function attKey(date, session){ return date + '|' + session; }
const ATT_STATUSES = [['P', 'Present'], ['A', 'Absent'], ['L', 'Late'], ['AU', 'Excused']];
// Styled to spec — grade + stream pickers, a single "day" record (no session
// selector shown), and three colour-coded status pills per learner, matching
// the Learners screen's page-head / toolbar / table visual language.
function streamsForGrade(grade){
  return Array.from(new Set((DB.classes || []).filter(c => c.grade === grade && c.stream).map(c => c.stream)));
}
function renderAttendance(el){
  const canMark = can('attendance.mark');
  const grades = distinctGrades();
  const curTerm = (DB.terms || []).find(t => t.current);
  el.innerHTML = `
    <div class="tt-page-head">
      <div><h2>Attendance</h2><p>Mark daily attendance by grade and stream</p></div>
      ${curTerm ? `<span class="tt-term-badge">${esc(curTerm.name)}</span>` : ''}
    </div>
    <div class="lrn-toolbar">
      <select id="attGrade"><option value="">All Grades</option>${grades.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}</select>
      <select id="attStream"><option value="">All Streams</option></select>
      <input type="date" id="attDate" value="${today()}" style="width:auto">
      <div class="spacer"></div>
      ${canMark ? `<button class="btn outline-dark" id="attMarkAll">Mark all present</button>` : ''}
      ${canMark ? `<button class="btn dark-green" id="attSave">💾 Save Attendance</button>` : ''}
    </div>
    <p class="att-summary" id="attSummary"></p>
    <div class="lrn-table-wrap"><table class="lrn-table"><thead><tr>
      <th>Learner</th><th>Admission No.</th><th>Attendance Status</th>
    </tr></thead><tbody id="attBody"></tbody></table></div>`;

  function fillStreams(){
    const g = $('attGrade').value;
    const streams = g ? streamsForGrade(g) : [];
    $('attStream').innerHTML = '<option value="">All Streams</option>' + streams.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  }
  fillStreams();

  function studentsForSelection(){
    const g = $('attGrade').value, s = $('attStream').value;
    return (DB.students || []).filter(st => (!g || st.grade === g) && (!s || st.stream === s));
  }
  function updateSummary(){
    const rows = $('attBody').querySelectorAll('tr[data-sid]');
    let present = 0;
    rows.forEach(tr => { if (tr.querySelector('.att-status-btn.present.active')) present++; });
    $('attSummary').textContent = `${rows.length} learner${rows.length === 1 ? '' : 's'} · ${present} marked present`;
  }
  function draw(){
    const date = $('attDate').value;
    const rec = (DB.attendance || {})[attKey(date, 'Full Day')] || {};
    const list = studentsForSelection();
    $('attBody').innerHTML = list.length ? list.map(s => {
      const cur = rec[s.id] || { s: 'P', n: '' };
      const col = lrnAvatarColor(s.name);
      return `<tr data-sid="${esc(s.id)}">
        <td><div class="lrn-name-cell"><span class="lrn-avatar" style="--ac:${col.c};--at:${col.tint}">${s.photo ? `<img src="${esc(s.photo)}" alt="">` : esc(initials(s.name))}</span><b>${esc(s.name)}</b></div></td>
        <td>${esc(s.admNo || '—')}</td>
        <td><div class="att-status-group">
          <button type="button" class="att-status-btn present ${cur.s === 'P' ? 'active' : ''}" data-status="P" ${canMark ? '' : 'disabled'}>✓ Present</button>
          <button type="button" class="att-status-btn late ${cur.s === 'L' ? 'active' : ''}" data-status="L" ${canMark ? '' : 'disabled'}>⏱ Late</button>
          <button type="button" class="att-status-btn absent ${cur.s === 'A' ? 'active' : ''}" data-status="A" ${canMark ? '' : 'disabled'}>✕ Absent</button>
        </div></td>
      </tr>`;
    }).join('') : `<tr><td colspan="3"><div class="empty"><b>No learners found</b>Try a different grade or stream.</div></td></tr>`;
    updateSummary();
  }
  draw();
  $('attGrade').onchange = () => { fillStreams(); draw(); };
  $('attStream').onchange = draw; $('attDate').onchange = draw;
  if (canMark) {
    $('attBody').onclick = (e) => {
      const btn = e.target.closest('[data-status]'); if (!btn) return;
      const tr = btn.closest('tr');
      tr.querySelectorAll('[data-status]').forEach(b => b.classList.toggle('active', b === btn));
      updateSummary();
    };
    $('attMarkAll').onclick = () => {
      $('attBody').querySelectorAll('tr[data-sid]').forEach(tr => {
        tr.querySelectorAll('[data-status]').forEach(b => b.classList.toggle('active', b.dataset.status === 'P'));
      });
      updateSummary();
    };
    $('attSave').onclick = async () => {
      const date = $('attDate').value;
      if (!date) { toast('Choose a date.'); return; }
      const rec = {};
      $('attBody').querySelectorAll('tr[data-sid]').forEach(tr => {
        const sid = tr.dataset.sid;
        const active = tr.querySelector('[data-status].active');
        rec[sid] = { s: active ? active.dataset.status : 'P', n: '' };
      });
      DB.attendance = DB.attendance || {};
      DB.attendance[attKey(date, 'Full Day')] = rec;
      const ok = await persist('attendance');
      if (ok) toast('Attendance saved.');
    };
  }
}

/* ---------------- staff attendance (em_staff_attendance is a map: date -> teacherId -> {s,n,in,out}) ----------------
 * Staff attendance marks itself: signing in stamps the person present with the
 * time they signed in (the working day runs 08:00–17:00), and anyone who has
 * not signed in on a past date is shown as absent. Whoever has permission can
 * still override any row by hand and save. */
function renderStaffAttendance(el){
  const canMark = can('attendance.staff');
  el.innerHTML = `
    <div class="list-toolbar">
      <input type="date" id="satDate" value="${today()}">
      <span class="muted" style="font-size:12.5px">Working day ${STAFF_DAY.start}–${STAFF_DAY.end} · sign-ins are recorded automatically</span>
      <div class="spacer"></div>
      <span id="satSummary" class="muted" style="font-size:12.5px"></span>
      <button class="btn ghost" id="satExport">Export CSV</button>
      ${canMark ? `<button class="btn primary" id="satSave">Save attendance</button>` : ''}
    </div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Staff</th><th>Job Title</th><th>Time In</th><th>Time Out</th><th>Status</th><th>Note</th></tr></thead><tbody id="satBody"></tbody></table></div>`;
  // What the system already knows about a staff member on a given day, before
  // anybody marks anything: their sign-in stamp, or leave, or nothing yet.
  function autoRow(t, date, saved){
    if (saved) return saved;
    const onLeave = (DB.leave || []).some(l => l.teacherId === t.id && String(l.status) === 'Approved'
      && String(l.startDate || '') <= date && date <= String(l.endDate || ''));
    if (onLeave) return { s: 'A', n: 'On approved leave', in: '', out: '' };
    if (date > today()) return { s: 'P', n: '', in: '', out: '' };
    if (date === today()) return { s: 'P', n: '', in: STAFF_DAY.start, out: '' };
    return { s: 'A', n: 'No sign-in recorded', in: '', out: '' };
  }
  function rowsFor(date){
    const rec = (DB.staff_attendance || {})[date] || {};
    return (DB.teachers || []).map(t => ({ t, cur: autoRow(t, date, rec[t.id]) }));
  }
  function draw(){
    const date = $('satDate').value || today();
    const rows = rowsFor(date);
    $('satBody').innerHTML = rows.length ? rows.map(({ t, cur }) => `<tr data-tid="${esc(t.id)}">
        <td>${nameCell(t.name, t.jobTitle)}</td>
        <td>${esc(t.jobTitle)}</td>
        <td><input type="time" data-in value="${esc(cur.in || '')}" ${canMark ? '' : 'disabled'} style="width:110px"></td>
        <td><input type="time" data-out value="${esc(cur.out || '')}" ${canMark ? '' : 'disabled'} style="width:110px"></td>
        <td>${ATT_STATUSES.map(([code, label]) => `<button type="button" class="btn tiny ${cur.s === code ? 'primary' : 'ghost'}" data-status="${code}" ${canMark ? '' : 'disabled'}>${label}</button>`).join(' ')}</td>
        <td><input data-note value="${esc(cur.n || '')}" ${canMark ? '' : 'disabled'} style="width:140px"></td>
      </tr>`).join('') : `<tr><td colspan="6"><div class="empty">No staff records yet.</div></td></tr>`;
    const present = rows.filter(r => r.cur.s === 'P').length;
    $('satSummary').textContent = rows.length ? `${present} present · ${rows.length - present} away of ${rows.length} staff` : '';
  }
  draw();
  $('satDate').onchange = draw;
  $('satExport').onclick = () => {
    const date = $('satDate').value || today();
    const rows = rowsFor(date);
    if (!rows.length) { toast('There is nothing to export yet.'); return; }
    const label = c => (ATT_STATUSES.find(s => s[0] === c) || [c, c])[1];
    downloadCsv('Staff attendance ' + date, ['Date', 'Staff', 'Job Title', 'Time In', 'Time Out', 'Status', 'Note'],
      rows.map(({ t, cur }) => [date, t.name, t.jobTitle || '', cur.in || '', cur.out || '', label(cur.s), cur.n || '']));
  };
  if (canMark) {
    $('satBody').onclick = (e) => {
      const btn = e.target.closest('[data-status]'); if (!btn) return;
      const tr = btn.closest('tr');
      tr.querySelectorAll('[data-status]').forEach(b => { b.classList.toggle('primary', b === btn); b.classList.toggle('ghost', b !== btn); });
      // Marking someone present fills in the working-day times if they're blank.
      if (btn.dataset.status === 'P') {
        const inEl = tr.querySelector('[data-in]'), outEl = tr.querySelector('[data-out]');
        if (inEl && !inEl.value) inEl.value = STAFF_DAY.start;
        if (outEl && !outEl.value && ($('satDate').value || today()) < today()) outEl.value = STAFF_DAY.end;
      }
    };
    $('satSave').onclick = async () => {
      const date = $('satDate').value;
      if (!date) { toast('Choose a date.'); return; }
      const rec = {};
      $('satBody').querySelectorAll('tr[data-tid]').forEach(tr => {
        const active = tr.querySelector('[data-status].primary');
        rec[tr.dataset.tid] = {
          s: active ? active.dataset.status : 'P',
          n: tr.querySelector('[data-note]').value.trim(),
          in: tr.querySelector('[data-in]').value || '',
          out: tr.querySelector('[data-out]').value || '',
        };
      });
      DB.staff_attendance = DB.staff_attendance || {};
      DB.staff_attendance[date] = rec;
      const ok = await persist('staff_attendance');
      if (ok) { toast('Staff attendance saved.'); draw(); }
    };
  }
}

