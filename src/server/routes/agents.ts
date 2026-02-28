import {
  AGENT_NAME_RE,
  deleteAgent,
  listAgents,
  readAgent,
  resolveAgentsDir,
  writeAgent,
} from "../agentStore";
import type { Agent } from "../agentStore";
import { parseStringBody } from "../utils/routeUtils";

import { readBody } from "../../utils/readBody";
import type { IncomingMessage, ServerResponse } from "node:http";

export async function handleAgentRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
): Promise<boolean> {
  const query = parsedUrl.searchParams;

  // GET /api/agents
  if (req.method === "GET" && parsedUrl.pathname === "/api/agents") {
    const scope = query.get("scope") ?? "global";
    const repoId = query.get("repoId");
    const dir = await resolveAgentsDir(scope, repoId);
    const agents = await listAgents(dir);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ agents }));
    return true;
  }

  // GET /api/agents/:name
  if (
    req.method === "GET" &&
    parsedUrl.pathname?.startsWith("/api/agents/") &&
    parsedUrl.pathname !== "/api/agents/"
  ) {
    const name = parsedUrl.pathname.slice("/api/agents/".length);
    if (!AGENT_NAME_RE.test(name)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid agent name" }));
      return true;
    }
    const scope = query.get("scope") ?? "global";
    const repoId = query.get("repoId");
    const dir = await resolveAgentsDir(scope, repoId);
    const agent = await readAgent(dir, name);
    if (agent === null) {
      res.writeHead(404);
      res.end();
      return true;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(agent));
    return true;
  }

  // POST /api/agents
  if (req.method === "POST" && parsedUrl.pathname === "/api/agents") {
    const body = await readBody(req);
    const name = parseStringBody(body, "name", { trim: true });
    const description = parseStringBody(body, "description");
    const content = parseStringBody(body, "content");
    if (!AGENT_NAME_RE.test(name)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid agent name" }));
      return true;
    }
    const scope = query.get("scope") ?? "global";
    const repoId = query.get("repoId");
    const dir = await resolveAgentsDir(scope, repoId);
    const existing = await readAgent(dir, name);
    if (existing !== null) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Agent already exists" }));
      return true;
    }
    const agent: Agent = { name, description, content };
    await writeAgent(dir, agent);
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify(agent));
    return true;
  }

  // PUT /api/agents/:name
  if (
    req.method === "PUT" &&
    parsedUrl.pathname?.startsWith("/api/agents/") &&
    parsedUrl.pathname !== "/api/agents/"
  ) {
    const name = parsedUrl.pathname.slice("/api/agents/".length);
    if (!AGENT_NAME_RE.test(name)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid agent name" }));
      return true;
    }
    const scope = query.get("scope") ?? "global";
    const repoId = query.get("repoId");
    const dir = await resolveAgentsDir(scope, repoId);
    const existing = await readAgent(dir, name);
    if (existing === null) {
      res.writeHead(404);
      res.end();
      return true;
    }
    const body = await readBody(req);
    const description =
      typeof body["description"] === "string"
        ? body["description"]
        : existing.description;
    const content =
      typeof body["content"] === "string" ? body["content"] : existing.content;
    const agent: Agent = { name, description, content };
    await writeAgent(dir, agent);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(agent));
    return true;
  }

  // DELETE /api/agents/:name
  if (
    req.method === "DELETE" &&
    parsedUrl.pathname?.startsWith("/api/agents/") &&
    parsedUrl.pathname !== "/api/agents/"
  ) {
    const name = parsedUrl.pathname.slice("/api/agents/".length);
    if (!AGENT_NAME_RE.test(name)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid agent name" }));
      return true;
    }
    const scope = query.get("scope") ?? "global";
    const repoId = query.get("repoId");
    const dir = await resolveAgentsDir(scope, repoId);
    const existing = await readAgent(dir, name);
    if (existing === null) {
      res.writeHead(404);
      res.end();
      return true;
    }
    await deleteAgent(dir, name);
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}
