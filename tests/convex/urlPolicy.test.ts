import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { assertOutboundUrl, isPrivateHost } from "../../convex/urlPolicy";
import { newTest, orgWithUser } from "./setup";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("protection SSRF des URL sortantes", () => {
  it("reconnaît les adresses internes", () => {
    for (const h of ["localhost", "127.0.0.1", "10.2.3.4", "172.20.0.1", "192.168.1.10", "169.254.169.254", "100.64.0.1", "host.docker.internal", "db.local", "[::1]", "fd00::1", "0.0.0.0"]) {
      expect(isPrivateHost(h), h).toBe(true);
    }
    for (const h of ["erp.example.fr", "8.8.8.8", "172.32.0.1", "api.fleethub.eu"]) {
      expect(isPrivateHost(h), h).toBe(false);
    }
  });

  it("refuse les adresses internes et les identifiants dans l'URL, sauf autorisation explicite", () => {
    expect(() => assertOutboundUrl("http://169.254.169.254/latest/meta-data", false)).toThrow(/SSRF/);
    expect(() => assertOutboundUrl("https://user:pass@erp.example.fr/h", false)).toThrow(/Identifiants/);
    expect(assertOutboundUrl("https://erp.example.fr/hooks/", false)).toBe("https://erp.example.fr/hooks");
    expect(assertOutboundUrl("http://host.docker.internal:8888", true)).toBe("http://host.docker.internal:8888");
  });

  it("s'applique aux webhooks et aux intégrations ; la variable d'env l'assouplit", async () => {
    const t = newTest();
    const a = await orgWithUser(t, "admin");
    await expect(a.as.mutation(api.webhooks.create, { url: "http://127.0.0.1:8080/h", events: ["incident.opened"] })).rejects.toThrow(/SSRF/);
    await expect(a.as.mutation(api.fleethub.saveConfig, { baseUrl: "http://10.0.0.5", apiKey: "k", enabled: false })).rejects.toThrow(/SSRF/);
    vi.stubEnv("ALLOW_PRIVATE_INTEGRATION_URLS", "true");
    await a.as.mutation(api.fleethub.saveConfig, { baseUrl: "http://host.docker.internal:8888", apiKey: "k", enabled: false });
  });
});
