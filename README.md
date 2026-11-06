# Coach échecs

Application web gratuite d'analyse de parties Chess.com, utilisable sur téléphone.

- Récupère les parties via l'API publique de Chess.com.
- Analyse avec Stockfish 19 lite dans le navigateur (WebAssembly, monothread, Web Worker).
- Reprend une analyse interrompue et ne recalcule jamais une partie déjà analysée.
- Calcule la précision avec la méthode publique de Lichess.
- Classe les coups avec les seuils publics de Chess.com. Les règles de Génial, Très bon et Occasion manquée, que Chess.com ne chiffre pas, sont des choix de cette appli (`RULES` dans `js/classify.js`).

Aucune clé n'est présente dans ce dépôt. Elles restent uniquement sur l'appareil de l'utilisateur.

## Mettre à jour

Augmenter `VERSION` dans `sw.js` à chaque déploiement : c'est ce qui affiche « Nouvelle version disponible ».

## Licences

- Ce projet : AGPL-3.0, voir `LICENSE`.
- Stockfish et stockfish.js : GPL-3.0, voir `vendor/STOCKFISH-COPYING.txt`.
- chess.js : BSD-2-Clause, voir `vendor/CHESSJS-LICENSE.txt`.
- Ouvertures : base [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings), CC0-1.0.
- Pièces cburnett, de Colin M.L. Burnett : GPLv2+.
- Formules de précision et de classification : portées du code de Lichess (lila en AGPL-3.0, scalachess en MIT), sources citées dans `js/lichess.js`.
