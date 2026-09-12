# LogistiX

Plateforme de supervision logistique : expéditions, hubs, itinéraires, incidents, SLA et traçabilité en temps réel. Interface en français, thème sombre custom.

## Stack

- **Backend** — [Convex](https://convex.dev) : base de données, requêtes/mutations/actions, auth par mot de passe (`@convex-dev/auth`), stockage, jobs schedulés.
- **Frontend** — React 19, [TanStack Router](https://tanstack.com/router) (file-based routing) + TanStack Start, [TanStack Query](https://tanstack.com/query) avec `@convex-dev/react-query` (`useSuspenseQuery`), `convex/react` pour les mutations.
- **Styling** — CSS custom dans `src/styles/app.css` (pas de Tailwind). Polices Syne + DM Mono, accent `#00d4aa`.
- **Multi-tenant** — une organisation « LogistiX » (slug `logistix`) ; `orgId` présent sur toutes les tables + index `by_org*`. Le premier compte se rattache paresseusement à cette organisation (voir `convex/orgContext.ts`).

## Démarrage

Prérequis : Node ≥ 20, Docker Desktop (backend Convex auto-hébergé).

### 1. Backend Convex (auto-hébergé sur Docker)

Le backend local écoute sur les ports `3210` (admin) et `3211` (site/proxy). La composition Docker utilisée est documentée en session (`C:\WINDOWS\TEMP\opencode\convex-local\docker-compose.yml`, conteneur `convex-local-backend-1`).

### 2. Configuration

`.env.local` doit contenir :

```
CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
CONVEX_SELF_HOSTED_ADMIN_KEY=<clé admin générée au démarrage du conteneur>
VITE_CONVEX_URL=http://127.0.0.1:3210
VITE_CONVEX_SITE_URL=http://127.0.0.1:3211
```

> `VITE_CONVEX_URL` doit pointer sur le port **API/admin (3210)** : c'est lui qui répond au WebSocket de synchronisation (`/api/{version}/sync`). `VITE_CONVEX_SITE_URL` (3211) sert pour les URLs de stockage/fichiers.

> **Windows** : définir `CONVEX_TMPDIR` dans un dossier du même volume que le projet (ex. `D:\Users\...\LogistiX\.tmp-convex`) avant toute commande Convex, sinon erreur `ENOENT mkdtemp` (C: et D: sont sur des systèmes de fichiers différents).

### 3. Installation et dev

```
npm install
npm run dev        # pousse le code Convex puis lance Vite sur http://localhost:3000
```

### 4. Peupler la base (seed)

```
npx convex run seed:seed --typecheck=disable
```

Crée : 1 organisation, 5 hubs, 4 routes, 20 expéditions (statuts variés sur 7 jours), des événements de suivi et 5 incidents. Non idempotent : ne pas relancer.

## Scripts

| Commande | Description |
|---|---|
| `npm run dev` | Pousse le code Convex puis lance le dev server |
| `npm run lint` | `tsc --noEmit` + `eslint` (`--max-warnings 0`) |
| `npm run build` | `vite build` (client + SSR) puis `tsc --noEmit` |
| `npm run format` | Prettier |

## Structure

- `convex/schema.ts` — tables et index (`organizations`, `users`, `hubs`, `routes`, `shipments`, `trackingEvents`, `incidents`).
- `convex/*.ts` — modules métier : `auth` (providers), `orgContext` (scope multi-tenant), `shipments`, `hubs`, `routes`, `incidents`, `tracking`, `stats`, `seed`.
- `convex/http.ts` — endpoints HTTP (health check).
- `src/routes/` — routes TanStack file-based (`/`, `/login`, `/expeditions`, `/hubs`, `/routes`, `/incidents`, `/sla`, `/performance`, `/tracabilite`, `/expeditions/$shipmentId`).
- `src/components/` — `form.tsx` (Modal/Field/inputs), `shipmentMeta.ts` (labels, couleurs, formats).
- `src/routeTree.gen.ts` — généré automatiquement (ne pas éditer).

## Conventions

- **Convex** : nouvelle syntaxe (`query`/`mutation`/`action` + `args`/`returns`/`handler`), validators `returns` toujours présents (`v.null()` pour les void), jamais de `undefined` dans les valeurs stockées ni dans les args de `runMutation` (champs optionnels omis, effacement via `null`), pas de `.filter()` Convex → index + `withIndex`.
- **Frontend** : `useSuspenseQuery` + `convexQuery`, `useMutation`/`useAction` depuis `convex/react`, contenu en français.
- **Lint** : `npm run lint` doit rester à 0 erreur.