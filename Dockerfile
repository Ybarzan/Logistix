# ---- Étape 1 : build du frontend (client + SSR) ----
FROM node:22-alpine AS build
WORKDIR /app

# Dépendances (cache Docker optimisé)
COPY package.json package-lock.json ./
RUN npm ci

# Code source
COPY . .
# Exclure les artefacts locaux
RUN rm -rf dist .tmp-convex

# URL du backend Convex figée au build (import.meta.env.VITE_CONVEX_URL)
ARG VITE_CONVEX_URL=http://127.0.0.1:3210
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL

RUN npm run build

# ---- Étape 2 : runtime (serveur de production Node natif) ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Dépendances de production uniquement
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Artifacts de build + serveur
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1

CMD ["node", "server/index.mjs"]