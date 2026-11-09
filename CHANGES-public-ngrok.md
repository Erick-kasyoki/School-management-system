> NOTE: E-mail was later removed from EraMaster entirely (see CHANGES-no-email.md); any e-mail wording below is historical.

# Public access via ngrok  (https://<domain>.ngrok-free.dev/30/public/)

* `public/.htaccess` - serves the whole app at /30/public/ (internal rewrite to the folder above; no duplicated files).
  `public/index.html` is a fallback redirect if mod_rewrite is ever off.
* Tunnel-safe client IP (`clientIp()` in api/config.php): the login lockout is per visitor, not per tunnel.
* HTTPS detected from ngrok's X-Forwarded-Proto (secure session cookie).
* `api/recover.php` and `api/mailtest.php` refuse tunnel traffic (they trusted "127.0.0.1", which ngrok always is).
* SMTP password: spaces are stripped automatically (Google App Passwords are shown as 4 groups of 4).
Run:  ngrok http 80      (XAMPP Apache on port 80)  - then open  https://<domain>/30/public/
