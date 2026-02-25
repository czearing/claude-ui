// src/utils/formatRelativeDate.test.ts
import { formatRelativeDate } from "./formatRelativeDate";

describe("formatRelativeDate", () => {
  const NOW = new Date("2024-06-15T12:00:00.000Z").getTime();

  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns "just now" when less than 60 seconds have passed', () => {
    expect(formatRelativeDate(new Date(NOW - 30_000).toISOString())).toBe(
      "just now",
    );
  });

  it('returns "just now" at 59 seconds', () => {
    expect(formatRelativeDate(new Date(NOW - 59_000).toISOString())).toBe(
      "just now",
    );
  });

  it('returns "1 minute ago" at exactly 60 seconds', () => {
    expect(formatRelativeDate(new Date(NOW - 60_000).toISOString())).toBe(
      "1 minute ago",
    );
  });

  it('returns "X minutes ago" for multiple minutes', () => {
    expect(formatRelativeDate(new Date(NOW - 45 * 60_000).toISOString())).toBe(
      "45 minutes ago",
    );
  });

  it('returns "1 hour ago" at exactly 60 minutes', () => {
    expect(formatRelativeDate(new Date(NOW - 60 * 60_000).toISOString())).toBe(
      "1 hour ago",
    );
  });

  it('returns "X hours ago" for multiple hours', () => {
    expect(
      formatRelativeDate(new Date(NOW - 5 * 3_600_000).toISOString()),
    ).toBe("5 hours ago");
  });

  it('returns "1 day ago" at exactly 24 hours', () => {
    expect(
      formatRelativeDate(new Date(NOW - 24 * 3_600_000).toISOString()),
    ).toBe("1 day ago");
  });

  it('returns "X days ago" for multiple days', () => {
    expect(
      formatRelativeDate(new Date(NOW - 7 * 24 * 3_600_000).toISOString()),
    ).toBe("7 days ago");
  });

  it('returns "1 month ago" at exactly 30 days', () => {
    expect(
      formatRelativeDate(new Date(NOW - 30 * 24 * 3_600_000).toISOString()),
    ).toBe("1 month ago");
  });

  it('returns "X months ago" for multiple months', () => {
    expect(
      formatRelativeDate(new Date(NOW - 90 * 24 * 3_600_000).toISOString()),
    ).toBe("3 months ago");
  });
});
