/**
 * @jest-environment node
 */
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";

import { readBody } from "./readBody";

// ── helpers ───────────────────────────────────────────────────────────────────

/** Create a minimal IncomingMessage-compatible emitter that fires data/end. */
function makeReq(body: string): IncomingMessage {
  const emitter = new EventEmitter();
  process.nextTick(() => {
    if (body) emitter.emit("data", body);
    emitter.emit("end");
  });
  return emitter as unknown as IncomingMessage;
}

function makeErrorReq(err: Error): IncomingMessage {
  const emitter = new EventEmitter();
  process.nextTick(() => {
    emitter.emit("error", err);
  });
  return emitter as unknown as IncomingMessage;
}

// ── readBody ──────────────────────────────────────────────────────────────────

describe("readBody", () => {
  it("resolves with parsed JSON for a valid body", async () => {
    const result = await readBody(makeReq(JSON.stringify({ foo: "bar" })));
    expect(result).toEqual({ foo: "bar" });
  });

  it("resolves with an empty object for an empty body", async () => {
    const result = await readBody(makeReq(""));
    expect(result).toEqual({});
  });

  it("handles chunked data (multiple data events)", async () => {
    const emitter = new EventEmitter();
    process.nextTick(() => {
      emitter.emit("data", '{"a":');
      emitter.emit("data", '"hello"}');
      emitter.emit("end");
    });
    const result = await readBody(emitter as unknown as IncomingMessage);
    expect(result).toEqual({ a: "hello" });
  });

  it("rejects with Invalid JSON body for malformed input", async () => {
    await expect(readBody(makeReq("not-json{}"))).rejects.toThrow(
      "Invalid JSON body",
    );
  });

  it("rejects when the stream emits an error event", async () => {
    const err = new Error("connection reset");
    await expect(readBody(makeErrorReq(err))).rejects.toThrow(
      "connection reset",
    );
  });

  it("parses nested objects and arrays", async () => {
    const payload = { tasks: [1, 2, 3], meta: { page: 1 } };
    const result = await readBody(makeReq(JSON.stringify(payload)));
    expect(result).toEqual(payload);
  });
});
