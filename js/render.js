// @ts-check
// Dessin du circuit sur canvas : grille, fils colorés par le potentiel, symboles et points de courant.
(function (RLC) {
  'use strict';
  const { terminals, parseEdge, formatSI, lampLevel } = RLC.circuit;

  /** Lit les couleurs du thème courant. */
  function readTheme() {
    const css = getComputedStyle(document.documentElement);
    const v = (/** @type {string} */ n) => css.getPropertyValue(n).trim();
    const hex = (/** @type {string} */ c) => {
      const h = c.replace('#', '');
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    };
    return {
      paper: v('--paper'), panel: v('--panel'), panel2: v('--panel-2'), line: v('--line'), grid: v('--grid'), gridMajor: v('--grid-major'),
      ink: v('--ink'), muted: v('--muted'), accent: v('--accent'), select: v('--select'), dot: v('--dot'), dotRing: v('--dot-ring'),
      err: v('--err'), warn: v('--warn'), transBand: v('--trans-band'),
      pos: hex(v('--volt-pos')), neg: hex(v('--volt-neg')), mid: hex(v('--volt-mid')), midCss: v('--volt-mid'),
      series: [1, 2, 3, 4, 5, 6, 7].map((n) => v('--series-' + n)),
    };
  }

  /** Couleur divergente d'un potentiel normalisé dans [−1, 1]. */
  function voltColor(theme, x) {
    const c = x >= 0 ? theme.pos : theme.neg, m = theme.mid, a = Math.min(1, Math.abs(x));
    return `rgb(${Math.round(m[0] + (c[0] - m[0]) * a)},${Math.round(m[1] + (c[1] - m[1]) * a)},${Math.round(m[2] + (c[2] - m[2]) * a)})`;
  }

  const LW = 0.09; // épaisseur de trait, en unités de grille

  /** Symbole sans fils de connexion, dans le repère local (axe x de −2 à 2). */
  function drawBody(ctx, c, ink, paper, closedNow, level = 0, glow = paper) {
    const p = c.params;
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = LW * 1.15;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    switch (c.type) {
      case 'resistor':
        ctx.fillStyle = paper;
        ctx.fillRect(-1.25, -0.42, 2.5, 0.84);
        ctx.strokeRect(-1.25, -0.42, 2.5, 0.84);
        break;
      case 'lamp': {
        // Disque blanc-jaune d'autant plus opaque que l'éclat est fort, et croix normalisée.
        ctx.fillStyle = paper;
        ctx.beginPath(); ctx.arc(0, 0, 0.85, 0, 7); ctx.fill();
        if (level > 0) {
          ctx.globalAlpha = level;
          ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(0, 0, 0.85, 0, 7); ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.beginPath(); ctx.arc(0, 0, 0.85, 0, 7); ctx.stroke();
        const r = 0.6;
        line(-r, -r, r, r);
        line(-r, r, r, -r);
        break;
      }
      case 'capacitor':
        ctx.fillStyle = paper;
        ctx.fillRect(-0.2, -0.8, 0.4, 1.6);
        ctx.lineWidth = LW * 1.6;
        line(-0.2, -0.8, -0.2, 0.8);
        line(0.2, -0.8, 0.2, 0.8);
        break;
      case 'inductor': {
        ctx.fillStyle = paper;
        ctx.fillRect(-1.3, -0.5, 2.6, 0.5);
        ctx.beginPath();
        const n = 4, w = 2.6 / n;
        for (let k = 0; k < n; k++) ctx.arc(-1.3 + w * (k + 0.5), 0, w / 2, Math.PI, 0);
        ctx.stroke();
        break;
      }
      case 'switch': {
        ctx.fillStyle = ink;
        const closed = closedNow;
        ctx.beginPath(); ctx.arc(-1, 0, 0.14, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(1, 0, 0.14, 0, 7); ctx.fill();
        ctx.lineWidth = LW * 1.5;
        if (closed) line(-1, 0, 1, 0);
        else line(-1, 0, 0.8, -0.85);
        break;
      }
      case 'vsource':
      case 'isource': {
        ctx.fillStyle = paper;
        ctx.beginPath(); ctx.arc(0, 0, 0.95, 0, 7); ctx.fill(); ctx.stroke();
        if (c.type === 'vsource') {
          // Norme : cercle barré dans l'axe, avec la borne + du côté a.
          line(-0.95, 0, 0.95, 0);
          ctx.lineWidth = LW * 0.9;
          line(-1.72, -0.72, -1.32, -0.72);
          line(-1.52, -0.92, -1.52, -0.52);
        } else {
          // Courant : la flèche donne le sens de i dans le circuit, vers la borne a.
          line(0.55, 0, -0.45, 0);
          ctx.fillStyle = ink;
          ctx.beginPath(); ctx.moveTo(-0.7, 0); ctx.lineTo(-0.3, -0.26); ctx.lineTo(-0.3, 0.26); ctx.closePath(); ctx.fill();
        }
        // Petit glyphe de forme d'onde.
        ctx.lineWidth = LW * 0.8;
        ctx.beginPath();
        const y0 = c.type === 'vsource' ? -0.42 : 0.5;
        if (p.wave === 'sine') {
          for (let k = 0; k <= 20; k++) {
            const x = -0.42 + 0.84 * k / 20, y = y0 - 0.2 * Math.sin(2 * Math.PI * k / 20);
            if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
          }
        } else if (p.wave === 'square') {
          ctx.moveTo(-0.42, y0 + 0.17); ctx.lineTo(-0.42, y0 - 0.17); ctx.lineTo(0, y0 - 0.17);
          ctx.lineTo(0, y0 + 0.17); ctx.lineTo(0.42, y0 + 0.17); ctx.lineTo(0.42, y0 - 0.17);
        } else if (p.wave === 'step') {
          ctx.moveTo(-0.42, y0 + 0.17); ctx.lineTo(0, y0 + 0.17); ctx.lineTo(0, y0 - 0.17); ctx.lineTo(0.42, y0 - 0.17);
        } else {
          ctx.moveTo(-0.35, y0); ctx.lineTo(0.35, y0);
        }
        ctx.stroke();
        break;
      }
      case 'diode':
        // Triangle pointé vers la cathode (b) et barre ; un retour de barre pour la Zener.
        ctx.fillStyle = ink;
        ctx.beginPath(); ctx.moveTo(-0.6, -0.6); ctx.lineTo(0.5, 0); ctx.lineTo(-0.6, 0.6); ctx.closePath(); ctx.fill();
        ctx.lineWidth = LW * 1.6;
        line(0.55, -0.65, 0.55, 0.65);
        if (p.Vz > 0) { line(0.55, -0.65, 0.2, -0.65); line(0.55, 0.65, 0.9, 0.65); }
        ctx.lineWidth = LW;
        line(-0.8, 0, -0.6, 0);
        line(0.55, 0, 0.8, 0);
        break;
      case 'opamp': {
        const s = p.flip ? -1 : 1; // e+ en bas par défaut
        ctx.lineWidth = LW;
        line(-3, s, -2, s);
        line(-3, -s, -2, -s);
        line(2, 0, 3, 0);
        ctx.fillStyle = paper;
        ctx.lineWidth = LW * 1.15;
        ctx.beginPath(); ctx.moveTo(-2, -2); ctx.lineTo(2, 0); ctx.lineTo(-2, 2); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.lineWidth = LW;
        // + sur e+, − sur e−
        line(-1.6, s, -1.0, s);
        line(-1.3, s - 0.3, -1.3, s + 0.3);
        line(-1.6, -s, -1.0, -s);
        break;
      }
      case 'voltmeter':
        ctx.fillStyle = paper;
        ctx.beginPath(); ctx.arc(0, 0, 0.8, 0, 7); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-0.32, -0.34); ctx.lineTo(0, 0.36); ctx.lineTo(0.32, -0.34); ctx.stroke();
        break;
      case 'ground':
        // Repère propre : la borne est à l'origine, les barres vers +y local.
        line(0, 0, 0, 0.55);
        ctx.lineWidth = LW * 1.4;
        line(-0.6, 0.55, 0.6, 0.55);
        line(-0.38, 0.8, 0.38, 0.8);
        line(-0.16, 1.05, 0.16, 1.05);
        break;
    }
  }

  /** Valeur principale affichée près d'un composant. */
  function valueText(c) {
    const p = c.params;
    switch (c.type) {
      case 'resistor': return formatSI(p.R, 'Ω');
      case 'lamp': return `${formatSI(p.R, 'Ω')} · ${formatSI(p.Umax, 'V')} max`;
      case 'diode': return p.Vz > 0 ? `Vz ${formatSI(p.Vz, 'V')}` : `Vd ${formatSI(p.Vd, 'V')}`;
      case 'capacitor': return formatSI(p.C, 'F');
      case 'inductor': return formatSI(p.L, 'H') + (p.r > 0 ? ` (r ${formatSI(p.r, 'Ω')})` : '');
      case 'vsource':
      case 'isource': {
        const unit = c.type === 'vsource' ? 'V' : 'A';
        if (p.wave === 'sine' || p.wave === 'square') return `${formatSI(p.A, unit)} · ${formatSI(p.f, 'Hz')}`;
        return formatSI(p.A, unit);
      }
      default: return '';
    }
  }

  /** Nom avec chiffres en indice, à la façon d'un tableau noir : R1 → R₁. */
  const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
  const prettyLabel = (/** @type {string} */ s) => String(s).replace(/\d/g, (d) => SUB[d]);

  class Renderer {
    /** @param {HTMLCanvasElement} canvas */
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
      this.view = { ox: 40, oy: 40, scale: 22 };
      this.theme = readTheme();
      this.w = 0; this.h = 0; this.dpr = 1;
      this.resize();
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      this.dpr = window.devicePixelRatio || 1;
      this.w = Math.max(1, r.width);
      this.h = Math.max(1, r.height);
      this.canvas.width = Math.round(this.w * this.dpr);
      this.canvas.height = Math.round(this.h * this.dpr);
    }

    /** Écran → grille. */
    toWorld(px, py) {
      return { x: (px - this.view.ox) / this.view.scale, y: (py - this.view.oy) / this.view.scale };
    }

    /** Cadre le circuit dans la zone visible. */
    fit(doc) {
      const b = docBounds(doc);
      if (!b) { this.view = { ox: this.w / 2, oy: this.h / 2, scale: 22 }; return; }
      // Trois unités de plus à droite : les étiquettes des composants verticaux y débordent.
      fitView(this.view, { ...b, x1: b.x1 + 3 }, this.w, this.h, 2, 34);
    }

    /**
     * @param {any} s scène : doc, sel, hover, draft, ghost, voltages, dots…
     */
    draw(s) {
      const { ctx, view, theme, dpr } = this;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = theme.paper;
      ctx.fillRect(0, 0, this.w, this.h);
      this._grid();
      ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.ox, dpr * view.oy);
      drawCircuit(ctx, s, theme, true);
      // Textes en pixels pour rester nets à tout zoom.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawLabels(ctx, s, theme, view);
    }

    _grid() {
      const { ctx, view, theme, w, h } = this;
      const sc = view.scale;
      if (sc < 7) return;
      const r = Math.max(0.8, sc / 18);
      const x0 = Math.floor(-view.ox / sc), y0 = Math.floor(-view.oy / sc);
      const nx = Math.ceil(w / sc) + 1, ny = Math.ceil(h / sc) + 1;
      for (let j = 0; j <= ny; j++) {
        for (let i = 0; i <= nx; i++) {
          const gx = x0 + i, gy = y0 + j;
          const major = gx % 5 === 0 && gy % 5 === 0;
          ctx.fillStyle = major ? theme.gridMajor : theme.grid;
          const R = major ? r * 1.5 : r;
          ctx.fillRect(view.ox + gx * sc - R / 2, view.oy + gy * sc - R / 2, R, R);
        }
      }
    }
  }

  /** Dessin du circuit, dans un contexte déjà transformé en unités de grille. */
  function drawCircuit(ctx, s, theme, live) {
    const { doc, sel, hover, sim } = s;

    const wireColor = (net) => {
      if (!s.voltages || net === undefined || net < 0) return theme.midCss;
      return voltColor(theme, s.voltages[net] / (s.vRef || 1));
    };

    // Halo des lampes, sous tout le reste
    /** @type {Map<number, number>} */
    const lampLevels = new Map();
    if (s.voltages && s.compIndex) {
      for (const c of doc.comps) {
        if (c.type !== 'lamp') continue;
        const nc = s.netComps[s.compIndex.get(c.id)];
        if (!nc) continue;
        const level = lampLevel(s.voltages[nc.a] - s.voltages[nc.b], c.params);
        lampLevels.set(c.id, level);
        if (level <= 0.002) continue;
        const R = 3.4;
        const g = ctx.createRadialGradient(c.x, c.y, 0.5, c.x, c.y, R);
        g.addColorStop(0, theme.dot);
        g.addColorStop(1, theme.dot + '00');
        ctx.globalAlpha = level * 0.75;
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(c.x, c.y, R, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Fils
    ctx.lineCap = 'round';
    ctx.lineWidth = LW;
    /** @type {Map<string, number>} */
    const degree = new Map();
    const netEdges = s.netEdges;
    doc.wires.forEach((key, idx) => {
      const e = parseEdge(key);
      const k1 = e.x + ',' + e.y, k2 = e.x2 + ',' + e.y2;
      degree.set(k1, (degree.get(k1) || 0) + 1);
      degree.set(k2, (degree.get(k2) || 0) + 1);
      let col = netEdges ? wireColor(netEdges[idx].net) : theme.ink;
      if (sel && sel.wire && sel.wire.has(key)) col = theme.select;
      else if (hover && hover.wire === key) col = theme.accent;
      ctx.strokeStyle = col;
      ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x2, e.y2); ctx.stroke();
    });
    for (const c of doc.comps) {
      for (const [x, y] of terminals(c)) {
        const k = x + ',' + y;
        degree.set(k, (degree.get(k) || 0) + 1);
      }
    }

    // Composants
    const closedOf = (c) => (s.closedState ? s.closedState(c) : !!c.params.closed);
    for (const c of doc.comps) {
      const selected = sel && sel.comp === c.id;
      const hovered = hover && hover.comp === c.id;
      const ink = selected ? theme.select : hovered ? theme.accent : theme.ink;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot * Math.PI / 2);
      const eq = s.equiv ? s.equiv.get(c.id) : null;
      if (c.type !== 'ground' && c.type !== 'opamp') {
        const k = s.compIndex ? s.compIndex.get(c.id) : undefined;
        const nc = k !== undefined && s.netComps ? s.netComps[k] : null;
        const colA = nc ? wireColor(nc.a) : theme.ink, colB = nc ? wireColor(nc.b) : theme.ink;
        ctx.lineWidth = LW;
        ctx.lineCap = 'round';
        const inner = eq ? (eq.kind === 'open' ? 0.45 : eq.kind === 'wire' ? 0 : 0.8)
          : c.type === 'switch' ? 1 : c.type === 'capacitor' ? 0.2 : c.type === 'lamp' ? 0.85 : 0.8;
        ctx.strokeStyle = colA;
        ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(-inner, 0); ctx.stroke();
        ctx.strokeStyle = colB;
        ctx.beginPath(); ctx.moveTo(inner, 0); ctx.lineTo(2, 0); ctx.stroke();
      }
      if (eq) {
        // Schéma équivalent : C ou L cède la place à un fil, une coupure ou une source.
        if (eq.kind === 'vsource' || eq.kind === 'isource') {
          if (eq.flip) ctx.rotate(Math.PI);
          drawBody(ctx, { type: eq.kind, params: { wave: 'dc' } }, theme.accent, theme.paper, false);
        } else if (eq.kind === 'open') {
          ctx.strokeStyle = theme.accent;
          ctx.lineWidth = LW * 1.3;
          for (const sx of [-0.45, 0.45]) { ctx.beginPath(); ctx.moveTo(sx, -0.3); ctx.lineTo(sx, 0.3); ctx.stroke(); }
        }
      } else {
        drawBody(ctx, c, ink, theme.paper, closedOf(c), lampLevels.get(c.id) || 0, theme.dot);
      }
      ctx.restore();
    }

    // Jonctions et bornes
    for (const [k, d] of degree) {
      const [x, y] = k.split(',').map(Number);
      if (d >= 3) {
        ctx.fillStyle = theme.ink;
        ctx.beginPath(); ctx.arc(x, y, 0.17, 0, 7); ctx.fill();
      } else if (d === 1 && live) {
        // Borne libre : petit anneau pour indiquer où raccorder.
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = LW * 0.8;
        ctx.fillStyle = theme.paper;
        ctx.beginPath(); ctx.arc(x, y, 0.19, 0, 7); ctx.fill(); ctx.stroke();
      }
    }

    // Convention d'orientation : sur tous les composants si « Valeurs » est actif, sinon sur la sélection.
    if (s.showValues && !s.equiv) {
      for (const c of doc.comps) if (c.type !== 'ground' && c.type !== 'opamp') drawConvention(ctx, c, theme);
    } else if (sel && sel.comp && live) {
      const c = doc.comps.find((x) => x.id === sel.comp);
      if (c && c.type !== 'ground' && c.type !== 'opamp') drawConvention(ctx, c, theme);
    }

    // Points de courant
    if (s.dots) drawDots(ctx, s, theme);

    // Fil en cours de tracé
    if (s.draft) {
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = LW * 1.1;
      ctx.setLineDash([0.28, 0.2]);
      ctx.beginPath();
      s.draft.forEach(([x, y], i) => { if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Composant en cours de pose
    if (s.ghost) {
      const c = s.ghost;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot * Math.PI / 2);
      if (c.type !== 'ground' && c.type !== 'opamp') {
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = LW;
        ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(2, 0); ctx.stroke();
      }
      drawBody(ctx, c, theme.ink, theme.paper, !!c.params.closed);
      ctx.restore();
    }
    // Curseur de grille sur une borne
    if (hover && hover.term) {
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = LW;
      ctx.beginPath(); ctx.arc(hover.term[0], hover.term[1], 0.32, 0, 7); ctx.stroke();
    }
  }

  function drawConvention(ctx, c, theme) {
    const [a, b] = terminals(c);
    const isSource = c.type === 'vsource' || c.type === 'isource';
    const ux = (b[0] - a[0]) / 4, uy = (b[1] - a[1]) / 4;
    const nx = uy, ny = -ux;       // normale, côté étiquette
    const arrow = (x1, y1, x2, y2, col) => {
      ctx.strokeStyle = col; ctx.fillStyle = col;
      ctx.lineWidth = LW * 0.8;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, tx = dx / L, ty = dy / L;
      ctx.beginPath();
      ctx.moveTo(x2 + tx * 0.25, y2 + ty * 0.25);
      ctx.lineTo(x2 - ty * 0.15, y2 + tx * 0.15);
      ctx.lineTo(x2 + ty * 0.15, y2 - tx * 0.15);
      ctx.closePath(); ctx.fill();
    };
    // u : du point b vers le point a, de l'autre côté de l'étiquette.
    const off = 1.15;
    arrow(c.x + ux * 1.5 - nx * off, c.y + uy * 1.5 - ny * off, c.x - ux * 1.5 - nx * off, c.y - uy * 1.5 - ny * off, theme.select);
    // i : sur le fil côté a. En récepteur, i entre par a ; en générateur, i sort par a.
    if (c.type !== 'voltmeter') {
      const ax = a[0] + ux * 0.15, ay = a[1] + uy * 0.15;
      if (isSource) arrow(ax + ux * 0.25, ay + uy * 0.25, ax - ux * 0.05, ay - uy * 0.05, theme.accent);
      else arrow(ax - ux * 0.05, ay - uy * 0.05, ax + ux * 0.25, ay + uy * 0.25, theme.accent);
    }
  }

  function drawDots(ctx, s, theme) {
    const R = 0.15;
    ctx.fillStyle = theme.dot;
    ctx.strokeStyle = theme.dotRing;
    ctx.lineWidth = 0.035;
    const dot = (x, y) => { ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.fill(); ctx.stroke(); };
    const { edgeQ, compQ, edgeOn, compOn } = s.dots;
    s.netEdges.forEach((e, j) => {
      if (!edgeOn[j]) return; // sans courant, pas de points
      const q = edgeQ[j], f = q - Math.floor(q);
      if (e.dir === 'h') dot(e.x + f, e.y); else dot(e.x, e.y + f);
    });
    s.netComps.forEach((nc, k) => {
      const c = nc.comp;
      if (c.type === 'voltmeter' || c.type === 'opamp' || !compOn[k]) return;
      const [a, b] = terminals(c);
      const q = compQ[k], f = q - Math.floor(q);
      const ux = (b[0] - a[0]) / 4, uy = (b[1] - a[1]) / 4;
      for (let n = 0; n < 4; n++) {
        const d = n + f;
        if (c.type === 'capacitor' && d > 1.8 && d < 2.2) continue; // pas de passage entre les armatures
        dot(a[0] + ux * d, a[1] + uy * d);
      }
    });
  }

  /** État d'un composant non linéaire, en toutes lettres. */
  function stateTag(c, state, k, nc) {
    if (c.type === 'diode') {
      if (Math.abs(state.i[k]) < 1e-5) return 'bloquée';
      return state.i[k] < 0 ? 'Zener' : 'passante';
    }
    if (c.type === 'opamp') {
      const u = state.u[k];
      if (Math.abs(u) >= 0.99 * c.params.vsat) return u > 0 ? 'saturé +' : 'saturé −';
      return `linéaire · ε = ${formatSI(state.V[nc.a] - state.V[nc.b], 'V', 2)}`;
    }
    return '';
  }

  function drawLabels(ctx, s, theme, view) {
    const sc = view.scale;
    if (sc < 11) return;
    const size = Math.min(13, Math.max(10, sc * 0.56));
    const lineH = size + 2;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const big = `600 ${size}px "Segoe UI", system-ui, sans-serif`;
    const small = `${size - 1}px "Segoe UI", system-ui, sans-serif`;
    for (const c of s.doc.comps) {
      if (c.type === 'ground') continue;
      /** @type {{t:string, font:string, col:string}[]} */
      const lines = [{ t: prettyLabel(c.label), font: big, col: theme.ink }];
      const eq = s.equiv ? s.equiv.get(c.id) : null;
      if (eq) lines.push({ t: eq.text, font: big, col: theme.accent });
      else {
        const val = valueText(c);
        if (val) lines.push({ t: val, font: small, col: theme.muted });
      }
      const k = s.compIndex ? s.compIndex.get(c.id) : undefined;
      if (s.state && k !== undefined && !s.equiv) {
        const tag = stateTag(c, s.state, k, s.netComps[k]);
        if (tag) lines.push({ t: tag, font: big, col: theme.ink });
        if (s.showValues) {
          const sign = c.type === 'vsource' || c.type === 'isource' ? -1 : 1;
          lines.push({ t: `u = ${formatSI(s.state.u[k], 'V', 3)}`, font: small, col: theme.ink });
          if (c.type !== 'voltmeter') lines.push({ t: `i = ${formatSI(sign * s.state.i[k], 'A', 3)}`, font: small, col: theme.ink });
        }
      }
      const horiz = c.rot % 2 === 0;
      let x = view.ox + c.x * sc, y = view.oy + c.y * sc;
      if (horiz) {
        ctx.textAlign = 'center';
        const up = c.type === 'opamp' ? 2.1 : c.type === 'vsource' || c.type === 'isource' ? 1.75 : c.type === 'switch' ? 1.55 : c.type === 'capacitor' ? 1.5 : 1.3;
        y = y - up * sc - (lines.length - 0.5) * lineH;
      } else {
        ctx.textAlign = 'left';
        x += (c.type === 'opamp' ? 2.4 : c.type === 'capacitor' || c.type === 'vsource' || c.type === 'isource' ? 1.45 : 1.1) * sc;
        y = y - (lines.length - 1) * lineH / 2;
      }
      for (const l of lines) {
        ctx.font = l.font;
        // Liseré couleur de papier : le texte reste lisible s'il passe sur un fil.
        ctx.strokeStyle = theme.paper;
        ctx.lineWidth = 3;
        ctx.strokeText(l.t, x, y);
        ctx.fillStyle = l.col;
        ctx.fillText(l.t, x, y);
        y += lineH;
      }
    }
  }

  /** Boîte englobante du dessin, en unités de grille. */
  function docBounds(doc) {
    if (!doc.comps.length && !doc.wires.length) return null;
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    const grow = (x, y) => { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); };
    for (const k of doc.comps) for (const [x, y] of terminals(k)) grow(x, y);
    for (const w of doc.wires) { const e = parseEdge(w); grow(e.x, e.y); grow(e.x2, e.y2); }
    return { x0: a, y0: b, x1: c, y1: d };
  }

  function fitView(view, b, w, h, marginUnits, maxScale) {
    const bw = b.x1 - b.x0 + marginUnits * 2, bh = b.y1 - b.y0 + marginUnits * 2;
    const sc = Math.min(maxScale, w / bw, h / bh);
    view.scale = sc;
    view.ox = w / 2 - sc * (b.x0 + b.x1) / 2;
    view.oy = h / 2 - sc * (b.y0 + b.y1) / 2;
  }

  /** Vignette d'un document pour la bibliothèque. */
  function thumbnail(canvas, doc, theme) {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = r.width || 240, h = r.height || 120;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const view = { ox: 0, oy: 0, scale: 10 };
    const b = docBounds(doc);
    if (b) fitView(view, { ...b, x1: b.x1 + 2 }, w, h, 1.6, 15);
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.ox, dpr * view.oy);
    drawCircuit(ctx, { doc }, theme, false);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawLabels(ctx, { doc }, { ...theme }, view);
  }

  /** Icône d'un type de composant pour la palette. */
  function icon(canvas, type, theme) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = 34 * dpr;
    canvas.height = 20 * dpr;
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    const c = { type, params: { ...RLC.circuit.defaultParams(type) } };
    const sc = type === 'opamp' ? 4.6 : 7.4;
    ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * 17, dpr * (type === 'ground' ? 4 : 10));
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = LW * 1.15;
    if (type !== 'ground' && type !== 'opamp') { ctx.beginPath(); ctx.moveTo(-2.2, 0); ctx.lineTo(2.2, 0); ctx.stroke(); }
    drawBody(ctx, c, theme.ink, theme.panel, false);
  }

  RLC.render = { Renderer, readTheme, thumbnail, icon, prettyLabel, valueText };
})(/** @type {any} */ (globalThis).RLC ??= {});
