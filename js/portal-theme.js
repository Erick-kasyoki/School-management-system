'use strict';
/* portal-theme.js — chooses which colour scheme (css/portal-themes.css) is on <body>.

   Sign-in screen (nobody logged in yet) follows the portal in the URL:
     ?portal=student -> pt-student, ?portal=parent -> pt-parent, otherwise -> pt-staff.
   After sign-in it follows the account:
     parent account   -> pt-parent
     student account  -> pt-student
     teacher          -> pt-staff   (burgundy staff portal)
     any other staff  -> pt-admin   (navy + gold main system: Principal, Deputy, Administrator, Accountant)

   To change which roles get which scheme, edit portalThemeFor() below. */

const PT_CLASSES = ['pt-admin', 'pt-student', 'pt-parent', 'pt-staff'];

function portalThemeFor(user){
  if (!user) {
    // ?portal=admin (Administrators card) or ?portal=provider -> navy + gold; plain ?portal=staff (Teachers) -> burgundy.
    const raw = (new URLSearchParams(location.search).get('portal') || '').toLowerCase();
    if (raw === 'admin' || raw === 'provider') return 'pt-admin';
    return PORTAL === 'student' ? 'pt-student' : PORTAL === 'parent' ? 'pt-parent' : 'pt-staff';
  }
  const ps = (typeof perms === 'function') ? perms() : [];
  if (ps.includes('portal.parent'))  return 'pt-parent';
  if (ps.includes('portal.student')) return 'pt-student';
  if (user.role_key === 'teacher')   return 'pt-staff';
  return 'pt-admin';
}

function applyPortalTheme(){
  const appEl = document.getElementById('app');
  const loggedIn = !!(typeof S !== 'undefined' && S.user) && appEl && appEl.style.display !== 'none';
  const cls = portalThemeFor(loggedIn ? S.user : null);
  if (document.body.classList.contains(cls) && PT_CLASSES.filter(c => c !== cls).every(c => !document.body.classList.contains(c))) return;
  PT_CLASSES.forEach(c => document.body.classList.toggle(c, c === cls));
}

(function bootPortalTheme(){
  applyPortalTheme();
  // The app/auth screens are shown and hidden by setting style.display — watch for that
  // so the colours switch on login, logout and portal change without touching shell.js/auth.js.
  const watch = id => { const el = document.getElementById(id); if (el) new MutationObserver(applyPortalTheme).observe(el, { attributes: true, attributeFilter: ['style'] }); };
  watch('app'); watch('authScreen');
})();
