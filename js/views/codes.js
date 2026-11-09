'use strict';
/* views/codes.js — tiny offline QR-code and Code 128 barcode generators (return SVG strings).
   Used by the payment receipt. No libraries, no internet needed.
   QR: byte mode, error-correction level M, versions 1–10 (up to 213 bytes). */

const QRGen = (function(){
  // [ecCodewordsPerBlock, blocksG1, dataCwG1, blocksG2, dataCwG2] for level M, versions 1..10
  const EC_M = [null, [10,1,16,0,0],[16,1,28,0,0],[26,1,44,0,0],[18,2,32,0,0],[24,2,43,0,0],[16,4,27,0,0],[18,4,31,0,0],[22,2,38,2,39],[22,3,36,2,37],[26,4,43,1,44]];
  const ALIGN = [null, [], [6,18], [6,22], [6,26], [6,30], [6,34], [6,22,38], [6,24,42], [6,26,46], [6,28,50]];

  // GF(256) arithmetic for Reed–Solomon
  const EXP = new Array(512), LOG = new Array(256);
  (function(){ let x = 1; for (let i = 0; i < 255; i++){ EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
  const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];
  function rsGenerator(n){ let g = [1]; for (let i = 0; i < n; i++){ const ng = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++){ ng[j] ^= g[j]; ng[j + 1] ^= gmul(g[j], EXP[i]); } g = ng; } return g; }
  function rsRemainder(data, n){ const g = rsGenerator(n); const res = new Array(n).fill(0);
    for (const d of data){ const f = d ^ res.shift(); res.push(0); if (f) for (let i = 0; i < n; i++) res[i] ^= gmul(g[i + 1], f); } return res; }

  function utf8(str){ return Array.from(unescape(encodeURIComponent(str))).map(c => c.charCodeAt(0)); }

  function build(text){
    const bytes = utf8(text);
    let ver = 0;
    for (let v = 1; v <= 10; v++){ const e = EC_M[v]; const cap = e[1] * e[2] + e[3] * e[4]; if (bytes.length + (v < 10 ? 2 : 3) <= cap){ ver = v; break; } }
    if (!ver) return null;
    const e = EC_M[ver], totalData = e[1] * e[2] + e[3] * e[4];
    // bit stream
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
    put(0, Math.min(4, totalData * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    const cw = []; for (let i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let pad = 0; cw.length < totalData; pad++) cw.push(pad % 2 ? 0x11 : 0xec);
    // split into blocks, add EC, interleave
    const blocks = []; let pos = 0;
    for (let i = 0; i < e[1]; i++){ blocks.push(cw.slice(pos, pos + e[2])); pos += e[2]; }
    for (let i = 0; i < e[3]; i++){ blocks.push(cw.slice(pos, pos + e[4])); pos += e[4]; }
    const ecs = blocks.map(b => rsRemainder(b, e[0]));
    const out = []; const maxLen = Math.max(...blocks.map(b => b.length));
    for (let i = 0; i < maxLen; i++) blocks.forEach(b => { if (i < b.length) out.push(b[i]); });
    for (let i = 0; i < e[0]; i++) ecs.forEach(b => out.push(b[i]));

    const size = 17 + ver * 4;
    const M = Array.from({ length: size }, () => new Array(size).fill(null));   // null = free, 0/1 = set
    const F = Array.from({ length: size }, () => new Array(size).fill(false));  // function-pattern flag
    const setF = (r, c, v) => { if (r >= 0 && r < size && c >= 0 && c < size){ M[r][c] = v; F[r][c] = true; } };
    const finder = (r, c) => { for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++){
      const on = (i >= 0 && i <= 6 && (j === 0 || j === 6)) || (j >= 0 && j <= 6 && (i === 0 || i === 6)) || (i >= 2 && i <= 4 && j >= 2 && j <= 4);
      setF(r + i, c + j, on ? 1 : 0); } };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    for (let i = 8; i < size - 8; i++){ setF(6, i, i % 2 === 0 ? 1 : 0); setF(i, 6, i % 2 === 0 ? 1 : 0); }
    const al = ALIGN[ver];
    al.forEach((r, ri) => al.forEach((c, ci) => {
      if ((ri === 0 && ci === 0) || (ri === 0 && ci === al.length - 1) || (ri === al.length - 1 && ci === 0)) return;
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) setF(r + i, c + j, (Math.max(Math.abs(i), Math.abs(j)) !== 1) ? 1 : 0);
    }));
    setF(size - 8, 8, 1);                       // dark module
    for (let i = 0; i < 9; i++){ if (!F[8][i]) setF(8, i, 0); if (!F[i][8]) setF(i, 8, 0); }   // reserve format areas
    for (let i = 0; i < 8; i++){ setF(8, size - 1 - i, 0); setF(size - 1 - i, 8, 0); }
    if (ver >= 7){   // version info
      let rem = ver; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const vb = (ver << 12) | rem;
      for (let i = 0; i < 18; i++){ const b = (vb >>> i) & 1; setF(Math.floor(i / 3), size - 11 + (i % 3), b); setF(size - 11 + (i % 3), Math.floor(i / 3), b); }
    }
    // place data bits (zig-zag)
    const dbits = []; out.forEach(b => { for (let i = 7; i >= 0; i--) dbits.push((b >>> i) & 1); });
    let bi = 0, up = true;
    for (let col = size - 1; col > 0; col -= 2){
      if (col === 6) col--;
      for (let k = 0; k < size; k++){
        const r = up ? size - 1 - k : k;
        for (let dc = 0; dc < 2; dc++){ const c = col - dc; if (!F[r][c]) M[r][c] = bi < dbits.length ? dbits[bi++] : 0; }
      }
      up = !up;
    }
    // choose best mask
    const masks = [(r,c)=>(r+c)%2===0,(r,c)=>r%2===0,(r,c)=>c%3===0,(r,c)=>(r+c)%3===0,(r,c)=>(Math.floor(r/2)+Math.floor(c/3))%2===0,
      (r,c)=>(r*c)%2+(r*c)%3===0,(r,c)=>((r*c)%2+(r*c)%3)%2===0,(r,c)=>((r+c)%2+(r*c)%3)%2===0];
    function withMask(m){
      const G = M.map(row => row.slice());
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!F[r][c] && masks[m](r, c)) G[r][c] ^= 1;
      // format bits: EC level M = 00, mask m
      const data = (0 << 3) | m; let rem = data; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const fmt = ((data << 10) | rem) ^ 0x5412;
      const bit = i => (fmt >>> i) & 1;
      for (let i = 0; i <= 5; i++) G[i][8] = bit(i);
      G[7][8] = bit(6); G[8][8] = bit(7); G[8][7] = bit(8);
      for (let i = 9; i < 15; i++) G[8][14 - i] = bit(i);
      for (let i = 0; i < 8; i++) G[8][size - 1 - i] = bit(i);
      for (let i = 8; i < 15; i++) G[size - 15 + i][8] = bit(i);
      G[size - 8][8] = 1;
      return G;
    }
    function penalty(G){
      let p = 0;
      for (let r = 0; r < size; r++){ let run = 1; for (let c = 1; c < size; c++){ if (G[r][c] === G[r][c-1]) run++; else { if (run >= 5) p += run - 2; run = 1; } } if (run >= 5) p += run - 2; }
      for (let c = 0; c < size; c++){ let run = 1; for (let r = 1; r < size; r++){ if (G[r][c] === G[r-1][c]) run++; else { if (run >= 5) p += run - 2; run = 1; } } if (run >= 5) p += run - 2; }
      for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++){ const v = G[r][c]; if (v === G[r][c+1] && v === G[r+1][c] && v === G[r+1][c+1]) p += 3; }
      let dark = 0; G.forEach(row => row.forEach(v => { if (v) dark++; }));
      p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
      return p;
    }
    let best = null, bestP = Infinity;
    for (let m = 0; m < 8; m++){ const G = withMask(m); const p = penalty(G); if (p < bestP){ bestP = p; best = G; } }
    return best;
  }

  function svg(text, px){
    const G = build(String(text || ''));
    if (!G) return '';
    const n = G.length, q = 3, dim = n + q * 2;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (G[r][c]) d += `M${c + q} ${r + q}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${px || 96}" height="${px || 96}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  return { svg, matrix: build };
})();

const Code128 = (function(){
  const P = ['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];
  // Code set B (printable ASCII 32..127); returns an SVG string
  function svg(text, w, h){
    const s = String(text || '').replace(/[^\x20-\x7e]/g, '?');
    const codes = [104]; let sum = 104;
    for (let i = 0; i < s.length; i++){ const v = s.charCodeAt(i) - 32; codes.push(v); sum += v * (i + 1); }
    codes.push(sum % 103); codes.push(106);
    let x = 10, bars = '';
    codes.forEach(cv => { const pat = P[cv]; for (let i = 0; i < pat.length; i++){ const wd = Number(pat[i]); if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${wd}" height="50" fill="#000"/>`; x += wd; } });
    const total = x + 10;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} 50" width="${w || 190}" height="${h || 34}" preserveAspectRatio="none" shape-rendering="crispEdges"><rect width="${total}" height="50" fill="#fff"/>${bars}</svg>`;
  }
  return { svg };
})();

if (typeof module !== 'undefined') module.exports = { QRGen, Code128 };
