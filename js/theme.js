'use strict';
/* theme.js — Theme Customization engine.

   Turns ONE accent colour into the whole palette the app uses, by overriding
   the CSS variables declared in index.html (--g-700, --g-900, --g-100, …).
   Every navbar, button, link, card, badge and highlight already reads those
   variables, so re-colouring the system is just setting them on <html>.

   Loaded in <head> (before the page paints) so a saved theme is applied
   immediately on refresh — no flash of the default colour. The Settings UI
   lives in js/views/theme-settings.js.

   "Default" = no overrides at all: removing the inline variables falls back
   to the stylesheet, so the original look is restored exactly. */

const THEME_CACHE_KEY = 'eramaster-accent';
const DEFAULT_THEME_COLOR = '#175537';   // the original Greenhill green
const THEME_PRESETS = [
  { id: 'emerald', name: 'Emerald', color: DEFAULT_THEME_COLOR, isDefault: true },
  { id: 'ocean',   name: 'Ocean',   color: '#1d4ed8' },
  { id: 'indigo',  name: 'Indigo',  color: '#4338ca' },
  { id: 'violet',  name: 'Violet',  color: '#6d28d9' },
  { id: 'rose',    name: 'Rose',    color: '#be123c' },
  { id: 'sunset',  name: 'Sunset',  color: '#c2410c' },
  { id: 'teal',    name: 'Teal',    color: '#0f766e' },
  { id: 'slate',   name: 'Slate',   color: '#334155' },
];

/* ---------------- colour maths ---------------- */
// Accepts "#abc", "abc", "#aabbcc"; returns "#aabbcc" (lower-case) or null.
function normalizeHex(v){
  let s = String(v == null ? '' : v).trim().toLowerCase();
  if (s[0] === '#') s = s.slice(1);
  if (/^[0-9a-f]{3}$/.test(s)) s = s.split('').map(c => c + c).join('');
  return /^[0-9a-f]{6}$/.test(s) ? '#' + s : null;
}
function hexToRgb(hex){ const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbToHsl(r, g, b){
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, s * 100, l * 100];
}
function hslToHex(h, s, l){
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
function relLuminance(hex){
  const [r, g, b] = hexToRgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastWithWhite(hex){ return 1.05 / (relLuminance(hex) + 0.05); }
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ---------------- palette ---------------- */
// Every CSS variable the theme may set on <html>. Removing them all restores the default.
const THEME_VAR_NAMES = [
  '--g-700', '--g-900', '--g-100', '--g-50', '--g-950', '--bg', '--line',
  '--side-bg', '--side-accent', '--side-accent-2', '--side-label', '--side-chev', '--side-text',
  '--t-dbg', '--t-dcard', '--t-dline', '--t-d50', '--t-d100',
];

// Builds the full palette from one accent colour. White text must stay readable
// on buttons, so a colour that is too light is darkened until it passes WCAG AA (4.5:1).
function buildThemePalette(input){
  const hex = normalizeHex(input) || DEFAULT_THEME_COLOR;
  let [h, s, l] = rgbToHsl(...hexToRgb(hex));
  let adjusted = false;
  while (contrastWithWhite(hslToHex(h, s, l)) < 4.5 && l > 6) { l -= 1; adjusted = true; }
  const primary = hslToHex(h, s, l);
  const tint = clampN(s * 0.6, 12, 45), neutral = clampN(s * 0.15, 5, 12), sideSat = clampN(s * 0.55, 12, 55), darkNeutral = clampN(s * 0.2, 8, 18);
  const vars = {
    '--g-700': primary,
    '--g-900': hslToHex(h, s, l * 0.6),
    '--g-950': hslToHex(h, s, l * 0.45),
    '--g-100': hslToHex(h, tint, 91),
    '--g-50':  hslToHex(h, tint * 0.8, 96),
    '--bg':    hslToHex(h, neutral, 96),
    '--line':  hslToHex(h, neutral, 90),
    '--side-bg':       hslToHex(h, sideSat, 12),
    '--side-accent':   `linear-gradient(135deg,${hslToHex(h, clampN(s, 40, 80), clampN(l + 12, 30, 52))},${primary})`,
    '--side-accent-2': hslToHex(h, clampN(s, 30, 75), 68),
    '--side-label':    hslToHex(h, 16, 60),
    '--side-chev':     hslToHex(h, 20, 40),
    '--side-text':     hslToHex(h, 20, 76),
    // dark-mode surfaces (index.html's body.dark rule reads these with green fallbacks)
    '--t-dbg':   hslToHex(h, darkNeutral, 7),
    '--t-dcard': hslToHex(h, darkNeutral, 11),
    '--t-dline': hslToHex(h, darkNeutral, 17),
    '--t-d50':   hslToHex(h, darkNeutral, 11),
    '--t-d100':  hslToHex(h, clampN(s * 0.3, 10, 25), 17),
  };
  return { color: hex, primary, adjusted, vars };
}

/* ---------------- apply / cache ---------------- */
function themeIsDefault(t){ const c = t && normalizeHex(t.color); return !c || c === DEFAULT_THEME_COLOR; }

// theme = { id, color } or null/default. Sets or clears the variables on <html>.
function applyTheme(theme){
  const st = document.documentElement.style;
  if (themeIsDefault(theme)) { THEME_VAR_NAMES.forEach(n => st.removeProperty(n)); cacheTheme(null); return; }
  const pal = buildThemePalette(theme.color);
  Object.keys(pal.vars).forEach(n => st.setProperty(n, pal.vars[n]));
  cacheTheme({ id: String(theme.id || 'custom'), color: pal.color });
}
// Remembered in this browser only so the next page load paints in the right colour
// straight away. The database (Settings) stays the source of truth.
function cacheTheme(theme){
  try { if (theme) localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(theme)); else localStorage.removeItem(THEME_CACHE_KEY); }
  catch (e) { /* storage unavailable — the theme is still applied for this session */ }
}
function readCachedTheme(){
  try { const t = JSON.parse(localStorage.getItem(THEME_CACHE_KEY)); return t && normalizeHex(t.color) ? t : null; }
  catch (e) { return null; }
}

// Called from applyBranding() (core.js) after every settings load/save.
function applyThemeFromSettings(){
  const t = typeof DB !== 'undefined' && DB.settings && DB.settings.theme;
  if (t && normalizeHex(t.color)) applyTheme(t);
  // No saved theme AND the settings really were loaded from the server → default.
  // (Accounts that can't read settings keep what the public sync below applied.)
  else if (typeof VER !== 'undefined' && VER['em_settings'] !== undefined) applyTheme(null);
}

/* ---------------- early apply + public sync ---------------- */
(function bootTheme(){
  const cached = readCachedTheme();
  if (cached) applyTheme(cached);       // instant, before first paint
  // Sign-in pages and portal accounts can't read Settings, so ask the public
  // endpoint for the school's saved theme (colour only — nothing sensitive).
  try {
    fetch('api/index.php?action=school_profile', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(j => { if (j && j.ok) applyTheme(j.theme || null); })
      .catch(() => { /* offline / server down — keep the cached theme */ });
  } catch (e) { /* ignore */ }
})();
