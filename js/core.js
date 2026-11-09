'use strict';
/* =====================================================================
   EraMaster — core: helpers, API client, state, permissions, seed data
   ===================================================================== */
const API = 'api/index.php';
const $ = (id) => document.getElementById(id);

/* ---------------- small helpers ---------------- */
// Every piece of user-supplied text goes through esc() before it touches innerHTML.
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function uid(prefix){ return prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3); }
function initials(name){ return String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'; }
function money(n){ return 'KSh ' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pad(n){ return String(n).padStart(2, '0'); }
function fmtDate(d){ return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function today(){ return fmtDate(new Date()); }
function dOff(n){ const d = new Date(); d.setDate(d.getDate() + n); return fmtDate(d); }
function nowTime(){ const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function clone(v){ return JSON.parse(JSON.stringify(v)); }
function daysBetween(a, b){ return Math.round((new Date(b) - new Date(a)) / 86400000); }
function sum(list, f){ return list.reduce((a, x) => a + Number(f ? f(x) : x || 0), 0); }
function htmlToText(h){ const d = document.createElement('div'); d.innerHTML = h; return d.textContent || ''; }
let toastTimer = null;
function toast(msg){
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ---------------- state ---------------- */
const S = { user: null };       // logged-in user (from the server, includes permissions)
let DB = {};                    // all module data, keyed by short name (students, exams, ...)
let VER = {};                   // server version counter per key (optimistic locking)
let APPR = [];                  // approvals visible to me

const MAP_NAMES = ['marks', 'payroll', 'payroll_status', 'attendance', 'staff_attendance', 'comments', 'settings'];
const LIST_NAMES = ['students', 'teachers', 'exams', 'payments', 'books', 'issues', 'inventory', 'vehicles', 'homework', 'transactions',
  'years', 'terms', 'departments', 'houses', 'policies', 'events', 'documents', 'applications', 'parents', 'classes',
  'allocations', 'lessonplans', 'timetable', 'discipline', 'welfare', 'feestructures', 'invoices', 'discounts', 'budgets', 'suppliers',
  'purchases', 'assets', 'maintenance', 'leave', 'reviews', 'training', 'dorms', 'boarding', 'passes', 'clinic_visits', 'medical',
  'announcements', 'messages', 'broadcasts', 'inquiries', 'clubs', 'memberships', 'achievements', 'alumni', 'subjects'];
const ALL_NAMES = LIST_NAMES.concat(MAP_NAMES);

function defaultSettings(){
  return {
    profile: { name: 'Greenhill Academy', motto: '', address: '', phone: '', email: '', principal: '', payTo: '0798978971' },
    term: 'Term 3, ' + new Date().getFullYear(),
    finePerDay: 10,
    grading: [
      { code: 'EE', label: 'Exceeding expectations', min: 80 },
      { code: 'ME', label: 'Meeting expectations', min: 65 },
      { code: 'AE', label: 'Approaching expectations', min: 50 },
      { code: 'BE', label: 'Below expectations', min: 0 },
    ],
  };
}
function blankFor(name){ return name === 'settings' ? defaultSettings() : (MAP_NAMES.includes(name) ? {} : []); }

/* ---------------- permissions ---------------- */
function perms(){ return (S.user && S.user.permissions) || []; }
function can(p){
  if (!p) return true;
  if (Array.isArray(p)) return p.some(x => can(x));
  const ps = perms();
  return ps.includes('*') || ps.includes(p);
}
function isPortalUser(){ const ps = perms(); return ps.includes('portal.parent') || ps.includes('portal.student'); }

/* ---------------- API ---------------- */
async function parseApiResponse(r, action){
  const raw = await r.text();
  try { return JSON.parse(raw); }
  catch (e) {
    const start = raw.indexOf('{');
    if (start > -1) { try { return JSON.parse(raw.slice(start)); } catch (e2) { /* fall through */ } }
    console.error(`Non-JSON response from "${action}" (HTTP ${r.status}). Raw response:`, raw);
    toast(`Server error (HTTP ${r.status}) — see the browser console for the raw response.`);
    return { ok: false, error: `Server returned an unexpected response (HTTP ${r.status}).` };
  }
}
function handleAuthLoss(res, action){
  if (res && res.error === 'Not authenticated' && S.user && action !== 'me' && action !== 'login') {
    S.user = null;
    if (typeof showAuthScreen === 'function') { showAuthScreen('Your session ended. Please log in again.'); }
  }
}
// Every request gets a time limit so a stuck server can never leave the screen spinning forever.
// Bulk actions (import / broadcast / receipts) are allowed longer than ordinary reads and saves.
function apiTimeoutMs(action){ return /^(import_|broadcast_send|dataimport)/.test(action) ? 300000 : 30000; }
const API_QUIET = new Set(['notif_feed', 'notif_list', 'chat_channels', 'chat_poll']);   // background polls: fail silently
async function apiCall(action, opts, query){
  const ctl = (typeof AbortController === 'function') ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), apiTimeoutMs(action)) : null;
  try {
    const qs = query ? '&' + new URLSearchParams(query).toString() : '';
    const r = await fetch(`${API}?action=${encodeURIComponent(action)}${qs}`, Object.assign({}, opts, ctl ? { signal: ctl.signal } : {}));
    const res = await parseApiResponse(r, action);
    handleAuthLoss(res, action);
    return res;
  } catch (netErr) {
    const timedOut = netErr && netErr.name === 'AbortError';
    console.error(timedOut ? 'Timed out calling' : 'Network error calling', action, netErr);
    if (!API_QUIET.has(action)) {
      toast(timedOut ? 'The server took too long to answer — please try again.' : 'Could not reach the server — is Apache/PostgreSQL running?');
    }
    return { ok: false, error: timedOut ? 'The server took too long to answer.' : 'Network error — could not reach the server.' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function apiGet(action, query){ return apiCall(action, { credentials: 'include', headers: { 'X-Requested-With': 'EraMaster', 'ngrok-skip-browser-warning': '1' } }, query); }
function apiPost(action, body){
  return apiCall(action, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'EraMaster', 'ngrok-skip-browser-warning': '1' },
    body: JSON.stringify(body || {}),
  });
}

/* ---------------- data load / save ---------------- */
function normalizeDB(){
  MAP_NAMES.forEach(n => {
    if (Array.isArray(DB[n]) || DB[n] == null || typeof DB[n] !== 'object') DB[n] = blankFor(n);
  });
  LIST_NAMES.forEach(n => { if (!Array.isArray(DB[n])) DB[n] = []; });
  const d = defaultSettings();
  DB.settings = Object.assign(d, DB.settings);
  DB.settings.profile = Object.assign(d.profile, DB.settings.profile || {});
  if (!Array.isArray(DB.settings.grading) || !DB.settings.grading.length) DB.settings.grading = d.grading;
}

/* =====================================================================
   Automatic upkeep — things the system keeps in step by itself, run once
   on every load (and re-run after a save where it matters):
     • the academic year / term that "today" falls inside
     • three terms per academic year, with editable opening/closing dates
     • leave requests that have run their course, and the staff status
       that follows from an approved leave still running today
     • older records written before a field was renamed
   ===================================================================== */
const STAFF_DAY = { start: '08:00', end: '17:00' };   // standard working day
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function ymd(d){ return String(d == null ? '' : d).slice(0, 10); }
function dayName(date){
  const d = new Date(ymd(date) + 'T00:00:00');
  return isNaN(d.getTime()) ? '' : DAY_NAMES[d.getDay()];
}
function inRange(d, a, b){ d = ymd(d); return (!a || d >= ymd(a)) && (!b || d <= ymd(b)); }
function yesNo(v){ return (v === true || v === 'Yes' || v === 'yes' || v === 'true') ? 'Yes' : 'No'; }

// Records saved by older versions used different field names (announcements
// kept the text in `body`, portal inquiries in `fromName`, events had no
// weekday). Fill the current fields in so the table, the form and Import /
// Export all line up on one shape.
function migrateLegacyFields(){
  const out = { announcements: false, inquiries: false, events: false };
  (DB.announcements || []).forEach(r => {
    if (!r.description && r.body) { r.description = r.body; out.announcements = true; }
    if (!r.type) { r.type = 'General'; out.announcements = true; }
  });
  (DB.inquiries || []).forEach(r => {
    if (r.status === 'New') { r.status = 'Open'; out.inquiries = true; }
    if (r.status === 'Responded') { r.status = 'In Progress'; out.inquiries = true; }
    if (!r.status) { r.status = 'Open'; out.inquiries = true; }
    if (!r.name && r.fromName) { r.name = r.fromName; out.inquiries = true; }
    if (!r.source) { r.source = r.fromType ? 'Portal' : 'Walk-in'; out.inquiries = true; }
    if (!r.date) { r.date = today(); out.inquiries = true; }
  });
  (DB.events || []).forEach(r => {
    if (!r.title && r.name) { r.title = r.name; out.events = true; }
    const d = dayName(r.date);
    if (d && r.day !== d) { r.day = d; out.events = true; }
  });
  return out;
}

// Default opening/closing dates for the three terms of a year — only used to
// fill a blank; once an administrator edits them, their dates are kept.
const DEFAULT_TERM_WINDOWS = [['01-05', '04-04'], ['04-28', '08-01'], ['08-25', '11-28']];
function yearOf(rec){
  const m = /(\d{4})/.exec(String((rec && rec.name) || ''));
  return m ? m[1] : String(new Date().getFullYear());
}
function yearTermWindows(yr){
  const y = yearOf(yr);
  return [1, 2, 3].map(i => ({
    n: i,
    name: 'Term ' + i + ', ' + y,
    year: y,
    start: ymd(yr['term' + i + 'Start']) || y + '-' + DEFAULT_TERM_WINDOWS[i - 1][0],
    end: ymd(yr['term' + i + 'End']) || y + '-' + DEFAULT_TERM_WINDOWS[i - 1][1],
  }));
}
function blankYear(y){
  const rec = { id: uid('yr'), name: String(y), start: y + '-01-05', end: y + '-11-28', current: 'Yes' };
  [1, 2, 3].forEach(i => {
    rec['term' + i + 'Start'] = y + '-' + DEFAULT_TERM_WINDOWS[i - 1][0];
    rec['term' + i + 'End'] = y + '-' + DEFAULT_TERM_WINDOWS[i - 1][1];
  });
  return rec;
}
function autoAcademicPeriods(){
  const t = today(), thisYear = String(new Date().getFullYear());
  const out = { years: false, terms: false, settings: false };
  DB.years = DB.years || [];
  DB.terms = DB.terms || [];
  if (!DB.years.some(r => yearOf(r) === thisYear)) { DB.years.push(blankYear(thisYear)); out.years = true; }

  DB.years.forEach(yr => {
    yearTermWindows(yr).forEach(w => {
      if (!yr['term' + w.n + 'Start']) { yr['term' + w.n + 'Start'] = w.start; out.years = true; }
      if (!yr['term' + w.n + 'End']) { yr['term' + w.n + 'End'] = w.end; out.years = true; }
    });
    if (!yr.start) { yr.start = ymd(yr.term1Start); out.years = true; }
    if (!yr.end) { yr.end = ymd(yr.term3End); out.years = true; }
    // The current year is simply the one today falls inside — no manual flag.
    const cur = inRange(t, yr.start, yr.end) ? 'Yes' : 'No';
    if (yesNo(yr.current) !== cur || typeof yr.current === 'boolean') { yr.current = cur; out.years = true; }
  });

  // Every academic year has exactly three terms, and their opening/closing
  // dates are the ones on the year record (editable there or here).
  DB.years.forEach(yr => {
    yearTermWindows(yr).forEach(w => {
      let rec = DB.terms.find(r => String(r.name || '').trim().toLowerCase() === w.name.toLowerCase());
      if (!rec) { rec = { id: uid('tm'), name: w.name, year: w.year, start: '', end: '', current: 'No' }; DB.terms.push(rec); out.terms = true; }
      if (ymd(rec.start) !== w.start) { rec.start = w.start; out.terms = true; }
      if (ymd(rec.end) !== w.end) { rec.end = w.end; out.terms = true; }
      if (rec.year !== w.year) { rec.year = w.year; out.terms = true; }
    });
  });
  let currentTerm = null;
  DB.terms.forEach(r => {
    const cur = inRange(t, r.start, r.end) ? 'Yes' : 'No';
    if (cur === 'Yes') currentTerm = r;
    if (yesNo(r.current) !== cur || typeof r.current === 'boolean') { r.current = cur; out.terms = true; }
  });
  // Between terms (holidays): keep the term that just ended as "current" for
  // reports, rather than leaving the app with no term at all.
  if (!currentTerm) {
    const past = DB.terms.filter(r => ymd(r.end) && ymd(r.end) < t).sort((a, b) => ymd(b.end).localeCompare(ymd(a.end)));
    currentTerm = past[0] || DB.terms[0] || null;
  }
  if (currentTerm && DB.settings.term !== currentTerm.name) { DB.settings.term = currentTerm.name; out.settings = true; }
  return out;
}

// Leave requests look after themselves: one whose dates have passed is closed
// off, and a member of staff on an approved leave that covers today shows as
// "On Leave" until it ends.
function autoLeaveSync(){
  const t = today();
  const out = { leave: false, teachers: false };
  const onLeaveNow = new Set();
  (DB.leave || []).forEach(r => {
    if (!r.dateRequested) { r.dateRequested = t; out.leave = true; }
    const ended = ymd(r.endDate) && ymd(r.endDate) < t;
    if (r.status === 'Approved' && ended) { r.status = 'Completed'; out.leave = true; }
    else if (r.status === 'Pending' && ended) { r.status = 'Expired'; out.leave = true; }
    if (r.status === 'Approved' && inRange(t, r.startDate, r.endDate) && r.teacherId) onLeaveNow.add(r.teacherId);
  });
  (DB.teachers || []).forEach(tc => {
    if (onLeaveNow.has(tc.id)) { if (tc.status !== 'On Leave') { tc.status = 'On Leave'; out.teachers = true; } }
    else if (tc.status === 'On Leave') { tc.status = 'Active'; out.teachers = true; }
  });
  return out;
}

// Runs after every load. Only saves the collections this account is actually
// allowed to write — everything else is simply corrected on screen.
async function autoMaintenance(){
  const keys = new Set();
  const mig = migrateLegacyFields();
  if (mig.announcements && can('communication.send')) keys.add('announcements');
  if (mig.inquiries && can('communication.send')) keys.add('inquiries');
  if (mig.events && can('events.manage')) keys.add('events');
  if (can('setup.manage')) {
    const a = autoAcademicPeriods();
    if (a.years) keys.add('years');
    if (a.terms) keys.add('terms');
    if (a.settings && can(['settings.manage', 'setup.manage'])) keys.add('settings');
  } else {
    autoAcademicPeriods();   // correct the view without saving
  }
  if (can('staff.manage')) {
    const l = autoLeaveSync();
    if (l.leave) keys.add('leave');
    if (l.teachers) keys.add('teachers');
  } else {
    autoLeaveSync();
  }
  if (keys.size) await persist(...Array.from(keys));
}

// School name, motto and logo, wherever they are shown in the app shell.
// Accounts that can read Settings use the live values; student/parent accounts can't, so they use the
// public copy (SCHOOL_PUBLIC, fetched from the public school_profile action by js/branding.js).
let SCHOOL_PUBLIC = { name: '', motto: '', logo: '' };
function brandLogoAbs(){ try { return SCHOOL_PUBLIC.logo ? new URL(SCHOOL_PUBLIC.logo, location.href).href : ''; } catch (e) { return ''; } }
// <img> for printed documents / letterheads (absolute URL, so it also works inside the print window).
function brandLogoImg(h, url){
  let u = url || brandLogoAbs();
  try { if (u) u = new URL(u, location.href).href; } catch (e) { u = ''; }
  return u ? `<img src="${esc(u)}" alt="" style="height:${h || 56}px;width:auto;max-width:120px;object-fit:contain;vertical-align:middle;margin-right:12px">` : '';
}
function applyBranding(){
  const p = (DB.settings && DB.settings.profile) || {};
  const live = typeof VER !== 'undefined' && VER['em_settings'] !== undefined;     // settings really loaded from the server
  const name = (live ? p.name : '') || SCHOOL_PUBLIC.name || p.name || 'Greenhill Academy';
  const motto = live ? (p.motto || '') : (SCHOOL_PUBLIC.motto || '');
  const logo = SCHOOL_PUBLIC.logo || '';
  document.title = 'EraMaster — ' + name;
  // Sidebar: [logo] name, with the motto on its own line underneath.
  const brand = document.querySelector('#sidebar .brand');
  if (brand) brand.innerHTML = `<div class="brand-row">${logo ? `<img class="brand-logo" src="${esc(logo)}" alt="">` : '<span class="brand-emoji">🎓</span>'}<div class="brand-text"><span class="brand-name">${esc(name)}</span>${motto ? `<span class="brand-motto">${esc(motto)}</span>` : ''}</div></div>`;
  // Sign-in page: logo on top, school name, motto underneath, then which sign-in this is.
  const sub = document.getElementById('authSubtitle');
  if (sub && !S.user) {
    const meta = (typeof PORTAL_META !== 'undefined' && typeof PORTAL !== 'undefined') ? PORTAL_META[PORTAL] : null;
    const label = meta ? String(meta.subtitle || '').replace(/^.*?—\s*/, '') : '';
    sub.innerHTML = `<b class="auth-school">${esc(name)}</b>${motto ? `<span class="auth-motto">${esc(motto)}</span>` : ''}${label ? `<span class="auth-signin">${esc(label)}</span>` : ''}`;
  }
  const al = document.getElementById('authLogo');
  if (al) { if (logo) { al.src = logo; al.hidden = false; } else { al.hidden = true; al.removeAttribute('src'); } }
  if (typeof applyFavicon === 'function') applyFavicon(logo);
  if (typeof applyThemeFromSettings === 'function') applyThemeFromSettings();   // colour theme saved in Settings (js/theme.js)
}

async function loadAll(){
  const res = await apiGet('get_all');
  const d = (res && res.data) || {};
  VER = (res && res.versions) || {};
  ALL_NAMES.forEach(n => { DB[n] = d['em_' + n] !== undefined ? d['em_' + n] : blankFor(n); });
  normalizeDB();
  // Fresh workspace: only an administrator seeds the demo data.
  if (d.em_students === undefined && can('settings.manage')) {
    seedData();
    await persist();
  }
  await autoMaintenance();
  applyBranding();
}

// Saves the named collections (all of them if none are named).
async function persist(...names){
  if (!names.length) names = ALL_NAMES;
  names = Array.from(new Set(names));
  const items = {}, base = {};
  names.forEach(n => { items['em_' + n] = DB[n]; if (VER['em_' + n] !== undefined) base['em_' + n] = VER['em_' + n]; });
  const res = await apiPost('set_all', { items, base });
  if (res && res.ok) { Object.assign(VER, res.versions || {}); return true; }
  toast((res && res.error) || 'Could not save your changes.');
  await loadAll();            // re-sync so the screen matches the database
  return false;
}

async function loadApprovals(){
  if (!can('approvals.view')) { APPR = []; return; }
  const res = await apiGet('approvals_list');
  APPR = (res && res.approvals) || [];
  if (typeof updateApprovalBadge === 'function') updateApprovalBadge();
}
function pendingForMe(){ return APPR.filter(a => a.can_act); }

// Raises a workflow request. `spec` = {type, title, description, effects:{on_create,on_approve,on_reject}}
async function requestApproval(spec){
  const res = await apiPost('approval_create', spec);
  if (!res || !res.ok) { toast((res && res.error) || 'Could not raise the request.'); return false; }
  await loadAll();            // server may have applied on_create effects
  await loadApprovals();
  return true;
}

/* ---------------- lookups ---------------- */
const REFS = {
  students: { list: () => DB.students, label: s => s.name + (s.admNo ? ' · ' + s.admNo : '') },
  teachers: { list: () => DB.teachers, label: t => t.name },
  parents:  { list: () => DB.parents,  label: p => p.name },
  classes:  { list: () => DB.classes,  label: c => c.grade + (c.stream ? ' ' + c.stream : '') },
  dorms:    { list: () => DB.dorms,    label: d => d.name },
  clubs:    { list: () => DB.clubs,    label: c => c.clubName },
  assets:   { list: () => DB.assets,   label: a => a.tag + ' · ' + a.name },
  suppliers:{ list: () => DB.suppliers,label: s => s.name },
};
function refOptions(ref){ const r = REFS[ref]; return r.list().map(o => [o.id, r.label(o)]); }
function refName(ref, id){ const r = REFS[ref]; const o = r.list().find(x => x.id === id); return o ? r.label(o) : '—'; }
function stuName(id){ const s = DB.students.find(x => x.id === id); return s ? s.name : '—'; }
function staffName(id){ const s = DB.teachers.find(x => x.id === id); return s ? s.name : '—'; }
function activeStudents(){ return DB.students.filter(s => s.status === 'Active'); }
function curTerm(){ return DB.settings.term; }
function schoolName(){
  // Same rule as applyBranding(): accounts that can read Settings use the live name; student / parent /
  // teacher accounts can't, so they use the public copy (SCHOOL_PUBLIC) instead of the built-in default.
  const live = typeof VER !== 'undefined' && VER['em_settings'] !== undefined;
  const p = (DB.settings && DB.settings.profile) || {};
  return (live ? p.name : '') || SCHOOL_PUBLIC.name || p.name || 'Greenhill Academy';
}
function myStaff(){
  if (!S.user) return null;
  const mail = String(S.user.email || '').trim().toLowerCase();
  return DB.teachers.find(t => t.id === S.user.linked_id) ||
         (mail && DB.teachers.find(t => String(t.email || '').trim().toLowerCase() === mail)) ||
         DB.teachers.find(t => String(t.name || '').trim().toLowerCase() === String(S.user.name || '').trim().toLowerCase()) || null;
}
function nextAdmNo(){
  const y = new Date().getFullYear();
  let max = 0;
  DB.students.forEach(s => { const m = /(\d+)$/.exec(s.admNo || ''); if (m) max = Math.max(max, Number(m[1])); });
  return `GHA-${y}-${String(max + 1).padStart(3, '0')}`;
}
// STF-<year>-<seq> — same idea as nextAdmNo(), for staff records that don't
// already have a staff number set.
function nextStaffId(){
  const y = new Date().getFullYear();
  let max = 0;
  (DB.teachers || []).forEach(t => { const m = /(\d+)$/.exec(t.staffNo || ''); if (m) max = Math.max(max, Number(m[1])); });
  return `STF-${y}-${String(max + 1).padStart(3, '0')}`;
}
function receiptNo(p){ return p.receipt || 'RCT-' + String(p.id).slice(-6).toUpperCase(); }
function gradeBand(pct){
  const g = DB.settings.grading.slice().sort((a, b) => b.min - a.min);
  const hit = g.find(x => pct >= x.min) || g[g.length - 1];
  const cls = ['b-green', 'b-blue', 'b-amber', 'b-red'][Math.min(g.indexOf(hit), 3)];
  return { code: hit.code, label: hit.label, cls };
}

/* ---------------- status badges ---------------- */
const GOOD = new Set(['Active', 'Approved', 'Completed', 'Paid', 'Present', 'Resolved', 'Closed', 'Good', 'Available', 'Admitted', 'Published', 'Delivered', 'Returned', 'In use', 'Current', 'Cleared', 'Applied', 'Enrolled', 'Done', 'Excellent', 'Sent', 'Online']);
const BAD = new Set(['Suspended', 'Rejected', 'Overdue', 'Poor', 'Lost', 'Critical', 'Expelled', 'Withdrawn', 'Disposed', 'Cancelled', 'Emergency', 'Expired', 'Owing', 'Fully Issued', 'Absent', 'Failed']);
const WARN = new Set(['Pending', 'Pending approval', 'On Leave', 'Fair', 'Waiting list', 'Open', 'Draft', 'Requested', 'Investigating', 'Under Service', 'In Review', 'Returned for changes', 'Major', 'Important', 'Follow-up', 'New', 'Maintenance', 'Under review', 'Invoiced', 'Out', 'Inactive', 'Transferred', 'Scheduled', 'Partial', 'Sending']);
function badge(v){
  if (v === undefined || v === null || v === '') return '—';
  const c = GOOD.has(v) ? 'b-green' : BAD.has(v) ? 'b-red' : WARN.has(v) ? 'b-amber' : 'b-blue';
  return `<span class="badge ${c}">${esc(v)}</span>`;
}
function nameCell(name, sub){
  return `<div class="name-cell"><div class="initial">${esc(initials(name))}</div><div class="nm"><b>${esc(name)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div></div>`;
}
function statCards(list){
  return list.map(s => `<div class="card stat"><div class="icon" style="background:${s[1]}; color:${s[2]};">${s[0]}</div><div class="value">${esc(s[3])}</div><div class="lbl">${esc(s[4])}</div></div>`).join('');
}
const C_G = ['var(--g-100)', 'var(--g-700)'], C_B = ['var(--blue-100)', 'var(--blue)'], C_A = ['var(--amber-100)', '#93650f'], C_R = ['var(--rose-100)', 'var(--rose)'], C_P = ['#f0eafc', '#7a4fb5'];
function stat(ico, c, val, lbl){ return [ico, c[0], c[1], val, lbl]; }
function optionsHtml(list, val){
  return list.map(x => { const [v, l] = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(v)}" ${String(v) === String(val == null ? '' : val) ? 'selected' : ''}>${esc(l)}</option>`; }).join('');
}

/* ---------------- modal ---------------- */
const overlay = () => $('overlay');
function openModal(title, bodyHtml, onSave, opts){
  opts = opts || {};
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = bodyHtml;
  document.querySelector('.modal').classList.toggle('wide', !!opts.wide);
  document.querySelector('.modal-foot').style.display = opts.noFoot ? 'none' : 'flex';
  const saveBtn = $('modalSave');
  const fresh = saveBtn.cloneNode(true);
  fresh.textContent = opts.saveLabel || 'Save';
  saveBtn.parentNode.replaceChild(fresh, saveBtn);
  fresh.disabled = false;
  fresh.addEventListener('click', async () => {
    if (!onSave || fresh.disabled) return;
    fresh.disabled = true;
    try { const ok = await onSave(); if (ok !== false) closeModal(); }
    finally { fresh.disabled = false; }
  });
  overlay().classList.add('show');
}
function closeModal(){ overlay().classList.remove('show'); }
function showInfoModal(title, html){ openModal(title, html, null, { wide: true, noFoot: true }); }

/* ---------------- printing & export ---------------- */
function printHtml(title, bodyHtml, autoPrint){
  if (autoPrint === undefined) autoPrint = true;
  const w = window.open('', '_blank');
  if (!w) { toast('Allow pop-ups for this site to print.'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:28px;max-width:900px;margin:auto}
  h1{font-size:20px;margin:0 0 2px}h2{font-size:15px;margin:18px 0 6px}.muted{color:#555;font-size:12px}
  table{border-collapse:collapse;width:100%;margin-top:8px}th,td{border:1px solid #999;padding:6px 8px;font-size:12px;text-align:left}
  th{background:#eee}.hd{border-bottom:2px solid #175537;padding-bottom:8px;margin-bottom:12px}.sign{margin-top:36px;display:flex;gap:40px}
  .sign div{flex:1;border-top:1px solid #333;padding-top:4px;font-size:12px}
  .print-toolbar{position:sticky;top:0;background:#f4f6f5;padding:10px 0;margin:-28px -28px 18px;text-align:center;border-bottom:1px solid #ddd}
  .print-toolbar button{font-family:inherit;font-size:13px;font-weight:600;padding:8px 18px;border-radius:8px;border:0;background:#175537;color:#fff;cursor:pointer}
  @media print{.print-toolbar{display:none}}</style></head>
  <body>${autoPrint ? '' : '<div class="print-toolbar"><button onclick="window.print()">🖨️ Print / Save as PDF</button></div>'}${bodyHtml}</body></html>`);
  w.document.close(); w.focus();
  if (autoPrint) setTimeout(() => { try { w.print(); } catch (e) { /* user can print manually */ } }, 350);
}
function letterhead(sub){
  const p = DB.settings.profile;
  return `<div class="hd"><div style="display:flex;align-items:center">${brandLogoImg(56)}<div><h1>${esc(p.name)}</h1><div class="muted">${esc([p.address, p.phone, p.email].filter(Boolean).join(' · '))}</div></div></div>${sub ? `<h2>${esc(sub)}</h2>` : ''}</div>`;
}
function downloadCsv(name, head, rows){
  const cell = v => {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;            // stop spreadsheet formula injection
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const csv = [head].concat(rows).map(r => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name.replace(/[^a-z0-9]+/gi, '_').toLowerCase() + '_' + today() + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
}

/* ---------------- tabs helper ---------------- */
const TAB = {};
function mountTabs(el, viewId, tabs){
  const vis = tabs.filter(t => can(t.perm));
  if (!vis.length) { el.innerHTML = '<div class="empty"><b>No access</b>Your role has no tabs in this section.</div>'; return; }
  const cur = vis.find(t => t.id === TAB[viewId]) ? TAB[viewId] : vis[0].id;
  el.innerHTML = `<div class="pill-tabs">${vis.map(t => `<div class="pill ${t.id === cur ? 'active' : ''}" data-tab="${t.id}">${esc(t.label)}</div>`).join('')}</div><div class="tab-body"></div>`;
  el.querySelector('.pill-tabs').onclick = e => {
    const p = e.target.closest('.pill'); if (!p) return;
    TAB[viewId] = p.dataset.tab; mountTabs(el, viewId, tabs);
  };
  vis.find(t => t.id === cur).render(el.querySelector('.tab-body'));
}

/* =====================================================================
   Demo data (fresh workspace or "Reset demo data")
   ===================================================================== */
function seedData(){
  ALL_NAMES.forEach(n => { DB[n] = blankFor(n); });
  const y = new Date().getFullYear();
  DB.settings.term = 'Term 3, ' + y;
  const term = DB.settings.term;
  const pa = [uid('pa'), uid('pa'), uid('pa'), uid('pa'), uid('pa')];
  const st = [uid('st'), uid('st'), uid('st'), uid('st'), uid('st'), uid('st'), uid('st'), uid('st')];
  const tc = [uid('tc'), uid('tc'), uid('tc'), uid('tc')];

  DB.parents = [
    { id: pa[0], name: 'Sarah Cherono', relationship: 'Mother', phone: '0712 345 678', email: 'sarah.cherono@example.com', address: 'Kilimani, Nairobi' },
    { id: pa[1], name: 'James Mwangi', relationship: 'Father', phone: '0722 111 222', email: '', address: 'Lavington, Nairobi' },
    { id: pa[2], name: 'Halima Hassan', relationship: 'Mother', phone: '0733 555 666', email: '', address: 'Kawangware, Nairobi' },
    { id: pa[3], name: 'Mary Wanjiru', relationship: 'Mother', phone: '0700 222 333', email: '', address: 'Spring Valley, Nairobi' },
    { id: pa[4], name: 'Peter Otieno', relationship: 'Father', phone: '0711 909 090', email: '', address: 'Kileleshwa, Nairobi' },
  ];
  const stu = (i, name, adm, grade, gender, pIdx, guardian, phone, balance, status, house) => ({
    id: st[i], name, admNo: adm, grade, stream: 'A', gender, dob: '', house: house || '', status, admissionDate: (y - 1) + '-01-15',
    previousSchool: '', birthCert: '', address: '', medical: '', parentId: pIdx == null ? '' : pa[pIdx], guardian, guardianPhone: phone, balance,
  });
  DB.students = [
    stu(0, 'Winnie Cherono', `GHA-${y}-021`, 'Grade 7', 'Female', 0, 'Sarah Cherono', '0712 345 678', 0, 'Active', 'Simba'),
    stu(1, 'David Mwangi', `GHA-${y}-004`, 'Grade 5', 'Male', 1, 'James Mwangi', '0722 111 222', 0, 'Active', 'Chui'),
    stu(2, 'Fatuma Hassan', `GHA-${y}-003`, 'PP2', 'Female', 2, 'Halima Hassan', '0733 555 666', 1200, 'Active', 'Tembo'),
    stu(3, 'Aisha Wanjiru', `GHA-${y}-005`, 'Grade 3', 'Female', 3, 'Mary Wanjiru', '0700 222 333', 7500, 'Suspended', 'Simba'),
    stu(4, 'Kevin Odhiambo', `GHA-${y}-006`, 'Grade 8', 'Male', null, 'David Odhiambo', '0798 000 111', 0, 'Active', 'Chui'),
    stu(5, 'Brian Otieno', `GHA-${y}-002`, 'Grade 9', 'Male', 4, 'Peter Otieno', '0711 909 090', 3500, 'Active', 'Tembo'),
    stu(6, 'Peter Kamau', `GHA-${y}-022`, 'Grade 7', 'Male', null, 'Jane Kamau', '0788 123 456', 0, 'Active', 'Chui'),
    stu(7, 'Mercy Achieng', `GHA-${y}-023`, 'Grade 7', 'Female', null, 'Rose Achieng', '0799 654 321', 2000, 'Active', 'Simba'),
  ];
  DB.teachers = [
    { id: tc[0], name: 'Mr. Peter Njoroge', qualification: 'MSc. Mathematics', experience: 12, nationalId: '22881323', gender: 'Male', phone: '0700 100 100', email: 'peter.njoroge@example.com', jobTitle: 'Head of Department', assignedClass: 'Grade 7', bankAccount: '', status: 'Active' },
    { id: tc[1], name: 'Ms. Lucy Wambui', qualification: 'BEd Primary Education', experience: 7, nationalId: '24771102', gender: 'Female', phone: '0700 200 200', email: 'lucy.wambui@example.com', jobTitle: 'Class Teacher', assignedClass: 'Grade 5', bankAccount: '', status: 'Active' },
    { id: tc[2], name: 'Mr. Samuel Kiptoo', qualification: 'BSc. Education', experience: 4, nationalId: '25190344', gender: 'Male', phone: '0700 300 300', email: 'samuel.kiptoo@example.com', jobTitle: 'Teacher', assignedClass: 'Grade 8', bankAccount: '', status: 'On Leave' },
    { id: tc[3], name: 'Mrs. Mary Atieno', qualification: 'Diploma in Accounting', experience: 9, nationalId: '19870007', gender: 'Female', phone: '0700 400 400', email: 'mary.atieno@example.com', jobTitle: 'Accounts Clerk', assignedClass: '', bankAccount: '', status: 'Active' },
  ];
  const ex1 = uid('ex'), ex2 = uid('ex');
  DB.exams = [
    { id: ex1, grade: 'Grade 7', stream: 'A', examType: 'Mid Term Exam', academicYear: String(y), term, examDate: dOff(-45), status: 'Published' },
    { id: ex2, grade: 'Grade 7', stream: 'A', examType: 'End Term Exam', academicYear: String(y), term, examDate: dOff(-3), status: 'Draft' },
  ];
  const mk = (a, b, c, d, e, f, g, h) => ({ Mathematics: a, English: b, Kiswahili: c, Science: d, Agriculture: e, 'Social Studies': f, 'C.R.E': g, 'Creative Arts': h });
  DB.marks = {
    [ex1]: { [st[0]]: mk(74, 80, 88, 55, 60, 70, 75, 82), [st[6]]: mk(66, 58, 61, 70, 64, 59, 68, 72), [st[7]]: mk(81, 77, 69, 62, 71, 75, 80, 66) },
    [ex2]: { [st[0]]: mk(78, 85, 92, 58, 65, 72, 79, 86), [st[6]]: mk(70, 61, 64, 73, 66, 62, 70, 75), [st[7]]: mk(84, 79, 72, 65, 74, 78, 83, 69) },
  };
  DB.comments = { [ex1]: { [st[0]]: { teacher: 'Consistent effort. Keep improving Science.', principal: 'Well done.' } } };
  DB.payments = [
    { id: uid('pay'), studentId: st[2], amount: 3000, date: dOff(-100), method: 'M-Pesa', receipt: 'RCT-000101' },
    { id: uid('pay'), studentId: st[3], amount: 12000, date: dOff(-140), method: 'Bank Transfer', receipt: 'RCT-000102' },
    { id: uid('pay'), studentId: st[5], amount: 8000, date: dOff(-160), method: 'M-Pesa', receipt: 'RCT-000103' },
  ];
  DB.payroll = {};
  [65000, 58000, 60000, 45000].forEach((b, i) => { DB.payroll[tc[i]] = { basic: b, allowances: 8000, deductions: 4200, overtime: 0, bonus: 0, loans: 0 }; });
  DB.payroll_status = {};
  DB.books = [
    { id: uid('bk'), title: 'Fluid English Grade 7', author: 'KLB', category: 'Coursebook', isbn: '', shelf: 'A1', copies: 40, available: 39 },
    { id: uid('bk'), title: 'CBC Mathematics Learners Book', author: 'Longhorn', category: 'Coursebook', isbn: '', shelf: 'A2', copies: 35, available: 35 },
    { id: uid('bk'), title: 'Treasure of the Ages', author: 'A. Njoroge', category: 'Fiction', isbn: '', shelf: 'C4', copies: 12, available: 10 },
  ];
  DB.issues = [
    { id: uid('is'), bookId: DB.books[0].id, borrower: 'Winnie Cherono', issueDate: dOff(-20), dueDate: dOff(-6), status: 'Out' },
    { id: uid('is'), bookId: DB.books[2].id, borrower: 'David Mwangi', issueDate: dOff(-5), dueDate: dOff(9), status: 'Out' },
    { id: uid('is'), bookId: DB.books[2].id, borrower: 'Kevin Odhiambo', issueDate: dOff(-3), dueDate: dOff(11), status: 'Out' },
  ];
  DB.inventory = [
    { id: uid('inv'), name: 'Student desks', category: 'Furniture', quantity: 420, reorder: 0, condition: 'Good', location: 'Classrooms', supplier: '', price: 3500, assignedTo: '', warranty: '' },
    { id: uid('inv'), name: 'Laptops (Dell)', category: 'ICT Equipment', quantity: 18, reorder: 0, condition: 'Fair', location: 'Computer Lab', supplier: '', price: 65000, assignedTo: '', warranty: dOff(25) },
    { id: uid('inv'), name: 'A4 printing paper (reams)', category: 'Stationery', quantity: 6, reorder: 20, condition: 'Good', location: 'Store', supplier: 'Fresh Stationers Ltd', price: 650, assignedTo: '', warranty: '' },
    { id: uid('inv'), name: 'Football set', category: 'Sports', quantity: 6, reorder: 0, condition: 'Good', location: 'Store', supplier: '', price: 2500, assignedTo: '', warranty: '' },
  ];
  DB.vehicles = [
    { id: uid('veh'), regNo: 'KDA 214C', route: 'Kileleshwa – Kilimani', stops: '', driver: 'Mr. John Mutua', driverPhone: '', capacity: 33, assigned: 29, status: 'Active', insuranceExpiry: dOff(200), nextService: dOff(14), fee: 6000 },
    { id: uid('veh'), regNo: 'KDB 552F', route: 'Lavington – Kawangware', stops: '', driver: 'Mr. Elisha Koech', driverPhone: '', capacity: 33, assigned: 22, status: 'Active', insuranceExpiry: dOff(12), nextService: dOff(60), fee: 6000 },
    { id: uid('veh'), regNo: 'KDC 771M', route: 'Spring Valley', stops: '', driver: 'Ms. Anne Wairimu', driverPhone: '', capacity: 20, assigned: 0, status: 'Under Service', insuranceExpiry: dOff(90), nextService: dOff(-2), fee: 6000 },
  ];
  DB.homework = [
    { id: uid('hw'), title: 'Fractions worksheet', grade: 'Grade 7', subject: 'Mathematics', teacher: 'Mr. Peter Njoroge', assignedDate: dOff(-3), dueDate: dOff(4), status: 'Open' },
    { id: uid('hw'), title: 'Composition: My Holiday', grade: 'Grade 5', subject: 'English', teacher: 'Ms. Lucy Wambui', assignedDate: dOff(-9), dueDate: dOff(-2), status: 'Open' },
    { id: uid('hw'), title: 'Plant parts diagram', grade: 'Grade 8', subject: 'Science', teacher: 'Mr. Samuel Kiptoo', assignedDate: dOff(-1), dueDate: dOff(11), status: 'Open' },
  ];
  DB.transactions = [
    { id: uid('tx'), date: dOff(-100), description: 'Fee payment — Fatuma Hassan', category: 'School Fees', type: 'Income', method: 'M-Pesa', amount: 3000 },
    { id: uid('tx'), date: dOff(-140), description: 'Fee payment — Aisha Wanjiru', category: 'School Fees', type: 'Income', method: 'Bank Transfer', amount: 12000 },
    { id: uid('tx'), date: dOff(-160), description: 'Fee payment — Brian Otieno', category: 'School Fees', type: 'Income', method: 'M-Pesa', amount: 8000 },
    { id: uid('tx'), date: dOff(-20), description: 'Stationery restock', category: 'Supplies', type: 'Expense', method: 'Cash', amount: 14500 },
    { id: uid('tx'), date: dOff(-25), description: 'Electricity bill', category: 'Utilities', type: 'Expense', method: 'Bank Transfer', amount: 9200 },
  ];
  DB.years = [{ id: uid('yr'), name: String(y), start: y + '-01-05', end: y + '-11-28', current: true }];
  DB.terms = [
    { id: uid('tm'), name: 'Term 1, ' + y, year: String(y), start: y + '-01-05', end: y + '-04-04', current: false },
    { id: uid('tm'), name: 'Term 2, ' + y, year: String(y), start: y + '-04-28', end: y + '-08-01', current: false },
    { id: uid('tm'), name: term, year: String(y), start: y + '-08-25', end: y + '-11-28', current: true },
  ];
  DB.departments = ['Languages', 'Sciences', 'Mathematics', 'Humanities', 'Administration', 'IT', 'Finance'].map(n => ({ id: uid('dp'), name: n, head: '', notes: '' }));
  const subj = (code, name, type, level, credits) => ({ id: uid('sub'), code, name, type, level, credits, classes: [], status: 'Active' });
  DB.subjects = [
    subj('CREATIVE', 'Creative Arts', 'Core', 'All Levels', 2),
    subj('ENG', 'English Language', 'Core', 'All Levels', 5),
    subj('FRENCH', 'French', 'Elective', 'All Levels', 3),
    subj('GH_HIST', 'Ghanaian History', 'Core', 'All Levels', 3),
    subj('GH_LANG', 'Ghanaian Language', 'Core', 'All Levels', 3),
    subj('ICT', 'Information & Communication Technology', 'Core', 'All Levels', 4),
    subj('INT_SCI', 'Integrated Science', 'Core', 'All Levels', 4),
    subj('MATH', 'Mathematics', 'Core', 'All Levels', 5),
    subj('SOC_STD', 'Social Studies', 'Core', 'All Levels', 3),
    subj('RME', 'Religious & Moral Education', 'Core', 'All Levels', 2),
    subj('PE', 'Physical Education', 'Core', 'All Levels', 2),
    subj('MUSIC', 'Music & Dance', 'Elective', 'All Levels', 2),
    subj('BDT', 'Basic Design & Technology', 'Core', 'All Levels', 3),
    subj('CAREER', 'Career Technology', 'Elective', 'All Levels', 2),
  ];
  DB.houses = [['Simba', 'Gold'], ['Chui', 'Green'], ['Tembo', 'Blue']].map(h => ({ id: uid('hs'), name: h[0], colour: h[1], patron: '' }));
  DB.classes = [
    { id: uid('cl'), grade: 'Grade 7', stream: 'A', classTeacherId: tc[1], room: 'Room 7A', capacity: 40 },
    { id: uid('cl'), grade: 'Grade 5', stream: 'A', classTeacherId: '', room: 'Room 5A', capacity: 40 },
  ];
  DB.allocations = [
    { id: uid('al'), grade: 'Grade 7', subject: 'Mathematics', teacherId: tc[0], periods: 6 },
    { id: uid('al'), grade: 'Grade 7', subject: 'English', teacherId: tc[1], periods: 5 },
    { id: uid('al'), grade: 'Grade 7', subject: 'Science', teacherId: tc[2], periods: 5 },
  ];
  DB.timetable = [
    { id: uid('tt'), day: 'Monday', period: '1', kind: 'Lesson', grade: 'Grade 7', stream: 'A', subject: 'Mathematics', teacherId: tc[0], room: 'Room 7A' },
    { id: uid('tt'), day: 'Monday', period: '2', kind: 'Lesson', grade: 'Grade 7', stream: 'A', subject: 'English', teacherId: tc[1], room: 'Room 7A' },
    { id: uid('tt'), day: 'Monday', period: '3', kind: 'Lesson', grade: 'Grade 7', stream: 'A', subject: 'Science', teacherId: tc[2], room: 'Lab 1' },
    { id: uid('tt'), day: 'Tuesday', period: '1', kind: 'Lesson', grade: 'Grade 7', stream: 'A', subject: 'English', teacherId: tc[1], room: 'Room 7A' },
  ];
  DB.events = [
    { id: uid('ev'), title: "Parents' meeting", type: 'Parents meeting', date: dOff(9), endDate: '', audience: 'Everyone', grade: '', venue: 'School hall', notes: '' },
    { id: uid('ev'), title: 'Sports day', type: 'Sports day', date: dOff(21), endDate: '', audience: 'Everyone', grade: '', venue: 'Playing field', notes: '' },
    { id: uid('ev'), title: 'End Term exams begin', type: 'Exam', date: dOff(35), endDate: dOff(40), audience: 'Everyone', grade: '', venue: '', notes: '' },
    { id: uid('ev'), title: 'Staff meeting', type: 'Staff meeting', date: dOff(3), endDate: '', audience: 'Staff', grade: '', venue: 'Staff room', notes: '' },
  ];
  DB.announcements = [
    { id: uid('an'), title: 'Term fees deadline', body: 'Please clear all outstanding balances before the end-term exams.', audience: 'Parents', grade: '', priority: 'Important', date: dOff(-2), postedBy: 'Administration' },
    { id: uid('an'), title: 'Welcome back', body: 'Welcome to the new term. Uniform checks begin Monday.', audience: 'Everyone', grade: '', priority: 'Normal', date: dOff(-20), postedBy: 'Administration' },
  ];
  DB.feestructures = [
    { id: uid('fs'), name: 'Tuition', category: 'Tuition', grade: 'All', term: 'Every term', amount: 25000, applies: 'All students' },
    { id: uid('fs'), name: 'Activities', category: 'Activities', grade: 'All', term: 'Every term', amount: 3000, applies: 'All students' },
    { id: uid('fs'), name: 'Boarding', category: 'Boarding', grade: 'All', term: 'Every term', amount: 15000, applies: 'Boarders' },
    { id: uid('fs'), name: 'Transport', category: 'Transport', grade: 'All', term: 'Every term', amount: 6000, applies: 'Optional' },
  ];
  DB.budgets = [
    { id: uid('bg'), category: 'Utilities', period: String(y), amount: 200000, notes: '' },
    { id: uid('bg'), category: 'Supplies', period: String(y), amount: 120000, notes: '' },
    { id: uid('bg'), category: 'Salaries', period: String(y), amount: 3000000, notes: '' },
  ];
  DB.suppliers = [
    { id: uid('sp'), name: 'Fresh Stationers Ltd', contactPerson: '', phone: '', email: '', category: 'Stationery', address: '', notes: '' },
    { id: uid('sp'), name: 'Longhorn Publishers', contactPerson: '', phone: '', email: '', category: 'Textbooks', address: '', notes: '' },
  ];
  DB.assets = [
    { id: uid('as'), tag: 'ICT-0001', name: 'Dell Latitude laptop', category: 'ICT', department: 'Mathematics', location: 'Computer Lab', assignedTo: tc[0], purchaseDate: (y - 2) + '-03-01', cost: 65000, lifeYears: 4, salvage: 5000, warranty: dOff(-30), status: 'In use', condition: 'Good', disposalDate: '' },
  ];
  DB.clubs = [
    { id: uid('cb'), clubName: 'Drama club', memberName: 'Winnie Cherono', role: 'Member', status: 'Active' },
    { id: uid('cb'), clubName: 'Football team', memberName: 'Peter Kamau', role: 'Leader', status: 'Active' },
    { id: uid('cb'), clubName: 'Football team', memberName: 'Mercy Achieng', role: 'Member', status: 'Active' },
  ];
  DB.memberships = [
    { id: uid('mb'), clubName: 'Drama club', activities: 'Weekly rehearsals and school-term drama productions.' },
    { id: uid('mb'), clubName: 'Football team', activities: 'Training Tue & Thu 4pm; inter-school league matches.' },
  ];
  DB.achievements = [
    { id: uid('ac'), achievement: 'Regional 7-a-side champions', year: String(y), principal: 'Mrs. Jane Kariuki' },
    { id: uid('ac'), achievement: 'Best actress — inter-school drama festival', year: String(y), principal: 'Mrs. Jane Kariuki' },
  ];
  DB.dorms = [
    { id: uid('dm'), name: 'Mt Kenya', gender: 'Girls', capacity: 30, houseParent: tc[1], notes: '' },
    { id: uid('dm'), name: 'Kilimanjaro', gender: 'Boys', capacity: 30, houseParent: '', notes: '' },
  ];
  DB.attendance = {
    [dOff(-1) + '|Morning']: { [st[0]]: { s: 'P', n: '' }, [st[6]]: { s: 'L', n: 'Bus delay' }, [st[7]]: { s: 'AU', n: '' } },
  };
}
