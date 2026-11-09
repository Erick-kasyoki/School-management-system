<?php
// api/handlers/auth.php — signup, login/logout, session bootstrap, change password, TOTP 2FA.
// Included by api/index.php; relies on config.php and data.php already being loaded.

function startSession(string $userId): void {
    session_regenerate_id(true);
    $_SESSION['user_id']   = $userId;
    $_SESSION['last_seen'] = time();
    $_SESSION['started_at'] = time();   // absolute session limit (SESSION_ABSOLUTE_SECONDS in config.php)
}

function signup(): void {
    global $pdo;
    $b     = input();
    $name  = trim((string)($b['name'] ?? ''));
    $role  = trim((string)($b['role'] ?? ''));
    $email = strtolower(trim((string)($b['email'] ?? '')));
    $pw    = (string)($b['password'] ?? '');

    if ($name === '' || $role === '' || $email === '' || $pw === '') {
        respond(['ok' => false, 'error' => 'Fill in all fields to continue.'], 400);
    }
    if (mb_strlen($name) > 150 || mb_strlen($role) > 80) {
        respond(['ok' => false, 'error' => 'Name or role is too long.'], 400);
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(['ok' => false, 'error' => 'Enter a valid email address.'], 400);
    }
    if ($problem = passwordProblem($pw)) {
        respond(['ok' => false, 'error' => $problem], 400);
    }

    $userCount = (int)$pdo->query('SELECT COUNT(*) FROM staff_accounts')->fetchColumn();
    if ($userCount > 0 && !ALLOW_SELF_SIGNUP) {
        respond(['ok' => false, 'error' => 'Self sign-up is switched off. Ask an administrator to create your account.'], 403);
    }

    $stmt = $pdo->prepare('SELECT id FROM staff_accounts WHERE email = ?');
    $stmt->execute([$email]);
    if ($stmt->fetch()) {
        respond(['ok' => false, 'error' => 'An account with that email already exists — log in instead.'], 409);
    }

    // The very first account ever created becomes the Super Administrator.
    // Everyone after that starts with the least-privilege "staff" role; the
    // Role field they choose is only a job-title label until an administrator
    // assigns real permissions from User Management.
    $isAdmin = $userCount === 0;
    $id      = uid('usr');
    $hash    = password_hash($pw, PASSWORD_DEFAULT);
    $stmt = $pdo->prepare('INSERT INTO staff_accounts (id, name, role, email, password_hash, is_admin, role_key, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, now())');
    $stmt->execute([$id, $name, $role, $email, $hash, $isAdmin ? 'true' : 'false', $isAdmin ? 'super_admin' : 'staff']);

    startSession($id);
    touchActiveSession($pdo, $id);
    securityEvent($pdo, 'signup', $id, $email, $isAdmin ? 'first account — Super Administrator' : 'self sign-up');
    $u = currentUser($pdo);
    audit($pdo, $u, 'create', 'users', $id, 'Account created: ' . $name . ($isAdmin ? ' (Super Administrator)' : ''), null);
    respond(['ok' => true, 'user' => publicUser($u)]);
}

/**
 * Student self-signup. Nobody can create a student login unless the name and
 * admission number they enter match an existing student record — "in the
 * school system" is checked here, on the server, not assumed from the form.
 */
function signupStudent(): void {
    global $pdo;
    $b     = input();
    $name  = trim((string)($b['name'] ?? ''));
    $adm   = trim((string)($b['adm_no'] ?? ''));
    $email = strtolower(trim((string)($b['email'] ?? '')));
    $pw    = (string)($b['password'] ?? '');
    // Finishing a social sign-in: the e-mail was verified by the provider, so it comes from the
    // server-side session (never from the form) and the account gets a random password
    // (the person can set their own any time with "Forgot Password").
    $social = false;
    if (!empty($b['social'])) {
        $sp = socialPendingGet('student');
        if (!$sp) respond(['ok' => false, 'error' => 'Your social sign-in expired. Press the social button again.'], 400);
        $email = $sp['email']; $pw = randomPassword(); $social = true;
    }

    if ($name === '' || $adm === '' || $email === '' || $pw === '') {
        respond(['ok' => false, 'error' => 'Fill in all fields to continue.'], 400);
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) respond(['ok' => false, 'error' => 'Enter a valid email address.'], 400);
    if ($problem = passwordProblem($pw)) respond(['ok' => false, 'error' => $problem], 400);

    $stmt = $pdo->prepare('SELECT id FROM staff_accounts WHERE email = ?');
    $stmt->execute([$email]);
    if ($stmt->fetch()) respond(['ok' => false, 'error' => 'An account with that email already exists — log in instead.'], 409);

    $match = null;
    foreach (loadAssoc($pdo, 'em_students', []) as $s) {
        if (strcasecmp(trim((string)($s['admNo'] ?? '')), $adm) === 0
            && strcasecmp(trim((string)($s['name'] ?? '')), $name) === 0) { $match = $s; break; }
    }
    if (!$match) {
        securityEvent($pdo, 'signup_blocked', null, $email, 'student self-signup: no matching admission record (' . $adm . ')');
        respond(['ok' => false, 'error' => 'We could not match that name and admission number to a student record. Check them and try again, or ask the school office to confirm your admission number.'], 403);
    }
    $sid  = (string)$match['id'];
    $stmt = $pdo->prepare('SELECT id FROM staff_accounts WHERE role_key = ? AND linked_id = ?');
    $stmt->execute(['student', $sid]);
    if ($stmt->fetch()) respond(['ok' => false, 'error' => 'An account already exists for this student. Log in instead, or contact the school office if you cannot access it.'], 409);

    if ($social) unset($_SESSION['social_pending']);
    $id   = uid('usr');
    $hash = password_hash($pw, PASSWORD_DEFAULT);
    $stmt = $pdo->prepare('INSERT INTO staff_accounts (id, name, role, email, password_hash, is_admin, role_key, linked_id, last_login_at) VALUES (?, ?, ?, ?, ?, false, ?, ?, now())');
    $stmt->execute([$id, $match['name'] ?: $name, 'Student', $email, $hash, 'student', $sid]);

    startSession($id);
    touchActiveSession($pdo, $id);
    securityEvent($pdo, 'signup', $id, $email, 'student self-signup, linked to ' . $sid);
    $u = currentUser($pdo);
    audit($pdo, $u, 'create', 'users', $id, 'Student portal account self-created: ' . $match['name'], null);
    respond(['ok' => true, 'user' => publicUser($u)]);
}

/**
 * Parent/guardian self-signup. Verified against the name + phone number the
 * school office already has on file in em_parents — same "must already be in
 * the system" rule as students, just checked against the guardian record.
 */
function signupParent(): void {
    global $pdo;
    $b     = input();
    $name  = trim((string)($b['name'] ?? ''));
    $phone = trim((string)($b['phone'] ?? ''));
    $email = strtolower(trim((string)($b['email'] ?? '')));
    $pw    = (string)($b['password'] ?? '');
    // Finishing a social sign-in: the e-mail was verified by the provider, so it comes from the
    // server-side session (never from the form) and the account gets a random password
    // (the person can set their own any time with "Forgot Password").
    $social = false;
    if (!empty($b['social'])) {
        $sp = socialPendingGet('parent');
        if (!$sp) respond(['ok' => false, 'error' => 'Your social sign-in expired. Press the social button again.'], 400);
        $email = $sp['email']; $pw = randomPassword(); $social = true;
    }

    if ($name === '' || $phone === '' || $email === '' || $pw === '') {
        respond(['ok' => false, 'error' => 'Fill in all fields to continue.'], 400);
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) respond(['ok' => false, 'error' => 'Enter a valid email address.'], 400);
    if ($problem = passwordProblem($pw)) respond(['ok' => false, 'error' => $problem], 400);

    $stmt = $pdo->prepare('SELECT id FROM staff_accounts WHERE email = ?');
    $stmt->execute([$email]);
    if ($stmt->fetch()) respond(['ok' => false, 'error' => 'An account with that email already exists — log in instead.'], 409);

    $wantPhone = normalizePhone($phone);
    $match = null;
    foreach (loadAssoc($pdo, 'em_parents', []) as $p) {
        if ($wantPhone !== '' && normalizePhone((string)($p['phone'] ?? '')) === $wantPhone
            && strcasecmp(trim((string)($p['name'] ?? '')), $name) === 0) { $match = $p; break; }
    }
    if (!$match) {
        securityEvent($pdo, 'signup_blocked', null, $email, 'parent self-signup: no matching guardian record');
        respond(['ok' => false, 'error' => 'We could not match that name and phone number to a parent/guardian record on file. Check them and try again, or ask the school office to confirm the details they have for you.'], 403);
    }
    $pid  = (string)$match['id'];
    $stmt = $pdo->prepare('SELECT id FROM staff_accounts WHERE role_key = ? AND linked_id = ?');
    $stmt->execute(['parent', $pid]);
    if ($stmt->fetch()) respond(['ok' => false, 'error' => 'An account already exists for this parent/guardian record. Log in instead, or contact the school office if you cannot access it.'], 409);

    if ($social) unset($_SESSION['social_pending']);
    $id   = uid('usr');
    $hash = password_hash($pw, PASSWORD_DEFAULT);
    $stmt = $pdo->prepare('INSERT INTO staff_accounts (id, name, role, email, password_hash, is_admin, role_key, linked_id, last_login_at) VALUES (?, ?, ?, ?, ?, false, ?, ?, now())');
    $stmt->execute([$id, $match['name'] ?: $name, 'Parent', $email, $hash, 'parent', $pid]);

    startSession($id);
    touchActiveSession($pdo, $id);
    securityEvent($pdo, 'signup', $id, $email, 'parent self-signup, linked to ' . $pid);
    $u = currentUser($pdo);
    audit($pdo, $u, 'create', 'users', $id, 'Parent portal account self-created: ' . $match['name'], null);
    respond(['ok' => true, 'user' => publicUser($u)]);
}

function login(): void {
    global $pdo;
    $b      = input();
    $email  = strtolower(trim((string)($b['email'] ?? '')));
    $pw     = (string)($b['password'] ?? '');
    $code   = trim((string)($b['code'] ?? ''));
    $portal = trim((string)($b['portal'] ?? ''));

    $stmt = $pdo->prepare("SELECT COUNT(*) FROM security_events WHERE type = 'login_failed' AND at > now() - interval '15 minutes' AND (email = ? OR ip = ?)");
    $stmt->execute([$email, clientIp()]);
    if ((int)$stmt->fetchColumn() >= MAX_LOGIN_FAILURES) {
        securityEvent($pdo, 'login_blocked', null, $email, 'too many failed attempts');
        respond(['ok' => false, 'error' => 'Too many failed attempts. Wait 15 minutes and try again.'], 429);
    }

    $stmt = $pdo->prepare('SELECT * FROM staff_accounts WHERE email = ?');
    $stmt->execute([$email]);
    $row = $stmt->fetch();

    if (!$row || !password_verify($pw, $row['password_hash'])) {
        securityEvent($pdo, 'login_failed', $row['id'] ?? null, $email, 'wrong email or password');
        respond(['ok' => false, 'error' => 'Incorrect email or password.'], 401);
    }

    if (!toBool($row['is_active'])) {
        securityEvent($pdo, 'login_blocked', $row['id'], $email, 'account deactivated');
        respond(['ok' => false, 'error' => 'This account has been deactivated. Contact an administrator.'], 403);
    }
    if (!empty($row['access_expires_at']) && strtotime($row['access_expires_at']) <= time()) {
        securityEvent($pdo, 'login_blocked', $row['id'], $email, 'access expired');
        respond(['ok' => false, 'error' => 'Access to this account has expired. Contact an administrator.'], 403);
    }

    // Portal separation: a parent account can only sign in on the parent portal, a student
    // account only on the student portal, and every staff/admin role only on the staff
    // portal — never the other way round, even with the correct email and password.
    $kind = accountKind((string)$row['role_key']);
    if ($portal !== '' && $portal !== $kind) {
        securityEvent($pdo, 'login_blocked', $row['id'], $email, 'wrong portal: tried "' . $portal . '", account is "' . $kind . '"');
        respond(['ok' => false, 'error' => 'This account is registered as ' . accountKindLabel($kind) . '. Please sign in from the ' . accountKindLabel($kind) . ' portal instead.', 'portal' => $kind], 403);
    }

    // An admin-issued password reset carries a one-time code sent to the
    // account's e-mail alongside the new password; it must be entered once,
    // here, before the account can be used again — proof the person signing
    // in is the one who actually received that e-mail.
    if (!empty($row['reset_otp_hash'])) {
        $otpExpired = empty($row['reset_otp_expires_at']) || strtotime($row['reset_otp_expires_at']) <= time();
        if ($otpExpired) {
            $pdo->prepare('UPDATE staff_accounts SET reset_otp_hash = NULL, reset_otp_expires_at = NULL WHERE id = ?')->execute([$row['id']]);
        } else {
            if ($code === '') {
                respond(['ok' => false, 'needs_otp' => true, 'error' => 'Enter the one-time code that was e-mailed with your new password.'], 401);
            }
            if (!hash_equals((string)$row['reset_otp_hash'], hash('sha256', preg_replace('/\D/', '', $code)))) {
                securityEvent($pdo, 'login_failed', $row['id'], $email, 'wrong password-reset OTP');
                respond(['ok' => false, 'needs_otp' => true, 'error' => 'That code is not valid. Check the e-mail and try again.'], 401);
            }
            $pdo->prepare('UPDATE staff_accounts SET reset_otp_hash = NULL, reset_otp_expires_at = NULL WHERE id = ?')->execute([$row['id']]);
            // The OTP field just consumed the reset code, not a 2FA code — if
            // this account also has authenticator 2FA on, ask for that fresh
            // on a follow-up submit rather than reusing this code for it.
            $code = '';
        }
    }

    if (toBool($row['totp_enabled'])) {
        if ($code === '') {
            respond(['ok' => false, 'needs_2fa' => true, 'error' => 'Enter the 6-digit code from your authenticator app.'], 401);
        }
        if (!verifyTotp((string)$row['totp_secret'], $code)) {
            securityEvent($pdo, 'login_failed', $row['id'], $email, 'wrong 2FA code');
            respond(['ok' => false, 'needs_2fa' => true, 'error' => 'That code is not valid. Try the current code.'], 401);
        }
    }

    startSession($row['id']);
    $pdo->prepare('UPDATE staff_accounts SET last_login_at = now() WHERE id = ?')->execute([$row['id']]);
    touchActiveSession($pdo, $row['id']);
    securityEvent($pdo, 'login_ok', $row['id'], $email, '');
    $u = currentUser($pdo);
    audit($pdo, $u, 'login', 'users', $row['id'], $u['name'] . ' signed in', null);
    stampStaffAttendance($pdo, $u);
    respond(['ok' => true, 'user' => publicUser($u)]);
}

/* ------------------------------------------------------------------ */
/* Social sign-in: provider table + the two small JSON actions the     */
/* sign-in page uses. The OAuth redirect/callback itself is in         */
/* api/social.php.                                                     */
/* ------------------------------------------------------------------ */
function socialProviderDefs(): array {
    return [
        'google'   => ['label' => 'Google',   'id' => SOCIAL_GOOGLE_ID,   'secret' => SOCIAL_GOOGLE_SECRET,
                       'auth' => 'https://accounts.google.com/o/oauth2/v2/auth', 'token' => 'https://oauth2.googleapis.com/token',
                       'scope' => 'openid email profile'],
        'facebook' => ['label' => 'Facebook', 'id' => SOCIAL_FACEBOOK_ID, 'secret' => SOCIAL_FACEBOOK_SECRET,
                       'auth' => 'https://www.facebook.com/v19.0/dialog/oauth', 'token' => 'https://graph.facebook.com/v19.0/oauth/access_token',
                       'scope' => 'email,public_profile'],
        'github'   => ['label' => 'GitHub',   'id' => SOCIAL_GITHUB_ID,   'secret' => SOCIAL_GITHUB_SECRET,
                       'auth' => 'https://github.com/login/oauth/authorize', 'token' => 'https://github.com/login/oauth/access_token',
                       'scope' => 'read:user user:email'],
        'linkedin' => ['label' => 'LinkedIn', 'id' => SOCIAL_LINKEDIN_ID, 'secret' => SOCIAL_LINKEDIN_SECRET,
                       'auth' => 'https://www.linkedin.com/oauth/v2/authorization', 'token' => 'https://www.linkedin.com/oauth/v2/accessToken',
                       'scope' => 'openid profile email'],
    ];
}

/** Which providers have both an ID and a secret. Public — it holds no secrets. */
function socialProviders(): void {
    $out = [];
    foreach (socialProviderDefs() as $k => $d) { $out[$k] = ($d['id'] !== '' && $d['secret'] !== ''); }
    respond(['ok' => true, 'providers' => $out]);
}

/** The verified social identity waiting for the person to finish registering (or null). */
function socialPendingGet(string $portal = ''): ?array {
    $p = $_SESSION['social_pending'] ?? null;
    if (!is_array($p) || (int)($p['exp'] ?? 0) < time()) return null;
    if ($portal !== '' && ($p['portal'] ?? '') !== $portal) return null;
    return $p;
}

function socialPending(): void {
    $p = socialPendingGet();
    respond(['ok' => true, 'pending' => $p ? [
        'email' => $p['email'], 'name' => $p['name'], 'provider' => $p['provider_label'], 'portal' => $p['portal'],
    ] : null]);
}

function logout(): void {
    global $pdo;
    $u = currentUser($pdo);
    if ($u) {
        securityEvent($pdo, 'logout', $u['id'], $u['email'], '');
        try { $pdo->prepare('DELETE FROM active_sessions WHERE session_key_hash = ?')->execute([sessionKeyHash()]); }
        catch (PDOException $e) { error_log('EraMaster logout cleanup: ' . $e->getMessage()); }
    }
    $_SESSION = [];
    if (session_id()) { session_destroy(); }
    respond(['ok' => true]);
}

function me(): void {
    global $pdo;
    $u = currentUser($pdo);
    if ($u) {
        // Same-browser sessions are shared across portal.html's three sign-in links
        // (one cookie, one PHP session). Without this check, someone already signed
        // in as staff who then opens ?portal=student would be silently resumed into
        // the full staff app instead of seeing the student sign-in/sign-up screen.
        // We don't touch the real session here — it's still valid on its own portal
        // page — we just refuse to hand it back to a page for the wrong portal.
        $portal = trim((string)($_GET['portal'] ?? ($_POST['portal'] ?? '')));
        if ($portal !== '' && $portal !== accountKind((string)$u['role_key'])) {
            respond(['ok' => true, 'user' => null, 'session_elsewhere' => accountKindLabel(accountKind((string)$u['role_key']))]);
        }
    }
    respond(['ok' => true, 'user' => $u ? publicUser($u) : null]);
}

function changePassword(): void {
    global $pdo;
    $u = requireUser($pdo);
    $b = input();
    $cur = (string)($b['current_password'] ?? '');
    $new = (string)($b['new_password'] ?? '');

    $stmt = $pdo->prepare('SELECT password_hash FROM staff_accounts WHERE id = ?');
    $stmt->execute([$u['id']]);
    $hash = (string)$stmt->fetchColumn();
    if (!password_verify($cur, $hash)) {
        respond(['ok' => false, 'error' => 'Your current password is not correct.'], 400);
    }
    if ($problem = passwordProblem($new)) respond(['ok' => false, 'error' => $problem], 400);
    if ($new === $cur) respond(['ok' => false, 'error' => 'Choose a password different from the current one.'], 400);

    $pdo->prepare('UPDATE staff_accounts SET password_hash = ?, must_change_password = false WHERE id = ?')
        ->execute([password_hash($new, PASSWORD_DEFAULT), $u['id']]);
    securityEvent($pdo, 'password_changed', $u['id'], $u['email'], '');
    respond(['ok' => true]);
}

function totpSetup(): void {
    global $pdo;
    $u = requireUser($pdo);
    if ($u['totp_enabled']) respond(['ok' => false, 'error' => 'Two-factor authentication is already on.'], 400);
    $secret = base32Encode(random_bytes(10));
    $pdo->prepare('UPDATE staff_accounts SET totp_secret = ?, totp_enabled = false WHERE id = ?')->execute([$secret, $u['id']]);
    $uri = 'otpauth://totp/' . rawurlencode('EraMaster:' . $u['email']) . '?secret=' . $secret . '&issuer=EraMaster';
    respond(['ok' => true, 'secret' => $secret, 'uri' => $uri]);
}

function totpEnable(): void {
    global $pdo;
    $u = requireUser($pdo);
    $b = input();
    $stmt = $pdo->prepare('SELECT totp_secret FROM staff_accounts WHERE id = ?');
    $stmt->execute([$u['id']]);
    $secret = (string)$stmt->fetchColumn();
    if ($secret === '' || !verifyTotp($secret, (string)($b['code'] ?? ''))) {
        respond(['ok' => false, 'error' => 'That code is not valid. Check the time on your phone and try again.'], 400);
    }
    $pdo->prepare('UPDATE staff_accounts SET totp_enabled = true WHERE id = ?')->execute([$u['id']]);
    securityEvent($pdo, '2fa_enabled', $u['id'], $u['email'], '');
    respond(['ok' => true]);
}

function totpDisable(): void {
    global $pdo;
    $u = requireUser($pdo);
    $b = input();
    $stmt = $pdo->prepare('SELECT password_hash FROM staff_accounts WHERE id = ?');
    $stmt->execute([$u['id']]);
    if (!password_verify((string)($b['password'] ?? ''), (string)$stmt->fetchColumn())) {
        respond(['ok' => false, 'error' => 'Your password is not correct.'], 400);
    }
    $pdo->prepare('UPDATE staff_accounts SET totp_enabled = false, totp_secret = NULL WHERE id = ?')->execute([$u['id']]);
    securityEvent($pdo, '2fa_disabled', $u['id'], $u['email'], '');
    respond(['ok' => true]);
}


/* ---------------- automatic staff attendance ----------------
 * The working day runs 08:00–17:00. Signing in marks the staff member present
 * for today with the time they signed in; anything already recorded by hand for
 * that day is left exactly as it is. */
const STAFF_DAY_START = '08:00';
const STAFF_DAY_END   = '17:00';

function stampStaffAttendance(PDO $pdo, ?array $u): void {
    if (!$u) return;
    try {
        $email  = strtolower(trim((string)($u['email'] ?? '')));
        $linked = (string)($u['linked_id'] ?? '');
        $teachers = loadAssoc($pdo, 'em_teachers', []);
        $teacherId = '';
        foreach ($teachers as $t) {
            if (!is_array($t)) continue;
            $tid = (string)($t['id'] ?? '');
            if ($linked !== '' && $tid === $linked) { $teacherId = $tid; break; }
            if ($email !== '' && strtolower(trim((string)($t['email'] ?? ''))) === $email) { $teacherId = $tid; break; }
        }
        if ($teacherId === '') return;  // not a staff record — nothing to mark

        $date = date('Y-m-d');
        $now  = date('H:i');
        $all  = loadAssoc($pdo, 'em_staff_attendance', []);
        $day  = isset($all[$date]) && is_array($all[$date]) ? $all[$date] : [];
        if (isset($day[$teacherId]) && is_array($day[$teacherId]) && ($day[$teacherId]['in'] ?? '') !== '') return;

        $late = $now > STAFF_DAY_START;
        $day[$teacherId] = [
            's'  => 'P',
            'n'  => $late ? ('Signed in at ' . $now) : 'Signed in on time',
            'in' => $now < STAFF_DAY_START ? STAFF_DAY_START : $now,
            'out' => $day[$teacherId]['out'] ?? '',
        ];
        $all[$date] = $day;
        storeKey($pdo, 'em_staff_attendance', json_encode($all));
    } catch (Throwable $e) {
        // Attendance marking must never stop somebody signing in.
        error_log('EraMaster staff attendance stamp: ' . $e->getMessage());
    }
}

/** Public school name & motto, so the sign-in page and portal show what was
 *  saved in School Settings. No account needed; nothing sensitive is returned. */
function schoolProfile(): void {
    global $pdo;
    $name = 'Greenhill Academy';
    $motto = '';
    $theme = null;
    $logo = null;
    try {
        $logo = schoolLogoUrl($pdo);
        $s = loadAssoc($pdo, 'em_settings', []);
        $p = is_array($s['profile'] ?? null) ? $s['profile'] : [];
        if (trim((string)($p['name'] ?? '')) !== '')  $name  = trim((string)$p['name']);
        if (trim((string)($p['motto'] ?? '')) !== '') $motto = trim((string)$p['motto']);
        // Saved colour theme (Settings → Theme customization). Only a validated hex colour and a
        // plain id are ever returned, so nothing else from settings leaks through this public call.
        $t = is_array($s['theme'] ?? null) ? $s['theme'] : null;
        if ($t && preg_match('/^#[0-9a-fA-F]{6}$/', (string)($t['color'] ?? ''))) {
            $theme = ['id' => preg_replace('/[^a-z0-9_-]/i', '', (string)($t['id'] ?? 'custom')) ?: 'custom', 'color' => strtolower((string)$t['color'])];
        }
    } catch (Throwable $e) {
        error_log('EraMaster school profile: ' . $e->getMessage());
    }
    respond(['ok' => true, 'name' => $name, 'motto' => $motto, 'theme' => $theme, 'logo' => $logo]);
}
