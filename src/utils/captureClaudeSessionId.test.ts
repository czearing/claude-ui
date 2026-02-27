/**
 * @jest-environment node
 *
 * Tests for captureClaudeSessionId using a real temp directory so mtime
 * behaviour is exercised exactly as it runs in production.
 */

/* eslint-disable import/order */
import {
  captureClaudeSessionId,
  encodeCwdToProjectDir,
} from "./captureClaudeSessionId";
import {
  mkdirSync,
  readdirSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/* eslint-enable import/order */

// Use process.env.TEMP/TMP so we never import node:os before mocking it
const tempHome = join(
  process.env.TEMP ?? process.env.TMP ?? "/tmp",
  `capture-test-${process.pid}`,
);

// Redirect homedir to an isolated temp tree so we never touch ~/.claude
// jest.mock is hoisted by babel-jest so it runs before any import resolves.
jest.mock("node:os", () => ({
  homedir: () => tempHome,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEST_CWD = "C:/Code/Personal/my-project";

function projectDir(): string {
  const encoded = encodeCwdToProjectDir(TEST_CWD);
  return join(tempHome, ".claude", "projects", encoded);
}

/** Write a JSONL stub and backdate its mtime to an explicit timestamp (ms). */
function createJsonl(name: string, mtimeMs: number): void {
  const path = join(projectDir(), `${name}.jsonl`);
  writeFileSync(path, '{"type":"summary"}\n');
  const t = new Date(mtimeMs);
  utimesSync(path, t, t);
}

// ─── Setup / teardown ────────────────────────────────────────────────────────

beforeAll(() => {
  mkdirSync(projectDir(), { recursive: true });
});

afterAll(() => {
  rmSync(tempHome, { recursive: true, force: true });
});

afterEach(() => {
  // Remove all JSONL files between tests for a clean slate
  for (const f of readdirSync(projectDir())) {
    if (f.endsWith(".jsonl")) {
      unlinkSync(join(projectDir(), f));
    }
  }
});

// ─── encodeCwdToProjectDir ────────────────────────────────────────────────────

describe("encodeCwdToProjectDir", () => {
  it("encodes Windows path separators and colon", () => {
    expect(encodeCwdToProjectDir("C:/Code/Personal/foo")).toBe(
      "C--Code-Personal-foo",
    );
  });

  it("encodes backslashes", () => {
    expect(encodeCwdToProjectDir("C:\\Code\\Personal\\foo")).toBe(
      "C--Code-Personal-foo",
    );
  });

  it("strips leading hyphens from Unix absolute paths", () => {
    expect(encodeCwdToProjectDir("/home/user/bar")).toBe("home-user-bar");
  });
});

// ─── captureClaudeSessionId — happy path ─────────────────────────────────────

describe("captureClaudeSessionId — happy path", () => {
  it("returns the UUID of the only JSONL created after spawnTimestamp", async () => {
    const T_spawn = 1_000_000;

    // One old personal session (exists before spawn)
    createJsonl("old-personal-uuid", T_spawn - 5000);

    // Handover creates a new file after the spawn
    createJsonl("handover-uuid", T_spawn + 2000);

    const result = await captureClaudeSessionId(TEST_CWD, T_spawn);
    expect(result).toBe("handover-uuid");
  });

  it("returns null when no JSONL file is newer than spawnTimestamp", async () => {
    const T_spawn = 1_000_000;

    createJsonl("old-personal-uuid", T_spawn - 1000);

    const result = await captureClaudeSessionId(TEST_CWD, T_spawn);
    expect(result).toBeNull();
  });

  it("returns null when the project directory does not exist", async () => {
    const result = await captureClaudeSessionId(
      "C:/does/not/exist",
      Date.now(),
    );
    expect(result).toBeNull();
  });
});

// ─── captureClaudeSessionId — the contamination bug ─────────────────────────
//
// These tests prove that the current mtime heuristic returns the WRONG file
// when the user's personal terminal session is updated after the handover exits.

describe("captureClaudeSessionId — contamination bug (mtime heuristic)", () => {
  it("BUG: returns the personal session when user sends a message AFTER the handover exits", async () => {
    const T_spawn = 1_000_000;
    const T_handover_exit = T_spawn + 10_000; // handover finishes 10 s later
    const T_user_reply = T_handover_exit + 5_000; // user sends message 5 s after that

    // Personal session existed before spawn, but user replies after handover exits
    createJsonl("personal-uuid", T_user_reply);

    // Handover creates its own file and exits
    createJsonl("handover-uuid", T_handover_exit);

    const result = await captureClaudeSessionId(TEST_CWD, T_spawn);

    // The correct answer is "handover-uuid" but the current code returns
    // "personal-uuid" because it has a later mtime.
    expect(result).toBe("personal-uuid"); // documents the bug
    expect(result).not.toBe("handover-uuid"); // proves the wrong file is chosen
  });

  it("BUG: returns the personal session when user starts a NEW terminal session after the handover exits", async () => {
    const T_spawn = 1_000_000;
    const T_handover_exit = T_spawn + 10_000;
    const T_new_personal_session = T_handover_exit + 3_000; // user opens new terminal claude

    // User opens a brand-new personal session after the handover finishes
    createJsonl("new-personal-uuid", T_new_personal_session);

    // Handover's file
    createJsonl("handover-uuid", T_handover_exit);

    const result = await captureClaudeSessionId(TEST_CWD, T_spawn);

    // Again: wrong UUID picked because it is newer
    expect(result).toBe("new-personal-uuid");
    expect(result).not.toBe("handover-uuid");
  });

  it("returns the correct handover UUID only when the personal session is idle", async () => {
    const T_spawn = 1_000_000;
    const T_handover_exit = T_spawn + 10_000;
    // Personal session last touched BEFORE the spawn — safe case
    const T_personal_last_used = T_spawn - 60_000;

    createJsonl("personal-uuid", T_personal_last_used);
    createJsonl("handover-uuid", T_handover_exit);

    const result = await captureClaudeSessionId(TEST_CWD, T_spawn);

    // Only works by luck: personal session happened to be idle
    expect(result).toBe("handover-uuid");
  });
});
