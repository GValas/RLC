// @ts-check
// Parcours guidés : pour chaque circuit, des instants clés et ce qu'il faut y comprendre.
// t est en secondes ; à chaque étape, le temps se place à t et s'arrête.
(function (RLC) {
  'use strict';

  /** @type {Object<string, {t:number, text:string}[]>} */
  const GUIDES = {
    'rc-charge': [
      { t: 0, text: 'K est fermé et C est vide. La tension d\'un condensateur est continue : juste après t = 0, u_C vaut encore 0. Combien vaut alors i ?' },
      { t: 1e-3, text: 't = τ = RC = 1 ms : u_C a atteint 63 % de E, soit 3,16 V. Le courant, lui, a chuté à 37 % de E/R.' },
      { t: 6e-3, text: 'Après environ 5τ, u_C ≈ E et i ≈ 0 : en régime continu établi, un condensateur se comporte comme un interrupteur ouvert.' },
    ],
    'rc-decharge': [
      { t: 1.9e-3, text: 'K est encore ouvert : aucun courant, C garde ses 5 V. K va se fermer à 2 ms. u_C peut-elle sauter à cet instant ? Et i ?' },
      { t: 2.01e-3, text: 'u_C n\'a presque pas bougé, mais i a sauté à u_C/R = 5 mA : seule la tension du condensateur est tenue d\'être continue.' },
      { t: 3e-3, text: 'Une constante de temps après la fermeture, u_C = 5 e⁻¹ ≈ 1,84 V. L\'énergie ½Cu² se dissipe dans R.' },
    ],
    'rl-etablissement': [
      { t: 0, text: 'Le courant dans une bobine est continu : juste après t = 0, i vaut encore 0. Combien vaut alors u_L ?' },
      { t: 1e-4, text: 't = τ = L/R = 0,1 ms : i a atteint 63 % de E/R, soit 31,6 mA. u_L est retombée à 37 % de E.' },
      { t: 6e-4, text: 'Après environ 5τ, i ≈ E/R = 50 mA et u_L ≈ 0 : en régime continu établi, une bobine idéale se comporte comme un fil.' },
    ],
    'rl-rupture': [
      { t: 0.99e-3, text: 'i monte vers E/R, et vaut ici environ 31 mA. K va s\'ouvrir à 1 ms. i ne peut pas sauter : par où ce courant va-t-il passer ?' },
      { t: 1.005e-3, text: 'Il passe dans Rp. u_L = −Rp·i ≈ −30 V : six fois E, et de signe opposé ! C\'est la surtension à la coupure.' },
      { t: 2e-3, text: 'La décharge se fait avec τ = L/Rp = 0,1 ms, bien plus vite que la charge (L/R = 1 ms) : ce sont deux circuits différents.' },
    ],
    'lc-ideal': [
      { t: 0, text: 'C est chargé à 5 V, i = 0 : toute l\'énergie est dans le condensateur.' },
      { t: 157e-6, text: 't = T₀/4 : u_C = 0 et i est maximal, E√(C/L) = 50 mA. Toute l\'énergie est maintenant dans la bobine.' },
      { t: 628e-6, text: 't = T₀ = 2π√(LC) : retour à l\'état initial. Sans résistance, rien n\'est perdu : il n\'y a pas de régime permanent.' },
    ],
    'rlc-pseudo': [
      { t: 0, text: 'Q = 5 : à quoi vous attendez-vous pour u_C ? Dépassera-t-elle E = 5 V ?' },
      { t: 3.16e-4, text: 'Premier maximum à une demi-pseudo-période : u_C ≈ 8,6 V, bien au-delà de E. La bobine, lancée, continue de charger C.' },
      { t: 6e-3, text: 'L\'enveloppe décroît avec τ = 2L/R = 1 ms. Environ Q oscillations sont visibles avant que le régime ne s\'établisse.' },
    ],
    'rlc-critique': [
      { t: 0, text: 'R = 2√(L/C) = 200 Ω, soit Q = 1/2 : la limite exacte entre oscillations et retour sans oscillation.' },
      { t: 2e-4, text: 'Le discriminant est nul : u_C = E(1 − (1 + ω₀t)e^(−ω₀t)). À ω₀t = 2, elle atteint déjà 59 % de E.' },
      { t: 1e-3, text: 'u_C est arrivée sans dépasser E. Essayez le curseur de R : un peu moins, et une oscillation apparaît.' },
    ],
    'rlc-aperiodique': [
      { t: 0, text: 'R ≫ 2√(L/C) : deux constantes de temps réelles et très différentes, τ₂ ≈ L/R = 10 µs et τ₁ ≈ RC = 1 ms.' },
      { t: 5e-5, text: 'Après quelques τ₂, le courant s\'est établi. La bobine n\'a plus d\'effet sensible : on croirait un simple circuit RC.' },
      { t: 6e-3, text: 'u_C a suivi la montée lente en τ₁. Le mode rapide est invisible à cette échelle.' },
    ],
    'rlc-parallele': [
      { t: 0, text: 'I est imposé. Juste après t = 0, le courant de L et la tension de C sont nuls : où passe I ?' },
      { t: 2e-5, text: 'Il passe surtout dans C, qui se charge. Ici, Q = R√(C/L) = 5 : un grand R donne un grand Q, l\'inverse du RLC série.' },
      { t: 8e-3, text: 'En régime continu, L est un fil : tout I y passe et u = 0. R et C ne voient plus rien.' },
    ],
    'rlc-resonance': [
      { t: 0, text: 'La source est à f₀ = 1/(2π√(LC)) ≈ 1,59 kHz. Que devient l\'impédance du circuit à cette fréquence ?' },
      { t: 2e-3, text: 'L\'amplitude de i monte progressivement, avec τ = 2L/R = 1 ms. Il faut quelques τ pour atteindre la résonance.' },
      { t: 8e-3, text: 'i atteint E/R = 50 mA et u_C atteint Q·E = 5 V : 5 fois la tension de la source ! L et C se compensent exactement.' },
    ],
    'rc-sinus': [
      { t: 0, text: 'f = 1/(2πRC) est la fréquence de coupure. Le régime permanent est atteint après quelques τ = 1 ms, bien moins qu\'une période de 6,3 ms.' },
      { t: 25e-3, text: 'En régime établi, u_C a pour amplitude E/√2 et un retard de phase de 45°, soit T/8. Lisez-le sur les courbes.' },
    ],
    'rc-creneaux': [
      { t: 0, text: 'T = 2τ : u_C n\'a pas le temps de rejoindre ± E à chaque demi-période.' },
      { t: 1e-3, text: 'Premier front à venir : u_C reprend en exponentielle vers −E, depuis la valeur atteinte.' },
      { t: 10e-3, text: 'Régime périodique établi : u_C oscille entre ± E·tanh(T/4τ) = ± 2,31 V, symétriquement autour de 0.' },
    ],
    'rlc-creneaux': [
      { t: 0, text: 'Chaque front du créneau est un échelon de 10 V pour un RLC de Q ≈ 3,3. Que voit-on à chaque front ?' },
      { t: 2.5e-3, text: 'Une réponse pseudo-périodique complète, qui commence à chaque front et s\'amortit avant le suivant.' },
      { t: 12e-3, text: 'Le signal reste périodique. Le dépassement répété à chaque front est la « sonnerie » bien connue en électronique.' },
    ],
    diviseur: [
      { t: 1e-3, text: 'Pas de condensateur ni de bobine : le régime est immédiat. u_R2 = E·R2/(R1+R2) = 7,5 V et i = 2,5 mA.' },
    ],
    'partage-charge': [
      { t: 0.9e-3, text: 'C₁ porte 10 V et 50 µJ, C₂ est vide. K va se fermer. Quelle sera la tension finale ? Et l\'énergie ?' },
      { t: 2e-3, text: 'La charge se conserve : 5 V sur chacun. L\'énergie vaut 2 × ½ C × 25 V², soit 25 µJ : la moitié est partie dans R, quelle que soit sa valeur !' },
    ],
    'diode-simple': [
      { t: 5e-3, text: 'Crête de E : la diode conduit et u_R ≈ E − Vd = 9,4 V. C\'est le seuil qui est perdu.' },
      { t: 15e-3, text: 'Alternance négative : diode bloquée, i ≈ 0, u_R ≈ 0. Toute la tension inverse est aux bornes de la diode.' },
    ],
    'diode-graetz': [
      { t: 5e-3, text: 'E > 0 : D₁ et D₄ conduisent. Suivez les points de courant : ils traversent R de haut en bas.' },
      { t: 15e-3, text: 'E < 0 : c\'est au tour de D₂ et D₃, et le courant traverse R dans le même sens. u_R reste positive, à E − 2Vd en crête.' },
    ],
    'diode-crete': [
      { t: 5e-3, text: 'Première crête : C se charge à travers la diode, jusqu\'à environ 9,4 V.' },
      { t: 17e-3, text: 'La tension d\'entrée est retombée : la diode se bloque et C se décharge lentement dans R, avec τ = RC = 0,1 s.' },
      { t: 410e-3, text: 'Le régime établi : une ondulation de l\'ordre de U·T/RC autour d\'une valeur presque continue. Plus C est grand, moins elle est marquée.' },
    ],
    'diode-ecreteur': [
      { t: 2.5e-3, text: 'E monte à 5 V, mais D₁ conduit dès 0,6 V : la sortie est retenue, et le reste de la tension tombe dans R.' },
      { t: 7.5e-3, text: 'Alternance négative : c\'est D₂ qui conduit. La sortie reste entre ± Vd, et le signal écrêté devient presque carré.' },
    ],
    'diode-zener': [
      { t: 2.5e-3, text: 'E = 15 V. Rs voit (15 − 5,1) V, soit 45 mA. Rc n\'en prend que 5 mA : la Zener absorbe tout le reste.' },
      { t: 7.5e-3, text: 'E = 9 V. Le courant de Rs tombe à 18 mA, seule la part de la Zener a changé. u_Rc reste près de 5,1 V.' },
    ],
    'diode-roue-libre': [
      { t: 9.9e-3, text: 'Courant établi vers E/r = 240 mA. La diode, en inverse, est bloquée. K va s\'ouvrir : par où passera i ?' },
      { t: 10.2e-3, text: 'Dans la diode, qui devient passante. La bobine ne voit que −(Vd + Rd·i), moins de 1 V. Comparez avec « Rupture du courant ».' },
      { t: 20e-3, text: 'i décroît avec τ = L/r = 2 ms : l\'énergie de la bobine se dissipe tranquillement dans r et la diode.' },
    ],
    'aop-suiveur': [
      { t: 2.5e-4, text: 'Contre-réaction totale : e− = s. Si ε ≈ 0, alors s = e+ = u_e. Le gain vaut 1, mais à quoi sert ce montage ?' },
      { t: 7.5e-4, text: 'À ceci : l\'entrée ne fournit aucun courant, alors que la sortie alimente Rc. Le suiveur isole la source de sa charge.' },
    ],
    'aop-inverseur': [
      { t: 2.5e-4, text: 'ε ≈ 0 : e− est une masse virtuelle. Dans R₁ passe u_e/R₁, et ce courant n\'entre pas dans l\'AOP : il continue dans R₂.' },
      { t: 7.5e-4, text: 'D\'où u_s = −R₂·u_e/R₁ = −10 u_e. Vérifiez ε dans l\'inspecteur de l\'AOP : il reste très faible.' },
    ],
    'aop-non-inverseur': [
      { t: 2.5e-4, text: 'R₁ et R₂ forment un diviseur de la sortie : e− = u_s·R₁/(R₁+R₂).' },
      { t: 7.5e-4, text: 'Comme ε ≈ 0, e− = u_e, donc u_s = (1 + R₂/R₁)·u_e = 3 u_e. Le signal reste en phase avec l\'entrée.' },
    ],
    'aop-integrateur': [
      { t: 5e-4, text: 'E = +1 V : i = E/R est constant et charge C. La sortie descend à la vitesse E/RC = 1 V/ms.' },
      { t: 15e-4, text: 'E = −1 V : le courant s\'inverse et la sortie remonte. Un créneau intégré donne bien un triangle.' },
      { t: 60e-3, text: 'Régime établi : triangle de ± 0,5 V. Sans Rf, la moindre composante continue finirait par saturer la sortie.' },
    ],
    'aop-comparateur': [
      { t: 2.5e-4, text: 'u_e = 5 V > U_ref = 2 V : ε > 0. Sans contre-réaction, μ₀ε dépasse largement Vsat : la sortie sature à +15 V.' },
      { t: 7.5e-4, text: 'u_e < U_ref : saturation à −15 V. Ici, ε n\'est pas nul : la règle ε ≈ 0 ne vaut qu\'en régime linéaire.' },
    ],
    'aop-schmitt': [
      { t: 4e-4, text: 's = +15 V : le diviseur place e+ à +5 V. u_e approche de ce seuil par le bas.' },
      { t: 4.6e-4, text: 'u_e a franchi +5 V : ε < 0, s bascule à −15 V, et le seuil passe aussitôt à −5 V. C\'est la réaction positive.' },
      { t: 3e-3, text: 'Il a fallu attendre −5 V pour rebasculer : les seuils sont différents à la montée et à la descente. C\'est l\'hystérésis.' },
    ],
    'aop-astable': [
      { t: 0, text: 'Sortie à +15 V : e+ = +7,5 V, et C se charge à travers R vers +15 V.' },
      { t: 1e-3, text: 'u_C approche de 7,5 V. Au moment où elle l\'atteint, ε change de signe et la sortie bascule.' },
      { t: 5e-3, text: 'C oscille entre les seuils ± 7,5 V. Chaque demi-période va de −7,5 V vers +15 V en s\'arrêtant à +7,5 V, d\'où T = 2RC ln 3.' },
    ],
    'aop-wien': [
      { t: 0, text: 'Le pont de Wien renvoie 1/3 de la sortie sur e+, à f₀ = 1/(2πRC) seulement. Le gain non inverseur vaut 3,2 : la boucle dépasse 1.' },
      { t: 5e-3, text: 'L\'oscillation croît, d\'abord exponentiellement, depuis une petite tension initiale. Rien n\'a été injecté à cette fréquence : elle est sélectionnée.' },
      { t: 9.5e-3, text: 'La saturation limite l\'amplitude et rend le signal un peu aplati. C\'est la non-linéarité qui fixe le régime permanent.' },
    ],
    'aop-precision': [
      { t: 2.5e-3, text: 'u_e = 1 V : u_Rc = 1 V, sans perte de seuil. Dans l\'inspecteur de l\'AOP, sa sortie est à 1 V + Vd : il compense la diode.' },
      { t: 7.5e-3, text: 'u_e < 0 : diode bloquée, boucle ouverte, sortie saturée à −15 V. u_Rc = 0. Même 100 mV seraient redressés.' },
    ],
    'chargeur-telephone': [
      { t: 0, text: 'De gauche à droite : le transformateur abaisse le 230 V, le pont redresse, C filtre, la Zener régule. Suivez la tension à chaque étage.' },
      { t: 15e-3, text: 'Démarrage : à chaque crête, le pont charge C. La sortie suit, jusqu\'à ce que la Zener fixe 5,1 V.' },
      { t: 205e-3, text: 'u_C ondule de plus de 0,5 V, à 100 Hz, et la sortie à peine : Rs et la Zener absorbent l\'ondulation. Mais combien de puissance Rs dissipe-t-elle ?' },
    ],
    'app-minuterie': [
      { t: 0.4, text: 'Bouton enfoncé : C est chargé à 12 V et la lampe brille. K va s\'ouvrir à 0,5 s.' },
      { t: 1.5, text: 'K ouvert : seul C alimente la lampe, avec τ = R_lampe·C = 1 s. Une seconde plus tard, u = 37 % : l\'éclat a diminué d\'autant.' },
      { t: 4, text: 'Après quelques τ, la lampe est éteinte. Pour allonger la minuterie, que changer ?' },
    ],
    'app-flash': [
      { t: 0.45, text: 'C s\'est chargé à travers R avec τ = 0,1 s. Une pile lente accumule une énergie qu\'elle ne pourrait pas fournir d\'un coup.' },
      { t: 0.505, text: 'K vient de se fermer : la lampe reçoit 9 V d\'un coup. La décharge a pour τ ≈ 10 ms, dix fois plus court que la charge.' },
      { t: 0.65, text: 'L\'éclair est fini. K reste fermé : E, à travers R, maintient une faible lueur de 9·10/110 ≈ 0,8 V.' },
    ],
    'app-clignotant': [
      { t: 1, text: 'Sortie à +15 V : la diode conduit et la lampe est allumée. C se charge pendant ce temps.' },
      { t: 2, text: 'Sortie à −15 V : la diode bloque la lampe, qui s\'éteint. C\'est toujours l\'astable, avec T = 2RC ln 3 ≈ 2,2 s.' },
      { t: 8, text: 'Sans la diode, la lampe brillerait aussi à −15 V, car son éclat dépend de |u|. Essayez de la court-circuiter !' },
    ],
    'app-defibrillateur': [
      { t: 0.9e-3, text: 'C est chargé à 5 kV, soit 400 J. K va se fermer. Le courant va-t-il être brutal ? Quel rôle joue L ?' },
      { t: 2.26e-3, text: 'Crête à environ 65 A, atteinte progressivement : la bobine évite une pointe de 100 A (5 kV/50 Ω) qui abîmerait les tissus.' },
      { t: 8e-3, text: 'Q ≈ 0,7 : presque pas d\'oscillation, et tout est fini en quelques millisecondes. Ces valeurs donnent un ordre de grandeur.' },
    ],
    'app-allumage': [
      { t: 14.9e-3, text: 'K fermé : i = E/r = 3 A, et ½Li² = 36 mJ sont stockés. K va s\'ouvrir : i va brutalement devoir passer dans C.' },
      { t: 15.07e-3, text: 'Un quart de pseudo-période plus tard : u_L ≈ −i√(L/C) ≈ −500 V, à partir d\'une batterie de 12 V ! L\'énergie est passée dans C.' },
      { t: 28e-3, text: 'L\'oscillation s\'amortit. Le secondaire de la vraie bobine, non représenté, multiplie cette tension par 100 environ : d\'où l\'étincelle.' },
    ],
    'app-enceinte': [
      { t: 25e-3, text: 'L a une impédance Lω, faible à 100 Hz et forte à 5 kHz. Le boomer ne reçoit presque que les graves.' },
      { t: 30e-3, text: 'C a une impédance 1/(Cω), forte à 100 Hz et faible à 5 kHz. Le tweeter ne reçoit que les aigus. Regardez la forme des deux courbes.' },
    ],
    'app-radio-accord': [
      { t: 1e-3, text: 'A et B émettent ensemble. Au début, le RLC n\'a pas encore « trouvé » A : la résonance prend le temps τ = 2L/R = 2 ms.' },
      { t: 9.5e-3, text: 'u_R est presque une sinusoïde pure à 1,59 kHz, d\'amplitude 1 V. B, à 5 kHz, reste à 3,5 %. Changez C pour accorder le circuit sur B.' },
    ],
    'app-radio-am': [
      { t: 5e-4, text: 'L\'antenne reçoit une porteuse à 10 kHz, dont l\'amplitude varie à 1 kHz. Le message est dans l\'enveloppe, pas dans la moyenne, qui est nulle.' },
      { t: 3.2e-3, text: 'La diode ne laisse passer que les crêtes, et RC = 0,3 ms est un compromis : long devant la porteuse, court devant le message.' },
    ],
    'app-mixage': [
      { t: 2.5e-3, text: 'e− est une masse virtuelle : chaque source voit seulement sa résistance, et ignore l\'autre. Les courants s\'additionnent dans Rf.' },
      { t: 12e-3, text: 'u_s = −Rf(e₁/R₁ + e₂/R₂). Le gain se règle pour chaque voie via R₁ ou R₂, sans toucher à l\'autre voie.' },
    ],
    'app-jauge': [
      { t: 5e-4, text: 'Pont équilibré : u = 0 si R₁R₃\' = R₂R₃, quelle que soit E. Ici, la jauge s\'est allongée de 1 % : u ≈ −25 mV, ce qui se mesure facilement.' },
      { t: 1e-3, text: 'L\'intérêt : la mesure ne dépend que de l\'écart, pas de la valeur de 5 V présente sur chaque branche. Essayez 1020 Ω pour la jauge.' },
    ],
    'err-diode-envers': [
      { t: 5e-3, text: 'Diode retournée : la crête positive de E est bloquée et u_R = 0. Comparez avec « Redressement simple alternance ».' },
      { t: 15e-3, text: 'Ce sont les alternances négatives qui passent. u_R ≈ −9,4 V : le montage redresse, mais à l\'envers.' },
    ],
    'err-sans-contre-reaction': [
      { t: 2.5e-4, text: 'R₂ manque : gain μ₀ sur ε. Pour 1 V en entrée, 10⁵ V seraient nécessaires : la sortie sature aussitôt.' },
      { t: 7.5e-4, text: 'Sortie carrée, à ± 15 V : la contre-réaction n\'est pas un détail, c\'est elle qui crée le régime linéaire.' },
    ],
    'err-entrees-inversees': [
      { t: 2.5e-4, text: 'Même schéma que l\'inverseur, mais e+ et e− sont échangées. Sur le papier, u_s = −10 u_e reste une solution : pourquoi pas ici ?' },
      { t: 7.5e-4, text: 'La réaction est positive : tout écart s\'amplifie, et cette solution est instable. La sortie colle aux saturations. Résoudre ε = 0 ne suffit pas.' },
    ],
    'err-coupure-bobine': [
      { t: 1.9e-3, text: 'i s\'établit dans L. K va s\'ouvrir à 2 ms, sans chemin de décharge. Que va-t-il se passer ?' },
      { t: 2.0005e-3, text: 'Tension démesurée, voir l\'alerte : i ne peut pas s\'annuler instantanément. En vrai, une étincelle jaillit aux bornes de K. D\'où la diode de roue libre.' },
    ],
    'err-condensateur-continu': [
      { t: 2e-3, text: 'La lampe brille : à t = 0⁺, C vide se comporte comme un fil. Elle reçoit toute la tension E.' },
      { t: 60e-3, text: 'Elle s\'est éteinte, générateur toujours branché ! Une fois C chargé, plus aucun courant continu ne passe. Il faudrait du sinusoïdal.' },
    ],
    'err-court-circuit': [
      { t: 0, text: 'Un fil relie directement les bornes de E. Il imposerait 5 V et 0 V au même point : le problème n\'a pas de solution, l\'application le signale. Essayez de retirer le fil, ou de donner à E une résistance interne.' },
    ],
  };

  for (const e of RLC.library) e.guide = GUIDES[e.id] || [];
  RLC.guides = GUIDES;
})(/** @type {any} */ (globalThis).RLC ??= {});
