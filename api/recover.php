<?php
// api/recover.php — local-only emergency password recovery for a Super
// Administrator account, for when nobody can sign in any more.
//
// This page ONLY works when opened from the same computer that is running
// the server (127.0.0.1 / ::1) — it refuses every other request outright.
// That is its entire security model, so:
//   * Do not put this server on a public network without a firewall.
//   * Delete or rename this file once you no longer need it, if you want
//     to remove the recovery path entirely.
require __DIR__ . '/config.php';
header('Content-Type: text/html; charset=utf-8');

$ip = $_SERVER['REMOTE_ADDR'] ?? '';
if (!in_array($ip, ['127.0.0.1', '::1'], true) || isProxiedRequest()) {   // a tunnel (ngrok) also arrives from 127.0.0.1 - refuse it
    http_response_code(403);
    exit('<h2>Local recovery only</h2><p>This recovery page can only be opened from the computer running EraMaster.</p>');
}

function h($v) { return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8'); }

$message = '';
$error   = '';

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $email   = strtolower(trim((string)($_POST['email'] ?? '')));
    $pw      = (string)($_POST['password'] ?? '');
    $confirm = (string)($_POST['confirm_password'] ?? '');

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $error = 'Enter a valid email address.';
    } elseif ($pw !== $confirm) {
        $error = 'The two passwords do not match.';
    } elseif ($problem = passwordProblem($pw)) {
        $error = $problem;
    } else {
        $stmt = $pdo->prepare('SELECT id, name, email FROM staff_accounts WHERE LOWER(email) = ? AND is_admin = true LIMIT 1');
        $stmt->execute([$email]);
        $u = $stmt->fetch();
        if (!$u) {
            $error = 'No Super Administrator account was found for that email address.';
        } else {
            $hash = password_hash($pw, PASSWORD_DEFAULT);
            $pdo->prepare('UPDATE staff_accounts SET password_hash = ?, must_change_password = false, is_active = true, access_expires_at = NULL, totp_enabled = false, totp_secret = NULL WHERE id = ?')
                ->execute([$hash, $u['id']]);
            try { $pdo->prepare('DELETE FROM active_sessions WHERE user_id = ?')->execute([$u['id']]); } catch (Throwable $e) {}
            securityEvent($pdo, 'local_recovery', $u['id'], $u['email'], 'password reset via recover.php');
            audit($pdo, null, 'update', 'users', $u['id'], 'Password reset via local recovery page for ' . $u['name'], null);
            $message = 'Password reset for ' . $u['name'] . '. Two-factor authentication and all other sessions for this account were also cleared. You can now return to the login page and sign in with the new password.';
        }
    }
}
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EraMaster — Local Recovery</title>
<style>
body{font-family:Arial,sans-serif;background:#063d29;margin:0;padding:40px;color:#24342d}
.card{max-width:620px;margin:auto;background:#fff;border-radius:18px;padding:30px;box-shadow:0 15px 40px rgba(0,0,0,.2)}
h1{margin-top:0;font-size:22px}
.warn{background:#fff4df;padding:14px;border-radius:10px;margin-bottom:20px}
.ok{background:#e5f7ec;padding:14px;border-radius:10px;margin-bottom:20px;color:#145b32}
.err{background:#fde7e4;padding:14px;border-radius:10px;margin-bottom:20px;color:#a32d22}
label{display:block;margin:16px 0 7px;font-weight:700}
input{box-sizing:border-box;width:100%;padding:13px;border:1px solid #aaa;border-radius:8px;font-size:16px}
button{margin-top:20px;width:100%;padding:14px;border:0;border-radius:9px;background:#17603f;color:#fff;font-size:17px;font-weight:700;cursor:pointer}
small{color:#64756d}
.back{display:inline-block;margin-top:18px}
</style>
</head><body><main class="card">
<h1>EraMaster — Local Recovery</h1>
<div class="warn"><b>Local recovery only.</b><br>This emergency page only works from the computer running EraMaster. Use it only when no Super Administrator can sign in.</div>
<?php if ($message): ?><div class="ok"><?=h($message)?></div><?php endif; ?>
<?php if ($error): ?><div class="err"><?=h($error)?></div><?php endif; ?>
<form method="post" autocomplete="off">
<label>Super Administrator email</label>
<input type="email" name="email" required placeholder="admin@example.com" value="<?=h($_POST['email'] ?? '')?>">
<label>New password</label>
<input type="password" name="password" required minlength="8" autocomplete="new-password">
<label>Confirm new password</label>
<input type="password" name="confirm_password" required minlength="8" autocomplete="new-password">
<small>Password: at least 8 characters, with letters and numbers.</small>
<button type="submit">Reset password</button>
</form>
<a class="back" href="../">← Return to EraMaster login</a>
</main></body></html>
