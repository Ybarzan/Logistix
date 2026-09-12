import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(() => {
    return Promise.resolve(new Response("ok", { status: 200 }));
  }),
});

export default http;