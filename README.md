# EraMaster (Greenhill Academy) — XAMPP + PostgreSQL

## What this is
A full school-ERP backend (PHP 8 + PostgreSQL) with a permission-based
security model, plus the start of the frontend. See **Project status**
below for exactly what's included in this delivery vs. still to come.

```
eramaster/
  index.html                     ← portal-aware login/sign-up + full staff app shell
  portal.html                    ← public landing page (links into index.html) + photo slideshow
  css/slideshow.css              ← slideshow styles (public page + admin manager)
  img/slideshow/                 ← built-in illustrated default scenes (used until photos are uploaded)
  uploads/slideshow/             ← slideshow photos (written by the API; needs to be writable)
  js/
    core.js                      ← state, API client, permissions, demo data
    slideshow.js                 ← public homepage slideshow widget (used by portal.html)
    theme.js                     ← colour-theme engine (palette, apply, cache) — loaded in <head>
    nav.js                       ← sidebar navigation map, write/delete permission tables
    auth.js                      ← sign-in / sign-up screens (all three portals)
    notifications.js             ← notification bell / center
    shell.js                     ← boot sequence + view routing
    modal.js                     ← shared modal chrome
    views/
      portal-dashboard.js        ← parent/student portal home
      dashboard.js                ← staff/admin landing dashboard
      fees.js                     ← Fees Management
      reports.js                  ← report cards, bulk report generation
      attendance.js                ← student + staff attendance
      results.js                   ← results/marks entry & approval flow
      timetable.js                  ← timetable auto-generation + editable grid
      media-import.js               ← photo upload, per-module Excel/CSV bulk import
      data-import.js                ← Administration → Data Import: any Excel/CSV/JSON file, auto-detected, previewed (CHANGES-data-import.md)
      settings-approvals.js         ← School Settings + Approvals inbox
      theme-settings.js             ← Settings → Theme customization (picker, presets, preview)
      slideshow-admin.js            ← Settings → Homepage slideshow (add / remove / reorder photos)
      my-account.js                 ← My Account (profile, password, 2FA)
      chat.js                       ← Staff Chat (live channels; css/chat.css)
    crud/
      schemas.js                  ← field schemas shared by every generic module screen
      screens.js                  ← Students/Classes/Teachers/Subjects + generic list+form
    admin/
      users.js                    ← Administration → Users
      roles.js                    ← Administration → Roles (permission editor)
      logs.js                     ← Administration → Audit log + Security events
  api/
    config.php          ← DB connection, sessions, auth/2FA helpers
    rbac.php             ← permission catalogue, default roles, workflow defs
    data.php              ← diffing, write authorization, versioned saves
    index.php              ← slim REST router — maps ?action= to a handler function
    handlers/
      auth.php               ← signup, login/logout, session, 2FA
      records.php              ← get_all / set_all (generic module data)
      users_roles.php            ← user accounts + role/permission editor
      audit_security.php           ← audit log, security log, session registry
      approvals.php                 ← the approval workflow engine
      portal.php                     ← parent & student portal endpoints
      slideshow.php                  ← homepage slideshow (public read, admin save)
      chat.php                       ← live staff chat (channels, private messages, feedback, end session)
      dataimport.php                 ← dynamic Data Import endpoints (preview / commit / browse / export)
    import/engine.php        ← file readers + header/type detection used by Data Import
    recover.php              ← local-only emergency password reset
  schema.sql            ← PostgreSQL schema (idempotent — safe to re-run)
```

No build step: everything is still plain `<script>`/`require` files served
directly by Apache, exactly as before — the split above only breaks two
formerly-monolithic files (a 3,200-line `js/app.js` and a 1,300-line
`api/index.php`) into one focused file per screen/domain, each loaded in the
same order the code always ran in. Functionality, URLs, and the `?action=`
API are unchanged; see **Project status** for what each screen does.

## 1–4. Install PostgreSQL, create the database, enable `pdo_pgsql`, copy into `htdocs`
Same as before:
```sql
CREATE DATABASE greenhill_academy;
```
```bash
psql -U postgres -d greenhill_academy -f /path/to/eramaster/schema.sql
```
`schema.sql` is **idempotent**: run it again any time you pull an update —
it only adds tables/columns that are missing and never touches your data.
Enable `extension=pdo_pgsql` and `extension=pgsql` in XAMPP's `php.ini`,
restart Apache, then copy the `eramaster` folder into `htdocs`.

## 5. Set your database credentials
Edit the four `DB_*` constants near the top of `api/config.php`.

## 5b. Passwords and notifications (no e-mail)
EraMaster does not send e-mail. When an administrator resets a user's password (Users → Reset password), the screen
shows the temporary password and a one-time code to hand to that person; there is no "Forgot password" e-mail flow.
Broadcasts (Messaging & Broadcasts → Broadcast) go to a target group as in-app notifications in each person's bell.

## 6. Start Apache and open the app
`http://localhost/eramaster/`. The very first account you create becomes
the **Super Administrator**; everyone after that starts with the
least-privilege **Staff** role until an admin assigns a real one.

## Security model
- **Permissions, not a fixed role list.** Every account has a `role_key`
  pointing at a row in the `roles` table, whose `permissions` is a JSON
  array of fine-grained permission strings (`students.edit`, `marks.approve`,
  `fees.refund_approve`, …). Built-in roles (Principal, Deputy, Academic
  Director, Exam Officer, HOD, Administrator, Accountant, HR Officer,
  Teacher, Class Teacher, Librarian, Nurse, Counsellor, Transport Officer,
  Storekeeper, Boarding Master, Receptionist, Auditor, Parent, Student, …)
  are seeded automatically; a Super Administrator can edit any of them or
  create new ones from **Administration → Roles** — no code change needed.
- **Server-enforced, not just hidden in the UI.** Every data key (students,
  marks, payroll, …) has read/write/delete permission rules in
  `api/rbac.php`'s `dataKeys()`, checked on every `get_all`/`set_all` call —
  hiding a button in the browser is not what keeps data safe here.
- **Every write is diffed and audited.** `set_all` compares the incoming
  JSON against what's stored, record by record, and writes one row per
  created/changed/deleted record to `audit_logs` — "Teacher John changed
  Student 104's Mathematics mark from 62 to 78," exactly as requested.
- **Optimistic locking.** Each `school_data` row has a `version` counter;
  a save that's based on stale data is rejected with a conflict rather than
  silently overwriting someone else's concurrent change.
- **Approval workflows.** `api/rbac.php`'s `workflowDefs()` defines fixed
  multi-step chains (exam results, mark corrections, purchases, refunds,
  salary changes, student deletion) with data-changing "effects" that only
  fire once the chain is fully approved — the client requests, the server
  decides.
- **Login security.** Passwords are `password_hash`'d; failed logins are
  throttled (`MAX_LOGIN_FAILURES` per 15 minutes); optional TOTP two-factor
  (works with Google/Microsoft Authenticator) via `totp_setup` /
  `totp_enable` / `totp_disable`; sessions idle out after
  `SESSION_IDLE_SECONDS`; every login/logout/lockout/2FA change is written
  to `security_events`.
- **Account lifecycle.** An administrator can deactivate an account
  (`is_active`) or give it an access-expiry date (`access_expires_at`);
  either one cuts off access on the next request, even mid-session.
- **Session management.** `active_sessions` records every signed-in device;
  `sessions_list` shows them (your own always; every account's, for anyone
  holding `security.view`) and `session_revoke` signs one out remotely —
  deactivating a user also force-clears all of theirs.
- **Local emergency recovery.** `api/recover.php` resets a Super
  Administrator's password, but only when opened from `127.0.0.1`/`::1` —
  it refuses every other request outright. It also clears that account's
  2FA and sessions. Delete or rename the file once you don't need it.
- **CSRF defence.** Every POST must carry `X-Requested-With: EraMaster`,
  which a cross-site form or fetch cannot add without triggering a CORS
  preflight the API doesn't answer.
- **Parent/Student portals are filtered server-side.** `portal_data` only
  ever returns records matching the account's own `linked_id` — a parent
  account can't be tricked into receiving another family's data by editing
  requests in the browser.
- **Three separate sign-in portals, one shared backend.** `portal.html` is
  the public landing page — anyone can open it. It links to `index.html`
  with `?portal=student`, `?portal=parent`, or `?portal=staff` (default);
  each shows a portal-appropriate login/sign-up screen, but the real
  separation is enforced by the server: `login`'s `portal` field is checked
  against the account's actual role (`accountKind()` in `config.php`), so a
  parent account is rejected on the staff or student portal and vice versa —
  changing the URL or spoofing the request can't get you into the wrong one.
- **Self-signup, but only if you're already in the school's records.**
  Students (`signup_student`) and parents (`signup_parent`) can create their
  own login, but only after the name + admission number (student) or name +
  phone number (parent) they enter matches an existing record in
  `em_students` / `em_parents` — no match, no account. Each record can only
  back one account (checked in code and enforced again by a unique DB index),
  so once claimed nobody else can also sign up as "you". Staff accounts are
  not self-service: `ALLOW_SELF_SIGNUP` is off by default, so after the
  first (Super Administrator) account, only an administrator can create
  staff/teacher/admin logins from **Users**, where they can also attach a
  Student/Parent role to a specific record via *Linked record ID*.

## Project status
**Backend: complete and functional** — auth (incl. 2FA, lockout, session
registry, deactivation/expiry, local recovery, verified student/parent
self-signup, portal-separated login), the full permission/role system, all
module data read/write with audit-on-diff, the approval workflow engine,
and the parent/student portal endpoints.

**Frontend: functional for staff/admin and for parents/students.**
`portal.html` (public landing page), `index.html` (portal-aware
login/sign-up + the full staff app shell: dashboard, generic CRUD for every
module, approvals inbox, users/roles/audit/security admin screens, my
account) and a working Parent/Student portal dashboard (children/own
profile, attendance, results, homework, fees, announcements, events,
messages, and a "contact the school" inbox) are all in this delivery.
**Every module's list screen has Export CSV and Import CSV/Excel**, not just a
select few: Export always writes out a module's full record shape (all
fields, not just the columns shown on screen), and Import reads that same
shape back in — so a round trip of export → edit in Excel/Sheets → import
always works. Students, Parents and Staff additionally recognise a wider set
of common column-name variants (e.g. "Adm No", "Admission Number", "Reg No"
all map to the same field) and de-duplicate against their natural key
(admission number, phone, TSC number); every other module de-duplicates on
`name` where the record has one, and otherwise just adds each non-empty row
as a new record.

**Administration → Roles** is now a full editor: tick/untick permissions
per role from the checkbox grid (grouped the same way as the permission
catalogue in `rbac.php`), rename or describe a role, create brand-new
custom roles, or delete unused custom ones — built-in roles can be
edited but not deleted, `users.manage`/`roles.manage` can never be
granted to anything but the Super Administrator, and every save is
audit-logged.

Three purpose-built screens now sit alongside the generic table+form CRUD
(everything else still uses that generic screen — students, teachers,
classes, lesson plans, timetable, library, discipline, welfare, clinic,
boarding, passes, fees, invoices, discounts, transactions, budgets,
suppliers, purchases, inventory, assets, maintenance, transport, leave,
reviews, training, announcements, messages, inquiries, events, documents,
years/terms/departments/houses/policies, club memberships and
achievements, etc.):
- **Academics → Results Entry** — pick an exam, enter each student's
  per-subject marks and a teacher comment (a principal-permission holder
  also gets a principal-comment column), save, then **Submit for review**
  raises an `exam_results` approval request: the exam is patched to *In
  Review* immediately, and to *Published* / back to *Draft* once the HOD →
  examination officer → principal chain (see **Approvals**) finishes.
- **Academics → Student Attendance** — date + session + class, one row per
  student with a Present/Absent/Late/Excused toggle and a note, saved to
  `em_attendance`.
- **HR → Staff Attendance** — the same idea per date for every staff
  member, saved to `em_staff_attendance`.

- **Academics → Timetable** — generated from your data: pick a class (or
  the whole school) and **Generate / regenerate…** builds a Mon–Fri grid
  from **Subject Allocations** (grade, subject, teacher, periods/week).
  A teacher is never in two classes at once, each subject is spread across
  the week, and the generator tries many layouts and keeps the one that
  places the most lessons (it warns if a teacher has more lessons than
  the week has slots). *Replace* starts fresh; *Keep existing* only fills
  what's missing around lessons you've already set. **Undo last
  generation** restores the previous timetable.
  Editing: click any slot to change subject/teacher/room (or make it a
  free period), or drag a lesson onto another slot to move/swap it —
  clashes (teacher or room in two places) are blocked unless you tick
  "Allow it". **By teacher** shows any teacher's week and lesson load;
  staff without `timetable.manage` open on their own timetable,
  read-only. Print and Export CSV are on every view. A "Required vs
  Scheduled" table under each class shows what's still missing.
- **Academics → Results Entry → Import marks** — upload a CSV/Excel file
  for the selected exam. **Download template** gives a file pre-filled
  with the class's students (and any marks already entered). Both layouts
  work: one column per subject (`Mathematics` = exam marks, or
  `Mathematics CAT 1` / `CAT 2` / `Mid Term` / `Exam Marks`), or one row
  per student per subject — the Marks Register export re-imports as is.
  Students are matched by Adm No (or name); a preview lists unmatched
  students and any value that isn't 0–100 (those cells are skipped);
  empty cells leave existing marks alone; a `Comment`/`Remarks` column
  sets the teacher comment. Import saves as a draft — review, then
  **Submit for review**. Typing a mark outside 0–100 (or text) is now
  rejected on Save.

Still pending, if you want it built out further: a payroll run screen
(the `em_payroll`/`em_payroll_status` data, permissions and `salary_change`
workflow are already in place on the backend — only a matching UI is
missing).

## Homepage photo slideshow
`portal.html` uses a **full-page animated photo background**: photos cross-fade with a gentle zoom
(and a few pixels of mouse parallax on desktop) behind the sign-in cards, with a blue tint so the
text stays readable. A small control bar in the page header (top-right, inline on phones) has previous/next arrows and indicator dots;
it also supports swipe on phones and the ← → keys. Photos advance automatically and pause while the
pointer is over the control bar or the tab is hidden. Visitors who prefer reduced motion get a plain
quick fade with no zoom/parallax.

- **Manage it:** sign in as an account with the `settings.manage` permission →
  **School Setup → School Settings → Homepage slideshow**. Upload photos (resized in the browser),
  give each an optional title/caption (shown under the controls on desktop), reorder by dragging the ⠿
  handle or with ↑/↓, remove with ✕, choose seconds-per-photo (3–15), then **Save slideshow**.
  Up to 12 photos; wide landscape photos look best. Every save is written to the audit log.
- **No photos yet:** four built-in illustrated scenes (`img/slideshow/*.svg` — school building,
  classroom, sports field, library) play instead. They are drawings, not photographs of your
  school; the first photo an administrator saves replaces them.
- **Storage:** uploaded photos are files in `uploads/slideshow/` (the list lives in `school_data`
  under the key `gallery_slideshow`, which `get_all`/`set_all` never touch). Apache/PHP must be
  able to write to that folder; `uploads/.htaccess` stops anything in it being executed. No schema change.
- **Tip:** if saving many large photos at once fails, save 3–4 at a time (PHP's `post_max_size`
  is 8 MB by default in XAMPP).
- **API:** `GET ?action=slideshow` (public, read-only) and `POST ?action=slideshow_save`
  (requires `settings.manage`).

## Troubleshooting
- **"Database connection failed"** → check `api/config.php` credentials
  and that PostgreSQL is running.
- **Blank page / 500 error** → check `apache/logs/error.log`; with
  `APP_DEBUG = true` in `config.php` the JSON error response also includes
  the exception message.
- **"missing the v2 tables"** → re-run `schema.sql` against your database.
- **Locked out entirely** → open `http://localhost/eramaster/api/recover.php`
  from the server machine itself.
