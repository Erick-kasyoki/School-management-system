<?php
// api/handlers/approvals.php — the multi-step approval workflow engine:
// list/create/act-on/cancel approval requests (see workflowDefs() in rbac.php).

function approvalRowOut(array $r, array $u): array {
    $steps = json_decode((string)$r['steps'], true) ?: [];
    $cur   = (int)$r['current_step'];
    $step  = $steps[$cur] ?? null;
    $canAct = $r['status'] === 'Pending' && $step && userCan($u, $step['perm'])
              && ($r['requested_by'] !== $u['id'] || $u['is_admin']);
    return [
        'id' => $r['id'], 'type' => $r['type'], 'title' => $r['title'], 'description' => $r['description'],
        'steps' => $steps, 'current_step' => $cur, 'status' => $r['status'],
        'requested_by' => $r['requested_by'], 'requested_by_name' => $r['requested_by_name'],
        'created_at' => $r['created_at'], 'updated_at' => $r['updated_at'],
        'can_act' => (bool)$canAct, 'mine' => $r['requested_by'] === $u['id'],
    ];
}

function approvalsList(): void {
    global $pdo;
    $u = requireUser($pdo);
    if (!userCan($u, 'approvals.view')) respond(['ok' => true, 'approvals' => []]);
    $rows = $pdo->query('SELECT id, type, title, description, steps::text AS steps, current_step, status, requested_by, requested_by_name, created_at, updated_at FROM approvals ORDER BY created_at DESC LIMIT 300')->fetchAll();
    $viewAll = userCan($u, 'approvals.view_all');
    $out = [];
    foreach ($rows as $r) {
        $item = approvalRowOut($r, $u);
        $involved = $item['mine'];
        foreach ($item['steps'] as $s) { if (userCan($u, $s['perm'])) $involved = true; }
        if ($viewAll || $involved) $out[] = $item;
    }
    respond(['ok' => true, 'approvals' => $out]);
}

function approvalCreate(): void {
    global $pdo;
    $u    = requireUser($pdo);
    $raw  = inputObject();
    $type = (string)($raw->type ?? '');
    $defs = workflowDefs();
    if (!isset($defs[$type])) respond(['ok' => false, 'error' => 'Unknown workflow.'], 400);
    $wf = $defs[$type];
    if (!userCan($u, $wf['request'])) respond(['ok' => false, 'error' => 'You are not allowed to raise this kind of request.'], 403);

    $title = trim((string)($raw->title ?? ''));
    $desc  = trim((string)($raw->description ?? ''));
    if ($title === '') respond(['ok' => false, 'error' => 'A title is required.'], 400);
    $eff = (isset($raw->effects) && is_object($raw->effects)) ? $raw->effects : new stdClass();
    foreach (['on_create', 'on_approve', 'on_reject'] as $phase) {
        $err = validateEffects($wf, $eff->$phase ?? null);
        if ($err) respond(['ok' => false, 'error' => $err], 400);
    }
    $steps = [];
    foreach ($wf['steps'] as $s) {
        $steps[] = ['label' => $s[0], 'perm' => $s[1], 'status' => 'pending', 'by' => null, 'by_name' => null, 'at' => null, 'comment' => ''];
    }
    $id = uid('apr');
    $pdo->beginTransaction();
    try {
        $pdo->prepare('INSERT INTO approvals (id, type, title, description, effects, steps, current_step, status, requested_by, requested_by_name) VALUES (?, ?, ?, ?, CAST(? AS jsonb), CAST(? AS jsonb), 0, ?, ?, ?)')
            ->execute([$id, $type, mb_substr($title, 0, 200), mb_substr($desc, 0, 2000), json_encode($eff), json_encode($steps), 'Pending', $u['id'], $u['name']]);
        if (!empty($eff->on_create)) applyEffectList($pdo, $u, $eff->on_create, 'workflow: ' . $wf['label']);
        audit($pdo, $u, 'create', 'approvals', $id, 'Requested approval: ' . $title, ['type' => $type]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    notifFlush($pdo, $u);
    notifyApprovalEvent($pdo, $u, 'created', ['id' => $id, 'title' => $title, 'requested_by' => $u['id'], 'requested_by_name' => $u['name']], $steps, 0);
    respond(['ok' => true, 'id' => $id]);
}

function approvalAct(): void {
    global $pdo;
    $u        = requireUser($pdo);
    $b        = input();
    $id       = trim((string)($b['id'] ?? ''));
    $decision = (string)($b['decision'] ?? '');
    $comment  = mb_substr(trim((string)($b['comment'] ?? '')), 0, 500);
    if (!in_array($decision, ['approve', 'reject'], true)) respond(['ok' => false, 'error' => 'Choose approve or reject.'], 400);

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('SELECT id, type, title, effects::text AS effects, steps::text AS steps, current_step, status, requested_by FROM approvals WHERE id = ? FOR UPDATE');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) { $pdo->rollBack(); respond(['ok' => false, 'error' => 'Request not found.'], 404); }
        if ($row['status'] !== 'Pending') { $pdo->rollBack(); respond(['ok' => false, 'error' => 'This request is already ' . strtolower($row['status']) . '.'], 400); }

        $steps = json_decode($row['steps'], true) ?: [];
        $cur   = (int)$row['current_step'];
        $step  = $steps[$cur] ?? null;
        if (!$step || !userCan($u, $step['perm'])) { $pdo->rollBack(); respond(['ok' => false, 'error' => 'You are not allowed to act on this step (' . ($step['label'] ?? '?') . ').'], 403); }
        if ($row['requested_by'] === $u['id'] && !$u['is_admin']) { $pdo->rollBack(); respond(['ok' => false, 'error' => 'You cannot approve your own request — someone else must.'], 403); }

        $steps[$cur]['status']  = $decision === 'approve' ? 'approved' : 'rejected';
        $steps[$cur]['by']      = $u['id'];
        $steps[$cur]['by_name'] = $u['name'];
        $steps[$cur]['at']      = date('c');
        $steps[$cur]['comment'] = $comment;

        $eff    = json_decode($row['effects']);
        $eff    = is_object($eff) ? $eff : new stdClass();
        $status = 'Pending';
        $newCur = $cur;
        $label  = 'workflow: ' . $row['title'];
        if ($decision === 'reject') {
            $status = 'Rejected';
            if (!empty($eff->on_reject)) applyEffectList($pdo, $u, $eff->on_reject, $label);
        } elseif ($cur + 1 < count($steps)) {
            $newCur = $cur + 1;
        } else {
            $status = 'Approved';
            if (!empty($eff->on_approve)) applyEffectList($pdo, $u, $eff->on_approve, $label);
        }
        $pdo->prepare('UPDATE approvals SET steps = CAST(? AS jsonb), current_step = ?, status = ?, updated_at = now() WHERE id = ?')
            ->execute([json_encode($steps), $newCur, $status, $id]);
        audit($pdo, $u, $decision === 'approve' ? 'approve' : 'reject', 'approvals', $id,
            ($decision === 'approve' ? 'Approved' : 'Rejected') . ' "' . $row['title'] . '" at step: ' . $step['label'] . ($comment !== '' ? ' — ' . $comment : ''), null);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    notifFlush($pdo, $u);
    $evRow = ['id' => $id, 'title' => $row['title'], 'requested_by' => $row['requested_by']];
    if ($status === 'Pending')       notifyApprovalEvent($pdo, $u, 'advanced', $evRow, $steps, $newCur, $comment);
    elseif ($status === 'Approved')  notifyApprovalEvent($pdo, $u, 'approved', $evRow, $steps, $cur, $comment);
    else                             notifyApprovalEvent($pdo, $u, 'rejected', $evRow, $steps, $cur, $comment);
    respond(['ok' => true, 'status' => $status]);
}

function approvalCancel(): void {
    global $pdo;
    $u  = requireUser($pdo);
    $b  = input();
    $id = trim((string)($b['id'] ?? ''));
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('SELECT id, title, effects::text AS effects, steps::text AS steps, current_step, status, requested_by FROM approvals WHERE id = ? FOR UPDATE');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) { $pdo->rollBack(); respond(['ok' => false, 'error' => 'Request not found.'], 404); }
        if ($row['requested_by'] !== $u['id'] && !$u['is_admin']) { $pdo->rollBack(); respond(['ok' => false, 'error' => 'Only the requester can cancel this.'], 403); }
        if ($row['status'] !== 'Pending') { $pdo->rollBack(); respond(['ok' => false, 'error' => 'Only pending requests can be cancelled.'], 400); }
        $eff = json_decode($row['effects']);
        if (is_object($eff) && !empty($eff->on_reject)) applyEffectList($pdo, $u, $eff->on_reject, 'workflow cancelled: ' . $row['title']);
        $pdo->prepare("UPDATE approvals SET status = 'Cancelled', updated_at = now() WHERE id = ?")->execute([$id]);
        audit($pdo, $u, 'update', 'approvals', $id, 'Cancelled request: ' . $row['title'], null);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    notifFlush($pdo, $u);
    $cs = json_decode((string)($row['steps'] ?? '[]'), true);
    notifyApprovalEvent($pdo, $u, 'cancelled', ['id' => $id, 'title' => $row['title'], 'requested_by' => $row['requested_by']], is_array($cs) ? $cs : [], (int)($row['current_step'] ?? 0));
    respond(['ok' => true]);
}

