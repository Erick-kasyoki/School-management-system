<?php
// api/import/engine.php — the dynamic import engine. Knows nothing about any particular kind of data.
//
//   1. Readers   CSV/TSV/TXT (any delimiter + encoding), JSON / NDJSON (any shape), XLSX (any sheet)
//                all become the same thing: a stream of rows, each a list of cells.
//   2. Analysis  finds where the table starts, whether it has a header row, and — column by column —
//                what type the data is (integer, decimal, boolean, date, datetime, time, text).
//   3. Convert   turns a raw cell into a properly typed value for the chosen column type.
//
// Nothing here (or in the handler) names a field. Columns are whatever the file contains.

const DI_MAX_BYTES  = 25 * 1024 * 1024;
const DI_TYPES      = ['text', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'time'];
const DI_NULL_TOKENS = ['null', 'nil', 'n/a', '#n/a', 'nan', '-', '--', '—'];

function diCfg(): array {
    return ['sample_rows' => 2000, 'preview_rows' => 50, 'max_rows' => 500000, 'max_cols' => 500,
            'date_order' => 'dmy', 'type_threshold' => 0.97, 'stage_ttl' => 86400];
}

final class DiException extends RuntimeException {}

/* ====================================================================== */
/* File kinds                                                             */
/* ====================================================================== */
function diKindFromName(string $name): ?string {
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if (in_array($ext, ['csv', 'tsv', 'txt', 'tab'], true)) return 'delimited';
    if ($ext === 'json') return 'json';
    if (in_array($ext, ['ndjson', 'jsonl'], true)) return 'ndjson';
    if (in_array($ext, ['xlsx', 'xlsm'], true)) return 'xlsx';
    if ($ext === 'xls') return 'xls';
    return null;
}

/** Trust the file's content over its extension where the content is unmistakable. */
function diSniffKind(string $path, string $kind): string {
    $h = fopen($path, 'rb'); $head = (string)fread($h, 8); fclose($h);
    if (str_starts_with($head, "PK\x03\x04")) return 'xlsx';
    if (str_starts_with($head, "\xD0\xCF\x11\xE0")) return 'xls';
    if ($kind === 'xlsx') throw new DiException('That file has an Excel name but is not a real .xlsx workbook.');
    // Text formats (CSV/TSV/TXT/JSON/NDJSON) must really be text. A NUL byte in the first 8 KB means a renamed
    // binary (PDF, image, .docx …) — UTF-16 text is the one legitimate exception and always starts with a BOM.
    $h = fopen($path, 'rb'); $chunk = (string)fread($h, 8192); fclose($h);
    if (!str_starts_with($chunk, "\xFF\xFE") && !str_starts_with($chunk, "\xFE\xFF") && str_contains($chunk, "\0")) {
        throw new DiException('That file is not a text file (it looks like binary data, for example a PDF, image or Word document renamed to .csv or .json). Export your data as .xlsx, CSV or JSON and upload that.');
    }
    return $kind;
}

/* ====================================================================== */
/* Cell helpers                                                           */
/* ====================================================================== */
function diIsNullToken(string $s): bool { return in_array(mb_strtolower(trim($s)), DI_NULL_TOKENS, true); }

/** Trim strings, blank -> null, drop trailing empty cells. */
function diTrimRow(array $r): array {
    $out = [];
    foreach ($r as $c) {
        if (is_string($c)) { $c = trim($c); if ($c === '') $c = null; }
        $out[] = $c;
    }
    while ($out && end($out) === null) array_pop($out);
    return $out;
}
function diRowEmpty(array $r): bool { foreach ($r as $c) { if ($c !== null && $c !== '') return false; } return true; }
function diCellStr(mixed $c): string {
    if ($c === null) return '';
    if (is_bool($c)) return $c ? 'true' : 'false';
    if (is_float($c)) return rtrim(rtrim(sprintf('%.15g', $c), '0'), '.') ?: '0';
    return (string)$c;
}

/* ====================================================================== */
/* Source: one object that hides which file type it is                    */
/* ====================================================================== */
final class DiSource {
    public string $kind;
    public array $sheets = [];          // xlsx only: [['name'=>..,'hidden'=>bool], ...]
    public ?string $sheetName = null;
    public ?bool $headerForced = null;  // JSON objects always carry their own keys
    public string $delimiter = ',';
    public array $notes = [];
    private string $path;
    private ?string $tmp = null;
    private string $textPath = '';
    private ?array $table = null;       // json / ndjson, held in memory
    private array $xl = [];

    public static function open(string $path, string $kind, array $o = []): DiSource {
        $s = new DiSource(); $s->kind = $kind; $s->path = $path;
        match ($kind) {
            'delimited' => $s->openDelimited($o),
            'json'      => $s->openJson(),
            'ndjson'    => $s->openNdjson(),
            'xlsx'      => $s->openXlsx($o),
            default     => throw new DiException('Unsupported file type.'),
        };
        return $s;
    }
    public function __destruct() { if ($this->tmp && is_file($this->tmp)) @unlink($this->tmp); }

    public function rows(): Generator {
        switch ($this->kind) {
            case 'delimited': yield from diReadDelimited($this->textPath, $this->delimiter); break;
            case 'xlsx':      yield from diXlsxRows($this->path, $this->xl); break;
            default:
                if (isset($this->table['matrix'])) { foreach ($this->table['matrix'] as $r) yield $r; break; }
                $header = $this->table['header'];
                yield $header;
                foreach ($this->table['records'] as $rec) {
                    $row = [];
                    foreach ($header as $k) $row[] = $rec[$k] ?? null;
                    yield $row;
                }
        }
    }

    /* ---- delimited text ---- */
    private function openDelimited(array $o): void {
        $this->textPath = diPrepareText($this->path, $this->tmp, $this->notes);
        $names = ['comma' => ',', 'semicolon' => ';', 'tab' => "\t", 'pipe' => '|'];
        $want = (string)($o['delimiter'] ?? 'auto');
        $this->delimiter = $names[$want] ?? diDetectDelimiter($this->textPath);
    }

    /* ---- JSON ---- */
    private function openJson(): void {
        $raw = (string)file_get_contents($this->path);
        $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw);
        if (!mb_check_encoding($raw, 'UTF-8')) $raw = mb_convert_encoding($raw, 'UTF-8', 'Windows-1252');
        $data = json_decode($raw, true, 512, JSON_BIGINT_AS_STRING);
        if ($data === null && json_last_error() !== JSON_ERROR_NONE) {
            // Might really be NDJSON saved with a .json name.
            if (preg_match('/^\s*\{.*\}\s*[\r\n]+\s*\{/s', $raw)) { $this->openNdjson(); return; }
            throw new DiException('That file is not valid JSON (' . json_last_error_msg() . ').');
        }
        unset($raw);
        $this->buildFromJson($data);
    }
    private function openNdjson(): void {
        $recs = [];
        $h = fopen($this->path, 'rb'); $n = 0;
        while (($line = fgets($h)) !== false) {
            $line = trim(preg_replace('/^\xEF\xBB\xBF/', '', $line));
            if ($line === '') continue;
            $n++;
            $d = json_decode($line, true, 512, JSON_BIGINT_AS_STRING);
            if ($d === null && json_last_error() !== JSON_ERROR_NONE) throw new DiException("Line $n is not valid JSON.");
            $recs[] = $d;
        }
        fclose($h);
        $this->buildFromJson($recs);
    }
    private function buildFromJson(mixed $data): void {
        [$kind, $payload, $note] = diJsonLocate($data);
        if ($note) $this->notes[] = $note;
        if ($kind === 'matrix') { $this->table = ['matrix' => $payload]; return; }   // header auto-detected
        $header = []; $flat = [];
        foreach ($payload as $rec) {
            $f = diFlatten($rec);
            foreach ($f as $k => $_) $header[$k] = true;
            $flat[] = $f;
        }
        $this->table = ['header' => array_map('strval', array_keys($header)), 'records' => $flat];
        $this->headerForced = true;
    }

    /* ---- XLSX ---- */
    private function openXlsx(array $o): void {
        $meta = diXlsxMeta($this->path);
        if (!$meta['sheets']) throw new DiException('That workbook has no sheets.');
        $this->sheets = array_map(fn($s) => ['name' => $s['name'], 'hidden' => $s['hidden']], $meta['sheets']);
        $pick = null; $want = (string)($o['sheet'] ?? '');
        foreach ($meta['sheets'] as $i => $s) if ($want !== '' && $s['name'] === $want) $pick = $i;
        if ($pick === null) foreach ($meta['sheets'] as $i => $s) if (!$s['hidden']) { $pick = $i; break; }
        $pick ??= 0;
        $this->sheetName = $meta['sheets'][$pick]['name'];
        $this->xl = ['target' => $meta['sheets'][$pick]['target'], 'shared' => $meta['shared'], 'dateXf' => $meta['dateXf'], 'd1904' => $meta['d1904']];
    }
}

/* ====================================================================== */
/* Delimited text                                                         */
/* ====================================================================== */
/** Returns a UTF-8 file path (the original, or a converted temp copy). */
function diPrepareText(string $path, ?string &$tmp, array &$notes): string {
    $raw = (string)file_get_contents($path);
    $changed = false;
    if (str_starts_with($raw, "\xFF\xFE")) { $raw = mb_convert_encoding(substr($raw, 2), 'UTF-8', 'UTF-16LE'); $changed = true; $notes[] = 'Converted from UTF-16.'; }
    elseif (str_starts_with($raw, "\xFE\xFF")) { $raw = mb_convert_encoding(substr($raw, 2), 'UTF-8', 'UTF-16BE'); $changed = true; $notes[] = 'Converted from UTF-16.'; }
    else {
        if (str_starts_with($raw, "\xEF\xBB\xBF")) { $raw = substr($raw, 3); $changed = true; }
        if (!mb_check_encoding($raw, 'UTF-8')) { $raw = mb_convert_encoding($raw, 'UTF-8', 'Windows-1252'); $changed = true; $notes[] = 'Text was not UTF-8; read as Windows-1252.'; }
    }
    if (strpos($raw, "\r") !== false && strpos($raw, "\n") === false) { $raw = str_replace("\r", "\n", $raw); $changed = true; }   // old Mac line endings
    if (!$changed) return $path;
    $tmp = $path . '.utf8.tmp';
    file_put_contents($tmp, $raw);
    return $tmp;
}

function diDetectDelimiter(string $path): string {
    $h = fopen($path, 'rb'); $lines = [];
    while (count($lines) < 30 && ($l = fgets($h)) !== false) { if (trim($l) !== '') $lines[] = $l; }
    fclose($h);
    $best = ','; $bestScore = 0;
    foreach ([',', ';', "\t", '|'] as $d) {
        $counts = [];
        foreach ($lines as $l) { $counts[] = count(str_getcsv($l, $d, '"', '')); }
        if (!$counts) continue;
        $freq = array_count_values($counts); arsort($freq);
        $mode = array_key_first($freq);
        if ($mode < 2) continue;
        $score = $freq[$mode] * 1000 + $mode;      // consistency first, then width
        if ($score > $bestScore) { $bestScore = $score; $best = $d; }
    }
    return $best;
}

function diReadDelimited(string $path, string $delim): Generator {
    $h = fopen($path, 'rb');
    while (($r = fgetcsv($h, 0, $delim, '"', '')) !== false) {
        if ($r === [null]) continue;
        yield $r;
    }
    fclose($h);
}

/* ====================================================================== */
/* JSON                                                                   */
/* ====================================================================== */
function diIsList(array $value): bool {
    return $value === [] || array_keys($value) === range(0, count($value) - 1);
}

/** Finds the "table" inside whatever shape the JSON has. Returns [kind, payload, note]. */
function diJsonLocate(mixed $data): array {
    if (!is_array($data)) return ['records', [['value' => $data]], 'The file holds a single value.'];
    if (diIsList($data)) {
        if (!$data) return ['records', [], ''];
        $allLists = true; $allObj = true;
        foreach ($data as $r) {
            if (!is_array($r) || !diIsList($r) || !$r) $allLists = false;
            if (!is_array($r) || diIsList($r)) $allObj = false;
        }
        if ($allLists) return ['matrix', $data, 'Rows are arrays; the first row is checked for headings.'];
        return ['records', array_map('diJsonRecord', $data), $allObj ? '' : 'Some entries were not objects; they were put in a "value" column.'];
    }
    // an object: look for the biggest list of records inside it
    $best = null; $bestN = 0; $bestKey = '';
    foreach ($data as $k => $v) {
        if (is_array($v) && diIsList($v) && count($v) > $bestN && is_array($v[0] ?? null)) { $best = $v; $bestN = count($v); $bestKey = (string)$k; }
    }
    if ($best !== null) return ['records', array_map('diJsonRecord', $best), "Used the list under \"$bestKey\"."];
    $allObj = $data !== [];
    foreach ($data as $v) if (!is_array($v) || diIsList($v)) { $allObj = false; break; }
    if ($allObj) {
        $recs = [];
        foreach ($data as $k => $v) $recs[] = ['_key' => (string)$k] + $v;
        return ['records', $recs, 'The object\'s keys became a "_key" column.'];
    }
    return ['records', [$data], 'The file holds a single record.'];
}
function diJsonRecord(mixed $r): array {
    if (is_array($r) && !diIsList($r)) return $r;
    if (is_array($r)) return ['value' => diJsonScalarList($r)];
    return ['value' => $r];
}
function diJsonScalarList(array $v): ?string {
    if (!$v) return null;
    foreach ($v as $x) if (is_array($x)) return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    return implode(', ', array_map(fn($x) => is_bool($x) ? ($x ? 'true' : 'false') : (string)$x, $v));
}
/** Nested objects become "parent.child" columns; lists of plain values become one comma-joined cell. */
function diFlatten(array $a, string $prefix = '', int $depth = 0): array {
    $out = [];
    foreach ($a as $k => $v) {
        $key = $prefix === '' ? (string)$k : $prefix . '.' . $k;
        if (!is_array($v)) { $out[$key] = $v; continue; }
        if (!$v) { $out[$key] = null; continue; }
        if (diIsList($v) || $depth >= 4) {
            $out[$key] = diIsList($v) ? diJsonScalarList($v) : json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            continue;
        }
        foreach (diFlatten($v, $key, $depth + 1) as $k2 => $v2) $out[$k2] = $v2;
    }
    return $out;
}

/* ====================================================================== */
/* XLSX (no libraries: zip + streaming XML)                               */
/* ====================================================================== */
const DI_NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function diXlsxMeta(string $path): array {
    $zip = new ZipArchive();
    if ($zip->open($path) !== true) throw new DiException('Could not open the workbook (is it corrupted or password-protected?).');
    $wbXml = $zip->getFromName('xl/workbook.xml');
    if ($wbXml === false) { $zip->close(); throw new DiException('That is not a readable Excel workbook (no workbook.xml). If it is password-protected, remove the password first.'); }
    $wb = simplexml_load_string($wbXml);
    $rels = [];
    $relXml = $zip->getFromName('xl/_rels/workbook.xml.rels');
    if ($relXml !== false) {
        foreach (simplexml_load_string($relXml)->Relationship as $r) {
            $t = (string)$r['Target'];
            $rels[(string)$r['Id']] = ltrim(str_starts_with($t, '/') ? $t : 'xl/' . $t, '/');
        }
    }
    $sheets = [];
    foreach ($wb->sheets->sheet as $s) {
        $rid = (string)$s->attributes(DI_NS_REL)['id'];
        if (!isset($rels[$rid])) continue;
        $sheets[] = ['name' => (string)$s['name'], 'target' => $rels[$rid], 'hidden' => in_array((string)$s['state'], ['hidden', 'veryHidden'], true)];
    }
    $d1904 = isset($wb->workbookPr) && in_array((string)$wb->workbookPr['date1904'], ['1', 'true'], true);

    // shared strings
    $shared = [];
    $ssXml = $zip->getFromName('xl/sharedStrings.xml');
    if ($ssXml !== false) {
        $xr = new XMLReader(); $xr->XML($ssXml);
        while ($xr->read()) {
            if ($xr->nodeType === XMLReader::ELEMENT && $xr->localName === 'si') {
                $outer = preg_replace('#<(\w+:)?rPh\b.*?</(\w+:)?rPh>#s', '', $xr->readOuterXml());
                $txt = '';
                if (preg_match_all('#<(?:\w+:)?t\b[^>]*>(.*?)</(?:\w+:)?t>#s', $outer, $m)) $txt = implode('', $m[1]);
                $shared[] = diXmlText($txt);
                $xr->next();
            }
        }
        $xr->close();
    }
    // which cell styles are dates / times
    $dateXf = [];
    $stXml = $zip->getFromName('xl/styles.xml');
    if ($stXml !== false) {
        $st = simplexml_load_string($stXml);
        $codes = [];
        if (isset($st->numFmts)) foreach ($st->numFmts->numFmt as $nf) $codes[(int)$nf['numFmtId']] = (string)$nf['formatCode'];
        $i = 0;
        if (isset($st->cellXfs)) foreach ($st->cellXfs->xf as $xf) { $k = diDateFormatKind((int)$xf['numFmtId'], $codes[(int)$xf['numFmtId']] ?? null); if ($k) $dateXf[$i] = $k; $i++; }
    }
    $zip->close();
    return ['sheets' => $sheets, 'shared' => $shared, 'dateXf' => $dateXf, 'd1904' => $d1904];
}
function diXmlText(string $t): string {
    $t = html_entity_decode($t, ENT_QUOTES | ENT_XML1, 'UTF-8');
    return preg_replace_callback('/_x([0-9A-Fa-f]{4})_/', fn($m) => mb_chr(hexdec($m[1]), 'UTF-8'), $t);
}
/** 'date' | 'datetime' | 'time' | null for a cell number format. */
function diDateFormatKind(int $id, ?string $code): ?string {
    if (in_array($id, [14, 15, 16, 17], true) || ($id >= 27 && $id <= 31) || ($id >= 34 && $id <= 36) || ($id >= 50 && $id <= 58)) return 'date';
    if (in_array($id, [18, 19, 20, 21, 45, 46, 47], true)) return 'time';
    if ($id === 22 || $id === 32 || $id === 33) return $id === 22 ? 'datetime' : 'time';
    if ($code === null) return null;
    $c = preg_replace('/"[^"]*"|\[[^\]]*\]|\\\\.|_.|\*.|General/i', '', $code);
    $hasDate = (bool)preg_match('/[dy]/i', $c);
    $hasTime = (bool)preg_match('/h|s|AM\/PM|A\/P/i', $c);
    if (!$hasDate && !$hasTime) return preg_match('/m/i', $c) ? 'date' : null;
    return $hasDate && $hasTime ? 'datetime' : ($hasDate ? 'date' : 'time');
}
function diColIndex(string $ref): int {
    $n = 0;
    foreach (str_split(strtoupper(preg_replace('/[^A-Za-z]/', '', $ref))) as $ch) $n = $n * 26 + (ord($ch) - 64);
    return $n - 1;
}
function diExcelDate(float $serial, string $kind, bool $d1904): string {
    $secs = (int)round(($serial - ($d1904 ? 24107 : 25569)) * 86400);
    if ($kind === 'time') return gmdate('H:i:s', (int)round(fmod($serial, 1) * 86400));
    return gmdate($kind === 'datetime' ? 'Y-m-d H:i:s' : 'Y-m-d', $kind === 'date' ? (int)(floor($secs / 86400) * 86400) : $secs);
}

function diXlsxRows(string $path, array $x): Generator {
    $xr = new XMLReader();
    if (!$xr->open('zip://' . $path . '#' . $x['target'])) throw new DiException('Could not read that sheet.');
    $row = null; $col = -1;
    while ($xr->read()) {
        if ($xr->nodeType === XMLReader::ELEMENT && $xr->localName === 'row') {
            $row = []; $col = -1;
            if ($xr->isEmptyElement) { yield []; $row = null; }
        } elseif ($xr->nodeType === XMLReader::END_ELEMENT && $xr->localName === 'row' && $row !== null) {
            yield $row; $row = null;
        } elseif ($xr->nodeType === XMLReader::ELEMENT && $xr->localName === 'c' && $row !== null) {
            $ref = $xr->getAttribute('r'); $t = $xr->getAttribute('t'); $s = (int)$xr->getAttribute('s');
            $col = $ref ? diColIndex($ref) : $col + 1;
            $v = null; $inline = null;
            if (!$xr->isEmptyElement) {
                $depth = $xr->depth;
                while ($xr->read()) {
                    if ($xr->nodeType === XMLReader::END_ELEMENT && $xr->localName === 'c' && $xr->depth === $depth) break;
                    if ($xr->nodeType === XMLReader::ELEMENT) {
                        if ($xr->localName === 'v') $v = $xr->readString();
                        elseif ($xr->localName === 'is') $inline = diXmlText(implode('', diInlineTexts($xr->readInnerXml())));
                    }
                }
            }
            $val = null;
            if ($t === 's') $val = ($v !== null && isset($x['shared'][(int)$v])) ? $x['shared'][(int)$v] : null;
            elseif ($t === 'inlineStr') $val = $inline;
            elseif ($t === 'str' || $t === 'd') $val = $v;
            elseif ($t === 'b') $val = $v === '1';
            elseif ($t === 'e') $val = null;
            elseif ($v !== null && $v !== '') {
                if (isset($x['dateXf'][$s]) && is_numeric($v)) $val = diExcelDate((float)$v, $x['dateXf'][$s], $x['d1904']);
                elseif (preg_match('/^-?\d{1,15}$/', $v)) $val = (int)$v;
                elseif (is_numeric($v)) $val = (float)sprintf('%.15g', (float)$v);
                else $val = $v;
            }
            while (count($row) < $col) $row[] = null;
            $row[$col] = $val;
        }
    }
    $xr->close();
}
function diInlineTexts(string $inner): array {
    $inner = preg_replace('#<(?:\w+:)?rPh\b.*?</(?:\w+:)?rPh>#s', '', $inner);
    preg_match_all('#<(?:\w+:)?t\b[^>]*>(.*?)</(?:\w+:)?t>#s', $inner, $m);
    return $m[1];
}

/* ====================================================================== */
/* Type detection                                                         */
/* ====================================================================== */
/** Integer/decimal from text like 1,234.50 or KSh 1,200. Returns ['integer'|'decimal', value] or null. */
function diParseNumber(string $s): ?array {
    $t = preg_replace('/^(?:KSh|Ksh|KES|USD|EUR|GBP|UGX|TZS|[\p{Sc}])\s?/u', '', trim($s));
    if (preg_match('/^[+-]?(?:[1-9]\d{0,2}(?:,\d{3})+|0|[1-9]\d*)$/', $t)) {
        $digits = strlen(preg_replace('/\D/', '', $t));
        if ($digits > 11) return null;                     // long digit strings are identifiers (phones, IDs), not quantities
        return ['integer', (int)str_replace(',', '', $t)];
    }
    if (preg_match('/^[+-]?(?:(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)\.\d+|\.\d+)$/', $t)) return ['decimal', (float)str_replace(',', '', $t)];
    return null;
}

const DI_MONTHS = ['jan' => 1, 'feb' => 2, 'mar' => 3, 'apr' => 4, 'may' => 5, 'jun' => 6, 'jul' => 7, 'aug' => 8, 'sep' => 9, 'oct' => 10, 'nov' => 11, 'dec' => 12];

function diParseTimeStr(string $s): ?string {
    if (!preg_match('/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*([AaPp][Mm])?$/', trim($s), $m)) return null;
    $h = (int)$m[1]; $mi = (int)$m[2]; $se = (int)($m[3] ?? 0); $ap = strtolower($m[4] ?? '');
    if ($ap !== '') { if ($h < 1 || $h > 12) return null; if ($ap === 'pm' && $h < 12) $h += 12; if ($ap === 'am' && $h === 12) $h = 0; }
    if ($h > 23 || $mi > 59 || $se > 59) return null;
    return sprintf('%02d:%02d:%02d', $h, $mi, $se);
}

/**
 * Parses a date / datetime / time string. 'ord' says whether a 05/06/2024-style date is
 * readable only day-first ('dmy'), only month-first ('mdy'), either ('both'), or is unambiguous (null).
 * Returns ['kind'=>..., 'ord'=>..., 'value'=>'2024-06-05' | '2024-06-05 14:30:00' | '14:30:00'].
 */
function diParseDateTime(string $s, string $order = 'dmy'): ?array {
    $s = trim($s);
    if (($t = diParseTimeStr($s)) !== null) return ['kind' => 'time', 'ord' => null, 'value' => $t];
    $dp = $s; $tp = null;
    if (preg_match('/^(.+?)(?:T|\s+)(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\s*(?:[AaPp][Mm])?)\s*(?:Z|[+-]\d{2}:?\d{2})?$/', $s, $m)) {
        $tp = diParseTimeStr($m[2]);
        if ($tp === null) return null;
        $dp = trim($m[1]);
    }
    $y = $mo = $d = null; $ord = null;
    if (preg_match('/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/', $dp, $m)) { [$y, $mo, $d] = [(int)$m[1], (int)$m[2], (int)$m[3]]; }
    elseif (preg_match('/^(\d{1,2})([\/\-.])(\d{1,2})\2(\d{4}|\d{2})$/', $dp, $m)) {
        if ($m[2] === '.' && strlen($m[4]) === 2) return null;
        $a = (int)$m[1]; $b = (int)$m[3]; $y = (int)$m[4];
        if (strlen($m[4]) === 2) $y += $y < 70 ? 2000 : 1900;
        $dmy = checkdate($b, $a, $y); $mdy = checkdate($a, $b, $y);
        if (!$dmy && !$mdy) return null;
        $ord = ($dmy && $mdy) ? ($a === $b ? null : 'both') : ($dmy ? 'dmy' : 'mdy');
        $use = $ord === 'dmy' || $ord === 'mdy' ? $ord : $order;
        [$d, $mo] = $use === 'dmy' ? [$a, $b] : [$b, $a];
    }
    elseif (preg_match('/^(\d{1,2})(?:st|nd|rd|th)?[\s\-\/]*([A-Za-z]{3,9})\.?,?[\s\-\/]*(\d{4})$/', $dp, $m) && isset(DI_MONTHS[strtolower(substr($m[2], 0, 3))])) {
        [$d, $mo, $y] = [(int)$m[1], DI_MONTHS[strtolower(substr($m[2], 0, 3))], (int)$m[3]];
    }
    elseif (preg_match('/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/', $dp, $m) && isset(DI_MONTHS[strtolower(substr($m[1], 0, 3))])) {
        [$mo, $d, $y] = [DI_MONTHS[strtolower(substr($m[1], 0, 3))], (int)$m[2], (int)$m[3]];
    }
    else return null;
    if ($y < 1000 || $y > 2999 || !checkdate($mo, $d, $y)) return null;
    $date = sprintf('%04d-%02d-%02d', $y, $mo, $d);
    return $tp !== null ? ['kind' => 'datetime', 'ord' => $ord, 'value' => "$date $tp"] : ['kind' => 'date', 'ord' => $ord, 'value' => $date];
}

/** What could this single cell be? Returns ['k' => [candidate kinds], 'o' => date-order info]. 'null' is neutral. */
function diClassify(mixed $v): array {
    if ($v === null) return ['k' => ['empty'], 'o' => null];
    if (is_bool($v)) return ['k' => ['boolean'], 'o' => null];
    if (is_int($v))  return ['k' => abs($v) >= 1e12 ? ['text'] : ['integer', 'decimal'], 'o' => null];
    if (is_float($v)) return ['k' => ['decimal'], 'o' => null];
    $s = trim((string)$v);
    if ($s === '') return ['k' => ['empty'], 'o' => null];
    if (diIsNullToken($s)) return ['k' => ['null'], 'o' => null];
    if (preg_match('/^(true|false|yes|no|y|n)$/i', $s)) return ['k' => ['boolean', 'text'], 'o' => null];
    if (($n = diParseNumber($s)) !== null) return ['k' => $n[0] === 'integer' ? ['integer', 'decimal'] : ['decimal'], 'o' => null];
    if (($dt = diParseDateTime($s)) !== null) return ['k' => [$dt['kind']], 'o' => $dt['ord']];
    return ['k' => ['text'], 'o' => null];
}
function diPrimaryType(mixed $v): string {
    $k = diClassify($v)['k'][0] ?? 'text';
    return in_array($k, ['empty', 'null'], true) ? 'empty' : $k;
}

function diNewStats(): array {
    return ['n' => 0, 'empty' => 0, 'k' => ['boolean' => 0, 'integer' => 0, 'decimal' => 0, 'date' => 0, 'datetime' => 0, 'time' => 0],
            'oDmy' => 0, 'oMdy' => 0, 'oBoth' => 0, 'distinct' => [], 'capped' => false, 'samples' => []];
}
function diAddToStats(array &$st, mixed $v): void {
    $c = diClassify($v);
    if (in_array($c['k'][0], ['empty', 'null'], true)) { $st['empty']++; return; }
    $st['n']++;
    foreach ($c['k'] as $k) if (isset($st['k'][$k])) $st['k'][$k]++;
    if (in_array($c['k'][0], ['date', 'datetime'], true)) { if ($c['o'] === 'dmy') $st['oDmy']++; elseif ($c['o'] === 'mdy') $st['oMdy']++; elseif ($c['o'] === 'both') $st['oBoth']++; }
    $key = diCellStr($v);
    if (!$st['capped']) {
        $st['distinct'][$key] = true;
        if (count($st['distinct']) > 5000) $st['capped'] = true;
    }
    if (count($st['samples']) < 5 && !in_array($key, $st['samples'], true)) $st['samples'][] = mb_substr($key, 0, 60);
}
/** [type, dateOrder] for a column from its statistics. A few dirty cells are tolerated. */
function diDecideType(array $st, string $defaultOrder, float $thr): array {
    $n = $st['n'];
    $order = $defaultOrder;
    if ($st['oDmy'] > 0 && $st['oMdy'] === 0) $order = 'dmy';
    elseif ($st['oMdy'] > 0 && $st['oDmy'] === 0) $order = 'mdy';
    elseif ($st['oDmy'] > 0 && $st['oMdy'] > 0) $order = $st['oDmy'] >= $st['oMdy'] ? 'dmy' : 'mdy';
    if ($n === 0) return ['text', $order];
    $fit = fn($c) => $c / $n >= $thr;
    if ($fit($st['k']['boolean'])) return ['boolean', $order];
    if ($fit($st['k']['integer'])) return ['integer', $order];
    if ($fit($st['k']['decimal'])) return ['decimal', $order];
    $clash = $order === 'dmy' ? $st['oMdy'] : ($order === 'mdy' ? $st['oDmy'] : 0);
    $dateFit = $st['k']['date'] + $st['k']['datetime'] - $clash;
    if ($dateFit / $n >= $thr) return [$st['k']['datetime'] > 0 ? 'datetime' : 'date', $order];
    if ($fit($st['k']['time'])) return ['time', $order];
    return ['text', $order];
}

/** Raw cell -> typed value. $ok turns false when the cell does not fit the type (the original text is kept). */
function diConvert(mixed $v, string $type, string $order, bool &$ok): mixed {
    $ok = true;
    if ($v === null) return null;
    if (is_string($v)) { $v = trim($v); if ($v === '') return null; }
    if ($type === 'text') return is_string($v) ? $v : diCellStr($v);
    if (is_string($v) && diIsNullToken($v)) return null;
    switch ($type) {
        case 'integer':
            if (is_int($v)) return $v;
            if (is_float($v) && floor($v) == $v) return (int)$v;
            if (is_string($v) && ($p = diParseNumber($v)) && $p[0] === 'integer') return $p[1];
            break;
        case 'decimal':
            if (is_int($v) || is_float($v)) return $v;
            if (is_string($v) && ($p = diParseNumber($v))) return $p[1];
            break;
        case 'boolean':
            if (is_bool($v)) return $v;
            if (is_int($v) && ($v === 0 || $v === 1)) return $v === 1;
            if (is_string($v)) {
                if (preg_match('/^(true|yes|y|1)$/i', $v)) return true;
                if (preg_match('/^(false|no|n|0)$/i', $v)) return false;
            }
            break;
        case 'date': case 'datetime': case 'time':
            if (is_string($v) && ($dt = diParseDateTime($v, $order))) {
                if ($dt['kind'] === $type) return $dt['value'];
                if ($type === 'datetime' && $dt['kind'] === 'date') return $dt['value'] . ' 00:00:00';
            }
            break;
    }
    $ok = false;
    return is_string($v) ? $v : diCellStr($v);
}

/* ====================================================================== */
/* Table analysis                                                         */
/* ====================================================================== */
function diLooksLikeHeader(array $first, array $below): bool {
    $cells = array_filter($first, fn($c) => $c !== null);
    if (!$cells) return false;
    foreach ($cells as $c) { if (diPrimaryType($c) !== 'text') return false; }     // a number/date in row 1 means it is data
    if (!$below) return true;
    $evidence = 0;
    foreach ($first as $j => $c) {
        if ($c === null) continue;
        $cnt = []; foreach ($below as $r) { $t = diPrimaryType($r[$j] ?? null); if ($t !== 'empty') $cnt[$t] = ($cnt[$t] ?? 0) + 1; }
        if ($cnt) { arsort($cnt); if (array_key_first($cnt) !== 'text') $evidence++; }
    }
    if ($evidence > 0) return true;
    // everything is text: a header is unique, short, mostly filled in, and not repeated further down its own column
    $lower = array_map(fn($c) => mb_strtolower(diCellStr($c)), $cells);
    if (count(array_unique($lower)) !== count($lower)) return false;
    if (count($cells) / max(1, count($first)) < 0.7) return false;
    foreach ($cells as $c) if (mb_strlen(diCellStr($c)) > 60) return false;
    foreach ($first as $j => $c) {
        if ($c === null) continue;
        foreach ($below as $r) if (isset($r[$j]) && mb_strtolower(diCellStr($r[$j])) === mb_strtolower(diCellStr($c))) return false;
    }
    return true;
}

/**
 * Reads the start of the source, finds the table, and describes every column.
 * $o: header = auto|yes|no, date_order = dmy|mdy. $full = also convert the sample for preview/min/max.
 */
function diAnalyse(DiSource $src, array $o, bool $full = true): array {
    $cfg = diCfg();
    $headerOpt = in_array(($o['header'] ?? 'auto'), ['yes', 'no'], true) ? $o['header'] : 'auto';
    $defOrder = ($o['date_order'] ?? $cfg['date_order']) === 'mdy' ? 'mdy' : 'dmy';

    // 1. buffer the first rows (empty rows skipped) and count the rest
    $buf = []; $nonEmpty = 0; $bufMax = $cfg['sample_rows'] + 20; $warnings = []; $maxWidth = 0;
    foreach ($src->rows() as $r) {
        $r = diTrimRow($r);
        if (!$r) continue;
        $nonEmpty++;
        if (count($buf) < $bufMax) { $buf[] = $r; }
        if ($nonEmpty > $cfg['max_rows'] + 50) throw new DiException('This file has more than ' . number_format($cfg['max_rows']) . ' rows. Split it into smaller files.');
    }
    if (!$buf) throw new DiException('That file has no data.');

    // 2. where does the table start? (skip title / note lines above it)
    $start = 0;
    if ($src->headerForced === null) {
        $win = array_slice($buf, 0, 15);
        $counts = array_map(fn($r) => count(array_filter($r, fn($c) => $c !== null)), $win);
        $freq = array_count_values($counts); arsort($freq); $mode = array_key_first($freq);
        if ($mode > 1) foreach ($counts as $i => $c) { if ($c >= ceil(0.6 * $mode)) { $start = $i; break; } }
    }
    // 3. header or not?
    $below = array_slice($buf, $start + 1, 30);
    if ($src->headerForced !== null) { $hasHeader = $src->headerForced; $auto = true; }
    elseif ($headerOpt === 'yes') { $hasHeader = true; $auto = false; }
    elseif ($headerOpt === 'no') { $hasHeader = false; $auto = false; }
    else { $hasHeader = diLooksLikeHeader($buf[$start], $below); $auto = true; }
    if ($start > 0) $warnings[] = "Skipped $start line" . ($start > 1 ? 's' : '') . ' above the table (titles or notes).';

    $dataRows = array_slice($buf, $start + ($hasHeader ? 1 : 0));
    $width = 0;
    foreach (array_slice($buf, $start) as $r) $width = max($width, count($r));
    if ($width > $cfg['max_cols']) throw new DiException("This file has $width columns; the limit is {$cfg['max_cols']}.");

    // 4. column names
    $names = []; $seen = [];
    for ($j = 0; $j < $width; $j++) {
        $raw = $hasHeader ? ($buf[$start][$j] ?? null) : null;
        $name = $raw !== null ? trim(diCellStr($raw)) : '';
        $blank = $name === '';
        if ($blank) $name = 'Column ' . ($j + 1);
        $base = $name; $k = 2;
        while (isset($seen[mb_strtolower($name)])) $name = $base . ' (' . $k++ . ')';
        $seen[mb_strtolower($name)] = true;
        $names[] = ['name' => $name, 'orig' => $raw !== null ? trim(diCellStr($raw)) : '', 'blank' => $blank];
    }
    if ($hasHeader && ($d = count(array_filter($names, fn($n) => $n['name'] !== $n['orig'] && !$n['blank'])))) $warnings[] = "$d duplicate column name" . ($d > 1 ? 's were' : ' was') . ' renamed.';

    // 5. statistics -> types
    $stats = array_map(fn() => diNewStats(), range(0, max(0, $width - 1)));
    $sample = array_slice($dataRows, 0, $cfg['sample_rows']);
    foreach ($sample as $r) for ($j = 0; $j < $width; $j++) diAddToStats($stats[$j], $r[$j] ?? null);
    $cols = [];
    foreach ($names as $j => $nm) {
        [$type, $order] = diDecideType($stats[$j], $defOrder, $cfg['type_threshold']);
        $allEmpty = $stats[$j]['n'] === 0 && $nm['blank'];
        $cols[] = ['index' => $j, 'name' => $nm['name'], 'type' => $type, 'order' => $order, 'include' => !$allEmpty, 'empty_column' => $allEmpty,
                   'non_empty' => $stats[$j]['n'], 'empty' => $stats[$j]['empty'], 'distinct' => count($stats[$j]['distinct']),
                   'distinct_capped' => $stats[$j]['capped'], 'samples' => $stats[$j]['samples'], 'failed' => 0, 'min' => null, 'max' => null];
    }
    if ($e = count(array_filter($cols, fn($c) => $c['empty_column']))) $warnings[] = "$e completely empty column" . ($e > 1 ? 's were' : ' was') . ' left out.';

    // 6. convert the sample once: preview rows, min/max, how many cells would not fit
    $preview = []; $flags = [];
    if ($full) {
        foreach ($sample as $i => $r) {
            $prow = []; $pf = [];
            for ($j = 0; $j < $width; $j++) {
                $ok = true;
                $val = diConvert($r[$j] ?? null, $cols[$j]['type'], $cols[$j]['order'], $ok);
                if (!$ok) { $cols[$j]['failed']++; $pf[] = $j; }
                elseif ($val !== null && in_array($cols[$j]['type'], ['integer', 'decimal', 'date', 'datetime', 'time'], true)) {
                    if ($cols[$j]['min'] === null || $val < $cols[$j]['min']) $cols[$j]['min'] = $val;
                    if ($cols[$j]['max'] === null || $val > $cols[$j]['max']) $cols[$j]['max'] = $val;
                }
                if ($i < $cfg['preview_rows']) $prow[] = $val;
            }
            if ($i < $cfg['preview_rows']) { $preview[] = $prow; $flags[] = $pf; }
        }
        foreach ($cols as $c) if ($c['failed'] > 0) $warnings[] = "Column \"{$c['name']}\": {$c['failed']} value" . ($c['failed'] > 1 ? 's do' : ' does') . " not look like {$c['type']}; they will be kept as text.";
    }
    $total = max(0, $nonEmpty - $start - ($hasHeader ? 1 : 0));
    if ($total > $cfg['max_rows']) throw new DiException('This file has more than ' . number_format($cfg['max_rows']) . ' rows. Split it into smaller files.');

    return ['has_header' => $hasHeader, 'header_auto' => $auto, 'skip' => $start + ($hasHeader ? 1 : 0), 'start_row' => $start,
            'width' => $width, 'columns' => $cols, 'preview' => $preview, 'preview_flags' => $flags,
            'total_rows' => $total, 'sampled_rows' => count($sample), 'warnings' => array_merge($src->notes, $warnings)];
}

/** Unique, readable JSON keys for a list of column names. */
function diColumnKeys(array $names, array $taken = []): array {
    $out = []; $used = array_fill_keys($taken, true);
    foreach ($names as $n) {
        $k = trim((string)preg_replace('/[^\p{L}\p{N}]+/u', '_', mb_strtolower($n)), '_');
        if ($k === '') $k = 'col';
        $base = $k; $i = 2;
        while (isset($used[$k])) $k = $base . '_' . $i++;
        $used[$k] = true; $out[] = $k;
    }
    return $out;
}
