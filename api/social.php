<?php
// api/social.php — "Log in / Register with Google, Facebook, GitHub or LinkedIn".
//
//   api/social.php?start=google&portal=student     -> sends the browser to the provider
//   api/social.php?code=...&state=...              -> the provider sends the browser back here
//
// This is the ONE redirect URL to register in each provider's developer console.
//
// Rules:
//  * Only Student and Parent portals. Staff/administrator accounts never use social sign-in.
//  * The provider must give us a VERIFIED e-mail address. That address is matched to the school's
//    own account list:
//      - account exists  -> signed in (same portal / active / expiry checks as the password login)
//      - no account yet  -> the person is sent back to the Register form with name + e-mail filled
//                           in and must still enter their admission number / phone, which is
//                           checked against the school's records — a Google account alone never
//                           creates a student or parent account.
//  * Accounts that have authenticator 2FA switched on must use their password + code instead.
require __DIR__ . '/config.php';
require __DIR__ . '/data.php';
require __DIR__ . '/handlers/auth.php';

header('Content-Type: text/html; charset=utf-8');

function socialRoot(): string {
    return rtrim(str_replace('\\', '/', dirname(dirname($_SERVER['SCRIPT_NAME'] ?? '/api/social.php'))), '/');
}
function socialBack(string $portal, array $q = []): void {
    $portal = in_array($portal, ['student', 'parent'], true) ? $portal : 'student';
    header('Location: ' . socialRoot() . '/index.html?' . http_build_query(['portal' => $portal] + $q));
    exit;
}
function socialRedirectUri(): string {
    if (SOCIAL_REDIRECT_URI !== '') return SOCIAL_REDIRECT_URI;
    $https  = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    $scheme = $https ? 'https' : 'http';
    return $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . socialRoot() . '/api/social.php';
}
/** HTTP helper: returns decoded JSON (array) or null. */
function socialHttp(string $url, ?array $post = null, array $headers = []): ?array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => SOCIAL_VERIFY_SSL, CURLOPT_SSL_VERIFYHOST => SOCIAL_VERIFY_SSL ? 2 : 0,
        CURLOPT_HTTPHEADER => array_merge(['Accept: application/json', 'User-Agent: EraMaster'], $headers),
    ]);
    if ($post !== null) { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post)); }
    $raw = curl_exec($ch);
    if ($raw === false) { error_log('EraMaster social: ' . curl_error($ch) . ' (' . $url . ')'); curl_close($ch); return null; }
    curl_close($ch);
    $j = json_decode((string)$raw, true);
    return is_array($j) ? $j : null;
}

$defs   = socialProviderDefs();
$flow   = $_SESSION['social_oauth'] ?? null;

/* ---------- step 1: send the person to the provider ---------- */
if (isset($_GET['start'])) {
    $prov   = (string)$_GET['start'];
    $portal = (string)($_GET['portal'] ?? '');
    if (!in_array($portal, ['student', 'parent'], true)) socialBack('student', ['social_error' => 'Social sign-in is only for the Student and Parent portals.']);
    if (!isset($defs[$prov]) || $defs[$prov]['id'] === '' || $defs[$prov]['secret'] === '') {
        socialBack($portal, ['social_error' => ($defs[$prov]['label'] ?? 'That') . ' sign-in is not set up for this school yet. Use your email and password.']);
    }
    $d     = $defs[$prov];
    $state = bin2hex(random_bytes(16));
    $_SESSION['social_oauth'] = ['state' => $state, 'provider' => $prov, 'portal' => $portal, 'exp' => time() + 600];
    $q = ['client_id' => $d['id'], 'redirect_uri' => socialRedirectUri(), 'response_type' => 'code', 'scope' => $d['scope'], 'state' => $state];
    if ($prov === 'google') $q['prompt'] = 'select_account';
    header('Location: ' . $d['auth'] . '?' . http_build_query($q));
    exit;
}

/* ---------- step 2: the provider sent them back ---------- */
unset($_SESSION['social_oauth']);                         // a flow can only be completed once
$portal = (string)($flow['portal'] ?? 'student');
if (!is_array($flow) || (int)$flow['exp'] < time()
    || !hash_equals((string)$flow['state'], (string)($_GET['state'] ?? ''))) {
    socialBack($portal, ['social_error' => 'That sign-in attempt expired. Please try again.']);
}
if (isset($_GET['error']) || empty($_GET['code'])) {
    socialBack($portal, ['social_error' => 'Social sign-in was cancelled.']);
}
$prov = (string)$flow['provider'];
$d    = $defs[$prov] ?? null;
if (!$d || $d['id'] === '') socialBack($portal, ['social_error' => 'That sign-in is not set up.']);

$tok = socialHttp($d['token'], [
    'grant_type' => 'authorization_code', 'code' => (string)$_GET['code'], 'redirect_uri' => socialRedirectUri(),
    'client_id' => $d['id'], 'client_secret' => $d['secret'],
]);
$access = (string)($tok['access_token'] ?? '');
if ($access === '') socialBack($portal, ['social_error' => $d['label'] . ' did not accept the sign-in. Check the school\'s ' . $d['label'] . ' app settings, or use your email and password.']);
$bearer = ['Authorization: Bearer ' . $access];

$email = ''; $name = ''; $verified = false;
if ($prov === 'google') {
    $u = socialHttp('https://openidconnect.googleapis.com/v1/userinfo', null, $bearer) ?? [];
    $email = (string)($u['email'] ?? ''); $name = (string)($u['name'] ?? ''); $verified = !empty($u['email_verified']);
} elseif ($prov === 'linkedin') {
    $u = socialHttp('https://api.linkedin.com/v2/userinfo', null, $bearer) ?? [];
    $email = (string)($u['email'] ?? ''); $name = (string)($u['name'] ?? ''); $verified = !empty($u['email_verified']);
} elseif ($prov === 'facebook') {
    $u = socialHttp('https://graph.facebook.com/v19.0/me?fields=id,name,email&access_token=' . urlencode($access)) ?? [];
    $email = (string)($u['email'] ?? ''); $name = (string)($u['name'] ?? ''); $verified = ($email !== '');   // Facebook only returns confirmed e-mails
} elseif ($prov === 'github') {
    $u  = socialHttp('https://api.github.com/user', null, $bearer) ?? [];
    $name = (string)($u['name'] ?? $u['login'] ?? '');
    $em = socialHttp('https://api.github.com/user/emails', null, $bearer);
    foreach (is_array($em) ? $em : [] as $row) {            // only the primary, verified address counts
        if (is_array($row) && !empty($row['primary']) && !empty($row['verified'])) { $email = (string)$row['email']; $verified = true; break; }
    }
}
$email = strtolower(trim($email));
if ($email === '' || !$verified || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    socialBack($portal, ['social_error' => $d['label'] . ' did not share a verified email address, so we cannot match you to a school account. Use your email and password instead.']);
}

$stmt = $pdo->prepare('SELECT * FROM staff_accounts WHERE email = ?');
$stmt->execute([$email]);
$row = $stmt->fetch();

if ($row) {
    $kind = accountKind((string)$row['role_key']);
    if ($kind !== 'student' && $kind !== 'parent') {
        securityEvent($pdo, 'login_blocked', $row['id'], $email, 'social sign-in refused: staff account');
        socialBack($portal, ['social_error' => 'Staff accounts cannot use social sign-in. Sign in with your email and password.']);
    }
    if ($kind !== $portal) {
        securityEvent($pdo, 'login_blocked', $row['id'], $email, 'social sign-in: wrong portal');
        socialBack($portal, ['social_error' => 'This account is registered as ' . accountKindLabel($kind) . '. Please sign in from the ' . accountKindLabel($kind) . ' portal instead.']);
    }
    if (!toBool($row['is_active']) || (!empty($row['access_expires_at']) && strtotime($row['access_expires_at']) <= time())) {
        securityEvent($pdo, 'login_blocked', $row['id'], $email, 'social sign-in: account inactive or expired');
        socialBack($portal, ['social_error' => 'This account is not active. Contact the school office.']);
    }
    if (toBool($row['totp_enabled'])) {
        socialBack($portal, ['social_error' => 'This account has two-step verification turned on. Log in with your password and authenticator code.']);
    }
    startSession($row['id']);
    $pdo->prepare('UPDATE staff_accounts SET last_login_at = now() WHERE id = ?')->execute([$row['id']]);
    touchActiveSession($pdo, $row['id']);
    securityEvent($pdo, 'login_ok', $row['id'], $email, 'via ' . $d['label']);
    $u = currentUser($pdo);
    audit($pdo, $u, 'login', 'users', $row['id'], $u['name'] . ' signed in with ' . $d['label'], null);
    socialBack($portal);                                    // the page picks up the new session on load
}

// No account yet: remember the verified identity and finish on the Register form.
$_SESSION['social_pending'] = ['email' => $email, 'name' => $name, 'provider_label' => $d['label'], 'portal' => $portal, 'exp' => time() + 900];
securityEvent($pdo, 'social_identity_verified', null, $email, 'via ' . $d['label'] . ', awaiting school-record check');
socialBack($portal, ['social' => 'complete']);
