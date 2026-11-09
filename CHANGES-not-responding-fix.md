> NOTE: E-mail was later removed from EraMaster entirely (see CHANGES-no-email.md); any e-mail wording below is historical.

# Fix: system "not responding"

Root causes found and fixed:

1. **Session lock** - PHP locks the session file for the whole request, so one slow request (mail-server check,
   import, broadcast) froze every other request from the same browser. `api/index.php` now releases the lock
   immediately for every action except signup/login/logout (the only ones that write the session).
2. **Fake SMTP credentials treated as real** - `CHANGE_ME` values counted as "configured", so the status bar tried
   a live Gmail login (up to 8-20 s) every ~90 s. `bcEmailReady()` now rejects placeholders.
3. **No DB timeouts** - `config.php` now sets connect_timeout=5, lock_timeout=10s, statement_timeout=30s
   (300 s for import_* / broadcast_send* actions).
4. **No browser timeouts / stacked polls** - `apiCall()` now aborts after 30 s (300 s for bulk actions) and background
   polls fail silently. Admissions and chat pollers no longer overlap or run in hidden tabs.

After deploying: restart Apache (XAMPP Control Panel) and hard-refresh the browser (Ctrl+F5).
