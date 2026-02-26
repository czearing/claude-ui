import {
  SKILL_NAME_RE,
  deleteSkill,
  listSkills,
  readSkill,
  resolveSkillsDir,
  writeSkill,
} from "../skillStore";
import type { Skill } from "../skillStore";

import { readBody } from "../../utils/readBody";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { parse } from "node:url";

export async function handleSkillRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: ReturnType<typeof parse>,
): Promise<boolean> {
  // GET /api/skills
  if (req.method === "GET" && parsedUrl.pathname === "/api/skills") {
    const scope =
      typeof parsedUrl.query["scope"] === "string"
        ? parsedUrl.query["scope"]
        : "global";
    const repoId =
      typeof parsedUrl.query["repoId"] === "string"
        ? parsedUrl.query["repoId"]
        : null;
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
    const scope =
      typeof parsedUrl.query["scope"] === "string"
        ? parsedUrl.query["scope"]
        : "global";
    const repoId =
      typeof parsedUrl.query["repoId"] === "string"
        ? parsedUrl.query["repoId"]
        : null;
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
    const name = typeof body["name"] === "string" ? body["name"].trim() : "";
    const description =
      typeof body["description"] === "string" ? body["description"] : "";
    const content = typeof body["content"] === "string" ? body["content"] : "";
    if (!SKILL_NAME_RE.test(name)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid skill name" }));
      return true;
    }
    const scope =
      typeof parsedUrl.query["scope"] === "string"
        ? parsedUrl.query["scope"]
        : "global";
    const repoId =
      typeof parsedUrl.query["repoId"] === "string"
        ? parsedUrl.query["repoId"]
        : null;
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
    const scope =
      typeof parsedUrl.query["scope"] === "string"
        ? parsedUrl.query["scope"]
        : "global";
    const repoId =
      typeof parsedUrl.query["repoId"] === "string"
        ? parsedUrl.query["repoId"]
        : null;
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
    const content =
      typeof body["content"] === "string" ? body["content"] : existing.content;
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
    const scope =
      typeof parsedUrl.query["scope"] === "string"
        ? parsedUrl.query["scope"]
        : "global";
    const repoId =
      typeof parsedUrl.query["repoId"] === "string"
        ? parsedUrl.query["repoId"]
        : null;
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
