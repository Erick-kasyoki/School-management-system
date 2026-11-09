'use strict';
/* views/statusbar.js — the status strip at the top of the Dashboard:
   the notification bell with its unread count, and the Academic Year / Term selectors. */

const SB_ICON = {
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
};
const sbSvg = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SB_ICON[k]}</svg>`;

function unreadNotifCount(){
  try {
    const st = loadNotifState();
    return st.muted ? 0 : buildNotifications().filter(x => !st.cleared.includes(x.id) && !st.read.includes(x.id)).length;
  } catch (e) { return 0; }
}
function updateStatusBell(n){
  const b = document.getElementById('sbBellCount'); if (!b) return;
  b.textContent = n > 99 ? '99+' : String(n); b.style.display = n ? 'flex' : 'none';
}
function sbPeriodHTML(){
  const years = (DB.years || []).slice().sort((a, b) => yearOf(b).localeCompare(yearOf(a)));
  if (!years.length) return '';
  const cur = currentTerm(), real = realCurrentTerm();
  const curYear = cur ? String(cur.year || yearOf(cur)) : yearOf(years[0]);
  const terms = (DB.terms || []).filter(t => String(t.year) === curYear).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const viewing = cur && real && String(cur.id) !== String(real.id);
  return `
    <div class="sb-item sb-sel"><span class="sb-ico sb-cal">${sbSvg('cal')}</span>
      <label><select id="sbYear" aria-label="Academic year">${years.map(y => `<option value="${esc(yearOf(y))}" ${yearOf(y) === curYear ? 'selected' : ''}>${esc(y.name)}</option>`).join('')}</select><small>Academic Year</small></label></div>
    <div class="sb-item sb-sel">
      <label><select id="sbTerm" aria-label="Term">${terms.map(t => `<option value="${esc(t.id)}" ${cur && String(t.id) === String(cur.id) ? 'selected' : ''}>${esc(String(t.name).split(',')[0])}</option>`).join('')}</select>
        <small>${viewing ? `<a href="#" id="sbReset" class="sb-view">Viewing · back to today</a>` : 'Current Term'}</small></label></div>`;
}
function renderStatusBar(host){
  if (!host) return;
  host.innerHTML = `<div class="sbar">
    <button type="button" class="sb-item sb-bell" id="sbBell" aria-label="Notifications"><span class="sb-ico sb-bellico">${sbSvg('bell')}<i id="sbBellCount" class="sb-count" style="display:none"></i></span></button>
    ${sbPeriodHTML()}
  </div>`;
  updateStatusBell(unreadNotifCount());

  const bell = document.getElementById('sbBell');
  if (bell) bell.onclick = (e) => { e.stopPropagation(); const nb = document.getElementById('notifBtn'); if (nb) nb.click(); };

  const yr = document.getElementById('sbYear'), tm = document.getElementById('sbTerm'), rs = document.getElementById('sbReset');
  const pick = id => { const real = realCurrentTerm(); setViewedTerm(real && String(real.id) === String(id) ? '' : String(id)); renderView(); };
  if (yr) yr.onchange = () => {
    const now = currentTerm(), n = now ? (/Term\s*(\d)/i.exec(now.name) || [])[1] : '1';
    const inYear = (DB.terms || []).filter(t => String(t.year) === yr.value).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const t = inYear.find(x => (/Term\s*(\d)/i.exec(x.name) || [])[1] === n) || inYear[0];
    if (t) pick(t.id); else toast('That academic year has no terms yet.');
  };
  if (tm) tm.onchange = () => pick(tm.value);
  if (rs) rs.onclick = (e) => { e.preventDefault(); setViewedTerm(''); renderView(); };
}
function mountStatusBar(host){
  renderStatusBar(host);
}
