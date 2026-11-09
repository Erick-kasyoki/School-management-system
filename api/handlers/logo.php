<?php
// api/handlers/logo.php — the school logo.
//
//   logo_save   POST  needs settings.manage — upload a new logo ({image: data-URI}) or remove it ({remove: true})
//
// The file lives in uploads/logo/ (static files only — see uploads/.htaccess) and its name is kept in
// school_data under the key 'school_logo'. That key is deliberately NOT in rbac.php's dataKeys(), so
// get_all / set_all never touch it. The public school_profile action and the portal_data action return
// the logo's URL, so the sign-in pages, landing page and portals all show whatever was uploaded here.

const LOGO_KEY       = 'school_logo';
const LOGO_DIR_REL   = 'uploads/logo';
const LOGO_MAX_BYTES = 1024 * 1024;   // 1 MB after the browser has resized it

function logoDir(): string { return dirname(__DIR__, 2) . '/' . LOGO_DIR_REL; }

/** URL (relative to the site root, with a cache-busting version) of the current logo, or null. */
function schoolLogoUrl(PDO $pdo): ?string {
    try {
        $row = loadKeyRow($pdo, LOGO_KEY);
        $v = $row ? json_decode($row['value'], true) : null;
        $file = is_array($v) ? (string)($v['file'] ?? '') : '';
        if ($file === '' || basename($file) !== $file) return null;
        $path = logoDir() . '/' . $file;
        if (!is_file($path)) return null;
        return LOGO_DIR_REL . '/' . rawurlencode($file) . '?v=' . filemtime($path);
    } catch (Throwable $e) {
        error_log('EraMaster logo: ' . $e->getMessage());
        return null;
    }
}

function logoSave(): void {
    global $pdo;
    $u = requirePerm($pdo, 'settings.manage');
    $b = input();
    $dir = logoDir();

    $pdo->beginTransaction();
    $newPath = null;
    try {
        $row = loadKeyRow($pdo, LOGO_KEY, true);
        $old = $row ? json_decode($row['value'], true) : null;
        $oldFile = is_array($old) ? (string)($old['file'] ?? '') : '';

        if (!empty($b['remove'])) {
            storeKey($pdo, LOGO_KEY, json_encode(['file' => '']));
            audit($pdo, $u, 'update', 'school_logo', null, 'School logo removed.', null);
            $file = '';
        } else {
            $dec = slideshowDecodeImage((string)($b['image'] ?? ''));      // same strict image check as the slideshow
            if (is_string($dec)) { $pdo->rollBack(); respond(['ok' => false, 'error' => $dec], 400); }
            if (strlen($dec[0]) > LOGO_MAX_BYTES) { $pdo->rollBack(); respond(['ok' => false, 'error' => 'That logo is too large (max 1 MB).'], 400); }
            if (!is_dir($dir) && !@mkdir($dir, 0755, true)) { $pdo->rollBack(); respond(['ok' => false, 'error' => 'Could not create the uploads/logo folder — check folder permissions.'], 500); }
            $file = 'logo_' . bin2hex(random_bytes(5)) . '.' . $dec[1];      // new name each time, so browsers never show a stale logo
            $newPath = $dir . '/' . $file;
            if (file_put_contents($newPath, $dec[0]) === false) throw new RuntimeException('Could not write the logo file.');
            storeKey($pdo, LOGO_KEY, json_encode(['file' => $file]));
            audit($pdo, $u, 'update', 'school_logo', null, 'School logo updated.', null);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        if ($newPath) @unlink($newPath);
        throw $e;
    }
    // Only after the database change is committed do we delete the previous file.
    if ($oldFile !== '' && basename($oldFile) === $oldFile && $oldFile !== $file) @unlink($dir . '/' . $oldFile);

    respond(['ok' => true, 'logo' => schoolLogoUrl($pdo)]);
}
