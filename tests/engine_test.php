<?php
// tests/engine_test.php — run:  php tests/engine_test.php
// Exercises the import engine (no database needed) against files in tests/samples/.
require __DIR__ . '/../api/import/engine.php';

$pass = 0; $fail = 0;
function check(string $label, bool $cond, string $extra = ''): void {
    global $pass, $fail;
    if ($cond) { $pass++; echo "  ok   $label\n"; } else { $fail++; echo "  FAIL $label $extra\n"; }
}
function analyse(string $file, array $o = []): array {
    $path = __DIR__ . '/samples/' . $file;
    $kind = diSniffKind($path, diKindFromName($file));
    $src = DiSource::open($path, $kind, $o);
    return [diAnalyse($src, $o, true), $src];
}
function types(array $a): array { return array_column($a['columns'], 'type', 'name'); }
function conv($v, $t, $o = 'dmy') { $ok = true; return diConvert($v, $t, $o, $ok); }

echo "CSV: semicolon + Latin-1 + dd/mm dates\n";
[$a, $s] = analyse('students_semicolon_latin1.csv');
$t = types($a);
check('delimiter detected as ;', $s->delimiter === ';');
check('header detected', $a['has_header'] === true);
check('accented name read correctly', $a['preview'][0][0] === 'José Mwangi', json_encode($a['preview'][0]));
check('Admission No is text', $t['Admission No'] === 'text');
check('phone with leading zero stays text', $t['Phone'] === 'text' && $a['preview'][0][2] === '0712345678');
check('DOB is date, day-first', $t['DOB'] === 'date' && $a['preview'][0][3] === '2010-06-05', json_encode($a['preview'][0]));
check('13/01/2010 forces day-first parse', $a['preview'][2][3] === '2010-01-13');
check('thousands separators -> decimal', $t['Fee Balance'] === 'decimal' && $a['preview'][0][4] === 1200.5 && $a['preview'][3][4] === 12000);
check('Yes/No -> boolean', $t['Active'] === 'boolean' && $a['preview'][0][5] === true && $a['preview'][1][5] === false);
check('blank column excluded', count(array_filter($a['columns'], fn($c) => !$c['include'])) === 1);
check('row count', $a['total_rows'] === 4);

echo "XLSX: title rows, hidden sheet, real dates/bools\n";
[$a, $s] = analyse('report.xlsx');
$t = types($a);
check('3 sheets listed, hidden flagged', count($s->sheets) === 3 && $s->sheets[2]['hidden'] === true);
check('default sheet is first visible', $s->sheetName === 'Term 1 Report');
check('title rows skipped, header found', $a['has_header'] && $a['start_row'] === 2 && $a['columns'][1]['name'] === 'Student', json_encode(array_column($a['columns'], 'name')));
check('empty leading column excluded', $a['columns'][0]['include'] === false);
check('Excel date -> datetime (one has a time)', $t['Exam Date'] === 'datetime' && $a['preview'][0][2] === '2026-03-02 00:00:00' && $a['preview'][2][2] === '2026-03-03 09:30:00', json_encode($a['preview']));
check('Maths integer', $t['Maths'] === 'integer');
check('English: one "absent" among numbers -> still text (tolerates only 3%)', $t['English'] === 'text');
check('Passed boolean', $t['Passed'] === 'boolean' && $a['preview'][1][5] === false);
check('Mean decimal', $t['Mean'] === 'decimal' && $a['preview'][0][6] === 79.75);
check('4 data rows', $a['total_rows'] === 4);
[$a2] = analyse('report.xlsx', ['sheet' => 'Fees']);
check('other sheet selectable', $a2['columns'][0]['name'] === 'Item' && types($a2)['Amount'] === 'decimal' && types($a2)['Due'] === 'date', json_encode(types($a2)));

echo "JSON shapes\n";
[$a] = analyse('nested.json');
$names = array_column($a['columns'], 'name');
check('nested objects flattened with dots', in_array('address.city', $names, true) && in_array('address.geo.lat', $names, true), json_encode($names));
check('keys that appear only in some records are columns', in_array('extra', $names, true));
check('list of scalars joined', $a['preview'][0][array_search('tags', $names)] === 'a, b');
check('booleans typed', types($a)['active'] === 'boolean');
check('ISO date string typed', types($a)['joined'] === 'date');
[$a] = analyse('wrapped.json');
check('list found inside wrapper object', array_column($a['columns'], 'name') === ['sku', 'qty', 'price'] && $a['total_rows'] === 2);
[$a] = analyse('keyed.json');
check('keyed object -> _key column + fields', array_column($a['columns'], 'name') === ['_key', 'n', 'age'] && $a['total_rows'] === 2);
[$a] = analyse('matrix.json');
check('array-of-arrays: header detected from first row', $a['has_header'] && array_column($a['columns'], 'name') === ['city', 'pop'] && types($a)['pop'] === 'integer');
[$a] = analyse('events.ndjson');
check('NDJSON read; timestamps -> datetime', $a['total_rows'] === 2 && types($a)['t'] === 'datetime' && $a['preview'][0][0] === '2026-01-01 10:00:00', json_encode($a['preview']));

echo "Other\n";
[$a, $s] = analyse('utf16.tsv');
check('UTF-16 TSV: tab + header', $s->delimiter === "\t" && $a['has_header'] && $a['total_rows'] === 2);
check('leading-zero code kept as text', types($a)['Code'] === 'text' && $a['preview'][0][1] === '007');
[$a] = analyse('headerless.csv');
check('numeric first row is data, not a header', $a['has_header'] === false && $a['total_rows'] === 3 && $a['columns'][0]['name'] === 'Column 1');
check('types for headerless', types($a) === ['Column 1' => 'integer', 'Column 2' => 'decimal', 'Column 3' => 'integer']);
[$a] = analyse('headerless.csv', ['header' => 'yes']);
check('manual override: header=yes', $a['has_header'] && $a['total_rows'] === 2);
[$a] = analyse('us_dates.csv');
check('12/31/2025 proves month-first', types($a)['when'] === 'date' && $a['preview'][0][0] === '2025-12-31' && $a['preview'][2][0] === '2026-03-04', json_encode($a['preview']));
[$a] = analyse('us_dates.csv', ['date_order' => 'dmy']);
check('column order is decided by the data, not the default', $a['preview'][2][0] === '2026-03-04');
[$a] = analyse('dirty.csv');
check('1 dirty value in 60 is tolerated (integer), flagged', types($a)['score'] === 'integer' && $a['columns'][1]['failed'] === 1);
check('dirty value kept as text', conv('abc', 'integer', 'dmy') === 'abc');
[$a] = analyse('quoted.csv');
check('quoted multi-line cell with "" escape', $a['total_rows'] === 2 && str_contains($a['preview'][0][1], "said \"hi\"\nthen left"));

echo "Conversions\n";
check('long digit strings are identifiers, not numbers', diClassify('254712345678')['k'] === ['text']);
check('currency prefix', conv('KSh 1,200', 'integer') === 1200);
check('bool tokens', conv('N', 'boolean') === false && conv('TRUE', 'boolean') === true);
check('null tokens in typed column', conv('N/A', 'integer') === null && conv('', 'integer') === null);
check('text column keeps null-ish tokens', conv('N/A', 'text') === 'N/A');
check('2-digit year', conv('5/6/24', 'date') === '2024-06-05');
check('text month', conv('5 March 2024', 'date') === '2024-03-05' && conv('Mar 5, 2024', 'date') === '2024-03-05');
check('12h time', conv('2:30 PM', 'time') === '14:30:00');
check('impossible date rejected', diParseDateTime('31/02/2024') === null);
check('version-like "1.2.3" is text', diClassify('1.2.3')['k'] === ['text']);
check('keys: unique + readable', diColumnKeys(['Fee Balance', 'fee balance', 'Name (2)', '', 'Ünï']) === ['fee_balance', 'fee_balance_2', 'name_2', 'col', 'ünï']);

echo "File sniffing\n";
$tmp = sys_get_temp_dir() . '/di_sniff_' . getmypid();
$bad = function (string $bytes, string $kind) use ($tmp): bool { file_put_contents($tmp, $bytes); try { diSniffKind($tmp, $kind); return false; } catch (DiException $e) { return true; } };
check('binary data renamed .csv is refused', $bad("%PDF-1.7\n\x00\x01\x02binary", 'delimited'));
check('binary data renamed .json is refused', $bad("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR", 'json'));
file_put_contents($tmp, "\xFF\xFEa\x00,\x00b\x00\n\x00");
check('UTF-16 text (BOM, contains NULs) is still accepted', diSniffKind($tmp, 'delimited') === 'delimited');
file_put_contents($tmp, "name,age\nAmina,12\n");
check('plain text is accepted', diSniffKind($tmp, 'delimited') === 'delimited');
file_put_contents($tmp, "PK\x03\x04rest");
check('zip header is read as Excel whatever the extension', diSniffKind($tmp, 'delimited') === 'xlsx');
@unlink($tmp);

echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
