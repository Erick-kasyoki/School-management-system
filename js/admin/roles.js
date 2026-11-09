'use strict';
/* admin/roles.js — Administration \u2192 Roles (permission editor).
   Part of the EraMaster frontend — loaded after core.js. */

/* ---------------- administration: roles (permission editor) ---------------- */
async function renderRoles(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const res = await apiGet('roles_list');
  if (!res.ok) { el.innerHTML = `<div class="empty">${esc(res.error || 'Could not load roles.')}</div>`; return; }
  const catalogue = res.catalogue || {};
  const adminOnly = res.admin_only || [];
  const totalPerms = Object.values(catalogue).reduce((n, g) => n + Object.keys(g).length, 0);

  el.innerHTML = `<p class="muted" style="margin:0 0 14px;font-size:13px">Every account's permissions come from its role. Tick what a role can do below — changes apply to everyone holding that role immediately. <code>users.manage</code> and <code>roles.manage</code> can only ever belong to the Super Administrator, so they aren't offered here.</p>
    <div class="list-toolbar"><div class="spacer"></div><button class="btn primary" id="addRole">+ New role</button></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Role</th><th>Description</th><th>Permissions</th><th>Type</th><th></th></tr></thead><tbody id="roleBody"></tbody></table></div>`;

  $('roleBody').innerHTML = res.roles.map(r => `<tr>
      <td><b>${esc(r.label)}</b></td>
      <td>${esc(r.description || '—')}</td>
      <td>${r.role_key === 'super_admin' || r.permissions.includes('*') ? 'All' : `${r.permissions.length} / ${totalPerms}`}</td>
      <td>${r.is_system ? badge('Current') : badge('Custom')}</td>
      <td class="rowActions">
        ${r.role_key !== 'super_admin' ? `<button class="icon-btn" data-edit="${esc(r.role_key)}">✎</button>` : ''}
        ${!r.is_system ? `<button class="icon-btn" data-del="${esc(r.role_key)}" title="Delete role">🗑</button>` : ''}
      </td>
    </tr>`).join('');

  $('roleBody').onclick = (e) => {
    const ek = e.target.dataset.edit, dk = e.target.dataset.del;
    if (ek) openRoleEditor(res.roles.find(x => x.role_key === ek), catalogue, adminOnly);
    if (dk) deleteRole(dk);
  };
  $('addRole').onclick = () => openRoleEditor(null, catalogue, adminOnly);
}

async function deleteRole(roleKey){
  if (!confirm('Delete this role? Accounts must be moved off it first.')) return;
  const res = await apiPost('role_delete', { role_key: roleKey });
  if (res.ok) { toast('Role deleted.'); renderView(); } else toast(res.error || 'Could not delete role.');
}

function openRoleEditor(role, catalogue, adminOnly){
  const isNew = !role;
  const current = new Set(isNew ? [] : role.permissions);
  const groupsHtml = Object.entries(catalogue).map(([group, perms]) => {
    const rows = Object.entries(perms).map(([key, label]) => {
      const locked = adminOnly.includes(key);
      const checked = !locked && current.has(key);
      return `<div class="perm-row ${locked ? 'locked' : ''}">
        <input type="checkbox" id="perm_${esc(key)}" value="${esc(key)}" ${checked ? 'checked' : ''} ${locked ? 'disabled' : ''}>
        <label for="perm_${esc(key)}">${esc(label)}${locked ? ' <span style="font-size:11px">(Super Administrator only)</span>' : ''}</label>
      </div>`;
    }).join('');
    return `<div class="perm-group" data-group="${esc(group)}">
      <div class="perm-group-hd"><b>${esc(group)}</b><button type="button" class="mini-link" data-toggle-group="${esc(group)}">Select all</button></div>
      <div class="perm-list">${rows}</div>
    </div>`;
  }).join('');

  openModal(isNew ? 'New role' : 'Edit role — ' + role.label, `
    <div class="form-grid">
      <label>Role name</label><input id="rlLabel" value="${isNew ? '' : esc(role.label)}" placeholder="e.g. Sports Coordinator">
      <label>Description</label><input id="rlDesc" value="${isNew ? '' : esc(role.description || '')}" placeholder="One line describing this role">
    </div>
    <div class="role-count" id="rlCount"></div>
    <div class="perm-groups" id="rlGroups">${groupsHtml}</div>
  `, async () => {
    const label = $('rlLabel').value.trim();
    if (!label) { toast('Give the role a name.'); return false; }
    const checked = Array.from(document.querySelectorAll('#rlGroups input[type=checkbox]:checked:not(:disabled)')).map(i => i.value);
    const res = await apiPost('role_save', {
      role_key: isNew ? '' : role.role_key,
      label, description: $('rlDesc').value.trim(),
      permissions: checked,
    });
    if (!res.ok) { toast(res.error || 'Could not save role.'); return false; }
    toast(isNew ? 'Role created.' : 'Role updated.');
    renderView(); return true;
  }, { wide: true });

  const updateCount = () => {
    const n = document.querySelectorAll('#rlGroups input[type=checkbox]:checked').length;
    $('rlCount').textContent = n + ' permission' + (n === 1 ? '' : 's') + ' selected';
  };
  document.querySelectorAll('#rlGroups input[type=checkbox]').forEach(cb => cb.onchange = updateCount);
  document.querySelectorAll('[data-toggle-group]').forEach(btn => {
    btn.onclick = () => {
      const wrap = btn.closest('.perm-group');
      const boxes = Array.from(wrap.querySelectorAll('input[type=checkbox]:not(:disabled)'));
      const allOn = boxes.every(b => b.checked);
      boxes.forEach(b => { b.checked = !allOn; });
      btn.textContent = allOn ? 'Select all' : 'Clear all';
      updateCount();
    };
  });
  updateCount();
}

