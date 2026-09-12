# LogistiX — Récapitulatif de session

> Projet : plateforme logistique (expéditions, hubs, itinéraires, incidents, traceabilité).
> Objectif global : assainissement de la dette technique en 5 phases (0 → 4).
> Statut : **Phases 0-1-2-3 implémentées. Environnement complet opérationnel : backend Docker up, seed OK, tsc/eslint/build 0 erreur. Phase 4 en cours (QA navigateur + docs).**

---

## 0. Session 5 — Industrialisation (RBAC, automatisation, tests, dépôt Git)

> Objectif : transformer le prototype en socle produit. Dépôt Git créé, RBAC serveur + frontend, automatisation par cron, premiers tests, correction d'un bug critique de validateurs.

### Dépôt Git
- **Dépôt créé** : `https://github.com/Ybarzan/Logistix.git` (branche `main`, commit initial `bc348be`).
- `.gitignore` complété : ajout de `.tmp-convex`. `.env.local` (clé admin) jamais commité.

### RBAC (contrôle d'accès par rôle)
- **Backend** (`convex/orgContext.ts`) : type `Role` (admin > manager > operator > viewer), `OrgScope` étendu avec `role`, helper `requireRole(scope, minRole)` avec hiérarchie d'héritage. Compte sans rôle → `viewer` (moindre privilège, fail-safe).
- **Matrice appliquée** : viewer = lecture seule ; operator = shipments (create/update/updateStatus) + tracking.log + incidents (create/resolve) ; manager = operator + hubs/routes (create/update) + incidents.update ; admin = tout + `organizations.updateUserRole` (nouvelle mutation).
- **Frontend** (`src/components/rbac.ts`) : helper `can(role, minRole)` + `roleLabel()`, badge de rôle dans la topbar, gating des actions par page (boutons masqués selon le rôle), try/catch sur toutes les mutations (message `.auth-error`).

### Automatisation (jobs schedulés)
- **`convex/automation.ts`** (nouveau) : détection automatique des retards d'expédition (statuts pending/loading/in_transit avec `estimatedDelivery` dépassée) et des surcharges de hubs (> 90% capacité). Sévérité selon la durée de dépassement (< 12h low, 12-24h medium, 24-48h high, > 48h critical). Anti-doublon : pas de nouvel incident tant qu'un incident ouvert (open/investigating) existe pour la même expédition/hub.
- **`convex/crons.ts`** (nouveau) : cron toutes les 15 min → `internal.automation.runAutomation`.

### Tests (premiers)
- **`convex/test/`** : 26 tests (17 unitaires + 9 intégration backend) via `node:test` + `tsx`. Couvre : `requireRole` (hiérarchie), `getOrgScope` (fail-safe viewer), `severityForDelay` (seuils), `formatOverrun` (formatage), flux expédition complet (création → statuts → événements tracking) + RBAC (refus sans auth).
- **Script npm** : `npm test` → `tsx --test "convex/test/*.test.ts"`.

### Bug critique corrigé
- **Validateurs `returns` incomplets** : `shipments.list`, `incidents.list`, `hubs.list`, `routes.list`, `tracking.listByShipment`, `shipments.getById` renvoyaient les documents complets (avec `orgId`) mais leurs validateurs omettaient `orgId` → `ReturnsValidationError` au runtime. **Toutes les pages de données étaient cassées** (jamais détecté : la QA navigateur n'avait pas eu lieu). Corrigé en ajoutant `orgId: v.optional(v.id("organizations"))` aux 5 validateurs.

### État final
- `npm run lint` : **0 erreur** · `npm run build` : **OK** · `npm test` : **26/26 passent**.

### À faire (reste)
1. **QA navigateur** : vérifier les pages avec le backend up (les validateurs corrigés doivent débloquer les données).
2. **Nettoyage des données de test** : ajouter des mutations de suppression (deleteShipment/deleteHub) pour que les tests d'intégration puissent nettoyer.
3. **Vérifier le cron en prod** : les incidents auto doivent apparaître toutes les 15 min sans doublon.
4. Backlog : actions (jobs schedulés), export PDF, authentification par code, gestion des utilisateurs/rôles dans l'UI (updateUserRole est prêt côté API).

---

## 1. Vue d'ensemble du projet

- **Backend** : Convex (base, requêtes, mutations, actions, auth par mot de passe).
- **Frontend** : TanStack Router (file-based), TanStack Query + `@convex-dev/react-query`, `convex/react` (mutations), React.
- **Style** : CSS custom dans `src/styles/app.css` (pas de Tailwind). Thème sombre : fond `#080b10`, accent `#00d4aa`, polices Syne + DM Mono. UI et contenu en français.
- **Multi-tenant** : une org « LogistiX » (slug `logistix`), `orgId` présent sur toutes les tables + index `by_org*`. Rattachement paresseux du premier compte via `orgContext.ts` (fallback slug `logistix`).
- **Auth** : `@convex-dev/auth` — login/mot de passe, page `/login`, layout protégé permettant la redirection `/login` → `/`.
- **Backend local** : Convex auto-hébergé Docker (`convex-local-backend-1`), admin/API `http://127.0.0.1:3210`, site `http://127.0.0.1:3211`. Config self-hosted dans `.env.local`. **`VITE_CONVEX_URL` doit être `http://127.0.0.1:3210`** (le WebSocket de sync `/api/{version}/sync` répond 101 uniquement sur ce port — le 3211 renvoie 404, ce qui provoque les boucles `Expected 101 status code` du client).

## 2. Plan en phases (état)

| Phase | Contenu | État |
|---|---|---|
| 0 | Scaffolding, styles, routes vides | ✅ opérationnel |
| 1 | Dashboard, hubs, routes, expéditions | ✅ opérationnel (données seed) |
| 2 | Auth + multi-tenant, migration schema, seed | ✅ opérationnel (login OK en attente de test manuel) |
| 3 | **Features** — SLA/Performance, CRUD, détail + timeline, recherche/filtres/tri | ✅ opérationnel |
| 4 | Tests / revues de code (qualité, correctifs) | 🔲 en cours — CI locale au vert, QA navigateur restant |

## 3. Session 4 — Mise en service de l'environnement (cette session)

### Environnement
- **Backend Docker démarré** : conteneur `convex-local-backend-1` (healthy), compose dans `C:\WINDOWS\TEMP\opencode\convex-local\docker-compose.yml`. Clé admin générée et enregistrée dans `.env.local`.
- **`.env.local`** : `CONVEX_SELF_HOSTED_URL`, `CONVEX_SELF_HOSTED_ADMIN_KEY`, `VITE_CONVEX_URL=http://127.0.0.1:3210`, `VITE_CONVEX_SITE_URL=http://127.0.0.1:3211` (suppression de `CONVEX_DEPLOYMENT`).
- **Push Convex réussi** → `convex/_generated/` généré (api, server, dataModel).
- **Seed exécuté** : 5 hubs, 20 expéditions, 59 événements (non idempotent — ne pas relancer).
- **`src/routeTree.gen.ts` régénéré** (11 routes) via `@tanstack/router-generator` (le dev server la régénère aussi à chaque démarrage).

### Corrections backend (typecheck)
- **`@convex-dev/auth@0.0.95`** : API changée — `Password.configure(...)` → `Password({ profile })` et **profile doit être synchrone** (le runtime fait `const { email } = profile`). `convex/auth.ts` réécrit en conséquence (retourne `{ name, email, role: "admin" }`).
- **`orgContext.ts` / `organizations.currentUser`** : fallback paresseux sur l'org par défaut (slug `logistix`) quand `user.orgId` absent → le premier compte voit les données du seed sans org explicite.
- **Types** : unions de statuts/appels `eq` (narrowing capturé hors closure), `eventType` typer en `EventType`, `recent`/`getById`/`slaByRoute` annotés `Id<"shipments">/Id<"routes">`, `seed.ts` : `IncidentSeed` typé avec indices optionnels, `http.ts` retourne `Promise<Response>`.
- **Frontend** : suppression des `?.`/`??` devenus inutiles après typage strict (`index.tsx`, `routes.tsx`, `expeditions.tsx`, `$shipmentId.tsx`, `hubs.tsx`, `sla.tsx`).

### Qualité
- **`npm run lint`** (tsc + eslint `--max-warnings 0`) : **0 erreur**.
- **`npm run build`** (`vite build` client + SSR puis `tsc`): **OK**.
- **Smoke test runtime** : `vite dev` sur `http://localhost:3000` — `/`, `/login`, `/expeditions`, `/sla` répondent en **200** (HTML SSR).
- **`README.md` réécrit** : stack, démarrage (Docker + env + seed), scripts, structure, conventions.

## 4. Fait en Phase 3

### Backend (`convex/`)
- **`schema.ts`** : nouvelle table `trackingEvents` (`shipmentId`, `eventType` union, `description`, `location?`, `orgId?`) avec indexes `by_org_and_shipment`, `by_org`.
- **`tracking.ts`** (nouveau) : `eventTypeSchema` + `recordTrackingEvent`, `listByShipment`, `recent` (flux paginé avec jointures), `log`.
- **`shipments.ts`** : `updateStatus` → événement tracking FR (`pending→created`, `loading→processed`), set `actualDelivery` si livré ; `update` (poids, priorité, client, réf., livraison estimée, effacements via `null`); `getById` → `{ shipment, fromHub, toHub, route }`.
- **`incidents.ts`** : `update` (type/sévérité/titre/description/statut, `resolvedAt` si résolu) — `resolve` conservé.
- **`hubs.ts` / `routes.ts`** : mutation `update` (patch par clé `!== undefined`).
- **`stats.ts`** (nouveau) : `slaStats` (total, statuts, `slaRate`, `onTime`, `late`, `avgTransitHours`, `delaysByReason`, `slaByRoute`), `performanceStats` (volumes, poids, `onTimeRate`, incidents, `resolutionRate`, `volumePerDay`, `hubThroughput`).
- **`seed.ts`** réécrit : 5 hubs, 4 routes, 20 expéditions, événements tracking, 5 incidents.

### Frontend (`src/`)
- **`components/shipmentMeta.ts`** (nouveau) : labels/couleurs statuts, priorités, types incidents, `eventColors`, formats dates/durées.
- **`components/form.tsx`** (nouveau) : `Modal`, `Field`, `TextInput`, `NumberInput`, `Select`, `TextArea`.
- **`styles/app.css`** : `.btn*`, `.input/.select`, `.field*`, `.modal*`, `.toolbar`, `.searchbox`, `.chip`, `.empty-state`, `.detail-grid`, `.feed-*`, `.seg*`, `.stat-pair`, `.allocation-row`.
- **`routes/_layout.tsx`** : nav avec Incidents + liens SLA / Performance / Traçabilité.
- **Routes** : `expeditions/$shipmentId` (détail + timeline + statut + suivi + édition), `sla`, `performance`, `tracabilite`, `incidents` (filtres/recherche/CRUD), `expeditions` (rewrite filtres/tri/recherche/création), `hubs`/`routes` (CRUD + toggle actif, fallback démo).

## 5. Corrections importantes

- **Jamais de `undefined` dans les valeurs Convex** : `ctx.db.insert`/`patch` ne tolérent pas `undefined`. Champs optionnels **omis** via `...(x !== undefined ? { x } : {})` ; effacement via **`null`**.
- **`@convex-dev/auth` 0.0.95** : `profile` **synchrone** (voir §3).
- **Lint `npm run lint` → 0 erreur** (imports triés, `Array<T>`, suppression des `no-unnecessary-condition`, `require-await` résolu via `Promise.resolve` sur `httpAction`).

## 6. À faire en Phase 4 (reste)

1. **QA navigateur** : créer un compte via `/login` (inscription) et vérifier : données seed visibles (dashboard, expéditions, hubs, routes, incidents), détail expédition + timeline + changement de statut, pages SLA / Performance / Traçabilité, CRUD (créer/modifier/résoudre).
2. **Tests éventuels** : vérifier les éventuels N+1 dans `tracking.recent`/`stats`, valider les validators de queries.
3. Backlog optionnel : actions (jobs schedulés), export PDF, authentification par code (nuance du plan de test utilisateur).

## 7. Convention à respecter (rappels)

- **Convex** : nouvelle syntaxe (`query`/`mutation`/`action` + `args`/`returns`/`handler`), `returns: v.null()` pour les void, `db.get("table", id)` avec noms de table explicites, **jamais de `undefined`** stocké ni passé à `runMutation` (null/omission), pas de `.filter()` Convex → index `withIndex`, `ctx.runQuery/runMutation` via `api.x.y`/`internal.x.y`.
- **Frontend** : `useSuspenseQuery` + `convexQuery`, `useMutation`/`useAction` (convex/react), routes TanStack file-based, contenu en français.
- **Lint** : `npm run lint` à **0 erreur**. Imports triés, `import type`, `Array<T>`, pas de `no-unnecessary-condition`.
- **Windows PowerShell** : les `$` dans les routes dynamiques sont détruits par le shell → préférer les outils de fichiers ; `grep` n'existe pas (utiliser `npx eslint`/concurrents).
- **`src/routeTree.gen.ts`** : généré (dev server ou generator) — ne jamais l'éditer.
- **Secrets/env** : `.env.local` (clé admin self-hosted) — ne pas committer de clés.
- **Windows / Convex** : `CONVEX_TMPDIR` doit pointer vers un dossier du même volume que le projet.