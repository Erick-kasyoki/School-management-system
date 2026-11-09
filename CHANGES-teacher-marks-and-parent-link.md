> NOTE: E-mail was later removed from EraMaster entirely (see CHANGES-no-email.md); any e-mail wording below is historical.

# Exam opener + teacher marks entry + parent link fixes

## Exams are OPENED by the exam office; teachers enter marks while open
- Academics -> Enter Marks.
  * Exam office (needs exams.manage: Exam Officer, Academic Director, Deputy Principal, Principal,
    Administrator, Super Admin): choose CAT / Mid Term Exam / End Term Exam, the term, all classes or
    some classes -> "Open exam". Each exam can be closed/re-opened from the table below.
  * Teachers see ONLY open exams: pick exam + subject, type marks 0-100, "Save marks".
    CAT -> CAT column, Mid Term Exam -> Mid Term column, End Term Exam -> End Term column.
- Only the chosen subject is saved (api/handlers/marks.php, action marks_save), so teachers do not
  overwrite each other. The server refuses entry when the exam is not open (also for the old
  Results Management grid) or is In Review / Published.
- Existing exams have no "open" flag yet, so they start Closed: open them once.
- Role upgrade: older databases keep an old Teacher role. On first request the API now ADDS the missing
  permissions once (marks.enter, exams.view for teachers; exams.manage for the office roles) and never
  removes any. New sign-ups still get "Staff (default)": set their role to Teacher in Administration -> Users.

## Parent portal "No children attached"
- Student form: "Linked Parent Record ID" is a dropdown of parents.
- Portal now also matches when the student is linked to a duplicate parent record that has the same phone
  or e-mail, or when the link is blank/deleted and the guardian phone (last 9 digits) / unique guardian name matches.
- The empty message names the parent record the login is linked to.
- If it still shows nothing: Administration -> Users -> edit the parent login and choose the parent record
  that the student is linked to (or edit the student and pick the parent shown in the message).

## Browser cache
- index.html now loads scripts with ?v=20261001b so old cached JS is not reused. Also press Ctrl+F5 once.
