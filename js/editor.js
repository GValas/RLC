// @ts-check
// Interactions sur la grille : poser, déplacer, relier, effacer, zoomer.
(function (RLC) {
  'use strict';
  const { terminals, parseEdge, edgeKey, addComp, addWireLine, defaultParams, TYPES } = RLC.circuit;

  /** Trajet en L entre deux points de grille. */
  function route(a, b, horizontalFirst) {
    if (a[0] === b[0] || a[1] === b[1]) return [a, b];
    const corner = horizontalFirst ? [b[0], a[1]] : [a[0], b[1]];
    return [a, corner, b];
  }

  class Editor {
    /**
     * @param {any} app facade de l'application
     * @param {HTMLCanvasElement} canvas
     * @param {any} renderer
     */
    constructor(app, canvas, renderer) {
      this.app = app;
      this.canvas = canvas;
      this.r = renderer;
      this.tool = 'select';
      this.rot = 0;
      this.hover = null;
      /** @type {any} */
      this.gesture = null;
      /** @type {any} */
      this.sel = null;
      this.ghost = null;
      this.draft = null;
      this.mouseWorld = null;
      this.paletteDrag = false;
      this.paletteStart = { x: 0, y: 0 };
      this._bind();
    }

    setTool(tool) {
      this.tool = tool;
      this.ghost = null;
      this.draft = null;
      this.canvas.style.cursor = tool === 'select' ? 'default' : tool === 'erase' ? 'cell' : 'crosshair';
      this.app.onToolChange(tool);
    }

    select(sel) {
      this.sel = sel;
      this.app.onSelectionChange();
    }

    /** Élément sous un point de la grille. */
    hit(w) {
      const doc = this.app.doc;
      // Bornes d'abord : elles démarrent un fil.
      const gx = Math.round(w.x), gy = Math.round(w.y);
      let term = null;
      if (Math.hypot(w.x - gx, w.y - gy) < 0.42) {
        for (const c of doc.comps) {
          for (const t of terminals(c)) if (t[0] === gx && t[1] === gy) term = t;
        }
      }
      let comp = null;
      for (let i = doc.comps.length - 1; i >= 0 && !comp; i--) {
        const c = doc.comps[i];
        if (c.type === 'ground') {
          if (Math.hypot(w.x - c.x, w.y - c.y - 0.5) < 1) comp = c;
          continue;
        }
        if (c.type === 'opamp') {
          const [lx, ly] = RLC.circuit.rotate(w.x - c.x, w.y - c.y, -c.rot);
          if (Math.abs(lx) < 2.4 && Math.abs(ly) < 2.2) comp = c;
          continue;
        }
        const [a, b] = terminals(c);
        const ux = (b[0] - a[0]) / 4, uy = (b[1] - a[1]) / 4;
        const s = (w.x - a[0]) * ux + (w.y - a[1]) * uy;
        const d = Math.abs((w.x - a[0]) * uy - (w.y - a[1]) * ux);
        if (s > 0.4 && s < 3.6 && d < 1) comp = c;
      }
      let wire = null;
      if (!comp) {
        let best = 0.32;
        for (const key of doc.wires) {
          const e = parseEdge(key);
          const d = e.dir === 'h'
            ? (w.x >= e.x - 0.1 && w.x <= e.x + 1.1 ? Math.abs(w.y - e.y) : 9)
            : (w.y >= e.y - 0.1 && w.y <= e.y + 1.1 ? Math.abs(w.x - e.x) : 9);
          if (d < best) { best = d; wire = key; }
        }
      }
      return { term, comp, wire };
    }

    /** Fils contigus d'une même ligne droite, jusqu'à la prochaine jonction ou borne. */
    wireRun(key) {
      const doc = this.app.doc;
      const set = new Set(doc.wires);
      /** @type {Map<string, number>} */
      const deg = new Map();
      const bump = (x, y) => { const k = x + ',' + y; deg.set(k, (deg.get(k) || 0) + 1); };
      for (const w of doc.wires) { const e = parseEdge(w); bump(e.x, e.y); bump(e.x2, e.y2); }
      for (const c of doc.comps) for (const [x, y] of terminals(c)) { bump(x, y); bump(x, y); }
      const out = new Set([key]);
      const e0 = parseEdge(key);
      const walk = (x, y, dx, dy) => {
        for (;;) {
          if ((deg.get(x + ',' + y) || 0) !== 2) break;
          const nx = x + dx, ny = y + dy;
          const k = dx ? edgeKey(Math.min(x, nx), y, 'h') : edgeKey(x, Math.min(y, ny), 'v');
          if (!set.has(k)) break;
          out.add(k);
          x = nx; y = ny;
        }
      };
      if (e0.dir === 'h') { walk(e0.x, e0.y, -1, 0); walk(e0.x2, e0.y2, 1, 0); }
      else { walk(e0.x, e0.y, 0, -1); walk(e0.x2, e0.y2, 0, 1); }
      return out;
    }

    /** Nombre de bornes et de corps de composants qu'un trajet traverserait, extrémités exclues. */
    _routeCost(pts) {
      /** @type {Set<string>} */
      const busy = new Set();
      for (const c of this.app.doc.comps) {
        const t = terminals(c);
        if (t.length === 1) { busy.add(t[0].join(',')); continue; }
        if (c.type === 'opamp') {
          for (const q of t) busy.add(q.join(','));
          for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) busy.add((c.x + x) + ',' + (c.y + y));
          continue;
        }
        const ux = (t[1][0] - t[0][0]) / 4, uy = (t[1][1] - t[0][1]) / 4;
        for (let n = 0; n <= 4; n++) busy.add((t[0][0] + ux * n) + ',' + (t[0][1] + uy * n));
      }
      const last = pts[pts.length - 1];
      let cost = 0;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
        const n = Math.abs(x2 - x1) + Math.abs(y2 - y1);
        for (let k = 0; k <= n; k++) {
          const x = x1 + Math.sign(x2 - x1) * k, y = y1 + Math.sign(y2 - y1) * k;
          if ((x === pts[0][0] && y === pts[0][1]) || (x === last[0] && y === last[1])) continue;
          if (busy.has(x + ',' + y)) cost++;
        }
      }
      return cost;
    }

    /** Trajet en L évitant les composants ; à égalité, on suit le premier mouvement de la souris. */
    _bestRoute(a, b, hFirst) {
      const pref = route(a, b, hFirst), other = route(a, b, !hFirst);
      return this._routeCost(other) < this._routeCost(pref) ? other : pref;
    }

    _bind() {
      const c = this.canvas;
      const pos = (e) => {
        const r = c.getBoundingClientRect();
        return { px: e.clientX - r.left, py: e.clientY - r.top };
      };
      c.addEventListener('pointerdown', (e) => {
        if (this.paletteDrag) return;
        const p = pos(e);
        const w = this.r.toWorld(p.px, p.py);
        c.setPointerCapture(e.pointerId);
        this._down(e, p, w);
      });
      c.addEventListener('pointermove', (e) => {
        if (this.paletteDrag) return;
        const p = pos(e);
        this._move(p, this.r.toWorld(p.px, p.py));
      });
      c.addEventListener('pointerup', (e) => {
        if (this.paletteDrag) return;
        const p = pos(e);
        this._up(this.r.toWorld(p.px, p.py));
      });
      c.addEventListener('pointercancel', () => { this.gesture = null; this.draft = null; });
      c.addEventListener('pointerleave', () => {
        if (!this.gesture) {
          this.hover = null;
          if (this.tool !== 'select' && this.tool !== 'wire' && this.tool !== 'erase') this.ghost = null;
          this.app.invalidate();
        }
      });
      c.addEventListener('wheel', (e) => {
        e.preventDefault();
        const p = pos(e);
        this.zoomAt(p.px, p.py, e.deltaY > 0 ? 1 / 1.15 : 1.15);
      }, { passive: false });

      // Glisser depuis la palette
      window.addEventListener('pointermove', (e) => {
        if (!this.paletteDrag) return;
        const p = pos(e);
        const inside = p.px >= 0 && p.py >= 0 && p.px <= this.r.w && p.py <= this.r.h;
        if (inside) this._updateGhost(this.r.toWorld(p.px, p.py));
        else this.ghost = null;
      });
      window.addEventListener('pointerup', (e) => {
        if (!this.paletteDrag) return;
        this.paletteDrag = false;
        const p = pos(e);
        const inside = p.px >= 0 && p.py >= 0 && p.px <= this.r.w && p.py <= this.r.h;
        const moved = Math.hypot(e.clientX - this.paletteStart.x, e.clientY - this.paletteStart.y) > 6;
        if (inside && this.ghost) {
          this._place(this.ghost);
          this.setTool('select');
        } else if (moved) {
          this.setTool('select');
        }
        // Simple clic sur la palette : l'outil reste actif pour poser plusieurs composants.
      });
    }

    /** Appelé par la palette au début d'un glisser. */
    startPaletteDrag(type, e) {
      this.setTool(type);
      this.paletteDrag = true;
      this.paletteStart = { x: e.clientX, y: e.clientY };
    }

    zoomAt(px, py, f) {
      const v = this.r.view;
      const s = Math.max(6, Math.min(70, v.scale * f));
      const k = s / v.scale;
      v.ox = px - (px - v.ox) * k;
      v.oy = py - (py - v.oy) * k;
      v.scale = s;
      this.app.invalidate();
    }

    _updateGhost(w) {
      const type = this.tool;
      this.ghost = /** @type {any} */ ({
        type, x: Math.round(w.x), y: Math.round(w.y), rot: this.rot,
        params: defaultParams(type), label: '',
      });
    }

    _place(g) {
      const app = this.app;
      app.structuralEdit(() => {
        const c = addComp(app.doc, g.type, g.x, g.y, g.rot);
        this.select({ comp: c.id });
      });
    }

    _down(e, p, w) {
      const tool = this.tool, h = this.hit(w);
      const grid = [Math.round(w.x), Math.round(w.y)];
      // Clic milieu ou espace : déplacement de la vue quel que soit l'outil.
      if (e.button === 1) { this.gesture = { kind: 'pan', px: p.px, py: p.py, ox: this.r.view.ox, oy: this.r.view.oy }; return; }
      if (tool === 'wire') { this.gesture = { kind: 'wire', from: grid, hFirst: null }; return; }
      if (tool === 'erase') {
        this.gesture = { kind: 'erase', did: false };
        this._eraseAt(w);
        return;
      }
      if (tool !== 'select') {
        this._updateGhost(w);
        this._place(this.ghost);
        return;
      }
      if (h.term) { this.gesture = { kind: 'wire', from: h.term, hFirst: null, fromTerm: true, wasComp: h.comp, start: w }; return; }
      if (h.comp) {
        this.select({ comp: h.comp.id });
        this.gesture = { kind: 'move', comp: h.comp, sx: w.x, sy: w.y, ox: h.comp.x, oy: h.comp.y, moved: false };
        return;
      }
      if (h.wire) {
        // Depuis l'extrémité libre d'un fil, on le prolonge ; ailleurs, on le sélectionne.
        const touching = this.app.doc.wires.map(parseEdge)
          .filter((e) => (e.x === grid[0] && e.y === grid[1]) || (e.x2 === grid[0] && e.y2 === grid[1])).length;
        if (touching === 1 && Math.hypot(w.x - grid[0], w.y - grid[1]) < 0.42) {
          this.gesture = { kind: 'wire', from: grid, hFirst: null };
          return;
        }
        this.select({ wire: this.wireRun(h.wire) });
        return;
      }
      this.select(null);
      this.gesture = { kind: 'pan', px: p.px, py: p.py, ox: this.r.view.ox, oy: this.r.view.oy };
    }

    _move(p, w) {
      const g = this.gesture;
      this.mouseWorld = w;
      this.mousePx = p;
      if (!g) {
        const h = this.hit(w);
        this.hover = { comp: h.comp ? h.comp.id : null, wire: h.wire, term: this.tool === 'wire' || this.tool === 'select' ? h.term : null };
        if (this.tool === 'select') {
          this.canvas.style.cursor = h.term ? 'crosshair' : h.comp ? (h.comp.type === 'switch' ? 'pointer' : 'grab') : h.wire ? 'pointer' : 'default';
        }
        if (this.tool !== 'select' && this.tool !== 'wire' && this.tool !== 'erase') this._updateGhost(w);
        this.app.invalidate();
        return;
      }
      if (g.kind === 'pan') {
        this.r.view.ox = g.ox + p.px - g.px;
        this.r.view.oy = g.oy + p.py - g.py;
      } else if (g.kind === 'wire') {
        const to = [Math.round(w.x), Math.round(w.y)];
        if (g.hFirst === null && (to[0] !== g.from[0] || to[1] !== g.from[1])) g.hFirst = Math.abs(w.x - g.from[0]) >= Math.abs(w.y - g.from[1]);
        this.draft = this._bestRoute(g.from, to, g.hFirst !== false);
      } else if (g.kind === 'move') {
        const nx = g.ox + Math.round(w.x - g.sx), ny = g.oy + Math.round(w.y - g.sy);
        if (nx !== g.comp.x || ny !== g.comp.y) {
          if (!g.moved) {
            // Le déplacement ne commence vraiment qu'ici : le clic simple reste un clic.
            this.app.beforeStructural();
            g.moved = true;
            g.oldTerms = terminals(g.comp).map((t) => [t[0], t[1]]);
            g.connected = g.oldTerms.map((t) => this._isConnected(t, g.comp));
          }
          g.comp.x = nx; g.comp.y = ny;
        }
      } else if (g.kind === 'erase') {
        this._eraseAt(w);
      }
      this.app.invalidate();
    }

    /** Une borne a-t-elle quelque chose d'autre sur son point de grille ? */
    _isConnected(t, self) {
      const doc = this.app.doc;
      const [x, y] = t;
      for (const key of doc.wires) {
        const e = parseEdge(key);
        if ((e.x === x && e.y === y) || (e.x2 === x && e.y2 === y)) return true;
      }
      return doc.comps.some((c) => c !== self && terminals(c).some((q) => q[0] === x && q[1] === y));
    }

    _up(w) {
      const g = this.gesture, app = this.app;
      this.gesture = null;
      if (!g) return;
      if (g.kind === 'wire') {
        const to = [Math.round(w.x), Math.round(w.y)];
        const pts = this._bestRoute(g.from, to, g.hFirst !== false);
        this.draft = null;
        if (to[0] === g.from[0] && to[1] === g.from[1]) {
          // Clic sur une borne sans tracer : on sélectionne son composant.
          if (g.wasComp) this.select({ comp: g.wasComp.id });
          app.invalidate();
          return;
        }
        app.structuralEdit(() => {
          for (let i = 0; i + 1 < pts.length; i++) addWireLine(app.doc, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
        });
      } else if (g.kind === 'move') {
        if (g.moved) {
          // Les fils suivent : on prolonge chaque connexion jusqu'à la nouvelle position de la borne.
          const now = terminals(g.comp);
          g.oldTerms.forEach((old, i) => {
            if (!g.connected[i]) return;
            const pts = this._bestRoute(old, now[i], Math.abs(now[i][0] - old[0]) >= Math.abs(now[i][1] - old[1]));
            for (let n = 0; n + 1 < pts.length; n++) addWireLine(app.doc, pts[n][0], pts[n][1], pts[n + 1][0], pts[n + 1][1]);
          });
          app.afterStructural();
        } else if (g.comp.type === 'switch') {
          app.toggleSwitch(g.comp.id);
        }
      } else if (g.kind === 'erase' && g.did) {
        app.afterStructural();
      }
      app.invalidate();
    }

    _eraseAt(w) {
      const h = this.hit(w), app = this.app, g = this.gesture;
      if (!h.comp && !h.wire) return;
      if (!g.did) { app.beforeStructural(); g.did = true; }
      if (h.comp) {
        app.doc.comps = app.doc.comps.filter((c) => c !== h.comp);
        app.doc.probes = app.doc.probes.filter((q) => q.id !== h.comp.id);
        if (this.sel && this.sel.comp === h.comp.id) this.select(null);
      } else if (h.wire) {
        app.doc.wires = app.doc.wires.filter((k) => k !== h.wire);
      }
      this.hover = null;
    }

    deleteSelection() {
      const s = this.sel, app = this.app;
      if (!s) return;
      app.structuralEdit(() => {
        if (s.comp) {
          app.doc.comps = app.doc.comps.filter((c) => c.id !== s.comp);
          app.doc.probes = app.doc.probes.filter((q) => q.id !== s.comp);
        } else if (s.wire) {
          app.doc.wires = app.doc.wires.filter((k) => !s.wire.has(k));
        }
        this.select(null);
      });
    }

    /** R : tourne le composant en pose, ou le composant sélectionné autour de son centre. */
    rotateAction() {
      if (TYPES[this.tool]) {
        this.rot = (this.rot + 1) % 4;
        if (this.ghost) this.ghost.rot = this.rot;
        this.app.invalidate();
        return;
      }
      if (this.sel && this.sel.comp) {
        const c = this.app.doc.comps.find((x) => x.id === this.sel.comp);
        if (c) this.app.structuralEdit(() => { c.rot = (c.rot + 1) % 4; });
      }
    }
  }

  RLC.Editor = Editor;
})(/** @type {any} */ (globalThis).RLC ??= {});
