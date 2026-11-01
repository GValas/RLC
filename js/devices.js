// @ts-check
// Modèles de l'onglet « Composants » : géométrie → valeur, puis évolution exacte, par morceaux.
// Tout est une fonction du temps, sans intégration : l'histoire se relit dans les deux sens.
(function (root) {
  'use strict';
  const RLC = root.RLC = root.RLC || {};

  const EPS0 = 8.854e-12;
  const MU0 = 4e-7 * Math.PI;
  const MATERIALS = {
    carbone: { name: 'Carbone', rho: 3.5e-5, ionR: 13 },
    nichrome: { name: 'Nichrome', rho: 1.1e-6, ionR: 10 },
    cuivre: { name: 'Cuivre', rho: 1.7e-8, ionR: 7 },
  };
  // Résistance thermique typique d'un composant ¼ W, et son inertie.
  const RTH = 150, TAU_TH = 4, P_NOMINAL = 0.25;
  // Au-delà, le composant n'existe plus : le calcul n'a plus de sens.
  const DT_MAX = 1000;

  /**
   * Histoire d'un composant : une suite de phases, chacune ouverte par une manœuvre de l'interrupteur.
   * @typedef {{ t0: number, mode: string, s0: any }} Phase
   */
  class History {
    /** @param {(s0: any, mode: string, dt: number) => any} evolve @param {any} s0 */
    constructor(evolve, s0) {
      this.evolve = evolve;
      /** @type {Phase[]} */
      this.phases = [{ t0: 0, mode: 'open', s0 }];
      this.tMax = 0;
    }
    /** @param {number} t */
    phaseAt(t) {
      const p = this.phases;
      let i = p.length - 1;
      while (i > 0 && p[i].t0 > t) i--;
      return p[i];
    }
    /** @param {number} t */
    at(t) {
      const ph = this.phaseAt(t);
      return Object.assign({ mode: ph.mode, since: t - ph.t0 }, this.evolve(ph.s0, ph.mode, Math.max(0, t - ph.t0)));
    }
    /** Manœuvre à l'instant t : le futur enregistré est réécrit. @param {number} t @param {string} mode */
    change(t, mode) {
      const s = Object.assign({}, this.at(t));
      delete s.mode;
      delete s.since;
      // La phase initiale reste toujours : elle porte l'état de départ.
      this.phases = this.phases.filter((p, i) => i === 0 || p.t0 < t);
      if (t <= 0) this.phases[0].mode = mode;
      else this.phases.push({ t0: t, mode, s0: s });
      this.tMax = t;
    }
  }

  /**
   * Plan : C = ε₀εᵣS/e. L'interrupteur relie R et C au générateur (charge) ou les referme sur eux-mêmes (décharge).
   * `flowGen` et `flowDis` : charge totale passée dans chaque branche, pour placer les électrons dans les fils.
   * @param {{ S: number, e: number, er: number, R: number, E: number }} p
   */
  function capacitor(p) {
    const C = EPS0 * p.er * p.S / p.e;
    const tau = p.R * C;
    const evolve = (/** @type {any} */ s0, /** @type {string} */ mode, /** @type {number} */ dt) => {
      const decay = Math.exp(-dt / tau);
      let q = s0.q, flowGen = s0.flowGen, flowDis = s0.flowDis, i = 0;
      if (mode === 'charge') {
        q = C * p.E + (s0.q - C * p.E) * decay;
        flowGen = s0.flowGen + (q - s0.q);
        i = (p.E - q / C) / p.R;
      } else if (mode === 'discharge') {
        q = s0.q * decay;
        flowDis = s0.flowDis + (s0.q - q);
        i = -q / C / p.R;
      }
      return { q, flowGen, flowDis, i, u: q / C, uR: p.R * i, energy: q * q / (2 * C) };
    };
    return { C, tau, E: p.E, R: p.R, iRef: p.E / p.R, xFull: C * p.E, history: new History(evolve, { q: 0, flowGen: 0, flowDis: 0 }) };
  }

  /**
   * Solénoïde long : L = µ₀µᵣN²S/ℓ. Bobine idéale, en série avec R ; en position 2, le courant se referme
   * par la branche de roue libre, sans jamais être coupé.
   * @param {{ N: number, l: number, S: number, mur: number, R: number, E: number }} p
   */
  function inductor(p) {
    const L = MU0 * p.mur * p.N * p.N * p.S / p.l;
    const tau = L / p.R;
    const I = p.E / p.R;
    const evolve = (/** @type {any} */ s0, /** @type {string} */ mode, /** @type {number} */ dt) => {
      const decay = Math.exp(-dt / tau);
      let i = s0.i, flowGen = s0.flowGen, flowDis = s0.flowDis;
      if (mode === 'charge') {
        i = I + (s0.i - I) * decay;
        flowGen = s0.flowGen + I * dt + (s0.i - I) * tau * (1 - decay);
      } else if (mode === 'discharge') {
        i = s0.i * decay;
        flowDis = s0.flowDis + s0.i * tau * (1 - decay);
      }
      const u = mode === 'charge' ? p.E - p.R * i : mode === 'discharge' ? -p.R * i : 0;
      const B = MU0 * p.mur * p.N * i / p.l;
      return { i, flowGen, flowDis, u, uR: p.R * i, B, energy: L * i * i / 2 };
    };
    return { L, tau, E: p.E, R: p.R, iRef: I, xFull: I, history: new History(evolve, { i: 0, flowGen: 0, flowDis: 0 }) };
  }

  /**
   * R = ρL/S. Aucun stockage électrique : i suit u aussitôt. Le seul retard est thermique.
   * @param {{ material: string, L: number, S: number, U: number }} p
   */
  function resistor(p) {
    const mat = MATERIALS[/** @type {keyof typeof MATERIALS} */ (p.material)];
    const R = mat.rho * p.L / p.S;
    const I = p.U / R;
    const P = p.U * I;
    const evolve = (/** @type {any} */ s0, /** @type {string} */ mode, /** @type {number} */ dt) => {
      const decay = Math.exp(-dt / TAU_TH);
      const on = mode === 'charge';
      const target = on ? RTH * P : 0;
      return {
        i: on ? I : 0,
        u: on ? p.U : 0,
        power: on ? P : 0,
        dT: Math.min(DT_MAX, target + (s0.dT - target) * decay),
        flow: s0.flow + (on ? dt : 0), // temps passé sous tension : l'échelle visuelle est choisie au dessin
      };
    };
    return { R, I, P, tau: TAU_TH, rth: RTH, nominal: P_NOMINAL, material: mat, U: p.U, iRef: I, history: new History(evolve, { dT: 0, flow: 0 }) };
  }

  /**
   * Anneaux du code des couleurs (2 chiffres, multiplicateur). Null sous 0,1 Ω, hors du code usuel.
   * @param {number} R
   * @returns {{ digits: number[], mult: number, value: number } | null}
   */
  function colorCode(R) {
    if (!(R >= 0.1) || !isFinite(R)) return null;
    let exp = Math.floor(Math.log10(R)) - 1;
    let two = Math.round(R / Math.pow(10, exp));
    if (two >= 100) { two = 10; exp += 1; }
    if (exp < -2 || exp > 9) return null;
    return { digits: [Math.floor(two / 10), two % 10], mult: exp, value: two * Math.pow(10, exp) };
  }

  RLC.devices = { capacitor, inductor, resistor, colorCode, MATERIALS, EPS0, MU0, RTH, TAU_TH, P_NOMINAL, DT_MAX };
})(globalThis);
