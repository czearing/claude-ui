/**
 * @jest-environment node
 */
import { handleSkillRoutes } from "./skills";
import {
  deleteSkill,
  listSkills,
  readSkill,
  resolveSkillsDir,
  writeSkill,
} from "../skillStore";

import { readBody } from "../../utils/readBody";
import type { IncomingMessage, ServerResponse } from "node:http";
import { parse } from "node:url";

jest.mock("../skillStore", () => ({
  SKILL_NAME_RE: /^[a-z0-9-]{1,64}$/,
  resolveSkillsDir: jest.fn(),
  listSkills: jest.fn(),
  readSkill: jest.fn(),
  writeSkill: jest.fn(),
  deleteSkill: jest.fn(),
}));

jest.mock("../../utils/readBody", () => ({
  readBody: jest.fn(),
}));

const mockResolveSkillsDir = resolveSkillsDir as jest.MockedFunction<
  typeof resolveSkillsDir
>;
const mockListSkills = listSkills as jest.MockedFunction<typeof listSkills>;
const mockReadSkill = readSkill as jest.MockedFunction<typeof readSkill>;
const mockWriteSkill = writeSkill as jest.MockedFunction<typeof writeSkill>;
const mockDeleteSkill = deleteSkill as jest.MockedFunction<typeof deleteSkill>;
const mockReadBody = readBody as jest.MockedFunction<typeof readBody>;

interface MockRes {
  writeHead: jest.Mock;
  end: jest.Mock;
}

function makeReq(method: string): IncomingMessage {
  return { method } as unknown as IncomingMessage;
}

function makeRes(): MockRes & ServerResponse {
  return {
    writeHead: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
  } as unknown as MockRes & ServerResponse;
}

function parsedUrl(url: string) {
  return parse(url, true);
}

const FAKE_DIR = "/home/user/.claude/skills";

beforeEach(() => {
  jest.resetAllMocks();
  mockResolveSkillsDir.mockResolvedValue(FAKE_DIR);
});

// ── GET /api/skills ───────────────────────────────────────────────────────────

describe("GET /api/skills", () => {
  it("lists skills with scope=global by default", async () => {
    const skills = [{ name: "my-skill", description: "Does stuff" }];
    mockListSkills.mockResolvedValue(skills);

    const req = makeReq("GET");
    const res = makeRes();
    const result = await handleSkillRoutes(req, res, parsedUrl("/api/skills"));

    expect(result).toBe(true);
    expect(mockResolveSkillsDir).toHaveBeenCalledWith("global", null);
    expect(mockListSkills).toHaveBeenCalledWith(FAKE_DIR);
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ skills }));
  });

  it("lists skills with scope=repo when query param provided", async () => {
    const skills = [{ name: "repo-skill", description: "Repo-scoped" }];
    mockListSkills.mockResolvedValue(skills);

    const req = makeReq("GET");
    const res = makeRes();
    const result = await handleSkillRoutes(
      req,
      res,
      parsedUrl("/api/skills?scope=repo&repoId=repo-1"),
    );

    expect(result).toBe(true);
    expect(mockResolveSkillsDir).toHaveBeenCalledWith("repo", "repo-1");
    expect(mockListSkills).toHaveBeenCalledWith(FAKE_DIR);
  });

  it("returns 200 with JSON body", async () => {
    mockListSkills.mockResolvedValue([]);

    const req = makeReq("GET");
    const res = makeRes();
    await handleSkillRoutes(req, res, parsedUrl("/api/skills"));

    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ skills: [] }));
  });
});

// ── GET /api/skills/:name ─────────────────────────────────────────────────────

describe("GET /api/skills/:name", () => {
  it("returns 400 for an invalid name", async () => {
    const req = makeReq("GET");
    const res = makeRes();
    const result = await handleSkillRoutes(
      req,
      res,
      parsedUrl("/api/skills/bad name with spaces"),
    );

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(400, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "Invalid skill name" }),
    );
    expect(mockReadSkill).not.toHaveBeenCalled();
  });

  it("returns 404 when skill is not found", async () => {
    mockReadSkill.mockResolvedValue(null);

    const req = makeReq("GET");
    const res = makeRes();
    const result = await handleSkillRoutes(
      req,
      res,
      parsedUrl("/api/skills/missing-skill"),
    );

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(404);
    expect(res.end).toHaveBeenCalled();
  });

  it("returns 200 with skill data when found", async () => {
    const skill = {
      name: "my-skill",
      description: "Does stuff",
      content: "body",
    };
    mockReadSkill.mockResolvedValue(skill);

    const req = makeReq("GET");
    const res = makeRes();
    const result = await handleSkillRoutes(
      req,
      res,
      parsedUrl("/api/skills/my-skill"),
    );

    expect(result).toBe(true);
    expect(mockReadSkill).toHaveBeenCalledWith(FAKE_DIR, "my-skill");
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(skill));
  });
});

// ── POST /api/skills ──────────────────────────────────────────────────────────

describe("POST /api/skills", () => {
  it("returns 400 for an invalid name", async () => {
    mockReadBody.mockResolvedValue({ name: "INVALID NAME!", content: "" });

    const req = makeReq("POST");
    const res = makeRes();
    const result = await handleSkillRoutes(req, res, parsedUrl("/api/skills"));

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(400, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "Invalid skill name" }),
    );
    expect(mockWriteSkill).not.toHaveBeenCalled();
  });

  it("returns 409 when skill already exists", async () => {
    mockReadBody.mockResolvedValue({
      name: "existing-skill",
      description: "old",
      content: "old body",
    });
    mockReadSkill.mockResolvedValue({
      name: "existing-skill",
      description: "old",
      content: "old body",
    });

    const req = makeReq("POST");
    const res = makeRes();
    const result = await handleSkillRoutes(req, res, parsedUrl("/api/skills"));

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(409, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "Skill already exists" }),
    );
    expect(mockWriteSkill).not.toHaveBeenCalled();
  });

  it("creates and returns 201 when name is valid and does not exist", async () => {
    mockReadBody.mockResolvedValue({
      name: "new-skill",
      description: "A brand new skill",
      content: "skill body",
    });
    mockReadSkill.mockResolvedValue(null);
    mockWriteSkill.mockResolvedValue(undefined);

    const req = makeReq("POST");
    const res = makeRes();
    const result = await handleSkillRoutes(req, res, parsedUrl("/api/skills"));

    expect(result).toBe(true);
    expect(mockWriteSkill).toHaveBeenCalledWith(FAKE_DIR, {
      name: "new-skill",
      description: "A brand new skill",
      content: "skill body",
    });
    expect(res.writeHead).toHaveBeenCalledWith(201, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({
        name: "new-skill",
        description: "A brand new skill",
        content: "skill body",
      }),
    );
  });
});

// ── PUT /api/skills/:name ─────────────────────────────────────────────────────

describe("PUT /api/skills/:name", () => {
  it("returns 400 for an invalid name", async () => {
    const req = makeReq("PUT");
    const res = makeRes();
    const result = await handleSkillRoutes(
      req,
      res,
      parsedUrl("/api/skills/INVALID NAME"),
    );

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(400, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "Invalid skill name" }),
    );
    expect(mockWriteSkill).not.toHaveBeenCalled();
  });

  it("returns 404 when skill is not found", async () => {
    mockReadSkill.mockResolvedValue(null);

    const req = makeReq("PUT");
    const res = makeRes();
    const result = await handleSkillRoutes(
      req,
      res,
      parsedUrl("/api/skills/missing-skill"),
    );

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(404);
    expect(res.end).toHaveBeenCalled();
    expect(mockWriteSkill).not.toHaveBeenCalled();
  });

  it("updates and returns 200 when skill is found", async () => {
    const existing = {
      name: "my-skill",
      description: "old desc",
      content: "old body",
    };
    mockReadSkill.mockResolvedValue(existing);
    mockReadBody.mockResolvedValue({
      description: "updated desc",
      content: "updated body",
    });
    mockWriteSkill.mockResolvedValue(undefined);

    const req = makeReq("PUT");
    const res = makeRes();
    const result = await handleSkillRoutes(
      req,
      res,
      parsedUrl("/api/skills/my-skill"),
    );

    expect(result).toBe(true);
    expect(mockWriteSkill).toHaveBeenCalledWith(FAKE_DIR, {
      name: "my-skill",
      description: "updated desc",
      content: "updated body",
    });
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({
        name: "my-skill",
        description: "updated desc",
        content: "updated body",
      }),
    );
  });
});

// ── DELETE /api/skills/:name ──────────────────────────────────────────────────

describe("DELETE /api/skills/:name", () => {
  it("returns 400 for an invalid name", async () => {
    const req = makeReq("DELETE");
    const res = makeRes();
    const result = await handleSkillRoutes(
      req,
      res,
      parsedUrl("/api/skills/INVALID NAME"),
    );

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(400, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "Invalid skill name" }),
    );
    expect(mockDeleteSkill).not.toHaveBeenCalled();
  });

  it("returns 404 when skill is not found", async () => {
    mockReadSkill.mockResolvedValue(null);

    const req = makeReq("DELETE");
    const res = makeRes();
    const result = await handleSkillRoutes(
      req,
      res,
      parsedUrl("/api/skills/missing-skill"),
    );

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(404);
    expect(res.end).toHaveBeenCalled();
    expect(mockDeleteSkill).not.toHaveBeenCalled();
  });

  it("deletes and returns 204 when skill is found", async () => {
    const existing = {
      name: "my-skill",
      description: "desc",
      content: "body",
    };
    mockReadSkill.mockResolvedValue(existing);
    mockDeleteSkill.mockResolvedValue(undefined);

    const req = makeReq("DELETE");
    const res = makeRes();
    const result = await handleSkillRoutes(
      req,
      res,
      parsedUrl("/api/skills/my-skill"),
    );

    expect(result).toBe(true);
    expect(mockDeleteSkill).toHaveBeenCalledWith(FAKE_DIR, "my-skill");
    expect(res.writeHead).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });
});

// ── Non-matching routes ───────────────────────────────────────────────────────

describe("non-matching routes", () => {
  it("returns false for an unrecognised method and path", async () => {
    const req = makeReq("PATCH");
    const res = makeRes();
    const result = await handleSkillRoutes(
      req,
      res,
      parsedUrl("/api/something-else"),
    );

    expect(result).toBe(false);
    expect(res.writeHead).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });

  it("returns false for a GET to an unrelated path", async () => {
    const req = makeReq("GET");
    const res = makeRes();
    const result = await handleSkillRoutes(req, res, parsedUrl("/api/agents"));

    expect(result).toBe(false);
  });
});
