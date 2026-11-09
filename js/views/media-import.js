'use strict';
/* views/media-import.js — profile photo upload and Excel/CSV bulk import.
   Part of the EraMaster frontend — loaded after core.js. */

/* ---------------- profile photo / dp upload (admin side + student portal) ----------------
   Photos are resized client-side to a small square JPEG data: URI and stored
   directly on the record (r.photo) via the normal save path — no separate
   file storage needed. */
function avatarThumb(r){
  if (r.photo) return `<img class="avatar-thumb" src="${esc(r.photo)}" alt="">`;
  return `<span class="avatar-thumb placeholder">${esc(initials(r.name))}</span>`;
}
function resizeImageFile(file, maxDim, quality){
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) { reject(new Error('Please choose an image file.')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.onload = () => {
        let w = img.width, h = img.height;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        w = Math.round(w * scale); h = Math.round(h * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function openPhotoUpload(key, id, onDone){
  const rec = (DB[key] || []).find(r => String(r.id) === id);
  if (!rec) return;
  openModal('Upload photo — ' + (rec.name || ''), `
    <div class="photo-upload-card">
      ${rec.photo ? `<img class="photo-upload-big" src="${esc(rec.photo)}" alt="">` : `<span class="photo-upload-big placeholder">${esc(initials(rec.name))}</span>`}
      <div><input type="file" id="phFile" accept="image/*"><p class="muted" style="font-size:12px;margin:8px 0 0">JPG or PNG. It will be resized automatically.</p></div>
    </div>`, async () => {
    const file = $('phFile').files[0];
    if (!file) { toast('Choose a photo first.'); return false; }
    try {
      rec.photo = await resizeImageFile(file, 240, 0.75);
    } catch (err) { toast(err.message || 'Could not process that image.'); return false; }
    const ok = await persist(key);
    if (ok) { toast('Photo saved.'); onDone && onDone(); }
    return ok;
  });
}

/* ---------------- Excel/CSV bulk import ---------------- */
function normHeader(h){ return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
const IMPORT_ALIASES = {
  students: {
    name: ['name', 'fullname', 'studentname'], admNo: ['admno', 'admissionno', 'admissionnumber', 'regno'],
    grade: ['grade', 'class', 'form'], stream: ['stream', 'section'], gender: ['gender', 'sex'],
    dob: ['dob', 'dateofbirth'], house: ['house'], status: ['status'],
    admissionDate: ['admissiondate', 'dateadmitted'], address: ['address'],
    guardian: ['guardian', 'guardianname', 'parentname'], guardianPhone: ['guardianphone', 'parentphone', 'phone'],
    guardianEmail: ['guardianemail', 'parentemail', 'email'],
    balance: ['balance', 'feebalance'],
  },
  parents: {
    name: ['name', 'fullname', 'parentname', 'guardianname'], relationship: ['relationship', 'relation'],
    phone: ['phone', 'phonenumber', 'mobile'], email: ['email'], address: ['address'],
  },
  teachers: {
    name: ['name', 'fullname', 'staffname'], nationalId: ['nationalid', 'idno', 'id'], gender: ['gender', 'sex'],
    phone: ['phone', 'phonenumber', 'mobile'], email: ['email'], jobTitle: ['jobtitle', 'position', 'designation', 'role'],
    departmentId: ['departmentid', 'department', 'dept'],
    assignedClass: ['assignedclass', 'class', 'grade'], bankAccount: ['bankaccount', 'account', 'accountno'],
    status: ['status'],
  },
};
// Which field makes a row "the same record" on import, per module. Without one,
// a second import of the same file would quietly duplicate every row.
const IMPORT_DEDUPE_FIELD = {
  students: 'admNo', teachers: 'nationalId', parents: 'phone',
  vehicles: 'regNo', years: 'name', terms: 'name', departments: 'name', houses: 'name',
  policies: 'title', documents: 'title', announcements: 'title', events: 'title', subjects: 'code',
};
// Extra spellings a person might use in their own spreadsheet, on top of the
// module's own field names and the Export/template headings.
const IMPORT_EXTRA_ALIASES = {
  vehicles: { regNo: ['regno', 'registrationno', 'numberplate', 'plate'], driver: ['driver', 'drivername'],
    driverPhone: ['driverphone', 'driversphone', 'phone'], route: ['route', 'routename'], fee: ['fee', 'termlyfee', 'transportfee'] },
  events: { title: ['title', 'event', 'eventname', 'name'], date: ['date', 'eventdate', 'datescheduled'],
    day: ['day', 'dayscheduled', 'weekday'], time: ['time', 'starttime'], endTime: ['endtime'], venue: ['venue', 'location'] },
  announcements: { title: ['title', 'announcement', 'subject', 'headline'], type: ['type', 'announcementtype', 'category'],
    description: ['description', 'body', 'message', 'details'] },
  inquiries: { name: ['name', 'fullname', 'inquirername', 'from'], phone: ['phone', 'phonenumber', 'mobile', 'telephone'],
    email: ['email', 'emailaddress'], source: ['source', 'channel', 'via'], status: ['status', 'state'], date: ['date', 'datereceived'] },
  years: { name: ['name', 'year', 'academicyear'], start: ['start', 'openingdate', 'startdate'], end: ['end', 'closingdate', 'enddate'] },
  terms: { name: ['name', 'term'], year: ['year', 'academicyear'], start: ['start', 'openingdate', 'startdate'], end: ['end', 'closingdate', 'enddate'] },
  departments: { name: ['name', 'department', 'departmentname'], head: ['head', 'headofdepartment', 'hod'] },
  houses: { name: ['name', 'house', 'housename'], colour: ['colour', 'color'], patron: ['patron', 'housepatron'] },
  policies: { title: ['title', 'policy', 'policyname', 'name'], effectiveDate: ['effectivedate', 'datefrom'] },
  documents: { title: ['title', 'document', 'documentname', 'name'], uploadedBy: ['uploadedby', 'addedby'] },
  maintenance: { assetId: ['assetid', 'asset', 'item', 'equipment'], issue: ['issue', 'fault', 'problem', 'description'],
    dateReported: ['datereported', 'date', 'reportedon'], resolvedDate: ['resolveddate', 'datedresolved', 'dateresolved'] },
  reviews: { teacherId: ['teacherid', 'teacher', 'staff', 'staffname', 'name'], period: ['period', 'reviewperiod'],
    reviewerName: ['reviewername', 'reviewer', 'reviewedby'], areasForImprovement: ['areasforimprovement', 'improvement', 'weaknesses'] },
  training: { title: ['title', 'training', 'course', 'coursename', 'name'], teacherId: ['teacherid', 'teacher', 'staff', 'staffname'],
    provider: ['provider', 'facilitator', 'institution'] },
  leave: { teacherId: ['teacherid', 'teacher', 'staff', 'staffname', 'name'], leaveType: ['leavetype', 'type'] },
};
// Modules with no hand-tuned alias map get one built on the fly, straight from
// their own field names plus the Export/template heading — so a file exported
// from a module (or its template, filled in) always re-imports cleanly.
function genericAliasMap(key){
  const map = {};
  const extra = IMPORT_EXTRA_ALIASES[key] || {};
  keyFields(key).forEach(f => {
    const names = [normHeader(f), normHeader(fieldLabel(f))].concat((extra[f] || []).map(normHeader));
    map[f] = Array.from(new Set(names));
  });
  return map;
}
// "Relation" fields (e.g. teachers.departmentId, maintenance.assetId) store
// another module's record id, but a spreadsheet a person fills in has the
// readable name. Accept either: an id that matches, otherwise a name lookup.
function resolveRelationValue(key, field, raw){
  const rel = relationFor(key, field);
  if (!rel || !raw) return raw;
  const list = DB[rel.source] || [];
  const hit = list.find(r => String(r.id) === raw) ||
    list.find(r => String(r[rel.display] || '').toLowerCase() === raw.toLowerCase());
  return hit ? hit.id : '';
}
// Fields that should end up as numbers. Everything else stays text, so phone
// numbers, registration plates and admission numbers keep their exact form.
const NUMERIC_IMPORT_FIELDS = new Set(['amount', 'balance', 'quantity', 'capacity', 'credits', 'fee', 'assigned',
  'periods', 'cost', 'unitCost', 'totalCost', 'price', 'week', 'sessionNumber', 'copies', 'available', 'reorder',
  'lifeYears', 'salvage', 'sessionNo']);
function coerceImportValue(key, field, val){
  if (val === '') return '';
  const opts = selectOptionsFor(key, field);
  if (opts) {
    const hit = opts.find(o => String(o).toLowerCase() === String(val).toLowerCase());
    if (hit) return hit;
    if (/^(yes|y|true|1)$/i.test(val) && opts.includes('Yes')) return 'Yes';
    if (/^(no|n|false|0)$/i.test(val) && opts.includes('No')) return 'No';
  }
  if (NUMERIC_IMPORT_FIELDS.has(field) && /^-?\d+(\.\d+)?$/.test(val)) return Number(val);
  return val;
}
function mapImportRow(key, rawRow){
  const aliasMap = IMPORT_ALIASES[key] || genericAliasMap(key);
  const byNorm = {};
  Object.keys(rawRow).forEach(h => { byNorm[normHeader(h)] = rawRow[h]; });
  const out = {};
  Object.keys(aliasMap).forEach(field => {
    const alias = aliasMap[field].find(a => byNorm[a] !== undefined && String(byNorm[a]).trim() !== '');
    let val = alias ? String(byNorm[alias]).trim() : '';
    if (val) val = resolveRelationValue(key, field, val);
    out[field] = coerceImportValue(key, field, val);
  });
  return out;
}
// Fill in what the system knows itself, rather than rejecting a row for it.
function completeImportedRow(key, rec){
  if (key === 'students') { if (!rec.admNo) rec.admNo = nextAdmNo(); if (!rec.status) rec.status = 'Active'; }
  if (key === 'inquiries') { if (!rec.date) rec.date = today(); if (!rec.status) rec.status = 'Open'; if (!rec.source) rec.source = 'Other'; }
  if (key === 'announcements') { if (!rec.date) rec.date = today(); if (!rec.type) rec.type = 'General'; if (!rec.postedBy) rec.postedBy = (S.user && S.user.name) || 'Administration'; }
  if (key === 'events') { if (rec.date) rec.day = dayName(rec.date); if (!rec.audience) rec.audience = 'Everyone'; }
  if (key === 'documents' && !rec.date) rec.date = today();
  if (key === 'maintenance' && !rec.dateReported) rec.dateReported = today();
  if (key === 'leave' && !rec.dateRequested) rec.dateRequested = today();
  if (key === 'years' || key === 'terms') { if (!rec.current) rec.current = 'No'; }
  if (key === 'terms' && !rec.year && rec.start) rec.year = String(rec.start).slice(0, 4);
  return rec;
}
// Plain-CSV reader, used when the file is a .csv or when the Excel reader
// library isn't available (e.g. first run with no internet) — so Import never
// dead-ends on a CSV file.
function parseCsvText(text){
  text = String(text || '').replace(/^\ufeff/, '');
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const clean = rows.filter(r => r.some(v => String(v).trim() !== ''));
  if (!clean.length) return [];
  const head = clean[0].map(h => String(h).trim());
  return clean.slice(1).map(r => {
    const o = {};
    head.forEach((h, i) => { o[h] = (r[i] === undefined ? '' : String(r[i]).trim().replace(/^'/, '')); });
    return o;
  });
}
async function readImportRows(file){
  const isCsv = /\.csv$/i.test(file.name || '') || file.type === 'text/csv';
  if (isCsv || typeof XLSX === 'undefined') {
    if (!isCsv) { toast('Excel files need an internet connection the first time (to load the reader). Save the file as CSV and try again.'); return null; }
    return parseCsvText(await file.text());
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}
async function importExcel(key, file, onDone){
  let rows;
  try { rows = await readImportRows(file); }
  catch (err) { console.error(err); toast('Could not read that file — is it a valid CSV/Excel file?'); return; }
  if (rows === null) return;
  if (!rows.length) { toast('That file has no rows.'); return; }

  const list = DB[key];
  const nameLike = keyFields(key).includes('name') ? 'name' : (keyFields(key).includes('title') ? 'title' : '');
  const dedupeField = IMPORT_DEDUPE_FIELD[key] || nameLike;
  const keyOf = r => String((dedupeField ? r[dedupeField] : '') || '').toLowerCase();
  const existing = new Map();
  list.forEach(r => { const k = keyOf(r); if (k) existing.set(k, r); });
  let added = 0, updated = 0, skipped = 0;
  rows.forEach(raw => {
    const mapped = completeImportedRow(key, mapImportRow(key, raw));
    const hasAnyValue = Object.keys(mapped).some(f => mapped[f] !== '' && mapped[f] !== undefined);
    if (!hasAnyValue) { skipped++; return; }
    // Every record needs something to identify it by.
    if (nameLike && !mapped[nameLike] && !mapped[dedupeField]) { skipped++; return; }
    const dedupeVal = keyOf(mapped);
    const hit = dedupeVal ? existing.get(dedupeVal) : null;
    if (hit) {
      // Same record again: update it with whatever the file fills in, instead
      // of silently throwing the row away.
      let touched = false;
      Object.keys(mapped).forEach(f => { if (mapped[f] !== '' && mapped[f] !== hit[f]) { hit[f] = mapped[f]; touched = true; } });
      touched ? updated++ : skipped++;
      return;
    }
    const rec = Object.assign({ id: uid(key.slice(0, 3)) }, mapped);
    list.push(rec);
    if (dedupeVal) existing.set(dedupeVal, rec);
    added++;
  });
  if (!added && !updated) { toast(`Nothing imported — ${skipped} row${skipped === 1 ? '' : 's'} were empty or already on the system.`); return; }
  const ok = await persist(key);
  if (ok) {
    const parts = [];
    if (added) parts.push(`${added} added`);
    if (updated) parts.push(`${updated} updated`);
    if (skipped) parts.push(`${skipped} skipped`);
    toast('Import finished — ' + parts.join(', ') + '.');
    if (typeof autoMaintenance === 'function' && (key === 'years' || key === 'terms' || key === 'leave')) await autoMaintenance();
    onDone && onDone();
  }
}

function openRecordForm(key, rec, onDone){
  // Exams have their own form (grade / stream / year / term pickers, calendar dates, end date, status).
  if (key === 'exams' && typeof openExamForm === 'function') return openExamForm(rec, onDone);
  const fields = keyFields(key);
  const data = rec ? clone(rec) : blankRecord(key);
  const isNew = !rec;
  const body = `<div class="form-grid">${fields.map(f => {
    if (key === 'transactions' && f === 'partyName') return '';
    if (key === 'transactions' && f === 'partyType') {
      return `<label>Paid by / to</label><select class="rf" data-f="partyType"><option value="">— not a school person —</option>${PAYEE_KINDS.map(k => `<option ${data.partyType === k ? 'selected' : ''}>${k}</option>`).join('')}</select>`
        + `<label>Choose person</label><select class="rf" data-f="partyId" data-initial="${esc(data.partyId || '')}"></select>`;
    }
    const relOpts = relationOptionsFor(key, f);
    const opts = selectOptionsFor(key, f);
    const val = data[f] == null ? '' : data[f];
    let control;
    if (relOpts) {
      control = `<select class="rf" data-f="${esc(f)}"><option value="">— none —</option>${relOpts.map(([id, label]) => `<option value="${esc(id)}" ${String(val) === id ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
    } else if (opts) {
      control = `<select class="rf" data-f="${esc(f)}">${opts.map(o => `<option value="${esc(o)}" ${String(val) === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    } else if (f === 'objectives' || f === 'resources' || f === 'description' || f === 'reply') {
      control = `<textarea class="rf" data-f="${esc(f)}" rows="3">${esc(val)}</textarea>`;
    } else {
      control = `<input class="rf" data-f="${esc(f)}" value="${esc(val)}">`;
    }
    return `<label>${esc(fieldLabel(f))}</label>${control}`;
  }).join('')}</div>`;
  openModal(isNew ? 'Add — ' + fieldLabel(key) : 'Edit — ' + fieldLabel(key), body, async () => {
    const out = isNew ? { id: uid(key.slice(0, 3)) } : { id: rec.id };
    document.querySelectorAll('#modalBody .rf').forEach(inp => {
      const f = inp.dataset.f, v = inp.value;
      out[f] = (v.trim() !== '' && /^-?\d+(\.\d+)?$/.test(v.trim())) ? Number(v) : v;
    });
    // The day of the week always follows the date that was chosen.
    if (key === 'events' && out.date) out.day = dayName(out.date);
    if (key === 'transactions') {
      const d = out.partyType && out.partyId ? payeeDetails(out.partyType, out.partyId) : null;
      out.partyName = d ? d.name : ''; if (!d) out.partyId = '';
    }
    const list = DB[key];
    if (isNew) list.push(out); else Object.assign(list.find(r => r.id === rec.id), out);
    const ok = await persist(key);
    if (ok) {
      toast('Saved.');
      // Changing a year's or term's dates re-checks which term the school is in.
      if ((key === 'years' || key === 'terms' || key === 'leave') && typeof autoMaintenance === 'function') await autoMaintenance();
      onDone && onDone();
    }
    return ok;
  });
  const findInp = f => document.querySelector(`#modalBody .rf[data-f="${f}"]`);
  const setIfEmpty = (f, v) => { const el2 = findInp(f); if (el2 && !el2.value && v) el2.value = v; };
  // Anywhere money is paid: pick the person and their details appear (and fill what they can).
  if (PAYEE_FIELD[key] || key === 'transactions') wirePayeePicker(key, findInp, setIfEmpty);
  // Discipline/welfare: typing a valid admission number auto-fills the student's
  // name/class/stream, so staff don't have to retype what's already on file.
  if ((key === 'discipline' || key === 'welfare') && fields.includes('admNo')) {
    const admInp = findInp('admNo');
    if (admInp) admInp.addEventListener('change', () => {
      const s = (DB.students || []).find(x => x.admNo === admInp.value.trim());
      if (!s) return;
      setIfEmpty('studentName', s.name); setIfEmpty('grade', s.grade); setIfEmpty('stream', s.stream);
    });
  }
  // Inquiries: typing a name that's already known (parent, learner's guardian,
  // staff member or past inquiry) fills in the phone and email by itself.
  if (key === 'inquiries') {
    const nameInp = findInp('name');
    if (nameInp) nameInp.addEventListener('change', () => {
      const q = nameInp.value.trim().toLowerCase();
      if (!q) return;
      const from = (arr, nf, pf, ef) => (arr || []).filter(Boolean)
        .filter(r => String(r[nf] || '').toLowerCase() === q)
        .map(r => ({ phone: r[pf], email: r[ef] }))[0];
      const hit = from(DB.parents, 'name', 'phone', 'email')
        || from(DB.teachers, 'name', 'phone', 'email')
        || from(DB.inquiries, 'name', 'phone', 'email')
        || from(DB.students, 'guardian', 'guardianPhone', 'guardianEmail');
      if (!hit) return;
      setIfEmpty('phone', hit.phone); setIfEmpty('email', hit.email);
    });
  }
  // The day of the week is filled in from the date as soon as it's chosen.
  if (key === 'events') {
    const dInp = findInp('date'), dayInp = findInp('day');
    if (dInp && dayInp) {
      const sync = () => { if (dInp.value) dayInp.value = dayName(dInp.value); };
      dInp.addEventListener('change', sync); sync();
    }
  }
}
function confirmDeleteRecord(key, id, onDone){
  openModal('Delete record', '<p>This cannot be undone. Delete this record?</p>', async () => {
    DB[key] = (DB[key] || []).filter(r => String(r.id) !== id);
    const ok = await persist(key);
    if (ok) { toast('Deleted.'); onDone && onDone(); }
    return ok;
  }, { saveLabel: 'Delete' });
}

