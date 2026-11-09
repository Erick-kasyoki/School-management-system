'use strict';
/* shell.js — app boot sequence and view routing (goTo/renderView).
   Part of the EraMaster frontend — loaded after core.js. */

/* ---------------- boot ---------------- */
async function bootApp(user, welcomeMsg){
  S.user = user;
  currentViewId = isPortalUser() ? 'portal' : 'dashboard';
  await loadAll();
  await loadApprovals();
  $('authScreen').style.display = 'none';
  $('app').style.display = 'flex';
  buildNav();
  if (typeof startNotifPolling === 'function') startNotifPolling();   // bell: server notifications for every role
  // Show the school name and motto saved in School Settings.
  applyBranding();
  $('tbName').textContent = user.name || '';
  $('tbEmail').textContent = user.email || (user.role_label || user.role || '');
  goTo(currentViewId, true);
  if (welcomeMsg) toast(welcomeMsg);
}
function updateApprovalBadge(){
  const n = pendingForMe().length;
  $('approvalBadgeWrap').innerHTML = n ? `<span class="badge b-amber">${n} awaiting you</span>` : '';
  const st = loadNotifState();
  const unread = st.muted ? 0 : buildNotifications().filter(x => (x.srv || !st.cleared.includes(x.id)) && notifIsUnread(x, st)).length;
  $('notifDot').style.display = unread ? 'block' : 'none';
  if (typeof updateStatusBell === 'function') updateStatusBell(unread);
  if (unread > NOTIF_LAST_UNREAD) notifBellPop();   // a real new notification arrived — bounce the bell
  NOTIF_LAST_UNREAD = unread;
  if ($('notifPop').classList.contains('show')) renderNotifPop();
}

(async function init(){
  const res = await apiGet('me', { portal: PORTAL });
  if (res.ok && res.user) { await bootApp(res.user); }
  else {
    showAuthScreen(res.session_elsewhere
      ? `You're currently signed in elsewhere as ${res.session_elsewhere}. Log in or sign up here to switch to this portal.`
      : null, 'info');
  }
})();

/* ---------------- nav & routing ---------------- */
// Parent/student accounts only ever hold portal.* permissions, so none of the
// staff NAV items above match them — they get this small nav instead.
function portalNav(){
  const label = (S.user && S.user.role_key === 'parent') ? 'Parent Portal' : 'Student Portal';
  return [
    { group: 'Overview', icon: '🏠', items: [
      { id: 'portal', label, icon: '🏠', perm: null, special: 'portal' },
      { id: 'portalResults', label: (S.user && S.user.role_key === 'parent') ? "Children's Results" : 'My Results', icon: '📊', perm: null, special: 'portalResults' },
      { id: 'portalReport', label: 'Report Form', icon: '🧾', perm: null, special: 'portalReport' },
      { id: 'profile', label: 'My Profile', icon: '👤', perm: null, special: 'profile' },
      { id: 'account', label: 'My Account', icon: '⚙️', perm: null, special: 'account' },
    ]},
  ];
}
let CURRENT_NAV = NAV;
let NAV_OPEN_GROUP = null;   // accordion: only one group's items are shown at a time
let NAV_LAST_VIEW = null;    // last currentViewId we auto-synced the open group from
function buildNav(){
  CURRENT_NAV = isPortalUser() ? portalNav() : NAV;
  const el = $('nav');
  // Only re-sync which group is "open" when the current screen actually changed
  // (a real navigation) — not on every re-render, or a plain toggle click on a
  // header would get immediately overridden back to the active screen's group.
  if (currentViewId !== NAV_LAST_VIEW) {
    NAV_LAST_VIEW = currentViewId;
    const activeGroup = CURRENT_NAV.find(g => g.items.some(it => it.id === currentViewId));
    if (activeGroup) NAV_OPEN_GROUP = activeGroup.group;
  }
  el.innerHTML = CURRENT_NAV.map(g => {
    const items = g.items.filter(it => can(it.perm));
    if (!items.length) return '';
    const hasActive = items.some(it => it.id === currentViewId);
    const collapsed = NAV_OPEN_GROUP !== g.group;
    return `<div class="nav-group ${collapsed ? 'collapsed' : ''} ${hasActive ? 'has-active' : ''}" data-group="${esc(g.group)}">
      <div class="nav-group-hd">
        <span class="nav-group-icon">${g.icon || ''}</span>
        <span class="nav-group-label">${esc(g.group)}</span>
        <span class="nav-chev">›</span>
      </div>
      <div class="nav-group-items">
        ${items.map(it => `<div class="nav-item ${it.id === currentViewId ? 'active' : ''}" data-id="${it.id}"><span class="nav-icon">${it.icon}</span>${esc(it.label)}</div>`).join('')}
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('.nav-item').forEach(n => n.onclick = () => goTo(n.dataset.id));
  el.querySelectorAll('.nav-group-hd').forEach(h => h.onclick = () => {
    const grp = h.closest('.nav-group').dataset.group;
    NAV_OPEN_GROUP = (NAV_OPEN_GROUP === grp) ? null : grp; // opening one closes whichever was open before
    buildNav();
  });
}
function findNavItem(id){ for (const g of CURRENT_NAV) { const it = g.items.find(x => x.id === id); if (it) return it; } return null; }
// First screen this person is actually allowed to open (null if their role has none yet).
function firstAllowedItem(){
  for (const g of CURRENT_NAV) { const it = g.items.find(x => can(x.perm)); if (it) return it; }
  return null;
}
function noAccessHtml(title, text, withBack){
  const first = withBack ? firstAllowedItem() : null;
  return `<div class="empty" style="max-width:520px;margin:50px auto"><b>${esc(title)}</b>${esc(text)}${first ? `<div style="margin-top:14px"><button class="btn primary" id="naBack">Go to ${esc(first.label)}</button></div>` : ''}</div>`;
}
function goTo(id, silent){
  // Never land on a screen the person's role can't open — use the first one it can, or explain.
  let item = findNavItem(id);
  if (!item || !can(item.perm)) item = firstAllowedItem();
  if (!item) {
    currentViewId = null; buildNav();
    $('viewTitle').textContent = 'Welcome';
    $('view').innerHTML = noAccessHtml('Your account has no access yet', 'You are signed in, but an administrator still needs to give your account a role. Please ask the school office or an administrator to assign one (Administration → Users), then sign in again.', false);
    closeSidebar();
    return;
  }
  currentViewId = item.id;
  buildNav();
  $('viewTitle').textContent = item.label;
  updateApprovalBadge();
  renderView();
  if (typeof refreshForView === 'function') refreshForView(item.id);   // pick up what other people changed since this screen's data was loaded
  closeSidebar(); // no-op on desktop; on phone/tablet, picking a screen should close the off-canvas menu
}

/* ---------------- mobile sidebar (hamburger) ----------------
   #sidebar is fixed off-canvas below 900px (see CSS); this just toggles the
   class that slides it in/out and dims the rest of the page behind it. */
function openSidebar(){ $('app').classList.add('sidebar-open'); }
function closeSidebar(){ $('app').classList.remove('sidebar-open'); }
function toggleSidebar(){ $('app').classList.toggle('sidebar-open'); }
$('sidebarToggle').onclick = toggleSidebar;
$('sidebarBackdrop').onclick = closeSidebar;
function renderView(){
  const item = findNavItem(currentViewId);
  const el = $('view');
  if (!item) { el.innerHTML = ''; return; }
  if (!can(item.perm)) {
    el.innerHTML = noAccessHtml('You don\'t have access to this page', 'Your role doesn\'t include it. If you think it should, ask an administrator to update your role.', true);
    const b = $('naBack'); if (b) b.onclick = () => goTo(firstAllowedItem().id);
    return;
  }
  if (item.special) {
    const fn = { dashboard: renderDashboard, settings: renderSettings, approvals: renderApprovals,
      users: renderUsers, roles: renderRoles, audit: renderAudit, security: renderSecurity, account: renderAccount, profile: renderProfile, admissions: renderAdmissions,
      portal: renderPortal, portalResults: renderPortalResults, portalReport: renderPortalReport, attendance: renderAttendance, staffAttendance: renderStaffAttendance, results: renderResultsManagement, entermarks: renderTeacherMarks, timetable: renderTimetable,
      fees: renderFeesManagement, receipts: renderReceipts, reports: renderReports, subjects: renderSubjectsManagement, messaging: renderMessaging, chat: renderStaffChat, dataimport: renderDataImport, applyLeave: renderApplyLeave }[item.special];
    fn ? fn(el) : (el.innerHTML = '<div class="empty">Not available.</div>');
  } else if (item.id === 'students') {
    renderStudentsList(el);
  } else if (item.id === 'teachers') {
    renderTeachersList(el);
  } else if (item.id === 'classes') {
    renderClassesList(el);
  } else {
    renderGenericList(item.id, el);
  }
}

