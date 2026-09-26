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

// Positions GPS réelles depuis fleet-hub, toutes les 2 minutes
// (uniquement pour les organisations ayant activé l'intégration).
crons.interval("sync fleet-hub positions", { minutes: 2 }, internal.fleethub.syncAll, {});

export default crons;