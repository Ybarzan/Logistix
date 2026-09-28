# LogistiX

Tour de contrôle logistique pour PME : expéditions, hubs, itinéraires, incidents, SLA et traçabilité en temps réel — **qui ne se contente pas d'afficher les problèmes mais aide à les résoudre**. Interface en français, thème sombre custom.

## Ce qui différencie LogistiX

LogistiX est le poste de pilotage d'un écosystème de quatre produits intégrés par API (jamais par base partagée) :

| Brique | Rôle dans la boucle | Contrat |
|---|---|---|
| **fleet-hub** (flotte, GPS, tachygraphe) | la position réelle des camions arrive seule | clé `X-Marketplace-Key` du transporteur |
| **FleetMarket** (bourse de fret PME) | capacité de secours quand le réseau propre ne suffit pas | clé API donneur d'ordre `X-Api-Key` |
| **Praxio** (moteur de conformité douane) | pré-contrôle douane avant la frontière | clé API `X-API-Key` rattachée à la société |

La boucle : un retard est détecté → LogistiX propose **« trouver un transporteur de secours »** → la charge part sur FleetMarket → des transporteurs dont la conformité est vérifiée par fleet-hub proposent → l'opérateur **retient depuis LogistiX** → le camion du transporteur tiers remonte en GPS via FleetMarket → le client suit tout sur un **lien public**. Pour un envoi hors UE, Praxio classe la marchandise (code SH) et un incident « douane » préventif reste ouvert tant que le code n'est pas confirmé ; chaque confirmation est renvoyée à Praxio, qui apprend de l'historique de la société.

Chaque événement porte sa **provenance** (`manual` / `auto` / `gps`) : un fait télématique se distingue d'une saisie.

## API REST v1 et webhooks (intégration ERP / WMS)

Clés d'API et webhooks se créent dans **Paramètres** (admin). Base : `<VITE_CONVEX_SITE_URL>/api/v1`, en-tête `Authorization: Bearer lx_live_…`. Une clé n'agit que sur son organisation, avec des droits d'opérateur.

| Méthode | Chemin | Rôle |
|---|---|---|
| `POST` | `/shipments` | Créer (hubs désignés par code ; idempotent sur `customerRef` + `customerName`) |
| `GET` | `/shipments?status=&limit=` | Lister |
| `GET` | `/shipments/{référence}` | Statut, ETA prédite (fourchette + explication), position, événements |
| `POST` | `/shipments/{référence}/status` | Changer le statut (`{ "status", "note" }`), machine à états appliquée |

Erreurs : `{ "error": { "code", "message" } }` avec 400 / 401 / 404 / 422 (règle métier, message lisible).

**Webhooks** : `shipment.created`, `shipment.status_changed`, `incident.opened` (dont les *retards prévus*), `incident.resolved`. Chaque envoi porte `X-LogistiX-Signature: t=<ms>,v1=<hex>` avec `v1 = HMAC-SHA256(secret, "<t>.<corps brut>")` — vérifier la signature et rejeter un `t` trop ancien. Relances à 1 min, 5 min, 30 min et 2 h, puis échec visible dans Paramètres.

## Stack

- **Backend** — [Convex](https://convex.dev) auto-hébergé : base, requêtes/mutations/actions, auth par mot de passe (`@convex-dev/auth`), crons.
- **Frontend** — React 19, TanStack Router + Start (SSR), TanStack Query via `@convex-dev/react-query`, Leaflet (cartes, chargé côté client uniquement).
- **Styling** — CSS custom dans `src/styles/app.css`. Polices Syne + DM Mono, accent `#00d4aa`.
- **Multi-tenant** — `orgId` sur toutes les tables + index `by_org*`. **Chaque inscription crée sa propre organisation** ; on rejoint une équipe uniquement par lien d'invitation (jeton à usage unique + e-mail identique). Aucun repli implicite sur une organisation par défaut.

## Démarrage

Prérequis : Node ≥ 20, Docker Desktop.

1. **Backend Convex** : `docker compose up -d convex-backend` (image figée par digest), ports `3210` (API/sync) et `3211` (site).
2. **`.env.local`** :
   ```
   CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
   CONVEX_SELF_HOSTED_ADMIN_KEY=<clé admin>
   VITE_CONVEX_URL=http://127.0.0.1:3210
   VITE_CONVEX_SITE_URL=http://127.0.0.1:3211
   ```
   > **Windows** : définir `CONVEX_TMPDIR` sur le même volume que le projet (ex. `D:\...\LogistiX\.tmp-convex`).
3. `npm install` puis `npm run dev`.
4. Données de démo : `npx convex run seed:seed --typecheck=disable` (non idempotent). Pour rattacher un compte existant à l'organisation de démo : `npx convex run organizations:attachUserToOrg '{"email":"…","slug":"logistix","role":"admin"}'`.
5. Intégrations : **Paramètres** → fleet-hub, FleetMarket, Praxio (URL + clé ; la clé ne quitte jamais le serveur). Depuis le conteneur Convex, les autres stacks locales sont joignables via `http://host.docker.internal:<port>`.
   > **Protection SSRF** : les URL d'intégration et de webhook vers des adresses internes (loopback, réseaux privés, 169.254.x, `*.internal`…) sont refusées par défaut. En **local uniquement** : `npx convex env set ALLOW_PRIVATE_INTEGRATION_URLS true`. Ne jamais l'activer en production (et y filtrer aussi la sortie réseau, le contrôle ne couvre pas la résolution DNS).

## Scripts

| Commande | Description |
|---|---|
| `npm run dev` | Pousse le code Convex puis lance le dev server |
| `npm run check` | **À lancer avant chaque commit** : lint + tests + build (code de sortie fiable) |
| `npm run lint` | `tsc` + `eslint --max-warnings 0` |
| `npm test` | Tests backend : `convex-test` + vitest (vraies fonctions Convex, base en mémoire) |
| `npm run build` | `vite build` (client + SSR) puis `tsc` |

La CI GitHub Actions exécute lint, tests et build à chaque push.

## Structure (backend `convex/`)

- `schema.ts` — tables et index.
- `orgContext.ts` — `getOrgScope` (fail-closed), `requireRole`, `requireOwned` (toute référence par id est vérifiée comme appartenant au tenant).
- `signup.ts`, `organizations.ts` — organisation à l'inscription, membres, rôles (dernier admin protégé), invitations.
- `shipments.ts` + `shipmentStatus.ts` — machine à états (livré/annulé terminaux), références `EX-AAAA-NNNNNN`, itinéraire et ETA déduits.
- `automation.ts` + `crons.ts` — retards (sévérité escaladée, clôture auto), surcharge des hubs, risque douane.
- `fleethub.ts` — synchro GPS (2 min), cartes, trace de positions.
- `fleetmarket.ts` — publication de charge, propositions, acceptation, suivi du transporteur retenu.
- `praxio.ts` + `customsRules.ts` — régime douanier, classification SH, confirmation, incident préventif.
- `recommendations.ts` — « que faire maintenant » : actions explicables par incident.
- `publicTracking.ts` — lien de suivi client (`/suivi/<jeton>`), données réduites, révocable.
- `eta.ts` + `etaModel.ts` — ETA prédictive (GPS, historique de roulage, règles CE 561/2006) et incident « retard prévu ».
- `apiKeys.ts`, `publicApi.ts`, `http.ts` — API REST v1 ; `webhooks.ts` — événements sortants signés (toute ouverture/résolution d'incident passe par `openIncident`/`resolveIncident`).
- `co2.ts` — CO₂e par expédition (t·km × facteur ; facteur par défaut indicatif, réglable par organisation).
- `stats.ts` — SLA et performance sur une fenêtre indexée de 90 jours.

## Conventions

- **Convex** : validators `returns` toujours présents **et à jour du schéma** (un champ ajouté au schéma doit l'être aux validators qui renvoient le document) ; jamais de `undefined` stocké (omission) — `undefined` dans un `patch` sert à effacer ; pas de `.filter()` Convex → `withIndex`.
- **Sécurité** : toute mutation passe par `requireRole` ; tout id reçu du client par `requireOwned` ; les clés d'intégration ne sont jamais renvoyées au navigateur.
- **Frontend** : `useSuspenseQuery` + `convexQuery`, contenu en français.
