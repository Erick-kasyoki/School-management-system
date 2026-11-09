'use strict';
/* views/my-profile.js — "My Profile" for every kind of account (staff, student, parent).
   Data comes from the profile_get action (api/handlers/profile.php), which is already
   limited to the signed-in person. Part of the EraMaster frontend — loaded after core.js. */

const PF_ICONS = {
  users:    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  book:     '<path d="M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2z"/><path d="M22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8z"/>',
  file:     '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
  mail:     '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  phone:    '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  whatsapp: '<path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.7-5.4A8.4 8.4 0 1 1 21 11.5z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-1.9-1-.9.7a3.6 3.6 0 0 1-1.7-1.7l.7-.9-1-1.9z"/>',
  pin:      '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  edit:     '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  lock:     '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  bell:     '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  idcard:   '<rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17a3.5 3.5 0 0 1 7 0M15 9h4M15 13h3"/>',
  grid:     '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  eye:      '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  camera:   '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  sun:      '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  heart:    '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
  coin:     '<circle cx="12" cy="12" r="9"/><path d="M14.5 9a2.5 2.5 0 0 0-2.5-1.5c-1.4 0-2.5.8-2.5 2s1 1.8 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2A2.5 2.5 0 0 1 9.5 15M12 6v1.5M12 16.5V18"/>',
};
function pfIcon(n){ return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PF_ICONS[n] || ''}</svg>`; }

let PF = { data: null, tab: 'overview' };

/* ---------------- small formatters ---------------- */
function pfOrdinal(n){ const v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); }
const PF_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function pfLongDate(s){
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? `${pfOrdinal(Number(m[3]))} ${PF_MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(s || '');
}
function pfClock(d){ let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${pad(d.getMinutes())} ${ap}`; }
function pfWhen(iso){
  const d = new Date(iso); if (isNaN(d.getTime())) return '';
  const days = daysBetween(fmtDate(d), today());
  if (days === 0) return 'Today, ' + pfClock(d);
  if (days === 1) return 'Yesterday, ' + pfClock(d);
  return `${d.getDate()} ${PF_MONTHS[d.getMonth()].slice(0, 3)}, ${d.getFullYear()}`;
}
// "08:00 – 08:40" → 'on' (happening now) | 'up' (later today) | 'done'
function pfLessonState(range){
  const m = /(\d{2}):(\d{2})\s*[–-]\s*(\d{2}):(\d{2})/.exec(range || '');
  if (!m) return 'up';
  const now = new Date(), cur = now.getHours() * 60 + now.getMinutes();
  const a = Number(m[1]) * 60 + Number(m[2]), b = Number(m[3]) * 60 + Number(m[4]);
  return cur >= a && cur < b ? 'on' : (cur < a ? 'up' : 'done');
}
const PF_STATE_LABEL = { on: 'Ongoing', up: 'Upcoming', done: 'Done' };
function pfAmPm(range){   // "08:00 – 08:40" → "8:00 AM - 8:40 AM"
  const f = t => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`; };
  const m = /(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})/.exec(range || '');
  return m ? `${f(m[1])} - ${f(m[2])}` : range;
}
function pfRoleKind(d){ return d.kind === 'student' ? 'Student' : d.kind === 'parent' ? 'Parent' : ((d.header.badge || 'Staff').replace(/^(the)\s+/i, '')); }

/* ---------------- load + draw ---------------- */
async function renderProfile(el){
  el.innerHTML = '<div class="empty">Loading your profile…</div>';
  const res = await apiGet('profile_get', { today: today() });
  if (!res.ok) {
    el.innerHTML = `<div class="empty" style="max-width:520px;margin:40px auto"><b>Could not load your profile</b>${esc(res.error || 'Something went wrong.')}<div style="margin-top:14px"><button class="btn primary" id="pfRetry">Try again</button></div></div>`;
    $('pfRetry').onclick = () => renderProfile(el);
    return;
  }
  PF.data = res;
  if (!res.tabs.some(t => t.id === PF.tab)) PF.tab = 'overview';
  pfDraw(el);
}
function pfReload(){ PF.data = null; renderProfile($('view')); }

function pfInfoGrid(rows){
  return `<dl class="pf-info">${rows.map(r => `<div><dt>${esc(r.label)}</dt><dd class="${r.value ? '' : 'pf-none'}">${esc(/^\d{4}-\d{2}-\d{2}$/.test(r.value) ? pfLongDate(r.value) : (r.value || '—'))}</dd></div>`).join('')}</dl>`;
}
function pfCard(title, bodyHtml, actionBtn){
  return `<section class="pf-card"><div class="pf-head"><h3>${esc(title)}</h3>${actionBtn || ''}</div>${bodyHtml}</section>`;
}
function pfTable(t, opts){
  opts = opts || {};
  if (!t || !t.rows.length) return `<div class="pf-empty">${esc(opts.empty || 'Nothing to show yet.')}</div>`;
  const hasAction = t.columns.length > t.rows[0].cells.length;
  return `<div class="pf-table-wrap"><table class="pf-table"><thead><tr>${t.columns.map((c, i) => `<th class="${hasAction && i === t.columns.length - 1 ? 'act' : ''}">${esc(c)}</th>`).join('')}</tr></thead><tbody>
    ${t.rows.map((r, i) => `<tr>${r.cells.map(c => `<td>${esc(c)}</td>`).join('')}${hasAction ? `<td class="act">${r.detail ? `<button class="pf-eye" data-detail="${i}" title="View students" aria-label="View">${pfIcon('eye')}</button>` : ''}</td>` : ''}</tr>`).join('')}
  </tbody></table></div>`;
}
function pfWeek(w){
  if (!w) return '<div class="pf-empty">No lessons are on the timetable yet.</div>';
  const cols = w.days.length;
  return `<div class="pf-table-wrap"><table class="pf-table pf-week"><thead><tr><th>Time / Lesson</th>${w.days.map(d => `<th>${esc(d)}</th>`).join('')}</tr></thead><tbody>
    ${w.rows.map(r => r.label
      ? `<tr class="pf-fixed"><td class="per"><b>${esc(pfAmPm(r.time))}</b></td><td colspan="${cols}">${esc(r.label)}</td></tr>`
      : `<tr><td class="per"><b>${esc(r.time ? pfAmPm(r.time) : '—')}</b><span>Lesson ${r.lesson}</span></td>${r.cells.map(c => `<td class="${c ? 'has' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>`;
}
function pfStatusChip(s){
  const cls = /^(present|approved|completed|published|late)$/i.test(s) ? 'ok' : /^(absent|rejected)/i.test(s) ? 'bad' : /^(pending|excused)/i.test(s) ? 'warn' : '';
  return `<span class="pf-chip ${cls}">${esc(s || '—')}</span>`;
}

/* ---------------- tab bodies ---------------- */
function pfTabOverview(d){
  const personalEditable = d.personal.some(r => r.editable);
  const profEditable = d.professional.some(r => r.editable);
  const kindWord = d.kind === 'student' ? 'Academic' : 'Professional';
  return pfCard('Personal Information', pfInfoGrid(d.personal), personalEditable ? '<button class="pf-pill-btn" id="pfEditPersonal">Edit Personal Info</button>' : '')
    + (d.professional.length ? pfCard(kindWord + ' Information', pfInfoGrid(d.professional), profEditable ? `<button class="pf-pill-btn" id="pfEditProf">Edit ${kindWord} Info</button>` : '') : '')
    + pfCard(d.kind === 'staff' ? 'Bio / About Me' : 'About Me',
        `<p class="pf-bio ${d.bio ? '' : 'empty'}">${d.bio ? esc(d.bio).replace(/\n/g, '<br>') : 'Nothing here yet. Use “Edit Bio” to tell people a little about yourself.'}</p>`,
        '<button class="pf-pill-btn" id="pfEditBio">Edit Bio</button>');
}
function pfTabProfessional(d){
  const kindWord = d.kind === 'student' ? 'Academic' : 'Professional';
  let html = pfCard(kindWord + ' Information', pfInfoGrid(d.professional), d.professional.some(r => r.editable) ? `<button class="pf-pill-btn" id="pfEditProf">Edit ${kindWord} Info</button>` : '');
  if (d.kind === 'staff') {
    html += pfCard('Training & Performance Reviews', d.extras.length
      ? `<div class="pf-table-wrap"><table class="pf-table"><thead><tr><th>Type</th><th>Title</th><th>Details</th><th>Status</th></tr></thead><tbody>${d.extras.map(x => `<tr><td>${esc(x.kind)}</td><td>${esc(x.title)}</td><td>${esc(x.detail)}</td><td>${pfStatusChip(x.status)}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="pf-empty">No training courses or performance reviews are recorded for you yet.</div>');
  }
  return html;
}
function pfTabTeaching(d){
  if (d.kind === 'parent') return pfCard('My Children', pfTable(d.classes, { empty: 'No children are attached to your record yet. Please contact the school office.' }));
  return pfCard('My Weekly Timetable', pfWeek(d.week));
}
function pfTabDocuments(d){
  return pfCard('School Documents', d.documents.length
    ? `<div class="pf-table-wrap"><table class="pf-table"><thead><tr><th>Title</th><th>Category</th><th>Description</th><th>Date</th></tr></thead><tbody>${d.documents.map(x => `<tr><td><b>${esc(x.title)}</b></td><td>${esc(x.category)}</td><td>${esc(x.description)}</td><td>${esc(x.date)}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="pf-empty">No published school documents yet.</div>');
}
function pfTabLeave(d){
  let html = '';
  if (d.kind === 'staff') {
    html += pfCard('Leave Requests', d.leaveRows.length
      ? `<div class="pf-table-wrap"><table class="pf-table"><thead><tr><th>Type</th><th>From</th><th>To</th><th>Reason</th><th>Status</th></tr></thead><tbody>${d.leaveRows.map(x => `<tr><td>${esc(x.type)}</td><td>${esc(x.from)}</td><td>${esc(x.to)}</td><td>${esc(x.reason)}</td><td>${pfStatusChip(x.status)}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="pf-empty">You have not requested any leave.</div>' + (can('leave.request') ? '<div style="margin-top:10px"><button class="btn primary" onclick="goTo(\'applyleave\')">Apply for Leave</button></div>' : ''));
  }
  html += pfCard(d.kind === 'staff' ? 'Attendance Record' : 'Attendance', d.attendance.length
    ? `<div class="pf-table-wrap"><table class="pf-table"><thead><tr><th>Date</th><th>Status</th><th>Note</th></tr></thead><tbody>${d.attendance.map(x => `<tr><td>${esc(x.date)}</td><td>${pfStatusChip(x.status)}</td><td>${esc(x.note)}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="pf-empty">No attendance has been recorded yet.</div>');
  return html;
}
function pfActivityIcon(a){
  if (/delete|reject/.test(a.action)) return ['red', 'file'];
  if (/login|approve/.test(a.action)) return ['green', 'users'];
  if (/create/.test(a.action)) return ['blue', 'file'];
  return ['blue', 'edit'];
}
function pfTabActivity(d){
  return pfCard('Activity Log', d.activity.length
    ? `<div class="pf-table-wrap"><table class="pf-table"><thead><tr><th>When</th><th>Action</th><th>Area</th><th>Details</th></tr></thead><tbody>${d.activity.map(a => `<tr><td style="white-space:nowrap">${esc(pfWhen(a.at))}</td><td>${esc(a.action)}</td><td>${esc(a.entity)}</td><td>${esc(a.summary)}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="pf-empty">Nothing has been recorded for your account yet.</div>');
}

/* ---------------- side + right columns ---------------- */
function pfSide(d){
  const h = d.header;
  const dept = d.kind === 'staff' && h.subtitle && !/department/i.test(h.subtitle) ? h.subtitle + ' Department' : h.subtitle;
  const quick = [
    ['edit', 'Edit Profile', 'pfQEdit'],
    ['lock', 'Change Password', 'pfQPass'],
    ['bell', 'Notification Settings', 'pfQNotif'],
    ['idcard', 'Download ID Card', 'pfQId'],
  ];
  if (d.kind !== 'parent' && d.teaching) quick.push(['grid', 'View Timetable', 'pfQTt']);
  const contacts = [['mail', h.email], ['phone', h.phone], ['whatsapp', h.whatsapp], ['pin', h.address]].filter(c => c[1]);
  return `<aside class="pf-side">
    <div class="pf-card">
      <div class="pf-id">
        <div class="pf-avatar-wrap">
          ${h.photo ? `<img class="pf-avatar" src="${esc(h.photo)}" alt="">` : `<div class="pf-avatar ph">${esc(initials(h.name))}</div>`}
          <span class="pf-online" title="Online"></span>
          <button class="pf-cam" id="pfCam" type="button" title="Change photo" aria-label="Change photo">${pfIcon('camera')}</button>
          <input type="file" id="pfFile" accept="image/*" hidden>
        </div>
        <h2 class="pf-name">${esc(h.name)}</h2>
        ${h.badge ? `<div class="pf-role">${esc(h.badge)}</div>` : ''}
        ${dept ? `<div class="pf-sub">${esc(dept)}</div>` : ''}
        ${h.idValue ? `<div class="pf-sub"><b>${esc(h.idLabel)}: ${esc(h.idValue)}</b></div>` : ''}
      </div>
      <ul class="pf-contacts">${contacts.length ? contacts.map(c => `<li>${pfIcon(c[0])}<span>${esc(c[1])}</span></li>`).join('') : '<li class="pf-empty">No contact details yet.</li>'}</ul>
    </div>
    <div class="pf-card pf-quick" style="margin-top:var(--pf-gap)">
      <h3>Quick Actions</h3>
      ${quick.map(q => `<button type="button" id="${q[2]}">${pfIcon(q[0])}${esc(q[1])}</button>`).join('')}
    </div>
  </aside>`;
}
function pfRight(d){
  const sum = `<section class="pf-card"><div class="pf-head"><h3>Summary</h3></div><div class="pf-sum">
    ${d.summary.map(t => `<div class="pf-tile"><div class="pf-ico ${esc(t.tone)}">${pfIcon(t.icon)}</div><div><b>${esc(t.value)}</b><span class="l">${esc(t.label)}</span></div></div>`).join('')}
  </div></section>`;

  let sched;
  if (d.lessons.length) {
    sched = pfCard("Today's Schedule", `<ul class="pf-list pf-sched">${d.lessons.map(l => { const st = pfLessonState(l.time); return `<li><span class="t">${esc(pfAmPm(l.time))}</span><span class="s"><span class="pf-state ${st}">${PF_STATE_LABEL[st]}</span></span><span class="c">${esc(l.label)}</span></li>`; }).join('')}</ul>`,
      d.teaching ? '<button class="pf-link" id="pfSchedLink">View Timetable</button>' : '');
  } else if (d.events.length) {
    sched = pfCard('Upcoming Events', `<ul class="pf-list pf-sched">${d.events.map(e => `<li><span class="t">${esc(pfLongDate(e.date))}${e.time ? ' · ' + esc(e.time) : ''}</span><span class="c">${esc(e.title)}${e.venue ? ' — ' + esc(e.venue) : ''}</span></li>`).join('')}</ul>`);
  } else {
    sched = pfCard("Today's Schedule", `<div class="pf-empty">${d.teaching ? 'No lessons today. Enjoy the day!' : 'Nothing scheduled.'}</div>`);
  }

  const acts = d.activity.slice(0, 4);
  const act = pfCard('Recent Activity', acts.length
    ? `<ul class="pf-list pf-act">${acts.map(a => { const [tone, ico] = pfActivityIcon(a); return `<li><span class="ai ${tone}">${pfIcon(ico)}</span><div><div class="tx">${esc(a.summary)}</div><div class="tm">${esc(pfWhen(a.at))}</div></div></li>`; }).join('')}</ul>`
    : '<div class="pf-empty">No recent activity.</div>',
    '<button class="pf-link" id="pfActLink">View All</button>');
  return `<aside class="pf-right">${sum}${sched}${act}</aside>`;
}
function pfBottomRight(d){
  if (d.kind === 'staff') {
    const tone = { 'Annual Leave': ['blue', 'calendar'], 'Sick Leave': ['green', 'heart'], 'Compassionate': ['orange', 'sun'] };
    return pfCard('Leave Balance', `<ul class="pf-list pf-leave">${d.leave.map(l => { const [c, i] = tone[l.type] || ['blue', 'calendar']; return `<li><span class="ai pf-ico ${c}">${pfIcon(i)}</span><span class="n">${esc(l.type)}</span><span class="d">${l.remaining} Days</span></li>`; }).join('')}</ul>`,
      '<button class="pf-link" id="pfLeaveLink">View Leave History</button>' + (can('leave.request') ? ' &nbsp;·&nbsp; <button class="pf-link" id="pfApplyLeave">Apply for Leave</button>' : ''));
  }
  return pfCard('Fee Balance', d.fees.length
    ? `<ul class="pf-list pf-leave">${d.fees.map(f => `<li><span class="ai pf-ico orange">${pfIcon('coin')}</span><span class="n">${esc(f.name)}</span><span class="d">${esc(money(f.balance))}</span></li>`).join('')}</ul>`
    : '<div class="pf-empty">No fee information yet.</div>');
}

function pfDraw(el){
  const d = PF.data;
  const tabBodies = { overview: pfTabOverview, professional: pfTabProfessional, teaching: pfTabTeaching, documents: pfTabDocuments, leave: pfTabLeave, activity: pfTabActivity };
  const main = (tabBodies[PF.tab] || pfTabOverview)(d);
  const unlinked = d.linked ? '' : `<div class="pf-note">Your login isn't connected to a ${d.kind === 'staff' ? 'staff' : d.kind} record at the school yet, so some details below are blank. ${d.kind === 'staff' ? 'Ask an administrator to link it under Administration → Users.' : 'Open your portal home page to connect it, or ask the school office.'}</div>`;
  el.innerHTML = `<div class="pf">
    <h1 class="pf-title">My Profile</h1>
    <div class="pf-crumbs"><a id="pfHome">Home</a><span>›</span><a id="pfCrumbSelf">My Profile</a><span>›</span><span class="cur">${esc(pfRoleKind(d))} Profile</span></div>
    ${unlinked}
    <div class="pf-grid">
      ${pfSide(d)}
      <div class="pf-main">
        <div class="pf-card pf-tabcard"><div class="pf-tabs" role="tablist">${d.tabs.map(t => `<button class="pf-tab ${t.id === PF.tab ? 'on' : ''}" data-tab="${t.id}" role="tab">${esc(t.label)}</button>`).join('')}</div></div>
        ${main}
      </div>
      ${pfRight(d)}
      ${d.classes ? `<div class="pf-classes">${pfCard(d.classes.title, pfTable(d.classes), d.kind === 'staff' ? `<button class="pf-link" id="pfAllClasses">View All Classes</button>` : '')}</div>` : ''}
      <div class="pf-bottom-right">${pfBottomRight(d)}</div>
    </div>
  </div>`;
  pfWire(el);
}

/* ---------------- interactions ---------------- */
function pfSetTab(id){ PF.tab = id; pfDraw($('view')); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function pfWire(el){
  const on = (id, fn) => { const n = $(id); if (n) n.onclick = fn; };
  const d = PF.data;
  el.querySelectorAll('.pf-tab').forEach(b => b.onclick = () => { PF.tab = b.dataset.tab; pfDraw(el); });
  on('pfHome', () => goTo(isPortalUser() ? 'portal' : 'dashboard'));
  on('pfCrumbSelf', () => { PF.tab = 'overview'; pfDraw(el); });
  on('pfActLink', () => pfSetTab('activity'));
  on('pfLeaveLink', () => pfSetTab('leave'));
  on('pfApplyLeave', () => goTo('applyleave'));
  on('pfSchedLink', () => { if (d.kind === 'staff' && can('timetable.view')) goTo('timetable'); else pfSetTab('teaching'); });
  on('pfAllClasses', () => pfSetTab('teaching'));
  on('pfQTt', () => { if (d.kind === 'staff' && can('timetable.view')) goTo('timetable'); else pfSetTab('teaching'); });
  on('pfEditPersonal', () => pfOpenEdit('Edit Personal Information', d.personal, false));
  on('pfEditProf', () => pfOpenEdit('Edit ' + (d.kind === 'student' ? 'Academic' : 'Professional') + ' Information', d.professional, false));
  on('pfEditBio', () => pfOpenEdit('Edit Bio', [], true));
  on('pfQEdit', () => pfOpenEdit('Edit Profile', d.personal.concat(d.professional), true));
  on('pfQPass', () => goTo('account'));
  on('pfQNotif', pfNotificationSettings);
  on('pfQId', pfIdCard);
  el.querySelectorAll('[data-detail]').forEach(b => b.onclick = () => {
    const det = d.classes.rows[Number(b.dataset.detail)].detail;
    showInfoModal(det.title, det.lines.length ? `<p class="muted" style="margin-top:0">${det.lines.length} student${det.lines.length === 1 ? '' : 's'}</p><ol style="margin:0;padding-left:22px;line-height:1.9">${det.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ol>` : '<div class="empty">No active students in this class yet.</div>');
  });
  // photo
  on('pfCam', () => $('pfFile').click());
  const file = $('pfFile');
  if (file) file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    let photo;
    try { photo = await resizeImageFile(f, 240, 0.75); } catch (err) { toast(err.message || 'Could not process that image.'); return; }
    const r = await apiPost('profile_photo', { photo });
    if (r.ok) { toast('Profile photo updated.'); pfReload(); } else toast(r.error || 'Could not save your photo.');
  };
}

function pfField(r){
  const id = 'pf_' + r.key, val = r.value || '';
  let input;
  if (r.type === 'select') {
    const opts = (r.options || []).slice(); if (val && !opts.includes(val)) opts.unshift(val);
    input = `<select id="${id}"><option value="">—</option>${optionsHtml(opts, val)}</select>`;
  } else {
    input = `<input id="${id}" type="${r.type === 'date' ? 'date' : r.type === 'tel' ? 'tel' : 'text'}" value="${esc(val)}">`;
  }
  return `<div><label for="${id}">${esc(r.label)}</label>${input}</div>`;
}
function pfOpenEdit(title, rows, withBio){
  const d = PF.data;
  const editable = rows.filter(r => r.editable);
  const readOnly = rows.filter(r => !r.editable && r.value);
  const body = `<div class="pf-form">
      ${editable.map(pfField).join('')}
      ${withBio ? `<div class="full"><label for="pf_bio">Bio / About me</label><textarea id="pf_bio" rows="4" maxlength="1000">${esc(d.bio)}</textarea></div>` : ''}
    </div>
    ${readOnly.length ? `<p class="muted" style="font-size:12.5px;margin:16px 0 0">${readOnly.map(r => esc(r.label)).join(', ')} come from the school's records. To change them, please ask the school office or an administrator.</p>` : ''}
    ${!editable.length && !withBio ? '<div class="empty">Nothing here can be edited by you.</div>' : ''}`;
  openModal(title, body, async () => {
    const payload = {};
    editable.forEach(r => { payload[r.key] = $('pf_' + r.key).value.trim(); });
    if (withBio) payload.bio = $('pf_bio').value.trim();
    if (!Object.keys(payload).length) return true;
    const res = await apiPost('profile_update', payload);
    if (!res.ok) { toast(res.error || 'Could not save your changes.'); return false; }
    toast(res.changed ? 'Profile updated.' : 'No changes to save.');
    pfReload();
    return true;
  }, { wide: true });
}

function pfNotificationSettings(){
  const st = loadNotifState();
  openModal('Notification Settings', `<label style="display:flex;gap:10px;align-items:center;margin:0;font-size:14px;font-weight:600;color:var(--ink)"><input type="checkbox" id="pfMute" style="width:auto" ${st.muted ? 'checked' : ''}> Mute notification alerts on this device</label>
    <p class="muted" style="font-size:12.5px;margin:12px 0 0">While muted, the bell stops showing new alerts. Nothing is deleted — switch it back on any time.</p>`,
    async () => { const s = loadNotifState(); s.muted = $('pfMute').checked; saveNotifState(s); updateApprovalBadge(); toast(s.muted ? 'Notifications muted.' : 'Notifications on.'); return true; });
}

function pfIdCard(){
  const d = PF.data, h = d.header;
  const rows = [h.idValue ? [h.idLabel, h.idValue] : null, h.subtitle ? [d.kind === 'student' ? 'Class' : 'Department', h.subtitle] : null, h.phone ? ['Phone', h.phone] : null].filter(Boolean);
  printHtml('ID Card — ' + h.name, `<div style="width:340px;margin:30px auto;border:2px solid #175537;border-radius:14px;overflow:hidden;font-family:Arial,sans-serif">
    <div style="background:#175537;color:#fff;padding:12px 16px;text-align:center"><b style="font-size:15px">${esc(schoolName())}</b><div style="font-size:11px;opacity:.85">${esc(pfRoleKind(d))} ID Card</div></div>
    <div style="padding:18px;text-align:center">
      ${h.photo ? `<img src="${esc(h.photo)}" style="width:110px;height:110px;border-radius:50%;object-fit:cover">` : `<div style="width:110px;height:110px;border-radius:50%;background:#dcefe3;color:#175537;font-size:36px;font-weight:700;line-height:110px;margin:0 auto">${esc(initials(h.name))}</div>`}
      <h2 style="margin:12px 0 2px;font-size:19px">${esc(h.name)}</h2><div style="color:#555;font-size:13px">${esc(h.badge || '')}</div>
      <table style="margin-top:12px;font-size:12.5px;width:100%">${rows.map(r => `<tr><td style="border:0;color:#666;text-align:left">${esc(r[0])}</td><td style="border:0;text-align:right;font-weight:700">${esc(r[1])}</td></tr>`).join('')}</table>
    </div></div>`, false);
}

// The name in the top bar opens this page.
(function linkTopbarName(){
  const box = $('tbName') && $('tbName').closest('.tb-user-info');
  if (!box) return;
  box.style.cursor = 'pointer'; box.title = 'Open my profile';
  box.onclick = () => { if (S.user) goTo('profile'); };
})();
