'use strict';
/* views/admissions.js — staff Admissions screen: applications list + the Application Details page. */
let ADM_VIEW = null;
async function renderAdmissions(el){
  if (ADM_VIEW) return admOpen(el, ADM_VIEW);
  el.innerHTML = '<div class="empty">Loading applications…</div>';
  const r = await apiGet('adm_list');
  if (!r.ok) { el.innerHTML = `<div class="empty">${esc(r.error || 'Could not load applications.')}</div>`; return; }
  const link = location.origin + location.pathname.replace(/[^/]*$/, '') + 'apply.html';
  el.innerHTML = `<div class="card panel"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
      <input id="adQ" placeholder="Search name or application no." style="flex:1;min-width:200px">
      <select id="adS"><option value="">All statuses</option>${['Submitted','Under Review','Interview Invited','Approved','Rejected'].map(s => `<option>${s}</option>`).join('')}</select></div>
    <p class="muted" style="font-size:12.5px;margin:0 0 12px">Public application page (share this link): <a href="${esc(link)}" target="_blank">${esc(link)}</a></p>
    <div style="overflow:auto"><table class="tbl"><thead><tr><th>Application</th><th>Applicant</th><th>Class</th><th>Received</th><th>Fee</th><th>Status</th></tr></thead><tbody id="adRows"></tbody></table></div></div>`;
  const draw = () => {
    const q = $('adQ').value.toLowerCase(), st = $('adS').value;
    const rows = r.list.filter(a => (!st || a.status === st) && (a.name + a.appNo).toLowerCase().includes(q));
    $('adRows').innerHTML = rows.map(a => `<tr data-id="${esc(a.id)}" style="cursor:pointer"><td>${esc(a.appNo)}</td><td>${esc(a.name)}</td><td>${esc(a.classApplied)}</td><td>${esc(a.received)}</td><td>${a.paid ? 'Paid' : 'Unpaid'}</td><td>${esc(a.status)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No applications yet.</td></tr>';
    $('adRows').querySelectorAll('tr[data-id]').forEach(t => t.onclick = () => { ADM_VIEW = t.dataset.id; admOpen(el, t.dataset.id); });
  };
  $('adQ').oninput = draw; $('adS').onchange = draw; draw();
}
async function admOpen(el, id, app){
  if (!app) { const r = await apiGet('adm_get', {id}); if (!r.ok) { toast(r.error || 'Could not open it.'); ADM_VIEW = null; return renderAdmissions(el); } app = r.app; }
  el.innerHTML = '<div class="ad-wrap"><button class="btn" id="adBack" style="margin-bottom:12px">← All applications</button><div id="adHost"></div></div>';
  $('adBack').onclick = () => { ADM_VIEW = null; renderAdmissions(el); };
  const manage = can('admissions.manage'), decide = can('admissions.decide');
  ADM.render($('adHost'), app, {
    staff: true, canDecide: decide,
    docUrl: d => `${API}?action=adm_doc&id=${encodeURIComponent(app.id)}&doc=${encodeURIComponent(d)}`,
    edit: manage ? () => admEditModal(el, app) : () => toast('You need the "Manage admissions" permission.'),
    act: async (action, extra) => {
      const okAct = manage || (decide && ['approve', 'reject', 'note'].includes(action));
      if (!okAct) { toast('Your role cannot do that. Only the Administrator processes applications; only the Principal / Headteacher approves or rejects.'); return false; }
      const r = await apiPost('adm_action', Object.assign({id: app.id, action}, extra || {}));
      if (!r.ok) { toast(r.error || 'That did not work.'); return false; }
      if (r.deleted) { ADM_VIEW = null; toast('Application deleted.'); renderAdmissions(el); return; }
      toast('Done.');
      admOpen(el, id, r.app);
    },
  });
}
function admEditModal(el, app){
  const F = [['student','name','Student name'],['student','gender','Gender'],['student','nationality','Nationality'],['student','religion','Religion'],['student','previousSchool','Previous school'],['student','health','Health condition'],['student','bloodGroup','Blood group'],
    ['guardian','name','Guardian name'],['guardian','relationship','Relationship'],['guardian','phone','Phone'],['guardian','whatsapp','WhatsApp'],['guardian','email','Email'],['guardian','occupation','Occupation'],['guardian','address','Address'],
    [null,'classApplied','Class applied for'],[null,'section','Preferred section'],[null,'term','Term']];
  const m = document.createElement('div'); m.className = 'ad-mod';
  m.innerHTML = `<div><h3>Edit Application</h3>${F.map((f, i) => `<label>${f[2]}</label><input data-i="${i}" value="${esc((f[0] ? (app[f[0]] || {})[f[1]] : app[f[1]]) || '')}">`).join('')}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button class="ad-b" id="ex">Cancel</button><button class="ad-b pri" id="eo">Save</button></div></div>`;
  document.body.appendChild(m); m.querySelector('#ex').onclick = () => m.remove();
  m.querySelector('#eo').onclick = async () => {
    const body = {id: app.id, student: {}, guardian: {}};
    m.querySelectorAll('input').forEach(i => { const f = F[i.dataset.i]; f[0] ? body[f[0]][f[1]] = i.value : body[f[1]] = i.value; });
    const r = await apiPost('adm_edit', body);
    if (!r.ok) return toast(r.error || 'Could not save.');
    m.remove(); toast('Saved.'); admOpen(el, app.id, r.app);
  };
}

/* ---- admission notifications for the bell (server-side, per role: Administrator / Principal) ---- */
let ADM_NOTIFS = [];
let ADM_POLLING = false;
async function admPollNotifs(){
  if (ADM_POLLING || document.hidden) return;          // never stack requests, never poll a hidden tab
  ADM_POLLING = true;
  try {
    if (typeof S === 'undefined' || !S.user || (typeof isPortalUser === 'function' && isPortalUser())) return;
    const r = await apiGet('notif_list');
    if (r && r.ok) { ADM_NOTIFS = r.items; if (typeof updateApprovalBadge === 'function') updateApprovalBadge(); }
  } catch (e) { /* offline — try again next time */ }
  finally { ADM_POLLING = false; }
}
setTimeout(admPollNotifs, 2500);
setInterval(admPollNotifs, 30000);
