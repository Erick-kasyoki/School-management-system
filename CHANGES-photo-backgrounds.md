# Background slideshow + school name headline (home.html and portal.html)

- Four built-in SVG illustrations are the default animated background on BOTH pages
  (school building, classroom, sports field, and library). Admin-uploaded photos still
  take priority and use the same slow zoom/drift and cross-fade; arrows and dots remain
  available on the portal page.
- The "WELCOME TO OUR SCHOOL" banner image is removed from both pages (img/welcome-banner.jpg deleted).
  The school name is now the big written headline on both pages (taken from Settings, same as before),
  with the motto under it.
- Note: if an admin has uploaded photos in Settings -> Homepage slideshow, those still take priority.
  Remove them there (or clear the list) to show the built-in illustrations.
- Also fixed: an empty "School logo" box showed on portal.html when no logo had been uploaded.

Files: home.html, portal.html, js/slideshow.js, img/slideshow/*.svg.
