# Portal colour schemes

| Who | Scheme |
|---|---|
| Main system — Principal, Deputy Principal, Administrator, Accountant (and the Administrators sign-in) | Navy Blue + White + Gold |
| Student portal | Forest Green + White |
| Parent portal | Royal Blue + White + Light Grey |
| Staff portal — Teachers (and the Teachers/staff sign-in) | Burgundy + White + Cream |

Applies to the sign-in screen (card, button, sliding panel, page background), sidebar, topbar, buttons, badges, tables and banners.

New files: `css/portal-themes.css` (the four palettes), `js/portal-theme.js` (picks the scheme from the URL before login and from the account's role after login).
Edited: `index.html` (2 include lines), `portal.html` and `home.html` (card/door colours; Administrators card now links to `index.html?portal=admin`, still the shared staff sign-in on the server).

To change which role gets which scheme: `portalThemeFor()` in js/portal-theme.js. To tweak a colour: the `body.pt-*` blocks in css/portal-themes.css.
Note: these schemes take priority over the single accent colour chosen in Settings → Theme.

## Home page (home.html)
Recoloured to Forest Green + White (dark forest nav/hero/footer, white sections, mint highlights instead of gold). The four portal doors keep their own portal colours.

## School logo as the browser-tab icon
New `favicon.php` serves the logo uploaded in Settings → School logo (or a simple default icon if none is uploaded). Every page (`index.html`, `home.html`, `portal.html`, `apply.html`) now has `<link rel="icon" href="favicon.php">`, and `.htaccess` rewrites `/favicon.ico` to it, so the tab no longer shows the browser's globe. Upload the logo first (Settings → School logo), then refresh the tab with Ctrl+F5 — browsers cache tab icons, so a closed-and-reopened tab may be needed.

## Security hardening
See `SECURITY-SETUP.md`: private files blocked, hardened PHP sessions, passwords moved out of the code into a private file outside the web folder, restricted PostgreSQL user, PHP source access limited to two entry points, HTTPS redirect + security headers.
