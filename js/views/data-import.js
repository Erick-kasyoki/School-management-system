'use strict';
/* views/data-import.js — Administration → Data Import.
   Upload any Excel / CSV / JSON file. The server detects headers, types and structure; this screen shows
   the detected result as an editable preview, then imports it as a dataset. Nothing here names a field. */

const DI = { token: null, a: null, file: null, source: null, opts: { sheet: '', delimiter: 'auto', header: 'auto', date_order: 'dmy' }, datasets: [], busy: false };
const DI_TYPE_LABEL = { text: 'Text', integer: 'Whole number', decimal: 'Decimal', boolean: 'Yes / No', date: 'Date', datetime: 'Date & time', time: 'Time' };

function diBytes(n){ return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
function diFmt(v, type){
  if (v === null || v === undefined || v === '') return '<span class="di-null">—</span>';
  if (type === 'boolean' && typeof v === 'boolean') return v ? '✓' : '✗';
  if ((type === 'integer' || type === 'decimal') && typeof v === 'number') return esc(v.toLocaleString(undefined, { maximumFractionDigits: 6 }));
  return esc(String(v));
}
function diTypeSelect(cur, attrs){
  return `<select ${attrs}>${Object.keys(DI_TYPE_LABEL).map(t => `<option value="${t}" ${t === cur ? 'selected' : ''}>${DI_TYPE_LABEL[t]}</option>`).join('')}</select>`;
}
async function diUploadPreview(fd){
  try {
    const r = await fetch(`${API}?action=import_preview`, { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'EraMaster' }, body: fd });
    const res = await parseApiResponse(r, 'import_preview');
    handleAuthLoss(res, 'import_preview');
    return res;
  } catch (e) { toast('Could not reach the server.'); return { ok: false, error: 'Network error — could not reach the server.' }; }
}

function renderDataImport(el){
  el.innerHTML = `<div class="di-wrap">
    <div class="di-intro"><p class="muted">Drop in any Excel, CSV, TSV or JSON file — any columns, any kind of data. The system finds the headers and data types for you, shows a preview, and only saves once you confirm.</p></div>
    <div id="diDrop" class="di-drop" tabindex="0" role="button" aria-label="Choose a file to import">
      <div class="di-drop-ic">📥</div>
      <div><b>Drop a file here</b> or <u>click to browse</u></div>
      <div class="muted">.xlsx · .csv · .tsv · .txt · .json · .ndjson — up to 25 MB, any number of columns</div>
      <input type="file" id="diFile" accept=".xlsx,.xlsm,.csv,.tsv,.txt,.json,.ndjson,.jsonl" hidden>
    </div>
    <div id="diStage"></div>
    <div class="panel"><h3>Imported datasets</h3><div id="diList"><div class="muted">Loading…</div></div></div>
  </div>`;
  const drop = $('diDrop'), inp = $('diFile');
  drop.onclick = () => inp.click();
  drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } };
  inp.onchange = () => { if (inp.files[0]) diStart(inp.files[0]); inp.value = ''; };
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) diStart(f); });
  diLoadList();
}

async function diStart(file){
  if (file.size > 25 * 1048576) { $('diStage').innerHTML = `<div class="di-error">That file is ${diBytes(file.size)} — the limit is 25 MB. Split it into smaller files.</div>`; return; }
  DI.opts = { sheet: '', delimiter: 'auto', header: 'auto', date_order: 'dmy' };
  const fd = new FormData(); fd.append('file', file);
  diStageMsg('Reading ' + esc(file.name) + '…');
  const res = await diUploadPreview(fd);
  if (!res.ok) { $('diStage').innerHTML = `<div class="di-error">${esc(res.error || 'Could not read that file.')}</div>`; return; }
  diAccept(res);
}
async function diReread(){
  const fd = new FormData(); fd.append('token', DI.token);
  Object.keys(DI.opts).forEach(k => fd.append(k, DI.opts[k]));
  diStageMsg('Re-reading…');
  const res = await diUploadPreview(fd);
  if (!res.ok) { toast(res.error || 'Could not re-read the file.'); diDraw(); return; }
  diAccept(res);
}
function diAccept(res){
  DI.token = res.token; DI.a = res.analysis; DI.file = res.file; DI.source = res.source;
  DI.opts = Object.assign({}, DI.opts, res.options, { sheet: res.source.sheet || '' });
  diDraw();
}
function diStageMsg(html){ $('diStage').innerHTML = `<div class="panel di-busy"><span class="di-spin"></span> ${html}</div>`; }

function diDraw(){
  const a = DI.a, f = DI.file, s = DI.source; if (!a) return;
  const inc = () => a.columns.filter(c => c.include).length;
  const opt = (v, cur, label) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`;
  $('diStage').innerHTML = `<div class="panel di-card">
    <div class="di-filebar">
      <div><b>${esc(f.name)}</b> <span class="badge">${esc({ delimited: 'Delimited text', json: 'JSON', ndjson: 'JSON lines', xlsx: 'Excel' }[f.kind] || f.kind)}</span>
        <span class="muted">${diBytes(f.size)} · ${a.total_rows.toLocaleString()} data row${a.total_rows === 1 ? '' : 's'} · ${a.width} column${a.width === 1 ? '' : 's'}</span></div>
      <button class="btn ghost tiny" id="diCancel">✕ Cancel</button>
    </div>
    <div class="di-opts">
      ${s.sheets && s.sheets.length > 1 ? `<label>Sheet<select id="diSheet">${s.sheets.map(x => opt(x.name, DI.opts.sheet, esc(x.name) + (x.hidden ? ' (hidden)' : ''))).join('')}</select></label>` : ''}
      ${f.kind === 'delimited' ? `<label>Separator<select id="diDelim">${opt('auto', DI.opts.delimiter, 'Auto-detect' + (DI.opts.delimiter === 'auto' && s.delimiter ? ' (' + s.delimiter + ')' : ''))}${opt('comma', DI.opts.delimiter, 'Comma ,')}${opt('semicolon', DI.opts.delimiter, 'Semicolon ;')}${opt('tab', DI.opts.delimiter, 'Tab')}${opt('pipe', DI.opts.delimiter, 'Pipe |')}</select></label>` : ''}
      ${s.header_fixed ? '' : `<label>First row<select id="diHeader">${opt('auto', DI.opts.header, 'Auto-detect (' + (a.has_header ? 'is a header' : 'is data') + ')')}${opt('yes', DI.opts.header, 'Is the header')}${opt('no', DI.opts.header, 'Is data (no header)')}</select></label>`}
      <label>Ambiguous dates<select id="diDateOrder">${opt('dmy', DI.opts.date_order, 'Day first (31/12/2025)')}${opt('mdy', DI.opts.date_order, 'Month first (12/31/2025)')}</select></label>
    </div>
    ${a.warnings.length ? `<ul class="di-warn">${a.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    <h4>Detected columns <span class="muted">— rename, change the type, or untick to leave out</span></h4>
    <div class="di-cols-wrap"><table class="tbl di-cols"><thead><tr><th></th><th>#</th><th>Column name</th><th>Type</th><th>Filled</th><th>Distinct</th><th>Range</th><th>Examples</th></tr></thead><tbody>
      ${a.columns.map((c, i) => { const tot = c.non_empty + c.empty; const pct = tot ? Math.round(100 * c.non_empty / tot) : 0;
        return `<tr class="${c.include ? '' : 'off'}" data-i="${i}">
          <td><input type="checkbox" class="di-inc" ${c.include ? 'checked' : ''} aria-label="Include column ${esc(c.name)}"></td>
          <td class="muted">${i + 1}</td>
          <td><input class="di-name" value="${esc(c.name)}" maxlength="150"></td>
          <td>${diTypeSelect(c.type, 'class="di-type"')}${c.failed ? `<div class="di-bad">${c.failed} won't fit</div>` : ''}</td>
          <td>${pct}%</td><td>${c.distinct}${c.distinct_capped ? '+' : ''}</td>
          <td class="muted di-range">${c.min !== null && c.min !== undefined ? esc(String(c.min)) + ' → ' + esc(String(c.max)) : ''}</td>
          <td class="muted di-ex">${c.samples.map(x => esc(x)).join(' · ')}</td></tr>`; }).join('')}
    </tbody></table></div>
    <h4>Preview <span class="muted">— first ${a.preview.length} of ${a.total_rows.toLocaleString()} rows, as they will be stored</span></h4>
    <div class="di-prev-wrap"><table class="tbl di-prev"><thead><tr><th class="di-rn">#</th>${a.columns.map((c, i) => `<th data-c="${i}" class="${c.include ? '' : 'off'}">${esc(c.name)}<small>${DI_TYPE_LABEL[c.type]}</small></th>`).join('')}</tr></thead>
      <tbody>${a.preview.map((r, ri) => `<tr><td class="di-rn">${ri + 1}</td>${r.map((v, j) => `<td data-c="${j}" class="${a.columns[j].include ? '' : 'off'} ${['integer', 'decimal'].includes(a.columns[j].type) ? 'num' : ''} ${(a.preview_flags[ri] || []).includes(j) ? 'bad' : ''}">${diFmt(v, a.columns[j].type)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="di-target">
      <label class="di-radio"><input type="radio" name="diMode" value="new" checked> Save as a new dataset</label>
      <input id="diName" placeholder="Dataset name" maxlength="200" value="${esc(f.name.replace(/\.[^.]+$/, ''))}">
      <input id="diDesc" placeholder="Description (optional)" maxlength="500">
      ${DI.datasets.length ? `<label class="di-radio"><input type="radio" name="diMode" value="append"> Add to an existing dataset</label>
        <select id="diAppend" disabled>${DI.datasets.map(d => `<option value="${esc(d.id)}">${esc(d.name)} (${d.row_count.toLocaleString()} rows)</option>`).join('')}</select>` : ''}
    </div>
    <div class="di-foot"><span class="muted" id="diCount"></span><button class="btn primary" id="diImport">Import ${a.total_rows.toLocaleString()} row${a.total_rows === 1 ? '' : 's'}</button></div>
  </div>`;
  diWire();
  $('diStage').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function diWire(){
  const a = DI.a;
  const upd = () => { $('diCount').textContent = a.columns.filter(c => c.include).length + ' of ' + a.columns.length + ' columns selected'; };
  upd();
  $('diCancel').onclick = () => { DI.token = DI.a = null; $('diStage').innerHTML = ''; };
  const re = (id, key) => { const e = $(id); if (e) e.onchange = () => { DI.opts[key] = e.value; diReread(); }; };
  re('diSheet', 'sheet'); re('diDelim', 'delimiter'); re('diHeader', 'header'); re('diDateOrder', 'date_order');
  document.querySelectorAll('.di-cols tbody tr').forEach(tr => {
    const i = +tr.dataset.i;
    tr.querySelector('.di-inc').onchange = e => {
      a.columns[i].include = e.target.checked; tr.classList.toggle('off', !e.target.checked);
      document.querySelectorAll(`.di-prev [data-c="${i}"]`).forEach(x => x.classList.toggle('off', !e.target.checked)); upd();
    };
    tr.querySelector('.di-name').oninput = e => {
      a.columns[i].name = e.target.value;
      const th = document.querySelector(`.di-prev th[data-c="${i}"]`); if (th) th.firstChild.textContent = e.target.value;
    };
    tr.querySelector('.di-type').onchange = e => { a.columns[i].type = e.target.value; const sm = document.querySelector(`.di-prev th[data-c="${i}"] small`); if (sm) sm.textContent = DI_TYPE_LABEL[e.target.value]; };
  });
  document.querySelectorAll('input[name=diMode]').forEach(r => r.onchange = () => {
    const app = document.querySelector('input[name=diMode]:checked').value === 'append';
    $('diName').disabled = app; $('diDesc').disabled = app; if ($('diAppend')) $('diAppend').disabled = !app;
  });
  $('diImport').onclick = diCommit;
}

async function diCommit(){
  if (DI.busy) return;
  const a = DI.a;
  if (!a.columns.some(c => c.include)) { toast('Tick at least one column to import.'); return; }
  const mode = document.querySelector('input[name=diMode]:checked').value;
  const body = { token: DI.token, mode, options: DI.opts, name: $('diName').value.trim(), description: $('diDesc').value.trim(),
    dataset_id: mode === 'append' && $('diAppend') ? $('diAppend').value : '',
    columns: a.columns.map(c => ({ index: c.index, name: c.name, type: c.type, include: c.include })) };
  if (mode === 'new' && !body.name) { toast('Give the dataset a name.'); $('diName').focus(); return; }
  const btn = $('diImport'); DI.busy = true; btn.disabled = true; btn.innerHTML = '<span class="di-spin"></span> Importing…';
  const res = await apiPost('import_commit', body);
  DI.busy = false;
  if (!res.ok) { btn.disabled = false; btn.textContent = 'Import ' + a.total_rows.toLocaleString() + ' rows'; toast(res.error || 'Import failed.'); return; }
  toast(`Imported ${res.imported.toLocaleString()} row${res.imported === 1 ? '' : 's'} into “${res.dataset.name}”.`);
  const warn = (res.warnings || []).concat(res.blank_rows_skipped ? [res.blank_rows_skipped + ' blank row(s) skipped.'] : []);
  DI.token = DI.a = null;
  $('diStage').innerHTML = `<div class="panel di-done"><b>✓ Imported ${res.imported.toLocaleString()} rows into “${esc(res.dataset.name)}”.</b>
    ${warn.length ? `<ul class="di-warn">${warn.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    <div><button class="btn ghost" id="diViewNew">View data</button> <button class="btn ghost" id="diAgain">Import another file</button></div></div>`;
  $('diAgain').onclick = () => { $('diStage').innerHTML = ''; $('diDrop').scrollIntoView({ behavior: 'smooth' }); };
  $('diViewNew').onclick = () => diViewData(res.dataset.id);
  diLoadList();
}

/* ---------------- dataset list ---------------- */
async function diLoadList(){
  const res = await apiGet('import_datasets');
  const box = $('diList'); if (!box) return;
  if (!res.ok) { box.innerHTML = `<div class="di-error">${esc(res.error || 'Could not load datasets.')}</div>`; return; }
  DI.datasets = res.datasets;
  if (!DI.datasets.length) { box.innerHTML = '<div class="empty"><b>Nothing imported yet</b>Upload a file above to create your first dataset.</div>'; return; }
  box.innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Dataset</th><th>Rows</th><th>Columns</th><th>Source</th><th>Updated</th><th></th></tr></thead><tbody>
    ${DI.datasets.map(d => `<tr>
      <td><b>${esc(d.name)}</b>${d.description ? `<div class="muted">${esc(d.description)}</div>` : ''}</td>
      <td>${d.row_count.toLocaleString()}</td>
      <td><span class="di-chips">${d.columns.slice(0, 6).map(c => `<span class="di-chip">${esc(c.name)}</span>`).join('')}${d.columns.length > 6 ? `<span class="di-chip more">+${d.columns.length - 6}</span>` : ''}</span></td>
      <td class="muted">${esc(d.source_file)}${d.sheet_name ? ' · ' + esc(d.sheet_name) : ''}</td>
      <td class="muted">${esc(String(d.updated_at).slice(0, 16).replace('T', ' '))}<div>${esc(d.created_by_name || '')}</div></td>
      <td class="di-actions"><button class="btn ghost tiny" data-v="${esc(d.id)}">View</button>
        <a class="btn ghost tiny" href="${API}?action=import_export&id=${encodeURIComponent(d.id)}&format=csv">CSV</a>
        <a class="btn ghost tiny" href="${API}?action=import_export&id=${encodeURIComponent(d.id)}&format=json">JSON</a>
        <button class="btn danger tiny" data-x="${esc(d.id)}">Delete</button></td></tr>`).join('')}
  </tbody></table></div>`;
  box.querySelectorAll('[data-v]').forEach(b => b.onclick = () => diViewData(b.dataset.v));
  box.querySelectorAll('[data-x]').forEach(b => b.onclick = () => diConfirmDelete(b.dataset.x));
}
function diConfirmDelete(id){
  const d = DI.datasets.find(x => x.id === id); if (!d) return;
  openModal('Delete dataset', `<p>Delete <b>${esc(d.name)}</b> and its ${d.row_count.toLocaleString()} rows? This cannot be undone.</p>`, async () => {
    const res = await apiPost('import_delete', { id });
    if (!res.ok) { toast(res.error || 'Could not delete.'); return false; }
    toast('Dataset deleted.'); diLoadList(); return true;
  }, { saveLabel: 'Delete' });
}

/* ---------------- dataset viewer ---------------- */
function diViewData(id){
  const st = { page: 1, per: 50, q: '', sort: '', dir: 'asc' };
  openModal('Dataset', '<div id="dvBody" class="muted">Loading…</div>', null, { wide: true, noFoot: true });
  let timer = null;
  const load = async () => {
    const res = await apiGet('import_rows', { id, page: st.page, per: st.per, q: st.q, sort: st.sort, dir: st.dir });
    const body = $('dvBody'); if (!body) return;
    if (!res.ok) { body.innerHTML = `<div class="di-error">${esc(res.error || 'Could not load.')}</div>`; return; }
    const cols = res.dataset.columns, pages = Math.max(1, Math.ceil(res.total / res.per));
    $('modalTitle').textContent = res.dataset.name + ' — ' + res.dataset.row_count.toLocaleString() + ' rows';
    body.innerHTML = `<div class="di-viewbar"><input type="search" id="dvQ" placeholder="Search every column…" value="${esc(st.q)}">
        <span class="muted">${res.total.toLocaleString()} match${res.total === 1 ? '' : 'es'}</span></div>
      <div class="di-view-wrap"><table class="tbl di-prev"><thead><tr><th class="di-rn">#</th>${cols.map(c => `<th data-k="${esc(c.key)}" class="sortable">${esc(c.name)}${st.sort === c.key ? (st.dir === 'asc' ? ' ▲' : ' ▼') : ''}<small>${DI_TYPE_LABEL[c.type] || c.type}</small></th>`).join('')}</tr></thead>
      <tbody>${res.rows.map(r => `<tr><td class="di-rn">${r.n}</td>${cols.map(c => `<td class="${['integer', 'decimal'].includes(c.type) ? 'num' : ''}">${diFmt(r.d[c.key], c.type)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length + 1}" class="muted">No rows match.</td></tr>`}</tbody></table></div>
      <div class="di-pager"><button class="btn ghost tiny" id="dvPrev" ${st.page <= 1 ? 'disabled' : ''}>← Prev</button><span class="muted">Page ${st.page} of ${pages}</span><button class="btn ghost tiny" id="dvNext" ${st.page >= pages ? 'disabled' : ''}>Next →</button></div>`;
    const q = $('dvQ'); q.focus(); q.setSelectionRange(q.value.length, q.value.length);
    q.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { st.q = q.value; st.page = 1; load(); }, 300); };
    $('dvPrev').onclick = () => { st.page--; load(); }; $('dvNext').onclick = () => { st.page++; load(); };
    body.querySelectorAll('th.sortable').forEach(th => th.onclick = () => { const k = th.dataset.k; st.dir = st.sort === k && st.dir === 'asc' ? 'desc' : 'asc'; st.sort = k; st.page = 1; load(); });
  };
  load();
}
