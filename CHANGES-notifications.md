> NOTE: E-mail was later removed from EraMaster entirely (see CHANGES-no-email.md); any e-mail wording below is historical.

# Fix: notifications that did not reach the person who has to act (leave → HR, approvals, announcements …)

## What was wrong
The app reads the school data **once, when someone signs in**. The server wrote the notification correctly, but the
receiving browser kept its old copy of the data:
- HR's bell said "Leave request — Jane Doe", but **Leave Requests (and the Approvals inbox) were still the copy loaded at
  sign-in**, so the request was not in the list. Approving then failed with "Someone else changed the same records…"
  because that screen's version counter was old too.
- The only reminder built from the data (leave pending 2+ days) counted from the leave's **start date** and was shown to
  **every** staff member who can apply, so it did not fire when it should.
- The bell's 25-second poll had **no timeout** – one request that never answered froze the bell until the page was reloaded.
- "Your leave request: Approved / Rejected" did not reach a login tied to the staff record **by e-mail only** (the match the
  Apply for Leave screen itself uses).

## What changed
- `js/notifications.js`
  - A NEW notification now makes the browser quietly re-read the data behind it (leave, announcements, events, homework,
    exams, messages/inquiries, approvals inbox) and refresh the version counters. Nothing is swapped while a dialog is open
    or someone is typing – it retries on the next tick. Marks entry and the students'/parents' portal are never touched.
  - Opening Leave Requests, Apply for Leave, Approvals, Announcements, Events, Inquiries, Messages or Homework always
    shows the latest data (also covers clicking a notification).
  - Poll has a 15 s timeout and always resets itself.
  - "Leave request — <name>" for HR now sits under the **Approvals** tab; the answer to your own request stays under Updates
    and opens **Apply for Leave**.
  - Pending-leave reminder: only for people who decide leave (`staff.manage`), counted from the day it was requested, names the
    staff member.
- `js/shell.js`: `goTo()` calls the refresh above after drawing a screen.
- `api/handlers/records.php`: `get_all` accepts an optional `?keys=em_leave,em_events` so the refresh only downloads what it needs
  (no `keys` = unchanged behaviour).
- `api/handlers/notify.php`: `notifStaffUserIdsForTeacher()` also matches the login's e-mail (link → e-mail → name).
- `index.html`: cache-busting version bumped for `notifications.js` and `shell.js`.

## Upgrade
Replace the files above, then hard-refresh the browser (Ctrl+F5). No database change.
