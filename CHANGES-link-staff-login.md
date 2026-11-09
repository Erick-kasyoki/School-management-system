> NOTE: E-mail was later removed from EraMaster entirely (see CHANGES-no-email.md); any e-mail wording below is historical.

# Fix: "Your login isn't linked to a staff record" on Apply for Leave
Cause: the login (e.g. the Super Administrator, whose e-mail/name differ from any staff record) matched no staff record,
and Administration -> Users could only link Student/Parent logins - the message told you to link it there, but staff logins had no picker.
- Users -> Edit now has a **Linked staff record** picker for every staff-type login, and the Super Administrator can be edited (link only; role/status stay locked).
- Add user also accepts an optional staff record.
- Server (`users_roles.php`) validates the staff record exists and isn't already used by another staff login.
- Editing your own link applies immediately (no sign-out needed).
