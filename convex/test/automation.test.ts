import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatOverrun, severityForDelay } from "../automation";

/**
 * Tests unitaires des helpers d'automatisation (convex/automation.ts) :
 * classification de la sévérité d'un retard et formatage lisible d'un
 * dépassement de durée.
 */

const HOUR = 60 * 60 * 1000;

describe("severityForDelay", () => {
  it("classe un retard de moins de 12h en low", () => {
    assert.equal(severityForDelay(0), "low");
    assert.equal(severityForDelay(5 * HOUR), "low");
    assert.equal(severityForDelay(12 * HOUR - 1), "low");
  });

  it("classe un retard de 12h à 24h en medium", () => {
    assert.equal(severityForDelay(12 * HOUR), "medium");
    assert.equal(severityForDelay(15 * HOUR), "medium");
    assert.equal(severityForDelay(24 * HOUR - 1), "medium");
  });

  it("classe un retard de 24h à 48h en high", () => {
    assert.equal(severityForDelay(24 * HOUR), "high");
    assert.equal(severityForDelay(30 * HOUR), "high");
    assert.equal(severityForDelay(48 * HOUR - 1), "high");
  });

  it("classe un retard de plus de 48h en critical", () => {
    assert.equal(severityForDelay(48 * HOUR), "critical");
    assert.equal(severityForDelay(72 * HOUR), "critical");
  });
});

describe("formatOverrun", () => {
  it("formate en minutes", () => {
    assert.equal(formatOverrun(0), "0min");
    assert.equal(formatOverrun(45 * 60 * 1000), "45min");
  });

  it("formate en heures et minutes", () => {
    assert.equal(formatOverrun(1 * HOUR), "1h00");
    assert.equal(formatOverrun(5 * HOUR + 30 * 60 * 1000), "5h30");
  });

  it("formate en jours et heures", () => {
    assert.equal(formatOverrun(1 * 24 * HOUR + 2 * HOUR), "1j 2h");
    assert.equal(formatOverrun(2 * 24 * HOUR), "2j 0h");
  });
});