<?php
// api/handlers/users_roles.php — Super Administrator screens: user accounts
// (list/create/set role/reset password/delete) and the role/permission editor.

function countAdmins(PDO $pdo): int {
    return (int)$pdo->query('SELECT COUNT(*) FROM staff_accounts WHERE is_admin = true')->fetchColumn();
}

function roleExists(PDO $pdo, string $key): bool {
    $stmt = $pdo->prepare('SELECT 1 FROM roles WHERE role_key = ?');
    $stmt->execute([$key]);
    return (bool)$stmt->fetchColumn();
}

function listUsers(): void {
    global $pdo;
    requirePerm($pdo, 'users.manage');
    $rows = $pdo->query(
        'SELECT s.id, s.name, s.role, s.role_key, r.label AS role_label, s.email, s.is_admin, s.linked_id, s.totp_enabled,
                s.must_change_password, s.last_login_at, s.created_at, s.is_active, s.access_expires_at
           FROM staff_accounts s LEFT JOIN roles r ON r.role_key = s.role_key
          ORDER BY s.created_at ASC'
    )->fetchAll();
    foreach ($rows as &$r) {
        $r['is_admin']     = toBool($r['is_admin']);
        $r['totp_enabled'] = toBool($r['totp_enabled']);
        $r['must_change_password'] = toBool($r['must_change_password']);
        $r['is_active']    = toBool($r['is_active']);
    }
    unset($r);
    respond(['ok' => true, 'users' => $rows]);
}

function createUser(): void {
    global $pdo;
    $me    = requirePerm($pdo, 'users.manage');
    $b     = input();
    $name  = trim((string)($b['name'] ?? ''));
    $email = strtolower(trim((string)($b['email'] ?? '')));
    $rk    = trim((string)($b['role_key'] ?? 'staff'));
    $label = trim((string)($b['role'] ?? ''));
    $link  = trim((string)($b['linked_id'] ?? ''));
    $pw    = (string)($b['password'] ?? '');

    if ($name === '' || $email === '') respond(['ok' => false, 'error' => 'Name and email are required.'], 400);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) respond(['ok' => false, 'error' => 'Enter a valid email address.'], 400);
    if ($rk === 'super_admin' || !roleExists($pdo, $rk)) respond(['ok' => false, 'error' => 'Choose a valid role.'], 400);
    if ($pw !== '' && ($problem = passwordProblem($pw))) respond(['ok' => false, 'error' => $problem], 400);

    // Same rule as self-signup: a Parent/Student account must point at a real
    // record in the school's own data, and each record can only back one account.
    if ($rk === 'student' || $rk === 'parent') {
        if ($link === '') respond(['ok' => false, 'error' => 'Pick which ' . ($rk === 'student' ? 'student' : 'parent/guardian') . ' record this login belongs to (Linked record ID).'], 400);
        $records = loadAssoc($pdo, $rk === 'student' ? 'em_students' : 'em_parents', []);
        $found = false;
        foreach ($records as $r) { if ((string)($r['id'] ?? '') === $link) { $found = true; break; } }
        if (!$found) respond(['ok' => false, 'error' => 'No ' . ($rk === 'student' ? 'student' : 'parent/guardian') . ' record with that ID was found.'], 400);
        $stmt = $pdo->prepare('SELECT id FROM staff_accounts WHERE role_key = ? AND linked_id = ?');
        $stmt->execute([$rk, $link]);
        if ($stmt->fetch()) respond(['ok' => false, 'error' => 'An account already exists for that record.'], 409);
    }

    elseif ($link !== '') {
        $found = false;
        foreach (loadAssoc($pdo, 'em_teachers', []) as $r) { if ((string)($r['id'] ?? '') === $link) { $found = true; break; } }
        if (!$found) respond(['ok' => false, 'error' => 'No staff record with that ID was found.'], 400);
        $stmt = $pdo->prepare('SELECT id FROM staff_accounts WHERE linked_id = ? AND role_key NOT IN (\'student\', \'parent\')');
        $stmt->execute([$link]);
        if ($stmt->fetch()) respond(['ok' => false, 'error' => 'Another login is already linked to that staff record.'], 409);
    }

    $stmt = $pdo->prepare('SELECT id FROM staff_accounts WHERE email = ?');
    $stmt->execute([$email]);
    if ($stmt->fetch()) respond(['ok' => false, 'error' => 'An account with that email already exists.'], 409);

    if ($label === '') {
        $stmt = $pdo->prepare('SELECT label FROM roles WHERE role_key = ?');
        $stmt->execute([$rk]);
        $label = (string)$stmt->fetchColumn();
    }
    $temp = $pw !== '' ? $pw : randomPassword();
    $id   = uid('usr');
    $stmt = $pdo->prepare('INSERT INTO staff_accounts (id, name, role, email, password_hash, is_admin, role_key, linked_id, must_change_password) VALUES (?, ?, ?, ?, ?, false, ?, ?, true)');
    $stmt->execute([$id, $name, mb_substr($label, 0, 80), $email, password_hash($temp, PASSWORD_DEFAULT), $rk, $link !== '' ? $link : null]);
    audit($pdo, $me, 'create', 'users', $id, 'Account created by administrator: ' . $name . ' (' . $rk . ')', null);
    respond(['ok' => true, 'id' => $id, 'temp_password' => $temp]);
}

function setUserRole(): void {
    global $pdo;
    $me = requirePerm($pdo, 'users.manage');
    $b  = input();
    $id = trim((string)($b['id'] ?? ''));
    if ($id === '') respond(['ok' => false, 'error' => 'Missing user id.'], 400);

    $stmt = $pdo->prepare('SELECT id, name, is_admin, role_key, role, linked_id FROM staff_accounts WHERE id = ?');
    $stmt->execute([$id]);
    $target = $stmt->fetch();
    if (!$target) respond(['ok' => false, 'error' => 'User not found.'], 404);

    $fields  = [];
    $params  = [];
    $changes = [];

    if (array_key_exists('role', $b)) {
        $role = trim((string)$b['role']);
        if ($role === '') respond(['ok' => false, 'error' => 'Role label cannot be empty.'], 400);
        $fields[] = 'role = ?';  $params[] = mb_substr($role, 0, 80);
        $changes[] = 'title → ' . $role;
    }

    if (array_key_exists('linked_id', $b)) {
        $link = trim((string)$b['linked_id']);
        $effectiveRole = array_key_exists('role_key', $b) ? trim((string)$b['role_key']) : (string)$target['role_key'];
        if ($link !== '' && ($effectiveRole === 'student' || $effectiveRole === 'parent')) {
            $records = loadAssoc($pdo, $effectiveRole === 'student' ? 'em_students' : 'em_parents', []);
            $found = false;
            foreach ($records as $r) { if ((string)($r['id'] ?? '') === $link) { $found = true; break; } }
            if (!$found) respond(['ok' => false, 'error' => 'No ' . ($effectiveRole === 'student' ? 'student' : 'parent/guardian') . ' record with that ID was found.'], 400);
            $stmt = $pdo->prepare('SELECT id FROM staff_accounts WHERE role_key = ? AND linked_id = ? AND id != ?');
            $stmt->execute([$effectiveRole, $link, $id]);
            if ($stmt->fetch()) respond(['ok' => false, 'error' => 'Another account is already linked to that record.'], 409);
        }
        // Staff-type logins (incl. the Super Administrator) link to a staff record so screens like
        // Apply for Leave / My Profile know who they are. Optional, but must be a real, unclaimed record.
        if ($link !== '' && $effectiveRole !== 'student' && $effectiveRole !== 'parent') {
            $found = false;
            foreach (loadAssoc($pdo, 'em_teachers', []) as $r) { if ((string)($r['id'] ?? '') === $link) { $found = true; break; } }
            if (!$found) respond(['ok' => false, 'error' => 'No staff record with that ID was found.'], 400);
            $stmt = $pdo->prepare('SELECT id FROM staff_accounts WHERE linked_id = ? AND id != ? AND role_key NOT IN (\'student\', \'parent\')');
            $stmt->execute([$link, $id]);
            if ($stmt->fetch()) respond(['ok' => false, 'error' => 'Another login is already linked to that staff record.'], 409);
        }
        $fields[] = 'linked_id = ?';  $params[] = $link !== '' ? $link : null;
        $changes[] = 'linked record';
    }

    if (array_key_exists('role_key', $b)) {
        $rk = trim((string)$b['role_key']);
        if ($rk === 'super_admin') respond(['ok' => false, 'error' => 'Grant Super Administrator with the admin toggle instead.'], 400);
        if (!roleExists($pdo, $rk)) respond(['ok' => false, 'error' => 'Unknown role.'], 400);
        if (toBool($target['is_admin']) && !array_key_exists('is_admin', $b)) {
            respond(['ok' => false, 'error' => 'This account is a Super Administrator — remove admin access first to give it a different role.'], 400);
        }
        $fields[] = 'role_key = ?';  $params[] = $rk;
        $changes[] = 'access role → ' . $rk;
    }

    if (array_key_exists('is_admin', $b)) {
        if (!$me['is_admin']) respond(['ok' => false, 'error' => 'Only a Super Administrator can change admin access.'], 403);
        $newIsAdmin = (bool)$b['is_admin'];
        // Never allow the last remaining administrator to be demoted.
        if (!$newIsAdmin && toBool($target['is_admin']) && countAdmins($pdo) <= 1) {
            respond(['ok' => false, 'error' => 'At least one administrator is required — promote someone else first.'], 400);
        }
        $fields[] = 'is_admin = ?';  $params[] = $newIsAdmin ? 'true' : 'false';
        if ($newIsAdmin) {
            $fields[] = 'role_key = ?';  $params[] = 'super_admin';
        } elseif ($target['role_key'] === 'super_admin' && !array_key_exists('role_key', $b)) {
            $fields[] = 'role_key = ?';  $params[] = 'staff';
        }
        $changes[] = $newIsAdmin ? 'granted Super Administrator' : 'removed Super Administrator';
    }

    if (!$fields) respond(['ok' => false, 'error' => 'Nothing to update.'], 400);

    $params[] = $id;
    $pdo->prepare('UPDATE staff_accounts SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($params);
    audit($pdo, $me, 'update', 'users', $id, 'Changed account ' . $target['name'] . ': ' . implode('; ', $changes), null);
    respond(['ok' => true]);
}

function resetPassword(): void {
    global $pdo;
    $me = requirePerm($pdo, 'users.manage');
    $b  = input();
    $id       = trim((string)($b['id'] ?? ''));
    $newPw    = (string)($b['new_password'] ?? '');
    // Admin decides, via a checkbox in the UI, whether the account must set
    // its own password immediately after signing in with the one just issued.
    $forceChange = !empty($b['force_change']);

    $stmt = $pdo->prepare('SELECT id, name, email FROM staff_accounts WHERE id = ?');
    $stmt->execute([$id]);
    $t = $stmt->fetch();
    if (!$t) respond(['ok' => false, 'error' => 'User not found.'], 404);

    if ($newPw === '') respond(['ok' => false, 'error' => 'Enter the new password to issue.'], 400);
    if ($problem = passwordProblem($newPw)) respond(['ok' => false, 'error' => $problem], 400);

    $otp = randomOtp();
    $pdo->prepare(
        'UPDATE staff_accounts
            SET password_hash = ?, must_change_password = ?,
                reset_otp_hash = ?, reset_otp_expires_at = now() + (? || \' minutes\')::interval
          WHERE id = ?'
    )->execute([
        password_hash($newPw, PASSWORD_DEFAULT),
        $forceChange ? 'true' : 'false',
        hash('sha256', $otp),
        RESET_OTP_TTL_MINUTES,
        $id,
    ]);

    securityEvent($pdo, 'password_reset', $id, $t['email'], 'reset by ' . $me['name']);
    audit($pdo, $me, 'update', 'users', $id, 'Password reset for ' . $t['name'] . ($forceChange ? ' (must change on next login)' : ''), null);

    // Nothing is e-mailed: the administrator passes the temporary password and the one-time code to the user in person.
    $out = ['ok' => true, 'temp_password' => $newPw, 'otp' => $otp];
    respond($out);
}

function deleteUser(): void {
    global $pdo;
    $me = requirePerm($pdo, 'users.manage');
    $b  = input();
    $id = trim((string)($b['id'] ?? ''));
    if ($id === '') respond(['ok' => false, 'error' => 'Missing user id.'], 400);
    if ($id === $me['id']) respond(['ok' => false, 'error' => 'You cannot delete your own account while logged in.'], 400);

    $stmt = $pdo->prepare('SELECT id, name, is_admin FROM staff_accounts WHERE id = ?');
    $stmt->execute([$id]);
    $target = $stmt->fetch();
    if (!$target) respond(['ok' => false, 'error' => 'User not found.'], 404);
    if (toBool($target['is_admin']) && countAdmins($pdo) <= 1) {
        respond(['ok' => false, 'error' => 'At least one administrator is required — promote someone else before removing this account.'], 400);
    }
    $pdo->prepare('DELETE FROM staff_accounts WHERE id = ?')->execute([$id]);
    audit($pdo, $me, 'delete', 'users', $id, 'Account deleted: ' . $target['name'], null);
    respond(['ok' => true]);
}

function rolesList(): void {
    global $pdo;
    $u = requireUser($pdo);
    if (!userCanAny($u, ['users.manage', 'roles.manage'])) respond(['ok' => false, 'error' => 'Administrator access required.'], 403);
    $rows = $pdo->query('SELECT role_key, label, description, permissions::text AS permissions, is_system FROM roles ORDER BY is_system DESC, label ASC')->fetchAll();
    foreach ($rows as &$r) {
        $r['permissions'] = json_decode($r['permissions'], true) ?: [];
        $r['is_system']   = toBool($r['is_system']);
    }
    unset($r);
    respond(['ok' => true, 'roles' => $rows, 'catalogue' => permissionCatalogue(), 'admin_only' => ADMIN_ONLY_PERMS]);
}

function roleSave(): void {
    global $pdo;
    $me    = requirePerm($pdo, 'roles.manage');
    $b     = input();
    $key   = trim((string)($b['role_key'] ?? ''));
    $label = trim((string)($b['label'] ?? ''));
    $desc  = trim((string)($b['description'] ?? ''));
    $perms = is_array($b['permissions'] ?? null) ? $b['permissions'] : [];
    if ($label === '' || mb_strlen($label) > 80) respond(['ok' => false, 'error' => 'Give the role a name (up to 80 characters).'], 400);

    $valid = allPermissionKeys();
    $clean = [];
    foreach ($perms as $p) {
        if (is_string($p) && in_array($p, $valid, true) && !in_array($p, ADMIN_ONLY_PERMS, true)) $clean[] = $p;
    }
    $clean = array_values(array_unique($clean));

    if ($key === 'super_admin') respond(['ok' => false, 'error' => 'The Super Administrator role cannot be edited.'], 400);

    if ($key !== '' && roleExists($pdo, $key)) {
        $pdo->prepare('UPDATE roles SET label = ?, description = ?, permissions = CAST(? AS jsonb) WHERE role_key = ?')
            ->execute([$label, $desc, json_encode($clean), $key]);
        audit($pdo, $me, 'update', 'roles', $key, 'Updated role ' . $label . ' (' . count($clean) . ' permissions)', ['permissions' => $clean]);
        respond(['ok' => true, 'role_key' => $key]);
    }

    $slug = trim((string)preg_replace('/[^a-z0-9]+/', '_', strtolower($label)), '_');
    $slug = substr($slug !== '' ? $slug : 'role', 0, 30);
    $key  = $slug;
    $n    = 2;
    while (roleExists($pdo, $key)) { $key = $slug . '_' . $n++; }
    $pdo->prepare('INSERT INTO roles (role_key, label, description, permissions, is_system) VALUES (?, ?, ?, CAST(? AS jsonb), false)')
        ->execute([$key, $label, $desc, json_encode($clean)]);
    audit($pdo, $me, 'create', 'roles', $key, 'Created role ' . $label, ['permissions' => $clean]);
    respond(['ok' => true, 'role_key' => $key]);
}

function roleDelete(): void {
    global $pdo;
    $me  = requirePerm($pdo, 'roles.manage');
    $b   = input();
    $key = trim((string)($b['role_key'] ?? ''));
    $stmt = $pdo->prepare('SELECT label, is_system FROM roles WHERE role_key = ?');
    $stmt->execute([$key]);
    $r = $stmt->fetch();
    if (!$r) respond(['ok' => false, 'error' => 'Role not found.'], 404);
    if (toBool($r['is_system'])) respond(['ok' => false, 'error' => 'Built-in roles cannot be deleted (you can edit their permissions instead).'], 400);
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM staff_accounts WHERE role_key = ?');
    $stmt->execute([$key]);
    if ((int)$stmt->fetchColumn() > 0) respond(['ok' => false, 'error' => 'Some accounts still use this role. Move them to another role first.'], 400);
    $pdo->prepare('DELETE FROM roles WHERE role_key = ?')->execute([$key]);
    audit($pdo, $me, 'delete', 'roles', $key, 'Deleted role ' . $r['label'], null);
    respond(['ok' => true]);
}

