# E-mail removed completely - notifications go to target groups inside the app

Removed from the code
* Dashboard Email status chip and its refresh button; `channel_status` / `broadcast_status` endpoints.
* SMTP/Gmail settings (api/config.php and the private config template), the PHPMailer library, `api/mailtest.php`,
  emailed payment receipts (`api/handlers/receipt.php`, `receipt_email`), the e-mail broadcast channel.
* `sendMail()` itself and every call to it (password reset, admissions, admin reset, new-application alerts).
* Self-service "Forgot password" (it only worked by e-mailing a code): `forgot_password` / `reset_with_code`
  endpoints, the forgot-password screens in index.html and js/auth.js. The login page now says to ask the office.
* Admissions "Send Email" action and the "...and e-mail the guardian" wording.

How it works now
* Messaging & Broadcasts -> **Broadcast**: choose a target group (one person, All Students, All Parents & Guardians,
  All Staff, or a class/grade), add an optional title and a message, send now or schedule. Each person in the group
  receives an in-app notification (bell). Only people with a login can receive one; the form shows
  "Will notify N people" first.
* Administrator password reset (Users -> Reset password) shows the temporary password and the one-time code in a
  window for the admin to give the user in person. Nothing is e-mailed.
* Admissions alerts for staff are in-app notifications.

Kept on purpose
* A person's e-mail address is still a data field (student / parent / staff / guardian records) and the e-mail
  address is still the sign-in username. Nothing is ever sent to it.
* The unused database columns `pwreset_*` in schema.sql are harmless and were left so existing databases need no migration.
