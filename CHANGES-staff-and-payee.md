> NOTE: E-mail was later removed from EraMaster entirely (see CHANGES-no-email.md); any e-mail wording below is historical.

# Staff page redesign + "who is paying / being paid" picker

## Staff page
Dashboard layout: stat cards, tabs (All / Active / Inactive / By Department / By Qualification / By Experience / On Leave),
search + sort + pagination, Filters panel and Staff Summary. View / Edit / Delete keep their original colours.
Staff records gained two optional fields: Qualification and Experience (years).

## Payee picker (js/views/payee.js — new)
Choose the student / staff / parent / supplier on Fees quick payment, Fee Payments, Invoices, Discounts, Purchases and the
Transactions Ledger; their details (class, guardian, phone, balance, contacts…) appear on a card automatically.

Changed: index.html, js/core.js, js/crud/schemas.js, js/crud/screens.js, js/views/fees.js, js/views/media-import.js
New: js/views/payee.js
No database change needed.

## "Your account isn't linked yet" (parent & student portals)
Cause: a Parent/Student login existed without a link to a parent/student record (e.g. created or re-roled by an
administrator without choosing a record, or the record was later deleted/re-imported).
Fixes:
* Automatic repair — a parent account whose e-mail matches exactly one unclaimed parent record is linked on sign-in
  (also repairs a link that points at a deleted record).
* Self-service — instead of a dead end, the portal shows a form: parents enter name + phone, students name + admission
  number (same check as sign-up, max 5 wrong tries / 15 min). New API action: portal_link.
* Administration → Users — Student/Parent logins now pick the record from a list (records that already have a login are
  greyed out) instead of typing an ID; accounts missing a link show a "Not linked" badge.
* Clearer message when a parent record has no children attached.
Changed: api/handlers/portal.php, api/index.php, js/views/portal-dashboard.js, js/views/portal-results.js, js/admin/users.js

## Dead-end audit of all three portals (staff, parent, student)
* Staff portal: an account whose role has no permissions yet (e.g. a new sign-up on the default Staff role) used to land on a
  blank/erroring Dashboard. Navigation now only opens screens the role can use, falls back to the first allowed one, and shows
  "Your account has no access yet" (with what to do) when there is none. Opening a page by URL/click without permission shows
  "You don't have access to this page" with a button to an allowed page.
* Parent/Student: sending a message, saving contact details or uploading a photo now also repairs a stale link first, and says
  "connect your account first" instead of a vague "Only linked accounts…" error.
* Parent/Student: "Could not load your portal / results" now has a Try again button.
* Login: signing in on the wrong portal (e.g. a parent on the staff page) now shows a one-click "Go to the Parent portal" link.
Changed: js/shell.js, js/auth.js, js/views/portal-dashboard.js, js/views/portal-results.js, api/handlers/portal.php, api/handlers/auth.php
