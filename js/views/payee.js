'use strict';
/* views/payee.js — "who is this payment for / to?" picker.
   Wherever money is paid or received (Fees quick payment, Fee Payments, Invoices, Discounts,
   Purchases, Transactions Ledger) the person picks the student / staff member / parent / supplier
   and their details are pulled from the existing records and shown on a card — nothing is retyped.
   Loaded after core.js and the crud files; used by fees.js and media-import.js. */

const PAYEE_SOURCES = { Student: 'students', Staff: 'teachers', Parent: 'parents', Supplier: 'suppliers' };
const PAYEE_KINDS = Object.keys(PAYEE_SOURCES);
// Which relation field on a module's form is "the person being paid / paying" (besides Transactions, handled separately).
const PAYEE_FIELD = { payments: ['studentId', 'Student'], invoices: ['studentId', 'Student'], discounts: ['studentId', 'Student'], purchases: ['supplierId', 'Supplier'] };

function payeeList(kind){ return (DB[PAYEE_SOURCES[kind]] || []); }
function payeeOptions(kind){
  return payeeList(kind).map(r => {
    const sub = kind === 'Student' ? r.admNo : kind === 'Staff' ? r.staffNo : kind === 'Supplier' ? r.category : r.relationship;
    return [r.id, (r.name || r.id) + (sub ? ' · ' + sub : '')];
  });
}
function payeeRecord(kind, id){ return payeeList(kind).find(r => String(r.id) === String(id)) || null; }

/** Everything we know about the person, as { kind, name, ref, lines:[[label,value]], balance }. */
function payeeDetails(kind, id){
  const r = payeeRecord(kind, id);
  if (!r) return null;
  const d = { kind, id: r.id, name: r.name || '—', ref: '', lines: [], balance: null, photo: r.photo || '' };
  if (kind === 'Student') {
    const par = (DB.parents || []).find(p => p.id === r.parentId) || {};
    d.ref = r.admNo || '';
    d.balance = Number(r.balance) || 0;
    d.lines = [['Class', classLabel({ grade: r.grade, stream: r.stream })], ['Guardian', r.guardian || par.name], ['Phone', r.guardianPhone || par.phone], ['Email', par.email], ['Status', r.status]];
  } else if (kind === 'Staff') {
    d.ref = r.staffNo || '';
    d.lines = [['Role', r.jobTitle], ['Department', typeof departmentName === 'function' ? departmentName(r.departmentId) : ''], ['Phone', r.phone], ['Email', r.email], ['Bank account', r.bankAccount]];
  } else if (kind === 'Parent') {
    const kids = (DB.students || []).filter(s => s.parentId === r.id);
    d.ref = r.relationship || '';
    d.balance = kids.length ? kids.reduce((a, s) => a + (Number(s.balance) || 0), 0) : null;
    d.lines = [['Phone', r.phone], ['Email', r.email], ['Children', kids.map(s => s.name).join(', ')]];
  } else {
    d.ref = r.category || '';
    d.lines = [['Contact person', r.contactPerson], ['Phone', r.phone], ['Email', r.email], ['Address', r.address]];
  }
  return d;
}
function payeeCardHtml(d, opts){
  opts = opts || {};
  if (!d) return '';
  const col = typeof lrnAvatarColor === 'function' ? lrnAvatarColor(d.name) : { c: 'var(--g-700)', tint: 'var(--g-100)' };
  const rows = d.lines.filter(l => l[1]).map(l => `<div><span>${esc(l[0])}</span><b>${esc(l[1])}</b></div>`).join('');
  const bal = d.balance === null ? '' : `<div class="payee-bal ${d.balance > 0 ? 'owing' : 'clear'}"><span>${d.kind === 'Parent' ? 'Children\'s balance' : 'Fee balance'}</span><b>${d.balance > 0 ? esc(money(d.balance)) : 'Fully paid'}</b>${opts.useBalance && d.balance > 0 ? `<button type="button" class="btn tiny ghost" data-use-balance="${d.balance}">Use as amount</button>` : ''}</div>`;
  return `<div class="payee-card">
    <div class="payee-head"><span class="lrn-avatar" style="--ac:${col.c};--at:${col.tint}">${d.photo ? `<img src="${esc(d.photo)}" alt="">` : esc(initials(d.name))}</span>
      <div><b>${esc(d.name)}</b><small>${esc(d.kind)}${d.ref ? ' · ' + esc(d.ref) : ''}</small></div></div>
    <div class="payee-grid">${rows}</div>${bal}</div>`;
}

/** Wires the picker into the generic Add/Edit form (openRecordForm). */
function wirePayeePicker(key, findInp, setIfEmpty){
  const body = document.querySelector('#modalBody');
  const grid = body && body.querySelector('.form-grid');
  if (!grid) return;
  const holder = document.createElement('div');
  holder.id = 'payeeCardHolder';
  grid.parentNode.insertBefore(holder, grid.nextSibling);
  const useBal = (el) => el.querySelectorAll('[data-use-balance]').forEach(b => b.onclick = () => { const a = findInp('amount') || findInp('totalCost'); if (a) a.value = b.dataset.useBalance; });

  // Modules with a single relation field (student / supplier) — show that person's card when chosen.
  if (PAYEE_FIELD[key]) {
    const [field, kind] = PAYEE_FIELD[key];
    const sel = findInp(field);
    if (!sel) return;
    const show = () => {
      const d = payeeDetails(kind, sel.value);
      holder.innerHTML = d ? payeeCardHtml(d, { useBalance: key === 'payments' }) : '';
      useBal(holder);
      if (d && key === 'payments') { const t = typeof currentTerm === 'function' ? currentTerm() : null; setIfEmpty('term', t && t.name); setIfEmpty('date', today()); }
    };
    sel.addEventListener('change', show); show();
    return;
  }
  // Transactions Ledger — choose the kind of person, then the person; description & category follow.
  if (key === 'transactions') {
    const kindSel = findInp('partyType'), who = findInp('partyId');
    if (!kindSel || !who) return;
    let lastDesc = null, lastCat = null;
    const fill = (kind) => {
      const keep = who.dataset.keep || '';
      who.innerHTML = '<option value="">— choose —</option>' + payeeOptions(kind).map(([id, l]) => `<option value="${esc(id)}" ${id === keep ? 'selected' : ''}>${esc(l)}</option>`).join('');
      who.disabled = !kind || kind === 'Other';
      who.dataset.keep = '';
    };
    const show = (auto) => {
      const kind = kindSel.value, d = kind && who.value ? payeeDetails(kind, who.value) : null;
      holder.innerHTML = d ? payeeCardHtml(d) : '';
      if (!d || !auto) return;
      const type = findInp('type'), income = kind === 'Student' || kind === 'Parent';
      if (type) type.value = income ? 'Income' : 'Expense';
      const desc = findInp('description'), cat = findInp('category');
      const text = income ? 'Fee payment — ' + d.name : kind === 'Staff' ? 'Salary payment — ' + d.name : 'Payment to ' + d.name;
      const c = income ? 'School Fees' : kind === 'Staff' ? 'Salaries' : 'Supplies';
      if (desc && (!desc.value || desc.value === lastDesc)) { desc.value = text; lastDesc = text; }
      if (cat && (!cat.value || cat.value === lastCat)) { cat.value = c; lastCat = c; }
    };
    kindSel.addEventListener('change', () => { who.dataset.keep = ''; fill(kindSel.value); show(false); });
    who.addEventListener('change', () => show(true));
    who.dataset.keep = who.dataset.initial || '';
    fill(kindSel.value); show(false);
  }
}
