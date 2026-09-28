import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { addHub, newTest, orgWithUser } from "./setup";

async function setup(n: number) {
  const t = newTest();
  const a = await orgWithUser(t, "admin");
  const lyon = await addHub(t, a.orgId, "LYS");
  const mrs = await addHub(t, a.orgId, "MRS");
  const par = await addHub(t, a.orgId, "PAR");
  for (let i = 0; i < n; i++) {
    await a.as.mutation(api.shipments.create, {
      fromHubId: i % 3 === 0 ? par : lyon,
      toHubId: mrs,
      weight: 100 + i,
      priority: i % 5 === 0 ? "urgent" : "normal",
      customerName: i === 7 ? "Nordica Pharma" : `Client ${i}`,
      ...(i === 7 ? { customerRef: "NP-5567" } : {}),
    });
  }
  return { t, a, lyon, mrs, par };
}

const page = (numItems: number, cursor: string | null = null) => ({ paginationOpts: { numItems, cursor } });

describe("liste paginée des expéditions", () => {
  it("parcourt TOUTES les expéditions au-delà de 50, sans doublon", async () => {
    const { a } = await setup(65);
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (;;) {
      const res: { page: Array<{ _id: string }>; isDone: boolean; continueCursor: string } =
        await a.as.query(api.shipments.search, { ...page(20, cursor) });
      res.page.forEach((s) => seen.add(s._id));
      if (res.isDone) break;
      cursor = res.continueCursor;
    }
    expect(seen.size).toBe(65);
    const counts = await a.as.query(api.shipments.statusCounts, {});
    expect(counts).toMatchObject({ capped: false, counts: { all: 65, pending: 65 } });
  });

  it("recherche plein texte : client, référence client, référence", async () => {
    const { a } = await setup(12);
    expect((await a.as.query(api.shipments.search, { ...page(10), q: "Nordica" })).page.map((s) => s.customerName)).toEqual(["Nordica Pharma"]);
    expect((await a.as.query(api.shipments.search, { ...page(10), q: "NP-5567" })).page).toHaveLength(1);
    const year = new Date().getUTCFullYear();
    expect((await a.as.query(api.shipments.search, { ...page(10), q: `EX-${year}-000003` })).page[0]?.reference).toBe(`EX-${year}-000003`);
  });

  it("filtres priorité et hub, tri par poids", async () => {
    const { a, par } = await setup(15);
    const urgent = await a.as.query(api.shipments.search, { ...page(50), priority: "urgent" });
    expect(urgent.page.every((s) => s.priority === "urgent")).toBe(true);
    expect(urgent.page).toHaveLength(3);
    const fromParis = await a.as.query(api.shipments.search, { ...page(50), hubId: par });
    expect(fromParis.page).toHaveLength(5);
    const heavy = await a.as.query(api.shipments.search, { ...page(3), sort: "heavy" });
    expect(heavy.page.map((s) => s.weight)).toEqual([114, 113, 112]);
  });

  it("une autre organisation ne trouve rien, même en recherche", async () => {
    const { t } = await setup(5);
    const b = await orgWithUser(t, "admin", "org-b");
    expect((await b.as.query(api.shipments.search, { ...page(10) })).page).toEqual([]);
    expect((await b.as.query(api.shipments.search, { ...page(10), q: "Client" })).page).toEqual([]);
  });
});
