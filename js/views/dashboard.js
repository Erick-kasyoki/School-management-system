'use strict';
/* views/dashboard.js — the staff/admin landing dashboard (card layout).
   Part of the EraMaster frontend — loaded after core.js. Styles: css/dashboard.css.
   Top strip (search · Email status · bell · Academic Year · Term) lives in statusbar.js.
   Email is the only messaging channel shown — there is no SMS / WhatsApp here. */

/* styles are injected from here so no other file (index.html) needs editing */
(function(){ if (document.getElementById('dhStyles')) return; const st = document.createElement('style'); st.id = 'dhStyles'; st.textContent = "/* css/dashboard.css \u2014 staff dashboard card layout */\n.dh-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin:0 0 16px;flex-wrap:wrap}\n.dh-head h2{margin:0;font-size:26px;font-weight:800;color:var(--g-900)}\n.dh-head p{margin:4px 0 0;font-size:13.5px;color:var(--muted)}.dh-head p b{color:var(--blue);font-weight:600}\n.dh-qa{position:relative}\n.dh-qa-btn{display:flex;align-items:center;gap:9px;background:#1b5fe0;color:#fff;border:0;border-radius:9px;padding:11px 18px;font-size:14px;font-weight:600;box-shadow:0 8px 18px -10px #1b5fe0}\n.dh-qa-btn svg{width:16px;height:16px}.dh-qa-btn:hover{filter:brightness(.94)}\n.dh-qa-menu{display:none;position:absolute;right:0;top:48px;min-width:210px;background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:0 18px 40px -12px rgba(0,0,0,.28);padding:6px;z-index:30}\n.dh-qa-menu.show{display:block}\n.dh-qa-menu button{display:flex;align-items:center;gap:10px;width:100%;border:0;background:none;padding:8px 10px;border-radius:8px;font-size:13.5px;color:var(--ink);text-align:left}\n.dh-qa-menu button:hover{background:var(--g-50)}\n.dh-qa-menu .dh-ic{width:28px;height:28px;border-radius:8px}.dh-qa-menu .dh-ic svg{width:15px;height:15px}\n\n.dh-ic{width:46px;height:46px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;flex:none}\n.dh-ic svg{width:22px;height:22px}\n.dh-stats{display:grid;grid-template-columns:repeat(6,1fr);gap:14px;margin-bottom:16px}\n.dh-stat{display:flex;align-items:center;gap:14px;padding:16px;border-radius:14px}\n.dh-stat small{display:block;font-size:12px;color:var(--muted);margin-bottom:2px}\n.dh-stat b{display:block;font-size:26px;font-weight:800;color:var(--g-900);line-height:1.15}\n.dh-stat span{display:block;font-size:11.5px;margin-top:3px}\n.dh-up{color:#178a4b}.dh-down{color:#d0334f}.dh-flat{color:var(--muted)}\n\n.dh-grid{display:grid;gap:14px;margin-bottom:14px}\n.dh-r1,.dh-r2{grid-template-columns:1.05fr 1.5fr 1fr 1.15fr}\n.dh-r3{grid-template-columns:2.55fr 1fr}\n.dh-card{padding:16px 18px;border-radius:14px;min-width:0;display:flex;flex-direction:column}\n.dh-ch{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}\n.dh-ch h3{margin:0;font-size:14.5px;font-weight:700;color:var(--g-900)}\n.dh-sel{width:auto;padding:5px 26px 5px 10px;font-size:11.5px;border-radius:7px;appearance:none;-webkit-appearance:none;cursor:pointer;\n  background:var(--card) url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23657268' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\") no-repeat right 7px center/12px}\n.dh-link{display:block;text-align:center;font-size:12.5px;font-weight:600;color:#1b5fe0;text-decoration:none;margin-top:auto;padding-top:12px}\n.dh-link:hover{text-decoration:underline}.dh-link.sm{display:inline;margin:0;padding:0}\nbody.dark .dh-link,body.dark .dh-head p b{color:#8db4ff}\n\n.dh-trio{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:14px}\n.dh-trio small,.dh-mini3 small,.dh-sched small{display:block;font-size:10.5px;color:var(--muted)}\n.dh-trio b{font-size:12px;white-space:nowrap;letter-spacing:-.2px}.dh-trio b.g,.dh-fin b.g{color:#178a4b}.dh-trio b.r,.dh-fin b.r{color:#d0334f}\n.dh-donut-row{display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-bottom:8px}\n.dh-donut{position:relative;flex:none}.dh-donut svg{width:100%;height:100%}\n.dh-donut-mid{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 24px}\n.dh-donut-mid b{font-size:19px;font-weight:800;color:var(--g-900)}.dh-donut-mid span{font-size:10.5px;color:var(--muted);line-height:1.2}\n.dh-legend{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px;flex:1;min-width:120px}\n.dh-legend li{display:flex;align-items:flex-start;gap:9px}.dh-legend i{width:9px;height:9px;border-radius:50%;margin-top:4px;flex:none}\n.dh-legend b{display:block;font-size:12px;font-weight:600}.dh-legend span{font-size:11.5px;color:var(--muted)}\n.dh-legend.tight .row{display:flex;justify-content:space-between;gap:10px;width:100%}.dh-legend.tight li>div{flex:1}\n.dh-legend.tight b{font-weight:600}.dh-legend.tight span{color:var(--ink)}\n\n.dh-chart{position:relative}.dh-area{width:100%;height:auto;display:block}\nline.dh-gl{stroke:var(--line);stroke-width:1}\n.dh-axis{font-size:10.5px;fill:var(--muted)}.dh-xline{stroke:#9db4ee;stroke-width:1;stroke-dasharray:3 3}\n.dh-tip{position:absolute;background:var(--card);border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 20px -8px rgba(0,0,0,.3);padding:7px 10px;font-size:11.5px;line-height:1.5;pointer-events:none;white-space:nowrap}\n.dh-tip-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#2a5adb;margin-right:5px}\n.dh-mini3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}\n.dh-mini3>div{border:1px solid var(--line);border-radius:9px;padding:9px 12px}.dh-mini3 b{font-size:19px;font-weight:800;color:var(--g-900)}\n\n.dh-fin{display:flex;flex-direction:column;gap:18px;margin:6px 0 8px}\n.dh-fin>div{display:flex;align-items:center;gap:12px}.dh-fin .dh-ic{width:42px;height:42px}\n.dh-fin small{display:block;font-size:11px;color:var(--muted)}.dh-fin b{font-size:19px;font-weight:800;color:var(--g-900)}\n\n.dh-act{display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--line)}\n.dh-act:last-child{border-bottom:0}.dh-act .dh-ic{width:34px;height:34px;border-radius:50%}.dh-act .dh-ic svg{width:16px;height:16px}\n.dh-act-b{flex:1;min-width:0}.dh-act-b b{display:block;font-size:12.5px;font-weight:600}\n.dh-act-b span{display:block;font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.dh-act em{font-style:normal;font-size:11px;color:var(--muted);white-space:nowrap;align-self:flex-start;margin-top:3px}\n\n.dh-tbl{width:100%;border-collapse:collapse;font-size:12.5px}\n.dh-tbl th{text-align:left;font-size:11px;font-weight:600;color:var(--muted);padding:7px 8px;border-bottom:1px solid var(--line)}\n.dh-tbl td{padding:9px 8px;border-bottom:1px solid var(--line);white-space:nowrap}.dh-tbl tr:last-child td{border-bottom:0}\n.dh-tbl th:last-child,.dh-tbl td:last-child{text-align:right}\n.dh-tbl.wide th:last-child,.dh-tbl.wide td:last-child{text-align:left}\n.dh-chip{display:inline-block;background:#dcf5e7;color:#178a4b;font-weight:700;font-size:11px;padding:3px 12px;border-radius:5px}\nbody.dark .dh-chip{background:rgba(26,158,75,.2);color:#6fe0a0}\n.dh-scroll{overflow-x:auto}\n\n.dh-sched>div{padding:8px 0;border-bottom:1px solid var(--line)}.dh-sched>div:last-child{border-bottom:0}\n.dh-sched .row{display:flex;justify-content:space-between;gap:10px;font-size:12px}.dh-sched .row b{font-weight:600}.dh-sched .row span{color:var(--muted);white-space:nowrap}\n\n.dh-sys>div{display:flex;align-items:center;gap:11px;padding:11px 0;font-size:12.5px}\n.dh-sys .ic{width:20px;color:var(--muted);flex:none}.dh-sys .ic svg{width:19px;height:19px}\n.dh-sys b{font-weight:500;flex:1}.dh-sys em{font-style:normal;font-size:11.5px;color:var(--muted)}.dh-sys em.g{color:#178a4b}\n.dh-sys i{width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-style:normal;font-size:11px;font-weight:800;color:#fff;flex:none}\n.dh-sys i svg{width:11px;height:11px;stroke-width:3}.dh-sys i.ok{background:#1a9e4b}.dh-sys i.warn{background:#f5a623}\n.dh-sys .bar{padding:0 0 6px 31px}.dh-sys .bar u{display:block;height:5px;border-radius:9px;background:#f5a623}\n.dh-sys .bar{position:relative}.dh-sys .bar:before{content:'';position:absolute;left:31px;right:0;top:0;height:5px;border-radius:9px;background:var(--line)}\n.dh-sys .bar u{position:relative;max-width:calc(100% - 31px)}\n\n.dh-short{display:grid;grid-template-columns:repeat(4,1fr);gap:16px 8px}\n.dh-short button{display:flex;flex-direction:column;align-items:center;gap:8px;border:0;background:none;font-size:11.5px;font-weight:600;color:var(--ink);padding:4px 0}\n.dh-short button .dh-ic{width:50px;height:50px;border-radius:50%}.dh-short button:hover .dh-ic{transform:translateY(-2px)}.dh-ic{transition:transform .15s}\n\n@media (max-width:1799px){.dh-r1,.dh-r2{grid-template-columns:1fr 1fr}.dh-r3{grid-template-columns:1fr}}\n@media (max-width:1499px){.dh-stats{grid-template-columns:repeat(3,1fr)}}\n@media (max-width:760px){.dh-stats,.dh-r1,.dh-r2{grid-template-columns:1fr}.dh-stats{grid-template-columns:1fr 1fr}.dh-stat b{font-size:22px}}\n\n.dh-top{display:flex;flex-wrap:wrap;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:6px 10px;margin:0 0 18px}\n.dh-top .sbar{flex:1 1 auto;border:0;margin:0;padding:0;justify-content:flex-end;background:none;box-shadow:none}\n.dh-search{position:relative;flex:1 1 280px;min-width:220px;max-width:440px;margin:6px 14px 6px 6px}\n.dh-search>svg{position:absolute;left:14px;top:50%;transform:translateY(-50%);width:16px;height:16px;color:var(--muted);pointer-events:none}\n.dh-search input{padding:11px 80px 11px 40px;border-radius:10px;font-size:13px;background:var(--bg)}\n.dh-search kbd{position:absolute;right:12px;top:50%;transform:translateY(-50%);font:600 11px inherit;font-family:inherit;color:var(--muted);pointer-events:none}\n.dh-results{display:none;position:absolute;left:0;right:0;top:46px;background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:0 18px 40px -12px rgba(0,0,0,.28);padding:6px;z-index:40}\n.dh-results.show{display:block}\n.dh-results button{display:block;width:100%;text-align:left;border:0;background:none;padding:8px 10px;border-radius:8px;color:var(--ink)}\n.dh-results button:hover{background:var(--g-50)}.dh-results b{display:block;font-size:13px}.dh-results span,.dh-none{font-size:11.5px;color:var(--muted)}.dh-none{padding:10px}\n"; document.head.appendChild(st); })();

/* ---------------- small helpers ---------------- */
const DH = { fee: 'term', enroll: 'year', fin: 'month', top: 'score', att: 'month', acts: null, sys: null };
const dhMoney = n => 'KSh ' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dhInt = n => Number(n || 0).toLocaleString();
const dhPct = (a, b, d = 1) => b ? (a / b * 100).toFixed(d) : '0.0';
const DH_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dhSel = (id, opts, val) => `<select class="dh-sel" id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
const dhIc = (p, c) => `<svg viewBox="0 0 24 24" fill="none" stroke="${c || 'currentColor'}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const DH_I = {
  students: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5h5M16 9h5M16 13h3"/>',
  teacher: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="18" cy="9" r="2.4"/><path d="M16.5 14.4c2.6.2 4.5 2.4 4.5 5.1"/>',
  parents: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 5V3.5M16 5V3.5M8 11h8M8 15h5"/>',
  classes: '<rect x="3" y="9" width="8" height="11" rx="1.5"/><rect x="13" y="9" width="8" height="11" rx="1.5"/><path d="M5 9V6a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v3M15 9V6a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v3"/>',
  subjects: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  staff: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17.5" cy="8.5" r="2.5"/><path d="M16 14.2c2.9.1 5 2.4 5 5.3"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.2c-.5-.9-1.5-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2.1 0 3 5.8 1.2 5.8 4.2 0 1.3-1.2 2.2-3 2.2-1.4 0-2.5-.6-3-1.6M12 6.5v1.3M12 16.2v1.3"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 5.5v16"/>',
  cal: '<rect x="3" y="4" width="18" height="17" rx="2.5"/><path d="M8 2v4M16 2v4M3 10h18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  db: '<ellipse cx="12" cy="5.5" rx="7.5" ry="3"/><path d="M4.5 5.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6M4.5 11.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/>',
  backup: '<path d="M12 3v11M7.5 9.5L12 14l4.5-4.5"/><path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15"/>',
  disk: '<rect x="3" y="14" width="18" height="6" rx="2"/><path d="M3 14l3-8h12l3 8M7 17h.01M11 17h.01"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 19c0-3 2.7-5.5 6-5.5s6 2.5 6 5.5"/><path d="M16 5.2a3 3 0 0 1 0 5.6M18 14c1.8.7 3 2.3 3 4.5"/>',
  msg: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/>',
  bag: '<rect x="4" y="8" width="16" height="12" rx="2.5"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 6 2.5 7 2.5 7h-17S6 14 6 8M10 19a2 2 0 0 0 4 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
};
const dhBadgeIc = (k, tint, col) => `<span class="dh-ic" style="background:${tint};color:${col}">${dhIc(DH_I[k])}</span>`;

function dhRange(kind){
  const t = currentTerm(), td = today();
  const yr = t ? (DB.years || []).find(y => String(yearOf(y)) === String(t.year || yearOf(t))) : null;
  if (kind === 'today') return [td, td];
  if (kind === 'month') { const d = new Date(); return [fmtDate(new Date(d.getFullYear(), d.getMonth(), 1)), fmtDate(new Date(d.getFullYear(), d.getMonth() + 1, 0))]; }
  if (kind === 'term') return t && t.start ? [ymd(t.start), ymd(t.end) || '9999-12-31'] : ['0000-01-01', '9999-12-31'];
  if (kind === 'year') return yr && yr.start ? [ymd(yr.start), ymd(yr.end) || '9999-12-31'] : ['0000-01-01', '9999-12-31'];
  return ['0000-01-01', '9999-12-31'];
}
const dhClass = s => s.grade ? s.grade + (s.stream ? ' ' + s.stream : '') : '—';
const dhIsTeacher = t => /teach|lectur|head of dep/i.test(String(t.jobTitle || '')) || !!t.assignedClass;

/* ---------------- donut + area chart (inline SVG, no libraries) ---------------- */
function dhDonut(segs, center, sub, size, stroke){
  size = size || 116; stroke = stroke || 20;
  const r = (size - stroke) / 2, C = 2 * Math.PI * r, total = segs.reduce((a, s) => a + s.v, 0);
  let off = 0;
  const arcs = total ? segs.filter(s => s.v > 0).map(s => { const len = s.v / total * C; const a = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${s.c}" stroke-width="${stroke}" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`; off += len; return a; }).join('')
    : `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${stroke}"/>`;
  return `<div class="dh-donut" style="width:${size}px;height:${size}px"><svg viewBox="0 0 ${size} ${size}">${arcs}</svg><div class="dh-donut-mid"><b>${center}</b><span>${sub}</span></div></div>`;
}
function dhNiceStep(max){ const raw = max / 4 || 1, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
function dhAreaChart(host, pts){
  const W = 560, H = 210, L = 42, R = 12, T = 12, B = 26;
  const maxV = Math.max(1, ...pts.map(p => p.v)), step = dhNiceStep(maxV), top = Math.ceil(maxV / step) * step;
  const live = pts.filter(p => p.v != null);
  const x = i => L + (pts.length < 2 ? 0 : i * (W - L - R) / (pts.length - 1)), y = v => T + (H - T - B) * (1 - v / top);
  let grid = '';
  for (let v = 0; v <= top + 1e-9; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="dh-gl"/><text x="${L - 8}" y="${y(v) + 3.5}" text-anchor="end" class="dh-axis">${v >= 1000 ? (v / 1000) + 'K' : v}</text>`;
  const line = live.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = live.length ? `${line} L${x(live.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z` : '';
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="dh-area">
    <defs><linearGradient id="dhAg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a5adb" stop-opacity=".22"/><stop offset="1" stop-color="#2a5adb" stop-opacity=".02"/></linearGradient></defs>
    ${grid}${pts.map((p, i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="dh-axis">${p.l}</text>`).join('')}
    ${area ? `<path d="${area}" fill="url(#dhAg)"/><path d="${line}" fill="none" stroke="#2a5adb" stroke-width="2"/>` : ''}
    ${live.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="3" fill="#fff" stroke="#2a5adb" stroke-width="2"/>`).join('')}
    <line id="dhXl" y1="${T}" y2="${H - B}" class="dh-xline" style="display:none"/></svg><div class="dh-tip" id="dhTip" style="display:none"></div>`;
  const svg = host.querySelector('svg'), tip = host.querySelector('#dhTip'), xl = host.querySelector('#dhXl');
  svg.onmousemove = (e) => {
    const rect = svg.getBoundingClientRect(), px = (e.clientX - rect.left) / rect.width * W;
    let best = 0; live.forEach((p, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
    if (!live.length) return;
    const p = live[best], cx = x(best) / W * rect.width;
    xl.setAttribute('x1', x(best)); xl.setAttribute('x2', x(best)); xl.style.display = '';
    tip.style.display = 'block'; tip.innerHTML = `${esc(p.full)}<br><span class="dh-tip-dot"></span>Students: <b>${dhInt(p.v)}</b>`;
    tip.style.left = Math.min(Math.max(cx - 52, 0), rect.width - 118) + 'px'; tip.style.top = (y(p.v) / H * rect.height + 12) + 'px';
  };
  svg.onmouseleave = () => { tip.style.display = 'none'; xl.style.display = 'none'; };
}

/* ---------------- main render ---------------- */
function renderDashboard(el){
  const term = currentTerm();
  const me = (S.user && (S.user.name || S.user.full_name)) || 'there';
  el.innerHTML = `
    <div class="dh-top"><div class="dh-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input type="search" id="dhSearch" autocomplete="off" placeholder="Search students, parents, staff, payments, receipts..."><kbd>Ctrl + K</kbd><div class="dh-results" id="dhResults"></div></div>
      <div id="sbHost"></div></div>
    <div class="dh-head">
      <div><h2>Dashboard</h2><p>Welcome back, <b>${esc(me)}</b>! Here's what's happening today.</p></div>
      <div class="dh-qa" id="dhQA"><button type="button" class="dh-qa-btn" id="dhQABtn">${dhIc(DH_I.plus)}<span>Quick Action</span>${dhIc(DH_I.chev)}</button><div class="dh-qa-menu" id="dhQAMenu"></div></div>
    </div>
    <div class="dh-stats" id="dhStats"></div>
    <div class="dh-grid dh-r1">
      <div class="card dh-card" id="dhFee"></div>
      <div class="card dh-card" id="dhEnroll"></div>
      <div class="card dh-card" id="dhFin"></div>
      <div class="card dh-card" id="dhActs"></div>
    </div>
    <div class="dh-grid dh-r2">
      <div class="card dh-card" id="dhTop"></div>
      <div class="card dh-card" id="dhAtt"></div>
      <div class="card dh-card" id="dhSched"></div>
      <div class="card dh-card" id="dhSys"></div>
    </div>
    <div class="dh-grid dh-r3">
      <div class="card dh-card" id="dhPay"></div>
      <div class="card dh-card" id="dhShort"></div>
    </div>
    ${can('approvals.view') ? `<div class="card panel" style="margin-bottom:14px"><h3>Pending Approvals</h3><div id="dashPending"></div></div>
    <div class="card panel" style="margin-bottom:14px"><h3>Recent Approvals</h3><div id="dashRecent"></div></div>` : ''}`;
  mountStatusBar($('sbHost'));
  dhStats(term); dhFee(); dhEnroll(); dhFin(); dhActs(); dhTop(); dhAtt(); dhSched(); dhSys(); dhPay(); dhShort(); dhQuick(); dhApprovals(); dhSearchInit();
}

/* ---- stat cards ---- */
function dhStats(term){
  const students = DB.students || [], teachers = DB.teachers || [], parents = DB.parents || [], classes = DB.classes || [], subjects = DB.subjects || [];
  const start = term && term.start ? ymd(term.start) : '';
  const before = start ? students.filter(s => !s.admissionDate || ymd(s.admissionDate) < start).length : 0;
  const growth = before ? (students.length - before) / before * 100 : null;
  const sub = (g, fallback) => g == null ? `<span class="dh-flat">${fallback}</span>` : `<span class="${g >= 0 ? 'dh-up' : 'dh-down'}">${g >= 0 ? '↗' : '↘'} ${Math.abs(g).toFixed(1)}% vs Last Term</span>`;
  const items = [
    ['students', 'Total Students', students.length, sub(growth, `${students.filter(s => s.status === 'Active').length} Active`), '#e6edff', '#2a5adb'],
    ['teacher', 'Total Teachers', teachers.filter(dhIsTeacher).length, `<span class="dh-flat">${teachers.filter(t => dhIsTeacher(t) && t.status === 'Active').length} Active</span>`, '#dcf5e7', '#178a4b'],
    ['parents', 'Total Parents', parents.length, `<span class="dh-flat">${students.filter(s => s.parentId).length} linked learners</span>`, '#ffe9d6', '#e2761b'],
    ['classes', 'Total Classes', classes.length, `<span class="dh-flat">All Active</span>`, '#efe4ff', '#7a45d6'],
    ['subjects', 'Total Subjects', subjects.length, `<span class="dh-flat">${subjects.filter(s => (s.status || 'Active') === 'Active').length} Active</span>`, '#ffe3e8', '#d0334f'],
    ['staff', 'Total Staff', teachers.length, `<span class="dh-flat">${new Set(teachers.map(t => t.jobTitle).filter(Boolean)).size} Roles</span>`, '#e6edff', '#2a5adb'],
  ];
  $('dhStats').innerHTML = items.map(([ic, l, v, s, tint, col]) => `<div class="card dh-stat">${dhBadgeIc(ic, tint, col)}<div><small>${l}</small><b>${dhInt(v)}</b>${s}</div></div>`).join('');
}

/* ---- fee collection overview ---- */
function dhFee(){
  const t = currentTerm(), tname = t && t.name;
  let collected;
  if (DH.fee === 'year') { const [a, b] = dhRange('year'); collected = sum((DB.payments || []).filter(p => inRange(p.date, a, b)), p => p.amount); }
  else collected = feeCollected(tname);
  const out = feeOutstanding(), total = collected + out, pc = total ? collected / total * 100 : 0;
  $('dhFee').innerHTML = `
    <div class="dh-ch"><h3>Fee Collection Overview</h3>${dhSel('dhFeeSel', [['term', 'This Term'], ['year', 'This Year']], DH.fee)}</div>
    <div class="dh-trio"><div><small>Total Fees</small><b>${dhMoney(total)}</b></div><div><small>Collected</small><b class="g">${dhMoney(collected)}</b></div><div><small>Outstanding</small><b class="r">${dhMoney(out)}</b></div></div>
    <div class="dh-donut-row">${dhDonut([{ v: collected, c: '#1a9e4b' }, { v: out, c: '#e0243b' }], pc.toFixed(1) + '%', 'Collected', 120, 22)}
      <ul class="dh-legend"><li><i style="background:#1a9e4b"></i><div><b>Collected (${pc.toFixed(1)}%)</b><span>${dhMoney(collected)}</span></div></li>
      <li><i style="background:#e0243b"></i><div><b>Outstanding (${(total ? 100 - pc : 0).toFixed(1)}%)</b><span>${dhMoney(out)}</span></div></li></ul></div>
    <a href="#" class="dh-link" data-go="fees">View Full Report</a>`;
  $('dhFeeSel').onchange = e => { DH.fee = e.target.value; dhFee(); };
  dhLinks($('dhFee'));
}

/* ---- enrollment trend ---- */
function dhEnroll(){
  const [a, b] = dhRange('year'), students = DB.students || [];
  const sd = a > '0001' ? new Date(a + 'T00:00:00') : new Date(new Date().getFullYear(), 0, 1);
  const ed = b < '9999' ? new Date(b + 'T00:00:00') : new Date(sd.getFullYear(), 11, 31);
  const pts = [], now = new Date();
  for (let d = new Date(sd.getFullYear(), sd.getMonth(), 1), n = 0; d <= ed && n < 12; d = new Date(d.getFullYear(), d.getMonth() + 1, 1), n++) {
    const end = fmtDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    const future = d > now;
    pts.push({ l: DH_MON[d.getMonth()], full: DH_MON[d.getMonth()] + ' ' + d.getFullYear(), v: future ? null : students.filter(s => !s.admissionDate || ymd(s.admissionDate) <= end).length });
  }
  const newAdm = students.filter(s => s.admissionDate && inRange(s.admissionDate, a, b)).length;
  const tin = students.filter(s => s.previousSchool && String(s.previousSchool).trim()).length;
  const tout = students.filter(s => /transfer|withdr/i.test(String(s.status || ''))).length;
  $('dhEnroll').innerHTML = `
    <div class="dh-ch"><h3>Student Enrollment Trend</h3>${dhSel('dhEnSel', [['year', 'This Academic Year']], DH.enroll)}</div>
    <div class="dh-chart" id="dhChart"></div>
    <div class="dh-mini3"><div><small>New Admissions</small><b>${dhInt(newAdm)}</b></div><div><small>Transferred In</small><b>${dhInt(tin)}</b></div><div><small>Transferred Out</small><b>${dhInt(tout)}</b></div></div>
    <a href="#" class="dh-link" data-go="applications">View Admissions</a>`;
  dhAreaChart($('dhChart'), pts); dhLinks($('dhEnroll'));
}

/* ---- finance summary ---- */
function dhFin(){
  const [a, b] = dhRange(DH.fin), tx = (DB.transactions || []).filter(t => inRange(t.date, a, b));
  const inc = sum(tx.filter(t => t.type === 'Income'), t => t.amount), exp = sum(tx.filter(t => t.type === 'Expense'), t => t.amount);
  $('dhFin').innerHTML = `
    <div class="dh-ch"><h3>Finance Summary</h3>${dhSel('dhFinSel', [['month', 'This Month'], ['term', 'This Term'], ['year', 'This Year']], DH.fin)}</div>
    <div class="dh-fin">
      <div>${dhBadgeIc('doc', '#dcf5e7', '#178a4b')}<span><small>Total Income</small><b class="g">${dhMoney(inc)}</b></span></div>
      <div>${dhBadgeIc('bag', '#ffe3e8', '#d0334f')}<span><small>Total Expenses</small><b class="r">${dhMoney(exp)}</b></span></div>
      <div>${dhBadgeIc('coin', '#efe4ff', '#7a45d6')}<span><small>Net Profit</small><b class="${inc - exp < 0 ? 'r' : ''}">${dhMoney(inc - exp)}</b></span></div>
    </div>
    <a href="#" class="dh-link" data-go="transactions">View Finance Dashboard</a>`;
  $('dhFinSel').onchange = e => { DH.fin = e.target.value; dhFin(); };
  dhLinks($('dhFin'));
}

/* ---- recent activities (real audit log when allowed, otherwise derived from the records) ---- */
function dhAgo(d){
  const s = String(d || ''), day = ymd(s), tm = s.length > 11 ? new Date(s.replace(' ', 'T')) : null;
  const t = tm && !isNaN(tm) ? tm.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  if (day === today()) return t || 'Today';
  if (day === dOff(-1)) return 'Yesterday' + (t ? ', ' + t : '');
  const dd = new Date(day + 'T00:00:00'); return isNaN(dd) ? '' : DH_MON[dd.getMonth()] + ' ' + dd.getDate();
}
function dhDerivedActs(){
  const out = [];
  (DB.students || []).filter(s => s.admissionDate).forEach(s => out.push({ d: ymd(s.admissionDate), ic: 'user', t: 'New student admitted', s: `${s.name} (${dhClass(s)})`, c: ['#e6edff', '#2a5adb'] }));
  (DB.payments || []).forEach(p => { const st = (DB.students || []).find(x => x.id === p.studentId); out.push({ d: ymd(p.date), ic: 'coin', t: 'Fee payment received', s: `${dhMoney(p.amount)} - ${st ? st.name + ' (' + dhClass(st) + ')' : 'Student'}`, c: ['#dcf5e7', '#178a4b'] }); });
  (DB.exams || []).filter(x => x.status === 'Published').forEach(x => out.push({ d: ymd(x.examDate), ic: 'cal', t: 'Exam results published', s: `${x.examType} - ${x.grade}`, c: ['#ffe9d6', '#e2761b'] }));
  (DB.announcements || []).forEach(a => out.push({ d: ymd(a.date), ic: 'msg', t: 'Announcement posted', s: a.title, c: ['#efe4ff', '#7a45d6'] }));
  (DB.issues || []).forEach(i => { const bk = (DB.books || []).find(b => b.id === i.bookId); out.push({ d: ymd(i.issueDate), ic: 'book', t: 'Library book issued', s: `${bk ? bk.title : 'Book'} → ${i.borrower}`, c: ['#e6edff', '#2a5adb'] }); });
  return out.filter(x => x.d && x.d <= today()).sort((a, b) => b.d.localeCompare(a.d)).slice(0, 6);
}
function dhActsHTML(list){
  return list.length ? list.map(a => `<div class="dh-act">${dhBadgeIc(a.ic, a.c[0], a.c[1])}<div class="dh-act-b"><b>${esc(a.t)}</b><span>${esc(a.s)}</span></div><em>${esc(dhAgo(a.d))}</em></div>`).join('') : '<div class="empty">No recent activity yet.</div>';
}
function dhActs(){
  $('dhActs').innerHTML = `<div class="dh-ch"><h3>Recent Activities</h3>${can('audit.view') ? '<a href="#" class="dh-link sm" data-go="audit">View All</a>' : ''}</div><div id="dhActsList">${dhActsHTML(dhDerivedActs())}</div>`;
  dhLinks($('dhActs'));
  if (can('audit.view')) apiGet('audit_list', { limit: 6 }).then(r => {
    const rows = r && r.ok && (r.logs || r.rows || r.items || r.entries);
    const host = $('dhActsList'); if (!host || !rows || !rows.length) return;
    host.innerHTML = dhActsHTML(rows.slice(0, 6).map(x => ({ d: x.at, ic: /pay|fee/i.test(x.entity || '') ? 'coin' : /stud|learn/i.test(x.entity || '') ? 'user' : /exam|result/i.test(x.entity || '') ? 'cal' : 'doc', t: x.summary || x.action, s: (x.user_name || '') + (x.entity ? ' · ' + x.entity : ''), c: ['#e6edff', '#2a5adb'] })));
  }).catch(() => {});
}

/* ---- top performing classes ---- */
function dhTop(){
  const students = DB.students || [], byId = {}; students.forEach(s => byId[s.id] = s);
  const agg = {};
  Object.values(DB.marks || {}).forEach(ex => Object.entries(ex || {}).forEach(([sid, subj]) => {
    const s = byId[sid]; if (!s) return;
    const vals = Object.values(subj || {}).map(Number).filter(n => !isNaN(n)); if (!vals.length) return;
    const k = dhClass(s); (agg[k] = agg[k] || []).push(sum(vals) / vals.length);
  }));
  const cnt = {}; students.forEach(s => { const k = dhClass(s); cnt[k] = (cnt[k] || 0) + 1; });
  let rows = Object.entries(agg).map(([k, v]) => ({ k, n: cnt[k] || 0, avg: sum(v) / v.length }));
  if (DH.top === 'students') rows = Object.entries(cnt).map(([k, n]) => ({ k, n, avg: (agg[k] ? sum(agg[k]) / agg[k].length : null) })).sort((a, b) => b.n - a.n);
  else rows.sort((a, b) => b.avg - a.avg);
  rows = rows.slice(0, 5);
  $('dhTop').innerHTML = `
    <div class="dh-ch"><h3>Top Performing Classes</h3>${dhSel('dhTopSel', [['score', 'By Average Score'], ['students', 'By Students']], DH.top)}</div>
    <table class="dh-tbl"><thead><tr><th>Class</th><th>Students</th><th>Average Score</th></tr></thead><tbody>
    ${rows.length ? rows.map(r => `<tr><td>${esc(r.k)}</td><td>${r.n}</td><td><span class="dh-chip">${r.avg == null ? '—' : r.avg.toFixed(2) + '%'}</span></td></tr>`).join('') : '<tr><td colspan="3"><div class="empty">No results recorded yet.</div></td></tr>'}</tbody></table>
    <a href="#" class="dh-link" data-go="classes">View All Classes</a>`;
  $('dhTopSel').onchange = e => { DH.top = e.target.value; dhTop(); };
  dhLinks($('dhTop'));
}

/* ---- attendance overview ---- */
function dhAtt(){
  const [a, b] = dhRange(DH.att); let P = 0, A = 0, L = 0;
  Object.entries(DB.attendance || {}).forEach(([k, rec]) => { if (!inRange(k.split('|')[0], a, b)) return;
    Object.values(rec || {}).forEach(r => { if (!r) return; if (r.s === 'P') P++; else if (r.s === 'L') L++; else if (r.s === 'A' || r.s === 'AU') A++; }); });
  const T = P + A + L;
  $('dhAtt').innerHTML = `
    <div class="dh-ch"><h3>Attendance Overview</h3>${dhSel('dhAttSel', [['today', 'Today'], ['month', 'This Month'], ['term', 'This Term']], DH.att)}</div>
    <div class="dh-donut-row">${dhDonut([{ v: P, c: '#1a9e4b' }, { v: A, c: '#f5a623' }, { v: L, c: '#e0243b' }], T ? dhPct(P, T) + '%' : '—', 'Overall Attendance', 132, 22)}
      <ul class="dh-legend tight"><li><i style="background:#1a9e4b"></i><div class="row"><b>Present</b><span>${dhPct(P, T)}% (${dhInt(P)})</span></div></li>
      <li><i style="background:#f5a623"></i><div class="row"><b>Absent</b><span>${dhPct(A, T)}% (${dhInt(A)})</span></div></li>
      <li><i style="background:#e0243b"></i><div class="row"><b>Late</b><span>${dhPct(L, T)}% (${dhInt(L)})</span></div></li></ul></div>
    <a href="#" class="dh-link" data-go="attendance">View Attendance Report</a>`;
  $('dhAttSel').onchange = e => { DH.att = e.target.value; dhAtt(); };
  dhLinks($('dhAtt'));
}

/* ---- today's schedule ---- */
function dhSched(){
  const day = dayName(today()), classes = DB.classes || [];
  const lessons = (DB.timetable || []).filter(t => t.day === day).sort((a, b) => Number(a.period) - Number(b.period));
  const rows = lessons.slice(0, 5).map(t => {
    const [s, e] = ttPeriodTime(t.period).split(' – ');
    return { time: `${s} - ${e}`, what: `${(t.grade || '') + (t.stream ? ' ' + t.stream : '')} - ${t.subject || t.kind || ''}`, where: t.room || '' };
  });
  (DB.events || []).filter(e => ymd(e.date) === today()).forEach(e => rows.push({ time: 'All day', what: e.title, where: e.venue || '' }));
  $('dhSched').innerHTML = `
    <div class="dh-ch"><h3>Today's Schedule</h3><a href="#" class="dh-link sm" data-go="timetable">View Timetable</a></div>
    <div class="dh-sched">${rows.length ? rows.map(r => `<div><small>${esc(r.time)}</small><div class="row"><b>${esc(r.what)}</b><span>${esc(r.where || '-')}</span></div></div>`).join('') : `<div class="empty">${classes.length ? 'No lessons or events scheduled for ' + esc(day || 'today') + '.' : 'Set up classes and a timetable to see today\'s schedule.'}</div>`}</div>`;
  dhLinks($('dhSched'));
}

/* ---- system overview ---- */
function dhSize(){ try { const n = JSON.stringify(DB).length; return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; } catch (e) { return '—'; } }
function dhLastBackup(){ try { return localStorage.getItem('eramaster-last-backup') || ''; } catch (e) { return ''; } }
function dhSys(){
  const lb = dhLastBackup(), bytes = (() => { try { return JSON.stringify(DB).length; } catch (e) { return 0; } })();
  const used = Math.min(100, Math.max(2, bytes / (50 * 1048576) * 100));
  $('dhSys').innerHTML = `
    <div class="dh-ch"><h3>System Overview</h3></div>
    <div class="dh-sys">
      <div><span class="ic">${dhIc(DH_I.db)}</span><b>Database Status</b><em class="g">Online</em><i class="ok">${dhIc(DH_I.check, '#fff')}</i></div>
      <div><span class="ic">${dhIc(DH_I.backup)}</span><b>Backup Status</b><em>${lb ? esc(dhAgo(lb)) + (ymd(lb) === today() ? ', ' + new Date(lb).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '') : 'No backup yet'}</em>${lb ? `<i class="ok">${dhIc(DH_I.check, '#fff')}</i>` : '<i class="warn">!</i>'}</div>
      <div><span class="ic">${dhIc(DH_I.disk)}</span><b>Storage Usage</b><em>${dhSize()} of records</em></div>
      <div class="bar"><u style="width:${used}%"></u></div>
      <div><span class="ic" style="color:#f5a623">${dhIc(DH_I.users)}</span><b>Active Users</b><em id="dhActive">…</em></div>
    </div>
    <a href="#" class="dh-link" data-go="${can('security.view') ? 'security' : 'account'}">System Health</a>`;
  dhLinks($('dhSys'));
  apiGet('sessions_list').then(r => {
    const h = $('dhActive'); if (!h) return;
    if (!r || !r.ok) { h.textContent = '—'; return; }
    const cut = Date.now() - 15 * 60000, ids = new Set((r.sessions || []).filter(s => new Date(String(s.last_activity_at).replace(' ', 'T')).getTime() >= cut).map(s => s.user_id));
    h.textContent = `${ids.size} User${ids.size === 1 ? '' : 's'} Online`;
  }).catch(() => { const h = $('dhActive'); if (h) h.textContent = '—'; });
}

/* ---- recent payments ---- */
function dhPay(){
  const byId = {}; (DB.students || []).forEach(s => byId[s.id] = s);
  const rows = (DB.payments || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 5);
  $('dhPay').innerHTML = `
    <div class="dh-ch"><h3>Recent Payments</h3><a href="#" class="dh-link sm" data-go="payments">View All</a></div>
    <div class="dh-scroll"><table class="dh-tbl wide"><thead><tr><th>Receipt No.</th><th>Payer</th><th>Student</th><th>Class</th><th>Amount</th><th>Payment Method</th><th>Date</th><th>Status</th></tr></thead><tbody>
    ${rows.length ? rows.map(p => { const s = byId[p.studentId] || {}; const d = new Date(String(p.date).length > 10 ? p.date : p.date + 'T00:00:00');
      return `<tr><td>${esc(receiptNo(p))}</td><td>${esc(s.guardian || s.name || '—')}</td><td>${esc(s.name || '—')}</td><td>${esc(dhClass(s))}</td><td>${dhMoney(p.amount)}</td><td>${esc(p.method || '—')}</td><td>${isNaN(d) ? esc(p.date) : DH_MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear()}</td><td><span class="dh-chip">Paid</span></td></tr>`; }).join('')
      : '<tr><td colspan="8"><div class="empty">No payments recorded yet.</div></td></tr>'}</tbody></table></div>`;
  dhLinks($('dhPay'));
}

/* ---- quick shortcuts + quick action menu ---- */
function dhActions(){
  return [
    ['Add Student', 'students', '#fff1de', '#e2761b', 'students.create', () => { goTo('students'); setTimeout(() => { const b = $('lrn_add'); if (b) b.click(); }, 60); }],
    ['Collect Fee', 'coin', '#dcf5e7', '#178a4b', 'fees.create', () => { FEES_TAB = 'structure'; goTo('fees'); }],
    ['Add Teacher', 'user', '#ffe3e8', '#d0334f', 'staff.manage', () => { goTo('teachers'); setTimeout(() => { const b = $('tch_add'); if (b) b.click(); }, 60); }],
    ['Create Class', 'classes', '#e6edff', '#2a5adb', 'academics.manage', () => goTo('classes')],
    ['Notice Board', 'doc', '#efe4ff', '#7a45d6', 'communication.view', () => goTo('announcements')],
    ['Send Notification', 'msg', '#fff1de', '#e2761b', 'communication.send', () => { if (typeof TAB !== 'undefined') TAB.messaging = 'broadcast'; goTo('messages'); }],
    ['Generate Report', 'doc', '#e6edff', '#2a5adb', 'reports.view', () => goTo('reports')],
    ['Backup Data', 'backup', '#dcf5e7', '#178a4b', 'settings.manage', () => {
      try { const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' }), a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = `eramaster-backup-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        try { localStorage.setItem('eramaster-last-backup', new Date().toISOString()); } catch (e) { /* not persisted */ }
        toast('Backup downloaded.'); dhSys(); } catch (e) { toast('Could not create the backup.'); } }],
  ].filter(x => can(x[4]));
}
function dhShort(){
  const acts = dhActions();
  $('dhShort').innerHTML = `<div class="dh-ch"><h3>Quick Shortcuts</h3></div><div class="dh-short">${acts.map((a, i) => `<button type="button" data-i="${i}">${dhBadgeIc(a[1], a[2], a[3])}<span>${a[0]}</span></button>`).join('') || '<div class="empty">No shortcuts available for your role.</div>'}</div>`;
  $('dhShort').onclick = e => { const b = e.target.closest('[data-i]'); if (b) acts[+b.dataset.i][5](); };
}
function dhQuick(){
  const acts = dhActions().filter(a => a[0] !== 'Backup Data' && a[0] !== 'Generate Report'), menu = $('dhQAMenu'), btn = $('dhQABtn');
  menu.innerHTML = acts.map((a, i) => `<button type="button" data-i="${i}">${dhBadgeIc(a[1], a[2], a[3])}${a[0]}</button>`).join('');
  btn.onclick = e => { e.stopPropagation(); menu.classList.toggle('show'); };
  menu.onclick = e => { const b = e.target.closest('[data-i]'); if (b) { menu.classList.remove('show'); acts[+b.dataset.i][5](); } };
  document.addEventListener('click', () => menu.classList.remove('show'), { once: true });
  if (!acts.length) $('dhQA').style.display = 'none';
}
function dhLinks(root){ root.querySelectorAll('[data-go]').forEach(a => a.onclick = e => { e.preventDefault(); const id = a.dataset.go; if (findNavItem(id)) goTo(id); else toast('Not available for your role.'); }); }

/* ---- pending / recent approvals (same behaviour as the previous dashboard) ---- */
function dhApprovals(){
  if (!can('approvals.view') || !$('dashPending')) return;
  const pending = APPR.filter(a => a.status === 'Pending' && (a.can_act || a.mine)).slice(0, 6);
  $('dashPending').innerHTML = pending.length ? pending.map(a => `
    <div class="dash-appr-row">
      <div>${nameCell(a.title, `${a.type} · requested by ${a.requested_by_name}`)}</div>
      ${a.can_act ? `<div style="display:flex;gap:8px;flex:none">
          <button class="btn tiny primary" data-dpid="${esc(a.id)}" data-dpact="approve">Approve</button>
          <button class="btn tiny danger" data-dpid="${esc(a.id)}" data-dpact="reject">Reject</button>
        </div>` : badge(a.status)}
    </div>`).join('') : '<div class="empty">Nothing awaiting a decision.</div>';
  $('dashPending').onclick = async (e) => {
    const id = e.target.dataset.dpid, act = e.target.dataset.dpact;
    if (!id || !act) return;
    const res = await apiPost('approval_act', { id, decision: act });
    if (res.ok) { toast(act === 'approve' ? 'Approved.' : 'Rejected.'); await loadAll(); await loadApprovals(); renderView(); }
    else toast(res.error || 'Could not record your decision.');
  };
  const recent = APPR.filter(a => a.status !== 'Pending')
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))).slice(0, 6);
  $('dashRecent').innerHTML = recent.length ? recent.map(a => `
    <div class="dash-appr-row"><div>${nameCell(a.title, a.type)}</div>${badge(a.status)}</div>`).join('') : '<div class="empty">No decisions made yet.</div>';
}

/* ---- search box in the top strip ---- */
function dhSearchHits(q){
  q = q.trim().toLowerCase(); if (q.length < 2) return [];
  const has = (...v) => v.some(x => String(x || '').toLowerCase().includes(q)), out = [];
  const add = (perm, list, test, make) => { if (!can(perm)) return; (list || []).filter(test).slice(0, 4).forEach(r => out.push(make(r))); };
  add('students.view', DB.students, s => has(s.name, s.admNo, s.guardian, s.guardianPhone), s => ({ t: s.name, s: 'Student · ' + (s.admNo || ''), go: 'students' }));
  add('parents.view', DB.parents, p => has(p.name, p.phone, p.email), p => ({ t: p.name, s: 'Parent · ' + (p.phone || ''), go: 'parents' }));
  add('staff.view', DB.teachers, t => has(t.name, t.email, t.phone, t.jobTitle), t => ({ t: t.name, s: 'Staff · ' + (t.jobTitle || ''), go: 'teachers' }));
  add('fees.view', DB.payments, p => has(p.receipt, receiptNo(p), p.method, stuName(p.studentId)), p => ({ t: receiptNo(p), s: 'Payment · ' + stuName(p.studentId) + ' · ' + dhMoney(p.amount), go: 'payments' }));
  return out.slice(0, 10);
}
function dhSearchInit(){
  const inp = $('dhSearch'), box = $('dhResults'); if (!inp) return;
  const draw = () => { const hits = dhSearchHits(inp.value);
    box.innerHTML = hits.length ? hits.map((h, i) => `<button type="button" data-i="${i}"><b>${esc(h.t)}</b><span>${esc(h.s)}</span></button>`).join('') : (inp.value.trim().length > 1 ? '<div class="dh-none">No matches</div>' : '');
    box.classList.toggle('show', !!box.innerHTML); box._hits = hits; };
  inp.oninput = draw; inp.onfocus = draw;
  box.onclick = e => { const b = e.target.closest('[data-i]'); if (!b) return; const h = box._hits[+b.dataset.i]; box.classList.remove('show'); inp.value = ''; if (h && findNavItem(h.go)) goTo(h.go); };
  inp.onkeydown = e => { if (e.key === 'Enter' && box.querySelector('[data-i]')) box.querySelector('[data-i]').click(); if (e.key === 'Escape') { box.classList.remove('show'); inp.blur(); } };
  document.addEventListener('click', e => { if (!e.target.closest('.dh-search')) box.classList.remove('show'); });
  if (!window.__dhKey) { window.__dhKey = true; document.addEventListener('keydown', e => { const i = $('dhSearch'); if (i && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); i.focus(); } }); }
}
