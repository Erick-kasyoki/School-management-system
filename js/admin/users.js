'use strict';
/* admin/users.js — Administration \u2192 Users.
   Part of the EraMaster frontend — loaded after core.js. */

/* ---------------- administration: users ---------------- */
let USERS_LOADED = [];
/* Record picker for Student / Parent logins — lists the real records (so nobody has to copy an ID by hand)
   and marks the ones that already have an account. Falls back to a text box if the records can't be read. */
function linkPickerHtml(role, current, id){
  const isStu = role === 'student', isPar = role === 'parent';
  const list = (isStu ? DB.students : isPar ? DB.parents : DB.teachers) || [];
  if (!list.length) return `<input id="${id}" value="${esc(current || '')}" placeholder="record ID">`;
  const group = x => (x === 'student' || x === 'parent') ? x : 'staff';
  const taken = new Set(USERS_LOADED.filter(x => group(x.role_key) === group(role) && x.linked_id && x.linked_id !== current).map(x => String(x.linked_id)));
  const label = r => isStu ? `${r.name}${r.admNo ? ' · ' + r.admNo : ''}${r.grade ? ' · ' + r.grade : ''}`
    : isPar ? `${r.name}${r.phone ? ' · ' + r.phone : ''}${r.email ? ' · ' + r.email : ''}`
    : `${r.name}${r.staffNo ? ' · ' + r.staffNo : ''}${r.email ? ' · ' + r.email : ''}`;
  return `<select id="${id}"><option value="">— not linked —</option>${list.slice().sort((a, b) => String(a.name).localeCompare(String(b.name))).map(r =>
    `<option value="${esc(r.id)}" ${String(r.id) === String(current || '') ? 'selected' : ''} ${taken.has(String(r.id)) ? 'disabled' : ''}>${esc(label(r))}${taken.has(String(r.id)) ? ' — already has an account' : ''}</option>`).join('')}</select>`;
}
async function renderUsers(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const [ur, rr] = await Promise.all([apiGet('list_users'), apiGet('roles_list')]);
  if (!ur.ok) { el.innerHTML = `<div class="empty">${esc(ur.error || 'Could not load users.')}</div>`; return; }
  const roles = (rr.ok && rr.roles) || [];
  USERS_LOADED = ur.users;
  el.innerHTML = `<div class="list-toolbar">
      <input id="usrSearch" placeholder="Search name, e-mail or role…">
      <div class="spacer"></div>
      <span class="muted" style="font-size:12.5px">${ur.users.length} account${ur.users.length === 1 ? '' : 's'}</span>
      <button class="btn ghost" id="usrExport">Export CSV</button>
      <button class="btn ghost" id="usrTemplate">Import template</button>
      <button class="btn ghost" id="usrImport">Import CSV</button>
      <input type="file" id="usrImportFile" accept=".csv" style="display:none">
      <button class="btn primary" id="addUser">+ Add user</button>
    </div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last login</th><th></th></tr></thead><tbody id="usrBody"></tbody></table></div>`;
  const roleLabel = u => u.is_admin ? 'Super Administrator' : (u.role_label || u.role_key || '');
  function shown(){
    const q = ($('usrSearch').value || '').toLowerCase();
    return ur.users.filter(u => !q || [u.name, u.email, roleLabel(u)].some(v => String(v || '').toLowerCase().includes(q)));
  }
  function draw(){
    const rows = shown();
    $('usrBody').innerHTML = rows.length ? rows.map(u => `<tr><td>${nameCell(u.name, u.email)}</td><td>${esc(u.email)}</td>
      <td>${u.is_admin ? '<span class="badge b-green">Super Administrator</span>' : esc(u.role_label || u.role_key)}${(u.role_key === 'student' || u.role_key === 'parent') && !u.linked_id ? ' <span class="badge b-amber" title="This login can\'t see anything until it is linked to a record. Click ✎ to link it.">Not linked</span>' : ''}</td>
      <td>${badge(u.is_active ? 'Active' : 'Suspended')}</td><td>${esc((u.last_login_at || '').slice(0, 10) || 'Never')}</td>
      <td class="rowActions"><button class="icon-btn" data-edit="${esc(u.id)}">✎</button></td></tr>`).join('')
      : `<tr><td colspan="6"><div class="empty">No accounts match that search.</div></td></tr>`;
  }
  draw();
  $('usrSearch').oninput = draw;
  $('usrBody').onclick = (e) => { const id = e.target.dataset.edit; if (id) openUserEdit(ur.users.find(x => x.id === id), roles); };
  $('addUser').onclick = () => openUserCreate(roles);
  const USER_COLS = ['Full name', 'Email', 'Role', 'Status', 'Last login', 'Linked record ID'];
  // Export every account currently listed, and take the same columns back in on
  // import — so a filled-in export (or the blank template) creates the accounts.
  $('usrExport').onclick = () => {
    const rows = shown();
    if (!rows.length) { toast('There are no accounts to export.'); return; }
    downloadCsv('System users', USER_COLS, rows.map(u => [u.name, u.email, roleLabel(u),
      u.is_active ? 'Active' : 'Suspended', (u.last_login_at || '').slice(0, 10) || 'Never', u.linked_id || '']));
  };
  $('usrTemplate').onclick = () => downloadCsv('Users import template', USER_COLS,
    [['Jane Doe', 'jane.doe@school.ac.ke', (roles.find(r => r.role_key !== 'super_admin') || {}).label || 'Staff', 'Active', '', '']]);
  $('usrImport').onclick = () => $('usrImportFile').click();
  $('usrImportFile').onchange = async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    let rows;
    try { rows = parseCsvText(await file.text()); }
    catch (err) { console.error(err); toast('Could not read that file — save it as CSV and try again.'); return; }
    if (!rows.length) { toast('That file has no rows.'); return; }
    const pick = (row, names) => { const k = Object.keys(row).find(h => names.includes(normHeader(h)) && String(row[h]).trim() !== ''); return k ? String(row[k]).trim() : ''; };
    const roleKeyFor = txt => {
      const t = normHeader(txt);
      const hit = roles.find(r => normHeader(r.label) === t || normHeader(r.role_key) === t);
      return hit && hit.role_key !== 'super_admin' ? hit.role_key : '';
    };
    const known = new Set(ur.users.map(u => String(u.email || '').toLowerCase()));
    let added = 0; const problems = [];
    for (const row of rows) {
      const name = pick(row, ['fullname', 'name', 'username']);
      const email = pick(row, ['email', 'emailaddress']).toLowerCase();
      const roleTxt = pick(row, ['role', 'rolekey', 'rolelabel', 'accounttype']);
      const linked = pick(row, ['linkedrecordid', 'linkedid', 'recordid']);
      if (!name || !email) { problems.push(`${name || email || 'a row'}: needs both a name and an e-mail`); continue; }
      if (known.has(email)) continue;  // already on the system
      const role_key = roleKeyFor(roleTxt) || 'staff';
      const res = await apiPost('create_user', { name, email, role_key, password: '', linked_id: linked });
      if (res.ok) { added++; known.add(email); } else problems.push(`${email}: ${res.error || 'could not be created'}`);
    }
    const skipped = rows.length - added - problems.length;
    let msg = `Import finished — ${added} account${added === 1 ? '' : 's'} created`;
    if (skipped > 0) msg += `, ${skipped} already on the system`;
    if (problems.length) msg += `, ${problems.length} could not be created (${problems.slice(0, 2).join('; ')})`;
    toast(msg + '.');
    if (added) toast('New accounts get an auto-generated password — use Reset password to set and e-mail each one.');
    renderView();
  };
}
function roleOptionsHtml(roles, val){ return roles.filter(r => r.role_key !== 'super_admin').map(r => `<option value="${esc(r.role_key)}" ${r.role_key === val ? 'selected' : ''}>${esc(r.label)}</option>`).join(''); }
function openUserCreate(roles){
  openModal('Add user', `<div class="form-grid">
    <label>Full name</label><input id="nuName">
    <label>Email</label><input id="nuEmail" type="email">
    <label>Role</label><select id="nuRole">${roleOptionsHtml(roles, 'staff')}</select>
    <label>Temporary password (blank = auto-generate)</label><input id="nuPw" type="password">
  </div>
  <div id="nuLinkWrap" style="display:none;margin-top:4px">
    <label id="nuLinkLabel">Linked record</label>
    <div id="nuLinkHolder"></div>
    <p class="muted" style="font-size:12px;margin:6px 0 0">Student and Parent roles: required — choose the person this login belongs to. Staff roles: optional — choose their staff record so Apply for Leave, My Profile etc. know who they are. Each record can only have one account.</p>
  </div>`, async () => {
    const res = await apiPost('create_user', { name: $('nuName').value, email: $('nuEmail').value, role_key: $('nuRole').value, password: $('nuPw').value, linked_id: ($('nuLink') ? $('nuLink').value.trim() : '') });
    if (!res.ok) { toast(res.error || 'Could not create user.'); return false; }
    toast('User created — temporary password: ' + res.temp_password);
    renderView(); return true;
  });
  const toggleLink = () => {
    const r = $('nuRole').value;
    $('nuLinkWrap').style.display = 'block';
    $('nuLinkLabel').textContent = ['student', 'parent'].includes(r) ? 'Linked ' + r + ' record' : 'Linked staff record (optional)';
    $('nuLinkHolder').innerHTML = linkPickerHtml(r, '', 'nuLink');
  };
  $('nuRole').onchange = toggleLink;
  toggleLink();
}
function openUserEdit(u, roles){
  // A Super Administrator's role/status stay locked as before — only the staff-record link can be set.
  const adm = !!u.is_admin;
  openModal('Edit — ' + u.name, `<div class="form-grid" ${adm ? 'style="display:none"' : ''}>
      <label>Role</label><select id="euRole">${roleOptionsHtml(roles, u.role_key)}</select>
      <label>Account status</label><select id="euStatus"><option value="1" ${u.is_active ? 'selected' : ''}>Active</option><option value="0" ${!u.is_active ? 'selected' : ''}>Suspended</option></select>
    </div>
    <div id="euLinkWrap" style="margin-top:4px">
      <label id="euLinkLabel">Linked record</label>
      <div id="euLinkHolder"></div>
      <p class="muted" style="font-size:12px;margin:6px 0 0" id="euLinkHelp"></p>
    </div>
    ${adm ? '' : `<div class="modal-extra-actions">
      <button class="btn ghost" id="euReset" type="button">Reset password</button>
      <button class="btn ghost danger" id="euDelete" type="button">Delete account</button>
    </div>`}`, async () => {
    const link = $('euLink') ? $('euLink').value.trim() : (u.linked_id || '');
    const body = adm ? { id: u.id, linked_id: link } : { id: u.id, role_key: $('euRole').value, linked_id: link };
    const r1 = await apiPost('set_user_role', body);
    if (!r1.ok) { toast(r1.error || 'Could not update the account.'); return false; }
    if (!adm) {
      const r2 = await apiPost('set_user_status', { id: u.id, is_active: $('euStatus').value === '1' });
      if (!r2.ok) { toast(r2.error || 'Could not update status.'); return false; }
    }
    // Editing your own login: pick up the new link straight away (no sign-out needed).
    if (S.user && S.user.id === u.id) S.user.linked_id = link || null;
    toast('Updated.'); renderView(); return true;
  });
  const toggleLink = () => {
    const r = adm ? 'super_admin' : $('euRole').value, stuPar = ['student', 'parent'].includes(r);
    $('euLinkLabel').textContent = stuPar ? 'Linked ' + r + ' record' : (adm ? 'Linked staff record (not needed)' : 'Linked staff record (optional)');
    $('euLinkHelp').textContent = stuPar
      ? 'Until this is set, the parent/student can sign in but sees nothing. (They can also link themselves with their name and phone / admission number.)'
      : (adm ? 'Not needed. The Super Administrator works across every screen without being tied to any staff record; link one only if you also want your own leave and profile to show under it.'
             : 'Optional. Links this login to a staff record so Apply for Leave, My Profile and similar screens know who they are. (Matching e-mail or name is also picked up automatically.)');
    $('euLinkHolder').innerHTML = linkPickerHtml(r, (adm || r === u.role_key || !stuPar && !['student','parent'].includes(u.role_key)) ? u.linked_id : '', 'euLink');
  };
  if (!adm) $('euRole').onchange = toggleLink;
  toggleLink();
  setTimeout(() => {
    if ($('euReset')) $('euReset').onclick = () => openResetPassword(u);
    if ($('euDelete')) $('euDelete').onclick = async () => {
      if (!confirm('Delete this account? This cannot be undone.')) return;
      const res = await apiPost('delete_user', { id: u.id });
      if (res.ok) { toast('Account deleted.'); closeModal(); renderView(); } else toast(res.error || 'Could not delete account.');
    };
  }, 0);
}
function suggestPassword(){
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let pw;
  do { pw = Array.from({ length: 10 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(''); }
  while (!/[A-Za-z]/.test(pw) || !/\d/.test(pw));
  return pw;
}
function openResetPassword(u){
  openModal('Reset password — ' + u.name, `
    <p class="muted" style="margin-top:0;font-size:13px">Set the new password for this account yourself. It, plus a one-time verification code, will be e-mailed to <b>${esc(u.email)}</b> — the account must enter that code once, the next time it signs in.</p>
    <div class="form-grid">
      <label>New password</label><input id="rpPw1" type="password" autocomplete="new-password">
      <label>Confirm new password</label><input id="rpPw2" type="password" autocomplete="new-password">
    </div>
    <p><a href="#" id="rpSuggest">Suggest a password</a></p>
    <label style="display:flex;align-items:center;gap:8px;font-weight:400;margin-top:6px">
      <input type="checkbox" id="rpForce" style="width:auto" checked>
      Require this person to change their password immediately after they next sign in
    </label>
    <p class="muted" style="font-size:12px">At least 8 characters, with letters and numbers.</p>`, async () => {
    const pw1 = $('rpPw1').value, pw2 = $('rpPw2').value;
    if (pw1 !== pw2) { toast('The two passwords do not match.'); return false; }
    const res = await apiPost('reset_password', { id: u.id, new_password: pw1, force_change: $('rpForce').checked });
    if (!res.ok) { toast(res.error || 'Could not reset password.'); return false; }
    // Nothing is e-mailed: the administrator gives the user the temporary password and the one-time code in person.
    setTimeout(() => openModal('Password reset — give these to the user',
      `<p class="muted" style="margin:0 0 10px">Pass these on privately. The code is asked for at their next sign-in.</p>
       <label>Temporary password</label><input readonly onclick="this.select()" value="${esc(res.temp_password)}">
       <label>One-time code</label><input readonly onclick="this.select()" value="${esc(res.otp)}">`, null, { noFoot: true }), 120);
    return true;
  }, { saveLabel: 'Reset password' });
  setTimeout(() => { $('rpSuggest').onclick = (e) => { e.preventDefault(); $('rpPw1').value = $('rpPw2').value = suggestPassword(); }; }, 0);
}

