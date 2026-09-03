import { describe, expect, it } from "vitest";

import {
  choicesForKey,
  clearsOnConnectionChange,
  emptyListHint,
  emptyOptionsNote,
  firstUnusedKey,
  GENERIC_EMPTY_NOTE,
  keyOptions,
  parsePickerOptions,
  pickerOptions,
  type PickerOption,
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

/**
 * The sentence under a dropdown that came back empty, which is the whole of what a user has to go
 * on. It used to be one line for every provider — "invite the bot where it needs to post" — which
 * is advice you cannot follow on Telegram, where a bot cannot be invited into a DM and cannot
 * message anyone who has not written to it first. Each connector now writes its own.
 */
describe("emptyOptionsNote", () => {
  it("asks a Telegram user to message the bot, not to invite it", () => {
    const note = emptyOptionsNote("targets", "telegram");
    expect(note).toBe(
      "No chats yet. Open Telegram, send the bot any message (or /start) from the account or " +
        "group you want it to post in, then reload.",
    );
    expect(note).not.toMatch(/invite/i);
    expect(emptyOptionsNote("chats", "telegram")).toBe(note);
  });

  it("offers Slack a channel invite or a person to DM", () => {
    expect(emptyOptionsNote("targets", "slack")).toMatch(/Invite the bot to a channel/);
    expect(emptyOptionsNote("channels", "slack")).toMatch(/person to DM/);
  });

  it("sends a Discord user to the server invite, and names the typed way to DM", () => {
    expect(emptyOptionsNote("targets", "discord-bot")).toMatch(/Invite the bot to the server/);
    expect(emptyOptionsNote("targets", "discord-bot")).toMatch(/user:<their Discord id>/);
  });

  it("falls back to the generic line for an unknown provider, a kind nobody explained, and none", () => {
    // `undefined` is the real case: the connection list has not arrived yet, or the row is gone.
    expect(emptyOptionsNote("targets", undefined)).toBe(GENERIC_EMPTY_NOTE);
    expect(emptyOptionsNote("targets", "not-a-provider")).toBe(GENERIC_EMPTY_NOTE);
    // A connector with no `emptyHint` at all, and one that has one but not for this kind.
    expect(emptyOptionsNote("bases", "airtable")).toBe(GENERIC_EMPTY_NOTE);
    expect(emptyOptionsNote("guilds", "discord-bot")).toBe(GENERIC_EMPTY_NOTE);
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

/**
 * The key half of a `{ key, value }` row — an Airtable column, a Notion property — is the same
 * dropdown with two extra rules: a key is a *slot*, so one another row already writes is not on
 * offer, and the list now describes what it lists (`type`, `choices`), which is what turns the
 * value half into a dropdown of its own.
 */
const COLUMNS: PickerOption[] = [
  { id: "Name", label: "Name", type: "singleLineText" },
  { id: "Status", label: "Status", type: "singleSelect", choices: ["Todo", "Done"] },
  { id: "Notes", label: "Notes", type: "multilineText" },
];

describe("parsePickerOptions", () => {
  it("carries a column's type and its choices through untouched", () => {
    expect(parsePickerOptions({ options: COLUMNS })).toEqual(COLUMNS);
  });

  it("leaves both off a list that describes nothing", () => {
    // Channels and chats are just names; the value field must not become a dropdown of nothing.
    expect(parsePickerOptions({ options: [{ id: "C123", label: "general" }] })).toEqual([
      { id: "C123", label: "general" },
    ]);
  });

  it("drops an entry with no usable id, and names one with no label after its id", () => {
    expect(
      parsePickerOptions({
        options: [{ id: "", label: "nameless" }, { label: "no id at all" }, null, "a string", { id: "C1" }],
      }),
    ).toEqual([{ id: "C1", label: "C1" }]);
  });

  it("ignores choices that are not a list of names", () => {
    expect(
      parsePickerOptions({
        options: [
          { id: "a", label: "a", choices: "Todo" },
          { id: "b", label: "b", choices: [] },
          { id: "c", label: "c", choices: ["Todo", 7, null, "Done"] },
          { id: "d", label: "d", type: 12 },
        ],
      }),
    ).toEqual([
      { id: "a", label: "a" },
      { id: "b", label: "b" },
      { id: "c", label: "c", choices: ["Todo", "Done"] },
      { id: "d", label: "d" },
    ]);
  });

  it("answers a body that is not a list with nothing", () => {
    expect(parsePickerOptions({})).toEqual([]);
    expect(parsePickerOptions({ options: "nope" })).toEqual([]);
    expect(parsePickerOptions(null)).toEqual([]);
  });
});

describe("keyOptions", () => {
  it("offers every column while nothing is written yet", () => {
    expect(keyOptions(COLUMNS, [], "")).toEqual(COLUMNS);
  });

  it("does not offer a column another row already writes", () => {
    // Two rows for the same column is never the intent, and the second would silently win.
    expect(keyOptions(COLUMNS, ["Name", "Notes"], "Notes").map((option) => option.id)).toEqual([
      "Status",
      "Notes",
    ]);
  });

  it("keeps this row's own key, which is of course in use", () => {
    expect(keyOptions(COLUMNS, ["Status"], "Status")).toEqual(COLUMNS);
  });

  it("keeps a key the table no longer has, marked as custom", () => {
    // A column renamed in Airtable since this workflow was saved: what it writes still shows.
    expect(keyOptions(COLUMNS, ["Owner"], "Owner")).toEqual([
      ...COLUMNS,
      { id: "Owner", label: "Custom: Owner" },
    ]);
  });

  it("shows a key as itself while the list is still loading", () => {
    expect(keyOptions(null, ["Owner"], "Owner")).toEqual([{ id: "Owner", label: "Owner" }]);
    expect(keyOptions(null, [], "")).toEqual([]);
  });

  it("does not mutate the list it was given", () => {
    const loaded = [...COLUMNS];
    keyOptions(loaded, ["Name"], "Owner");
    expect(loaded).toEqual(COLUMNS);
  });
});

describe("firstUnusedKey", () => {
  it("opens a new row on the first column nothing writes yet", () => {
    expect(firstUnusedKey(COLUMNS, ["Name"])).toBe("Status");
    expect(firstUnusedKey(COLUMNS, [])).toBe("Name");
  });

  it("leaves the row empty when every column is spoken for", () => {
    expect(firstUnusedKey(COLUMNS, ["Name", "Status", "Notes"])).toBe("");
  });

  it("leaves the row empty while there is no list to spend", () => {
    expect(firstUnusedKey(null, [])).toBe("");
  });
});

describe("choicesForKey", () => {
  it("gives an enum-like column its options", () => {
    expect(choicesForKey(COLUMNS, "Status")).toEqual(["Todo", "Done"]);
  });

  it("gives every other case nothing, so the value stays a template field", () => {
    expect(choicesForKey(COLUMNS, "Notes")).toBeNull();
    expect(choicesForKey(COLUMNS, "Owner")).toBeNull();
    expect(choicesForKey(COLUMNS, "")).toBeNull();
    expect(choicesForKey(null, "Status")).toBeNull();
  });

  it("hands back a copy, not the list's own array", () => {
    choicesForKey(COLUMNS, "Status")?.push("Blocked");
    expect(COLUMNS[1].choices).toEqual(["Todo", "Done"]);
  });
});
