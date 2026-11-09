<?php
// api/handlers/marks.php — "Enter Marks" for teachers.
//
// The exam office OPENS an exam (CAT, Mid Term Exam or End Term Exam, per class and term). While it is open,
// teachers enter the marks for their own subject. One call saves ONE subject of ONE exam and merges just those
// cells into the stored marks, so two teachers working on different subjects never overwrite each other.
//   CAT -> stored as "cat1", Mid Term Exam -> "midEnd", End Term Exam -> "examMarks"
// Refused when the exam is not open, or is already in review / published. Needs marks.enter (or exams.manage).

function marksGradeCode(float $avg, array $bands): string {
    $code = '';
    foreach ($bands as $b) { $code = $b['code']; if ($avg >= $b['min']) return $b['code']; }
    return $code;
}

/** Which mark column an exam type fills. */
function marksFieldForExam(array $exam): string {
    $t = strtolower((string)($exam['examType'] ?? ''));
    if (strpos($t, 'cat') !== false) return 'cat1';
    if (strpos($t, 'mid') !== false) return 'midEnd';
    return 'examMarks';
}

function marksSave(): void {
    global $pdo;
    $u = requireUser($pdo);
    if (!userCanAny($u, ['marks.enter', 'exams.manage'])) respond(['ok' => false, 'error' => 'Your role cannot enter marks. Ask an administrator to give you the Teacher role.'], 403);

    $b       = input();
    $examId  = trim((string)($b['examId'] ?? ''));
    $subject = trim((string)($b['subject'] ?? ''));
    $rows    = $b['rows'] ?? null;
    if ($examId === '' || $subject === '' || !is_array($rows)) respond(['ok' => false, 'error' => 'Choose an exam and a subject, then enter at least one mark.'], 400);
    if (mb_strlen($subject) > 80) respond(['ok' => false, 'error' => 'That subject name is too long.'], 400);

    $bands    = portalGradingBands(loadAssoc($pdo, 'em_settings', []));
    $students = [];
    foreach (loadAssoc($pdo, 'em_students', []) as $s) { if (isset($s['id'])) $students[(string)$s['id']] = $s; }

    $pdo->beginTransaction();
    try {
        $exam = null;
        foreach (loadAssoc($pdo, 'em_exams', []) as $e) { if (is_array($e) && (string)($e['id'] ?? '') === $examId) { $exam = $e; break; } }
        if (!$exam) { $pdo->rollBack(); respond(['ok' => false, 'error' => 'That exam no longer exists. Refresh the page and try again.'], 404); }
        $st = (string)($exam['status'] ?? 'Draft');
        if ($st === 'In Review' || $st === 'Published') { $pdo->rollBack(); respond(['ok' => false, 'error' => 'These results are already with the reviewers or published, so marks can no longer be changed.'], 409); }
        if (!canBypassExamOpen($u) && !examIsOpenForEntry($exam)) { $pdo->rollBack(); respond(['ok' => false, 'error' => 'This exam is not open for marks entry. Ask the exam office to open it.'], 403); }

        $field = marksFieldForExam($exam);
        $eg = (string)($exam['grade'] ?? ''); $es = (string)($exam['stream'] ?? '');

        $mRow  = loadKeyRow($pdo, 'em_marks', true);
        $marks = $mRow ? (json_decode($mRow['value'], true) ?: []) : [];
        $cRow  = loadKeyRow($pdo, 'em_comments', true);
        $coms  = $cRow ? (json_decode($cRow['value'], true) ?: []) : [];
        $oldMarks = $mRow ? json_decode($mRow['value'], true) : null;
        $oldComs  = $cRow ? json_decode($cRow['value'], true) : null;
        if (!isset($marks[$examId]) || !is_array($marks[$examId])) $marks[$examId] = [];
        if (!isset($coms[$examId])  || !is_array($coms[$examId]))  $coms[$examId]  = [];

        $saved = 0; $skipped = [];
        foreach ($rows as $r) {
            if (!is_array($r)) continue;
            $sid = (string)($r['studentId'] ?? '');
            if (!isset($students[$sid])) { $skipped[] = 'unknown student'; continue; }
            $stu = $students[$sid];
            if (strcasecmp((string)($stu['grade'] ?? ''), $eg) !== 0 || ($es !== '' && strcasecmp((string)($stu['stream'] ?? ''), $es) !== 0)) {
                $skipped[] = (string)($stu['name'] ?? $sid) . ' is not in this class'; continue;
            }
            $v = $r['mark'] ?? '';
            if (is_string($v)) $v = trim(str_replace(',', '.', $v));
            if ($v !== '' && (!is_numeric($v) || (float)$v < 0 || (float)$v > 100)) {
                $pdo->rollBack();
                respond(['ok' => false, 'error' => 'Marks must be numbers from 0 to 100 (' . ($stu['name'] ?? $sid) . ').'], 400);
            }
            $cell = (isset($marks[$examId][$sid][$subject]) && is_array($marks[$examId][$sid][$subject])) ? $marks[$examId][$sid][$subject] : [];
            if (!$cell && isset($marks[$examId][$sid][$subject]) && is_numeric($marks[$examId][$sid][$subject])) $cell = ['examMarks' => $marks[$examId][$sid][$subject]];
            foreach (['cat1', 'cat2', 'midEnd', 'examMarks'] as $f) { if (!array_key_exists($f, $cell)) $cell[$f] = ''; }
            $cell[$field] = ($v === '') ? '' : $v + 0;
            $nums = [];
            foreach (['cat1', 'cat2', 'midEnd', 'examMarks'] as $f) { if ($cell[$f] !== '' && $cell[$f] !== null && is_numeric($cell[$f])) $nums[] = (float)$cell[$f]; }
            $avg = $nums ? round(array_sum($nums) / count($nums), 1) : '';
            $cell['average']   = $avg;
            $cell['gradeCode'] = $nums ? marksGradeCode((float)$avg, $bands) : '';
            $cell['entryDate'] = $nums ? date('Y-m-d') : '';
            $cell['enteredBy'] = $nums ? (string)$u['name'] : '';
            if (!isset($marks[$examId][$sid]) || !is_array($marks[$examId][$sid])) $marks[$examId][$sid] = [];
            $marks[$examId][$sid][$subject] = $cell;
            $saved++;
            if (array_key_exists('comment', $r)) {
                $prev = (isset($coms[$examId][$sid]) && is_array($coms[$examId][$sid])) ? $coms[$examId][$sid] : [];
                $coms[$examId][$sid] = ['teacher' => mb_substr(trim((string)$r['comment']), 0, 500), 'principal' => (string)($prev['principal'] ?? '')];
            }
        }

        $mJson = json_encode($marks, JSON_FORCE_OBJECT);
        $cJson = json_encode($coms,  JSON_FORCE_OBJECT);
        $mInfo = computeDiff('em_marks', $oldMarks, json_decode($mJson, true));
        if (diffHasChanges($mInfo)) { storeKey($pdo, 'em_marks', $mJson); auditDiff($pdo, $u, 'em_marks', $mInfo, 'teacher entry: ' . $subject); }
        $cInfo = computeDiff('em_comments', $oldComs, json_decode($cJson, true));
        if (diffHasChanges($cInfo)) { storeKey($pdo, 'em_comments', $cJson); auditDiff($pdo, $u, 'em_comments', $cInfo, 'teacher entry: ' . $subject); }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    if ($saved > 0) notifyMarksSaved($pdo, $u, $exam, $subject, $saved);   // tells the exam office (api/handlers/notify.php)
    respond(['ok' => true, 'saved' => $saved, 'skipped' => $skipped, 'field' => $field]);
}
