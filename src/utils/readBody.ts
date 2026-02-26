import type { IncomingMessage } from "node:http";

/**
 * Buffer and JSON-parse the body of an HTTP request.
 *
 * Resolves with an empty object when the body is empty.
 * Rejects with an Error when the body is not valid JSON.
 */
export function readBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += String(chunk)));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}") as Record<string, unknown>);
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}
