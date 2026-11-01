// Tests du moteur, comparés aux solutions analytiques.
// Navigateur : ouvrir tests/index.html. Node, si vous l'avez : node tests/run-node.js
(function (root) {
  'use strict';
  const RLC = root.RLC;
  const { Sim, library, circuit, linalg } = RLC;
  const results = [];

  function test(name, fn) {
    try { fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, msg: e.message }); }
  }
  function near(a, b, tol, what) {
    if (!(Math.abs(a - b) <= tol)) throw new Error(`${what || 'valeur'} : obtenu ${a}, attendu ${b} (± ${tol})`);
  }
  function ok(cond, what) { if (!cond) throw new Error(what); }

  const lib = (id) => library.find((e) => e.id === id).build();
  const compIdx = (s, label) => s.net.comps.findIndex((c) => c.label === label);
  const run = (doc, tEnd) => {
    const s = new Sim(doc);
    ok(!s.errors.length, 'erreurs de compilation : ' + s.errors.join(' '));
    s.advanceTo(tEnd, 20000);
    ok(s.ctx.t >= tEnd, `simulation incomplète à ${s.ctx.t} au lieu de ${tEnd}`);
    return s;
  };

  test('LU résout un système 3×3', () => {
    const A = Float64Array.from([2, 1, 1, 1, 3, 2, 1, 0, 0]);
    const x = linalg.luSolve(linalg.luFactor(A, 3), Float64Array.from([4, 5, 6]));
    near(x[0], 6, 1e-12); near(x[1], 15, 1e-12); near(x[2], -23, 1e-12);
  });

  test('LU : pivotements successifs sur une matrice 6×6', () => {
    const n = 6, A0 = new Float64Array(n * n), x0 = [3, -1, 4, 1, -5, 9];
    // Pseudo-aléatoire fixe, avec de petits pivots pour forcer plusieurs permutations.
    let seed = 12345;
    for (let i = 0; i < n * n; i++) { seed = (seed * 16807) % 2147483647; A0[i] = seed / 2147483647 - 0.5; }
    for (let i = 0; i < n; i++) A0[i * n + i] *= 1e-6;
    const b = new Float64Array(n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) b[i] += A0[i * n + j] * x0[j];
    const x = linalg.luSolve(linalg.luFactor(A0.slice(), n), b);
    x0.forEach((v, i) => near(x[i], v, 1e-9, 'x' + i));
  });

  test('Valeurs propres : matrice compagne (1, 2 et 3)', () => {
    const ev = linalg.eigenvalues(Float64Array.from([6, -11, 6, 1, 0, 0, 0, 1, 0]), 3).map((l) => l.re).sort((a, b) => a - b);
    near(ev[0], 1, 1e-9); near(ev[1], 2, 1e-9); near(ev[2], 3, 1e-9);
  });

  test('Valeurs propres : paire complexe et ordre 5', () => {
    const ev = linalg.eigenvalues(Float64Array.from([0, -4, 1, 0]), 2);
    near(Math.abs(ev[0].im), 2, 1e-12);
    const M = new Float64Array(25);
    // Blocs (−1 ± 3j), (−2 ± j) et −5, mélangés par une permutation de base.
    M.set([-1, 3, 0, 0, 0, -3, -1, 0, 0, 0, 0, 0, -2, 1, 0, 0, 0, -1, -2, 0, 0, 0, 0, 0, -5]);
    const e5 = linalg.eigenvalues(M, 5);
    ok(e5.some((l) => Math.abs(l.re + 5) < 1e-9), 'mode −5 manquant');
    ok(e5.some((l) => Math.abs(l.re + 1) < 1e-9 && Math.abs(Math.abs(l.im) - 3) < 1e-9), 'mode −1±3j manquant');
  });

  test('Saisie et affichage des valeurs', () => {
    near(circuit.parseSI('4,7k'), 4700, 1e-9);
    near(circuit.parseSI('100 n'), 1e-7, 1e-20);
    near(circuit.parseSI('10mH'), 0.01, 1e-12);
    near(circuit.parseSI('1e-3'), 1e-3, 1e-12);
    near(circuit.parseSI('2.2 µF'), 2.2e-6, 1e-15);
    near(circuit.parseSI('5 V'), 5, 0);
    near(circuit.parseSI('2M'), 2e6, 0);
    ok(isNaN(circuit.parseSI('abc')), 'abc devrait être illisible');
    ok(circuit.formatSI(4700, 'Ω') === '4,7 kΩ', 'format : ' + circuit.formatSI(4700, 'Ω'));
    ok(circuit.formatSI(1e-6, 'F') === '1 µF', 'format : ' + circuit.formatSI(1e-6, 'F'));
  });

  test('Toute la bibliothèque compile et simule sans erreur', () => {
    for (const e of library) {
      const d = e.build();
      const s = new Sim(d);
      if (e.expectError) { ok(s.errors.length > 0, `${e.id} devrait être refusé`); continue; }
      ok(!s.errors.length, `${e.id} : ${s.errors.join(' ')}`);
      ok(!s.net.unconnected.size, `${e.id} : borne non reliée (${[...s.net.unconnected]})`);
      ok(d.probes.length > 0, `${e.id} sans sonde`);
      s.advanceTo(s.tc, 20000);
      ok(s.ctx.t >= s.tc, `${e.id} : simulation incomplète`);
      for (let k = 0; k < s.K; k++) ok(isFinite(s.ctx.st.u[k]) && isFinite(s.ctx.st.i[k]), `${e.id} : valeur non finie`);
    }
  });

  test('RC : charge exponentielle et τ = RC', () => {
    const s = run(lib('rc-charge'), 10e-3);
    const k = compIdx(s, 'C');
    const tau = 1e-3;
    for (const t of [0.1e-3, 0.5e-3, 1e-3, 2e-3, 5e-3]) near(s.sampleAt(t).u[k], 5 * (1 - Math.exp(-t / tau)), 1e-3, `u_C(${t})`);
    near(s.sampleAt(1e-3).i[k], (5 / 1000) * Math.exp(-1), 1e-6, 'i_C(τ)');
    near(s.segments[0].summary.items[0].tau, tau, tau * 1e-3, 'τ affichée');
    near(s.steadyAt(s.segments[0], k, 5e-3)[0], 5, 1e-3, 'permanent');
  });

  test('RC : détection du régime permanent à 1 %', () => {
    const s = run(lib('rc-charge'), 10e-3);
    const r0 = s.regimeAt(1e-3);
    ok(r0.kind === 'transitoire', 'à τ : ' + r0.kind);
    const r1 = s.regimeAt(9e-3);
    ok(r1.kind === 'permanent', 'à 9τ : ' + r1.kind);
    near(r1.tPerm, 1e-3 * Math.log(100), 0.2e-3, 'temps de réponse à 1 %');
  });

  test('RL : établissement du courant', () => {
    const s = run(lib('rl-etablissement'), 1e-3);
    const k = compIdx(s, 'L');
    const tau = 1e-4;
    for (const t of [2e-5, 1e-4, 3e-4]) near(s.sampleAt(t).i[k], 0.05 * (1 - Math.exp(-t / tau)), 2e-5, `i_L(${t})`);
    near(s.sampleAt(1e-4).u[k], 5 * Math.exp(-1), 5e-3, 'u_L(τ)');
  });

  test('RLC série pseudo-périodique : solution exacte, ω₀ et Q', () => {
    const s = run(lib('rlc-pseudo'), 8e-3);
    const k = compIdx(s, 'C');
    const R = 20, L = 10e-3, C = 1e-6, E = 5;
    const w0 = 1 / Math.sqrt(L * C), a = R / (2 * L), wd = Math.sqrt(w0 * w0 - a * a);
    const exact = (t) => E * (1 - Math.exp(-a * t) * (Math.cos(wd * t) + (a / wd) * Math.sin(wd * t)));
    for (const t of [1e-4, 3.3e-4, 7e-4, 1.5e-3, 3e-3, 6e-3]) near(s.sampleAt(t).u[k], exact(t), 2e-3, `u_C(${t})`);
    const m = s.segments[0].summary.items[0];
    ok(m.kind === 'pseudo', 'type : ' + m.kind);
    near(m.w0, w0, w0 * 1e-4, 'ω₀');
    near(m.Q, 5, 5e-3, 'Q');
  });

  test('RLC : classification critique et apériodique', () => {
    const c = new Sim(lib('rlc-critique')).segments[0].summary.items;
    ok(c.length === 1 && c[0].kind === 'critique', 'critique : ' + JSON.stringify(c));
    near(c[0].Q, 0.5, 1e-3, 'Q critique');
    const a = new Sim(lib('rlc-aperiodique')).segments[0].summary.items;
    ok(a.length === 1 && a[0].kind === 'aperiodique', 'apériodique : ' + JSON.stringify(a));
    ok(a[0].Q < 0.5, 'Q apériodique');
  });

  test('LC idéal : énergie conservée et pas de régime permanent', () => {
    const s = run(lib('lc-ideal'), 10e-3);
    const c = compIdx(s, 'C'), l = compIdx(s, 'L');
    const w0 = 1e4;
    near(s.sampleAt(3e-3).u[c], 5 * Math.cos(w0 * 3e-3), 5e-3, 'u_C(3 ms)');
    const x = s.sampleAt(9.7e-3);
    near(0.5e-6 * x.u[c] ** 2 + 0.5 * 10e-3 * x.i[l] ** 2, 0.5e-6 * 25, 1e-8, 'énergie');
    ok(s.regimeAt(9e-3).kind === 'libre', 'régime : ' + s.regimeAt(9e-3).kind);
    ok(s.segments[0].summary.items[0].kind === 'harmonique', 'mode harmonique attendu');
  });

  test('RLC forcé : amplitude et phase du permanent (phaseurs)', () => {
    const doc = lib('rlc-resonance');
    const s = run(doc, 30e-3);
    const R = 20, L = 10e-3, C = 1e-6, f = 1592, w = 2 * Math.PI * f;
    const X = L * w - 1 / (C * w), Z = Math.hypot(R, X), phi = Math.atan2(X, R);
    const kR = compIdx(s, 'R'), seg = s.segments[0];
    // Solution de référence i = (E/Z) sin(ωt − φ), comparée au permanent calculé et à la simulation.
    for (const t of [20e-3, 25.1e-3, 27.3e-3]) {
      const ref = (1 / Z) * Math.sin(w * t - phi);
      near(s.steadyAt(seg, kR, t)[1], ref, 1e-6, `permanent ${t}`);
      near(s.sampleAt(t).i[kR], ref, 1e-3, `simulation ${t}`);
    }
    ok(s.regimeAt(28e-3).kind === 'permanent', 'régime final : ' + s.regimeAt(28e-3).kind);
    ok(s.regimeAt(0.5e-3).kind === 'transitoire', 'régime initial');
  });

  test('RC en créneaux : régime périodique exact, y compris τ ≪ T', () => {
    const check = (R, f) => {
      const doc = lib('rc-creneaux');
      doc.comps.find((c) => c.label === 'R').params.R = R;
      doc.comps.find((c) => c.label === 'E').params.f = f;
      const tau = R * 1e-6, T = 1 / f;
      const s = run(doc, Math.max(12 * tau, 10 * T));
      const k = compIdx(s, 'C'), seg = s.segments[0];
      // Juste avant le front descendant (t = T/2 modulo T), u_C = E·tanh(T/4τ).
      const pk = 5 * Math.tanh(T / (4 * tau));
      const t = (Math.ceil(s.ctx.t / T) - 2 + 0.5) * T - T * 1e-5;
      near(s.steadyAt(seg, k, t)[0], pk, 3e-3, `crête permanente R=${R}`);
      near(s.sampleAt(t).u[k], pk, 3e-3, `crête simulée R=${R}`);
      ok(s.regimeAt(s.ctx.t - 2 * T).kind === 'permanent', `régime R=${R} : ` + s.regimeAt(s.ctx.t - 2 * T).kind);
    };
    check(1000, 500);   // τ comparable à T
    check(100, 50);     // τ = 0,1 ms ≪ T = 20 ms
  });

  test('Condensateurs en série : le partage suit la conservation de la charge', () => {
    const d = circuit.newDoc();
    const E = circuit.addComp(d, 'vsource', 0, 4, 1, { A: 9 }, 'E');
    circuit.addComp(d, 'resistor', 4, 0, 0, { R: 100 }, 'R');
    circuit.addComp(d, 'capacitor', 10, 2, 1, { C: 1e-6 }, 'C1');
    circuit.addComp(d, 'capacitor', 10, 8, 1, { C: 2e-6 }, 'C2');
    circuit.addWirePath(d, [0, 2], [0, 0], [2, 0]);
    circuit.addWirePath(d, [6, 0], [10, 0]);
    circuit.addWirePath(d, [10, 4], [10, 6]);
    circuit.addWirePath(d, [10, 10], [0, 10], [0, 6]);
    void E;
    const s = run(d, 3e-3);
    const c1 = compIdx(s, 'C1'), c2 = compIdx(s, 'C2'), seg = s.segments[0];
    near(s.sampleAt(3e-3).u[c1], 6, 1e-3, 'u_C1 simulée');
    near(s.sampleAt(3e-3).u[c2], 3, 1e-3, 'u_C2 simulée');
    near(s.steadyAt(seg, c1, 3e-3)[0], 6, 1e-3, 'u_C1 permanente');
    near(s.steadyAt(seg, c2, 3e-3)[0], 3, 1e-3, 'u_C2 permanente');
    ok(s.regimeAt(2.9e-3).kind === 'permanent', 'régime');
  });

  test('Partage de charge : charge conservée, énergie dissipée', () => {
    const s = run(lib('partage-charge'), 10e-3);
    const c1 = compIdx(s, 'C1'), c2 = compIdx(s, 'C2');
    const x = s.sampleAt(9e-3);
    // Convention : u_C1 et u_C2 sont de même sens dans la boucle, leurs valeurs s'égalisent à E/2 en module.
    near(Math.abs(x.u[c1]), 5, 1e-2, 'u_C1 finale');
    near(Math.abs(x.u[c2]), 5, 1e-2, 'u_C2 finale');
    near(s.segments.length, 2, 0, 'segments');
  });

  test('Temps réversible : relire le passé rend les mêmes valeurs', () => {
    const s = run(lib('rlc-pseudo'), 5e-3);
    const k = compIdx(s, 'C');
    const a = s.sampleAt(1.234e-3).u[k], head = s.ctx.t;
    s.sampleAt(4e-3);
    near(s.sampleAt(1.234e-3).u[k], a, 0, 'relecture');
    near(s.ctx.t, head, 0, 'la relecture ne change pas la tête de simulation');
  });

  test('Interrupteur basculé dans le passé : le futur est réécrit', () => {
    const doc = lib('rc-charge');
    doc.comps.find((c) => c.label === 'K').params.closed = false;
    const s = run(doc, 5e-3);
    const k = compIdx(s, 'C'), id = doc.comps.find((c) => c.label === 'K').id;
    near(s.sampleAt(5e-3).u[k], 0, 1e-5, 'C presque vide tant que K est ouvert (fuite de Roff)');
    // On ferme K à 2 ms alors que la tête est à 5 ms.
    const rewrote = s.toggleAt(2e-3, id);
    ok(rewrote, 'le futur aurait dû être réécrit');
    ok(s.ctx.t < 2.1e-3, 'la tête revient vers 2 ms : ' + s.ctx.t);
    s.advanceTo(5e-3, 20000);
    near(s.sampleAt(3e-3).u[k], 5 * (1 - Math.exp(-1)), 2e-3, 'charge depuis 2 ms');
    near(s.sampleAt(1.5e-3).u[k], 0, 1e-5, 'avant le basculement, inchangé');
    ok(s.segments.length === 2, 'segments : ' + s.segments.length);
  });

  test('Basculement programmé et changement de paramètre en cours de route', () => {
    const doc = lib('rc-decharge');
    const s = run(doc, 8e-3);
    const k = compIdx(s, 'C');
    near(s.sampleAt(1.9e-3).u[k], 5, 2e-3, 'avant K');
    near(s.sampleAt(3e-3).u[k], 5 * Math.exp(-1), 3e-3, 'une constante de temps après K');
    ok(s.segments.length === 2, 'segments');
    const kR = compIdx(s, 'R');
    const uBefore = s.sampleAt(s.ctx.t).u[k];
    s.editAt(s.ctx.t, (p) => { p[kR].R = 2000; }, 'R modifiée');
    const t0 = s.ctx.t;
    s.advanceTo(t0 + 2e-3, 20000);
    near(s.sampleAt(t0 + 2e-3).u[k], uBefore * Math.exp(-1), Math.abs(uBefore) * 2e-2 + 1e-5, 'nouvelle constante de temps');
  });

  test('Le courant dans chaque fil suit la loi des nœuds', () => {
    const s = run(lib('rlc-parallele'), 1e-3);
    const x = s.sampleAt(1e-3);
    const sum = (e) => { let v = 0; for (let j = 0; j < e.terms.length; j += 2) v += e.terms[j + 1] * x.i[e.terms[j]]; return v; };
    // Rail du haut, entre le générateur (x = 6) et le premier dipôle : tout le courant de la source.
    const kI = compIdx(s, 'I');
    const first = s.net.edges.find((e) => e.dir === 'h' && e.y === 4 && e.x === 6);
    near(Math.abs(sum(first)), Math.abs(x.i[kI]), 1e-9, 'rail du haut');
    // Dernier tronçon vertical au-dessus de C : le courant de C.
    const kC = compIdx(s, 'C');
    const c = s.net.comps[kC].comp;
    const top = s.net.edges.find((e) => e.dir === 'v' && e.x === c.x && e.y === 4);
    near(Math.abs(sum(top)), Math.abs(x.i[kC]), 1e-9, 'branche de C');
  });

  test('Compilation : erreurs et avertissements', () => {
    const d = circuit.newDoc();
    circuit.addComp(d, 'vsource', 0, 0, 0, { A: 5 }, 'E');
    circuit.addWirePath(d, [-2, 0], [-2, 2], [2, 2], [2, 0]);
    ok(new Sim(d).errors.length === 1, 'générateur court-circuité non détecté');

    const p = circuit.newDoc();
    circuit.addComp(p, 'vsource', 0, 0, 0, { A: 5 }, 'E1');
    circuit.addComp(p, 'vsource', 0, 4, 0, { A: 3 }, 'E2');
    circuit.addWirePath(p, [-2, 0], [-2, 4]);
    circuit.addWirePath(p, [2, 0], [2, 4]);
    ok(new Sim(p).errors.length === 1, 'boucle de générateurs non détectée');

    const o = circuit.newDoc();
    circuit.addComp(o, 'resistor', 0, 0, 0, {}, 'R');
    ok(new Sim(o).net.unconnected.size === 1, 'borne en l\'air non détectée');
  });

  test('Mémoire pleine : le passé reste accessible après éclaircissement', () => {
    const s = new Sim(lib('rlc-pseudo'));
    s.cap = 2000;
    s.advanceTo(40e-3, 20000);
    ok(s.len <= 2000, 'taille : ' + s.len);
    const k = compIdx(s, 'C');
    near(s.h[0], 0, 0, 't = 0 conservé');
    const R = 20, L = 10e-3, C = 1e-6, E = 5, w0 = 1 / Math.sqrt(L * C), a = R / (2 * L), wd = Math.sqrt(w0 * w0 - a * a);
    const t = 1e-3;
    const exact = E * (1 - Math.exp(-a * t) * (Math.cos(wd * t) + (a / wd) * Math.sin(wd * t)));
    near(s.sampleAt(t).u[k], exact, 0.1, 'valeur après éclaircissement');
  });

  // ---------- Diode et AOP ----------
  /** Extrema d'une grandeur sur un intervalle de temps. */
  const extrema = (s, k, kind, t0, t1, n = 4000) => {
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j <= n; j++) {
      const x = s.sampleAt(t0 + (t1 - t0) * j / n);
      const v = kind === 'i' ? x.i[k] : x.u[k];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return { lo, hi };
  };

  test('Diode : point de fonctionnement en continu', () => {
    const d = circuit.newDoc();
    circuit.addComp(d, 'vsource', 0, 4, 1, { A: 5 }, 'E');
    circuit.addComp(d, 'diode', 4, 0, 0, {}, 'D');
    circuit.addComp(d, 'resistor', 8, 4, 1, { R: 1000 }, 'R');
    circuit.addWirePath(d, [0, 2], [0, 0], [2, 0]);
    circuit.addWirePath(d, [6, 0], [8, 0], [8, 2]);
    circuit.addWirePath(d, [8, 6], [8, 8], [0, 8], [0, 6]);
    const s = run(d, 1e-3);
    const x = s.sampleAt(1e-3), kD = compIdx(s, 'D');
    near(x.i[kD], 4.4e-3 / 1.001, 2e-5, 'i');
    near(x.u[kD], 0.6 + x.i[kD], 0.02, 'u_D ≈ Vd + Rd i (coude arrondi sur 10 mV)');
    ok(s.regimeAt(1e-3).kind === 'permanent', 'régime : ' + s.regimeAt(1e-3).kind);
    // Diode retournée : bloquée.
    d.comps.find((c) => c.label === 'D').rot = 2;
    const b = run(d, 1e-3);
    near(b.sampleAt(1e-3).i[compIdx(b, 'D')], 0, 1e-7, 'courant inverse');
  });

  test('Redressement simple alternance : seuil et blocage', () => {
    const s = run(lib('diode-simple'), 40e-3);
    const { lo, hi } = extrema(s, compIdx(s, 'R'), 'u', 0, 40e-3);
    near(hi, 9.4 * 1000 / 1001, 0.03, 'crête');
    near(lo, 0, 1e-3, 'alternance bloquée');
    ok(s.regimeAt(39e-3).kind === 'permanent', 'permanent périodique');
    near(s.segments[0].nl.T, 20e-3, 1e-9, 'période');
  });

  test('Pont de Graetz : deux seuils perdus, sortie toujours positive', () => {
    const s = run(lib('diode-graetz'), 40e-3);
    const { lo, hi } = extrema(s, compIdx(s, 'R'), 'u', 5e-3, 40e-3);
    near(hi, 8.8 * 1000 / 1002, 0.04, 'crête');
    ok(lo > -1e-3, 'sortie positive : ' + lo);
    // Deux bosses par période du secteur.
    near(s.sampleAt(25e-3).u[compIdx(s, 'R')], s.sampleAt(35e-3).u[compIdx(s, 'R')], 0.02, 'périodicité T/2');
  });

  test('Détecteur de crête : charge puis faible ondulation', () => {
    const s = run(lib('diode-crete'), 0.6);
    const { lo, hi } = extrema(s, compIdx(s, 'C'), 'u', 0.5, 0.6);
    ok(hi < 9.5 && hi > 8.5, 'crête : ' + hi);
    ok(hi - lo < 2.1 && hi - lo > 1, 'ondulation ≈ T/RC·U : ' + (hi - lo));
    ok(s.segments[0].nl.kind === 'forced', 'régime : ' + s.segments[0].nl.kind);
  });

  test('Écrêteur et Zener', () => {
    const e = run(lib('diode-ecreteur'), 30e-3);
    const r = extrema(e, compIdx(e, 'D1'), 'u', 5e-3, 30e-3);
    near(r.hi, 0.6, 0.02, 'écrêtage haut');
    near(r.lo, -0.6, 0.02, 'écrêtage bas');
    const z = run(lib('diode-zener'), 30e-3);
    const v = extrema(z, compIdx(z, 'Rc'), 'u', 5e-3, 30e-3);
    ok(v.hi < 5.15 && v.lo > 5.05, `Zener : ${v.lo} à ${v.hi}`);
  });

  test('Diode de roue libre : décroissance sans surtension', () => {
    const s = run(lib('diode-roue-libre'), 22e-3);
    const k = compIdx(s, 'L');
    const iK = 0.24 * (1 - Math.exp(-10e-3 / 2e-3));
    near(s.sampleAt(9.999e-3).i[k], iK, 1e-3, 'courant avant K (5 τ)');
    // Après K, le courant décroît avec τ ≈ L/r, la bobine ne voit que le seuil de la diode.
    const i1 = s.sampleAt(12e-3).i[k];
    near(i1, (iK + 0.6 / 50) * Math.exp(-1) - 0.6 / 50, 0.01, 'i une constante de temps après');
    const u = extrema(s, k, 'u', 10.1e-3, 20e-3);
    ok(u.lo > -0.9, 'la bobine ne voit que Vd + Rd·i : ' + u.lo);
    ok(!s.overvoltage, 'surtension détectée');
  });

  test('AOP en régime linéaire : suiveur, inverseur, non-inverseur', () => {
    const gain = (id, g) => {
      const s = run(lib(id), 4e-3);
      const kA = compIdx(s, 'A'), kE = compIdx(s, 'E');
      for (const t of [2.2e-3, 2.5e-3, 3.1e-3]) {
        const x = s.sampleAt(t);
        near(x.u[kA], g * x.u[kE], 0.02 * Math.abs(g) + 0.005, `${id} à ${t}`);
      }
      ok(s.regimeAt(3.9e-3).kind === 'permanent', `${id} : ` + s.regimeAt(3.9e-3).kind);
      // Masse virtuelle : ε reste de l'ordre de quelques millivolts au plus.
      const n = s.net.comps[kA], x = s.sampleAt(3.3e-3);
      ok(Math.abs(x.V[n.a] - x.V[n.b]) < 0.05, 'ε : ' + (x.V[n.a] - x.V[n.b]));
    };
    gain('aop-suiveur', 1);
    gain('aop-inverseur', -10);
    gain('aop-non-inverseur', 3);
  });

  test('Intégrateur : pente = −E/RC, triangle en régime établi', () => {
    const s = run(lib('aop-integrateur'), 100e-3);
    const k = compIdx(s, 'A');
    const a = s.sampleAt(90.2e-3).u[k], b = s.sampleAt(90.8e-3).u[k];
    near((b - a) / 0.6e-3, -1000, 80, 'pente pendant E = +1 V');
    const r = extrema(s, k, 'u', 90e-3, 100e-3);
    near(r.hi, 0.5, 0.05, 'crête du triangle');
    near(r.lo, -0.5, 0.05, 'creux du triangle');
    ok(s.regimeAt(99e-3).kind === 'permanent', 'régime : ' + s.regimeAt(99e-3).kind);
  });

  test('Comparateur : saturation et basculement au seuil', () => {
    const s = run(lib('aop-comparateur'), 4e-3);
    const k = compIdx(s, 'A');
    const r = extrema(s, k, 'u', 1e-3, 4e-3);
    near(r.hi, 15, 0.1, 'saturation haute');
    near(r.lo, -15, 0.1, 'saturation basse');
    // u_e = 5 sin ωt dépasse 2 V à t = asin(0,4)/ω ≈ 65,5 µs (modulo la période).
    const t = 2e-3 + Math.asin(0.4) / (2 * Math.PI * 1000);
    ok(s.sampleAt(t - 15e-6).u[k] < 0, 'avant le seuil');
    // ε croît lentement au passage du seuil : le basculement dure quelques dizaines de microsecondes.
    ok(s.sampleAt(t + 40e-6).u[k] > 10, 'après le seuil : ' + s.sampleAt(t + 40e-6).u[k]);
  });

  test('Bascule de Schmitt : seuils à ± 5 V', () => {
    const s = run(lib('aop-schmitt'), 15e-3);
    const kA = compIdx(s, 'A'), kE = compIdx(s, 'E');
    const r = extrema(s, kA, 'u', 5e-3, 15e-3);
    near(r.hi, 15, 0.1, 'saturation haute');
    near(r.lo, -15, 0.1, 'saturation basse');
    // Niveaux d'entrée au moment où la sortie passe par zéro.
    const cross = [];
    let prev = s.sampleAt(5e-3).u[kA];
    for (let t = 5e-3; t < 15e-3; t += 2e-7) {
      const x = s.sampleAt(t);
      if (Math.sign(x.u[kA]) !== Math.sign(prev)) cross.push(x.u[kE]);
      prev = x.u[kA];
    }
    ok(cross.length >= 3, 'basculements : ' + cross.length);
    for (const v of cross) near(Math.abs(v), 5, 0.25, 'seuil');
  });

  test('Astable : période 2RC ln 3 et orbite détectée', () => {
    const s = run(lib('aop-astable'), 12e-3);
    const nl = s.segments[0].nl;
    ok(nl.kind === 'oscillator', 'type : ' + nl.kind);
    near(nl.T, 2 * 1e-3 * Math.log(3), 0.05e-3, 'période');
    const kC = compIdx(s, 'C');
    const r = extrema(s, kC, 'u', 5e-3, 12e-3);
    near(r.hi, 7.5, 0.2, 'seuil haut sur C');
    near(r.lo, -7.5, 0.2, 'seuil bas sur C');
    ok(s.regimeAt(11e-3).kind === 'permanent', 'régime : ' + s.regimeAt(11e-3).kind);
  });

  test('Pont de Wien : démarrage et fréquence', () => {
    const s = run(lib('aop-wien'), 30e-3);
    const nl = s.segments[0].nl;
    ok(nl.kind === 'oscillator', 'type : ' + nl.kind);
    near(1 / nl.T, 1 / (2 * Math.PI * 1e-4), 200, 'fréquence');
    const r = extrema(s, compIdx(s, 'A'), 'u', 25e-3, 30e-3);
    ok(r.hi > 8 && r.lo < -8, `amplitude : ${r.lo} à ${r.hi}`);
  });

  test('Redresseur de précision : le seuil de la diode est compensé', () => {
    const s = run(lib('aop-precision'), 30e-3);
    const r = extrema(s, compIdx(s, 'Rc'), 'u', 12e-3, 30e-3);
    near(r.hi, 1, 0.01, 'crête sans perte de seuil');
    near(r.lo, 0, 2e-3, 'alternance négative');
  });

  test('Non linéaire : réversibilité et basculement dans le passé', () => {
    const s = run(lib('diode-roue-libre'), 15e-3);
    const k = compIdx(s, 'L');
    const a = s.sampleAt(11e-3).i[k];
    near(s.sampleAt(11e-3).i[k], a, 0, 'relecture');
    ok(s.editAt(5e-3, (p) => { p[compIdx(s, 'L')].r = 100; }, 'r modifiée'), 'futur réécrit');
    s.advanceTo(15e-3, 20000);
    ok(s.segments.length >= 2, 'nouveau segment');
    ok(s.sampleAt(9.9e-3).i[k] < 0.15, 'nouveau courant établi : ' + s.sampleAt(9.9e-3).i[k]);
  });

  test('Courant dans les fils autour d\'un AOP : retour par la masse', () => {
    const s = run(lib('aop-inverseur'), 2e-3);
    const x = s.sampleAt(1.3e-3);
    const sum = (e) => { let v = 0; for (let j = 0; j < e.terms.length; j += 2) v += e.terms[j + 1] * x.i[e.terms[j]]; return v; };
    // Tronçon au-dessus de la charge : tout le courant de Rc.
    const kRc = compIdx(s, 'Rc'), top = s.net.edges.find((e) => e.dir === 'v' && e.x === 25 && e.y === 12);
    near(Math.abs(sum(top)), Math.abs(x.i[kRc]), 1e-7, 'branche de Rc');
  });

  test('Interrupteur ouvert : le courant reste sous le seuil des fuites', () => {
    const doc = lib('rlc-pseudo');
    doc.comps.find((c) => c.label === 'K').params.closed = false;
    const s = run(doc, 5e-3);
    const x = s.sampleAt(4e-3);
    let vMax = 0;
    for (const v of x.V) vMax = Math.max(vMax, Math.abs(v));
    const leak = s.leakCurrent(s.segmentAt(4e-3), vMax);
    for (let k = 0; k < s.K; k++) ok(Math.abs(x.i[k]) < leak, `${s.net.comps[k].label} : ${x.i[k]} ≥ ${leak}`);
    // Rien ne se passe : c'est un régime permanent, pas un transitoire sans fin dû à la fuite.
    near(s.steadyAt(s.segmentAt(4e-3), compIdx(s, 'C'), 4e-3)[0], 0, 1e-6, 'u_C permanente');
    ok(s.regimeAt(4e-3).kind === 'permanent', 'régime : ' + s.regimeAt(4e-3).kind);
    // Une fois K fermé, le vrai courant dépasse largement ce seuil.
    s.toggleAt(5e-3, doc.comps.find((c) => c.label === 'K').id);
    s.advanceTo(5.2e-3, 20000);
    const y = s.sampleAt(5.2e-3);
    ok(Math.abs(y.i[compIdx(s, 'L')]) > 1000 * s.leakCurrent(s.segmentAt(5.2e-3), 5), 'courant réel');
  });

  test('Chargeur de téléphone : 5 V stables sous 500 mA', () => {
    const s = run(lib('chargeur-telephone'), 0.6);
    const out = extrema(s, compIdx(s, 'Rc'), 'u', 0.5, 0.6);
    ok(out.lo > 4.9 && out.hi < 5.3, `sortie : ${out.lo} à ${out.hi}`);
    near(s.sampleAt(0.55).i[compIdx(s, 'Rc')], 0.5, 0.03, 'courant de charge');
    const cap = extrema(s, compIdx(s, 'C'), 'u', 0.5, 0.6);
    ok(cap.hi - cap.lo > 0.3 && cap.lo > 6, `ondulation sur C : ${cap.lo} à ${cap.hi}`);
    ok(s.segments[0].nl.kind === 'forced', 'type : ' + s.segments[0].nl.kind);
    ok(s.regimeAt(0.59).kind === 'permanent', 'régime : ' + s.regimeAt(0.59).kind);
  });

  test('Lampe : dipôle ohmique, éclat proportionnel à |u|/Umax', () => {
    const d = circuit.newDoc();
    circuit.addComp(d, 'vsource', 0, 4, 1, { A: 4 }, 'E');
    circuit.addComp(d, 'resistor', 4, 0, 0, { R: 100 }, 'R');
    const lamp = circuit.addComp(d, 'lamp', 8, 4, 1, { R: 300, Umax: 6 }, 'H');
    circuit.addWirePath(d, [0, 2], [0, 0], [2, 0]);
    circuit.addWirePath(d, [6, 0], [8, 0], [8, 2]);
    circuit.addWirePath(d, [8, 6], [8, 8], [0, 8], [0, 6]);
    const s = run(d, 1e-3);
    const x = s.sampleAt(1e-3), k = compIdx(s, 'H');
    near(x.u[k], 3, 1e-6, 'diviseur : u = 3 V');
    near(x.i[k], 0.01, 1e-8, 'i = u/R');
    near(circuit.lampLevel(x.u[k], lamp.params), 0.5, 1e-6, 'éclat à Umax/2');
    near(circuit.lampLevel(-3, lamp.params), 0.5, 0, 'indépendant du signe');
    near(circuit.lampLevel(0, lamp.params), 0, 0, 'éteinte');
    near(circuit.lampLevel(6, lamp.params), 1, 0, 'pleine à Umax');
    near(circuit.lampLevel(9, lamp.params), 1, 0, 'plafonnée au-delà');
  });

  test('Minuterie : la lampe décroît avec τ = RC', () => {
    const s = run(lib('app-minuterie'), 2);
    const k = compIdx(s, 'H'), lamp = s.net.comps[k].comp.params;
    near(s.sampleAt(0.49).u[k], 12 * 1000 / 1010, 0.02, 'lampe allumée avant K');
    near(s.sampleAt(1.5).u[k], s.sampleAt(0.5).u[k] * Math.exp(-1), 0.05, 'une constante de temps après');
    ok(circuit.lampLevel(s.sampleAt(1.5).u[k], lamp) < 0.4, 'éclat réduit');
  });

  test('Flash : charge lente, décharge rapide dans la lampe', () => {
    const s = run(lib('app-flash'), 0.8);
    const kC = compIdx(s, 'C'), kH = compIdx(s, 'H');
    near(s.sampleAt(0.49).u[kC], 9, 0.08, 'C chargé avant K');
    near(s.sampleAt(0.49).u[kH], 0, 1e-3, 'lampe éteinte avant K');
    const v = extrema(s, kH, 'u', 0.5, 0.52);
    ok(v.hi > 8.5, 'éclair : ' + v.hi);
    // Décharge dans 10 Ω en parallèle de 100 Ω côté source : retour vers 9·10/110.
    near(s.sampleAt(0.7).u[kC], 9 * 10 / 110, 0.05, 'tension finale');
  });

  test('Clignotant : période 2RC ln 3, lampe allumée une demi-période', () => {
    const s = run(lib('app-clignotant'), 11);
    const nl = s.segments[0].nl, kH = compIdx(s, 'H');
    ok(nl.kind === 'oscillator', 'type : ' + nl.kind);
    near(nl.T, 2 * Math.log(3), 0.05, 'période');
    let on = 0;
    const n = 2000, lamp = s.net.comps[kH].comp.params;
    for (let j = 0; j < n; j++) if (circuit.lampLevel(s.sampleAt(5 + 4 * j / n).u[kH], lamp) > 0.5) on++;
    near(on / n, 0.5, 0.08, 'fraction du temps allumée');
    near(extrema(s, kH, 'u', 5, 9).hi, 15 - 0.6, 0.3, 'tension sur la lampe');
  });

  test('Défibrillateur : RLC série et courant de crête', () => {
    const s = run(lib('app-defibrillateur'), 10e-3);
    const after = s.segmentAt(5e-3), m = after.summary.items[0];
    near(m.Q, Math.sqrt(40e-3 / 32e-6) / 50, 0.01, 'Q');
    near(m.w0, 1 / Math.sqrt(40e-3 * 32e-6), 2, 'ω₀');
    const k = compIdx(s, 'Thorax'), a = 625, w = Math.sqrt(m.w0 * m.w0 - a * a);
    const t = Math.atan(w / a) / w;   // instant du maximum de i = V₀/(Lω) e^(−at) sin ωt
    const peak = 5000 / (40e-3 * w) * Math.exp(-a * t) * Math.sin(w * t);
    near(extrema(s, k, 'i', 1e-3, 8e-3).hi, peak, 0.5, 'courant de crête');
    ok(peak > 40 && peak < 80, 'ordre de grandeur : ' + peak);
  });

  test('Allumage : surtension à l\'ouverture de K, ordre de grandeur i√(L/C)', () => {
    const s = run(lib('app-allumage'), 20e-3);
    const k = compIdx(s, 'L');
    near(s.sampleAt(14.9e-3).i[k], 3, 0.01, 'courant établi');
    const low = extrema(s, k, 'u', 15e-3, 17e-3, 8000).lo;
    const expect = 3 * Math.sqrt(8e-3 / 0.22e-6);
    ok(Math.abs(low) > 0.7 * expect && Math.abs(low) < 1.1 * expect, `crête ${low} pour ${expect}`);
    ok(!s.overvoltage, 'pas d\'alerte en dessous de 100 kV');
  });

  test('Enceinte : chaque voie reçoit sa bande de fréquences', () => {
    const s = run(lib('app-enceinte'), 40e-3);
    const seg = s.segments[0], amp = (label, w) => {
      const k = compIdx(s, label), m = seg.steady.terms.find((x) => Math.abs(x.w - w) < 1);
      return Math.hypot(m.ur[k], m.ui[k]);
    };
    const wG = 2 * Math.PI * 100, wA = 2 * Math.PI * 5000;
    near(amp('Boomer', wG), 8 / Math.hypot(8, wG * 1.3e-3), 1e-4, 'boomer, graves');
    near(amp('Boomer', wA), 8 / Math.hypot(8, wA * 1.3e-3), 1e-4, 'boomer, aigus');
    near(amp('Tweeter', wA), 8 / Math.hypot(8, 1 / (wA * 20e-6)), 1e-4, 'tweeter, aigus');
    near(amp('Tweeter', wG), 8 / Math.hypot(8, 1 / (wG * 20e-6)), 1e-4, 'tweeter, graves');
    ok(amp('Boomer', wG) > 5 * amp('Boomer', wA), 'boomer sélectif');
    ok(amp('Tweeter', wA) > 5 * amp('Tweeter', wG), 'tweeter sélectif');
  });

  test('Accord radio : la station A passe, la station B est rejetée', () => {
    const s = run(lib('app-radio-accord'), 30e-3);
    const k = compIdx(s, 'R');
    const r = extrema(s, k, 'u', 25e-3, 30e-3, 20000);
    const b = 10 / Math.hypot(10, 2 * Math.PI * 5000 * 10e-3 - 1 / (2 * Math.PI * 5000 * 1e-6));
    near(r.hi, 1 + b, 0.03, 'amplitude au-dessus de R');
    ok(b < 0.05, 'atténuation de B : ' + b);
  });

  test('Démodulation AM : C suit l\'enveloppe du message', () => {
    const s = run(lib('app-radio-am'), 8e-3);
    const nl = s.segments[0].nl;
    near(nl.T, 1e-3, 1e-9, 'période commune');
    const k = compIdx(s, 'C');
    const r = extrema(s, k, 'u', 6e-3, 8e-3, 8000);
    ok(r.hi > 6.4 && r.hi < 7, 'crête : ' + r.hi);
    ok(r.lo > 1.2 && r.lo < 3, 'creux (2,5 V − seuil, moins la décharge de C) : ' + r.lo);
    ok(s.regimeAt(7.9e-3).kind === 'permanent', 'régime : ' + s.regimeAt(7.9e-3).kind);
  });

  test('Table de mixage : u_s = −2(e₁ + e₂)', () => {
    const s = run(lib('app-mixage'), 25e-3);
    const kA = compIdx(s, 'A'), k1 = compIdx(s, 'Micro'), k2 = compIdx(s, 'Guitare');
    for (const t of [20.3e-3, 21.7e-3, 23.1e-3]) {
      const x = s.sampleAt(t);
      near(x.u[kA], -2 * (x.u[k1] + x.u[k2]), 0.03, `à ${t}`);
    }
  });

  test('Jauge : déséquilibre du pont de Wheatstone', () => {
    const s = run(lib('app-jauge'), 1e-3);
    near(s.sampleAt(1e-3).u[compIdx(s, 'V')], 5 - 10 * 1010 / 2010, 1e-5, 'tension de pont');
  });

  test('Bibliothèque : aucun fil en attente', () => {
    for (const e of library) {
      const d = e.build();
      const deg = new Map();
      const bump = (x, y) => { const q = x + ',' + y; deg.set(q, (deg.get(q) || 0) + 1); };
      for (const w of d.wires) { const f = circuit.parseEdge(w); bump(f.x, f.y); bump(f.x2, f.y2); }
      for (const c of d.comps) for (const [x, y] of circuit.terminals(c)) bump(x, y);
      for (const [q, n] of deg) ok(n >= 2, `${e.id} : extrémité libre en ${q}`);
    }
  });

  // ---------- Aides à la compréhension ----------
  test('Parcours guidés : chaque circuit en a un, aux instants croissants', () => {
    for (const e of library) {
      ok(e.guide && e.guide.length >= 1, `${e.id} sans parcours`);
      for (let j = 0; j < e.guide.length; j++) {
        const g = e.guide[j];
        ok(typeof g.text === 'string' && g.text.length > 20 && g.t >= 0, `${e.id}, étape ${j}`);
        if (j) ok(g.t > e.guide[j - 1].t, `${e.id} : instants non croissants à l'étape ${j}`);
      }
      if (e.expectError) continue;
      const s = new Sim(e.build());
      const last = e.guide[e.guide.length - 1].t;
      s.advanceTo(last, 20000);
      ok(s.ctx.t >= last, `${e.id} : étape finale inatteignable`);
    }
    ok(Object.keys(RLC.guides).every((id) => library.some((e) => e.id === id)), 'parcours orphelin');
  });

  test('Parcours guidés : les valeurs annoncées sont exactes', () => {
    const at = (id, label, kind, t) => {
      const s = new Sim(lib(id));
      s.advanceTo(t, 20000);
      const x = s.sampleAt(t), k = compIdx(s, label);
      return kind === 'i' ? x.i[k] : x.u[k];
    };
    near(at('rc-charge', 'C', 'u', 1e-3), 3.16, 0.01, 'RC à τ');
    near(at('rlc-pseudo', 'C', 'u', 3.16e-4), 8.6, 0.15, 'dépassement du RLC');
    near(Math.abs(at('lc-ideal', 'L', 'i', 157e-6)), 0.05, 1e-3, 'LC à T₀/4');
    near(at('rl-rupture', 'L', 'u', 1.005e-3), -30, 5, 'surtension de rupture');
    near(at('rl-rupture', 'L', 'i', 0.99e-3), 0.031, 2e-3, 'i avant rupture');
    near(at('app-defibrillateur', 'Thorax', 'i', 2.26e-3), 65, 3, 'crête du défibrillateur');
    near(at('aop-precision', 'A', 'u', 2.5e-3), 1.6, 0.05, 'sortie du redresseur de précision');
    near(at('diode-zener', 'Rs', 'i', 2.5e-3), 0.045, 2e-3, 'courant de Rs à la crête');
    near(at('diode-zener', 'Rs', 'i', 7.5e-3), 0.018, 2e-3, 'courant de Rs au creux');
    near(at('app-flash', 'H', 'u', 0.65), 9 * 10 / 110, 0.05, 'lueur du flash');
    near(at('app-jauge', 'V', 'u', 5e-4), -0.025, 1e-3, 'jauge');
  });

  test('Erreurs classiques : les comportements annoncés', () => {
    const rev = run(lib('err-diode-envers'), 20e-3);
    const r = extrema(rev, compIdx(rev, 'R'), 'u', 0, 20e-3);
    near(r.lo, -9.4 * 1000 / 1001, 0.03, 'diode retournée : crête négative');
    near(r.hi, 0, 1e-3, 'diode retournée : rien en positif');
    for (const id of ['err-sans-contre-reaction', 'err-entrees-inversees']) {
      const s = run(lib(id), 3e-3);
      const v = extrema(s, compIdx(s, 'A'), 'u', 1e-3, 3e-3);
      ok(Math.max(Math.abs(v.lo), Math.abs(v.hi)) > 14.5, `${id} : la sortie doit saturer`);
    }
    const open = run(lib('err-sans-contre-reaction'), 3e-3);
    const w = extrema(open, compIdx(open, 'A'), 'u', 1e-3, 3e-3);
    ok(w.hi > 14.5 && w.lo < -14.5, 'sans contre-réaction : les deux saturations');
    const cut = run(lib('err-coupure-bobine'), 2.1e-3);
    ok(cut.overvoltage, 'bobine coupée : alerte de surtension');
    const lamp = run(lib('err-condensateur-continu'), 60e-3);
    const kH = compIdx(lamp, 'H');
    ok(lamp.sampleAt(2e-3).u[kH] > 4, 'lampe allumée au départ');
    ok(lamp.sampleAt(60e-3).u[kH] < 0.05, 'lampe éteinte à la fin');
  });

  test('Valeur critique : R = 2√(L/C) pour le RLC série', () => {
    const s = new Sim(lib('rlc-pseudo'));
    const seg = s.segments[0];
    near(s.criticalValue(seg, compIdx(s, 'R'), 'R'), 200, 1, 'R critique');
    const L = s.criticalValue(seg, compIdx(s, 'L'), 'L');
    near(L, 20 * 20 * 1e-6 / 4, 1e-5, 'L critique pour R = 20 Ω');
    ok(new Sim(lib('rc-charge')).criticalValue(new Sim(lib('rc-charge')).segments[0], 2, 'R') === null, 'pas de valeur critique au premier ordre');
    ok(new Sim(lib('diode-simple')).criticalValue(new Sim(lib('diode-simple')).segments[0], 1, 'R') === null, 'non linéaire : pas de valeur critique');
  });

  test('Schémas équivalents et valeurs à 0⁺ et à l\'infini', () => {
    const s = run(lib('rlc-pseudo'), 1e-4), seg = s.segments[0];
    const idC = s.net.comps[compIdx(s, 'C')].id, idL = s.net.comps[compIdx(s, 'L')].id;
    const zero = s.equivalents(seg, '0');
    ok(zero.get(idC).kind === 'wire', 'C vide à 0⁺ : un fil');
    ok(zero.get(idL).kind === 'open', 'L sans courant à 0⁺ : ouverte');
    const inf = s.equivalents(seg, 'inf');
    ok(inf.get(idC).kind === 'open', 'C à l\'infini : ouvert');
    ok(inf.get(idL).kind === 'wire', 'L à l\'infini : un fil');
    near(s.finalValues(seg).u[compIdx(s, 'C')], 5, 1e-3, 'u_C finale');
    near(s.firstSample(seg).u[compIdx(s, 'E')], 5, 1e-6, 'E à 0⁺');
    // C chargé et courant établi : ils deviennent des sources.
    const d = run(lib('lc-ideal'), 1e-4), z2 = d.equivalents(d.segments[0], '0');
    const eqC = z2.get(d.net.comps[compIdx(d, 'C')].id);
    ok(eqC.kind === 'vsource' && Math.abs(eqC.value - 5) < 1e-3, 'C chargé : source de 5 V');
    // Pas de valeur finale constante en sinusoïdal.
    const ac = run(lib('rc-sinus'), 1e-3);
    ok(ac.equivalents(ac.segments[0], 'inf') === null, 'sinusoïdal : pas de schéma à l\'infini');
    ok(ac.finalValues(ac.segments[0]) === null, 'sinusoïdal : pas de valeur finale');
  });

  test('Lois de Kirchhoff : mailles et nœuds nulles à tout instant', () => {
    const s = run(lib('rlc-pseudo'), 1e-3);
    const x = s.sampleAt(0.7e-3), seg = s.segmentAt(0.7e-3);
    const mesh = s.meshFor(compIdx(s, 'C'), seg);
    ok(mesh && mesh.length === 5, 'maille à 5 dipôles : ' + (mesh && mesh.length));
    near(mesh.reduce((a, t) => a + t.sign * x.u[t.k], 0), 0, 1e-6, 'somme des tensions');
    const p = run(lib('rlc-parallele'), 1e-3), y = p.sampleAt(0.7e-3);
    const n = p.net.comps[compIdx(p, 'R')].a, b = p.nodeBalance(n, y);
    ok(b.terms.length === 4, 'quatre branches au nœud : ' + b.terms.length);
    near(b.sum, 0, 1e-6, 'somme des courants');
    // Autour d'un AOP, la maille traverse la masse, et le nœud de masse reçoit le retour d'alimentation.
    const a = run(lib('aop-inverseur'), 2e-3), z = a.sampleAt(1.3e-3);
    const mE = a.meshFor(compIdx(a, 'Rc'), a.segmentAt(1.3e-3));
    ok(mE === null || mE.length >= 1, 'maille autour de la charge');
    const gNet = a.net.comps[compIdx(a, 'Rc')].b, g = a.nodeBalance(gNet, z);
    ok(g.isGround, 'réseau de masse reconnu');
    ok(new Sim(lib('aop-inverseur')).meshFor(compIdx(a, 'A'), a.segmentAt(1.3e-3)) === null, 'AOP : pas de loi des mailles simple');
  });

  test('AOP sans masse : erreur explicite', () => {
    const d = lib('aop-suiveur');
    d.comps = d.comps.filter((c) => c.type !== 'ground');
    ok(new Sim(d).errors.some((e) => e.includes('masse')), 'erreur attendue');
  });

  // Onglet « Composants » : les formules animées doivent donner les mêmes courbes que le moteur.
  test('Composants : condensateur plan, charge puis décharge', () => {
    const D = RLC.devices;
    const m = D.capacitor({ S: 1e-2, e: 1e-5, er: 3, R: 1e4, E: 10 });
    near(m.C, 8.854e-12 * 3 * 1e-2 / 1e-5, 1e-12, 'C = ε₀εᵣS/e');
    near(m.tau, 1e4 * m.C, 1e-12, 'τ = RC');
    const h = m.history;
    h.change(0, 'charge');
    near(h.at(0).i, 1e-3, 1e-12, 'à 0⁺, le condensateur est un fil : i = E/R');
    near(h.at(0).u, 0, 1e-12, 'u continue à 0⁺');
    near(h.at(m.tau).u, 10 * (1 - Math.exp(-1)), 1e-9, 'u(τ)');
    const T = 3 * m.tau, uT = h.at(T).u;
    h.change(T, 'open');
    near(h.at(T + m.tau).u, uT, 1e-9, 'interrupteur ouvert : la charge reste');
    near(h.at(T + m.tau).i, 0, 1e-15, 'interrupteur ouvert : i = 0');
    const T2 = T + m.tau;
    h.change(T2, 'discharge');
    near(h.at(T2).u, uT, 1e-9, 'u continue à la manœuvre');
    near(h.at(T2).i, -uT / 1e4, 1e-12, 'i s\'inverse à la décharge');
    near(h.at(T2 + m.tau).u, uT * Math.exp(-1), 1e-9, 'u décroît avec τ');
    near(h.at(T2 + 40 * m.tau).flowDis, h.at(T2 + 40 * m.tau).flowGen, 1e-12, 'autant de charge rendue que reçue');
    // Relecture : le passé n'a pas bougé, et une manœuvre dans le passé réécrit le futur.
    near(h.at(m.tau).u, 10 * (1 - Math.exp(-1)), 1e-9, 'relecture du passé');
    h.change(m.tau, 'open');
    near(h.at(T2).u, 10 * (1 - Math.exp(-1)), 1e-9, 'futur réécrit');
    ok(h.tMax === m.tau, 'tMax ramené à la manœuvre');
  });

  test('Composants : solénoïde, le courant continue en roue libre', () => {
    const D = RLC.devices;
    const m = D.inductor({ N: 500, l: 0.05, S: 5e-4, mur: 1, R: 100, E: 10 });
    near(m.L, 4e-7 * Math.PI * 250000 * 5e-4 / 0.05, 1e-9, 'L = µ₀N²S/ℓ');
    near(m.tau, m.L / 100, 1e-12, 'τ = L/R');
    const h = m.history;
    h.change(0, 'charge');
    near(h.at(0).i, 0, 1e-12, 'i continue : bobine ouverte à 0⁺');
    near(h.at(0).u, 10, 1e-9, 'toute la tension aux bornes de L');
    near(h.at(m.tau).i, 0.1 * (1 - Math.exp(-1)), 1e-9, 'i(τ)');
    near(h.at(40 * m.tau).u, 0, 1e-9, 'régime permanent : un fil');
    const T = 2 * m.tau, iT = h.at(T).i;
    h.change(T, 'discharge');
    near(h.at(T).i, iT, 1e-12, 'i continue à la manœuvre');
    near(h.at(T).u, -100 * iT, 1e-9, 'u_L s\'inverse');
    near(h.at(T + m.tau).i, iT * Math.exp(-1), 1e-9, 'i décroît sans changer de signe');
    near(h.at(T + m.tau).energy, m.L * Math.pow(iT * Math.exp(-1), 2) / 2, 1e-12, 'énergie ½Li²');
    // Le flux calculé est bien l'intégrale du courant.
    const a = h.at(T + 0.5 * m.tau), b = h.at(T + 0.5 * m.tau + 1e-3 * m.tau);
    near((b.flowDis - a.flowDis) / (1e-3 * m.tau), (a.i + b.i) / 2, 1e-6, 'd(flux)/dt = i');
  });

  test('Composants : résistance et code des couleurs', () => {
    const D = RLC.devices;
    const m = D.resistor({ material: 'carbone', L: 0.01, S: 3.5e-9, U: 5 });
    near(m.R, 100, 1e-9, 'R = ρL/S');
    const h = m.history;
    near(h.at(1).i, 0, 0, 'ouvert : aucun courant');
    h.change(1, 'charge');
    near(h.at(1).i, 0.05, 1e-12, 'i suit u sans retard');
    near(h.at(1 + 400).dT, D.RTH * 0.25, 1e-6, 'échauffement final : Rth·P');
    near(h.at(1 + D.TAU_TH).dT, D.RTH * 0.25 * (1 - Math.exp(-1)), 1e-9, 'inertie thermique');
    const code = (R) => { const c = D.colorCode(R); return c && [...c.digits, c.mult].join(''); };
    ok(code(100) === '101', '100 Ω : marron, noir, marron');
    ok(code(4700) === '472', '4,7 kΩ : jaune, violet, rouge');
    ok(code(1) === '10-1', '1 Ω : marron, noir, or');
    ok(code(0.47) === '47-2', '0,47 Ω : jaune, violet, argent');
    ok(code(996) === '102', 'arrondi à deux chiffres : 996 Ω → 1,0 kΩ : ' + code(996));
    ok(code(0.01) === null, 'sous 0,1 Ω : pas de code');
  });

  test('Composants : les formules animées coïncident avec le moteur', () => {
    const D = RLC.devices;
    const near1 = (a, b, what) => near(a, b, Math.abs(b) * 0.002 + 1e-9, what);
    const rc = lib('rc-charge');
    const cC = rc.comps.find((c) => c.type === 'capacitor'), cR = rc.comps.find((c) => c.type === 'resistor'), cE = rc.comps.find((c) => c.type === 'vsource');
    const tauC = cR.params.R * cC.params.C;
    const sC = run(rc, 3 * tauC);
    const mC = D.capacitor({ S: cC.params.C, e: D.EPS0, er: 1, R: cR.params.R, E: cE.params.A });
    near1(mC.C, cC.params.C, 'C reconstruit');
    mC.history.change(0, 'charge');
    const iC = compIdx(sC, cC.label);
    for (const k of [0.5, 1, 2]) near1(sC.sampleAt(k * tauC).u[iC], mC.history.at(k * tauC).u, `u(${k}τ) moteur/formule`);
    const rl = lib('rl-etablissement');
    const lL = rl.comps.find((c) => c.type === 'inductor'), lR = rl.comps.find((c) => c.type === 'resistor'), lE = rl.comps.find((c) => c.type === 'vsource');
    const tauL = lL.params.L / lR.params.R;
    const sL = run(rl, 3 * tauL);
    const mL = D.inductor({ N: 1, l: 1, S: lL.params.L / D.MU0, mur: 1, R: lR.params.R, E: lE.params.A });
    mL.history.change(0, 'charge');
    const iL = compIdx(sL, lL.label);
    for (const k of [0.5, 1, 2]) near1(Math.abs(sL.sampleAt(k * tauL).i[iL]), mL.history.at(k * tauL).i, `i(${k}τ) moteur/formule`);
  });

  root.RLC_TEST_RESULTS = results;
})(globalThis);
