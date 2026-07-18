import { describe, expect, it } from "vitest";
import { addDays, formatSlotLabel, localToTs, todayInTz, weekdayOf } from "../src/engine/time";

const ALMATY = "Asia/Almaty";

describe("todayInTz", () => {
  it("returns the local calendar date in Almaty", () => {
    // 2026-07-18 09:00 UTC = 14:00 Almaty.
    expect(todayInTz(ALMATY, new Date("2026-07-18T09:00:00Z"))).toBe("2026-07-18");
  });

  it("rolls the date at the local midnight boundary, not the UTC one", () => {
    // 2026-07-18 19:30 UTC = 2026-07-19 00:30 Almaty (+5).
    expect(todayInTz(ALMATY, new Date("2026-07-18T19:30:00Z"))).toBe("2026-07-19");
  });
});

describe("weekdayOf", () => {
  it("maps known dates to weekday keys", () => {
    expect(weekdayOf("2026-07-18")).toBe("sat");
    expect(weekdayOf("2026-07-19")).toBe("sun");
    expect(weekdayOf("2026-07-20")).toBe("mon");
    expect(weekdayOf("2026-07-22")).toBe("wed");
    expect(weekdayOf("2026-07-24")).toBe("fri");
  });
});

describe("addDays", () => {
  it("adds a day within the month", () => {
    expect(addDays("2026-07-18", 1)).toBe("2026-07-19");
  });

  it("crosses month boundaries in both directions", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-07-01", -1)).toBe("2026-06-30");
  });

  it("crosses the year boundary", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("localToTs", () => {
  it("resolves Almaty wall-clock to UTC seconds (+5, no DST)", () => {
    // 2026-07-18 15:00 Almaty = 10:00 UTC.
    expect(localToTs("2026-07-18T15:00", ALMATY)).toBe(Date.UTC(2026, 6, 18, 10, 0) / 1000);
  });

  it("is stable across a month boundary", () => {
    expect(localToTs("2026-08-01T09:00", ALMATY)).toBe(Date.UTC(2026, 7, 1, 4, 0) / 1000);
  });
});

describe("formatSlotLabel", () => {
  it("formats «weekday, day month, HH:mm» without a preposition", () => {
    const ts = localToTs("2026-07-18T15:00", ALMATY);
    expect(formatSlotLabel(ts, ALMATY)).toBe("сб, 18 июля, 15:00");
  });
});
