<?php
// api/handlers/notify.php — in-app notifications for EVERY role (staff, teachers, students, parents).
//
// Before this file the bell only listed things a person could already see in their own screens, and
// students / parents / teachers were never told anything. Now the SERVER writes a notification row to
// whoever a change concerns, at the moment it happens:
//
//   payment recorded / new invoice ........ the student's family
//   announcement / event posted ........... the audience it was posted for (Everyone / Students / Parents / Staff, optional grade)
//   homework set .......................... the class and their parents
//   results published / exam opened ....... the class' families / teachers who can enter marks
//   student marked absent or late ......... the parents
//   staff leave requested / decided ....... HR / the staff member
//   parent or student message to school ... staff who can send communication
//   school reply to that message .......... the parent / student who asked
//   approval needed / moved on / decided .. the next approvers / the requester
//   marks entered by a teacher ............ the exam office
//   broadcast sent (e-mail) ............... the same people, in their bell too (works even when e-mail is not set up)
//
//   notif_feed   GET   my latest notifications + unread count (polled by the browser)
//   notif_read   POST  {ids:[..]} or {all:true}
//   notif_clear  POST  {ids:[..]} or {all:true}
//
// Notifications are written AFTER the data change has been committed and inside try/catch, so a problem here
// can never stop a payment, a mark or an approval from being saved.

/* ---------------- storage ---------------- */
function notifEnsureTable(PDO $pdo): void {
    static $done = false;
    if ($done) return;
    $pdo->exec("CREATE TABLE IF NOT EXISTS notifications (
        id         BIGSERIAL    PRIMARY KEY,
        user_id    VARCHAR(40)  NOT NULL,
        kind       VARCHAR(30)  NOT NULL DEFAULT 'update',
        title      VARCHAR(200) NOT NULL,
        body       TEXT         NOT NULL DEFAULT '',
        view       VARCHAR(40)  NOT NULL DEFAULT '',
        ref        VARCHAR(80)  NOT NULL DEFAULT '',
        from_name  VARCHAR(150) NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
        read_at    TIMESTAMPTZ,
        cleared    BOOLEAN      NOT NULL DEFAULT false
    )");
    $pdo->exec('CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, id DESC)');
    $done = true;
}

/**
 * Writes one notification per person (de-duplicated). $exceptId = the person who caused it, who is not told about their own action.
 * $dedupe = skip when that person already has an UNREAD notification with the same kind + ref from the last 30 minutes.
 * Returns how many people were notified.
 */
function notifyUsers(PDO $pdo, array $userIds, string $kind, string $title, string $body = '', string $view = '',
                     string $ref = '', string $fromName = '', ?string $exceptId = null, bool $dedupe = false): int {
    $ids = [];
    foreach ($userIds as $id) {
        $id = (string)$id;
        if ($id === '' || ($exceptId !== null && $id === $exceptId)) continue;
        $ids[$id] = true;
        if (count($ids) >= 3000) break;
    }
    if (!$ids) return 0;
    notifEnsureTable($pdo);
    $ins = $pdo->prepare('INSERT INTO notifications (user_id, kind, title, body, view, ref, from_name) VALUES (?, ?, ?, ?, ?, ?, ?)');
    $dup = $pdo->prepare("SELECT 1 FROM notifications WHERE user_id = ? AND kind = ? AND ref = ? AND read_at IS NULL AND cleared = false AND created_at > now() - interval '30 minutes' LIMIT 1");
    $n = 0;
    foreach (array_keys($ids) as $uid) {
        $uid = (string)$uid;
        if ($dedupe && $ref !== '') {
            $dup->execute([$uid, $kind, mb_substr($ref, 0, 80)]);
            if ($dup->fetchColumn()) continue;
        }
        $ins->execute([$uid, $kind, mb_substr($title, 0, 200), mb_substr($body, 0, 1000), mb_substr($view, 0, 40), mb_substr($ref, 0, 80), mb_substr($fromName, 0, 150)]);
        $n++;
    }
    return $n;
}

/* ---------------- who is who ---------------- */
/** School records of one kind, memoised for the current request (reset by notifFlush). */
function notifRecords(PDO $pdo, string $key): array {
    if (!isset($GLOBALS['NOTIF_MEMO'])) $GLOBALS['NOTIF_MEMO'] = [];
    if (!isset($GLOBALS['NOTIF_MEMO'][$key])) {
        $out = [];
        $v = loadAssoc($pdo, $key, []);
        if (is_array($v)) { foreach ($v as $r) { if (is_array($r) && isset($r['id'])) $out[] = $r; } }
        $GLOBALS['NOTIF_MEMO'][$key] = $out;
    }
    return $GLOBALS['NOTIF_MEMO'][$key];
}

function notifPhone9($p): string { return substr(normalizePhone((string)$p), -9); }

/** Parent-record ids that belong to this student's family (linked record + other records with the same phone / e-mail). */
function notifParentRecordIds(array $student, array $parents): array {
    $pid = trim((string)($student['parentId'] ?? ''));
    $phones = []; $emails = []; $ids = [];
    $ph = notifPhone9($student['guardianPhone'] ?? '');
    $em = strtolower(trim((string)($student['guardianEmail'] ?? '')));
    if (strlen($ph) === 9) $phones[$ph] = true;
    if ($em !== '') $emails[$em] = true;
    if ($pid !== '') {
        $ids[$pid] = true;
        foreach ($parents as $p) {
            if ((string)$p['id'] !== $pid) continue;
            $ph2 = notifPhone9($p['phone'] ?? '');
            $em2 = strtolower(trim((string)($p['email'] ?? '')));
            if (strlen($ph2) === 9) $phones[$ph2] = true;
            if ($em2 !== '') $emails[$em2] = true;
        }
    }
    foreach ($parents as $p) {
        $pp = notifPhone9($p['phone'] ?? '');
        $pe = strtolower(trim((string)($p['email'] ?? '')));
        if ((strlen($pp) === 9 && isset($phones[$pp])) || ($pe !== '' && isset($emails[$pe]))) $ids[(string)$p['id']] = true;
    }
    return array_map('strval', array_keys($ids));
}

/** Login ids of one kind of account: 'student', 'parent' (optionally only those linked to $linkedIds) or 'staff' (everyone else). */
function notifAccountIds(PDO $pdo, string $kind, ?array $linkedIds = null): array {
    if ($kind === 'staff') {
        $rows = $pdo->query("SELECT id FROM staff_accounts WHERE is_active = true AND role_key NOT IN ('student', 'parent')")->fetchAll();
        return array_map(function ($r) { return (string)$r['id']; }, $rows);
    }
    if ($linkedIds !== null) {
        $linkedIds = array_values(array_unique(array_filter(array_map('strval', $linkedIds), function ($x) { return $x !== ''; })));
        if (!$linkedIds) return [];
        $ph = implode(',', array_fill(0, count($linkedIds), '?'));
        $stmt = $pdo->prepare("SELECT id FROM staff_accounts WHERE is_active = true AND role_key = ? AND linked_id IN ($ph)");
        $stmt->execute(array_merge([$kind], $linkedIds));
    } else {
        $stmt = $pdo->prepare('SELECT id FROM staff_accounts WHERE is_active = true AND role_key = ?');
        $stmt->execute([$kind]);
    }
    return array_map(function ($r) { return (string)$r['id']; }, $stmt->fetchAll());
}

/** Active staff logins that hold at least one of these permissions (Super Administrators always qualify). */
function notifUserIdsWithPerm(PDO $pdo, array $perms): array {
    $rows = $pdo->query('SELECT s.id, s.is_admin, s.is_active, r.permissions AS perms FROM staff_accounts s LEFT JOIN roles r ON r.role_key = s.role_key')->fetchAll();
    $out = [];
    foreach ($rows as $r) {
        if (!toBool($r['is_active'])) continue;
        if (toBool($r['is_admin'])) { $out[] = (string)$r['id']; continue; }
        $p = json_decode((string)($r['perms'] ?? '[]'), true);
        if (!is_array($p)) continue;
        if (in_array('*', $p, true)) { $out[] = (string)$r['id']; continue; }
        foreach ($perms as $need) {
            if (in_array($need, $p, true)) { $out[] = (string)$r['id']; break; }
        }
    }
    return $out;
}

/** Logins (student and/or parent) of the families of these students. */
function notifFamilyUserIds(PDO $pdo, array $studentIds, bool $withStudents = true, bool $withParents = true): array {
    if (!$studentIds) return [];
    $want = [];
    foreach ($studentIds as $sid) $want[(string)$sid] = true;
    $parents = notifRecords($pdo, 'em_parents');
    $stuIds = []; $parIds = [];
    foreach (notifRecords($pdo, 'em_students') as $s) {
        $sid = (string)$s['id'];
        if (!isset($want[$sid])) continue;
        $stuIds[] = $sid;
        foreach (notifParentRecordIds($s, $parents) as $pid) $parIds[$pid] = true;
    }
    $out = [];
    if ($withStudents) $out = array_merge($out, notifAccountIds($pdo, 'student', $stuIds));
    if ($withParents)  $out = array_merge($out, notifAccountIds($pdo, 'parent', array_map('strval', array_keys($parIds))));
    return $out;
}

/** Ids of the (non-inactive) students in a grade, optionally one stream. */
function notifStudentIdsInGrade(PDO $pdo, string $grade, string $stream = ''): array {
    $out = [];
    foreach (notifRecords($pdo, 'em_students') as $s) {
        if (strcasecmp((string)($s['status'] ?? ''), 'Inactive') === 0) continue;
        if (strcasecmp(trim((string)($s['grade'] ?? '')), trim($grade)) !== 0) continue;
        if ($stream !== '' && strcasecmp(trim((string)($s['stream'] ?? '')), trim($stream)) !== 0) continue;
        $out[] = (string)$s['id'];
    }
    return $out;
}

/** Everyone an announcement / event is for. $aud = Everyone | Students | Parents | Staff; $grade '' = every class. */
function notifAudienceUserIds(PDO $pdo, string $aud, string $grade = ''): array {
    if (!in_array($aud, ['Everyone', 'Students', 'Parents', 'Staff'], true)) $aud = 'Everyone';
    $out = [];
    if ($aud === 'Everyone' || $aud === 'Staff') $out = array_merge($out, notifAccountIds($pdo, 'staff'));
    if ($aud !== 'Staff') {
        if ($grade !== '') {
            $out = array_merge($out, notifFamilyUserIds($pdo, notifStudentIdsInGrade($pdo, $grade), $aud !== 'Parents', $aud !== 'Students'));
        } else {
            if ($aud !== 'Parents')  $out = array_merge($out, notifAccountIds($pdo, 'student'));
            if ($aud !== 'Students') $out = array_merge($out, notifAccountIds($pdo, 'parent'));
        }
    }
    return array_values(array_unique($out));
}

/** The staff login(s) of a teacher / staff record (linked, or the same name). */
function notifStaffUserIdsForTeacher(PDO $pdo, string $teacherId): array {
    if ($teacherId === '') return [];
    $name = '';
    $email = '';
    foreach (notifRecords($pdo, 'em_teachers') as $t) {
        if ((string)$t['id'] === $teacherId) {
            $name  = strtolower(trim((string)($t['name'] ?? '')));
            $email = strtolower(trim((string)($t['email'] ?? '')));
            break;
        }
    }
    // Same ways the app itself ties a login to a staff record: the link picked under Users, the e-mail, or the name.
    $sql = "SELECT id FROM staff_accounts WHERE is_active = true AND role_key NOT IN ('student', 'parent') AND (linked_id = ?";
    $params = [$teacherId];
    if ($name !== '')  { $sql .= ' OR lower(name) = ?';  $params[] = $name; }
    if ($email !== '') { $sql .= ' OR lower(email) = ?'; $params[] = $email; }
    $sql .= ')';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    return array_map(function ($r) { return (string)$r['id']; }, $stmt->fetchAll());
}

/* ---------------- change hooks ---------------- */
function notifQueue(string $key, array $info, $old, $new): void {
    if (!isset($GLOBALS['NOTIF_QUEUE'])) $GLOBALS['NOTIF_QUEUE'] = [];
    $GLOBALS['NOTIF_QUEUE'][] = [$key, $info, $old, $new];
}

/** Call right AFTER commit: turns the queued data changes into notifications. Never throws. */
function notifFlush(PDO $pdo, array $actor): void {
    $q = $GLOBALS['NOTIF_QUEUE'] ?? [];
    $GLOBALS['NOTIF_QUEUE'] = [];
    $GLOBALS['NOTIF_MEMO'] = [];
    foreach ($q as $item) {
        try {
            notifFromChange($pdo, $actor, (string)$item[0], $item[1], $item[2], $item[3]);
        } catch (Throwable $e) {
            error_log('EraMaster notify (' . $item[0] . '): ' . $e->getMessage());
        }
    }
    $GLOBALS['NOTIF_MEMO'] = [];
}

function notifKsh($n): string { return 'KSh ' . number_format((float)$n, 2); }

function notifFromChange(PDO $pdo, array $actor, string $key, array $info, $old, $new): void {
    $by = (string)($actor['name'] ?? '');
    $me = (string)($actor['id'] ?? '');
    $created = $info['created'] ?? [];
    $updated = $info['updated'] ?? [];

    switch ($key) {
        case 'em_payments':
            foreach (array_slice($created, 0, 50, true) as $p) {
                $sid = (string)($p['studentId'] ?? '');
                $amt = (float)($p['amount'] ?? 0);
                if ($sid === '' || $amt <= 0) continue;
                $rcpt = trim((string)($p['receipt'] ?? ''));
                notifyUsers($pdo, notifFamilyUserIds($pdo, [$sid]), 'fees', 'Payment received',
                    notifKsh($amt) . ' received' . ($rcpt !== '' ? ' (receipt ' . $rcpt . ')' : '') . '. Thank you.', 'fees', (string)($p['id'] ?? ''), $by, $me);
            }
            break;

        case 'em_invoices':
            foreach (array_slice($created, 0, 50, true) as $inv) {
                $sid = (string)($inv['studentId'] ?? '');
                if ($sid === '') continue;
                $due = trim((string)($inv['dueDate'] ?? ''));
                notifyUsers($pdo, notifFamilyUserIds($pdo, [$sid]), 'fees', 'New fee invoice',
                    notifKsh($inv['amount'] ?? 0) . ' — ' . ((string)($inv['feeType'] ?? 'Fees')) . ($due !== '' ? ', due ' . $due : ''), 'fees', (string)($inv['id'] ?? ''), $by, $me);
            }
            break;

        case 'em_announcements':
        case 'em_events':
            foreach (array_slice($created, 0, 20, true) as $r) {
                $isEv = ($key === 'em_events');
                $title = trim((string)($r['title'] ?? ''));
                if ($title === '') continue;
                $urgent = (!$isEv && (($r['priority'] ?? '') === 'Urgent' || ($r['type'] ?? '') === 'Emergency'));
                $body = $isEv
                    ? trim((string)($r['date'] ?? '') . (empty($r['time']) ? '' : ' ' . $r['time']) . (empty($r['venue']) ? '' : ' · ' . $r['venue']))
                    : (string)($r['description'] ?? '');
                notifyUsers($pdo, notifAudienceUserIds($pdo, (string)($r['audience'] ?? 'Everyone'), (string)($r['grade'] ?? '')),
                    $isEv ? 'event' : ($urgent ? 'alert' : 'announcement'), $title, $body, $isEv ? 'events' : 'announcements', (string)($r['id'] ?? ''), $by, $me);
            }
            break;

        case 'em_homework':
            foreach (array_slice($created, 0, 20, true) as $h) {
                $grade = trim((string)($h['grade'] ?? ''));
                if ($grade === '') continue;
                $ids = notifStudentIdsInGrade($pdo, $grade, (string)($h['stream'] ?? ''));
                $due = trim((string)($h['dueDate'] ?? ''));
                notifyUsers($pdo, notifFamilyUserIds($pdo, $ids), 'homework', 'New homework' . (!empty($h['subject']) ? ': ' . $h['subject'] : ''),
                    trim((string)($h['title'] ?? '')) . ($due !== '' ? ' — due ' . $due : ''), 'homework', (string)($h['id'] ?? ''), $by, $me);
            }
            break;

        case 'em_exams':
            foreach ($updated as $id => $x) {
                $rec = $x['rec'];
                $label = trim((string)($rec['examType'] ?? 'Exam') . ' ' . (string)($rec['grade'] ?? ''));
                foreach ($x['changes'] as $c) {
                    $path = (string)$c['path'];
                    $val  = is_string($c['new']) ? strtolower(trim($c['new'])) : '';
                    if ($path === 'status' && $val === 'published') {
                        $ids = notifStudentIdsInGrade($pdo, (string)($rec['grade'] ?? ''), (string)($rec['stream'] ?? ''));
                        notifyUsers($pdo, notifFamilyUserIds($pdo, $ids), 'results', 'Results published',
                            trim($label . (!empty($rec['term']) ? ' (' . $rec['term'] . ')' : '')) . ' results are now available.', 'results', (string)$id, $by, $me);
                    } elseif ($path === 'open' && $val === 'yes') {
                        notifyUsers($pdo, notifUserIdsWithPerm($pdo, ['marks.enter']), 'marks', 'Exam open for marks entry',
                            $label . ' is open — please enter your subject marks.', 'entermarks', 'open_' . $id, $by, $me, true);
                    }
                }
            }
            break;

        case 'em_attendance':
            // Compare the saved registers directly (the generic diff is capped, which would drop pupils on a big class).
            if (!is_array($new)) break;
            $oldMap = is_array($old) ? $old : [];
            $names = []; $count = 0;
            foreach (notifRecords($pdo, 'em_students') as $s) { $names[(string)$s['id']] = (string)($s['name'] ?? 'Your child'); }
            $cut = date('Y-m-d', strtotime('-2 days'));
            foreach ($new as $regKey => $reg) {
                if (!is_array($reg)) continue;
                $date = explode('|', (string)$regKey)[0];
                if ($date < $cut) continue;                       // old registers being corrected: don't alarm anyone
                $prevReg = (isset($oldMap[$regKey]) && is_array($oldMap[$regKey])) ? $oldMap[$regKey] : [];
                foreach ($reg as $sid => $cell) {
                    $st = is_array($cell) ? (string)($cell['s'] ?? '') : '';
                    if ($st !== 'A' && $st !== 'L') continue;
                    $was = (isset($prevReg[$sid]) && is_array($prevReg[$sid])) ? (string)($prevReg[$sid]['s'] ?? '') : '';
                    if ($was === $st) continue;
                    if (++$count > 300) break 2;
                    $nm = $names[(string)$sid] ?? '';
                    if ($nm === '') continue;
                    notifyUsers($pdo, notifFamilyUserIds($pdo, [(string)$sid], false, true), 'attendance',
                        $st === 'A' ? 'Marked absent' : 'Marked late',
                        $nm . ' was marked ' . ($st === 'A' ? 'absent' : 'late') . ' on ' . $date . '.', 'portal', 'att_' . $sid . '_' . $date, $by, $me, true);
                }
            }
            break;

        case 'em_leave':
            foreach (array_slice($created, 0, 20, true) as $l) {
                $who = '';
                foreach (notifRecords($pdo, 'em_teachers') as $t) { if ((string)$t['id'] === (string)($l['teacherId'] ?? '')) { $who = (string)($t['name'] ?? ''); break; } }
                notifyUsers($pdo, notifUserIdsWithPerm($pdo, ['staff.manage']), 'leave', 'Leave request' . ($who !== '' ? ' — ' . $who : ''),
                    trim((string)($l['leaveType'] ?? 'Leave') . ' ' . (string)($l['startDate'] ?? '') . (empty($l['endDate']) ? '' : ' to ' . $l['endDate'])), 'leave', (string)($l['id'] ?? ''), $by, $me);
            }
            foreach ($updated as $id => $x) {
                foreach ($x['changes'] as $c) {
                    if ((string)$c['path'] !== 'status') continue;
                    $st = trim((string)$c['new']);
                    if ($st === '' || strcasecmp($st, 'Pending') === 0) continue;
                    notifyUsers($pdo, notifStaffUserIdsForTeacher($pdo, (string)($x['rec']['teacherId'] ?? '')), 'leave', 'Your leave request: ' . $st,
                        trim((string)($x['rec']['leaveType'] ?? 'Leave') . ' ' . (string)($x['rec']['startDate'] ?? '')), 'leave', (string)$id, $by, $me);
                }
            }
            break;

        case 'em_inquiries':
            foreach ($updated as $id => $x) {
                $rec = $x['rec'];
                $from = (string)($rec['fromId'] ?? '');
                if ($from === '') continue;                       // walk-in / phone inquiry: nobody to tell
                $replied = false; $statusChanged = false;
                foreach ($x['changes'] as $c) {
                    $p = (string)$c['path'];
                    if ($p === 'reply' && trim((string)$c['new']) !== '') $replied = true;
                    if ($p === 'status') $statusChanged = true;
                }
                if (!$replied && !$statusChanged) continue;
                $ids = array_merge(notifAccountIds($pdo, 'parent', [$from]), notifAccountIds($pdo, 'student', [$from]));
                $subj = trim((string)($rec['subject'] ?? 'Your message'));
                if ($replied) {
                    notifyUsers($pdo, $ids, 'message', 'The school replied to your message', $subj . ' — ' . trim((string)($rec['reply'] ?? '')), 'portal', (string)$id, $by, $me);
                } else {
                    notifyUsers($pdo, $ids, 'message', 'Your message is now ' . (string)($rec['status'] ?? 'updated'), $subj, 'portal', (string)$id, $by, $me);
                }
            }
            break;
    }
}

/* ---------------- direct hooks used by other handlers ---------------- */
/** A parent / student sent a message to the school. */
function notifyPortalInquiry(PDO $pdo, array $actor, array $rec): void {
    try {
        $kind = (string)($rec['fromType'] ?? 'parent');
        notifyUsers($pdo, notifUserIdsWithPerm($pdo, ['communication.send']), 'inquiry',
            'New ' . strtolower((string)($rec['type'] ?? 'inquiry')) . ' from ' . (string)($rec['fromName'] ?? ucfirst($kind)),
            (string)($rec['subject'] ?? ''), 'inquiries', (string)($rec['id'] ?? ''), (string)($actor['name'] ?? ''), (string)($actor['id'] ?? ''));
    } catch (Throwable $e) {
        error_log('EraMaster notify (portal inquiry): ' . $e->getMessage());
    }
}

/** A teacher saved marks: tell the exam office / reviewers (one notification per exam + subject until it is read). */
function notifyMarksSaved(PDO $pdo, array $actor, array $exam, string $subject, int $saved): void {
    try {
        $label = trim((string)($exam['examType'] ?? 'Exam') . ' ' . (string)($exam['grade'] ?? '') . ' ' . (string)($exam['stream'] ?? ''));
        notifyUsers($pdo, notifUserIdsWithPerm($pdo, ['exams.manage', 'marks.review']), 'marks', 'Marks entered: ' . $subject,
            $label . ' — ' . $saved . ' learner' . ($saved === 1 ? '' : 's') . ' saved by ' . (string)($actor['name'] ?? 'a teacher') . '.',
            'results', 'marks_' . (string)($exam['id'] ?? '') . '_' . $subject, (string)($actor['name'] ?? ''), (string)($actor['id'] ?? ''), true);
    } catch (Throwable $e) {
        error_log('EraMaster notify (marks): ' . $e->getMessage());
    }
}

/** Approval engine: who needs to act next, and who is told how it ended. */
function notifyApprovalEvent(PDO $pdo, array $actor, string $event, array $row, array $steps, int $stepIdx, string $comment = ''): void {
    try {
        $title = (string)($row['title'] ?? 'Request');
        $reqId = (string)($row['requested_by'] ?? '');
        $me    = (string)($actor['id'] ?? '');
        $by    = (string)($actor['name'] ?? '');
        $ref   = (string)($row['id'] ?? '');
        $stepPerm = isset($steps[$stepIdx]['perm']) ? (string)$steps[$stepIdx]['perm'] : '';
        $stepLabel = isset($steps[$stepIdx]['label']) ? (string)$steps[$stepIdx]['label'] : '';
        switch ($event) {
            case 'created':
                if ($stepPerm !== '') notifyUsers($pdo, array_diff(notifUserIdsWithPerm($pdo, [$stepPerm]), [$reqId]), 'approval', 'Approval needed: ' . $title,
                    'Requested by ' . (string)($row['requested_by_name'] ?? $by) . ($stepLabel !== '' ? ' · step: ' . $stepLabel : ''), 'approvals', $ref, $by, $me);
                break;
            case 'advanced':
                if ($stepPerm !== '') notifyUsers($pdo, array_diff(notifUserIdsWithPerm($pdo, [$stepPerm]), [$reqId]), 'approval', 'Approval needed: ' . $title,
                    'Approved by ' . $by . ' — now waiting for: ' . $stepLabel, 'approvals', $ref, $by, $me);
                notifyUsers($pdo, [$reqId], 'approval', 'Your request moved forward: ' . $title, 'Approved by ' . $by . '. Next: ' . $stepLabel . '.', 'approvals', $ref, $by, $me);
                break;
            case 'approved':
                notifyUsers($pdo, [$reqId], 'approval', 'Approved: ' . $title, 'Final approval given by ' . $by . ($comment !== '' ? ' — ' . $comment : ''), 'approvals', $ref, $by, $me);
                break;
            case 'rejected':
                notifyUsers($pdo, [$reqId], 'approval', 'Rejected: ' . $title, 'Rejected by ' . $by . ($comment !== '' ? ' — ' . $comment : ''), 'approvals', $ref, $by, $me);
                break;
            case 'cancelled':
                if ($stepPerm !== '') notifyUsers($pdo, array_diff(notifUserIdsWithPerm($pdo, [$stepPerm]), [$reqId]), 'approval', 'Request cancelled: ' . $title,
                    'The requester withdrew it — no action needed.', 'approvals', $ref, $by, $me);
                break;
        }
    } catch (Throwable $e) {
        error_log('EraMaster notify (approval): ' . $e->getMessage());
    }
}

/** Who a broadcast reaches inside the app (logins), mirroring bcResolve()'s audiences. */
function notifBroadcastUserIds(PDO $pdo, string $audience, string $grade, string $target): array {
    $parents = notifRecords($pdo, 'em_parents');
    if ($audience === 'staff')    return notifAccountIds($pdo, 'staff');
    if ($audience === 'students') return notifAccountIds($pdo, 'student');
    if ($audience === 'parents')  return notifAccountIds($pdo, 'parent');
    if ($audience === 'class') {
        return $grade === '' ? [] : notifFamilyUserIds($pdo, notifStudentIdsInGrade($pdo, $grade));
    }
    if ($audience === 'specific') {
        $parts = explode(':', $target, 2);
        $kind = $parts[0] ?? ''; $id = $parts[1] ?? '';
        if ($id === '') return [];
        if ($kind === 'student') return notifFamilyUserIds($pdo, [$id]);
        if ($kind === 'parent') {
            // every login linked to this parent, or to another record with the same phone / e-mail
            $ids = [$id];
            $me = null;
            foreach ($parents as $p) { if ((string)$p['id'] === $id) { $me = $p; break; } }
            if ($me) {
                $ph = notifPhone9($me['phone'] ?? ''); $em = strtolower(trim((string)($me['email'] ?? '')));
                foreach ($parents as $p) {
                    if ((string)$p['id'] === $id) continue;
                    if ((strlen($ph) === 9 && notifPhone9($p['phone'] ?? '') === $ph) || ($em !== '' && strtolower(trim((string)($p['email'] ?? ''))) === $em)) $ids[] = (string)$p['id'];
                }
            }
            return notifAccountIds($pdo, 'parent', $ids);
        }
        if ($kind === 'staff') return notifStaffUserIdsForTeacher($pdo, $id);
    }
    return [];
}

/* ---------------- endpoints ---------------- */
function notifFeed(): void {
    global $pdo;
    $u = requireUser($pdo);
    $me = (string)$u['id'];
    if (session_status() === PHP_SESSION_ACTIVE) { session_write_close(); }   // a poll must never block the same user's other requests
    notifEnsureTable($pdo);
    $stmt = $pdo->prepare('SELECT id, kind, title, body, view, ref, from_name, created_at, read_at FROM notifications WHERE user_id = ? AND cleared = false ORDER BY id DESC LIMIT 60');
    $stmt->execute([$me]);
    $items = [];
    foreach ($stmt->fetchAll() as $r) {
        $ts = strtotime((string)$r['created_at']);
        $items[] = ['id' => (int)$r['id'], 'kind' => (string)$r['kind'], 'title' => (string)$r['title'], 'body' => (string)$r['body'],
                    'view' => (string)$r['view'], 'ref' => (string)$r['ref'], 'from' => (string)$r['from_name'],
                    'at' => $ts ? gmdate('c', $ts) : '', 'read' => $r['read_at'] !== null];
    }
    $c = $pdo->prepare('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND cleared = false AND read_at IS NULL');
    $c->execute([$me]);
    if (random_int(1, 60) === 1) {      // housekeeping: keep three months
        try { $pdo->exec("DELETE FROM notifications WHERE created_at < now() - interval '90 days'"); } catch (Throwable $e) { /* harmless */ }
    }
    respond(['ok' => true, 'items' => $items, 'unread' => (int)$c->fetchColumn()]);
}

/** Shared by notif_read / notif_clear: which rows does the request mean? Returns [sqlFragment, params]. */
function notifTargetClause(array $b): array {
    if (!empty($b['all'])) return ['', []];
    $ids = [];
    foreach ((array)($b['ids'] ?? []) as $id) { if (is_numeric($id)) $ids[] = (int)$id; }
    $ids = array_slice(array_values(array_unique($ids)), 0, 200);
    if (!$ids) respond(['ok' => true]);
    return [' AND id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')', $ids];
}

function notifRead(): void {
    global $pdo;
    $u = requireUser($pdo);
    notifEnsureTable($pdo);
    [$sql, $params] = notifTargetClause(input());
    $stmt = $pdo->prepare('UPDATE notifications SET read_at = now() WHERE user_id = ? AND read_at IS NULL' . $sql);
    $stmt->execute(array_merge([(string)$u['id']], $params));
    respond(['ok' => true]);
}

function notifClear(): void {
    global $pdo;
    $u = requireUser($pdo);
    notifEnsureTable($pdo);
    [$sql, $params] = notifTargetClause(input());
    $stmt = $pdo->prepare('UPDATE notifications SET cleared = true, read_at = COALESCE(read_at, now()) WHERE user_id = ? AND cleared = false' . $sql);
    $stmt->execute(array_merge([(string)$u['id']], $params));
    respond(['ok' => true]);
}
