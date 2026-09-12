import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Détection automatique des retards d'expédition et des surcharges de hubs,
// toutes les 15 minutes. La logique anti-doublon est gérée dans
// convex/automation.ts (incidents ouverts déjà existants).
crons.interval(
  "detect delays and hub overload",
  { minutes: 15 },
  internal.automation.runAutomation,
  {},
);

export default crons;