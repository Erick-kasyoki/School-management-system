# School branding: motto under the name + admin-uploaded logo

Fixed: the motto ran into the school name ("...ACADEMYSRTIVE TO EXCEL") because it had no line break.
The motto now sits on its own line directly below the school name in the sidebar and on the sign-in pages.

New: school logo
- Settings -> "School logo" card (needs settings.manage): choose a JPG/PNG/WebP, preview, Save logo / Remove logo.
  The image is resized in the browser (max 512px) and stored in uploads/logo/ (new file name on every upload, so no stale cache).
- It then appears automatically in:
  sidebar (staff, student and parent), all three sign-in pages, the public landing page (portal.html),
  browser-tab icon, printed letterheads / marks registers, staff report cards and the student/parent Report Form.
- Student and parent accounts can't read Settings, so the name, motto and logo they see come from the public
  school_profile action (js/branding.js); previously they always saw the default "Greenhill Academy".

Files: api/handlers/logo.php (new), api/index.php (logo_save route), api/handlers/auth.php (school_profile returns logo),
api/handlers/portal.php (portal_data school.logo), js/branding.js (new), js/views/logo-admin.js (new), js/core.js,
js/views/settings-approvals.js, js/views/results.js, js/views/portal-results.js, index.html, portal.html.
Folder uploads/logo/ must be writable by Apache (same as uploads/slideshow).
