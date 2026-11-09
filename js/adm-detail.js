'use strict';
/* adm-detail.js — the "Application Details" screen. Standalone (no core.js needed) so the public
   apply.html page and the staff Admissions screen render the exact same layout.
   ADM.render(el, app, {staff, docUrl(docId), act(action, extra) -> Promise, edit()}) */
const ADM = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtD = iso => { if (!iso) return '—'; const d = new Date(String(iso).slice(0,10) + 'T00:00:00'); return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'}); };
  const fmtT = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit', hour12:true}).toUpperCase(); };
  const age = dob => { const b = new Date(dob), n = new Date(); if (isNaN(b)) return ''; let a = n.getFullYear() - b.getFullYear(); if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--; return a + ' years'; };
  const stage = s => s === 'Interview Invited' ? 'Interview Invited' : s;
  const badgeCls = s => s.split(' ')[0];
  const v = x => esc(x || '—');
  const kv = rows => `<dl class="ad-kv">${rows.map(r => `<dt>${esc(r[0])}</dt><dd>${v(r[1])}</dd>`).join('')}</dl>`;
  const I = {grid:'▦', clock:'◷', cal:'▣', user:'♙', phone:'✆', mail:'✉', book:'▭', ok:'☑', no:'✕', wa:'◉', eye:'◎', pay:'▤', note:'▤'};

  function render(el, a, o) {
    o = o || {}; const s = a.student || {}, g = a.guardian || {}, f = a.fee || {}, iv = a.interview, cur = 'KSh';
    const docs = a.docs || [], hist = a.history || [], notes = a.notes || [];
    const money = `${cur} ${Number(f.amount || 0).toFixed(2)}`;
    const paid = f.paid ? '<span class="ad-paid">Paid ✓</span>' : '<span class="ad-paid no">Awaiting confirmation</span>';
    const dl = d => `<a title="Download" data-doc="${esc(d.id)}">⭳</a>`;
    const docRow = d => `<div class="ad-doc"><span class="ad-ico ${/image/.test(d.mime) ? 'img' : ''}">${/image/.test(d.mime) ? 'IMG' : 'PDF'}</span><div>${esc(d.filename || d.label)}<small>Uploaded on ${fmtD(d.uploaded_at)}</small></div>${dl(d)}</div>`;
    const tl = (n) => hist.slice(-n).map(h => `<li><i></i><span>${fmtD(h.at)}</span><span>${fmtT(h.at)}</span><span>${esc(h.text)}${h.by ? `<small>By ${esc(h.by)}</small>` : ''}</span></li>`).join('') || '<li><span></span><span>No activity yet</span></li>';
    const cards = {
      stu: `<div class="ad-card"><h3>Student Information</h3>${kv([['Full Name', s.name], ['Date of Birth', fmtD(s.dob)], ['Gender', s.gender], ['Nationality', s.nationality], ['Religion', s.religion], ['Previous School', s.previousSchool], ['Health Condition', s.health], ['Blood Group', s.bloodGroup]])}</div>`,
      gua: `<div class="ad-card"><h3>Guardian Information</h3>${kv([['Guardian Name', g.name], ['Relationship', g.relationship], ['Phone', g.phone], ['WhatsApp', g.whatsapp], ['Email', g.email], ['Occupation', g.occupation], ['Address', g.address], ['Additional Contact', g.additional || 'N/A']])}</div>`,
      doc: `<div class="ad-card"><h3>Documents</h3>${docs.map(docRow).join('') || '<p class="ad-meta">No documents uploaded.</p>'}</div>`,
      cls: `<div class="ad-card"><h3>Class &amp; Academic Information</h3>${kv([['Class Applied For', a.classApplied], ['Preferred Section', a.section], ['Academic Year', a.year], ['Term', a.term], ['Session', a.year ? a.year + ' Academic Session' : '']])}</div>`,
      fee: `<div class="ad-card"><h3>Application Fee</h3><dl class="ad-kv">${[['Fee Amount', money], ['Payment Method', f.method], ['Transaction ID', f.txn], ['Payment Date', fmtD(f.date)]].map(r => `<dt>${r[0]}</dt><dd>${v(r[1])}</dd>`).join('')}<dt>Status</dt><dd>${paid}</dd></dl></div>`,
      his: `<div class="ad-card"><h3>Decision History</h3><ul class="ad-tl">${tl(4)}</ul><button class="ad-link" data-tab="his">View Full Timeline</button></div>`,
      hisFull: `<div class="ad-card"><h3>Decision History</h3><ul class="ad-tl">${tl(100)}</ul></div>`,
      ivw: `<div class="ad-card"><h3>Interview</h3>${iv ? kv([['Date', fmtD(iv.date)], ['Time', iv.time], ['Venue', 'School admissions office']]) : '<p class="ad-meta">No interview has been scheduled yet.</p>'}</div>`,
      notes: `<div class="ad-card"><h3>Internal Notes</h3>${notes.length ? notes.map(n => `<div class="ad-note">${esc(n.text)}<small>Added by ${esc(n.by)} on ${fmtD(n.at)}</small></div>`).join('') : '<p class="ad-meta">No notes yet.</p>'}</div>`,
    };
    const tabs = [['info', 'Application Information'], ['docs', 'Documents'], ['ivw', 'Interview'], ['his', 'Decision History'], ['notes', 'Notes & Communication']];
    const panels = {
      info: `<div class="ad-cols">${cards.stu}${cards.gua}${cards.doc}${cards.cls}${cards.fee}${cards.his}</div>${o.staff ? `<div style="margin-top:14px">${cards.notes}</div>` : ''}`,
      docs: cards.doc, ivw: cards.ivw, his: cards.hisFull,
      notes: o.staff ? cards.notes : '<div class="ad-card"><h3>Notes &amp; Communication</h3><p class="ad-meta">Contact the school office quoting your application number if you have a question.</p></div>',
    };
    const qa = o.staff ? [['cal','Invite to Interview','interview'], ...(o.canDecide ? [['ok','Approve Application','approve'], ['no','Reject Application','reject']] : [['ok','Refer to Principal / Headteacher','refer']]), ['wa','Send Reminder (WhatsApp)','wa'], ['user','View Interview','tab:ivw'], ['pay','View Payment','tab:info'], ['note','Add Internal Note','note']]
                       : [['user','View Interview','tab:ivw'], ['pay','View Payment','tab:info'], ['book','View Documents','tab:docs'], ['grid','Print Application','print']];
    const sum = [['grid','Application No.', a.appNo], ['clock','Status', `<span class="ad-badge ${badgeCls(a.status)}">${esc(a.status.toUpperCase())}</span>`, 1], ['book','Class Applied', a.classApplied], ['cal','Academic Year', a.year], ['cal','Date Received', fmtD(a.received)],
      ['cal','Interview Date', iv ? fmtD(iv.date) : '—'], ['clock','Interview Time', iv ? iv.time : '—'], ['user','Guardian', g.name], ['phone','Phone', g.phone], ['mail','Email', g.email]];
    el.innerHTML = `<div class="ad">
      <div class="ad-top"><div><h1>Application Details</h1><p>${esc(a.appNo)}</p></div>
        <div class="ad-btns">${o.staff ? '<button class="ad-b pri" data-a="edit">✎ Edit Application</button>' : ''}<button class="ad-b" data-a="print">⎙ Print</button><button class="ad-b" data-a="print">⭳ Download (PDF)</button>
        ${o.staff ? '<button class="ad-b" data-a="more">More Actions ⌄</button><div class="ad-menu" hidden><button data-act="paid">Mark fee as paid</button><button data-act="review">Move to Under Review</button><button data-act="delete">Delete application</button></div>' : ''}</div></div>
      <div class="ad-grid"><div class="ad-stack">
        <div class="ad-card ad-id">${a.photo ? `<img class="ad-photo" src="${esc(a.photo)}" alt="">` : `<div class="ad-photo">${esc((s.name || '?')[0])}</div>`}
          <div><div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.5fr);gap:6px">
            <div><h2>${esc(s.name)}</h2><div class="ad-meta"><b>${esc(s.gender)}</b> • ${fmtD(s.dob)} • ${age(s.dob)}</div>
              <p><span class="ad-badge ${badgeCls(a.status)}">${esc(a.status.toUpperCase())}</span></p><p class="ad-meta">Application Fee: <b style="color:var(--ad-ink)">${money}</b> ${paid}</p></div>
            <div class="ad-fields"><div><small>Application No.</small><span>${esc(a.appNo)}</span></div><div><small>Current Stage</small><span class="ad-badge ${badgeCls(a.status)}">${esc(stage(a.status))}</span></div>
              <div><small>Date Received</small><span>${fmtD(a.received)}</span></div><div><small>Next Step</small><span>${v(a.nextStep)}</span></div>
              <div><small>Class Applied For</small><span>${v(a.classApplied)}</span></div><div><small>Assigned To</small><span>${v(a.assignedTo)}</span></div>
              <div><small>Academic Year</small><span>${v(a.year)}</span></div><div><small>Application Type</small><span>${v(a.type)}</span></div></div></div></div></div>
        <div class="ad-card" style="padding:0 16px"><div class="ad-tabs">${tabs.map((t, i) => `<button class="ad-tab ${i ? '' : 'on'}" data-tab="${t[0]}">${t[1]}</button>`).join('')}</div></div>
        <div id="adPanel"></div></div>
        <div class="ad-stack"><div class="ad-card"><h3 style="font-size:16px">Application Summary</h3>${sum.map(r => `<div class="ad-sum"><em>${I[r[0]]}</em><span style="color:var(--ad-mut)">${r[1]}</span><b>${r[3] ? r[2] : v(r[2])}</b></div>`).join('')}</div>
          <div class="ad-card ad-quick"><h3 style="font-size:16px">Quick Actions</h3>${qa.map(r => `<button class="ad-qa" data-q="${r[2]}"><em>${I[r[0]]}</em>${r[1]}</button>`).join('')}</div></div></div></div>`;
    const panel = t => { el.querySelector('#adPanel').innerHTML = panels[t]; el.querySelectorAll('.ad-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
      el.querySelectorAll('#adPanel [data-doc]').forEach(x => x.onclick = () => window.open(o.docUrl(x.dataset.doc), '_blank'));
      el.querySelectorAll('#adPanel [data-tab]').forEach(x => x.onclick = () => panel(x.dataset.tab)); };
    panel('info');
    el.querySelectorAll('.ad-tab').forEach(b => b.onclick = () => panel(b.dataset.tab));
    const menu = el.querySelector('.ad-menu');
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { const k = b.dataset.a; if (k === 'print') window.print(); else if (k === 'more') menu.hidden = !menu.hidden; else if (k === 'edit') o.edit && o.edit(a); });
    el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => { menu.hidden = true; if (b.dataset.act === 'delete' && !confirm('Delete this application permanently?')) return; o.act(b.dataset.act); });
    el.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { const q = b.dataset.q;
      if (q.startsWith('tab:')) { panel(q.slice(4)); window.scrollTo({top: 0, behavior: 'smooth'}); } else if (q === 'print') window.print(); else if (q === 'wa') {
        const ph = String(g.whatsapp || g.phone || '').replace(/\D/g, '').replace(/^0/, '233');
        window.open(`https://wa.me/${ph}?text=${encodeURIComponent(`Dear ${g.name}, this is a reminder about application ${a.appNo} for ${s.name}.`)}`, '_blank');
      } else modal(q, a, o); });
  }

  function modal(kind, a, o) {
    const T = {interview: ['Invite to Interview', '<label>Date</label><input type="date" id="m1"><label>Time</label><input type="time" id="m2" value="10:00">'],
      approve: ['Approve Application', '<p>Approve this application?</p>'], refer: ['Refer to Principal / Headteacher', '<p>Send this application to the Principal / Headteacher for the final decision? They will be notified.</p>'], reject: ['Reject Application', '<p>Reject this application?</p>'],
      note: ['Add Internal Note', '<label>Note (staff only)</label><textarea id="m1" rows="4"></textarea>']}[kind];
    const m = document.createElement('div'); m.className = 'ad-mod';
    m.innerHTML = `<div><h3>${T[0]}</h3>${T[1]}<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button class="ad-b" id="mx">Cancel</button><button class="ad-b pri" id="mo">Confirm</button></div></div>`;
    document.body.appendChild(m); m.querySelector('#mx').onclick = () => m.remove();
    m.querySelector('#mo').onclick = async () => { const x1 = m.querySelector('#m1'), x2 = m.querySelector('#m2');
      const extra = kind === 'interview' ? {date: x1.value, time: x2.value} : x1 ? {text: x1.value} : {};
      if (await o.act(kind, extra) !== false) m.remove(); };
  }
  return {render, esc, fmtD};
})();
