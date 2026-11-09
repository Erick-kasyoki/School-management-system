# Super Administrator needs no staff link
The Super Administrator (permission `*`) already has access to every screen and every action, and My Profile, Enter Marks,
Timetable and the staff-attendance auto-mark already work without a linked staff record. The only places that still nagged about a missing link were:
- Apply for Leave: the "login isn't linked" warning is replaced by a plain note that the Super Administrator can file leave for any staff member.
- Users -> Edit (Super Administrator): the staff-record picker is now labelled "not needed" instead of implying it is required.
Changed files: js/views/apply-leave.js, js/admin/users.js. No server or database change.
