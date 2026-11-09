'use strict';
/* views/portal-results.js — "My Results" and "Report Form" for the student and parent portals.
   Both read the server's portal_data action, which only ever returns the signed-in account's own
   linked student (student login) or the students whose parentId is the parent's record (parent login),
   and only exams whose status is Published. Nothing here can reach another child's marks.
   Loaded after core.js, results.js and portal-dashboard.js. */

let PORTAL_SEL = { child: '', exam: '' };

async function portalLoad(force){
  if (!force && PORTAL_CACHE && PORTAL_CACHE.ok) return PORTAL_CACHE;
  const res = await apiGet('portal_data');
  if (res && res.ok) PORTAL_CACHE = res;
  return res;
}
// Jump from the portal home's child card straight to a child's results / report form.
function portalOpen(view, childId, examId){
  PORTAL_SEL.child = childId || PORTAL_SEL.child;
  PORTAL_SEL.exam = examId || '';
  goTo(view);
}

/* ---------------- grading & maths (uses the school's own bands sent by the server) ---------------- */
function portalGradeFor(avg, grading){
  if (avg === '' || avg == null || isNaN(Number(avg))) return { code: '', label: '' };
  const bands = (grading && grading.length ? grading : []).slice().sort((a, b) => b.min - a.min);
  const hit = bands.find(b => Number(avg) >= b.min) || bands[bands.length - 1];
  return hit ? { code: hit.code, label: hit.label || '' } : { code: '', label: '' };
}
function portalResultRows(result, grading){
  const rows = Object.keys(result.marks || {}).map(sub => {
    const c = normalizeMarkCell(result.marks[sub]);
    const avg = (c.average === '' || c.average == null) ? '' : Number(c.average);
    return { sub, cat1: c.cat1, cat2: c.cat2, midEnd: c.midEnd, examMarks: c.examMarks, avg, grade: portalGradeFor(avg, grading) };
  });
  const avgs = rows.map(r => r.avg).filter(v => v !== '');
  const total = avgs.reduce((a, b) => a + b, 0);
  const overall = avgs.length ? Math.round(total / avgs.length * 10) / 10 : '';
  return { rows, total: Math.round(total * 10) / 10, overall, overallGrade: portalGradeFor(overall, grading) };
}
function portalPickChild(res){
  const kids = res.children || [];
  if (!kids.length) return null;
  return kids.find(k => k.id === PORTAL_SEL.child) || kids[0];
}
function portalExamsSorted(child){
  return (child.results || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}
function portalChildPicker(res, child, id){
  if ((res.children || []).length < 2) return '';
  return `<div class="card panel" style="margin-bottom:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <label style="margin:0">Child</label>
    <select id="${id}" style="max-width:340px">${res.children.map(k => `<option value="${esc(k.id)}" ${k.id === child.id ? 'selected' : ''}>${esc(k.name)} — ${esc(k.grade)}${k.stream ? ' ' + esc(k.stream) : ''}</option>`).join('')}</select>
  </div>`;
}
function portalGate(el, res){
  if (!res || !res.ok) { portalLoadFailed(el, 'Could not load your results', res); return false; }
  if (!res.linked) { portalShowUnlinked(el, res); return false; }
  if (!(res.children || []).length) { el.innerHTML = portalNoChildrenHtml(res); return false; }
  return true;
}

/* ---------------- the report form document (used on screen and for print / PDF) ---------------- */
function portalReportHtml(child, result, res){
  const sc = res.school || {};
  const g = res.grading || [];
  const d = portalResultRows(result, g);
  const att = child.attendance || { present: 0, absent: 0 };
  const attTotal = att.present + att.absent;
  const attPct = attTotal ? Math.round(att.present / attTotal * 100) + '%' : '—';
  const cm = result.comments && !Array.isArray(result.comments) ? result.comments : {};
  const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const contact = [sc.address, sc.phone, sc.email].filter(Boolean).join(' · ');
  return `<div class="hd"><h1>${brandLogoImg(56, sc.logo)}${esc(sc.name || schoolName())}</h1>${sc.motto ? `<div class="muted"><i>${esc(sc.motto)}</i></div>` : ''}${contact ? `<div class="muted">${esc(contact)}</div>` : ''}
      <h2>Student Report Form — ${esc(result.examType)}${result.term ? ' (' + esc(result.term) + ')' : ''}</h2></div>
    <table class="rf-info"><tbody>
      <tr><td><b>Name</b></td><td>${esc(child.name)}</td><td><b>Adm No</b></td><td>${esc(child.admNo)}</td></tr>
      <tr><td><b>Class</b></td><td>${esc(child.grade)}${child.stream ? ' ' + esc(child.stream) : ''}</td><td><b>Term / Exam</b></td><td>${esc(result.term || '—')} · ${esc(result.examType)}</td></tr>
      <tr><td><b>Position</b></td><td>${esc(ordinal(result.rank))} out of ${esc(result.of)}</td><td><b>Attendance</b></td><td>${esc(attPct)}${attTotal ? ` (${att.present} present, ${att.absent} absent)` : ''}</td></tr>
    </tbody></table>
    <table><thead><tr><th>Subject</th><th>CAT 1</th><th>CAT 2</th><th>Mid/End Term</th><th>Exam Marks</th><th>Average</th><th>Grade</th></tr></thead><tbody>
      ${d.rows.map(r => `<tr><td>${esc(r.sub)}</td><td>${esc(r.cat1)}</td><td>${esc(r.cat2)}</td><td>${esc(r.midEnd)}</td><td>${esc(r.examMarks)}</td><td>${esc(r.avg)}</td><td>${esc(r.grade.code)}</td></tr>`).join('') || '<tr><td colspan="7">No marks recorded.</td></tr>'}
      <tr><td><b>Total</b></td><td></td><td></td><td></td><td></td><td><b>${esc(d.total)}</b></td><td></td></tr>
      <tr><td><b>Overall average</b></td><td></td><td></td><td></td><td></td><td><b>${d.overall === '' ? '—' : esc(d.overall)}</b></td><td><b>${esc(d.overallGrade.code || '—')}</b></td></tr>
    </tbody></table>
    ${g.length ? `<p class="muted" style="margin-top:10px"><b>Grading key:</b> ${g.map(b => `${esc(b.code)}${b.label ? ' (' + esc(b.label) + ')' : ''} ≥ ${esc(b.min)}`).join(' · ')}</p>` : ''}
    <p><b>Class teacher's comment:</b> ${esc(cm.teacher || '—')}</p>
    <p><b>Principal's comment:</b> ${esc(cm.principal || '—')}</p>
    <div class="sign"><div>Class Teacher</div><div>Principal</div><div>Parent / Guardian</div></div>`;
}
const PORTAL_REPORT_CSS = `<style>
  .rf-doc{background:#fff;color:#111;padding:26px 28px;border:1px solid var(--line);border-radius:14px;max-width:900px}
  .rf-doc h1{font-size:20px;margin:0 0 2px}.rf-doc h2{font-size:15px;margin:14px 0 6px}
  .rf-doc .hd{border-bottom:2px solid #175537;padding-bottom:8px;margin-bottom:12px}.rf-doc .muted{color:#555;font-size:12px}
  .rf-doc table{border-collapse:collapse;width:100%;margin-top:8px}.rf-doc th,.rf-doc td{border:1px solid #999;padding:6px 8px;font-size:12.5px;text-align:left}
  .rf-doc th{background:#eee}.rf-doc .sign{margin-top:34px;display:flex;gap:30px}.rf-doc .sign div{flex:1;border-top:1px solid #333;padding-top:4px;font-size:12px}
  .rf-doc .table-scroll{overflow-x:auto}
</style>`;

/* ---------------- My Results ---------------- */
async function renderPortalResults(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const res = await portalLoad(true);
  if (!portalGate(el, res)) return;
  const child = portalPickChild(res);
  PORTAL_SEL.child = child.id;
  const exams = portalExamsSorted(child);
  const isParent = res.kind === 'parent';

  el.innerHTML = `<p class="crumb">📊 ${isParent ? 'Parent' : 'Student'} portal <span>›</span> My Results</p>
    ${portalChildPicker(res, child, 'prChild')}
    <div class="card panel" style="margin-bottom:16px">
      <h3 style="margin:0 0 4px">${esc(child.name)} <span class="muted" style="font-weight:400;font-size:12.5px">· ${esc(child.admNo)} · ${esc(child.grade)}${child.stream ? ' ' + esc(child.stream) : ''}</span></h3>
      <div class="muted" style="font-size:12.5px">Only results the school has approved and published are shown here.</div>
    </div>
    ${exams.length ? exams.map(r => {
      const d = portalResultRows(r, res.grading);
      const cm = r.comments && !Array.isArray(r.comments) ? r.comments : {};
      return `<div class="card panel" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
          <div><h3 style="margin:0">${esc(r.examType)}${r.term ? ' — ' + esc(r.term) : ''}</h3><div class="muted" style="font-size:12.5px">${esc(r.date || '')}</div></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" data-report="${esc(r.examId)}">🧾 Report form</button></div>
        </div>
        <div class="stats-grid" style="margin:14px 0">
          ${statCards([
            stat('🧮', C_B, d.total, 'Total marks'),
            stat('📈', C_G, d.overall === '' ? '—' : d.overall, 'Average'),
            stat('🏅', C_A, d.overallGrade.code || '—', 'Overall grade'),
            stat('🥇', C_P, `${r.rank} / ${r.of}`, 'Class position'),
          ])}
        </div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Subject</th><th>CAT 1</th><th>CAT 2</th><th>Mid/End Term</th><th>Exam Marks</th><th>Average</th><th>Grade</th></tr></thead><tbody>
          ${d.rows.map(x => `<tr><td>${esc(x.sub)}</td><td>${esc(x.cat1)}</td><td>${esc(x.cat2)}</td><td>${esc(x.midEnd)}</td><td>${esc(x.examMarks)}</td><td><b>${esc(x.avg)}</b></td><td>${x.grade.code ? `<span class="badge b-blue">${esc(x.grade.code)}</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">No marks recorded.</div></td></tr>'}
        </tbody></table></div>
        ${cm.teacher ? `<div class="row-line"><b>Class teacher's comment:</b> ${esc(cm.teacher)}</div>` : ''}
        ${cm.principal ? `<div class="row-line"><b>Principal's comment:</b> ${esc(cm.principal)}</div>` : ''}
      </div>`;
    }).join('') : `<div class="card panel"><div class="empty"><b>No published results yet</b>Results will appear here as soon as the school approves and publishes them.</div></div>`}`;

  const pick = $('prChild'); if (pick) pick.onchange = e => { PORTAL_SEL.child = e.target.value; renderPortalResults(el); };
  el.querySelectorAll('[data-report]').forEach(b => b.onclick = () => portalOpen('portalReport', child.id, b.dataset.report));
}

/* ---------------- Report Form ---------------- */
async function renderPortalReport(el){
  el.innerHTML = '<div class="empty">Loading…</div>';
  const res = await portalLoad(true);
  if (!portalGate(el, res)) return;
  const child = portalPickChild(res);
  PORTAL_SEL.child = child.id;
  const exams = portalExamsSorted(child);
  const isParent = res.kind === 'parent';
  if (!exams.find(x => x.examId === PORTAL_SEL.exam)) PORTAL_SEL.exam = exams[0] ? exams[0].examId : '';
  const cur = exams.find(x => x.examId === PORTAL_SEL.exam);

  el.innerHTML = `<p class="crumb">🧾 ${isParent ? 'Parent' : 'Student'} portal <span>›</span> Report Form</p>
    ${portalChildPicker(res, child, 'prChild')}
    ${exams.length ? `<div class="card panel" style="margin-bottom:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <label style="margin:0">Report</label>
      <select id="prExam" style="max-width:340px">${exams.map(x => `<option value="${esc(x.examId)}" ${x.examId === PORTAL_SEL.exam ? 'selected' : ''}>${esc(x.examType)}${x.term ? ' — ' + esc(x.term) : ''}${x.date ? ' (' + esc(x.date) + ')' : ''}</option>`).join('')}</select>
      <button class="btn primary" id="prPrint" style="margin-left:auto">🖨️ Print / Save as PDF</button>
    </div>
    ${PORTAL_REPORT_CSS}<div class="rf-doc"><div class="table-scroll">${portalReportHtml(child, cur, res)}</div></div>`
    : `<div class="card panel"><div class="empty"><b>No report form available yet</b>${esc(child.name)}'s report form will appear here once the school publishes the results.</div></div>`}`;

  const pc = $('prChild'); if (pc) pc.onchange = e => { PORTAL_SEL.child = e.target.value; PORTAL_SEL.exam = ''; renderPortalReport(el); };
  const pe = $('prExam'); if (pe) pe.onchange = e => { PORTAL_SEL.exam = e.target.value; renderPortalReport(el); };
  const pp = $('prPrint'); if (pp) pp.onclick = () =>
    printHtml(`Report Form — ${child.name} — ${cur.examType}`, portalReportHtml(child, cur, res), false);
}
