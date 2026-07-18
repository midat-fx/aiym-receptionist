import { describe, expect, it } from "vitest";
import { generateCandidates } from "../src/engine/slots";
import { makeBusiness, makeService } from "./factories";

// Fixed «now» = Saturday 2026-07-18 14:00 Almaty (09:00 UTC).
const NOW = new Date("2026-07-18T09:00:00Z");
const MON = "2026-07-20"; // weekday, 10:00–20:00
const starts = (b: ReturnType<typeof makeBusiness>, s: ReturnType<typeof makeService>, from: string, to: string, part: "any" | "morning" | "afternoon" | "evening" = "any") =>
  generateCandidates(b, s, from, to, part, NOW).map((x) => x.startLocal);

describe("generateCandidates", () => {
  it("builds the grid every slot_step to the last fitting start (10:00..18:30 for a 90′ service)", () => {
    const s = starts(makeBusiness(), makeService({ duration_min: 90 }), MON, MON);
    expect(s[0]).toBe(`${MON}T10:00`);
    expect(s[s.length - 1]).toBe(`${MON}T18:30`);
    expect(s.length).toBe(18);
  });

  it("respects a lunch break (two intervals) and never offers the closed hour", () => {
    const b = makeBusiness({ working_hours: JSON.stringify({ mon: [["10:00", "14:00"], ["15:00", "19:00"]] }) });
    const s = starts(b, makeService({ duration_min: 30 }), MON, MON);
    expect(s).toContain(`${MON}T13:30`); // last of the first window
    expect(s).not.toContain(`${MON}T14:00`); // closed
    expect(s).toContain(`${MON}T15:00`); // first of the second window
    expect(s[s.length - 1]).toBe(`${MON}T18:30`);
  });

  it("returns nothing on a closed day", () => {
    const b = makeBusiness({ working_hours: JSON.stringify({ sun: [] }) });
    expect(starts(b, makeService({ duration_min: 30 }), "2026-07-19", "2026-07-19")).toEqual([]);
  });

  it("fits a long service right up to the end of the window (180′ -> last start 17:00)", () => {
    const s = starts(makeBusiness(), makeService({ duration_min: 180 }), MON, MON);
    expect(s[0]).toBe(`${MON}T10:00`);
    expect(s[s.length - 1]).toBe(`${MON}T17:00`);
    expect(s).not.toContain(`${MON}T17:30`);
  });

  it("subtracts the buffer from the last fitting start", () => {
    const withBuffer = starts(makeBusiness({ buffer_min: 15 }), makeService({ duration_min: 60 }), MON, MON);
    const noBuffer = starts(makeBusiness({ buffer_min: 0 }), makeService({ duration_min: 60 }), MON, MON);
    expect(noBuffer[noBuffer.length - 1]).toBe(`${MON}T19:00`);
    expect(withBuffer[withBuffer.length - 1]).toBe(`${MON}T18:30`);
    expect(withBuffer).not.toContain(`${MON}T19:00`);
  });

  it("drops slots earlier than now + 60 min lead time (today)", () => {
    const s = starts(makeBusiness(), makeService({ duration_min: 30 }), "2026-07-18", "2026-07-18");
    expect(s).not.toContain("2026-07-18T10:00");
    expect(s).not.toContain("2026-07-18T14:30");
    expect(s[0]).toBe("2026-07-18T15:00"); // now 14:00 + 60 min
  });

  it("empties today when now is within the lead time of closing", () => {
    const lateNow = new Date("2026-07-18T14:30:00Z"); // 19:30 Almaty
    const s = generateCandidates(makeBusiness(), makeService({ duration_min: 30 }), "2026-07-18", "2026-07-18", "any", lateNow);
    expect(s).toEqual([]);
  });

  it("filters part_of_day = morning (<12:00)", () => {
    const s = starts(makeBusiness(), makeService({ duration_min: 30 }), MON, MON, "morning");
    expect(s).toContain(`${MON}T11:30`);
    expect(s).not.toContain(`${MON}T12:00`);
    expect(s.every((x) => Number(x.slice(11, 13)) < 12)).toBe(true);
  });

  it("filters part_of_day = afternoon (12:00–16:59)", () => {
    const s = starts(makeBusiness(), makeService({ duration_min: 30 }), MON, MON, "afternoon");
    expect(s).toContain(`${MON}T12:00`);
    expect(s).toContain(`${MON}T16:30`);
    expect(s).not.toContain(`${MON}T11:30`);
    expect(s).not.toContain(`${MON}T17:00`);
  });

  it("filters part_of_day = evening (>=17:00)", () => {
    const s = starts(makeBusiness(), makeService({ duration_min: 30 }), MON, MON, "evening");
    expect(s).toContain(`${MON}T17:00`);
    expect(s).not.toContain(`${MON}T16:30`);
    expect(s.every((x) => Number(x.slice(11, 13)) >= 17)).toBe(true);
  });

  it("clamps the range to [today, today+horizon-1]", () => {
    // horizon 14, today 2026-07-18 -> last bookable day 2026-07-31.
    expect(starts(makeBusiness(), makeService({ duration_min: 30 }), "2026-08-01", "2026-08-01")).toEqual([]);
    const s = starts(makeBusiness(), makeService({ duration_min: 30 }), "2026-07-30", "2026-08-05");
    expect(s.every((x) => x < "2026-08-01")).toBe(true);
    expect(s.length).toBeGreaterThan(0);
  });

  it("clamps a past from-date up to today", () => {
    const s = starts(makeBusiness(), makeService({ duration_min: 30 }), "2026-07-10", "2026-07-18");
    expect(s.every((x) => x >= "2026-07-18")).toBe(true);
  });
});
