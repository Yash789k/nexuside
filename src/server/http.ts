import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Service } from "./service";
export async function serve(service: Service, webRoot: string, port = 4317) {
  const token = randomBytes(32).toString("hex");
  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    );
    const reply = (code: number, value: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    try {
      const address = server.address();
      const actualPort =
        typeof address === "object" && address ? address.port : port;
      const host = req.headers.host;
      if (
        host !== `127.0.0.1:${actualPort}` &&
        host !== `localhost:${actualPort}`
      ) {
        reply(403, { error: "Invalid host" });
        return;
      }
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (url.pathname.startsWith("/api/")) {
        if (req.method !== "POST") {
          reply(405, { error: "POST required" });
          return;
        }
        const auth = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
        if (
          auth.length !== token.length ||
          !timingSafeEqual(Buffer.from(auth), Buffer.from(token))
        ) {
          reply(401, {
            error: "Open the authenticated URL shown in your terminal.",
          });
          return;
        }
        const origin = req.headers.origin;
        if (origin && origin !== `http://${host}`) {
          reply(403, { error: "Origin denied" });
          return;
        }
        if (!req.headers["content-type"]?.startsWith("application/json")) {
          reply(415, { error: "JSON required" });
          return;
        }
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 30_000_000) {
            reply(413, { error: "Request too large" });
            req.destroy();
            return;
          }
        }
        const data = await service.request(
          url.pathname.slice(5),
          body ? JSON.parse(body) : {},
        );
        reply(200, data);
        return;
      }
      if (req.method !== "GET") {
        reply(405, { error: "GET required" });
        return;
      }
      const file =
        url.pathname === "/"
          ? "index.html"
          : decodeURIComponent(url.pathname.slice(1));
      if (
        !/^[a-zA-Z0-9_./-]+$/.test(file) ||
        file.split("/").includes("..") ||
        ![".html", ".js", ".css", ".svg", ".woff2", ".png"].includes(
          path.extname(file),
        )
      ) {
        reply(404, { error: "Not found" });
        return;
      }
      const content = await readFile(path.join(webRoot, file));
      const types: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
        ".png": "image/png",
      };
      res.writeHead(200, { "Content-Type": types[path.extname(file)] });
      res.end(content);
    } catch (e) {
      reply((e as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 400, {
        error: (e as Error).message,
      });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  const address = server.address() as { port: number };
  return {
    server,
    token,
    url: `http://127.0.0.1:${address.port}/#token=${token}`,
  };
}
