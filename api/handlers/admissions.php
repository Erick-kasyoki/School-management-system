<?php
// api/handlers/admissions.php — online admission applications.
//   PUBLIC (no login):  apply_info, apply_submit, apply_track, apply_doc
//   STAFF (admissions): adm_list, adm_get, adm_action, adm_edit, adm_doc
// Tables are created on first use, so re-running schema.sql is optional.

const ADM_FEE = 200;
const ADM_CURRENCY = 'KSh';
const ADM_DOCS = ['Birth Certificate', 'Passport Photo', 'Previous School Report', 'Medical Report', 'Proof of Residence'];

function admEnsure(PDO $pdo): void {
    $pdo->exec("CREATE TABLE IF NOT EXISTS admission_applications (
        id VARCHAR(40) PRIMARY KEY, app_no VARCHAR(30) UNIQUE NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'Submitted', data JSONB NOT NULL DEFAULT '{}'::jsonb,
        photo TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    $pdo->exec("CREATE TABLE IF NOT EXISTS admission_documents (
        id VARCHAR(40) PRIMARY KEY, app_id VARCHAR(40) NOT NULL, label VARCHAR(80), filename VARCHAR(150),
        mime VARCHAR(60), data TEXT NOT NULL, uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    $pdo->exec("CREATE TABLE IF NOT EXISTS app_notifications (
        id VARCHAR(40) PRIMARY KEY, audience JSONB NOT NULL DEFAULT '[]'::jsonb, title VARCHAR(200) NOT NULL,
        body TEXT, view VARCHAR(40), actor_id VARCHAR(40), created_at TIMESTAMPTZ NOT NULL DEFAULT now())");
}

// Two different offices: the ADMINISTRATOR processes applications; the PRINCIPAL / HEADTEACHER takes the decision.
const ADM_ADMIN_ROLES = ['administrator', 'super_admin'];
const ADM_PRINCIPAL_ROLES = ['principal'];

/** Saves an in-app notification for these roles (shown in their notification bell). */
function admNotify(PDO $pdo, string $title, string $body, bool $alsoPrincipal = false, ?array $actor = null): void {
    try {
        $roles = $alsoPrincipal ? array_merge(ADM_ADMIN_ROLES, ADM_PRINCIPAL_ROLES) : ADM_ADMIN_ROLES;
        $pdo->prepare('INSERT INTO app_notifications (id, audience, title, body, view, actor_id) VALUES (?, CAST(? AS jsonb), ?, ?, ?, ?)')
            ->execute([uid('ntf'), json_encode($roles), $title, $body, 'applications', $actor['id'] ?? null]);
    } catch (Throwable $e) { /* a failed notification must never block the action itself */ }
}

function notifList(): void {
    global $pdo; $u = requireUser($pdo); admEnsure($pdo);
    $mine = [$u['role_key']]; if (!empty($u['is_admin'])) $mine[] = 'super_admin';
    $out = [];
    foreach ($pdo->query("SELECT id, audience::text AS audience, title, body, view, created_at FROM app_notifications WHERE created_at > now() - interval '45 days' ORDER BY created_at DESC LIMIT 100") as $r) {
        if (array_intersect($mine, json_decode($r['audience'], true) ?: [])) $out[] = ['id' => $r['id'], 'title' => $r['title'], 'desc' => (string)$r['body'], 'view' => $r['view'], 'ts' => $r['created_at']];
        if (count($out) >= 40) break;
    }
    respond(['ok' => true, 'items' => $out]);
}

function admClasses(PDO $pdo): array {
    $out = [];
    foreach (loadAssoc($pdo, 'em_classes', []) as $c) if (is_array($c) && !empty($c['name'])) $out[] = (string)$c['name'];
    return $out ?: ['Basic 1','Basic 2','Basic 3','Basic 4','Basic 5','Basic 6','JHS 1','JHS 2','JHS 3'];
}

function admYear(PDO $pdo): string {
    $s = loadAssoc($pdo, 'em_settings', []);
    if (!empty($s['academicYear'])) return (string)$s['academicYear'];
    $y = (int)date('Y'); return $y . '/' . ($y + 1);
}

function admNextNo(PDO $pdo): string {
    $y = date('Y');
    $n = (int)$pdo->query("SELECT COUNT(*) FROM admission_applications WHERE app_no LIKE 'APP-$y-%'")->fetchColumn() + 1;
    do { $no = sprintf('APP-%s-%05d', $y, $n++);
         $q = $pdo->prepare('SELECT 1 FROM admission_applications WHERE app_no = ?'); $q->execute([$no]);
    } while ($q->fetchColumn());
    return $no;
}

function admDecode(array $r, bool $staff, array $docs): array {
    $d = json_decode($r['data'], true) ?: [];
    $d['id'] = $r['id']; $d['appNo'] = $r['app_no']; $d['status'] = $r['status']; $d['photo'] = (string)$r['photo'];
    $d['docs'] = $docs;
    if (!$staff) unset($d['notes']);
    return $d;
}

function admDocs(PDO $pdo, string $id): array {
    $q = $pdo->prepare('SELECT id, label, filename, mime, uploaded_at FROM admission_documents WHERE app_id = ? ORDER BY uploaded_at');
    $q->execute([$id]); return $q->fetchAll();
}

function admLoad(PDO $pdo, string $key): ?array {
    $q = $pdo->prepare('SELECT id, app_no, status, data::text AS data, photo FROM admission_applications WHERE id = ? OR app_no = ?');
    $q->execute([$key, $key]); $r = $q->fetch(); return $r ?: null;
}

function admSave(PDO $pdo, string $id, array $d, ?string $status = null): void {
    $pdo->prepare('UPDATE admission_applications SET data = CAST(? AS jsonb), status = COALESCE(?, status), updated_at = now() WHERE id = ?')
        ->execute([json_encode($d), $status, $id]);
}

function admEvent(array &$d, string $text, string $by = ''): void {
    $d['history'][] = ['at' => date('c'), 'text' => $text, 'by' => $by];
}

function admClean($v, int $max = 200): string { return mb_substr(trim(strip_tags((string)$v)), 0, $max); }

function admPublicAuth(PDO $pdo, string $no, string $phone): array {
    admEnsure($pdo);
    $r = admLoad($pdo, trim($no));
    $ok = $r && ($d = json_decode($r['data'], true)) && normalizePhone((string)($d['guardian']['phone'] ?? '')) !== ''
        && substr(normalizePhone($phone), -9) === substr(normalizePhone((string)$d['guardian']['phone']), -9);
    if (!$ok) { usleep(800000); respond(['ok' => false, 'error' => 'No application matches that number and phone.'], 404); }
    return $r;
}

function applyInfo(): void {
    global $pdo; admEnsure($pdo);
    respond(['ok' => true, 'classes' => admClasses($pdo), 'year' => admYear($pdo), 'fee' => ADM_FEE, 'currency' => ADM_CURRENCY, 'docs' => ADM_DOCS]);
}

function applySubmit(): void {
    global $pdo; admEnsure($pdo);
    $b = input(); $s = $b['student'] ?? []; $g = $b['guardian'] ?? [];
    $name = admClean($s['name'] ?? ''); $dob = admClean($s['dob'] ?? '', 10); $class = admClean($b['classApplied'] ?? '');
    $gname = admClean($g['name'] ?? ''); $gphone = admClean($g['phone'] ?? '', 30);
    if ($name === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $dob) || $class === '' || $gname === '' || strlen(normalizePhone($gphone)) < 9)
        respond(['ok' => false, 'error' => 'Please fill in the student name, date of birth, class, guardian name and a valid phone number.'], 400);
    if (!in_array($class, admClasses($pdo), true)) respond(['ok' => false, 'error' => 'Choose a class from the list.'], 400);
    if (!in_array((string)($s['gender'] ?? ''), ['Female', 'Male'], true)) respond(['ok' => false, 'error' => 'Please choose the student\'s gender.'], 400);
    foreach (['nationality' => 'nationality', 'religion' => 'religion'] as $k => $lbl)
        if (admClean($s[$k] ?? '') === '') respond(['ok' => false, 'error' => "Please choose the student's $lbl."], 400);
    $photo = (string)($b['photo'] ?? '');
    if ($photo !== '' && (!preg_match('#^data:image/(png|jpe?g|webp);base64,#i', $photo) || strlen($photo) > 450000))
        respond(['ok' => false, 'error' => 'The passport photo must be a small JPG/PNG image.'], 400);
    $pick = fn(array $a, array $keys) => array_combine($keys, array_map(fn($k) => admClean($a[$k] ?? ''), $keys));
    $d = [
        'student' => ['name' => $name, 'dob' => $dob] + $pick($s, ['gender','nationality','religion','previousSchool','health','bloodGroup']),
        'guardian' => ['name' => $gname, 'phone' => $gphone] + $pick($g, ['relationship','whatsapp','email','occupation','address','additional']),
        'classApplied' => $class, 'section' => admClean($b['section'] ?? ''), 'year' => admYear($pdo),
        'term' => admClean($b['term'] ?? 'Term 1'), 'type' => 'New Admission', 'received' => date('Y-m-d'),
        'assignedTo' => '', 'nextStep' => 'Review application',
        'fee' => ['amount' => ADM_FEE, 'currency' => ADM_CURRENCY, 'method' => admClean($b['payMethod'] ?? 'Mobile Money'),
                  'txn' => admClean($b['payRef'] ?? '', 60), 'date' => date('Y-m-d'), 'paid' => false],
        'history' => [], 'notes' => [], 'interview' => null,
    ];
    admEvent($d, 'Application received'); admEvent($d, 'Application submitted');
    $id = uid('app'); $no = admNextNo($pdo);
    $pdo->prepare('INSERT INTO admission_applications (id, app_no, status, data, photo) VALUES (?,?,?,CAST(? AS jsonb),?)')
        ->execute([$id, $no, 'Submitted', json_encode($d), $photo]);
    foreach ((array)($b['docs'] ?? []) as $doc) {
        $label = admClean($doc['label'] ?? ''); $data = (string)($doc['data'] ?? '');
        if (!in_array($label, ADM_DOCS, true) || !preg_match('#^data:(application/pdf|image/(png|jpe?g|webp));base64,#i', $data, $m) || strlen($data) > 2800000) continue;
        $pdo->prepare('INSERT INTO admission_documents (id, app_id, label, filename, mime, data) VALUES (?,?,?,?,?,?)')
            ->execute([uid('doc'), $id, $label, admClean($doc['filename'] ?? $label, 120), strtolower($m[1]), $data]);
    }
    admNotify($pdo, "New application $no", "$name applied for $class (guardian: $gname, $gphone).");
    respond(['ok' => true, 'appNo' => $no]);
}

function applyTrack(): void {
    global $pdo; $b = input();
    $r = admPublicAuth($pdo, (string)($b['appNo'] ?? ''), (string)($b['phone'] ?? ''));
    respond(['ok' => true, 'app' => admDecode($r, false, admDocs($pdo, $r['id']))]);
}

function admServeDoc(PDO $pdo, string $appId, string $docId): void {
    $q = $pdo->prepare('SELECT filename, mime, data FROM admission_documents WHERE id = ? AND app_id = ?');
    $q->execute([$docId, $appId]); $r = $q->fetch();
    if (!$r) respond(['ok' => false, 'error' => 'Not found'], 404);
    header_remove('Content-Type');
    header('Content-Type: ' . $r['mime']);
    header('Content-Disposition: attachment; filename="' . preg_replace('/[^\w.\- ]/', '_', $r['filename']) . '"');
    echo base64_decode(substr($r['data'], strpos($r['data'], ',') + 1)); exit;
}

function applyDoc(): void {
    global $pdo; $r = admPublicAuth($pdo, (string)($_GET['appNo'] ?? ''), (string)($_GET['phone'] ?? ''));
    admServeDoc($pdo, $r['id'], (string)($_GET['doc'] ?? ''));
}

/* ---------------- staff ---------------- */
function admList(): void {
    global $pdo; requirePerm($pdo, 'admissions.view'); admEnsure($pdo);
    $out = [];
    foreach ($pdo->query('SELECT id, app_no, status, data::text AS data, photo FROM admission_applications ORDER BY created_at DESC') as $r) {
        $d = json_decode($r['data'], true) ?: [];
        $out[] = ['id' => $r['id'], 'appNo' => $r['app_no'], 'status' => $r['status'], 'name' => $d['student']['name'] ?? '',
                  'classApplied' => $d['classApplied'] ?? '', 'received' => $d['received'] ?? '', 'guardian' => $d['guardian']['name'] ?? '',
                  'paid' => !empty($d['fee']['paid'])];
    }
    respond(['ok' => true, 'list' => $out]);
}

function admGet(): void {
    global $pdo; requirePerm($pdo, 'admissions.view'); admEnsure($pdo);
    $r = admLoad($pdo, (string)($_GET['id'] ?? '')); if (!$r) respond(['ok' => false, 'error' => 'Not found'], 404);
    respond(['ok' => true, 'app' => admDecode($r, true, admDocs($pdo, $r['id']))]);
}

function admDoc(): void {
    global $pdo; requirePerm($pdo, 'admissions.view');
    admServeDoc($pdo, (string)($_GET['id'] ?? ''), (string)($_GET['doc'] ?? ''));
}

function admAction(): void {
    global $pdo; $u = requireUser($pdo); admEnsure($pdo);
    $b = input(); $r = admLoad($pdo, (string)($b['id'] ?? '')); if (!$r) respond(['ok' => false, 'error' => 'Not found'], 404);
    $d = json_decode($r['data'], true); $st = $r['status']; $act = (string)($b['action'] ?? '');
    // Administrator (admissions.manage) processes; Principal / Headteacher (admissions.decide) decides.
    $isDecision = in_array($act, ['approve', 'reject'], true);
    $allowed = $isDecision ? userCan($u, 'admissions.decide')
             : ($act === 'note' ? userCanAny($u, ['admissions.manage', 'admissions.decide']) : userCan($u, 'admissions.manage'));
    if (!$allowed) respond(['ok' => false, 'error' => $isDecision
        ? 'Only the Principal / Headteacher can approve or reject an application. Use "Refer to Principal / Headteacher" instead.'
        : 'You do not have permission to do that.'], 403);
    $notify = null;
    $who = $u['name']; $stuName = $d['student']['name'];
    switch ($act) {
        case 'review':    $st = 'Under Review'; $d['assignedTo'] = $who; $d['nextStep'] = 'Invite to Interview'; admEvent($d, 'Moved to Under Review', $who); $notify = ['moved to Under Review', false]; break;
        case 'refer':     $d['nextStep'] = 'Awaiting Principal / Headteacher decision'; admEvent($d, 'Referred to the Principal / Headteacher for decision', $who); $notify = ['referred to the Principal / Headteacher for a decision', true]; break;
        case 'interview':
            $date = admClean($b['date'] ?? '', 10); $time = admClean($b['time'] ?? '', 5);
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || $time === '') respond(['ok' => false, 'error' => 'Choose an interview date and time.'], 400);
            $st = 'Interview Invited'; $d['interview'] = ['date' => $date, 'time' => $time]; $d['nextStep'] = 'Decide: approve or reject';
            admEvent($d, "Interview scheduled for $date at $time", $who); $notify = ["interview scheduled for $date at $time", true];
            break;
        case 'approve':   $st = 'Approved'; $d['nextStep'] = 'Complete admission'; admEvent($d, 'Application approved by the Principal / Headteacher', $who); $notify = ['APPROVED by the Principal / Headteacher', true];
            break;
        case 'reject':    $st = 'Rejected'; $d['nextStep'] = 'None'; admEvent($d, 'Application rejected by the Principal / Headteacher', $who); $notify = ['REJECTED by the Principal / Headteacher', true];
            break;
        case 'paid':      $d['fee']['paid'] = true; admEvent($d, 'Application fee marked as paid', $who); $notify = ['application fee marked as paid', false]; break;
        case 'note':
            $t = admClean($b['text'] ?? '', 1000); if ($t === '') respond(['ok' => false, 'error' => 'Write a note first.'], 400);
            $d['notes'][] = ['text' => $t, 'by' => $who, 'at' => date('c')]; $notify = ['internal note added', false]; break;
        case 'delete':
            $pdo->prepare('DELETE FROM admission_documents WHERE app_id = ?')->execute([$r['id']]);
            $pdo->prepare('DELETE FROM admission_applications WHERE id = ?')->execute([$r['id']]);
            audit($pdo, $u, 'delete', 'applications', $r['id'], 'Deleted application ' . $r['app_no'], null);
            admNotify($pdo, "Application {$r['app_no']} deleted", "$stuName's application was deleted by $who.", false, $u); respond(['ok' => true, 'deleted' => true]);
        default: respond(['ok' => false, 'error' => 'Unknown action'], 400);
    }
    admSave($pdo, $r['id'], $d, $st);
    audit($pdo, $u, 'update', 'applications', $r['id'], "Application {$r['app_no']}: $act", null);
    if ($notify) admNotify($pdo, "Application {$r['app_no']}: {$notify[0]}", "$stuName ({$d['classApplied']}) — {$notify[0]}, by $who.", $notify[1], $u);
    $r = admLoad($pdo, $r['id']);
    respond(['ok' => true, 'app' => admDecode($r, true, admDocs($pdo, $r['id']))]);
}

function admEdit(): void {
    global $pdo; $u = requirePerm($pdo, 'admissions.manage'); admEnsure($pdo);
    $b = input(); $r = admLoad($pdo, (string)($b['id'] ?? '')); if (!$r) respond(['ok' => false, 'error' => 'Not found'], 404);
    $d = json_decode($r['data'], true);
    foreach (['student' => ['name','gender','nationality','religion','previousSchool','health','bloodGroup'],
              'guardian' => ['name','relationship','phone','whatsapp','email','occupation','address','additional']] as $grp => $keys)
        foreach ($keys as $k) if (isset($b[$grp][$k])) $d[$grp][$k] = admClean($b[$grp][$k]);
    foreach (['classApplied','section','term'] as $k) if (isset($b[$k])) $d[$k] = admClean($b[$k]);
    admEvent($d, 'Application details edited', $u['name']); admSave($pdo, $r['id'], $d);
    audit($pdo, $u, 'update', 'applications', $r['id'], "Edited application {$r['app_no']}", null);
    admNotify($pdo, "Application {$r['app_no']}: details edited", "{$d['student']['name']}'s application was edited by {$u['name']}.", false, $u);
    $r = admLoad($pdo, $r['id']);
    respond(['ok' => true, 'app' => admDecode($r, true, admDocs($pdo, $r['id']))]);
}
