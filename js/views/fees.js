'use strict';
/* views/fees.js — Fees Management screen.
   Part of the EraMaster frontend — loaded after core.js. */

/* ---------------- Fees Management ---------------- */
function renderFeesManagement(el){
  const term = currentTerm(), termName = term && term.name;
  const canRecord = canWrite('payments'), canManage = canWrite('feestructures');
  el.innerHTML = `
    <p class="crumb">🏠 Home <span>›</span> Fees</p>
    <div class="tt-page-head">
      <div><h2>Fees Management</h2><p>${esc(termHeaderLabel())}</p></div>
      <div class="fees-hero-actions" id="feesTabs">
        <button class="btn outline-dark" data-tab="structure">🧾 Fee Structure</button>
        <button class="btn outline-dark" data-tab="all">☰ All Payments</button>
        <button class="btn amber-solid" data-tab="outstanding">⚠️ Outstanding</button>
      </div>
    </div>
    <div class="stats-grid" id="feesStats"></div>
    <div class="dash-grid">
      <div class="card panel">
        <h3>Quick Payment Recording</h3>
        <label>Search Student</label>
        <div class="fee-quick-search">
          <input type="text" id="feesSearch" placeholder="Type student name or ID…" autocomplete="off">
          <div class="fee-quick-suggest" id="feesSuggest" style="display:none"></div>
        </div>
        <div id="feesStudentCard"></div>
        <div id="feesQuickFields" style="display:none;margin-top:6px">
          <label>Fee Type</label><select id="feesType">${optionsHtml(FEE_TYPES)}</select>
          <label>Amount</label><input type="number" id="feesAmount" min="0" step="0.01" placeholder="0.00">
          <label>Payment Method</label><select id="feesMethod">${optionsHtml(PAYMENT_METHODS)}</select>
          <div id="feesNetWrap" style="display:none"><label>Network</label><select id="feesNetwork"><option value="">—</option><option>MTN</option><option>Telecel</option><option>AirtelTigo</option><option>M-Pesa</option><option>Airtel Money</option></select></div>
          <div id="feesRefWrap" style="display:none"><label>Reference Number</label><input type="text" id="feesRef" placeholder="Transaction / cheque / slip number" autocomplete="off"></div>
          ${canRecord ? `<button class="btn primary" id="feesRecordBtn" style="margin-top:14px;width:100%">Record Payment</button>` : ''}
        </div>
      </div>
      <div class="card panel">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <h3 style="margin:0">Recent Transactions</h3>
          <button class="btn tiny ghost" id="feesViewAll">View All ▾</button>
        </div>
        <div id="feesTxTable"></div>
      </div>
    </div>
    <div class="card panel" id="feesTabPanel" style="margin-top:16px"></div>`;

  function drawStats(){
    const collected = feeCollected(termName), outstanding = feeOutstanding(), totalDue = feeTotalDue(termName);
    $('feesStats').innerHTML = statCards([
      stat('💳', C_G, money(collected), 'Total Collected'),
      stat('🧾', C_A, money(totalDue), 'Total Due'),
      stat('⚠️', C_R, money(outstanding), 'Outstanding'),
    ]);
  }

  let selectedStudent = null;
  function drawSuggestions(){
    const q = $('feesSearch').value.trim().toLowerCase();
    const box = $('feesSuggest');
    if (!q) { box.style.display = 'none'; return; }
    const matches = (DB.students || []).filter(s => s.name.toLowerCase().includes(q) || String(s.admNo || '').toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length) { box.style.display = 'none'; return; }
    box.innerHTML = matches.map(s => `<div data-sid="${esc(s.id)}">${esc(s.name)} <span class="muted">· ${esc(s.admNo || '—')} · ${esc(classLabel({ grade: s.grade, stream: s.stream }))}</span></div>`).join('');
    box.style.display = 'block';
    box.querySelectorAll('[data-sid]').forEach(row => row.onclick = () => {
      const s = (DB.students || []).find(x => x.id === row.dataset.sid);
      selectedStudent = s || null;
      $('feesSearch').value = s ? `${s.name} (${s.admNo || '—'})` : '';
      box.style.display = 'none';
      $('feesQuickFields').style.display = s ? '' : 'none';
      const d = s ? payeeDetails('Student', s.id) : null;
      $('feesStudentCard').innerHTML = d ? payeeCardHtml(d, { useBalance: true }) : '';
      $('feesStudentCard').querySelectorAll('[data-use-balance]').forEach(b => b.onclick = () => { $('feesAmount').value = b.dataset.useBalance; });
    });
  }

  function drawTransactions(){
    const rows = (DB.payments || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 6);
    $('feesTxTable').innerHTML = rows.length ? `<div class="table-wrap"><table class="tbl"><thead><tr>
        <th>Receipt</th><th>Student</th><th>Fee Type</th><th>Amount</th>
      </tr></thead><tbody>
      ${rows.map(p => `<tr><td><a href="#" class="rcp-link" data-rc="${esc(p.id)}">${esc(p.receipt || receiptNo(p))}</a></td><td>${esc(stuName(p.studentId))}</td><td>${esc(p.feeType || '—')}</td><td>${money(p.amount)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No transactions yet.</div>';
  }

  function drawTabPanel(){
    const panel = $('feesTabPanel');
    if (FEES_TAB === 'structure') {
      const rows = DB.feestructures || [];
      panel.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <h3 style="margin:0">Fee Structure</h3>
          ${canManage ? `<button class="btn tiny primary" id="feesAddStructure">+ Add Fee Structure</button>` : ''}
        </div>
        ${rows.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Class/Grade</th><th>Term</th><th>Fee Type</th><th>Amount</th></tr></thead><tbody>
          ${rows.map(r => `<tr><td>${esc(r.grade)}</td><td>${esc(r.term)}</td><td>${esc(r.feeType)}</td><td>${money(r.amount)}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">No fee structures set up yet.</div>'}`;
      if (canManage) $('feesAddStructure').onclick = () => openRecordForm('feestructures', blankRecord('feestructures'), () => renderView());
    } else if (FEES_TAB === 'all') {
      const rows = (DB.payments || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      panel.innerHTML = `<h3 style="margin:0 0 10px">All Payments</h3>
        ${rows.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Receipt</th><th>Student</th><th>Fee Type</th><th>Method</th><th>Amount</th></tr></thead><tbody>
          ${rows.map(p => `<tr><td>${esc(p.date)}</td><td><a href="#" class="rcp-link" data-rc="${esc(p.id)}">${esc(p.receipt || receiptNo(p))}</a></td><td>${esc(stuName(p.studentId))}</td><td>${esc(p.feeType || '—')}</td><td>${esc(p.method || '—')}</td><td>${money(p.amount)}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">No payments recorded yet.</div>'}`;
    } else {
      const rows = owingStudents().slice().sort((a, b) => (b.balance || 0) - (a.balance || 0));
      panel.innerHTML = `<h3 style="margin:0 0 10px">Outstanding Balances</h3>
        ${rows.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Student</th><th>Adm No</th><th>Class</th><th>Balance</th></tr></thead><tbody>
          ${rows.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.admNo || '—')}</td><td>${esc(classLabel(s))}</td><td style="color:var(--rose);font-weight:700">${money(s.balance)}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">No outstanding balances — everyone is paid up.</div>'}`;
    }
  }

  drawStats(); drawTransactions(); drawTabPanel();
  function syncPayExtras(){
    const m = $('feesMethod').value;
    $('feesNetWrap').style.display = m === 'Mobile Money' ? '' : 'none';
    $('feesRefWrap').style.display = (m === 'Cash') ? 'none' : '';
  }
  $('feesMethod').onchange = syncPayExtras; syncPayExtras();
  const rcClick = (e) => { const a = e.target.closest('[data-rc]'); if (!a) return; e.preventDefault(); openReceipt(a.dataset.rc); };
  $('feesTxTable').onclick = rcClick; $('feesTabPanel').onclick = rcClick;
  $('feesSearch').oninput = drawSuggestions;
  $('feesSearch').onfocus = drawSuggestions;
  $('feesSearch').onblur = () => { setTimeout(() => { const b = $('feesSuggest'); if (b) b.style.display = 'none'; }, 150); };
  $('feesViewAll').onclick = () => { FEES_TAB = 'all'; drawTabPanel(); };
  $('feesTabs').onclick = (e) => {
    const p = e.target.closest('[data-tab]'); if (!p) return;
    FEES_TAB = p.dataset.tab; drawTabPanel();
  };
  if (canRecord) $('feesRecordBtn').onclick = async () => {
    if (!selectedStudent) { toast('Search and select a student first.'); return; }
    const amount = Number($('feesAmount').value);
    if (!amount || amount <= 0) { toast('Enter a valid amount.'); return; }
    const method = $('feesMethod').value;
    const rec = { id: uid('pm'), studentId: selectedStudent.id, feeType: $('feesType').value,
      method, amount, date: today(), term: termName || '', receipt: '',
      time: rcpTime12(), cashier: (S.user && S.user.name) || '',
      reference: ($('feesRef').value || '').trim(), network: method === 'Mobile Money' ? $('feesNetwork').value : '' };
    rec.receipt = nextReceiptNo();
    DB.payments = DB.payments || [];
    DB.payments.push(rec);
    selectedStudent.balance = Math.max(0, (Number(selectedStudent.balance) || 0) - amount);
    const ok = await persist('payments', 'students');
    if (ok) { toast('Payment recorded — ' + rec.receipt); openReceipt(rec.id); }
  };
}

