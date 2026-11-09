'use strict';
/* crud/screens.js — Students/Classes/Teachers/Subjects screens plus the generic list+form screen used by every other module.
   Part of the EraMaster frontend — loaded after core.js. */

function renderStudentsList(el){
  const key = 'students';
  const writable = canWrite(key);
  const grades = distinctGrades();
  const curTerm = (DB.terms || []).find(t => t.current);

  el.innerHTML = `
    <div class="tt-page-head">
      <div><h2>Learners</h2><p id="lrnCount"></p></div>
      ${curTerm ? `<span class="tt-term-badge">${esc(curTerm.name)}</span>` : ''}
    </div>
    <div class="lrn-toolbar">
      <div class="lrn-search"><span class="lrn-search-ic">🔍</span><input type="search" id="lrn_search" placeholder="Search by name or admission no"></div>
      <select id="lrn_grade"><option value="">All Grades</option>${grades.map(g => `<option value="${esc(g)}" ${g === LRN_GRADE_PRESET ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
      <select id="lrn_status"><option value="">All Status</option><option value="Active">Active</option><option value="Inactive">Inactive</option></select>
      <div class="spacer"></div>
      <button class="btn ghost" id="lrn_export">Export CSV</button>
      ${writable ? `<button class="btn outline-dark" id="lrn_import">⇧ Bulk Import</button><input type="file" id="lrn_import_file" accept=".xlsx,.xls,.csv" style="display:none">` : ''}
      ${writable ? `<button class="btn dark-green" id="lrn_add">+ Add Learner</button>` : ''}
    </div>
    <div class="lrn-table-wrap"><table class="lrn-table"><thead><tr>
      <th>Learner</th><th>Admission No.</th><th>Grade / Stream</th><th>Gender</th><th>Parent Phone</th><th>Status</th><th></th>
    </tr></thead><tbody id="lrn_body"></tbody></table></div>`;

  function filtered(){
    const list = DB.students || [];
    const q = ($('lrn_search').value || '').toLowerCase();
    const g = $('lrn_grade').value;
    const st = $('lrn_status').value;
    return list.filter(r =>
      (!q || String(r.name || '').toLowerCase().includes(q) || String(r.admNo || '').toLowerCase().includes(q)) &&
      (!g || r.grade === g) &&
      (!st || (r.status || 'Active') === st));
  }
  function draw(){
    const total = (DB.students || []).length;
    $('lrnCount').textContent = total + ' learner' + (total === 1 ? '' : 's') + ' enrolled';
    const rows = filtered();
    $('lrn_body').innerHTML = rows.length ? rows.map(r => {
      const col = lrnAvatarColor(r.name);
      return `<tr>
        <td><div class="lrn-name-cell"><span class="lrn-avatar" style="--ac:${col.c};--at:${col.tint}">${r.photo ? `<img src="${esc(r.photo)}" alt="">` : esc(initials(r.name))}</span><b>${esc(r.name)}</b></div></td>
        <td>${esc(r.admNo || '—')}</td>
        <td>${esc(r.grade || '—')}${r.stream ? ' - ' + esc(r.stream) : ''}</td>
        <td>${esc(r.gender || '—')}</td>
        <td>${esc(r.guardianPhone || '—')}</td>
        <td>${badge(r.status || 'Active')}</td>
        <td class="rowActions">
          ${writable ? `<button class="lrn-row-ic" data-edit="${esc(r.id)}" title="Edit">✎</button>` : ''}
          ${canDelete(key) ? `<button class="lrn-row-ic danger" data-del="${esc(r.id)}" title="Delete">🗑</button>` : ''}
        </td>
      </tr>`;
    }).join('') :
      `<tr><td colspan="7"><div class="empty"><b>No learners found</b>${writable ? 'Click "+ Add Learner" to create the first one.' : ''}</div></td></tr>`;
  }
  LRN_GRADE_PRESET = '';
  draw();
  $('lrn_search').oninput = draw;
  $('lrn_grade').onchange = draw;
  $('lrn_status').onchange = draw;
  $('lrn_export').onclick = () => { const f = keyFields(key); downloadCsv(key, f.map(fieldLabel), (DB[key] || []).map(r => f.map(x => r[x]))); };
  if (writable) {
    $('lrn_add').onclick = () => openRecordForm(key, null, draw);
    $('lrn_import').onclick = () => $('lrn_import_file').click();
    $('lrn_import_file').onchange = (e) => { const f = e.target.files[0]; if (f) importExcel(key, f, draw); e.target.value = ''; };
  }
  $('lrn_body').onclick = async (e) => {
    const editId = e.target.dataset.edit, delId = e.target.dataset.del;
    if (editId) openRecordForm(key, (DB.students || []).find(r => String(r.id) === editId), draw);
    if (delId) confirmDeleteRecord(key, delId, draw);
  };
}
// Purpose-built "Classes" screen — a card grid (one card per class) rather
// than the generic table+form CRUD every other module uses. Editing/creating
// still goes through the shared classes form (openRecordForm), since the
// classes MODULE_SCHEMA already has the right fields (grade, stream,
// classTeacherId, room, capacity).
function classGradeCode(c){ return String(c.grade || '').replace(/\s+/g, ''); }
function classStudentCount(c){ return (DB.students || []).filter(s => s.grade === c.grade && (!c.stream || s.stream === c.stream)).length; }
function renderClassesList(el){
  const key = 'classes';
  const writable = canWrite(key);
  const curTerm = (DB.terms || []).find(t => t.current);
  el.innerHTML = `
    <p class="crumb">🏠 Home <span>›</span> Classes</p>
    <div class="tt-page-head">
      <div><h2>Classes</h2><p>${esc((curTerm && curTerm.year) || '')}${curTerm ? ' — ' + esc(curTerm.name) : ''}</p></div>
      ${writable ? `<button class="btn primary" id="cls_add">+ Create Class</button>` : ''}
    </div>
    <div class="cls-grid" id="cls_grid"></div>`;

  function draw(){
    const classes = DB.classes || [];
    $('cls_grid').innerHTML = classes.length ? classes.map(c => {
      const count = classStudentCount(c);
      const cap = Number(c.capacity) || 0;
      const pct = cap ? Math.min(100, Math.round(count / cap * 100)) : 0;
      const teacherName = relationLabel('classes', 'classTeacherId', c.classTeacherId) || '—';
      return `<div class="cls-card">
        <div class="cls-card-hd">
          <div class="cls-card-title"><span class="cls-card-icon">🏫</span><b>${esc(classLabel(c))}</b></div>
          <span class="cls-card-badge">${esc(classGradeCode(c))}</span>
        </div>
        <div class="cls-stats">
          <div class="cls-stat"><span>Students</span><b>${count}</b></div>
          <div class="cls-stat"><span>Capacity</span><b>${cap || '—'}</b></div>
        </div>
        <div class="cls-teacher"><span>Class Teacher</span><b>${esc(teacherName)}</b></div>
        <div class="cls-fill-row">
          <div class="enroll-bar-track"><div class="enroll-bar-fill" style="width:${pct}%"></div></div>
          <small>${pct}% full</small>
        </div>
        <div class="cls-actions-row">
          <button class="btn outline-dark" data-students="${esc(c.id)}">👥 Students</button>
          ${writable ? `<button class="btn amber-solid" data-edit="${esc(c.id)}">✎ Edit</button>` : ''}
          <button class="btn primary" data-results="${esc(c.id)}">📊 Results</button>
        </div>
        ${canDelete(key) ? `<button class="btn rose-solid" data-del="${esc(c.id)}">🗑 Delete</button>` : ''}
      </div>`;
    }).join('') : `<div class="empty"><b>No classes set up yet</b>${writable ? 'Click "+ Create Class" to add the first one.' : ''}</div>`;
  }
  draw();
  if (writable) $('cls_add').onclick = () => openRecordForm(key, null, draw);
  $('cls_grid').onclick = (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const studId = btn.dataset.students, editId = btn.dataset.edit, resId = btn.dataset.results, delId = btn.dataset.del;
    const cls = (DB.classes || []).find(c => String(c.id) === (studId || editId || resId || delId));
    if (!cls) return;
    if (studId) { LRN_GRADE_PRESET = cls.grade; goTo('students'); }
    if (editId) openRecordForm(key, cls, draw);
    if (delId) confirmDeleteRecord(key, delId, draw);
    if (resId) {
      const exam = firstExamForClass(cls);
      if (!exam) { toast(`No exam set up yet for ${classLabel(cls)} — create one under Exams first.`); return; }
      RESULTS_VIEW_MODE = 'entry'; RESULTS_EXAM_ID = exam.id;
      goTo('results');
    }
  };
}
// Colour tints for "Assigned Classes" badges on the Teachers screen — cycled
// by subject name so the same subject always gets the same colour.
const SUBJECT_PALETTE = [
  { c: '#175537', tint: '#dcefe3' }, { c: '#1f6f78', tint: '#e0f2f2' },
  { c: '#7a4fb5', tint: '#f0eafc' }, { c: '#2a5adb', tint: '#e2ecff' },
  { c: '#b8860b', tint: '#faf1da' },
];
function subjectColor(s){ return SUBJECT_PALETTE[ttHash(String(s || '')) % SUBJECT_PALETTE.length]; }
// What a teacher is assigned to teach, derived from the allocations table
// (grade + subject), matched up with the class's stream where known.
function teacherAssignments(t){
  const seen = new Set(), rows = [];
  (DB.allocations || []).filter(a => a.teacherId === t.id).forEach(a => {
    const cls = (DB.classes || []).find(c => c.grade === a.grade);
    const label = a.grade + (cls && cls.stream ? ' ' + cls.stream : '') + ' · ' + a.subject;
    if (!seen.has(label)) { seen.add(label); rows.push({ label, subject: a.subject }); }
  });
  return rows;
}
// Staff screen — dashboard-style page: stat cards, status/grouping tabs, a
// searchable + sortable + paged table, and a filter / summary sidebar.
// Create/edit still go through the shared teachers form (openRecordForm).
function departmentName(id){
  if (!id) return '';
  const d = (DB.departments || []).find(x => x.id === id);
  return d ? d.name : '';
}
// Subjects a staff member teaches, taken from Subject Allocations.
function staffSubjects(t){
  const seen = new Set(), out = [];
  (DB.allocations || []).filter(a => a.teacherId === t.id).forEach(a => { if (a.subject && !seen.has(a.subject)) { seen.add(a.subject); out.push(a.subject); } });
  return out;
}
function staffExpBucket(r){
  if (r.experience === undefined || r.experience === null || r.experience === '' || isNaN(Number(r.experience))) return 'Not set';
  const y = Number(r.experience);
  return y <= 2 ? '0–2 years' : y <= 5 ? '3–5 years' : y <= 10 ? '6–10 years' : 'Over 10 years';
}
const STAFF_EXP_ORDER = ['0–2 years', '3–5 years', '6–10 years', 'Over 10 years', 'Not set'];
function staffStatusPill(s){
  s = s || 'Active';
  const c = s === 'Active' ? 'b-green' : s === 'On Leave' ? 'b-amber' : 'b-red';
  return `<span class="badge ${c}">${esc(s)}</span>`;
}
function renderTeachersList(el){
  const key = 'teachers';
  const writable = canWrite(key);
  const PAGE_SIZE = 8;
  const st = { tab: 'all', page: 1, tableQ: '', sort: 'name', applied: { q: '', dept: '', subject: '', status: '', qual: '', exp: '' } };
  const TABS = [['all', 'All Staff'], ['Active', 'Active'], ['Inactive', 'Inactive'], ['dept', 'By Department'], ['qual', 'By Qualification'], ['exp', 'By Experience'], ['On Leave', 'On Leave']];
  const SORTS = [['name', 'Name (A–Z)'], ['nameDesc', 'Name (Z–A)'], ['staffNo', 'Staff ID'], ['dept', 'Department'], ['exp', 'Most experienced']];

  el.innerHTML = `
    <div class="stf-head">
      <div><h2>Staff</h2><p class="crumb stf-crumb"><a href="#" id="stf_home">Home</a> <span>›</span> Staff</p></div>
      <div class="stf-head-actions">
        ${writable ? `<button class="btn stf-primary" id="tch_add">＋ Add Staff</button>` : ''}
        ${writable ? `<button class="btn stf-ghost" id="tch_import">⇩ Import</button><input type="file" id="tch_import_file" accept=".xlsx,.xls,.csv" style="display:none">` : ''}
        <button class="btn stf-ghost" id="tch_export">⇧ Export</button>
        <span class="stf-vsep"></span>
        <div class="stf-menu-wrap"><button class="btn stf-ghost" id="stf_more">⋮ More Actions ▾</button>
          <div class="stf-menu" id="stf_more_menu" hidden><button data-act="print">Print list</button><button data-act="reset">Reset all filters</button></div></div>
      </div>
    </div>
    <div class="stf-stats" id="stf_stats"></div>
    <div class="stf-layout">
      <div class="stf-main">
        <div class="stf-tabs" id="stf_tabs" role="tablist">${TABS.map(t => `<button role="tab" data-tab="${t[0]}">${t[1]}</button>`).join('')}</div>
        <div class="stf-card">
          <div class="stf-table-tools">
            <div class="stf-search"><span>🔍</span><input type="search" id="tch_search" placeholder="Search staff…"></div>
            <div class="stf-menu-wrap"><button class="btn stf-ghost" id="stf_sort">⇅ Sort</button>
              <div class="stf-menu" id="stf_sort_menu" hidden>${SORTS.map(s => `<button data-sort="${s[0]}">${s[1]}</button>`).join('')}</div></div>
          </div>
          <div class="stf-table-scroll"><table class="stf-table"><thead><tr>
            <th>Staff Member</th><th>Staff ID</th><th>Department</th><th>Subjects</th><th>Qualification</th><th>Phone</th><th>Status</th><th>Actions</th>
          </tr></thead><tbody id="tch_body"></tbody></table></div>
          <div class="stf-foot"><span id="stf_showing"></span><div class="stf-pager" id="stf_pager"></div></div>
        </div>
      </div>
      <aside class="stf-side">
        <div class="stf-card stf-filters">
          <div class="stf-side-hd"><b>Filters</b><button class="stf-link" id="stf_reset">Reset</button></div>
          <label>Search Staff</label><input type="search" id="f_q" placeholder="Search by name, email or ID...">
          <label>Department</label><select id="f_dept"></select>
          <label>Subject</label><select id="f_subject"></select>
          <label>Status</label><select id="f_status"><option value="">All Status</option><option>Active</option><option>Inactive</option><option>On Leave</option></select>
          <label>Qualification</label><select id="f_qual"></select>
          <label>Experience</label><select id="f_exp"></select>
          <div class="stf-filter-btns"><button class="btn stf-primary" id="f_apply">⏷ Apply Filters</button><button class="btn stf-ghost" id="f_clear">↻ Clear</button></div>
        </div>
        <div class="stf-card stf-summary"><b class="stf-side-title">Staff Summary</b><div id="stf_summary"></div></div>
      </aside>
    </div>`;

  const list = () => DB.teachers || [];
  const qualOf = r => String(r.qualification || '').trim();

  function fillSelect(id, allLabel, values, current){
    const sel = $(id);
    sel.innerHTML = `<option value="">${esc(allLabel)}</option>` + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    sel.value = values.includes(current) ? current : '';
  }
  function fillFilterOptions(){
    const a = st.applied;
    const depts = [...new Set((DB.departments || []).map(d => d.name).filter(Boolean))].sort();
    const subjects = [...new Set([...(DB.subjects || []).map(s => s.name), ...(DB.allocations || []).map(x => x.subject)].filter(Boolean))].sort();
    const quals = [...new Set(list().map(qualOf).filter(Boolean))].sort();
    fillSelect('f_dept', 'All Departments', depts, $('f_dept').value || a.dept);
    fillSelect('f_subject', 'All Subjects', subjects, $('f_subject').value || a.subject);
    fillSelect('f_qual', 'All Qualifications', quals, $('f_qual').value || a.qual);
    fillSelect('f_exp', 'All Experience', STAFF_EXP_ORDER, $('f_exp').value || a.exp);
  }
  function matches(r){
    const a = st.applied, q = (a.q || '').toLowerCase(), tq = st.tableQ.toLowerCase();
    const dept = departmentName(r.departmentId), subs = staffSubjects(r);
    const hay = [r.name, r.email, r.staffNo, dept, r.phone, qualOf(r), subs.join(' ')].join(' ').toLowerCase();
    const status = r.status || 'Active';
    return (!q || [r.name, r.email, r.staffNo].join(' ').toLowerCase().includes(q)) &&
      (!tq || hay.includes(tq)) &&
      (!a.dept || dept === a.dept) && (!a.subject || subs.includes(a.subject)) &&
      (!a.status || status === a.status) && (!a.qual || qualOf(r) === a.qual) && (!a.exp || staffExpBucket(r) === a.exp) &&
      (st.tab !== 'Active' && st.tab !== 'Inactive' && st.tab !== 'On Leave' || status === st.tab);
  }
  function groupKey(r){
    return st.tab === 'dept' ? (departmentName(r.departmentId) || 'No department')
         : st.tab === 'qual' ? (qualOf(r) || 'Not set')
         : st.tab === 'exp' ? staffExpBucket(r) : '';
  }
  function sorted(rows){
    const cmp = {
      name: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
      nameDesc: (a, b) => String(b.name || '').localeCompare(String(a.name || '')),
      staffNo: (a, b) => String(a.staffNo || '').localeCompare(String(b.staffNo || ''), undefined, { numeric: true }),
      dept: (a, b) => departmentName(a.departmentId).localeCompare(departmentName(b.departmentId)),
      exp: (a, b) => (Number(b.experience) || 0) - (Number(a.experience) || 0),
    }[st.sort];
    const out = rows.slice().sort(cmp);
    if (st.tab === 'dept' || st.tab === 'qual') return out.sort((a, b) => groupKey(a).localeCompare(groupKey(b)));
    if (st.tab === 'exp') return out.sort((a, b) => STAFF_EXP_ORDER.indexOf(groupKey(a)) - STAFF_EXP_ORDER.indexOf(groupKey(b)));
    return out;
  }
  function drawStats(){
    const all = list(), n = all.length;
    const cnt = f => all.filter(f).length;
    const share = v => n ? Math.round(v / n * 100) + '% of all staff' : '—';
    const cards = [
      ['👥', '#e8e9ff', '#5a55d6', 'Total Staff', n, 'Across ' + new Set(all.map(r => r.departmentId).filter(Boolean)).size + ' departments'],
      ['🎓', '#dcefe3', '#175537', 'Male Staff', cnt(r => r.gender === 'Male'), share(cnt(r => r.gender === 'Male'))],
      ['👤', '#ffe6dc', '#e2672e', 'Female Staff', cnt(r => r.gender === 'Female'), share(cnt(r => r.gender === 'Female'))],
      ['🪪', '#e2ecff', '#2a5adb', 'Active Staff', cnt(r => (r.status || 'Active') === 'Active'), share(cnt(r => (r.status || 'Active') === 'Active'))],
      ['🚫', '#fff2d9', '#e08a00', 'Inactive Staff', cnt(r => r.status === 'Inactive'), share(cnt(r => r.status === 'Inactive'))],
    ];
    $('stf_stats').innerHTML = cards.map(c => `<div class="stf-stat"><span class="stf-stat-ic" style="background:${c[1]};color:${c[2]}">${c[0]}</span>
      <div><div class="stf-stat-lbl">${c[3]}</div><div class="stf-stat-val">${c[4]}</div><div class="stf-stat-sub">${esc(c[5])}</div></div></div>`).join('');
    const rows = [['Total Staff', n], ['Active Staff', cnt(r => (r.status || 'Active') === 'Active')], ['Inactive Staff', cnt(r => r.status === 'Inactive')],
      ['On Leave', cnt(r => r.status === 'On Leave')], ['Departments', (DB.departments || []).length], ['Subjects', (DB.subjects || []).length]];
    $('stf_summary').innerHTML = rows.map(r => `<div class="stf-sum-row"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('');
  }
  function pagerButtons(pages){
    const set = new Set([1, pages, st.page, st.page - 1, st.page + 1].filter(p => p >= 1 && p <= pages));
    const nums = [...set].sort((a, b) => a - b), out = [];
    nums.forEach((p, i) => { if (i && p - nums[i - 1] > 1) out.push('<span class="stf-dots">…</span>'); out.push(`<button data-page="${p}" class="${p === st.page ? 'on' : ''}">${p}</button>`); });
    return `<button data-page="${st.page - 1}" ${st.page <= 1 ? 'disabled' : ''} aria-label="Previous page">‹</button>${out.join('')}<button data-page="${st.page + 1}" ${st.page >= pages ? 'disabled' : ''} aria-label="Next page">›</button>`;
  }
  function draw(){
    drawStats(); fillFilterOptions();
    $('stf_tabs').querySelectorAll('button').forEach(b => { const on = b.dataset.tab === st.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    const rows = sorted(list().filter(matches));
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    st.page = Math.min(st.page, pages);
    const from = (st.page - 1) * PAGE_SIZE, slice = rows.slice(from, from + PAGE_SIZE);
    let lastGroup = null;
    $('tch_body').innerHTML = slice.length ? slice.map(r => {
      let head = '';
      const g = groupKey(r);
      if (g && g !== lastGroup) { lastGroup = g; head = `<tr class="stf-group"><td colspan="8">${esc(g)} <span>${rows.filter(x => groupKey(x) === g).length}</span></td></tr>`; }
      const dept = departmentName(r.departmentId), col = lrnAvatarColor(r.name), subs = staffSubjects(r);
      return head + `<tr>
        <td><div class="stf-person"><span class="lrn-avatar stf-avatar" style="--ac:${col.c};--at:${col.tint}">${r.photo ? `<img src="${esc(r.photo)}" alt="">` : esc(initials(r.name))}</span>
          <div><b>${esc(r.name)}</b><small>${esc(r.email || r.jobTitle || '')}</small></div></div></td>
        <td>${esc(r.staffNo || '—')}</td>
        <td>${esc(dept || '—')}</td>
        <td>${esc(subs.join(', ') || '—')}</td>
        <td>${esc(qualOf(r) || '—')}</td>
        <td>${esc(r.phone || '—')}</td>
        <td>${staffStatusPill(r.status)}</td>
        <td class="rowActions stf-actions">
          <button class="btn outline-dark tiny" data-view="${esc(r.id)}">👁 View</button>
          ${writable ? `<button class="btn amber-solid tiny" data-edit="${esc(r.id)}">✎ Edit</button>` : ''}
          ${canDelete(key) ? `<button class="btn rose-solid tiny" data-del="${esc(r.id)}" style="width:auto" title="Delete">🗑</button>` : ''}
        </td></tr>`;
    }).join('') : `<tr><td colspan="8"><div class="empty"><b>No staff found</b>${writable && !list().length ? 'Click "Add Staff" to create the first one.' : 'Try changing the search, tab or filters.'}</div></td></tr>`;
    $('stf_showing').textContent = rows.length ? `Showing ${from + 1} to ${from + slice.length} of ${rows.length} staff` : 'Showing 0 staff';
    $('stf_pager').innerHTML = pages > 1 ? pagerButtons(pages) : '';
  }
  function readFilters(){ st.applied = { q: $('f_q').value.trim(), dept: $('f_dept').value, subject: $('f_subject').value, status: $('f_status').value, qual: $('f_qual').value, exp: $('f_exp').value }; st.page = 1; draw(); }
  function clearFilters(){ ['f_q', 'f_dept', 'f_subject', 'f_status', 'f_qual', 'f_exp'].forEach(id => $(id).value = ''); $('tch_search').value = ''; st.tableQ = ''; readFilters(); }
  function closeMenus(){ $('stf_more_menu').hidden = true; $('stf_sort_menu').hidden = true; }

  draw();
  $('tch_search').oninput = (e) => { st.tableQ = e.target.value; st.page = 1; draw(); };
  $('f_apply').onclick = readFilters;
  $('f_q').onkeydown = (e) => { if (e.key === 'Enter') readFilters(); };
  $('f_clear').onclick = clearFilters;
  $('stf_reset').onclick = clearFilters;
  $('stf_home').onclick = (e) => { e.preventDefault(); if (typeof goTo === 'function') goTo('dashboard'); };
  $('stf_tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.tab = b.dataset.tab; st.page = 1; draw(); };
  $('stf_pager').onclick = (e) => { const b = e.target.closest('button'); if (!b || b.disabled) return; st.page = Number(b.dataset.page); draw(); };
  $('stf_sort').onclick = (e) => { e.stopPropagation(); const h = $('stf_sort_menu').hidden; closeMenus(); $('stf_sort_menu').hidden = !h; };
  $('stf_sort_menu').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.sort = b.dataset.sort; closeMenus(); draw(); };
  $('stf_more').onclick = (e) => { e.stopPropagation(); const h = $('stf_more_menu').hidden; closeMenus(); $('stf_more_menu').hidden = !h; };
  $('stf_more_menu').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; closeMenus(); if (b.dataset.act === 'print') window.print(); else clearFilters(); };
  el.addEventListener('click', (e) => { if (!e.target.closest('.stf-menu-wrap')) closeMenus(); });
  $('tch_export').onclick = () => { const f = keyFields(key); downloadCsv(key, f.map(fieldLabel), list().map(r => f.map(x => x === 'departmentId' ? departmentName(r[x]) : r[x]))); };
  if (writable) {
    $('tch_add').onclick = () => openRecordForm(key, null, draw);
    $('tch_import').onclick = () => $('tch_import_file').click();
    $('tch_import_file').onchange = (e) => { const f = e.target.files[0]; if (f) importExcel(key, f, draw); e.target.value = ''; };
  }
  $('tch_body').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const editId = b.dataset.edit, delId = b.dataset.del, viewId = b.dataset.view;
    if (editId) openRecordForm(key, list().find(r => String(r.id) === editId), draw);
    if (delId) confirmDeleteRecord(key, delId, draw);
    if (viewId) viewStaffRecord(list().find(r => String(r.id) === viewId));
  };
}
function viewStaffRecord(r){
  if (!r) return;
  const row = (label, val) => `<label style="display:block;font-size:11px;color:var(--muted);margin-top:10px">${esc(label)}</label><div style="font-size:14px;font-weight:600">${esc(val || '—')}</div>`;
  showInfoModal('Staff — ' + r.name, `
    ${row('Staff ID', r.staffNo)}${row('Full Name', r.name)}${row('Role', r.jobTitle)}
    ${row('Department', departmentName(r.departmentId))}${row('Subjects', staffSubjects(r).join(', '))}
    ${row('Qualification', r.qualification)}${row('Experience', r.experience === '' || r.experience == null ? '' : r.experience + ' years')}
    ${row('Phone', r.phone)}${row('Email', r.email)}
    ${row('Assigned Class', r.assignedClass)}${row('Status', r.status)}`);
}
// Purpose-built "Subjects" screen — a school-wide subject catalog, separate
// from Subject Allocations (which ties a subject to a specific teacher/class
// for timetabling). Each subject record also carries which grades/classes it
// is taught in (r.classes, an array of grade names), set via "Assign to Classes".
function renderSubjectsManagement(el){
  const key = 'subjects';
  const writable = canWrite(key);
  el.innerHTML = `
    <p class="crumb">Home <span>›</span> Subjects</p>
    <div class="tt-page-head">
      <div><h2>Subjects</h2><p id="subjCount"></p></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${writable ? `<button class="btn amber-solid" id="subj_assign">🔗 Assign to Classes</button><button class="btn dark-green" id="subj_add">+ Add Subject</button>` : ''}
      </div>
    </div>
    <div class="mgmt-search-row">
      <div class="lrn-search"><span class="lrn-search-ic">🔍</span><input type="search" id="subj_search" placeholder="Search by code or subject name"></div>
      <div class="spacer"></div>
      <button class="btn ghost" id="subj_export">Export CSV</button>
      ${writable ? `<button class="btn ghost" id="subj_import">Import CSV/Excel</button><input type="file" id="subj_import_file" accept=".xlsx,.xls,.csv" style="display:none">` : ''}
    </div>
    <p class="mgmt-section-title" id="subjSectionTitle">All Subjects</p>
    <div class="lrn-table-wrap"><table class="lrn-table"><thead><tr>
      <th>Code</th><th>Subject Name</th><th>Type</th><th>Level</th><th>Credits</th><th>Classes</th><th>Status</th><th>Actions</th>
    </tr></thead><tbody id="subj_body"></tbody></table></div>`;

  function filtered(){
    const list = DB.subjects || [];
    const q = ($('subj_search').value || '').toLowerCase();
    return list.filter(r => !q || String(r.code || '').toLowerCase().includes(q) || String(r.name || '').toLowerCase().includes(q));
  }
  function draw(){
    const rows = filtered();
    $('subjCount').textContent = (DB.subjects || []).length + ' subjects in the curriculum';
    $('subjSectionTitle').textContent = `All Subjects (${rows.length})`;
    $('subj_body').innerHTML = rows.length ? rows.map(r => `
      <tr>
        <td><b>${esc(r.code || '—')}</b></td>
        <td>${esc(r.name || '—')}</td>
        <td>${badge(r.type || '—')}</td>
        <td>${esc(r.level || '—')}</td>
        <td>${esc(r.credits == null || r.credits === '' ? '—' : r.credits)}</td>
        <td>${(r.classes || []).length}</td>
        <td>${badge(r.status || 'Active')}</td>
        <td class="rowActions">
          ${writable ? `<button class="icon-btn amber-solid" data-edit="${esc(r.id)}" title="Edit">✎</button>` : ''}
          ${writable ? `<button class="icon-btn danger" data-toggle="${esc(r.id)}" title="${r.status === 'Inactive' ? 'Enable' : 'Disable'}">🚫</button>` : ''}
        </td>
      </tr>`).join('') :
      `<tr><td colspan="8"><div class="empty"><b>No subjects found</b>${writable ? 'Click "+ Add Subject" to create the first one.' : ''}</div></td></tr>`;
  }
  draw();
  $('subj_search').oninput = draw;
  $('subj_export').onclick = () => { const f = keyFields(key); downloadCsv(key, f.map(fieldLabel), (DB[key] || []).map(r => f.map(x => r[x]))); };
  if (writable) {
    $('subj_add').onclick = () => openRecordForm(key, null, draw);
    $('subj_import').onclick = () => $('subj_import_file').click();
    $('subj_import_file').onchange = (e) => { const f = e.target.files[0]; if (f) importExcel(key, f, draw); e.target.value = ''; };
    $('subj_assign').onclick = () => openAssignSubjectsToClasses(draw);
  }
  $('subj_body').onclick = async (e) => {
    const editId = e.target.dataset.edit, toggleId = e.target.dataset.toggle;
    if (editId) openRecordForm(key, (DB.subjects || []).find(r => String(r.id) === editId), draw);
    if (toggleId) await toggleSubjectStatus(toggleId, draw);
  };
}
async function toggleSubjectStatus(id, onDone){
  const rec = (DB.subjects || []).find(r => String(r.id) === id);
  if (!rec) return;
  rec.status = rec.status === 'Inactive' ? 'Active' : 'Inactive';
  const ok = await persist('subjects');
  if (ok) { toast(rec.status === 'Inactive' ? 'Subject disabled.' : 'Subject enabled.'); onDone && onDone(); }
}
// "Assign to Classes" — pick a subject, then tick which grades/classes it's
// taught in. Stored directly on the subject record (r.classes), which is what
// the Subjects table's "Classes" column counts.
function openAssignSubjectsToClasses(onDone){
  const subjects = DB.subjects || [];
  if (!subjects.length) { toast('Add a subject first.'); return; }
  const grades = distinctGrades();
  if (!grades.length) { toast('No classes/grades set up yet — add one under Classes first.'); return; }
  let curId = subjects[0].id;
  const body = () => {
    const s = subjects.find(x => x.id === curId);
    const assigned = new Set(s.classes || []);
    return `<div class="form-grid">
      <label>Subject</label><select class="rf" id="asgSubj">${subjects.map(x => `<option value="${esc(x.id)}" ${x.id === curId ? 'selected' : ''}>${esc(x.code)} — ${esc(x.name)}</option>`).join('')}</select>
    </div>
    <p class="mgmt-section-title" style="margin-top:14px">Classes / Grades</p>
    <div style="display:flex;flex-wrap:wrap;gap:8px">
      ${grades.map(g => `<label style="display:flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:8px;padding:7px 12px;font-size:13px">
        <input type="checkbox" class="asgGrade" value="${esc(g)}" ${assigned.has(g) ? 'checked' : ''}> ${esc(g)}
      </label>`).join('')}
    </div>`;
  };
  function wire(){
    $('asgSubj').onchange = (e) => {
      // Save the ticks for the subject being left before switching to the next one.
      const prev = subjects.find(x => x.id === curId);
      prev.classes = Array.from(document.querySelectorAll('.asgGrade:checked')).map(c => c.value);
      curId = e.target.value;
      $('modalBody').innerHTML = body();
      wire();
    };
  }
  openModal('Assign to Classes', body(), async () => {
    const s = subjects.find(x => x.id === curId);
    s.classes = Array.from(document.querySelectorAll('.asgGrade:checked')).map(c => c.value);
    const ok = await persist('subjects');
    if (ok) toast('Saved.');
    return ok;
  }, { wide: true, saveLabel: 'Save assignment' });
  wire();
}
function renderGenericList(key, el){
  if (!(key in DB)) { el.innerHTML = '<div class="empty"><b>Unknown module</b>This data key does not exist.</div>'; return; }
  const allFields = keyFields(key);                                  // full record shape — used for export/import
  const fields = MODULE_SCHEMAS[key] ? allFields : allFields.slice(0, 6);  // schema modules show every column; dynamic ones stay trimmed
  const writable = canWrite(key);
  const hasPhoto = PHOTO_KEYS.includes(key) && writable;
  const hasGradeFilter = GRADE_FILTER_KEYS.includes(key);
  const grades = hasGradeFilter ? distinctGrades() : [];
  const typeConf = TYPE_FILTER_KEYS[key] || null;
  const typeOpts = typeConf ? (selectOptionsFor(key, typeConf.field) || Array.from(new Set((DB[key] || []).map(r => r[typeConf.field]).filter(Boolean)))) : [];
  const dateField = DATE_FILTER_KEYS[key] || null;
  const reportConf = REPORT_KEYS[key] || null;
  const statusField = STATUS_SUMMARY_KEYS[key] || null;
  const canManageAccounts = key === 'students' && can('users.manage');
  el.innerHTML = `
    <div class="list-toolbar">
      <input type="search" class="search" id="mod_search" placeholder="${key === 'discipline' ? 'Search by admission no…' : 'Search…'}">
      ${hasGradeFilter ? `<select id="mod_grade_filter"><option value="">All grades/classes</option>${grades.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}</select>` : ''}
      ${typeConf ? `<select id="mod_type_filter"><option value="">${esc(typeConf.allLabel)}</option>${typeOpts.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>` : ''}
      ${dateField ? `<input type="date" id="mod_date_from" title="From date"><input type="date" id="mod_date_to" title="To date">` : ''}
      <div class="spacer"></div>
      ${statusField ? `<span id="mod_status_summary" class="muted" style="font-size:12.5px"></span>` : ''}
      <button class="btn ghost" id="mod_export">Export CSV</button>
      ${reportConf && canWrite(key) ? `<button class="btn ghost" id="mod_report">Generate report</button>` : ''}
      ${writable ? `<button class="btn ghost" id="mod_template" title="Download an empty file with the right column headings">Import template</button>` : ''}
      ${writable ? `<button class="btn ghost" id="mod_import">Import CSV/Excel</button><input type="file" id="mod_import_file" accept=".xlsx,.xls,.csv" style="display:none">` : ''}
      ${writable ? `<button class="btn primary" id="mod_add">+ Add</button>` : ''}
    </div>
    <div class="table-wrap"><table class="tbl"><thead><tr>${hasPhoto ? '<th>Photo</th>' : ''}${fields.map(f => `<th>${esc(fieldLabel(f))}</th>`).join('')}<th></th></tr></thead><tbody id="mod_body"></tbody></table></div>`;

  function filteredRows(){
    const list = DB[key] || [];
    const q = ($('mod_search').value || '').toLowerCase();
    const gradeSel = hasGradeFilter ? ($('mod_grade_filter').value || '') : '';
    const typeSel = typeConf ? ($('mod_type_filter').value || '') : '';
    const dFrom = dateField ? ($('mod_date_from').value || '') : '';
    const dTo = dateField ? ($('mod_date_to').value || '') : '';
    // Search looks at every field on the record (not just the visible columns),
    // and matches the displayed text of relation fields too.
    const rows = list.filter(r =>
      (!q || allFields.some(f => String(exportValue(key, f, r)).toLowerCase().includes(q))) &&
      (!gradeSel || r.grade === gradeSel) &&
      (!typeSel || r[typeConf.field] === typeSel) &&
      (!dFrom || String(r[dateField] || '') >= dFrom) &&
      (!dTo || String(r[dateField] || '') <= dTo));
    const descBy = SORT_DESC_KEYS[key], ascBy = SORT_ASC_KEYS[key];
    if (descBy) rows.sort((a, b) => String(b[descBy] || '').localeCompare(String(a[descBy] || '')));
    else if (ascBy) rows.sort((a, b) => String(a[ascBy] || '').localeCompare(String(b[ascBy] || '')));
    return rows;
  }
  function draw(){
    const rows = filteredRows();
    if (statusField) {
      const counts = {};
      rows.forEach(r => { const v = r[statusField] || 'Unset'; counts[v] = (counts[v] || 0) + 1; });
      $('mod_status_summary').textContent = Object.keys(counts).length ?
        Object.keys(counts).sort().map(k => `${k}: ${counts[k]}`).join('  ·  ') : 'No records';
    }
    $('mod_body').innerHTML = rows.length ? rows.map(r => `
      <tr>${hasPhoto ? `<td>${avatarThumb(r)}</td>` : ''}${fields.map(f => `<td>${cellHtml(r[f], key, f)}</td>`).join('')}
      <td class="rowActions">
        ${hasPhoto ? `<button class="icon-btn" data-photo="${esc(r.id)}" title="Upload photo">📷</button>` : ''}
        ${key === 'payments' ? `<button class="icon-btn" data-receipt="${esc(r.id)}" title="View receipt">🧾</button>` : ''}
        ${writable ? `<button class="icon-btn" data-edit="${esc(r.id)}" title="Edit">✎</button>` : ''}
        ${key === 'students' && writable ? `<button class="icon-btn" data-toggle-status="${esc(r.id)}" title="${r.status === 'Inactive' ? 'Activate' : 'Deactivate'}">${r.status === 'Inactive' ? '▶' : '⏸'}</button>` : ''}
        ${canManageAccounts ? `<button class="icon-btn" data-reset-pw="${esc(r.id)}" title="Reset password">🔑</button>` : ''}
        ${canDelete(key) ? `<button class="icon-btn danger" data-del="${esc(r.id)}" title="Delete">🗑</button>` : ''}
      </td></tr>`).join('') :
      `<tr><td colspan="${fields.length + 1 + (hasPhoto ? 1 : 0)}"><div class="empty"><b>No records yet</b>${writable ? 'Click "+ Add" to create the first one.' : 'Nothing has been added here yet.'}</div></td></tr>`;
  }
  draw();
  $('mod_search').oninput = draw;
  if (hasGradeFilter) $('mod_grade_filter').onchange = draw;
  if (typeConf) $('mod_type_filter').onchange = draw;
  if (dateField) { $('mod_date_from').onchange = draw; $('mod_date_to').onchange = draw; }
  // Export writes every field of whatever the filters are currently showing,
  // with readable values (names, not record ids) — the same column headings the
  // Import template uses, so an exported file can always be imported back.
  $('mod_export').onclick = () => {
    const rows = filteredRows();
    if (!rows.length) { toast('There is nothing to export on this screen yet.'); return; }
    downloadCsv(fieldLabel(key), allFields.map(fieldLabel), rows.map(r => allFields.map(f => exportValue(key, f, r))));
  };
  if (reportConf && canWrite(key)) $('mod_report').onclick = () => {
    const rows = filteredRows();
    const table = `<table><thead><tr>${fields.map(f => `<th>${esc(fieldLabel(f))}</th>`).join('')}</tr></thead><tbody>
      ${rows.map(r => `<tr>${fields.map(f => `<td>${esc(exportValue(key, f, r))}</td>`).join('')}</tr>`).join('')}
    </tbody></table>`;
    printHtml(reportConf.title, letterhead(reportConf.title) + `<p class="muted">Generated ${today()} by ${esc((S.user && S.user.name) || '')} · ${rows.length} record${rows.length === 1 ? '' : 's'}</p>` + table);
  };
  if (writable) {
    $('mod_add').onclick = () => openRecordForm(key, null, draw);
    $('mod_template').onclick = () => downloadCsv(fieldLabel(key) + ' import template', allFields.map(fieldLabel), [allFields.map(() => '')]);
    $('mod_import').onclick = () => $('mod_import_file').click();
    $('mod_import_file').onchange = (e) => { const f = e.target.files[0]; if (f) importExcel(key, f, draw); e.target.value = ''; };
  }
  $('mod_body').onclick = async (e) => {
    const editId = e.target.dataset.edit, delId = e.target.dataset.del, photoId = e.target.dataset.photo;
    const toggleId = e.target.dataset.toggleStatus, resetId = e.target.dataset.resetPw;
    if (e.target.dataset.receipt) { openReceipt(e.target.dataset.receipt); return; }
    if (editId) openRecordForm(key, (DB[key] || []).find(r => String(r.id) === editId), draw);
    if (delId) confirmDeleteRecord(key, delId, draw);
    if (photoId) openPhotoUpload(key, photoId, draw);
    if (toggleId) await toggleStudentStatus(toggleId, draw);
    if (resetId) await resetStudentPassword(resetId);
  };
}
/* Deactivate/activate a student — flips the record's own status field (does
   not touch their login account, if they have one). */
async function toggleStudentStatus(id, onDone){
  const rec = (DB.students || []).find(r => String(r.id) === id);
  if (!rec) return;
  rec.status = rec.status === 'Inactive' ? 'Active' : 'Inactive';
  const ok = await persist('students');
  if (ok) { toast(rec.status === 'Inactive' ? 'Student deactivated.' : 'Student activated.'); onDone && onDone(); }
}
/* Reset a student's login password, if their record is linked to one. Reuses
   the same admin reset-password flow as the Users screen. */
async function resetStudentPassword(id){
  const rec = (DB.students || []).find(r => String(r.id) === id);
  if (!rec) return;
  const ur = await apiGet('list_users');
  if (!ur.ok) { toast(ur.error || 'Could not load accounts.'); return; }
  const u = (ur.users || []).find(x => x.role_key === 'student' && String(x.linked_id) === String(id));
  if (!u) { toast('This student has no login account yet.'); return; }
  openResetPassword(u);
}

