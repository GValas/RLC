# Circuits RLC

Construire un circuit sur une grille, le mettre sous tension et observer ses régimes transitoire et
permanent. HTML, CSS et JavaScript natifs : aucune installation, aucune étape de construction.

**Lancer :** ouvrir `index.html` dans un navigateur récent (un double-clic suffit).

## Utilisation

| Action | Geste |
|---|---|
| Poser un composant | Le glisser depuis la palette, ou cliquer dessus puis sur la grille |
| Tirer un fil | Partir d'une borne (ou de l'extrémité d'un fil), ou utiliser l'outil Fil (`W`) |
| Tourner / effacer | `R` / `Suppr`, ou l'outil Gomme |
| Régler un composant | Le sélectionner. Valeurs acceptées : `4,7k`, `100n`, `10m`, `1e-3` |
| Basculer un interrupteur | Cliquer dessus, à tout moment |
| Tracer u ou i | Sélectionner le composant, puis « Tracer u » / « Tracer i » |
| Déplacer / zoomer la vue | Glisser le fond / molette |
| Lecture, pause | `Espace` ; `←` `→` pour avancer pas à pas, `Début` pour t = 0 |
| Se placer dans le temps | Curseur du temps, ou clic sur un graphique ; molette pour zoomer |

Deux fils qui se touchent sont toujours reliés, et le point noir marque la jonction.

Basculer un interrupteur ou modifier un paramètre alors qu'on a remonté le temps efface le futur
enregistré : l'histoire repart de cet instant. Modifier la structure du circuit le met hors tension.

Les circuits enregistrés restent dans ce navigateur (`localStorage`). Pour les conserver ou les
partager, passer par « Exporter » (fichier JSON).

## Pour comprendre

| Aide | Où la trouver |
|---|---|
| **Parcours guidé** | En haut de l'inspecteur, pour chaque circuit de la bibliothèque : instants clés commentés |
| **Prédire avant de voir** | Inspecteur, hors tension : annoncer les valeurs à t = 0⁺ et finale, puis vérifier |
| **État des composants** | Sur le schéma, sous tension : diode passante ou bloquée, AOP linéaire ou saturé, ε |
| **Valeurs** | Bouton au-dessus du schéma : u et i, avec leurs flèches, sur tous les composants |
| **Survol** | D'un graphique : le schéma montre cet instant. D'un fil ou d'un composant : V, u et i |
| **Curseurs « et si… ? »** | Sous R, L, C, E et f : la courbe précédente reste en pâle, et la valeur critique est proposée |
| **Lois de Kirchhoff** | Sélectionner un composant (loi des mailles) ou un fil (loi des nœuds) |
| **Schémas équivalents** | Inspecteur, sous tension : C et L remplacés par leur équivalent à t⁺ et à t → ∞ |
| **Équations** | Panneau du régime libre : équation différentielle, racines et forme de la solution |
| **Erreurs classiques** | Bibliothèque : diode à l'envers, AOP sans contre-réaction, entrées inversées, etc. |

## Onglet Composants

Pour le condensateur, la bobine et la résistance : l'architecture réelle du composant, le lien entre
ses dimensions et sa valeur (C = ε₀εᵣS/e, L = µ₀µᵣN²S/ℓ, R = ρL/S), puis son fonctionnement animé dans
un circuit, avec les électrons, le champ, les courbes et un commentaire qui suit chaque étape. Le temps
s'y remonte comme dans l'onglet Circuit. Les courbes viennent de solutions exactes (`js/devices.js`),
vérifiées contre le moteur. Le nombre et la vitesse des particules dessinées restent schématiques.

## Modèle physique

- **Résolution** : analyse nodale modifiée. Trapèzes à pas adaptatif, avec Euler implicite juste
  après chaque discontinuité pour obtenir les valeurs à t⁺.
- **Régime permanent** : phaseurs pour les signaux sinusoïdaux, recherche de la solution périodique
  pour les créneaux, grands pas implicites pour la partie continue (ce qui respecte la conservation
  de la charge, par exemple pour deux condensateurs en série).
- **Régime transitoire** : tout écart de plus de 1 % entre les variables d'état et le régime
  permanent. La partie colorée des graphiques correspond à cette durée.
- **Régime libre** : τ, ω₀ et Q viennent des valeurs propres du circuit, sources éteintes.

- **Lampe** : dipôle ohmique de résistance fixe. Son éclat vaut |u|/Umax, plafonné à 100 %. Il suit la
  tension instantanée, sans inertie thermique : en sinusoïdal, la lampe clignote au double de la fréquence.
  Au-delà de Umax elle ne grille pas, l'inspecteur le signale seulement.
- **Diode** : modèle à seuil de prépa (bloquée sous Vd, puis u = Vd + Rd·i), coude arrondi sur 10 mV,
  avec une tension Zener facultative. Résolution par Newton à chaque pas.
- **AOP** : modèle du premier ordre, τ dx/dt + x = μ₀ε, avec saturation à ± Vsat et vitesse de balayage.
  Ce modèle dynamique est nécessaire : avec un AOP idéal sans dynamique, un comparateur à hystérésis
  ou un astable n'auraient aucune raison de basculer. Il lui faut une masse dans le circuit.
- **Circuits non linéaires** : ni phaseurs ni modes propres. Le régime permanent est cherché par
  simulation anticipée (au plus 400 ms de calcul à chaque changement de configuration) : état
  stationnaire, signal périodique imposé ou oscillations auto-entretenues, dont la période est alors
  affichée. S'il n'est pas trouvé à temps, l'application indique « Régime non déterminé ».

### Ce que l'animation représente

Le modèle est celui de l'**ARQS** : le courant s'établit partout en même temps, sans propagation.

Les points indiquent le sens du courant, et leur vitesse est proportionnelle à son intensité. L'échelle
s'adapte au courant affiché : ce n'est ni la vitesse réelle des charges, ni une mesure comparable d'un
instant à l'autre.

### Limites

- Pas de transistor, et l'alimentation des AOP n'est pas dessinée : leur courant de sortie revient par la masse.
- Pour un AOP sans condensateur ni bobine autour de lui, le régime est considéré comme établi d'emblée
  (il s'établit en quelques microsecondes).
- Un courant de l'ordre des fuites du modèle (interrupteur ouvert, diode bloquée) est affiché comme nul :
  aucun point ne circule, même si le graphique montre encore quelques picoampères.
- Couper le courant d'une bobine sans chemin de décharge produit une surtension énorme, limitée
  seulement par la résistance « ouvert » de l'interrupteur. L'application affiche alors un avertissement.
- Mémoire de l'historique limitée à 64 Mo : au-delà, les échantillons sont éclaircis uniformément.
  Tout le passé reste accessible, avec moins de détail.

## Tests

Le moteur est comparé aux solutions analytiques : ouvrir `tests/index.html`, ou lancer
`node tests/run-node.js` si Node est installé (il n'est pas nécessaire à l'application).

## Organisation

| Fichier | Rôle |
|---|---|
| `js/linalg.js` | Factorisation LU, valeurs propres |
| `js/circuit.js` | Catalogue des composants, compilation de la grille en nœuds, unités |
| `js/engine.js` | Simulation, historique, régime permanent, modes propres |
| `js/library.js` | Bibliothèque de circuits |
| `js/render.js` | Dessin du circuit |
| `js/scope.js` | Graphiques |
| `js/editor.js` | Interactions sur la grille |
| `js/app.js` | Transport du temps, inspecteur, sauvegarde |
