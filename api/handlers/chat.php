<?php
// api/handlers/chat.php — live staff chat.
//
//   chat_channels        GET   my channels + unread counts
//   chat_staff           GET   every active staff member (for the "new channel" picker)
//   chat_channel_create  POST  new channel (private = invited people, public = all staff, moderators only)
//   chat_add_members     POST  add people to a private channel (host / moderator)
//   chat_poll            GET   new messages, feedback receipts, members + who is online, session state
//   chat_send            POST  send a message to everyone in the channel, or only to chosen people
//   chat_feedback        POST  recipient feedback on a message: ack | done | question | declined
//   chat_clear_mine      POST  "Clear my view" — hides the history for me only
//   chat_end             POST  end the session AND clear the chat for everyone (host / moderator)
//   chat_restart         POST  start a fresh session in an ended channel (host / moderator)
//
// "Live" = the browser polls chat_poll every few seconds. The PHP session is released
// (session_write_close) before the slow work so polling never blocks the user's other requests.
//
// Privacy rule: a message with a non-empty to_ids is visible ONLY to its sender and those recipients.
// A message with an empty to_ids is visible to everyone in the channel.

const CHAT_FEEDBACK = ['ack', 'done', 'question', 'declined'];
const CHAT_MAX_BODY = 2000;
const CHAT_ONLINE_SECONDS = 45;

/* ---------------- helpers ---------------- */

/** Logged-in staff only (students/parents never get chat) with the communication.view permission. */
function chatUser(PDO $pdo): array {
    $u = requireUser($pdo);
    if (accountKind((string)$u['role_key']) !== 'staff' || !userCan($u, 'communication.view')) {
        respond(['ok' => false, 'error' => 'Staff chat is only available to school staff.'], 403);
    }
    return $u;
}

function chatIsMod(array $u): bool {
    return !empty($u['is_admin']) || userCan($u, 'chat.moderate');
}

/** Releases the session lock so a polling request can't hold up the same user's other requests. */
function chatReleaseSession(): void {
    if (session_status() === PHP_SESSION_ACTIVE) { session_write_close(); }
}

function chatIso($ts): ?string {
    if ($ts === null || $ts === '') return null;
    $t = strtotime((string)$ts);
    return $t === false ? null : gmdate('c', $t);
}

/** SQL fragment: "this message is visible to $me". Adds its own uniquely-named params. */
function chatVis(string $alias, string $sfx, array &$params, string $me): string {
    $params[':vm' . $sfx] = $me;
    $params[':vj' . $sfx] = json_encode($me);
    return "(jsonb_array_length($alias.to_ids) = 0 OR $alias.sender_id = :vm$sfx OR $alias.to_ids @> CAST(:vj$sfx AS jsonb))";
}

/** id => name for every account (small school; one cheap query). */
function chatNames(PDO $pdo): array {
    $out = [];
    foreach ($pdo->query('SELECT id, name FROM staff_accounts') as $r) { $out[$r['id']] = $r['name']; }
    return $out;
}

/** The default channel every school gets, created once. */
function chatEnsureDefaults(PDO $pdo): void {
    $n = (int)$pdo->query('SELECT COUNT(*) FROM chat_channels')->fetchColumn();
    if ($n > 0) return;
    $stmt = $pdo->prepare(
        "INSERT INTO chat_channels (id, name, topic, kind, created_by, created_by_name)
         VALUES ('ch_staffroom', 'Staff Room', 'Everyone on the staff — general chat', 'public', 'system', 'System')
         ON CONFLICT (id) DO NOTHING"
    );
    $stmt->execute();
}

/** Public channels include every staff member: make sure this person has a membership row in each. */
function chatJoinPublic(PDO $pdo, string $userId): void {
    $stmt = $pdo->prepare(
        "INSERT INTO chat_members (channel_id, user_id, last_read_id)
         SELECT c.id, CAST(:uid AS varchar), COALESCE((SELECT MAX(m.id) FROM chat_messages m WHERE m.channel_id = c.id), 0)
           FROM chat_channels c WHERE c.kind = 'public'
         ON CONFLICT (channel_id, user_id) DO NOTHING"
    );
    $stmt->execute([':uid' => $userId]);
}

/** Loads a channel and checks the caller belongs to it. Returns [channel row, member row]. */
function chatChannelFor(PDO $pdo, array $u, string $cid): array {
    $stmt = $pdo->prepare('SELECT * FROM chat_channels WHERE id = ?');
    $stmt->execute([$cid]);
    $ch = $stmt->fetch();
    if (!$ch) respond(['ok' => false, 'error' => 'That channel no longer exists.'], 404);
    $stmt = $pdo->prepare('SELECT * FROM chat_members WHERE channel_id = ? AND user_id = ?');
    $stmt->execute([$cid, $u['id']]);
    $mem = $stmt->fetch();
    if (!$mem && $ch['kind'] === 'public') {   // everyone on the staff belongs to a public channel
        chatJoinPublic($pdo, $u['id']);
        $stmt->execute([$cid, $u['id']]);
        $mem = $stmt->fetch();
    }
    if (!$mem) respond(['ok' => false, 'error' => 'You are not a member of this channel.'], 403);
    return [$ch, $mem];
}

function chatShapeChannel(array $ch, array $u, array $extra = []): array {
    $isHost = ($ch['created_by'] === $u['id']);
    return array_merge([
        'id'                 => $ch['id'],
        'name'               => $ch['name'],
        'topic'              => $ch['topic'],
        'kind'               => $ch['kind'],
        'created_by'         => $ch['created_by'],
        'created_by_name'    => $ch['created_by_name'],
        'status'             => $ch['status'],
        'session_no'         => (int)$ch['session_no'],
        'session_started_at' => chatIso($ch['session_started_at']),
        'ended_at'           => chatIso($ch['ended_at']),
        'ended_by'           => $ch['ended_by'],
        'is_host'            => $isHost,
        'can_end'            => $isHost || chatIsMod($u),
    ], $extra);
}

/** Active staff accounts (never students/parents), with an "online" flag from the session registry. */
function chatStaffRows(PDO $pdo, ?string $onlyChannel = null): array {
    $sql = "SELECT s.id, s.name, COALESCE(r.label, s.role) AS role,
                   EXISTS (SELECT 1 FROM active_sessions a
                            WHERE a.user_id = s.id AND a.last_activity_at > now() - interval '" . CHAT_ONLINE_SECONDS . " seconds') AS online
              FROM staff_accounts s LEFT JOIN roles r ON r.role_key = s.role_key
             WHERE s.is_active = true AND s.role_key NOT IN ('student', 'parent')
               AND (s.access_expires_at IS NULL OR s.access_expires_at > now())";
    $params = [];
    if ($onlyChannel !== null) {
        $sql .= ' AND s.id IN (SELECT user_id FROM chat_members WHERE channel_id = :cid)';
        $params[':cid'] = $onlyChannel;
    }
    $sql .= ' ORDER BY s.name';
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $out = [];
    foreach ($stmt->fetchAll() as $r) {
        $out[] = ['id' => $r['id'], 'name' => $r['name'], 'role' => $r['role'], 'online' => toBool($r['online'])];
    }
    return $out;
}

/** Keeps only ids that belong to real, active staff. */
function chatValidStaffIds(PDO $pdo, array $ids): array {
    $ids = array_values(array_unique(array_filter(array_map('strval', $ids), function ($x) { return $x !== ''; })));
    if (!$ids) return [];
    $valid = [];
    foreach (chatStaffRows($pdo) as $r) { $valid[$r['id']] = true; }
    return array_values(array_filter($ids, function ($id) use ($valid) { return isset($valid[$id]); }));
}

function chatSystemMessage(PDO $pdo, string $cid, string $text): void {
    $stmt = $pdo->prepare("INSERT INTO chat_messages (channel_id, sender_id, sender_name, body, is_system) VALUES (?, 'system', 'System', ?, true)");
    $stmt->execute([$cid, $text]);
}

/* ---------------- channels ---------------- */

function chatChannels(): void {
    global $pdo;
    $u = chatUser($pdo);
    chatReleaseSession();
    chatEnsureDefaults($pdo);
    chatJoinPublic($pdo, $u['id']);

    $params = [':me' => $u['id'], ':me2' => $u['id']];
    $vis = chatVis('m', '1', $params, $u['id']);
    $sql = "SELECT c.*,
                   (SELECT COUNT(*) FROM chat_messages m
                     WHERE m.channel_id = c.id AND m.is_system = false AND m.sender_id <> :me
                       AND m.id > GREATEST(cm.last_read_id, cm.cleared_before) AND $vis) AS unread,
                   (SELECT COUNT(*) FROM chat_members x WHERE x.channel_id = c.id) AS member_count
              FROM chat_channels c
              JOIN chat_members cm ON cm.channel_id = c.id AND cm.user_id = :me2
             ORDER BY (c.kind = 'public') DESC, c.name";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);

    $staffCount = count(chatStaffRows($pdo));
    $out = [];
    $total = 0;
    foreach ($stmt->fetchAll() as $ch) {
        $unread = ($ch['status'] === 'ended') ? 0 : (int)$ch['unread'];
        $total += $unread;
        $out[] = chatShapeChannel($ch, $u, [
            'unread'       => $unread,
            'member_count' => $ch['kind'] === 'public' ? $staffCount : (int)$ch['member_count'],
        ]);
    }
    respond(['ok' => true, 'channels' => $out, 'unread_total' => $total, 'can_create_public' => chatIsMod($u)]);
}

function chatStaff(): void {
    global $pdo;
    $u = chatUser($pdo);
    chatReleaseSession();
    $rows = array_values(array_filter(chatStaffRows($pdo), function ($r) use ($u) { return $r['id'] !== $u['id']; }));
    respond(['ok' => true, 'staff' => $rows]);
}

function chatChannelCreate(): void {
    global $pdo;
    $u = chatUser($pdo);
    $in = input();
    $name = trim((string)($in['name'] ?? ''));
    $topic = trim((string)($in['topic'] ?? ''));
    $kind = (($in['kind'] ?? 'private') === 'public') ? 'public' : 'private';
    if (mb_strlen($name) < 2 || mb_strlen($name) > 60) respond(['ok' => false, 'error' => 'Give the channel a name of 2 to 60 characters.'], 422);
    if (mb_strlen($topic) > 200) respond(['ok' => false, 'error' => 'The topic is too long (200 characters max).'], 422);
    if ($kind === 'public' && !chatIsMod($u)) respond(['ok' => false, 'error' => 'Only a moderator can create a channel for all staff.'], 403);

    $members = chatValidStaffIds($pdo, is_array($in['members'] ?? null) ? $in['members'] : []);
    $members = array_values(array_filter($members, function ($id) use ($u) { return $id !== $u['id']; }));
    if ($kind === 'private' && !$members) respond(['ok' => false, 'error' => 'Pick at least one colleague for a private channel.'], 422);

    $id = uid('ch');
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('INSERT INTO chat_channels (id, name, topic, kind, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?)');
        $stmt->execute([$id, $name, $topic, $kind, $u['id'], $u['name']]);
        $ins = $pdo->prepare('INSERT INTO chat_members (channel_id, user_id) VALUES (?, ?) ON CONFLICT (channel_id, user_id) DO NOTHING');
        $ins->execute([$id, $u['id']]);
        if ($kind === 'private') {
            foreach ($members as $m) { $ins->execute([$id, $m]); }
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    audit($pdo, $u, 'create', 'chat_channel', $id, 'Created ' . $kind . ' chat channel "' . $name . '"');
    respond(['ok' => true, 'id' => $id]);
}

function chatAddMembers(): void {
    global $pdo;
    $u = chatUser($pdo);
    $in = input();
    [$ch] = chatChannelFor($pdo, $u, (string)($in['channel_id'] ?? ''));
    if ($ch['kind'] !== 'private') respond(['ok' => false, 'error' => 'Everyone on the staff is already in a public channel.'], 422);
    if ($ch['created_by'] !== $u['id'] && !chatIsMod($u)) respond(['ok' => false, 'error' => 'Only the host or a moderator can add people.'], 403);

    $ids = chatValidStaffIds($pdo, is_array($in['members'] ?? null) ? $in['members'] : []);
    if (!$ids) respond(['ok' => false, 'error' => 'Pick at least one colleague to add.'], 422);
    $names = chatNames($pdo);
    $ins = $pdo->prepare(
        'INSERT INTO chat_members (channel_id, user_id, last_read_id)
         VALUES (?, ?, COALESCE((SELECT MAX(id) FROM chat_messages WHERE channel_id = ?), 0))
         ON CONFLICT (channel_id, user_id) DO NOTHING'
    );
    $added = [];
    foreach ($ids as $id) {
        $ins->execute([$ch['id'], $id, $ch['id']]);
        if ($ins->rowCount() > 0) $added[] = $names[$id] ?? $id;
    }
    if ($added && $ch['status'] === 'active') {
        chatSystemMessage($pdo, $ch['id'], $u['name'] . ' added ' . implode(', ', $added) . '.');
    }
    respond(['ok' => true, 'added' => count($added)]);
}

/* ---------------- live polling ---------------- */

function chatPoll(): void {
    global $pdo;
    $u = chatUser($pdo);
    $me = $u['id'];
    chatReleaseSession();

    $cid     = (string)($_GET['channel_id'] ?? '');
    $after   = max(0, (int)($_GET['after'] ?? 0));
    $sn      = (int)($_GET['sn'] ?? 0);
    $viewing = ($_GET['viewing'] ?? '0') === '1';

    [$ch, $mem] = chatChannelFor($pdo, $u, $cid);
    $cleared = (int)$mem['cleared_before'];

    // First load, or the session changed under this browser (ended / restarted): send the whole recent history.
    $reset = ($after <= 0) || ($sn !== (int)$ch['session_no']);
    $floor = $reset ? $cleared : max($after, $cleared);

    $params = [':cid' => $cid, ':floor' => $floor];
    $v1 = chatVis('m', '1', $params, $me);
    $v2 = chatVis('p', '2', $params, $me);
    $inner = "SELECT m.id, m.sender_id, m.sender_name, m.body, m.is_system, CAST(m.to_ids AS text) AS to_ids, m.reply_to, m.created_at,
                     p.sender_name AS p_name,
                     CASE WHEN p.id IS NOT NULL AND $v2 THEN LEFT(p.body, 140) END AS p_body
                FROM chat_messages m
                LEFT JOIN chat_messages p ON p.id = m.reply_to
               WHERE m.channel_id = :cid AND m.id > :floor AND $v1";
    $sql = $reset
        ? "SELECT * FROM ($inner ORDER BY m.id DESC LIMIT 100) t ORDER BY t.id ASC"
        : "$inner ORDER BY m.id ASC LIMIT 200";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $names = chatNames($pdo);
    $messages = [];
    $maxId = 0;
    foreach ($rows as $r) {
        $to = [];
        $toIds = json_decode((string)$r['to_ids'], true);
        if (is_array($toIds)) {
            foreach ($toIds as $tid) { $to[] = ['id' => $tid, 'name' => $names[$tid] ?? 'Former staff']; }
        }
        $messages[] = [
            'id'          => (int)$r['id'],
            'sender_id'   => $r['sender_id'],
            'sender_name' => $r['sender_name'],
            'body'        => $r['body'],
            'is_system'   => toBool($r['is_system']),
            'to'          => $to,
            'reply_to'    => $r['p_body'] !== null ? ['id' => (int)$r['reply_to'], 'name' => $r['p_name'], 'body' => $r['p_body']] : null,
            'created_at'  => chatIso($r['created_at']),
        ];
        $maxId = max($maxId, (int)$r['id']);
    }

    // Feedback / seen receipts: everything on messages I sent, plus my own receipts.
    $rp = [':cid' => $cid, ':cl' => $cleared, ':me1' => $me, ':me2' => $me];
    $rs = $pdo->prepare(
        'SELECT r.message_id, r.user_id, r.seen_at, r.feedback, r.feedback_at
           FROM chat_receipts r JOIN chat_messages m ON m.id = r.message_id
          WHERE m.channel_id = :cid AND m.id > :cl AND (m.sender_id = :me1 OR r.user_id = :me2)
          ORDER BY r.message_id DESC LIMIT 600'
    );
    $rs->execute($rp);
    $receipts = [];
    foreach ($rs->fetchAll() as $r) {
        $receipts[] = [
            'message_id'  => (int)$r['message_id'],
            'user_id'     => $r['user_id'],
            'seen_at'     => chatIso($r['seen_at']),
            'feedback'    => $r['feedback'],
            'feedback_at' => chatIso($r['feedback_at']),
        ];
    }

    // The viewer is looking at this channel right now: mark directed messages "seen" and move the read marker.
    if ($viewing && $ch['status'] === 'active') {
        $sp = [':me' => $me, ':cid' => $cid, ':cl' => $cleared, ':mj' => json_encode($me), ':me3' => $me, ':me4' => $me];
        $seen = $pdo->prepare(
            'INSERT INTO chat_receipts (message_id, user_id, seen_at)
             SELECT m.id, CAST(:me AS varchar), now() FROM chat_messages m
              WHERE m.channel_id = :cid AND m.id > :cl AND m.sender_id <> :me3
                AND m.to_ids @> CAST(:mj AS jsonb)
                AND NOT EXISTS (SELECT 1 FROM chat_receipts r WHERE r.message_id = m.id AND r.user_id = :me4 AND r.seen_at IS NOT NULL)
             ON CONFLICT (message_id, user_id) DO UPDATE SET seen_at = COALESCE(chat_receipts.seen_at, now())'
        );
        $seen->execute($sp);
        if ($maxId > 0) {
            $rd = $pdo->prepare('UPDATE chat_members SET last_read_id = GREATEST(last_read_id, :mx) WHERE channel_id = :cid AND user_id = :uid');
            $rd->execute([':mx' => $maxId, ':cid' => $cid, ':uid' => $me]);
        }
    }

    $members = ($ch['kind'] === 'public') ? chatStaffRows($pdo) : chatStaffRows($pdo, $cid);

    respond([
        'ok'       => true,
        'channel'  => chatShapeChannel($ch, $u),
        'reset'    => $reset,
        'messages' => $messages,
        'receipts' => $receipts,
        'members'  => $members,
        'me'       => ['id' => $me, 'name' => $u['name'], 'can_moderate' => chatIsMod($u)],
    ]);
}

/* ---------------- sending & feedback ---------------- */

function chatSend(): void {
    global $pdo;
    $u = chatUser($pdo);
    $me = $u['id'];
    $in = input();
    [$ch] = chatChannelFor($pdo, $u, (string)($in['channel_id'] ?? ''));
    if ($ch['status'] !== 'active') respond(['ok' => false, 'error' => 'This session has ended. Ask the host to start a new one.'], 409);

    $body = trim((string)($in['body'] ?? ''));
    if ($body === '') respond(['ok' => false, 'error' => 'Write a message first.'], 422);
    if (mb_strlen($body) > CHAT_MAX_BODY) respond(['ok' => false, 'error' => 'That message is too long (' . CHAT_MAX_BODY . ' characters max).'], 422);

    // Recipients: empty = everyone in the channel; otherwise they must be real staff who are in this channel.
    $to = chatValidStaffIds($pdo, is_array($in['to'] ?? null) ? $in['to'] : []);
    $to = array_values(array_filter($to, function ($id) use ($me) { return $id !== $me; }));
    if (is_array($in['to'] ?? null) && count($in['to']) > 0 && !$to) {
        respond(['ok' => false, 'error' => 'Choose someone other than yourself as the recipient.'], 422);
    }
    if ($to && $ch['kind'] === 'private') {
        $stmt = $pdo->prepare('SELECT user_id FROM chat_members WHERE channel_id = ?');
        $stmt->execute([$ch['id']]);
        $inChannel = array_flip(array_column($stmt->fetchAll(), 'user_id'));
        foreach ($to as $id) {
            if (!isset($inChannel[$id])) respond(['ok' => false, 'error' => 'One of the recipients is not in this channel.'], 422);
        }
    }

    // Replying: the quoted message must be in this channel and visible to me.
    $replyTo = null;
    if (!empty($in['reply_to'])) {
        $p = [':cid' => $ch['id'], ':rid' => (int)$in['reply_to']];
        $vis = chatVis('m', '1', $p, $me);
        $stmt = $pdo->prepare("SELECT m.id FROM chat_messages m WHERE m.id = :rid AND m.channel_id = :cid AND $vis");
        $stmt->execute($p);
        $found = $stmt->fetchColumn();
        if ($found) $replyTo = (int)$found;
    }

    $stmt = $pdo->prepare(
        'INSERT INTO chat_messages (channel_id, sender_id, sender_name, body, to_ids, reply_to)
         VALUES (?, ?, ?, ?, CAST(? AS jsonb), ?) RETURNING id'
    );
    $stmt->execute([$ch['id'], $me, $u['name'], $body, json_encode($to), $replyTo]);
    respond(['ok' => true, 'id' => (int)$stmt->fetchColumn()]);
}

function chatFeedback(): void {
    global $pdo;
    $u = chatUser($pdo);
    $me = $u['id'];
    $in = input();
    $mid = (int)($in['message_id'] ?? 0);
    $fb  = (string)($in['feedback'] ?? '');
    if ($fb !== '' && !in_array($fb, CHAT_FEEDBACK, true)) respond(['ok' => false, 'error' => 'Unknown feedback option.'], 422);

    $stmt = $pdo->prepare('SELECT id, channel_id, sender_id, is_system, to_ids FROM chat_messages WHERE id = ?');
    $stmt->execute([$mid]);
    $m = $stmt->fetch();
    if (!$m) respond(['ok' => false, 'error' => 'That message no longer exists (the session may have been cleared).'], 404);
    [$ch] = chatChannelFor($pdo, $u, (string)$m['channel_id']);
    if ($ch['status'] !== 'active') respond(['ok' => false, 'error' => 'This session has ended.'], 409);
    if ($m['sender_id'] === $me || toBool($m['is_system'])) respond(['ok' => false, 'error' => 'You can only give feedback on a colleague\'s message.'], 422);

    $toIds = json_decode((string)$m['to_ids'], true);
    if (is_array($toIds) && count($toIds) > 0 && !in_array($me, $toIds, true)) {
        respond(['ok' => false, 'error' => 'That message was not sent to you.'], 403);
    }

    $value = ($fb === '') ? null : $fb;
    $at    = ($fb === '') ? null : gmdate('Y-m-d H:i:sP');
    $up = $pdo->prepare(
        'INSERT INTO chat_receipts (message_id, user_id, seen_at, feedback, feedback_at)
         VALUES (?, ?, now(), ?, ?)
         ON CONFLICT (message_id, user_id) DO UPDATE
            SET feedback = EXCLUDED.feedback, feedback_at = EXCLUDED.feedback_at,
                seen_at = COALESCE(chat_receipts.seen_at, now())'
    );
    $up->execute([$mid, $me, $value, $at]);
    respond(['ok' => true]);
}

/* ---------------- clear / end / restart ---------------- */

function chatClearMine(): void {
    global $pdo;
    $u = chatUser($pdo);
    $in = input();
    [$ch] = chatChannelFor($pdo, $u, (string)($in['channel_id'] ?? ''));
    $stmt = $pdo->prepare(
        'UPDATE chat_members
            SET cleared_before = COALESCE((SELECT MAX(id) FROM chat_messages WHERE channel_id = :cid), 0),
                last_read_id   = COALESCE((SELECT MAX(id) FROM chat_messages WHERE channel_id = :cid2), 0)
          WHERE channel_id = :cid3 AND user_id = :uid'
    );
    $stmt->execute([':cid' => $ch['id'], ':cid2' => $ch['id'], ':cid3' => $ch['id'], ':uid' => $u['id']]);
    respond(['ok' => true]);
}

/** Ends the live session for EVERYONE and deletes the whole conversation (messages + feedback). */
function chatEnd(): void {
    global $pdo;
    $u = chatUser($pdo);
    $in = input();
    [$ch] = chatChannelFor($pdo, $u, (string)($in['channel_id'] ?? ''));
    if ($ch['created_by'] !== $u['id'] && !chatIsMod($u)) {
        respond(['ok' => false, 'error' => 'Only the host or a moderator can end this session.'], 403);
    }
    if ($ch['status'] === 'ended') respond(['ok' => false, 'error' => 'This session has already ended.'], 409);

    $pdo->beginTransaction();
    try {
        $cnt = $pdo->prepare('SELECT COUNT(*) FROM chat_messages WHERE channel_id = ?');
        $cnt->execute([$ch['id']]);
        $n = (int)$cnt->fetchColumn();

        $del = $pdo->prepare('DELETE FROM chat_messages WHERE channel_id = ?');   // receipts go with them (ON DELETE CASCADE)
        $del->execute([$ch['id']]);
        $pdo->prepare('UPDATE chat_members SET last_read_id = 0, cleared_before = 0 WHERE channel_id = ?')->execute([$ch['id']]);
        $pdo->prepare("UPDATE chat_channels SET status = 'ended', ended_at = now(), ended_by = ? WHERE id = ?")->execute([$u['name'], $ch['id']]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    audit($pdo, $u, 'delete', 'chat_channel', $ch['id'], 'Ended chat session ' . $ch['session_no'] . ' in "' . $ch['name'] . '" and cleared ' . $n . ' message(s)');
    respond(['ok' => true, 'cleared' => $n]);
}

function chatRestart(): void {
    global $pdo;
    $u = chatUser($pdo);
    $in = input();
    [$ch] = chatChannelFor($pdo, $u, (string)($in['channel_id'] ?? ''));
    if ($ch['created_by'] !== $u['id'] && !chatIsMod($u)) {
        respond(['ok' => false, 'error' => 'Only the host or a moderator can start a new session.'], 403);
    }
    if ($ch['status'] !== 'ended') respond(['ok' => false, 'error' => 'This session is still running.'], 409);

    $pdo->beginTransaction();
    try {
        $pdo->prepare("UPDATE chat_channels SET status = 'active', session_no = session_no + 1, session_started_at = now(), ended_at = NULL, ended_by = NULL WHERE id = ?")
            ->execute([$ch['id']]);
        chatSystemMessage($pdo, $ch['id'], 'New session started by ' . $u['name'] . '.');
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    audit($pdo, $u, 'update', 'chat_channel', $ch['id'], 'Started a new chat session in "' . $ch['name'] . '"');
    respond(['ok' => true]);
}
