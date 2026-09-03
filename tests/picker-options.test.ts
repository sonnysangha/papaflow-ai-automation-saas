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
 * those workflows has to keep running. The other pickers (Slack channels, Telegram chats) share the
 * field, so most of what follows is about *not* applying the model rules to them.
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

  it("keeps a template the list does not contain", () => {
    expect(pickerOptions([], "{{ trigger.model }}")).toEqual([
      { id: "{{ trigger.model }}", label: "Custom: {{ trigger.model }}" },
    ]);
  });

  it("shows a value as itself while the list is still loading", () => {
    // `null` is "no list yet", which is not evidence of anything: labelling a saved `gpt-5`
    // `Custom: gpt-5` for the length of a round-trip says exactly the wrong thing about it.
    expect(pickerOptions(null, "gpt-5")).toEqual([{ id: "gpt-5", label: "gpt-5" }]);
    expect(pickerOptions(null, "")).toEqual([]);
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
  it("drops a model the newly chosen account does not offer", () => {
    expect(clearsOnConnectionChange("models", MODELS, "claude-fable-5-1")).toBe(true);
  });

  it("keeps a model the new account does offer", () => {
    expect(clearsOnConnectionChange("models", MODELS, "gpt-5-mini")).toBe(false);
  });

  it("keeps everything when the new account listed nothing", () => {
    // An empty list is not evidence: the connection may simply have no captured model list.
    expect(clearsOnConnectionChange("models", [], "gpt-5")).toBe(false);
  });

  it("never touches a template or an empty field", () => {
    expect(clearsOnConnectionChange("models", MODELS, "{{ trigger.model }}")).toBe(false);
    expect(clearsOnConnectionChange("models", MODELS, "")).toBe(false);
  });

  it("never clears any other kind, because no other list is complete", () => {
    // A Telegram bot only knows the chats that have written to it and Slack's channel listing stops
    // after ten pages, so "absent" does not mean "the account does not have it" — and the value is
    // autosaved, so clearing one would be silent data loss on a workflow that ran fine yesterday.
    const chats = [{ id: "-100123", label: "ops" }];
    for (const kind of ["chats", "channels", "targets", "bases", "tables:appABC"]) {
      expect(clearsOnConnectionChange(kind, chats, "-100999")).toBe(false);
    }
  });
});
