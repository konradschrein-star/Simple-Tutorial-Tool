import { config } from "dotenv";
import { resolve } from "path";
// Load .env before anything reads process.env.
config({ path: resolve(process.cwd(), ".env") });

import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { handleTutorialRecordingUpload } from "./upload-handler";

/**
 * Custom server. Its only job beyond serving Next.js is to intercept the
 * screen-recording upload (hundreds of MB) and stream it straight to disk,
 * bypassing Next's request-body size limit.
 */
const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
const bindHost = process.env.BIND_HOST || "0.0.0.0";

const app = next({ dev, hostname: "localhost", port });
const handle = app.getRequestHandler();

async function start() {
  await app.prepare();
  const server = createServer(async (req, res) => {
    try {
      if (req.method === "POST" && req.url) {
        const m = /^\/api\/production\/jobs\/([^/]+)\/recording\/?(?:\?.*)?$/.exec(req.url);
        if (m) {
          await handleTutorialRecordingUpload(req, res, m[1]!);
          return;
        }
      }
      await handle(req, res, parse(req.url!, true));
    } catch (err) {
      console.error("[server] Error handling request:", err);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  server.listen(port, bindHost, () =>
    console.log(`[server] ready on http://${bindHost}:${port} (${dev ? "dev" : "prod"})`),
  );
}
start().catch((e) => {
  console.error("[server] Failed to start:", e);
  process.exit(1);
});
