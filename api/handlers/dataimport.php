<?php
// api/handlers/dataimport.php — the dynamic Data Import module (any CSV / Excel / JSON file).
//
//   import_preview   POST (multipart)  upload a file (or re-read a staged one with new options) and get back
//                                       the detected structure: header row, column names, types, a row preview.
//   import_commit    POST (JSON)        store the previewed file as a dataset (new, or appended to an existing one).
//   import_datasets  GET                list stored datasets.
//   import_rows      GET                browse a dataset's rows (search, sort, pages).
//   import_update    POST               rename / describe a dataset.
//   import_delete    POST               delete a dataset and its rows.
//   import_export    GET                download a dataset as CSV or JSON.
//
// Storage is two generic tables (see schema.sql): import_datasets (name + column list) and import_rows
// (one JSONB document per row). No column of any imported file is ever a database column, so any
// file with any headers can be stored without a code or schema change.
// Everything needs the 'import.manage' permission.

require_once __DIR__ . '/../import/engine.php';

function diBoot(PDO $pdo): void {
    @ini_set('memory_limit', '768M');
    @set_time_limit(300);
    diEnsureSchema($pdo);
}

function diEnsureSchema(PDO $pdo): void {
    static $done = false;
    if ($done) return;
    $pdo->exec("CREATE TABLE IF NOT EXISTS import_datasets (
        id VARCHAR(40) PRIMARY KEY, name VARCHAR(200) NOT NULL, description TEXT NOT NULL DEFAULT '',
        source_file VARCHAR(255) NOT NULL DEFAULT '', source_kind VARCHAR(20) NOT NULL DEFAULT '', sheet_name VARCHAR(200),
        columns JSONB NOT NULL DEFAULT '[]'::jsonb, row_count INTEGER NOT NULL DEFAULT 0,
        imports JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_by VARCHAR(40), created_by_name VARCHAR(150) NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    $pdo->exec("CREATE TABLE IF NOT EXISTS import_rows (
        id BIGSERIAL PRIMARY KEY, dataset_id VARCHAR(40) NOT NULL REFERENCES import_datasets(id) ON DELETE CASCADE,
        row_no INTEGER NOT NULL, data JSONB NOT NULL, search TEXT NOT NULL DEFAULT '')");
    $pdo->exec('CREATE INDEX IF NOT EXISTS import_rows_ds_idx ON import_rows (dataset_id, row_no)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS import_rows_data_gin ON import_rows USING GIN (data jsonb_path_ops)');
    $done = true;
}

function diFail(string $msg, int $code = 422): void { respond(['ok' => false, 'error' => $msg], $code); }

/* ---------------- staging (uploaded file waits here between preview and import) ---------------- */
function diStageDir(): string {
    // Staged uploads live in the system temp folder — outside the web root, so they can never be fetched by URL.
    // Only if that is not writable do we fall back to uploads/imports (protected by its own .htaccess).
    static $dir = null;
    if ($dir !== null) return $dir;
    $tmp = rtrim(sys_get_temp_dir(), '/\\') . DIRECTORY_SEPARATOR . 'eramaster_import_stage';
    if (!is_dir($tmp)) @mkdir($tmp, 0700, true);
    if (is_dir($tmp) && is_writable($tmp)) return $dir = $tmp;
    $d = dirname(__DIR__, 2) . '/uploads/imports';
    if (!is_dir($d)) @mkdir($d, 0775, true);
    if (!is_file($d . '/.htaccess')) @file_put_contents($d . '/.htaccess', "# Staged uploads are never served.\nRequire all denied\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
    return $dir = $d;
}
function diCleanStage(): void {
    $ttl = diCfg()['stage_ttl'];
    foreach (glob(diStageDir() . '/*') ?: [] as $f) {
        if (is_file($f) && basename($f) !== '.htaccess' && filemtime($f) < time() - $ttl) @unlink($f);
    }
}
function diValidToken(string $t): bool { return (bool)preg_match('/^[a-f0-9]{32}$/', $t); }
function diUploadError(int $code): string {
    return match ($code) {
        UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'The file is larger than the server allows (php.ini upload_max_filesize is ' . ini_get('upload_max_filesize') . ', post_max_size ' . ini_get('post_max_size') . ').',
        UPLOAD_ERR_PARTIAL => 'The upload was interrupted. Please try again.',
        UPLOAD_ERR_NO_FILE => 'Choose a file first.',
        default => 'The file could not be uploaded (error ' . $code . ').',
    };
}
function diStageUpload(array $f, array $u): string {
    if (($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) diFail(diUploadError((int)$f['error']));
    if ((int)$f['size'] > DI_MAX_BYTES) diFail('That file is over ' . (DI_MAX_BYTES / 1048576) . ' MB. Split it into smaller files.');
    $name = mb_substr(basename((string)$f['name']), 0, 200);
    $kind = diKindFromName($name);
    if ($kind === null) diFail('Unsupported file type. Use Excel (.xlsx), CSV/TSV/TXT, JSON or NDJSON.');
    $token = bin2hex(random_bytes(16));
    $dest = diStageDir() . '/' . $token . '.dat';
    if (!move_uploaded_file($f['tmp_name'], $dest)) diFail('Could not store the upload.', 500);
    try { $kind = diSniffKind($dest, $kind); }
    catch (DiException $e) { @unlink($dest); diFail($e->getMessage()); }
    if ($kind === 'xls') { @unlink($dest); diFail('Old .xls (Excel 97-2003) files cannot be read. Open it in Excel, choose Save As → .xlsx (or CSV), and upload that.'); }
    file_put_contents(diStageDir() . '/' . $token . '.json', json_encode(['name' => $name, 'kind' => $kind, 'size' => (int)$f['size'], 'user' => $u['id'], 'at' => time()]));
    return $token;
}
function diLoadStage(string $token, array $u): array {
    if (!diValidToken($token)) diFail('Choose a file first.');
    $mf = diStageDir() . '/' . $token . '.json';
    $data = diStageDir() . '/' . $token . '.dat';
    if (!is_file($mf) || !is_file($data)) diFail('That upload has expired. Please choose the file again.', 410);
    $m = json_decode((string)file_get_contents($mf), true);
    if (!is_array($m) || (string)$m['user'] !== (string)$u['id']) diFail('That upload belongs to another user.', 403);
    $m['path'] = $data; $m['token'] = $token;
    return $m;
}
function diDropStage(string $token): void {
    foreach (['.dat', '.json', '.dat.utf8.tmp'] as $e) @unlink(diStageDir() . '/' . $token . $e);
}
function diOpts(array $src): array {
    $h = (string)($src['header'] ?? 'auto');
    return ['sheet' => (string)($src['sheet'] ?? ''), 'delimiter' => (string)($src['delimiter'] ?? 'auto'),
            'header' => in_array($h, ['auto', 'yes', 'no'], true) ? $h : 'auto',
            'date_order' => ($src['date_order'] ?? 'dmy') === 'mdy' ? 'mdy' : 'dmy'];
}

/* ---------------- preview ---------------- */
function importPreview(): void {
    global $pdo;
    $u = requirePerm($pdo, 'import.manage');
    diBoot($pdo);
    diCleanStage();
    // When the body is bigger than php.ini's post_max_size, PHP throws the whole request away: $_FILES and $_POST
    // both arrive empty. Say so, instead of the misleading "Choose a file first".
    if (empty($_FILES) && empty($_POST) && (int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
        diFail('The file is larger than this server accepts (php.ini post_max_size is ' . ini_get('post_max_size') . ', upload_max_filesize is '
             . ini_get('upload_max_filesize') . '). Raise both in php.ini and restart Apache, or split the file into smaller parts.', 413);
    }
    try {
        $token = (string)($_POST['token'] ?? '');
        if (!empty($_FILES['file'])) $token = diStageUpload($_FILES['file'], $u);
        $meta = diLoadStage($token, $u);
        $o = diOpts($_POST);
        $src = DiSource::open($meta['path'], $meta['kind'], $o);
        $a = diAnalyse($src, $o, true);
    } catch (DiException $e) {
        if (!empty($token) && !empty($_FILES['file'])) diDropStage($token);   // a brand-new upload that cannot be read is discarded
        diFail($e->getMessage());
    }
    respond(['ok' => true, 'token' => $token,
        'file' => ['name' => $meta['name'], 'kind' => $meta['kind'], 'size' => $meta['size']],
        'source' => ['sheets' => $src->sheets, 'sheet' => $src->sheetName,
                     'delimiter' => $meta['kind'] === 'delimited' ? [',' => 'comma', ';' => 'semicolon', "\t" => 'tab', '|' => 'pipe'][$src->delimiter] ?? 'comma' : null,
                     'header_fixed' => $src->headerForced !== null],
        'options' => $o, 'analysis' => $a]);
}

/* ---------------- commit ---------------- */
function importCommit(): void {
    global $pdo;
    $u = requirePerm($pdo, 'import.manage');
    diBoot($pdo);
    $in = input();
    $cfg = diCfg();
    try {
        $meta = diLoadStage((string)($in['token'] ?? ''), $u);
        $o = diOpts((array)($in['options'] ?? []));
        $src = DiSource::open($meta['path'], $meta['kind'], $o);
        $a = diAnalyse($src, $o, false);
    } catch (DiException $e) { diFail($e->getMessage()); }

    // the person's column choices, by column index
    $choice = [];
    foreach ((array)($in['columns'] ?? []) as $c) { if (is_array($c) && isset($c['index'])) $choice[(int)$c['index']] = $c; }
    $use = [];
    foreach ($a['columns'] as $col) {
        $c = $choice[$col['index']] ?? [];
        $include = array_key_exists('include', $c) ? (bool)$c['include'] : $col['include'];
        if (!$include) continue;
        $type = in_array(($c['type'] ?? ''), DI_TYPES, true) ? $c['type'] : $col['type'];
        $name = trim((string)($c['name'] ?? '')); if ($name === '') $name = $col['name'];
        $use[] = ['index' => $col['index'], 'name' => mb_substr($name, 0, 150), 'type' => $type, 'order' => $col['order']];
    }
    if (!$use) diFail('Select at least one column to import.');

    $mode = ($in['mode'] ?? 'new') === 'append' ? 'append' : 'new';
    $setName = trim((string)($in['name'] ?? ''));
    $pdo->beginTransaction();
    try {
        if ($mode === 'append') {
            $st = $pdo->prepare('SELECT id, name, columns, row_count FROM import_datasets WHERE id = ? FOR UPDATE');
            $st->execute([(string)($in['dataset_id'] ?? '')]);
            $ds = $st->fetch();
            if (!$ds) { $pdo->rollBack(); diFail('The dataset you are adding to no longer exists.', 404); }
            $dsId = $ds['id']; $dsName = $ds['name'];
            $cols = json_decode($ds['columns'], true) ?: [];
            $byName = [];
            foreach ($cols as $i => $c) $byName[mb_strtolower(trim($c['name']))] = $i;
            $newNames = [];
            foreach ($use as $i => $m) { if (!isset($byName[mb_strtolower($m['name'])])) $newNames[$i] = $m['name']; }
            $newKeys = diColumnKeys(array_values($newNames), array_column($cols, 'key'));
            $n = 0;
            foreach ($use as $i => &$m) {
                $ix = $byName[mb_strtolower($m['name'])] ?? null;
                if ($ix !== null) {
                    $m['key'] = $cols[$ix]['key'];
                    if ($cols[$ix]['type'] === 'integer' && $m['type'] === 'decimal') $cols[$ix]['type'] = 'decimal';   // widen, never narrow
                    $m['type'] = $cols[$ix]['type'];
                } else {
                    $m['key'] = $newKeys[$n++];
                    $cols[] = ['key' => $m['key'], 'name' => $m['name'], 'type' => $m['type']];
                }
            }
            unset($m);
            $rowNo = (int)$pdo->query("SELECT COALESCE(MAX(row_no),0) FROM import_rows WHERE dataset_id = " . $pdo->quote($dsId))->fetchColumn();
        } else {
            if ($setName === '') $setName = preg_replace('/\.[^.]+$/', '', $meta['name']);
            $dsId = uid('ds'); $dsName = mb_substr($setName, 0, 200);
            $keys = diColumnKeys(array_column($use, 'name'));
            $cols = [];
            foreach ($use as $i => &$m) { $m['key'] = $keys[$i]; $cols[] = ['key' => $m['key'], 'name' => $m['name'], 'type' => $m['type']]; }
            unset($m);
            $pdo->prepare('INSERT INTO import_datasets (id, name, description, source_file, source_kind, sheet_name, created_by, created_by_name) VALUES (?,?,?,?,?,?,?,?)')
                ->execute([$dsId, $dsName, mb_substr(trim((string)($in['description'] ?? '')), 0, 2000), $meta['name'], $meta['kind'], $src->sheetName, $u['id'], $u['name']]);
            $rowNo = 0;
        }

        // stream the whole file into import_rows in batches
        $skip = $a['skip']; $seen = 0; $inserted = 0; $blank = 0; $fails = [];
        $batch = []; $ins = null;
        $flush = function () use (&$batch, $pdo, $dsId) {
            if (!$batch) return;
            $sql = 'INSERT INTO import_rows (dataset_id, row_no, data, search) VALUES ' . implode(',', array_fill(0, count($batch), '(?,?,CAST(? AS jsonb),?)'));
            $p = [];
            foreach ($batch as $r) { array_push($p, $dsId, $r[0], $r[1], $r[2]); }
            $pdo->prepare($sql)->execute($p);
            $batch = [];
        };
        foreach ($src->rows() as $raw) {
            $raw = diTrimRow($raw);
            if (!$raw) continue;
            if ($seen++ < $skip) continue;
            $doc = []; $words = [];
            foreach ($use as $m) {
                $ok = true;
                $v = diConvert($raw[$m['index']] ?? null, $m['type'], $m['order'], $ok);
                if (!$ok) { $fails[$m['name']] = ($fails[$m['name']] ?? 0) + 1; }
                if ($v === null) continue;
                $doc[$m['key']] = $v;
                $words[] = is_bool($v) ? ($v ? 'true' : 'false') : (string)$v;
            }
            if (!$doc) { $blank++; continue; }
            $rowNo++; $inserted++;
            $batch[] = [$rowNo, json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION), mb_strtolower(mb_substr(implode(' ', $words), 0, 4000))];
            if (count($batch) >= 400) $flush();
            if ($inserted > $cfg['max_rows']) throw new DiException('Too many rows.');
        }
        $flush();
        if ($inserted === 0) { $pdo->rollBack(); diFail('Nothing was imported: the selected columns have no data.'); }

        $entry = ['at' => gmdate('c'), 'file' => $meta['name'], 'sheet' => $src->sheetName, 'rows' => $inserted, 'by' => $u['name'], 'mode' => $mode];
        $pdo->prepare("UPDATE import_datasets SET columns = CAST(? AS jsonb), row_count = row_count + ?, imports = imports || CAST(? AS jsonb), updated_at = now() WHERE id = ?")
            ->execute([json_encode($cols, JSON_UNESCAPED_UNICODE), $inserted, json_encode([$entry], JSON_UNESCAPED_UNICODE), $dsId]);
        audit($pdo, $u, 'import', 'dataset', $dsId, "Imported $inserted rows from {$meta['name']} into dataset \"$dsName\"" . ($mode === 'append' ? ' (appended)' : ''),
              ['file' => $meta['name'], 'rows' => $inserted, 'columns' => count($use), 'mode' => $mode]);
        $pdo->commit();
    } catch (DiException $e) { if ($pdo->inTransaction()) $pdo->rollBack(); diFail($e->getMessage()); }
    catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }

    diDropStage($meta['token']);
    $warn = [];
    foreach ($fails as $n => $c) $warn[] = "Column \"$n\": $c value" . ($c > 1 ? 's did' : ' did') . ' not fit the chosen type and ' . ($c > 1 ? 'were' : 'was') . ' stored as text.';
    respond(['ok' => true, 'dataset' => ['id' => $dsId, 'name' => $dsName, 'mode' => $mode], 'imported' => $inserted, 'blank_rows_skipped' => $blank, 'warnings' => $warn]);
}

/* ---------------- browse ---------------- */
function diDatasetRow(array $r): array {
    return ['id' => $r['id'], 'name' => $r['name'], 'description' => $r['description'], 'source_file' => $r['source_file'], 'source_kind' => $r['source_kind'],
            'sheet_name' => $r['sheet_name'], 'columns' => json_decode($r['columns'], true) ?: [], 'row_count' => (int)$r['row_count'],
            'imports' => json_decode($r['imports'] ?? '[]', true) ?: [], 'created_by_name' => $r['created_by_name'], 'created_at' => $r['created_at'], 'updated_at' => $r['updated_at']];
}
function diGetDataset(PDO $pdo, string $id): array {
    $st = $pdo->prepare('SELECT * FROM import_datasets WHERE id = ?'); $st->execute([$id]);
    $r = $st->fetch();
    if (!$r) diFail('Dataset not found.', 404);
    return diDatasetRow($r);
}
function importDatasets(): void {
    global $pdo;
    requirePerm($pdo, 'import.manage'); diBoot($pdo);
    $rows = $pdo->query('SELECT * FROM import_datasets ORDER BY updated_at DESC')->fetchAll();
    respond(['ok' => true, 'datasets' => array_map('diDatasetRow', $rows)]);
}
function importRows(): void {
    global $pdo;
    requirePerm($pdo, 'import.manage'); diBoot($pdo);
    $ds = diGetDataset($pdo, (string)($_GET['id'] ?? ''));
    $per = max(1, min(200, (int)($_GET['per'] ?? 50))); $page = max(1, (int)($_GET['page'] ?? 1));
    $where = 'dataset_id = ' . $pdo->quote($ds['id']);
    $q = trim((string)($_GET['q'] ?? ''));
    if ($q !== '') $where .= ' AND search LIKE ' . $pdo->quote('%' . addcslashes(mb_strtolower($q), '%_\\') . '%');
    $order = 'row_no ASC';
    $keys = array_column($ds['columns'], 'key');
    $sort = (string)($_GET['sort'] ?? '');
    if ($sort !== '' && in_array($sort, $keys, true)) $order = 'data -> ' . $pdo->quote($sort) . '::text ' . (($_GET['dir'] ?? 'asc') === 'desc' ? 'DESC' : 'ASC') . ' NULLS LAST, row_no ASC';
    $total = (int)$pdo->query("SELECT COUNT(*) FROM import_rows WHERE $where")->fetchColumn();
    $st = $pdo->query("SELECT row_no, data::text AS data FROM import_rows WHERE $where ORDER BY $order LIMIT $per OFFSET " . (($page - 1) * $per));
    $rows = [];
    foreach ($st->fetchAll() as $r) $rows[] = ['n' => (int)$r['row_no'], 'd' => json_decode($r['data'], true)];
    respond(['ok' => true, 'dataset' => ['id' => $ds['id'], 'name' => $ds['name'], 'columns' => $ds['columns'], 'row_count' => $ds['row_count']],
             'rows' => $rows, 'total' => $total, 'page' => $page, 'per' => $per]);
}

/* ---------------- manage ---------------- */
function importUpdate(): void {
    global $pdo;
    $u = requirePerm($pdo, 'import.manage'); diBoot($pdo);
    $in = input(); $ds = diGetDataset($pdo, (string)($in['id'] ?? ''));
    $name = trim((string)($in['name'] ?? $ds['name'])); if ($name === '') diFail('Give the dataset a name.');
    $pdo->prepare('UPDATE import_datasets SET name = ?, description = ?, updated_at = now() WHERE id = ?')
        ->execute([mb_substr($name, 0, 200), mb_substr(trim((string)($in['description'] ?? $ds['description'])), 0, 2000), $ds['id']]);
    audit($pdo, $u, 'update', 'dataset', $ds['id'], "Renamed/edited dataset \"{$ds['name']}\"");
    respond(['ok' => true]);
}
function importDelete(): void {
    global $pdo;
    $u = requirePerm($pdo, 'import.manage'); diBoot($pdo);
    $ds = diGetDataset($pdo, (string)(input()['id'] ?? ''));
    $pdo->prepare('DELETE FROM import_datasets WHERE id = ?')->execute([$ds['id']]);
    audit($pdo, $u, 'delete', 'dataset', $ds['id'], "Deleted dataset \"{$ds['name']}\" ({$ds['row_count']} rows)", ['rows' => $ds['row_count']]);
    respond(['ok' => true]);
}

/* ---------------- export ---------------- */
/** Spreadsheet formula-injection guard for CSV export (same idea as downloadCsv() in js/core.js): a text cell that
 *  starts with = @ TAB CR — or with + / - when it is not just a number/phone — is prefixed with an apostrophe, so Excel
 *  shows it as text instead of running it. Numbers, booleans and phone-like values such as +254712345678 are untouched. */
function diCsvSafe(mixed $v): mixed {
    if (!is_string($v) || $v === '') return $v;
    $c = $v[0];
    if ($c === '=' || $c === '@' || $c === "\t" || $c === "\r") return "'" . $v;
    if (($c === '+' || $c === '-') && !preg_match('/^[+-]?[\d\s().,-]+$/', $v)) return "'" . $v;
    return $v;
}
function importExport(): void {
    global $pdo;
    requirePerm($pdo, 'import.manage'); diBoot($pdo);
    @set_time_limit(300);
    $ds = diGetDataset($pdo, (string)($_GET['id'] ?? ''));
    $fmt = ($_GET['format'] ?? 'csv') === 'json' ? 'json' : 'csv';
    $file = trim((string)preg_replace('/[^\p{L}\p{N}_-]+/u', '_', $ds['name']), '_') ?: 'dataset';
    header_remove('Cache-Control');
    header('Cache-Control: no-store');
    header('Content-Type: ' . ($fmt === 'csv' ? 'text/csv' : 'application/json') . '; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $file . '.' . $fmt . '"');
    $out = fopen('php://output', 'wb');
    $cols = $ds['columns'];
    if ($fmt === 'csv') { fwrite($out, "\xEF\xBB\xBF"); fputcsv($out, array_map('diCsvSafe', array_column($cols, 'name')), ',', '"', ''); }
    else fwrite($out, "[\n");
    $last = 0; $first = true;
    $st = $pdo->prepare('SELECT id, data::text AS data FROM import_rows WHERE dataset_id = ? AND id > ? ORDER BY id LIMIT 2000');
    while (true) {
        $st->execute([$ds['id'], $last]);
        $rows = $st->fetchAll();
        if (!$rows) break;
        foreach ($rows as $r) {
            $last = (int)$r['id']; $d = json_decode($r['data'], true);
            if ($fmt === 'csv') {
                $line = [];
                foreach ($cols as $c) { $v = $d[$c['key']] ?? null; $line[] = $v === null ? '' : (is_bool($v) ? ($v ? 'true' : 'false') : diCsvSafe($v)); }
                fputcsv($out, $line, ',', '"', '');
            } else {
                $o = [];
                foreach ($cols as $c) $o[$c['name']] = $d[$c['key']] ?? null;
                fwrite($out, ($first ? '' : ",\n") . json_encode($o, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION));
                $first = false;
            }
        }
    }
    if ($fmt === 'json') fwrite($out, "\n]\n");
    fclose($out);
    exit;
}
