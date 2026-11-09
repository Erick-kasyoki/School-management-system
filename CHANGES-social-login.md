> NOTE: E-mail was later removed from EraMaster entirely (see CHANGES-no-email.md); any e-mail wording below is historical.

# Social sign-in (Google / Facebook / GitHub / LinkedIn) + smaller sign-in card

## How it behaves (Student and Parent portals)
- **Has a school account** with that email -> signed straight in.
- **No account yet** -> back to the Register form with name + email filled in (email locked,
  no password box). They still enter their admission number / phone, which is checked against
  the school's records. A Google/Facebook/... account alone never creates a student or parent account.
  They can set their own password later with *Forgot Password*.
- Staff/administrator accounts cannot use it. Accounts with authenticator 2FA must use password + code.
- A provider must return a *verified* email (GitHub: the primary verified one).
- Buttons for providers that are not set up look greyed out and explain why when clicked.

## Turn a provider on (api/config.php: SOCIAL_*_ID / SOCIAL_*_SECRET)
Register this redirect URL in each console (same URL for all four):
`https://YOUR-SITE/api/social.php`  (local: `http://localhost/helmers/api/social.php`)

- Google: console.cloud.google.com -> APIs & Services -> Credentials -> OAuth client ID (Web application).
- Facebook: developers.facebook.com -> Create app -> Facebook Login -> Valid OAuth Redirect URIs.
  Needs the `email` permission (app in Live mode for the public).
- GitHub: github.com/settings/developers -> New OAuth App -> Authorization callback URL.
- LinkedIn: linkedin.com/developers -> Create app -> add "Sign In with LinkedIn using OpenID Connect" -> Authorized redirect URLs.

Google, Facebook and LinkedIn normally require HTTPS on a real domain (localhost is allowed for testing).
On XAMPP/Windows, if sign-in says the provider "did not accept", check the PHP error log for
"SSL certificate problem": set `curl.cainfo` in php.ini (or `SOCIAL_VERIFY_SSL` false for local testing only).

## Files
api/social.php (new), api/config.php, api/handlers/auth.php, api/index.php,
index.html, js/auth.js (cache version `20261006c`)

## Size
Card 1000x640 -> 820x540; smaller headings, fields, Login/Register buttons and social buttons.
