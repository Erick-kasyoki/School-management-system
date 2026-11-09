'use strict';
/* views/theme-settings.js — the "Theme customization" section of School Settings.
   Called from renderSettings() (settings-approvals.js). The palette engine and
   apply/cache logic live in js/theme.js.

   Nothing changes on the real site until "Apply theme" is pressed: choosing a
   preset or colour only updates the live preview panel beside the controls. */

let THEME_PREVIEW_HOOKED = false;

function themeLabelFor(t){
  if (!t || themeIsDefault(t)) return 'Emerald (default)';
  const c = normalizeHex(t.color);
  const p = THEME_PRESETS.find(x => x.color === c);
  return p ? p.name : 'Custom ' + c.toUpperCase();
}

// CSS variables for the scoped preview. In dark mode the page's own dark surfaces
// are swapped in so the preview matches what the site will really look like.
function themePreviewStyle(hex){
  const pal = buildThemePalette(hex);
  const vars = Object.assign({}, pal.vars);
  if (document.body.classList.contains('dark')) {
    Object.assign(vars, { '--g-50': pal.vars['--t-d50'], '--g-100': pal.vars['--t-d100'], '--bg': pal.vars['--t-dbg'], '--card': pal.vars['--t-dcard'], '--line': pal.vars['--t-dline'], '--g-900': '#eaf6ee' });
  }
  return { pal, css: Object.keys(vars).map(k => `${k}:${vars[k]}`).join(';') };
}

function renderThemeCustomizer(el, manage){
  const savedTheme = () => (DB.settings && DB.settings.theme && !themeIsDefault(DB.settings.theme)) ? DB.settings.theme : null;
  const savedColor = () => savedTheme() ? normalizeHex(savedTheme().color) : DEFAULT_THEME_COLOR;

  // pending = what the person is trying out (not yet applied)
  const start = savedTheme();
  const pending = { id: start ? start.id : 'emerald', color: savedColor() };
  let hexInvalid = false;

  const dis = manage ? '' : 'disabled';
  const wrap = document.createElement('section');
  wrap.className = 'card panel theme-card';
  wrap.id = 'themeCard';
  wrap.innerHTML = `
    <div class="theme-head">
      <div>
        <h3>Theme customization</h3>
        <p class="theme-sub">Pick the accent colour for the whole system — sidebar, buttons, links, cards and highlights. Changes are previewed here first and only take effect when you press <b>Apply theme</b>.</p>
      </div>
      <span class="theme-current" id="themeCurrent"></span>
    </div>
    ${manage ? '' : `<div class="theme-locked">You can view the current theme, but changing it needs the <b>Manage system settings</b> permission.</div>`}
    <div class="theme-layout">
      <div class="theme-controls">
        <label>Predefined themes</label>
        <div class="theme-swatches" id="themeSwatches" role="radiogroup" aria-label="Predefined colour themes">
          ${THEME_PRESETS.map(p => `<button type="button" class="theme-swatch" role="radio" aria-checked="false" data-id="${esc(p.id)}" data-color="${esc(p.color)}" ${dis}>
            <span class="theme-dot" style="background:${esc(p.color)}"></span><span class="theme-swatch-name">${esc(p.name)}${p.isDefault ? '<small>Default</small>' : ''}</span>
            <span class="theme-check" aria-hidden="true">✓</span></button>`).join('')}
        </div>
        <label for="themeHex">Custom colour</label>
        <div class="theme-custom">
          <input type="color" id="themeColor" aria-label="Pick a custom colour" ${dis}>
          <input type="text" id="themeHex" maxlength="7" spellcheck="false" autocomplete="off" placeholder="#175537" aria-label="Hex colour code" ${dis}>
        </div>
        <p class="theme-note" id="themeNote" role="status"></p>
        <div class="theme-actions">
          <button type="button" class="btn primary" id="themeApply" ${dis}>Apply theme</button>
          <button type="button" class="btn ghost" id="themeDiscard" ${dis}>Discard changes</button>
          <button type="button" class="btn ghost danger" id="themeReset" ${dis}>Reset to default</button>
        </div>
      </div>
      <div class="theme-preview-col">
        <label>Live preview</label>
        <div class="tp-frame" id="themePreview" aria-hidden="true">
          <div class="tp-top"><span class="tp-title">Dashboard</span><span class="tp-bell">🔔<i></i></span></div>
          <div class="tp-body">
            <div class="tp-side">
              <div class="tp-brand">🎓 Greenhill</div>
              <div class="tp-item active">🏠 Dashboard</div>
              <div class="tp-item">🎓 Students</div>
              <div class="tp-item">💳 Fees</div>
            </div>
            <div class="tp-main">
              <div class="tp-stats">
                <div class="tp-stat"><span class="tp-ic">🎓</span><b>1,248</b><small>Learners</small></div>
                <div class="tp-stat"><span class="tp-ic">📚</span><b>42</b><small>Classes</small></div>
              </div>
              <div class="tp-row"><span class="btn primary tp-btn">Primary</span><span class="btn ghost tp-btn">Secondary</span><span class="tp-link">Link text</span><span class="tp-badge">Active</span></div>
              <div class="tp-bar"><i></i></div>
              <div class="tp-input">Focused field</div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  el.appendChild(wrap);

  const q = (id) => wrap.querySelector('#' + id);
  const isDirty = () => pending.color !== savedColor();

  function refresh(){
    const c = pending.color;
    // preview (scoped to the preview panel only)
    const { pal, css } = themePreviewStyle(c);
    q('themePreview').setAttribute('style', css);
    // swatch selection + inputs
    wrap.querySelectorAll('.theme-swatch').forEach(b => {
      const on = b.dataset.color === c;
      b.classList.toggle('selected', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    if (!hexInvalid) q('themeColor').value = c;
    if (document.activeElement !== q('themeHex')) q('themeHex').value = c.toUpperCase();   // don't rewrite the text while it's being typed
    q('themeHex').setAttribute('aria-invalid', hexInvalid ? 'true' : 'false');
    // note under the inputs
    const note = q('themeNote');
    if (hexInvalid) { note.textContent = 'Enter a 6-digit hex colour, like #1D4ED8.'; note.className = 'theme-note warn'; }
    else if (pal.adjusted) { note.textContent = 'This colour is very light, so it is shown slightly darker to keep button text readable.'; note.className = 'theme-note'; }
    else { note.textContent = isDirty() ? 'Previewing — not applied yet.' : ''; note.className = 'theme-note'; }
    // status + buttons
    q('themeCurrent').textContent = 'Current: ' + themeLabelFor(savedTheme());
    q('themeApply').disabled = !manage || !isDirty() || hexInvalid;
    q('themeDiscard').disabled = !manage || !isDirty();
    q('themeReset').disabled = !manage || !savedTheme();
  }

  function choose(color, id){
    const c = normalizeHex(color); if (!c) return;
    const preset = THEME_PRESETS.find(p => p.color === c);
    pending.color = c; pending.id = preset ? preset.id : (id || 'custom');
    hexInvalid = false; refresh();
  }

  if (manage) {
    q('themeSwatches').onclick = (e) => { const b = e.target.closest('.theme-swatch'); if (b) choose(b.dataset.color, b.dataset.id); };
    q('themeColor').oninput = (e) => choose(e.target.value, 'custom');
    q('themeHex').oninput = (e) => {
      const c = normalizeHex(e.target.value);
      if (c) { choose(c, 'custom'); }
      else { hexInvalid = e.target.value.trim() !== ''; refresh(); }
    };
    q('themeHex').onblur = () => { hexInvalid = false; q('themeHex').value = pending.color.toUpperCase(); refresh(); };
    q('themeDiscard').onclick = () => { pending.color = savedColor(); pending.id = savedTheme() ? savedTheme().id : 'emerald'; hexInvalid = false; refresh(); };

    q('themeApply').onclick = async () => {
      const btn = q('themeApply'); btn.disabled = true;
      const isDefault = pending.color === DEFAULT_THEME_COLOR;
      if (isDefault) delete DB.settings.theme; else DB.settings.theme = { id: pending.id, color: pending.color };
      const ok = await persist('settings');
      if (ok) { applyTheme(isDefault ? null : DB.settings.theme); toast('Theme applied.'); }
      refresh();
    };
    q('themeReset').onclick = async () => {
      if (!confirm('Reset the system colours back to the default green theme?')) return;
      delete DB.settings.theme;
      const ok = await persist('settings');
      if (ok) { applyTheme(null); pending.color = DEFAULT_THEME_COLOR; pending.id = 'emerald'; hexInvalid = false; toast('Theme reset to default.'); }
      refresh();
    };
  }

  // The dark-mode button changes which surfaces the preview should mimic.
  window.__themePreviewRefresh = refresh;
  if (!THEME_PREVIEW_HOOKED && $('themeToggle')) {
    THEME_PREVIEW_HOOKED = true;
    $('themeToggle').addEventListener('click', () => { if (document.getElementById('themeCard') && window.__themePreviewRefresh) window.__themePreviewRefresh(); });
  }
  refresh();
}
