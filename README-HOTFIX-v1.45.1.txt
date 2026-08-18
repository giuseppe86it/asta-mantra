HOTFIX v1.45.1 — Pulsante Titolarità Live

Problema corretto:
- Il pulsante BASE LOCALE non avviava correttamente refreshFormationsLive su Safari/iPhone a causa di una collisione tra la funzione interna e il wrapper globale.

Sostituire SOLO:
- index.html
- app.js
- sw.js

Non modificare:
- styles.css
- formations-current.json
- formations.js
- players.js
- market.js
- dati asta / localStorage

Dopo il caricamento su GitHub:
1. attendere il deploy Pages;
2. chiudere completamente la PWA Asta Mantra;
3. riaprirla;
4. aprire Formazioni e toccare BASE LOCALE.

Con formations-current.json già presente e valido, il badge deve passare a LIVE (o CACHE se il feed è vecchio).
