import { describe, expect, it } from "vitest";
import { soon } from "../src/format";
import { emptyForm, formOf, TIMES, whenOf } from "../src/schedules";

describe("schedule form", () => {
  it("turns each mode into the server's when", () => {
    const f = { ...emptyForm(), timezone: "Europe/London" };
    expect(whenOf({ ...f, mode: "every", count: 15, unit: "m" })).toEqual({ every: "15m" });
    expect(whenOf({ ...f, mode: "daily", time: "09:30", weekdays: true })).toEqual({ cron: "30 9 * * 1-5", timezone: "Europe/London" });
    expect(whenOf({ ...f, mode: "daily", time: "00:00", weekdays: false })).toEqual({ cron: "0 0 * * *", timezone: "Europe/London" });
    expect(whenOf({ ...f, mode: "cron", cron: " 5 4 * * 0 " })).toEqual({ cron: "5 4 * * 0", timezone: "Europe/London" });
  });

  it("reads a plain time of day back as daily, anything else as cron", () => {
    expect(formOf({ every: "2h" })).toMatchObject({ mode: "every", count: 2, unit: "h" });
    expect(formOf({ cron: "30 9 * * 1-5", timezone: "UTC" })).toMatchObject({ mode: "daily", time: "09:30", weekdays: true, timezone: "UTC" });
    expect(formOf({ cron: "7 9 * * *", timezone: "UTC" })).toMatchObject({ mode: "cron", cron: "7 9 * * *" });
    expect(formOf({ cron: "0 */2 * * *", timezone: "UTC" })).toMatchObject({ mode: "cron" });
  });

  it("offers every quarter hour", () => {
    expect(TIMES).toHaveLength(96);
    expect(TIMES[37]).toEqual({ value: "09:15", label: "09:15" });
  });
});

describe("soon", () => {
  it("says when something is due", () => {
    const now = new Date(2026, 9, 28, 10, 0).getTime();
    expect(soon(new Date(now + 20_000).toISOString(), now)).toBe("any moment");
    expect(soon(new Date(now + 5 * 60_000).toISOString(), now)).toBe("in 5 min");
    expect(soon(new Date(2026, 9, 28, 18, 0).toISOString(), now)).toMatch(/^today /);
    expect(soon(new Date(2026, 9, 29, 9, 0).toISOString(), now)).toMatch(/^tomorrow /);
  });
});
