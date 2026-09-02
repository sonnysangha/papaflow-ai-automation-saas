import { describe, expect, it } from "vitest";

import { resolvePickerKind } from "@/components/canvas/picker-kind";

/**
 * `picker: "tables:{baseId}"` — a remote list that only exists relative to a sibling input. The
 * config panel disables the field while `missing` names one, so the substitution and the emptiness
 * test are the whole contract.
 */
describe("resolvePickerKind", () => {
  it("leaves a kind with no placeholder alone", () => {
    expect(resolvePickerKind("channels", {})).toEqual({ kind: "channels", missing: [] });
    expect(resolvePickerKind("channels", { baseId: "app1" })).toEqual({
      kind: "channels",
      missing: [],
    });
  });

  it("substitutes one placeholder from a sibling input", () => {
    expect(resolvePickerKind("tables:{baseId}", { baseId: "appABC" })).toEqual({
      kind: "tables:appABC",
      missing: [],
    });
  });

  it("names the sibling that has no value yet", () => {
    expect(resolvePickerKind("tables:{baseId}", {})).toEqual({ kind: "tables:", missing: ["baseId"] });
    expect(resolvePickerKind("tables:{baseId}", { baseId: "" })).toEqual({
      kind: "tables:",
      missing: ["baseId"],
    });
    expect(resolvePickerKind("tables:{baseId}", { baseId: "   " })).toEqual({
      kind: "tables:",
      missing: ["baseId"],
    });
    expect(resolvePickerKind("tables:{baseId}", { baseId: null })).toEqual({
      kind: "tables:",
      missing: ["baseId"],
    });
  });

  it("substitutes several placeholders, and lists only the empty ones", () => {
    expect(
      resolvePickerKind("fields:{baseId}:{tableId}", { baseId: "appABC", tableId: "tbl1" }),
    ).toEqual({ kind: "fields:appABC:tbl1", missing: [] });

    expect(resolvePickerKind("fields:{baseId}:{tableId}", { tableId: "tbl1" })).toEqual({
      kind: "fields::tbl1",
      missing: ["baseId"],
    });

    expect(resolvePickerKind("fields:{baseId}:{tableId}", {})).toEqual({
      kind: "fields::",
      missing: ["baseId", "tableId"],
    });
  });

  it("names a repeated placeholder once", () => {
    expect(resolvePickerKind("{baseId}:{baseId}", {})).toEqual({ kind: ":", missing: ["baseId"] });
  });

  it("keeps values that are answers but not strings", () => {
    expect(resolvePickerKind("rows:{limit}", { limit: 0 })).toEqual({ kind: "rows:0", missing: [] });
    expect(resolvePickerKind("rows:{all}", { all: false })).toEqual({
      kind: "rows:false",
      missing: [],
    });
  });
});
