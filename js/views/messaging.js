'use strict';
/* views/messaging.js — Messaging & Broadcasts: Staff Chat plus an in-app broadcast composer that sends a
   notification to a target group (all students / parents / staff, one class, or one person). No e-mail.
   Broadcast records live in DB.broadcasts (see core.js LIST_NAMES / api/rbac.php em_broadcasts).
   Part of the EraMaster frontend — loaded after core.js, nav.js, shell.js. */

/* ---------------- shared helpers ---------------- */
function messagingRecipientOptions(){
  const opts = [];
  DB.students.forEach(s => opts.push(['student:' + s.id, s.name + ' (student)']));
  DB.parents.forEach(p => opts.push(['parent:' + p.id, p.name + ' (parent)']));
  DB.teachers.forEach(t => opts.push(['staff:' + t.id, t.name + ' (staff)']));
  return opts;
}
function messagingRecipientName(val){
  if (!val) return '';
  const [kind, id] = val.split(':');
  const src = kind === 'student' ? DB.students : kind === 'parent' ? DB.parents : DB.teachers;
  const rec = (src || []).find(x => x.id === id);
  return rec ? rec.name : '';
}
function messagingGrades(){ return Array.from(new Set(DB.students.map(s => s.grade).filter(Boolean))).sort(); }
function messagingAudienceCount(audience, grade){
  if (audience === 'students') return DB.students.length;
  if (audience === 'parents') return DB.parents.length;
  if (audience === 'staff') return DB.teachers.length;
  if (audience === 'class') return DB.students.filter(s => s.grade === grade).length;
  return 1; // specific
}
function messagingAudienceLabel(audience, grade){
  if (audience === 'students') return 'All Students';
  if (audience === 'parents') return 'All Parents & Guardians';
  if (audience === 'staff') return 'All Staff';
  if (audience === 'class') return grade ? `Class — ${grade}` : 'By Class/Grade';
  return 'Specific Individual';
}
function timeAgoOrDate(iso){
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/* ---------------- entry point ---------------- */
function renderMessaging(el){
  el.innerHTML = `<p class="crumb">💬 Communication <span>›</span> Messaging &amp; Broadcasts</p><div id="msgTabsHost"></div>`;
  if (TAB.messaging === undefined || TAB.messaging === 'email') TAB.messaging = 'broadcast';
  mountTabs($('msgTabsHost'), 'messaging', [
    { id: 'chat', label: 'Internal Chat', perm: 'communication.view', render: el => renderStaffChat(el, { embedded: true }) },
    { id: 'broadcast', label: 'Broadcast', perm: 'communication.view', render: renderBroadcastTab },
    ...((DB.messages || []).length ? [{ id: 'notes', label: 'Old notes', perm: 'communication.view', render: renderInternalChatTab }] : []),
  ]);
}

/* ---------------- Old internal notes (read-only history from before the live Staff Chat) ---------------- */
function renderInternalChatTab(el){
  const canSend = can('communication.send');
  const list = (DB.messages || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  el.innerHTML = `<div class="card panel">
    ${canSend ? `<div class="chat-compose-row">
      <div class="grow"><label>To</label><select id="chatTo">${optionsHtml(messagingRecipientOptions())}</select></div>
      <div class="grow" style="flex:2"><label>Message</label><input id="chatBody" placeholder="Type a message…"></div>
      <button class="btn primary" id="chatSendBtn" style="height:38px">Send</button>
    </div>` : ''}
    <div class="chat-list">
      ${list.length ? list.map(m => `<div class="row-line"><b>${esc(m.fromName || 'You')}</b> → ${esc(m.toName || '—')}
          <div class="muted" style="margin-top:2px">${esc(m.body || '')}</div>
          <div class="muted" style="font-size:11px;margin-top:3px">${esc(timeAgoOrDate(m.date))}</div></div>`).join('')
        : `<div class="empty"><b>No internal messages yet</b>Staff-to-staff and staff-to-parent notes sent here will show up in this list.</div>`}
    </div>
  </div>`;
  if (canSend) {
    $('chatSendBtn').onclick = async () => {
      const to = $('chatTo').value, body = $('chatBody').value.trim();
      if (!body) { toast('Write a message first.'); return; }
      DB.messages.unshift({ id: uid('msg'), to, toName: messagingRecipientName(to), body, date: new Date().toISOString(), from: S.user.id || '', fromName: S.user.name || 'You' });
      const ok = await persist('messages');
      if (ok) { toast('Message sent.'); renderMessaging($('view')); } else DB.messages.shift();
    };
  }
}

/* ---------------- Broadcast composer (in-app notification to a target group) ---------------- */
let MSG_STATE = { audience: 'specific', recipient: '', grade: '', subject: '', message: '', schedule: false, scheduleAt: '' };
let MSG_PREVIEW_TIMER = null;

function renderBroadcastTab(el){
  const canSend = can('communication.send');
  const len = MSG_STATE.message.length;
  const recipientCount = messagingAudienceCount(MSG_STATE.audience, MSG_STATE.grade);
  const recent = (DB.broadcasts || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 8);

  el.innerHTML = `<div class="msg-layout">
    <div class="card msg-compose">
      <h2>Create Broadcast</h2>
      <p class="sub">Compose your message and choose the target group. Everyone in it gets a notification in the app (the bell).</p>

      <div class="msg-row">
        <div>
          <label>Delivered as</label>
          <div class="channel-group">
            <span class="channel-btn active">🔔 In-app notification</span>
          </div>
        </div>
        <div>
          <label>Target Audience</label>
          <select id="msgAudience">
            <option value="specific" ${MSG_STATE.audience === 'specific' ? 'selected' : ''}>Specific Individual</option>
            <option value="students" ${MSG_STATE.audience === 'students' ? 'selected' : ''}>All Students</option>
            <option value="parents" ${MSG_STATE.audience === 'parents' ? 'selected' : ''}>All Parents &amp; Guardians</option>
            <option value="staff" ${MSG_STATE.audience === 'staff' ? 'selected' : ''}>All Staff</option>
            <option value="class" ${MSG_STATE.audience === 'class' ? 'selected' : ''}>By Class/Grade</option>
          </select>
        </div>
      </div>

      ${MSG_STATE.audience === 'specific' ? `<label>Select User</label>
        <select id="msgRecipient"><option value="">— Choose a recipient —</option>${optionsHtml(messagingRecipientOptions(), MSG_STATE.recipient)}</select>
      ` : ''}
      ${MSG_STATE.audience === 'class' ? `<label>Select Class/Grade</label>
        <select id="msgGrade"><option value="">— Choose a class —</option>${optionsHtml(messagingGrades().map(g => [g, g]), MSG_STATE.grade)}</select>` : ''}

      <div id="msgPreview" class="muted" style="margin:8px 0 2px;font-size:12.5px"></div>
      <label>Title <span class="muted" style="font-weight:400">(optional)</span></label><input id="msgSubject" placeholder="e.g. Fees reminder" value="${esc(MSG_STATE.subject)}">
      <label>Message Content</label>
      <textarea id="msgContent" class="msg-textarea" placeholder="Type your message…">${esc(MSG_STATE.message)}</textarea>
      <div class="msg-meta-row">
        <span id="msgCreditsHint">Delivered to each person's notification bell</span>
        <span id="msgCharCount">${len} characters</span>
      </div>

      <div class="msg-schedule-row">
        <label class="msg-schedule-toggle"><input type="checkbox" id="msgSchedule" ${MSG_STATE.schedule ? 'checked' : ''}> Schedule for later</label>
        ${MSG_STATE.schedule ? `<input type="datetime-local" id="msgScheduleAt" class="msg-schedule-when" value="${esc(MSG_STATE.scheduleAt)}">` : ''}
      </div>

      <div class="msg-send-row">
        ${canSend
          ? `<button class="btn primary" id="msgSendBtn">📨 ${MSG_STATE.schedule ? 'Schedule' : 'Send'} Notification</button>`
          : `<span class="muted">You don't have permission to send broadcasts.</span>`}
      </div>
    </div>

    <div>
      <div class="card msg-status-card">
        <h3>System Status</h3>
        <div class="msg-status-row"><span>In-app notifications</span>${badge('Online')}</div>
      </div>
      <div class="card msg-recent">
        <h3>Recent Broadcasts</h3>
        <div class="msg-recent-list">
          ${recent.length ? recent.map(b => `<div class="msg-recent-item">
              <div class="msg-recent-hd"><span class="msg-recent-chan">${esc(b.subject || 'In-app')}</span><span class="msg-recent-time">${esc(timeAgoOrDate(b.date))}</span></div>
              <div class="msg-recent-body">${esc(b.message)}</div>
              <div class="msg-recent-foot"><span>${esc(b.targetLabel)} · ${b.recipients || 0} notified</span>${badge(b.status)}</div>
              ${b.error ? `<div class="muted" style="font-size:11.5px;margin-top:4px">${esc(b.error)}</div>` : ''}
            </div>`).join('')
            : `<div class="empty"><b>No broadcasts yet</b>Messages you send from this page will appear here.</div>`}
        </div>
      </div>
    </div>
  </div>`;

  // Re-render, first saving whatever is currently in the fields so nothing typed is lost.
  const syncStateFromInputs = () => {
    const c = $('msgContent'); if (c) MSG_STATE.message = c.value;
    const r = $('msgRecipient'); if (r) MSG_STATE.recipient = r.value;
    const g = $('msgGrade'); if (g) MSG_STATE.grade = g.value;
    const sa = $('msgScheduleAt'); if (sa) MSG_STATE.scheduleAt = sa.value;
    const sj = $('msgSubject'); if (sj) MSG_STATE.subject = sj.value;
  };

  $('msgAudience').onchange = (e) => { syncStateFromInputs(); MSG_STATE.audience = e.target.value; renderBroadcastTab(el); };
  const recSel = $('msgRecipient'); if (recSel) recSel.onchange = (e) => { MSG_STATE.recipient = e.target.value; refreshBroadcastPreview(); };
  const gradeSel = $('msgGrade'); if (gradeSel) gradeSel.onchange = (e) => { MSG_STATE.grade = e.target.value; refreshBroadcastPreview(); };
  const subjIn = $('msgSubject'); if (subjIn) subjIn.oninput = (e) => { MSG_STATE.subject = e.target.value; };
  $('msgSchedule').onchange = (e) => { syncStateFromInputs(); MSG_STATE.schedule = e.target.checked; renderBroadcastTab(el); };
  const schedAt = $('msgScheduleAt'); if (schedAt) schedAt.onchange = (e) => { MSG_STATE.scheduleAt = e.target.value; };

  // Character/page counter updates live without a full re-render, so typing keeps focus.
  $('msgContent').oninput = (e) => {
    MSG_STATE.message = e.target.value;
    const n = e.target.value.length;
    $('msgCharCount').textContent = `${n} characters`;
  };

  if (canSend) $('msgSendBtn').onclick = () => sendBroadcast(el);

  // Ask the server who this would really reach, and (once per visit) send anything that was scheduled and is now due.
  if (canSend) {
    refreshBroadcastPreview();
    dispatchDueBroadcasts(el);
  }
}

// Live "who will get this" line under the audience pickers — resolved by the server from the
// school records, so it matches exactly what Send will do.
function refreshBroadcastPreview(){
  clearTimeout(MSG_PREVIEW_TIMER);
  MSG_PREVIEW_TIMER = setTimeout(async () => {
    const box = $('msgPreview'); if (!box) return;
    if ((MSG_STATE.audience === 'specific' && !MSG_STATE.recipient) || (MSG_STATE.audience === 'class' && !MSG_STATE.grade)) { box.textContent = ''; return; }
    const r = await apiPost('broadcast_preview', broadcastPayload());
    const box2 = $('msgPreview'); if (!box2 || !r || !r.ok) return;
    if (r.error) { box2.innerHTML = `<span style="color:var(--rose)">${esc(r.error)}</span>`; return; }
    let t = r.reachable
      ? `Will notify <b>${r.reachable}</b> ${r.reachable === 1 ? 'person' : 'people'}`
      : `<span style="color:var(--rose)">No one in this group has a login yet, so nobody would be notified.</span>`;
    box2.innerHTML = t;
  }, 250);
}
function broadcastPayload(){
  return { audience: MSG_STATE.audience, grade: MSG_STATE.grade, target: MSG_STATE.recipient, subject: MSG_STATE.subject.trim(), message: MSG_STATE.message };
}
let MSG_DUE_CHECKED = false;
async function dispatchDueBroadcasts(el){
  if (MSG_DUE_CHECKED) return;
  MSG_DUE_CHECKED = true;
  setTimeout(() => { MSG_DUE_CHECKED = false; }, 60000);   // at most once a minute
  const has = (DB.broadcasts || []).some(b => b.status === 'Scheduled');
  if (!has) return;
  const r = await apiPost('broadcast_send_due', {});
  if (r && r.ok && r.dispatched) {
    await loadAll();
    toast(`${r.dispatched} scheduled broadcast${r.dispatched === 1 ? '' : 's'} sent.`);
    if (TAB.messaging === 'broadcast' && $('msgSendBtn')) renderBroadcastTab(el);
  }
}

async function sendBroadcast(el){
  syncBroadcastFormIntoState();
  const message = MSG_STATE.message.trim();
  if (!message) { toast('Write a message before sending.'); return; }
  if (MSG_STATE.audience === 'specific' && !MSG_STATE.recipient) { toast('Choose who this message is for.'); return; }
  if (MSG_STATE.audience === 'class' && !MSG_STATE.grade) { toast('Choose a class/grade.'); return; }
  if (MSG_STATE.schedule && !MSG_STATE.scheduleAt) { toast('Pick a date and time to schedule for.'); return; }

  const btn = $('msgSendBtn'); if (btn) { btn.disabled = true; btn.textContent = MSG_STATE.schedule ? 'Scheduling…' : 'Sending…'; }
  const targetLabel = MSG_STATE.audience === 'specific' ? messagingRecipientName(MSG_STATE.recipient)
    : messagingAudienceLabel(MSG_STATE.audience, MSG_STATE.grade);
  const base = {
    id: uid('bc'), channel: 'In-app', audience: MSG_STATE.audience, grade: MSG_STATE.grade,
    targetId: MSG_STATE.audience === 'specific' ? MSG_STATE.recipient : '',
    subject: MSG_STATE.subject.trim(), targetLabel, message,
    sentBy: (S.user && S.user.name) || '',
  };
  let record, toastMsg;

  if (MSG_STATE.schedule) {
    // Saved now; the server sends it when the time comes (see dispatchDueBroadcasts / broadcast_send_due).
    const when = new Date(MSG_STATE.scheduleAt);
    record = Object.assign(base, { recipients: 0, status: 'Scheduled', scheduledFor: MSG_STATE.scheduleAt,
      scheduledAtUtc: isNaN(when) ? '' : when.toISOString(), date: new Date().toISOString() });
    toastMsg = 'Broadcast scheduled.';
  } else {
    const res = await apiPost('broadcast_send', broadcastPayload());
    if (!res || !res.ok) {
      toast((res && res.error) || 'Could not send. Nothing was sent.');
      renderBroadcastTab(el);
      return;
    }
    const inapp = res.inapp || 0;
    record = Object.assign(base, { targetLabel: res.label || targetLabel, recipients: inapp, inapp, failed: 0,
      status: inapp ? 'Sent' : 'Failed', error: '', date: new Date().toISOString() });
    toastMsg = `Notification sent to ${inapp} ${inapp === 1 ? 'person' : 'people'} (${record.targetLabel}).`;
  }

  DB.broadcasts = DB.broadcasts || [];
  DB.broadcasts.unshift(record);
  const ok = await persist('broadcasts');
  if (!ok) { DB.broadcasts.shift(); return; }
  toast(toastMsg);
  MSG_STATE.message = ''; MSG_STATE.subject = ''; MSG_STATE.schedule = false; MSG_STATE.scheduleAt = '';
  renderMessaging($('view'));
}
function syncBroadcastFormIntoState(){
  const c = $('msgContent'); if (c) MSG_STATE.message = c.value;
  const r = $('msgRecipient'); if (r) MSG_STATE.recipient = r.value;
  const g = $('msgGrade'); if (g) MSG_STATE.grade = g.value;
  const sa = $('msgScheduleAt'); if (sa) MSG_STATE.scheduleAt = sa.value;
  const sj = $('msgSubject'); if (sj) MSG_STATE.subject = sj.value;
}
