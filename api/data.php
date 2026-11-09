<?php
// api/data.php — reading and writing the module data (school_data) safely:
//   * record-level diffs, so the audit log can say exactly what changed
//   * per-key permission checks (see dataKeys() in rbac.php)
//   * optimistic-lock saves (version counter)
//   * automatic "effects" used by the approval workflow engine
// Values are stored exactly as the browser sent them (objects stay objects,
// so an empty {} never turns into [] and silently loses data).

function isList(array $a): bool {
    if ($a === []) return true;
    return array_keys($a) === range(0, count($a) - 1);
}

function recLabel($r): string {
    if (!is_array($r)) return '';
    foreach (['name', 'title', 'description', 'regNo', 'tag', 'subject', 'item', 'borrower', 'category', 'type'] as $f) {
        if (isset($r[$f]) && is_scalar($r[$f]) && (string)$r[$f] !== '') return (string)$r[$f];
    }
    return (string)($r['id'] ?? '');
}

function shortText($v, int $n = 80): string {
    if (is_array($v) || is_object($v)) $v = json_encode($v);
    $s = (string)$v;
    return mb_strlen($s) > $n ? mb_substr($s, 0, $n - 1) . '…' : $s;
}

function trimVal($v) {
    if ($v === null || is_bool($v) || is_int($v) || is_float($v)) return $v;
    return shortText($v, 300);
}

/** Recursively compares two decoded JSON values and lists changed leaves. */
function diffLeaves($old, $new, string $path, array &$out): void {
    if (count($out) >= 60) return;
    $oldMap   = is_array($old) && !isList($old);
    $newMap   = is_array($new) && !isList($new);
    $oldEmpty = ($old === null || $old === []);
    $newEmpty = ($new === null || $new === []);
    if (($oldMap && ($newMap || $newEmpty)) || ($newMap && $oldEmpty)) {
        $keys = array_unique(array_merge(array_keys((array)$old), array_keys((array)$new)));
        foreach ($keys as $k) {
            $o = (is_array($old) && array_key_exists($k, $old)) ? $old[$k] : null;
            $n = (is_array($new) && array_key_exists($k, $new)) ? $new[$k] : null;
            diffLeaves($o, $n, $path === '' ? (string)$k : $path . '.' . $k, $out);
        }
        return;
    }
    if (json_encode($old) !== json_encode($new)) {
        $out[] = ['path' => $path, 'old' => trimVal($old), 'new' => trimVal($new)];
    }
}

/** Describes what changed between the stored value and the submitted value of one key. */
function computeDiff(string $key, $old, $new): array {
    $info = ['map' => false, 'created' => [], 'deleted' => [], 'updated' => [], 'changes' => []];
    if (in_array($key, MAP_KEYS, true)) {
        $info['map'] = true;
        diffLeaves($old, $new, '', $info['changes']);
        return $info;
    }
    $oldList = is_array($old) ? $old : [];
    $newList = is_array($new) ? $new : [];
    $om = [];
    $nm = [];
    foreach ($oldList as $r) { if (is_array($r) && isset($r['id'])) $om[(string)$r['id']] = $r; }
    foreach ($newList as $r) { if (is_array($r) && isset($r['id'])) $nm[(string)$r['id']] = $r; }
    foreach ($nm as $id => $r) {
        if (!isset($om[$id])) {
            $info['created'][$id] = $r;
        } else {
            $ch = [];
            diffLeaves($om[$id], $r, '', $ch);
            if ($ch) $info['updated'][$id] = ['rec' => $r, 'changes' => $ch];
        }
    }
    foreach ($om as $id => $r) { if (!isset($nm[$id])) $info['deleted'][$id] = $r; }
    return $info;
}

function diffHasChanges(array $info): bool {
    if ($info['map']) return count($info['changes']) > 0;
    return $info['created'] || $info['deleted'] || $info['updated'];
}

/** Returns an error message if this user may not make the described change, else null. */
function authorizeWrite(array $u, string $key, array $info): ?string {
    $cfg    = dataKeys()[$key];
    $entity = substr($key, 3);
    // Leave: someone who can only *request* leave (no staff.manage) may add new
    // Pending requests — never approve, edit or delete (their own or anyone's).
    if ($key === 'em_leave' && !userCan($u, 'staff.manage')) {
        if (!userCan($u, 'leave.request')) return 'You do not have permission to change leave.';
        if (!empty($info['deleted']) || !empty($info['updated'])) return 'Only HR can change or cancel a leave request once it is submitted.';
        foreach ((array)($info['created'] ?? []) as $r) {
            if (strcasecmp(trim((string)($r['status'] ?? '')), 'Pending') !== 0) return 'New leave requests must start as Pending — HR decides them.';
        }
        return null;
    }
    if (userCanAny($u, $cfg['write'])) {
        if (!empty($info['deleted']) && !userCanAny($u, $cfg['delete'] ?? $cfg['write'])) {
            return 'You do not have permission to delete records from ' . $entity . '.';
        }
        return null;
    }
    foreach ($cfg['limited'] as $perm => $fields) {
        if (!userCan($u, $perm)) continue;
        if (!empty($info['created']) || !empty($info['deleted'])) continue;
        $ok = true;
        foreach ($info['updated'] as $upd) {
            foreach ($upd['changes'] as $c) {
                $top = explode('.', (string)$c['path'])[0];
                if (!in_array($top, $fields, true)) $ok = false;
            }
        }
        if ($ok) return null;
    }
    return 'You do not have permission to change ' . $entity . '.';
}

/** Writes one audit row per changed record. */
function auditDiff(PDO $pdo, array $u, string $key, array $info, string $note = ''): void {
    $entity = substr($key, 3);
    $suffix = $note !== '' ? ' (' . $note . ')' : '';
    if ($info['map']) {
        audit($pdo, $u, 'update', $entity, null, 'Changed ' . count($info['changes']) . ' value(s) in ' . $entity . $suffix, ['changes' => $info['changes']]);
        return;
    }
    $count = 0;
    foreach ($info['created'] as $id => $r) {
        if ($count++ >= 200) return;
        audit($pdo, $u, 'create', $entity, (string)$id, 'Added ' . $entity . ': ' . shortText(recLabel($r), 100) . $suffix, null);
    }
    foreach ($info['updated'] as $id => $x) {
        if ($count++ >= 200) return;
        $fields = [];
        foreach ($x['changes'] as $c) { $fields[] = explode('.', (string)$c['path'])[0]; }
        $fields = array_values(array_unique($fields));
        audit($pdo, $u, 'update', $entity, (string)$id,
            'Updated ' . $entity . ': ' . shortText(recLabel($x['rec']), 100) . ' — ' . implode(', ', array_slice($fields, 0, 6)) . $suffix,
            ['changes' => $x['changes']]);
    }
    foreach ($info['deleted'] as $id => $r) {
        if ($count++ >= 200) return;
        audit($pdo, $u, 'delete', $entity, (string)$id, 'Deleted ' . $entity . ': ' . shortText(recLabel($r), 100) . $suffix, ['record' => $r]);
    }
}

/* ---------------- storage ---------------- */
function loadKeyRow(PDO $pdo, string $key, bool $lock = false): ?array {
    $stmt = $pdo->prepare('SELECT value::text AS value, version FROM school_data WHERE key = ?' . ($lock ? ' FOR UPDATE' : ''));
    $stmt->execute([$key]);
    $r = $stmt->fetch();
    return $r ?: null;
}

function storeKey(PDO $pdo, string $key, string $jsonText): int {
    $stmt = $pdo->prepare(
        'INSERT INTO school_data (key, value, version, updated_at) VALUES (?, CAST(? AS jsonb), 1, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = school_data.version + 1, updated_at = now()
         RETURNING version'
    );
    $stmt->execute([$key, $jsonText]);
    return (int)$stmt->fetchColumn();
}

/** Decoded (associative) value of a key, or $default when it does not exist. */
function loadAssoc(PDO $pdo, string $key, $default = []) {
    $row = loadKeyRow($pdo, $key);
    if (!$row) return $default;
    $v = json_decode($row['value'], true);
    return $v === null ? $default : $v;
}

/* ---------------- workflow effects ---------------- */
function validateEffects(array $wf, $list): ?string {
    if ($list === null) return null;
    if (!is_array($list)) return 'Effects must be a list.';
    if (count($list) > 20) return 'Too many effects.';
    $dk = dataKeys();
    foreach ($list as $e) {
        if (!is_object($e)) return 'Invalid effect.';
        $key = $e->key ?? '';
        $op  = $e->op ?? '';
        if (!is_string($key) || !in_array($key, $wf['keys'], true) || !isset($dk[$key])) return 'This workflow may not change ' . (is_string($key) ? $key : 'that data') . '.';
        $isMap = in_array($key, MAP_KEYS, true);
        switch ($op) {
            case 'append':
                if ($isMap || !isset($e->item) || !is_object($e->item) || empty($e->item->id)) return 'Invalid append effect.';
                break;
            case 'patch':
                if ($isMap || empty($e->id) || !isset($e->set) || !is_object($e->set) || isset($e->set->id)) return 'Invalid patch effect.';
                break;
            case 'inc':
                if ($isMap || empty($e->id) || empty($e->field) || !isset($e->by) || !is_numeric($e->by)) return 'Invalid increment effect.';
                break;
            case 'delete':
                if ($isMap || empty($e->id)) return 'Invalid delete effect.';
                break;
            case 'set_path':
                if (!$isMap || !isset($e->path) || !is_array($e->path) || count($e->path) < 1 || count($e->path) > 6) return 'Invalid set_path effect.';
                foreach ($e->path as $seg) {
                    if ((!is_string($seg) && !is_int($seg)) || $seg === '') return 'Invalid set_path effect.';
                }
                break;
            default:
                return 'Unknown effect operation.';
        }
    }
    return null;
}

function applyEffect($val, stdClass $e) {
    switch ($e->op) {
        case 'append':
            $val[] = $e->item;
            break;
        case 'patch':
            foreach ($val as $r) {
                if (is_object($r) && isset($r->id) && $r->id === $e->id) {
                    foreach ($e->set as $f => $v) { $r->$f = $v; }
                }
            }
            break;
        case 'inc':
            $f = (string)$e->field;
            foreach ($val as $r) {
                if (is_object($r) && isset($r->id) && $r->id === $e->id) {
                    $r->$f = ((isset($r->$f) && is_numeric($r->$f)) ? $r->$f : 0) + $e->by;
                }
            }
            break;
        case 'delete':
            $val = array_values(array_filter($val, function ($r) use ($e) { return !(is_object($r) && isset($r->id) && $r->id === $e->id); }));
            break;
        case 'set_path':
            $node = $val;
            $last = count($e->path) - 1;
            foreach ($e->path as $i => $seg) {
                $seg = (string)$seg;
                if ($i === $last) {
                    $node->$seg = $e->value;
                } else {
                    if (!isset($node->$seg) || !is_object($node->$seg)) { $node->$seg = new stdClass(); }
                    $node = $node->$seg;
                }
            }
            break;
    }
    return $val;
}

/** Applies validated effects inside the caller's transaction, auditing every change. */
function applyEffectList(PDO $pdo, array $actor, array $effects, string $note): void {
    $byKey = [];
    foreach ($effects as $e) { $byKey[$e->key][] = $e; }
    foreach ($byKey as $key => $list) {
        $row   = loadKeyRow($pdo, $key, true);
        $val   = $row ? json_decode($row['value']) : null;
        $old   = $row ? json_decode($row['value'], true) : null;
        if (in_array($key, MAP_KEYS, true)) {
            if (!is_object($val)) $val = new stdClass();
        } else {
            if (!is_array($val)) $val = [];
        }
        foreach ($list as $e) { $val = applyEffect($val, $e); }
        $newJson = json_encode($val);
        $info    = computeDiff($key, $old, json_decode($newJson, true));
        if (diffHasChanges($info)) {
            storeKey($pdo, $key, $newJson);
            auditDiff($pdo, $actor, $key, $info, $note);
            notifQueue($key, $info, $old, json_decode($newJson, true));   // flushed by the caller after commit
        }
    }
}


/** Users who may enter marks on any exam, open or not (the exam office and the principal). */
function canBypassExamOpen(array $u): bool { return userCanAny($u, ['exams.manage', 'marks.approve']); }

/** Is this exam currently open for teachers to enter marks? (set by the exam office) */
function examIsOpenForEntry($e): bool {
    if (!is_array($e)) return false;
    $st = (string)($e['status'] ?? 'Draft');
    if ($st === 'In Review' || $st === 'Published') return false;
    return strcasecmp(trim((string)($e['open'] ?? '')), 'Yes') === 0;
}

/** For em_marks / em_comments: teachers may only change exams that are open. Returns an error or null. */
function authorizeMarksOpen(PDO $pdo, array $u, string $key, $old, $new): ?string {
    if ($key !== 'em_marks' && $key !== 'em_comments') return null;
    if (canBypassExamOpen($u)) return null;
    $old = is_array($old) ? $old : []; $new = is_array($new) ? $new : [];
    $exams = [];
    foreach (loadAssoc($pdo, 'em_exams', []) as $e) { if (is_array($e) && isset($e['id'])) $exams[(string)$e['id']] = $e; }
    foreach (array_unique(array_merge(array_keys($old), array_keys($new))) as $eid) {
        $a = array_key_exists($eid, $old) ? $old[$eid] : null;
        $b = array_key_exists($eid, $new) ? $new[$eid] : null;
        if (json_encode($a) === json_encode($b)) continue;
        if (!isset($exams[(string)$eid]) || !examIsOpenForEntry($exams[(string)$eid])) {
            return 'Marks can only be entered while the exam is open. Ask the exam office to open it first.';
        }
    }
    return null;
}
