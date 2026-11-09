# Homepage photo slideshow — what was added

## New files
| File | Purpose |
|---|---|
| `js/slideshow.js` | Public slideshow widget (fade, zoom/parallax, arrows, dots, hover-pause, swipe, keyboard) |
| `css/slideshow.css` | Styles for the public slideshow and the admin manager (all rules prefixed `.ss-` / `.ssm-`) |
| `js/views/slideshow-admin.js` | Settings → Homepage slideshow: add / remove / reorder / caption photos |
| `api/handlers/slideshow.php` | `slideshow` (public read) and `slideshow_save` (needs `settings.manage`) |
| `img/slideshow/*.svg` | Four built-in illustrated scenes shown until an admin uploads photos |
| `uploads/.htaccess` | Blocks script execution inside the uploads folder |
| `uploads/slideshow/` | Where slideshow photos are stored (must be writable by Apache/PHP) |

## Small edits to existing files
| File | Change |
|---|---|
| `portal.html` | Stylesheet link and `slideshow.js` script (the script creates the full-page background layer) |
| `index.html` | Stylesheet link and `slideshow-admin.js` script tag |
| `js/views/settings-approvals.js` | One call to `renderSlideshowManager(el, manage)` at the end of `renderSettings` |
| `api/index.php` | `require` of the new handler and two `case` routes |
| `README.md` | Folder map updated and a "Homepage photo slideshow" section added |

No database schema change. Install: copy the folder into `htdocs`, make `uploads/slideshow/` writable.

Note: the slideshow is a fixed full-page background. With no photos saved, the built-in illustrated scenes play instead.
