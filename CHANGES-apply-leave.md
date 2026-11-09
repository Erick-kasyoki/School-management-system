> NOTE: E-mail was later removed from EraMaster entirely (see CHANGES-no-email.md); any e-mail wording below is historical.

# Apply for Leave
- New **Apply for Leave** screen (Overview menu, right under Approvals, and a button on My Profile → Leave).
  Pick type + dates + reason → request goes to HR as *Pending*; the person sees their own requests and status.
- HR still approves/rejects under HR → Leave Requests (unchanged).
- Every staff-type role now has `leave.request` (Principal, Deputy, Administrator, Accountant, HR, Storekeeper,
  Receptionist… were missing it). Existing databases get it once via `upgradeLeaveRequestPerm()` (additive; Roles edits respected).
- Server guard (`authorizeWrite`, data.php): people who can only *request* leave can add Pending requests but can no
  longer edit/approve/delete leave records.
- Login not linked to a staff record → the screen says so (link by name/e-mail or via Users).

## Fix: "no leave request" after applying
- `myStaff()` (core.js) now also matches the login to the staff record by e-mail, same order as the server/profile page.
- Apply screen no longer defaults HR/admin logins to the first staff member; with no linked record they must choose
  who the leave is for, and the list below follows the chosen person.
