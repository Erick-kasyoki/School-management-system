<?php
// api/handlers/portal.php — parent & student portal endpoints. All data here
// is filtered server-side to the signed-in account's own linked_id.


function portalKind(array $u): ?string {
    if (in_array('portal.parent', $u['permissions'], true))  return 'parent';
    if (in_array('portal.student', $u['permissions'], true)) return 'student';
    return null;
}

function receiptNo(array $p): string {
    return !empty($p['receipt']) ? (string)$p['receipt'] : 'RCT-' . strtoupper(substr((string)$p['id'], -6));
}

/** The school's grading bands from Settings ([{code,label,min}], highest first); a sensible default if none are saved. */
function portalGradingBands(array $settings): array {
    $out = [];
    foreach (($settings['grading'] ?? []) as $g) {
        if (is_array($g) && isset($g['code'], $g['min']) && is_numeric($g['min'])) {
            $out[] = ['code' => (string)$g['code'], 'label' => (string)($g['label'] ?? ''), 'min' => (float)$g['min']];
        }
    }
    if (!$out) {
        $out = [['code' => 'EE', 'label' => 'Exceeding expectations', 'min' => 80], ['code' => 'ME', 'label' => 'Meeting expectations', 'min' => 65],
                ['code' => 'AE', 'label' => 'Approaching expectations', 'min' => 50], ['code' => 'BE', 'label' => 'Below expectations', 'min' => 0]];
    }
    usort($out, function ($a, $b) { return $b['min'] <=> $a['min']; });
    return $out;
}

/**
 * Works out which school record (parent or student) this portal account belongs to.
 * Returns the record id, or '' if the account is not (or no longer) linked to a real record.
 *  - A saved link that still points at a real record is used as-is.
 *  - An empty or stale link (record deleted / re-imported) is repaired automatically when the
 *    account's e-mail matches exactly one parent record that no other account has claimed.
 *  - Anything else stays unlinked; the person can link themselves with portal_link, or the
 *    office can pick the record under Administration → Users.
 */
function portalResolveLink(PDO $pdo, array $u, string $kind): string {
    $link    = trim((string)($u['linked_id'] ?? ''));
    $records = loadAssoc($pdo, $kind === 'parent' ? 'em_parents' : 'em_students', []);
    foreach ($records as $r) { if ($link !== '' && (string)($r['id'] ?? '') === $link) return $link; }
    if ($kind !== 'parent') return '';          // students have no e-mail on file to match safely
    $email = strtolower(trim((string)($u['email'] ?? '')));
    if ($email === '') return '';
    $taken = [];
    $stmt = $pdo->prepare('SELECT linked_id FROM staff_accounts WHERE role_key = ? AND linked_id IS NOT NULL AND id != ?');
    $stmt->execute(['parent', $u['id']]);
    foreach ($stmt->fetchAll() as $row) $taken[(string)$row['linked_id']] = true;
    $hits = [];
    foreach ($records as $r) {
        if (strtolower(trim((string)($r['email'] ?? ''))) === $email && !isset($taken[(string)($r['id'] ?? '')])) $hits[] = $r;
    }
    if (count($hits) !== 1) return '';
    $rid = (string)$hits[0]['id'];
    $pdo->prepare('UPDATE staff_accounts SET linked_id = ? WHERE id = ?')->execute([$rid, $u['id']]);
    securityEvent($pdo, 'portal_autolink', (string)$u['id'], $email, 'parent account auto-linked by e-mail to ' . $rid);
    audit($pdo, $u, 'update', 'users', (string)$u['id'], 'Parent account automatically linked to its record by matching e-mail', null);
    return $rid;
}

/**
 * Lets a signed-in parent/student connect their own account to their school record by
 * proving who they are — the same details the sign-up form checks (name + phone for a
 * parent, name + admission number for a student). Limited to 5 wrong tries per 15 minutes.
 */
function portalLink(): void {
    global $pdo;
    $u    = requireUser($pdo);
    $kind = portalKind($u);
    if (!$kind) respond(['ok' => false, 'error' => 'This account does not have portal access.'], 403);
    if (portalResolveLink($pdo, $u, $kind) !== '') respond(['ok' => true, 'already' => true]);

    $stmt = $pdo->prepare("SELECT COUNT(*) FROM security_events WHERE type = 'portal_link_failed' AND user_id = ? AND at > now() - interval '15 minutes'");
    $stmt->execute([(string)$u['id']]);
    if ((int)$stmt->fetchColumn() >= 5) respond(['ok' => false, 'error' => 'Too many tries. Please wait 15 minutes, or ask the school office to link your account.'], 429);

    $b    = input();
    $name = trim((string)($b['name'] ?? ''));
    $match = null;
    if ($kind === 'parent') {
        $want = normalizePhone(trim((string)($b['phone'] ?? '')));
        if ($name === '' || $want === '') respond(['ok' => false, 'error' => 'Enter your full name and phone number exactly as the school has them.'], 400);
        foreach (loadAssoc($pdo, 'em_parents', []) as $p) {
            if (normalizePhone((string)($p['phone'] ?? '')) === $want && strcasecmp(trim((string)($p['name'] ?? '')), $name) === 0) { $match = $p; break; }
        }
    } else {
        $adm = trim((string)($b['adm_no'] ?? ''));
        if ($name === '' || $adm === '') respond(['ok' => false, 'error' => 'Enter your full name and admission number exactly as the school has them.'], 400);
        foreach (loadAssoc($pdo, 'em_students', []) as $s) {
            if (strcasecmp(trim((string)($s['admNo'] ?? '')), $adm) === 0 && strcasecmp(trim((string)($s['name'] ?? '')), $name) === 0) { $match = $s; break; }
        }
    }
    if (!$match) {
        securityEvent($pdo, 'portal_link_failed', (string)$u['id'], (string)$u['email'], $kind . ' self-link: no matching record');
        respond(['ok' => false, 'error' => 'We could not match those details to a ' . ($kind === 'parent' ? 'parent/guardian' : 'student') . ' record. Check the spelling, or ask the school office to link your account.'], 403);
    }
    $rid  = (string)$match['id'];
    $stmt = $pdo->prepare('SELECT id FROM staff_accounts WHERE role_key = ? AND linked_id = ? AND id != ?');
    $stmt->execute([$kind, $rid, $u['id']]);
    if ($stmt->fetch()) respond(['ok' => false, 'error' => 'Another account is already linked to that record. Please contact the school office.'], 409);

    $pdo->prepare('UPDATE staff_accounts SET linked_id = ? WHERE id = ?')->execute([$rid, $u['id']]);
    securityEvent($pdo, 'portal_link', (string)$u['id'], (string)$u['email'], $kind . ' self-linked to ' . $rid);
    audit($pdo, $u, 'update', 'users', (string)$u['id'], ucfirst($kind) . ' linked their own account to record ' . $rid . ' (verified by details)', null);
    respond(['ok' => true]);
}

function portalData(): void {
    global $pdo;
    $u    = requireUser($pdo);
    $kind = portalKind($u);
    if (!$kind) respond(['ok' => false, 'error' => 'This account does not have portal access.'], 403);
    $link = portalResolveLink($pdo, $u, $kind);   // '' when not (or no longer) linked to a real record
    $u['linked_id'] = $link;

    $students = loadAssoc($pdo, 'em_students', []);
    $children = [];
    $diag     = null;
    if ($kind === 'parent' && $link !== '') {
        // Which parent record is this login linked to, and which parent ids really exist?
        $parents = loadAssoc($pdo, 'em_parents', []);
        $myRec = null; $realIds = []; $nameCount = [];
        $normName = function ($v) { return preg_replace('/\s+/', ' ', strtolower(trim((string)$v))); };
        foreach ($parents as $p) {
            $pid = trim((string)($p['id'] ?? ''));
            if ($pid !== '') $realIds[$pid] = true;
            $n = $normName($p['name'] ?? '');
            if ($n !== '') $nameCount[$n] = ($nameCount[$n] ?? 0) + 1;
            if ($pid === $link) $myRec = $p;
        }
        $myPhone = substr(normalizePhone((string)($myRec['phone'] ?? '')), -9);
        $myName  = $normName($myRec['name'] ?? '');
        $myEmails = array_filter([strtolower(trim((string)($myRec['email'] ?? ''))), strtolower(trim((string)($u['email'] ?? '')))]);
        // Other parent records that are clearly the SAME person (same phone number or e-mail) — e.g. the office
        // created the guardian twice. A student linked to such a duplicate still belongs to this login.
        $samePerson = [$link => true];
        foreach ($parents as $p) {
            $pid = trim((string)($p['id'] ?? ''));
            if ($pid === '' || $pid === $link) continue;
            $ph = substr(normalizePhone((string)($p['phone'] ?? '')), -9);
            $em = strtolower(trim((string)($p['email'] ?? '')));
            if ((strlen($myPhone) === 9 && $ph === $myPhone) || ($em !== '' && in_array($em, $myEmails, true))) $samePerson[$pid] = true;
        }
        foreach ($students as $s) {
            $sp = trim((string)($s['parentId'] ?? ''));
            if ($sp !== '' && isset($samePerson[$sp])) { $children[] = $s; continue; }
            // Student was never pointed at a real parent record (blank, or the record was deleted/re-imported):
            // fall back to the guardian details the office typed on the student, so the family is not locked out.
            if ($sp !== '' && isset($realIds[$sp])) continue;          // belongs to a different, real parent record
            $gPhone = substr(normalizePhone((string)($s['guardianPhone'] ?? '')), -9);
            $gName  = $normName($s['guardian'] ?? '');
            $phoneHit = strlen($myPhone) === 9 && $gPhone === $myPhone;
            $nameHit  = $myName !== '' && $gName === $myName && ($nameCount[$myName] ?? 0) === 1;
            if ($phoneHit || $nameHit) $children[] = $s;
        }
        if (!$children) {
            $diag = ['recordName' => (string)($myRec['name'] ?? ''), 'recordPhone' => (string)($myRec['phone'] ?? ''), 'recordId' => $link];
        }
    } else {
        foreach ($students as $s) {
            if ($link === '') break;
            if ($kind === 'student' && trim((string)($s['id'] ?? '')) === $link) $children[] = $s;
        }
    }

    $exams    = loadAssoc($pdo, 'em_exams', []);
    $marks    = loadAssoc($pdo, 'em_marks', []);
    $comments = loadAssoc($pdo, 'em_comments', []);
    $att      = loadAssoc($pdo, 'em_attendance', []);
    $homework = loadAssoc($pdo, 'em_homework', []);
    $tt       = loadAssoc($pdo, 'em_timetable', []);
    $payments = loadAssoc($pdo, 'em_payments', []);
    $invoices = loadAssoc($pdo, 'em_invoices', []);
    $disc     = loadAssoc($pdo, 'em_discipline', []);
    $teachers = loadAssoc($pdo, 'em_teachers', []);
    $tname = [];
    foreach ($teachers as $t) { if (isset($t['id'])) $tname[$t['id']] = $t['name'] ?? ''; }

    $out = [];
    $grades = [];
    foreach ($children as $s) {
        $sid = $s['id'];
        $grades[] = $s['grade'] ?? '';

        // attendance
        $records = [];
        $present = 0;
        $absent  = 0;
        foreach ($att as $k => $recs) {
            if (!is_array($recs) || !isset($recs[$sid])) continue;
            $parts = explode('|', (string)$k);
            $status = $recs[$sid]['s'] ?? '';
            if (in_array($status, ['P', 'L', 'E'], true)) $present++;
            if (in_array($status, ['AE', 'AU'], true)) $absent++;
            $records[] = ['date' => $parts[0], 'session' => $parts[1] ?? '', 's' => $status, 'n' => $recs[$sid]['n'] ?? ''];
        }
        usort($records, function ($a, $b) { return strcmp($b['date'], $a['date']); });
        $records = array_slice($records, 0, 60);

        // published results only
        $results = [];
        foreach ($exams as $ex) {
            if (($ex['status'] ?? '') !== 'Published' || ($ex['grade'] ?? '') !== ($s['grade'] ?? '')) continue;
            $eid = $ex['id'];
            $rec = (isset($marks[$eid]) && is_array($marks[$eid])) ? $marks[$eid] : [];
            if (!isset($rec[$sid]) || !is_array($rec[$sid]) || !$rec[$sid]) continue;
            $totals = [];
            foreach ($students as $o) {
                if (($o['grade'] ?? '') !== $ex['grade'] || !isset($rec[$o['id']]) || !is_array($rec[$o['id']])) continue;
                $sum = 0;
                // Each subject's value is either a plain number (older records) or an
                // object {cat1, cat2, midEnd, examMarks, average, gradeCode, entryDate}
                // — only its computed "average" should count toward the subject total.
                foreach ($rec[$o['id']] as $v) {
                    if (is_numeric($v)) { $sum += $v; }
                    elseif (is_array($v) && isset($v['average']) && is_numeric($v['average'])) { $sum += $v['average']; }
                }
                $totals[$o['id']] = $sum;
            }
            $mine = $totals[$sid] ?? 0;
            $rank = 1;
            foreach ($totals as $t) { if ($t > $mine) $rank++; }
            $results[] = [
                'examId' => $eid, 'examType' => $ex['examType'] ?? '', 'term' => $ex['term'] ?? '', 'date' => $ex['date'] ?? '',
                'marks' => $rec[$sid], 'total' => $mine, 'rank' => $rank, 'of' => count($totals),
                'comments' => (isset($comments[$eid][$sid]) && is_array($comments[$eid][$sid])) ? $comments[$eid][$sid] : new stdClass(),
            ];
        }

        $hw = [];
        foreach ($homework as $h) { if (($h['grade'] ?? '') === ($s['grade'] ?? '')) $hw[] = $h; }
        usort($hw, function ($a, $b) { return strcmp((string)($b['dueDate'] ?? ''), (string)($a['dueDate'] ?? '')); });

        $slots = [];
        foreach ($tt as $t) {
            if (($t['grade'] ?? '') !== ($s['grade'] ?? '')) continue;
            if (!empty($t['stream']) && !empty($s['stream']) && $t['stream'] !== $s['stream']) continue;
            $t['teacherName'] = $tname[$t['teacherId'] ?? ''] ?? '';
            $slots[] = $t;
        }

        $pay = [];
        foreach ($payments as $p) {
            if (($p['studentId'] ?? '') !== $sid) continue;
            $pay[] = ['id' => $p['id'], 'date' => $p['date'] ?? '', 'amount' => $p['amount'] ?? 0, 'receipt' => receiptNo($p), 'method' => $p['method'] ?? ''];
        }
        usort($pay, function ($a, $b) { return strcmp($b['date'], $a['date']); });
        $inv = [];
        foreach ($invoices as $i) { if (($i['studentId'] ?? '') === $sid) $inv[] = $i; }

        $notices = [];
        if ($kind === 'parent') {
            foreach ($disc as $d) {
                if (($d['studentId'] ?? '') === $sid && !empty($d['parentNotified'])) {
                    $notices[] = ['date' => $d['date'] ?? '', 'category' => $d['category'] ?? '', 'action' => $d['action'] ?? '', 'stage' => $d['stage'] ?? ''];
                }
            }
        }

        $out[] = [
            'id' => $sid, 'name' => $s['name'] ?? '', 'admNo' => $s['admNo'] ?? '', 'grade' => $s['grade'] ?? '', 'stream' => $s['stream'] ?? '',
            'status' => $s['status'] ?? '', 'balance' => $s['balance'] ?? 0, 'photo' => $s['photo'] ?? '',
            'attendance' => ['present' => $present, 'absent' => $absent, 'records' => $records],
            'results' => $results, 'homework' => $hw, 'timetable' => $slots, 'payments' => $pay, 'invoices' => $inv, 'notices' => $notices,
        ];
    }

    $audience = $kind === 'parent' ? 'Parents' : 'Students';
    $relevant = function ($item) use ($audience, $grades) {
        $aud = $item['audience'] ?? 'Everyone';
        if ($aud !== 'Everyone' && $aud !== $audience) return false;
        $g = $item['grade'] ?? '';
        return $g === '' || in_array($g, $grades, true);
    };
    $ann = [];
    foreach (loadAssoc($pdo, 'em_announcements', []) as $a) { if ($relevant($a)) $ann[] = $a; }
    usort($ann, function ($a, $b) { return strcmp((string)($b['date'] ?? ''), (string)($a['date'] ?? '')); });
    $evs = [];
    foreach (loadAssoc($pdo, 'em_events', []) as $e) { if ($relevant($e)) $evs[] = $e; }
    usort($evs, function ($a, $b) { return strcmp((string)($a['date'] ?? ''), (string)($b['date'] ?? '')); });

    $msgs = [];
    $inq  = [];
    if ($link !== '') {
        foreach (loadAssoc($pdo, 'em_messages', []) as $m) { if (($m['toId'] ?? '') === $link) $msgs[] = $m; }
        foreach (loadAssoc($pdo, 'em_inquiries', []) as $q) { if (($q['fromId'] ?? '') === $link) $inq[] = $q; }
    }
    usort($msgs, function ($a, $b) { return strcmp((string)($b['date'] ?? ''), (string)($a['date'] ?? '')); });
    usort($inq, function ($a, $b) { return strcmp((string)($b['date'] ?? ''), (string)($a['date'] ?? '')); });

    $me = ['name' => $u['name'], 'phone' => '', 'email' => $u['email'], 'address' => '', 'photo' => ''];
    if ($kind === 'parent') {
        foreach (loadAssoc($pdo, 'em_parents', []) as $p) {
            if (($p['id'] ?? '') === $link) { $me = ['name' => $p['name'] ?? $u['name'], 'phone' => $p['phone'] ?? '', 'email' => $p['email'] ?? $u['email'], 'address' => $p['address'] ?? '', 'photo' => '']; }
        }
    } elseif ($kind === 'student' && $out) {
        $me['photo'] = $out[0]['photo'] ?? '';
    }
    $settings = loadAssoc($pdo, 'em_settings', []);
    respond([
        'ok' => true, 'kind' => $kind, 'linked' => $link !== '', 'me' => $me, 'children' => $out, 'diag' => $diag,
        'announcements' => array_slice($ann, 0, 30), 'events' => array_slice($evs, 0, 40),
        'messages' => array_slice($msgs, 0, 30), 'inquiries' => array_slice($inq, 0, 30),
        'school' => ['name' => $settings['profile']['name'] ?? 'Greenhill Academy', 'payTo' => $settings['profile']['payTo'] ?? '', 'phone' => $settings['profile']['phone'] ?? '',
                     'motto' => $settings['profile']['motto'] ?? '', 'logo' => schoolLogoUrl($pdo), 'address' => $settings['profile']['address'] ?? '',
                     'email' => $settings['profile']['email'] ?? '', 'principal' => $settings['profile']['principal'] ?? ''],
        // The school's own grading bands, so the results / report form show the same grades the teachers see.
        'grading' => portalGradingBands($settings),
    ]);
}

function portalInquiry(): void {
    global $pdo;
    $u    = requireUser($pdo);
    $kind = portalKind($u);
    if (!$kind) respond(['ok' => false, 'error' => 'This account does not have portal access.'], 403);
    $u['linked_id'] = portalResolveLink($pdo, $u, $kind);
    $b       = input();
    $type    = (string)($b['type'] ?? 'Inquiry');
    $subject = trim((string)($b['subject'] ?? ''));
    $message = trim((string)($b['message'] ?? ''));
    if (!in_array($type, ['Inquiry', 'Leave request', 'Complaint', 'Other'], true)) $type = 'Inquiry';
    if ($subject === '' || $message === '') respond(['ok' => false, 'error' => 'Add a subject and a message.'], 400);
    if (mb_strlen($subject) > 150 || mb_strlen($message) > 2000) respond(['ok' => false, 'error' => 'That message is too long.'], 400);

    $rec = [
        'id' => uid('inq'), 'date' => date('Y-m-d'), 'fromType' => $kind, 'fromId' => (string)($u['linked_id'] ?: $u['id']),
        'fromName' => $u['name'], 'type' => $type, 'subject' => $subject, 'message' => $message,
        'childId' => (string)($b['childId'] ?? ''), 'status' => 'New', 'reply' => '',
        // Columns the staff Inquiries screen shows (it had no name / source for portal messages before).
        'name' => $u['name'], 'email' => (string)($u['email'] ?? ''), 'phone' => '', 'source' => 'Portal',
    ];
    $pdo->beginTransaction();
    try {
        $row  = loadKeyRow($pdo, 'em_inquiries', true);
        $list = $row ? json_decode($row['value'], true) : [];
        if (!is_array($list) || !isList($list)) $list = [];
        $list[] = $rec;
        storeKey($pdo, 'em_inquiries', json_encode($list));
        audit($pdo, $u, 'create', 'inquiries', $rec['id'], 'Portal ' . strtolower($type) . ': ' . $subject, null);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    notifyPortalInquiry($pdo, $u, $rec);   // staff who can send communication are told straight away
    respond(['ok' => true]);
}

function portalUpdateProfile(): void {
    global $pdo;
    $u = requireUser($pdo);
    if (portalKind($u) !== 'parent') respond(['ok' => false, 'error' => 'Only parent accounts can update these details.'], 403);
    $u['linked_id'] = portalResolveLink($pdo, $u, 'parent');
    if ($u['linked_id'] === '') respond(['ok' => false, 'error' => 'Your account is not linked to a parent record yet. Open the Parent Portal home page and connect it first.'], 403);
    $b       = input();
    $phone   = mb_substr(trim((string)($b['phone'] ?? '')), 0, 30);
    $email   = mb_substr(trim((string)($b['email'] ?? '')), 0, 150);
    $address = mb_substr(trim((string)($b['address'] ?? '')), 0, 250);
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) respond(['ok' => false, 'error' => 'Enter a valid email address.'], 400);

    $pdo->beginTransaction();
    try {
        $row  = loadKeyRow($pdo, 'em_parents', true);
        $list = $row ? json_decode($row['value'], true) : [];
        $found = false;
        if (is_array($list)) {
            foreach ($list as &$p) {
                if (($p['id'] ?? '') === $u['linked_id']) {
                    $p['phone'] = $phone; $p['email'] = $email; $p['address'] = $address;
                    $found = true;
                }
            }
            unset($p);
        }
        if (!$found) { $pdo->rollBack(); respond(['ok' => false, 'error' => 'Your parent record was not found. Ask the school office.'], 404); }
        storeKey($pdo, 'em_parents', json_encode($list));
        audit($pdo, $u, 'update', 'parents', (string)$u['linked_id'], 'Parent updated own contact details via portal', null);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    respond(['ok' => true]);
}

// Lets a student (portal.student account, linked to their own record) upload
// their own profile photo — nothing else on the student record. The photo
// arrives already resized/compressed client-side as a data: URI.
function portalUploadPhoto(): void {
    global $pdo;
    $u = requireUser($pdo);
    if (portalKind($u) !== 'student') respond(['ok' => false, 'error' => 'Only student accounts can upload a profile photo.'], 403);
    $u['linked_id'] = portalResolveLink($pdo, $u, 'student');
    if ($u['linked_id'] === '') respond(['ok' => false, 'error' => 'Your account is not linked to a student record yet. Open the Student Portal home page and connect it first.'], 403);
    $b     = input();
    $photo = (string)($b['photo'] ?? '');
    if ($photo === '') respond(['ok' => false, 'error' => 'No photo was received.'], 400);
    if (!preg_match('#^data:image/(png|jpe?g|webp);base64,#i', $photo)) respond(['ok' => false, 'error' => 'That does not look like an image file.'], 400);
    if (strlen($photo) > 450000) respond(['ok' => false, 'error' => 'That photo is too large — please choose a smaller one.'], 400);

    $pdo->beginTransaction();
    try {
        $row  = loadKeyRow($pdo, 'em_students', true);
        $list = $row ? json_decode($row['value'], true) : [];
        $found = false;
        if (is_array($list)) {
            foreach ($list as &$s) {
                if (($s['id'] ?? '') === $u['linked_id']) { $s['photo'] = $photo; $found = true; }
            }
            unset($s);
        }
        if (!$found) { $pdo->rollBack(); respond(['ok' => false, 'error' => 'Your student record was not found. Ask the school office.'], 404); }
        storeKey($pdo, 'em_students', json_encode($list));
        audit($pdo, $u, 'update', 'students', (string)$u['linked_id'], 'Student uploaded their own profile photo via portal', null);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    respond(['ok' => true]);
}
