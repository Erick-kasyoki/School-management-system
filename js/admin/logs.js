'use strict';
/* admin/logs.js — Administration \u2192 Audit log and Security events.
   Part of the EraMaster frontend — loaded after core.js. */

/* ---------------- administration: audit log ---------------- */
async function renderAudit(el){
  el.innerHTML = `<div class="list-toolbar"><input type="search" id="auQ" class="search" placeholder="Search summary or user…"><div class="spacer"></div></div><div class="table-wrap"><table class="tbl"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Summary</th></tr></thead><tbody id="auBody"><tr><td colspan="5"><div class="empty">Loading…</div></td></tr></tbody></table></div>`;
  async function load(){
    const res = await apiGet('audit_list', { q: $('auQ').value.trim(), limit: 150 });
    if (!res.ok) { $('auBody').innerHTML = `<tr><td colspan="5"><div class="empty">${esc(res.error || 'Could not load the audit log.')}</div></td></tr>`; return; }
    $('auBody').innerHTML = res.rows.length ? res.rows.map(r => `<tr><td>${esc(String(r.at).slice(0, 19).replace('T', ' '))}</td><td>${esc(r.user_name)}</td><td>${badge(r.action)}</td><td>${esc(r.entity)}</td><td>${esc(r.summary)}</td></tr>`).join('') : `<tr><td colspan="5"><div class="empty">No matching entries.</div></td></tr>`;
  }
  let t = null;
  $('auQ').oninput = () => { clearTimeout(t); t = setTimeout(load, 300); };
  load();
}

/* ---------------- administration: security events ---------------- */
async function renderSecurity(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const res = await apiGet('security_list');
  if (!res.ok) { el.innerHTML = `<div class="empty">${esc(res.error || 'Could not load security events.')}</div>`; return; }
  el.innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th>When</th><th>Type</th><th>Email</th><th>IP</th><th>Detail</th></tr></thead><tbody>
    ${res.rows.length ? res.rows.map(r => `<tr><td>${esc(String(r.at).slice(0, 19).replace('T', ' '))}</td><td>${badge(r.type)}</td><td>${esc(r.email || '—')}</td><td>${esc(r.ip || '—')}</td><td>${esc(r.detail || '—')}</td></tr>`).join('') : `<tr><td colspan="5"><div class="empty">No events yet.</div></td></tr>`}
    </tbody></table></div>`;
}

