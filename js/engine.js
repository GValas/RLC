// @ts-check
// Moteur de simulation : analyse nodale modifiée, trapèzes à pas adaptatif, Euler implicite aux
// discontinuités, historique complet (donc temps réversible) et calcul du régime permanent.
(function (RLC) {
  'use strict';
  const { luFactor, luSolve, eigenvalues } = RLC.linalg;
  const { compile } = RLC.circuit;

  const GMIN = 1e-12;            // fuite minimale de chaque nœud, évite les nœuds flottants
  const DT_INIT = Math.pow(2, -33); // ≈ 0,12 ns : pas d'Euler implicite juste après une discontinuité
  const DT_MIN = Math.pow(2, -40);  // ≈ 0,9 ps
  const RTOL = 3e-5, ATOL_V = 1e-7, ATOL_I = 1e-10;
  const SETTLE_EPS = 0.01;       // régime permanent : écart inférieur à 1 %
  const MAX_BYTES = 64 * 1024 * 1024;
  const FILTER_ALL = { mode: 'all', f: 0 };
  const FILTER_OFF = { mode: 'off', f: 0 };
  const FILTER_DC = { mode: 'dc', f: 0 };
  const FILTER_NL = { mode: 'nl', f: 0 }; // configuration figée : ni échelon ni basculement à venir
  const DIODE_S = 0.01;          // arrondi du coude de la diode (V) : Newton converge mieux qu'avec un angle
  const DIODE_GOFF = 1e-9;       // conductance de fuite de la diode bloquée
  const CLAMP_RATE = 1e9;        // rappel de la sortie d'AOP au-delà de la saturation (1/s)
  const LOOKAHEAD_MS = 400;      // temps de calcul maximal pour chercher un régime permanent non linéaire

  /** softplus(x) = ln(1 + eˣ) et sa dérivée, sans dépassement. */
  function softplus(x) {
    if (x > 40) return { v: x, d: 1 };
    if (x < -40) return { v: 0, d: 0 };
    const e = Math.exp(x);
    return { v: Math.log1p(e), d: e / (1 + e) };
  }

  /** Caractéristique de la diode : courant et conductance pour une tension u. */
  function diodeIG(p, u) {
    const gon = 1 / p.Rd;
    const f = softplus((u - p.Vd) / DIODE_S);
    let i = gon * DIODE_S * f.v + DIODE_GOFF * u;
    let G = gon * f.d + DIODE_GOFF;
    if (p.Vz > 0) {
      const z = softplus((-u - p.Vz) / DIODE_S);
      i -= gon * DIODE_S * z.v;
      G += gon * z.d;
    }
    return { i, G };
  }

  /** dx/dt de la tension interne de l'AOP et ses dérivées par rapport à ε et x. */
  function opampF(p, eps, x) {
    const wT = 2 * Math.PI * p.gbw;
    const tau = p.mu0 / wT;
    const arg = wT * eps / p.sr;
    const t = Math.tanh(arg);
    let f = p.sr * t - x / tau;
    const fe = Math.abs(arg) > 20 ? 0 : wT * (1 - t * t);
    let fx = -1 / tau;
    const over = Math.abs(x) - p.vsat;
    if (over > 0) {
      f -= CLAMP_RATE * over * Math.sign(x);
      fx -= CLAMP_RATE;
    }
    return { f, fe, fx };
  }

  /** Plus petite période commune à des fréquences, 0 si elles ne sont pas commensurables. */
  function commonPeriod(freqs) {
    const f0 = Math.min(...freqs);
    for (let d = 1; d <= 12; d++) {
      const base = f0 / d;
      if (freqs.every((f) => Math.abs(f / base - Math.round(f / base)) < 1e-6)) return 1 / base;
    }
    return 0;
  }

  /**
   * @typedef {{u: Float64Array, i: Float64Array, V: Float64Array}} State
   * @typedef {{mode: string, f: number}} Filter
   */

  /** Valeur d'une source à l'instant t, éventuellement restreinte à une partie du signal. */
  function sourceValue(p, t, seg, filter) {
    const mode = filter.mode;
    if (mode === 'off') return 0;
    const wave = p.wave;
    if (mode === 'dc') {
      if (wave === 'dc') return p.A;
      if (wave === 'step') return p.off + (p.t0 <= seg.tStart + 1e-15 ? p.A : 0);
      return p.off;
    }
    if (mode === 'sq') {
      if (wave !== 'square' || p.f !== filter.f) return 0;
      return squarePhase(p, t) < p.duty / 100 ? p.A : -p.A;
    }
    if (mode === 'nl' && wave === 'step') return p.off + (p.t0 <= seg.tStart + 1e-15 ? p.A : 0);
    switch (wave) {
      case 'dc': return p.A;
      case 'sine': return p.off + p.A * Math.sin(2 * Math.PI * p.f * t + p.phase * Math.PI / 180);
      case 'square': return p.off + (squarePhase(p, t) < p.duty / 100 ? p.A : -p.A);
      case 'step': return p.off + (t >= p.t0 ? p.A : 0);
    }
    return 0;
  }
  function squarePhase(p, t) {
    const x = p.f * t + p.phase / 360;
    return x - Math.floor(x);
  }
  /** Prochain front d'un signal carré strictement après t. */
  function nextSquareEdge(p, t) {
    const T = 1 / p.f, d = p.duty / 100, ph = p.phase / 360;
    const x = p.f * t + ph;
    const base = Math.floor(x);
    for (const c of [base + d, base + 1, base + 1 + d]) {
      const te = (c - ph) * T;
      if (te > t + T * 1e-9) return te;
    }
    return t + T;
  }

  /** Plus grande puissance de deux ≤ x : tous les pas réguliers partagent le cache de factorisations. */
  function quantDt(x) {
    return isFinite(x) ? Math.pow(2, Math.floor(Math.log2(x))) : x;
  }

  class Sim {
    /** @param {any} doc document (une copie est conservée) */
    constructor(doc, opts = {}) {
      this.lookaheadMs = opts.lookaheadMs ?? LOOKAHEAD_MS;
      this.doc = RLC.circuit.cloneDoc(doc);
      this.net = compile(this.doc);
      this.errors = this.net.errors;
      this.warnings = this.net.warnings.slice();
      if (this.errors.length) return;
      const comps = this.net.comps;
      this.K = comps.length;
      this.nNets = this.net.nNets;
      // Branches supplémentaires : une par générateur de tension.
      let n = this.net.nNodes;
      this.branch = new Int32Array(this.K).fill(-1);
      comps.forEach((c, k) => { if (c.type === 'vsource') this.branch[k] = n++; });
      // Un AOP ajoute deux inconnues : sa tension interne x et son courant de sortie.
      this.bx = new Int32Array(this.K).fill(-1);
      this.bi = new Int32Array(this.K).fill(-1);
      comps.forEach((c, k) => { if (c.type === 'opamp') { this.bx[k] = n++; this.bi[k] = n++; } });
      this.N = n;
      this.react = [];
      comps.forEach((c, k) => { if (c.type === 'capacitor' || c.type === 'inductor') this.react.push(k); });
      this.diodes = [];
      this.opamps = [];
      comps.forEach((c, k) => {
        if (c.type === 'diode') this.diodes.push(k);
        if (c.type === 'opamp') this.opamps.push(k);
      });
      this.nonlinear = this.diodes.length + this.opamps.length > 0;
      /** Grandeurs à mémoire, celles qui définissent le régime atteint. */
      this.stateK = [...this.react, ...this.opamps];
      // Pour juger du régime, seuls C et L comptent. La sortie d'un AOP bascule si vite qu'un décalage
      // infime la ferait paraître loin du régime établi ; seul, un AOP s'établit en quelques µs.
      this.residualK = this.react;
      this.a = comps.map((c) => this.net.mna[c.a]);
      this.b = comps.map((c) => this.net.mna[c.b]);
      this.o = comps.map((c) => (c.c === undefined ? -1 : this.net.mna[c.c]));
      if (this.nonlinear) {
        this.nlA = new Float64Array(n * n);
        this.nlR = new Float64Array(n);
        this.nlX = new Float64Array(n);
      }

      // Historique : t, n° de segment, écart au permanent, u[K], i[K], V[nets]
      this.width = 3 + 2 * this.K + this.nNets;
      this.cap = Math.max(1024, Math.floor((opts.maxBytes || MAX_BYTES) / 8 / this.width));
      this.h = new Float64Array(this.cap * this.width);
      this.len = 0;

      this.rhs = new Float64Array(this.N);
      this.segments = [];
      this.overvoltage = false;
      /** @type {any} */
      this.ctx = {
        seg: null, t: 0, dt: DT_INIT, filter: FILTER_ALL, dtMax: Infinity, peak: new Float64Array(this.K),
        st: this._newState(), spare: this._newState(), s1: this._newState(), s2: this._newState(), s3: this._newState(),
      };

      const params = comps.map((c) => ({ ...c.comp.params }));
      const closed = comps.map((c) => (c.type === 'switch' ? !!c.comp.params.closed : false));
      // État avant la mise sous tension.
      comps.forEach((c, k) => {
        if (c.type === 'capacitor') this.ctx.st.u[k] = params[k].V0;
        if (c.type === 'inductor') this.ctx.st.i[k] = params[k].I0;
        if (c.type === 'opamp') this.ctx.st.u[k] = params[k].x0;
      });
      this.tc = this._charTime(params, closed);
      this._push(0, 0, 0, this.ctx.st);
      this._startSegment(0, params, closed, 'Mise sous tension');
      this.t = this.ctx.t;
    }

    _newState() {
      return { u: new Float64Array(this.K), i: new Float64Array(this.K), V: new Float64Array(this.nNets) };
    }

    // ---------- Assemblage ----------

    /** Matrice MNA pour un pas dt et une méthode ('T' trapèzes, 'E' Euler implicite). */
    _buildMatrix(seg, dt, method, gmin = GMIN, ideal = false) {
      const N = this.N, A = new Float64Array(N * N);
      const add = (i, j, v) => { if (i >= 0 && j >= 0) A[i * N + j] += v; };
      const stampG = (a, b, G) => { add(a, a, G); add(b, b, G); add(a, b, -G); add(b, a, -G); };
      for (let n = 0; n < this.net.nNodes; n++) A[n * N + n] += gmin;
      for (let k = 0; k < this.K; k++) {
        const type = this.net.comps[k].type, p = seg.params[k], a = this.a[k], b = this.b[k];
        switch (type) {
          case 'resistor':
          case 'lamp': stampG(a, b, 1 / p.R); break;
          case 'switch': {
            const G = seg.closed[k] ? 1 / p.Ron : (ideal ? 0 : 1 / p.Roff);
            stampG(a, b, G);
            break;
          }
          case 'capacitor': stampG(a, b, (method === 'T' ? 2 : 1) * p.C / dt); break;
          case 'inductor': stampG(a, b, 1 / ((method === 'T' ? 2 : 1) * p.L / dt + (p.r || 0))); break;
          case 'vsource': {
            const br = this.branch[k];
            add(a, br, 1); add(b, br, -1); add(br, a, 1); add(br, b, -1);
            add(br, br, -(p.r || 0));
            break;
          }
          case 'opamp': {
            // Sortie : Vs = x − Rout·i, avec i sortant de l'AOP. La ligne de x est écrite par Newton.
            const o = this.o[k], bi = this.bi[k];
            add(o, bi, -1);
            add(bi, o, 1);
            add(bi, this.bx[k], -1);
            add(bi, bi, p.rout);
            break;
          }
        }
      }
      return A;
    }

    _lu(seg, dt, method) {
      const key = method + dt;
      let f = seg.lus.get(key);
      if (!f) {
        f = this._factor(seg, dt, method);
        if (seg.lus.size > 80) seg.lus.clear();
        seg.lus.set(key, f);
      }
      return f;
    }

    /** Linéaire : matrice factorisée. Non linéaire : partie fixe, que Newton complète à chaque itération. */
    _factor(seg, dt, method) {
      const A = this._buildMatrix(seg, dt, method);
      return this.nonlinear ? A : luFactor(A, this.N);
    }

    /**
     * Newton sur les éléments non linéaires. L'état initial de la solution est l'état précédent.
     * `base` est la matrice linéaire, `rhs` son second membre, remplacé par la solution.
     * @returns {boolean} vrai si l'itération a convergé
     */
    _newton(seg, base, dt, st, rhs) {
      const N = this.N, A = this.nlA, r = this.nlR, x = this.nlX;
      const mna = this.net.mna;
      for (let n = 0; n < this.nNets; n++) if (mna[n] >= 0) x[mna[n]] = st.V[n];
      for (let k = 0; k < this.K; k++) {
        if (this.branch[k] >= 0) x[this.branch[k]] = st.i[k];
        if (this.bx[k] >= 0) {
          x[this.bx[k]] = st.u[k] + seg.params[k].rout * st.i[k];
          x[this.bi[k]] = st.i[k];
        }
      }
      const volt = (/** @type {number} */ n) => (n >= 0 ? x[n] : 0);
      for (let iter = 0; iter < 60; iter++) {
        A.set(base);
        r.set(rhs);
        for (const k of this.diodes) {
          const a = this.a[k], b = this.b[k], u = volt(a) - volt(b);
          const { i, G } = diodeIG(seg.params[k], u);
          const Ieq = i - G * u;
          if (a >= 0) { A[a * N + a] += G; r[a] -= Ieq; if (b >= 0) A[a * N + b] -= G; }
          if (b >= 0) { A[b * N + b] += G; r[b] += Ieq; if (a >= 0) A[b * N + a] -= G; }
        }
        for (const k of this.opamps) {
          // Euler implicite : x₁ − x₀ = dt·f(ε₁, x₁). Il reste stable malgré la raideur de la boucle.
          const p = seg.params[k], a = this.a[k], b = this.b[k], bx = this.bx[k];
          const eps = volt(a) - volt(b), xk = x[bx];
          const x0 = st.u[k] + p.rout * st.i[k];
          const { f, fe, fx } = opampF(p, eps, xk);
          A[bx * N + bx] += 1 - dt * fx;
          if (a >= 0) A[bx * N + a] -= dt * fe;
          if (b >= 0) A[bx * N + b] += dt * fe;
          r[bx] = x0 + dt * (f - fe * eps - fx * xk);
        }
        luSolve(luFactor(A, N), r);
        const relax = iter > 25 ? 0.5 : 1;  // en cas de ballottement entre deux états, on amortit
        let change = 0;
        for (let i = 0; i < N; i++) {
          const nv = x[i] + relax * (r[i] - x[i]);
          const d = Math.abs(nv - x[i]) / (1e-6 + Math.abs(nv));
          if (d > change) change = d;
          x[i] = nv;
        }
        if (change < 1e-8 && relax === 1) { rhs.set(x); return true; }
        if (!(change < Infinity)) break;
      }
      rhs.set(x);
      return false;
    }

    /** Résout un pas et écrit le nouvel état dans `out`. tEval est l'instant où lire les sources. */
    _solve(seg, f, dt, method, st, tEval, filter, out) {
      const rhs = this.rhs;
      rhs.fill(0);
      const comps = this.net.comps;
      const addI = (a, b, I) => { if (a >= 0) rhs[a] += I; if (b >= 0) rhs[b] -= I; };
      for (let k = 0; k < this.K; k++) {
        const type = comps[k].type, p = seg.params[k], a = this.a[k], b = this.b[k];
        if (type === 'capacitor') {
          const G = (method === 'T' ? 2 : 1) * p.C / dt;
          const Ieq = method === 'T' ? -G * st.u[k] - st.i[k] : -G * st.u[k];
          addI(a, b, -Ieq);
        } else if (type === 'inductor') {
          const r = p.r || 0;
          let Ieq;
          if (method === 'T') {
            const Z = 2 * p.L / dt;
            Ieq = ((Z - r) * st.i[k] + st.u[k]) / (Z + r);
          } else {
            const Z = p.L / dt;
            Ieq = (Z * st.i[k]) / (Z + r);
          }
          addI(a, b, -Ieq);
        } else if (type === 'vsource') {
          rhs[this.branch[k]] = sourceValue(p, tEval, seg, filter);
        } else if (type === 'isource') {
          addI(a, b, sourceValue(p, tEval, seg, filter));
        }
      }
      let ok = true;
      if (this.nonlinear) ok = this._newton(seg, f, dt, st, rhs);
      else luSolve(f, rhs);
      const mna = this.net.mna;
      for (let n = 0; n < this.nNets; n++) out.V[n] = mna[n] >= 0 ? rhs[mna[n]] : 0;
      for (let k = 0; k < this.K; k++) {
        const c = comps[k], p = seg.params[k];
        const u = out.V[c.a] - out.V[c.b];
        out.u[k] = u;
        switch (c.type) {
          case 'resistor':
          case 'lamp': out.i[k] = u / p.R; break;
          case 'switch': out.i[k] = seg.closed[k] ? u / p.Ron : u / p.Roff; break;
          case 'capacitor': {
            const G = (method === 'T' ? 2 : 1) * p.C / dt;
            out.i[k] = method === 'T' ? G * (u - st.u[k]) - st.i[k] : G * (u - st.u[k]);
            break;
          }
          case 'inductor': {
            const r = p.r || 0;
            if (method === 'T') {
              const Z = 2 * p.L / dt;
              out.i[k] = (u + (Z - r) * st.i[k] + st.u[k]) / (Z + r);
            } else {
              const Z = p.L / dt;
              out.i[k] = (u + Z * st.i[k]) / (Z + r);
            }
            break;
          }
          case 'vsource': out.i[k] = rhs[this.branch[k]]; break;
          case 'isource': out.i[k] = -sourceValue(p, tEval, seg, filter); break;
          case 'diode': out.i[k] = diodeIG(p, u).i; break;
          case 'opamp':
            // Pour un AOP : u est le potentiel de sortie, i le courant qui en sort.
            out.u[k] = out.V[c.c];
            out.i[k] = rhs[this.bi[k]];
            break;
          default: out.i[k] = 0;
        }
      }
      return ok;
    }

    // ---------- Pas de temps ----------

    /** Prochaine discontinuité strictement après t. */
    _nextBreak(seg, t, filter) {
      let bp = Infinity;
      if (filter.mode === 'off' || filter.mode === 'dc') return bp;
      const scheduled = filter.mode === 'all';
      for (let k = 0; k < this.K; k++) {
        const c = this.net.comps[k], p = seg.params[k];
        if (c.type === 'vsource' || c.type === 'isource') {
          if (p.wave === 'square' && (filter.mode !== 'sq' || p.f === filter.f)) bp = Math.min(bp, nextSquareEdge(p, t));
          if (scheduled && p.wave === 'step' && p.t0 > t + 1e-15) bp = Math.min(bp, p.t0);
        } else if (scheduled && c.type === 'switch' && p.tToggle > t + 1e-15) {
          bp = Math.min(bp, p.tToggle);
        }
      }
      return bp;
    }

    /** Euler implicite sur un pas minuscule : donne les valeurs juste après une discontinuité. */
    _reinit(ctx) {
      const f = this._lu(ctx.seg, DT_INIT, 'E');
      const out = ctx.spare;
      this._solve(ctx.seg, f, DT_INIT, 'E', ctx.st, ctx.t + DT_INIT, ctx.filter, out);
      ctx.spare = ctx.st;
      ctx.st = out;
      ctx.t += DT_INIT;
      ctx.dt = DT_INIT;
    }

    /**
     * Tente un pas par doublement de pas. Renvoie 0 si rejeté, 1 si accepté, 2 si on arrive sur une
     * discontinuité, 3 si on arrive sur `limit`.
     */
    _step(ctx, limit) {
      const seg = ctx.seg, react = this.react;
      let dt = Math.min(ctx.dt, ctx.dtMax);
      const edge = this._nextBreak(seg, ctx.t, ctx.filter);
      const bp = Math.min(edge, limit);
      let land = false;
      if (ctx.t + dt * 1.0001 >= bp) { dt = bp - ctx.t; land = true; }
      if (!(dt > 0)) return edge <= limit ? 2 : 3;
      const tEnd = land ? bp : ctx.t + dt;
      const tEval = land ? tEnd - dt * 1e-6 : tEnd;
      const quant = !land && dt === ctx.dt;

      const fFull = quant ? this._lu(seg, dt, 'T') : this._factor(seg, dt, 'T');
      const fHalf = quant ? this._lu(seg, dt / 2, 'T') : this._factor(seg, dt / 2, 'T');
      const { s1, s2, s3 } = ctx;
      const ok1 = this._solve(seg, fFull, dt, 'T', ctx.st, tEval, ctx.filter, s1);
      const ok2 = this._solve(seg, fHalf, dt / 2, 'T', ctx.st, ctx.t + dt / 2, ctx.filter, s2);
      const ok3 = this._solve(seg, fHalf, dt / 2, 'T', s2, tEval, ctx.filter, s3);

      let err = ok1 && ok2 && ok3 ? 0 : Infinity;
      const comps = this.net.comps, peak = ctx.peak;
      for (let j = 0; j < react.length; j++) {
        const k = react[j], isC = comps[k].type === 'capacitor';
        const x = isC ? s3.u[k] : s3.i[k], y = isC ? s1.u[k] : s1.i[k];
        const ax = Math.abs(x);
        if (ax > peak[k]) peak[k] = ax;
        const e = Math.abs(x - y) / 3 / ((isC ? ATOL_V : ATOL_I) + RTOL * peak[k]);
        if (e > err) err = e;
      }
      for (const k of this.opamps) {
        // La sortie bascule très vite : il faut résoudre le basculement, à 0,1 % de la saturation près.
        const e = Math.abs(s3.u[k] - s1.u[k]) / 3 / (1e-3 * seg.params[k].vsat);
        if (e > err) err = e;
      }
      if (!(err <= 1) && dt > DT_MIN) {
        ctx.dt = Math.max(quantDt(dt / 2), DT_MIN);
        return 0;
      }
      ctx.st.u.set(s3.u); ctx.st.i.set(s3.i); ctx.st.V.set(s3.V);
      ctx.t = tEnd;
      // Doubler le pas multiplie l'erreur par 8 : au-delà de 0,1, le pas suivant serait rejeté.
      if (!land && err < 0.1) ctx.dt = Math.min(ctx.dt * 2, ctx.dtMax);
      if (!land) return 1;
      return edge <= limit ? 2 : 3;
    }

    // ---------- Segments et régime permanent ----------

    /** Crée un segment (configuration figée) à l'instant t à partir de l'état courant. */
    _startSegment(t, params, closed, label) {
      const seg = {
        idx: this.segments.length, tStart: t, params, closed, label,
        lus: new Map(), modes: null, summary: null, steady: null, refs: null, lastAbove: t,
        settleWindow: 0, dtMax: Infinity, noSteady: false, undamped: false,
      };
      this.segments.push(seg);
      this._computeModes(seg);
      const ctx = this.ctx;
      this._computeSteady(seg, t, ctx.st);
      this._computeRefs(seg, t, ctx.st);
      ctx.seg = seg;
      ctx.t = t;
      ctx.dtMax = quantDt(seg.dtMax);
      ctx.filter = FILTER_ALL;
      this._reinit(ctx);
      this._push(ctx.t, seg.idx, this._residual(seg, ctx.t, ctx.st), ctx.st);
      return seg;
    }

    /**
     * Modes propres : on observe un pas d'Euler implicite, sources éteintes.
     * Si x⁺ = Φx alors chaque valeur propre μ de Φ donne λ = (1 − 1/μ)/dt.
     */
    _computeModes(seg) {
      if (this.nonlinear) {
        // Pas de modes propres globaux : seules les échelles de temps servent à borner le pas.
        seg.modes = [];
        seg.tSlow = 0;
        seg.tOsc = Infinity;
        seg.undamped = false;
        seg.summary = { items: [], order: 0 };
        seg.settleWindow = 0;
        let cap = this.tc > 0 ? this.tc / 400 : Infinity;
        for (let k = 0; k < this.K; k++) {
          const c = this.net.comps[k], p = seg.params[k];
          if ((c.type === 'vsource' || c.type === 'isource') && (p.wave === 'sine' || p.wave === 'square')) cap = Math.min(cap, 1 / p.f / 128);
        }
        seg.dtMax = cap;
        return;
      }
      const m = this.react.length;
      const dt = 1e-6;
      const modes = [];
      if (m > 0) {
        const f = luFactor(this._buildMatrix(seg, dt, 'E', 1e-15, true), this.N);
        const Phi = new Float64Array(m * m);
        const inp = this._newState(), out = this._newState();
        const comps = this.net.comps;
        for (let j = 0; j < m; j++) {
          inp.u.fill(0); inp.i.fill(0);
          const kj = this.react[j];
          if (comps[kj].type === 'capacitor') inp.u[kj] = 1; else inp.i[kj] = 1;
          this._solve(seg, f, dt, 'E', inp, dt, FILTER_OFF, out);
          for (let i = 0; i < m; i++) {
            const k = this.react[i];
            Phi[i * m + j] = comps[k].type === 'capacitor' ? out.u[k] : out.i[k];
          }
        }
        for (const mu of eigenvalues(Phi, m)) {
          const n2 = mu.re * mu.re + mu.im * mu.im;
          if (!isFinite(n2) || n2 < 1e-20) continue; // contrainte algébrique : mode instantané
          const re = (1 - mu.re / n2) / dt, im = (mu.im / n2) / dt;
          modes.push({ re, im });
        }
      }
      seg.modes = modes;

      // Échelles de temps utiles
      let tSlow = 0, tOsc = Infinity, tForce = Infinity, tcFree = 0;
      seg.undamped = false;
      for (const l of modes) {
        const mag = Math.hypot(l.re, l.im);
        if (mag < 1e-4) continue;             // grandeur conservée (charge d'un condensateur isolé)
        const w = Math.abs(l.im);
        const Q = w > 0 ? mag / (2 * Math.max(-l.re, 1e-300)) : 0;
        if (w > 1e-9 * mag) tOsc = Math.min(tOsc, 2 * Math.PI / w);
        if (w > 1e-9 * mag && Q > 1e5) {
          seg.undamped = true;
          tcFree = Math.max(tcFree, 5 * 2 * Math.PI / w);
        } else if (l.re < 0) {
          tSlow = Math.max(tSlow, -1 / l.re);
          tcFree = Math.max(tcFree, 5 / -l.re);
        }
      }
      for (let k = 0; k < this.K; k++) {
        const c = this.net.comps[k], p = seg.params[k];
        if ((c.type === 'vsource' || c.type === 'isource') && (p.wave === 'sine' || p.wave === 'square')) {
          tForce = Math.min(tForce, 1 / p.f);
        }
      }
      seg.tSlow = tSlow;
      seg.tOsc = tOsc;
      let cap = this.tc > 0 ? this.tc / 400 : Infinity;
      if (tForce < Infinity) cap = Math.min(cap, tForce / 128);
      // Un mode parasite (bobine coupée, dont la seule fuite est GMIN) ne doit pas brider le pas : passé
      // sa brève extinction, plus rien n'évolue. Le contrôle d'erreur suffit à le résoudre.
      const PARASITIC = 1e-9;
      if (tOsc > PARASITIC && tOsc < Infinity) cap = Math.min(cap, tOsc / 256); // l'erreur de phase des trapèzes s'accumule
      if (tSlow > PARASITIC) cap = Math.min(cap, tSlow / 16);
      seg.dtMax = Math.max(cap, DT_INIT);
      seg.settleWindow = Math.max(0.5 * tSlow, tOsc < Infinity ? tOsc / 2 : 0);
      seg.summary = summarizeModes(modes);
    }

    /** Durée caractéristique pour régler vitesse et fenêtre, en essayant aussi interrupteurs fermés. */
    _charTime(params, closed) {
      if (this.nonlinear) return this._charTimeNL(params);
      const one = (cl) => {
        const seg = /** @type {any} */ ({ params, closed: cl, tStart: 0, lus: new Map() });
        const saved = this.tc;
        this.tc = 0;
        this._computeModes(seg);
        this.tc = saved;
        let tc = 0;
        for (const l of seg.modes) {
          const mag = Math.hypot(l.re, l.im);
          if (mag < 1e-4) continue;
          const w = Math.abs(l.im);
          const Q = w > 0 ? mag / (2 * Math.max(-l.re, 1e-300)) : 0;
          if (w > 1e-9 * mag && Q > 1e5) tc = Math.max(tc, 10 * Math.PI / w);
          else if (l.re < 0) tc = Math.max(tc, 5 / -l.re);
        }
        return tc;
      };
      // Trois configurations : l'état initial, tout fermé et tout ouvert (une minuterie ne révèle sa
      // constante de temps qu'une fois son interrupteur ouvert).
      const isSwitch = (/** @type {number} */ k) => this.net.comps[k].type === 'switch';
      let tc = Math.max(one(closed), one(closed.map((c, k) => isSwitch(k) || c)), one(closed.map((c, k) => !isSwitch(k) && c)));
      // Il faut voir la réponse après le dernier événement programmé, pas seulement l'événement.
      let lastEvent = 0;
      for (let k = 0; k < this.K; k++) {
        const c = this.net.comps[k], p = params[k];
        if ((c.type === 'vsource' || c.type === 'isource')) {
          if (p.wave === 'sine' || p.wave === 'square') tc = Math.max(tc, 4 / p.f);
          if (p.wave === 'step') lastEvent = Math.max(lastEvent, p.t0);
        }
        if (c.type === 'switch' && p.tToggle > 0) lastEvent = Math.max(lastEvent, p.tToggle);
      }
      tc += lastEvent;
      if (tc < 1e-6) tc = 1e-6;
      if (!this.react.length && tc <= 1e-6) tc = 1;
      return tc;
    }

    /**
     * Circuit non linéaire : estimation à partir des produits RC et L/R des éléments voisins. Elle est
     * ensuite affinée par la durée que la simulation anticipée a mis à trouver le régime établi.
     */
    _charTimeNL(params) {
      const comps = this.net.comps;
      const touching = (c) => comps.flatMap((o, j) => (o !== c && (o.type === 'resistor' || o.type === 'lamp') && (o.a === c.a || o.b === c.a || o.a === c.b || o.b === c.b) ? [params[j].R] : []));
      let tau = 0, tc = 0, lastEvent = 0;
      comps.forEach((c, k) => {
        const p = params[k];
        if (c.type === 'capacitor') {
          for (const R of touching(c)) tau = Math.max(tau, R * p.C);
        } else if (c.type === 'inductor') {
          const Rs = touching(c);
          if (p.r > 0) Rs.push(p.r);
          if (Rs.length) tau = Math.max(tau, p.L / Math.min(...Rs));
        } else if (c.type === 'vsource' || c.type === 'isource') {
          if (p.wave === 'sine' || p.wave === 'square') tc = Math.max(tc, 4 / p.f);
          if (p.wave === 'step') lastEvent = Math.max(lastEvent, p.t0);
        } else if (c.type === 'switch' && p.tToggle > 0) lastEvent = Math.max(lastEvent, p.tToggle);
      });
      this.tauHeur = tau;
      tc = Math.max(tc, 5 * tau) + lastEvent;
      return tc > 0 ? tc : 1e-3;
    }

    /**
     * Régime permanent d'un circuit non linéaire : on simule à l'avance, sans toucher à l'historique,
     * jusqu'à trouver un état stationnaire ou une orbite périodique, forcée ou auto-entretenue.
     */
    _computeSteadyNL(seg, t0, st0) {
      const steady = { dcU: new Float64Array(this.K), dcI: new Float64Array(this.K), terms: [], tables: [] };
      seg.steady = steady;
      seg.noSteady = false;
      seg.nl = { kind: 'unknown', T: 0 };
      const freqs = [];
      for (let k = 0; k < this.K; k++) {
        const c = this.net.comps[k], p = seg.params[k];
        if ((c.type === 'vsource' || c.type === 'isource') && (p.wave === 'sine' || p.wave === 'square')) freqs.push(p.f);
      }
      const T = freqs.length ? commonPeriod(freqs) : 0;
      const ctx = this._newCtx(seg, st0, t0, FILTER_NL, seg.dtMax);
      this._reinit(ctx);
      const deadline = performance.now() + this.lookaheadMs;
      let found = null;
      if (freqs.length) { if (T) found = this._seekForced(ctx, t0, T, deadline); }
      else found = this._seekFree(ctx, t0, deadline);
      if (!found) { seg.noSteady = true; return; }
      if (found.table) {
        steady.tables.push(found.table);
        seg.nl = { kind: T ? 'forced' : 'oscillator', T: found.table.T };
        seg.settleWindow = found.table.T / 2;
      } else {
        steady.dcU.set(ctx.st.u);
        steady.dcI.set(ctx.st.i);
        seg.nl = { kind: 'stationary', T: 0 };
      }
      this.tc = Math.max(this.tc, Math.min(found.elapsed, this.tc * 40) + (found.table ? 3 * found.table.T : 0));
    }

    /** Une ligne d'échantillon de table : instant relatif, puis u et i de chaque composant. */
    _row(rows, t, st) {
      rows.push(t);
      for (let k = 0; k < this.K; k++) rows.push(st.u[k], st.i[k]);
    }

    /** Écart relatif entre deux états à mémoire. */
    _stateGap(a, b, scale) {
      let d = 0;
      for (let j = 0; j < this.stateK.length; j++) {
        const k = this.stateK[j], ind = this.net.comps[k].type === 'inductor';
        const v = Math.abs((ind ? a.i[k] : a.u[k]) - (ind ? b[2 * k + 1] : b[2 * k])) / scale[j];
        if (v > d) d = v;
      }
      return d;
    }

    /** Fait avancer `ctx` jusqu'à tEnd en appelant onRow après chaque pas. Faux si le temps manque. */
    _runTo(ctx, tEnd, deadline, onRow) {
      let n = 0;
      while (ctx.t < tEnd) {
        if ((++n & 31) === 0 && performance.now() > deadline) return false;
        const res = this._step(ctx, tEnd);
        if (res === 0) continue;
        onRow();
        if (res === 2 && ctx.t < tEnd) { this._reinit(ctx); onRow(); }
      }
      return true;
    }

    /** Signal périodique imposé : on compare l'état d'une période à l'autre. */
    _seekForced(ctx, t0, T, deadline) {
      const K = this.K, wRow = 1 + 2 * K;
      const scale = this.stateK.map(() => 1e-6);
      const snap = () => { const s = new Float64Array(2 * K); for (let k = 0; k < K; k++) { s[2 * k] = ctx.st.u[k]; s[2 * k + 1] = ctx.st.i[k]; } return s; };
      let prev = null, dPrev = Infinity;
      for (let n = 1; ; n++) {
        const tA = t0 + (n - 1) * T, tEnd = t0 + n * T;
        /** @type {number[]} */
        const rows = [];
        this._row(rows, ctx.t - tA, ctx.st);
        const ok = this._runTo(ctx, tEnd, deadline, () => {
          this._row(rows, ctx.t - tA, ctx.st);
          this.stateK.forEach((k, j) => {
            const v = Math.abs(this.net.comps[k].type === 'inductor' ? ctx.st.i[k] : ctx.st.u[k]);
            if (v > scale[j]) scale[j] = v;
          });
        });
        if (!ok) return null;
        let done = !this.stateK.length;
        if (prev) {
          const d = this._stateGap(ctx.st, prev, scale);
          // Suite géométrique : l'écart qui reste à parcourir vaut d·ρ/(1−ρ).
          const rho = dPrev < Infinity && dPrev > 0 ? d / dPrev : 1;
          if (d < 1e-6 || (rho < 0.999 && d * rho / (1 - rho) < 1e-3)) done = true;
          dPrev = d;
        }
        prev = snap();
        if (done) return { elapsed: tEnd - t0, table: { T, tA, data: Float64Array.from(rows), w: wRow } };
      }
    }

    /** Sans signal périodique : état stationnaire, ou oscillations auto-entretenues. */
    _seekFree(ctx, t0, deadline) {
      const K = this.K, wRow = 1 + 2 * K, S = this.stateK.length;
      if (!S) return { elapsed: 0, table: null };
      const value = (/** @type {number} */ j) => {
        const k = this.stateK[j];
        return this.net.comps[k].type === 'inductor' ? ctx.st.i[k] : ctx.st.u[k];
      };
      let w = Math.max(this.tc / 64, 1e-9);
      for (;;) {
        /** @type {number[]} */
        const rows = [];
        const mn = new Float64Array(S).fill(Infinity), mx = new Float64Array(S).fill(-Infinity);
        const track = () => {
          this._row(rows, ctx.t, ctx.st);
          for (let j = 0; j < S; j++) { const v = value(j); if (v < mn[j]) mn[j] = v; if (v > mx[j]) mx[j] = v; }
        };
        track();
        const tEnd = ctx.t + w;
        if (!this._runTo(ctx, tEnd, deadline, track)) return null;
        let range = 0, best = 0, bestSwing = -1;
        // Référence choisie parmi C et L s'il y en a : leur évolution est lente et bien échantillonnée.
        const nRef = this.react.length || S;
        for (let j = 0; j < S; j++) {
          const swing = mx[j] - mn[j];
          const scale = Math.max(Math.abs(mx[j]), Math.abs(mn[j]), 1e-6);
          if (swing / scale > range) range = swing / scale;
          if (j < nRef && swing / scale > bestSwing) { bestSwing = swing / scale; best = j; }
        }
        if (range < 2e-3 && w >= this.tc / 8) return { elapsed: ctx.t - t0, table: null };
        const table = this._findOrbit(rows, this.stateK[best], this.net.comps[this.stateK[best]].type === 'inductor', mn[best], mx[best], wRow, mn, mx);
        if (table) return { elapsed: ctx.t - t0, table };
        w *= 2;
      }
    }

    /** Cherche une période dans une fenêtre d'échantillons, d'après les passages par le milieu. */
    _findOrbit(rows, kRef, isCurrent, lo, hi, w, mn, mx) {
      const col = 1 + 2 * kRef + (isCurrent ? 1 : 0), mid = (lo + hi) / 2;
      const n = rows.length / w;
      /** @type {{t:number, r:number}[]} */
      const ups = [];
      for (let r = 1; r < n; r++) {
        const a = rows[(r - 1) * w + col], b = rows[r * w + col];
        if (a < mid && b >= mid) ups.push({ t: rows[(r - 1) * w] + (mid - a) / (b - a) * (rows[r * w] - rows[(r - 1) * w]), r });
      }
      if (ups.length < 4) return null;
      const [c0, c1, c2] = ups.slice(-3);
      const T1 = c1.t - c0.t, T2 = c2.t - c1.t;
      if (Math.abs(T1 - T2) > 0.005 * T2) return null;
      // Les autres grandeurs lentes doivent revenir au même point d'une période à l'autre. La sortie
      // d'un AOP en est exclue : au milieu d'un basculement, 1 µs d'écart y représente 10 V.
      const nCheck = this.react.length || this.stateK.length;
      for (let j = 0; j < nCheck; j++) {
        const k = this.stateK[j], cj = 1 + 2 * k + (this.net.comps[k].type === 'inductor' ? 1 : 0);
        const span = Math.max(mx[j] - mn[j], 1e-6);
        if (Math.abs(rows[c1.r * w + cj] - rows[c2.r * w + cj]) > 0.02 * span) return null;
      }
      const data = rows.slice(c1.r * w, (c2.r + 1) * w);
      for (let i = 0; i < data.length; i += w) data[i] -= c1.t;
      return { T: T2, tA: c1.t, data: Float64Array.from(data), w };
    }

    /** Phaseurs de tous les composants à une pulsation donnée (les sources concernées sont fournies). */
    _phasor(seg, w, sources) {
      const N = this.N, M = 2 * N;
      const A = new Float64Array(M * M), rhs = new Float64Array(M);
      /** Ajoute (re + j·im) à la case (i, j) de la matrice complexe. */
      const add = (i, j, re, im) => {
        if (i < 0 || j < 0) return;
        A[i * M + j] += re; A[(i + N) * M + (j + N)] += re;
        A[i * M + (j + N)] -= im; A[(i + N) * M + j] += im;
      };
      const stampY = (a, b, re, im) => { add(a, a, re, im); add(b, b, re, im); add(a, b, -re, -im); add(b, a, -re, -im); };
      for (let n = 0; n < this.net.nNodes; n++) add(n, n, GMIN, 0);
      /** @type {{re:number, im:number}[]} */
      const adm = [];
      const comps = this.net.comps;
      for (let k = 0; k < this.K; k++) {
        const c = comps[k], p = seg.params[k], a = this.a[k], b = this.b[k];
        let y = { re: 0, im: 0 };
        if (c.type === 'resistor' || c.type === 'lamp') y = { re: 1 / p.R, im: 0 };
        else if (c.type === 'switch') y = { re: seg.closed[k] ? 1 / p.Ron : 1 / p.Roff, im: 0 };
        else if (c.type === 'capacitor') y = { re: 0, im: w * p.C };
        else if (c.type === 'inductor') {
          const r = p.r || 0, x = w * p.L, d = r * r + x * x;
          y = { re: r / d, im: -x / d };
        } else if (c.type === 'vsource') {
          const br = this.branch[k];
          add(a, br, 1, 0); add(b, br, -1, 0); add(br, a, 1, 0); add(br, b, -1, 0);
          add(br, br, -(p.r || 0), 0);
        }
        adm.push(y);
        stampY(a, b, y.re, y.im);
      }
      // Sources : A sin(ωt+φ) = Re[A e^{j(φ−π/2)} e^{jωt}]
      for (const k of sources) {
        const p = seg.params[k], ph = p.phase * Math.PI / 180 - Math.PI / 2;
        const re = p.A * Math.cos(ph), im = p.A * Math.sin(ph);
        if (comps[k].type === 'vsource') {
          const br = this.branch[k];
          rhs[br] += re; rhs[br + N] += im;
        } else {
          const a = this.a[k], b = this.b[k];
          if (a >= 0) { rhs[a] += re; rhs[a + N] += im; }
          if (b >= 0) { rhs[b] -= re; rhs[b + N] -= im; }
        }
      }
      luSolve(luFactor(A, M), rhs);
      const vRe = (n) => (n >= 0 ? rhs[n] : 0), vIm = (n) => (n >= 0 ? rhs[n + N] : 0);
      const ur = new Float64Array(this.K), ui = new Float64Array(this.K);
      const ir = new Float64Array(this.K), ii = new Float64Array(this.K);
      for (let k = 0; k < this.K; k++) {
        const c = comps[k], a = this.a[k], b = this.b[k], y = adm[k];
        ur[k] = vRe(a) - vRe(b);
        ui[k] = vIm(a) - vIm(b);
        if (c.type === 'vsource') {
          ir[k] = rhs[this.branch[k]]; ii[k] = rhs[this.branch[k] + N];
        } else if (c.type === 'isource') {
          const p = seg.params[k], ph = p.phase * Math.PI / 180 - Math.PI / 2;
          ir[k] = sources.includes(k) ? -p.A * Math.cos(ph) : 0;
          ii[k] = sources.includes(k) ? -p.A * Math.sin(ph) : 0;
        } else {
          ir[k] = y.re * ur[k] - y.im * ui[k];
          ii[k] = y.re * ui[k] + y.im * ur[k];
        }
      }
      return { w, ur, ui, ir, ii };
    }

    /** Intégration autonome entre deux instants (utilisée pour le régime périodique). */
    _newCtx(seg, st0, t, filter, dtMax) {
      const ctx = {
        seg, st: this._newState(), spare: this._newState(), s1: this._newState(), s2: this._newState(), s3: this._newState(),
        t, dt: DT_INIT, filter, dtMax: quantDt(dtMax), peak: new Float64Array(this.K).fill(1e-6),
      };
      ctx.st.u.set(st0.u); ctx.st.i.set(st0.i); ctx.st.V.set(st0.V);
      return ctx;
    }

    _integrate(seg, st0, tA, tB, filter, dtMax, onSample) {
      const ctx = this._newCtx(seg, st0, tA, filter, dtMax);
      this._reinit(ctx);
      if (onSample) onSample(ctx.t, ctx.st);
      let guard = 0;
      while (ctx.t < tB && guard++ < 200000) {
        const res = this._step(ctx, tB);
        if (res === 0) continue;
        if (onSample) onSample(ctx.t, ctx.st);
        if (res === 2 && ctx.t < tB) {
          this._reinit(ctx);
          if (onSample) onSample(ctx.t, ctx.st);
        }
      }
      return ctx.st;
    }

    /**
     * Régime périodique d'un groupe de signaux carrés de fréquence f : on cherche x₀ tel que
     * x(T) = x₀, soit (I − Φ)x₀ = b, puis on enregistre une période.
     */
    _periodicTable(seg, f) {
      const T = 1 / f, tA = seg.tStart, m = this.react.length, filter = { mode: 'sq', f };
      const dtMax = T / 128;
      const comps = this.net.comps;
      const zero = this._newState();
      const getX = (st, k) => (comps[k].type === 'capacitor' ? st.u[k] : st.i[k]);
      const x0 = this._newState();
      if (m > 0) {
        const endB = this._integrate(seg, zero, tA, tA + T, filter, dtMax, null);
        const M = new Float64Array(m * m), b = new Float64Array(m);
        const basis = this._newState();
        for (let j = 0; j < m; j++) {
          b[j] = getX(endB, this.react[j]);
          basis.u.fill(0); basis.i.fill(0);
          const kj = this.react[j];
          if (comps[kj].type === 'capacitor') basis.u[kj] = 1; else basis.i[kj] = 1;
          const end = this._integrate(seg, basis, tA, tA + T, FILTER_OFF, dtMax, null);
          for (let i = 0; i < m; i++) M[i * m + j] = (i === j ? 1 : 0) - getX(end, this.react[i]) + (i === j ? 1e-9 : 0);
        }
        luSolve(luFactor(M, m), b);
        for (let j = 0; j < m; j++) {
          const k = this.react[j];
          if (comps[k].type === 'capacitor') x0.u[k] = b[j]; else x0.i[k] = b[j];
        }
      }
      /** @type {number[]} */
      const rows = [];
      this._integrate(seg, x0, tA, tA + T, filter, dtMax, (t, st) => {
        rows.push(t - tA);
        for (let k = 0; k < this.K; k++) rows.push(st.u[k], st.i[k]);
      });
      return { T, tA, data: Float64Array.from(rows), w: 1 + 2 * this.K };
    }

    _computeSteady(seg, t0, st0) {
      if (this.nonlinear) { this._computeSteadyNL(seg, t0, st0); return; }
      const comps = this.net.comps;
      /** @type {Map<number, number[]>} */
      const sineGroups = new Map(), squareFreqs = new Set();
      for (let k = 0; k < this.K; k++) {
        const c = comps[k], p = seg.params[k];
        if (c.type !== 'vsource' && c.type !== 'isource') continue;
        if (p.wave === 'sine') {
          if (!sineGroups.has(p.f)) sineGroups.set(p.f, []);
          sineGroups.get(p.f).push(k);
        } else if (p.wave === 'square') squareFreqs.add(p.f);
      }
      const near = (w) => seg.modes.some((l) => Math.abs(l.re) < 1e-5 * Math.abs(l.im) && Math.abs(Math.abs(l.im) - w) < 1e-5 * w);
      const steady = { dcU: new Float64Array(this.K), dcI: new Float64Array(this.K), terms: [], tables: [] };
      seg.noSteady = false;
      for (const [f, list] of sineGroups) {
        const w = 2 * Math.PI * f;
        if (near(w)) { seg.noSteady = true; continue; }
        steady.terms.push(this._phasor(seg, w, list));
      }
      for (const f of squareFreqs) steady.tables.push(this._periodicTable(seg, f));
      seg.steady = steady;

      // Partie continue : grands pas d'Euler implicite depuis l'état initial, privé de la partie
      // alternative. Les modes amortis disparaissent, les grandeurs conservées sont préservées.
      let scale = 1e-3;
      for (const l of seg.modes) {
        const mag = Math.hypot(l.re, l.im);
        if (mag >= 1e-4) scale = Math.max(scale, 1 / mag);
      }
      const dtHuge = Math.min(scale * 1e3, 1e5);
      // Interrupteurs idéaux ici : la fuite d'un interrupteur ouvert ne définit pas un régime permanent.
      const f = luFactor(this._buildMatrix(seg, dtHuge, 'E', 1e-15, true), this.N);
      let a = this._newState(), b = this._newState();
      const ac = [0, 0];
      for (let k = 0; k < this.K; k++) {
        this._acAt(seg, k, t0, ac);
        a.u[k] = st0.u[k] - ac[0];
        a.i[k] = st0.i[k] - ac[1];
      }
      for (let it = 0; it < 3; it++) {
        this._solve(seg, f, dtHuge, 'E', a, t0 + dtHuge, FILTER_DC, b);
        const t = a; a = b; b = t;
      }
      steady.dcU.set(a.u);
      steady.dcI.set(a.i);
    }

    /** Partie alternative du régime permanent (phaseurs et tables périodiques). */
    _acAt(seg, k, t, out) {
      const s = seg.steady;
      let u = 0, i = 0;
      for (const m of s.terms) {
        const c = Math.cos(m.w * t), d = Math.sin(m.w * t);
        u += m.ur[k] * c - m.ui[k] * d;
        i += m.ir[k] * c - m.ii[k] * d;
      }
      for (const tb of s.tables) {
        let ph = (t - tb.tA) % tb.T;
        if (ph < 0) ph += tb.T;
        const w = tb.w, n = tb.data.length / w;
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (tb.data[mid * w] <= ph) lo = mid; else hi = mid;
        }
        const t0 = tb.data[lo * w], t1 = tb.data[hi * w];
        const f = t1 > t0 ? Math.min(1, Math.max(0, (ph - t0) / (t1 - t0))) : 0;
        const iu = 1 + 2 * k;
        u += tb.data[lo * w + iu] * (1 - f) + tb.data[hi * w + iu] * f;
        i += tb.data[lo * w + iu + 1] * (1 - f) + tb.data[hi * w + iu + 1] * f;
      }
      out[0] = u; out[1] = i;
    }

    /** Régime permanent du composant d'indice k à l'instant t dans le segment. @returns {number[]} [u, i] */
    steadyAt(seg, k, t, out = [0, 0]) {
      this._acAt(seg, k, t, out);
      out[0] += seg.steady.dcU[k];
      out[1] += seg.steady.dcI[k];
      return out;
    }

    /** Amplitudes de référence pour mesurer l'écart relatif au permanent. */
    _computeRefs(seg, t0, st0) {
      const s = seg.steady, comps = this.net.comps, tmp = [0, 0];
      // Plancher lié à l'échelle du circuit : sous 1 % de ses tensions et courants, un écart (une fuite
      // qui dérive, par exemple) n'est pas un régime transitoire.
      let vMax = 0, iMax = 1e-4;
      for (let k = 0; k < this.K; k++) {
        const type = comps[k].type, p = seg.params[k];
        if (type === 'vsource') vMax = Math.max(vMax, Math.abs(p.A) + Math.abs(p.off || 0));
        if (type === 'isource') iMax = Math.max(iMax, Math.abs(p.A) + Math.abs(p.off || 0));
        if (type === 'capacitor') vMax = Math.max(vMax, Math.abs(p.V0));
        if (type === 'inductor') iMax = Math.max(iMax, Math.abs(p.I0));
      }
      const floorV = Math.max(1e-9, 0.01 * vMax), floorI = Math.max(1e-12, 0.01 * iMax);
      seg.refs = this.residualK.map((k) => {
        const isC = comps[k].type !== 'inductor';
        let amp = Math.abs(isC ? s.dcU[k] : s.dcI[k]);
        for (const m of s.terms) amp += isC ? Math.hypot(m.ur[k], m.ui[k]) : Math.hypot(m.ir[k], m.ii[k]);
        for (const tb of s.tables) {
          let mx = 0;
          for (let r = 0; r < tb.data.length; r += tb.w) mx = Math.max(mx, Math.abs(tb.data[r + 1 + 2 * k + (isC ? 0 : 1)]));
          amp += mx;
        }
        this.steadyAt(seg, k, t0, tmp);
        const gap = Math.abs((isC ? st0.u[k] : st0.i[k]) - (isC ? tmp[0] : tmp[1]));
        return Math.max(amp, gap, isC ? floorV : floorI);
      });
    }

    /** Écart relatif (norme infinie) entre les variables d'état et leur régime permanent. */
    _residual(seg, t, st) {
      if (seg.noSteady) return 1;
      const comps = this.net.comps, tmp = [0, 0];
      let r = 0;
      for (let j = 0; j < this.residualK.length; j++) {
        const k = this.residualK[j], isC = comps[k].type !== 'inductor';
        this.steadyAt(seg, k, t, tmp);
        const e = Math.abs((isC ? st.u[k] : st.i[k]) - (isC ? tmp[0] : tmp[1])) / seg.refs[j];
        if (e > r) r = e;
      }
      return r;
    }

    // ---------- Historique ----------

    _push(t, segIdx, r, st) {
      if (this.len >= this.cap) {
        if (!this._marks || this._marks.length < this.cap) this._marks = new Int32Array(this.cap);
        this._thin();
      }
      const w = this.width, K = this.K, o = this.len * w, h = this.h;
      h[o] = t; h[o + 1] = segIdx; h[o + 2] = r;
      for (let k = 0; k < K; k++) { h[o + 3 + 2 * k] = st.u[k]; h[o + 4 + 2 * k] = st.i[k]; }
      for (let n = 0; n < this.nNets; n++) h[o + 3 + 2 * K + n] = st.V[n];
      this.len++;
      const seg = this.segments[segIdx];
      if (seg && r > SETTLE_EPS) seg.lastAbove = t;
      if (seg && K) for (let k = 0; k < K; k++) if (Math.abs(st.u[k]) > 1e5) this.overvoltage = true;
    }

    /**
     * Mémoire pleine : on ramène les échantillons à une densité uniforme en temps (éclaircir un rang
     * sur deux viderait peu à peu le passé), sans toucher aux changements de segment.
     */
    _thin() {
      const w = this.width, h = this.h, last = this.len - 1;
      let spacing = (h[last * w] - h[0]) * 2 / this.cap;
      do {
        let out = 1, kept = h[0];
        for (let r = 1; r <= last; r++) {
          const t = h[r * w];
          const prevSeg = h[r * w + 1] !== h[(r - 1) * w + 1];
          const nextSeg = r < last && h[r * w + 1] !== h[(r + 1) * w + 1];
          if (t - kept >= spacing || prevSeg || nextSeg || r === last) {
            this._marks[out] = r;
            out++;
            kept = t;
          }
        }
        if (out <= this.cap * 0.75) {
          for (let n = 1; n < out; n++) {
            const r = this._marks[n];
            if (r !== n) h.copyWithin(n * w, r * w, (r + 1) * w);
          }
          this.len = out;
          return;
        }
        spacing *= 2;
      } while (spacing < Infinity);
    }

    /** Indice du dernier échantillon d'instant ≤ t. */
    indexAt(t) {
      const w = this.width, h = this.h;
      let lo = 0, hi = this.len - 1;
      if (t >= h[hi * w]) return hi;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (h[mid * w] <= t) lo = mid; else hi = mid;
      }
      return lo;
    }

    /** Tension et courant interpolés à l'instant t. */
    sampleAt(t, out) {
      const w = this.width, h = this.h, K = this.K;
      const i0 = this.indexAt(t), i1 = Math.min(i0 + 1, this.len - 1);
      const o0 = i0 * w, o1 = i1 * w;
      const t0 = h[o0], t1 = h[o1];
      const f = t1 > t0 ? Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) : 0;
      out = out || this._newState();
      for (let k = 0; k < K; k++) {
        const a = o0 + 3 + 2 * k, b = o1 + 3 + 2 * k;
        out.u[k] = h[a] + (h[b] - h[a]) * f;
        out.i[k] = h[a + 1] + (h[b + 1] - h[a + 1]) * f;
      }
      for (let n = 0; n < this.nNets; n++) {
        const a = o0 + 3 + 2 * K + n, b = o1 + 3 + 2 * K + n;
        out.V[n] = h[a] + (h[b] - h[a]) * f;
      }
      out.segIdx = h[o0 + 1];
      out.r = h[o0 + 2] + (h[o1 + 2] - h[o0 + 2]) * f;
      return out;
    }

    /** Segment actif à l'instant t. */
    segmentAt(t) {
      return this.segments[this.h[this.indexAt(t) * this.width + 1]] || this.segments[0];
    }

    /** Valeur brute de la colonne (u ou i) d'un échantillon d'indice idx. */
    valueAtIndex(idx, k, kind) {
      return this.h[idx * this.width + 3 + 2 * k + (kind === 'i' ? 1 : 0)];
    }

    // ---------- Avance du temps ----------

    /** Avance la simulation jusqu'à `target`, dans la limite de `budgetMs`. */
    advanceTo(target, budgetMs = 10) {
      const ctx = this.ctx;
      const deadline = performance.now() + budgetMs;
      let n = 0;
      while (ctx.t < target) {
        if ((++n & 15) === 0 && performance.now() > deadline) break;
        const res = this._step(ctx, Infinity);
        if (res === 0) continue;
        const seg = ctx.seg;
        if (res === 2) {
          this._push(ctx.t, seg.idx, this._residual(seg, ctx.t, ctx.st), ctx.st);
          this._afterEdge(ctx);
        } else {
          this._push(ctx.t, seg.idx, this._residual(seg, ctx.t, ctx.st), ctx.st);
        }
        if (!isFinite(ctx.st.u[0] ?? 0)) { this.failed = true; break; }
      }
      this.t = ctx.t;
      return ctx.t;
    }

    /** Traite la discontinuité sur laquelle on vient d'arriver. */
    _afterEdge(ctx) {
      const seg = ctx.seg, t = ctx.t, comps = this.net.comps;
      let closed = null, stepped = false, label = '';
      for (let k = 0; k < this.K; k++) {
        const p = seg.params[k];
        if (comps[k].type === 'switch' && p.tToggle > 0 && Math.abs(p.tToggle - t) <= 1e-12 * Math.max(t, 1e-9)) {
          closed = closed || seg.closed.slice();
          closed[k] = !closed[k];
          label = `${comps[k].label} ${closed[k] ? 'fermé' : 'ouvert'}`;
        }
        if ((comps[k].type === 'vsource' || comps[k].type === 'isource') && p.wave === 'step' && Math.abs(p.t0 - t) <= 1e-12 * Math.max(t, 1e-9)) {
          stepped = true;
          label = `Échelon de ${comps[k].label}`;
        }
      }
      if (closed || stepped) {
        this._startSegment(t, seg.params, closed || seg.closed, label);
      } else {
        this._reinit(ctx);
        this._push(ctx.t, seg.idx, this._residual(seg, ctx.t, ctx.st), ctx.st);
      }
    }

    /**
     * Modifie le circuit à l'instant t, éventuellement dans le passé : le futur enregistré est
     * effacé et l'histoire repart de t. `mutate(params, closed)` applique le changement.
     * @returns {boolean} vrai si un futur enregistré a été réécrit
     */
    editAt(t, mutate, label) {
      const head = this.ctx.t;
      // La tête a normalement un pas d'avance sur l'affichage : ce n'est pas un futur à réécrire.
      const rewrote = head - t > 4 * Math.min(this.ctx.dt, this.ctx.dtMax);
      t = Math.max(Math.min(t, head), this.h[0]);
      const idx = this.indexAt(t);
      const seg = this.segments[this.h[idx * this.width + 1]];
      // Restauration de l'échantillon, puis pas exact jusqu'à t.
      const ctx = this.ctx, w = this.width, o = idx * w, st = ctx.st;
      for (let k = 0; k < this.K; k++) { st.u[k] = this.h[o + 3 + 2 * k]; st.i[k] = this.h[o + 4 + 2 * k]; }
      for (let n = 0; n < this.nNets; n++) st.V[n] = this.h[o + 3 + 2 * this.K + n];
      this.len = idx + 1;
      const tS = this.h[o];
      this.segments.length = seg.idx + 1;
      ctx.seg = seg; ctx.t = tS; ctx.filter = FILTER_ALL;
      if (t - tS > 1e-13) {
        // Un seul pas de trapèzes : l'intervalle est déjà celui du pas accepté précédemment.
        const dt = t - tS;
        this._solve(seg, this._factor(seg, dt, 'T'), dt, 'T', st, t, FILTER_ALL, ctx.spare);
        st.u.set(ctx.spare.u); st.i.set(ctx.spare.i); st.V.set(ctx.spare.V);
        ctx.t = t;
        this._push(t, seg.idx, this._residual(seg, t, st), st);
      }
      // Recalcul de la dernière sortie du seuil de 1 % de ce segment.
      seg.lastAbove = seg.tStart;
      for (let r = this.len - 1; r >= 0 && this.h[r * w + 1] === seg.idx; r--) {
        if (this.h[r * w + 2] > SETTLE_EPS) { seg.lastAbove = this.h[r * w]; break; }
      }
      const params = seg.params.map((p) => ({ ...p }));
      const closed = seg.closed.slice();
      mutate(params, closed);
      this.tc = Math.max(this.tc, this._charTime(params, closed));
      this._startSegment(ctx.t, params, closed, label);
      this.t = ctx.t;
      return rewrote;
    }

    // ---------- Lecture pédagogique du circuit ----------

    /** Modes propres d'une configuration quelconque (circuits linéaires). */
    modesFor(params, closed) {
      if (this.nonlinear) return null;
      const seg = /** @type {any} */ ({ params, closed, tStart: 0, lus: new Map() });
      this._computeModes(seg);
      return seg.summary;
    }

    /**
     * Valeur d'un paramètre à laquelle le circuit passe d'oscillant à non oscillant (R critique…),
     * la plus proche de la valeur actuelle. Null s'il n'y en a pas.
     */
    criticalValue(seg, k, key) {
      if (this.nonlinear) return null;
      const v0 = seg.params[k][key];
      if (!(v0 > 0)) return null;
      const closed = seg.closed.map((c, j) => c || this.net.comps[j].type === 'switch');
      const oscillates = (v) => {
        const params = seg.params.map((p) => ({ ...p }));
        params[k][key] = v;
        return this.modesFor(params, closed).items.some((m) => m.kind === 'pseudo' || m.kind === 'harmonique');
      };
      const logs = [];
      for (let n = -32; n <= 32; n++) logs.push(Math.log10(v0) + n / 8);
      const os = logs.map((l) => oscillates(Math.pow(10, l)));
      let best = null;
      for (let n = 0; n + 1 < logs.length; n++) {
        if (os[n] === os[n + 1]) continue;
        if (best === null || Math.abs(n - 32) < Math.abs(best - 32)) best = n;
      }
      if (best === null) return null;
      let lo = logs[best], hi = logs[best + 1];
      const osLo = os[best];
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2;
        if (oscillates(Math.pow(10, mid)) === osLo) lo = mid; else hi = mid;
      }
      return Math.pow(10, (lo + hi) / 2);
    }

    /** Premier échantillon d'un segment : les valeurs juste après son début (t⁺). */
    firstSample(seg) {
      const w = this.width;
      // La toute première ligne de l'historique est l'état avant la mise sous tension.
      let i = Math.max(this.indexAt(seg.tStart), seg.idx === 0 ? 1 : 0);
      while (i < this.len - 1 && this.h[i * w + 1] !== seg.idx) i++;
      return this.sampleAt(this.h[i * w]);
    }

    /** Valeurs finales d'un segment, si son régime établi est constant. Sinon null. */
    finalValues(seg) {
      const s = seg.steady;
      if (seg.noSteady || seg.undamped || s.terms.length || s.tables.length) return null;
      return { u: s.dcU, i: s.dcI };
    }

    /**
     * Schéma équivalent de C et L à t⁺ ou en régime continu établi.
     * @param {any} seg @param {'0'|'inf'} when
     * @returns {Map<number, {kind:string, value:number, flip:boolean}> | null}
     */
    equivalents(seg, when) {
      const out = new Map();
      if (when === 'inf') {
        if (!this.finalValues(seg)) return null;
        for (const k of this.react) {
          const c = this.net.comps[k];
          out.set(c.id, c.type === 'capacitor' ? { kind: 'open', value: 0, flip: false } : { kind: 'wire', value: 0, flip: false });
        }
        return out;
      }
      const st = this.firstSample(seg);
      for (const k of this.react) {
        const c = this.net.comps[k];
        if (c.type === 'capacitor') {
          const u = st.u[k];
          out.set(c.id, Math.abs(u) < 1e-3 ? { kind: 'wire', value: 0, flip: false } : { kind: 'vsource', value: u, flip: u < 0 });
        } else {
          const i = st.i[k];
          out.set(c.id, Math.abs(i) < 1e-6 ? { kind: 'open', value: 0, flip: false } : { kind: 'isource', value: i, flip: i > 0 });
        }
      }
      return out;
    }

    /**
     * Maille passant par le composant k : la somme des sign·u de ses termes est nulle.
     * @returns {{k:number, sign:number}[] | null}
     */
    meshFor(k, seg) {
      const comps = this.net.comps, start = comps[k];
      if (!start || start.type === 'opamp' || start.type === 'voltmeter') return null;
      const mna = this.net.mna;
      /** @type {Map<number, {to:number, k:number, sign:number}[]>} */
      const adj = new Map();
      const link = (x, to, j, sign) => {
        if (!adj.has(x)) adj.set(x, []);
        adj.get(x).push({ to, k: j, sign });
      };
      comps.forEach((c, j) => {
        if (j === k || c.type === 'opamp' || c.type === 'voltmeter') return;
        if (c.type === 'switch' && !seg.closed[j]) return;
        link(c.a, c.b, j, 1);
        link(c.b, c.a, j, -1);
      });
      // Tous les symboles de masse sont au même potentiel.
      const grounds = [];
      mna.forEach((m, n) => { if (m === -1) grounds.push(n); });
      for (const g of grounds) for (const h of grounds) if (g !== h) link(g, h, -1, 0);
      const from = new Map([[start.b, null]]);
      const queue = [start.b];
      while (queue.length) {
        const x = queue.shift();
        if (x === start.a) break;
        for (const e of adj.get(x) || []) {
          if (from.has(e.to)) continue;
          from.set(e.to, { prev: x, k: e.k, sign: e.sign });
          queue.push(e.to);
        }
      }
      if (!from.has(start.a)) return null;
      const path = [];
      for (let x = start.a; from.get(x); x = from.get(x).prev) {
        const f = from.get(x);
        if (f.k >= 0) path.unshift({ k: f.k, sign: f.sign });
      }
      return [{ k, sign: 1 }, ...path];
    }

    /**
     * Courants qui arrivent à un réseau de fils. `rest` est ce qui repart par la masse (alimentation
     * des AOP) ; sinon la somme est nulle.
     */
    nodeBalance(net, st) {
      const terms = [];
      this.net.comps.forEach((c, k) => {
        if (c.type === 'opamp') {
          if (c.c === net) terms.push({ k, i: st.i[k] });
        } else if (c.type !== 'voltmeter' && c.a !== c.b) {
          if (c.a === net) terms.push({ k, i: -st.i[k] });
          if (c.b === net) terms.push({ k, i: st.i[k] });
        }
      });
      const sum = terms.reduce((a, t) => a + t.i, 0);
      return { terms, sum, isGround: this.net.mna[net] === -1 };
    }

    /**
     * Courant en dessous duquel il ne passe « rien » : fuites des interrupteurs ouverts, des diodes
     * bloquées et des nœuds, pour une tension donnée. Une résistance « ouvert » faible (moins de 1 MΩ)
     * a été choisie exprès : son courant est réel et n'est pas compté comme une fuite.
     */
    leakCurrent(seg, vMax) {
      if (seg.leakG === undefined) {
        let G = this.net.nNodes * GMIN + this.diodes.length * DIODE_GOFF;
        this.net.comps.forEach((c, k) => {
          if (c.type === 'switch' && !seg.closed[k] && seg.params[k].Roff >= 1e6) G += 1 / seg.params[k].Roff;
        });
        seg.leakG = G;
      }
      return 10 * vMax * seg.leakG;
    }

    /** Bascule un interrupteur à l'instant t. */
    toggleAt(t, id) {
      const k = this.net.comps.findIndex((c) => c.id === id);
      if (k < 0) return false;
      const c = this.net.comps[k];
      const closedNow = !this.segmentAt(t).closed[k];
      return this.editAt(t, (_p, closed) => { closed[k] = closedNow; }, `${c.label} ${closedNow ? 'fermé' : 'ouvert'}`);
    }

    /** Régime en vigueur à l'instant t. */
    regimeAt(t) {
      const seg = this.segmentAt(t);
      const next = this.segments[seg.idx + 1];
      const end = next ? next.tStart : this.ctx.t;
      const settled = !seg.noSteady && end - seg.lastAbove >= seg.settleWindow && end > seg.tStart;
      if (seg.noSteady) return { kind: this.nonlinear ? 'inconnu' : 'libre', seg, tPerm: Infinity };
      if (seg.undamped && !settled) return { kind: 'libre', seg, tPerm: Infinity };
      if (settled && t >= seg.lastAbove) return { kind: 'permanent', seg, tPerm: seg.lastAbove };
      return { kind: 'transitoire', seg, tPerm: settled ? seg.lastAbove : Infinity };
    }
  }

  /** Lecture « prépa » des modes propres : τ, ω₀, Q, pseudo-période. */
  function summarizeModes(modes) {
    const visible = modes.filter((l) => {
      const m = Math.hypot(l.re, l.im);
      return m >= 1e-4 && m <= 2e9;   // ni grandeurs conservées, ni modes parasites ultra-rapides
    });
    const reals = visible.filter((l) => Math.abs(l.im) <= 1e-6 * Math.hypot(l.re, l.im));
    const pairs = visible.filter((l) => l.im > 1e-6 * Math.hypot(l.re, l.im));
    const items = [];
    for (const l of pairs) {
      const w0 = Math.hypot(l.re, l.im), Q = w0 / (2 * Math.max(-l.re, 1e-300));
      items.push({
        kind: Q > 1e5 ? 'harmonique' : 'pseudo',
        lambda: l, w0, Q, wp: l.im, tau: Q > 1e5 ? Infinity : -1 / l.re, T: 2 * Math.PI / l.im,
      });
    }
    if (reals.length === 2 && !pairs.length) {
      const [a, b] = reals;
      const w0 = Math.sqrt(a.re * b.re), Q = w0 / -(a.re + b.re);
      const close = Math.abs(a.re - b.re) < 0.02 * Math.abs(a.re + b.re);
      items.push({ kind: close ? 'critique' : 'aperiodique', w0, Q, tau1: -1 / a.re, tau2: -1 / b.re });
    } else {
      for (const l of reals) items.push({ kind: 'premier', lambda: l, tau: -1 / l.re });
    }
    return { items, order: visible.length };
  }

  RLC.Sim = Sim;
  RLC.engine = { sourceValue, summarizeModes, SETTLE_EPS };
})(/** @type {any} */ (globalThis).RLC ??= {});
