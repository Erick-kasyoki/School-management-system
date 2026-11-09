'use strict';
/* js/slideshow.js — full-page background slideshow for the public portal page (portal.html).
   Dependency-free. Photos come from api/index.php?action=slideshow (managed by an administrator in
   Settings → Homepage slideshow). If none have been uploaded yet, built-in illustrations are shown. */
(function(){
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ARROW_L = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';
  const ARROW_R = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
  const FADE_MS = 1200;

  fetch('api/index.php?action=slideshow', { credentials: 'same-origin' })
    .then(r => r.json())
    .then(d => (d && d.ok && Array.isArray(d.slides) && d.slides.length) ? start(d.slides, (d.interval || 5) * 1000) : fallback())
    .catch(fallback);

  function fallback(){
    fetch('api/index.php?action=school_profile', { credentials: 'same-origin' })
      .then(r => r.json()).catch(() => null)
      .then(p => {
        start([
          { src: 'img/slideshow/school-building.svg', title: 'Every day starts together', caption: 'Sign in below to reach your portal.' },
          { src: 'img/slideshow/classroom.svg', title: 'Learning that inspires', caption: 'Results, homework and timetables — all in your portal.' },
          { src: 'img/slideshow/sports-field.svg', title: 'One school, one community', caption: 'Stay connected with everything happening at school.' },
          { src: 'img/slideshow/library.svg', title: 'Questions are welcome', caption: 'Teachers and learners, working together.' },
        ], 5500);
      });
  }

  function start(slides, delay){
    const many = slides.length > 1;
    const bg = document.createElement('div');
    bg.className = 'ssbg'; bg.setAttribute('role', 'region'); bg.setAttribute('aria-roledescription', 'carousel'); bg.setAttribute('aria-label', 'School photo slideshow');
    // Zoom lasts as long as a photo is on screen (plus the fade), so it never stops and restarts visibly.
    bg.style.setProperty('--ss-zoom', ((delay + FADE_MS) / 1000).toFixed(1) + 's');
    bg.innerHTML = `<div class="ssbg-track">${slides.map((s, i) => `
      <figure class="ss-slide" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${slides.length}">
        <div class="ss-media"><img src="${esc(s.src)}" alt="${esc(s.title || s.caption || 'School photo ' + (i + 1))}" ${i === 0 ? 'fetchpriority="high"' : 'loading="eager"'} decoding="async" draggable="false"></div>
      </figure>`).join('')}</div><div class="ssbg-shade"></div>`;

    const ui = document.createElement('div'); ui.className = 'ssbg-ui';
    const cap = document.createElement('div'); cap.className = 'ssbg-cap'; cap.setAttribute('aria-live', 'off');
    let dock = null;
    if (many) {
      dock = document.createElement('div'); dock.className = 'ssbg-dock';
      dock.innerHTML = `<button class="ss-arrow ss-prev" type="button" aria-label="Previous photo">${ARROW_L}</button>
        <div class="ss-dots">${slides.map((_, i) => `<button class="ss-dot" type="button" aria-label="Show photo ${i + 1}"></button>`).join('')}</div>
        <button class="ss-arrow ss-next" type="button" aria-label="Next photo">${ARROW_R}</button>`;
      ui.appendChild(dock);
    }
    ui.appendChild(cap);
    document.body.prepend(bg);
    // The controls sit in the page header area so they scroll with the page and never cover the cards.
    const wrap = document.querySelector('.wrap');
    (wrap || document.body).insertBefore(ui, (wrap || document.body).firstChild);
    document.body.classList.add('has-ssbg');

    const els  = Array.from(bg.querySelectorAll('.ss-slide'));
    const dots = dock ? Array.from(dock.querySelectorAll('.ss-dot')) : [];
    let cur = -1, timer = null, prevTimer = null, hovering = false, focusIn = false, hiddenTab = document.hidden;

    function show(i){
      i = (i + els.length) % els.length;
      if (i === cur) return;
      const old = cur >= 0 ? els[cur] : null;
      els.forEach(e => e.classList.remove('is-prev'));
      if (old) { old.classList.remove('is-active'); old.classList.add('is-prev'); }
      els[i].classList.add('is-active');
      els.forEach((e, k) => e.setAttribute('aria-hidden', k === i ? 'false' : 'true'));
      clearTimeout(prevTimer);
      prevTimer = setTimeout(() => { if (old) old.classList.remove('is-prev'); }, FADE_MS + 150);
      cur = i;
      dots.forEach((d, k) => d.setAttribute('aria-current', k === i ? 'true' : 'false'));
      const s = slides[i];
      cap.innerHTML = (s.title ? `<h3>${esc(s.title)}</h3>` : '') + (s.caption ? `<p>${esc(s.caption)}</p>` : '');
      cap.style.animation = 'none'; void cap.offsetWidth; cap.style.animation = '';
    }
    // Restarting the timer on every manual change gives each photo its full time on screen.
    function schedule(){
      clearTimeout(timer);
      if (!many || hovering || focusIn || hiddenTab) return;
      timer = setTimeout(() => { show(step(1)); schedule(); }, delay);
    }
    function go(i){ show(i); schedule(); }
    // Next/previous visible photo — skips any whose image failed to load.
    function step(dir){
      let i = cur;
      for (let k = 0; k < els.length; k++) { i = (i + dir + els.length) % els.length; if (!els[i].dataset.broken) return i; }
      return cur;
    }

    show(0);
    if (!many) return;
    schedule();

    dock.querySelector('.ss-prev').onclick = () => go(step(-1));
    dock.querySelector('.ss-next').onclick = () => go(step(1));
    dots.forEach((d, i) => d.onclick = () => go(i));

    // Pause while the pointer is over the slideshow controls, or a control has *keyboard* focus
    // (a mouse click leaves focus on the button, which must not stop the show for good).
    dock.addEventListener('mouseenter', () => { hovering = true; schedule(); });
    dock.addEventListener('mouseleave', () => { hovering = false; schedule(); });
    dock.addEventListener('focusin',  e => { focusIn = !!(e.target.matches && e.target.matches(':focus-visible')); schedule(); });
    dock.addEventListener('focusout', () => { focusIn = false; schedule(); });
    // Don't burn cycles (or skip photos nobody saw) while the tab is in the background.
    document.addEventListener('visibilitychange', () => { hiddenTab = document.hidden; schedule(); });

    document.addEventListener('keydown', e => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowLeft')  go(step(-1));
      if (e.key === 'ArrowRight') go(step(1));
    });

    // Swipe left/right anywhere on touch screens (mostly-horizontal drags only, so scrolling still works).
    let sx = 0, sy = 0, tracking = false;
    document.addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; tracking = true; }, { passive: true });
    document.addEventListener('touchend', e => {
      if (!tracking) return; tracking = false;
      const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) go(step(dx < 0 ? 1 : -1));
    }, { passive: true });

    // Very light pointer parallax — a few pixels, mouse users only, off for reduced-motion.
    const fine = window.matchMedia('(hover:hover) and (pointer:fine)').matches;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (fine && !still) {
      let raf = 0, mx = 0, my = 0;
      document.addEventListener('mousemove', e => {
        mx = e.clientX / window.innerWidth - .5; my = e.clientY / window.innerHeight - .5;
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          bg.querySelectorAll('.ss-media').forEach(m => { m.style.setProperty('--px', (-mx * 16).toFixed(1) + 'px'); m.style.setProperty('--py', (-my * 10).toFixed(1) + 'px'); });
        });
      });
    }

    // A photo that fails to load is dropped from the rotation instead of leaving a blank screen.
    els.forEach((el, i) => el.querySelector('img').addEventListener('error', () => {
      el.dataset.broken = '1';
      if (dots[i]) dots[i].style.display = 'none';
      if (i === cur) go(step(1));
    }));
  }
})();
