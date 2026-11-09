'use strict';
/* branding.js — fetches the school's PUBLIC name, motto and logo (no login needed) so the sign-in page,
   and student/parent accounts (who can't read Settings), show the same branding the admin set.
   Loaded right after core.js; applyBranding() itself lives in core.js. */

// Browser-tab icon = the school logo (falls back to the default icon when there is none).
function applyFavicon(url){
  try {
    let link = document.querySelector('link[rel="icon"]');
    if (!url) { if (link && link.dataset.schoolLogo) link.remove(); return; }
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.dataset.schoolLogo = '1';
    link.href = url;
  } catch (e) { /* cosmetic only */ }
}

async function loadPublicBranding(){
  try {
    const r = await fetch('api/index.php?action=school_profile', { credentials: 'same-origin' });
    const j = await r.json();
    if (j && j.ok) {
      SCHOOL_PUBLIC = { name: j.name || '', motto: j.motto || '', logo: j.logo || '' };
      applyBranding();
    }
  } catch (e) { /* offline / server down — keep whatever is showing */ }
}
loadPublicBranding();
