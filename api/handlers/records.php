<?php
// api/handlers/records.php — the generic module-data endpoints (get_all/set_all)
// that every screen in the app reads and writes through.

function getAll(): void {
    global $pdo;
    $u  = requireUser($pdo);
    $dk = dataKeys();
    // Optional ?keys=em_leave,em_events: the browser re-reads only the collections a notification is about.
    $only = null;
    if (isset($_GET['keys']) && $_GET['keys'] !== '') {
        $only = [];
        foreach (explode(',', (string)$_GET['keys']) as $k) {
            $k = trim($k);
            if ($k !== '' && isset($dk[$k])) $only[$k] = true;
        }
    }
    $rows = $pdo->query('SELECT key, value::text AS value, version FROM school_data')->fetchAll();
    $parts = [];
    $vers  = [];
    foreach ($rows as $r) {
        $key = $r['key'];
        if (!isset($dk[$key]) || !userCanAny($u, $dk[$key]['read'])) continue;
        if ($only !== null && !isset($only[$key])) continue;
        // The stored JSON text is passed through untouched (no decode/encode round trip).
        $parts[] = json_encode($key) . ':' . $r['value'];
        $vers[$key] = (int)$r['version'];
    }
    http_response_code(200);
    echo '{"ok":true,"data":{' . implode(',', $parts) . '},"versions":' . json_encode((object)$vers) . '}';
    exit;
}

function setAll(): void {
    global $pdo;
    $u   = requireUser($pdo);
    $raw = inputObject();
    // New clients send {items:{key:value}, base:{key:versionTheyLoaded}}; older ones sent {key:value}.
    $items = (isset($raw->items) && is_object($raw->items)) ? $raw->items : $raw;
    $base  = (isset($raw->base) && is_object($raw->base)) ? (array)$raw->base : [];
    $dk    = dataKeys();

    $versions  = [];
    $conflicts = [];
    $pdo->beginTransaction();
    try {
        foreach ($items as $key => $valueObj) {
            $key = (string)$key;
            if (!isset($dk[$key])) {
                $pdo->rollBack();
                respond(['ok' => false, 'error' => 'Unknown data key: ' . $key], 400);
            }
            $isMap = in_array($key, MAP_KEYS, true);
            if ($isMap ? !is_object($valueObj) : !is_array($valueObj)) {
                $pdo->rollBack();
                respond(['ok' => false, 'error' => 'Invalid value for ' . $key . '.'], 400);
            }
            $row = loadKeyRow($pdo, $key, true);
            if ($row && isset($base[$key]) && (int)$base[$key] !== (int)$row['version']) {
                $conflicts[] = $key;
                continue;
            }
            $old     = $row ? json_decode($row['value'], true) : null;
            $newJson = json_encode($valueObj);
            $info    = computeDiff($key, $old, json_decode($newJson, true));
            if (!diffHasChanges($info)) {
                if ($row) $versions[$key] = (int)$row['version'];
                continue;
            }
            if ($err = authorizeWrite($u, $key, $info)) {
                $pdo->rollBack();
                respond(['ok' => false, 'error' => $err], 403);
            }
            if ($err = authorizeMarksOpen($pdo, $u, $key, $old, json_decode($newJson, true))) {
                $pdo->rollBack();
                respond(['ok' => false, 'error' => $err], 403);
            }
            $versions[$key] = storeKey($pdo, $key, $newJson);
            auditDiff($pdo, $u, $key, $info);
            notifQueue($key, $info, $old, json_decode($newJson, true));   // told to the right people after the commit (api/handlers/notify.php)
        }
        if ($conflicts) {
            $pdo->rollBack();
            respond(['ok' => false, 'conflict' => $conflicts, 'error' => 'Someone else changed the same records while you were editing. Your screen has been refreshed — please redo your change.'], 409);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    notifFlush($pdo, $u);
    respond(['ok' => true, 'versions' => $versions]);
}

