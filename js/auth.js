'use strict';
/* auth.js — the sign-in / register card (all three portals) and logout.
   Part of the EraMaster frontend — loaded after core.js.

   The card (#authCard) has two modes, set through data-mode:
     login     form on the right, coloured overlay on the left
     register  form on the left,  coloured overlay on the right
   Forgotten passwords are reset by an administrator (Users -> Reset password). */

/* ---------------- auth screens ---------------- */
const AUTH_MODES = { login: 'login', register: 'register' };
let AUTH_MODE = 'login';

function authBoxFor(mode){ return document.querySelector('#authCard .form-box.' + mode); }

/** Switch the card to login / register. keepMsg leaves the message banner showing. */
function setAuthMode(mode, keepMsg){
  mode = AUTH_MODES[mode] || 'login';
  const card = $('authCard');
  const sidesChange = (AUTH_MODE === 'register') !== (mode === 'register');
  card.style.setProperty('--d', sidesChange ? '.5s' : '0s');   // wait for the overlay to slide before the form fades in
  AUTH_MODE = mode;
  card.dataset.mode = mode;
  // The one message banner lives at the top of whichever form is showing.
  const box = authBoxFor(mode), msg = $('authMsg');
  box.querySelector('.fb-inner').insertBefore(msg, box.querySelector('.fb-inner').firstChild);
  if (!keepMsg) msg.style.display = 'none';
  if (window.matchMedia && matchMedia('(pointer:fine)').matches) {
    setTimeout(() => {
      if (AUTH_MODE !== mode) return;
      const first = box.querySelector('form:not([hidden]) input:not([hidden])');
      if (first) first.focus({ preventScroll: true });
    }, sidesChange ? 700 : 150);
  }
}

function showAuthScreen(message, type){
  $('app').style.display = 'none';
  $('authScreen').style.display = 'flex';
  setAuthMode('login', true);
  const m = $('authMsg');
  if (message) { m.textContent = message; m.className = type === 'info' ? 'auth-msg ok' : 'auth-msg'; m.style.display = 'block'; }
  else { m.style.display = 'none'; }
  if (!message && typeof SOCIAL_QS !== 'undefined') {
    if (SOCIAL_QS.error) { authError(SOCIAL_QS.error); SOCIAL_QS.error = ''; }
    else if (SOCIAL_QS.complete) { applySocialComplete(); }
  }
}
function authError(msg){ const m = $('authMsg'); m.textContent = msg; m.className = 'auth-msg'; m.style.display = 'block'; }
function authOk(msg){ const m = $('authMsg'); m.textContent = msg; m.className = 'auth-msg ok'; m.style.display = 'block'; }

(function initPortalChrome(){
  const meta = PORTAL_META[PORTAL];
  document.documentElement.style.setProperty('--accent', meta.accent);
  document.documentElement.style.setProperty('--accent-dark', meta.accentDark);
  $('authTitle').textContent = meta.title;
  $('authSubtitle').textContent = meta.subtitle;
  if (meta.tag) { $('portalTag').textContent = meta.tag; $('portalTag').style.display = 'inline-block'; }
  // Registration: only this portal's own form is shown.
  ALL_SIGNUP_IDS.forEach(id => { $(id).hidden = (id !== signupFormIdFor(PORTAL)); });
})();

$('showSignup').onclick = () => setAuthMode('register');
$('showLogin').onclick  = () => setAuthMode('login');

/* ---------------- social sign-in (Google / Facebook / GitHub / LinkedIn) ----------------
   The buttons send the browser to api/social.php, which does the OAuth round trip and comes back
   to this page. A provider only works once its keys are set in api/config.php. */
let SOCIAL_ON = {};
let SOCIAL_COMPLETE = false;   // true while finishing registration after a successful social sign-in
const SOCIAL_QS = (() => {
  const q = new URLSearchParams(location.search);
  const o = { error: q.get('social_error') || '', complete: q.get('social') === 'complete' };
  if (o.error || o.complete) history.replaceState(null, '', location.pathname + '?portal=' + encodeURIComponent(PORTAL));
  return o;
})();

apiGet('social_providers').then(r => {
  SOCIAL_ON = (r && r.providers) || {};
  document.querySelectorAll('#authCard [data-social]').forEach(b => {
    b.classList.toggle('off', !SOCIAL_ON[b.dataset.social.toLowerCase()]);
  });
});

document.querySelectorAll('#authCard [data-social]').forEach(b => {
  b.addEventListener('click', () => {
    const name = b.dataset.social, key = name.toLowerCase();
    if (PORTAL === 'staff') { authOk('Social sign-in is for the Student and Parent portals. Staff sign in with email and password.'); return; }
    if (!SOCIAL_ON[key]) { authOk(name + ' sign-in is not set up for this school yet. Use your email and password.'); return; }
    location.href = 'api/social.php?start=' + encodeURIComponent(key) + '&portal=' + encodeURIComponent(PORTAL);
  });
});

/* Came back from a provider with no school account yet: finish on the Register form. */
async function applySocialComplete(){
  SOCIAL_QS.complete = false;
  const r = await apiGet('social_pending');
  const p = r && r.pending;
  if (!p || p.portal !== PORTAL) { authError('That social sign-in expired. Press the button again.'); return; }
  SOCIAL_COMPLETE = true;
  const stu = PORTAL === 'student';
  const nameEl = $(stu ? 'stuName' : 'parName'), emailEl = $(stu ? 'stuEmail' : 'parEmail'), pwEl = $(stu ? 'stuPassword' : 'parPassword');
  nameEl.value = p.name || ''; emailEl.value = p.email; emailEl.readOnly = true;
  pwEl.removeAttribute('required'); pwEl.removeAttribute('minlength'); pwEl.closest('.fld').hidden = true;
  setAuthMode('register', true);
  authOk('Signed in with ' + p.provider + ' as ' + p.email + '. Enter the rest exactly as the school has it to finish.');
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('loginBtn'); btn.disabled = true;
  const res = await apiPost('login', {
    email: $('loginEmail').value.trim(),
    password: $('loginPassword').value,
    code: $('loginCode').value.trim(),
    portal: PORTAL,
  });
  btn.disabled = false;
  if (res.needs_otp) {
    $('loginCodeLabel').textContent = 'One-time code from your administrator'; $('loginCode').placeholder = 'One-time code';
    $('twofaWrap').style.display = 'block'; authError(res.error); return;
  }
  if (res.needs_2fa) {
    $('loginCodeLabel').textContent = '6-digit authenticator code'; $('loginCode').placeholder = '6-digit code';
    $('twofaWrap').style.display = 'block'; authError(res.error); return;
  }
  if (!res.ok) {
    authError(res.error || 'Could not log in.');
    // Right password, wrong door: offer a one-click way to the portal this account belongs to.
    if (res.portal) {
      const a = document.createElement('a');
      a.href = location.pathname + '?portal=' + encodeURIComponent(res.portal);
      a.textContent = 'Go to the ' + (res.portal === 'staff' ? 'Staff' : res.portal === 'parent' ? 'Parent' : 'Student') + ' portal →';
      a.style.cssText = 'display:block;margin-top:6px;font-weight:700;color:inherit;text-decoration:underline';
      $('authMsg').appendChild(a);
    }
    return;
  }
  await bootApp(res.user, `Welcome back, ${res.user.name}.`);
});

$('signupFormStaff').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('signupBtnStaff'); btn.disabled = true;
  const res = await apiPost('signup', {
    name: $('suName').value.trim(), role: $('suRole').value.trim(),
    email: $('suEmail').value.trim(), password: $('suPassword').value,
  });
  btn.disabled = false;
  if (!res.ok) { authError(res.error || 'Could not create the account.'); return; }
  await bootApp(res.user, `Welcome, ${res.user.name} — you're in as ${res.user.role_label}.`);
});

$('signupFormStudent').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('signupBtnStudent'); btn.disabled = true;
  const res = await apiPost('signup_student', {
    name: $('stuName').value.trim(), adm_no: $('stuAdm').value.trim(),
    email: $('stuEmail').value.trim(), password: SOCIAL_COMPLETE ? '' : $('stuPassword').value, social: SOCIAL_COMPLETE,
  });
  btn.disabled = false;
  if (!res.ok) { authError(res.error || 'Could not create the account.'); return; }
  await bootApp(res.user, `Verified! Welcome, ${res.user.name} — you're signed in to your Student Portal.`);
});

$('signupFormParent').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('signupBtnParent'); btn.disabled = true;
  const res = await apiPost('signup_parent', {
    name: $('parName').value.trim(), phone: $('parPhone').value.trim(),
    email: $('parEmail').value.trim(), password: SOCIAL_COMPLETE ? '' : $('parPassword').value, social: SOCIAL_COMPLETE,
  });
  btn.disabled = false;
  if (!res.ok) { authError(res.error || 'Could not create the account.'); return; }
  await bootApp(res.user, `Verified! Welcome, ${res.user.name} — you're signed in to your Parent Portal.`);
});

async function doLogout(){ await apiPost('logout'); S.user = null; if (typeof stopNotifPolling === 'function') stopNotifPolling(); showAuthScreen(); }
$('topbarLogoutBtn').onclick = doLogout;
$('accountBtn').onclick = () => goTo('account');

