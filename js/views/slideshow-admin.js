'use strict';
/* views/slideshow-admin.js — Settings → "Homepage slideshow".
   Lets an administrator (settings.manage) add, remove, caption and reorder the photos shown
   on the public landing page (portal.html). Called from renderSettings().
   Nothing is saved until "Save slideshow" is pressed. Talks to api/handlers/slideshow.php. */

function renderSlideshowManager(el, manage){
  if (!manage) return;                                   // only holders of settings.manage see this card
  const MAX = 12, MAX_NEW_BYTES = 6.5 * 1024 * 1024;     // keeps one save comfortably under PHP's post_max_size
  const card = document.createElement('div');
  card.className = 'ssm'; card.id = 'ssmCard';
  card.innerHTML = `
    <h3>Homepage slideshow</h3>
    <p class="ssm-sub">Photos play as the full-screen animated background of the public school portal page — wide (landscape) photos look best. Until you add some, built-in illustrated school scenes are shown. Drag the ⠿ handle (or use the arrows) to change the order. Up to ${MAX} photos; photos are resized automatically.</p>
    <div class="ssm-bar">
      <input type="file" id="ssmFile" accept="image/png,image/jpeg,image/webp" multiple hidden>
      <button class="btn primary" id="ssmAdd" type="button">＋ Add photos</button>
      <span class="grow"></span>
      <label style="margin:0;display:flex;align-items:center;gap:8px">Change photo every
        <select id="ssmSecs">${[3, 4, 5, 6, 8, 10, 15].map(n => `<option value="${n}">${n} seconds</option>`).join('')}</select>
      </label>
    </div>
    <div class="ssm-list" id="ssmList"><div class="ssm-empty">Loading…</div></div>
    <div style="display:flex;gap:10px;margin-top:14px;align-items:center;flex-wrap:wrap">
      <button class="btn primary" id="ssmSave" type="button" disabled>Save slideshow</button>
      <button class="btn ghost" id="ssmDiscard" type="button" disabled>Discard changes</button>
      <span class="muted" id="ssmStatus" style="font-size:12.5px"></span>
    </div>`;
  el.appendChild(card);

  const q = (id) => card.querySelector('#' + id);
  let items = [], interval = 5, dirty = false, dragId = null;

  function setDirty(v){
    dirty = v;
    q('ssmSave').disabled = !v; q('ssmDiscard').disabled = !v;
    q('ssmStatus').textContent = v ? 'Unsaved changes' : '';
  }
  function fromServer(d){
    items = (d.slides || []).map(s => ({ id: s.id, title: s.title || '', caption: s.caption || '', src: s.src }));
    interval = d.interval || 5;
    q('ssmSecs').value = String(interval);
    if (!Array.from(q('ssmSecs').options).some(o => o.value === String(interval))) {
      q('ssmSecs').add(new Option(interval + ' seconds', interval)); q('ssmSecs').value = String(interval);
    }
    setDirty(false); draw();
  }
  async function load(){
    const d = await apiGet('slideshow');
    if (!card.isConnected) return;                       // the Settings screen was re-rendered meanwhile
    if (!d || !d.ok) { q('ssmList').innerHTML = `<div class="ssm-empty">Could not load the slideshow.</div>`; return; }
    fromServer(d);
  }

  function draw(){
    const list = q('ssmList');
    q('ssmAdd').disabled = items.length >= MAX;
    if (!items.length) {
      list.innerHTML = `<div class="ssm-empty"><b>No photos yet</b><br>The homepage is showing the built-in illustrated scenes. Add a photo to replace them.</div>`;
      return;
    }
    list.innerHTML = items.map((it, i) => `
      <div class="ssm-item" data-id="${esc(it.id)}">
        <span class="ssm-grip" title="Drag to reorder" aria-hidden="true">⠿</span>
        <img class="ssm-thumb" src="${esc(it.src)}" alt="">
        <div class="ssm-fields">
          <input data-f="title" maxlength="80" placeholder="Title (optional)" value="${esc(it.title)}" aria-label="Title for photo ${i + 1}">
          <input data-f="caption" maxlength="200" placeholder="Caption (optional)" value="${esc(it.caption)}" aria-label="Caption for photo ${i + 1}">
          ${it.image ? '<span><span class="ssm-new">New — not saved yet</span></span>' : ''}
        </div>
        <div class="ssm-acts">
          <button class="icon-btn" type="button" data-act="up" title="Move earlier" aria-label="Move photo ${i + 1} earlier" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon-btn" type="button" data-act="down" title="Move later" aria-label="Move photo ${i + 1} later" ${i === items.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="icon-btn danger" type="button" data-act="del" title="Remove" aria-label="Remove photo ${i + 1}">✕</button>
        </div>
      </div>`).join('');
  }

  const idxOf = (id) => items.findIndex(x => x.id === id);
  function move(from, to){
    if (from < 0 || to < 0 || to >= items.length || from === to) return;
    items.splice(to, 0, items.splice(from, 1)[0]);
    setDirty(true); draw();
  }

  const list = q('ssmList');
  list.addEventListener('input', (e) => {
    const row = e.target.closest('.ssm-item'); if (!row || !e.target.dataset.f) return;
    const it = items[idxOf(row.dataset.id)]; if (it) { it[e.target.dataset.f] = e.target.value; setDirty(true); }
  });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const i = idxOf(b.closest('.ssm-item').dataset.id);
    if (b.dataset.act === 'up') move(i, i - 1);
    if (b.dataset.act === 'down') move(i, i + 1);
    if (b.dataset.act === 'del') { items.splice(i, 1); setDirty(true); draw(); }
  });

  // Drag-and-drop reordering — only starts from the ⠿ handle so text fields stay selectable.
  list.addEventListener('mousedown', (e) => { const row = e.target.closest('.ssm-item'); if (row) row.draggable = !!e.target.closest('.ssm-grip'); });
  list.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.ssm-item'); if (!row || !row.draggable) { e.preventDefault(); return; }
    dragId = row.dataset.id; row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch (_) {}
  });
  function clearMarks(){ list.querySelectorAll('.drop-before,.drop-after,.dragging').forEach(n => n.classList.remove('drop-before', 'drop-after', 'dragging')); }
  list.addEventListener('dragover', (e) => {
    if (!dragId) return; e.preventDefault();
    const row = e.target.closest('.ssm-item'); if (!row || row.dataset.id === dragId) return;
    const r = row.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    list.querySelectorAll('.drop-before,.drop-after').forEach(n => n.classList.remove('drop-before', 'drop-after'));
    row.classList.add(after ? 'drop-after' : 'drop-before');
  });
  list.addEventListener('drop', (e) => {
    if (!dragId) return; e.preventDefault();
    const row = e.target.closest('.ssm-item');
    if (row && row.dataset.id !== dragId) {
      const r = row.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      const from = idxOf(dragId); const moved = items.splice(from, 1)[0];
      let to = idxOf(row.dataset.id) + (after ? 1 : 0);
      items.splice(to, 0, moved); setDirty(true);
    }
    dragId = null; draw();
  });
  list.addEventListener('dragend', () => { dragId = null; clearMarks(); });

  // Adding photos: resize in the browser first, so uploads are small and fast.
  q('ssmAdd').onclick = () => q('ssmFile').click();
  q('ssmFile').onchange = async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    if (!files.length) return;
    const room = MAX - items.length;
    if (files.length > room) toast(room > 0 ? `Only ${room} more photo${room === 1 ? '' : 's'} fit — the rest were skipped.` : `The slideshow is full (${MAX} photos).`);
    const btn = q('ssmAdd'); btn.disabled = true; btn.textContent = 'Processing…';
    let added = 0;
    for (const f of files.slice(0, Math.max(0, room))) {
      try {
        const data = await resizeImageFile(f, 1920, 0.8);       // from media-import.js
        items.push({ id: uid('new'), title: '', caption: '', src: data, image: data });
        added++;
      } catch (err) { toast((f.name ? f.name + ': ' : '') + (err.message || 'Could not process that image.')); }
    }
    btn.textContent = '＋ Add photos';
    if (added) setDirty(true);
    draw();
  };
  q('ssmSecs').onchange = () => { interval = Number(q('ssmSecs').value) || 5; setDirty(true); };
  q('ssmDiscard').onclick = () => { if (!dirty || confirm('Discard your unsaved slideshow changes?')) load(); };

  q('ssmSave').onclick = async () => {
    const newBytes = items.reduce((n, it) => n + (it.image ? it.image.length : 0), 0);
    if (newBytes > MAX_NEW_BYTES) { toast('Those new photos add up to too much for one save — save a few at a time.'); return; }
    const btn = q('ssmSave'); btn.disabled = true; btn.textContent = 'Saving…';
    const res = await apiPost('slideshow_save', {
      interval,
      slides: items.map(it => it.image ? { id: it.id, title: it.title, caption: it.caption, image: it.image } : { id: it.id, title: it.title, caption: it.caption }),
    });
    btn.textContent = 'Save slideshow';
    if (res && res.ok) { fromServer(res); toast('Slideshow saved — the homepage is updated.'); }
    else { btn.disabled = false; toast((res && res.error) || 'Could not save the slideshow.'); }
  };

  load();
}
