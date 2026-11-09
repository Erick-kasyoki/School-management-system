'use strict';
/* views/logo-admin.js — Settings → "School logo".
   An administrator (settings.manage) uploads the school logo here. It is resized in the browser,
   stored by api/handlers/logo.php, and then shown in the sidebar, on the sign-in pages, on the public
   landing page (portal.html), in the student/parent portals and on printed letterheads/report forms. */

function renderLogoManager(el, manage){
  if (!manage) return;
  const MAX_SIDE = 512;
  const card = document.createElement('div');
  card.className = 'ssm'; card.id = 'logoCard';
  card.innerHTML = `
    <h3>School logo</h3>
    <p class="ssm-sub">Shown next to the school name in the sidebar, on every sign-in page, the public landing page, the student &amp; parent portals and printed report forms. A square or wide PNG with a transparent background looks best (JPG / PNG / WebP). It is resized automatically.</p>
    <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
      <div id="logoPrev" style="width:120px;height:120px;border:1px dashed var(--line);border-radius:14px;display:flex;align-items:center;justify-content:center;background:#fff;overflow:hidden"></div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp" hidden>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn primary" id="logoPick" type="button">⬆ Choose logo…</button>
          <button class="btn primary" id="logoSave" type="button" disabled>Save logo</button>
          <button class="btn ghost" id="logoRemove" type="button">Remove logo</button>
        </div>
        <span class="muted" id="logoStatus" style="font-size:12.5px"></span>
      </div>
    </div>`;
  el.appendChild(card);
  const q = id => card.querySelector('#' + id);
  let pending = '';   // data-URI of a chosen-but-unsaved logo

  function draw(){
    const src = pending || SCHOOL_PUBLIC.logo;
    q('logoPrev').innerHTML = src ? `<img src="${esc(src)}" alt="School logo" style="max-width:100%;max-height:100%;object-fit:contain">` : '<span class="muted" style="font-size:12px;text-align:center;padding:6px">No logo yet</span>';
    q('logoSave').disabled = !pending;
    q('logoRemove').disabled = !!pending || !SCHOOL_PUBLIC.logo;
    q('logoStatus').textContent = pending ? 'New logo chosen — not saved yet.' : '';
  }

  // Resize in the browser (keeps transparency as PNG; falls back to JPEG only if the PNG is still large).
  function toDataUri(file){
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
        let out = c.toDataURL('image/png');
        if (out.length > 900 * 1024 * 1.37) {
          const c2 = document.createElement('canvas'); c2.width = w; c2.height = h;
          const x2 = c2.getContext('2d'); x2.fillStyle = '#fff'; x2.fillRect(0, 0, w, h); x2.drawImage(img, 0, 0, w, h);
          out = c2.toDataURL('image/jpeg', 0.88);
        }
        resolve(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image.')); };
      img.src = url;
    });
  }

  q('logoPick').onclick = () => q('logoFile').click();
  q('logoFile').onchange = async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { toast('Please choose a PNG, JPG or WebP image.'); return; }
    try { pending = await toDataUri(f); draw(); } catch (err) { toast(err.message); }
  };
  q('logoSave').onclick = async () => {
    if (!pending) return;
    q('logoSave').disabled = true; q('logoStatus').textContent = 'Saving…';
    const r = await apiPost('logo_save', { image: pending });
    if (r && r.ok) { SCHOOL_PUBLIC.logo = r.logo || ''; pending = ''; applyBranding(); toast('School logo saved.'); }
    else { toast((r && r.error) || 'Could not save the logo.'); }
    if (card.isConnected) draw();
  };
  q('logoRemove').onclick = async () => {
    if (!confirm('Remove the school logo everywhere?')) return;
    const r = await apiPost('logo_save', { remove: true });
    if (r && r.ok) { SCHOOL_PUBLIC.logo = ''; applyBranding(); toast('School logo removed.'); }
    else toast((r && r.error) || 'Could not remove the logo.');
    if (card.isConnected) draw();
  };
  draw();
}
