import { broadcastTaskEvent } from "../boardBroadcast";
import { readRepos, writeRepos } from "../repoStore";
import type { Repo } from "../repoStore";
import { parseStringBody } from "../utils/routeUtils";

import { readBody } from "../../utils/readBody";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

export async function handleRepoRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
): Promise<boolean> {
  // GET /api/repos
  if (req.method === "GET" && parsedUrl.pathname === "/api/repos") {
    const repos = await readRepos();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(repos));
    return true;
  }

  // POST /api/repos
  if (req.method === "POST" && parsedUrl.pathname === "/api/repos") {
    const body = await readBody(req);
    const name = parseStringBody(body, "name", { trim: true });
    const path = parseStringBody(body, "path", { trim: true });
    if (!name || !path) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "name and path are required" }));
      return true;
    }
    if (!existsSync(path)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Path does not exist: ${path}` }));
      return true;
    }
    const repos = await readRepos();
    const repo: Repo = {
      id: randomUUID(),
      name,
      path,
      createdAt: new Date().toISOString(),
    };
    repos.push(repo);
    await writeRepos(repos);
    broadcastTaskEvent("repo:created", repo);
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify(repo));
    return true;
  }

  // PATCH /api/repos/:id
  if (req.method === "PATCH" && parsedUrl.pathname?.startsWith("/api/repos/")) {
    const id = parsedUrl.pathname.slice("/api/repos/".length);
    const body = await readBody(req);
    const repos = await readRepos();
    const idx = repos.findIndex((r) => r.id === id);
    if (idx === -1) {
      res.writeHead(404);
      res.end();
      return true;
    }
    if (typeof body["path"] === "string" && !existsSync(body["path"])) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `Path does not exist: ${body["path"]}`,
        }),
      );
      return true;
    }
    repos[idx] = { ...repos[idx], ...body, id } as Repo;
    await writeRepos(repos);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(repos[idx]));
    return true;
  }

  // DELETE /api/repos/:id
  if (
    req.method === "DELETE" &&
    parsedUrl.pathname?.startsWith("/api/repos/")
  ) {
    const id = parsedUrl.pathname.slice("/api/repos/".length);
    const repos = await readRepos();
    const filtered = repos.filter((r) => r.id !== id);
    await writeRepos(filtered);
    broadcastTaskEvent("repo:deleted", { id });
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}
