'use strict';
/* views/portal-dashboard.js — the parent/student portal home screen, plus shared fee/term/attendance helpers used across views.
   Part of the EraMaster frontend — loaded after core.js. */

/* ---------------- parent/student portal dashboard ----------------
   Consumes the server's portal_data action, which is already filtered so a
   parent/student can only ever receive their own linked records. */
let PORTAL_CACHE = null;
/* ---------------- "link my account" (shared by every portal screen) ----------------
   An account can sign in but not yet be tied to its school record. Instead of a dead end, the
   person can prove who they are (parent: name + phone; student: name + admission number — the same
   check sign-up uses) and the account is linked on the spot. The office can still do it for them
   under Administration → Users. */
function portalUnlinkedHtml(res){
  const isParent = res.kind === 'parent';
  return `<div class="card panel" style="max-width:520px;margin:30px auto">
    <h3 style="margin-top:0">Connect your account to your ${isParent ? 'parent / guardian' : 'student'} record</h3>
    <p class="muted" style="font-size:13.5px;margin:0 0 6px">You're signed in, but the school hasn't linked this login to your record yet. Enter your details exactly as the school has them and we'll connect it for you.</p>
    <label>Full name</label><input id="plkName" autocomplete="name" placeholder="${isParent ? 'e.g. Sarah Cherono' : 'e.g. Winnie Cherono'}">
    ${isParent
      ? '<label>Phone number</label><input id="plkPhone" type="tel" autocomplete="tel" placeholder="The number the school has for you">'
      : '<label>Admission number</label><input id="plkAdm" placeholder="e.g. GHA-2026-021">'}
    <button class="btn primary" id="plkGo" style="margin-top:14px;width:100%">Link my account</button>
    <p class="muted" style="font-size:12.5px;margin:12px 0 0">Not working? Ask the school office to link it for you — they can do it in a few seconds.</p>
  </div>`;
}
function wirePortalLink(el, res){
  const go = $('plkGo');
  if (!go) return;
  go.onclick = async () => {
    const isParent = res.kind === 'parent';
    const body = { name: $('plkName').value.trim() };
    if (isParent) body.phone = $('plkPhone').value.trim(); else body.adm_no = $('plkAdm').value.trim();
    go.disabled = true;
    const r = await apiPost('portal_link', body);
    go.disabled = false;
    if (!r.ok) { toast(r.error || 'Could not link your account.'); return; }
    PORTAL_CACHE = null;
    toast('Your account is now linked.');
    renderView();
  };
}
function portalLoadFailed(el, title, res){
  el.innerHTML = `<div class="empty" style="max-width:520px;margin:40px auto"><b>${esc(title)}</b>${esc((res && res.error) || 'Something went wrong.')}<div style="margin-top:14px"><button class="btn primary" id="portalRetry">Try again</button></div></div>`;
  $('portalRetry').onclick = () => renderView();
}
// Shown when the account is linked but no student points at it. For parents it names the parent record
// the login is tied to, so the school office can see exactly which record the student must be linked to.
function portalNoChildrenHtml(res){
  const isParent = res.kind === 'parent';
  if (!isParent) return `<div class="empty"><b>No student record found</b>Please contact the school office.</div>`;
  const d = res.diag || {};
  const rec = d.recordName ? `<div style="margin-top:8px;font-size:12.5px">Your login is linked to the parent record <b>${esc(d.recordName)}</b>${d.recordPhone ? ' (' + esc(d.recordPhone) + ')' : ''}.</div>` : '';
  return `<div class="empty"><b>No children are attached to your record yet</b>The school office needs to open your child's student record and choose you under <i>Linked Parent Record ID</i> (or enter your phone number as the guardian phone). Please contact the school office.${rec}</div>`;
}
function portalShowUnlinked(el, res){ el.innerHTML = portalUnlinkedHtml(res); wirePortalLink(el, res); }

async function renderPortal(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const res = await apiGet('portal_data');
  if (!res.ok) { portalLoadFailed(el, 'Could not load your portal', res); return; }
  PORTAL_CACHE = res;
  if (!res.linked) { portalShowUnlinked(el, res); return; }
  const isParent = res.kind === 'parent';
  let html = '';

  html += `<div class="portal-banner">
    <div class="portal-banner-text">
      <div class="portal-banner-hi">Welcome back${S.user && S.user.name ? ', ' + esc(S.user.name.split(' ')[0]) : ''} 👋</div>
      <div class="portal-banner-sub">${isParent ? "Here's how your family is doing at " : "Here's what's happening at "}${esc((res.school && res.school.name) || schoolName())}.</div>
    </div>
    <div class="portal-banner-icon">${isParent ? '👪' : '🎓'}</div>
  </div>`;

  if (isParent) {
    const me = res.me;
    html += `<div class="card panel" style="margin-bottom:18px">
      <h3>My contact details</h3>
      <div class="form-grid">
        <label>Full name</label><input value="${esc(me.name)}" disabled>
        <label>Phone</label><input id="pfPhone" value="${esc(me.phone)}">
        <label>Email</label><input id="pfEmail" type="email" value="${esc(me.email)}">
        <label>Address</label><input id="pfAddress" value="${esc(me.address)}">
      </div>
      <button class="btn primary" id="pfSave" style="margin-top:12px">Save contact details</button>
    </div>`;
  }

  html += res.children.length ? res.children.map(c => renderChildCard(c, isParent)).join('')
    : portalNoChildrenHtml(res);

  html += `<div class="dash-grid" style="margin-top:18px">
    <div class="card panel"><h3>Announcements</h3>${res.announcements.length ? res.announcements.map(a => `<div class="row-line">${nameCell(a.title, a.date)}<div class="muted" style="font-size:12.5px;margin-top:2px">${esc(a.body || '')}</div></div>`).join('') : '<div class="empty">Nothing posted yet.</div>'}</div>
    <div class="card panel"><h3>Upcoming events</h3>${res.events.length ? res.events.map(e => `<div class="row-line">${nameCell(e.title, e.date)}</div>`).join('') : '<div class="empty">No upcoming events.</div>'}</div>
  </div>`;

  html += `<div class="card panel" style="margin-top:18px">
    <h3>Messages from the school</h3>
    ${res.messages.length ? res.messages.map(m => `<div class="row-line">${nameCell(m.subject || 'Message', m.date)}<div class="muted" style="font-size:12.5px;margin-top:2px">${esc(m.body || m.message || '')}</div></div>`).join('') : '<div class="empty">No messages yet.</div>'}
  </div>`;

  html += `<div class="card panel" style="margin-top:18px">
    <h3>Contact the school</h3>
    <div class="form-grid">
      <label>Type</label><select id="inqType"><option>Inquiry</option><option>Leave request</option><option>Complaint</option><option>Other</option></select>
      <label>Subject</label><input id="inqSubject">
    </div>
    <label>Message</label><textarea id="inqMessage" rows="3" style="width:100%"></textarea>
    <button class="btn primary" id="inqSend" style="margin-top:10px">Send</button>
    <div style="margin-top:16px">${res.inquiries.length ? res.inquiries.map(q => `<div class="row-line">${nameCell(q.subject, q.date)} ${badge(q.status)}${q.reply ? `<div class="muted" style="font-size:12.5px;margin-top:4px"><b>School reply:</b> ${esc(q.reply)}</div>` : ''}</div>`).join('') : '<div class="empty">Nothing sent yet.</div>'}</div>
  </div>`;

  el.innerHTML = html;
  el.querySelectorAll('[data-portal-go]').forEach(b => b.onclick = () => portalOpen(b.dataset.portalGo, b.dataset.child));

  if (isParent) {
    $('pfSave').onclick = async () => {
      const r = await apiPost('portal_update_profile', { phone: $('pfPhone').value.trim(), email: $('pfEmail').value.trim(), address: $('pfAddress').value.trim() });
      if (r.ok) { toast('Saved.'); renderView(); } else toast(r.error || 'Could not save.');
    };
  }
  $('inqSend').onclick = async () => {
    const subject = $('inqSubject').value.trim(), message = $('inqMessage').value.trim();
    if (!subject || !message) { toast('Add a subject and a message.'); return; }
    const r = await apiPost('portal_inquiry', { type: $('inqType').value, subject, message });
    if (r.ok) { toast('Sent.'); renderView(); } else toast(r.error || 'Could not send.');
  };
}
function renderChildCard(c, isParent){
  const att = c.attendance, total = att.present + att.absent, pct = total ? Math.round(att.present / total * 100) : null;
  const latest = c.results && c.results[0];
  const attColor = pct === null ? C_B : pct >= 90 ? C_G : pct >= 75 ? C_A : C_R;
  return `<div class="card panel" style="margin-bottom:18px">
    <h3 style="display:flex;align-items:center;gap:10px">${c.photo ? `<img class="avatar-thumb" src="${esc(c.photo)}" alt="">` : ''}${esc(c.name)}${isParent ? ` <span class="muted" style="font-weight:400;font-size:12.5px">· ${esc(c.admNo)} · ${esc(c.grade)}${c.stream ? ' ' + esc(c.stream) : ''} ${badge(c.status)}</span>` : ''}</h3>
    <div class="stats-grid" style="margin-bottom:14px">
      ${statCards([
        stat('📶', attColor, pct === null ? '—' : pct + '%', 'Attendance (last ' + total + ')'),
        stat('💵', c.balance > 0 ? C_R : C_G, money(c.balance), 'Fees balance'),
        stat('📄', C_B, c.results.length, 'Published results'),
        stat('✏️', C_A, c.homework.length, 'Homework items'),
      ])}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px">
      <button class="btn primary" data-portal-go="portalResults" data-child="${esc(c.id)}">📊 ${isParent ? 'View results' : 'My results'}</button>
      <button class="btn ghost" data-portal-go="portalReport" data-child="${esc(c.id)}">🧾 Report form</button>
    </div>
    ${latest ? `<div class="row-line"><b>Latest result</b> — ${esc(latest.examType)} (${esc(latest.term)}): total ${esc(latest.total)}, rank ${esc(latest.rank)} of ${esc(latest.of)}</div>` : ''}
    ${c.notices && c.notices.length ? `<div class="row-line"><b>Discipline notices</b><br>${c.notices.map(n => esc(n.date + ' — ' + n.category + ': ' + n.action)).join('<br>')}</div>` : ''}
    <details style="margin-top:10px"><summary style="cursor:pointer;font-weight:600;font-size:13px;color:var(--g-700)">Attendance, homework &amp; fee payments</summary>
      <div style="margin-top:10px">
        <b>Recent attendance</b>
        <div class="table-wrap" style="margin:8px 0 14px"><table class="tbl"><thead><tr><th>Date</th><th>Session</th><th>Status</th></tr></thead><tbody>
        ${att.records.slice(0, 10).map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.session)}</td><td>${badge(r.s)}</td></tr>`).join('') || '<tr><td colspan="3"><div class="empty">No records yet.</div></td></tr>'}
        </tbody></table></div>
        <b>Homework</b>
        <div class="table-wrap" style="margin:8px 0 14px"><table class="tbl"><thead><tr><th>Title</th><th>Subject</th><th>Due</th></tr></thead><tbody>
        ${c.homework.slice(0, 10).map(h => `<tr><td>${esc(h.title)}</td><td>${esc(h.subject)}</td><td>${esc(h.dueDate)}</td></tr>`).join('') || '<tr><td colspan="3"><div class="empty">Nothing assigned.</div></td></tr>'}
        </tbody></table></div>
        <b>Fee payments</b>
        <div class="table-wrap" style="margin:8px 0"><table class="tbl"><thead><tr><th>Date</th><th>Amount</th><th>Receipt</th><th>Method</th></tr></thead><tbody>
        ${c.payments.slice(0, 10).map(p => `<tr><td>${esc(p.date)}</td><td>${money(p.amount)}</td><td>${esc(p.receipt)}</td><td>${esc(p.method)}</td></tr>`).join('') || '<tr><td colspan="4"><div class="empty">No payments recorded.</div></td></tr>'}
        </tbody></table></div>
      </div>
    </details>
  </div>`;
}

/* ---------------- shared: fees, term & attendance-today helpers (used by
   Dashboard, Fees Management and Reports) ---------------- */
/* The term everything is shown for. Normally it is the term today falls in; the dashboard's
   Year / Term selector can point it at another term ("viewing"), remembered in this browser. */
function realCurrentTerm(){
  const ts = DB.terms || [];
  return ts.find(t => yesNo(t.current) === 'Yes') || ts.find(t => t.name === (DB.settings && DB.settings.term)) || ts[0] || null;
}
function viewedTermId(){ try { return localStorage.getItem('eramaster-view-term') || ''; } catch (e) { return ''; } }
function setViewedTerm(id){ try { id ? localStorage.setItem('eramaster-view-term', id) : localStorage.removeItem('eramaster-view-term'); } catch (e) { /* not persisted */ } }
function currentTerm(){
  const id = viewedTermId();
  const v = id && (DB.terms || []).find(t => String(t.id) === id);
  return v || realCurrentTerm();
}
function termHeaderLabel(){ const t = currentTerm(); if (!t) return ''; return t.year ? `${t.year} — ${t.name}` : t.name; }
function paymentsForTerm(termName){
  const list = DB.payments || [];
  return termName ? list.filter(p => !p.term || p.term === termName) : list;
}
function feeCollected(termName){ return sum(paymentsForTerm(termName), p => p.amount || 0); }
function feeOutstanding(){ return sum(DB.students || [], s => Math.max(0, Number(s.balance) || 0)); }
function feeTotalDue(termName){ return feeCollected(termName) + feeOutstanding(); }
function owingStudents(){ return (DB.students || []).filter(s => (Number(s.balance) || 0) > 0); }
function presentTodayCount(){
  const rec = (DB.attendance || {})[attKey(today(), 'Full Day')] || {};
  return Object.values(rec).filter(r => r && r.s === 'P').length;
}
function classLabel(c){ return c.grade + (c.stream ? ' ' + c.stream : ''); }
function enrollmentByClass(){
  const classes = DB.classes || [], students = DB.students || [];
  return classes.map(c => ({ label: classLabel(c), count: students.filter(s => s.grade === c.grade && (!c.stream || s.stream === c.stream)).length }));
}
let FEES_TAB = 'structure';

