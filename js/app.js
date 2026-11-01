// @ts-check
// Application : état, transport du temps, inspecteur, sondes, sauvegarde et bibliothèque.
(function (RLC) {
  'use strict';
  const { TYPES, newDoc, formatSI, parseSI } = RLC.circuit;
  const { Renderer, readTheme, thumbnail, icon, prettyLabel } = RLC.render;

  const STORE_KEY = 'rlc.circuits.v1', AUTO_KEY = 'rlc.autosave.v1', THEME_KEY = 'rlc.theme';
  const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));

  /** Stockage tolérant : en navigation privée, les accès peuvent lever une exception. */
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  };

  /** Petit constructeur DOM : le texte passe toujours par textContent. */
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

  const app = {
    doc: newDoc(),
    /** @type {any} */ sim: null,
    tNow: 0,
    playing: false,
    dir: 1,
    speed: 1e-3,
    lagging: false,
    undo: /** @type {string[]} */ ([]),
    redo: /** @type {string[]} */ ([]),
    theme: null,
    dirty: true,
    /** @type {any} */ editor: null,
    /** @type {any} */ renderer: null,
    /** @type {any} */ scope: null,
    compIndex: /** @type {Map<number, number>} */ (new Map()),
    /** @type {any} */ state: null,
    /** @type {any} */ dots: null,
    vRef: 1, iRef: 1, iPeak: 0,
    /** État affiché : l'instant courant, ou l'instant survolé sur un graphique. */
    /** @type {any} */ view: null,
    /** @type {any} */ hoverState: null,
    viewT: 0,
    showValues: false,
    /** @type {null | '0' | 'inf'} */ equivKind: null,
    guideStep: -1,
    whatIf: false,
    predictOpen: false,
    /** @type {Object<string, string>} */ predictInputs: {},
    /** @type {any[] | null} */ predictResults: null,
    lastSeg: -1,
    /** @type {any} */ compiled: null,

    invalidate() { this.dirty = true; },

    // ---------- Édition de la structure ----------
    beforeStructural() {
      // Le schéma ne correspondra plus au texte du parcours guidé.
      this.doc.guideId = undefined;
      this.undo.push(JSON.stringify(this.doc));
      if (this.undo.length > 100) this.undo.shift();
      this.redo.length = 0;
      if (this.sim) { this.powerOff(); toast('Circuit mis hors tension pour modification.'); }
    },
    afterStructural() { this.changed(); },
    structuralEdit(fn) { this.beforeStructural(); fn(); this.afterStructural(); },
    changed() {
      this.compiled = RLC.circuit.compile(this.doc);
      store.set(AUTO_KEY, JSON.stringify(this.doc));
      updateMessage();
      updateUndoButtons();
      renderInspector();
      renderProbes();
      this.invalidate();
    },
    loadDoc(doc, fit = true) {
      if (this.sim) this.powerOff();
      this.doc = doc;
      this.guideStep = -1;
      this.predictOpen = false;
      this.predictResults = null;
      this.editor.select(null);
      $('docName').value = doc.name;
      this.changed();
      if (fit) this.renderer.fit(doc);
    },
    onToolChange(tool) {
      for (const b of document.querySelectorAll('[data-tool]')) {
        b.setAttribute('aria-pressed', b.dataset.tool === tool ? 'true' : 'false');
      }
      this.invalidate();
    },
    onSelectionChange() { renderInspector(); this.invalidate(); },

    // ---------- Mise sous tension ----------
    powerOn() {
      const sim = new RLC.Sim(this.doc);
      if (sim.errors.length) { updateMessage(sim.errors); return; }
      attachSim(sim);
      this.dir = 1;
      this.vRef = 1e-9; this.iRef = 1e-12;
      autoTiming();
      if (!this.doc.probes.length) addDefaultProbes();
      this.playing = true;
      $('btnPower').textContent = 'Couper le circuit';
      $('btnPower').setAttribute('aria-pressed', 'true');
      updateMessage();
      renderInspector();
      renderProbes();
      syncPlayButtons();
      this.invalidate();
    },
    powerOff() {
      this.sim = null;
      this.view = null;
      this.equivKind = null;
      this.predictResults = null;
      this.scope.refSim = null;
      this.state = null;
      this.dots = null;
      this.playing = false;
      this.tNow = 0;
      $('btnPower').textContent = 'Mise sous tension';
      $('btnPower').setAttribute('aria-pressed', 'false');
      $('regime').dataset.kind = 'off';
      $('regime').textContent = 'Hors tension';
      $('tNow').textContent = '0 s';
      $('timeline').value = 0;
      updateMessage();
      renderInspector();
      renderProbes();
      syncPlayButtons();
      this.invalidate();
    },

    /** Bascule un interrupteur, hors tension (état initial) ou sous tension (événement daté). */
    toggleSwitch(id) {
      const c = this.doc.comps.find((x) => x.id === id);
      if (!c) return;
      if (!this.sim) {
        this.undo.push(JSON.stringify(this.doc));
        this.redo.length = 0;
        c.params.closed = !c.params.closed;
        this.changed();
        return;
      }
      const t = this.tNow;
      const rewrote = this.sim.toggleAt(t, id);
      this.tNow = Math.max(t, this.sim.h[(this.sim.len - 1) * this.sim.width]);
      if (rewrote) toast('Le futur enregistré est réécrit à partir de cet instant.');
      renderInspector();
      this.invalidate();
    },

    closedState(c) {
      if (!this.sim) return !!c.params.closed;
      const k = this.compIndex.get(c.id);
      if (k === undefined) return !!c.params.closed;
      return !!this.sim.segmentAt(this.view ? this.viewT : this.tNow).closed[k];
    },

    /** Changement de paramètre : hors tension simple ; sous tension, il date un nouveau segment. */
    setParam(c, def, value) {
      const prev = c.params[def.key];
      if (prev === value) return;
      if (def.structural) {
        // Le paramètre déplace des bornes : c'est une modification du schéma.
        this.structuralEdit(() => { c.params[def.key] = value; });
        return;
      }
      if (def.display) {
        // Sans effet électrique : ni nouveau segment, ni futur à réécrire.
        this.undo.push(JSON.stringify(this.doc));
        this.redo.length = 0;
        c.params[def.key] = value;
        store.set(AUTO_KEY, JSON.stringify(this.doc));
        updateUndoButtons();
        this.invalidate();
        return;
      }
      this.undo.push(JSON.stringify(this.doc));
      this.redo.length = 0;
      c.params[def.key] = value;
      store.set(AUTO_KEY, JSON.stringify(this.doc));
      updateUndoButtons();
      if (this.sim) {
        const k = this.compIndex.get(c.id);
        if (def.initial) {
          if (this.tNow > 0) toast('Valeur initiale : elle s\'appliquera à la prochaine mise sous tension.');
          else restartSim();
        } else if (this.tNow <= 0) {
          restartSim();
        } else {
          const t = this.tNow;
          const rewrote = this.sim.editAt(t, (params) => { params[k][def.key] = value; }, `${c.label} modifié`);
          this.tNow = Math.max(t, this.sim.h[(this.sim.len - 1) * this.sim.width]);
          if (rewrote) toast('Le futur enregistré est réécrit à partir de cet instant.');
        }
      }
      if (def.key === 'wave') renderInspector();
      this.invalidate();
    },
  };

  /** Branche une simulation neuve sur l'affichage. */
  function attachSim(sim) {
    app.sim = sim;
    app.compIndex = new Map(sim.net.comps.map((c, k) => [c.id, k]));
    app.state = sim._newState();
    app.hoverState = sim._newState();
    app.view = app.state;
    app.viewT = 0;
    app.dots = {
      edgeQ: new Float64Array(sim.net.edges.length), compQ: new Float64Array(sim.K),
      edgeOn: new Uint8Array(sim.net.edges.length), compOn: new Uint8Array(sim.K),
    };
    app.iPeak = 0;
    app.tNow = 0;
    app.lastSeg = -1;
  }

  /** Relance depuis t = 0 après un changement de paramètre fait avant le départ. */
  function restartSim() {
    const sim = new RLC.Sim(app.doc);
    if (sim.errors.length) { app.powerOff(); updateMessage(sim.errors); return; }
    attachSim(sim);
  }

  function addDefaultProbes() {
    const pick = app.doc.comps.find((c) => c.type === 'capacitor') || app.doc.comps.find((c) => c.type === 'inductor') ||
      app.doc.comps.find((c) => c.type === 'resistor') || app.doc.comps.find((c) => c.type === 'lamp') || app.doc.comps.find((c) => c.type === 'voltmeter');
    if (pick) app.doc.probes.push({ id: pick.id, kind: pick.type === 'inductor' ? 'i' : 'u' });
  }

  /** Vitesse et fenêtre adaptées au circuit : le phénomène se déroule en une dizaine de secondes. */
  function autoTiming() {
    const sim = app.sim;
    if (!sim) return;
    const tc = sim.tc;
    setSpeed(tc / 8);
    app.scope.window = roundNice(tc * 1.2);
    app.scope.showAll = false;
    syncWindowButton();
  }
  function roundNice(x) {
    const mag = Math.pow(10, Math.floor(Math.log10(x)));
    const n = x / mag;
    for (const step of [1, 1.5, 2, 3, 5, 7.5]) if (n <= step) return step * mag;
    return 10 * mag;
  }
  function setSpeed(s) {
    app.speed = s;
    const log = Math.log10(s);
    $('speed').value = String(log);
    $('speedOut').textContent = `${formatSI(s, 's')}/s`;
    $('speedOut').title = `Une seconde réelle correspond à ${formatSI(s, 's')} de temps simulé.`;
  }

  // ---------- Boucle d'animation ----------

  let lastFrame = 0;
  function frame(now) {
    const dtWall = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const sim = app.sim;
    if (sim) {
      if (app.playing) {
        app.tNow += app.dir * app.speed * dtWall;
        if (app.dir > 0) {
          if (app.tNow > sim.ctx.t) sim.advanceTo(app.tNow, 10);
          app.lagging = app.tNow > sim.ctx.t;
          if (app.lagging) app.tNow = sim.ctx.t;
        } else if (app.tNow <= 0) {
          app.tNow = 0;
          app.playing = false;
          syncPlayButtons();
        }
        app.invalidate();
      }
      sim.sampleAt(app.tNow, app.state);
      // Un graphique survolé : le schéma montre cet instant, sans toucher au temps de la simulation.
      const hoverT = app.scope.hoverT;
      app.view = hoverT === null ? app.state : sim.sampleAt(hoverT, app.hoverState);
      app.viewT = hoverT === null ? app.tNow : hoverT;
      trackSegments();
      updateCurrents(sim, dtWall);
      updateReadouts(sim);
    }
    if (app.dirty) {
      app.dirty = false;
      const before = app.scope.hoverT;
      drawAll();
      // Le graphique vient de déterminer l'instant survolé : le schéma le rattrape à l'image suivante.
      if (app.editor.gesture || app.scope.hoverT !== before) app.dirty = true;
    }
    requestAnimationFrame(frame);
  }

  /** Met à jour le panneau du régime libre quand l'instant affiché change de configuration. */
  function trackSegments() {
    const idx = app.state.segIdx;
    if (idx !== app.lastSeg) {
      app.lastSeg = idx;
      renderModes();
    }
  }

  /** Avance les points de courant : leur vitesse est proportionnelle à i, leur sens suit celui du film. */
  function updateCurrents(sim, dtWall) {
    const s = app.view, d = app.dots;
    let iMax = 0, vMax = 0;
    for (let n = 0; n < sim.nNets; n++) vMax = Math.max(vMax, Math.abs(s.V[n]));
    // Ce qui ne dépasse pas les fuites du modèle est un courant nul : circuit ouvert, pas de charges.
    const leak = sim.leakCurrent(sim.segments[s.segIdx] || sim.segments[0], vMax);
    for (let k = 0; k < sim.K; k++) {
      const a = Math.abs(s.i[k]);
      if (a > leak) iMax = Math.max(iMax, a);
    }
    const decay = Math.exp(-dtWall / 6);
    // L'échelle suit le courant, mais sans descendre sous 2 % du plus fort courant observé : sinon un
    // courant de fuite de quelques nanoampères finirait par faire défiler les points à pleine vitesse.
    app.iPeak = Math.max(app.iPeak, iMax);
    app.iRef = Math.max(iMax, app.iRef * decay, app.iPeak * 0.02, 1e-12);
    app.vRef = Math.max(vMax, app.vRef * decay, 1e-9);
    const threshold = Math.max(app.iRef * 1e-3, app.iPeak * 1e-3, leak, 1e-12);
    const gain = app.playing && app.scope.hoverT === null ? (4.5 / app.iRef) * dtWall * app.dir : 0;
    for (let k = 0; k < sim.K; k++) {
      const on = Math.abs(s.i[k]) > threshold;
      d.compOn[k] = on ? 1 : 0;
      if (on) d.compQ[k] += s.i[k] * gain;
    }
    sim.net.edges.forEach((e, j) => {
      let i = 0;
      const tm = e.terms;
      for (let n = 0; n < tm.length; n += 2) i += tm[n + 1] * s.i[tm[n]];
      const on = Math.abs(i) > threshold;
      d.edgeOn[j] = on ? 1 : 0;
      if (on) d.edgeQ[j] += i * gain;
    });
  }

  function drawAll() {
    const ed = app.editor, sim = app.sim;
    /** @type {any} */
    const scene = {
      doc: app.doc, sel: ed.sel, hover: ed.hover, draft: ed.draft, ghost: ed.ghost, sim,
      closedState: (c) => app.closedState(c),
    };
    scene.showValues = app.showValues;
    if (sim) {
      const v = app.view || app.state;
      scene.state = v;
      scene.vRef = app.vRef;
      scene.netEdges = sim.net.edges;
      scene.netComps = sim.net.comps;
      scene.compIndex = app.compIndex;
      const eq = app.equivKind ? equivScene(sim) : null;
      if (eq) {
        // Schéma statique : ni potentiels ni charges, seulement la structure.
        scene.equiv = eq;
      } else {
        scene.voltages = v.V;
        scene.dots = app.dots;
      }
    }
    app.renderer.draw(scene);
    app.scope.draw(sim, app.tNow, sim ? buildTraces(sim) : [], app.theme);
    if (sim && app.editor.sel) { updateLiveValues(); updateKirchhoff(); }
    updateBoardHints(sim);
  }

  /** Bulle au survol d'un fil ou d'un composant, et mention de l'instant affiché. */
  function updateBoardHints(sim) {
    const tip = $('boardTip'), badge = $('stageBadge');
    const hoverT = app.scope.hoverT;
    badge.hidden = hoverT === null || !sim;
    if (!badge.hidden) badge.textContent = `Schéma à t = ${formatSI(hoverT, 's', 4)}`;
    const ed = app.editor, hover = ed.hover, p = ed.mousePx;
    if (!sim || !hover || !p || ed.gesture || app.equivKind || (!hover.wire && !hover.comp)) { tip.hidden = true; return; }
    const s = app.view;
    tip.textContent = '';
    const line = (txt) => tip.append(h('div', { text: txt }));
    if (hover.wire) {
      const e = sim.net.edges.find((x) => x.key === hover.wire);
      if (!e) { tip.hidden = true; return; }
      line(`V = ${formatSI(s.V[e.net], 'V', 3)}`);
      let i = 0;
      for (let n = 0; n < e.terms.length; n += 2) i += e.terms[n + 1] * s.i[e.terms[n]];
      const arrow = e.dir === 'h' ? (i > 0 ? '→' : '←') : (i > 0 ? '↓' : '↑');
      if (!e.terms.length) line('i : non défini (boucle de fils)');
      else line(`i = ${formatSI(Math.abs(i), 'A', 3)} ${Math.abs(i) > 1e-12 ? arrow : ''}`);
    } else {
      const k = app.compIndex.get(hover.comp);
      if (k === undefined) { tip.hidden = true; return; }
      const nc = sim.net.comps[k];
      line(prettyLabel(nc.label));
      line(`u = ${formatSI(s.u[k], 'V', 3)}`);
      if (nc.type !== 'voltmeter') line(`i = ${formatSI((isSource(nc.type) ? -1 : 1) * s.i[k], 'A', 3)}`);
    }
    tip.hidden = false;
    const r = { w: $('stage').clientWidth, h: $('stage').clientHeight };
    tip.style.left = Math.min(p.px + 14, r.w - tip.offsetWidth - 4) + 'px';
    tip.style.top = Math.min(p.py + 14, r.h - tip.offsetHeight - 4) + 'px';
  }

  function buildTraces(sim) {
    const out = [];
    for (const p of app.doc.probes) {
      const k = app.compIndex.get(p.id);
      if (k === undefined) continue;
      const nc = sim.net.comps[k];
      out.push({
        k, kind: p.kind, id: p.id,
        name: `${p.kind}(${prettyLabel(nc.label)})`,
        color: app.theme.series[(p.slot ?? 0) % 7],
        sign: p.kind === 'i' && isSource(nc.type) ? -1 : 1,
      });
    }
    return out;
  }
  const isSource = (t) => t === 'vsource' || t === 'isource';

  let lastReadout = 0;
  function updateReadouts(sim) {
    const t = app.tNow, head = sim.ctx.t;
    const now = performance.now();
    if (now - lastReadout < 50) return;
    lastReadout = now;
    $('tNow').textContent = formatSI(t, 's', 4);
    if (document.activeElement !== $('timeline') || app.playing) {
      $('timeline').value = head > 0 ? String(Math.round(t / head * 1000)) : '0';
    }
    const reg = sim.regimeAt(t);
    const el = $('regime');
    el.dataset.kind = reg.kind;
    el.textContent = reg.kind === 'transitoire' ? 'Régime transitoire'
      : reg.kind === 'permanent' ? 'Régime permanent'
      : reg.kind === 'inconnu' ? 'Régime non déterminé' : 'Sans régime permanent';
    el.title = reg.kind === 'permanent' ? `Écart au régime permanent inférieur à 1 % depuis t = ${formatSI(reg.tPerm, 's', 3)}.`
      : reg.kind === 'transitoire' ? 'Écart au régime permanent supérieur à 1 %.'
      : reg.kind === 'inconnu' ? 'Aucun état stationnaire ni signal périodique n\'a été trouvé en simulation anticipée.'
      : 'Aucune dissipation : les oscillations propres ne s\'amortissent pas.';
    updateProbeValues(sim);
    updateMessage();
  }

  function updateProbeValues(sim) {
    for (const el of document.querySelectorAll('[data-probe-value]')) {
      const k = +el.dataset.k, kind = el.dataset.kind;
      const v = (kind === 'i' ? (isSource(sim.net.comps[k].type) ? -1 : 1) * app.state.i[k] : app.state.u[k]);
      el.textContent = formatSI(v, kind === 'i' ? 'A' : 'V', 3);
    }
  }

  // ---------- Messages ----------
  function updateMessage(errors) {
    const el = $('stageMsg');
    let text = '', level = '';
    const c = app.compiled;
    if (errors && errors.length) { text = errors.join(' '); level = 'err'; }
    else if (app.sim && app.sim.overvoltage) {
      text = 'Surtension supérieure à 100 kV : un courant de bobine a été coupé sans chemin de décharge, ou un générateur de courant est en circuit ouvert. En pratique, une étincelle se produirait.';
      level = 'warn';
    } else if (app.sim && app.lagging) {
      text = 'Calcul limité : le temps simulé avance moins vite que demandé. Réduisez la vitesse.';
      level = 'warn';
    } else if (c && c.errors.length) { text = c.errors.join(' '); level = 'err'; }
    else if (c && c.warnings.length) { text = c.warnings.join(' '); level = 'warn'; }
    if (el.textContent !== text) el.textContent = text;
    el.dataset.level = level;
    el.hidden = !text;
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { t.hidden = true; }, 3200);
  }

  // ---------- Inspecteur ----------

  function renderInspector() {
    const root = $('inspector');
    root.textContent = '';
    renderGuide(root);
    const sel = app.editor.sel;
    const c = sel && sel.comp ? app.doc.comps.find((x) => x.id === sel.comp) : null;
    if (c) renderCompPanel(root, c);
    else if (sel && sel.wire) {
      root.append(h('div', {}, h('h3', { class: 'ins-title', text: 'Fil' }), h('p', { class: 'ins-sub', text: `${sel.wire.size} segment${sel.wire.size > 1 ? 's' : ''} sélectionné${sel.wire.size > 1 ? 's' : ''}` })));
      if (app.sim) root.append(h('div', { class: 'kirch', id: 'kirch' }));
      root.append(h('div', { class: 'btn-row' }, h('button', { text: 'Supprimer', onclick: () => app.editor.deleteSelection() })));
    } else {
      root.append(h('div', {},
        h('h3', { class: 'ins-title', text: 'Circuit' }),
        h('p', { class: 'ins-sub', text: `${app.doc.comps.length} composant${app.doc.comps.length > 1 ? 's' : ''}. Cliquez sur un composant pour le régler.` }),
      ));
    }
    root.append(h('div', { class: 'section', id: 'modesBox' }));
    renderModes();
    renderEquivalents(root);
    renderPredict(root);
    if (app.sim) { updateLiveValues(); updateKirchhoff(); }
  }

  // ---------- Parcours guidé ----------

  function guideEntry() {
    return app.doc.guideId ? RLC.library.find((e) => e.id === app.doc.guideId) : null;
  }

  function renderGuide(root) {
    const e = guideEntry();
    if (!e || !e.guide || !e.guide.length) return;
    const n = app.guideStep, N = e.guide.length;
    const box = h('section', { class: 'guide' }, h('h2', { text: 'Parcours guidé' }));
    if (n < 0) {
      box.append(
        h('p', { text: `${N} étape${N > 1 ? 's' : ''} sur ce circuit : à chacune, le temps s'arrête sur un instant clé.` }),
        h('div', { class: 'btn-row' }, h('button', { text: 'Commencer', onclick: () => goToStep(0) })),
      );
    } else {
      box.append(
        h('div', { class: 'step', text: `Étape ${n + 1} sur ${N} · t = ${formatSI(e.guide[n].t, 's', 3)}` }),
        h('p', { text: e.guide[n].text }),
        h('div', { class: 'btn-row' },
          h('button', { text: 'Précédent', disabled: n === 0, onclick: () => goToStep(n - 1) }),
          h('button', { text: n + 1 < N ? 'Suivant' : 'Terminer', onclick: () => (n + 1 < N ? goToStep(n + 1) : endGuide()) }),
        ),
      );
    }
    root.append(box);
  }

  function goToStep(n) {
    const e = guideEntry();
    if (!e) return;
    app.guideStep = n;
    if (!app.sim) app.powerOn();
    const sim = app.sim;
    if (sim) {
      const t = e.guide[n].t;
      if (t > sim.ctx.t) sim.advanceTo(t, 3000);
      app.tNow = Math.min(t, sim.ctx.t);
      app.playing = false;
      app.equivKind = null;
      syncPlayButtons();
    }
    renderInspector();
    app.invalidate();
  }

  function endGuide() {
    app.guideStep = -1;
    renderInspector();
  }

  // ---------- Prédire avant de voir ----------

  /** Zéro net pour les valeurs infimes du tout premier pas de calcul (quelques nanovolts). */
  const tidy = (/** @type {number} */ v, /** @type {string} */ unit) => (Math.abs(v) < (unit === 'V' ? 1e-5 : 1e-8) ? 0 : v);

  /** Valeurs affichées d'une sonde (signe de la convention générateur compris). */
  const probeValue = (nc, k, kind, st) => (kind === 'i' ? (isSource(nc.type) ? -1 : 1) * st.i[k] : st.u[k]);

  function renderPredict(root) {
    if (!app.doc.probes.length) return;
    const box = h('div', { class: 'section' }, h('h2', { text: 'Prédire avant de voir' }));
    if (app.predictResults) {
      for (const r of app.predictResults) {
        box.append(h('div', { class: 'verdict' },
          h('b', { text: r.ok === null ? '– ' : r.ok ? '✓ Juste : ' : '✗ À revoir : ' }),
          `${r.name} : vous aviez ${r.mine}, le calcul donne ${r.truth}`));
      }
      if (!app.predictResults.length) box.append(h('p', { class: 'note', text: 'Aucune valeur saisie.' }));
    } else if (app.sim) {
      box.append(h('p', { class: 'note', text: 'Coupez le circuit pour prédire avant une nouvelle mise sous tension.' }));
    } else if (!app.predictOpen) {
      box.append(
        h('p', { class: 'note', text: 'Annoncez la valeur juste après la mise sous tension et la valeur finale, puis comparez.' }),
        h('div', { class: 'btn-row' }, h('button', { text: 'Faire une prédiction', onclick: () => { app.predictOpen = true; renderInspector(); } })),
      );
    } else {
      for (const p of app.doc.probes) {
        const c = app.doc.comps.find((x) => x.id === p.id);
        if (!c) continue;
        const key = (w) => `${p.id}:${p.kind}:${w}`;
        const field = (w, label) => {
          const input = h('input', { value: app.predictInputs[key(w)] || '', placeholder: 'ex. 5 ou 10m', spellcheck: false, autocomplete: 'off', ariaLabel: `${p.kind}(${c.label}) ${label}` });
          input.addEventListener('input', () => { app.predictInputs[key(w)] = input.value; });
          return h('div', { class: 'field' }, h('label', { text: label }), input);
        };
        box.append(h('div', {},
          h('div', { text: `${p.kind}(${prettyLabel(c.label)}), en ${p.kind === 'i' ? 'A' : 'V'}` }),
          h('div', { class: 'predict-row' }, field('0', 'à t = 0⁺'), field('inf', 'finale')),
        ));
      }
      box.append(h('div', { class: 'btn-row' }, h('button', { text: 'Vérifier', onclick: checkPrediction })));
    }
    root.append(box);
  }

  /** Lance la simulation, à l'arrêt à t = 0, et compare les valeurs saisies à celles du calcul. */
  function checkPrediction() {
    app.powerOn();
    const sim = app.sim;
    if (!sim) return;
    app.playing = false;
    syncPlayButtons();
    const seg = sim.segments[0], first = sim.firstSample(seg), fin = sim.finalValues(seg);
    const results = [];
    for (const p of app.doc.probes) {
      const k = app.compIndex.get(p.id);
      if (k === undefined) continue;
      const nc = sim.net.comps[k], unit = p.kind === 'i' ? 'A' : 'V';
      const name = (w) => `${p.kind}(${prettyLabel(nc.label)}) ${w}`;
      const start = tidy(probeValue(nc, k, p.kind, first), unit);
      const end = fin ? tidy(probeValue(nc, k, p.kind, fin), unit) : null;
      const scale = Math.max(Math.abs(start), Math.abs(end || 0));
      const judge = (w, label, truth) => {
        const raw = app.predictInputs[`${p.id}:${p.kind}:${w}`];
        if (raw === undefined || !raw.trim()) return;
        const mine = parseSI(raw);
        if (truth === null) {
          results.push({ ok: null, name: name(label), mine: isNaN(mine) ? raw : formatSI(mine, unit), truth: 'pas de valeur finale constante' });
          return;
        }
        const tol = Math.max(0.05 * Math.abs(truth), 0.02 * scale, unit === 'V' ? 1e-3 : 1e-6);
        results.push({ ok: !isNaN(mine) && Math.abs(mine - truth) <= tol, name: name(label), mine: isNaN(mine) ? `« ${raw} »` : formatSI(mine, unit), truth: formatSI(truth, unit, 3) });
      };
      judge('0', 'à 0⁺', start);
      judge('inf', 'finale', end);
    }
    app.predictOpen = false;
    app.predictResults = results;
    renderInspector();
    app.invalidate();
  }

  // ---------- Schémas équivalents ----------

  function equivScene(sim) {
    const seg = sim.segmentAt(app.tNow);
    const raw = sim.equivalents(seg, /** @type {'0'|'inf'} */ (app.equivKind));
    if (!raw) return null;
    const out = new Map();
    for (const [id, e] of raw) {
      const text = e.kind === 'open' ? 'interrupteur ouvert' : e.kind === 'wire' ? 'fil'
        : e.kind === 'vsource' ? `source ${formatSI(e.value, 'V', 3)}` : `source ${formatSI(Math.abs(e.value), 'A', 3)}`;
      out.set(id, { ...e, text });
    }
    return out;
  }

  function renderEquivalents(root) {
    const sim = app.sim;
    if (!sim || !sim.react.length) return;
    const seg = sim.segmentAt(app.tNow), fin = sim.finalValues(seg);
    const mark = seg.idx === 0 ? 't = 0⁺' : `t = ${formatSI(seg.tStart, 's', 3)}⁺`;
    const box = h('div', { class: 'section' }, h('h2', { text: 'Schémas équivalents' }));
    const toggle = (kind) => { app.equivKind = app.equivKind === kind ? null : kind; if (app.equivKind) { app.playing = false; syncPlayButtons(); } renderInspector(); app.invalidate(); };
    box.append(h('div', { class: 'btn-row' },
      h('button', { text: mark, class: app.equivKind === '0' ? 'on' : '', ariaPressed: String(app.equivKind === '0'), onclick: () => toggle('0') }),
      h('button', { text: 't → ∞', class: app.equivKind === 'inf' ? 'on' : '', disabled: !fin, title: fin ? '' : 'Le régime établi n\'est pas constant ici', ariaPressed: String(app.equivKind === 'inf'), onclick: () => toggle('inf') }),
    ));
    if (!fin) box.append(h('p', { class: 'note', text: 'Pas de schéma à t → ∞ : le régime établi n\'est pas constant.' }));
    if (app.equivKind) {
      const st = app.equivKind === '0' ? sim.firstSample(seg) : fin;
      const dl = h('dl', { class: 'values' });
      sim.net.comps.forEach((c, k) => {
        if (c.type === 'switch') return;
        dl.append(h('dt', { text: prettyLabel(c.label) }), h('dd', { text: `${formatSI(tidy(st.u[k], 'V'), 'V', 3)} · ${formatSI(tidy((isSource(c.type) ? -1 : 1) * st.i[k], 'A'), 'A', 3)}` }));
      });
      box.append(dl);
    }
    root.append(box);
  }

  // ---------- Lois de Kirchhoff, en direct ----------

  function updateKirchhoff() {
    const box = document.getElementById('kirch'), sim = app.sim, sel = app.editor.sel;
    if (!box || !sim || !sel) return;
    const s = app.view || app.state, name = (k) => prettyLabel(sim.net.comps[k].label);
    box.textContent = '';
    if (sel.comp) {
      const k = app.compIndex.get(sel.comp);
      const mesh = k === undefined ? null : sim.meshFor(k, sim.segmentAt(app.viewT));
      if (!mesh) { box.hidden = true; return; }
      box.hidden = false;
      const text = mesh.map((t, i) => `${t.sign < 0 ? (i ? ' − ' : '−') : (i ? ' + ' : '')}u(${name(t.k)})`).join('');
      const sum = mesh.reduce((a, t) => a + t.sign * s.u[t.k], 0);
      box.append(h('b', { text: 'Loi des mailles' }), h('div', { text }), h('div', { text: `= ${formatSI(Math.abs(sum) < 1e-6 ? 0 : sum, 'V', 3)}` }));
    } else if (sel.wire) {
      const key = sel.wire.values().next().value;
      const e = sim.net.edges.find((x) => x.key === key);
      if (!e) { box.hidden = true; return; }
      const b = sim.nodeBalance(e.net, s);
      box.hidden = false;
      box.append(h('b', { text: 'Loi des nœuds' }), h('div', { text: `Potentiel : ${formatSI(s.V[e.net], 'V', 3)}` }));
      for (const t of b.terms) box.append(h('div', { text: `${name(t.k)} : ${formatSI(t.i, 'A', 3)} arrivant` }));
      if (b.isGround && Math.abs(b.sum) > 1e-9) box.append(h('div', { text: `Masse : ${formatSI(-b.sum, 'A', 3)} (retour d'alimentation)` }), h('div', { text: 'Somme = 0' }));
      else box.append(h('div', { text: `Somme = ${formatSI(Math.abs(b.sum) < 1e-9 ? 0 : b.sum, 'A', 3)}` }));
    }
  }

  // ---------- Curseurs « et si… ? » ----------

  /** Recalcule jusqu'à l'instant courant. Pendant un glissement, tout est allégé. */
  function rebuildFromDoc(light) {
    const t = app.tNow > 0 ? app.tNow : (app.sim ? app.sim.tc : 0);
    const sim = new RLC.Sim(app.doc, light ? { maxBytes: 6e6, lookaheadMs: 30 } : {});
    if (sim.errors.length) { app.powerOff(); updateMessage(sim.errors); return; }
    attachSim(sim);
    sim.advanceTo(t, light ? 25 : 800);
    app.tNow = Math.min(t, sim.ctx.t);
  }

  function whatIfInput(c, def, value, input) {
    if (!app.whatIf) {
      app.whatIf = true;
      app.undo.push(JSON.stringify(app.doc));
      app.redo.length = 0;
      updateUndoButtons();
      if (app.sim) {
        // La courbe de départ reste affichée en pâle : on voit l'effet du changement.
        app.scope.refSim = app.sim;
        app.playing = false;
        syncPlayButtons();
        renderProbes();
      }
    }
    c.params[def.key] = value;
    input.value = fieldValue(value);
    if (app.sim) { rebuildFromDoc(true); renderModes(); }
    app.invalidate();
  }

  function whatIfEnd() {
    app.whatIf = false;
    store.set(AUTO_KEY, JSON.stringify(app.doc));
    if (app.sim) rebuildFromDoc(false);
    renderInspector();
    app.invalidate();
  }

  /** Curseur logarithmique, de la valeur centrale divisée par 100 à multipliée par 100. */
  function sliderFor(c, def, input) {
    const center = Math.abs(c.params[def.key]) || (def.min || 1);
    const range = h('input', { type: 'range', min: '-2', max: '2', step: '0.01', value: '0', ariaLabel: `${def.label} : curseur` });
    const sign = c.params[def.key] < 0 ? -1 : 1;
    range.addEventListener('input', () => whatIfInput(c, def, sign * center * Math.pow(10, +range.value), input));
    range.addEventListener('change', whatIfEnd);
    const els = [range];
    if (app.sim && def.unit && ['R', 'L', 'C'].includes(def.key)) {
      const k = app.compIndex.get(c.id);
      const seg = app.sim.segmentAt(app.tNow);
      const crit = k === undefined ? null : app.sim.criticalValue(seg, k, def.key);
      if (crit) {
        els.push(h('div', { class: 'critical' },
          h('span', { text: `Valeur critique (Q = 1/2) : ${formatSI(crit, def.unit, 3)}` }),
          h('button', {
            text: 'Y aller',
            onclick: () => { whatIfInput(c, def, crit, input); whatIfEnd(); },
          })));
      }
    }
    return els;
  }

  function renderCompPanel(root, c) {
    const T = TYPES[c.type];
    root.append(h('div', {},
      h('h3', { class: 'ins-title', text: `${T.name} ${c.type === 'ground' ? '' : prettyLabel(c.label)}` }),
      h('p', { class: 'ins-sub', text: T.hint }),
    ));
    if (c.type !== 'ground') {
      const nameInput = h('input', { value: c.label, maxLength: 8, id: 'fieldLabel' });
      nameInput.addEventListener('change', () => {
        const v = nameInput.value.trim();
        if (v && !app.doc.comps.some((x) => x !== c && x.label === v)) {
          app.undo.push(JSON.stringify(app.doc));
          c.label = v;
          if (app.sim) app.sim.net.comps.forEach((nc) => { if (nc.id === c.id) nc.label = v; });
          store.set(AUTO_KEY, JSON.stringify(app.doc));
          renderProbes();
          app.invalidate();
        } else nameInput.value = c.label;
      });
      root.append(h('div', { class: 'field' }, h('label', { text: 'Nom', htmlFor: 'fieldLabel' }), nameInput));
    }
    for (const def of T.params) {
      if (def.when && !def.when(c.params)) continue;
      root.append(paramField(c, def));
    }
    if (c.type === 'switch') {
      root.append(h('div', { class: 'btn-row' }, h('button', {
        text: app.closedState(c) ? 'Ouvrir' : 'Fermer',
        onclick: () => app.toggleSwitch(c.id),
      })));
    }
    if (c.type !== 'ground') {
      const hasU = app.doc.probes.some((p) => p.id === c.id && p.kind === 'u');
      const hasI = app.doc.probes.some((p) => p.id === c.id && p.kind === 'i');
      const row = h('div', { class: 'btn-row' },
        h('button', { text: 'Tracer u', class: hasU ? 'on' : '', 'ariaPressed': String(hasU), onclick: () => toggleProbe(c.id, 'u') }),
      );
      if (c.type !== 'voltmeter') row.append(h('button', { text: 'Tracer i', class: hasI ? 'on' : '', 'ariaPressed': String(hasI), onclick: () => toggleProbe(c.id, 'i') }));
      root.append(row);
      root.append(h('dl', { class: 'values', id: 'liveValues' }));
      if (app.sim && c.type !== 'opamp' && c.type !== 'voltmeter') root.append(h('div', { class: 'kirch', id: 'kirch' }));
    }
    root.append(h('div', { class: 'btn-row' },
      h('button', { text: 'Tourner (R)', onclick: () => app.editor.rotateAction() }),
      h('button', { text: 'Supprimer', onclick: () => app.editor.deleteSelection() }),
    ));
    if (c.type === 'opamp') {
      root.append(h('p', { class: 'note', text: 'u est le potentiel de la sortie par rapport à la masse, i le courant qui en sort. L\'alimentation n\'est pas dessinée.' }));
    } else if (c.type !== 'ground' && c.type !== 'voltmeter') {
      root.append(h('p', {
        class: 'note',
        text: isSource(c.type)
          ? 'Sélectionné, le composant affiche u (bleu) et i (rouge) en convention générateur.'
          : 'Sélectionné, le composant affiche u (bleu) et i (rouge) en convention récepteur.',
      }));
    }
  }

  function paramField(c, def) {
    const id = 'f_' + def.key;
    const wrap = h('div', { class: 'field' }, h('label', { text: def.label, htmlFor: id }));
    if (def.kind === 'select') {
      const sel = h('select', { id });
      def.options.forEach((o, i) => {
        const opt = h('option', { value: String(i), text: o.label });
        if (o.value === (def.key === 'closed' ? !!c.params.closed : c.params[def.key])) opt.selected = true;
        sel.append(opt);
      });
      sel.addEventListener('change', () => app.setParam(c, def, def.options[+sel.value].value));
      wrap.append(sel);
      return wrap;
    }
    const value = () => (def.plain ? String(c.params[def.key]).replace('.', ',') : fieldValue(c.params[def.key]));
    const input = h('input', { id, value: value(), inputMode: 'text', spellcheck: false, autocomplete: 'off' });
    const err = h('div', { class: 'err', hidden: true });
    input.addEventListener('change', () => {
      const v = parseSI(input.value);
      let msg = '';
      if (isNaN(v)) msg = 'Valeur illisible. Exemples : 4,7k — 100n — 1e-3';
      else if (def.min !== undefined && v < def.min) msg = `Minimum : ${formatSI(def.min, def.unit)}`;
      else if (def.max !== undefined && v > def.max) msg = `Maximum : ${formatSI(def.max, def.unit)}`;
      err.textContent = msg;
      err.hidden = !msg;
      input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      if (msg) return;
      app.setParam(c, def, v);
      input.value = value();
    });
    wrap.append(h('div', { class: 'row' }, input, def.unit ? h('span', { class: 'unit', text: def.unit }) : null), err);
    if (def.slider) wrap.append(...sliderFor(c, def, input));
    return wrap;
  }

  /** Valeur éditable : préfixe SI sans unité, l'unité étant affichée à côté. */
  function fieldValue(v) {
    return formatSI(v, '', 5).replace(/ /g, ' ');
  }

  function updateLiveValues() {
    const box = $('liveValues');
    const sel = app.editor.sel;
    if (!box || !sel || !sel.comp) return;
    box.textContent = '';
    if (!app.sim) { box.hidden = true; return; }
    const k = app.compIndex.get(sel.comp);
    if (k === undefined) { box.hidden = true; return; }
    box.hidden = false;
    const nc = app.sim.net.comps[k], s = app.state;
    const u = s.u[k], i = (isSource(nc.type) ? -1 : 1) * s.i[k];
    const row = (a, b) => box.append(h('dt', { text: a }), h('dd', { text: b }));
    if (nc.type === 'opamp') {
      const vsat = app.sim.segments[s.segIdx].params[k].vsat;
      row('Sortie s', formatSI(u, 'V', 4));
      row('ε = e+ − e−', formatSI(s.V[nc.a] - s.V[nc.b], 'V', 3));
      row('i de sortie', formatSI(i, 'A', 3));
      row('État', Math.abs(u) >= 0.99 * vsat ? `Saturé ${u > 0 ? '+' : '−'}` : 'Linéaire ou en transition');
      return;
    }
    row('u', formatSI(u, 'V', 4));
    if (nc.type !== 'voltmeter') {
      row('i', formatSI(i, 'A', 4));
      row(isSource(nc.type) ? 'P fournie' : 'P reçue', formatSI(u * i, 'W', 3));
    }
    const seg = app.sim.segments[s.segIdx];
    if (nc.type === 'lamp') {
      const umax = sel.comp ? app.doc.comps.find((x) => x.id === sel.comp).params.Umax : 1;
      row('Éclat |u|/Umax', `${Math.round(RLC.circuit.lampLevel(u, { Umax: umax }) * 100)} %`);
      if (Math.abs(u) > umax) row('Attention', 'u dépasse Umax');
    }
    if (nc.type === 'capacitor') {
      row('q = Cu', formatSI(seg.params[k].C * u, 'C', 3));
      row('Énergie ½Cu²', formatSI(0.5 * seg.params[k].C * u * u, 'J', 3));
    }
    if (nc.type === 'inductor') row('Énergie ½Li²', formatSI(0.5 * seg.params[k].L * i * i, 'J', 3));
  }

  /** Grandeurs propres du circuit : τ, ω₀, Q, nature du régime libre. */
  function renderModes() {
    const box = document.getElementById('modesBox');
    if (!box) return;
    const eqLine = (txt) => h('div', { class: 'eq', text: txt });
    box.textContent = '';
    box.append(h('h2', { text: 'Régime libre' }));
    if (!app.sim) {
      box.append(h('p', { class: 'note', text: 'Disponible à la mise sous tension : τ, ω₀, Q et nature du régime.' }));
      return;
    }
    const seg = app.sim.segments[app.state ? (app.state.segIdx || 0) : 0] || app.sim.segments[0];
    if (seg.nl) {
      const nl = seg.nl;
      const text = {
        stationary: 'L\'état final est stationnaire. Il a été trouvé par simulation anticipée.',
        forced: `Le régime établi suit la source, de période T = ${formatSI(nl.T, 's', 3)}. Il a été trouvé par simulation anticipée.`,
        oscillator: `Oscillations auto-entretenues de période T = ${formatSI(nl.T, 's', 4)}, soit f = ${formatSI(1 / (nl.T || 1), 'Hz', 4)}.`,
        unknown: 'Aucun état stationnaire ni signal périodique n\'a été trouvé.',
      }[nl.kind];
      box.append(
        h('p', { class: 'note', text: 'Circuit non linéaire : τ, ω₀ et Q ne sont pas définis globalement.' }),
        h('div', { class: 'mode', text }),
      );
      return;
    }
    const items = seg.summary.items;
    if (!items.length) {
      box.append(h('p', { class: 'note', text: 'Aucune dynamique propre dans cette configuration : le circuit suit ses sources sans retard.' }));
      return;
    }
    const div = (...kids) => box.append(h('div', { class: 'mode' }, ...kids));
    const line = (label, value) => h('div', {}, label + ' : ', h('b', { text: value }));
    for (const m of items) {
      if (m.kind === 'premier') div(h('b', { text: 'Premier ordre' }), line('τ', formatSI(m.tau, 's', 3)),
        eqLine(`τ dx/dt + x = x∞, avec τ = ${formatSI(m.tau, 's', 3)}`), eqLine('x(t) = x∞ + (x(0⁺) − x∞) e^(−t/τ)'));
      else if (m.kind === 'pseudo') div(h('b', { text: 'Pseudo-périodique' }), line('ω₀', formatSI(m.w0, 'rad/s', 4)), line('Q', formatSI(m.Q, '', 3)), line('τ', formatSI(m.tau, 's', 3)), line('T', formatSI(m.T, 's', 3)),
        eqLine(`x″ + (ω₀/Q) x′ + ω₀² (x − x∞) = 0, avec ω₀/Q = ${formatSI(m.w0 / m.Q, '/s', 3)}`),
        eqLine(`r = ${formatSI(m.lambda.re, '', 3)} ± j ${formatSI(m.wp, '', 4)} rad/s`));
      else if (m.kind === 'harmonique') div(h('b', { text: 'Oscillateur harmonique' }), line('ω₀', formatSI(m.w0, 'rad/s', 4)), line('T₀', formatSI(m.T, 's', 3)),
        eqLine('x″ + ω₀² (x − x∞) = 0'));
      else if (m.kind === 'critique') div(h('b', { text: 'Régime critique' }), line('ω₀', formatSI(m.w0, 'rad/s', 4)), line('Q', formatSI(m.Q, '', 3)), line('τ', formatSI(m.tau1, 's', 3)),
        eqLine('x″ + 2ω₀ x′ + ω₀² (x − x∞) = 0'), eqLine('x(t) = x∞ + (A + Bt) e^(−ω₀t)'));
      else if (m.kind === 'aperiodique') div(h('b', { text: 'Apériodique' }), line('ω₀', formatSI(m.w0, 'rad/s', 4)), line('Q', formatSI(m.Q, '', 3)), line('τ₁', formatSI(m.tau1, 's', 3)), line('τ₂', formatSI(m.tau2, 's', 3)),
        eqLine('x″ + (ω₀/Q) x′ + ω₀² (x − x∞) = 0'), eqLine('x(t) = x∞ + A e^(−t/τ₁) + B e^(−t/τ₂)'));
    }
  }

  // ---------- Sondes ----------

  function toggleProbe(id, kind) {
    const probes = app.doc.probes;
    const i = probes.findIndex((p) => p.id === id && p.kind === kind);
    if (i >= 0) probes.splice(i, 1);
    else {
      if (probes.length >= 6) { toast('Six graphiques au maximum : retirez-en un d\'abord.'); return; }
      probes.push(/** @type {any} */ ({ id, kind, slot: freeSlot() }));
    }
    store.set(AUTO_KEY, JSON.stringify(app.doc));
    renderInspector();
    renderProbes();
    app.invalidate();
  }

  /** Chaque sonde garde sa couleur tant qu'elle existe. */
  function freeSlot() {
    const used = new Set(app.doc.probes.map((p) => p.slot));
    for (let s = 0; s < 7; s++) if (!used.has(s)) return s;
    return 0;
  }

  function renderProbes() {
    const root = $('probes');
    root.textContent = '';
    // Les documents de la bibliothèque n'ont pas de couleur attribuée.
    app.doc.probes.forEach((p, i) => { if (p.slot === undefined) p.slot = i; });
    for (const p of app.doc.probes) {
      const c = app.doc.comps.find((x) => x.id === p.id);
      if (!c) continue;
      const swatch = document.createElement('i');
      swatch.style.background = (app.theme.series[(p.slot ?? 0) % 7]);
      const k = app.compIndex.get(p.id);
      const value = h('span', { text: '—' });
      if (app.sim && k !== undefined) {
        value.dataset.probeValue = '1';
        value.dataset.k = String(k);
        value.dataset.kind = p.kind;
      }
      root.append(h('span', { class: 'chip' },
        swatch,
        h('span', { text: `${p.kind}(${prettyLabel(c.label)}) =` }),
        value,
        h('button', { text: '×', ariaLabel: `Retirer ${p.kind}(${c.label})`, title: 'Retirer ce graphique', onclick: () => toggleProbe(p.id, p.kind) }),
      ));
    }
    const legend = h('span', { class: 'legend' });
    const check = (label, title, get, set) => {
      const box = h('input', { type: 'checkbox', checked: get() });
      box.addEventListener('change', () => { set(box.checked); app.invalidate(); });
      return h('label', { title }, box, label);
    };
    if (app.scope.refSim) {
      legend.append(h('button', { text: 'Effacer la référence', title: 'Retirer la courbe pâle laissée par le curseur', onclick: () => { app.scope.refSim = null; renderProbes(); app.invalidate(); } }));
    }
    legend.append(
      check('Permanent', 'Courbe tiretée : solution du régime permanent', () => app.scope.showSteady, (v) => { app.scope.showSteady = v; }),
      check('Transitoire', 'Courbe pointillée : écart entre le signal et le régime permanent', () => app.scope.showTransient, (v) => { app.scope.showTransient = v; }),
      h('button', { id: 'btnWindow', text: 'Tout voir', title: 'Afficher toute la durée simulée, ou revenir à la fenêtre glissante (molette : zoom)', onclick: () => { app.scope.showAll = !app.scope.showAll; syncWindowButton(); app.invalidate(); } }),
      h('button', { text: 'CSV', title: 'Exporter les valeurs des graphiques', onclick: exportCSV }),
    );
    root.append(legend);
    syncWindowButton();
    if (app.sim) updateProbeValues(app.sim);
  }

  function syncWindowButton() {
    const b = document.getElementById('btnWindow');
    if (b) b.classList.toggle('on', app.scope.showAll);
  }

  function exportCSV() {
    const sim = app.sim;
    if (!sim || !app.doc.probes.length) { toast('Mettez le circuit sous tension et ajoutez un graphique d\'abord.'); return; }
    const traces = buildTraces(sim);
    const head = ['t (s)', ...traces.map((t) => `${t.kind}_${sim.net.comps[t.k].label} (${t.kind === 'i' ? 'A' : 'V'})`)];
    const rows = [head.join(';')];
    const stride = Math.max(1, Math.floor(sim.len / 20000));
    for (let r = 0; r < sim.len; r += stride) {
      const line = [sim.h[r * sim.width]];
      for (const t of traces) line.push(t.sign * sim.valueAtIndex(r, t.k, t.kind));
      rows.push(line.join(';'));
    }
    download(`${safeName(app.doc.name)}.csv`, rows.join('\n'), 'text/csv');
  }

  // ---------- Fichiers et stockage ----------

  const safeName = (s) => String(s || 'circuit').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'circuit';
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function readCircuits() {
    try { return JSON.parse(store.get(STORE_KEY) || '{}') || {}; } catch { return {}; }
  }

  function saveCurrent() {
    const name = ($('docName').value || '').trim() || 'Sans titre';
    app.doc.name = name;
    const all = readCircuits();
    all[name] = { doc: app.doc, savedAt: Date.now() };
    if (store.set(STORE_KEY, JSON.stringify(all))) toast(`« ${name} » enregistré dans ce navigateur.`);
    else toast('Enregistrement impossible : stockage du navigateur indisponible. Utilisez Exporter.');
  }

  /** Contrôle un document importé et complète ce qui manque. Lève une erreur si inutilisable. */
  function sanitizeDoc(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.comps) || !Array.isArray(raw.wires)) throw new Error('Ce fichier ne décrit pas un circuit.');
    const doc = newDoc(typeof raw.name === 'string' ? raw.name.slice(0, 60) : 'Importé');
    const ids = new Set();
    for (const c of raw.comps) {
      if (!c || !TYPES[c.type]) throw new Error(`Composant inconnu : ${c && c.type}`);
      if (![c.x, c.y, c.id].every(Number.isInteger)) throw new Error('Position de composant invalide.');
      if (ids.has(c.id)) throw new Error('Identifiant de composant en double.');
      ids.add(c.id);
      /** @type {any} */
      const params = RLC.circuit.defaultParams(c.type);
      for (const d of TYPES[c.type].params) {
        const v = c.params ? c.params[d.key] : undefined;
        if (d.kind === 'select') { if (d.options.some((o) => o.value === v)) params[d.key] = v; }
        else if (typeof v === 'number' && isFinite(v) && (d.min === undefined || v >= d.min)) params[d.key] = v;
      }
      doc.comps.push({
        id: c.id, type: c.type, x: c.x, y: c.y, rot: Number.isInteger(c.rot) ? ((c.rot % 4) + 4) % 4 : 0,
        label: typeof c.label === 'string' && c.label ? c.label.slice(0, 8) : TYPES[c.type].prefix + c.id, params,
      });
    }
    doc.wires = [...new Set(raw.wires.filter((w) => typeof w === 'string' && /^-?\d+,-?\d+,[hv]$/.test(w)))];
    if (Array.isArray(raw.probes)) {
      for (const p of raw.probes.slice(0, 6)) {
        if (p && ids.has(p.id) && (p.kind === 'u' || p.kind === 'i')) {
          doc.probes.push(/** @type {any} */ ({ id: p.id, kind: p.kind, slot: Number.isInteger(p.slot) ? p.slot : undefined }));
        }
      }
    }
    doc.nextId = Math.max(0, ...ids) + 1;
    if (RLC.library.some((e) => e.id === raw.guideId)) /** @type {any} */ (doc).guideId = raw.guideId;
    return doc;
  }

  function openLibrary() {
    const body = $('libBody');
    body.textContent = '';
    /** @type {Map<string, any[]>} */
    const byTheme = new Map();
    for (const e of RLC.library) {
      if (!byTheme.has(e.theme)) byTheme.set(e.theme, []);
      /** @type {any} */ (byTheme.get(e.theme)).push(e);
    }
    const thumbs = [];
    for (const [theme, list] of byTheme) {
      body.append(h('div', { class: 'theme-title', text: theme }));
      const cards = h('div', { class: 'cards' });
      for (const e of list) {
        const cv = h('canvas', { ariaHidden: 'true' });
        thumbs.push([cv, e]);
        cards.append(h('button', {
          class: 'card',
          onclick: () => {
            $('dlgLibrary').close();
            app.undo.push(JSON.stringify(app.doc));
            app.redo.length = 0;
            const doc = e.build();
            doc.guideId = e.id;
            app.loadDoc(doc);
          },
        }, cv, h('strong', { text: e.name }), h('span', { text: e.desc })));
      }
      body.append(cards);
    }
    $('dlgLibrary').showModal();
    // Les vignettes se dessinent une fois la fenêtre mise en page.
    for (const [cv, e] of thumbs) thumbnail(cv, e.build(), app.theme);
  }

  function openMine() {
    const body = $('mineBody');
    body.textContent = '';
    const all = readCircuits();
    const names = Object.keys(all).sort((a, b) => all[b].savedAt - all[a].savedAt);
    if (!names.length) body.append(h('p', { class: 'empty', text: 'Aucun circuit enregistré pour l\'instant. « Enregistrer » conserve le circuit courant dans ce navigateur.' }));
    for (const name of names) {
      const entry = all[name];
      const row = h('div', { class: 'mine-row' },
        h('span', { class: 'name', text: name }),
        h('span', { class: 'date', text: new Date(entry.savedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) }),
        h('button', {
          text: 'Ouvrir',
          onclick: () => {
            try {
              const doc = sanitizeDoc(entry.doc);
              $('dlgMine').close();
              app.undo.push(JSON.stringify(app.doc));
              app.redo.length = 0;
              app.loadDoc(doc);
            } catch (err) { toast(/** @type {Error} */ (err).message); }
          },
        }),
        h('button', { text: 'Exporter', onclick: () => download(`${safeName(name)}.json`, JSON.stringify(entry.doc, null, 1), 'application/json') }),
        h('button', {
          text: 'Supprimer',
          onclick: () => {
            if (!confirm(`Supprimer définitivement « ${name} » ?`)) return;
            const cur = readCircuits();
            delete cur[name];
            store.set(STORE_KEY, JSON.stringify(cur));
            openMine();
          },
        }),
      );
      body.append(row);
    }
    if (!$('dlgMine').open) $('dlgMine').showModal();
  }

  function updateUndoButtons() {
    $('btnUndo').disabled = !app.undo.length;
    $('btnRedo').disabled = !app.redo.length;
  }

  function doUndo(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(app.doc));
    const doc = JSON.parse(/** @type {string} */ (from.pop()));
    app.loadDoc(doc, false);
    updateUndoButtons();
  }

  // ---------- Transport ----------

  function syncPlayButtons() {
    const on = !!app.sim;
    for (const id of ['btnStart', 'btnBack', 'btnPause', 'btnFwd', 'timeline', 'btnAuto']) $(id).disabled = !on;
    $('btnBack').classList.toggle('on', on && app.playing && app.dir < 0);
    $('btnFwd').classList.toggle('on', on && app.playing && app.dir > 0);
    $('btnPause').classList.toggle('on', on && !app.playing);
  }

  function seek(t) {
    const sim = app.sim;
    if (!sim) return;
    app.tNow = Math.max(0, Math.min(t, sim.ctx.t));
    app.invalidate();
  }

  function bindUI() {
    $('btnPower').addEventListener('click', () => { if (app.sim) app.powerOff(); else app.powerOn(); });
    $('btnStart').addEventListener('click', () => { seek(0); app.playing = false; syncPlayButtons(); });
    $('btnBack').addEventListener('click', () => { app.dir = -1; app.playing = app.tNow > 0; syncPlayButtons(); });
    $('btnFwd').addEventListener('click', () => { app.dir = 1; app.playing = true; syncPlayButtons(); });
    $('btnPause').addEventListener('click', () => { app.playing = false; syncPlayButtons(); app.invalidate(); });
    $('timeline').addEventListener('input', () => {
      const sim = app.sim;
      if (!sim) return;
      app.playing = false;
      syncPlayButtons();
      seek(+$('timeline').value / 1000 * sim.ctx.t);
      $('tNow').textContent = formatSI(app.tNow, 's', 4);
    });
    $('speed').addEventListener('input', () => setSpeed(Math.pow(10, +$('speed').value)));
    $('btnAuto').addEventListener('click', () => { autoTiming(); app.invalidate(); });

    $('btnNew').addEventListener('click', () => {
      app.undo.push(JSON.stringify(app.doc));
      app.redo.length = 0;
      app.loadDoc(newDoc());
    });
    $('btnLibrary').addEventListener('click', openLibrary);
    $('btnMine').addEventListener('click', openMine);
    $('btnSave').addEventListener('click', saveCurrent);
    $('btnExport').addEventListener('click', () => {
      app.doc.name = ($('docName').value || '').trim() || 'Sans titre';
      download(`${safeName(app.doc.name)}.json`, JSON.stringify(app.doc, null, 1), 'application/json');
    });
    $('btnImport').addEventListener('click', () => $('fileImport').click());
    $('fileImport').addEventListener('change', async () => {
      const f = $('fileImport').files[0];
      $('fileImport').value = '';
      if (!f) return;
      try {
        const doc = sanitizeDoc(JSON.parse(await f.text()));
        app.undo.push(JSON.stringify(app.doc));
        app.redo.length = 0;
        app.loadDoc(doc);
        toast(`« ${doc.name} » importé.`);
      } catch (err) {
        toast(`Import impossible : ${/** @type {Error} */ (err).message}`);
      }
    });
    $('btnUndo').addEventListener('click', () => doUndo(app.undo, app.redo));
    $('btnRedo').addEventListener('click', () => doUndo(app.redo, app.undo));
    $('docName').addEventListener('change', () => {
      app.doc.name = $('docName').value.trim() || 'Sans titre';
      store.set(AUTO_KEY, JSON.stringify(app.doc));
    });
    $('btnTheme').addEventListener('click', () => {
      const dark = getComputedStyle(document.documentElement).colorScheme.includes('dark');
      const next = dark ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      store.set(THEME_KEY, next);
      refreshTheme();
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshTheme);

    $('btnValues').addEventListener('click', () => {
      app.showValues = !app.showValues;
      $('btnValues').setAttribute('aria-pressed', String(app.showValues));
      $('btnValues').classList.toggle('on', app.showValues);
      app.invalidate();
    });
    $('zoomIn').addEventListener('click', () => app.editor.zoomAt(app.renderer.w / 2, app.renderer.h / 2, 1.25));
    $('zoomOut').addEventListener('click', () => app.editor.zoomAt(app.renderer.w / 2, app.renderer.h / 2, 0.8));
    $('zoomFit').addEventListener('click', () => { app.renderer.fit(app.doc); app.invalidate(); });

    for (const d of document.querySelectorAll('dialog')) {
      d.addEventListener('click', (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        if (t === d || t.hasAttribute('data-close')) d.close();
      });
    }

    window.addEventListener('keydown', (e) => {
      const tag = /** @type {HTMLElement} */ (e.target).tagName;
      const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveCurrent(); return; }
      if (document.body.dataset.tab === 'components') return; // le schéma est caché : ses raccourcis aussi
      if (typing || document.querySelector('dialog[open]')) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doUndo(app.redo, app.undo); else doUndo(app.undo, app.redo); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doUndo(app.redo, app.undo); return; }
      if (mod) return;
      switch (e.key) {
        case 'Delete': case 'Backspace': e.preventDefault(); app.editor.deleteSelection(); break;
        case 'r': case 'R': app.editor.rotateAction(); break;
        case 'Escape': app.editor.setTool('select'); app.editor.select(null); break;
        case 'w': case 'W': app.editor.setTool('wire'); break;
        case ' ':
          if (tag === 'BUTTON') return;
          e.preventDefault();
          if (app.sim) { app.playing = !app.playing; if (app.playing && app.dir < 0 && app.tNow <= 0) app.dir = 1; syncPlayButtons(); }
          else app.powerOn();
          break;
        case 'Home': seek(0); break;
        case 'ArrowLeft': if (app.sim) { app.playing = false; syncPlayButtons(); seek(app.tNow - app.speed / 20); } break;
        case 'ArrowRight':
          if (app.sim) {
            app.playing = false; syncPlayButtons();
            const t = app.tNow + app.speed / 20;
            if (t > app.sim.ctx.t) app.sim.advanceTo(t, 30);
            seek(t);
          }
          break;
      }
    });

    new ResizeObserver(() => {
      app.renderer.resize();
      app.scope.resize();
      // Le dessin immédiat évite le clignotement du canvas vidé par le redimensionnement.
      drawAll();
    }).observe($('stage'));
    new ResizeObserver(() => { app.scope.resize(); drawAll(); }).observe($('scopeWrap'));
  }

  function refreshTheme() {
    app.theme = readTheme();
    app.renderer.theme = app.theme;
    buildPalette();
    renderProbes();
    app.invalidate();
  }

  function buildPalette() {
    const tools = $('tools'), parts = $('parts');
    tools.textContent = '';
    parts.textContent = '';
    const toolBtn = (id, label, glyph) => {
      const b = h('button', { title: label }, h('span', { text: glyph, style: 'width:34px;text-align:center' }), h('span', { text: label }));
      b.dataset.tool = id;
      b.setAttribute('aria-pressed', app.editor.tool === id ? 'true' : 'false');
      b.addEventListener('click', () => app.editor.setTool(id));
      tools.append(b);
    };
    toolBtn('select', 'Sélection', '↖');
    toolBtn('wire', 'Fil', '╱');
    toolBtn('erase', 'Gomme', '⌫');
    const order = ['resistor', 'lamp', 'capacitor', 'inductor', 'diode', 'switch', 'vsource', 'isource', 'opamp', 'voltmeter', 'ground'];
    const short = { vsource: 'Gén. de tension', isource: 'Gén. de courant' };
    for (const type of order) {
      const cv = h('canvas', { ariaHidden: 'true' });
      const b = h('button', { title: `${TYPES[type].name} — ${TYPES[type].hint}` }, cv, h('span', { text: short[type] || TYPES[type].name }));
      b.dataset.tool = type;
      b.setAttribute('aria-pressed', app.editor.tool === type ? 'true' : 'false');
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); app.editor.startPaletteDrag(type, e); });
      parts.append(b);
      icon(cv, type, app.theme);
    }
  }

  function init() {
    const savedTheme = store.get(THEME_KEY);
    if (savedTheme === 'dark' || savedTheme === 'light') document.documentElement.dataset.theme = savedTheme;
    app.theme = readTheme();
    app.renderer = new Renderer($('board'));
    app.scope = new RLC.Scope($('scope'), $('tooltip'));
    app.scope.onSeek = (t) => { app.playing = false; syncPlayButtons(); seek(t); };
    app.scope.onHover = () => app.invalidate();
    app.editor = new RLC.Editor(app, $('board'), app.renderer);
    buildPalette();
    bindUI();
    setSpeed(1e-3);

    let doc = null;
    try {
      const raw = store.get(AUTO_KEY);
      if (raw) doc = sanitizeDoc(JSON.parse(raw));
    } catch { doc = null; }
    if (!doc) { doc = RLC.library.find((e) => e.id === 'rlc-pseudo').build(); doc.guideId = 'rlc-pseudo'; }
    app.loadDoc(doc);
    syncPlayButtons();
    updateUndoButtons();
    requestAnimationFrame((t) => { lastFrame = t; frame(t); });
    RLC.app = app; // accessible depuis la console, pratique pour explorer
  }

  init();
})(/** @type {any} */ (globalThis).RLC ??= {});
