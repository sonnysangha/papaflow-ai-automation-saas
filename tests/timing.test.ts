import { describe, expect, it } from "vitest";

import { safeEqual } from "@/lib/timing";

describe("safeEqual", () => {
  it("accepts identical strings", () => {
    expect(safeEqual("s3cr3t", "s3cr3t")).toBe(true);
    expect(safeEqual("", "")).toBe(true);
  });

  it("rejects same-length strings that differ anywhere", () => {
    expect(safeEqual("s3cr3t", "s3cr3T")).toBe(false);
    expect(safeEqual("s3cr3t", "S3cr3t")).toBe(false);
  });

  it("rejects strings of different lengths instead of throwing", () => {
    // `crypto.timingSafeEqual` throws on unequal buffers; the length check has to come first.
    expect(safeEqual("s3cr3t", "s3cr3t-and-more")).toBe(false);
    expect(safeEqual("", "s3cr3t")).toBe(false);
  });

  it("compares bytes, not code units", () => {
    expect(safeEqual("é", "é")).toBe(true);
    // Same visible character, different encodings (composed vs decomposed) — not equal.
    expect(safeEqual("é", "é")).toBe(false);
  });
});
