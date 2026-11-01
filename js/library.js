// @ts-check
// Bibliothèque de circuits de base, construits avec le même modèle que l'éditeur.
(function (RLC) {
  'use strict';
  const { newDoc, addComp, addWirePath } = RLC.circuit;

  /** Dipôles en série sur le haut d'un rectangle, d'autres sur la droite, retour par le bas. */
  function loop(name, left, top, right) {
    const doc = newDoc(name);
    const x0 = 6, yTop = 4;
    const rightSpan = Math.max(right.length * 6, 8); // pair : le centre reste sur la grille
    const yBot = yTop + rightSpan;
    const yMid = (yTop + yBot) / 2;
    addComp(doc, left.type, x0, yMid, 1, left.params, left.label);
    let x = x0;
    addWirePathTo(doc, [x0, yMid - 2], [x0, yTop]);
    for (const c of top) {
      addWirePathTo(doc, [x, yTop], [x + 1, yTop]);
      addComp(doc, c.type, x + 3, yTop, 0, c.params, c.label);
      x += 5;
    }
    x += 1;
    addWirePathTo(doc, [x - 1, yTop], [x, yTop]);
    let y = yTop;
    const extra = rightSpan - right.length * 4;
    const gap = Math.floor(extra / (right.length + 1));
    right.forEach((c) => {
      const y1 = y + gap;
      addWirePathTo(doc, [x, y], [x, y1]);
      addComp(doc, c.type, x, y1 + 2, 1, c.params, c.label);
      y = y1 + 4;
    });
    addWirePath(doc, [x, y], [x, yBot], [x0, yBot], [x0, yMid + 2]);
    return { doc, x, yBot, x0, yTop };
  }
  const addWirePathTo = (doc, a, b) => { if (a[0] !== b[0] || a[1] !== b[1]) addWirePath(doc, a, b); };

  /** Dipôles côte à côte entre deux rails horizontaux. */
  function rails(name, list) {
    const doc = newDoc(name);
    const yTop = 4, yBot = 12, yMid = 8;
    let x = 6;
    const xs = [];
    for (const c of list) {
      addComp(doc, c.type, x, yMid, 1, c.params, c.label);
      addWirePath(doc, [x, yTop], [x, yMid - 2]);
      addWirePath(doc, [x, yMid + 2], [x, yBot]);
      xs.push(x);
      x += 6;
    }
    addWirePath(doc, [xs[0], yTop], [xs[xs.length - 1], yTop]);
    addWirePath(doc, [xs[0], yBot], [xs[xs.length - 1], yBot]);
    return { doc, xs, yTop, yBot };
  }

  const probeOf = (doc, label, kind) => {
    const c = doc.comps.find((x) => x.label === label);
    if (c) doc.probes.push({ id: c.id, kind });
  };
  const withProbes = (doc, ...list) => {
    for (const [label, kind] of list) probeOf(doc, label, kind);
    return doc;
  };

  const SINE = (A, f, extra = {}) => ({ wave: 'sine', f, A, ...extra });
  const place = (doc, type, x, y, rot, params, label) => addComp(doc, type, x, y, rot, params, label);
  const ground = (doc, x, y) => addComp(doc, 'ground', x, y, 0, {}, 'M');

  /**
   * AOP au centre (16, 8) : entrées en x = 13, sortie en (19, 8), charge Rc en x = 25.
   * @param {boolean} flip e+ en haut si vrai
   * @param {number} yRail hauteur de la ligne de masse
   */
  function ampBase(name, flip, yRail, opParams = {}, xLeft = 6) {
    const doc = newDoc(name);
    place(doc, 'opamp', 16, 8, 0, { flip, ...opParams }, 'A');
    const yRc = yRail - 3;
    place(doc, 'resistor', 25, yRc, 1, { R: 10000 }, 'Rc');
    addWirePath(doc, [19, 8], [25, 8], [25, yRc - 2]);
    addWirePath(doc, [25, yRc + 2], [25, yRail], [xLeft, yRail]);
    ground(doc, 19, yRail);
    return doc;
  }

  /** Générateur d'entrée à gauche (6, 11), borne − sur la ligne de masse. */
  function ampInput(doc, params, yRail, label = 'E') {
    place(doc, 'vsource', 6, 11, 1, params, label);
    addWirePath(doc, [6, 13], [6, yRail]);
  }

  /** Dipôles en parallèle, alimentés par un générateur à travers un ou plusieurs dipôles en série. */
  function feed(name, source, series, branches) {
    const doc = newDoc(name);
    addComp(doc, source.type, 6, 8, 1, source.params, source.label);
    addWirePath(doc, [6, 6], [6, 4], [8, 4]);
    let xs = 8;
    for (const s of Array.isArray(series) ? series : [series]) {
      addComp(doc, s.type, xs + 2, 4, 0, s.params, s.label);
      xs += 4;
      addWirePath(doc, [xs, 4], [xs + 1, 4]);
      xs += 1;
    }
    let x = xs + 1;
    addWirePath(doc, [xs, 4], [x, 4]);
    const xFirst = x;
    for (const b of branches) {
      addComp(doc, b.type, x, 8, b.rot ?? 1, b.params, b.label);
      addWirePath(doc, [x, 4], [x, 6]);
      addWirePath(doc, [x, 10], [x, 12]);
      x += 6;
    }
    addWirePath(doc, [xFirst, 4], [x - 6, 4]);
    addWirePath(doc, [6, 10], [6, 12], [x - 6, 12]);
    return doc;
  }

  const E = (A = 5, extra = {}) => ({ type: 'vsource', label: 'E', params: { A, ...extra } });
  const R = (v, label = 'R') => ({ type: 'resistor', label, params: { R: v } });
  const C = (v, label = 'C', V0 = 0) => ({ type: 'capacitor', label, params: { C: v, V0 } });
  const L = (v, label = 'L', extra = {}) => ({ type: 'inductor', label, params: { L: v, ...extra } });
  const K = (closed = false, label = 'K', extra = {}) => ({ type: 'switch', label, params: { closed, ...extra } });
  const H = (R, Umax, label = 'H') => ({ type: 'lamp', label, params: { R, Umax } });
  const D = (label = 'D', extra = {}, rot = 1) => ({ type: 'diode', label, params: extra, rot });

  /**
   * Chaque entrée se construit à la demande pour rendre un document neuf.
   * @type {{id:string, name:string, theme:string, desc:string, build:()=>any}[]}
   */
  const LIBRARY = [
    {
      id: 'rc-charge', theme: 'Premier ordre', name: 'Charge d\'un condensateur',
      desc: 'Échelon de tension sur un RC. τ = RC ; u_C atteint 63 % de E à t = τ.',
      build: () => withProbes(loop('Charge d\'un condensateur', E(5), [K(true), R(1000)], [C(1e-6)]).doc, ['C', 'u'], ['C', 'i']),
    },
    {
      id: 'rc-decharge', theme: 'Premier ordre', name: 'Décharge d\'un condensateur',
      desc: 'Le condensateur, chargé à 5 V, se décharge dans R à la fermeture de K, à t = 2 ms.',
      build: () => withProbes(loop('Décharge d\'un condensateur', C(1e-6, 'C', 5), [K(false, 'K', { tToggle: 2e-3 })], [R(1000)]).doc, ['C', 'u'], ['R', 'i']),
    },
    {
      id: 'rl-etablissement', theme: 'Premier ordre', name: 'Établissement du courant',
      desc: 'Échelon de tension sur un RL. τ = L/R ; le courant est continu dans la bobine.',
      build: () => withProbes(loop('Établissement du courant dans une bobine', E(5), [K(true), R(100)], [L(10e-3)]).doc, ['L', 'i'], ['L', 'u']),
    },
    {
      id: 'rl-rupture', theme: 'Premier ordre', name: 'Rupture du courant',
      desc: 'K s\'ouvre à t = 1 ms : la bobine se décharge dans la résistance en parallèle, avec une surtension.',
      build: () => {
        const doc = newDoc('Rupture du courant dans une bobine');
        addComp(doc, 'vsource', 6, 8, 1, { A: 5 }, 'E');
        addComp(doc, 'switch', 10, 4, 0, { closed: true, tToggle: 1e-3 }, 'K');
        addComp(doc, 'resistor', 16, 4, 0, { R: 100 }, 'R');
        addComp(doc, 'resistor', 22, 8, 1, { R: 1000 }, 'Rp');
        addComp(doc, 'inductor', 28, 8, 1, { L: 100e-3 }, 'L');
        addWirePath(doc, [6, 6], [6, 4], [8, 4]);
        addWirePath(doc, [12, 4], [14, 4]);
        addWirePath(doc, [18, 4], [28, 4], [28, 6]);
        addWirePath(doc, [22, 4], [22, 6]);
        addWirePath(doc, [6, 10], [6, 12], [28, 12], [28, 10]);
        addWirePath(doc, [22, 10], [22, 12]);
        return withProbes(doc, ['L', 'i'], ['L', 'u']);
      },
    },
    {
      id: 'lc-ideal', theme: 'Second ordre', name: 'Oscillateur LC idéal',
      desc: 'Sans résistance, l\'énergie passe du condensateur à la bobine. Pas de régime permanent.',
      build: () => withProbes(loop('Oscillateur LC idéal', C(1e-6, 'C', 5), [K(true)], [L(10e-3)]).doc, ['C', 'u'], ['L', 'i']),
    },
    {
      id: 'rlc-pseudo', theme: 'Second ordre', name: 'RLC série pseudo-périodique',
      desc: 'Échelon de tension avec Q = 5 : oscillations amorties autour de E.',
      build: () => withProbes(loop('RLC série pseudo-périodique', E(5), [K(true), R(20), L(10e-3)], [C(1e-6)]).doc, ['C', 'u'], ['L', 'i']),
    },
    {
      id: 'rlc-critique', theme: 'Second ordre', name: 'RLC série critique',
      desc: 'R = 2√(L/C) : Q = 1/2, retour le plus rapide sans dépassement.',
      build: () => withProbes(loop('RLC série critique', E(5), [K(true), R(200), L(10e-3)], [C(1e-6)]).doc, ['C', 'u'], ['L', 'i']),
    },
    {
      id: 'rlc-aperiodique', theme: 'Second ordre', name: 'RLC série apériodique',
      desc: 'R grand devant 2√(L/C) : deux constantes de temps réelles, aucune oscillation.',
      build: () => withProbes(loop('RLC série apériodique', E(5), [K(true), R(1000), L(10e-3)], [C(1e-6)]).doc, ['C', 'u'], ['L', 'i']),
    },
    {
      id: 'rlc-parallele', theme: 'Second ordre', name: 'RLC parallèle en courant',
      desc: 'Un générateur de courant alimente R, L et C en parallèle.',
      build: () => withProbes(rails('RLC parallèle', [
        { type: 'isource', label: 'I', params: { A: 10e-3 } }, R(500), L(10e-3), C(1e-6),
      ]).doc, ['C', 'u'], ['L', 'i']),
    },
    {
      id: 'rlc-resonance', theme: 'Régime sinusoïdal', name: 'Résonance en intensité',
      desc: 'Générateur à f₀ ≈ 1,59 kHz : le courant atteint E/R après un long transitoire.',
      build: () => withProbes(loop('Résonance en intensité d\'un RLC série', E(1, { wave: 'sine', f: 1592 }), [R(20), L(10e-3)], [C(1e-6)]).doc, ['R', 'i'], ['C', 'u']),
    },
    {
      id: 'rc-sinus', theme: 'Régime sinusoïdal', name: 'Filtre RC passe-bas',
      desc: 'À f = f_c, u_C est atténuée de √2 et déphasée de −45° en régime permanent.',
      build: () => withProbes(loop('Filtre RC passe-bas', E(1, { wave: 'sine', f: 159.15 }), [R(1000)], [C(1e-6)]).doc, ['E', 'u'], ['C', 'u']),
    },
    {
      id: 'rc-creneaux', theme: 'Régime périodique', name: 'RC en créneaux',
      desc: 'Charges et décharges successives, jusqu\'au régime périodique établi.',
      build: () => withProbes(loop('RC alimenté en créneaux', E(5, { wave: 'square', f: 500 }), [R(1000)], [C(1e-6)]).doc, ['C', 'u'], ['R', 'i']),
    },
    {
      id: 'rlc-creneaux', theme: 'Régime périodique', name: 'RLC en créneaux',
      desc: 'Réponse du second ordre aux fronts d\'un signal carré : la sonnerie se répète.',
      build: () => withProbes(loop('RLC série en créneaux', E(5, { wave: 'square', f: 200 }), [R(30), L(10e-3)], [C(1e-6)]).doc, ['C', 'u']),
    },
    {
      id: 'diviseur', theme: 'Régime stationnaire', name: 'Pont diviseur de tension',
      desc: 'Aucun élément réactif : le régime permanent est atteint immédiatement.',
      build: () => withProbes(loop('Pont diviseur de tension', E(10), [], [R(1000, 'R1'), R(3000, 'R2')]).doc, ['R2', 'u'], ['R1', 'i']),
    },
    {
      id: 'partage-charge', theme: 'Régime stationnaire', name: 'Partage de charge',
      desc: 'C₁ chargé se vide dans C₂ : la charge se conserve mais pas l\'énergie, dissipée dans R.',
      build: () => withProbes(loop('Partage de charge entre deux condensateurs', C(1e-6, 'C1', 10), [K(false, 'K', { tToggle: 1e-3 }), R(100)], [C(1e-6, 'C2')]).doc, ['C1', 'u'], ['C2', 'u']),
    },
    {
      id: 'diode-simple', theme: 'Diode', name: 'Redressement simple alternance',
      desc: 'La diode ne laisse passer que les alternances positives, moins sa tension de seuil.',
      build: () => withProbes(loop('Redressement simple alternance', E(10, { wave: 'sine', f: 50 }), [D()], [R(1000)]).doc, ['E', 'u'], ['R', 'u']),
    },
    {
      id: 'diode-graetz', theme: 'Diode', name: 'Pont de Graetz',
      desc: 'Redressement double alternance : deux diodes conduisent à chaque alternance, d\'où deux seuils perdus.',
      build: () => {
        const doc = newDoc('Pont de Graetz');
        place(doc, 'vsource', 15, 11, 0, SINE(10, 50), 'E');
        place(doc, 'diode', 10, 5, 3, {}, 'D1');
        place(doc, 'diode', 20, 5, 3, {}, 'D2');
        place(doc, 'diode', 10, 17, 3, {}, 'D3');
        place(doc, 'diode', 20, 17, 3, {}, 'D4');
        place(doc, 'resistor', 27, 11, 1, { R: 1000 }, 'R');
        addWirePath(doc, [10, 7], [10, 15]);
        addWirePath(doc, [20, 7], [20, 15]);
        addWirePath(doc, [10, 11], [13, 11]);
        addWirePath(doc, [17, 11], [20, 11]);
        addWirePath(doc, [10, 3], [10, 1], [27, 1], [27, 9]);
        addWirePath(doc, [20, 3], [20, 1]);
        addWirePath(doc, [10, 19], [10, 21], [27, 21], [27, 13]);
        addWirePath(doc, [20, 19], [20, 21]);
        return withProbes(doc, ['E', 'u'], ['R', 'u']);
      },
    },
    {
      id: 'diode-crete', theme: 'Diode', name: 'Détecteur de crête',
      desc: 'Le condensateur se charge à la crête, puis se décharge lentement dans R : une tension presque continue.',
      build: () => withProbes(feed('Détecteur de crête', E(10, { wave: 'sine', f: 50 }), D(), [C(100e-6), R(1000)]), ['E', 'u'], ['C', 'u']),
    },
    {
      id: 'diode-ecreteur', theme: 'Diode', name: 'Écrêteur à deux diodes',
      desc: 'Deux diodes tête-bêche limitent la tension de sortie à ± Vd.',
      build: () => withProbes(feed('Écrêteur à deux diodes', E(5, { wave: 'sine', f: 100 }), R(1000), [D('D1'), D('D2', {}, 3)]), ['E', 'u'], ['D1', 'u']),
    },
    {
      id: 'diode-zener', theme: 'Diode', name: 'Stabilisation par diode Zener',
      desc: 'La tension de sortie reste voisine de Vz malgré l\'ondulation de l\'alimentation.',
      build: () => withProbes(feed('Stabilisation par diode Zener', E(3, { wave: 'sine', f: 100, off: 12 }), R(220, 'Rs'), [D('Dz', { Vz: 5.1 }, 3), R(1000, 'Rc')]), ['E', 'u'], ['Rc', 'u']),
    },
    {
      id: 'diode-roue-libre', theme: 'Diode', name: 'Diode de roue libre',
      desc: 'À l\'ouverture de K, le courant de la bobine continue dans la diode : plus de surtension destructrice.',
      build: () => withProbes(feed('Diode de roue libre', E(12), K(true, 'K', { tToggle: 10e-3 }), [D('D', {}, 3), L(100e-3, 'L', { r: 50 })]), ['L', 'i'], ['L', 'u']),
    },
    {
      id: 'aop-suiveur', theme: 'AOP en régime linéaire', name: 'Montage suiveur',
      desc: 'u_s = u_e : la sortie recopie l\'entrée, sans lui prendre de courant.',
      build: () => {
        const doc = ampBase('Montage suiveur', false, 13);
        ampInput(doc, SINE(1, 1000), 13);
        addWirePath(doc, [6, 9], [13, 9]);
        addWirePath(doc, [21, 8], [21, 4], [11, 4], [11, 7], [13, 7]);
        return withProbes(doc, ['E', 'u'], ['A', 'u']);
      },
    },
    {
      id: 'aop-inverseur', theme: 'AOP en régime linéaire', name: 'Amplificateur inverseur',
      desc: 'u_s = −(R₂/R₁) u_e, ici un gain de −10.',
      build: () => {
        const doc = ampBase('Amplificateur inverseur', false, 13);
        ampInput(doc, SINE(1, 1000), 13);
        place(doc, 'resistor', 9, 7, 0, { R: 1000 }, 'R1');
        place(doc, 'resistor', 16, 3, 0, { R: 10000 }, 'R2');
        addWirePath(doc, [6, 9], [6, 7], [7, 7]);
        addWirePath(doc, [11, 7], [13, 7]);
        addWirePath(doc, [12, 7], [12, 3], [14, 3]);
        addWirePath(doc, [18, 3], [21, 3], [21, 8]);
        addWirePath(doc, [13, 9], [13, 13]);
        return withProbes(doc, ['E', 'u'], ['A', 'u']);
      },
    },
    {
      id: 'aop-non-inverseur', theme: 'AOP en régime linéaire', name: 'Amplificateur non inverseur',
      desc: 'u_s = (1 + R₂/R₁) u_e, ici un gain de 3.',
      build: () => {
        const doc = ampBase('Amplificateur non inverseur', true, 18);
        ampInput(doc, SINE(1, 1000), 18);
        place(doc, 'resistor', 16, 12, 0, { R: 2000 }, 'R2');
        place(doc, 'resistor', 13, 15, 1, { R: 1000 }, 'R1');
        addWirePath(doc, [6, 9], [6, 7], [13, 7]);
        addWirePath(doc, [13, 9], [13, 13]);
        addWirePath(doc, [13, 12], [14, 12]);
        addWirePath(doc, [18, 12], [21, 12], [21, 8]);
        addWirePath(doc, [13, 17], [13, 18]);
        return withProbes(doc, ['E', 'u'], ['A', 'u']);
      },
    },
    {
      id: 'aop-integrateur', theme: 'AOP en régime linéaire', name: 'Intégrateur',
      desc: 'Des créneaux en entrée donnent un triangle en sortie. La résistance Rf évite la dérive vers la saturation.',
      build: () => {
        const doc = ampBase('Intégrateur inverseur', false, 13);
        ampInput(doc, { wave: 'square', f: 500, A: 1 }, 13);
        place(doc, 'resistor', 9, 7, 0, { R: 10000 }, 'R');
        place(doc, 'capacitor', 16, 3, 0, { C: 100e-9 }, 'C');
        place(doc, 'resistor', 16, -1, 0, { R: 100000 }, 'Rf');
        addWirePath(doc, [6, 9], [6, 7], [7, 7]);
        addWirePath(doc, [11, 7], [13, 7]);
        addWirePath(doc, [12, 7], [12, -1], [14, -1]);
        addWirePath(doc, [12, 3], [14, 3]);
        addWirePath(doc, [18, -1], [21, -1], [21, 8]);
        addWirePath(doc, [18, 3], [21, 3]);
        addWirePath(doc, [13, 9], [13, 13]);
        return withProbes(doc, ['E', 'u'], ['A', 'u']);
      },
    },
    {
      id: 'aop-comparateur', theme: 'AOP en commutation', name: 'Comparateur simple',
      desc: 'Sans contre-réaction, la sortie sature à ± Vsat selon le signe de u_e − U_ref.',
      build: () => {
        const doc = ampBase('Comparateur simple', true, 13);
        ampInput(doc, SINE(5, 1000), 13);
        place(doc, 'vsource', 12, 11, 1, { A: 2 }, 'Uref');
        addWirePath(doc, [6, 9], [6, 7], [13, 7]);
        addWirePath(doc, [13, 9], [12, 9]);
        return withProbes(doc, ['E', 'u'], ['A', 'u']);
      },
    },
    {
      id: 'aop-schmitt', theme: 'AOP en commutation', name: 'Comparateur à hystérésis',
      desc: 'Bascule de Schmitt inverseuse : les seuils valent ± Vsat·R₁/(R₁+R₂), soit ± 5 V.',
      build: () => {
        const doc = ampBase('Comparateur à hystérésis', false, 18, { x0: 15 });
        ampInput(doc, SINE(10, 200), 18);
        place(doc, 'resistor', 16, 12, 0, { R: 20000 }, 'R2');
        place(doc, 'resistor', 13, 15, 1, { R: 10000 }, 'R1');
        addWirePath(doc, [6, 9], [6, 7], [13, 7]);
        addWirePath(doc, [13, 9], [13, 13]);
        addWirePath(doc, [13, 12], [14, 12]);
        addWirePath(doc, [18, 12], [21, 12], [21, 8]);
        addWirePath(doc, [13, 17], [13, 18]);
        return withProbes(doc, ['E', 'u'], ['A', 'u']);
      },
    },
    {
      id: 'aop-astable', theme: 'AOP en commutation', name: 'Multivibrateur astable',
      desc: 'Oscillateur de relaxation : C se charge et se décharge entre les seuils. T = 2RC ln 3 ≈ 2,2 ms.',
      build: () => {
        const doc = ampBase('Multivibrateur astable', false, 18, { x0: 15 }, 9);
        place(doc, 'resistor', 16, 3, 0, { R: 10000 }, 'R');
        place(doc, 'capacitor', 9, 11, 1, { C: 100e-9 }, 'C');
        place(doc, 'resistor', 16, 12, 0, { R: 10000 }, 'R2');
        place(doc, 'resistor', 13, 15, 1, { R: 10000 }, 'R1');
        addWirePath(doc, [13, 7], [9, 7], [9, 9]);
        addWirePath(doc, [9, 13], [9, 18]);
        addWirePath(doc, [12, 7], [12, 3], [14, 3]);
        addWirePath(doc, [18, 3], [21, 3], [21, 8]);
        addWirePath(doc, [13, 9], [13, 13]);
        addWirePath(doc, [13, 12], [14, 12]);
        addWirePath(doc, [18, 12], [21, 12], [21, 8]);
        addWirePath(doc, [13, 17], [13, 18]);
        return withProbes(doc, ['C', 'u'], ['A', 'u']);
      },
    },
    {
      id: 'aop-wien', theme: 'AOP en commutation', name: 'Oscillateur à pont de Wien',
      desc: 'Gain légèrement supérieur à 3 : l\'oscillation démarre et sa saturation fixe l\'amplitude, à f ≈ 1/(2πRC).',
      build: () => {
        const doc = ampBase('Oscillateur à pont de Wien', true, 18, { x0: 1 });
        place(doc, 'capacitor', 18, 3, 0, { C: 10e-9 }, 'Cs');
        place(doc, 'resistor', 13, 3, 0, { R: 10000 }, 'Rs');
        place(doc, 'resistor', 8, 11, 1, { R: 10000 }, 'Rp');
        place(doc, 'capacitor', 4, 11, 1, { C: 10e-9 }, 'Cp');
        place(doc, 'resistor', 16, 12, 0, { R: 22000 }, 'R2');
        place(doc, 'resistor', 13, 15, 1, { R: 10000 }, 'R1');
        addWirePath(doc, [21, 8], [21, 3], [20, 3]);
        addWirePath(doc, [16, 3], [15, 3]);
        addWirePath(doc, [11, 3], [11, 7], [13, 7]);
        addWirePath(doc, [11, 7], [4, 7], [4, 9]);
        addWirePath(doc, [8, 7], [8, 9]);
        addWirePath(doc, [8, 13], [8, 18]);
        addWirePath(doc, [4, 13], [4, 18], [6, 18]);
        addWirePath(doc, [13, 9], [13, 13]);
        addWirePath(doc, [13, 12], [14, 12]);
        addWirePath(doc, [18, 12], [21, 12], [21, 8]);
        addWirePath(doc, [13, 17], [13, 18]);
        return withProbes(doc, ['A', 'u'], ['Cp', 'u']);
      },
    },
    {
      id: 'aop-precision', theme: 'AOP et diode', name: 'Redresseur de précision',
      desc: 'La diode est dans la boucle de l\'AOP : son seuil est compensé et même un signal faible est redressé.',
      build: () => {
        const doc = newDoc('Redresseur de précision');
        place(doc, 'opamp', 16, 8, 0, { flip: true }, 'A');
        place(doc, 'diode', 22, 8, 0, {}, 'D');
        place(doc, 'resistor', 25, 13, 1, { R: 10000 }, 'Rc');
        ampInput(doc, SINE(1, 100), 17);
        ground(doc, 19, 17);
        addWirePath(doc, [6, 9], [6, 7], [13, 7]);
        addWirePath(doc, [19, 8], [20, 8]);
        addWirePath(doc, [24, 8], [25, 8], [25, 11]);
        addWirePath(doc, [13, 9], [13, 11], [24, 11], [24, 8]);
        addWirePath(doc, [25, 15], [25, 17], [6, 17]);
        return withProbes(doc, ['E', 'u'], ['Rc', 'u']);
      },
    },
    {
      id: 'chargeur-telephone', theme: 'Applications', name: 'Chargeur de téléphone',
      desc: 'Modèle à transformateur 50 Hz, remplacé par son équivalent vu du secondaire (m = 1/30), puis pont de Graetz, filtrage et régulation à 5 V.',
      build: () => {
        const doc = newDoc('Chargeur de téléphone');
        const fast = { Rd: 0.05 }; // diodes de redressement : les pointes de courant atteignent plusieurs ampères
        // Secondaire vu comme une source : 230 V efficaces × √2 × m, fuites L et enroulements r.
        place(doc, 'vsource', 12, 11, 0, SINE(10.84, 50), 'E');
        place(doc, 'inductor', 18, 11, 0, { L: 2e-3, r: 0.5 }, 'L');
        place(doc, 'diode', 8, 8, 3, fast, 'D1');
        place(doc, 'diode', 22, 8, 3, fast, 'D2');
        place(doc, 'diode', 8, 14, 3, fast, 'D3');
        place(doc, 'diode', 22, 14, 3, fast, 'D4');
        place(doc, 'capacitor', 27, 11, 1, { C: 4700e-6 }, 'C');
        place(doc, 'resistor', 32, 4, 0, { R: 4.7 }, 'Rs');
        place(doc, 'diode', 37, 11, 3, { Vz: 5.1, Rd: 0.1 }, 'Dz');
        place(doc, 'resistor', 43, 11, 1, { R: 10 }, 'Rc');
        addWirePath(doc, [8, 10], [8, 12]);
        addWirePath(doc, [22, 10], [22, 12]);
        addWirePath(doc, [8, 11], [10, 11]);
        addWirePath(doc, [14, 11], [16, 11]);
        addWirePath(doc, [20, 11], [22, 11]);
        addWirePath(doc, [8, 6], [8, 4], [30, 4]);
        addWirePath(doc, [22, 4], [22, 6]);
        addWirePath(doc, [27, 4], [27, 9]);
        addWirePath(doc, [34, 4], [43, 4], [43, 9]);
        addWirePath(doc, [37, 4], [37, 9]);
        addWirePath(doc, [8, 16], [8, 18], [43, 18], [43, 13]);
        addWirePath(doc, [22, 16], [22, 18]);
        addWirePath(doc, [27, 13], [27, 18]);
        addWirePath(doc, [37, 13], [37, 18]);
        ground(doc, 32, 18);
        return withProbes(doc, ['E', 'u'], ['C', 'u'], ['Rc', 'u']);
      },
    },
    {
      id: 'app-minuterie', theme: 'Applications', name: 'Minuterie d\'escalier',
      desc: 'K s\'ouvre à 0,5 s : le condensateur entretient la lampe, qui s\'éteint doucement avec τ = RC ≈ 1 s.',
      build: () => withProbes(feed('Minuterie d\'escalier', E(12), [K(true, 'K', { tToggle: 0.5 }), R(10, 'Rc')], [C(1000e-6), H(1000, 12)]), ['H', 'u']),
    },
    {
      id: 'app-flash', theme: 'Applications', name: 'Flash d\'appareil photo',
      desc: 'C se charge lentement à travers R, puis K libère d\'un coup son énergie dans la lampe.',
      build: () => {
        const doc = newDoc('Flash d\'appareil photo');
        place(doc, 'vsource', 6, 8, 1, { A: 9 }, 'E');
        place(doc, 'resistor', 10, 4, 0, { R: 100 }, 'R');
        place(doc, 'capacitor', 14, 8, 1, { C: 1000e-6 }, 'C');
        place(doc, 'switch', 18, 4, 0, { closed: false, tToggle: 0.5 }, 'K');
        place(doc, 'lamp', 22, 8, 1, { R: 10, Umax: 9 }, 'H');
        addWirePath(doc, [6, 6], [6, 4], [8, 4]);
        addWirePath(doc, [12, 4], [16, 4]);
        addWirePath(doc, [14, 4], [14, 6]);
        addWirePath(doc, [20, 4], [22, 4], [22, 6]);
        addWirePath(doc, [6, 10], [6, 12], [22, 12], [22, 10]);
        addWirePath(doc, [14, 10], [14, 12]);
        return withProbes(doc, ['C', 'u'], ['H', 'u']);
      },
    },
    {
      id: 'app-clignotant', theme: 'Applications', name: 'Clignotant',
      desc: 'Un astable commande la lampe à travers une diode : elle ne s\'allume que lorsque la sortie est positive. T ≈ 2,2 s.',
      build: () => {
        const doc = newDoc('Clignotant');
        place(doc, 'opamp', 16, 8, 0, { x0: 15 }, 'A');
        place(doc, 'resistor', 16, 3, 0, { R: 100000 }, 'R');
        place(doc, 'capacitor', 9, 11, 1, { C: 10e-6 }, 'C');
        place(doc, 'resistor', 16, 12, 0, { R: 10000 }, 'R2');
        place(doc, 'resistor', 13, 15, 1, { R: 10000 }, 'R1');
        place(doc, 'diode', 23, 8, 0, {}, 'D');
        place(doc, 'lamp', 25, 13, 1, { R: 100, Umax: 14 }, 'H');
        ground(doc, 19, 18);
        addWirePath(doc, [13, 7], [9, 7], [9, 9]);
        addWirePath(doc, [9, 13], [9, 18], [25, 18], [25, 15]);
        addWirePath(doc, [12, 7], [12, 3], [14, 3]);
        addWirePath(doc, [18, 3], [21, 3], [21, 8]);
        addWirePath(doc, [19, 8], [21, 8]);
        addWirePath(doc, [13, 9], [13, 13]);
        addWirePath(doc, [13, 12], [14, 12]);
        addWirePath(doc, [18, 12], [21, 12], [21, 8]);
        addWirePath(doc, [13, 17], [13, 18]);
        addWirePath(doc, [25, 8], [25, 11]);
        return withProbes(doc, ['A', 'u'], ['H', 'u']);
      },
    },
    {
      id: 'app-defibrillateur', theme: 'Applications', name: 'Défibrillateur',
      desc: 'Décharge d\'un condensateur de 5 kV dans le thorax (50 Ω) à travers une bobine qui adoucit le choc : un RLC série, Q ≈ 0,7.',
      build: () => withProbes(loop('Défibrillateur', C(32e-6, 'C', 5000), [K(false, 'K', { tToggle: 1e-3 }), L(40e-3)], [R(50, 'Thorax')]).doc, ['Thorax', 'i'], ['C', 'u']),
    },
    {
      id: 'app-allumage', theme: 'Applications', name: 'Allumage d\'une voiture',
      desc: 'Une batterie de 12 V, une coupure brutale : la bobine et le condensateur produisent plusieurs centaines de volts au primaire.',
      build: () => {
        const doc = newDoc('Allumage d\'une voiture');
        place(doc, 'vsource', 6, 8, 1, { A: 12 }, 'E');
        place(doc, 'switch', 10, 4, 0, { closed: true, tToggle: 15e-3 }, 'K');
        place(doc, 'capacitor', 10, 0, 0, { C: 0.22e-6 }, 'C');
        place(doc, 'inductor', 18, 8, 1, { L: 8e-3, r: 4 }, 'L');
        addWirePath(doc, [6, 6], [6, 4], [8, 4], [8, 0]);
        addWirePath(doc, [12, 0], [12, 4]);
        addWirePath(doc, [12, 4], [18, 4], [18, 6]);
        addWirePath(doc, [18, 10], [18, 12], [6, 12], [6, 10]);
        return withProbes(doc, ['L', 'i'], ['L', 'u']);
      },
    },
    {
      id: 'app-enceinte', theme: 'Applications', name: 'Enceinte à deux voies',
      desc: 'Une bobine envoie les graves au boomer, un condensateur envoie les aigus au tweeter. Coupure vers 1 kHz.',
      build: () => {
        const doc = newDoc('Enceinte à deux voies');
        place(doc, 'vsource', 6, 6, 1, SINE(1, 100), 'Grave');
        place(doc, 'vsource', 6, 12, 1, SINE(1, 5000), 'Aigu');
        place(doc, 'inductor', 14, 6, 1, { L: 1.3e-3 }, 'L');
        place(doc, 'resistor', 14, 12, 1, { R: 8 }, 'Boomer');
        place(doc, 'capacitor', 22, 6, 1, { C: 20e-6 }, 'C');
        place(doc, 'resistor', 22, 12, 1, { R: 8 }, 'Tweeter');
        addWirePath(doc, [6, 8], [6, 10]);
        addWirePath(doc, [14, 8], [14, 10]);
        addWirePath(doc, [22, 8], [22, 10]);
        addWirePath(doc, [6, 4], [6, 2], [22, 2], [22, 4]);
        addWirePath(doc, [14, 2], [14, 4]);
        addWirePath(doc, [6, 14], [6, 16], [22, 16], [22, 14]);
        addWirePath(doc, [14, 14], [14, 16]);
        return withProbes(doc, ['Boomer', 'u'], ['Tweeter', 'u']);
      },
    },
    {
      id: 'app-radio-accord', theme: 'Applications', name: 'Accord d\'une radio',
      desc: 'Deux stations émettent en même temps. Le RLC résonne sur f₀ ≈ 1,59 kHz : seule la station A reste aux bornes de R.',
      build: () => {
        const doc = newDoc('Accord d\'une radio');
        place(doc, 'vsource', 6, 6, 1, SINE(1, 1592), 'A');
        place(doc, 'vsource', 6, 12, 1, SINE(1, 5000), 'B');
        place(doc, 'inductor', 10, 2, 0, { L: 10e-3 }, 'L');
        place(doc, 'capacitor', 15, 2, 0, { C: 1e-6 }, 'C');
        place(doc, 'resistor', 22, 9, 1, { R: 10 }, 'R');
        addWirePath(doc, [6, 8], [6, 10]);
        addWirePath(doc, [6, 4], [6, 2], [8, 2]);
        addWirePath(doc, [12, 2], [13, 2]);
        addWirePath(doc, [17, 2], [22, 2], [22, 7]);
        addWirePath(doc, [22, 11], [22, 16], [6, 16], [6, 14]);
        return withProbes(doc, ['A', 'u'], ['B', 'u'], ['R', 'u']);
      },
    },
    {
      id: 'app-radio-am', theme: 'Applications', name: 'Démodulation d\'une radio AM',
      desc: 'Porteuse et bandes latérales forment un signal modulé. Une diode et un RC en extraient l\'enveloppe, le message à 1 kHz.',
      build: () => {
        const doc = newDoc('Démodulation d\'une radio AM');
        place(doc, 'vsource', 6, 4, 1, SINE(5, 10000), 'P');
        place(doc, 'vsource', 6, 10, 1, SINE(1.25, 9000), 'B1');
        place(doc, 'vsource', 6, 16, 1, SINE(1.25, 11000), 'B2');
        place(doc, 'voltmeter', 1, 10, 1, {}, 'Antenne');
        place(doc, 'diode', 10, 0, 0, {}, 'D');
        place(doc, 'capacitor', 16, 10, 1, { C: 30e-9 }, 'C');
        place(doc, 'resistor', 22, 10, 1, { R: 10000 }, 'R');
        addWirePath(doc, [6, 6], [6, 8]);
        addWirePath(doc, [6, 12], [6, 14]);
        addWirePath(doc, [6, 2], [6, 0], [8, 0]);
        addWirePath(doc, [6, 0], [1, 0], [1, 8]);
        addWirePath(doc, [12, 0], [22, 0], [22, 8]);
        addWirePath(doc, [16, 0], [16, 8]);
        addWirePath(doc, [6, 18], [6, 20], [22, 20], [22, 12]);
        addWirePath(doc, [16, 12], [16, 20]);
        addWirePath(doc, [6, 20], [1, 20], [1, 12]);
        return withProbes(doc, ['Antenne', 'u'], ['C', 'u']);
      },
    },
    {
      id: 'app-mixage', theme: 'Applications', name: 'Table de mixage',
      desc: 'Sommateur inverseur : u_s = −Rf (e₁/R₁ + e₂/R₂). Deux signaux se mélangent sans se perturber, grâce à la masse virtuelle.',
      build: () => {
        const doc = ampBase('Table de mixage', false, 13);
        ampInput(doc, SINE(1, 100), 13, 'Micro');
        place(doc, 'vsource', 1, 11, 1, SINE(0.5, 1000), 'Guitare');
        place(doc, 'resistor', 9, 7, 0, { R: 10000 }, 'R1');
        place(doc, 'resistor', 9, 4, 0, { R: 10000 }, 'R2');
        place(doc, 'resistor', 16, 1, 0, { R: 20000 }, 'Rf');
        addWirePath(doc, [6, 9], [6, 7], [7, 7]);
        addWirePath(doc, [1, 9], [1, 4], [7, 4]);
        addWirePath(doc, [1, 13], [6, 13]);
        addWirePath(doc, [11, 7], [13, 7]);
        addWirePath(doc, [11, 4], [12, 4]);
        addWirePath(doc, [12, 7], [12, 1], [14, 1]);
        addWirePath(doc, [18, 1], [21, 1], [21, 8]);
        addWirePath(doc, [13, 9], [13, 13]);
        return withProbes(doc, ['Micro', 'u'], ['Guitare', 'u'], ['A', 'u']);
      },
    },
    {
      id: 'app-jauge', theme: 'Applications', name: 'Jauge de contrainte',
      desc: 'Pont de Wheatstone : une jauge allongée de 1 % déséquilibre le pont, et le voltmètre lit quelques dizaines de millivolts.',
      build: () => {
        const doc = newDoc('Jauge de contrainte');
        place(doc, 'vsource', 6, 9, 1, { A: 10 }, 'E');
        place(doc, 'resistor', 14, 6, 1, { R: 1000 }, 'R1');
        place(doc, 'resistor', 14, 12, 1, { R: 1000 }, 'R2');
        place(doc, 'resistor', 24, 6, 1, { R: 1000 }, 'R3');
        place(doc, 'resistor', 24, 12, 1, { R: 1010 }, 'Jauge');
        place(doc, 'voltmeter', 19, 9, 0, {}, 'V');
        addWirePath(doc, [14, 8], [14, 10]);
        addWirePath(doc, [24, 8], [24, 10]);
        addWirePath(doc, [14, 9], [17, 9]);
        addWirePath(doc, [21, 9], [24, 9]);
        addWirePath(doc, [6, 7], [6, 2], [24, 2], [24, 4]);
        addWirePath(doc, [14, 2], [14, 4]);
        addWirePath(doc, [6, 11], [6, 16], [24, 16], [24, 14]);
        addWirePath(doc, [14, 14], [14, 16]);
        return withProbes(doc, ['V', 'u']);
      },
    },
    {
      id: 'err-diode-envers', theme: 'Erreurs classiques', name: 'Diode à l\'envers',
      desc: 'Le redresseur fonctionne… mais donne une tension négative. Que s\'est-il passé ?',
      build: () => {
        const doc = loop('Diode à l\'envers', E(10, { wave: 'sine', f: 50 }), [D()], [R(1000)]).doc;
        doc.comps.find((c) => c.label === 'D').rot = 2;
        return withProbes(doc, ['E', 'u'], ['R', 'u']);
      },
    },
    {
      id: 'err-sans-contre-reaction', theme: 'Erreurs classiques', name: 'AOP sans contre-réaction',
      desc: 'On a oublié R₂ dans l\'inverseur : pourquoi la sortie ne vaut-elle pas −10 u_e ?',
      build: () => {
        const doc = ampBase('AOP sans contre-réaction', false, 13);
        ampInput(doc, SINE(1, 1000), 13);
        place(doc, 'resistor', 9, 7, 0, { R: 1000 }, 'R1');
        addWirePath(doc, [6, 9], [6, 7], [7, 7]);
        addWirePath(doc, [11, 7], [13, 7]);
        addWirePath(doc, [13, 9], [13, 13]);
        return withProbes(doc, ['E', 'u'], ['A', 'u']);
      },
    },
    {
      id: 'err-entrees-inversees', theme: 'Erreurs classiques', name: 'Entrées de l\'AOP inversées',
      desc: 'L\'inverseur avec e+ et e− échangées : le calcul donne le même résultat, le montage non. Pourquoi ?',
      build: () => {
        const doc = ampBase('Entrées de l\'AOP inversées', true, 13, { x0: 1 });
        ampInput(doc, SINE(1, 1000), 13);
        place(doc, 'resistor', 9, 7, 0, { R: 1000 }, 'R1');
        place(doc, 'resistor', 16, 3, 0, { R: 10000 }, 'R2');
        addWirePath(doc, [6, 9], [6, 7], [7, 7]);
        addWirePath(doc, [11, 7], [13, 7]);
        addWirePath(doc, [12, 7], [12, 3], [14, 3]);
        addWirePath(doc, [18, 3], [21, 3], [21, 8]);
        addWirePath(doc, [13, 9], [13, 13]);
        return withProbes(doc, ['E', 'u'], ['A', 'u']);
      },
    },
    {
      id: 'err-coupure-bobine', theme: 'Erreurs classiques', name: 'Bobine coupée sans protection',
      desc: 'K s\'ouvre alors qu\'un courant traverse la bobine, sans chemin de décharge. Observez la tension.',
      build: () => withProbes(loop('Bobine coupée sans protection', E(5), [K(true, 'K', { tToggle: 2e-3 }), R(100)], [L(100e-3)]).doc, ['L', 'i'], ['L', 'u']),
    },
    {
      id: 'err-condensateur-continu', theme: 'Erreurs classiques', name: 'Condensateur en continu',
      desc: 'Une lampe en série avec un condensateur, sur une pile : elle s\'allume, puis s\'éteint. Pourquoi ?',
      build: () => withProbes(loop('Condensateur en continu', E(5), [C(100e-6)], [H(100, 5)]).doc, ['H', 'u'], ['C', 'u']),
    },
    {
      id: 'err-court-circuit', theme: 'Erreurs classiques', name: 'Générateur en court-circuit',
      desc: 'Un fil relie les deux bornes du générateur : la simulation refuse de démarrer. Lisez son message.',
      expectError: true,
      build: () => {
        const r = loop('Générateur en court-circuit', E(5), [], [R(100)]);
        addWirePath(r.doc, [3, 4], [3, r.yBot]);
        addWirePath(r.doc, [3, 4], [6, 4]);
        addWirePath(r.doc, [3, r.yBot], [6, r.yBot]);
        return withProbes(r.doc, ['R', 'u']);
      },
    },
  ];

  RLC.library = LIBRARY;
})(/** @type {any} */ (globalThis).RLC ??= {});
