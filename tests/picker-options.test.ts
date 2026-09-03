import { describe, expect, it } from "vitest";

import {
  clearsOnConnectionChange,
  emptyListHint,
  pickerOptions,
} from "@/components/canvas/picker-options";

/**
 * The three decisions a picker makes about a list it has just been handed, pulled out of the field
 * so they can be checked without a DOM.
 *
 * They exist because of the model dropdown: `model` was a text box until now, so every AI node in
 * every saved workflow holds a hand-typed id the new list may or may not contain, and every one of
 * those workflows has to keep running.
 */

const MODELS = [
  { id: "gpt-5", label: "gpt-5" },
  { id: "gpt-5-mini", label: "gpt-5-mini" },
];

describe("pickerOptions", () => {
  it("offers the list as it came back when the value is in it", () => {
    expect(pickerOptions(MODELS, "gpt-5")).toEqual(MODELS);
  });

  it("offers nothing extra when there is no value yet", () => {
    expect(pickerOptions(MODELS, "")).toEqual(MODELS);
  });

  it("keeps a value the list does not contain, marked as custom", () => {
    // A model id typed before this field became a dropdown, or one the provider has since retired.
    expect(pickerOptions(MODELS, "gpt-4o-2024-08-06")).toEqual([
      ...MODELS,
      { id: "gpt-4o-2024-08-06", label: "Custom: gpt-4o-2024-08-06" },
    ]);
  });

  it("keeps a template, and a value whose list never loaded", () => {
    expect(pickerOptions([], "{{ trigger.model }}")).toEqual([
      { id: "{{ trigger.model }}", label: "Custom: {{ trigger.model }}" },
    ]);
    expect(pickerOptions([], "o4-mini")).toEqual([{ id: "o4-mini", label: "Custom: o4-mini" }]);
  });

  it("does not mutate the list it was given", () => {
    const loaded = [...MODELS];
    pickerOptions(loaded, "something-else");
    expect(loaded).toEqual(MODELS);
  });
});

describe("emptyListHint", () => {
  it("sends an empty model list to a text box, naming the way out", () => {
    expect(emptyListHint("models")).toBe(
      "This connection has no model list — re-test it on the Connections page or type a model id",
    );
  });

  it("leaves every other kind as a dropdown", () => {
    // An empty channel list is fixed at the provider ("invite the bot"), not by re-testing here.
    for (const kind of ["channels", "chats", "targets", "bases", "tables:appABC"]) {
      expect(emptyListHint(kind)).toBeNull();
    }
  });
});

describe("clearsOnConnectionChange", () => {
  it("drops a value the newly chosen account does not offer", () => {
    expect(clearsOnConnectionChange(MODELS, "claude-fable-5-1")).toBe(true);
  });

  it("keeps a value the new account does offer", () => {
    expect(clearsOnConnectionChange(MODELS, "gpt-5-mini")).toBe(false);
  });

  it("keeps everything when the new account listed nothing", () => {
    // An empty list is not evidence: the connection may simply have no captured model list.
    expect(clearsOnConnectionChange([], "gpt-5")).toBe(false);
  });

  it("never touches a template or an empty field", () => {
    expect(clearsOnConnectionChange(MODELS, "{{ trigger.model }}")).toBe(false);
    expect(clearsOnConnectionChange(MODELS, "")).toBe(false);
  });
});
