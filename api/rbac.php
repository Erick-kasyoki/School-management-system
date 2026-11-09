<?php
// api/rbac.php — the security model in one place:
//   1. the permission catalogue (what can be granted),
//   2. the default roles (Principal, Teacher, Accountant, ...),
//   3. which permissions a user needs to read / write / delete each data key,
//   4. the approval workflows (multi-step sign-off chains).
//
// Changing who can do what normally needs NO code change: an administrator
// edits roles from  Administration > Users & roles  in the app. Edit this
// file only to add brand-new permissions, data keys or workflows.

/** Permissions that only a Super Administrator may hand out (prevents privilege escalation). */
const ADMIN_ONLY_PERMS = ['users.manage', 'roles.manage'];

/** Data keys whose top level is a map (object), not a list of records. */
const MAP_KEYS = ['em_marks', 'em_payroll', 'em_payroll_status', 'em_attendance', 'em_staff_attendance', 'em_comments', 'em_settings'];

function permissionCatalogue(): array {
    return [
        'Overview' => [
            'dashboard.view'     => 'View the staff dashboard',
            'approvals.view'     => 'Use the approvals inbox',
            'approvals.view_all' => 'See every approval request',
        ],
        'School' => [
            'setup.view'       => 'View school setup (years, terms, departments)',
            'setup.manage'     => 'Manage school setup',
            'events.view'      => 'View calendar & events',
            'events.manage'    => 'Manage calendar & events',
            'documents.view'   => 'View documents register',
            'documents.manage' => 'Manage documents register',
            'reports.view'     => 'View reports & analytics',
            'reports.export'   => 'Export / print reports',
        ],
        'School Family' => [
            'students.view'     => 'View students',
            'students.create'   => 'Admit students',
            'students.edit'     => 'Edit students',
            'students.delete'   => 'Delete students (sensitive)',
            'admissions.view'   => 'View admissions',
            'admissions.manage' => 'Manage admissions (Administrator: review, interview, fees, notes)',
            'admissions.decide' => 'Decide on admissions (Principal / Headteacher: approve or reject)',
            'parents.view'      => 'View parents & guardians',
            'parents.manage'    => 'Manage parents & guardians',
            'staff.view'        => 'View staff',
            'staff.manage'      => 'Manage staff & HR records',
            'leave.request'     => 'Submit staff leave requests',
            'alumni.view'       => 'View alumni',
            'alumni.manage'     => 'Manage alumni',
        ],
        'Academics' => [
            'academics.view'   => 'View classes, allocations & lesson plans',
            'academics.manage' => 'Manage classes & allocations',
            'academics.plan'   => 'Write lesson plans & schemes of work',
            'timetable.view'   => 'View timetables',
            'timetable.manage' => 'Manage timetables',
            'attendance.view'  => 'View attendance',
            'attendance.mark'  => 'Mark student attendance',
            'attendance.staff' => 'Manage staff attendance',
            'exams.view'       => 'View exams, marks & results',
            'exams.manage'     => 'Create & manage exams',
            'marks.enter'      => 'Enter / correct marks & comments',
            'marks.review'     => 'Results workflow: HOD review',
            'marks.verify'     => 'Results workflow: examination officer verification',
            'marks.approve'    => 'Results workflow: principal approval & publish',
            'homework.view'    => 'View homework',
            'homework.manage'  => 'Assign homework',
            'library.view'     => 'View library',
            'library.manage'   => 'Manage library',
            'clubs.view'       => 'View clubs, sports & activities',
            'clubs.manage'     => 'Manage clubs, sports & activities',
        ],
        'Welfare' => [
            'discipline.view'   => 'View discipline cases (restricted)',
            'discipline.manage' => 'Manage discipline cases',
            'welfare.view'      => 'View counselling & safeguarding (restricted)',
            'welfare.manage'    => 'Manage counselling & safeguarding',
            'clinic.view'       => 'View clinic records (restricted)',
            'clinic.manage'     => 'Manage clinic records',
            'boarding.view'     => 'View boarding',
            'boarding.manage'   => 'Manage boarding',
        ],
        'Finance' => [
            'fees.view'           => 'View fees & balances',
            'fees.create'         => 'Record fee payments',
            'fees.manage'         => 'Manage fee structures, invoices & discounts',
            'fees.refund'         => 'Request refunds',
            'fees.refund_review'  => 'Refund workflow: review',
            'fees.refund_approve' => 'Refund workflow: final approval',
            'transactions.view'   => 'View the transactions ledger',
            'transactions.create' => 'Add ledger transactions',
            'budgets.view'        => 'View budgets',
            'budgets.manage'      => 'Manage budgets',
            'payroll.view'        => 'View payroll (restricted)',
            'payroll.edit'        => 'Request / edit salary structures',
            'payroll.run'         => 'Run payroll',
            'payroll.approve'     => 'Approve salary changes',
            'procurement.view'      => 'View procurement',
            'procurement.request'   => 'Raise purchase requests',
            'procurement.manage'    => 'Manage suppliers & purchase orders',
            'procurement.review'    => 'Purchase workflow: department head review',
            'procurement.approve'   => 'Purchase workflow: administrator approval',
            'procurement.authorise' => 'Purchase workflow: principal authorisation',
            'procurement.pay'       => 'Pay supplier invoices',
        ],
        'Operations' => [
            'inventory.view'   => 'View inventory',
            'inventory.manage' => 'Manage inventory',
            'assets.view'      => 'View asset register',
            'assets.manage'    => 'Manage asset register',
            'transport.view'   => 'View transport',
            'transport.manage' => 'Manage transport',
        ],
        'Communication' => [
            'communication.view' => 'View announcements & messages',
            'communication.send' => 'Send announcements & messages',
            'chat.moderate'      => 'Staff chat: end and clear any channel',
        ],
        'Administration' => [
            'users.manage'    => 'Manage user accounts (Super Administrator only)',
            'roles.manage'    => 'Manage roles & permissions (Super Administrator only)',
            'audit.view'      => 'View the audit log',
            'security.view'   => 'View security events & login history',
            'settings.manage' => 'Manage system settings, backups & demo data',
            'import.manage'   => 'Data Import: upload, preview and manage imported datasets (any CSV / Excel / JSON file)',
        ],
        'Portals' => [
            'portal.parent'  => 'Parent portal',
            'portal.student' => 'Student portal',
        ],
    ];
}

function allPermissionKeys(): array {
    $out = [];
    foreach (permissionCatalogue() as $group) {
        foreach ($group as $k => $_label) { $out[] = $k; }
    }
    return $out;
}

function mergePerms(...$lists): array {
    return array_values(array_unique(array_merge(...$lists)));
}

/** The built-in roles. Inserted into the `roles` table the first time the API runs. */
function defaultRoles(): array {
    $views = array_values(array_filter(allPermissionKeys(), function ($p) {
        return substr($p, -5) === '.view' && strpos($p, 'portal.') !== 0;
    }));
    $base  = ['dashboard.view', 'events.view', 'communication.view', 'approvals.view', 'leave.request'];
    $staff = mergePerms($base, ['students.view', 'staff.view', 'exams.view', 'homework.view', 'homework.manage',
        'library.view', 'timetable.view', 'attendance.view', 'academics.view', 'leave.request']);
    $teacher = mergePerms($staff, ['attendance.mark', 'marks.enter', 'clubs.view', 'academics.plan']);

    return [
        'super_admin' => ['label' => 'Super Administrator', 'description' => 'Everything, including users, roles and settings.', 'permissions' => ['*']],
        'principal' => ['label' => 'Principal / Headteacher', 'description' => 'Heads the school: sees everything and takes the final decisions (e.g. admits or rejects applicants). Does not run user or role management.',
            'permissions' => mergePerms($views, ['leave.request', 'approvals.view_all', 'reports.export', 'audit.view', 'security.view',
                'students.edit', 'students.delete', 'admissions.decide', 'discipline.manage', 'marks.approve', 'marks.enter',
                'fees.refund_approve', 'payroll.approve', 'procurement.authorise', 'events.manage', 'communication.send', 'chat.moderate', 'setup.manage', 'exams.manage'])],
        'deputy_principal' => ['label' => 'Deputy Principal', 'description' => 'Academics, discipline and second-level approvals.',
            'permissions' => mergePerms($views, ['leave.request', 'approvals.view_all', 'reports.export', 'students.edit', 'admissions.manage',
                'discipline.manage', 'attendance.mark', 'marks.review', 'marks.verify', 'marks.enter', 'fees.refund_review',
                'procurement.review', 'procurement.approve', 'events.manage', 'communication.send', 'chat.moderate', 'academics.manage', 'exams.manage'])],
        'academic_director' => ['label' => 'Academic Director', 'description' => 'Curriculum, timetable and exams.',
            'permissions' => mergePerms($staff, ['academics.manage', 'academics.plan', 'exams.manage', 'marks.review',
                'marks.verify', 'reports.view', 'reports.export', 'setup.view', 'clubs.view', 'events.manage'])],
        'exam_officer' => ['label' => 'Examination Officer', 'description' => 'Runs exams and verifies results.',
            'permissions' => mergePerms($staff, ['exams.manage', 'marks.enter', 'marks.verify', 'reports.view', 'reports.export'])],
        // Timetable generation/editing is deliberately restricted to the HOD and
        // Administrator roles (plus the Super Administrator, who has '*').
        'hod' => ['label' => 'Head of Department', 'description' => 'Reviews marks and purchase requests for a department; builds the timetable.',
            'permissions' => mergePerms($teacher, ['marks.review', 'academics.manage', 'procurement.view', 'procurement.request', 'procurement.review', 'timetable.manage'])],
        'administrator' => ['label' => 'Administrator', 'description' => 'Runs day-to-day administration and processes applications (not final admission decisions, not user or role management).',
            'permissions' => mergePerms($views, ['leave.request', 'setup.manage', 'students.create', 'students.edit', 'admissions.manage', 'parents.manage',
                'staff.manage', 'events.manage', 'documents.manage', 'inventory.manage', 'assets.manage', 'transport.manage',
                'boarding.manage', 'communication.send', 'chat.moderate', 'procurement.manage', 'procurement.approve', 'fees.refund_review',
                'reports.export', 'clubs.manage', 'alumni.manage', 'timetable.manage', 'academics.manage', 'library.manage', 'exams.manage', 'import.manage'])],
        'accountant' => ['label' => 'Accountant', 'description' => 'Fees, ledger, budgets and payments.',
            'permissions' => mergePerms($base, ['students.view', 'staff.view', 'fees.view', 'fees.create', 'fees.manage', 'fees.refund',
                'transactions.view', 'transactions.create', 'budgets.view', 'budgets.manage', 'payroll.view', 'payroll.run',
                'procurement.view', 'procurement.pay', 'reports.view', 'reports.export', 'communication.send'])],
        'hr_officer' => ['label' => 'HR Officer', 'description' => 'Staff records, leave and salary structures.',
            'permissions' => mergePerms($base, ['students.view', 'staff.view', 'staff.manage', 'payroll.view', 'payroll.edit',
                'documents.view', 'documents.manage', 'reports.view'])],
        'teacher' => ['label' => 'Teacher', 'description' => 'Classes, attendance, marks and homework.', 'permissions' => $teacher],
        'class_teacher' => ['label' => 'Class Teacher', 'description' => 'A teacher who also handles class discipline and parents.',
            'permissions' => mergePerms($teacher, ['discipline.view', 'discipline.manage', 'parents.view'])],
        'librarian' => ['label' => 'Librarian', 'description' => 'Runs the library.',
            'permissions' => mergePerms($staff, ['library.manage'])],
        'nurse' => ['label' => 'Nurse / Clinic Officer', 'description' => 'Clinic and medical records.',
            'permissions' => mergePerms($staff, ['clinic.view', 'clinic.manage'])],
        'counsellor' => ['label' => 'Counsellor', 'description' => 'Counselling, welfare and safeguarding.',
            'permissions' => mergePerms($staff, ['welfare.view', 'welfare.manage', 'discipline.view'])],
        'transport_officer' => ['label' => 'Transport Officer', 'description' => 'Vehicles, drivers and routes.',
            'permissions' => mergePerms($staff, ['transport.view', 'transport.manage'])],
        'storekeeper' => ['label' => 'Storekeeper', 'description' => 'Inventory and purchase requests.',
            'permissions' => mergePerms($base, ['students.view', 'inventory.view', 'inventory.manage', 'assets.view', 'procurement.view', 'procurement.request', 'procurement.manage'])],
        'boarding_master' => ['label' => 'Boarding Master / Mistress', 'description' => 'Dormitories, passes and boarding attendance.',
            'permissions' => mergePerms($staff, ['boarding.view', 'boarding.manage', 'attendance.mark'])],
        'receptionist' => ['label' => 'Receptionist', 'description' => 'Front desk: admissions enquiries and parents.',
            'permissions' => mergePerms($base, ['students.view', 'parents.view', 'admissions.view', 'admissions.manage', 'documents.view'])],
        'auditor' => ['label' => 'Auditor', 'description' => 'Read-only access to everything, including audit trails.',
            'permissions' => mergePerms($views, ['approvals.view_all', 'audit.view', 'security.view', 'reports.export'])],
        'staff' => ['label' => 'Staff (default)', 'description' => 'Least-privilege starting point for new sign-ups until an administrator assigns a role.',
            'permissions' => $staff],
        'parent'  => ['label' => 'Parent', 'description' => 'Parent portal only.',  'permissions' => ['portal.parent']],
        'student' => ['label' => 'Student', 'description' => 'Student portal only.', 'permissions' => ['portal.student']],
    ];
}

/**
 * Per-data-key rules enforced on the server for get_all / set_all.
 *   read    : any-of permissions needed to receive the key
 *   write   : any-of permissions needed to create/update records
 *   delete  : any-of permissions needed to remove records (defaults to write)
 *   limited : perm => [fields] — holders of that perm (but not of `write`) may
 *             only change those fields on existing records (e.g. an accountant
 *             may change a student's fee `balance`, nothing else).
 */
function dataKeys(): array {
    $k = function (array $read, array $write, ?array $delete = null, array $limited = []) {
        return ['read' => $read, 'write' => $write, 'delete' => $delete, 'limited' => $limited];
    };
    $D = ['dashboard.view'];
    return [
        'em_students'   => $k($D, ['students.create', 'students.edit'], ['students.delete'], ['fees.create' => ['balance'], 'fees.manage' => ['balance']]),
        'em_teachers'   => $k($D, ['staff.manage']),
        'em_exams'      => $k($D, ['exams.manage']),
        'em_marks'      => $k(['exams.view'], ['marks.enter']),
        'em_comments'   => $k(['exams.view'], ['marks.enter', 'marks.approve']),
        'em_payments'   => $k(['fees.view'], ['fees.create'], ['settings.manage']),
        'em_transactions' => $k(['transactions.view'], ['transactions.create', 'fees.create', 'payroll.run', 'procurement.pay'], ['settings.manage']),
        'em_payroll'    => $k(['payroll.view'], ['payroll.edit', 'payroll.approve']),
        'em_payroll_status' => $k(['payroll.view'], ['payroll.run']),
        'em_books'      => $k(['library.view'], ['library.manage']),
        'em_issues'     => $k(['library.view'], ['library.manage']),
        'em_inventory'  => $k(['inventory.view'], ['inventory.manage']),
        'em_vehicles'   => $k(['transport.view'], ['transport.manage']),
        'em_homework'   => $k(['homework.view'], ['homework.manage']),

        'em_settings'   => $k($D, ['settings.manage', 'setup.manage']),
        'em_years'      => $k($D, ['setup.manage']),
        'em_terms'      => $k($D, ['setup.manage']),
        'em_departments' => $k($D, ['setup.manage']),
        'em_houses'     => $k($D, ['setup.manage']),
        'em_policies'   => $k($D, ['setup.manage']),
        'em_events'     => $k($D, ['events.manage']),
        'em_documents'  => $k(['documents.view'], ['documents.manage']),

        'em_applications' => $k(['admissions.view'], ['admissions.manage']),
        'em_parents'    => $k($D, ['parents.manage']),
        'em_classes'    => $k($D, ['academics.manage']),
        'em_subjects'   => $k($D, ['academics.manage']),
        'em_allocations' => $k($D, ['academics.manage']),
        'em_lessonplans' => $k(['academics.view'], ['academics.manage', 'academics.plan']),
        'em_timetable'  => $k($D, ['timetable.manage']),
        'em_attendance' => $k(['attendance.view'], ['attendance.mark']),
        'em_staff_attendance' => $k(['attendance.view'], ['attendance.staff']),

        'em_discipline' => $k(['discipline.view'], ['discipline.manage']),
        'em_welfare'    => $k(['welfare.view'], ['welfare.manage']),
        'em_clinic_visits' => $k(['clinic.view'], ['clinic.manage']),
        'em_medical'    => $k(['clinic.view'], ['clinic.manage']),
        'em_dorms'      => $k(['boarding.view'], ['boarding.manage']),
        'em_boarding'   => $k(['boarding.view'], ['boarding.manage']),
        'em_passes'     => $k(['boarding.view'], ['boarding.manage']),

        'em_feestructures' => $k(['fees.view'], ['fees.manage']),
        'em_invoices'   => $k(['fees.view'], ['fees.manage']),
        'em_discounts'  => $k(['fees.view'], ['fees.manage']),
        'em_budgets'    => $k(['budgets.view'], ['budgets.manage']),
        'em_suppliers'  => $k(['procurement.view'], ['procurement.manage']),
        'em_purchases'  => $k(['procurement.view'], ['procurement.request', 'procurement.manage', 'procurement.pay'], ['procurement.manage']),
        'em_assets'     => $k(['assets.view'], ['assets.manage']),
        'em_maintenance' => $k(['assets.view'], ['assets.manage']),

        'em_leave'      => $k(['staff.manage', 'leave.request'], ['staff.manage', 'leave.request']),
        'em_reviews'    => $k(['staff.manage'], ['staff.manage']),
        'em_training'   => $k(['staff.view'], ['staff.manage']),

        'em_announcements' => $k($D, ['communication.send']),
        'em_messages'   => $k(['communication.view'], ['communication.send', 'attendance.mark', 'discipline.manage']),
        'em_broadcasts' => $k(['communication.view'], ['communication.send']),
        'em_inquiries'  => $k(['communication.view'], ['communication.send']),

        'em_clubs'      => $k(['clubs.view'], ['clubs.manage']),
        'em_memberships' => $k(['clubs.view'], ['clubs.manage']),
        'em_achievements' => $k(['clubs.view'], ['clubs.manage']),
        'em_alumni'     => $k(['alumni.view'], ['alumni.manage', 'students.edit']),
    ];
}

/**
 * Approval workflows. Steps are fixed here (the client cannot choose them).
 *   request : permission needed to start one
 *   steps   : ordered [label, permission required to act on that step]
 *   keys    : the only data keys this workflow's automatic effects may touch
 *
 * Effects (sent by the client, validated here) run automatically:
 *   on_create  — right after the request is raised (e.g. mark exam "In Review")
 *   on_approve — after the final step is approved
 *   on_reject  — when any step rejects, or the requester cancels
 * Supported ops: append, patch, inc, delete, set_path.
 */
function workflowDefs(): array {
    return [
        'exam_results' => [
            'label' => 'Publish exam results', 'request' => 'marks.enter', 'keys' => ['em_exams'],
            'steps' => [['HOD review', 'marks.review'], ['Examination officer verification', 'marks.verify'], ['Principal approval', 'marks.approve']],
        ],
        'mark_correction' => [
            'label' => 'Marks correction', 'request' => 'marks.enter', 'keys' => ['em_marks'],
            'steps' => [['HOD review', 'marks.review'], ['Examination officer approval', 'marks.verify']],
        ],
        'purchase' => [
            'label' => 'Purchase request', 'request' => 'procurement.request', 'keys' => ['em_purchases'],
            'steps' => [['Department head review', 'procurement.review'], ['Administrator approval', 'procurement.approve'], ['Principal authorisation', 'procurement.authorise']],
        ],
        'refund' => [
            'label' => 'Fee refund', 'request' => 'fees.refund', 'keys' => ['em_transactions', 'em_students', 'em_payments'],
            'steps' => [['Administrator review', 'fees.refund_review'], ['Principal approval', 'fees.refund_approve']],
        ],
        // Cancelling a payment receipt reverses the payment, so it needs the same two sign-offs as a refund.
        'receipt_cancel' => [
            'label' => 'Cancel payment receipt', 'request' => 'fees.create', 'keys' => ['em_payments', 'em_students'],
            'steps' => [['Administrator review', 'fees.refund_review'], ['Principal approval', 'fees.refund_approve']],
        ],
        'salary_change' => [
            'label' => 'Salary change', 'request' => 'payroll.edit', 'keys' => ['em_payroll'],
            'steps' => [['Principal approval', 'payroll.approve']],
        ],
        'delete_student' => [
            'label' => 'Delete student record', 'request' => 'students.edit', 'keys' => ['em_students'],
            'steps' => [['Administrator approval', 'students.delete']],
        ],
    ];
}
