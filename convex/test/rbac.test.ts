import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getOrgScope, requireRole } from "../orgContext";
import type { Id } from "../_generated/dataModel";
import type { OrgScope } from "../orgContext";

/**
 * Tests unitaires du RBAC (convex/orgContext.ts).
 *
 * `getOrgScope` est testé avec un ctx mocké : `getAuthUserId` lit
 * `ctx.auth.getUserIdentity()` puis découpe le `subject` sur "|"
 * (voir @convex-dev/auth/server), et le reste du ctx est simulé.
 */

type MockUser = {
  _id: string;
  role?: OrgScope["role"];
  orgId?: string;
};

type MockCtx = {
  auth: {
    getUserIdentity: () => Promise<{ subject: string } | null>;
  };
  db: {
    get: (table: string, id: string) => Promise<MockUser | null>;
    query: (table: string) => {
      withIndex: (name: string, predicate: unknown) => {
        first: () => Promise<{ _id: string } | null>;
      };
    };
  };
};

function makeCtx(options: {
  identity: { subject: string } | null;
  user: MockUser | null;
  fallbackOrg: { _id: string } | null;
}): MockCtx {
  return {
    auth: {
      getUserIdentity: () => Promise.resolve(options.identity),
    },
    db: {
      get: (table: string, id: string) =>
        Promise.resolve(
          table === "users" && id === options.user?._id ? options.user : null,
        ),
      query: (table: string) => {
        if (table !== "organizations") {
          throw new Error(`Table inattendue : ${table}`);
        }
        return {
          withIndex: () => ({
            first: () => Promise.resolve(options.fallbackOrg),
          }),
        };
      },
    },
  };
}

type Ctx = Parameters<typeof getOrgScope>[0];

const scope = (role: OrgScope["role"]): OrgScope => ({
  userId: "user-1" as Id<"users">,
  orgId: "org-1" as Id<"organizations">,
  role,
});

describe("requireRole", () => {
  it("rejette un scope null (non authentifié)", () => {
    assert.throws(() => requireRole(null, "viewer"), /Non authentifié/);
    assert.throws(() => requireRole(null, "admin"), /Non authentifié/);
  });

  it("rejette un rôle insuffisant", () => {
    assert.throws(
      () => requireRole(scope("viewer"), "operator"),
      /Permissions insuffisantes/,
    );
    assert.throws(
      () => requireRole(scope("operator"), "manager"),
      /Permissions insuffisantes/,
    );
  });

  it("accepte un rôle égal au minimum requis", () => {
    assert.deepEqual(requireRole(scope("operator"), "operator"), scope("operator"));
    assert.deepEqual(requireRole(scope("admin"), "admin"), scope("admin"));
  });

  it("accepte un rôle supérieur (héritage de permissions)", () => {
    assert.deepEqual(requireRole(scope("admin"), "viewer"), scope("admin"));
    assert.deepEqual(requireRole(scope("manager"), "operator"), scope("manager"));
  });
});

describe("getOrgScope", () => {
  it("retourne null sans identité", async () => {
    const ctx = makeCtx({ identity: null, user: null, fallbackOrg: null });
    assert.equal(await getOrgScope(ctx as unknown as Ctx), null);
  });

  it("retourne null si l'utilisateur n'existe pas", async () => {
    const ctx = makeCtx({
      identity: { subject: "user-1|session-1" },
      user: null,
      fallbackOrg: null,
    });
    assert.equal(await getOrgScope(ctx as unknown as Ctx), null);
  });

  it("retourne le scope avec l'organisation de l'utilisateur", async () => {
    const ctx = makeCtx({
      identity: { subject: "user-1|session-1" },
      user: { _id: "user-1", role: "admin", orgId: "org-1" },
      fallbackOrg: null,
    });
    assert.deepEqual(await getOrgScope(ctx as unknown as Ctx), {
      userId: "user-1",
      orgId: "org-1",
      role: "admin",
    });
  });

  it("retombe sur l'organisation LogistiX si l'utilisateur n'en a pas", async () => {
    const ctx = makeCtx({
      identity: { subject: "user-1|session-1" },
      user: { _id: "user-1", role: "manager" },
      fallbackOrg: { _id: "org-logistix" },
    });
    assert.deepEqual(await getOrgScope(ctx as unknown as Ctx), {
      userId: "user-1",
      orgId: "org-logistix",
      role: "manager",
    });
  });

  it("retourne null si aucune organisation n'existe", async () => {
    const ctx = makeCtx({
      identity: { subject: "user-1|session-1" },
      user: { _id: "user-1", role: "viewer" },
      fallbackOrg: null,
    });
    assert.equal(await getOrgScope(ctx as unknown as Ctx), null);
  });

  it("défaut au rôle viewer (moindre privilège) si le rôle est absent", async () => {
    const ctx = makeCtx({
      identity: { subject: "user-1|session-1" },
      user: { _id: "user-1", orgId: "org-1" },
      fallbackOrg: null,
    });
    assert.deepEqual(await getOrgScope(ctx as unknown as Ctx), {
      userId: "user-1",
      orgId: "org-1",
      role: "viewer",
    });
  });
});