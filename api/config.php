<?php
// api/config.php — database connection + shared helpers
// EDIT the four DB_* values below to match your PostgreSQL setup.

// Every response from this API must be pure JSON. XAMPP's default PHP
// settings print warnings/notices/deprecation messages directly into the
// response body, which breaks JSON parsing on the frontend. Log errors
// instead of displaying them; check your PHP error log (XAMPP:
// apache/logs/error.log) if something isn't working.
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');


/* ---------------- private settings (passwords & keys live OUTSIDE the web folder) ----------------
   Database password, e-mail password and social-login secrets are NOT stored in this file any more.
   Put them in  <XAMPP folder>/eramaster-private/config.php  (e.g. C:\\xampp\\eramaster-private\\config.php)
   — a folder the web server never serves — or point the ERAMASTER_CONFIG environment variable at a file.
   A ready-to-fill template is in server-setup/eramaster-private/config.php. Anything defined there wins
   over the defaults below. */
(function () {
    $candidates = array_filter([
        (string)getenv('ERAMASTER_CONFIG'),
        dirname(__DIR__, 3) . '/eramaster-private/config.php',
    ]);
    foreach ($candidates as $f) {
        if (is_file($f) && is_readable($f)) { require $f; return; }
    }
})();

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

/* ---------------- app settings ---------------- */
// true  = unexpected server errors include their message in the JSON (handy while setting up).
// false = show a generic message (recommended in production; details stay in the PHP error log).
defined('APP_DEBUG') || define('APP_DEBUG', false);
// true  = anyone who can open the page may create a least-privilege "Staff" account.
// false = only an administrator can create staff accounts (User Management > Add user).
// The very first account (the Super Administrator) can always be created either way.
// Students and parents never use this flag — they self-verify against their own
// admission/guardian record via signup_student / signup_parent instead (see index.php).
defined('ALLOW_SELF_SIGNUP') || define('ALLOW_SELF_SIGNUP', false);
defined('SESSION_IDLE_SECONDS') || define('SESSION_IDLE_SECONDS', 7200);   // log out after 2 hours of inactivity
defined('MAX_LOGIN_FAILURES') || define('MAX_LOGIN_FAILURES', 5);        // failed logins allowed per 15 minutes (per email or per IP)
defined('SESSION_ABSOLUTE_SECONDS') || define('SESSION_ABSOLUTE_SECONDS', 43200); // hard stop: sign in again after 12 hours, however active
defined('BEHIND_HTTPS_PROXY') || define('BEHIND_HTTPS_PROXY', false);   // true only if a trusted reverse proxy terminates HTTPS and sets X-Forwarded-Proto

defined('RESET_OTP_TTL_MINUTES') || define('RESET_OTP_TTL_MINUTES', 30); // how long an admin-issued reset OTP stays valid

/* ---------------- social sign-in (Google / Facebook / GitHub / LinkedIn) ---------------- */
// Students and parents can log in, or create their account, with one of these.
// A provider's button only works once BOTH its ID and SECRET are filled in here.
// Leave blank to keep that provider switched off. Step-by-step: CHANGES-social-login.md
//
// In every provider's developer console, register this ONE redirect URL:
//     <your site>/api/social.php        e.g. https://school.example.com/api/social.php
//                                       or   http://localhost/helmers/api/social.php
// (SOCIAL_REDIRECT_URI below overrides the automatic guess — set it if you are behind a proxy.)
defined('SOCIAL_GOOGLE_ID') || define('SOCIAL_GOOGLE_ID', '');
defined('SOCIAL_GOOGLE_SECRET') || define('SOCIAL_GOOGLE_SECRET', '');
defined('SOCIAL_FACEBOOK_ID') || define('SOCIAL_FACEBOOK_ID', '');
defined('SOCIAL_FACEBOOK_SECRET') || define('SOCIAL_FACEBOOK_SECRET', '');
defined('SOCIAL_GITHUB_ID') || define('SOCIAL_GITHUB_ID', '');
defined('SOCIAL_GITHUB_SECRET') || define('SOCIAL_GITHUB_SECRET', '');
defined('SOCIAL_LINKEDIN_ID') || define('SOCIAL_LINKEDIN_ID', '');
defined('SOCIAL_LINKEDIN_SECRET') || define('SOCIAL_LINKEDIN_SECRET', '');
defined('SOCIAL_REDIRECT_URI') || define('SOCIAL_REDIRECT_URI', '');
// XAMPP on Windows often has no CA bundle, which makes the HTTPS calls to the providers fail
// ("SSL certificate problem"). Best fix: set curl.cainfo in php.ini. Quick local-only fix: false.
defined('SOCIAL_VERIFY_SSL') || define('SOCIAL_VERIFY_SSL', true);


require __DIR__ . '/rbac.php';

/* ---------------- sessions (hardened) ---------------- */
/** True when the request reached Apache through a tunnel / reverse proxy on this same computer (ngrok, cloudflared, nginx...). */
function isProxiedRequest(): bool {
    return !empty($_SERVER['HTTP_X_FORWARDED_FOR']) || !empty($_SERVER['HTTP_X_FORWARDED_HOST']) || !empty($_SERVER['HTTP_FORWARDED']);
}
// A proxy running on this machine (ngrok) is trusted to say whether the visitor used HTTPS.
$viaLocalProxy = in_array((string)($_SERVER['REMOTE_ADDR'] ?? ''), ['127.0.0.1', '::1'], true);
$isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ((BEHIND_HTTPS_PROXY || $viaLocalProxy) && strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https');
ini_set('session.use_strict_mode', '1');          // refuse session ids the server did not create (stops fixation)
ini_set('session.use_only_cookies', '1');         // never accept a session id from the URL
ini_set('session.use_trans_sid', '0');            // never put it in links
ini_set('session.cookie_httponly', '1');          // JavaScript cannot read the cookie
ini_set('session.cookie_secure', $isHttps ? '1' : '0');   // HTTPS only once the site is on HTTPS
ini_set('session.cookie_samesite', 'Lax');        // Lax (not Strict) so the social sign-in redirect still works
ini_set('session.gc_maxlifetime', (string)SESSION_IDLE_SECONDS);
if (PHP_VERSION_ID < 80400) {                     // longer, unguessable ids (these two settings are deprecated from PHP 8.4)
    ini_set('session.sid_length', '48');
    ini_set('session.sid_bits_per_character', '6');
}
session_name('ERAMASTERSESSID');                  // not the default PHPSESSID
session_set_cookie_params([
    'lifetime' => 0,                              // browser-session cookie
    'path'     => '/',
    'secure'   => $isHttps,
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();
if (!empty($_SESSION['user_id'])) {
    $now = time();
    $expired = (isset($_SESSION['last_seen']) && ($now - (int)$_SESSION['last_seen']) > SESSION_IDLE_SECONDS)
            || (isset($_SESSION['started_at']) && ($now - (int)$_SESSION['started_at']) > SESSION_ABSOLUTE_SECONDS);
    if ($expired) {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $cp = session_get_cookie_params();
            setcookie(session_name(), '', ['expires' => $now - 3600, 'path' => $cp['path'], 'secure' => $cp['secure'], 'httponly' => true, 'samesite' => 'Lax']);
        }
        session_destroy();
        session_start();
    } else {
        $_SESSION['last_seen'] = $now;
        if (!isset($_SESSION['started_at'])) $_SESSION['started_at'] = $now;
    }
}

/** SHA-256 of the PHP session id — the key the active_sessions table stores (never the raw id). */
function sessionKeyHash(): string {
    return hash('sha256', session_id());
}

/** Inserts/refreshes this browser's row in active_sessions. Called once per request once logged in. */
function touchActiveSession(PDO $pdo, string $userId): void {
    try {
        $stmt = $pdo->prepare(
            'INSERT INTO active_sessions (session_key_hash, user_id, ip_address, user_agent)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (session_key_hash) DO UPDATE SET last_activity_at = now(), ip_address = EXCLUDED.ip_address'
        );
        $stmt->execute([sessionKeyHash(), $userId, clientIp(), mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 250)]);
    } catch (PDOException $e) {
        error_log('EraMaster touchActiveSession: ' . $e->getMessage());
    }
}

/** True if some other request has deleted this session's row (i.e. an admin revoked it remotely). */
function sessionWasRevoked(PDO $pdo): bool {
    try {
        $stmt = $pdo->prepare('SELECT 1 FROM active_sessions WHERE session_key_hash = ?');
        $stmt->execute([sessionKeyHash()]);
        return !$stmt->fetchColumn();
    } catch (PDOException $e) {
        return false; // fail open on a transient DB hiccup rather than locking everyone out
    }
}

/* ---------------- database ---------------- */
defined('DB_HOST') || define('DB_HOST', '127.0.0.1');
defined('DB_PORT') || define('DB_PORT', '5432');
defined('DB_NAME') || define('DB_NAME', 'greenhill_academy');
defined('DB_USER') || define('DB_USER', 'eramaster_app');
defined('DB_PASS') || define('DB_PASS', '352535');   // set in the private config file, never here

set_exception_handler(function ($e) {
    error_log('EraMaster: ' . $e);
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => APP_DEBUG ? ('Server error: ' . $e->getMessage()) : 'Server error — see the PHP error log.']);
    exit;
});

try {
    // connect_timeout: fail fast (5 s) if PostgreSQL is stopped/unreachable instead of hanging every request.
    $pdo = new PDO(
        "pgsql:host=" . DB_HOST . ";port=" . DB_PORT . ";dbname=" . DB_NAME . ";connect_timeout=5",
        DB_USER,
        DB_PASS,
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_TIMEOUT            => 10,
        ]
    );
    // Never let one stuck query or row lock freeze the whole app: give up on a lock after 10 s and on a
    // query after 30 s. (Bulk import actions raise the query limit in api/index.php.)
    $pdo->exec("SET lock_timeout = '10s'");
    $pdo->exec("SET statement_timeout = '30s'");
} catch (PDOException $e) {
    error_log('EraMaster DB connection failed: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => APP_DEBUG ? ('Database connection failed: ' . $e->getMessage()) : 'Database connection failed — check the private config file and the PHP error log.']);
    exit;
}

/* ---------------- request helpers ---------------- */
function rawBody(): string {
    static $raw = null;
    if ($raw === null) { $raw = (string)file_get_contents('php://input'); }
    return $raw;
}

/** JSON body as an associative array. */
function input(): array {
    $d = json_decode(rawBody(), true);
    return is_array($d) ? $d : [];
}

/** JSON body as objects — preserves {} vs [] exactly, so data is stored untouched. */
function inputObject(): stdClass {
    $d = json_decode(rawBody());
    return is_object($d) ? $d : new stdClass();
}

function respond(array $arr, int $code = 200): void {
    http_response_code($code);
    echo json_encode($arr);
    exit;
}

function uid(string $prefix): string {
    return $prefix . '_' . bin2hex(random_bytes(5));
}

// PDO's pgsql driver can return BOOLEAN columns as 't'/'f' strings.
function toBool($v): bool {
    if (is_bool($v)) return $v;
    return $v === 't' || $v === 'true' || $v === true || $v === 1 || $v === '1';
}

function clientIp(): string {
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    // Behind a tunnel on this computer (ngrok) every visitor arrives from 127.0.0.1, which would make the
    // per-IP login lockout hit EVERYONE at once. Use the visitor address the tunnel reports instead.
    if (($ip === '127.0.0.1' || $ip === '::1') && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $first = trim(explode(',', (string)$_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
        if (filter_var($first, FILTER_VALIDATE_IP)) return $first;
    }
    return $ip;
}


/* ---------------- current user & permissions ---------------- */
function currentUser(PDO $pdo): ?array {
    static $cache = [];
    $sid = $_SESSION['user_id'] ?? '';
    if ($sid === '') return null;
    if (array_key_exists($sid, $cache)) return $cache[$sid];

    $stmt = $pdo->prepare(
        'SELECT s.id, s.name, s.role, s.role_key, s.email, s.is_admin, s.linked_id, s.totp_enabled,
                s.must_change_password, s.last_login_at, s.is_active, s.access_expires_at,
                r.label AS role_label, r.permissions AS role_permissions
           FROM staff_accounts s LEFT JOIN roles r ON r.role_key = s.role_key
          WHERE s.id = ?'
    );
    $stmt->execute([$sid]);
    $u = $stmt->fetch();
    if (!$u) {
        $_SESSION = [];
        return null;
    }
    // Deactivated, expired, or remotely-revoked accounts lose access immediately, mid-session.
    $expired = $u['access_expires_at'] !== null && strtotime($u['access_expires_at']) <= time();
    if (!toBool($u['is_active']) || $expired || sessionWasRevoked($pdo)) {
        $_SESSION = [];
        return null;
    }
    touchActiveSession($pdo, $u['id']);
    $u['is_admin']             = toBool($u['is_admin']);
    $u['totp_enabled']         = toBool($u['totp_enabled']);
    $u['must_change_password'] = toBool($u['must_change_password']);
    $u['is_active']            = toBool($u['is_active']);
    $perms = json_decode((string)($u['role_permissions'] ?? '[]'), true);
    $u['permissions'] = $u['is_admin'] ? ['*'] : (is_array($perms) ? $perms : []);
    unset($u['role_permissions']);
    $cache[$sid] = $u;
    return $u;
}

function publicUser(array $u): array {
    return [
        'id' => $u['id'], 'name' => $u['name'], 'role' => $u['role'], 'role_key' => $u['role_key'],
        'role_label' => $u['role_label'] ?? $u['role'], 'email' => $u['email'], 'is_admin' => $u['is_admin'],
        'linked_id' => $u['linked_id'], 'totp_enabled' => $u['totp_enabled'],
        'must_change_password' => $u['must_change_password'], 'permissions' => $u['permissions'],
        'access_expires_at' => $u['access_expires_at'] ?? null,
    ];
}

function userCan(array $u, string $perm): bool {
    return in_array('*', $u['permissions'], true) || in_array($perm, $u['permissions'], true);
}

function userCanAny(array $u, array $perms): bool {
    foreach ($perms as $p) { if (userCan($u, $p)) return true; }
    return false;
}

/**
 * Which "portal" an account belongs to, for login-time separation:
 *   student accounts only ever get 'student', parent accounts only 'parent',
 *   and every other role (Principal, Teacher, Accountant, Administrator, the
 *   Super Administrator, ...) is bucketed as 'staff' — one shared sign-in
 *   page for everyone who works at the school, same as today.
 */
function accountKind(string $roleKey): string {
    if ($roleKey === 'student') return 'student';
    if ($roleKey === 'parent')  return 'parent';
    return 'staff';
}
function accountKindLabel(string $kind): string {
    return $kind === 'student' ? 'Student' : ($kind === 'parent' ? 'Parent' : 'Staff/Administrator');
}
/** Normalises a phone number to digits only, so "0712 345 678" and "+254712345678" can be compared. */
function normalizePhone(string $p): string {
    return preg_replace('/\D+/', '', $p) ?? '';
}

/** Halts with 401 unless logged in; returns the user. */
function requireUser(PDO $pdo): array {
    $u = currentUser($pdo);
    if (!$u) respond(['ok' => false, 'error' => 'Not authenticated'], 401);
    return $u;
}

/** Halts with 403 unless the logged-in user holds the permission. */
function requirePerm(PDO $pdo, string $perm): array {
    $u = requireUser($pdo);
    if (!userCan($u, $perm)) respond(['ok' => false, 'error' => 'You do not have permission to do that (' . $perm . ').'], 403);
    return $u;
}

function requireSuperAdmin(PDO $pdo): array {
    $u = requireUser($pdo);
    if (!$u['is_admin']) respond(['ok' => false, 'error' => 'Super Administrator access required.'], 403);
    return $u;
}

/* ---------------- roles bootstrap ---------------- */
function ensureDefaultRoles(PDO $pdo): void {
    try {
        $n = (int)$pdo->query('SELECT COUNT(*) FROM roles')->fetchColumn();
    } catch (PDOException $e) {
        respond(['ok' => false, 'error' => 'The database is missing the v2 tables. Run schema.sql against your database again (README step 2).'], 500);
    }
    if ($n > 0) return;
    $stmt = $pdo->prepare('INSERT INTO roles (role_key, label, description, permissions, is_system) VALUES (?, ?, ?, CAST(? AS jsonb), true) ON CONFLICT (role_key) DO NOTHING');
    foreach (defaultRoles() as $key => $r) {
        $stmt->execute([$key, $r['label'], $r['description'], json_encode($r['permissions'])]);
    }
}
ensureDefaultRoles($pdo);

/**
 * One-time, additive upgrade of the built-in roles stored in the database. Roles are copied from defaultRoles()
 * only the first time the API ever runs, so a database created by an older version keeps old permission lists
 * (e.g. a Teacher role without marks.enter). This adds the missing permissions ONCE and never removes any, so
 * later edits made in Administration > Roles are respected.
 */
function upgradeBuiltInRoles(PDO $pdo): void {
    $flag = 'sys_roles_upgrade_2026_10';
    try {
        $row = $pdo->prepare('SELECT 1 FROM school_data WHERE key = ?');
        $row->execute([$flag]);
        if ($row->fetchColumn()) return;
        $grants = [
            'marks.enter'  => ['teacher', 'class_teacher', 'hod', 'exam_officer', 'principal', 'deputy_principal'],
            'exams.view'   => ['teacher', 'class_teacher', 'hod', 'staff'],
            'exams.manage' => ['exam_officer', 'academic_director', 'deputy_principal', 'principal', 'administrator'],
        ];
        $get = $pdo->prepare('SELECT permissions::text FROM roles WHERE role_key = ?');
        $set = $pdo->prepare('UPDATE roles SET permissions = CAST(? AS jsonb) WHERE role_key = ?');
        foreach ($grants as $perm => $keys) {
            foreach ($keys as $rk) {
                $get->execute([$rk]);
                $cur = $get->fetchColumn();
                if ($cur === false) continue;
                $list = json_decode((string)$cur, true);
                if (!is_array($list) || in_array('*', $list, true) || in_array($perm, $list, true)) continue;
                $list[] = $perm;
                $set->execute([json_encode(array_values($list)), $rk]);
            }
        }
        $pdo->prepare("INSERT INTO school_data (key, value, version, updated_at) VALUES (?, '{}'::jsonb, 1, now()) ON CONFLICT (key) DO NOTHING")->execute([$flag]);
    } catch (Throwable $e) { /* never block the API over a best-effort upgrade */ }
}
upgradeBuiltInRoles($pdo);

/** One-time: separate the Principal / Headteacher (decides) from the Administrator (processes) on existing databases. */
function upgradePrincipalRole(PDO $pdo): void {
    $flag = 'sys_roles_upgrade_principal_2026_10';
    try {
        $row = $pdo->prepare('SELECT 1 FROM school_data WHERE key = ?'); $row->execute([$flag]);
        if ($row->fetchColumn()) return;
        $g = $pdo->prepare("SELECT permissions::text FROM roles WHERE role_key = 'principal'"); $g->execute();
        $cur = $g->fetchColumn();
        if ($cur !== false) {
            $list = json_decode((string)$cur, true);
            if (is_array($list) && !in_array('*', $list, true)) {
                $list = array_values(array_unique(array_merge(array_diff($list, ['admissions.manage']), ['admissions.decide'])));
                $pdo->prepare("UPDATE roles SET permissions = CAST(? AS jsonb), label = 'Principal / Headteacher', description = ? WHERE role_key = 'principal'")
                    ->execute([json_encode($list), 'Heads the school: sees everything and takes the final decisions (e.g. admits or rejects applicants). Does not run user or role management.']);
            }
        }
        $pdo->prepare("INSERT INTO school_data (key, value, version, updated_at) VALUES (?, '{}'::jsonb, 1, now()) ON CONFLICT (key) DO NOTHING")->execute([$flag]);
    } catch (Throwable $e) { /* best effort */ }
}
upgradePrincipalRole($pdo);

/** One-time: let the built-in Administrator role use the new Data Import screen on existing databases. */
function upgradeImportPerm(PDO $pdo): void {
    $flag = 'sys_roles_upgrade_import_2026_10';
    try {
        $row = $pdo->prepare('SELECT 1 FROM school_data WHERE key = ?'); $row->execute([$flag]);
        if ($row->fetchColumn()) return;
        $g = $pdo->prepare("SELECT permissions::text FROM roles WHERE role_key = 'administrator'"); $g->execute();
        $cur = $g->fetchColumn();
        if ($cur !== false) {
            $list = json_decode((string)$cur, true);
            if (is_array($list) && !in_array('*', $list, true) && !in_array('import.manage', $list, true)) {
                $list[] = 'import.manage';
                $pdo->prepare("UPDATE roles SET permissions = CAST(? AS jsonb) WHERE role_key = 'administrator'")->execute([json_encode(array_values($list))]);
            }
        }
        $pdo->prepare("INSERT INTO school_data (key, value, version, updated_at) VALUES (?, '{}'::jsonb, 1, now()) ON CONFLICT (key) DO NOTHING")->execute([$flag]);
    } catch (Throwable $e) { /* best effort */ }
}
upgradeImportPerm($pdo);

/** One-time: let every staff-type built-in role apply for leave on existing databases (additive only). */
function upgradeLeaveRequestPerm(PDO $pdo): void {
    $flag = 'sys_roles_upgrade_leave_request_2026_10';
    try {
        $row = $pdo->prepare('SELECT 1 FROM school_data WHERE key = ?'); $row->execute([$flag]);
        if ($row->fetchColumn()) return;
        $keys = ['principal', 'deputy_principal', 'academic_director', 'exam_officer', 'hod', 'administrator', 'accountant', 'hr_officer',
                 'teacher', 'class_teacher', 'librarian', 'nurse', 'counsellor', 'transport_officer', 'storekeeper', 'boarding_master',
                 'receptionist', 'staff'];
        $get = $pdo->prepare('SELECT permissions::text FROM roles WHERE role_key = ?');
        $set = $pdo->prepare('UPDATE roles SET permissions = CAST(? AS jsonb) WHERE role_key = ?');
        foreach ($keys as $rk) {
            $get->execute([$rk]);
            $cur = $get->fetchColumn();
            if ($cur === false) continue;
            $list = json_decode((string)$cur, true);
            if (!is_array($list) || in_array('*', $list, true) || in_array('leave.request', $list, true)) continue;
            $list[] = 'leave.request';
            $set->execute([json_encode(array_values($list)), $rk]);
        }
        $pdo->prepare("INSERT INTO school_data (key, value, version, updated_at) VALUES (?, '{}'::jsonb, 1, now()) ON CONFLICT (key) DO NOTHING")->execute([$flag]);
    } catch (Throwable $e) { /* best effort */ }
}
upgradeLeaveRequestPerm($pdo);

/* ---------------- audit & security events ---------------- */
function audit(PDO $pdo, ?array $u, string $action, string $entity, ?string $recordId, string $summary, $details = null): void {
    $stmt = $pdo->prepare(
        'INSERT INTO audit_logs (user_id, user_name, user_role, action, entity, record_id, summary, details, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb), ?)'
    );
    $stmt->execute([
        $u['id'] ?? null,
        $u['name'] ?? 'System',
        $u['role_label'] ?? ($u['role'] ?? null),
        $action,
        $entity,
        $recordId,
        mb_substr($summary, 0, 500),
        $details === null ? null : json_encode($details),
        clientIp(),
    ]);
}

function securityEvent(PDO $pdo, string $type, ?string $userId, ?string $email, string $detail = ''): void {
    try {
        $stmt = $pdo->prepare('INSERT INTO security_events (type, user_id, email, ip, user_agent, detail) VALUES (?, ?, ?, ?, ?, ?)');
        $stmt->execute([$type, $userId, $email, clientIp(), mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 250), $detail]);
    } catch (PDOException $e) {
        error_log('EraMaster securityEvent: ' . $e->getMessage());
    }
}

/* ---------------- passwords ---------------- */
function passwordProblem(string $pw): ?string {
    if (strlen($pw) < 8) return 'Password must be at least 8 characters.';
    if (!preg_match('/[A-Za-z]/', $pw) || !preg_match('/\d/', $pw)) return 'Password must include at least one letter and one number.';
    return null;
}

function randomPassword(): string {
    $alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    do {
        $pw = '';
        for ($i = 0; $i < 10; $i++) { $pw .= $alphabet[random_int(0, strlen($alphabet) - 1)]; }
    } while (passwordProblem($pw) !== null);
    return $pw;
}

/** A 6-digit one-time code, e.g. for the admin-issued password reset e-mail. */
function randomOtp(): string {
    return str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
}

/* ---------------- TOTP two-factor (RFC 6238, works with Google/Microsoft Authenticator) ---------------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(string $bin): string {
    $bits = '';
    for ($i = 0; $i < strlen($bin); $i++) { $bits .= str_pad(decbin(ord($bin[$i])), 8, '0', STR_PAD_LEFT); }
    $out = '';
    foreach (str_split($bits, 5) as $chunk) { $out .= B32[bindec(str_pad($chunk, 5, '0', STR_PAD_RIGHT))]; }
    return $out;
}

function base32Decode(string $s): string {
    $bits = '';
    $s = strtoupper(preg_replace('/[^A-Z2-7]/', '', $s));
    for ($i = 0; $i < strlen($s); $i++) { $bits .= str_pad(decbin(strpos(B32, $s[$i])), 5, '0', STR_PAD_LEFT); }
    $out = '';
    foreach (str_split($bits, 8) as $byte) { if (strlen($byte) === 8) $out .= chr(bindec($byte)); }
    return $out;
}

function totpAt(string $secret, int $counter): string {
    $hash = hash_hmac('sha1', pack('N2', 0, $counter), base32Decode($secret), true);
    $off  = ord($hash[19]) & 0x0f;
    $num  = ((ord($hash[$off]) & 0x7f) << 24) | ((ord($hash[$off + 1]) & 0xff) << 16)
          | ((ord($hash[$off + 2]) & 0xff) << 8) | (ord($hash[$off + 3]) & 0xff);
    return str_pad((string)($num % 1000000), 6, '0', STR_PAD_LEFT);
}

function verifyTotp(string $secret, string $code): bool {
    $code = preg_replace('/\D/', '', $code);
    if (strlen($code) !== 6) return false;
    $c = (int)floor(time() / 30);
    for ($i = -1; $i <= 1; $i++) {
        if (hash_equals(totpAt($secret, $c + $i), $code)) return true;
    }
    return false;
}
