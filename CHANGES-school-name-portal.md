# Fix: school name on student / parent / teacher dashboards didn't follow Settings

Cause: schoolName() read DB.settings.profile.name. Student, parent and teacher accounts can't read Settings
(settings.manage), so that value was always the built-in default "Greenhill Academy".

Fix:
- js/core.js: schoolName() now uses the same rule as applyBranding() (live settings if readable, else the public school_profile copy).
- js/views/portal-dashboard.js: the welcome banner uses the school name returned live by portal_data, falling back to schoolName().
This also fixes report cards, ID cards and receipts for those accounts.

# All money now in KSh
- js/core.js money(), js/views/receipt.js (headings, receipt totals, SMS text), api/handlers/receipt.php (printed receipt),
  api/handlers/profile.php (fee balances on profile cards), api/handlers/admissions.php + apply.html + js/adm-detail.js
  (application fee; old applications saved as GHS now also display KSh), js/crud/schemas.js (Amount / Balance / Termly Fee column labels).
- Amounts already stored are not converted, only the currency label changed.
