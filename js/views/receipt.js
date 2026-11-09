'use strict';
/* views/receipt.js — Payment Receipt screen (shown automatically after a payment is recorded)
   and the Receipts history list.
   Part of the EraMaster frontend — loaded after core.js, codes.js and fees.js.

   A receipt is not a separate record: it is built on the fly from the payment record
   (DB.payments), the student, the parent, the fee structure and the school profile, so it
   can never disagree with the fees data. Extra fields the receipt uses are stored on the
   payment itself: time, reference, network, cashier, cancelState, refundState. */

let RECEIPT_ID = null;        // payment id being viewed (null = show the history list)
let RECEIPT_BACK = 'fees';    // screen the Back button returns to
let RECEIPT_SEARCH = '';      // search text carried into the history list

/* ---------------- helpers ---------------- */
const RCP_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function rcpDate(s){
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? `${Number(m[3])} ${RCP_MONTHS[Number(m[2]) - 1]} ${m[1]}` : (s || '—');
}
function rcpNum(n){ return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function rcpTime12(d){
  d = d || new Date();
  let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
}
function rcpNow(){ const d = new Date(); return `${d.getDate()} ${RCP_MONTHS[d.getMonth()]} ${d.getFullYear()} ${rcpTime12(d)}`; }
function rcpYear(date){
  const d = String(date || '');
  const y = (DB.years || []).find(x => x.start && x.end && d >= x.start && d <= x.end);
  return y ? y.name : d.slice(0, 4);
}
function findPayment(id){ return (DB.payments || []).find(p => String(p.id) === String(id)) || null; }

/** Next sequential receipt number for the year: RCP-2026-000245 */
function nextReceiptNo(){
  const y = new Date().getFullYear(); let max = 0;
  (DB.payments || []).forEach(p => {
    const m = /^RCP-(\d{4})-(\d+)$/.exec(p.receipt || '');
    if (m && Number(m[1]) === y) max = Math.max(max, Number(m[2]));
  });
  return `RCP-${y}-${String(max + 1).padStart(6, '0')}`;
}

/** Opens the receipt screen for a payment. */
function openReceipt(id){
  RECEIPT_ID = id;
  if (currentViewId !== 'receipts') RECEIPT_BACK = currentViewId;
  goTo('receipts');
}

/* ---------------- receipt data ---------------- */
function rcpInvoiceFor(q){
  const inv = (DB.invoices || []).find(i => i.studentId === q.studentId && (!q.term || !i.term || i.term === q.term) && (!i.feeType || i.feeType === q.feeType))
    || (DB.invoices || []).find(i => i.studentId === q.studentId && (!q.term || !i.term || i.term === q.term));
  return q.invoiceNo || (inv && inv.invoiceNo) || '—';
}

function receiptModel(p){
  const list = DB.payments || [];
  const idx = list.indexOf(p);
  const s = (DB.students || []).find(x => x.id === p.studentId) || {};
  const par = (DB.parents || []).find(x => x.id === s.parentId) || null;
  const prof = (DB.settings && DB.settings.profile) || {};
  const live = q => q.cancelState !== 'Cancelled';
  const cancelled = !live(p);
  const amount = Number(p.amount) || 0;
  const before = (q, i) => String(q.date || '') < String(p.date || '') || (q.date === p.date && i <= idx);

  // balance after this payment = balance today + everything paid after it
  const laterSum = list.reduce((a, q, i) => (q.studentId === p.studentId && live(q) && !before(q, i)) ? a + (Number(q.amount) || 0) : a, 0);
  const remaining = Math.max(0, (Number(s.balance) || 0) + laterSum);
  const previous = cancelled ? remaining : remaining + amount;

  // fee lines: the class's fee structure for the term, with what has been paid up to this receipt
  const term = p.term || '';
  const paidOf = type => list.reduce((a, q, i) => (q.studentId === p.studentId && live(q) && (q.term || '') === term && (q.feeType || '') === type && before(q, i)) ? a + (Number(q.amount) || 0) : a, 0);
  const fs = (DB.feestructures || []).filter(f => f.grade === s.grade && (!term || !f.term || f.term === term));
  const byType = {};
  fs.forEach(f => { byType[f.feeType || 'Fees'] = (byType[f.feeType || 'Fees'] || 0) + (Number(f.amount) || 0); });
  let lines = Object.keys(byType).map(t => ({ desc: t, amount: byType[t], paid: paidOf(t) }));
  if (lines.length) {
    // a fee type that was paid but is not in the class's fee structure still gets its own line
    if (!cancelled && p.feeType && !byType[p.feeType]) lines.push({ desc: p.feeType, amount: paidOf(p.feeType), paid: paidOf(p.feeType) });
  } else {
    // no fee structure set up for this class/term: show what was paid, plus whatever is still owed
    lines = [{ desc: p.feeType || 'School fees', amount: amount, paid: cancelled ? 0 : amount }];
    if (remaining > 0) lines.push({ desc: 'Outstanding balance', amount: remaining, paid: 0 });
  }
  lines.forEach(l => { l.discount = 0; l.tax = 0; l.balance = Math.max(0, l.amount - l.paid); });

  const discount = (DB.discounts || []).filter(d => d.studentId === p.studentId && d.status !== 'Expired' && (!d.term || !term || d.term === term))
    .reduce((a, d) => a + (Number(d.amount) || 0), 0);
  const totalFees = lines.reduce((a, l) => a + l.amount, 0);

  const nextInv = (DB.invoices || []).filter(i => i.studentId === p.studentId && i.status !== 'Paid' && i.dueDate && i.dueDate >= today()).map(i => i.dueDate).sort()[0];
  const state = cancelled ? 'CANCELLED' : (remaining <= 0 ? 'PAID' : 'PARTIAL');
  const logo = brandLogoAbs();

  return {
    p, s, par, no: receiptNo(p), amount, previous, remaining, lines, discount, tax: 0, totalFees, state, cancelled,
    school: { name: prof.name || schoolName(), motto: prof.motto || '', address: prof.address || '', phone: prof.phone || '', email: prof.email || '', website: prof.website || '', principal: prof.principal || '', logo },
    year: rcpYear(p.date), term: term || '—',
    parentName: (par && par.name) || s.guardian || '—', parentPhone: (par && par.phone) || s.guardianPhone || '—',
    parentEmail: (par && par.email) || s.guardianEmail || '',
    invoice: rcpInvoiceFor(p), nextDue: nextInv || '', cashier: p.cashier || p.recordedBy || '—',
    generatedBy: (S.user && S.user.name) || '—',
  };
}

/* ---------------- icons ---------------- */
const RCP_ICON = {
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  print: '<path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  refund: '<path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5"/><path d="M12 8v4l3 2"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  history: '<path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5"/><path d="M12 8v4l3 2"/>',
};
function rcpIco(n, size){ return `<svg class="rcp-ico" viewBox="0 0 24 24" width="${size || 16}" height="${size || 16}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${RCP_ICON[n] || ''}</svg>`; }

/* ---------------- the receipt paper (also used by the print window) ---------------- */
function rcpStamp(name, logo){
  const nm = String(name || '').toUpperCase();
  const fs = Math.max(5.5, Math.min(10, 128 / (nm.length * 0.68)));
  return `<svg class="rcp-stamp" viewBox="0 0 120 120" width="96" height="96">
    <defs><path id="rcpTop" d="M16,60 a44,44 0 0,1 88,0"/><path id="rcpBot" d="M13,60 a47,47 0 0,0 94,0"/></defs>
    <circle cx="60" cy="60" r="57" fill="none" stroke="#1d3f94" stroke-width="2.4"/><circle cx="60" cy="60" r="30" fill="none" stroke="#1d3f94" stroke-width="1.4"/>
    <text font-size="${fs.toFixed(1)}" font-weight="700" fill="#1d3f94" text-anchor="middle" letter-spacing=".6"><textPath href="#rcpTop" startOffset="50%">${esc(nm)}</textPath></text>
    <text font-size="7.5" font-weight="700" fill="#1d3f94" text-anchor="middle" letter-spacing="1.2"><textPath href="#rcpBot" startOffset="50%">OFFICIAL RECEIPT</textPath></text>
    ${logo ? `<image href="${esc(logo)}" x="42" y="42" width="36" height="36" preserveAspectRatio="xMidYMid meet"/>` : `<text x="60" y="68" font-size="26" text-anchor="middle" fill="#1d3f94">★</text>`}
  </svg>`;
}

function receiptPaperHtml(m, opts){
  opts = opts || {};
  const { p, s, school } = m;
  const qr = QRGen.svg([school.name, m.no, s.admNo || '', m.amount.toFixed(2), p.date || ''].join('|'), 92);
  const bar = Code128.svg(m.no.replace(/[^A-Za-z0-9]/g, ''), 150, 30);
  const contact = (ico, v) => v ? `<div class="rcp-contact">${rcpIco(ico, 13)}<span>${esc(v)}</span></div>` : '';
  const row = (k, v, cls) => `<div class="rcp-kv"><span>${esc(k)}</span><b class="${cls || ''}">${v == null || v === '' ? '—' : esc(v)}</b></div>`;
  const photo = s.photo ? `<img src="${esc(s.photo)}" alt="">` : `<span>${esc(initials(s.name))}</span>`;
  const stateText = m.state === 'PARTIAL' ? 'PARTIALLY PAID' : m.state;
  const stateCls = m.state === 'PAID' ? 'ok' : m.state === 'PARTIAL' ? 'warn' : 'bad';
  const method = p.method || '—';

  return `<div class="rcp-paper${opts.duplicate ? ' is-dup' : ''}${m.cancelled ? ' is-cancelled' : ''}">
    ${opts.duplicate ? '<div class="rcp-wm">DUPLICATE</div>' : ''}${m.cancelled ? '<div class="rcp-wm bad">CANCELLED</div>' : ''}
    <div class="rcp-head">
      <div class="rcp-school">
        ${school.logo ? `<img class="rcp-logo" src="${esc(school.logo)}" alt="">` : `<div class="rcp-logo ph">🎓</div>`}
        <div class="rcp-school-txt">
          <h1>${esc(school.name)}</h1>
          ${school.motto ? `<div class="rcp-motto">${esc(school.motto)}</div>` : ''}
          ${contact('pin', school.address)}${contact('phone', school.phone)}${contact('mail', school.email)}${contact('globe', school.website)}
        </div>
      </div>
      <div class="rcp-title-col">
        <div class="rcp-title">PAYMENT RECEIPT</div>
        <div class="rcp-meta">
          <div class="rcp-meta-l">
            <label>Receipt No.</label><b class="rcp-no">${esc(m.no)}</b>
            <label>Receipt Date</label><b>${esc(rcpDate(p.date))}</b>
            <label>Academic Year</label><b>${esc(m.year || '—')}</b>
            <label>Term</label><b>${esc(m.term)}</b>
            <label>Generated By</label><b>${esc(m.generatedBy)}</b>
          </div>
          <div class="rcp-meta-r">${qr}<div class="rcp-bar">${bar}</div><small>${esc(m.no.replace(/[^A-Za-z0-9]/g, ''))}</small></div>
        </div>
      </div>
    </div>

    <div class="rcp-cols">
      <div>
        <h3 class="rcp-h">STUDENT INFORMATION</h3>
        <div class="rcp-stu">
          <div class="rcp-photo">${photo}</div>
          <div class="rcp-stu-a">${row('Admission No.', s.admNo)}${row('Student ID', s.studentId || s.admNo)}${row('Student Name', s.name)}${row('Gender', s.gender)}</div>
          <div class="rcp-stu-b">${row('Class', s.grade)}${row('Section', s.stream)}${row('Roll Number', s.rollNo)}${row('Parent Name', m.parentName)}${row('Parent Phone', m.parentPhone)}</div>
        </div>
      </div>
      <div>
        <h3 class="rcp-h">PAYMENT INFORMATION</h3>
        <div class="rcp-pay">
          ${row('Invoice Number', m.invoice)}${row('Payment Date', rcpDate(p.date))}${row('Payment Time', p.time)}
          <div class="rcp-kv"><span>Payment Method</span><b><i class="rcp-chip">${esc(method)}</i></b></div>
          ${row('Reference Number', p.reference)}${p.network ? row('Network', p.network) : ''}${row('Collector / Cashier', m.cashier)}
        </div>
      </div>
    </div>

    <h3 class="rcp-h">FEE BREAKDOWN</h3>
    <div class="rcp-cols2">
      <table class="rcp-tbl">
        <thead><tr><th>#</th><th class="l">Description</th><th>Amount (KSh)</th><th>Discount (KSh)</th><th>Tax (KSh)</th><th>Paid (KSh)</th><th>Balance (KSh)</th></tr></thead>
        <tbody>${m.lines.map((l, i) => `<tr><td>${i + 1}</td><td class="l">${esc(l.desc)}</td><td>${rcpNum(l.amount)}</td><td>${rcpNum(l.discount)}</td><td>${rcpNum(l.tax)}</td><td>${rcpNum(l.paid)}</td><td class="${l.balance > 0 ? 'red' : ''}">${rcpNum(l.balance)}</td></tr>`).join('')}</tbody>
      </table>
      <div class="rcp-side">
        <div class="rcp-box">
          <h4>PAYMENT SUMMARY</h4>
          <div class="rcp-sum"><span>Previous Balance</span><b>${rcpNum(m.previous)}</b></div>
          <div class="rcp-sum"><span>Amount Paid Today</span><b>${rcpNum(m.cancelled ? 0 : m.amount)}</b></div>
          <div class="rcp-sum"><span>Remaining Balance</span><b class="${m.remaining > 0 ? 'red' : ''}">${rcpNum(m.remaining)}</b></div>
          <div class="rcp-sum"><span>Next Due Date</span><b>${m.nextDue ? esc(rcpDate(m.nextDue)) : '—'}</b></div>
        </div>
        <div class="rcp-box">
          <h4>NOTES</h4>
          <p>${esc(p.notes || 'Thank you for your payment. Please keep this receipt for your records.')}</p>
        </div>
      </div>
    </div>

    <div class="rcp-totals">
      <div class="rcp-status ${stateCls}"><small>PAYMENT STATUS</small><div><i>${m.state === 'PAID' ? '✓' : m.state === 'PARTIAL' ? '!' : '✕'}</i> ${esc(stateText)}</div></div>
      <div class="rcp-tot"><small>Total Fees</small><b>${rcpNum(m.totalFees)}</b></div>
      <div class="rcp-tot"><small>Discount</small><b>${rcpNum(m.discount)}</b></div>
      <div class="rcp-tot"><small>Tax</small><b>${rcpNum(m.tax)}</b></div>
      <div class="rcp-tot paid"><small>Amount Paid</small><b>${rcpNum(m.cancelled ? 0 : m.amount)}</b></div>
    </div>

    <div class="rcp-sign">
      ${rcpStamp(school.name, school.logo)}
      <div class="rcp-sig"><div class="rcp-sig-name">${esc(m.cashier === '—' ? '' : m.cashier)}</div><div class="rcp-sig-line">Cashier Signature</div></div>
      <div class="rcp-sig"><div class="rcp-sig-name"></div><div class="rcp-sig-line">Parent Signature</div></div>
      <div class="rcp-sig"><div class="rcp-sig-name">${esc(school.principal)}</div><div class="rcp-sig-line">Authorised Signature</div></div>
    </div>
    <div class="rcp-foot"><span>This is a computer generated receipt and does not require a physical signature.</span><span>Printed On: ${esc(rcpNow())}</span></div>
  </div>`;
}

/** Print / preview / duplicate window — a clean page holding only the receipt. */
function receiptWindow(p, opts){
  opts = opts || {};
  const m = receiptModel(p);
  const w = window.open('', '_blank');
  if (!w) { toast('Allow pop-ups for this site to print.'); return; }
  const css = new URL('css/receipt.css', location.href).href;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc('Receipt ' + m.no + (opts.duplicate ? ' (Duplicate)' : ''))}</title><link rel="stylesheet" href="${esc(css)}"></head>
  <body class="rcp-print">${opts.print ? '' : '<div class="rcp-toolbar"><button onclick="window.print()">🖨️ Print / Save as PDF</button></div>'}${receiptPaperHtml(m, { duplicate: opts.duplicate })}
  ${opts.print ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},400)})<\/script>' : ''}</body></html>`);
  w.document.close();
}

/* ---------------- screens ---------------- */
function renderReceipts(el){
  const p = RECEIPT_ID ? findPayment(RECEIPT_ID) : null;
  if (p) renderReceiptView(el, p); else renderReceiptHistory(el);
}

function rcpStateChip(m){
  const p = m.p;
  if (m.cancelled) return '<span class="rcp-pill bad">Cancelled</span>';
  if (p.cancelState === 'Requested') return '<span class="rcp-pill warn">Cancellation pending</span>';
  if (p.refundState === 'Refunded') return '<span class="rcp-pill bad">Refunded</span>';
  if (p.refundState === 'Requested') return '<span class="rcp-pill warn">Refund pending</span>';
  return '<span class="rcp-pill ok">Paid</span>';     // a valid receipt = payment received (the fee balance is shown separately)
}

function renderReceiptView(el, p){
  const m = receiptModel(p);
  const s = m.s;
  const locked = m.cancelled || p.cancelState === 'Requested';
  const hist = (DB.payments || []).filter(q => q.studentId === p.studentId)
    .slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const act = (cls, ico, label, id, dis) => `<button class="rcp-act ${cls}" id="${id}" ${dis ? 'disabled' : ''}>${rcpIco(ico, 17)}<span>${esc(label)}</span></button>`;

  el.innerHTML = `
    <p class="crumb">🏠 Home <span>›</span> Finance <span>›</span> Receipts <span>›</span> View Receipt</p>
    <div class="tt-page-head">
      <div><h2>Payment Receipt</h2><p>${esc(m.no)} · ${esc(s.name || '—')}</p></div>
      <div class="rcp-top-actions">
        <button class="btn outline-dark" id="rcBack">${rcpIco('back', 15)} Back</button>
        <button class="btn outline-dark" id="rcPreview">${rcpIco('print', 15)} Print Preview</button>
        <button class="btn outline-dark" id="rcHistory">${rcpIco('history', 15)} Receipt History</button>
      </div>
    </div>
    <div class="rcp-layout">
      <div class="rcp-scroll">${receiptPaperHtml(m)}</div>
      <aside class="rcp-aside">
        <div class="card rcp-panel">
          <h4>ACTIONS</h4>
          ${act('green', 'print', 'Print Receipt', 'rcPrint')}
          ${act('blue', 'download', 'Download PDF', 'rcPdf')}
          ${act('purple', 'share', 'Share Receipt', 'rcShare')}
          ${act('blue', 'copy', 'Duplicate Receipt', 'rcDup')}
          ${act('red', 'refund', 'Request Refund', 'rcRefund', locked || p.refundState === 'Requested' || p.refundState === 'Refunded')}
          ${act('outline', 'x', 'Cancel Receipt', 'rcCancel', locked)}
        </div>
        <div class="card rcp-panel">
          <h4>QUICK INFO</h4>
          <div class="rcp-qi"><span>Receipt No.</span><b>${esc(m.no)}</b></div>
          <div class="rcp-qi"><span>Student</span><b>${esc(s.name || '—')}</b></div>
          <div class="rcp-qi"><span>Class</span><b>${esc(s.grade || '—')}${s.stream ? ' - ' + esc(s.stream) : ''}</b></div>
          <div class="rcp-qi"><span>Amount Paid</span><b class="green">KSh ${rcpNum(m.cancelled ? 0 : m.amount)}</b></div>
          <div class="rcp-qi"><span>Balance</span><b class="${m.remaining > 0 ? 'red' : 'green'}">KSh ${rcpNum(m.remaining)}</b></div>
          <div class="rcp-qi"><span>Status</span><b>${rcpStateChip(m)}</b></div>
          <div class="rcp-qi"><span>Payment Method</span><b>${esc(p.method || '—')}</b></div>
        </div>
      </aside>
    </div>
    <div class="card panel rcp-hist">
      <h3>PAYMENT HISTORY</h3>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>Receipt No.</th><th>Receipt Date</th><th>Invoice No.</th><th>Amount Paid (KSh)</th><th>Payment Method</th><th>Status</th><th>Action</th></tr></thead><tbody>
        ${hist.map((q, i) => { const qm = receiptModel(q); return `<tr${q.id === p.id ? ' class="rcp-cur"' : ''}><td>${i + 1}</td><td>${esc(receiptNo(q))}</td><td>${esc(rcpDate(q.date))}</td><td>${esc(qm.invoice)}</td><td>${rcpNum(q.amount)}</td><td>${esc(q.method || '—')}</td><td>${rcpStateChip(qm)}</td><td><button class="icon-btn" data-view="${esc(q.id)}" title="View receipt">${rcpIco('eye', 16)}</button></td></tr>`; }).join('')}
      </tbody></table></div>
      <div style="text-align:center;margin-top:12px"><button class="btn outline-dark" id="rcAll">View All Payment History</button></div>
    </div>`;

  $('rcBack').onclick = () => { RECEIPT_ID = null; goTo(RECEIPT_BACK && RECEIPT_BACK !== 'receipts' ? RECEIPT_BACK : 'fees'); };
  $('rcHistory').onclick = () => { RECEIPT_ID = null; RECEIPT_SEARCH = ''; renderView(); };
  $('rcAll').onclick = () => { RECEIPT_ID = null; RECEIPT_SEARCH = s.name || ''; renderView(); };
  $('rcPreview').onclick = () => receiptWindow(p, { print: false });
  $('rcPrint').onclick = () => receiptWindow(p, { print: true });
  $('rcPdf').onclick = () => { toast('In the print window choose “Save as PDF” as the destination.'); receiptWindow(p, { print: true }); };
  $('rcDup').onclick = () => receiptWindow(p, { print: true, duplicate: true });
  $('rcShare').onclick = () => rcpShare(m);
  $('rcRefund').onclick = () => rcpRefundDialog(m);
  $('rcCancel').onclick = () => rcpCancelDialog(m);
  el.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { RECEIPT_ID = b.dataset.view; renderView(); window.scrollTo(0, 0); });
}

/* ---------------- actions ---------------- */
function rcpSummaryText(m){
  return [`${m.school.name} — Payment Receipt`, `Receipt No: ${m.no}`, `Student: ${m.s.name || '—'} (${m.s.admNo || '—'})`,
    `Date: ${rcpDate(m.p.date)}`, `Paid: KSh ${rcpNum(m.amount)} via ${m.p.method || '—'}`, `Balance: KSh ${rcpNum(m.remaining)}`].join('\n');
}

async function rcpShare(m){
  const text = rcpSummaryText(m);
  if (navigator.share) { try { await navigator.share({ title: 'Receipt ' + m.no, text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(text); toast('Receipt summary copied — paste it into any app to share.'); return; } catch (e) { /* fall through */ }
  openModal('Share receipt', `<label>Copy this summary</label><textarea rows="7" readonly onclick="this.select()">${esc(text)}</textarea>`, null, { noFoot: true });
}

function rcpRefundDialog(m){
  if (!can('fees.refund')) { toast('You do not have permission to request refunds.'); return; }
  openModal('Request refund', `<p class="muted" style="margin:0 0 6px">Goes to the Administrator, then the Principal, for approval. Nothing changes until it is approved.</p>
    <label>Amount to refund (KSh)</label><input type="number" id="rcpRfAmt" min="0.01" max="${m.amount}" step="0.01" value="${m.amount}">
    <label>Reason</label><textarea id="rcpRfWhy" rows="3" placeholder="Why is this payment being refunded?"></textarea>`,
    async () => {
      const amt = Number($('rcpRfAmt').value), why = $('rcpRfWhy').value.trim();
      if (!(amt > 0) || amt > m.amount) { toast('Enter an amount between 0.01 and ' + rcpNum(m.amount) + '.'); return false; }
      if (!why) { toast('Please give a reason.'); return false; }
      const sid = m.p.studentId, pid = m.p.id;
      const ok = await requestApproval({
        type: 'refund', title: `Refund ${rcpNum(amt)} — ${m.no} · ${m.s.name || ''}`, description: why,
        effects: {
          on_create:  [{ key: 'em_payments', op: 'patch', id: pid, set: { refundState: 'Requested', refundAmount: amt, refundReason: why } }],
          on_approve: [{ key: 'em_payments', op: 'patch', id: pid, set: { refundState: 'Refunded' } }, { key: 'em_students', op: 'inc', id: sid, field: 'balance', by: amt }],
          on_reject:  [{ key: 'em_payments', op: 'patch', id: pid, set: { refundState: '' } }],
        },
      });
      if (ok) { toast('Refund request sent for approval.'); renderView(); }
      return ok;
    }, { saveLabel: 'Send for approval' });
}

function rcpCancelDialog(m){
  if (!can('fees.create')) { toast('You do not have permission to cancel receipts.'); return; }
  openModal('Cancel receipt', `<p class="muted" style="margin:0 0 6px">Cancelling reverses the payment (the student owes it again). It goes to the Administrator, then the Principal, for approval.</p>
    <label>Reason</label><textarea id="rcpCxWhy" rows="3" placeholder="e.g. wrong student, wrong amount, duplicate entry"></textarea>`,
    async () => {
      const why = $('rcpCxWhy').value.trim();
      if (!why) { toast('Please give a reason.'); return false; }
      const sid = m.p.studentId, pid = m.p.id, amt = m.amount;
      const ok = await requestApproval({
        type: 'receipt_cancel', title: `Cancel receipt ${m.no} · ${m.s.name || ''}`, description: why,
        effects: {
          on_create:  [{ key: 'em_payments', op: 'patch', id: pid, set: { cancelState: 'Requested', cancelReason: why } }],
          on_approve: [{ key: 'em_payments', op: 'patch', id: pid, set: { cancelState: 'Cancelled', cancelledOn: today() } }, { key: 'em_students', op: 'inc', id: sid, field: 'balance', by: amt }],
          on_reject:  [{ key: 'em_payments', op: 'patch', id: pid, set: { cancelState: '' } }],
        },
      });
      if (ok) { toast('Cancellation sent for approval.'); renderView(); }
      return ok;
    }, { saveLabel: 'Send for approval' });
}

/* ---------------- receipt history list ---------------- */
function renderReceiptHistory(el){
  el.innerHTML = `
    <p class="crumb">🏠 Home <span>›</span> Finance <span>›</span> Receipts</p>
    <div class="tt-page-head"><div><h2>Receipts</h2><p>Every payment receipt issued — open one to print, email or share it.</p></div>
      <div class="rcp-top-actions"><button class="btn outline-dark" id="rcExport">Export CSV</button></div></div>
    <div class="card panel">
      <input type="search" id="rcSearch" placeholder="Search receipt no., student, admission no., method…" value="${esc(RECEIPT_SEARCH)}" style="max-width:420px;margin-bottom:12px">
      <div id="rcList"></div>
    </div>`;
  function rows(){
    const q = $('rcSearch').value.trim().toLowerCase();
    return (DB.payments || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .filter(p => { if (!q) return true; const s = (DB.students || []).find(x => x.id === p.studentId) || {};
        return [receiptNo(p), s.name, s.admNo, p.method, p.feeType, p.reference].some(v => String(v || '').toLowerCase().includes(q)); });
  }
  function draw(){
    const list = rows();
    $('rcList').innerHTML = list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Receipt No.</th><th>Date</th><th>Student</th><th>Class</th><th>Fee Type</th><th>Method</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(p => { const m = receiptModel(p); return `<tr><td><b>${esc(m.no)}</b></td><td>${esc(rcpDate(p.date))}</td><td>${esc(m.s.name || '—')}</td><td>${esc(m.s.grade ? classLabel(m.s) : '—')}</td><td>${esc(p.feeType || '—')}</td><td>${esc(p.method || '—')}</td><td>${money(p.amount)}</td><td>${rcpStateChip(m)}</td><td><button class="icon-btn" data-view="${esc(p.id)}" title="View receipt">${rcpIco('eye', 16)}</button></td></tr>`; }).join('')}
      </tbody></table></div>` : '<div class="empty">No receipts found.</div>';
    $('rcList').querySelectorAll('[data-view]').forEach(b => b.onclick = () => { RECEIPT_ID = b.dataset.view; renderView(); window.scrollTo(0, 0); });
  }
  draw();
  $('rcSearch').oninput = () => { RECEIPT_SEARCH = $('rcSearch').value; draw(); };
  $('rcExport').onclick = () => {
    const list = rows(); if (!list.length) { toast('Nothing to export.'); return; }
    downloadCsv('Receipts', ['Receipt No.', 'Date', 'Student', 'Adm No', 'Fee Type', 'Method', 'Reference', 'Amount', 'Status'],
      list.map(p => { const m = receiptModel(p); return [m.no, p.date, m.s.name, m.s.admNo, p.feeType, p.method, p.reference, p.amount, m.state]; }));
  };
}
