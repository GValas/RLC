# Circuits RLC

Simulateur de circuits pour des étudiants de prépa. Le `README.md` décrit l'usage, le modèle physique,
ses limites et le rôle de chaque fichier : ne pas le dupliquer ici.

## Contraintes

- **Front-end pur :** HTML, CSS et JavaScript natifs. Ni npm, ni bundler, ni dépendance à installer.
- **Double-clic sur `index.html` :** l'application doit marcher en `file://`. Donc des scripts classiques
  qui partagent l'espace de noms global `RLC`, pas de modules ES.
- **Types :** JSDoc avec `// @ts-check`.
- **Langue :** interface, commentaires et messages de commit en français.
- **Notation prépa :** équations visibles, notations du programme (τ, ω₀, Q, t = 0⁺).

## Physique

- **ARQS :** le courant s'établit partout en même temps. Ne pas réintroduire d'animation de propagation
  ni de front lumineux, retirés à la demande de l'auteur.
- **Dessins :** les particules de l'onglet Composants sont schématiques, et le dessin le dit. Les valeurs
  chiffrées et les courbes, elles, doivent être exactes.
- **Sens réels :** les électrons vont à l'inverse de i. Un changement de dessin de la bobine doit garder B
  conforme à la règle de la main droite et e conforme à la loi de Lenz.

## Tests

- **Moteur :** `node tests/run-node.js`, ou ouvrir `tests/index.html`. Les résultats sont comparés aux
  solutions analytiques.
- **Nouveau script :** ajouter tout script testé à la fois dans `tests/run-node.js` et `tests/index.html`,
  et tout script de l'application dans `index.html`, où l'ordre de chargement compte.
- **Nouveau circuit de bibliothèque :** il lui faut un parcours guidé dans `js/guides.js`. Un circuit qui
  doit échouer volontairement porte `expectError: true`.
- **Interface :** les tests ne couvrent que le calcul. Tout changement visible se vérifie dans un
  navigateur, en thèmes clair et sombre.
- **WSL :** Node et Chrome sont côté Windows (`/mnt/c/Program Files/nodejs/node.exe`). Chrome se pilote
  en headless par le protocole DevTools.

## Thème

Les couleurs de l'interface sont des variables CSS définies trois fois dans `css/style.css` : thème clair,
`[data-theme="dark"]` et `prefers-color-scheme`. Une nouvelle variable doit figurer dans les trois blocs.

## Dépôt

Dépôt public : https://github.com/GValas/RLC, branche `main`. Ne jamais y mettre de donnée personnelle.
