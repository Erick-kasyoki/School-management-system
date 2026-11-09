# Data Import — fully dynamic (Administration → Data Import)

Upload **any** Excel, CSV/TSV/TXT, JSON or NDJSON file. No fields, columns, row counts or data types are
written into the code or the database schema: the system reads the file, works out its structure, shows
you a preview, and stores it as a dataset only after you confirm.

The existing per-screen **Bulk Import** buttons (Students, Staff, Subjects, …) are untouched; they still
map spreadsheets onto that module's own fields. Data Import is the general-purpose route for everything else.

## Using it
1. **Administration → Data Import**, drop a file (or click to browse).
2. Check the preview. For every column you can **rename**, **change the type**, or **untick** it. For
   Excel you can pick the **sheet**; for text files the **separator**; you can override the **header row**
   and whether ambiguous dates (05/06/2025) are **day-first or month-first**. Changing any option re-reads
   the same upload instantly.
3. Choose **Save as a new dataset** (give it a name) or **Add to an existing dataset**, then **Import**.
4. The dataset list below lets you **View** (search every column, sort, page), **export to CSV / JSON**, or **Delete**.

## What it detects automatically
| | |
|---|---|
| **File type** | by extension *and* content (a `.csv` that is really an Excel file is read as Excel) |
| **CSV/TSV/TXT** | comma / semicolon / tab / pipe, UTF-8 (with or without BOM), UTF-16, Windows-1252; quoted multi-line cells |
| **Excel (.xlsx)** | every sheet (hidden ones flagged), real Excel dates/times/booleans, shared & inline strings, 1900/1904 date systems |
| **JSON** | array of objects · `{ "anything": [ …records… ] }` · object-of-objects (keys become a `_key` column) · array of arrays · single object · NDJSON. Nested objects become `parent.child` columns; lists of plain values are comma-joined |
| **Table start** | title / note lines above the real table are skipped; fully empty columns are left out |
| **Header row** | headed vs. header-less files (a numeric first row is data); duplicate/blank names are made unique |
| **Column types** | whole number · decimal · yes/no · date · date & time · time · text. Handles `1,200.50`, `KSh 1,200`, `Yes/No/TRUE/FALSE`, ISO and `5 March 2024` dates, 12-hour times |

Deliberate safeguards: leading-zero codes (`007`, `0712…`) and digit strings of 12+ digits (phones, IDs)
stay **text**; a column becomes numeric/date only if ≥97 % of its values fit, and any value that doesn't
is **kept as text** (and reported) rather than lost; `N/A`, `null`, `-` become empty in typed columns only.

## How it is stored (no hard-coded fields)
Two generic tables (in `schema.sql`; also created automatically on first use):
- `import_datasets` — name, source file/sheet, import history, and `columns` = `[{key, name, type}]` as JSON
- `import_rows` — one **JSONB** document per row `{column_key: value}` + a lower-cased `search` text; GIN-indexed

Any file with any headers fits without a migration. Because rows are JSONB you can also query them from SQL:
```sql
SELECT data->>'student', (data->>'maths')::int
  FROM import_rows WHERE dataset_id = 'ds_…' AND (data->>'maths')::int > 70;
```

## Files
| | |
|---|---|
| `api/import/engine.php` | readers (CSV/JSON/XLSX), header + type detection, conversion — knows nothing about any data |
| `api/handlers/dataimport.php` | endpoints `import_preview`, `import_commit`, `import_datasets`, `import_rows`, `import_update`, `import_delete`, `import_export` |
| `js/views/data-import.js`, `css/data-import.css` | the screen |
| `api/index.php`, `api/rbac.php`, `api/config.php`, `js/nav.js`, `js/shell.js`, `index.html`, `schema.sql` | small wiring edits |
| `tests/engine_test.php`, `tests/samples/` | engine tests: `php tests/engine_test.php` |

## Permission
New permission **`import.manage`** (Administration → Roles). Super Administrator has it automatically; the
built-in **Administrator** role gets it (added once to existing databases too). Grant it to any other role
from Administration → Roles. Every import and delete is written to the **Audit log**.

## Limits & notes
- 25 MB per file, 500,000 rows, 500 columns (constants in `api/import/engine.php` / `diCfg()`).
  Measured: 200,000 rows import in ~15 s; 50,000 Excel rows in ~7 s; search/sort on 200k rows < 1 s.
- Old **.xls** (Excel 97-2003) cannot be read — the screen tells the user to Save As .xlsx or CSV. Password-protected workbooks are refused with a clear message.
- XAMPP's `php.ini` must allow the upload: `upload_max_filesize` and `post_max_size` (XAMPP's default 40M is fine). The error message names these if exceeded.
- Uploaded files wait in the system temp folder (outside `htdocs`, never web-reachable) between preview and import, are deleted after import, and expired previews are cleaned after 24 h. They are tied to the user who uploaded them.
- No new PHP extensions: uses `zip` and `SimpleXML`/`XMLReader` (both on in XAMPP) plus the existing `pdo_pgsql`.

## Review fixes (2026-10-07)
Full re-test against a real PostgreSQL + PHP server (all sample files, 100k-row CSV, 30k-row XLSX, permissions, append,
export, UI flow). The import itself was sound; three weaknesses were found and fixed:
1. **Oversized uploads gave the wrong message.** When a file is bigger than php.ini `post_max_size`, PHP discards the
   whole request, and the screen said "Choose a file first". It now names `post_max_size` / `upload_max_filesize`. The
   browser also refuses files over 25 MB up front (`js/views/data-import.js`).
2. **Binary files renamed to .csv/.json were "imported" as gibberish.** `diSniffKind()` now rejects files containing NUL
   bytes (UTF-16 text with a BOM is still accepted) — `api/import/engine.php`.
3. **CSV export could carry spreadsheet formulas.** Imported text such as `=HYPERLINK(...)` or `@SUM(...)` is now
   prefixed with `'` in CSV exports so Excel shows it as text. Numbers and phone-like values (`+254712345678`) are
   untouched; JSON export is unchanged — `api/handlers/dataimport.php` (`diCsvSafe()`).
Tests: `php tests/engine_test.php` is now 57 checks (5 new for file sniffing).
