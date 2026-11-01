// @ts-check
// Modèle du document (composants + fils sur la grille) et compilation en liste de nœuds.
(function (RLC) {
  'use strict';

  /**
   * @typedef {{id:number, type:string, x:number, y:number, rot:number, label:string, params:Object<string, any>}} Comp
   * @typedef {{id:number, kind:'u'|'i'}} Probe
   * @typedef {{name:string, comps:Comp[], wires:string[], probes:Probe[], nextId:number}} Doc
   */

  const WAVES = [
    { value: 'dc', label: 'Continu' },
    { value: 'sine', label: 'Sinusoïdal' },
    { value: 'square', label: 'Créneaux' },
    { value: 'step', label: 'Échelon à t₀' },
  ];
  const wavesWith = (/** @type {string[]} */ ...w) => (/** @type {any} */ p) => w.includes(p.wave);

  /** Paramètres communs aux deux générateurs (l'amplitude est ajoutée par chaque type). */
  const sourceParams = [
    { key: 'wave', label: 'Forme du signal', kind: 'select', options: WAVES, def: 'dc' },
    { key: 'f', label: 'Fréquence f', unit: 'Hz', def: 1000, min: 1e-3, slider: true, when: wavesWith('sine', 'square') },
    { key: 'phase', label: 'Phase à l\'origine', unit: '°', def: 0, plain: true, when: wavesWith('sine', 'square') },
    { key: 'duty', label: 'Rapport cyclique', unit: '%', def: 50, min: 1, max: 99, plain: true, when: wavesWith('square') },
    { key: 't0', label: 'Instant t₀', unit: 's', def: 0, min: 0, when: wavesWith('step') },
  ];

  /** Catalogue des composants. `a` est la borne de gauche à rotation nulle. */
  const TYPES = {
    resistor: {
      name: 'Résistance', prefix: 'R', hint: 'Dipôle ohmique : u = R·i',
      params: [{ key: 'R', label: 'Résistance R', unit: 'Ω', def: 100, min: 1e-6, slider: true }],
    },
    lamp: {
      name: 'Lampe', prefix: 'H', hint: 'Dipôle ohmique dont l\'éclat suit |u| / Umax',
      params: [
        { key: 'R', label: 'Résistance R', unit: 'Ω', def: 100, min: 1e-6, slider: true },
        { key: 'Umax', label: 'Tension maximale Umax', unit: 'V', def: 5, min: 1e-3, display: true },
      ],
    },
    capacitor: {
      name: 'Condensateur', prefix: 'C', hint: 'i = C·du/dt, tension continue',
      params: [
        { key: 'C', label: 'Capacité C', unit: 'F', def: 1e-6, min: 1e-15, slider: true },
        { key: 'V0', label: 'Tension initiale u(0)', unit: 'V', def: 0, initial: true },
      ],
    },
    inductor: {
      name: 'Bobine', prefix: 'L', hint: 'u = L·di/dt + r·i, courant continu',
      params: [
        { key: 'L', label: 'Inductance L', unit: 'H', def: 10e-3, min: 1e-12, slider: true },
        { key: 'r', label: 'Résistance interne r', unit: 'Ω', def: 0, min: 0 },
        { key: 'I0', label: 'Courant initial i(0)', unit: 'A', def: 0, initial: true },
      ],
    },
    switch: {
      name: 'Interrupteur', prefix: 'K', hint: 'Cliquer dessus pour le basculer',
      params: [
        { key: 'closed', label: 'État initial', kind: 'select', def: false, initial: true, options: [{ value: false, label: 'Ouvert' }, { value: true, label: 'Fermé' }] },
        { key: 'tToggle', label: 'Basculement auto à t (0 = jamais)', unit: 's', def: 0, min: 0 },
        { key: 'Ron', label: 'Résistance fermé', unit: 'Ω', def: 1e-6, min: 1e-9 },
        { key: 'Roff', label: 'Résistance ouvert', unit: 'Ω', def: 1e10, min: 1 },
      ],
    },
    vsource: {
      name: 'Générateur de tension', prefix: 'E', hint: 'Convention générateur ; borne + marquée',
      params: [
        { key: 'A', label: 'Tension E (amplitude)', unit: 'V', def: 5, slider: true },
        ...sourceParams,
        { key: 'off', label: 'Composante continue', unit: 'V', def: 0, when: wavesWith('sine', 'square', 'step') },
        { key: 'r', label: 'Résistance interne', unit: 'Ω', def: 0, min: 0 },
      ],
    },
    isource: {
      name: 'Générateur de courant', prefix: 'I', hint: 'Convention générateur ; la flèche donne le sens de i',
      params: [
        { key: 'A', label: 'Courant I (amplitude)', unit: 'A', def: 10e-3 },
        ...sourceParams,
        { key: 'off', label: 'Composante continue', unit: 'A', def: 0, when: wavesWith('sine', 'square', 'step') },
      ],
    },
    diode: {
      name: 'Diode', prefix: 'D', hint: 'Modèle à seuil : bloquée sous Vd, puis u = Vd + Rd·i',
      params: [
        { key: 'Vd', label: 'Tension de seuil Vd', unit: 'V', def: 0.6, min: 0 },
        { key: 'Rd', label: 'Résistance dynamique Rd', unit: 'Ω', def: 1, min: 1e-3 },
        { key: 'Vz', label: 'Tension Zener (0 = aucune)', unit: 'V', def: 0, min: 0 },
      ],
    },
    opamp: {
      name: 'AOP', prefix: 'A', hint: 'Amplificateur opérationnel du premier ordre, avec saturation',
      params: [
        { key: 'flip', label: 'Position des entrées', kind: 'select', def: false, structural: true, options: [{ value: false, label: 'e− en haut, e+ en bas' }, { value: true, label: 'e+ en haut, e− en bas' }] },
        { key: 'mu0', label: 'Gain statique μ₀', unit: '', def: 1e5, min: 1 },
        { key: 'gbw', label: 'Produit gain-bande', unit: 'Hz', def: 1e6, min: 1 },
        { key: 'vsat', label: 'Tension de saturation', unit: 'V', def: 15, min: 0.1 },
        { key: 'sr', label: 'Vitesse de balayage', unit: 'V/s', def: 1e7, min: 1 },
        { key: 'rout', label: 'Résistance de sortie', unit: 'Ω', def: 1, min: 1e-3 },
        { key: 'x0', label: 'Tension de sortie initiale', unit: 'V', def: 0, initial: true },
      ],
    },
    voltmeter: {
      name: 'Voltmètre', prefix: 'V', hint: 'Mesure u entre deux points, sans courant',
      params: [],
    },
    ground: {
      name: 'Masse', prefix: 'M', hint: 'Référence des potentiels (facultative)',
      params: [],
    },
  };

  /** Rotation d'un quart de tour horaire répétée `rot` fois. */
  function rotate(dx, dy, rot) {
    for (let k = 0; k < ((rot % 4) + 4) % 4; k++) { const t = dx; dx = -dy; dy = t; }
    return [dx, dy];
  }

  /** @param {Comp} c @returns {[number, number][]} bornes (a, b) ou (a) pour la masse */
  function terminals(c) {
    if (c.type === 'ground') return [[c.x, c.y]];
    if (c.type === 'opamp') {
      // Ordre : e+, e−, sortie. Par défaut e− est en haut, comme sur la plupart des schémas d'inverseur.
      const s = c.params && c.params.flip ? -1 : 1;
      return /** @type {[number, number][]} */ ([[-3, s], [-3, -s], [3, 0]].map(([dx, dy]) => {
        const [rx, ry] = rotate(dx, dy, c.rot);
        return [c.x + rx, c.y + ry];
      }));
    }
    const [dx, dy] = rotate(-2, 0, c.rot);
    return [[c.x + dx, c.y + dy], [c.x - dx, c.y - dy]];
  }

  /** Paramètres par défaut d'un type. */
  function defaultParams(type) {
    /** @type {Object<string, any>} */
    const p = {};
    for (const d of TYPES[type].params) p[d.key] = d.def;
    return p;
  }

  /** Éclat d'une lampe entre 0 et 1 : proportionnel à |u|, plein à sa tension maximale. */
  function lampLevel(u, p) {
    return Math.min(1, Math.abs(u) / p.Umax);
  }

  /** Prochain nom libre : R1, R2… */
  function nextLabel(doc, type) {
    const prefix = TYPES[type].prefix;
    let n = 1;
    while (doc.comps.some((c) => c.label === prefix + n)) n++;
    return prefix + n;
  }

  /** @returns {Doc} */
  function newDoc(name = 'Sans titre') {
    return { name, comps: [], wires: [], probes: [], nextId: 1 };
  }

  /** @param {Doc} doc */
  function addComp(doc, type, x, y, rot = 0, params = {}, label = '') {
    /** @type {Comp} */
    const c = {
      id: doc.nextId++, type, x, y, rot,
      label: label || nextLabel(doc, type),
      params: { ...defaultParams(type), ...params },
    };
    doc.comps.push(c);
    return c;
  }

  const edgeKey = (x, y, dir) => x + ',' + y + ',' + dir;
  /** @param {string} key */
  function parseEdge(key) {
    const [x, y, d] = key.split(',');
    const X = +x, Y = +y;
    return { x: X, y: Y, dir: d, x2: d === 'h' ? X + 1 : X, y2: d === 'h' ? Y : Y + 1 };
  }

  /** Ajoute une ligne droite de fils unitaires. @param {Doc} doc */
  function addWireLine(doc, x1, y1, x2, y2) {
    const set = new Set(doc.wires);
    if (y1 === y2) for (let x = Math.min(x1, x2); x < Math.max(x1, x2); x++) set.add(edgeKey(x, y1, 'h'));
    else if (x1 === x2) for (let y = Math.min(y1, y2); y < Math.max(y1, y2); y++) set.add(edgeKey(x1, y, 'v'));
    else throw new Error('Fil non orthogonal');
    doc.wires = [...set];
  }

  /** Relie une suite de points par des segments orthogonaux. @param {Doc} doc */
  function addWirePath(doc, ...pts) {
    for (let i = 0; i + 1 < pts.length; i++) addWireLine(doc, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
  }

  /**
   * Résultat de la compilation.
   * @typedef {{id:number, type:string, label:string, a:number, b:number, comp:Comp}} NetComp
   * @typedef {{key:string, x:number, y:number, dir:string, net:number, terms:number[]}} NetEdge
   * terms : suite (indice de composant, signe) dont la somme donne le courant dans le sens x→x+1 ou y→y+1.
   */

  /** @param {Doc} doc */
  function compile(doc) {
    /** @type {Map<string, number>} */
    const vid = new Map();
    /** @type {number[]} */
    const uf = [];
    const vertex = (x, y) => {
      const k = x + ',' + y;
      let v = vid.get(k);
      if (v === undefined) { v = uf.length; uf.push(v); vid.set(k, v); }
      return v;
    };
    const find = (/** @type {number} */ v) => {
      while (uf[v] !== v) { uf[v] = uf[uf[v]]; v = uf[v]; }
      return v;
    };
    const edges = doc.wires.map(parseEdge);
    for (const e of edges) {
      const a = vertex(e.x, e.y), b = vertex(e.x2, e.y2);
      uf[find(a)] = find(b);
    }
    const termV = doc.comps.map((c) => terminals(c).map(([x, y]) => vertex(x, y)));

    /** @type {Map<number, number>} */
    const netOf = new Map();
    const net = (/** @type {number} */ v) => {
      const r = find(v);
      let n = netOf.get(r);
      if (n === undefined) { n = netOf.size; netOf.set(r, n); }
      return n;
    };

    /** @type {NetComp[]} */
    const comps = [];
    const errors = [], warnings = [];
    /** @type {number[]} */
    const groundNets = [];
    doc.comps.forEach((c, i) => {
      if (c.type === 'ground') { groundNets.push(net(termV[i][0])); return; }
      /** @type {any} */
      const nc = { id: c.id, type: c.type, label: c.label, a: net(termV[i][0]), b: net(termV[i][1]), comp: c };
      if (c.type === 'opamp') nc.c = net(termV[i][2]);
      comps.push(nc);
    });
    const nNets = netOf.size;
    // Nœuds de fils isolés : on leur donne quand même un numéro pour les dessiner.
    for (const e of edges) net(vertex(e.x, e.y));
    const nAllNets = netOf.size;

    // Comptage des bornes par réseau : une borne seule est en l'air.
    const degree = new Int32Array(nAllNets);
    doc.comps.forEach((c, i) => { for (const v of termV[i]) degree[net(v)]++; });
    /** @type {Set<number>} */
    const unconnected = new Set();
    for (const c of comps) {
      if (c.type === 'opamp') {
        if (degree[c.a] < 2 || degree[c.b] < 2 || degree[/** @type {any} */ (c).c] < 2) unconnected.add(c.id);
      } else if (c.type !== 'voltmeter' && (degree[c.a] < 2 || degree[c.b] < 2) && c.a !== c.b) {
        unconnected.add(c.id);
      }
    }
    if (unconnected.size) {
      const names = comps.filter((c) => unconnected.has(c.id)).map((c) => c.label).join(', ');
      warnings.push(`Borne non reliée : ${names}.`);
    }

    // Boucles de sources idéales (singulières) et sources de courant en l'air.
    const vf = new Int32Array(nAllNets).map((_, i) => i);
    const vfind = (/** @type {number} */ x) => { while (vf[x] !== x) { vf[x] = vf[vf[x]]; x = vf[x]; } return x; };
    for (const c of comps) {
      if (c.type !== 'vsource' || c.comp.params.r > 0) continue;
      if (c.a === c.b) errors.push(`${c.label} est court-circuité par un fil : ajoutez une résistance interne ou retirez le fil.`);
      else if (vfind(c.a) === vfind(c.b)) errors.push(`${c.label} forme une boucle de générateurs de tension idéaux : leurs tensions ne peuvent pas être imposées ensemble.`);
      else vf[vfind(c.a)] = vfind(c.b);
    }
    for (const c of comps) {
      if (c.a === c.b && c.type !== 'vsource' && c.type !== 'opamp') warnings.push(`${c.label} a ses deux bornes reliées par un fil : il est court-circuité.`);
    }

    // Référence de potentiel par îlot électrique.
    const isl = new Int32Array(nAllNets).map((_, i) => i);
    const ifind = (/** @type {number} */ x) => { while (isl[x] !== x) { isl[x] = isl[isl[x]]; x = isl[x]; } return x; };
    for (const c of comps) {
      if (c.type === 'voltmeter') continue;
      isl[ifind(c.a)] = ifind(c.b);
      if (c.type === 'opamp') isl[ifind(/** @type {any} */ (c).c)] = ifind(c.a);
    }
    /** @type {Set<number>} */
    const refIslands = new Set();
    /** @type {Int32Array} */
    const mna = new Int32Array(nAllNets).fill(-2);
    for (const g of groundNets) { mna[g] = -1; refIslands.add(ifind(g)); }
    // La sortie d'un AOP est définie par rapport à la masse de son alimentation.
    for (const c of comps) {
      if (c.type === 'opamp' && !refIslands.has(ifind(c.a))) errors.push(`${c.label} a besoin d'une masse : posez le symbole de masse sur le circuit.`);
    }
    // Sans masse, le 0 V va sur la borne − d'un générateur : la borne + apparaît alors positive.
    for (const c of comps) {
      if ((c.type === 'vsource' || c.type === 'isource') && !refIslands.has(ifind(c.b))) {
        mna[c.b] = -1;
        refIslands.add(ifind(c.b));
      }
    }
    let nNodes = 0;
    for (let n = 0; n < nAllNets; n++) {
      if (mna[n] === -1) continue;
      const root = ifind(n);
      if (!refIslands.has(root)) { refIslands.add(root); mna[n] = -1; continue; }
      mna[n] = nNodes++;
    }

    // Arbre couvrant de chaque réseau : le courant de chaque fil se déduit de la loi des nœuds.
    /** @type {Map<number, {e:any, other:number, sign:number, idx:number}[]>} */
    const adj = new Map();
    /** @type {NetEdge[]} */
    const netEdges = edges.map((e) => ({ key: edgeKey(e.x, e.y, e.dir), x: e.x, y: e.y, dir: e.dir, net: net(vertex(e.x, e.y)), terms: [] }));
    edges.forEach((e, idx) => {
      const a = vertex(e.x, e.y), b = vertex(e.x2, e.y2);
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push({ e, other: b, sign: 1, idx });   // a→b = sens canonique
      adj.get(b).push({ e, other: a, sign: -1, idx });
    });
    /** Injections d'un composant dans chaque sommet (courant entrant dans le réseau). */
    /** @type {Map<number, number[]>} */
    const inject = new Map();
    let ci = 0;
    doc.comps.forEach((c, i) => {
      if (c.type === 'ground') return;
      const [va, vb, vc] = termV[i];
      if (c.type === 'opamp') {
        // Entrées sans courant ; la sortie injecte i dans le réseau (fourni par l'alimentation).
        if (!inject.has(vc)) inject.set(vc, []);
        inject.get(vc).push(ci, 1);
      } else {
        // Le courant a→b quitte le réseau en a et y entre en b.
        if (!inject.has(va)) inject.set(va, []);
        if (!inject.has(vb)) inject.set(vb, []);
        inject.get(va).push(ci, -1);
        inject.get(vb).push(ci, 1);
      }
      ci++;
    });
    /** @type {Set<number>} */
    const seen = new Set();
    // Racine sur une masse si possible : le courant renvoyé à l'alimentation d'un AOP y sort du réseau.
    const groundVerts = doc.comps.flatMap((c, i) => (c.type === 'ground' ? [termV[i][0]] : []));
    for (const start of [...groundVerts, ...adj.keys()]) {
      if (seen.has(start)) continue;
      /** Parcours en profondeur itératif ; on remonte les injections vers la racine. */
      /** @type {{v:number, parentEdge:number, parentSign:number}[]} */
      const order = [];
      const stack = [{ v: start, parentEdge: -1, parentSign: 0 }];
      seen.add(start);
      while (stack.length) {
        const cur = /** @type {any} */ (stack.pop());
        order.push(cur);
        for (const nb of adj.get(cur.v) || []) {
          if (seen.has(nb.other)) continue;
          seen.add(nb.other);
          // On parcourt v→other : le courant du fil vu de l'enfant vers le parent est de sens other→v.
          stack.push({ v: nb.other, parentEdge: nb.idx, parentSign: -nb.sign });
        }
      }
      /** @type {Map<number, number[]>} */
      const acc = new Map();
      for (let i = order.length - 1; i >= 0; i--) {
        const { v, parentEdge, parentSign } = order[i];
        const inj = (acc.get(v) || []).concat(inject.get(v) || []);
        if (parentEdge >= 0) {
          // Ce qui entre dans le sous-arbre sort par le fil vers le parent.
          const terms = netEdges[parentEdge].terms;
          for (let k = 0; k < inj.length; k += 2) terms.push(inj[k], inj[k + 1] * parentSign);
          const parent = findParent(order, i, adj);
          const list = acc.get(parent);
          if (list) list.push(...inj); else acc.set(parent, inj.slice());
        }
      }
    }

    return { comps, edges: netEdges, nNets: nAllNets, nNodes, mna, errors, warnings, unconnected, nElectric: nNets };
  }

  /** Sommet parent de order[i] : l'autre extrémité du fil parent. */
  function findParent(order, i, adj) {
    const { v, parentEdge } = order[i];
    for (const nb of adj.get(v)) if (nb.idx === parentEdge) return nb.other;
    return v;
  }

  /** Copie profonde d'un document (toutes les valeurs sont JSON). @param {Doc} doc @returns {Doc} */
  const cloneDoc = (doc) => JSON.parse(JSON.stringify(doc));

  // ---------- Formatage et saisie des valeurs ----------
  const PREFIXES = [
    { e: 12, s: 'T' }, { e: 9, s: 'G' }, { e: 6, s: 'M' }, { e: 3, s: 'k' }, { e: 0, s: '' },
    { e: -3, s: 'm' }, { e: -6, s: 'µ' }, { e: -9, s: 'n' }, { e: -12, s: 'p' }, { e: -15, s: 'f' },
  ];

  /**
   * Écriture ingénieur à la française : 4,7 µF.
   * @param {number} v @param {string} unit @param {number} [digits]
   */
  function formatSI(v, unit = '', digits = 3) {
    if (!isFinite(v)) return '—';
    const sp = unit ? ' ' : '';
    const abs = Math.abs(v);
    if (abs < 1e-15) return '0' + sp + unit; // en dessous, ce n'est que du bruit de calcul
    let pick = PREFIXES[PREFIXES.length - 1];
    for (const p of PREFIXES) if (abs >= Math.pow(10, p.e) * 0.9995) { pick = p; break; }
    const scaled = v / Math.pow(10, pick.e);
    let s = Number(scaled.toPrecision(digits)).toString().replace('.', ',');
    if (s.includes('e')) s = scaled.toExponential(1).replace('.', ',');
    return s + (unit || pick.s ? (sp + pick.s + unit) : '');
  }

  /** Lit « 4,7k », « 100 n », « 1e-3 », « 2.2 µF ». Renvoie NaN si illisible. @param {string} text */
  function parseSI(text) {
    const m = String(text).trim().replace(',', '.').replace(/\s+/g, '')
      .match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)([a-zA-ZµΩ°%]*)$/);
    if (!m) return NaN;
    const mult = { T: 1e12, G: 1e9, M: 1e6, k: 1e3, K: 1e3, m: 1e-3, u: 1e-6, 'µ': 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 };
    const tail = m[2];
    let f = 1;
    // Un préfixe seulement s'il reste une unité connue derrière, ou rien.
    if (tail && mult[tail[0]] !== undefined && /^.(?:[ΩFHVAsz°%]|Hz|ohm|)$/.test(tail)) f = mult[tail[0]];
    return parseFloat(m[1]) * f;
  }

  RLC.circuit = {
    TYPES, terminals, rotate, defaultParams, nextLabel, newDoc, addComp, addWireLine, addWirePath,
    edgeKey, parseEdge, compile, cloneDoc, formatSI, parseSI, lampLevel,
  };
})(/** @type {any} */ (globalThis).RLC ??= {});
