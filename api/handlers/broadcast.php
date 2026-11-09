<?php
// api/handlers/broadcast.php — Messaging → Broadcast: send an in-app notification to a target group.
// (E-mail has been removed from the system; everything is delivered to the recipients' notification bell.)
//
//   broadcast_preview   POST  how many people would this reach?
//   broadcast_send      POST  notify exactly that group now
//   broadcast_send_due  POST  send any "Scheduled" broadcasts whose time has come
//
// All of them need communication.send. The group is resolved HERE on the server from the school records
// and the login accounts (see notifBroadcastUserIds in notify.php) — the browser only says who it wants:
//   students | parents | staff | class (a grade) | specific (one student / parent / staff member).
// Everyone is de-duplicated, so a parent with three children in a class gets ONE notification.
// Only people who have a login can receive a notification.

const BROADCAST_MAX_RECIPIENTS = 5000;

function bcRecordList($v): array {
    $out = [];
    if (is_array($v)) foreach ($v as $r) { if (is_array($r) && isset($r['id'])) $out[] = $r; }
    return $out;
}

/** Plain-English name of the target group, e.g. "All Parents & Guardians" or "Class — Grade 5". */
function bcLabel(PDO $pdo, string $audience, string $grade, string $target): string {
    if ($audience === 'students') return 'All Students';
    if ($audience === 'parents')  return 'All Parents & Guardians';
    if ($audience === 'staff')    return 'All Staff';
    if ($audience === 'class')    return 'Class — ' . $grade;
    if ($audience === 'specific') {
        $parts = explode(':', $target, 2);
        $key = ['student' => 'em_students', 'parent' => 'em_parents', 'staff' => 'em_teachers'][$parts[0] ?? ''] ?? '';
        if ($key !== '') {
            foreach (bcRecordList(loadAssoc($pdo, $key, [])) as $r) {
                if ((string)$r['id'] === (string)($parts[1] ?? '')) return (string)($r['name'] ?? 'Recipient');
            }
        }
    }
    return '';
}

/** Login ids of everyone in the target group (empty array if the group is empty or invalid). */
function bcRecipientIds(PDO $pdo, string $audience, string $grade, string $target): array {
    if (!in_array($audience, ['students', 'parents', 'staff', 'class', 'specific'], true)) return [];
    if ($audience === 'class' && $grade === '') return [];
    if ($audience === 'specific' && trim($target) === '') return [];
    $GLOBALS['NOTIF_MEMO'] = [];
    $ids = notifBroadcastUserIds($pdo, $audience, $grade, $target);
    $GLOBALS['NOTIF_MEMO'] = [];
    return array_values(array_unique(array_map('strval', $ids)));
}

/** Sends one broadcast. Returns ['label'=>..., 'inapp'=>N] or ['error'=>...]. Never responds itself. */
function bcRun(PDO $pdo, string $audience, string $grade, string $target, string $subject, string $message, ?array $actor = null): array {
    if (trim($message) === '') return ['error' => 'Write a message before sending.'];
    $label = bcLabel($pdo, $audience, $grade, $target);
    if ($label === '' || ($audience === 'class' && $grade === '')) return ['error' => 'Choose who this message is for.'];

    $ids = bcRecipientIds($pdo, $audience, $grade, $target);
    if (!$ids) return ['error' => 'No one in "' . $label . '" has a login yet, so there is nobody to notify.'];
    if (count($ids) > BROADCAST_MAX_RECIPIENTS) {
        return ['error' => 'This group has ' . count($ids) . ' people; the limit per broadcast is ' . BROADCAST_MAX_RECIPIENTS . '. Send it by class instead.'];
    }
    @set_time_limit(120);
    $GLOBALS['NOTIF_MEMO'] = [];
    $inapp = notifyUsers($pdo, $ids, 'message', $subject !== '' ? $subject : 'Notice from the school', $message, 'portal',
                         '', (string)($actor['name'] ?? 'School office'), isset($actor['id']) ? (string)$actor['id'] : null);
    $GLOBALS['NOTIF_MEMO'] = [];
    return ['label' => $label, 'inapp' => (int)$inapp];
}

function bcRequireSender(PDO $pdo): array {
    $u = requireUser($pdo);
    if (!userCan($u, 'communication.send')) respond(['ok' => false, 'error' => 'You do not have permission to send broadcasts.'], 403);
    return $u;
}

/* ---------------- endpoints ---------------- */
function broadcastPreview(): void {
    global $pdo;
    bcRequireSender($pdo);
    $b = input();
    $aud = (string)($b['audience'] ?? ''); $grade = trim((string)($b['grade'] ?? '')); $target = (string)($b['target'] ?? '');
    $label = bcLabel($pdo, $aud, $grade, $target);
    if ($label === '') respond(['ok' => true, 'reachable' => 0, 'label' => '']);
    respond(['ok' => true, 'label' => $label, 'reachable' => count(bcRecipientIds($pdo, $aud, $grade, $target))]);
}

function broadcastSend(): void {
    global $pdo;
    $u = bcRequireSender($pdo);
    $b = input();
    $out = bcRun($pdo, (string)($b['audience'] ?? ''), trim((string)($b['grade'] ?? '')), (string)($b['target'] ?? ''),
                 trim((string)($b['subject'] ?? '')), (string)($b['message'] ?? ''), $u);
    if (isset($out['error'])) respond(['ok' => false, 'error' => $out['error']], 400);
    audit($pdo, $u, 'create', 'broadcast', null, 'Broadcast to ' . $out['label'] . ': ' . $out['inapp'] . ' notified in-app');
    respond(['ok' => true] + $out);
}

/** Sends every "Scheduled" broadcast whose time has passed, and updates its record. */
function broadcastSendDue(): void {
    global $pdo;
    $u = bcRequireSender($pdo);
    $now = time();

    // 1) claim the due ones (mark "Sending") so two open browsers can't both send them
    $due = [];
    $pdo->beginTransaction();
    try {
        $row = loadKeyRow($pdo, 'em_broadcasts', true);
        $list = $row ? json_decode($row['value'], true) : null;
        if (!is_array($list)) $list = [];
        foreach ($list as $i => $rec) {
            if (!is_array($rec) || ($rec['status'] ?? '') !== 'Scheduled') continue;
            $when = !empty($rec['scheduledAtUtc']) ? strtotime((string)$rec['scheduledAtUtc']) : strtotime((string)($rec['scheduledFor'] ?? ''));
            if ($when === false || $when > $now) continue;
            $list[$i]['status'] = 'Sending';
            $due[] = $rec;
        }
        if ($due) storeKey($pdo, 'em_broadcasts', json_encode($list));
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    if (!$due) respond(['ok' => true, 'dispatched' => 0]);

    // 2) send them
    $outcomes = [];
    foreach ($due as $rec) {
        $o = bcRun($pdo, (string)($rec['audience'] ?? ''), trim((string)($rec['grade'] ?? '')),
                   (string)($rec['targetId'] ?? ''), trim((string)($rec['subject'] ?? '')), (string)($rec['message'] ?? ''), $u);
        $outcomes[(string)$rec['id']] = $o;
        audit($pdo, $u, 'create', 'broadcast', (string)$rec['id'], 'Scheduled broadcast to ' . ($rec['targetLabel'] ?? '') . ': ' .
            (isset($o['error']) ? 'not sent — ' . $o['error'] : $o['inapp'] . ' notified in-app'));
    }

    // 3) write the results back onto the records
    $pdo->beginTransaction();
    try {
        $row = loadKeyRow($pdo, 'em_broadcasts', true);
        $list = $row ? json_decode($row['value'], true) : null;
        if (!is_array($list)) $list = [];
        foreach ($list as $i => $rec) {
            $id = is_array($rec) ? (string)($rec['id'] ?? '') : '';
            if ($id === '' || !isset($outcomes[$id])) continue;
            $o = $outcomes[$id];
            if (isset($o['error'])) { $list[$i]['status'] = 'Failed'; $list[$i]['recipients'] = 0; $list[$i]['error'] = $o['error']; }
            else {
                $list[$i]['recipients'] = $o['inapp'];
                $list[$i]['inapp'] = $o['inapp'];
                $list[$i]['status'] = 'Sent';
                $list[$i]['date'] = gmdate('c');
            }
        }
        storeKey($pdo, 'em_broadcasts', json_encode($list));
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    respond(['ok' => true, 'dispatched' => count($outcomes)]);
}
