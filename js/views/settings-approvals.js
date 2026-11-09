'use strict';
/* views/settings-approvals.js — School Settings and the Approvals inbox.
   Part of the EraMaster frontend — loaded after core.js. */

/* ---------------- school settings (map, not a list) ---------------- */
function renderSettings(el){
  const s = DB.settings, p = s.profile;
  const manage = can('settings.manage');
  el.innerHTML = `<div class="form-grid">
    <label>School name</label><input id="setName" ${manage ? '' : 'disabled'} value="${esc(p.name)}">
    <label>Motto</label><input id="setMotto" ${manage ? '' : 'disabled'} value="${esc(p.motto)}">
    <label>Address</label><input id="setAddress" ${manage ? '' : 'disabled'} value="${esc(p.address)}">
    <label>Phone</label><input id="setPhone" ${manage ? '' : 'disabled'} value="${esc(p.phone)}">
    <label>Email</label><input id="setEmail" ${manage ? '' : 'disabled'} value="${esc(p.email)}">
    <label>Principal</label><input id="setPrincipal" ${manage ? '' : 'disabled'} value="${esc(p.principal)}">
    <label>M-Pesa / pay-to</label><input id="setPayTo" ${manage ? '' : 'disabled'} value="${esc(p.payTo)}">
    <label>Current term</label><input id="setTerm" ${manage ? '' : 'disabled'} value="${esc(s.term)}">
    <label>Late fine per day</label><input id="setFine" ${manage ? '' : 'disabled'} value="${esc(s.finePerDay)}">
  </div>${manage ? `<button class="btn primary" id="saveSettings" style="margin-top:16px">Save settings</button>` : ''}`;
  if (manage) $('saveSettings').onclick = async () => {
    Object.assign(p, { name: $('setName').value, motto: $('setMotto').value, address: $('setAddress').value, phone: $('setPhone').value, email: $('setEmail').value, principal: $('setPrincipal').value, payTo: $('setPayTo').value });
    s.term = $('setTerm').value; s.finePerDay = Number($('setFine').value) || 0;
    const ok = await persist('settings');
    // The school name and motto saved here are what the whole system shows —
    // sidebar, page title, letterheads and the public portal.
    if (ok) { applyBranding(); toast('Settings saved.'); }
  };
  // School logo upload card (js/views/logo-admin.js) — shown on the sidebar, sign-in pages, landing page and reports.
  if (typeof renderLogoManager === 'function') renderLogoManager(el, manage);
  // Business hours & calendar targets card (js/views/business-hours.js) — working days/hours, holidays, breach warning.
  if (typeof renderBusinessHours === 'function') renderBusinessHours(el, manage);
  // Theme customization card (js/views/theme-settings.js) — appended below the school details.
  if (typeof renderThemeCustomizer === 'function') renderThemeCustomizer(el, manage);
  // Homepage photo slideshow manager (js/views/slideshow-admin.js) — add / remove / reorder photos.
  if (typeof renderSlideshowManager === 'function') renderSlideshowManager(el, manage);
}

/* ---------------- approvals inbox ---------------- */
// How long a pending request has been open, counting only business hours (js/views/business-hours.js).
function approvalSlaChip(a){
  if (a.status !== 'Pending' || typeof businessMinutesBetween !== 'function' || !a.created_at) return '—';
  const cfg = bhGet(), mins = businessMinutesBetween(a.created_at, Date.now(), cfg), st = bhSlaState(mins, cfg);
  return `<span class="sla-chip ${st === 'ok' ? '' : st}" title="Target ${esc(cfg.targetHours)}h of working time; warns at ${esc(cfg.warnPct)}%">${esc(bhFmtMins(mins))}${st === 'breach' ? ' · overdue' : st === 'warn' ? ' · due soon' : ''}</span>`;
}
function renderApprovals(el){
  el.innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Title</th><th>Type</th><th>Requested by</th><th>Status</th><th>Current step</th><th>Open (working time)</th><th></th></tr></thead><tbody id="aprBody"></tbody></table></div>`;
  const body = $('aprBody');
  body.innerHTML = APPR.length ? APPR.map(a => {
    const step = a.steps[a.current_step];
    return `<tr><td>${esc(a.title)}</td><td>${esc(a.type)}</td><td>${esc(a.requested_by_name)}</td><td>${badge(a.status)}</td>
      <td>${step ? esc(step.label) : '—'}</td>
      <td>${approvalSlaChip(a)}</td>
      <td class="rowActions">
        ${a.can_act ? `<button class="btn tiny primary" data-act="approve" data-id="${esc(a.id)}">Approve</button> <button class="btn tiny danger" data-act="reject" data-id="${esc(a.id)}">Reject</button>` : ''}
        ${a.mine && a.status === 'Pending' ? `<button class="btn tiny ghost" data-cancel="${esc(a.id)}">Cancel</button>` : ''}
      </td></tr>`;
  }).join('') : `<tr><td colspan="7"><div class="empty"><b>Nothing pending</b>Approval requests raised from other screens (results, purchases, refunds, salary changes…) will show up here.</div></td></tr>`;
  body.onclick = async (e) => {
    const id = e.target.dataset.id, act = e.target.dataset.act, cancelId = e.target.dataset.cancel;
    if (id && act) {
      const res = await apiPost('approval_act', { id, decision: act });
      if (res.ok) { toast(act === 'approve' ? 'Approved.' : 'Rejected.'); await loadAll(); await loadApprovals(); renderView(); }
      else toast(res.error || 'Could not record your decision.');
    }
    if (cancelId) {
      const res = await apiPost('approval_cancel', { id: cancelId });
      if (res.ok) { toast('Cancelled.'); await loadApprovals(); renderView(); } else toast(res.error || 'Could not cancel.');
    }
  };
}

