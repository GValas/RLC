// @ts-check
// Oscilloscope : une ligne par sonde, axe du temps commun, régimes transitoire et permanent visibles.
(function (RLC) {
  'use strict';
  const { formatSI } = RLC.circuit;

  const M = { left: 66, right: 14, top: 8, axis: 22, gap: 8 };

  /** Graduations rondes (1, 2, 5 × 10ⁿ). */
  function niceTicks(lo, hi, want) {
    const span = hi - lo;
    if (!(span > 0)) return [lo];
    const raw = span / Math.max(1, want);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
  }

  /** Assez de chiffres pour que deux graduations voisines ne s'écrivent jamais de la même façon. */
  function tickFormatter(ticks, unit) {
    let digits = 3;
    if (ticks.length > 1) {
      const step = Math.abs(ticks[1] - ticks[0]);
      const top = Math.max(...ticks.map(Math.abs));
      if (step > 0 && top > 0) digits = Math.min(9, Math.max(3, Math.ceil(Math.log10(top / step)) + 1));
    }
    return (/** @type {number} */ v) => formatSI(v, unit, digits);
  }

  class Scope {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {HTMLElement} tooltip
     */
    constructor(canvas, tooltip) {
      this.canvas = canvas;
      this.tooltip = tooltip;
      this.ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
      this.w = 0; this.h = 0; this.dpr = 1;
      this.window = 1e-2;
      this.showAll = false;
      this.showSteady = true;
      this.showTransient = false;
      this.mouse = null;
      /** Instant survolé, que le schéma affiche en aperçu. */
      /** @type {number | null} */
      this.hoverT = null;
      /** Simulation de référence, tracée en pâle pour comparer. */
      /** @type {any} */
      this.refSim = null;
      /** @type {null | ((t:number)=>void)} */
      this.onSeek = null;
      /** @type {null | (()=>void)} */
      this.onHover = null;
      this.range = [0, 1];
      this.dragging = false;
      this.resize();
      this._bind();
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      this.dpr = window.devicePixelRatio || 1;
      this.w = Math.max(1, r.width);
      this.h = Math.max(1, r.height);
      this.canvas.width = Math.round(this.w * this.dpr);
      this.canvas.height = Math.round(this.h * this.dpr);
    }

    _bind() {
      const c = this.canvas;
      const pos = (/** @type {PointerEvent|WheelEvent} */ e) => {
        const r = c.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      };
      const seek = (/** @type {{x:number}} */ p) => {
        const t = this.xToT(p.x);
        if (this.onSeek) this.onSeek(t);
      };
      c.addEventListener('pointerdown', (e) => {
        const p = pos(e);
        if (p.x < M.left) return;
        this.dragging = true;
        c.setPointerCapture(e.pointerId);
        seek(p);
      });
      c.addEventListener('pointermove', (e) => {
        const p = pos(e);
        this.mouse = p;
        if (this.dragging) seek(p);
        if (this.onHover) this.onHover();
      });
      c.addEventListener('pointerup', () => { this.dragging = false; });
      c.addEventListener('pointercancel', () => { this.dragging = false; });
      c.addEventListener('pointerleave', () => {
        this.mouse = null;
        this.hoverT = null;
        this.tooltip.hidden = true;
        if (this.onHover) this.onHover();
      });
      c.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.showAll = false;
        this.window = Math.max(1e-10, this.window * (e.deltaY > 0 ? 1.2 : 1 / 1.2));
        if (this.onHover) this.onHover();
      }, { passive: false });
    }

    xToT(x) {
      const [a, b] = this.range;
      const f = (x - M.left) / Math.max(1, this.w - M.left - M.right);
      return a + (b - a) * Math.max(0, Math.min(1, f));
    }

    /**
     * @param {any} sim @param {number} tNow @param {{k:number, kind:string, name:string, color:string, sign:number}[]} traces
     * @param {any} theme
     */
    draw(sim, tNow, traces, theme) {
      const { ctx, dpr, w, h } = this;
      this.hoverT = null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = theme.panel;
      ctx.fillRect(0, 0, w, h);
      ctx.font = '11px "Segoe UI", system-ui, sans-serif';
      if (!sim || !traces.length) {
        ctx.fillStyle = theme.muted;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          sim ? 'Sélectionnez un composant, puis « Tracer u » ou « Tracer i ».' : 'Les graphiques apparaissent à la mise sous tension.',
          w / 2, h / 2);
        this.tooltip.hidden = true;
        return;
      }
      const head = sim.ctx.t;
      let t0, t1;
      if (this.showAll) { t0 = 0; t1 = Math.max(head, 1e-12); }
      else {
        const W = this.window;
        t1 = Math.max(tNow + W * 0.1, W);
        t0 = t1 - W;
        if (t0 < 0) { t1 -= t0; t0 = 0; }
      }
      this.range = [t0, t1];
      const n = traces.length;
      const plotW = Math.max(10, w - M.left - M.right);
      const rowH = Math.max(36, (h - M.axis - M.top - (n - 1) * M.gap) / n);
      const xOf = (/** @type {number} */ t) => M.left + (t - t0) / (t1 - t0) * plotW;

      const data = traces.map((tr) => this._collect(sim, tr, t0, t1, plotW));
      if (this.refSim) {
        data.forEach((d, i) => {
          const r = this._collect(this.refSim, traces[i], t0, t1, plotW);
          d.ref = r.mid;
          d.min = Math.min(d.min, r.min);
          d.max = Math.max(d.max, r.max);
        });
      }

      // Bande du régime transitoire, par segment.
      const bands = this._bands(sim, t0, t1);
      traces.forEach((tr, row) => {
        const top = M.top + row * (rowH + M.gap);
        this._row(sim, tr, data[row], top, rowH, xOf, bands, theme, row === 0, tNow, t0, t1, plotW);
      });

      // Axe du temps
      const yAxis = M.top + n * rowH + (n - 1) * M.gap;
      ctx.fillStyle = theme.muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const timeTicks = niceTicks(t0, t1, Math.max(2, Math.floor(plotW / 90)));
      const fmtT = tickFormatter(timeTicks, 's');
      for (const v of timeTicks) ctx.fillText(fmtT(v), xOf(v), yAxis + 5);

      this._hover(sim, traces, data, t0, t1, xOf, rowH, theme);
    }

    /** Colonne par colonne : min/max du signal, permanent et transitoire au centre. */
    _collect(sim, tr, t0, t1, plotW) {
      const cols = Math.max(2, Math.floor(plotW));
      const lo = new Float64Array(cols).fill(NaN), hi = new Float64Array(cols).fill(NaN);
      const dtCol = (t1 - t0) / cols;
      const w = sim.width, h = sim.h, off = 3 + 2 * tr.k + (tr.kind === 'i' ? 1 : 0), sign = tr.sign;
      const head = sim.ctx.t;
      let i0 = sim.indexAt(t0);
      const i1 = sim.indexAt(Math.min(t1, head));
      const total = i1 - i0 + 1;
      const stride = Math.max(1, Math.floor(total / 8000));
      for (let r = i0; r <= i1; r += stride) {
        const t = h[r * w];
        if (t > t1) break;
        const c = Math.floor((t - t0) / dtCol);
        if (c < 0 || c >= cols) continue;
        const v = sign * h[r * w + off];
        if (!(v >= lo[c])) lo[c] = v;
        if (!(v <= hi[c])) hi[c] = v;
      }
      // Colonnes vides (pas plus large qu'un pixel) : interpolation.
      const mid = new Float64Array(cols).fill(NaN), steady = new Float64Array(cols).fill(NaN);
      const tmp = [0, 0], s = sim._dispState || (sim._dispState = sim._newState());
      for (let c = 0; c < cols; c++) {
        const t = t0 + (c + 0.5) * dtCol;
        if (t > head) break;
        sim.sampleAt(t, s);
        const v = sign * (tr.kind === 'i' ? s.i[tr.k] : s.u[tr.k]);
        mid[c] = v;
        if (isNaN(lo[c])) { lo[c] = v; hi[c] = v; }
        const seg = sim.segments[s.segIdx];
        if (seg && !seg.noSteady && (this.showSteady || this.showTransient)) {
          sim.steadyAt(seg, tr.k, t, tmp);
          steady[c] = sign * (tr.kind === 'i' ? tmp[1] : tmp[0]);
        }
      }
      let min = Infinity, max = -Infinity;
      for (let c = 0; c < cols; c++) {
        if (lo[c] < min) min = lo[c];
        if (hi[c] > max) max = hi[c];
        if (this.showSteady && steady[c] < min) min = steady[c];
        if (this.showSteady && steady[c] > max) max = steady[c];
        if (this.showTransient && !isNaN(steady[c])) {
          const d = mid[c] - steady[c];
          if (d < min) min = d;
          if (d > max) max = d;
        }
      }
      if (!isFinite(min)) { min = -1; max = 1; }
      if (max - min < Math.max(Math.abs(max), Math.abs(min)) * 1e-6 || max === min) {
        const pad = Math.max(Math.abs(max) * 0.1, tr.kind === 'i' ? 1e-6 : 1e-3);
        min -= pad; max += pad;
      } else {
        const pad = (max - min) * 0.08;
        min -= pad; max += pad;
      }
      return { lo, hi, mid, steady, cols, dtCol, min, max };
    }

    /** Intervalles [a, b] de régime transitoire et marques de changement. */
    _bands(sim, t0, t1) {
      const out = [];
      sim.segments.forEach((seg, i) => {
        const next = sim.segments[i + 1];
        const end = next ? next.tStart : sim.ctx.t;
        if (end < t0 || seg.tStart > t1) return;
        const reg = sim.regimeAt(Math.max(seg.tStart + 1e-15, Math.min(end, sim.ctx.t)));
        const tP = reg.tPerm;
        out.push({ a: seg.tStart, b: Math.min(end, tP), end, label: seg.label, perm: isFinite(tP) ? tP : null, libre: reg.kind === 'libre', idx: i });
      });
      return out;
    }

    _row(sim, tr, d, top, rowH, xOf, bands, theme, first, tNow, t0, t1, plotW) {
      const { ctx } = this;
      const yOf = (/** @type {number} */ v) => top + rowH - (v - d.min) / (d.max - d.min) * rowH;
      const left = M.left, right = M.left + plotW;
      ctx.save();
      ctx.beginPath(); ctx.rect(left, top, plotW, rowH); ctx.clip();

      for (const b of bands) {
        const xa = Math.max(left, xOf(b.a)), xb = Math.min(right, xOf(b.b));
        if (xb > xa && !b.libre) { ctx.fillStyle = theme.transBand; ctx.fillRect(xa, top, xb - xa, rowH); }
        if (b.libre) {
          const xe = Math.min(right, xOf(b.end));
          ctx.fillStyle = theme.transBand; ctx.fillRect(xa, top, xe - xa, rowH);
        }
      }

      // Grille discrète
      ctx.strokeStyle = theme.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const ticks = niceTicks(d.min, d.max, Math.max(3, Math.floor(rowH / 24)));
      for (const v of ticks) { const y = Math.round(yOf(v)) + 0.5; ctx.moveTo(left, y); ctx.lineTo(right, y); }
      ctx.stroke();
      if (d.min < 0 && d.max > 0) {
        ctx.strokeStyle = theme.muted;
        ctx.beginPath();
        const y = Math.round(yOf(0)) + 0.5;
        ctx.moveTo(left, y); ctx.lineTo(right, y);
        ctx.stroke();
      }
      // Changements de configuration
      ctx.strokeStyle = theme.muted;
      ctx.setLineDash([3, 3]);
      for (const b of bands) {
        if (b.idx === 0) continue;
        const x = Math.round(xOf(b.a)) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + rowH); ctx.stroke();
      }
      ctx.setLineDash([]);

      const xCol = (/** @type {number} */ c) => left + c + 0.5;
      const drawLine = (arr, color, width, dash, skipFuture) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.setLineDash(dash);
        ctx.lineJoin = 'round';
        ctx.beginPath();
        let pen = false;
        for (let c = 0; c < d.cols; c++) {
          const v = arr(c);
          if (isNaN(v) || (skipFuture && t0 + (c + 0.5) * d.dtCol > tNow)) { pen = false; continue; }
          const y = yOf(v);
          if (pen) ctx.lineTo(xCol(c), y); else { ctx.moveTo(xCol(c), y); pen = true; }
        }
        ctx.stroke();
        ctx.setLineDash([]);
      };

      if (this.showSteady) drawLine((c) => d.steady[c], theme.muted, 1.5, [6, 4], false);
      if (this.showTransient) {
        ctx.globalAlpha = 0.65;
        drawLine((c) => d.mid[c] - d.steady[c], tr.color, 1.5, [1.5, 3], false);
        ctx.globalAlpha = 1;
      }

      if (d.ref) {
        ctx.globalAlpha = 0.6;
        drawLine((c) => d.ref[c], theme.muted, 1.75, [], false);
        ctx.globalAlpha = 1;
      }

      // Signal : enveloppe min/max pour ne perdre aucune pointe. Le futur déjà calculé reste pâle.
      const trace = (from, to, alpha) => {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = tr.color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        let pen = false;
        let py = 0;
        for (let c = from; c < to; c++) {
          if (isNaN(d.lo[c])) { pen = false; continue; }
          const yl = yOf(d.lo[c]), yh = yOf(d.hi[c]), x = xCol(c);
          if (!pen) { ctx.moveTo(x, yl); pen = true; py = yl; }
          // On part du bord le plus proche pour éviter un trait en dents de scie.
          if (Math.abs(py - yl) <= Math.abs(py - yh)) { ctx.lineTo(x, yl); ctx.lineTo(x, yh); py = yh; }
          else { ctx.lineTo(x, yh); ctx.lineTo(x, yl); py = yl; }
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      };
      const split = Math.max(0, Math.min(d.cols, Math.ceil((tNow - t0) / d.dtCol)));
      trace(0, split + 1 > d.cols ? d.cols : split + 1, 1);
      if (split < d.cols) trace(split, d.cols, 0.28);

      // Instant courant
      const xNow = xOf(tNow);
      if (xNow >= left && xNow <= right) {
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(xNow, top); ctx.lineTo(xNow, top + rowH); ctx.stroke();
      }

      // Étiquettes des régimes sur la première ligne seulement.
      ctx.font = '11px "Segoe UI", system-ui, sans-serif';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.lineJoin = 'round';
      /** Texte avec un liseré couleur de fond : il reste lisible par-dessus une courbe. */
      const halo = (/** @type {string} */ txt, /** @type {number} */ x, /** @type {number} */ y, /** @type {string} */ col) => {
        ctx.strokeStyle = theme.panel;
        ctx.lineWidth = 3;
        ctx.strokeText(txt, x, y);
        ctx.fillStyle = col;
        ctx.fillText(txt, x, y);
      };
      if (first && rowH > 44) {
        for (const b of bands) {
          const xa = Math.max(left, xOf(b.a)), xb = Math.min(right, xOf(b.b));
          if (b.libre) { halo('sans régime permanent', xa + 5, top + 3, theme.muted); continue; }
          if (xb - xa > 70) halo('transitoire', xa + 5, top + 3, theme.muted);
          if (b.perm !== null) {
            const xp = Math.max(left, xOf(b.perm)), xe = Math.min(right, xOf(b.end));
            if (xe - xp > 64) halo('permanent', xp + 5, top + 3, theme.muted);
          }
        }
      }
      // Nom de la grandeur, directement sur sa courbe.
      ctx.textAlign = 'right';
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
      halo(tr.name, right - 6, top + 3, theme.ink);
      ctx.restore();

      // Axe vertical, nom de la grandeur et cadre.
      ctx.font = '11px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = theme.muted;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const unit = tr.kind === 'i' ? 'A' : 'V';
      let lastY = -100;
      const fmtY = tickFormatter(ticks, unit);
      for (const v of ticks) {
        const y = yOf(v);
        if (Math.abs(y - lastY) < 13 || y < top + 5 || y > top + rowH - 5) continue;
        ctx.fillText(fmtY(v), left - 5, y);
        lastY = y;
      }
      ctx.strokeStyle = theme.line;
      ctx.lineWidth = 1;
      ctx.strokeRect(left + 0.5, top + 0.5, plotW - 1, rowH - 1);
    }

    _hover(sim, traces, data, t0, t1, xOf, rowH, theme) {
      const { tooltip } = this;
      const m = this.mouse;
      if (!m || m.x < M.left || m.x > this.w - M.right) { tooltip.hidden = true; return; }
      const t = this.xToT(m.x);
      const row = Math.min(traces.length - 1, Math.max(0, Math.floor((m.y - M.top) / (rowH + M.gap))));
      const x = Math.round(xOf(t)) + 0.5;
      const { ctx } = this;
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, M.top); ctx.lineTo(x, M.top + traces.length * (rowH + M.gap) - M.gap); ctx.stroke();

      if (t > sim.ctx.t) { tooltip.hidden = true; return; }
      this.hoverT = t;
      const tr = traces[row], d = data[row];
      const unit = tr.kind === 'i' ? 'A' : 'V';
      const c = Math.max(0, Math.min(d.cols - 1, Math.floor((t - t0) / d.dtCol)));
      tooltip.textContent = '';
      const add = (/** @type {string} */ label, /** @type {string} */ value, bold = false) => {
        const line = document.createElement('div');
        const b = document.createElement(bold ? 'b' : 'span');
        b.textContent = label + ' ';
        line.append(b, value);
        tooltip.append(line);
      };
      add('t =', formatSI(t, 's', 4));
      add(`${tr.name} =`, formatSI(d.mid[c], unit, 4), true);
      if (!isNaN(d.steady[c])) {
        add('permanent', formatSI(d.steady[c], unit, 4));
        add('transitoire', formatSI(d.mid[c] - d.steady[c], unit, 3));
      }
      tooltip.hidden = false;
      const bw = tooltip.offsetWidth, bh = tooltip.offsetHeight;
      tooltip.style.left = (m.x + 14 + bw > this.w ? m.x - bw - 10 : m.x + 14) + 'px';
      tooltip.style.top = Math.max(2, Math.min(this.h - bh - 2, m.y - bh / 2)) + 'px';
    }
  }

  RLC.Scope = Scope;
})(/** @type {any} */ (globalThis).RLC ??= {});
