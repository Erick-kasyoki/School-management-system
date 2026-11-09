<?php
// favicon.php — the browser-tab icon: the school logo uploaded in Settings → School logo.
// Every page points its <link rel="icon"> here (and /favicon.ico is rewritten to it by .htaccess),
// so the tab shows the logo even before any JavaScript runs. With no logo uploaded it serves a
// simple default icon instead of the browser's globe.

require __DIR__ . '/api/config.php';
require __DIR__ . '/api/data.php';
require __DIR__ . '/api/handlers/logo.php';

$mimes = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'gif' => 'image/gif', 'webp' => 'image/webp', 'svg' => 'image/svg+xml'];
$path = null; $mime = null;

try {
    $row = loadKeyRow($pdo, LOGO_KEY);
    $v = $row ? json_decode($row['value'], true) : null;
    $file = is_array($v) ? (string)($v['file'] ?? '') : '';
    if ($file !== '' && basename($file) === $file && is_file(logoDir() . '/' . $file)) {
        $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        if (isset($mimes[$ext])) { $path = logoDir() . '/' . $file; $mime = $mimes[$ext]; }
    }
} catch (Throwable $e) {
    error_log('EraMaster favicon: ' . $e->getMessage());
}

if (function_exists('session_write_close')) @session_write_close();   // config.php opens a session; the icon doesn't need it
header_remove('Content-Type'); header_remove('Pragma'); header_remove('Expires');
header('Cache-Control: no-cache');          // browsers re-check, so a newly uploaded logo shows up
header('X-Content-Type-Options: nosniff');

if ($path) {
    $mtime = filemtime($path);
    $etag = '"' . $mtime . '-' . filesize($path) . '"';
    header('ETag: ' . $etag);
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');
    if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) { http_response_code(304); exit; }
    header('Content-Type: ' . $mime);
    readfile($path);
    exit;
}

header('Content-Type: image/svg+xml');
echo '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1e5a32"/>'
   . '<path d="M32 14 8 26l24 12 24-12-24-12Zm-14 22v8c0 3 6 8 14 8s14-5 14-8v-8l-14 7-14-7Z" fill="#fff"/></svg>';
