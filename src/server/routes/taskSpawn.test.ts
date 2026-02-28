/**
 * @jest-environment node
 */

import * as pty from "node-pty";

import { buildArgs, buildChildEnv, spawnClaude, stripAnsi } from "./taskSpawn";

// ── Mock node-pty ─────────────────────────────────────────────────────────────

jest.mock("node-pty", () => ({
  spawn: jest.fn().mockReturnValue({ onData: jest.fn(), onExit: jest.fn() }),
}));

const mockPtySpawn = pty.spawn as jest.MockedFunction<typeof pty.spawn>;

// ── stripAnsi ─────────────────────────────────────────────────────────────────

describe("stripAnsi", () => {
  it("strips CSI sequences (e.g. color codes like \\x1b[31m)", () => {
    expect(stripAnsi("\x1b[31mHello\x1b[0m")).toBe("Hello");
  });

  it("strips OSC sequences terminated by BEL (\\x07)", () => {
    expect(stripAnsi("\x1b]0;My Terminal Title\x07plain text")).toBe(
      "plain text",
    );
  });

  it("passes through plain text unchanged", () => {
    expect(stripAnsi("Hello, World!")).toBe("Hello, World!");
  });

  it("returns empty string for empty input", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("strips multiple escape sequences in a single string", () => {
    const input = "\x1b[1m\x1b[32mBold Green\x1b[0m normal \x1b[31mred\x1b[0m";
    expect(stripAnsi(input)).toBe("Bold Green normal red");
  });
});

// ── buildChildEnv ─────────────────────────────────────────────────────────────

describe("buildChildEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("includes normal environment variables", () => {
    process.env["MY_TEST_VAR"] = "hello";

    const result = buildChildEnv();

    expect(result["MY_TEST_VAR"]).toBe("hello");
  });

  it("excludes CLAUDECODE", () => {
    process.env["CLAUDECODE"] = "1";

    const result = buildChildEnv();

    expect(result).not.toHaveProperty("CLAUDECODE");
  });

  it("excludes CLAUDE_CODE_ENTRYPOINT", () => {
    process.env["CLAUDE_CODE_ENTRYPOINT"] = "cli";

    const result = buildChildEnv();

    expect(result).not.toHaveProperty("CLAUDE_CODE_ENTRYPOINT");
  });

  it("excludes CLAUDE_CODE_SSE_PORT", () => {
    process.env["CLAUDE_CODE_SSE_PORT"] = "3000";

    const result = buildChildEnv();

    expect(result).not.toHaveProperty("CLAUDE_CODE_SSE_PORT");
  });

  it("excludes CLAUDE_CODE_UI_SESSION_ID", () => {
    process.env["CLAUDE_CODE_UI_SESSION_ID"] = "sess-abc";

    const result = buildChildEnv();

    expect(result).not.toHaveProperty("CLAUDE_CODE_UI_SESSION_ID");
  });

  it("does not include keys whose value is undefined", () => {
    // Object.assign with undefined value key — force an undefined entry
    (process.env as Record<string, string | undefined>)["UNDEF_KEY"] =
      undefined;

    const result = buildChildEnv();

    expect(result).not.toHaveProperty("UNDEF_KEY");
  });
});

// ── buildArgs ─────────────────────────────────────────────────────────────────

describe("buildArgs", () => {
  it("returns base flags and prompt when resumeId is undefined", () => {
    const result = buildArgs(undefined, "do the thing");

    expect(result).toEqual([
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "-p",
      "do the thing",
    ]);
  });

  it("inserts --resume <id> before the prompt when resumeId is provided", () => {
    const result = buildArgs("resume-123", "do the thing");

    expect(result).toEqual([
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--resume",
      "resume-123",
      "-p",
      "do the thing",
    ]);
  });

  it("always ends with -p and specText as the last two args", () => {
    const withResume = buildArgs("r1", "my spec");
    const withoutResume = buildArgs(undefined, "my spec");

    expect(withResume.at(-2)).toBe("-p");
    expect(withResume.at(-1)).toBe("my spec");
    expect(withoutResume.at(-2)).toBe("-p");
    expect(withoutResume.at(-1)).toBe("my spec");
  });
});

// ── spawnClaude ───────────────────────────────────────────────────────────────

describe("spawnClaude", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockPtySpawn.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("calls pty.spawn with cols=220 and rows=24", () => {
    spawnClaude(["--help"], "/tmp");

    expect(mockPtySpawn).toHaveBeenCalledTimes(1);
    const [, , opts] = mockPtySpawn.mock.calls[0];
    expect(opts.cols).toBe(220);
    expect(opts.rows).toBe(24);
  });

  it("uses CLAUDE_PATH env var as the command when set", () => {
    process.env["CLAUDE_PATH"] = "/custom/path/to/claude";

    spawnClaude([], "/tmp");

    const [cmd] = mockPtySpawn.mock.calls[0];
    expect(cmd).toBe("/custom/path/to/claude");
  });

  it("uses 'claude.cmd' on win32 when CLAUDE_PATH is not set", () => {
    delete process.env["CLAUDE_PATH"];
    const originalPlatform = Object.getOwnPropertyDescriptor(
      process,
      "platform",
    );
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });

    try {
      spawnClaude([], "/tmp");

      const [cmd] = mockPtySpawn.mock.calls[0];
      expect(cmd).toBe("claude.cmd");
    } finally {
      if (originalPlatform) {
        Object.defineProperty(process, "platform", originalPlatform);
      }
    }
  });
});
