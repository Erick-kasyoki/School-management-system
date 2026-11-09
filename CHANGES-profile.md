# My Profile (every role)

A profile page for **every** account — staff (teachers, admins, accountants…), students and parents —
in the three-column layout of the design: identity card + quick actions, tabbed details, summary,
today's schedule, recent activity, classes table and leave/fee balance.

## Files
| File | What |
|---|---|
| `api/handlers/profile.php` (new) | `profile_get`, `profile_update`, `profile_photo` |
| `js/views/my-profile.js` (new) | the page |
| `css/profile.css` (new) | styles (accent colour = `--pf-accent` at the top) |
| `schema.sql` | new table `user_profiles` — **re-run schema.sql once** (it is idempotent) |
| `api/index.php` | requires the handler + 3 routes |
| `js/nav.js`, `js/shell.js` | "My Profile" in the Account group (and the student/parent nav); topbar name opens it |
| `index.html` | loads the new css/js |

## What each role sees
* **Teacher** – as in the design. Classes, students, subjects, schedule and rooms come from the Timetable.
* **Other staff** – same page; summary shows attendance, leave taken, training and reviews; no classes table.
* **Student** – academic info, weekly timetable, subjects, attendance, fee balance.
* **Parent** – children table (class, attendance, fee balance), upcoming events, fee balance.

## Rules
* School-owned facts (staff ID, department, position, qualification, class, admission no…) are read-only.
* People edit their own: phone, WhatsApp, address, nationality, marital status, bio, licence, working hours
  (+ date of birth / gender for staff). Date of employment and employment type need `staff.manage`.
* A parent's phone/address also update their parent record (same as the existing portal contact form).
* Leave entitlements default to Annual 21 / Sick 10 / Compassionate 5; override with
  `settings.leaveEntitlements = {"Annual Leave": 15, ...}`.
* Period times assume 40-minute periods from 08:00 (same assumption as the Timetable screen).
