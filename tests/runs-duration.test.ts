import { describe, expect, it } from "vitest";

import { formatDuration, formatSpanMs, liveDuration } from "@/components/runs/format";

describe("formatDuration", () => {
  it("reads in the unit a person would say out loud", () => {
    expect(formatDuration(0, 240)).toBe("240ms");
    expect(formatDuration(0, 999)).toBe("999ms");
    expect(formatDuration(0, 1_200)).toBe("1.2s");
    expect(formatDuration(0, 59_900)).toBe("59.9s");
    expect(formatDuration(0, 65_000)).toBe("1m 5s");
    expect(formatDuration(0, 7_200_000)).toBe("120m 0s");
  });

  it("is an em dash while the run has not finished", () => {
    expect(formatDuration(1_000)).toBe("—");
    expect(formatDuration(1_000, undefined)).toBe("—");
  });

  it("never goes negative when a clock runs backwards", () => {
    expect(formatDuration(5_000, 4_000)).toBe("0ms");
  });
});

describe("liveDuration", () => {
  it("counts a still-running run up against the caller's clock", () => {
    expect(liveDuration(1_000, undefined, 3_400)).toBe("2.4s");
    expect(liveDuration(1_000, undefined, 1_120)).toBe("120ms");
    expect(liveDuration(1_000, undefined, 121_000)).toBe("2m 0s");
  });

  it("ignores the clock once the run has an end of its own", () => {
    expect(liveDuration(1_000, 2_000, 9_999_999)).toBe("1.0s");
  });

  it("is 0ms rather than negative for a run that started in the future", () => {
    expect(liveDuration(5_000, undefined, 1_000)).toBe("0ms");
  });
});

describe("formatSpanMs", () => {
  it("formats a bare duration the same way", () => {
    expect(formatSpanMs(0)).toBe("0ms");
    expect(formatSpanMs(1_000)).toBe("1.0s");
    expect(formatSpanMs(90_500)).toBe("1m 31s");
  });
});
