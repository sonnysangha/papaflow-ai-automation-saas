import { describe, expect, it } from "vitest";
import { extractRefs, renameKeyInTemplates, resolveTemplates } from "@/nodes/templates";

/** What `runNode` builds: every node's output keyed by node key, plus the reserved roots. */
const ctx = {
  http_request_1: {
    status: 200,
    body: { user: { name: "Ada" }, ids: [1, 2, 3] },
    ok: true,
    empty: null,
  },
  trigger: { payload: { score: 7 } },
  $item: { name: "row-1" },
};

describe("resolveTemplates", () => {
  it("resolves a string that is exactly one template to the raw value", () => {
    const { value, warnings } = resolveTemplates("{{ http_request_1.body }}", ctx);
    expect(value).toEqual({ user: { name: "Ada" }, ids: [1, 2, 3] });
    expect(warnings).toEqual([]);
  });

  it("preserves numbers, booleans and null through a whole-string template", () => {
    expect(resolveTemplates("{{ http_request_1.status }}", ctx).value).toBe(200);
    expect(resolveTemplates("{{http_request_1.ok}}", ctx).value).toBe(true);
    expect(resolveTemplates("  {{ http_request_1.empty }}  ", ctx).value).toBeNull();
  });

  it("stringifies templates embedded in a longer string", () => {
    const { value } = resolveTemplates(
      "user={{ http_request_1.body.user }} status={{ http_request_1.status }}",
      ctx,
    );
    expect(value).toBe('user={"name":"Ada"} status=200');
  });

  it("indexes arrays with [n]", () => {
    expect(resolveTemplates("{{ http_request_1.body.ids[1] }}", ctx).value).toBe(2);
    expect(resolveTemplates("second={{ http_request_1.body.ids[1] }}", ctx).value).toBe("second=2");
  });

  it("reads the reserved trigger and $item roots", () => {
    expect(resolveTemplates("{{ trigger.payload.score }}", ctx).value).toBe(7);
    expect(resolveTemplates("{{ $item.name }}", ctx).value).toBe("row-1");
  });

  it("resolves a missing path to an empty string and warns once per path", () => {
    const { value, warnings } = resolveTemplates(
      { a: "{{ ghost.field }}", b: "x={{ ghost.field }}", c: "{{ other.thing }}" },
      ctx,
    );
    expect(value).toEqual({ a: "", b: "x=", c: "" });
    expect(warnings).toEqual(["{{ ghost.field }}: not found", "{{ other.thing }}: not found"]);
  });

  it("treats a key that exists but holds undefined as not found", () => {
    const { value, warnings } = resolveTemplates("{{ a.b }}", { a: { b: undefined } });
    expect(value).toBe("");
    expect(warnings).toEqual(["{{ a.b }}: not found"]);
  });

  it("never reaches through the prototype chain", () => {
    expect(resolveTemplates("{{ toString }}", {}).warnings).toEqual(["{{ toString }}: not found"]);
    expect(resolveTemplates("{{ a.constructor }}", { a: {} }).warnings).toEqual([
      "{{ a.constructor }}: not found",
    ]);
  });

  it("walks objects and arrays and leaves non-strings alone", () => {
    const { value, warnings } = resolveTemplates(
      {
        url: "https://example.com/{{ trigger.payload.score }}",
        list: ["{{ http_request_1.status }}", 5],
        on: true,
        keep: null,
      },
      ctx,
    );
    expect(value).toEqual({
      url: "https://example.com/7",
      list: [200, 5],
      on: true,
      keep: null,
    });
    expect(warnings).toEqual([]);
  });

  it("resolves values but not object keys", () => {
    const { value } = resolveTemplates(
      { "{{ trigger.payload.score }}": "{{ trigger.payload.score }}" },
      ctx,
    );
    expect(value).toEqual({ "{{ trigger.payload.score }}": 7 });
  });

  it("returns strings without templates unchanged", () => {
    expect(resolveTemplates("plain { not } a template", ctx).value).toBe("plain { not } a template");
  });

  it("does not mutate the value it is given", () => {
    const inputs = { nested: { text: "{{ trigger.payload.score }}" } };
    resolveTemplates(inputs, ctx);
    expect(inputs.nested.text).toBe("{{ trigger.payload.score }}");
  });
});

describe("extractRefs", () => {
  it("returns unique paths in first-seen order", () => {
    expect(extractRefs("{{ a.b }} and {{ c }}")).toEqual(["a.b", "c"]);
  });

  it("walks nested values and de-duplicates", () => {
    expect(extractRefs({ x: ["{{ a.b }}", "{{ d[0].e }}"], y: "{{ a.b }}", z: 3 })).toEqual([
      "a.b",
      "d[0].e",
    ]);
  });

  it("returns an empty array when there is nothing to resolve", () => {
    expect(extractRefs({ a: "plain", b: 1, c: null })).toEqual([]);
  });
});

describe("renameKeyInTemplates", () => {
  it("rewrites only templates whose root segment is the old key", () => {
    expect(
      renameKeyInTemplates(
        {
          a: "{{ http_request_1.body }}",
          b: "{{ http_request_10.body }}",
          c: "{{ other.http_request_1 }}",
        },
        "http_request_1",
        "fetch_user",
      ),
    ).toEqual({
      a: "{{ fetch_user.body }}",
      b: "{{ http_request_10.body }}",
      c: "{{ other.http_request_1 }}",
    });
  });

  it("keeps the rest of the path, indices included", () => {
    expect(renameKeyInTemplates("x {{ a[0].b }} y {{ a }}", "a", "b1")).toBe(
      "x {{ b1[0].b }} y {{ b1 }}",
    );
  });

  it("leaves values without a matching template untouched", () => {
    expect(renameKeyInTemplates([1, "plain", null], "a", "b")).toEqual([1, "plain", null]);
  });
});
