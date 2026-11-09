> NOTE: E-mail was later removed from EraMaster entirely (see CHANGES-no-email.md); any e-mail wording below is historical.

# Online admission applications

**Public:** `apply.html` (linked from home.html) — anyone can apply (no login), upload documents, then
track the application with *application number + guardian phone*. The tracking view is the
"Application Details" layout.
**Staff:** Admissions (sidebar) now lists applications; opening one shows the same layout with
Edit, Invite to Interview, Approve / Reject, Send Email (SMTP), WhatsApp reminder, internal notes,
Mark fee as paid. Needs `admissions.view` (read) / `admissions.manage` (act).

Files: `apply.html`, `css/admissions.css`, `js/adm-detail.js`, `js/views/admissions.js`,
`api/handlers/admissions.php` (+ routes in `api/index.php`), tables in `schema.sql`
(also auto-created on first use). Fee: `ADM_FEE` / `ADM_CURRENCY` at the top of the handler.
The application fee is recorded (method + reference) and confirmed by staff — no live
Mobile Money gateway is wired in.

## Roles & notifications (update)
* **Administrator** processes applications (`admissions.manage`): review, interview, fee, notes, e-mail, edit,
  and *Refer to Principal / Headteacher*.
* **Principal / Headteacher** decides (`admissions.decide`): only they (and the Super Administrator) can
  Approve / Reject. On existing databases the Principal role is upgraded once (gets `admissions.decide`,
  loses `admissions.manage`); later changes in Administration → Roles are respected.
* **Notifications:** every action (new application, review, interview, referral, approval/rejection, fee,
  note, e-mail, edit, delete) creates a bell notification (Admissions tab) for Administrators + Super
  Administrator, and also for the Principal on interview / referral / decision. The same people also get an e-mail
  (needs SMTP in api/config.php). The bell refreshes every 30 seconds.
* apply.html: gender, nationality and religion are now drop-downs (with "Other" to type).
