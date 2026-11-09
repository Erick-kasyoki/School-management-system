'use strict';
/* views/my-account.js — the My Account screen (profile, password, 2FA).
   Part of the EraMaster frontend — loaded after core.js. */

/* ---------------- my account ---------------- */
function renderAccount(el){
  const u = S.user;
  const isStudent = perms().includes('portal.student');
  el.innerHTML = `
  ${isStudent ? `<div class="card panel" style="margin-bottom:16px">
    <h3>My profile photo</h3>
    <div class="photo-upload-card">
      <img class="photo-upload-big" id="myPhotoPreview" src="${esc(PORTAL_CACHE && PORTAL_CACHE.me && PORTAL_CACHE.me.photo || '')}" alt="" style="${PORTAL_CACHE && PORTAL_CACHE.me && PORTAL_CACHE.me.photo ? '' : 'display:none'}">
      <span class="photo-upload-big placeholder" id="myPhotoPlaceholder" style="${PORTAL_CACHE && PORTAL_CACHE.me && PORTAL_CACHE.me.photo ? 'display:none' : ''}">${esc(initials(u.name))}</span>
      <div>
        <input type="file" id="myPhotoFile" accept="image/*">
        <p class="muted" style="font-size:12px;margin:8px 0 0">JPG or PNG. It'll be resized automatically.</p>
        <button class="btn primary" id="myPhotoSave" style="margin-top:10px">Save photo</button>
      </div>
    </div>
  </div>` : ''}
  <div class="dash-grid">
    <div class="card panel">
      <h3>Change password</h3>
      <label>Current password</label><input id="cpCur" type="password">
      <label>New password</label><input id="cpNew" type="password">
      <button class="btn primary" id="cpSave" style="margin-top:14px">Update password</button>
    </div>
    <div class="card panel">
      <h3>Two-factor authentication</h3>
      <p class="muted" style="margin-top:0;font-size:13px">${u.totp_enabled ? 'Currently <b>on</b> for this account.' : 'Currently <b>off</b>. Turning it on requires an authenticator app (Google/Microsoft Authenticator).'}</p>
      <div id="twofaArea"></div>
    </div>
  </div>`;
  if (isStudent) {
    let pendingPhoto = null;
    $('myPhotoFile').onchange = async () => {
      const file = $('myPhotoFile').files[0];
      if (!file) return;
      try { pendingPhoto = await resizeImageFile(file, 240, 0.75); }
      catch (err) { toast(err.message || 'Could not process that image.'); return; }
      $('myPhotoPreview').src = pendingPhoto; $('myPhotoPreview').style.display = '';
      $('myPhotoPlaceholder').style.display = 'none';
    };
    $('myPhotoSave').onclick = async () => {
      if (!pendingPhoto) { toast('Choose a photo first.'); return; }
      const res = await apiPost('portal_upload_photo', { photo: pendingPhoto });
      if (res.ok) { toast('Photo saved.'); if (PORTAL_CACHE && PORTAL_CACHE.me) PORTAL_CACHE.me.photo = pendingPhoto; }
      else toast(res.error || 'Could not save your photo.');
    };
  }
  $('cpSave').onclick = async () => {
    const res = await apiPost('change_password', { current_password: $('cpCur').value, new_password: $('cpNew').value });
    if (res.ok) { toast('Password updated.'); $('cpCur').value = ''; $('cpNew').value = ''; }
    else toast(res.error || 'Could not update password.');
  };
  const area = $('twofaArea');
  if (u.totp_enabled) {
    area.innerHTML = `<label>Current password (to confirm)</label><input id="tfPw" type="password"><button class="btn ghost danger" id="tfOff" style="margin-top:10px">Turn off 2FA</button>`;
    $('tfOff').onclick = async () => {
      const res = await apiPost('totp_disable', { password: $('tfPw').value });
      if (res.ok) { toast('2FA turned off.'); S.user.totp_enabled = false; renderView(); } else toast(res.error || 'Could not turn off 2FA.');
    };
  } else {
    area.innerHTML = `<button class="btn primary" id="tfStart">Set up 2FA</button><div id="tfSetup" style="margin-top:14px;display:none"></div>`;
    $('tfStart').onclick = async () => {
      const res = await apiPost('totp_setup');
      if (!res.ok) { toast(res.error || 'Could not start 2FA setup.'); return; }
      $('tfSetup').style.display = 'block';
      $('tfSetup').innerHTML = `<p class="muted" style="font-size:13px">Add this secret key to your authenticator app, then enter the 6-digit code it shows:</p>
        <p style="font-family:monospace;background:#f4f6f5;padding:10px;border-radius:8px;word-break:break-all">${esc(res.secret)}</p>
        <label>6-digit code</label><input id="tfCode" inputmode="numeric" maxlength="6">
        <button class="btn primary" id="tfEnable" style="margin-top:10px">Confirm & enable</button>`;
      $('tfEnable').onclick = async () => {
        const r2 = await apiPost('totp_enable', { code: $('tfCode').value.trim() });
        if (r2.ok) { toast('2FA enabled.'); S.user.totp_enabled = true; renderView(); } else toast(r2.error || 'That code did not work.');
      };
    };
  }
}

