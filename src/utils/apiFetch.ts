export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Typed fetch wrapper that:
 * - Parses JSON on 2xx responses
 * - Returns undefined on 204 No Content
 * - Throws ApiError with server's error message on non-2xx
 * - Returns undefined (instead of throwing) when allow404=true and status is 404
 */
export async function apiFetch<T = void>(
  url: string,
  opts?: RequestInit & { allow404?: boolean },
): Promise<T> {
  const { allow404, ...fetchOpts } = opts ?? {};
  const res = Object.keys(fetchOpts).length
    ? await fetch(url, fetchOpts)
    : await fetch(url);
  if (res.ok) {
    if (res.status === 204) {
      return undefined as T;
    }
    return res.json() as Promise<T>;
  }
  if (allow404 && res.status === 404) {
    return undefined as T;
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status);
}
