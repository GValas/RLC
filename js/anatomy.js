// @ts-check
// Onglet « Composants » : architecture d'un condensateur, d'une bobine et d'une résistance,
// puis leur fonctionnement animé. Les dessins lisent l'état exact de js/devices.js.
(function (root) {
  'use strict';
  const RLC = root.RLC;
  const D = RLC.devices;
  const { formatSI } = RLC.circuit;

  /** @param {string} tag @param {Record<string, any>} [props] @param {...any} kids */
  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) /** @type {any} */ (el)[k] = v;
    }
    el.append(...kids.filter((x) => x !== null && x !== undefined));
    return el;
  }

  // ---------------------------------------------------------------- Couleurs

  function readColors() {
    const css = getComputedStyle(document.documentElement);
    const v = (/** @type {string} */ n) => css.getPropertyValue(n).trim();
    const dark = css.colorScheme.includes('dark');
    return {
      dark, paper: v('--paper'), panel: v('--panel'), panel2: v('--panel-2'), line: v('--line'), ink: v('--ink'), muted: v('--muted'),
      accent: v('--accent'), pos: v('--volt-pos'), neg: v('--volt-neg'), mid: v('--volt-mid'), dot: v('--dot'), good: v('--good'),
      warn: v('--warn'), err: v('--err'), s1: v('--series-1'), s2: v('--series-2'),
      wire: dark ? '#8e939b' : '#6f7277',
      metal: dark ? '#9aa1ab' : '#aab0b8', metalDark: dark ? '#6d737c' : '#7f858d', metalLight: dark ? '#c3c8cf' : '#d3d7dc',
      dielectric: dark ? 'rgba(236,200,110,.20)' : 'rgba(226,180,70,.28)', dielectricEdge: dark ? 'rgba(236,200,110,.55)' : 'rgba(170,125,20,.6)',
      copper: dark ? '#d98b52' : '#b8662c', copperBack: dark ? '#7f5233' : '#d9a982',
      ferrite: dark ? '#4c5058' : '#5b5e65', air: dark ? 'rgba(160,190,230,.10)' : 'rgba(90,130,190,.10)',
      field: dark ? '#6fd0b0' : '#0f8a66',
      body: dark ? '#b79a6c' : '#d9bd8e', bodyDark: dark ? '#8a7350' : '#b89a68', ceramic: dark ? '#d8d4c8' : '#f1ede2', film: dark ? '#44403a' : '#3b3731',
    };
  }
  /** @typedef {ReturnType<typeof readColors>} Colors */
  const BAND = ['#1c1c1c', '#7a4a21', '#cf2f24', '#ec7a17', '#efc81a', '#2c9a44', '#2a64c8', '#7a3fb5', '#8d8d8d', '#f4f2ea'];
  const BAND_NAMES = ['noir', 'marron', 'rouge', 'orange', 'jaune', 'vert', 'bleu', 'violet', 'gris', 'blanc'];
  const GOLD = '#c79a2c', SILVER = '#c4c7cb';
  /** @param {number} m */
  const bandColor = (m) => m === -1 ? GOLD : m === -2 ? SILVER : BAND[m];
  /** @param {number} m */
  const bandName = (m) => m === -1 ? 'or' : m === -2 ? 'argent' : BAND_NAMES[m];

  /** Exposant en caractères Unicode. @param {number} n */
  const sup = (n) => String(n).split('').map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d] ?? '⁻').join('');
  const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif';

  // ---------------------------------------------------------------- Outils de dessin

  /** Prépare un canvas à la taille de sa boîte, avec un repère logique W×H centré. @param {HTMLCanvasElement} cv @param {number} W @param {number} H */
  function prepare(cv, W, H) {
    const r = cv.getBoundingClientRect();
    const dpr = root.devicePixelRatio || 1;
    const bw = Math.max(1, Math.round(r.width * dpr)), bh = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    const ctx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, bw, bh);
    const s = Math.min(r.width / W, r.height / H) || 1;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (r.width - W * s) / 2, dpr * (r.height - H * s) / 2);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    return { ctx, s };
  }
  /** @param {CanvasRenderingContext2D} g @param {string} text @param {number} x @param {number} y @param {string} color @param {number} [size] @param {CanvasTextAlign} [align] @param {boolean} [bold] */
  function text(g, text, x, y, color, size = 13, align = 'left', bold = false) {
    g.font = `${bold ? '600 ' : ''}${size}px ${FONT}`;
    g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle';
    g.fillText(text, x, y);
  }
  /** @param {CanvasRenderingContext2D} g @param {number[][]} pts @param {string} color @param {number} [w] */
  function line(g, pts, color, w = 2) {
    g.strokeStyle = color; g.lineWidth = w;
    g.beginPath();
    pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]));
    g.stroke();
  }
  /** @param {CanvasRenderingContext2D} g @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 @param {string} color @param {number} [w] @param {number} [head] */
  function arrow(g, x1, y1, x2, y2, color, w = 2, head = 8) {
    const a = Math.atan2(y2 - y1, x2 - x1);
    line(g, [[x1, y1], [x2, y2]], color, w);
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x2 + Math.cos(a) * 2, y2 + Math.sin(a) * 2);
    g.lineTo(x2 - head * Math.cos(a - 0.45), y2 - head * Math.sin(a - 0.45));
    g.lineTo(x2 - head * Math.cos(a + 0.45), y2 - head * Math.sin(a + 0.45));
    g.closePath(); g.fill();
  }
  /** Nom de vecteur, flèche dessinée : le caractère combinant U+20D7 manque à trop de polices. @param {CanvasRenderingContext2D} g @param {string} name @param {number} x @param {number} y @param {string} color */
  function vector(g, name, x, y, color) {
    text(g, name, x, y, color, 15, 'left', true);
    const w = g.measureText(name).width;
    arrow(g, x, y - 11, x + w + 1, y - 11, color, 1.2, 4);
  }
  /** Cote à deux flèches. @param {CanvasRenderingContext2D} g @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 @param {string} color */
  function dimension(g, x1, y1, x2, y2, color) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    arrow(g, mx, my, x1, y1, color, 1.3, 6);
    arrow(g, mx, my, x2, y2, color, 1.3, 6);
  }
  /** Étiquette reliée à un point. @param {CanvasRenderingContext2D} g @param {number} x @param {number} y @param {number} px @param {number} py @param {string} title @param {string} [sub] @param {Colors} c */
  function label(g, x, y, px, py, title, sub, c) {
    g.fillStyle = c.muted;
    g.beginPath(); g.arc(px, py, 2.5, 0, 7); g.fill();
    line(g, [[x - 5, y], [px, py]], c.muted, 1);
    text(g, title, x, y, c.ink, 13, 'left', true);
    if (sub) text(g, sub, x, y + 16, c.muted, 12);
  }
  /** Électron : le signe reste lisible en couleur comme en niveaux de gris. @param {CanvasRenderingContext2D} g @param {number} x @param {number} y @param {Colors} c @param {number} [r] @param {number} [alpha] */
  function electron(g, x, y, c, r = 5, alpha = 1) {
    g.globalAlpha = alpha;
    g.fillStyle = c.neg;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, r * 0.28);
    g.beginPath(); g.moveTo(x - r * 0.5, y); g.lineTo(x + r * 0.5, y); g.stroke();
    g.globalAlpha = 1;
  }
  /** @param {CanvasRenderingContext2D} g @param {number} x @param {number} y @param {Colors} c @param {number} [r] */
  function plusCharge(g, x, y, c, r = 5) {
    g.fillStyle = c.pos;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, r * 0.28);
    g.beginPath(); g.moveTo(x - r * 0.5, y); g.lineTo(x + r * 0.5, y); g.moveTo(x, y - r * 0.5); g.lineTo(x, y + r * 0.5); g.stroke();
  }

  /** Chemin en ligne brisée, parcouru à l'abscisse curviligne. @param {number[][]} pts */
  function makePath(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, cum, len: cum[cum.length - 1] };
  }
  /** Électrons régulièrement espacés, décalés de `shift` : un fil est plein, ils ne font que glisser.
   * @param {CanvasRenderingContext2D} g @param {ReturnType<typeof makePath>} path @param {number} shift @param {Colors} c @param {number} [gap] @param {(p: number[]) => number} [alphaAt] */
  function electrons(g, path, shift, c, gap = 26, alphaAt) {
    const visible = (/** @type {number} */ a) => a > 0;
    let s = ((shift % gap) + gap) % gap;
    let k = 0;
    for (; s < path.len; s += gap) {
      while (k < path.cum.length - 2 && path.cum[k + 1] < s) k++;
      const seg = path.cum[k + 1] - path.cum[k] || 1;
      const f = (s - path.cum[k]) / seg;
      const a = path.pts[k], b = path.pts[k + 1];
      const p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] ?? 1];
      const alpha = alphaAt ? alphaAt(p) : 1;
      if (visible(alpha)) electron(g, p[0], p[1], c, 4.5, alpha);
    }
  }

  /** Générateur, interrupteur à deux positions et fils communs aux scènes du condensateur et de la bobine. */
  const FRAME = { yT: 56, yB: 388, xG: 62, xJ: 244, xP: 318, yC2: 104, xR1: 372, xR2: 464 };

  /** @param {CanvasRenderingContext2D} g @param {Colors} c @param {string} mode @param {{ E: number, R: number }} m @param {boolean} [twoWay] */
  function drawFrame(g, c, mode, m, twoWay = true) {
    const { yT, yB, xG, xJ, xP, yC2 } = FRAME;
    const yMid = (yT + yB) / 2;
    line(g, [[xJ, yT], [xG, yT], [xG, yMid - 8]], c.wire);
    line(g, [[xG, yMid + 8], [xG, yB]], c.wire);
    if (twoWay) line(g, [[xJ, yC2], [xJ, yB]], c.wire);
    // Pile : la grande barre est la borne +.
    line(g, [[xG - 22, yMid - 8], [xG + 22, yMid - 8]], c.ink, 3);
    line(g, [[xG - 11, yMid + 8], [xG + 11, yMid + 8]], c.ink, 5);
    text(g, '+', xG + 28, yMid - 18, c.pos, 16, 'left', true);
    text(g, '−', xG + 20, yMid + 19, c.neg, 16, 'left', true);
    text(g, 'E = ' + formatSI(m.E, 'V'), xG + 34, yMid + 1, c.ink, 13);
    // Interrupteur : contact 1 vers le générateur, contact 2 vers la branche de décharge.
    const tip = mode === 'charge' ? [xJ, yT] : mode === 'discharge' ? [xJ, yC2] : [xJ + 8, (yT + yC2) / 2 + 4];
    line(g, [[xP, yT], tip], c.ink, 3);
    for (const p of [[xP, yT], [xJ, yT]].concat(twoWay ? [[xJ, yC2]] : [])) {
      g.fillStyle = c.panel; g.strokeStyle = c.ink; g.lineWidth = 2;
      g.beginPath(); g.arc(p[0], p[1], 4.5, 0, 7); g.fill(); g.stroke();
    }
    text(g, '1', xJ - 11, yT - 13, c.muted, 12, 'center', true);
    if (twoWay) text(g, '2', xJ + 15, yC2 + 3, c.muted, 12, 'center', true);
    text(g, 'K', xP + 4, yT - 15, c.ink, 13, 'center', true);
  }
  /** @param {CanvasRenderingContext2D} g @param {Colors} c @param {number} R */
  function drawResistorBox(g, c, R) {
    const { yT, xR1, xR2 } = FRAME;
    g.fillStyle = c.panel; g.strokeStyle = c.ink; g.lineWidth = 2;
    g.beginPath(); g.rect(xR1, yT - 13, xR2 - xR1, 26); g.fill(); g.stroke();
    text(g, 'R = ' + formatSI(R, 'Ω'), (xR1 + xR2) / 2, yT, c.ink, 12.5, 'center');
  }
  /** Flèche de courant : sa longueur suit |i|. @param {CanvasRenderingContext2D} g @param {Colors} c @param {number} x @param {number} y @param {number} i @param {number} iRef */
  function currentArrow(g, c, x, y, i, iRef) {
    const a = Math.min(1, Math.abs(i) / (iRef || 1));
    if (a > 0.004) {
      const len = 14 + 34 * a, dir = i > 0 ? 1 : -1;
      arrow(g, x - dir * len / 2, y - 12, x + dir * len / 2, y - 12, c.dark ? c.dot : '#c98500', 3, 10);
    }
    text(g, 'i = ' + formatSI(i, 'A'), x, y - 30, c.ink, 13, 'center', true);
  }

  /** Vitesse visuelle des électrons : 200 px au total pour la charge d'un condensateur sous E max. */
  const EMAX = 20;
  /** @param {{ E: number, R: number, tau: number }} m */
  const flowScale = (m) => 200 / (EMAX / m.R * m.tau);

  // ---------------------------------------------------------------- Courbes

  /** @param {HTMLCanvasElement} cv @param {{ model: any, series: { name: string, unit: string, color: keyof Colors, get: (s: any) => number }[], tNow: number, windowTau: number, hover: number|null, onRange: (lo: number, hi: number) => void }} o @param {Colors} c */
  function drawCharts(cv, o, c) {
    const r = cv.getBoundingClientRect();
    const W = r.width, H = r.height;
    const { ctx: g } = prepare(cv, W, H);
    const left = 54, right = 12, gap = 26, top = 18, bottom = 22;
    const n = o.series.length;
    const chartH = (H - top - bottom - gap * (n - 1)) / n;
    const span = o.windowTau * o.model.tau;
    const hi = Math.max(span, o.tNow), lo = hi - span;
    o.onRange(lo, hi);
    const X = (/** @type {number} */ t) => left + (t - lo) / span * (W - left - right);
    const hist = o.model.history;
    const cols = Math.max(2, Math.floor(W - left - right));
    // Une colonne par pixel, plus chaque manœuvre : les sauts gardent leur vraie hauteur.
    const times = [];
    for (let k = 0; k <= cols; k++) times.push(lo + span * k / cols);
    for (const ph of hist.phases) if (ph.t0 > lo && ph.t0 < hi) times.push(ph.t0);
    times.sort((a, b) => a - b);
    const samples = times.map((t) => hist.at(t));

    o.series.forEach((sr, idx) => {
      const y0 = top + idx * (chartH + gap);
      let mn = 0, mx = 0;
      for (const s of samples) { const v = sr.get(s); if (v < mn) mn = v; if (v > mx) mx = v; }
      const ref = sr.ref ? sr.ref(o.model) : 0;
      if (ref > mx && mn >= 0) mx = ref;
      if (mx - mn < 1e-30) mx = mn + 1;
      const Y = (/** @type {number} */ v) => y0 + chartH - (v - mn) / (mx - mn) * chartH;
      // Titre et graduations
      text(g, `${sr.name} (${sr.unit})`, left, y0 - 9, c.ink, 12, 'left', true);
      g.strokeStyle = c.line; g.lineWidth = 1;
      g.beginPath(); g.moveTo(left, y0); g.lineTo(left, y0 + chartH); g.moveTo(left, Y(0)); g.lineTo(W - right, Y(0)); g.stroke();
      text(g, formatSI(mx, sr.unit, 2), left - 5, y0 + 5, c.muted, 11, 'right');
      if (mn < 0) text(g, formatSI(mn, sr.unit, 2), left - 5, y0 + chartH - 5, c.muted, 11, 'right');
      if (mn < 0 || mx > 0) text(g, '0', left - 5, Y(0), c.muted, 11, 'right');
      // Le futur déjà enregistré reste visible, en pâle.
      const trace = (/** @type {number} */ from, /** @type {number} */ to, /** @type {number} */ alpha) => {
        g.globalAlpha = alpha; g.strokeStyle = /** @type {string} */ (c[sr.color]); g.lineWidth = 2;
        g.beginPath();
        let first = true;
        times.forEach((t, k) => {
          if (t < from || t > to) return;
          const py = Y(sr.get(samples[k]));
          if (first) g.moveTo(X(t), py); else g.lineTo(X(t), py);
          first = false;
        });
        g.stroke(); g.globalAlpha = 1;
      };
      if (o.tNow > lo) trace(lo, o.tNow, 1);
      if (hist.tMax > o.tNow) trace(o.tNow, hist.tMax, 0.3);
    });
    // Curseur de l'instant courant, et lecture au survol.
    const xNow = X(o.tNow);
    line(g, [[xNow, top - 2], [xNow, H - bottom]], c.accent, 1.5);
    if (o.hover !== null && o.hover >= lo && o.hover <= Math.min(hi, hist.tMax)) {
      const xh = X(o.hover), s = hist.at(o.hover);
      line(g, [[xh, top - 2], [xh, H - bottom]], c.muted, 1);
      const parts = o.series.map((sr) => `${sr.name} = ${formatSI(sr.get(s), sr.unit)}`);
      text(g, `t = ${formatSI(o.hover, 's')}   ${parts.join('   ')}`, W - right, H - 8, c.ink, 12, 'right');
    } else {
      text(g, formatSI(lo, 's', 2), left, H - 8, c.muted, 11);
      text(g, formatSI(hi, 's', 2), W - right, H - 8, c.muted, 11, 'right');
      text(g, 'τ = ' + formatSI(o.model.tau, 's', 3), (left + W - right) / 2, H - 8, c.muted, 11, 'center');
    }
  }

  // ---------------------------------------------------------------- Condensateur

  const LOG_PLATE = (/** @type {number} */ S) => 95 + 90 * Math.log10(S / 2e-3) / Math.log10(20);
  const LOG_GAP = (/** @type {number} */ e) => 18 + 46 * Math.log10(e / 5e-6) / Math.log10(20);

  /** @param {CanvasRenderingContext2D} g @param {number} x @param {number} y @param {number} w @param {number} thick @param {string} top @param {string} side */
  function slab(g, x, y, w, thick, top, side) {
    const dx = w * 0.42, dy = w * 0.26;
    g.fillStyle = side;
    g.beginPath();
    g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w + dx, y - dy); g.lineTo(x + w + dx, y - dy + thick); g.lineTo(x + w, y + thick); g.lineTo(x, y + thick);
    g.closePath(); g.fill();
    g.fillStyle = top;
    g.beginPath();
    g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w + dx, y - dy); g.lineTo(x + dx, y - dy);
    g.closePath(); g.fill();
  }

  /** @param {HTMLCanvasElement} cv @param {any} p @param {any} m @param {Colors} c */
  function drawCapacitorParts(cv, p, m, c) {
    const { ctx: g } = prepare(cv, 720, 320);
    const w = LOG_PLATE(p.S), gapPx = LOG_GAP(p.e);
    const x = 60 + (185 - w) / 2, yBottom = 205, yTop = yBottom - gapPx - 8;
    const dx = w * 0.42, dy = w * 0.26, cx = x + w / 2 + dx / 2, cyTop = yTop - dy / 2, cyBot = yBottom + 8 - dy / 2;
    // Borne du bas, armature du bas
    line(g, [[cx, cyBot], [cx, 300]], c.wire, 3);
    slab(g, x, yBottom, w, 8, c.metalLight, c.metal);
    // Diélectrique : translucide, pour laisser voir qu'il remplit l'intervalle.
    g.fillStyle = c.dielectric; g.strokeStyle = c.dielectricEdge; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, yBottom); g.lineTo(x, yTop + 8); g.lineTo(x + w, yTop + 8); g.lineTo(x + w, yBottom);
    g.closePath(); g.fill(); g.stroke();
    g.beginPath();
    g.moveTo(x + w, yBottom); g.lineTo(x + w, yTop + 8); g.lineTo(x + w + dx, yTop + 8 - dy); g.lineTo(x + w + dx, yBottom - dy);
    g.closePath(); g.fill(); g.stroke();
    // Armature du haut, borne du haut
    slab(g, x, yTop, w, 8, c.metalLight, c.metal);
    line(g, [[cx, 14], [cx, cyTop]], c.wire, 3);
    g.fillStyle = c.wire; g.beginPath(); g.arc(cx, cyTop, 4, 0, 7); g.fill();
    // Cotes
    dimension(g, x - 16, yTop + 8, x - 16, yBottom, c.ink);
    text(g, 'e', x - 25, (yTop + 8 + yBottom) / 2, c.ink, 15, 'right', true);
    text(g, 'S', x + w * 0.28 + dx * 0.25, yTop - dy * 0.45, c.ink, 15, 'center', true);
    // Étiquettes
    const lx = 318;
    label(g, lx, 36, x + w + dx * 0.55, yTop - dy * 0.5, 'Armature', 'plaque de métal, conductrice', c);
    label(g, lx, 92, x + w + dx * 0.5, (yTop + yBottom) / 2 - dy * 0.3, 'Diélectrique', p.er <= 1.05 ? 'ici le vide : un isolant parfait' : `isolant, εᵣ = ${String(p.er).replace('.', ',')}`, c);
    label(g, lx, 148, x + w + dx * 0.55, yBottom + 2 - dy * 0.5, 'Seconde armature', 'jamais en contact avec la première', c);
    label(g, lx, 204, cx + 1, 280, 'Bornes', 'relient chaque armature au circuit', c);
    // En pratique : roulé.
    const rx = 610, ry = 118;
    g.strokeStyle = c.line; g.lineWidth = 1;
    g.beginPath(); g.arc(rx, ry, 80, 0, 7); g.stroke();
    const spiral = (/** @type {number} */ phase, /** @type {string} */ color, /** @type {number} */ lw) => {
      g.strokeStyle = color; g.lineWidth = lw;
      g.beginPath();
      for (let a = 0; a < 5 * 2 * Math.PI; a += 0.1) {
        const rr = 10 + 13.6 * (a + phase) / (2 * Math.PI);
        const X = rx + rr * Math.cos(a), Y = ry + rr * Math.sin(a);
        if (a === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
      }
      g.stroke();
    };
    spiral(0, c.metal, 2.6);
    spiral(Math.PI, c.copper, 2.6);
    text(g, 'En pratique, on roule', rx, 222, c.ink, 13, 'center', true);
    text(g, 'deux bandes de métal (gris, orange),', rx, 240, c.muted, 12, 'center');
    text(g, 'isolées par un film (en blanc) :', rx, 256, c.muted, 12, 'center');
    text(g, 'grande surface, petit volume.', rx, 272, c.muted, 12, 'center');
  }

  /** @param {HTMLCanvasElement} cv @param {any} p @param {any} m @param {any} s @param {Colors} c */
  function drawCapacitorScene(cv, p, m, s, c) {
    const { ctx: g } = prepare(cv, 800, 440);
    const { yT, yB, xJ, xP, xR2 } = FRAME;
    const cx = 600, plateW = 230, xL = cx - plateW / 2, xRr = cx + plateW / 2;
    const yPT = 130, yPB = 318, thick = 12;
    const k = flowScale(m);
    const norm = m.E > 0 ? s.u / m.E : 0;
    drawFrame(g, c, s.mode, m);
    line(g, [[xP, yT], [cx, yT], [cx, yPT]], c.wire);
    line(g, [[xJ, yB], [cx, yB], [cx, yPB + thick]], c.wire);
    // Diélectrique et ses molécules, qui s'alignent peu à peu sur le champ.
    g.fillStyle = p.er > 1.05 ? c.dielectric : c.air;
    g.fillRect(xL, yPT + thick, plateW, yPB - yPT - thick);
    if (p.er > 1.05) {
      for (let r = 0; r < 3; r++) for (let q = 0; q < 7; q++) {
        const x = xL + 18 + q * (plateW - 36) / 6, y = yPT + thick + 28 + r * 56;
        const a0 = Math.sin(q * 12.9 + r * 78.2) * 2.6;
        const a = a0 * (1 - Math.min(1, norm));
        const ux = Math.sin(a) * 9, uy = Math.cos(a) * 9;
        g.globalAlpha = 0.85;
        g.fillStyle = c.neg; g.beginPath(); g.arc(x - ux, y - uy, 4, 0, 7); g.fill();
        g.fillStyle = c.pos; g.beginPath(); g.arc(x + ux, y + uy, 4, 0, 7); g.fill();
        g.globalAlpha = 1;
      }
    }
    // Champ : du + vers le −, de plus en plus marqué avec u.
    const fieldA = Math.min(1, Math.abs(norm) * (m.E / 10 > 1 ? 1 : Math.max(0.4, m.E / 10)));
    if (fieldA > 0.01) {
      g.globalAlpha = fieldA;
      for (let q = 0; q < 6; q++) {
        const x = xL + 38 + q * (plateW - 76) / 5;
        arrow(g, x, yPT + thick + 7, x, yPB - 7, c.field, 1.8, 8);
      }
      g.globalAlpha = 1;
      vector(g, 'E', xRr - 17, (yPT + yPB) / 2 + 28, c.field);
    }
    // Électrons dans les fils
    electrons(g, makePath([[cx, yPT], [cx, yT], [xP, yT]]), s.q * k, c);
    electrons(g, makePath([[xJ, yB], [cx, yB], [cx, yPB + thick]]), s.q * k, c);
    electrons(g, makePath([[xJ, yT], [FRAME.xG, yT], [FRAME.xG, (yT + yB) / 2 - 10]]), s.flowGen * k, c);
    electrons(g, makePath([[FRAME.xG, (yT + yB) / 2 + 10], [FRAME.xG, yB], [xJ, yB]]), s.flowGen * k, c);
    electrons(g, makePath([[xJ, yB], [xJ, FRAME.yC2]]), s.flowDis * k, c);
    drawResistorBox(g, c, m.R);
    // Armatures, charges en excès sur les faces en regard.
    g.fillStyle = c.metal; g.fillRect(xL, yPT, plateW, thick); g.fillRect(xL, yPB, plateW, thick);
    const full = Math.max(8, Math.min(32, Math.round(8 + (Math.log10(Math.max(m.xFull, 1e-12)) + 9.75) * 5)));
    const count = Math.round(full * (m.xFull > 0 ? s.q / m.xFull : 0));
    for (let i = 0; i < count; i++) {
      // Remplissage du centre vers les bords : l'œil lit la quantité.
      const rank = Math.ceil(i / 2) * (i % 2 ? 1 : -1);
      const step = (plateW - 16) / Math.max(full, 16);
      const x = cx + rank * step;
      plusCharge(g, x, yPT + thick + 2, c, Math.min(6, step * 0.46));
      electron(g, x, yPB - 2, c, Math.min(6, step * 0.46));
    }
    // Légendes
    text(g, 'Armature : +q', xL, yPT - 13, c.muted, 12.5);
    text(g, 'Armature : −q', xL, yPB + thick + 15, c.muted, 12.5);
    text(g, 'q = ' + formatSI(s.q, 'C'), xRr, yPT - 13, c.ink, 13, 'right', true);
    dimension(g, xRr + 18, yPT + thick, xRr + 18, yPB, c.ink);
    text(g, 'u =', xRr + 26, (yPT + yPB) / 2 - 9, c.ink, 13, 'left', true);
    text(g, formatSI(s.u, 'V'), xRr + 26, (yPT + yPB) / 2 + 9, c.ink, 13, 'left', true);
    currentArrow(g, c, (xR2 + cx) / 2 - 8, yT, s.i, m.iRef);
    // Message central : ce que font les électrons maintenant.
    const tx = 300;
    const msg = captionCapacitor(s, m);
    msg.forEach((t, i) => text(g, t, tx, 188 + i * 19, i ? c.muted : c.ink, 13, 'left', !i));
    legendElectron(g, c, 20, 425);
  }
  /** @param {CanvasRenderingContext2D} g @param {Colors} c @param {number} x @param {number} y */
  function legendElectron(g, c, x, y) {
    electron(g, x, y, c, 5);
    text(g, 'électron (sens réel, à l\'inverse de i ; vitesse et nombre schématiques)', x + 11, y, c.muted, 12);
  }
  /** @param {any} s @param {any} m */
  function captionCapacitor(s, m) {
    if (s.mode === 'charge' && s.u < m.E * 0.98) return ['Les électrons quittent le haut', 'et s\'accumulent en bas.', 'Aucun ne traverse l\'isolant.'];
    if (s.mode === 'charge') return ['Chargé : u = E.', 'Plus rien ne pousse', 'les électrons.'];
    if (s.mode === 'discharge' && s.u > m.E * 0.02) return ['Les électrons en excès', 'retournent par le fil', 'vers l\'armature du haut.'];
    if (s.mode === 'discharge') return ['Déchargé : u = 0.', 'L\'énergie a été dissipée', 'dans R.'];
    if (s.q > m.xFull * 0.01) return ['Circuit ouvert :', 'les charges n\'ont aucun', 'chemin, u se maintient.'];
    return ['Armatures neutres :', 'ni charge en excès,', 'ni champ, ni tension.'];
  }

  // ---------------------------------------------------------------- Bobine

  /** Spires dessinées (schématiques) : le nombre suit N sans le reproduire. @param {number} N */
  const drawnTurns = (N) => Math.round(5 + 9 * Math.log(N / 50) / Math.log(40));

  /** @param {HTMLCanvasElement} cv @param {any} p @param {any} m @param {Colors} c */
  function drawInductorParts(cv, p, m, c) {
    const { ctx: g } = prepare(cv, 720, 320);
    const turns = drawnTurns(p.N);
    const lenPx = 150 + 110 * Math.log10(p.l / 0.02) / Math.log10(10);
    const ry = 34 + 28 * Math.log10(p.S / 1e-4) / Math.log10(50), rx = ry * 0.32;
    const x0 = 58, cy = 138, x1 = x0 + lenPx;
    const pitch = (x1 - x0) / turns;
    const coreColor = p.mur > 1.5 ? c.ferrite : c.air;
    // Bord arrière des spires, noyau, puis bord avant.
    const arc = (/** @type {number} */ x, /** @type {number} */ from, /** @type {number} */ to, /** @type {string} */ color) => {
      g.strokeStyle = color; g.lineWidth = 4;
      g.beginPath();
      for (let a = from; a <= to + 1e-9; a += (to - from) / 20) {
        const f = (a + Math.PI / 2) / (2 * Math.PI);
        const X = x + rx * Math.cos(a) + pitch * f, Y = cy + ry * Math.sin(a);
        if (a === from) g.moveTo(X, Y); else g.lineTo(X, Y);
      }
      g.stroke();
    };
    for (let k = 0; k < turns; k++) arc(x0 + k * pitch, Math.PI / 2, 3 * Math.PI / 2, c.copperBack);
    g.fillStyle = coreColor; g.strokeStyle = c.line; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x0 - 10, cy - ry * 0.72); g.lineTo(x1 + 10, cy - ry * 0.72); g.ellipse(x1 + 10, cy, rx * 0.72, ry * 0.72, 0, -Math.PI / 2, Math.PI / 2); g.lineTo(x0 - 10, cy + ry * 0.72);
    g.ellipse(x0 - 10, cy, rx * 0.72, ry * 0.72, 0, Math.PI / 2, 3 * Math.PI / 2);
    g.closePath(); g.fill(); g.stroke();
    for (let k = 0; k < turns; k++) arc(x0 + k * pitch, -Math.PI / 2, Math.PI / 2, c.copper);
    // Bornes
    line(g, [[x0, cy - ry], [x0 - 18, cy - ry - 22], [x0 - 42, cy - ry - 22]], c.copper, 4);
    line(g, [[x1, cy - ry], [x1 + 18, cy - ry - 22], [x1 + 42, cy - ry - 22]], c.copper, 4);
    // Cotes
    dimension(g, x0, cy + ry + 22, x1, cy + ry + 22, c.ink);
    text(g, 'ℓ', (x0 + x1) / 2, cy + ry + 34, c.ink, 15, 'center', true);
    text(g, `N = ${p.N} spires (dessin : ${turns})`, x0, 296, c.muted, 12);
    // Étiquettes, à droite du solénoïde
    const lx = 420;
    label(g, lx, 28, x1 + 42, cy - ry - 22, 'Borne', 'le fil lui-même, décapé', c);
    label(g, lx, 76, x0 + (turns - 1) * pitch + pitch * 0.25 + rx, cy - ry * 0.3, 'Spire', 'cuivre émaillé : le vernis isole', c);
    label(g, lx, 124, x1 + 10 + rx * 0.72, cy + ry * 0.2, p.mur > 1.5 ? 'Noyau de ferrite' : 'Noyau d\'air', p.mur > 1.5 ? `canalise et renforce B (µᵣ = ${p.mur})` : 'rien à l\'intérieur (µᵣ = 1)', c);
    // Coupe : le sens du champ, spire par spire.
    const bx = 430, by = 190, bw = 270, bh = 92;
    text(g, 'Coupe : i sort en haut, entre en bas', bx, by - 11, c.ink, 13, 'left', true);
    g.strokeStyle = c.line; g.lineWidth = 1; g.strokeRect(bx, by, bw, bh);
    g.fillStyle = coreColor; g.fillRect(bx + 1, by + 16, bw - 2, bh - 32);
    for (let k = 0; k < 9; k++) {
      const x = bx + 23 + k * (bw - 46) / 8;
      for (const up of [true, false]) {
        const y = up ? by + 10 : by + bh - 10;
        g.fillStyle = c.copper; g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill();
        g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 1.6;
        if (up) { g.beginPath(); g.arc(x, y, 2.2, 0, 7); g.fill(); }
        else { g.beginPath(); g.moveTo(x - 3.6, y - 3.6); g.lineTo(x + 3.6, y + 3.6); g.moveTo(x + 3.6, y - 3.6); g.lineTo(x - 3.6, y + 3.6); g.stroke(); }
      }
    }
    // ⊙ en haut, ⊗ en bas : règle de la main droite, B va vers la droite.
    arrow(g, bx + 30, by + bh / 2 - 7, bx + bw - 30, by + bh / 2 - 7, p.mur > 1.5 ? '#7fe0c0' : c.field, 2.4, 10);
    arrow(g, bx + 30, by + bh / 2 + 9, bx + bw - 30, by + bh / 2 + 9, p.mur > 1.5 ? '#7fe0c0' : c.field, 2.4, 10);
    text(g, 'B uniforme à l\'intérieur, presque nul dehors', bx, by + bh + 15, c.muted, 12);
  }

  /** @param {HTMLCanvasElement} cv @param {any} p @param {any} m @param {any} s @param {Colors} c */
  function drawInductorScene(cv, p, m, s, c) {
    const { ctx: g } = prepare(cv, 800, 440);
    const { yT, yB, xJ, xP, xR2 } = FRAME;
    const cx = 610, a = 58, b = 13, yTop = 128, turns = 7, pitch = 28;
    const yBot = yTop + turns * pitch;
    const xW = cx - a;
    const k = flowScale(m);
    drawFrame(g, c, s.mode, m);
    line(g, [[xP, yT], [xW, yT], [xW, yTop]], c.wire);
    line(g, [[xW, yBot], [xW, yB], [xJ, yB]], c.wire);

    /** Hélice : φ ∈ (0, π) devant, de gauche à droite en descendant. Courant descendant → B vers le haut. */
    const pointAt = (/** @type {number} */ phi) => {
      const y = yTop + pitch * phi / (2 * Math.PI);
      return [cx - a * Math.cos(phi), y + b * Math.sin(phi), Math.sin(phi) >= 0 ? 1 : 0];
    };
    const drawHelix = (/** @type {boolean} */ front) => {
      g.strokeStyle = front ? c.copper : c.copperBack; g.lineWidth = 5;
      for (let t = 0; t < turns; t++) {
        g.beginPath();
        const from = t * 2 * Math.PI + (front ? 0 : Math.PI), to = from + Math.PI;
        for (let n = 0; n <= 18; n++) {
          const pt = pointAt(from + (to - from) * n / 18);
          if (n) g.lineTo(pt[0], pt[1]); else g.moveTo(pt[0], pt[1]);
        }
        g.stroke();
      }
    };
    const iFrac = Math.min(1, Math.abs(s.i) / (m.iRef || 1));
    // Arrière : spires, champ de retour, noyau.
    if (iFrac > 0.005) {
      g.globalAlpha = iFrac;
      for (const side of [-1, 1]) {
        for (const reach of [a + 40, a + 62]) {
          g.strokeStyle = c.field; g.lineWidth = 1.8;
          g.beginPath();
          g.moveTo(cx + side * 14, yTop - 12);
          g.bezierCurveTo(cx + side * reach * 0.9, yTop - 44, cx + side * reach * 1.15, yBot - 20, cx + side * 14, yBot + 14);
          g.stroke();
        }
        arrow(g, cx + side * (a + 49), (yTop + yBot) / 2 - 8, cx + side * (a + 49), (yTop + yBot) / 2 + 8, c.field, 1.8, 8);
      }
      g.globalAlpha = 1;
    }
    drawHelix(false);
    if (p.mur > 1.5) { g.fillStyle = c.ferrite; g.fillRect(cx - a * 0.7, yTop - 4, a * 1.4, yBot - yTop + 8); }
    else { g.fillStyle = c.air; g.fillRect(cx - a * 0.7, yTop - 4, a * 1.4, yBot - yTop + 8); }
    // Électrons dans l'hélice : ceux de l'arrière sont estompés.
    const helixPts = /** @type {number[][]} */ ([]);
    for (let n = turns * 40; n >= 0; n--) helixPts.push(pointAt(n / 40 * 2 * Math.PI));
    const flowAll = (s.flowGen + s.flowDis) * k;
    const helixPath = makePath(helixPts);
    const back = (/** @type {number[]} */ pt) => pt[2] ? 0 : 0.4;
    electrons(g, helixPath, flowAll, c, 46, back);
    // Champ à l'intérieur : vers le haut, pour ce sens d'enroulement.
    if (iFrac > 0.005) {
      g.globalAlpha = iFrac;
      for (const dx of [-24, 0, 24]) arrow(g, cx + dx, yBot + 14, cx + dx, yTop - 14, p.mur > 1.5 ? '#7fe0c0' : c.field, 2.2, 9);
      g.globalAlpha = 1;
      vector(g, 'B', cx + a + 24, yTop - 26, c.field);
    }
    drawHelix(true);
    // On redessine les électrons de devant au-dessus des spires.
    electrons(g, helixPath, flowAll, c, 46, (pt) => pt[2] ? 1 : 0);
    // Fils
    electrons(g, makePath([[xJ, yB], [xW, yB], [xW, yBot]]), flowAll, c);
    electrons(g, makePath([[xW, yTop], [xW, yT], [xP, yT]]), flowAll, c);
    electrons(g, makePath([[xJ, yT], [FRAME.xG, yT], [FRAME.xG, (yT + yB) / 2 - 10]]), s.flowGen * k, c);
    electrons(g, makePath([[FRAME.xG, (yT + yB) / 2 + 10], [FRAME.xG, yB], [xJ, yB]]), s.flowGen * k, c);
    electrons(g, makePath([[xJ, FRAME.yC2], [xJ, yB]]), s.flowDis * k, c);
    drawResistorBox(g, c, m.R);
    currentArrow(g, c, (xR2 + xW) / 2, yT, s.i, m.iRef);
    // f.é.m. d'auto-induction : une flèche de générateur, dans le sens où elle pousserait le courant.
    const emf = -s.u;
    const eFrac = Math.min(1, Math.abs(s.u) / (m.E || 1));
    const ex = xW - 22, eMid = (yTop + yBot) / 2;
    if (eFrac > 0.01) {
      // i descend dans la bobine : e > 0 pousse vers le bas ; ici e = −u (convention récepteur).
      const dir = emf > 0 ? 1 : -1, len = 18 + 44 * eFrac;
      arrow(g, ex, eMid - dir * len / 2, ex, eMid + dir * len / 2, c.accent, 3.5, 11);
    }
    text(g, 'u = ' + formatSI(s.u, 'V'), ex - 10, eMid + 58, c.ink, 13, 'right', true);
    text(g, 'e = −u = ' + formatSI(emf, 'V'), ex - 10, eMid + 77, c.accent, 13, 'right', true);
    const msg = captionInductor(s, m);
    msg.forEach((t, i) => text(g, t, 278, 170 + i * 19, i ? c.muted : c.ink, 13, 'left', !i));
    legendElectron(g, c, 20, 425);
  }
  /** @param {any} s @param {any} m */
  function captionInductor(s, m) {
    const iNorm = m.iRef ? Math.abs(s.i) / m.iRef : 0;
    if (s.mode === 'charge' && iNorm < 0.98) return ['B augmente : la f.é.m.', '(flèche) freine le courant,', 'qui monte sans sauter.'];
    if (s.mode === 'charge') return ['i et B sont constants :', 'plus de f.é.m., la bobine', 'est un simple fil.'];
    if (s.mode === 'discharge' && iNorm > 0.02) return ['Pas de saut : B baisse,', 'la f.é.m. (flèche) pousse', 'le courant dans le même sens.'];
    if (s.mode === 'discharge') return ['i = 0 et B = 0 :', 'l\'énergie magnétique', 's\'est dissipée dans R.'];
    return ['Interrupteur ouvert :', 'aucun courant,', 'aucun champ.'];
  }

  // ---------------------------------------------------------------- Résistance

  /** @param {HTMLCanvasElement} cv @param {any} p @param {any} m @param {Colors} c */
  function drawResistorParts(cv, p, m, c) {
    const { ctx: g } = prepare(cv, 720, 320);
    const x0 = 56, x1 = 330, cy = 118, ry = 44;
    // Connexions
    line(g, [[10, cy], [x0, cy]], c.metalDark, 5);
    line(g, [[x1, cy], [x1 + 44, cy]], c.metalDark, 5);
    // Corps
    const grad = g.createLinearGradient(0, cy - ry, 0, cy + ry);
    grad.addColorStop(0, c.bodyDark); grad.addColorStop(0.28, c.body); grad.addColorStop(1, c.bodyDark);
    g.fillStyle = grad;
    g.beginPath(); g.roundRect(x0 + 34, cy - ry + 6, x1 - x0 - 68, 2 * ry - 12, 6); g.fill();
    // Capuchons
    const cap = g.createLinearGradient(0, cy - ry, 0, cy + ry);
    cap.addColorStop(0, c.metalDark); cap.addColorStop(0.3, c.metalLight); cap.addColorStop(1, c.metalDark);
    g.fillStyle = cap;
    g.beginPath(); g.roundRect(x0, cy - ry, 44, 2 * ry, 12); g.fill();
    g.beginPath(); g.roundRect(x1 - 44, cy - ry, 44, 2 * ry, 12); g.fill();
    // Anneaux
    const code = D.colorCode(m.R);
    if (code) {
      const colors = [bandColor(code.digits[0]), bandColor(code.digits[1]), bandColor(code.mult), GOLD];
      [106, 124, 142, 212].forEach((x, i) => {
        g.fillStyle = colors[i];
        g.fillRect(x - 6 + 0, cy - ry + 6, 12, 2 * ry - 12);
      });
    }
    // Vue en coupe : le film entaillé en hélice sur le cœur en céramique.
    const wx = 234, wy = cy - ry + 6, ww = 52, wh = 2 * ry - 12;
    g.save();
    g.beginPath(); g.rect(wx, wy, ww, wh); g.clip();
    g.fillStyle = c.ceramic; g.fillRect(wx, wy, ww, wh);
    g.strokeStyle = c.film; g.lineWidth = 7;
    for (let x = wx - wh; x < wx + ww + wh; x += 13) { g.beginPath(); g.moveTo(x, wy + wh); g.lineTo(x + wh * 0.42, wy); g.stroke(); }
    g.restore();
    g.strokeStyle = c.muted; g.setLineDash([3, 3]); g.lineWidth = 1; g.strokeRect(wx, wy, ww, wh); g.setLineDash([]);
    // Étiquettes
    label(g, 44, 210, x0 + 22, cy + ry - 8, 'Capuchon', 'contact métallique avec le film', c);
    label(g, 44, 256, 26, cy + 2, 'Connexion', 'fil soudé au capuchon', c);
    label(g, 240, 196, wx + ww / 2, wy + wh - 4, 'Film entaillé en hélice', '', c);
    text(g, 'carbone ou métal, sur céramique', 240, 212, c.muted, 12);
    label(g, 240, 246, 170, cy + ry - 8, 'Enrobage', 'vernis isolant', c);
    if (code) {
      const names = [bandName(code.digits[0]), bandName(code.digits[1]), bandName(code.mult), 'or (± 5 %)'];
      text(g, 'Anneaux : ' + names.join(', '), 56, 42, c.ink, 13, 'left', true);
      text(g, `${code.digits[0]}${code.digits[1]} × 10${sup(code.mult)} = ${formatSI(code.value, 'Ω', 2)}`, 56, 60, c.muted, 12);
    } else {
      text(g, 'Sous 0,1 Ω, pas de code des couleurs usuel', 56, 42, c.ink, 13, 'left', true);
      text(g, 'Ce serait plutôt un simple fil.', 56, 60, c.muted, 12);
    }
    // Le trajet déroulé : L et S de la formule.
    const bx = 470, by = 74;
    const lenPx = 90 + 120 * Math.log10(p.L / 2e-3) / Math.log10(25);
    const hPx = 14 + 38 * Math.log10(p.S / 1e-10) / 3;
    text(g, 'Le film déroulé : un long ruban', bx, 26, c.ink, 13, 'left', true);
    const depth = 16 + hPx * 0.3;
    g.fillStyle = c.film;
    g.fillRect(bx, by + 12, lenPx, hPx);
    g.fillStyle = c.dark ? '#6a655c' : '#5f5a52';
    g.beginPath(); g.moveTo(bx, by + 12); g.lineTo(bx + depth, by + 12 - depth * 0.6); g.lineTo(bx + lenPx + depth, by + 12 - depth * 0.6); g.lineTo(bx + lenPx, by + 12); g.closePath(); g.fill();
    g.fillStyle = c.dark ? '#7a756b' : '#4a463f';
    g.beginPath(); g.moveTo(bx + lenPx, by + 12); g.lineTo(bx + lenPx + depth, by + 12 - depth * 0.6); g.lineTo(bx + lenPx + depth, by + 12 - depth * 0.6 + hPx); g.lineTo(bx + lenPx, by + 12 + hPx); g.closePath(); g.fill();
    dimension(g, bx, by + 12 + hPx + 14, bx + lenPx, by + 12 + hPx + 14, c.ink);
    text(g, 'L', bx + lenPx / 2, by + 12 + hPx + 26, c.ink, 15, 'center', true);
    text(g, 'S', bx + lenPx + depth + 8, by + 12 + hPx / 2 - depth * 0.3, c.ink, 15, 'left', true);
    text(g, 'Plus long ou plus fin : plus résistant.', bx, 206, c.muted, 12);
    text(g, 'L\'entaille allonge le trajet sans', bx, 228, c.muted, 12);
    text(g, 'agrandir le composant.', bx, 244, c.muted, 12);
    text(g, p.material === 'cuivre' ? 'Le cuivre conduit trop : il sert aux fils.' : p.material === 'nichrome' ? 'Le nichrome : stable et précis.' : 'Le carbone : courant et bon marché.', bx, 266, c.muted, 12);
  }

  /**
   * Agitation dans le matériau : modèle de Drude, à vitesse thermique et champ très exagérés.
   * Chaque électron accélère à l'opposé du champ, puis repart au hasard après un choc sur un ion.
   */
  class Drude {
    constructor(box) {
      this.box = box;
      /** @type {{ x: number, y: number, hit: number }[]} */
      this.ions = [];
      const cols = 9, rows = 4;
      for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
        this.ions.push({ x: box.x + (q + 0.5 + (r % 2) * 0.18) * box.w / cols, y: box.y + (r + 0.5) * box.h / rows, hit: 0 });
      }
      this.electrons = [];
      for (let k = 0; k < 18; k++) {
        const a = Math.random() * 7;
        this.electrons.push({ x: box.x + Math.random() * box.w, y: box.y + (Math.floor(Math.random() * 3) + 1) * box.h / 4, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90 });
      }
    }
    /** @param {number} dt @param {number} accel accélération vers −x @param {number} ionR @param {number} heat */
    step(dt, accel, ionR, heat) {
      const { x, y, w, h } = this.box;
      const v0 = 90 + 40 * heat;
      for (const ion of this.ions) ion.hit = Math.max(0, ion.hit - dt * 3);
      for (const e of this.electrons) {
        e.vx -= accel * dt;
        e.x += e.vx * dt; e.y += e.vy * dt;
        if (e.y < y + 5) { e.y = y + 5; e.vy = Math.abs(e.vy); }
        if (e.y > y + h - 5) { e.y = y + h - 5; e.vy = -Math.abs(e.vy); }
        if (e.x < x) e.x += w; else if (e.x > x + w) e.x -= w;
        for (const ion of this.ions) {
          const dx = e.x - ion.x, dy = e.y - ion.y, d = Math.hypot(dx, dy);
          if (d < ionR + 4) {
            // Le choc cède l'énergie gagnée au réseau : c'est l'effet Joule.
            const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 2.2;
            e.vx = Math.cos(a) * v0; e.vy = Math.sin(a) * v0;
            e.x = ion.x + (ionR + 5) * Math.cos(a); e.y = ion.y + (ionR + 5) * Math.sin(a);
            if (accel > 0) ion.hit = 1;
            break;
          }
        }
      }
    }
  }

  /** @param {HTMLCanvasElement} cv @param {any} p @param {any} m @param {any} s @param {Drude} drude @param {Colors} c */
  function drawResistorScene(cv, p, m, s, drude, c) {
    const { ctx: g } = prepare(cv, 800, 440);
    const yT = 42, yB = 138, xG = 62, xR1 = 330, xR2 = 530, xRight = 720, xK1 = 180, xK2 = 240;
    const closed = s.mode === 'charge';
    // Circuit
    line(g, [[xK1, yT], [xG, yT], [xG, 82]], c.wire);
    line(g, [[xG, 98], [xG, yB], [xRight, yB], [xRight, yT], [xR2, yT]], c.wire);
    line(g, [[xK2, yT], [xR1, yT]], c.wire);
    line(g, [[xG - 18, 82], [xG + 18, 82]], c.ink, 3);
    line(g, [[xG - 9, 98], [xG + 9, 98]], c.ink, 5);
    text(g, 'U = ' + formatSI(p.U, 'V'), xG + 28, 90, c.ink, 13);
    text(g, '+', xG + 22, 70, c.pos, 15, 'left', true);
    line(g, [[xK2, yT], closed ? [xK1, yT] : [xK1 + 8, yT - 22]], c.ink, 3);
    for (const x of [xK1, xK2]) {
      g.fillStyle = c.panel; g.strokeStyle = c.ink; g.lineWidth = 2;
      g.beginPath(); g.arc(x, yT, 4.5, 0, 7); g.fill(); g.stroke();
    }
    text(g, 'K', (xK1 + xK2) / 2, yT + 18, c.ink, 13, 'center', true);
    // Électrons dans les fils, à l'inverse de i.
    const vis = Math.min(1, Math.log10(1 + 9 * Math.min(10, s.i / 0.05)) / Math.log10(91)) * 60 * 0.5;
    const shift = s.flow * vis;
    electrons(g, makePath([[xR1, yT], [xK2, yT]]), shift, c);
    electrons(g, makePath([[xK1, yT], [xG, yT], [xG, 80]]), shift, c);
    electrons(g, makePath([[xG, 100], [xG, yB], [xRight, yB], [xRight, yT], [xR2, yT]]), shift, c);
    // Résistance : la couleur suit le potentiel, de V = U à V = 0.
    const grad = g.createLinearGradient(xR1, 0, xR2, 0);
    if (closed) { grad.addColorStop(0, c.pos); grad.addColorStop(1, c.neg); }
    else { grad.addColorStop(0, c.mid); grad.addColorStop(1, c.mid); }
    g.fillStyle = grad;
    g.beginPath(); g.roundRect(xR1, yT - 15, xR2 - xR1, 30, 5); g.fill();
    text(g, 'R = ' + formatSI(m.R, 'Ω'), (xR1 + xR2) / 2, yT, '#fff', 13, 'center', true);
    if (closed) {
      text(g, 'V = U', xR1 - 4, yT - 25, c.pos, 12, 'left', true);
      text(g, 'V = 0', xR2 + 4, yT - 25, c.neg, 12, 'right', true);
    }
    currentArrow(g, c, 615, yT, s.i, m.iRef);
    // Loupe
    const box = drude.box;
    g.setLineDash([4, 4]);
    line(g, [[xR1, yT + 15], [box.x, box.y - 22]], c.muted, 1);
    line(g, [[xR2, yT + 15], [box.x + box.w, box.y - 22]], c.muted, 1);
    g.setLineDash([]);
    const heat = Math.min(1, s.dT / 150);
    g.fillStyle = c.panel2; g.fillRect(box.x, box.y, box.w, box.h);
    if (heat > 0) { g.fillStyle = `rgba(226, 80, 30, ${0.22 * heat})`; g.fillRect(box.x, box.y, box.w, box.h); }
    g.strokeStyle = c.line; g.lineWidth = 1; g.strokeRect(box.x, box.y, box.w, box.h);
    text(g, `Dans le ${m.material.name.toLowerCase()} : ions fixes, électrons libres`, box.x, box.y - 11, c.ink, 13, 'left', true);
    // Ions : ils vibrent davantage quand le matériau chauffe.
    const ionR = m.material.ionR;
    const t = performance.now() / 1000;
    const jitter = 0.4 + 3.2 * heat;
    drude.ions.forEach((ion, n) => {
      const jx = Math.sin(t * 31 + n * 1.7) * jitter, jy = Math.cos(t * 37 + n * 2.3) * jitter;
      if (ion.hit > 0) {
        g.fillStyle = `rgba(240, 130, 40, ${0.55 * ion.hit})`;
        g.beginPath(); g.arc(ion.x + jx, ion.y + jy, ionR + 9, 0, 7); g.fill();
      }
      plusCharge(g, ion.x + jx, ion.y + jy, c, ionR);
    });
    for (const e of drude.electrons) electron(g, e.x, e.y, c, 4.5);
    // Champ et sens de dérive, sous la loupe.
    const by = box.y + box.h + 15;
    if (closed) {
      arrow(g, box.x + 8, by, box.x + 64, by, c.field, 2.4, 9);
      vector(g, 'E', box.x + 72, by + 1, c.field);
      arrow(g, box.x + box.w - 8, by, box.x + box.w - 64, by, c.neg, 2.4, 9);
      text(g, 'dérive des électrons', box.x + box.w - 72, by, c.muted, 12, 'right');
      text(g, 'chaque choc chauffe le réseau', (box.x + box.w) / 2 + 10, by, c.ink, 12, 'center', true);
    } else {
      text(g, 'Sans champ : agitation désordonnée, aucun déplacement d\'ensemble, donc i = 0.', box.x, by, c.muted, 12);
    }
    text(g, 'Mouvements très exagérés : dans un fil de cuivre, la dérive réelle ne dépasse guère le mm/s.', box.x, by + 18, c.muted, 12);
  }

  // ---------------------------------------------------------------- Contenu des trois fiches

  const fmtFr = (/** @type {number} */ v, /** @type {number} */ d = 3) => Number(v.toPrecision(d)).toString().replace('.', ',');

  const PAGES = {
    capacitor: {
      tab: 'Condensateur',
      question: 'Deux plaques de métal séparées par un isolant : il stocke des charges, donc de l\'énergie électrique.',
      params: { S: 1e-2, e: 1e-5, er: 3, R: 1e4, E: 10 },
      sliders: [
        { key: 'S', label: 'Surface en regard S', min: 2e-3, max: 4e-2, log: true, show: (/** @type {number} */ v) => fmtFr(v * 1e4) + ' cm²' },
        { key: 'e', label: 'Épaisseur de l\'isolant e', min: 5e-6, max: 1e-4, log: true, show: (/** @type {number} */ v) => fmtFr(v * 1e6) + ' µm' },
        { key: 'er', label: 'Permittivité relative εᵣ', min: 1, max: 10, step: 0.1, show: (/** @type {number} */ v) => fmtFr(v, 2) },
        { key: 'R', label: 'Résistance R du circuit', min: 1e2, max: 1e5, log: true, show: (/** @type {number} */ v) => formatSI(v, 'Ω', 2) },
        { key: 'E', label: 'Tension E du générateur', min: 1, max: EMAX, step: 0.5, show: (/** @type {number} */ v) => fmtFr(v) + ' V' },
      ],
      build: D.capacitor,
      formula: (/** @type {any} */ m) => ['C = ε₀εᵣS / e = ' + formatSI(m.C, 'F'), 'τ = RC = ' + formatSI(m.tau, 's')],
      moves: [{ mode: 'charge', label: 'Charger', title: 'K en position 1 : relie le condensateur au générateur' }, { mode: 'open', label: 'Ouvrir', title: 'K ouvert : isole le condensateur' }, { mode: 'discharge', label: 'Décharger', title: 'K en position 2 : referme le condensateur sur R' }],
      parts: drawCapacitorParts,
      scene: drawCapacitorScene,
      series: [
        { name: 'u', unit: 'V', color: 's1', get: (/** @type {any} */ s) => s.u, ref: (/** @type {any} */ m) => m.E },
        { name: 'i', unit: 'A', color: 's2', get: (/** @type {any} */ s) => s.i, ref: (/** @type {any} */ m) => m.iRef },
      ],
      values: (/** @type {any} */ s) => [['Tension u', formatSI(s.u, 'V')], ['Courant i', formatSI(s.i, 'A')], ['Charge q', formatSI(s.q, 'C')], ['Électrons déplacés', fmtElectrons(s.q)], ['Énergie ½Cu²', formatSI(s.energy, 'J')]],
      story: storyCapacitor,
      recall: ['i = C du/dt : le courant mesure la vitesse à laquelle u change.', 'u est continue : à t = 0⁺, un condensateur déchargé se comporte comme un fil.', 'En régime permanent continu, i = 0 : il se comporte comme un interrupteur ouvert.', 'Aucune charge ne traverse l\'isolant : le courant « passe » par influence.'],
    },
    inductor: {
      tab: 'Bobine',
      question: 'Un fil enroulé : le courant y crée un champ magnétique, qui stocke de l\'énergie et s\'oppose à toute variation de ce courant.',
      params: { N: 500, l: 0.05, S: 5e-4, mur: 1, R: 100, E: 10 },
      sliders: [
        { key: 'N', label: 'Nombre de spires N', min: 50, max: 2000, log: true, round: true, show: (/** @type {number} */ v) => String(Math.round(v)) },
        { key: 'l', label: 'Longueur ℓ', min: 0.02, max: 0.2, log: true, show: (/** @type {number} */ v) => fmtFr(v * 100) + ' cm' },
        { key: 'S', label: 'Section S', min: 1e-4, max: 5e-3, log: true, show: (/** @type {number} */ v) => fmtFr(v * 1e4) + ' cm²' },
        { key: 'mur', label: 'Noyau : perméabilité µᵣ', min: 1, max: 500, log: true, round: true, show: (/** @type {number} */ v) => String(Math.round(v)) + (v < 1.5 ? ' (air)' : ' (ferrite)') },
        { key: 'R', label: 'Résistance R du circuit', min: 10, max: 1e3, log: true, show: (/** @type {number} */ v) => formatSI(v, 'Ω', 2) },
        { key: 'E', label: 'Tension E du générateur', min: 1, max: EMAX, step: 0.5, show: (/** @type {number} */ v) => fmtFr(v) + ' V' },
      ],
      build: D.inductor,
      formula: (/** @type {any} */ m) => ['L = µ₀µᵣN²S / ℓ = ' + formatSI(m.L, 'H'), 'τ = L/R = ' + formatSI(m.tau, 's')],
      moves: [{ mode: 'charge', label: 'Établir le courant', title: 'K en position 1 : relie la bobine au générateur' }, { mode: 'discharge', label: 'Roue libre', title: 'K en position 2 : referme la bobine sur R, sans couper le courant' }],
      parts: drawInductorParts,
      scene: drawInductorScene,
      series: [
        { name: 'i', unit: 'A', color: 's2', get: (/** @type {any} */ s) => s.i, ref: (/** @type {any} */ m) => m.iRef },
        { name: 'u', unit: 'V', color: 's1', get: (/** @type {any} */ s) => s.u, ref: (/** @type {any} */ m) => m.E },
      ],
      values: (/** @type {any} */ s) => [['Courant i', formatSI(s.i, 'A')], ['Tension u = L di/dt', formatSI(s.u, 'V')], ['Champ B sur l\'axe', formatSI(s.B, 'T')], ['Énergie ½Li²', formatSI(s.energy, 'J')]],
      story: storyInductor,
      recall: ['u = L di/dt : une variation de courant induit une tension.', 'i est continu : à t = 0⁺, une bobine sans courant se comporte comme un interrupteur ouvert.', 'En régime permanent continu, u = 0 : elle se comporte comme un fil.', 'Couper brutalement le courant est dangereux : di/dt énorme, donc surtension et étincelle.'],
    },
    resistor: {
      tab: 'Résistance',
      question: 'Un matériau moyennement conducteur : les électrons y perdent à chaque choc l\'énergie gagnée, qui devient de la chaleur. Rien n\'est stocké.',
      params: { material: 'carbone', L: 0.01, S: 3.5e-9, U: 5 },
      sliders: [
        { key: 'material', label: 'Matériau', options: Object.entries(D.MATERIALS).map(([k, v]) => [k, `${v.name} (ρ = ${formatSI(v.rho, 'Ω·m', 2)})`]) },
        { key: 'L', label: 'Longueur du trajet L', min: 2e-3, max: 5e-2, log: true, show: (/** @type {number} */ v) => fmtFr(v * 1e3) + ' mm' },
        { key: 'S', label: 'Section S', min: 1e-10, max: 1e-7, log: true, show: (/** @type {number} */ v) => fmtFr(v * 1e12) + ' µm²' },
        { key: 'U', label: 'Tension U', min: 0.5, max: 20, step: 0.5, show: (/** @type {number} */ v) => fmtFr(v) + ' V' },
      ],
      build: D.resistor,
      formula: (/** @type {any} */ m) => ['R = ρL / S = ' + formatSI(m.R, 'Ω'), 'P = U²/R = ' + formatSI(m.P, 'W') + ' sous tension'],
      moves: [{ mode: 'charge', label: 'Fermer K', title: 'Applique la tension à la résistance' }, { mode: 'open', label: 'Ouvrir K', title: 'Coupe le circuit' }],
      parts: drawResistorParts,
      scene: drawResistorScene,
      series: [
        { name: 'i', unit: 'A', color: 's2', get: (/** @type {any} */ s) => s.i, ref: (/** @type {any} */ m) => m.iRef },
        { name: 'Échauffement ΔT', unit: 'K', color: 's1', get: (/** @type {any} */ s) => s.dT, ref: (/** @type {any} */ m) => Math.min(D.DT_MAX, m.rth * m.P) },
      ],
      values: (/** @type {any} */ s) => [['Tension u', formatSI(s.u, 'V')], ['Courant i = u/R', formatSI(s.i, 'A')], ['Puissance dissipée', formatSI(s.power, 'W')], ['Échauffement ΔT', s.dT >= D.DT_MAX ? `≥ ${D.DT_MAX} K : détruite` : fmtFr(s.dT, 3) + ' K']],
      story: storyResistor,
      recall: ['u = R i à chaque instant : ni mémoire, ni retard, ni stockage.', 'Le potentiel chute régulièrement le long du matériau, et le courant y est le même partout.', 'P = R i² : toute l\'énergie reçue devient de la chaleur.', 'Le seul retard est thermique, sans effet ici sur le circuit : R est supposée constante.'],
    },
  };

  /** @param {number} q */
  function fmtElectrons(q) {
    const n = q / 1.602e-19;
    if (n < 1) return '0';
    const e = Math.floor(Math.log10(n));
    return `${fmtFr(n / Math.pow(10, e), 2)} × 10${sup(e)}`;
  }

  /** @param {any} s @param {any} m @returns {[string, string]} */
  function storyCapacitor(s, m) {
    const x = s.since / m.tau;
    if (s.mode === 'charge') {
      if (s.u < 0.02 * m.E) return ['Démarrage : il se comporte comme un fil', `Pas encore de charge, donc pas de champ ni de tension : u ≈ 0. Toute la tension E s'applique à R, et i = E/R = ${formatSI(m.iRef, 'A')} d'emblée. Les électrons partent de l'armature du haut sans rien pour les retenir et s'accumulent sur celle du bas.`];
      if (x < 4) return ['Charge : u monte, i diminue', `Les charges accumulées créent un champ qui repousse les suivantes : u grandit, il reste moins de tension pour R, donc i baisse. Après τ = ${formatSI(m.tau, 's')}, u atteint 63 % de E.`];
      return ['Chargé : il se comporte comme un interrupteur ouvert', `u = E : la tension du condensateur équilibre celle du générateur. Plus aucun courant. L'énergie ½Cu² est stockée dans le champ, entre les armatures.`];
    }
    if (s.mode === 'discharge') {
      if (x < 0.02 && s.q > 0) return ['Décharge : u n\'a pas sauté', `À la manœuvre, u garde sa valeur : le condensateur devient un générateur et impose i = −u/R. Le courant change de sens dès cet instant.`];
      if (x < 4 && s.q > 0.01 * m.xFull) return ['Décharge : les électrons reviennent', `Le champ repousse les électrons en excès de l'armature du bas : ils retournent par le fil vers le haut. Moins de charge, donc moins de tension, donc moins de courant : u décroît en e^(−t/τ).`];
      return ['Déchargé', `Armatures à nouveau neutres, u = 0. L'énergie stockée s'est dissipée en chaleur dans R.`];
    }
    if (s.q > 0.01 * m.xFull) return ['Isolé : il garde sa charge', `Aucun chemin pour les électrons, et l'isolant les empêche de traverser : q et u ne changent plus. C'est sa fonction de mémoire. Un vrai condensateur fuit lentement, ce que ce modèle idéal néglige.`];
    return ['Déchargé, K ouvert', `Chaque armature contient autant de charges + que de − : aucun champ, u = 0. Cliquez sur « Charger ».`];
  }
  /** @param {any} s @param {any} m @returns {[string, string]} */
  function storyInductor(s, m) {
    const x = s.since / m.tau, frac = Math.abs(s.i) / m.iRef;
    if (s.mode === 'charge') {
      if (frac < 0.02) return ['Démarrage : elle se comporte comme un interrupteur ouvert', `Le courant ne peut pas sauter : i ≈ 0, et rien ne chute dans R. Toute la tension E est donc aux bornes de la bobine, ce qui fixe la pente di/dt = E/L. Le champ naissant induit une f.é.m. qui s'oppose à sa propre cause (loi de Lenz).`];
      if (frac < 0.98) return ['Établissement : i monte, u diminue', `Plus i grandit, plus R prend de tension : il en reste moins pour la bobine, et i monte de moins en moins vite. Après τ = ${formatSI(m.tau, 's')}, i atteint 63 % de E/R.`];
      return ['Établi : elle se comporte comme un fil', `i = E/R reste constant, B aussi : plus de variation de flux, donc plus de f.é.m. et u = 0. L'énergie ½Li² est stockée dans le champ magnétique.`];
    }
    if (s.mode === 'discharge') {
      if (x < 0.02 && frac > 0.01) return ['Roue libre : i n\'a pas sauté', `À la manœuvre, i garde sa valeur et son sens. La tension u, elle, saute et change de signe : u = −R i. La bobine devient le générateur du circuit.`];
      if (frac > 0.02) return ['Roue libre : le champ se vide', `B diminue, et la f.é.m. induite tente de maintenir le courant (loi de Lenz) : elle pousse maintenant dans le sens de i. Les électrons continuent dans le même sens, de plus en plus lentement.`];
      return ['Courant éteint', `L'énergie magnétique ½Li² s'est dissipée en chaleur dans R.`];
    }
    return ['K ouvert, aucun courant', `Pas de courant, pas de champ. Cliquez sur « Établir le courant ». Il n'y a pas de bouton « Ouvrir » une fois le courant établi : le couper exigerait di/dt infini. Essayez le circuit « Coupure de bobine » de la bibliothèque.`];
  }
  /** @param {any} s @param {any} m @returns {[string, string]} */
  function storyResistor(s, m) {
    if (s.mode !== 'charge') {
      if (s.dT > 1) return ['K ouvert : le courant cesse aussitôt', `Sans champ, plus de dérive : i = 0 sans aucun délai. Seule la température met du temps à revenir, l'agitation restant désordonnée.`];
      return ['K ouvert : agitation sans courant', `Les électrons libres s'agitent en tous sens, mais autant vers la gauche que vers la droite : le courant moyen est nul.`];
    }
    if (m.P > 10) return ['Elle grillerait', `P = ${formatSI(m.P, 'W')} : un composant de ce format ne dissipe qu'environ ${fmtFr(m.nominal)} W. Un générateur réel limiterait le courant, et la résistance brûlerait. Le dessin n'en montre que le début.`];
    if (m.P > m.nominal * 1.02) return ['Trop de puissance pour ce format', `P = ${formatSI(m.P, 'W')} dépasse les ${fmtFr(m.nominal)} W d'un composant courant. Échauffement final calculé : ${fmtFr(m.rth * m.P)} K. Il faudrait un boîtier plus gros.`];
    if (s.since < 0.5) return ['Fermeture : i s\'établit sans délai', `Rien à charger, rien à magnétiser : i = U/R dès la fermeture. Le champ s'établit partout dans le matériau, et tous les électrons commencent aussitôt à dériver.`];
    return ['Sous tension : u = R i, et la chaleur monte', `Le champ accélère les électrons, les chocs sur les ions leur reprennent cette énergie : leur vitesse moyenne reste constante, d'où i ∝ U. Le réseau vibre davantage : c'est l'effet Joule.`];
  }

  // ---------------------------------------------------------------- Vue

  const view = {
    /** @type {keyof typeof PAGES} */
    page: 'capacitor',
    /** @type {Record<string, any>} */
    params: {},
    /** @type {any} */
    model: null,
    tNow: 0,
    dir: 1,
    playing: false,
    rate: 1,
    /** @type {number | null} */
    hover: null,
    range: { lo: 0, hi: 1 },
    visible: false,
    partsDirty: true,
    lastFrame: 0,
    /** @type {any} */
    dom: {},
    /** @type {Drude | null} */
    drude: null,
    colors: /** @type {Colors | null} */ (null),
  };
  for (const k of Object.keys(PAGES)) view.params[k] = Object.assign({}, PAGES[/** @type {keyof typeof PAGES} */ (k)].params);

  function rebuild() {
    const page = PAGES[view.page];
    view.model = page.build(view.params[view.page]);
    view.tNow = 0;
    view.partsDirty = true;
    // La résistance s'anime dès l'ouverture : l'agitation thermique existe sans courant.
    view.playing = view.page === 'resistor';
    view.dir = 1;
  }
  const autoRate = () => view.model.tau / 2;

  function setRate(/** @type {number} */ r) {
    view.rate = r;
    view.dom.rate.value = String(Math.log10(r));
    updateRateOut();
  }

  function updateRateOut() {
    const onScreen = view.model.tau / view.rate;
    view.dom.rateOut.textContent = `1 s = ${formatSI(view.rate, 's', 2)} · τ dure ${formatSI(onScreen, 's', 2)} à l'écran`;
  }

  function buildPage() {
    const page = PAGES[view.page];
    const root_ = view.dom.body;
    root_.textContent = '';
    rebuild();
    const P = view.params[view.page];
    const partsCv = h('canvas', { class: 'an-parts', ariaLabel: `Architecture : ${page.tab.toLowerCase()}`, role: 'img' });
    const sceneCv = h('canvas', { class: 'an-scene', ariaLabel: 'Animation de son fonctionnement dans un circuit', role: 'img' });
    const chartsCv = h('canvas', { class: 'an-charts', ariaLabel: 'Courbes en fonction du temps' });
    const formula = h('div', { class: 'an-formula' });
    const controls = h('div', { class: 'an-controls' });
    for (const def of page.sliders) controls.append(buildControl(def, P));
    const moves = h('div', { class: 'an-moves' });
    const moveBtns = page.moves.map((mv) => {
      const b = h('button', { text: mv.label, title: mv.title, onclick: () => manoeuvre(mv.mode) });
      b.dataset.mode = mv.mode;
      moves.append(b);
      return b;
    });
    const timeline = h('input', { type: 'range', class: 'timeline', min: '0', max: '1000', value: '0', step: '1', ariaLabel: 'Position dans le temps' });
    timeline.addEventListener('input', () => {
      view.playing = false;
      view.tNow = view.model.history.tMax * +timeline.value / 1000;
      syncTransport();
      draw();
    });
    const rate = h('input', { type: 'range', min: '-7', max: '2', step: '0.01', ariaLabel: 'Vitesse de lecture' });
    const rateOut = h('output');
    rate.addEventListener('input', () => setRate(Math.pow(10, +rate.value)));
    const back = h('button', { text: '◀', title: 'Lecture arrière', ariaLabel: 'Lecture arrière', onclick: () => { view.dir = -1; view.playing = view.tNow > 0; syncTransport(); } });
    const pause = h('button', { text: '❚❚', title: 'Pause', ariaLabel: 'Pause', onclick: () => { view.playing = false; syncTransport(); } });
    const fwd = h('button', { text: '▶', title: 'Lecture avant', ariaLabel: 'Lecture avant', onclick: () => { view.dir = 1; view.playing = true; syncTransport(); } });
    const reset = h('button', { text: 'Recommencer', title: 'Revenir à t = 0, K ouvert', onclick: () => { rebuild(); syncTransport(); draw(); } });
    const auto = h('button', { text: 'Auto', title: 'Régler la vitesse : τ dure 2 s à l\'écran', onclick: () => setRate(autoRate()) });
    const readout = h('output', { class: 'an-time' });
    const storyTitle = h('strong');
    const storyText = h('p');
    const story = h('div', { class: 'an-story', role: 'status' }, storyTitle, storyText);
    const values = h('dl', { class: 'values an-values' });
    const recall = h('ul', { class: 'an-recall' }, ...page.recall.map((t) => h('li', { text: t })));

    root_.append(
      h('p', { class: 'an-lead', text: page.question }),
      h('div', { class: 'an-grid' },
        h('section', { class: 'an-card an-card-parts' }, h('h2', { text: 'Architecture' }), h('div', { class: 'an-wide' }, partsCv)),
        h('section', { class: 'an-card' }, h('h2', { text: 'Ses dimensions fixent sa valeur' }), formula, controls),
        h('section', { class: 'an-card an-card-scene' },
          h('h2', { text: 'Dans un circuit' }),
          h('div', { class: 'an-transport' }, moves, h('span', { class: 'sep' }), h('div', { class: 'play' }, back, pause, fwd), readout, timeline),
          h('div', { class: 'an-wide' }, sceneCv),
          h('div', { class: 'an-transport' }, h('div', { class: 'speed' }, h('label', { text: 'Vitesse' }), rate, rateOut, auto), reset),
        ),
        h('section', { class: 'an-card' }, h('h2', { text: 'Que se passe-t-il ?' }), story, values, chartsCv),
        h('section', { class: 'an-card an-card-recall' }, h('h2', { text: 'À retenir' }), recall),
      ),
    );
    Object.assign(view.dom, { partsCv, sceneCv, chartsCv, formula, timeline, rate, rateOut, moveBtns, back, pause, fwd, readout, storyTitle, storyText, values });
    view.drude = view.page === 'resistor' ? new Drude({ x: 40, y: 190, w: 720, h: 190 }) : null;
    setRate(autoRate());
    chartsCv.addEventListener('pointermove', (e) => { view.hover = chartTime(e); draw(); });
    chartsCv.addEventListener('pointerleave', () => { view.hover = null; draw(); });
    chartsCv.addEventListener('click', (e) => {
      const t = chartTime(e);
      view.playing = false;
      view.tNow = Math.max(0, Math.min(view.model.history.tMax, t));
      syncTransport();
      draw();
    });
    updateFormula();
    syncTransport();
    draw();
  }
  /** @param {PointerEvent | MouseEvent} e */
  function chartTime(e) {
    const r = view.dom.chartsCv.getBoundingClientRect();
    return view.range.lo + (e.clientX - r.left - 54) / (r.width - 66) * (view.range.hi - view.range.lo);
  }

  /** @param {any} def @param {any} P */
  function buildControl(def, P) {
    const id = 'an-' + view.page + '-' + def.key;
    if (def.options) {
      const sel = h('select', { id }, ...def.options.map(([v, t]) => h('option', { value: v, text: t })));
      sel.value = P[def.key];
      sel.addEventListener('change', () => { P[def.key] = sel.value; changed(); });
      return h('div', { class: 'field' }, h('label', { text: def.label, htmlFor: id }), sel);
    }
    const out = h('output', { class: 'an-out', text: def.show(P[def.key]) });
    const input = h('input', { id, type: 'range' });
    if (def.log) {
      input.min = '0'; input.max = '1'; input.step = '0.002';
      input.value = String(Math.log(P[def.key] / def.min) / Math.log(def.max / def.min));
    } else {
      input.min = String(def.min); input.max = String(def.max); input.step = String(def.step);
      input.value = String(P[def.key]);
    }
    input.addEventListener('input', () => {
      let v = def.log ? def.min * Math.pow(def.max / def.min, +input.value) : +input.value;
      if (def.round) v = Math.round(v);
      P[def.key] = v;
      out.textContent = def.show(v);
      changed();
    });
    return h('div', { class: 'field' }, h('div', { class: 'an-field-head' }, h('label', { text: def.label, htmlFor: id }), out), input);
  }
  /** Un réglage modifié : on repart de zéro, l'ancienne histoire ne correspond plus à ce composant. */
  function changed() {
    rebuild();
    // La vitesse ne bouge pas tant que τ reste lisible : un composant plus lent se voit plus lent.
    const onScreen = view.model.tau / view.rate;
    if (onScreen < 0.4 || onScreen > 12) setRate(autoRate());
    else updateRateOut();
    updateFormula();
    syncTransport();
    draw();
  }
  function updateFormula() {
    const lines = PAGES[view.page].formula(view.model);
    view.dom.formula.textContent = '';
    for (const t of lines) view.dom.formula.append(h('div', { text: t }));
  }
  /** @param {string} mode */
  function manoeuvre(mode) {
    const hist = view.model.history;
    hist.change(view.tNow, mode);
    view.dir = 1;
    view.playing = true;
    syncTransport();
    draw();
  }
  function syncTransport() {
    const d = view.dom;
    const cur = view.model.history.at(view.tNow).mode;
    for (const b of d.moveBtns) b.classList.toggle('on', b.dataset.mode === cur);
    d.back.classList.toggle('on', view.playing && view.dir < 0);
    d.fwd.classList.toggle('on', view.playing && view.dir > 0);
    d.pause.classList.toggle('on', !view.playing);
  }

  function draw() {
    if (!view.visible) return;
    const c = readColors();
    const d = view.dom, page = PAGES[view.page], m = view.model;
    const P = view.params[view.page];
    if (view.partsDirty) { page.parts(d.partsCv, P, m, c); view.partsDirty = false; }
    const s = m.history.at(view.tNow);
    if (view.page === 'resistor') drawResistorScene(d.sceneCv, P, m, s, /** @type {Drude} */ (view.drude), c);
    else page.scene(d.sceneCv, P, m, s, c);
    drawCharts(d.chartsCv, {
      model: m, series: page.series, tNow: view.tNow, windowTau: 10, hover: view.hover,
      onRange: (lo, hi) => { view.range = { lo, hi }; },
    }, c);
    d.readout.textContent = `t = ${formatSI(view.tNow, 's')}`;
    d.timeline.value = String(m.history.tMax > 0 ? view.tNow / m.history.tMax * 1000 : 0);
    d.timeline.disabled = !(m.history.tMax > 0);
    const [title, body] = page.story(s, m);
    if (d.storyTitle.textContent !== title) d.storyTitle.textContent = title;
    if (d.storyText.textContent !== body) d.storyText.textContent = body;
    const rows = page.values(s);
    if (d.values.childElementCount !== rows.length * 2) {
      d.values.textContent = '';
      for (const [k] of rows) d.values.append(h('dt', { text: k }), h('dd'));
    }
    rows.forEach((r, i) => { d.values.children[2 * i + 1].textContent = r[1]; });
  }

  function frame(/** @type {number} */ now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - view.lastFrame) / 1000);
    view.lastFrame = now;
    if (!view.visible) return;
    if (view.playing) {
      const hist = view.model.history;
      view.tNow += view.dir * view.rate * dt;
      if (view.dir > 0) { if (view.tNow > hist.tMax) hist.tMax = view.tNow; }
      else if (view.tNow <= 0) { view.tNow = 0; view.playing = false; syncTransport(); }
      if (view.drude) {
        const m = view.model, s = hist.at(view.tNow);
        // L'accélération suit le champ U/L, bornée pour rester lisible.
        const E = s.u / P_L();
        const accel = view.dir * Math.min(420, 150 * Math.sqrt(Math.abs(E) / 500));
        view.drude.step(dt, s.mode === 'charge' ? accel : 0, m.material.ionR, Math.min(1, s.dT / 150));
      }
      draw();
    }
  }
  const P_L = () => view.params.resistor.L;

  /** @param {'circuit' | 'components'} tab */
  function showTab(tab) {
    document.body.dataset.tab = tab;
    const on = tab === 'components';
    document.getElementById('anatomy').hidden = !on;
    for (const b of document.querySelectorAll('.tabs [role="tab"]')) b.setAttribute('aria-selected', String(/** @type {HTMLElement} */ (b).dataset.tab === tab));
    view.visible = on;
    if (on) {
      // La simulation du circuit reste en pause derrière l'onglet : on la retrouve à ce même instant.
      const app = RLC.app;
      if (app && app.playing) document.getElementById('btnPause').click();
      view.partsDirty = true;
      draw();
    }
  }

  function init() {
    const host = /** @type {HTMLElement} */ (document.getElementById('anatomy'));
    const subtabs = h('div', { class: 'an-tabs', role: 'tablist', ariaLabel: 'Composant étudié' });
    view.dom.body = h('div', { class: 'an-body' });
    for (const key of /** @type {(keyof typeof PAGES)[]} */ (Object.keys(PAGES))) {
      const b = h('button', {
        text: PAGES[key].tab, role: 'tab',
        onclick: () => {
          view.page = key;
          for (const o of subtabs.children) o.setAttribute('aria-selected', String(o === b));
          buildPage();
        },
      });
      b.setAttribute('aria-selected', String(key === view.page));
      subtabs.append(b);
    }
    host.append(subtabs, view.dom.body);
    for (const b of document.querySelectorAll('.tabs [role="tab"]')) {
      b.addEventListener('click', () => showTab(/** @type {any} */ (/** @type {HTMLElement} */ (b).dataset.tab)));
    }
    new ResizeObserver(() => { view.partsDirty = true; draw(); }).observe(host);
    document.getElementById('btnTheme').addEventListener('click', () => { view.partsDirty = true; draw(); });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { view.partsDirty = true; draw(); });
    window.addEventListener('keydown', (e) => {
      if (!view.visible || e.key !== ' ') return;
      const tag = /** @type {HTMLElement} */ (e.target).tagName;
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT') return;
      e.preventDefault();
      view.playing = !view.playing;
      syncTransport();
    });
    view.visible = true;
    buildPage();
    view.visible = false;
    requestAnimationFrame((t) => { view.lastFrame = t; frame(t); });
  }

  init();
  RLC.anatomy = { view, showTab };
})(globalThis);
