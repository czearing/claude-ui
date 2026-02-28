import {
  SKILL_NAME_RE,
  deleteSkill,
  listSkills,
  readSkill,
  resolveSkillsDir,
  writeSkill,
} from "../skillStore";
import type { Skill } from "../skillStore";
import { parseStringBody } from "../utils/routeUtils";

import { readBody } from "../../utils/readBody";
import type { IncomingMessage, ServerResponse } from "node:http";

export async function handleSkillRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: URL,
): Promise<boolean> {
  const query = parsedUrl.searchParams;

  // GET /api/skills
  if (req.method === "GET" && parsedUrl.pathname === "/api/skills") {
    const scope = query.get("scope") ?? "global";
    const repoId = query.get("repoId");
    const dir = await resolveSkillsDir(scope, repoId);
    const skills = await listSkills(dir);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ skills }));
    return true;
  }

  // GET /api/skills/:name
  if (
    req.method === "GET" &&
    parsedUrl.pathname?.startsWith("/api/skills/") &&
    parsedUrl.pathname !== "/api/skills/"
  ) {
    const name = parsedUrl.pathname.slice("/api/skills/".length);
    if (!SKILL_NAME_RE.test(name)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid skill name" }));
      return true;
    }
    const scope = query.get("scope") ?? "global";
    const repoId = query.get("repoId");
    const dir = await resolveSkillsDir(scope, repoId);
    const skill = await readSkill(dir, name);
    if (skill === null) {
      res.writeHead(404);
      res.end();
      return true;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(skill));
    return true;
  }

  // POST /api/skills
  if (req.method === "POST" && parsedUrl.pathname === "/api/skills") {
    const body = await readBody(req);
    const name = parseStringBody(body, "name", { trim: true });
    const description = parseStringBody(body, "description");
    const content = parseStringBody(body, "content");
    if (!SKILL_NAME_RE.test(name)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid skill name" }));
      return true;
    }
    const scope = query.get("scope") ?? "global";
    const repoId = query.get("repoId");
    const dir = await resolveSkillsDir(scope, repoId);
    const existing = await readSkill(dir, name);
    if (existing !== null) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Skill already exists" }));
      return true;
    }
    const skill: Skill = { name, description, content };
    await writeSkill(dir, skill);
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify(skill));
    return true;
  }

  // PUT /api/skills/:name
  if (
    req.method === "PUT" &&
    parsedUrl.pathname?.startsWith("/api/skills/") &&
    parsedUrl.pathname !== "/api/skills/"
  ) {
    const name = parsedUrl.pathname.slice("/api/skills/".length);
    if (!SKILL_NAME_RE.test(name)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid skill name" }));
      return true;
    }
    const scope = query.get("scope") ?? "global";
    const repoId = query.get("repoId");
    const dir = await resolveSkillsDir(scope, repoId);
    const existing = await readSkill(dir, name);
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
    // Trim content to match what parseFrontmatterDoc returns on GET, so the
    // PUT response is consistent with a subsequent GET. Without this, the
    // client's val===content guard in SkillEditor can fail on trailing
    // newlines, which the file round-trip strips via .trim().
    const rawContent =
      typeof body["content"] === "string" ? body["content"] : existing.content;
    const content = rawContent.trim();
    const skill: Skill = { name, description, content };
    await writeSkill(dir, skill);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(skill));
    return true;
  }

  // DELETE /api/skills/:name
  if (
    req.method === "DELETE" &&
    parsedUrl.pathname?.startsWith("/api/skills/") &&
    parsedUrl.pathname !== "/api/skills/"
  ) {
    const name = parsedUrl.pathname.slice("/api/skills/".length);
    if (!SKILL_NAME_RE.test(name)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid skill name" }));
      return true;
    }
    const scope = query.get("scope") ?? "global";
    const repoId = query.get("repoId");
    const dir = await resolveSkillsDir(scope, repoId);
    const existing = await readSkill(dir, name);
    if (existing === null) {
      res.writeHead(404);
      res.end();
      return true;
    }
    await deleteSkill(dir, name);
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}
