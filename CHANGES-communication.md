> NOTE: E-mail was later removed from EraMaster entirely (see CHANGES-no-email.md); any e-mail wording below is historical.

# Communication across the whole system

## The problem
- The bell only listed things a person could already see in their own screens, so **students, parents and teachers were
  never told anything** (a payment, published results, a school reply, homework, an absence ...).
- A parent could message the school, but the message showed with a **blank name** on the staff Inquiries screen, staff had
  **no way to reply**, and nobody was told it had arrived.
- Approvals, marks entry and leave requests moved on silently — people had to keep opening screens to find out.
- Broadcasts failed completely when e-mail was not set up, so nobody could be reached at all.

## What now happens (all written by the SERVER, after the change is saved)
| When this happens | Who is notified |
|---|---|
| Fee payment recorded | the student's family (student + parent logins) |
| New fee invoice | the student's family |
| Announcement / event posted | its audience (Everyone / Students / Parents / Staff, optional grade); "Urgent" and "Emergency" show as Urgent |
| Homework set | the class and their parents |
| Results published (final approval) | the class' families |
| Exam opened for marks entry | everyone who can enter marks (teachers) |
| Teacher saves marks | the exam office / reviewers (one notice per exam + subject until read) |
| Student marked absent / late | the parents (today and the last 2 days only) |
| Staff leave requested / decided | HR (staff.manage) / the staff member |
| Parent or student sends a message | staff who can send communication |
| Staff fill in **Reply to sender** on an inquiry (or change its status) | that parent / student |
| Approval raised / moved to next step / approved / rejected / cancelled | next approvers / the requester |
| Broadcast sent | the same people **inside the app** as well as by e-mail — works even if e-mail is not configured |
| Unread staff-chat messages | shown in the bell too |

- Everybody now has a working bell: students and parents see **All / Updates / Messages**; staff also see Approvals / Admissions.
- Read / cleared state is stored on the server, so it follows a person to any phone or computer.
- The bell checks for new items every ~25 seconds (and when the tab is re-opened) and bounces when something new arrives.
- Clicking a notification opens the right screen (students / parents land in their portal).
- A notification failure can never stop a payment, mark or approval from saving.

## Inquiries (parent ⇄ school loop)
- Portal messages now arrive with name, e-mail and source "Portal", status "New".
- New **Reply to sender** field in Inquiries. Saving a reply notifies the parent/student and shows it in their portal ("School reply").

## Files
- new: `api/handlers/notify.php`
- edited: `api/index.php` (3 routes), `api/handlers/records.php`, `api/data.php`, `api/handlers/approvals.php`, `api/handlers/marks.php`,
  `api/handlers/portal.php`, `api/handlers/broadcast.php`, `schema.sql`, `js/notifications.js`, `js/shell.js`, `js/auth.js`,
  `js/crud/schemas.js`, `js/views/media-import.js`, `js/views/messaging.js`, `index.html` (script cache version bumped)

## To install
1. Copy the files over your project (then hard-refresh the browser; script versions were bumped so it picks up the new files).
2. The `notifications` table is created automatically on first use. Re-running `schema.sql` also creates it (safe to re-run).
3. Nothing to configure. Existing data is untouched; notifications start from the moment you upgrade.

## Notes
- Families are matched through the student's linked parent record, and any other parent record with the same phone or e-mail.
  A parent who has not yet linked their login to their record (Parent Portal → connect) cannot receive family notifications.
- Staff-to-staff direct messages remain in Staff Chat (live channels); that is unchanged.
