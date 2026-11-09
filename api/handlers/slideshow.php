<?php
// api/handlers/slideshow.php — homepage photo slideshow.
//
//   slideshow       GET   public  — the ordered slides for portal.html (no login needed,
//                                   like school_profile). Returns only id/title/caption/src.
//   slideshow_save  POST  needs settings.manage — add / remove / reorder / caption photos.
//
// The slide list lives in school_data under the key 'gallery_slideshow'. That key is
// deliberately NOT in rbac.php's dataKeys(), so get_all / set_all never touch it and no
// existing module is affected. Photos are stored as real files in /uploads/slideshow/
// (not as base64 inside the database), which keeps the public JSON tiny and lets the
// browser cache the images.

const SLIDESHOW_KEY       = 'gallery_slideshow';
const SLIDESHOW_MAX       = 12;                 // most photos allowed
const SLIDESHOW_MAX_BYTES = 2 * 1024 * 1024;    // per decoded image
const SLIDESHOW_DIR_REL   = 'uploads/slideshow';

function slideshowDir(): string {
    return dirname(__DIR__, 2) . '/' . SLIDESHOW_DIR_REL;
}

function slideshowLoad(PDO $pdo, bool $lock = false): array {
    $row = loadKeyRow($pdo, SLIDESHOW_KEY, $lock);
    $v   = $row ? json_decode($row['value'], true) : null;
    $slides = (is_array($v) && is_array($v['slides'] ?? null)) ? $v['slides'] : [];
    $secs   = (is_array($v) && isset($v['interval'])) ? (int)$v['interval'] : 5;
    $out = [];
    foreach ($slides as $s) {
        if (!is_array($s) || empty($s['id']) || empty($s['file'])) continue;
        // Only ever serve a plain file name from our own folder.
        if (basename((string)$s['file']) !== (string)$s['file']) continue;
        $out[] = ['id' => (string)$s['id'], 'title' => (string)($s['title'] ?? ''), 'caption' => (string)($s['caption'] ?? ''), 'file' => (string)$s['file']];
    }
    return ['interval' => max(3, min(15, $secs)), 'slides' => $out];
}

function slideshowView(array $data): array {
    $dir = slideshowDir();
    $slides = [];
    foreach ($data['slides'] as $s) {
        $path = $dir . '/' . $s['file'];
        if (!is_file($path)) continue;          // file went missing — skip rather than show a broken image
        $slides[] = ['id' => $s['id'], 'title' => $s['title'], 'caption' => $s['caption'],
                     'src' => SLIDESHOW_DIR_REL . '/' . rawurlencode($s['file']) . '?v=' . filemtime($path)];
    }
    return ['interval' => $data['interval'], 'slides' => $slides];
}

function slideshowPublic(): void {
    global $pdo;
    $v = ['interval' => 5, 'slides' => []];
    try { $v = slideshowView(slideshowLoad($pdo)); }
    catch (Throwable $e) { error_log('EraMaster slideshow: ' . $e->getMessage()); }
    respond(['ok' => true] + $v);
}

/** Validates a data: URI image and returns [binary, extension] or an error string. */
function slideshowDecodeImage(string $uri) {
    // Split on the first comma instead of running a regex over megabytes of base64.
    $comma = strpos($uri, ',');
    if ($comma === false || $comma > 60 || !preg_match('#^data:image/(jpeg|jpg|png|webp);base64$#i', substr($uri, 0, $comma))) {
        return 'That does not look like a JPG, PNG or WebP image.';
    }
    $bin = base64_decode(substr($uri, $comma + 1), true);
    if ($bin === false || $bin === '') return 'That image could not be read.';
    if (strlen($bin) > SLIDESHOW_MAX_BYTES) return 'A photo is too large (max 2 MB after resizing).';
    $info = @getimagesizefromstring($bin);
    $ext  = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_WEBP => 'webp'][$info[2] ?? 0] ?? null;
    if (!$info || !$ext) return 'That file is not a valid image.';
    return [$bin, $ext];
}

function slideshowSave(): void {
    global $pdo;
    $u = requirePerm($pdo, 'settings.manage');
    $b = input();
    $in = $b['slides'] ?? null;
    if (!is_array($in)) respond(['ok' => false, 'error' => 'No slides were received.'], 400);
    if (count($in) > SLIDESHOW_MAX) respond(['ok' => false, 'error' => 'A slideshow can hold at most ' . SLIDESHOW_MAX . ' photos.'], 400);
    $interval = max(3, min(15, (int)($b['interval'] ?? 5)));

    $dir = slideshowDir();
    if (!is_dir($dir) && !@mkdir($dir, 0755, true)) respond(['ok' => false, 'error' => 'Could not create the uploads/slideshow folder — check folder permissions.'], 500);

    $written = [];      // files created by this request (removed again if anything fails)
    $pdo->beginTransaction();
    try {
        $old = slideshowLoad($pdo, true);
        $oldById = [];
        foreach ($old['slides'] as $s) $oldById[$s['id']] = $s;

        $new = [];
        $seen = [];
        foreach ($in as $s) {
            if (!is_array($s)) continue;
            $title   = mb_substr(trim((string)($s['title'] ?? '')), 0, 80);
            $caption = mb_substr(trim((string)($s['caption'] ?? '')), 0, 200);
            $id      = (string)($s['id'] ?? '');
            if (!empty($s['image'])) {                                  // a brand-new photo
                $dec = slideshowDecodeImage((string)$s['image']);
                if (is_string($dec)) { $pdo->rollBack(); foreach ($written as $f) @unlink($f); respond(['ok' => false, 'error' => $dec], 400); }
                $id   = uid('ss');
                $file = $id . '.' . $dec[1];
                if (file_put_contents($dir . '/' . $file, $dec[0]) === false) throw new RuntimeException('Could not write ' . $file);
                $written[] = $dir . '/' . $file;
            } elseif (isset($oldById[$id]) && !isset($seen[$id])) {     // an existing photo (keeps its file)
                $file = $oldById[$id]['file'];
            } else {
                continue;                                               // unknown / duplicate id — ignore
            }
            $seen[$id] = true;
            $new[] = ['id' => $id, 'title' => $title, 'caption' => $caption, 'file' => $file];
        }

        storeKey($pdo, SLIDESHOW_KEY, json_encode(['interval' => $interval, 'slides' => $new]));
        $removed = array_diff(array_keys($oldById), array_keys($seen));
        $added   = count($written);
        audit($pdo, $u, 'update', 'slideshow', null,
            'Homepage slideshow saved: ' . count($new) . ' photo(s), ' . $added . ' added, ' . count($removed) . ' removed.', null);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        foreach ($written as $f) @unlink($f);
        throw $e;
    }
    // Only after the database change is safely committed do we delete the files of removed photos.
    foreach ($removed as $rid) { @unlink($dir . '/' . $oldById[$rid]['file']); }

    respond(['ok' => true] + slideshowView(slideshowLoad($pdo)));
}
