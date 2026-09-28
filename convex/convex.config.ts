import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";

const app = defineApp();
// Limitation de débit de l'API REST (compteurs fragmentés : tient la charge concurrente).
app.use(rateLimiter);

export default app;
