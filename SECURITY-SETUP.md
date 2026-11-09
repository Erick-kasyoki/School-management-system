# EraMaster — security setup

Do these in order. Steps 1–2 are already done in the code; 3–5 need you to change the server once.
All helper files are in `server-setup/` (blocked from browsers). **Do not upload `server-setup/` to a public server.**

## 0. Change the passwords you shared
The old `api/config.php` held the PostgreSQL `postgres` password in plain text.
Because that file was sent in a zip, treat both as exposed:
* PostgreSQL: step 3 below creates a new user with a new password; also change the `postgres` password
  (`ALTER USER postgres PASSWORD '...';`).

## 1. Private files are blocked   (done)
* Root `.htaccess` refuses `.md .sql .log .bak .zip .gz .ini .env .bat .sh` files, `README`, `CHANGES-*`, `.git*`, and turns off folder listings.
* `tests/`, `server-setup/` and `uploads/` (static files only, no PHP) are locked down.
* The stray `php-1.2.1.tar.gz` was removed from the site (kept one folder up as `removed-from-site/`).
* Passwords/keys moved out of the code into a file **outside** the web folder (step 3a).

## 2. Secure PHP session settings   (done, in `api/config.php`)
Cookie is `HttpOnly`, `Secure` (automatically on HTTPS), `SameSite=Lax`; strict mode (no session-id fixation),
cookie-only ids, 48-character ids, custom cookie name, id regenerated at login, idle timeout 2 h (as before)
**plus** a hard 12-hour limit (`SESSION_ABSOLUTE_SECONDS`). Everyone is signed out once when you deploy (new cookie name).
`APP_DEBUG` is now `false`, so errors no longer show internals to visitors (details stay in the PHP error log).

## 3. Restrict PostgreSQL
a. **Private config file.** Copy `server-setup/eramaster-private/config.php` to `C:\xampp\eramaster-private\config.php`
   (the folder next to `htdocs`, not inside it) and fill in the CHANGE_ME values.
b. **Low-privilege user.** Run `server-setup/postgres/restrict-postgres.sql` once as `postgres`
   (the command is at the top of the file). The app then connects as `eramaster_app`, which is not a superuser
   and can only touch `greenhill_academy`.
c. **Only this computer may connect.** Apply `postgresql.conf.snippet` (listen on localhost, SCRAM passwords) and
   `pg_hba.conf.example` (allow only `127.0.0.1`/`::1`, reject everything else), then restart the PostgreSQL service.
d. Test: sign in to EraMaster. If you see "Database connection failed", check `DB_PASS` in the private file and Apache's `error.log`.

## 4. PHP source stays private   (done)
Browsers can open only `index.html`, `home.html`, `portal.html`, `apply.html`, `favicon.php`, `api/index.php` and `api/social.php`.
Everything else in `api/` (config, handlers, importer) is include-only. `api/recover.php`
works only from the server computer itself (and is refused when the request came through a tunnel such as ngrok).
Requires `AllowOverride All` for htdocs (XAMPP's default).

## 5. Enable HTTPS (XAMPP on Windows)
1. Enable the modules/lines listed at the top of `server-setup/apache/httpd-ssl.snippet.conf` (ssl, rewrite, headers, the `Include` line) and `extension=openssl` in php.ini.
2. Certificate for local use: install **mkcert** (github.com/FiloSottile/mkcert), then in a terminal:
   `mkcert -install` and
   `mkcert -cert-file localhost.pem -key-file localhost-key.pem localhost 127.0.0.1 ::1`
   Copy `localhost.pem` to `C:\xampp\apache\conf\ssl.crt\` and `localhost-key.pem` to `C:\xampp\apache\conf\ssl.key\`.
   (Apache's built-in `makecert.bat` also works but the browser will show a warning.)
3. Put the snippet's settings into `C:\xampp\apache\conf\extra\httpd-ssl.conf`, restart Apache, open `https://localhost/<your-folder>/`.
4. The root `.htaccess` already redirects http → https and sends the HSTS header. **If https isn't working yet, comment out the four `Rewrite…` redirect lines in `.htaccess` so you aren't locked out.**
5. On a real public server use a free Let's Encrypt certificate (win-acme on Windows, certbot on Linux) and your domain name;
   after it has worked for a while, raise HSTS `max-age` to `31536000` in `.htaccess`.
6. If you use social sign-in, change the redirect URL in each provider's console to `https://…/api/social.php`.
