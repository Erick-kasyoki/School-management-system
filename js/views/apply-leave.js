'use strict';
/* apply-leave.js — "Apply for Leave": the one obvious place a staff member
   asks for leave, and sees how their requests are going.
   HR / managers still decide on requests in HR → Leave Requests.
   Relies on core.js (DB, S, persist, myStaff, uid, today, esc, toast, can)
   and crud/schemas.js (selectOptionsFor). */

function alDays(from, to){
  if (!from || !to) return 0;
  const a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00');
  if (isNaN(a) || isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}
function alChip(status){
  const s = String(status || 'Pending');
  const c = s === 'Approved' ? 'b-green' : s === 'Rejected' ? 'b-red' : s === 'Pending' ? 'b-amber' : '';
  return `<span class="badge ${c}">${esc(s)}</span>`;
}

function alTable(rows){
  return rows.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Reason</th><th>Requested</th><th>Status</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td>${esc(r.leaveType)}</td><td>${esc(r.startDate)}</td><td>${esc(r.endDate)}</td><td>${alDays(r.startDate, r.endDate) || '—'}</td><td>${esc(r.reason)}</td><td>${esc(r.dateRequested || '')}</td><td>${alChip(r.status)}</td></tr>`).join('')}
        </tbody></table></div>`
        : '<div class="empty"><b>No requests yet</b>Anything you apply for will show up here.</div>';
}

function renderApplyLeave(el){
  const me = myStaff();
  const manager = can('staff.manage');
  const isSuper = perms().includes('*');   // Super Administrator: needs no staff link, can file / manage leave for anyone
  const types = selectOptionsFor('leave', 'leaveType') || ['Annual Leave', 'Sick Leave', 'Other'];
  const staffOpts = (DB.teachers || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));

  // A login that isn't tied to a staff record can't file leave for itself —
  // unless it's HR, who can file on behalf of someone.
  if (!me && !manager) {
    el.innerHTML = `<div class="empty" style="max-width:520px;margin:50px auto"><b>Your login isn't linked to a staff record yet</b>
      Ask HR or an administrator to link your account to your staff record (or to use the same name / e-mail on both), then come back here to apply for leave.</div>`;
    return;
  }

  const listFor = (id) => (DB.leave || []).filter(r => id && r.teacherId === id)
    .sort((a, b) => String(b.dateRequested || b.startDate || '').localeCompare(String(a.dateRequested || a.startDate || '')));
  const mine = listFor(me ? me.id : '');

  el.innerHTML = `
    <div class="card" style="max-width:720px;margin-bottom:18px">
      <h3 style="margin-top:0">Apply for leave</h3>
      ${manager && !me ? (isSuper ? '<p class="muted" style="margin-top:-4px">As Super Administrator you can file leave on behalf of any staff member — choose who it is for.</p>' : '<p class="muted" style="margin-top:-4px;color:#b45309">Your login isn\'t linked to a staff record, so choose who this leave is for. (Link it under Administration → Users → ✎ → Linked staff record to have it filled in automatically.)</p>') : ''}
      <p class="muted" style="margin-top:-4px">Your request goes to HR, who will approve or decline it. You'll be notified of the decision.</p>
      <div class="form-grid">
        ${manager ? `<label>Staff member</label><select id="al_who">${me ? '' : '<option value="">— choose a staff member —</option>'}${staffOpts.map(t => `<option value="${esc(t.id)}" ${me && me.id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>` : ''}
        <label>Leave type</label><select id="al_type">${types.map(t => `<option>${esc(t)}</option>`).join('')}</select>
        <label>First day</label><input type="date" id="al_from" min="${today()}" value="${today()}">
        <label>Last day</label><input type="date" id="al_to" min="${today()}" value="${today()}">
        <label>Days</label><div id="al_days" class="muted" style="padding-top:8px">1 day</div>
        <label>Reason</label><textarea id="al_reason" rows="3" placeholder="Briefly say why you need the leave"></textarea>
      </div>
      <div id="al_msg" class="muted" style="color:var(--red-600,#b91c1c);min-height:20px;margin-top:8px"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:6px">
        <button class="btn primary" id="al_submit">Submit request</button>
      </div>
    </div>
    <div class="card">
      <h3 style="margin-top:0" id="al_listTitle">${me ? 'My leave requests' : 'Leave requests'}</h3>
      <div id="al_list">${alTable(mine)}</div>
    </div>`;

  const f = $('al_from'), t = $('al_to'), msg = $('al_msg');
  const refresh = () => {
    if (t.value && f.value && t.value < f.value) t.value = f.value;
    t.min = f.value || today();
    const n = alDays(f.value, t.value);
    $('al_days').textContent = n ? `${n} day${n === 1 ? '' : 's'} (calendar days)` : '—';
  };
  f.onchange = refresh; t.onchange = refresh; refresh();
  if (manager && $('al_who')) {
    const redraw = () => { const id = $('al_who').value; $('al_listTitle').textContent = (me && id === me.id) ? 'My leave requests' : 'Leave requests for this person'; $('al_list').innerHTML = alTable(listFor(id)); };
    $('al_who').onchange = redraw; redraw();
  }

  $('al_submit').onclick = async () => {
    msg.textContent = '';
    const teacherId = manager ? $('al_who').value : me.id;
    const reason = $('al_reason').value.trim();
    if (!teacherId) { msg.textContent = 'Choose who the leave is for.'; return; }
    if (!f.value || !t.value) { msg.textContent = 'Choose the first and last day of your leave.'; return; }
    if (t.value < f.value) { msg.textContent = 'The last day can\'t be before the first day.'; return; }
    if (!reason) { msg.textContent = 'Please give a short reason.'; return; }
    const clash = (DB.leave || []).find(r => r.teacherId === teacherId && (r.status === 'Pending' || r.status === 'Approved')
      && String(r.startDate) <= t.value && String(r.endDate) >= f.value);
    if (clash) { msg.textContent = `That overlaps an existing ${String(clash.status).toLowerCase()} request (${clash.startDate} to ${clash.endDate}).`; return; }

    const btn = $('al_submit'); btn.disabled = true; btn.textContent = 'Submitting…';
    const rec = { id: uid('lea'), teacherId, leaveType: $('al_type').value, startDate: f.value, endDate: t.value,
                  reason, status: 'Pending', dateRequested: today() };
    DB.leave = DB.leave || [];
    DB.leave.push(rec);
    const ok = await persist('leave');
    if (ok) {
      toast('Leave request submitted — HR has been notified.');
      if (typeof autoMaintenance === 'function') await autoMaintenance();
      renderApplyLeave(el);
    } else {
      btn.disabled = false; btn.textContent = 'Submit request';
    }
  };
}
