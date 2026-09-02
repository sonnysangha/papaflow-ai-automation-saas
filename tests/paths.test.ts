import { describe, expect, it } from "vitest";
import { z } from "zod";
import { outputPaths } from "@/nodes/paths";

describe("outputPaths", () => {
  it("lists the root object's properties with their JSON Schema types", () => {
    expect(
      outputPaths(
        z.object({
          status: z.number(),
          body: z.any(),
          headers: z.record(z.string(), z.string()),
        }),
      ),
    ).toEqual([
      { path: "status", type: "number" },
      { path: "body", type: "any" },
      { path: "headers", type: "object" },
    ]);
  });

  it("does not recurse into a record, whose keys are unknown", () => {
    expect(
      outputPaths(z.object({ meta: z.record(z.string(), z.object({ a: z.string() })) })),
    ).toEqual([{ path: "meta", type: "object" }]);
  });

  it("recurses into nested objects three levels deep and no further", () => {
    expect(
      outputPaths(
        z.object({ a: z.object({ b: z.object({ c: z.object({ d: z.string() }) }) }) }),
      ).map((entry) => entry.path),
    ).toEqual(["a", "a.b", "a.b.c"]);
  });

  it("adds [0] for an array, typed by its items", () => {
    expect(
      outputPaths(
        z.object({
          tags: z.array(z.string()),
          rows: z.array(z.object({ id: z.string(), meta: z.object({ deep: z.number() }) })),
        }),
      ),
    ).toEqual([
      { path: "tags", type: "array" },
      { path: "tags[0]", type: "string" },
      { path: "rows", type: "array" },
      { path: "rows[0]", type: "object" },
      { path: "rows[0].id", type: "string" },
      { path: "rows[0].meta", type: "object" },
    ]);
  });

  it("types schemas the JSON Schema cannot pin down as any", () => {
    expect(
      outputPaths(
        z.object({
          whatever: z.unknown(),
          either: z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]),
          scalar: z.union([z.string(), z.number()]),
          maybe: z.string().nullable(),
          flag: z.boolean(),
          pick: z.enum(["a", "b"]),
        }),
      ),
    ).toEqual([
      { path: "whatever", type: "any" },
      { path: "either", type: "any" },
      { path: "scalar", type: "string|number" },
      { path: "maybe", type: "string" },
      { path: "flag", type: "boolean" },
      { path: "pick", type: "string" },
    ]);
  });

  it("lists nothing for a schema with no addressable children", () => {
    expect(outputPaths(z.record(z.string(), z.any()))).toEqual([]);
    expect(outputPaths(z.string())).toEqual([]);
    expect(outputPaths(z.any())).toEqual([]);
  });

  it("indexes a root array as [0]", () => {
    expect(outputPaths(z.array(z.object({ a: z.string() })))).toEqual([
      { path: "[0]", type: "object" },
      { path: "[0].a", type: "string" },
    ]);
  });

  it("describes the HTTP Request node's outputs", () => {
    const paths = outputPaths(
      z.object({
        status: z.number(),
        headers: z.record(z.string(), z.string()),
        body: z.any(),
      }),
    );
    expect(paths.map((entry) => entry.path)).toEqual(["status", "headers", "body"]);
  });
});
