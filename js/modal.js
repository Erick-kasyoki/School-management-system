'use strict';
/* modal.js — shared modal chrome (close/cancel button wiring).
   Part of the EraMaster frontend — loaded after core.js. */

/* ---------------- modal chrome (close/cancel buttons) ---------------- */
$('modalClose').onclick = closeModal;
$('modalCancel').onclick = closeModal;
$('overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') closeModal(); });
