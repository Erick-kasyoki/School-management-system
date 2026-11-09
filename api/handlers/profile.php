<?php
// api/handlers/profile.php — "My Profile" for every kind of account (staff, student, parent).
//
//   profile_get     everything the profile page shows, assembled server-side and limited to the
//                   signed-in person (so it works for every role, whatever module permissions
//                   that role has).
//   profile_update  saves the details a person is allowed to maintain themselves.
//   profile_photo   saves the person's profile picture.
//
// School-owned facts (staff ID, department, class, admission no. ...) always come from the school
// records and are read-only here. Self-maintained details live in user_profiles.data.

const PROFILE_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
// Fields a person may edit about themselves, per kind of account.
const PROFILE_SELF_FIELDS = [
    'staff'   => ['dob', 'gender', 'nationality', 'maritalStatus', 'phone', 'whatsapp', 'address', 'bio', 'license', 'workingHours'],
    'student' => ['nationality', 'phone', 'whatsapp', 'address', 'bio'],
    'parent'  => ['nationality', 'maritalStatus', 'occupation', 'phone', 'whatsapp', 'address', 'bio'],
];
// HR facts on a staff profile: only someone with staff.manage may change them.
const PROFILE_HR_FIELDS = ['dateOfEmployment', 'employmentType'];
const PROFILE_TEXT_LIMITS = ['bio' => 1000, 'address' => 250, 'phone' => 30, 'whatsapp' => 30];
const PROFILE_DEFAULT_LEAVE = ['Annual Leave' => 21, 'Sick Leave' => 10, 'Compassionate' => 5];

function profileKind(array $u): string {
    $k = portalKind($u);
    return $k ?: 'staff';
}

function profileSettings(PDO $pdo, string $userId): array {
    $stmt = $pdo->prepare('SELECT data::text AS data, photo FROM user_profiles WHERE user_id = ?');
    $stmt->execute([$userId]);
    $r = $stmt->fetch();
    if (!$r) return ['data' => [], 'photo' => ''];
    $d = json_decode((string)$r['data'], true);
    return ['data' => is_array($d) ? $d : [], 'photo' => (string)($r['photo'] ?? '')];
}

/** The teacher/staff record this login belongs to: saved link, then e-mail, then exact name. */
function profileStaffRecord(PDO $pdo, array $u): ?array {
    $list = loadAssoc($pdo, 'em_teachers', []);
    $link = trim((string)($u['linked_id'] ?? ''));
    if ($link !== '') foreach ($list as $t) { if ((string)($t['id'] ?? '') === $link) return $t; }
    $mail = strtolower(trim((string)($u['email'] ?? '')));
    if ($mail !== '') foreach ($list as $t) { if (strtolower(trim((string)($t['email'] ?? ''))) === $mail) return $t; }
    $name = strtolower(trim((string)($u['name'] ?? '')));
    foreach ($list as $t) { if ($name !== '' && strtolower(trim((string)($t['name'] ?? ''))) === $name) return $t; }
    return null;
}

/** The school day, top to bottom — keep in step with TT_SCHEDULE in js/views/timetable.js.
 *  Rows with a 'lesson' number are teaching slots (stored as period = lesson number);
 *  the rest are fixed parts of the day. Times are written as on the school's timetable (12-hour, no am/pm). */
const PROFILE_SCHEDULE = [
    ['start' => '8:00',  'end' => '8:20',  'label' => 'Assembly / Morning Parade'],
    ['start' => '8:20',  'end' => '9:00',  'lesson' => 1],
    ['start' => '9:00',  'end' => '9:40',  'lesson' => 2],
    ['start' => '9:40',  'end' => '10:20', 'lesson' => 3],
    ['start' => '10:20', 'end' => '10:40', 'label' => 'Break'],
    ['start' => '10:40', 'end' => '11:20', 'lesson' => 4],
    ['start' => '11:20', 'end' => '12:00', 'lesson' => 5],
    ['start' => '12:00', 'end' => '12:40', 'lesson' => 6],
    ['start' => '12:40', 'end' => '1:40',  'label' => 'Lunch Break'],
    ['start' => '1:40',  'end' => '2:20',  'lesson' => 7],
    ['start' => '2:20',  'end' => '3:00',  'lesson' => 8],
    ['start' => '3:00',  'end' => '3:40',  'lesson' => 9],
    ['start' => '3:40',  'end' => '4:20',  'label' => 'Games / Creative Activities'],
    ['start' => '4:20',  'end' => '5:00',  'label' => 'Revision / Class Duties / Departure'],
];

/** "1:40" -> "13:40" (school hours are 8:00–5:00, so an hour below 7 is afternoon). */
function profileTo24(string $t): string {
    [$h, $m] = array_map('intval', explode(':', $t));
    if ($h < 7) $h += 12;
    return sprintf('%02d:%02d', $h, $m);
}

/** Time slot of a lesson in 24-hour form ("13:40 – 14:20"), which the profile screen turns into 12-hour; '' if unknown. */
function profilePeriodTime($p): string {
    foreach (PROFILE_SCHEDULE as $r) {
        if (isset($r['lesson']) && $r['lesson'] === (int)$p) return profileTo24($r['start']) . ' – ' . profileTo24($r['end']);
    }
    return '';
}

/** Time slot of a lesson as the timetable shows it ("1:40–2:20"). */
function profileLessonShort($p): string {
    foreach (PROFILE_SCHEDULE as $r) {
        if (isset($r['lesson']) && $r['lesson'] === (int)$p) return $r['start'] . '–' . $r['end'];
    }
    return '';
}

/** "Mon, Wed, Fri (Lesson 1, 8:20–9:00)" from a list of ['day'=>..,'period'=>..] slots. */
function profileSlotText(array $slots): string {
    $byPeriod = [];
    foreach ($slots as $s) {
        $d = substr((string)($s['day'] ?? ''), 0, 3);
        $byPeriod[(int)($s['period'] ?? 1)][$d] = array_search((string)($s['day'] ?? ''), PROFILE_DAYS, true);
    }
    ksort($byPeriod);
    $parts = [];
    foreach ($byPeriod as $period => $days) {
        asort($days);
        $when = profileLessonShort($period);
        $parts[] = implode(', ', array_keys($days)) . ' (Lesson ' . $period . ($when !== '' ? ', ' . $when : '') . ')';
    }
    return implode('; ', $parts);
}

/** Joins the non-empty parts with a separator (avoids trim() on a multi-byte character). */
function profileJoin(array $parts, string $sep = ' · '): string {
    return implode($sep, array_filter($parts, function ($p) { return trim((string)$p) !== ''; }));
}

function profileClassLabel(array $x): string {
    return trim((string)($x['grade'] ?? '') . ' ' . (string)($x['stream'] ?? ''));
}

/** Attendance % from a student's records ('P','L','E' present; 'AE','AU' absent). null = nothing recorded. */
function profileStudentAttendance(array $att, string $sid, ?string $monthPrefix = null): ?int {
    $present = 0; $absent = 0;
    foreach ($att as $k => $recs) {
        if (!is_array($recs) || !isset($recs[$sid])) continue;
        if ($monthPrefix !== null && strpos((string)$k, $monthPrefix) !== 0) continue;
        $s = $recs[$sid]['s'] ?? '';
        if (in_array($s, ['P', 'L', 'E'], true)) $present++;
        if (in_array($s, ['AE', 'AU'], true))     $absent++;
    }
    $t = $present + $absent;
    return $t ? (int)round($present * 100 / $t) : null;
}

function profileDaysBetween(string $a, string $b): int {
    $x = strtotime($a); $y = strtotime($b);
    return ($x && $y && $y >= $x) ? (int)(round(($y - $x) / 86400) + 1) : 0;
}

function profileRow(string $key, string $label, $value, bool $editable, string $type = 'text', array $options = []): array {
    $r = ['key' => $key, 'label' => $label, 'value' => (string)($value ?? ''), 'editable' => $editable, 'type' => $type];
    if ($options) $r['options'] = $options;
    return $r;
}

function profileGet(): void {
    global $pdo;
    $u    = requireUser($pdo);
    $kind = profileKind($u);
    $mine = profileSettings($pdo, (string)$u['id']);
    $own  = $mine['data'];
    $hr   = userCan($u, 'staff.manage');
    $self = PROFILE_SELF_FIELDS[$kind];
    // value shown for a self-maintained field: what the person saved, else the school's record
    $pick = function (string $key, $fallback = '') use ($own) {
        return (isset($own[$key]) && $own[$key] !== '') ? $own[$key] : $fallback;
    };
    $edit = function (string $key) use ($self): bool { return in_array($key, $self, true); };

    $tt        = loadAssoc($pdo, 'em_timetable', []);
    $students  = loadAssoc($pdo, 'em_students', []);
    $att       = loadAssoc($pdo, 'em_attendance', []);
    $settings  = loadAssoc($pdo, 'em_settings', []);
    $teachers  = loadAssoc($pdo, 'em_teachers', []);
    $tname = [];
    foreach ($teachers as $t) { if (isset($t['id'])) $tname[$t['id']] = $t['name'] ?? ''; }
    // "today" as the person's own browser sees it (the server's clock may be in another time zone)
    $todayYmd  = (isset($_GET['today']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$_GET['today'])) ? (string)$_GET['today'] : date('Y-m-d');
    $todayName = date('l', strtotime($todayYmd . ' 12:00:00'));
    $monthKey  = substr($todayYmd, 0, 7);

    $out = [
        'ok' => true, 'kind' => $kind, 'teaching' => false, 'linked' => false,
        'header' => [], 'personal' => [], 'professional' => [], 'bio' => '', 'bioEditable' => $edit('bio'),
        'summary' => [], 'lessons' => [], 'events' => [], 'classes' => null, 'week' => null,
        'leave' => null, 'leaveRows' => [], 'attendance' => [], 'extras' => [], 'documents' => [], 'activity' => [],
        'fees' => [], 'tabs' => [],
    ];

    /* ----------------------------- STAFF ----------------------------- */
    if ($kind === 'staff') {
        $rec = profileStaffRecord($pdo, $u);
        // The Super Administrator's login IS their record — it never needs a teacher/staff link.
        $out['linked'] = $rec !== null || !empty($u['is_admin']);
        $tid = $rec['id'] ?? '';
        $deptName = '';
        if (!empty($rec['departmentId'])) {
            foreach (loadAssoc($pdo, 'em_departments', []) as $d) { if (($d['id'] ?? '') === $rec['departmentId']) $deptName = (string)($d['name'] ?? ''); }
        }
        $position = (string)($rec['jobTitle'] ?? '') ?: (string)($u['role_label'] ?? $u['role'] ?? '');
        $phone = $pick('phone', $rec['phone'] ?? '');
        $out['header'] = [
            'name' => (string)$u['name'], 'badge' => $position, 'subtitle' => $deptName,
            'idLabel' => 'Staff ID', 'idValue' => (string)($rec['staffNo'] ?? ''),
            'email' => (string)($rec['email'] ?? '') ?: (string)$u['email'], 'phone' => $phone,
            'whatsapp' => $pick('whatsapp', $phone), 'address' => $pick('address'),
        ];
        $out['personal'] = [
            profileRow('fullName', 'Full Name', $u['name'], false),
            profileRow('maritalStatus', 'Marital Status', $pick('maritalStatus'), $edit('maritalStatus'), 'select', ['Single', 'Married', 'Divorced', 'Widowed']),
            profileRow('dob', 'Date of Birth', $pick('dob'), $edit('dob'), 'date'),
            profileRow('phone', 'Phone Number', $phone, $edit('phone'), 'tel'),
            profileRow('gender', 'Gender', $pick('gender', $rec['gender'] ?? ''), $edit('gender'), 'select', ['Male', 'Female']),
            profileRow('email', 'Email Address', $out['header']['email'], false),
            profileRow('nationality', 'Nationality', $pick('nationality'), $edit('nationality')),
            profileRow('address', 'Residential Address', $pick('address'), $edit('address')),
        ];
        $out['professional'] = [
            profileRow('employeeId', 'Employee ID', $rec['staffNo'] ?? '', false),
            profileRow('dateOfEmployment', 'Date of Employment', $pick('dateOfEmployment'), $hr, 'date'),
            profileRow('department', 'Department', $deptName, false),
            profileRow('qualification', 'Qualification', $rec['qualification'] ?? '', false),
            profileRow('position', 'Position', $position, false),
            profileRow('license', 'Professional License', $pick('license'), $edit('license')),
            profileRow('employmentType', 'Employment Type', $pick('employmentType'), $hr, 'select', ['Full Time', 'Part Time', 'Contract', 'Volunteer']),
            profileRow('workingHours', 'Working Hours', $pick('workingHours', '08:00 AM - 05:00 PM'), $edit('workingHours')),
        ];
        $out['bio'] = (string)$pick('bio');

        // timetable → this teacher's lessons
        $mineLessons = [];
        if ($tid !== '') foreach ($tt as $e) { if (($e['teacherId'] ?? '') === $tid && ($e['kind'] ?? 'Lesson') === 'Lesson') $mineLessons[] = $e; }
        $out['teaching'] = count($mineLessons) > 0;

        $groups = [];     // class label → [subjects[], slots[], room]
        foreach ($mineLessons as $e) {
            $cl = profileClassLabel($e);
            $groups[$cl]['key'] = ($e['grade'] ?? '') . '|' . ($e['stream'] ?? '');
            $groups[$cl]['subjects'][(string)($e['subject'] ?? '')] = true;
            $groups[$cl]['slots'][] = ['day' => $e['day'] ?? '', 'period' => $e['period'] ?? 1];
            if (!empty($e['room'])) $groups[$cl]['room'] = (string)$e['room'];
        }
        $rows = []; $allSubjects = []; $studentIds = [];
        foreach ($groups as $label => $g) {
            $inClass = [];
            foreach ($students as $s) {
                if (($s['status'] ?? 'Active') !== 'Active') continue;
                if (($s['grade'] ?? '') . '|' . ($s['stream'] ?? '') === $g['key'] || (($s['grade'] ?? '') === explode('|', $g['key'])[0] && explode('|', $g['key'])[1] === '')) {
                    $inClass[] = $s; $studentIds[$s['id'] ?? ''] = true;
                }
            }
            $subs = array_keys($g['subjects']);
            foreach ($subs as $x) $allSubjects[$x] = true;
            usort($g['slots'], function ($a, $b) { return array_search($a['day'], PROFILE_DAYS, true) <=> array_search($b['day'], PROFILE_DAYS, true); });
            $rows[] = [
                'cells' => [$label, implode(', ', $subs), (string)count($inClass), profileSlotText($g['slots']), $g['room'] ?? '—'],
                'detail' => ['title' => $label . ' — ' . implode(', ', $subs), 'lines' => array_map(function ($s) { return ($s['admNo'] ?? '') . '  ' . ($s['name'] ?? ''); }, $inClass)],
            ];
        }
        if ($rows) $out['classes'] = ['title' => 'My Classes', 'columns' => ['Class', 'Subject', 'Students', 'Schedule', 'Room', 'Action'], 'rows' => $rows];

        foreach ($mineLessons as $e) {
            if (($e['day'] ?? '') === $todayName) $out['lessons'][] = ['period' => (int)$e['period'], 'time' => profilePeriodTime($e['period']), 'label' => profileClassLabel($e) . ' - ' . ($e['subject'] ?? '')];
        }
        usort($out['lessons'], function ($a, $b) { return $a['period'] <=> $b['period']; });
        $out['week'] = profileWeekGrid($mineLessons, function ($e) { return profileClassLabel($e) . ' · ' . ($e['subject'] ?? ''); });

        // staff attendance this month (only days someone actually recorded)
        $sa = loadAssoc($pdo, 'em_staff_attendance', []);
        $pres = 0; $tot = 0; $attRows = [];
        krsort($sa);
        foreach ($sa as $date => $day) {
            if (!is_array($day) || $tid === '' || !isset($day[$tid])) continue;
            $r = $day[$tid];
            if (strpos((string)$date, $monthKey) === 0) { $tot++; if (($r['s'] ?? '') !== 'A') $pres++; }
            if (count($attRows) < 31) $attRows[] = ['date' => (string)$date, 'status' => ($r['s'] ?? '') === 'A' ? 'Absent' : 'Present', 'note' => profileJoin([profileJoin([(string)($r['in'] ?? ''), (string)($r['out'] ?? '')], ' – '), (string)($r['n'] ?? '')])];
        }
        $attPct = $tot ? (int)round($pres * 100 / $tot) : null;
        $out['attendance'] = $attRows;

        // leave
        $ent = $settings['leaveEntitlements'] ?? [];
        $year = substr($todayYmd, 0, 4); $used = [];
        $leaveRows = [];
        foreach (loadAssoc($pdo, 'em_leave', []) as $l) {
            if ($tid === '' || ($l['teacherId'] ?? '') !== $tid) continue;
            $leaveRows[] = ['type' => $l['leaveType'] ?? '', 'from' => $l['startDate'] ?? '', 'to' => $l['endDate'] ?? '', 'status' => $l['status'] ?? '', 'reason' => $l['reason'] ?? ''];
            if (in_array($l['status'] ?? '', ['Approved', 'Completed', 'Expired'], true) && strpos((string)($l['startDate'] ?? ''), $year) === 0) {
                $used[$l['leaveType'] ?? ''] = ($used[$l['leaveType'] ?? ''] ?? 0) + profileDaysBetween((string)$l['startDate'], (string)$l['endDate']);
            }
        }
        usort($leaveRows, function ($a, $b) { return strcmp((string)$b['from'], (string)$a['from']); });
        $out['leaveRows'] = array_slice($leaveRows, 0, 30);
        $bal = [];
        foreach (PROFILE_DEFAULT_LEAVE as $type => $days) {
            $total = isset($ent[$type]) && is_numeric($ent[$type]) ? (int)$ent[$type] : $days;
            $bal[] = ['type' => $type, 'remaining' => max(0, $total - ($used[$type] ?? 0)), 'total' => $total];
        }
        $out['leave'] = $bal;

        // summary tiles
        if ($out['teaching']) {
            $out['summary'] = [
                ['label' => 'Classes Assigned', 'value' => (string)count($groups), 'icon' => 'users', 'tone' => 'blue'],
                ['label' => 'Total Students', 'value' => (string)count($studentIds), 'icon' => 'book', 'tone' => 'green'],
                ['label' => 'Subjects Teaching', 'value' => (string)count($allSubjects), 'icon' => 'file', 'tone' => 'orange'],
                ['label' => 'Attendance (This Month)', 'value' => $attPct === null ? '—' : $attPct . '%', 'icon' => 'calendar', 'tone' => 'purple'],
            ];
        } else {
            $trainings = 0; $reviews = 0;
            foreach (loadAssoc($pdo, 'em_training', []) as $t) { if ($tid !== '' && ($t['teacherId'] ?? '') === $tid) $trainings++; }
            foreach (loadAssoc($pdo, 'em_reviews', []) as $t) { if ($tid !== '' && ($t['teacherId'] ?? '') === $tid) $reviews++; }
            $out['summary'] = [
                ['label' => 'Attendance (This Month)', 'value' => $attPct === null ? '—' : $attPct . '%', 'icon' => 'calendar', 'tone' => 'purple'],
                ['label' => 'Leave Taken (Days)', 'value' => (string)array_sum($used), 'icon' => 'file', 'tone' => 'orange'],
                ['label' => 'Training Courses', 'value' => (string)$trainings, 'icon' => 'book', 'tone' => 'green'],
                ['label' => 'Performance Reviews', 'value' => (string)$reviews, 'icon' => 'users', 'tone' => 'blue'],
            ];
        }
        // professional-tab extras
        foreach (loadAssoc($pdo, 'em_training', []) as $t) {
            if ($tid !== '' && ($t['teacherId'] ?? '') === $tid) $out['extras'][] = ['kind' => 'Training', 'title' => (string)($t['title'] ?? ''), 'detail' => profileJoin([(string)($t['provider'] ?? ''), (string)($t['startDate'] ?? '')]), 'status' => (string)($t['status'] ?? '')];
        }
        foreach (loadAssoc($pdo, 'em_reviews', []) as $t) {
            if ($tid !== '' && ($t['teacherId'] ?? '') === $tid) $out['extras'][] = ['kind' => 'Review', 'title' => (string)($t['period'] ?? 'Performance review'), 'detail' => profileJoin(['Rated ' . (string)($t['rating'] ?? '—'), (string)($t['reviewDate'] ?? '')]), 'status' => (string)($t['status'] ?? '')];
        }
        $out['tabs'] = [
            ['id' => 'overview', 'label' => 'Profile Overview'], ['id' => 'professional', 'label' => 'Professional Info'],
            ['id' => 'teaching', 'label' => 'Teaching'], ['id' => 'documents', 'label' => 'Documents'],
            ['id' => 'leave', 'label' => 'Leave & Attendance'], ['id' => 'activity', 'label' => 'Activity Log'],
        ];
    }

    /* ----------------------------- STUDENT ----------------------------- */
    if ($kind === 'student') {
        $me = null;
        $link = portalResolveLink($pdo, $u, 'student');
        foreach ($students as $s) { if ($link !== '' && (string)($s['id'] ?? '') === $link) $me = $s; }
        $out['linked'] = $me !== null;
        $cls = $me ? profileClassLabel($me) : '';
        $phone = $pick('phone');
        $out['header'] = [
            'name' => (string)$u['name'], 'badge' => 'Student', 'subtitle' => $cls,
            'idLabel' => 'Admission No', 'idValue' => (string)($me['admNo'] ?? ''),
            'email' => (string)$u['email'], 'phone' => $phone, 'whatsapp' => $pick('whatsapp', $phone), 'address' => $pick('address', $me['address'] ?? ''),
        ];
        $out['personal'] = [
            profileRow('fullName', 'Full Name', $u['name'], false),
            profileRow('dobS', 'Date of Birth', $me['dob'] ?? '', false, 'date'),
            profileRow('genderS', 'Gender', $me['gender'] ?? '', false),
            profileRow('nationality', 'Nationality', $pick('nationality'), $edit('nationality')),
            profileRow('phone', 'Phone Number', $phone, $edit('phone'), 'tel'),
            profileRow('email', 'Email Address', $u['email'], false),
            profileRow('address', 'Residential Address', $pick('address', $me['address'] ?? ''), $edit('address')),
            profileRow('guardianS', 'Guardian', trim((string)($me['guardian'] ?? '') . ' ' . (string)($me['guardianPhone'] ?? '')), false),
        ];
        $out['professional'] = [
            profileRow('admNo', 'Admission No', $me['admNo'] ?? '', false),
            profileRow('classS', 'Class', $cls, false),
            profileRow('house', 'House', $me['house'] ?? '', false),
            profileRow('admissionDate', 'Date of Admission', $me['admissionDate'] ?? '', false, 'date'),
            profileRow('statusS', 'Status', $me['status'] ?? '', false),
        ];
        $out['bio'] = (string)$pick('bio');
        $mineLessons = [];
        if ($me) foreach ($tt as $e) { if (($e['grade'] ?? '') === ($me['grade'] ?? '') && ($e['stream'] ?? '') === ($me['stream'] ?? '') && ($e['kind'] ?? 'Lesson') === 'Lesson') $mineLessons[] = $e; }
        $sub = [];
        foreach ($mineLessons as $e) { $sub[(string)($e['subject'] ?? '')]['slots'][] = ['day' => $e['day'] ?? '', 'period' => $e['period'] ?? 1]; $sub[(string)($e['subject'] ?? '')]['t'] = $tname[$e['teacherId'] ?? ''] ?? '—'; $sub[(string)($e['subject'] ?? '')]['room'] = $e['room'] ?? '—'; }
        $rows = [];
        foreach ($sub as $name => $g) $rows[] = ['cells' => [$name, $g['t'], (string)count($g['slots']), profileSlotText($g['slots']), $g['room'] ?: '—'], 'detail' => null];
        if ($rows) $out['classes'] = ['title' => 'My Subjects', 'columns' => ['Subject', 'Teacher', 'Periods / Week', 'Schedule', 'Room'], 'rows' => $rows];
        foreach ($mineLessons as $e) { if (($e['day'] ?? '') === $todayName) $out['lessons'][] = ['period' => (int)$e['period'], 'time' => profilePeriodTime($e['period']), 'label' => ($e['subject'] ?? '') . ' - ' . ($tname[$e['teacherId'] ?? ''] ?? '')]; }
        usort($out['lessons'], function ($a, $b) { return $a['period'] <=> $b['period']; });
        $out['week'] = profileWeekGrid($mineLessons, function ($e) { return ($e['subject'] ?? ''); });
        $out['teaching'] = (bool)$mineLessons;
        $sid = (string)($me['id'] ?? '');
        $pct = $sid !== '' ? profileStudentAttendance($att, $sid) : null;
        $out['attendance'] = $sid !== '' ? profileStudentAttendanceRows($att, $sid) : [];
        $out['summary'] = [
            ['label' => 'Class', 'value' => $cls ?: '—', 'icon' => 'users', 'tone' => 'blue'],
            ['label' => 'Subjects', 'value' => (string)count($sub), 'icon' => 'book', 'tone' => 'green'],
            ['label' => 'Fee Balance', 'value' => $me ? 'KSh ' . number_format((float)($me['balance'] ?? 0), 2) : '—', 'icon' => 'file', 'tone' => 'orange'],
            ['label' => 'Attendance', 'value' => $pct === null ? '—' : $pct . '%', 'icon' => 'calendar', 'tone' => 'purple'],
        ];
        if ($me) $out['fees'][] = ['name' => $me['name'] ?? '', 'balance' => (float)($me['balance'] ?? 0)];
        $out['tabs'] = [
            ['id' => 'overview', 'label' => 'Profile Overview'], ['id' => 'professional', 'label' => 'Academic Info'],
            ['id' => 'teaching', 'label' => 'Timetable'], ['id' => 'documents', 'label' => 'Documents'],
            ['id' => 'leave', 'label' => 'Attendance'], ['id' => 'activity', 'label' => 'Activity Log'],
        ];
    }

    /* ----------------------------- PARENT ----------------------------- */
    if ($kind === 'parent') {
        $link = portalResolveLink($pdo, $u, 'parent');
        $me = null;
        foreach (loadAssoc($pdo, 'em_parents', []) as $p) { if ($link !== '' && (string)($p['id'] ?? '') === $link) $me = $p; }
        $out['linked'] = $me !== null;
        $phone = $pick('phone', $me['phone'] ?? '');
        $out['header'] = [
            'name' => (string)$u['name'], 'badge' => (string)($me['relationship'] ?? '') ?: 'Parent / Guardian', 'subtitle' => 'Parent Portal',
            'idLabel' => '', 'idValue' => '',
            'email' => (string)($me['email'] ?? '') ?: (string)$u['email'], 'phone' => $phone, 'whatsapp' => $pick('whatsapp', $phone), 'address' => $pick('address', $me['address'] ?? ''),
        ];
        $out['personal'] = [
            profileRow('fullName', 'Full Name', $u['name'], false),
            profileRow('maritalStatus', 'Marital Status', $pick('maritalStatus'), $edit('maritalStatus'), 'select', ['Single', 'Married', 'Divorced', 'Widowed']),
            profileRow('relationshipP', 'Relationship', $me['relationship'] ?? '', false),
            profileRow('phone', 'Phone Number', $phone, $edit('phone'), 'tel'),
            profileRow('nationality', 'Nationality', $pick('nationality'), $edit('nationality')),
            profileRow('email', 'Email Address', $out['header']['email'], false),
            profileRow('occupation', 'Occupation', $pick('occupation'), $edit('occupation')),
            profileRow('address', 'Residential Address', $pick('address', $me['address'] ?? ''), $edit('address')),
        ];
        $out['bio'] = (string)$pick('bio');
        $children = [];
        if ($me) {
            $samePerson = [$link => true];
            $myPhone = substr(normalizePhone((string)($me['phone'] ?? '')), -9);
            foreach ($students as $s) {
                $sp = trim((string)($s['parentId'] ?? ''));
                $gPhone = substr(normalizePhone((string)($s['guardianPhone'] ?? '')), -9);
                if (($sp !== '' && isset($samePerson[$sp])) || ($sp === '' && strlen($myPhone) === 9 && $gPhone === $myPhone)) $children[] = $s;
            }
        }
        $rows = []; $bal = 0.0; $pcts = [];
        foreach ($children as $s) {
            $pct = profileStudentAttendance($att, (string)$s['id']);
            if ($pct !== null) $pcts[] = $pct;
            $bal += (float)($s['balance'] ?? 0);
            $out['fees'][] = ['name' => $s['name'] ?? '', 'balance' => (float)($s['balance'] ?? 0)];
            $rows[] = ['cells' => [(string)($s['name'] ?? ''), profileClassLabel($s), (string)($s['admNo'] ?? ''), $pct === null ? '—' : $pct . '%', 'KSh ' . number_format((float)($s['balance'] ?? 0), 2)], 'detail' => null];
        }
        $out['classes'] = ['title' => 'My Children', 'columns' => ['Child', 'Class', 'Admission No', 'Attendance', 'Fee Balance'], 'rows' => $rows];
        $upcoming = 0;
        foreach (loadAssoc($pdo, 'em_events', []) as $e) { if (($e['date'] ?? '') >= $todayYmd && in_array($e['audience'] ?? 'Everyone', ['Everyone', 'Parents'], true)) $upcoming++; }
        $out['summary'] = [
            ['label' => 'Children', 'value' => (string)count($children), 'icon' => 'users', 'tone' => 'blue'],
            ['label' => 'Total Fee Balance', 'value' => 'KSh ' . number_format($bal, 2), 'icon' => 'file', 'tone' => 'orange'],
            ['label' => 'Avg. Attendance', 'value' => $pcts ? (int)round(array_sum($pcts) / count($pcts)) . '%' : '—', 'icon' => 'calendar', 'tone' => 'purple'],
            ['label' => 'Upcoming Events', 'value' => (string)$upcoming, 'icon' => 'book', 'tone' => 'green'],
        ];
        $out['professional'] = [];
        $out['attendance'] = [];
        foreach ($children as $s) { foreach (array_slice(profileStudentAttendanceRows($att, (string)$s['id']), 0, 10) as $r) { $r['note'] = trim(($s['name'] ?? '') . ' ' . $r['note']); $out['attendance'][] = $r; } }
        $out['tabs'] = [
            ['id' => 'overview', 'label' => 'Profile Overview'], ['id' => 'teaching', 'label' => 'Children'],
            ['id' => 'documents', 'label' => 'Documents'], ['id' => 'leave', 'label' => 'Attendance'], ['id' => 'activity', 'label' => 'Activity Log'],
        ];
    }

    /* ----------- shared: events, documents, activity, photo ----------- */
    if (!$out['lessons']) {
        $aud = $kind === 'staff' ? ['Everyone', 'Staff'] : ($kind === 'student' ? ['Everyone', 'Students'] : ['Everyone', 'Parents']);
        $evs = [];
        foreach (loadAssoc($pdo, 'em_events', []) as $e) {
            if (($e['date'] ?? '') >= $todayYmd && in_array($e['audience'] ?? 'Everyone', $aud, true)) $evs[] = ['date' => $e['date'], 'time' => (string)($e['time'] ?? ''), 'title' => (string)($e['title'] ?? ''), 'venue' => (string)($e['venue'] ?? '')];
        }
        usort($evs, function ($a, $b) { return strcmp($a['date'] . $a['time'], $b['date'] . $b['time']); });
        $out['events'] = array_slice($evs, 0, 5);
    }
    foreach (loadAssoc($pdo, 'em_documents', []) as $d) {
        if (($d['status'] ?? 'Published') === 'Published') $out['documents'][] = ['title' => (string)($d['title'] ?? ''), 'category' => (string)($d['category'] ?? ''), 'description' => (string)($d['description'] ?? ''), 'date' => (string)($d['date'] ?? '')];
    }
    $out['documents'] = array_slice($out['documents'], 0, 40);

    $stmt = $pdo->prepare('SELECT action, entity, summary, at FROM audit_logs WHERE user_id = ? ORDER BY at DESC LIMIT 50');
    $stmt->execute([(string)$u['id']]);
    $out['activity'] = array_map(function ($r) {
        return ['action' => $r['action'], 'entity' => $r['entity'], 'summary' => $r['summary'], 'at' => date('c', strtotime((string)$r['at']))];
    }, $stmt->fetchAll());

    // picture: what the person uploaded, else the photo on their school record
    $photo = $mine['photo'];
    if ($photo === '') {
        if ($kind === 'student' && !empty($me['photo'])) $photo = (string)$me['photo'];
        if ($kind === 'staff' && !empty($rec['photo']))  $photo = (string)$rec['photo'];
    }
    $out['header']['photo'] = $photo;
    $out['canEditHr'] = $hr;
    respond($out);
}

/** Mon–Fri grid following the school day: one row per slot of PROFILE_SCHEDULE (lessons carry the
 *  cells; assembly / break / lunch / games / revision come back as full-width bands with a 'label'). */
function profileWeekGrid(array $entries, callable $label): ?array {
    if (!$entries) return null;
    $max = 0; $grid = [];
    foreach ($entries as $e) {
        $p = (int)($e['period'] ?? 1); $max = max($max, $p);
        $grid[$p][(string)($e['day'] ?? '')][] = $label($e);
    }
    $cellsFor = function (int $p) use ($grid) {
        $cells = [];
        foreach (PROFILE_DAYS as $d) $cells[] = isset($grid[$p][$d]) ? implode(' / ', $grid[$p][$d]) : '';
        return $cells;
    };
    $rows = []; $last = 0;
    foreach (PROFILE_SCHEDULE as $r) {
        $time = profileTo24($r['start']) . ' – ' . profileTo24($r['end']);
        if (isset($r['lesson'])) {
            $last = $r['lesson'];
            $rows[] = ['lesson' => $r['lesson'], 'time' => $time, 'cells' => $cellsFor($r['lesson'])];
        } else {
            $rows[] = ['label' => $r['label'], 'time' => $time];
        }
    }
    // Lessons numbered beyond the day plan (older data) are kept visible after the last row.
    for ($p = $last + 1; $p <= $max; $p++) $rows[] = ['lesson' => $p, 'time' => '', 'cells' => $cellsFor($p)];
    return ['days' => PROFILE_DAYS, 'rows' => $rows];
}

function profileStudentAttendanceRows(array $att, string $sid): array {
    $labels = ['P' => 'Present', 'L' => 'Late', 'E' => 'Excused', 'AE' => 'Absent (excused)', 'AU' => 'Absent'];
    $rows = [];
    foreach ($att as $k => $recs) {
        if (!is_array($recs) || !isset($recs[$sid])) continue;
        $parts = explode('|', (string)$k);
        $s = $recs[$sid]['s'] ?? '';
        $rows[] = ['date' => $parts[0], 'status' => $labels[$s] ?? $s, 'note' => trim(($parts[1] ?? '') . ' ' . ($recs[$sid]['n'] ?? ''))];
    }
    usort($rows, function ($a, $b) { return strcmp($b['date'], $a['date']); });
    return array_slice($rows, 0, 31);
}

function profileUpdate(): void {
    global $pdo;
    $u    = requireUser($pdo);
    $kind = profileKind($u);
    $b    = input();
    $allowed = PROFILE_SELF_FIELDS[$kind];
    if ($kind === 'staff' && userCan($u, 'staff.manage')) $allowed = array_merge($allowed, PROFILE_HR_FIELDS);

    $stmt = $pdo->prepare('SELECT data::text FROM user_profiles WHERE user_id = ?');
    $stmt->execute([(string)$u['id']]);
    $cur = json_decode((string)$stmt->fetchColumn(), true);
    $cur = is_array($cur) ? $cur : [];

    $changed = [];
    foreach ($allowed as $k) {
        if (!array_key_exists($k, $b)) continue;
        $v = trim((string)$b[$k]);
        $v = mb_substr($v, 0, PROFILE_TEXT_LIMITS[$k] ?? 120);
        if (in_array($k, ['dob', 'dateOfEmployment'], true) && $v !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) respond(['ok' => false, 'error' => 'Enter that date as YYYY-MM-DD.'], 400);
        if ($v !== ($cur[$k] ?? '')) { $cur[$k] = $v; $changed[] = $k; }
    }
    if (!$changed) respond(['ok' => true, 'changed' => 0]);

    $pdo->beginTransaction();
    try {
        $pdo->prepare('INSERT INTO user_profiles (user_id, data, updated_at) VALUES (?, CAST(? AS jsonb), now())
                       ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()')
            ->execute([(string)$u['id'], json_encode($cur, JSON_UNESCAPED_UNICODE)]);

        // A parent's phone/address are also the school's contact details for them (same as the
        // existing portal "My contact details"), so keep the parent record in step.
        if ($kind === 'parent' && (in_array('phone', $changed, true) || in_array('address', $changed, true))) {
            $link = portalResolveLink($pdo, $u, 'parent');
            if ($link !== '') {
                $row  = loadKeyRow($pdo, 'em_parents', true);
                $list = $row ? json_decode($row['value'], true) : [];
                if (is_array($list)) {
                    foreach ($list as &$p) {
                        if (($p['id'] ?? '') === $link) {
                            if (in_array('phone', $changed, true))   $p['phone']   = $cur['phone'];
                            if (in_array('address', $changed, true)) $p['address'] = $cur['address'];
                        }
                    }
                    unset($p);
                    storeKey($pdo, 'em_parents', json_encode($list));
                }
            }
        }
        audit($pdo, $u, 'update', 'profile', (string)$u['id'], 'Updated own profile (' . implode(', ', $changed) . ')', null);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    respond(['ok' => true, 'changed' => count($changed)]);
}

function profilePhoto(): void {
    global $pdo;
    $u     = requireUser($pdo);
    $photo = (string)(input()['photo'] ?? '');
    if ($photo === '') respond(['ok' => false, 'error' => 'No photo was received.'], 400);
    if (!preg_match('#^data:image/(png|jpe?g|webp);base64,#i', $photo)) respond(['ok' => false, 'error' => 'That does not look like an image file.'], 400);
    if (strlen($photo) > 450000) respond(['ok' => false, 'error' => 'That photo is too large — please choose a smaller one.'], 400);
    $pdo->prepare('INSERT INTO user_profiles (user_id, photo, updated_at) VALUES (?, ?, now())
                   ON CONFLICT (user_id) DO UPDATE SET photo = EXCLUDED.photo, updated_at = now()')
        ->execute([(string)$u['id'], $photo]);
    audit($pdo, $u, 'update', 'profile', (string)$u['id'], 'Changed own profile photo', null);
    respond(['ok' => true]);
}
