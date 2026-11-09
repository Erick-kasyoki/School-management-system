# Student & parent portals: Results + Report Form

Before: the portal home only showed a one-line "Latest result" (total, rank).

Now (student and parent logins):
- Sidebar: "My Results" (parents: "Children's Results") and "Report Form".
- Each child card on the portal home has "View results" and "Report form" buttons.
- Results page: every PUBLISHED exam for the child: CAT 1, CAT 2, Mid/End Term, Exam Marks,
  Average and Grade per subject, total, overall average and grade, class position (e.g. 2 / 30),
  teacher's and principal's comments.
- Report Form page: pick child (parents with several children) and exam/term; formal report card
  with school letterhead, position, attendance, grading key and signature lines; "Print / Save as PDF".
- Grades use the school's own grading bands from Settings (sent by the server), not hard-coded ones.

Privacy (unchanged, enforced in api/handlers/portal.php):
- A student login only receives its own linked student record.
- A parent login only receives students whose Parent ID is the parent's record.
- Only exams with status "Published" (i.e. approved through the Exam Results workflow) are sent.

Files: js/views/portal-results.js (new), js/shell.js, js/views/portal-dashboard.js, index.html,
api/handlers/portal.php (adds grading bands + fuller school details to portal_data).
