<?php
// api/handlers/audit_security.php — audit log, security-event log, session
// registry (list/revoke) and account activation/expiry.

function auditList(): void {
    global $pdo;
    requirePerm($pdo, 'audit.view');
    $q      = trim((string)($_GET['q'] ?? ''));
    $entity = trim((string)($_GET['entity'] ?? ''));
    $limit  = max(1, min(200, (int)($_GET['limit'] ?? 100)));
    $offset = max(0, (int)($_GET['offset'] ?? 0));

    $where  = [];
    $params = [];
    if ($q !== '') {
        $where[]  = '(summary ILIKE ? OR user_name ILIKE ?)';
        $params[] = '%' . $q . '%';
        $params[] = '%' . $q . '%';
    }
    if ($entity !== '') {
        $where[]  = 'entity = ?';
        $params[] = $entity;
    }
    $sql = 'SELECT id, at, user_id, user_name, user_role, action, entity, record_id, summary, details::text AS details, ip FROM audit_logs'
         . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
         . ' ORDER BY at DESC, id DESC LIMIT ' . ($limit + 1) . ' OFFSET ' . $offset;
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    $more = count($rows) > $limit;
    if ($more) array_pop($rows);
    foreach ($rows as &$r) { $r['details'] = $r['details'] !== null ? json_decode($r['details'], true) : null; }
    unset($r);
    $entities = $pdo->query('SELECT DISTINCT entity FROM audit_logs ORDER BY entity')->fetchAll(PDO::FETCH_COLUMN);
    respond(['ok' => true, 'rows' => $rows, 'has_more' => $more, 'entities' => $entities]);
}

function securityList(): void {
    global $pdo;
    requirePerm($pdo, 'security.view');
    $rows = $pdo->query('SELECT id, at, type, user_id, email, ip, user_agent, detail FROM security_events ORDER BY at DESC, id DESC LIMIT 300')->fetchAll();
    respond(['ok' => true, 'rows' => $rows]);
}

/** Active sessions across everyone (for security.view), or just the caller's own (everyone else). */
function sessionsList(): void {
    global $pdo;
    $u = requireUser($pdo);
    $own = !userCan($u, 'security.view');
    $sql = 'SELECT a.session_key_hash, a.user_id, s.name AS user_name, a.created_at, a.last_activity_at, a.ip_address, a.user_agent
              FROM active_sessions a LEFT JOIN staff_accounts s ON s.id = a.user_id'
         . ($own ? ' WHERE a.user_id = ?' : '') . ' ORDER BY a.last_activity_at DESC LIMIT 300';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($own ? [$u['id']] : []);
    $rows = $stmt->fetchAll();
    $mine = sessionKeyHash();
    foreach ($rows as &$r) { $r['is_this_device'] = ($r['session_key_hash'] === $mine); $r['session_key_hash'] = substr($r['session_key_hash'], 0, 12); }
    unset($r);
    respond(['ok' => true, 'sessions' => $rows]);
}

/** Signs a device out remotely: an administrator for anyone, or a user for their own other devices. */
function sessionRevoke(): void {
    global $pdo;
    $u    = requireUser($pdo);
    $b    = input();
    $short = trim((string)($b['session_key_hash'] ?? ''));
    if ($short === '') respond(['ok' => false, 'error' => 'Missing session id.'], 400);

    $canAll = userCan($u, 'security.view');
    $sql = 'SELECT session_key_hash, user_id FROM active_sessions WHERE session_key_hash LIKE ?' . ($canAll ? '' : ' AND user_id = ?');
    $stmt = $pdo->prepare($sql);
    $stmt->execute($canAll ? [$short . '%'] : [$short . '%', $u['id']]);
    $row = $stmt->fetch();
    if (!$row) respond(['ok' => false, 'error' => 'Session not found.'], 404);

    $pdo->prepare('DELETE FROM active_sessions WHERE session_key_hash = ?')->execute([$row['session_key_hash']]);
    if ($row['user_id'] !== $u['id'] || $canAll) {
        audit($pdo, $u, 'update', 'sessions', $row['user_id'], 'Signed out a device for a user', null);
    }
    respond(['ok' => true]);
}

/** Deactivate/reactivate an account, or set/clear its access-expiry date. */
function setUserStatus(): void {
    global $pdo;
    $me = requirePerm($pdo, 'users.manage');
    $b  = input();
    $id = trim((string)($b['id'] ?? ''));
    if ($id === '') respond(['ok' => false, 'error' => 'Missing user id.'], 400);
    if ($id === $me['id']) respond(['ok' => false, 'error' => 'You cannot change your own account status while logged in.'], 400);

    $stmt = $pdo->prepare('SELECT id, name, is_admin, is_active FROM staff_accounts WHERE id = ?');
    $stmt->execute([$id]);
    $target = $stmt->fetch();
    if (!$target) respond(['ok' => false, 'error' => 'User not found.'], 404);

    $fields  = [];
    $params  = [];
    $changes = [];

    if (array_key_exists('is_active', $b)) {
        $active = (bool)$b['is_active'];
        if (!$active && toBool($target['is_admin']) && countAdmins($pdo) <= 1) {
            respond(['ok' => false, 'error' => 'At least one administrator is required — promote someone else before deactivating this account.'], 400);
        }
        $fields[] = 'is_active = ?';  $params[] = $active ? 'true' : 'false';
        $changes[] = $active ? 'reactivated' : 'deactivated';
    }

    if (array_key_exists('access_expires_at', $b)) {
        $raw = trim((string)$b['access_expires_at']);
        if ($raw === '') {
            $fields[] = 'access_expires_at = NULL';
            $changes[] = 'access expiry cleared';
        } else {
            $ts = strtotime($raw);
            if ($ts === false) respond(['ok' => false, 'error' => 'Invalid expiry date.'], 400);
            $fields[] = 'access_expires_at = ?';  $params[] = date('c', $ts);
            $changes[] = 'access expires ' . date('Y-m-d', $ts);
        }
    }

    if (!$fields) respond(['ok' => false, 'error' => 'Nothing to update.'], 400);

    $params[] = $id;
    $pdo->prepare('UPDATE staff_accounts SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($params);
    if (array_key_exists('is_active', $b) && !(bool)$b['is_active']) {
        $pdo->prepare('DELETE FROM active_sessions WHERE user_id = ?')->execute([$id]); // sign them out everywhere immediately
    }
    audit($pdo, $me, 'update', 'users', $id, 'Account status for ' . $target['name'] . ': ' . implode('; ', $changes), null);
    respond(['ok' => true]);
}

