ASTA MANTRA v1.45 — TITOLARITÀ LIVE
====================================

COSA CAMBIA
- Le Probabili Formazioni diventano una fonte dati del motore strategico.
- Ogni giocatore riceve una probabilità/stato di titolarità.
- La titolarità entra nel confronto Strategia A / Strategia B.
- La titolarità entra nel ranking Asta Live e nella scelta ALT 1 / ALT 2 / ALT 3.
- I TARGET dichiarati restano TARGET: la nuova informazione non cancella il piano, ma migliora l'ordinamento e le alternative.
- Nel menu Formazioni compare “Aggiorna”, con indicazione LIVE / CACHE / BASE LOCALE e data dell'ultimo dato.
- Se il feed live non è disponibile, l'app continua a funzionare con formations.js e con il feed salvato localmente.

FILE DA SOSTITUIRE
- index.html
- app.js
- styles.css
- sw.js

FILE NUOVI DA AGGIUNGERE AL REPOSITORY
- scripts/update_formations.py
- .github/workflows/update-formations.yml

PRIMA ATTIVAZIONE
1. Carica/sostituisci i file mantenendo esattamente le cartelle indicate.
2. Esegui una volta manualmente il workflow “Aggiorna probabili formazioni” da GitHub Actions.
3. Il workflow genera formations-current.json nella root del repository.
4. Da quel momento il workflow è programmato ogni 15 minuti e l'app controlla periodicamente se esiste un feed più recente.

IMPORTANTE
- formations-current.json NON va compilato a mano: viene prodotto dall'updater.
- L'updater accetta il nuovo dato solo se riesce a leggere almeno 15 squadre, così un cambiamento temporaneo della pagina sorgente non sovrascrive un feed valido.
- Listone, parser Listone, players.js, market.js, formations.js, backup e dati asta salvati nel browser non vengono modificati.
- La cadenza configurata è di 15 minuti: è un aggiornamento quasi in tempo reale, non un flusso live al secondo.

VERSIONE CACHE PWA
- v1.45
