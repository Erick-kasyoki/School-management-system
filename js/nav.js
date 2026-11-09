'use strict';
/* nav.js — sidebar navigation map, write/delete permission tables, portal URL detection.
   Part of the EraMaster frontend — loaded after core.js. */

'use strict';
/* =====================================================================
   EraMaster — app.js: auth flow, navigation, dashboard, generic module
   screens (add/edit/delete/export for every DB list), approvals inbox,
   and a basic Administration area (users, audit, security).
   Relies entirely on the helpers, state (S, DB, VER, APPR) and API
   client already defined in js/core.js.
   ===================================================================== */

/* ---------------- navigation map ---------------- */
// Each item's id is the DB/module key (matches core.js's LIST_NAMES) unless
// `special` names a dedicated screen below.
const NAV = [
  { group: 'Overview', icon: '🏠', items: [
    { id: 'dashboard', label: 'Dashboard', icon: '🏠', perm: 'dashboard.view', special: 'dashboard' },
    { id: 'approvals', label: 'Approvals', icon: '✅', perm: 'approvals.view', special: 'approvals' },
    { id: 'applyleave', label: 'Apply for Leave', icon: '🌴', perm: 'leave.request', special: 'applyLeave' },
  ]},
  { group: 'School Family', icon: '👥', items: [
    { id: 'students', label: 'Students', icon: '🎓', perm: 'students.view' },
    { id: 'parents', label: 'Parents & Guardians', icon: '👪', perm: 'parents.view' },
    { id: 'teachers', label: 'Staff', icon: '🧑‍🏫', perm: 'staff.view' },
    { id: 'applications', label: 'Admissions', icon: '📝', perm: 'admissions.view', special: 'admissions' },
  ]},
  { group: 'Academics', icon: '📚', items: [
    { id: 'classes', label: 'Classes', icon: '🏫', perm: 'academics.view' },
    { id: 'subjects', label: 'Subjects', icon: '📘', perm: 'academics.view', special: 'subjects' },
    { id: 'allocations', label: 'Subject Allocations', icon: '📚', perm: 'academics.view' },
    { id: 'lessonplans', label: 'Lesson Plans', icon: '📝', perm: 'academics.view' },
    { id: 'timetable', label: 'Timetable', icon: '🗓️', perm: 'timetable.view', special: 'timetable' },
    { id: 'exams', label: 'Exams', icon: '📄', perm: 'exams.view' },
    { id: 'homework', label: 'Homework', icon: '✏️', perm: 'homework.view' },
    { id: 'books', label: 'Library — Books', icon: '📖', perm: 'library.view' },
    { id: 'issues', label: 'Library — Issues', icon: '🔁', perm: 'library.view' },
    { id: 'clubs', label: 'Clubs & Activities', icon: '🏅', perm: 'clubs.view' },
    { id: 'memberships', label: 'Club Memberships', icon: '🙋', perm: 'clubs.view' },
    { id: 'achievements', label: 'Achievements', icon: '🏆', perm: 'clubs.view' },
    { id: 'attendance', label: 'Student Attendance', icon: '🗒️', perm: 'attendance.view', special: 'attendance' },
    { id: 'entermarks', label: 'Enter Marks', icon: '✍️', perm: ['marks.enter', 'exams.manage'], special: 'entermarks' },
    { id: 'results', label: 'Results Management', icon: '📊', perm: 'exams.view', special: 'results' },
    { id: 'reports', label: 'Reports', icon: '📈', perm: 'reports.view', special: 'reports' },
  ]},
  { group: 'Welfare', icon: '🛡️', items: [
    { id: 'discipline', label: 'Discipline', icon: '⚖️', perm: 'discipline.view' },
    { id: 'welfare', label: 'Counselling & Safeguarding', icon: '💗', perm: 'welfare.view' },
    { id: 'clinic_visits', label: 'Clinic Visits', icon: '🩺', perm: 'clinic.view' },
    { id: 'medical', label: 'Medical Records', icon: '💊', perm: 'clinic.view' },
    { id: 'dorms', label: 'Dormitories', icon: '🏠', perm: 'boarding.view' },
    { id: 'boarding', label: 'Boarding', icon: '🛏️', perm: 'boarding.view' },
    { id: 'passes', label: 'Passes', icon: '🎫', perm: 'boarding.view' },
  ]},
  { group: 'Finance', icon: '💰', items: [
    { id: 'fees', label: 'Fees Management', icon: '💰', perm: 'fees.view', special: 'fees' },
    { id: 'payments', label: 'Fee Payments', icon: '💵', perm: 'fees.view' },
    { id: 'receipts', label: 'Receipts', icon: '🧾', perm: 'fees.view', special: 'receipts' },
    { id: 'feestructures', label: 'Fee Structures', icon: '🧾', perm: 'fees.view' },
    { id: 'invoices', label: 'Invoices', icon: '📃', perm: 'fees.view' },
    { id: 'discounts', label: 'Discounts', icon: '🏷️', perm: 'fees.view' },
    { id: 'transactions', label: 'Transactions Ledger', icon: '📒', perm: 'transactions.view' },
    { id: 'budgets', label: 'Budgets', icon: '📈', perm: 'budgets.view' },
    { id: 'suppliers', label: 'Suppliers', icon: '🏭', perm: 'procurement.view' },
    { id: 'purchases', label: 'Purchases', icon: '🛒', perm: 'procurement.view' },
  ]},
  { group: 'Operations', icon: '🧰', items: [
    { id: 'inventory', label: 'Inventory', icon: '📦', perm: 'inventory.view' },
    { id: 'assets', label: 'Asset Register', icon: '💻', perm: 'assets.view' },
    { id: 'maintenance', label: 'Maintenance', icon: '🔧', perm: 'assets.view' },
    { id: 'vehicles', label: 'Transport', icon: '🚌', perm: 'transport.view' },
  ]},
  { group: 'HR', icon: '🧑‍💼', items: [
    { id: 'leave', label: 'Leave Requests', icon: '🌴', perm: ['staff.view', 'leave.request'] },
    { id: 'reviews', label: 'Performance Reviews', icon: '📋', perm: 'staff.view' },
    { id: 'training', label: 'Training', icon: '🎯', perm: 'staff.view' },
    { id: 'staff_attendance', label: 'Staff Attendance', icon: '🕘', perm: 'attendance.view', special: 'staffAttendance' },
  ]},
  { group: 'Communication', icon: '💬', items: [
    { id: 'announcements', label: 'Announcements', icon: '📢', perm: 'communication.view' },
    { id: 'chat', label: 'Staff Chat', icon: '💬', perm: 'communication.view', special: 'chat' },
    { id: 'messages', label: 'Messaging & Broadcasts', icon: '📣', perm: 'communication.view', special: 'messaging' },
    { id: 'inquiries', label: 'Inquiries', icon: '❓', perm: 'communication.view' },
    { id: 'events', label: 'Calendar & Events', icon: '📅', perm: 'events.view' },
    { id: 'documents', label: 'Documents', icon: '📁', perm: 'documents.view' },
  ]},
  { group: 'School Setup', icon: '🏫', items: [
    { id: 'settings', label: 'School Settings', icon: '⚙️', perm: 'setup.view', special: 'settings' },
    { id: 'years', label: 'Academic Years', icon: '📆', perm: 'setup.view' },
    { id: 'terms', label: 'Terms', icon: '📆', perm: 'setup.view' },
    { id: 'departments', label: 'Departments', icon: '🏢', perm: 'setup.view' },
    { id: 'houses', label: 'Houses', icon: '🏳️', perm: 'setup.view' },
    { id: 'policies', label: 'Policies', icon: '📜', perm: 'setup.view' },
  ]},
  { group: 'Administration', icon: '🔐', items: [
    { id: 'users', label: 'Users', icon: '👤', perm: 'users.manage', special: 'users' },
    { id: 'roles', label: 'Roles', icon: '🔑', perm: 'roles.manage', special: 'roles' },
    { id: 'dataimport', label: 'Data Import', icon: '📥', perm: 'import.manage', special: 'dataimport' },
    { id: 'audit', label: 'Audit Log', icon: '🧭', perm: 'audit.view', special: 'audit' },
    { id: 'security', label: 'Security Events', icon: '🛡️', perm: 'security.view', special: 'security' },
  ]},
  { group: 'Account', icon: '⚙️', items: [
    { id: 'profile', label: 'My Profile', icon: '👤', perm: null, special: 'profile' },
    { id: 'account', label: 'My Account', icon: '⚙️', perm: null, special: 'account' },
  ]},
];

// UI-only mirror of api/rbac.php dataKeys() write/delete rules, so Add/Edit/Delete
// buttons only show when the server would actually accept the change. The server
// re-checks everything regardless — this only controls what the UI offers.
const WRITE_PERMS = {
  students: ['students.create', 'students.edit'], teachers: ['staff.manage'], exams: ['exams.manage'],
  payments: ['fees.create'], transactions: ['transactions.create', 'fees.create', 'payroll.run', 'procurement.pay'],
  books: ['library.manage'], issues: ['library.manage'], inventory: ['inventory.manage'], vehicles: ['transport.manage'],
  homework: ['homework.manage'], years: ['setup.manage'], terms: ['setup.manage'], departments: ['setup.manage'],
  houses: ['setup.manage'], policies: ['setup.manage'], events: ['events.manage'],
  documents: ['documents.manage'], applications: ['admissions.manage'], parents: ['parents.manage'],
  classes: ['academics.manage'], subjects: ['academics.manage'], allocations: ['academics.manage'], lessonplans: ['academics.manage', 'academics.plan'],
  timetable: ['timetable.manage'], discipline: ['discipline.manage'], welfare: ['welfare.manage'],
  clinic_visits: ['clinic.manage'], medical: ['clinic.manage'], dorms: ['boarding.manage'], boarding: ['boarding.manage'],
  passes: ['boarding.manage'], feestructures: ['fees.manage'], invoices: ['fees.manage'], discounts: ['fees.manage'],
  budgets: ['budgets.manage'], suppliers: ['procurement.manage'], purchases: ['procurement.request', 'procurement.manage', 'procurement.pay'],
  assets: ['assets.manage'], maintenance: ['assets.manage'], leave: ['staff.manage', 'leave.request'], reviews: ['staff.manage'],
  training: ['staff.manage'], announcements: ['communication.send'], messages: ['communication.send'], broadcasts: ['communication.send'],
  inquiries: ['communication.send'], clubs: ['clubs.manage'], memberships: ['clubs.manage'], achievements: ['clubs.manage'],
  alumni: ['alumni.manage', 'students.edit'],
};
const DELETE_PERMS = { students: ['students.delete'] };
function canWrite(key){ return can(WRITE_PERMS[key] || []); }
function canDelete(key){ return can(DELETE_PERMS[key] || WRITE_PERMS[key] || []); }

let currentViewId = 'dashboard';

/* ---------------- portal detection ----------------
   Which sign-in page this is, from ?portal= on the URL. 'student' and 'parent'
   are their own portals; anything else (teacher/admin/provider/missing) is the
   shared staff portal — matches accountKind() on the server, which is what
   actually enforces the separation at login time. */
const PORTAL = (() => {
  const p = (new URLSearchParams(location.search).get('portal') || '').toLowerCase();
  return (p === 'student' || p === 'parent') ? p : 'staff';
})();
const PORTAL_META = {
  student: { tag: 'Student Portal', title: 'EraMaster', subtitle: 'Greenhill Academy — student sign in', accent: 'var(--student)', accentDark: 'var(--student-dark)' },
  parent:  { tag: 'Parent Portal',  title: 'EraMaster', subtitle: 'Greenhill Academy — parent/guardian sign in', accent: 'var(--parent)', accentDark: 'var(--parent-dark)' },
  staff:   { tag: '',                title: 'EraMaster', subtitle: 'Greenhill Academy — staff & administrator sign in', accent: 'var(--g-700)', accentDark: 'var(--staff-dark)' },
};
function signupFormIdFor(portal){ return portal === 'student' ? 'signupFormStudent' : portal === 'parent' ? 'signupFormParent' : 'signupFormStaff'; }
const ALL_SIGNUP_IDS = ['signupFormStaff', 'signupFormStudent', 'signupFormParent'];

