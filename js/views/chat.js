'use strict';
/* views/chat.js — Staff Chat: live channels where staff talk to each other.
     • pick who a message goes to (everyone in the channel, or only chosen people — those are private)
     • recipients give feedback (Got it / Done / Need details / Can't do) and the sender sees it live, plus "Seen"
     • the host or a moderator can End session & clear the chat for everyone; anyone can Clear my view
   "Live" = the browser polls api chat_poll every ~2.5 s while this screen is open (10 s if the tab is hidden).
   API: api/handlers/chat.php. Part of the EraMaster frontend — loaded after core.js, nav.js, shell.js. */

const CHAT_FB = [
  { id: 'ack',      icon: '👍', label: 'Got it' },
  { id: 'done',     icon: '✅', label: 'Done' },
  { id: 'question', icon: '❓', label: 'Need details' },
  { id: 'declined', icon: '🚫', label: "Can't do" },
];
const CHAT = {
  root: null, timer: null, tick: 0, busy: false, again: false, fail: 0, sending: false,
  channels: [], canCreatePublic: false, unreadTotal: 0, badgeReady: false,
  activeId: null, channel: null, members: [], me: null,
  msgs: [], lastId: 0, sn: 0, receipts: {},
  to: [], replyTo: null, draft: '', openFb: new Set(),
  sig: '', headSig: '', footMode: '', forceBottom: false, pickerOpen: false, pickerQ: '',
  titleN: 0, baseTitle: null,
};

/* ---------------- small helpers ---------------- */
function chatFb(id){ return CHAT_FB.find(f => f.id === id) || null; }
function chatAlive(){ return !!(CHAT.root && document.body.contains(CHAT.root) && S.user); }
function chatIsMobile(){ return window.matchMedia && window.matchMedia('(max-width: 800px)').matches; }
function chatTime(iso){ const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function chatDay(iso){
  const d = new Date(iso); if (isNaN(d)) return '';
  const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
}
function chatDateTime(iso){ const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
function chatMemberName(id){ const m = CHAT.members.find(x => x.id === id); return m ? m.name : 'Staff member'; }
function chatOthers(){ return CHAT.members.filter(m => CHAT.me && m.id !== CHAT.me.id); }
function chatRecipientNames(){ return CHAT.to.map(chatMemberName); }

/* ---------------- entry point ---------------- */
function renderStaffChat(el, opts){
  opts = opts || {};
  chatStop();
  if (CHAT.baseTitle === null) CHAT.baseTitle = document.title;
  el.innerHTML = `${opts.embedded ? '' : '<p class="crumb">💬 Communication <span>›</span> Staff Chat</p>'}
    <div class="chat-app ${opts.embedded ? 'embedded' : ''}" id="chatRoot">
      <aside class="chat-side" id="chatSide"><div class="empty">Loading…</div></aside>
      <section class="chat-main" id="chatMain"><div class="empty">Loading…</div></section>
    </div>`;
  CHAT.root = $('chatRoot');
  CHAT.sig = ''; CHAT.headSig = ''; CHAT.footMode = ''; CHAT.fail = 0;
  chatBoot();
}
async function chatBoot(){
  await chatLoadChannels();
  if (!chatAlive()) return;
  const keep = CHAT.channels.find(c => c.id === CHAT.activeId);
  if (keep || (!chatIsMobile() && CHAT.channels[0])) { await chatSelect((keep || CHAT.channels[0]).id); }
  else { chatRenderMain(); }
  chatSchedule();
}
function chatStop(){ clearTimeout(CHAT.timer); CHAT.timer = null; }

/* ---------------- polling loop ---------------- */
function chatSchedule(){
  clearTimeout(CHAT.timer);
  if (!chatAlive()) return;
  const base = document.hidden ? 10000 : 2500;
  const delay = Math.min(30000, base * Math.pow(2, Math.min(CHAT.fail, 4)));   // back off while the server is unreachable
  CHAT.timer = setTimeout(chatTick, delay);
}
async function chatTick(){
  if (!chatAlive()) { chatStop(); return; }
  CHAT.tick++;
  await chatPollOnce();
  if (chatAlive() && CHAT.tick % 3 === 0) await chatLoadChannels();   // unread counts of the other channels
  chatSchedule();
}
async function chatPollOnce(){
  if (CHAT.busy) { CHAT.again = true; return; }
  CHAT.busy = true;
  try {
    do { CHAT.again = false; await chatPollInner(); } while (CHAT.again && chatAlive());
  } finally { CHAT.busy = false; }
}
async function chatPollInner(){
  const cid = CHAT.activeId;
  if (!cid) return;
  const res = await apiGet('chat_poll', { channel_id: cid, after: CHAT.lastId, sn: CHAT.sn, viewing: document.hidden ? '0' : '1' });
  if (cid !== CHAT.activeId || !chatAlive()) return;
  if (!res || !res.ok) {
    CHAT.fail++;
    if (res && /no longer exists|not a member/i.test(res.error || '')) {
      toast(res.error); CHAT.activeId = null; CHAT.fail = 0;
      await chatLoadChannels();
      if (CHAT.channels[0] && !chatIsMobile()) await chatSelect(CHAT.channels[0].id); else chatRenderMain();
    }
    return;
  }
  CHAT.fail = 0;
  chatApply(res);
}

/* ---------------- apply a poll result ---------------- */
function chatApply(res){
  CHAT.me = res.me; CHAT.members = res.members;
  const ch = res.channel, prevStatus = CHAT.channel ? CHAT.channel.status : null;
  CHAT.channel = ch;

  let incoming = 0;
  if (ch.status === 'ended') { CHAT.msgs = []; CHAT.lastId = 0; }
  else if (res.reset) {
    CHAT.msgs = res.messages.slice();
    CHAT.lastId = CHAT.msgs.reduce((a, m) => Math.max(a, m.id), 0);
  } else {
    res.messages.forEach(m => {
      if (m.id > CHAT.lastId) { CHAT.msgs.push(m); CHAT.lastId = m.id; if (!m.is_system && m.sender_id !== CHAT.me.id) incoming++; }
    });
  }
  CHAT.sn = ch.session_no;

  CHAT.receipts = {};
  res.receipts.forEach(r => { (CHAT.receipts[r.message_id] = CHAT.receipts[r.message_id] || {})[r.user_id] = r; });

  // keep the sidebar's numbers honest without waiting for the next channel refresh
  const row = CHAT.channels.find(c => c.id === ch.id);
  if (row && !document.hidden && row.unread) { row.unread = 0; chatRenderSide(); chatRecountBadge(); }
  if (row && row.status !== ch.status) { row.status = ch.status; chatRenderSide(); }

  if (incoming && document.hidden) { CHAT.titleN += incoming; document.title = `(${CHAT.titleN}) ${CHAT.baseTitle}`; }

  chatRenderHead();
  if (prevStatus !== ch.status || CHAT.footMode === '') chatRenderFoot();
  chatRenderMsgs(false, incoming);
}

/* ---------------- channels list ---------------- */
async function chatLoadChannels(){
  const res = await apiGet('chat_channels');
  if (!res || !res.ok) { CHAT.fail++; return; }
  CHAT.channels = res.channels;
  CHAT.canCreatePublic = !!res.can_create_public;
  chatSetUnread(res.unread_total);
  if (chatAlive()) chatRenderSide();
}
function chatRecountBadge(){ chatSetUnread(CHAT.channels.reduce((a, c) => a + (c.unread || 0), 0)); }
function chatSetUnread(n){
  const prev = CHAT.unreadTotal;
  CHAT.unreadTotal = n;
  applyChatBadge();
  if (CHAT.badgeReady && n > prev && !chatAlive()) toast('💬 New staff chat message');
  CHAT.badgeReady = true;
}
function chatRenderSide(){
  const side = $('chatSide'); if (!side) return;
  side.innerHTML = `<div class="chat-side-head"><b>Channels</b><button class="btn tiny primary" id="chatNew">＋ New</button></div>
    <div class="chat-chan-list">${CHAT.channels.map(c => `<button class="chat-chan ${c.id === CHAT.activeId ? 'active' : ''}" data-id="${esc(c.id)}">
        <span class="cc-ico">${c.kind === 'public' ? '#' : '🔒'}</span>
        <span class="cc-name">${esc(c.name)}${c.status === 'ended' ? ' <em>ended</em>' : ''}</span>
        ${c.unread ? `<span class="cc-badge">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}
      </button>`).join('') || '<div class="empty">No channels yet.</div>'}</div>`;
  side.querySelectorAll('.chat-chan').forEach(b => b.onclick = () => chatSelect(b.dataset.id));
  $('chatNew').onclick = chatNewChannelModal;
}
async function chatSelect(id){
  CHAT.activeId = id; CHAT.channel = CHAT.channels.find(c => c.id === id) || null;
  CHAT.msgs = []; CHAT.lastId = 0; CHAT.sn = 0; CHAT.receipts = {}; CHAT.members = [];
  CHAT.to = []; CHAT.replyTo = null; CHAT.draft = ''; CHAT.openFb = new Set(); CHAT.pickerOpen = false;
  CHAT.sig = ''; CHAT.headSig = ''; CHAT.footMode = ''; CHAT.forceBottom = true;
  if (CHAT.root) CHAT.root.classList.add('show-main');
  chatRenderSide();
  chatRenderMain();
  await chatPollOnce();
}

/* ---------------- main pane skeleton ---------------- */
function chatRenderMain(){
  const main = $('chatMain'); if (!main) return;
  if (!CHAT.activeId) {
    main.innerHTML = `<div class="empty chat-empty"><b>Pick a channel</b>Choose a channel on the left, or start a new one.</div>`;
    return;
  }
  main.innerHTML = `<div class="chat-head" id="chatHead"></div>
    <div class="chat-msgs-wrap"><div class="chat-msgs" id="chatMsgs"><div class="empty">Loading…</div></div>
      <button class="chat-new-pill" id="chatPill" hidden>↓ New messages</button></div>
    <div class="chat-foot" id="chatFoot"></div>`;
  const list = $('chatMsgs');
  list.onclick = chatMsgClick;
  list.onscroll = () => { if (chatNearBottom()) $('chatPill').hidden = true; };
  $('chatPill').onclick = () => { list.scrollTop = list.scrollHeight; $('chatPill').hidden = true; };
}

/* ---------------- header ---------------- */
function chatRenderHead(){
  const head = $('chatHead'), ch = CHAT.channel; if (!head || !ch || !CHAT.me) return;
  const online = CHAT.members.filter(m => m.online).length;
  const sig = [ch.id, ch.name, ch.topic, ch.status, ch.session_no, ch.can_end, online, CHAT.members.length].join('|');
  if (sig === CHAT.headSig) return;
  CHAT.headSig = sig;
  const active = ch.status === 'active';
  head.innerHTML = `<button class="chat-back" id="chatBack" title="Back to channels">←</button>
    <div class="ch-title"><b>${ch.kind === 'public' ? '#' : '🔒'} ${esc(ch.name)}</b>
      <span class="ch-sub">${esc(ch.topic || (ch.kind === 'public' ? 'All staff' : 'Private channel'))} · <span class="dot online"></span>${online} online · ${CHAT.members.length} member${CHAT.members.length === 1 ? '' : 's'} · Session ${ch.session_no}${active ? '' : ' (ended)'}</span></div>
    <div class="ch-actions">
      <button class="btn tiny ghost" id="chatMembers">👥 Members</button>
      <button class="btn tiny ghost" id="chatClearMine" title="Hide the history on your screen only">🧹 Clear my view</button>
      ${ch.can_end && active ? `<button class="btn tiny danger ghost" id="chatEnd" title="Ends the session and deletes the chat for everyone">⛔ End session &amp; clear</button>` : ''}
      ${ch.can_end && !active ? `<button class="btn tiny primary" id="chatRestart">▶ Start new session</button>` : ''}
    </div>`;
  $('chatBack').onclick = () => { CHAT.root.classList.remove('show-main'); };
  $('chatMembers').onclick = chatMembersModal;
  $('chatClearMine').onclick = chatClearMine;
  if ($('chatEnd')) $('chatEnd').onclick = chatEndSession;
  if ($('chatRestart')) $('chatRestart').onclick = chatRestartSession;
}

/* ---------------- composer ---------------- */
function chatRenderFoot(){
  const foot = $('chatFoot'), ch = CHAT.channel; if (!foot || !ch) return;
  if (ch.status === 'ended') {
    CHAT.footMode = 'ended';
    foot.innerHTML = `<div class="chat-ended">🔚 <b>Session ended</b> by ${esc(ch.ended_by || 'the host')}${ch.ended_at ? ' on ' + esc(chatDateTime(ch.ended_at)) : ''}. The conversation was cleared for everyone.
      ${ch.can_end ? '<button class="btn tiny primary" id="chatRestart2">▶ Start new session</button>' : '<span class="muted"> Ask the host to start a new session.</span>'}</div>`;
    if ($('chatRestart2')) $('chatRestart2').onclick = chatRestartSession;
    return;
  }
  CHAT.footMode = 'live';
  foot.innerHTML = `<div id="chatReply"></div>
    <div class="chat-to" id="chatTo"></div>
    <div class="chat-input">
      <textarea id="chatInput" rows="1" maxlength="2000"></textarea>
      <button class="btn primary" id="chatSend">Send</button>
    </div>`;
  const inp = $('chatInput');
  inp.value = CHAT.draft;
  inp.oninput = () => { CHAT.draft = inp.value; chatAutosize(inp); };
  inp.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); chatDoSend(); } };
  $('chatSend').onclick = chatDoSend;
  chatAutosize(inp);
  chatRenderReply();
  chatRenderTo();
}
function chatAutosize(t){ t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px'; }
function chatRenderReply(){
  const el = $('chatReply'); if (!el) return;
  el.innerHTML = CHAT.replyTo
    ? `<div class="chat-replying"><span>↩ Replying to <b>${esc(CHAT.replyTo.name)}</b>: ${esc(CHAT.replyTo.body)}</span><button class="btn tiny ghost" id="chatReplyX">✕</button></div>` : '';
  if ($('chatReplyX')) $('chatReplyX').onclick = () => { CHAT.replyTo = null; chatRenderReply(); };
}
function chatRenderTo(){
  const el = $('chatTo'); if (!el) return;
  const names = chatRecipientNames();
  el.innerHTML = `<div class="to-row">
      <span class="to-lbl">To:</span>
      <button class="to-chip ${CHAT.to.length ? '' : 'on'}" id="chatToAll" title="Everyone in this channel sees it">👥 Everyone</button>
      ${CHAT.to.map((id, i) => `<span class="to-chip on person">🔒 ${esc(names[i])}<button class="to-x" data-id="${esc(id)}" title="Remove">✕</button></span>`).join('')}
      <button class="to-add" id="chatToAdd">＋ Choose people</button>
    </div>
    <div class="to-pop" id="chatToPop" ${CHAT.pickerOpen ? '' : 'hidden'}></div>`;
  $('chatToAll').onclick = () => { CHAT.to = []; chatRenderTo(); chatUpdatePlaceholder(); };
  $('chatToAdd').onclick = () => { CHAT.pickerOpen = !CHAT.pickerOpen; CHAT.pickerQ = ''; chatRenderTo(); };
  el.querySelectorAll('.to-x').forEach(b => b.onclick = () => { CHAT.to = CHAT.to.filter(x => x !== b.dataset.id); chatRenderTo(); chatUpdatePlaceholder(); });
  if (CHAT.pickerOpen) chatRenderPicker();
  chatUpdatePlaceholder();
}
function chatUpdatePlaceholder(){
  const inp = $('chatInput'), btn = $('chatSend'); if (!inp || !CHAT.channel) return;
  inp.placeholder = CHAT.to.length ? `Private message to ${chatRecipientNames().join(', ')}…` : `Message everyone in ${CHAT.channel.name}…`;
  if (btn) btn.textContent = CHAT.to.length ? '🔒 Send privately' : 'Send';
}
function chatRenderPicker(){
  const pop = $('chatToPop'); if (!pop) return;
  pop.innerHTML = `<input id="chatToQ" placeholder="Search staff…" value="${esc(CHAT.pickerQ)}">
    <div class="to-list" id="chatToList"></div>
    <div class="to-foot"><button class="btn tiny ghost" id="chatToClear">Everyone</button><button class="btn tiny primary" id="chatToDone">Done</button></div>`;
  const fill = () => {
    const q = CHAT.pickerQ.trim().toLowerCase();
    const rows = chatOthers().filter(m => !q || m.name.toLowerCase().includes(q) || (m.role || '').toLowerCase().includes(q));
    $('chatToList').innerHTML = rows.map(m => `<label class="to-item"><input type="checkbox" data-id="${esc(m.id)}" ${CHAT.to.includes(m.id) ? 'checked' : ''}>
        <span class="dot ${m.online ? 'online' : ''}"></span><span class="ti-name">${esc(m.name)}</span><small>${esc(m.role || '')}</small></label>`).join('')
      || '<div class="empty" style="padding:10px">Nobody else is in this channel.</div>';
    $('chatToList').querySelectorAll('input').forEach(cb => cb.onchange = () => {
      CHAT.to = cb.checked ? Array.from(new Set(CHAT.to.concat(cb.dataset.id))) : CHAT.to.filter(x => x !== cb.dataset.id);
      chatRenderToChips();
    });
  };
  fill();
  $('chatToQ').oninput = e => { CHAT.pickerQ = e.target.value; fill(); };
  $('chatToClear').onclick = () => { CHAT.to = []; CHAT.pickerOpen = false; chatRenderTo(); };
  $('chatToDone').onclick = () => { CHAT.pickerOpen = false; chatRenderTo(); };
  $('chatToQ').focus();
}
/** Re-draws just the chips row while the picker stays open (so the search box keeps focus). */
function chatRenderToChips(){
  const row = document.querySelector('#chatTo .to-row'); if (!row) return;
  const names = chatRecipientNames();
  row.innerHTML = `<span class="to-lbl">To:</span>
    <button class="to-chip ${CHAT.to.length ? '' : 'on'}" id="chatToAll">👥 Everyone</button>
    ${CHAT.to.map((id, i) => `<span class="to-chip on person">🔒 ${esc(names[i])}<button class="to-x" data-id="${esc(id)}" title="Remove">✕</button></span>`).join('')}
    <button class="to-add" id="chatToAdd">＋ Choose people</button>`;
  $('chatToAll').onclick = () => { CHAT.to = []; chatRenderTo(); };
  $('chatToAdd').onclick = () => { CHAT.pickerOpen = false; chatRenderTo(); };
  row.querySelectorAll('.to-x').forEach(b => b.onclick = () => { CHAT.to = CHAT.to.filter(x => x !== b.dataset.id); chatRenderTo(); });
  chatUpdatePlaceholder();
}
document.addEventListener('mousedown', e => {
  if (CHAT.pickerOpen && chatAlive() && !e.target.closest('#chatTo')) { CHAT.pickerOpen = false; chatRenderTo(); }
});

async function chatDoSend(){
  const inp = $('chatInput'), btn = $('chatSend');
  if (!inp || CHAT.sending || !CHAT.activeId) return;
  const body = inp.value.trim();
  if (!body) return;
  CHAT.sending = true; btn.disabled = true;
  const res = await apiPost('chat_send', { channel_id: CHAT.activeId, body, to: CHAT.to, reply_to: CHAT.replyTo ? CHAT.replyTo.id : null });
  CHAT.sending = false; if ($('chatSend')) $('chatSend').disabled = false;
  if (!res.ok) { toast(res.error || 'Could not send the message.'); chatPollOnce(); return; }
  inp.value = ''; CHAT.draft = ''; CHAT.replyTo = null; chatAutosize(inp); chatRenderReply();
  CHAT.forceBottom = true;
  await chatPollOnce();
  inp.focus();
}

/* ---------------- messages ---------------- */
function chatNearBottom(){ const el = $('chatMsgs'); return !el || (el.scrollHeight - el.scrollTop - el.clientHeight) < 90; }

function chatSignature(){
  let s = CHAT.msgs.length + ':' + CHAT.lastId + ':' + CHAT.openFb.size + ':' + Array.from(CHAT.openFb).join(',');
  Object.keys(CHAT.receipts).forEach(mid => {
    Object.values(CHAT.receipts[mid]).forEach(r => { s += `|${mid}.${r.user_id}.${r.seen_at ? 1 : 0}.${r.feedback || ''}`; });
  });
  return s;
}
function chatRenderMsgs(force, incoming){
  const el = $('chatMsgs'); if (!el || !CHAT.me) return;
  const sig = chatSignature();
  if (!force && sig === CHAT.sig) return;
  CHAT.sig = sig;
  const stick = CHAT.forceBottom || chatNearBottom(), prevTop = el.scrollTop;
  if (!CHAT.msgs.length) {
    el.innerHTML = `<div class="empty chat-empty"><b>${CHAT.channel && CHAT.channel.status === 'ended' ? 'Chat cleared' : 'No messages yet'}</b>${CHAT.channel && CHAT.channel.status === 'ended' ? '' : 'Say hello — pick who it goes to below.'}</div>`;
  } else {
    let prevDay = '';
    el.innerHTML = CHAT.msgs.map(m => {
      const day = chatDay(m.created_at);
      const sep = day !== prevDay ? `<div class="chat-day"><span>${esc(day)}</span></div>` : '';
      prevDay = day;
      return sep + chatMsgHtml(m);
    }).join('');
  }
  if (stick) { el.scrollTop = el.scrollHeight; CHAT.forceBottom = false; if ($('chatPill')) $('chatPill').hidden = true; }
  else { el.scrollTop = prevTop; if (incoming && $('chatPill')) $('chatPill').hidden = false; }
}
function chatMsgHtml(m){
  const meId = CHAT.me.id;
  if (m.is_system) return `<div class="cm-sys">${esc(m.body)} · ${esc(chatTime(m.created_at))}</div>`;
  const mine = m.sender_id === meId;
  const directed = m.to.length > 0;
  const forMe = directed && m.to.some(t => t.id === meId);
  const recs = CHAT.receipts[m.id] || {};
  const myFb = recs[meId] ? recs[meId].feedback : null;

  const tag = directed
    ? `<span class="cm-tag">🔒 ${mine ? 'Only to: ' : 'Private — '}${esc(m.to.map(t => t.id === meId ? 'you' : t.name).join(', '))}</span>` : '';
  const quote = m.reply_to ? `<div class="cm-quote"><b>${esc(m.reply_to.name)}</b> ${esc(m.reply_to.body)}</div>` : '';

  let status = '';
  if (mine && directed) {
    status = `<div class="cm-status">${m.to.map(t => {
      const r = recs[t.id]; const f = r && chatFb(r.feedback);
      if (f) return `<span class="cm-chip fb-${r.feedback}" title="${esc(chatDateTime(r.feedback_at))}">${esc(t.name)}: ${f.icon} ${esc(f.label)}</span>`;
      if (r && r.seen_at) return `<span class="cm-chip seen" title="${esc(chatDateTime(r.seen_at))}">${esc(t.name)}: 👁 Seen</span>`;
      return `<span class="cm-chip">${esc(t.name)}: ✓ Sent</span>`;
    }).join('')}</div>`;
  } else if (mine) {
    const groups = {};
    Object.values(recs).forEach(r => { if (chatFb(r.feedback)) (groups[r.feedback] = groups[r.feedback] || []).push(chatMemberName(r.user_id)); });
    const chips = CHAT_FB.filter(f => groups[f.id]).map(f => `<span class="cm-chip fb-${f.id}" title="${esc(groups[f.id].join(', '))}">${f.icon} ${esc(f.label)} ×${groups[f.id].length}</span>`);
    if (chips.length) status = `<div class="cm-status">${chips.join('')}</div>`;
  } else {
    const showRow = forMe || CHAT.openFb.has(m.id);
    status = `<div class="cm-actions">
      ${showRow ? CHAT_FB.map(f => `<button class="fb-btn ${myFb === f.id ? 'on' : ''}" data-act="fb" data-id="${m.id}" data-fb="${f.id}">${f.icon} ${esc(f.label)}</button>`).join('')
                : `<button class="fb-link" data-act="openfb" data-id="${m.id}">Give feedback</button>`}
      <button class="fb-link" data-act="reply" data-id="${m.id}">↩ Reply</button>
    </div>`;
  }

  const who = mine ? '<b>You</b>' : `<b class="cm-who" data-act="pm" data-sid="${esc(m.sender_id)}" title="Message only ${esc(m.sender_name)}">${esc(m.sender_name)}</b>`;
  return `<div class="cm ${mine ? 'mine' : ''} ${forMe ? 'to-me' : ''}" data-id="${m.id}">
    <div class="cm-meta">${who} · ${esc(chatTime(m.created_at))} ${tag}</div>
    ${quote}<div class="cm-body">${esc(m.body)}</div>${status}</div>`;
}
function chatMsgClick(e){
  const t = e.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act, id = Number(t.dataset.id);
  if (act === 'openfb') { CHAT.openFb.add(id); chatRenderMsgs(true, 0); }
  else if (act === 'fb') { chatSendFeedback(id, t.dataset.fb); }
  else if (act === 'reply') {
    const m = CHAT.msgs.find(x => x.id === id); if (!m || !$('chatInput')) return;
    CHAT.replyTo = { id: m.id, name: m.sender_name, body: m.body.length > 90 ? m.body.slice(0, 90) + '…' : m.body };
    if (m.to.length) CHAT.to = [m.sender_id];                 // answering a private message stays private by default
    chatRenderReply(); chatRenderTo(); $('chatInput').focus();
  }
  else if (act === 'pm') {
    const sid = t.dataset.sid; if (!$('chatInput') || !chatOthers().some(x => x.id === sid)) return;
    CHAT.to = [sid]; chatRenderTo(); $('chatInput').focus();
  }
}
async function chatSendFeedback(mid, fb){
  const cur = CHAT.receipts[mid] && CHAT.receipts[mid][CHAT.me.id];
  const next = (cur && cur.feedback === fb) ? '' : fb;          // tapping the active answer again withdraws it
  const res = await apiPost('chat_feedback', { message_id: mid, feedback: next });
  if (!res.ok) { toast(res.error || 'Could not send feedback.'); }
  await chatPollOnce();
}

/* ---------------- header actions ---------------- */
async function chatClearMine(){
  if (!confirm('Clear this chat from YOUR screen? Everyone else keeps their copy.')) return;
  const res = await apiPost('chat_clear_mine', { channel_id: CHAT.activeId });
  if (!res.ok) { toast(res.error || 'Could not clear.'); return; }
  CHAT.msgs = []; CHAT.receipts = {}; CHAT.forceBottom = true; chatRenderMsgs(true, 0);
  toast('Your view was cleared.');
}
async function chatEndSession(){
  const name = CHAT.channel ? CHAT.channel.name : 'this channel';
  if (!confirm(`End the session in "${name}" for EVERYONE?\n\nAll messages and feedback will be permanently deleted. You can start a fresh session afterwards.`)) return;
  const res = await apiPost('chat_end', { channel_id: CHAT.activeId });
  if (!res.ok) { toast(res.error || 'Could not end the session.'); return; }
  toast(`Session ended — ${res.cleared} message${res.cleared === 1 ? '' : 's'} cleared.`);
  CHAT.forceBottom = true;
  await chatPollOnce(); await chatLoadChannels();
}
async function chatRestartSession(){
  const res = await apiPost('chat_restart', { channel_id: CHAT.activeId });
  if (!res.ok) { toast(res.error || 'Could not start a new session.'); return; }
  toast('New session started.');
  CHAT.footMode = ''; CHAT.forceBottom = true;
  await chatPollOnce(); await chatLoadChannels();
}

/* ---------------- modals ---------------- */
function chatPeopleListHtml(people, checked){
  return `<input id="chatPplQ" placeholder="Search staff…" style="margin-bottom:8px">
    <div class="ncm-list" id="chatPplList">${people.map(p => `<label class="to-item ncm-item" data-q="${esc((p.name + ' ' + (p.role || '')).toLowerCase())}">
        <input type="checkbox" value="${esc(p.id)}" ${checked && checked.includes(p.id) ? 'checked' : ''}>
        <span class="dot ${p.online ? 'online' : ''}"></span><span class="ti-name">${esc(p.name)}</span><small>${esc(p.role || '')}</small></label>`).join('')
      || '<div class="empty">No staff to show.</div>'}</div>`;
}
function chatWirePeopleSearch(){
  const q = $('chatPplQ'); if (!q) return;
  q.oninput = () => {
    const s = q.value.trim().toLowerCase();
    document.querySelectorAll('#chatPplList .ncm-item').forEach(x => { x.style.display = !s || x.dataset.q.includes(s) ? '' : 'none'; });
  };
}
function chatPickedIds(){ return Array.from(document.querySelectorAll('#chatPplList input:checked')).map(x => x.value); }

async function chatNewChannelModal(){
  const res = await apiGet('chat_staff');
  if (!res || !res.ok) { toast((res && res.error) || 'Could not load staff.'); return; }
  openModal('New channel', `<label>Channel name</label><input id="chNewName" maxlength="60" placeholder="e.g. Exams team, Form 3 teachers">
    <label>Topic <span class="muted" style="font-weight:400">(optional)</span></label><input id="chNewTopic" maxlength="200" placeholder="What is this channel for?">
    <label>Who can join</label>
    <select id="chNewKind"><option value="private">🔒 Private — only the people I pick</option>${CHAT.canCreatePublic ? '<option value="public"># Public — all staff</option>' : ''}</select>
    <div id="chNewPeople"><label>Add colleagues</label>${chatPeopleListHtml(res.staff, [])}</div>`,
    async () => {
      const name = $('chNewName').value.trim(), kind = $('chNewKind').value;
      if (name.length < 2) { toast('Give the channel a name.'); return false; }
      const members = kind === 'private' ? chatPickedIds() : [];
      if (kind === 'private' && !members.length) { toast('Pick at least one colleague.'); return false; }
      const r = await apiPost('chat_channel_create', { name, topic: $('chNewTopic').value.trim(), kind, members });
      if (!r.ok) { toast(r.error || 'Could not create the channel.'); return false; }
      await chatLoadChannels();
      chatSelect(r.id);
      return true;
    }, { saveLabel: 'Create channel' });
  chatWirePeopleSearch();
  $('chNewKind').onchange = () => { $('chNewPeople').style.display = $('chNewKind').value === 'private' ? '' : 'none'; };
}

async function chatMembersModal(){
  const ch = CHAT.channel; if (!ch) return;
  const list = `<div class="ncm-list">${CHAT.members.map(m => `<div class="to-item"><span class="dot ${m.online ? 'online' : ''}"></span>
      <span class="ti-name">${esc(m.name)}${CHAT.me && m.id === CHAT.me.id ? ' (you)' : ''}${m.id === ch.created_by ? ' <em class="muted">host</em>' : ''}</span><small>${esc(m.role || '')}</small></div>`).join('')}</div>`;
  const canAdd = ch.kind === 'private' && ch.can_end;
  if (!canAdd) { openModal(`${ch.name} — members`, list + (ch.kind === 'public' ? '<p class="muted" style="margin-top:10px">Everyone on the staff is in this channel.</p>' : ''), null, { noFoot: true }); return; }
  const res = await apiGet('chat_staff');
  const inIds = CHAT.members.map(m => m.id);
  const others = (res && res.ok ? res.staff : []).filter(s => !inIds.includes(s.id));
  openModal(`${ch.name} — members`, list + `<label style="margin-top:14px">Add people</label>${chatPeopleListHtml(others, [])}`, async () => {
    const ids = chatPickedIds();
    if (!ids.length) { toast('Tick the people to add.'); return false; }
    const r = await apiPost('chat_add_members', { channel_id: ch.id, members: ids });
    if (!r.ok) { toast(r.error || 'Could not add them.'); return false; }
    toast(`${r.added} added.`); CHAT.headSig = ''; await chatPollOnce(); return true;
  }, { saveLabel: 'Add selected' });
  chatWirePeopleSearch();
}

/* ---------------- unread badge on the sidebar item ---------------- */
function applyChatBadge(){
  document.querySelectorAll('.nav-item[data-id="chat"] .chat-nav-badge').forEach(x => x.remove());
  const item = document.querySelector('.nav-item[data-id="chat"]');
  if (item && CHAT.unreadTotal > 0) item.insertAdjacentHTML('beforeend', `<span class="chat-nav-badge">${CHAT.unreadTotal > 99 ? '99+' : CHAT.unreadTotal}</span>`);
}
// buildNav() redraws the whole sidebar, so put the badge back each time it does.
(function(){
  const orig = buildNav;
  buildNav = function(){ orig.apply(this, arguments); applyChatBadge(); };
})();
// While the chat screen is closed, check for new messages every 20 s (chat screen keeps its own faster loop).
let CHAT_BG_BUSY = false;
setInterval(() => {
  if (CHAT_BG_BUSY || document.hidden || !S.user || isPortalUser() || !can('communication.view') || chatAlive()) return;
  CHAT_BG_BUSY = true;
  apiGet('chat_channels').then(res => { if (res && res.ok) chatSetUnread(res.unread_total); }).finally(() => { CHAT_BG_BUSY = false; });
}, 20000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (CHAT.titleN && CHAT.baseTitle !== null) { CHAT.titleN = 0; document.title = CHAT.baseTitle; }
    if (chatAlive()) { chatStop(); chatTick(); }              // catch up immediately when the tab comes back
  }
});
