/**
 * Serveur de production LogistiX.
 *
 * Sert le handler SSR généré par TanStack Start (`dist/server/server.js`)
 * via un serveur HTTP Node natif. Aucune dépendance supplémentaire.
 *
 * Usage : `node server/index.mjs` (après `npm run build`)
 * Variables d'environnement :
 *   - PORT           : port d'écoute (défaut 3000)
 *   - HOST           : adresse d'écoute (défaut 0.0.0.0)
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

// Le handler SSR est généré par `vite build` dans dist/server/server.js
const { default: serverHandler } = await import(
  pathToFileURL(join(__dirname, "..", "dist", "server", "server.js")).href
);

const DIST_CLIENT = join(__dirname, "..", "dist", "client");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/** Sert un fichier statique du dossier dist/client. */
async function serveStatic(req, res, pathname) {
  // Sécurité : résolution du chemin dans le dossier client uniquement.
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = join(DIST_CLIENT, safePath);
  if (!filePath.startsWith(DIST_CLIENT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return true;
  }
  try {
    const data = await readFile(filePath);
    const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // 1. Fichiers statiques (assets buildés).
    if (req.method === "GET" || req.method === "HEAD") {
      if (await serveStatic(req, res, url.pathname)) return;
    }

    // 2. Fallback SPA pour les routes sans fichier statique : on laisse le
    //    handler SSR générer la page (TanStack Start gère le 404 lui-même).
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body:
        req.method === "GET" || req.method === "HEAD"
          ? undefined
          : await new Promise((resolve) => {
              const chunks = [];
              req.on("data", (c) => chunks.push(c));
              req.on("end", () => resolve(Buffer.concat(chunks)));
            }),
      duplex: "half",
    });

    const response = await serverHandler.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    }
    res.end();
  } catch (err) {
    console.error("[LogistiX] Erreur serveur :", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end("Erreur interne du serveur");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[LogistiX] Serveur de production démarré sur http://${HOST}:${PORT}`);
});