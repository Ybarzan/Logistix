/**
 * Politique d'URL sortantes (webhooks, intégrations) contre la SSRF : le
 * serveur ne doit pas pouvoir être utilisé pour atteindre le réseau interne
 * (loopback, RFC 1918, lien-local, métadonnées cloud 169.254.169.254…).
 *
 * En local, les autres stacks tournent sur host.docker.internal : on les
 * autorise EXPLICITEMENT via la variable d'environnement Convex
 * ALLOW_PRIVATE_INTEGRATION_URLS=true (jamais en production).
 *
 * Limite assumée : contrôle sur le nom/l'IP littérale de l'URL, pas sur la
 * résolution DNS (un domaine public pointant vers une IP privée n'est pas
 * détecté ici — à compléter côté réseau/egress en hébergement).
 */

const PRIVATE_HOSTNAMES = [/^localhost$/, /\.localhost$/, /\.local$/, /\.internal$/, /^metadata(\.|$)/];

function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // lien-local, métadonnées cloud
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h.includes(":")) return false;
  return h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("::ffff:");
}

export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return PRIVATE_HOSTNAMES.some((re) => re.test(h)) || isPrivateIPv4(h) || isPrivateIPv6(h);
}

export function allowPrivateUrls(): boolean {
  return process.env.ALLOW_PRIVATE_INTEGRATION_URLS === "true";
}

/** Valide une URL sortante http(s) ; lève une erreur lisible sinon. */
export function assertOutboundUrl(raw: string, allowPrivate: boolean = allowPrivateUrls()): string {
  const url = raw.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("URL invalide");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("URL http(s) requise");
  if (parsed.username || parsed.password) throw new Error("Identifiants interdits dans l'URL");
  if (!allowPrivate && isPrivateHost(parsed.hostname)) {
    throw new Error("Adresse interne ou privée refusée (protection SSRF)");
  }
  return url;
}
