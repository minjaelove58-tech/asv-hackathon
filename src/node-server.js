import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { webcrypto } from "node:crypto";
import worker from "./index.js";
import { createMySqlDatabase } from "./aispace-db.js";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const publicRoot = path.resolve(fileURLToPath(new URL("../public/", import.meta.url)));
const port = Number(process.env.PORT || 3000);
let database = null;
let databaseError = null;

try {
  database = await createMySqlDatabase();
  console.log("AISPACE MySQL database connected and schema verified");
} catch (error) {
  databaseError = error instanceof Error ? error : new Error(String(error));
  console.error(`AISPACE database connection failed: ${databaseError.message}`);
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

function requestHeaders(nodeRequest) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(nodeRequest.headers)) {
    if (value !== undefined) {
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
  }
  return headers;
}

function readBody(nodeRequest, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    nodeRequest.on("data", chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body is too large"));
        nodeRequest.destroy();
        return;
      }
      chunks.push(chunk);
    });
    nodeRequest.on("end", () => resolve(Buffer.concat(chunks)));
    nodeRequest.on("error", reject);
  });
}

async function serveStatic(nodeResponse, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    nodeResponse.writeHead(400);
    nodeResponse.end("Bad request");
    return;
  }

  if (pathname.includes("\0")) {
    nodeResponse.writeHead(400);
    nodeResponse.end("Bad request");
    return;
  }

  const candidates = [pathname];
  if (pathname === "/") {
    candidates.unshift("/index.html");
  } else if (!path.extname(pathname)) {
    candidates.push(`${pathname}.html`, path.posix.join(pathname, "index.html"));
  }

  for (const candidate of candidates) {
    const filePath = path.resolve(publicRoot, `.${candidate}`);
    if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${path.sep}`)) {
      continue;
    }

    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        continue;
      }
      const body = await readFile(filePath);
      nodeResponse.writeHead(200, {
        "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        "Content-Length": body.length,
        "Cache-Control": "no-cache"
      });
      nodeResponse.end(nodeResponse.req?.method === "HEAD" ? undefined : body);
      return;
    } catch {
      // Try the next extension candidate.
    }
  }

  nodeResponse.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  nodeResponse.end("Not found");
}

async function handle(nodeRequest, nodeResponse) {
  const url = new URL(nodeRequest.url || "/", `http://${nodeRequest.headers.host || "localhost"}`);
  nodeResponse.req = nodeRequest;

  if (!url.pathname.startsWith("/api/")) {
    await serveStatic(nodeResponse, url);
    return;
  }

  try {
    const method = nodeRequest.method || "GET";
    const requestInit = {
      method,
      headers: requestHeaders(nodeRequest)
    };
    if (method !== "GET" && method !== "HEAD") {
      requestInit.body = await readBody(nodeRequest);
      requestInit.duplex = "half";
    }

    const request = new Request(url, requestInit);
    const response = await worker.fetch(request, {
      DB: database,
      AUTH_SECRET: process.env.AUTH_SECRET || ""
    });

    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    nodeResponse.writeHead(response.status, responseHeaders);
    nodeResponse.end(nodeRequest.method === "HEAD" ? undefined : Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    nodeResponse.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    nodeResponse.end(JSON.stringify({ ok: false, message }));
  }
}

const server = createServer((request, response) => {
  handle(request, response);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`AISPACE server listening on port ${port}`);
  if (databaseError) {
    console.error("/api/health will report the database initialization error until the process is restarted.");
  }
});

async function shutdown() {
  server.close();
  if (database) {
    await database.close();
  }
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
