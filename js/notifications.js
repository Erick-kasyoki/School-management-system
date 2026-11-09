'use strict';
/* notifications.js — the bell/notification center (approvals, mentions, etc.).
   Part of the EraMaster frontend — loaded after core.js. */

/* ---------------- notification center ----------------
   A single feed assembled from every module the signed-in user has
   permission to view (approvals, discipline, welfare, announcements,
   messages, inquiries, events, leave, maintenance) — someone without
   e.g. welfare.view will never see a welfare item here, same as they
   can't open the Counselling screen itself. Read/cleared/muted state
   is remembered per browser, keyed to the signed-in user. Items the SERVER
   writes (leave to decide, approvals, marks, messages ...) live in the
   `notifications` table instead and are polled below. */
function myRecentDecided(){
  return APPR.filter(a => a.mine && a.status !== 'Pending')
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
    .slice(0, 5);
}
const NOTIF_TABS = [
  { id: 'all', label: 'All' }, { id: 'updates', label: 'Updates' }, { id: 'approvals', label: 'Approvals' }, { id: 'admissions', label: 'Admissions' }, { id: 'chat', label: 'Messages' },
];
// Students and parents only ever get school updates and messages, so they don't see the staff-only tabs.
const NOTIF_TABS_PORTAL = [ { id: 'all', label: 'All' }, { id: 'updates', label: 'Updates' }, { id: 'chat', label: 'Messages' } ];
function notifTabs(){ return (typeof isPortalUser === 'function' && isPortalUser()) ? NOTIF_TABS_PORTAL : NOTIF_TABS; }
let NOTIF_ACTIVE_TAB = 'all';

/* ---------------- server notifications (every role) ----------------
   The server writes a row to the `notifications` table whenever something concerns a person — a payment, a
   published result, an announcement, an approval waiting for them, a school reply, an absence ... (see
   api/handlers/notify.php). We poll for them here, so students, parents and teachers get a working bell too.
   Read / cleared state for these lives on the server, so it follows the person to any device. */
let NOTIF_SERVER = [];
let NOTIF_POLL_TIMER = null;
let NOTIF_POLL_BUSY = false;
const NOTIF_KINDS = {
  fees:         { tab: 'updates', badge: 'Fees',       cls: 'update',     icon: '💳' },
  announcement: { tab: 'updates', badge: 'Notice',     cls: 'alert',      icon: '📢' },
  alert:        { tab: 'updates', badge: 'Urgent',     cls: 'escalated',  icon: '🚨' },
  event:        { tab: 'updates', badge: 'Event',      cls: 'alert',      icon: '📅' },
  homework:     { tab: 'updates', badge: 'Homework',   cls: 'update',     icon: '📚' },
  results:      { tab: 'updates', badge: 'Results',    cls: 'update',     icon: '📊' },
  attendance:   { tab: 'updates', badge: 'Attendance', cls: 'escalated',  icon: '🕘' },
  leave:        { tab: 'updates', badge: 'Leave',      cls: 'assignment', icon: '🌴' },
  marks:        { tab: 'updates', badge: 'Marks',      cls: 'update',     icon: '✍️' },
  approval:     { tab: 'approvals', badge: 'Approval', cls: 'assignment', icon: '👥' },
  message:      { tab: 'chat',    badge: 'Message',    cls: 'chat',       icon: '💬' },
  inquiry:      { tab: 'chat',    badge: 'Inquiry',    cls: 'chat',       icon: '❓' },
};
// Where a notification opens. Students/parents only have their portal screens, so anything else lands on the portal home.
function notifTargetView(view){
  if (typeof isPortalUser === 'function' && isPortalUser()) return view === 'results' ? 'portalResults' : 'portal';
  // Someone who can only REQUEST leave (HR decides) lands on their own Apply for Leave list, not on the whole register.
  if (view === 'leave' && !can('staff.manage') && findNavItem('applyleave')) return 'applyleave';
  return view || '';
}
function notifIsUnread(n, st){ return n.srv ? !n.read : !st.read.includes(n.id); }
/* ---- keeping the data behind the bell fresh ----
   The app reads the school data once, when someone signs in. A notification can arrive minutes later ("Leave request —
   Jane Doe"), but the Leave Requests list, the approvals inbox, announcements ... were still the OLD copy — so HR got
   a bell with nothing behind it, and approving then failed with "someone else changed the same records".
   Now: when a NEW notification arrives (and whenever one of these screens is opened) the affected collections are
   re-read quietly from the server. Nothing is swapped while a dialog is open or someone is typing — it is retried
   on the next tick. */
let NOTIF_SEEN = null;                    // ids already seen; null until the first poll after sign-in
const NOTIF_PENDING_DATA = new Set();     // collections to re-read
const NOTIF_PENDING_KINDS = new Set();    // kinds of notification that asked for it
let NOTIF_PENDING_APPR = false;           // re-read the approvals inbox too
let NOTIF_REFRESH_BUSY = false;
const NOTIF_DATA = {                      // notification kind -> collections to re-read
  leave: ['leave'], announcement: ['announcements'], alert: ['announcements'], event: ['events'],
  homework: ['homework'], marks: ['exams'], message: ['messages', 'inquiries'], inquiry: ['inquiries'],
};
const NOTIF_REDRAW = {                    // notification kind -> screens that may redraw themselves (never a typing screen like marks entry)
  leave: ['leave', 'applyleave'], announcement: ['announcements'], alert: ['announcements'], event: ['events'],
  homework: ['homework'], message: ['messages', 'inquiries'], inquiry: ['inquiries'], approval: ['approvals'],
};
const NOTIF_VIEW_DATA = {                 // screen opened -> [collections, approvals inbox?] to re-read first
  leave: [['leave'], false], applyleave: [['leave'], false], approvals: [[], true],
  announcements: [['announcements'], false], events: [['events'], false], inquiries: [['inquiries'], false],
  messages: [['messages'], false], homework: [['homework'], false],
};
function notifUserIsBusy(){
  const ov = $('overlay');
  if (ov && ov.classList.contains('show')) return true;                 // a form / dialog is open
  const a = document.activeElement, v = $('view');
  return !!(a && v && v.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));   // typing on a screen
}
// Quiet JSON fetch with a timeout: a request that never answers must not freeze the bell for the rest of the session.
async function notifFetchJson(url, ms){
  const ctl = (typeof AbortController === 'function') ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), ms || 15000) : null;
  try {
    const r = await fetch(url, { credentials: 'include', headers: { 'X-Requested-With': 'EraMaster' }, signal: ctl ? ctl.signal : undefined });
    return await r.json();
  } finally { if (timer) clearTimeout(timer); }
}
// Re-reads these collections (and optionally the approvals inbox). true = something changed, false = nothing new, null = could not reach the server.
async function refreshCollections(names, withApprovals){
  names = Array.from(new Set(names || []));
  if (!S.user || (!names.length && !withApprovals)) return false;
  let changed = false;
  try {
    if (names.length) {
      const res = await notifFetchJson(`${API}?action=get_all&keys=${encodeURIComponent(names.map(n => 'em_' + n).join(','))}`);
      if (!res || !res.ok || !res.data) { if (res && res.error === 'Not authenticated') handleAuthLoss(res, 'get_all'); return null; }
      names.forEach(n => {
        const k = 'em_' + n;
        if (res.data[k] === undefined) return;
        if (JSON.stringify(DB[n]) !== JSON.stringify(res.data[k])) changed = true;
        DB[n] = res.data[k];
        if (res.versions && res.versions[k] !== undefined) VER[k] = res.versions[k];     // keeps later saves from clashing with these changes
      });
      normalizeDB();
      if (names.includes('leave') && typeof autoLeaveSync === 'function') autoLeaveSync();
    }
    if (withApprovals && typeof loadApprovals === 'function') {
      const was = JSON.stringify(APPR);
      await loadApprovals();
      if (JSON.stringify(APPR) !== was) changed = true;
    }
  } catch (e) { return null; }
  return changed;
}
function notifQueueRefresh(n){
  if (!n || (typeof isPortalUser === 'function' && isPortalUser())) return;     // students / parents read their own portal feed, not these collections
  (NOTIF_DATA[n.kind] || []).forEach(name => NOTIF_PENDING_DATA.add(name));
  if (n.kind === 'approval') NOTIF_PENDING_APPR = true;
  NOTIF_PENDING_KINDS.add(n.kind);
}
async function notifRunRefresh(){
  if (NOTIF_REFRESH_BUSY || (!NOTIF_PENDING_DATA.size && !NOTIF_PENDING_APPR)) return;
  if (notifUserIsBusy()) return;                          // never swap data under someone who is mid-edit — retried on the next tick
  NOTIF_REFRESH_BUSY = true;
  const names = Array.from(NOTIF_PENDING_DATA), appr = NOTIF_PENDING_APPR, kinds = Array.from(NOTIF_PENDING_KINDS);
  NOTIF_PENDING_DATA.clear(); NOTIF_PENDING_KINDS.clear(); NOTIF_PENDING_APPR = false;
  let changed = false;
  try { changed = await refreshCollections(names, appr); }
  finally { NOTIF_REFRESH_BUSY = false; }
  if (changed === null) {                                 // server not reachable right now: keep the job for the next tick
    names.forEach(n => NOTIF_PENDING_DATA.add(n)); kinds.forEach(k => NOTIF_PENDING_KINDS.add(k)); if (appr) NOTIF_PENDING_APPR = true;
    return;
  }
  if (changed) {
    updateApprovalBadge();
    if (!notifUserIsBusy() && kinds.some(k => (NOTIF_REDRAW[k] || []).includes(currentViewId))) renderView();
  }
}
// Called by goTo(): opening a screen other people feed (leave, approvals, announcements ...) always shows their latest changes.
async function refreshForView(viewId){
  const cfg = NOTIF_VIEW_DATA[viewId];
  if (!cfg || !S.user || (typeof isPortalUser === 'function' && isPortalUser())) return;
  const changed = await refreshCollections(cfg[0], cfg[1]);
  if (changed === true) {
    updateApprovalBadge();
    if (currentViewId === viewId && !notifUserIsBusy()) renderView();
  }
}
async function loadServerNotifs(){
  if (!S.user || NOTIF_POLL_BUSY) return;
  NOTIF_POLL_BUSY = true;
  try {
    // Quiet on purpose (not apiGet): a dropped connection must not pop a toast every 30 seconds.
    const res = await notifFetchJson(`${API}?action=notif_feed`);
    if (res && res.ok && Array.isArray(res.items)) {
      const before = JSON.stringify(NOTIF_SERVER.map(n => [n.id, n.read]));
      // Unread items we have not seen before = something just happened: queue a re-read of the data behind it.
      const fresh = NOTIF_SEEN ? res.items.filter(n => !n.read && !NOTIF_SEEN.has(n.id)) : [];
      NOTIF_SEEN = new Set(res.items.map(n => n.id));
      NOTIF_SERVER = res.items;
      fresh.forEach(n => notifQueueRefresh(n));
      if (before !== JSON.stringify(NOTIF_SERVER.map(n => [n.id, n.read]))) updateApprovalBadge();
      notifRunRefresh();
    } else if (res && res.error === 'Not authenticated') { stopNotifPolling(); handleAuthLoss(res, 'notif_feed'); }
  } catch (e) { /* offline / server restarting / request timed out — try again on the next tick */ }
  finally { NOTIF_POLL_BUSY = false; }
}
function startNotifPolling(){
  stopNotifPolling();
  loadServerNotifs();
  NOTIF_POLL_TIMER = setInterval(() => { if (!document.hidden) loadServerNotifs(); }, 25000);
}
function stopNotifPolling(){
  if (NOTIF_POLL_TIMER) { clearInterval(NOTIF_POLL_TIMER); NOTIF_POLL_TIMER = null; }
  NOTIF_SERVER = []; NOTIF_SEEN = null;
  NOTIF_PENDING_DATA.clear(); NOTIF_PENDING_KINDS.clear(); NOTIF_PENDING_APPR = false;
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user) loadServerNotifs(); });
async function notifServerMark(action, ids){
  try {
    await fetch(`${API}?action=${action}`, { method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'EraMaster' }, body: JSON.stringify(ids ? { ids } : { all: true }) });
  } catch (e) { /* the next poll will bring the screen back in line */ }
}
function notifStoreKey(){ return 'eramaster-notif-' + ((S.user && (S.user.id || S.user.email)) || 'anon'); }
function loadNotifState(){
  try { const v = JSON.parse(localStorage.getItem(notifStoreKey())); return Object.assign({ read: [], cleared: [], muted: false }, v); }
  catch (e) { return { read: [], cleared: [], muted: false }; }
}
function saveNotifState(st){ try { localStorage.setItem(notifStoreKey(), JSON.stringify(st)); } catch (e) { /* storage unavailable — state just won't persist */ } }
// Best-effort field lookup for modules with no fixed schema (announcements,
// messages, inquiries, leave, maintenance): try each candidate key, case-insensitive.
function genericField(rec, candidates){
  if (!rec) return '';
  const keys = Object.keys(rec);
  for (const cand of candidates) {
    const hit = keys.find(k => k.toLowerCase() === cand.toLowerCase());
    if (hit && rec[hit] != null && rec[hit] !== '') return String(rec[hit]);
  }
  return '';
}
function genericDate(rec){
  if (!rec) return '';
  const hit = Object.keys(rec).find(k => /date|_at$|^time$/i.test(k));
  return hit ? String(rec[hit] || '') : '';
}
function timeAgo(dateStr){
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.round(hrs / 24);
  if (days < 7) return days + 'd ago';
  return dateStr;
}
// Assembles the whole feed. Every source is gated by the same permission
// that guards its own screen — that's what makes this "notify by permission".
function buildNotifications(){
  const items = [];
  const myName = (S.user && S.user.name) || '';
  if (can('approvals.view')) {
    pendingForMe().forEach(a => items.push({ id: 'appr_' + a.id, tab: 'approvals', badge: 'Assignment', badgeCls: 'assignment', icon: '👥',
      title: a.title, desc: `Requested by ${a.requested_by_name || '—'} · ${a.type || ''}`, ts: a.created_at || '', view: 'approvals' }));
    myRecentDecided().forEach(a => items.push({ id: 'apprd_' + a.id, tab: 'approvals', badge: 'Update', badgeCls: 'update', icon: 'ℹ️',
      title: a.title, desc: `Your request was ${String(a.status || '').toLowerCase()}`, ts: a.updated_at || a.created_at || '', view: 'approvals' }));
  }
  if (can('discipline.view')) {
    (DB.discipline || []).forEach(r => {
      if (myName && r.reportedBy === myName) items.push({ id: 'disc_' + r.id, tab: 'assigned', badge: 'Assigned', badgeCls: 'assignment', icon: '📋',
        title: `Discipline case: ${r.studentName || 'Student'}`, desc: `${r.misconductType || 'Incident'} · ${r.grade || ''}${r.stream ? ' ' + r.stream : ''}`, ts: r.incidentDate || '', view: 'discipline' });
      if (['Bullying', 'Fighting', 'Vandalism'].includes(r.misconductType) && r.status === 'Pending')
        items.push({ id: 'escd_' + r.id, tab: 'escalated', badge: 'Escalated', badgeCls: 'escalated', icon: '🚨',
          title: `Unresolved ${r.misconductType}: ${r.studentName || 'Student'}`, desc: `${r.grade || ''}${r.stream ? ' ' + r.stream : ''} · reported by ${r.reportedBy || '—'}`, ts: r.incidentDate || '', view: 'discipline' });
    });
  }
  if (can('welfare.view')) {
    (DB.welfare || []).forEach(r => {
      if (myName && r.counsellorName === myName) items.push({ id: 'wel_' + r.id, tab: 'assigned', badge: 'Assigned', badgeCls: 'assignment', icon: '💬',
        title: `Welfare case: ${r.studentName || 'Student'}`, desc: `${r.counsellingType || 'Session'} · ${r.caseStatus || ''}`, ts: r.counsellingDate || '', view: 'welfare' });
      if (r.referral && r.referral !== 'None' && r.caseStatus !== 'Closed')
        items.push({ id: 'escw_' + r.id, tab: 'escalated', badge: 'Escalated', badgeCls: 'escalated', icon: '🚨',
          title: `Referred: ${r.studentName || 'Student'}`, desc: `Referred to ${r.referral} · ${r.caseStatus || ''}`, ts: r.counsellingDate || '', view: 'welfare' });
    });
  }
  if (can('communication.view')) {
    (DB.announcements || []).forEach(r => items.push({ id: 'ann_' + (r.id || genericField(r, ['title'])), tab: 'all', badge: 'Alert', badgeCls: 'alert', icon: '🔔',
      title: genericField(r, ['title', 'subject', 'name']) || 'Announcement', desc: genericField(r, ['description', 'body', 'message', 'details']), ts: genericDate(r), view: 'announcements' }));
    (DB.messages || []).forEach(r => items.push({ id: 'msg_' + (r.id || ''), tab: 'chat', badge: 'Message', badgeCls: 'chat', icon: '💬',
      title: genericField(r, ['subject', 'title', 'from', 'sender']) || 'New message', desc: genericField(r, ['message', 'body', 'text', 'description']), ts: genericDate(r), view: 'messages' }));
    (DB.inquiries || []).forEach(r => items.push({ id: 'inq_' + (r.id || ''), tab: 'chat', badge: 'Message', badgeCls: 'chat', icon: '💬',
      title: genericField(r, ['subject', 'title', 'name']) || 'New inquiry', desc: genericField(r, ['message', 'body', 'description', 'details']), ts: genericDate(r), view: 'inquiries' }));
  }
  if (can('events.view')) {
    (DB.events || []).forEach(r => items.push({ id: 'evt_' + (r.id || ''), tab: 'all', badge: 'Alert', badgeCls: 'alert', icon: '📅',
      title: genericField(r, ['title', 'name']) || 'Event', desc: genericField(r, ['description', 'details', 'location']), ts: genericDate(r), view: 'events' }));
  }
  // Reminder for the people who DECIDE leave (staff.manage): still pending 2+ days after it was requested.
  // (It used to be counted from the leave START date and shown to everybody who can apply — so it never fired when it should.)
  if (can('staff.manage')) {
    (DB.leave || []).forEach(r => {
      if (!/^pending/i.test(String((r && r.status) || ''))) return;
      const d = String(r.dateRequested || ''), days = d ? daysBetween(d, today()) : 0;
      if (days < 2) return;
      const who = ((DB.teachers || []).find(t => t.id === r.teacherId) || {}).name || 'Staff member';
      items.push({ id: 'leave_' + (r.id || ''), tab: 'approvals', badge: 'Leave', badgeCls: 'assignment', icon: '⏱️',
        title: `Leave request pending ${days}d`, desc: `${who} · ${r.leaveType || 'Leave'} ${r.startDate || ''}${r.endDate ? ' to ' + r.endDate : ''}`, ts: d, view: 'leave' });
    });
  }
  if (can('assets.view')) {
    (DB.maintenance || []).forEach(r => {
      const status = genericField(r, ['status']);
      if (status && /open|pending/i.test(status)) {
        const d = genericDate(r), days = d ? daysBetween(d, today()) : 0;
        if (days >= 3) items.push({ id: 'maint_' + (r.id || ''), tab: 'sla', badge: 'SLA', badgeCls: 'sla', icon: '🛠️',
          title: `Maintenance overdue ${days}d`, desc: genericField(r, ['item', 'asset', 'description']) || 'Needs attention', ts: d, view: 'maintenance' });
      }
    });
  }
  NOTIF_SERVER.forEach(n => {
    const k = NOTIF_KINDS[n.kind] || { tab: 'updates', badge: 'Update', cls: 'update', icon: '🔔' };
    const toDecide = n.kind === 'leave' && can('staff.manage') && String(n.title || '').indexOf('Your leave request') !== 0;
    items.push({ id: 'srv_' + n.id, srv: true, sid: n.id, read: !!n.read, tab: toDecide ? 'approvals' : k.tab, badge: k.badge, badgeCls: toDecide ? 'assignment' : k.cls, icon: k.icon,
      title: n.title, desc: n.body, ts: n.at || '', view: notifTargetView(n.view) });
  });
  if (typeof CHAT !== 'undefined' && CHAT.unreadTotal > 0 && can('communication.view'))
    items.push({ id: 'chatunread_' + CHAT.unreadTotal, tab: 'chat', badge: 'Chat', badgeCls: 'chat', icon: '💬',
      title: `${CHAT.unreadTotal} unread staff chat message${CHAT.unreadTotal === 1 ? '' : 's'}`, desc: 'Open Staff Chat to read and reply.', ts: new Date().toISOString(), view: 'chat' });
  (typeof ADM_NOTIFS !== 'undefined' ? ADM_NOTIFS : []).forEach(n => items.push({ id: 'adm_' + n.id, tab: 'admissions', badge: 'Admissions', badgeCls: 'assignment', icon: '📝',
    title: n.title, desc: n.desc, ts: n.ts, view: 'applications' }));
  items.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
  return items;
}
function renderNotifPop(){
  const st = loadNotifState();
  const all = buildNotifications().filter(n => n.srv || !st.cleared.includes(n.id));
  const tabs = notifTabs();
  if (!tabs.some(t => t.id === NOTIF_ACTIVE_TAB)) NOTIF_ACTIVE_TAB = 'all';
  const counts = { all: all.length };
  tabs.forEach(t => { if (t.id !== 'all') counts[t.id] = 0; });
  all.forEach(n => { if (counts[n.tab] !== undefined) counts[n.tab]++; });
  const unreadCount = all.filter(n => notifIsUnread(n, st)).length;

  $('notifTabs').innerHTML = tabs.map(t => `
    <div class="nc-tab ${NOTIF_ACTIVE_TAB === t.id ? 'active' : ''}" data-tab="${t.id}">${esc(t.label)}${counts[t.id] ? `<span class="nc-tab-count">${counts[t.id]}</span>` : ''}</div>`).join('');

  const shown = NOTIF_ACTIVE_TAB === 'all' ? all : all.filter(n => n.tab === NOTIF_ACTIVE_TAB);
  $('notifList').innerHTML = shown.length ? shown.map(n => {
    const unread = notifIsUnread(n, st);
    return `<div class="nc-item" data-nid="${esc(n.id)}" data-view="${esc(n.view || '')}">
      <div class="nc-item-icon">${n.icon}</div>
      <div class="nc-item-body">
        <span class="nc-item-badge ${n.badgeCls}">${esc(n.badge)}</span>
        <div class="nc-item-title">${esc(n.title)}</div>
        ${n.desc ? `<div class="nc-item-desc">${esc(n.desc)}</div>` : ''}
        <div class="nc-item-time">${esc(timeAgo(n.ts))}</div>
      </div>
      ${unread ? '<span class="nc-item-dot"></span>' : ''}
    </div>`;
  }).join('') : '<div class="notif-empty">Nothing here yet.</div>';

  const badgeEl = $('notifUnreadBadge');
  badgeEl.textContent = unreadCount ? unreadCount + ' unread' : '';
  badgeEl.style.display = unreadCount ? '' : 'none';

  $('notifTabs').onclick = (e) => {
    const t = e.target.closest('[data-tab]'); if (!t) return;
    NOTIF_ACTIVE_TAB = t.dataset.tab;
    renderNotifPop();
  };
  $('notifList').onclick = (e) => {
    const item = e.target.closest('[data-nid]'); if (!item) return;
    const id = item.dataset.nid, view = item.dataset.view;
    const st2 = loadNotifState();
    if (id.startsWith('srv_')) {
      const sid = Number(id.slice(4)), sn = NOTIF_SERVER.find(x => x.id === sid);
      if (sn && !sn.read) { sn.read = true; notifServerMark('notif_read', [sid]); }
    } else if (!st2.read.includes(id)) { st2.read.push(id); saveNotifState(st2); }
    if (view && findNavItem(view)) { closeNotifPop(); goTo(view); }
    else renderNotifPop();
    updateApprovalBadge();
  };
  $('notifMarkAllRead').onclick = (e) => {
    e.preventDefault();
    const st2 = loadNotifState();
    all.forEach(n => { if (!n.srv && !st2.read.includes(n.id)) st2.read.push(n.id); });
    if (all.some(n => n.srv && !n.read)) { NOTIF_SERVER.forEach(n => { n.read = true; }); notifServerMark('notif_read', null); }
    saveNotifState(st2); renderNotifPop(); updateApprovalBadge();
  };
  $('notifClearAll').onclick = (e) => {
    e.preventDefault();
    const st2 = loadNotifState();
    all.forEach(n => { if (!n.srv && !st2.cleared.includes(n.id)) st2.cleared.push(n.id); });
    if (all.some(n => n.srv)) { NOTIF_SERVER = []; notifServerMark('notif_clear', null); }
    saveNotifState(st2); renderNotifPop(); updateApprovalBadge();
  };
  const muteBtn = $('notifMuteBtn');
  muteBtn.textContent = st.muted ? 'Unmute' : 'Mute';
  muteBtn.classList.toggle('muted', !!st.muted);
  $('notifFootTitle').textContent = st.muted ? 'Notifications Muted' : 'Notifications Active';
  $('notifFootSub').textContent = st.muted ? 'Alerts paused on this device' : 'Receiving real-time alerts';
  muteBtn.onclick = () => {
    const st2 = loadNotifState();
    st2.muted = !st2.muted;
    saveNotifState(st2); renderNotifPop(); updateApprovalBadge();
  };
}
// Tracks the unread count as of the last time the bell was checked (see
// updateApprovalBadge in shell.js) so the bounce below only fires when a
// genuinely new notification has arrived — not on every screen navigation,
// which also calls updateApprovalBadge but usually leaves the count unchanged.
let NOTIF_LAST_UNREAD = 0;
// One-off bounce on the bell icon itself, layered on top of the dot's
// continuous "sonar" ripple (pure CSS, see .tb-dot::after) — together this is
// the "wave / pop" effect requested for new notifications.
function notifBellPop(){
  const btn = $('notifBtn');
  if (!btn) return;
  btn.classList.remove('notif-bounce');
  void btn.offsetWidth;                 // force reflow so re-adding the class restarts the animation
  btn.classList.add('notif-bounce');
}
function closeNotifPop(){ $('notifPop').classList.remove('show'); }
$('notifBtn').onclick = (e) => {
  e.stopPropagation();
  const open = $('notifPop').classList.contains('show');
  if (open) { closeNotifPop(); return; }
  renderNotifPop();
  $('notifPop').classList.add('show');
};
$('notifPop').onclick = (e) => e.stopPropagation();
document.addEventListener('click', closeNotifPop);

/* dark mode toggle — persisted per browser */
(function initTheme(){
  if (localStorage.getItem('eramaster-theme') === 'dark') document.body.classList.add('dark');
  $('themeToggle').onclick = () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('eramaster-theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  };
})();

