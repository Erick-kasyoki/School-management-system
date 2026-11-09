'use strict';
/* views/business-hours.js — the "Business Hours & Calendar Targets" section of School Settings,
   plus the pure helpers that turn those settings into working-time maths.
   Called from renderSettings() (settings-approvals.js); loaded after core.js.

   Stored in DB.settings.businessHours = { tz, start, end, warnPct, targetHours, days:[1..7], holidays:['YYYY-MM-DD'] }
   (days use ISO numbering: 1 = Mon … 7 = Sun). Nothing here needs a new table — settings is already
   a free-form map that persist('settings') saves.

   Defaults come from data the system already holds:
     • hours  → first and last row of the timetable's school day (TT_SCHEDULE, 08:00–17:00)
     • days   → the timetable's teaching days (TT_DAYS, Mon–Fri)
     • holidays → every Calendar & Events entry of type "Holiday" (kept in sync, never copied) */

const BH_DAY_LABELS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];
const BH_DAY_NAME_TO_ISO = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7 };

/* "8:20" / "1:40" in the timetable are 12-hour school times with no am/pm — anything before 7 is afternoon. */
function bhTtToHHMM(t){
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); if (!m) return null;
  let h = Number(m[1]); if (h < 7) h += 12;
  return String(h).padStart(2, '0') + ':' + m[2];
}
function bhDefaults(){
  let start = '08:00', end = '17:00', days = [1, 2, 3, 4, 5];
  if (typeof TT_SCHEDULE !== 'undefined' && TT_SCHEDULE.length) {
    start = bhTtToHHMM(TT_SCHEDULE[0].start) || start;
    end = bhTtToHHMM(TT_SCHEDULE[TT_SCHEDULE.length - 1].end) || end;
  }
  if (typeof TT_DAYS !== 'undefined' && TT_DAYS.length) days = TT_DAYS.map(d => BH_DAY_NAME_TO_ISO[d]).filter(Boolean);
  let tz = 'Africa/Nairobi';
  return { tz, start, end, warnPct: 75, targetHours: 24, days, holidays: [] };
}
function bhGet(){
  const d = bhDefaults(), s = (DB.settings && DB.settings.businessHours) || {};
  return Object.assign(d, s, { days: Array.isArray(s.days) ? s.days.slice() : d.days, holidays: Array.isArray(s.holidays) ? s.holidays.slice() : [] });
}

/* ---------- date helpers (all on plain 'YYYY-MM-DD' strings, so no timezone surprises) ---------- */
function bhValidDate(s){
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
function bhAddDays(s, n){ const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function bhIsoDow(s){ const w = new Date(s + 'T00:00:00Z').getUTCDay(); return w === 0 ? 7 : w; }
function bhToMin(hhmm){ const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; }

/* Holidays from Calendar & Events (type "Holiday", optional endDate range), capped so a typo can't explode. */
function bhEventHolidays(){
  const out = new Set();
  (DB.events || []).forEach(e => {
    if (!e || e.type !== 'Holiday' || !bhValidDate(e.date)) return;
    let d = e.date; const last = bhValidDate(e.endDate) && e.endDate >= e.date ? e.endDate : e.date;
    for (let i = 0; i < 366 && d <= last; i++) { out.add(d); d = bhAddDays(d, 1); }
  });
  return Array.from(out).sort();
}
function bhAllHolidays(cfg){ return new Set((cfg || bhGet()).holidays.concat(bhEventHolidays())); }

/* ---------- timezone helpers ---------- */
function bhZoneList(){
  let all = [];
  try { all = Intl.supportedValuesOf('timeZone'); } catch (e) { /* older browsers */ }
  const common = ['Africa/Nairobi', 'Africa/Kampala', 'Africa/Dar_es_Salaam', 'Africa/Kigali', 'Africa/Addis_Ababa', 'Africa/Lagos', 'Africa/Johannesburg', 'Africa/Cairo', 'Europe/London', 'UTC'];
  return Array.from(new Set(common.concat(all)));
}
function bhZoneLabel(tz){
  try {
    const f = (o) => new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: tz }, o)).formatToParts(new Date()).find(p => p.type === 'timeZoneName').value;
    const abbr = f({ timeZoneName: 'short' }), off = f({ timeZoneName: 'longOffset' });
    const utc = off === 'GMT' ? 'UTC+00:00' : off.replace('GMT', 'UTC');
    return tz + ' (' + (/^[A-Z]{2,5}$/.test(abbr) ? abbr + ', ' : '') + utc + ')';
  } catch (e) { return tz; }
}
/* An instant → the wall clock in the school's timezone: { date:'YYYY-MM-DD', min: minutes since midnight }. */
function bhWall(ms, tz){
  const p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return { date: p.year + '-' + p.month + '-' + p.day, min: Number(p.hour) * 60 + Number(p.minute) };
}

/* Working minutes between two instants (ms or Date or ISO string) under the saved settings —
   only inside the daily window, only on working days, never on a holiday. */
function businessMinutesBetween(from, to, cfg){
  cfg = cfg || bhGet();
  const a = new Date(from).getTime(), b = new Date(to).getTime();
  if (isNaN(a) || isNaN(b) || b <= a) return 0;
  const s = bhToMin(cfg.start), e = bhToMin(cfg.end); if (!(e > s)) return 0;
  const hol = bhAllHolidays(cfg), A = bhWall(a, cfg.tz), B = bhWall(b, cfg.tz);
  let total = 0, d = A.date;
  for (let i = 0; i < 800 && d <= B.date; i++, d = bhAddDays(d, 1)) {
    if (!cfg.days.includes(bhIsoDow(d)) || hol.has(d)) continue;
    const from_ = d === A.date ? Math.max(s, A.min) : s, to_ = d === B.date ? Math.min(e, B.min) : e;
    if (to_ > from_) total += to_ - from_;
  }
  return total;
}
/* 'ok' | 'warn' | 'breach' for something that has been open `mins` working minutes. */
function bhSlaState(mins, cfg){
  cfg = cfg || bhGet();
  const target = Number(cfg.targetHours) * 60; if (!(target > 0)) return 'ok';
  const pct = mins / target * 100;
  return pct >= 100 ? 'breach' : pct >= Number(cfg.warnPct) ? 'warn' : 'ok';
}
function bhFmtMins(m){ const h = Math.floor(m / 60), r = Math.round(m % 60); return h ? h + 'h' + (r ? ' ' + r + 'm' : '') : r + 'm'; }

/* ---------- the Settings card ---------- */
function renderBusinessHours(el, manage){
  const wrap = document.createElement('section');
  wrap.className = 'card panel theme-card bh-card';
  wrap.id = 'bhCard';
  const dis = manage ? '' : 'disabled';
  const cfg0 = bhGet();
  const zones = bhZoneList(); if (!zones.includes(cfg0.tz)) zones.unshift(cfg0.tz);
  const evHol = bhEventHolidays();
  wrap.innerHTML = `
    <div class="theme-head"><div>
      <h3>Business hours &amp; calendar targets</h3>
      <p class="theme-sub">Calculate response and approval turnaround only during operating shifts and working days. Defaults follow your timetable's school day and the holidays on your Calendar &amp; Events.</p>
    </div></div>
    ${manage ? '' : `<div class="theme-locked">You can view these settings, but changing them needs the <b>Manage system settings</b> permission.</div>`}
    <div class="bh-grid">
      <div class="bh-f bh-wide"><label for="bhTz">Timezone</label>
        <select id="bhTz" ${dis}>${zones.map(z => `<option value="${esc(z)}" ${z === cfg0.tz ? 'selected' : ''}>${esc(bhZoneLabel(z))}</option>`).join('')}</select></div>
      <div class="bh-f"><label for="bhStart">Daily start time</label><input type="time" id="bhStart" ${dis} value="${esc(cfg0.start)}"></div>
      <div class="bh-f"><label for="bhEnd">Daily end time</label><input type="time" id="bhEnd" ${dis} value="${esc(cfg0.end)}"></div>
      <div class="bh-f"><label for="bhTarget">Response target (hours)</label><input type="number" id="bhTarget" min="1" max="720" step="1" ${dis} value="${esc(cfg0.targetHours)}"></div>
      <div class="bh-f"><label for="bhWarn">Breach warning (%)</label><input type="number" id="bhWarn" min="1" max="100" step="1" ${dis} value="${esc(cfg0.warnPct)}"></div>
    </div>
    <label>Working days</label>
    <div class="bh-days" id="bhDays" role="group" aria-label="Working days">
      ${BH_DAY_LABELS.map(([n, l]) => `<button type="button" class="bh-day ${cfg0.days.includes(n) ? 'on' : ''}" data-d="${n}" aria-pressed="${cfg0.days.includes(n)}" ${dis}>${l}</button>`).join('')}
    </div>
    <label for="bhHol" style="margin-top:14px">Holidays / exempt dates <span class="bh-hint">(comma-separated YYYY-MM-DD)</span></label>
    <input id="bhHol" ${dis} placeholder="2026-10-20, 2026-12-25" value="${esc(cfg0.holidays.join(', '))}">
    <p class="theme-note" id="bhNote"></p>
    <p class="bh-ev">${evHol.length ? `<b>${evHol.length}</b> more holiday date${evHol.length === 1 ? '' : 's'} come automatically from Calendar &amp; Events (type “Holiday”): ${esc(evHol.slice(0, 6).join(', '))}${evHol.length > 6 ? '…' : ''}` : 'Add events of type “Holiday” in Calendar &amp; Events and they are exempted automatically.'}</p>
    <div class="bh-foot"><span class="bh-sum" id="bhSum"></span>
      ${manage ? `<button class="btn primary" id="bhSave">Save calendar targets</button>` : ''}</div>`;
  el.appendChild(wrap);

  const q = id => wrap.querySelector('#' + id);
  const read = () => ({
    tz: q('bhTz').value, start: q('bhStart').value, end: q('bhEnd').value,
    warnPct: Number(q('bhWarn').value), targetHours: Number(q('bhTarget').value),
    days: Array.from(wrap.querySelectorAll('.bh-day.on')).map(b => Number(b.dataset.d)),
    holidays: q('bhHol').value.split(/[,\s;]+/).map(x => x.trim()).filter(Boolean),
  });
  const problems = (c) => {
    const bad = c.holidays.filter(h => !bhValidDate(h));
    if (!(bhToMin(c.start) >= 0) || !(bhToMin(c.end) >= 0)) return 'Set both a start and an end time.';
    if (bhToMin(c.end) <= bhToMin(c.start)) return 'The end time must be later than the start time.';
    if (!(c.warnPct >= 1 && c.warnPct <= 100)) return 'Breach warning must be between 1 and 100.';
    if (!(c.targetHours >= 1)) return 'Response target must be at least 1 hour.';
    if (!c.days.length) return 'Choose at least one working day.';
    if (bad.length) return 'Not a valid date: ' + bad.slice(0, 3).join(', ') + (bad.length > 3 ? '…' : '') + ' — use YYYY-MM-DD.';
    return '';
  };
  function refresh(){
    const c = read(), err = problems(c), note = q('bhNote');
    note.textContent = err; note.className = 'theme-note' + (err ? ' warn' : '');
    const hrs = (bhToMin(c.end) - bhToMin(c.start)) / 60;
    q('bhSum').textContent = err ? '' : `${hrs % 1 ? hrs.toFixed(1) : hrs} working hours a day · ${c.days.length} day${c.days.length === 1 ? '' : 's'} a week · warns at ${Math.round(c.targetHours * c.warnPct / 100 * 10) / 10}h of a ${c.targetHours}h target`;
    if (manage) q('bhSave').disabled = !!err;
  }
  wrap.addEventListener('input', refresh);
  if (manage) {
    q('bhDays').onclick = (e) => { const b = e.target.closest('.bh-day'); if (!b) return; b.classList.toggle('on'); b.setAttribute('aria-pressed', b.classList.contains('on')); refresh(); };
    q('bhSave').onclick = async () => {
      const c = read(); if (problems(c)) return;
      c.holidays = Array.from(new Set(c.holidays)).sort();
      const btn = q('bhSave'); btn.disabled = true;
      DB.settings.businessHours = c;
      const ok = await persist('settings');
      if (ok) { toast('Calendar targets saved.'); q('bhHol').value = c.holidays.join(', '); if (typeof renderView === 'function' && currentViewId === 'approvals') renderView(); }
      refresh();
    };
  }
  refresh();
}
