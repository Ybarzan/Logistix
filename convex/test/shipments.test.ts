import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Test d'intégration expéditions contre le backend Convex self-hosté
 * (http://127.0.0.1:3210). Il vérifie le flux complet :
 *
 *   1. création (ou récupération) d'un utilisateur de test via auth:signIn ;
 *   2. récupération de son identifiant (query ad hoc via /api/run_test_function) ;
 *   3. organisations:currentUser avec une identité simulée (--identity) ;
 *   4. création d'un hub et d'une expédition via les mutations seed:* ;
 *   5. RBAC : shipments:updateStatus sans identité → refusé ;
 *   6. shipments:updateStatus avec identité → in_transit puis delivered ;
 *   7. vérification des événements de tracking via tracking:recent.
 *
 * Prérequis : backend self-hosté démarré, .env.local présent, `convex dev`
 * déjà poussé (les fonctions seed:* / shipments:* / tracking:* sont déployées).
 *
 * LIMITE CONNUE — nettoyage : aucune fonction de suppression n'existe dans
 * le projet, et cette version du backend self-hosté n'expose ni les
 * endpoints admin de documents (_system/frontend, /api/delete_documents…)
 * ni les mutations ad hoc (/api/run_test_function n'accepte que des
 * queries). Les données créées (préfixe "TEST-") restent donc en base ;
 * elles sont identifiables par le customerName "TEST-<timestamp>".
 */

type Env = {
  url: string;
  adminKey: string;
};

function loadEnv(): Env {
  const envPath = path.join(process.cwd(), ".env.local");
  const content = readFileSync(envPath, "utf8");
  const url = content.match(/^CONVEX_SELF_HOSTED_URL=(.+)$/m)?.[1] ?? "";
  const adminKey = content.match(/^CONVEX_SELF_HOSTED_ADMIN_KEY=(.+)$/m)?.[1] ?? "";
  assert.ok(url, "CONVEX_SELF_HOSTED_URL manquant dans .env.local");
  assert.ok(adminKey, "CONVEX_SELF_HOSTED_ADMIN_KEY manquant dans .env.local");
  return { url, adminKey };
}

function runConvex(
  env: Env,
  fn: string,
  args: unknown,
  identity?: string,
): { status: number; stdout: string; stderr: string } {
  const convexBin = path.join(
    process.cwd(),
    "node_modules",
    "convex",
    "bin",
    "main.js",
  );
  const cliArgs = ["run", fn, JSON.stringify(args), "--typecheck", "disable"];
  if (identity !== undefined) {
    cliArgs.push("--identity", identity);
  }
  const result = spawnSync(process.execPath, [convexBin, ...cliArgs], {
    encoding: "utf8",
    timeout: 60000,
    env: {
      ...process.env,
      CONVEX_SELF_HOSTED_URL: env.url,
      CONVEX_SELF_HOSTED_ADMIN_KEY: env.adminKey,
      CONVEX_TMPDIR: path.join(process.cwd(), ".tmp-convex"),
    },
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

type TestFunctionResult = {
  status: string;
  value?: unknown;
  message?: string;
  errorMessage?: string;
};

async function runTestFunction(
  env: Env,
  source: string,
): Promise<TestFunctionResult> {
  const response = await fetch(`${env.url}/api/run_test_function`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bundle: { path: "testQuery.js", source },
      adminKey: env.adminKey,
      args: {},
      format: "convex_encoded_json",
    }),
  });
  return (await response.json()) as TestFunctionResult;
}

const EMAIL = "test-integration@logistix.local";
const PASSWORD = "test-password-123";

describe("Intégration expéditions (backend self-hosté)", () => {
  const env = loadEnv();
  const customerName = `TEST-${Date.now()}`;
  let userId = "";
  let orgId = "";
  let hubId = "";
  let shipmentId = "";

  it("backend joignable (organizations:currentUser sans identité)", () => {
    // Sans identité, la query retourne null : le CLI n'imprime rien
    // (logOutput n'est appelé que si le résultat n'est pas null).
    const r = runConvex(env, "organizations:currentUser", {});
    assert.equal(r.status, 0, `Backend injoignable : ${r.stderr}`);
  });

  it("crée (ou retrouve) l'utilisateur de test via auth:signIn", () => {
    const r = runConvex(env, "auth:signIn", {
      provider: "password",
      params: {
        flow: "signUp",
        email: EMAIL,
        password: PASSWORD,
        name: "Test Intégration",
      },
    });
    if (r.status !== 0) {
      // L'utilisateur peut déjà exister d'une exécution précédente.
      assert.match(r.stderr, /already exists/i, `signUp inattendu : ${r.stderr}`);
    }
  });

  it("récupère l'identifiant de l'utilisateur par email", async () => {
    const source = [
      'import { query } from "convex:/_system/repl/wrappers.js";',
      "",
      "export default query({ handler: async (ctx) => {",
      `  const user = await ctx.db.query("users").filter((q) => q.eq(q.field("email"), ${JSON.stringify(EMAIL)})).first();`,
      "  return user ? user._id : null;",
      "} });",
    ].join("\n");
    const r = await runTestFunction(env, source);
    assert.equal(r.status, "success", r.message ?? r.errorMessage ?? "échec");
    userId = r.value as string;
    assert.ok(userId, "utilisateur introuvable en base");
  });

  it("récupère l'organisation via organizations:currentUser", () => {
    const identity = JSON.stringify({ subject: `${userId}|test-session` });
    const r = runConvex(env, "organizations:currentUser", {}, identity);
    assert.equal(r.status, 0, r.stderr);
    const parsed = JSON.parse(r.stdout) as {
      email?: string;
      role?: string;
      org?: { _id: string };
    };
    assert.equal(parsed.email, EMAIL);
    assert.equal(parsed.role, "admin");
    assert.ok(parsed.org, "organisation manquante");
    orgId = parsed.org._id;
  });

  it("crée un hub de test via seed:insertHub", () => {
    const r = runConvex(env, "seed:insertHub", {
      orgId,
      name: `TEST Hub ${Date.now()}`,
      code: `TH${Date.now() % 100000}`,
      city: "TestCity",
      country: "France",
      capacity: 1000,
      currentLoad: 0,
      lat: 48.8566,
      lng: 2.3522,
      isActive: true,
    });
    assert.equal(r.status, 0, r.stderr);
    hubId = JSON.parse(r.stdout) as string;
    assert.ok(hubId, "hub non créé");
  });

  it("crée une expédition de test via seed:insertShipment", () => {
    const r = runConvex(env, "seed:insertShipment", {
      orgId,
      fromHubId: hubId,
      toHubId: hubId,
      weight: 100,
      priority: "normal",
      customerName,
      status: "pending",
      createdAt: Date.now(),
    });
    assert.equal(r.status, 0, r.stderr);
    shipmentId = JSON.parse(r.stdout) as string;
    assert.ok(shipmentId, "expédition non créée");
  });

  it("refuse le changement de statut sans authentification (RBAC)", () => {
    const r = runConvex(env, "shipments:updateStatus", {
      shipmentId,
      status: "in_transit",
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Non authentifié/);
  });

  it("change le statut en in_transit puis delivered", () => {
    const identity = JSON.stringify({ subject: `${userId}|test-session` });
    for (const status of ["in_transit", "delivered"]) {
      const r = runConvex(
        env,
        "shipments:updateStatus",
        { shipmentId, status },
        identity,
      );
      assert.equal(r.status, 0, `${status} : ${r.stderr}`);
    }
  });

  it("vérifie les événements de tracking via tracking:recent", () => {
    const identity = JSON.stringify({ subject: `${userId}|test-session` });
    const r = runConvex(env, "tracking:recent", { limit: 50 }, identity);
    assert.equal(r.status, 0, r.stderr);
    const events = JSON.parse(r.stdout) as Array<{
      shipmentId: string;
      eventType: string;
    }>;
    const shipmentEvents = events.filter((e) => e.shipmentId === shipmentId);
    const types = shipmentEvents.map((e) => e.eventType);
    assert.ok(
      types.includes("in_transit"),
      `événements attendus in_transit : ${JSON.stringify(types)}`,
    );
    assert.ok(
      types.includes("delivered"),
      `événements attendus delivered : ${JSON.stringify(types)}`,
    );
  });
});