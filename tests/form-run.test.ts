import { describe, expect, it } from "vitest";

import {
  answersToPayload,
  mergeAnswers,
  missingRequiredFields,
  sampleAnswers,
  sampleValueFor,
  type FormAnswers,
} from "@/components/canvas/form-run";
import { parseFormSpec, type FormSpec } from "@/nodes/triggers/form";

/** A realistic spec, parsed the same way the canvas and the forms route both do. */
function spec(fields: FormSpec["fields"]): FormSpec {
  const parsed = parseFormSpec({ fields });
  if (!parsed) throw new Error("invalid fixture spec");
  return parsed;
}

const CONTACT = spec([
  { name: "email", label: "Email", type: "email", required: true },
  { name: "company", label: "Company", type: "text", required: false },
  { name: "seats", label: "Seats", type: "number", required: true },
  { name: "plan", label: "Plan", type: "select", required: true, options: ["Starter", "Pro"] },
  { name: "notes", label: "Notes", type: "textarea", required: false },
]);

describe("sampleValueFor / sampleAnswers", () => {
  it("gives every field type a non-empty sample", () => {
    for (const field of CONTACT.fields) {
      expect(sampleValueFor(field).length).toBeGreaterThan(0);
    }
  });

  it("samples a select from its own first option", () => {
    const plan = CONTACT.fields.find((field) => field.name === "plan")!;
    expect(sampleValueFor(plan)).toBe("Starter");
  });

  it("falls back to an empty string for a select with no options configured yet", () => {
    const empty = spec([
      { name: "choice", label: "Choice", type: "select", required: false, options: [] },
    ]);
    expect(sampleValueFor(empty.fields[0])).toBe("");
  });

  it("covers every configured field, keyed by name", () => {
    const answers = sampleAnswers(CONTACT.fields);
    expect(Object.keys(answers).sort()).toEqual(["company", "email", "notes", "plan", "seats"]);
  });
});

describe("mergeAnswers", () => {
  it("samples every field when nothing was remembered", () => {
    expect(mergeAnswers(CONTACT, null)).toEqual(sampleAnswers(CONTACT.fields));
    expect(mergeAnswers(CONTACT, undefined)).toEqual(sampleAnswers(CONTACT.fields));
  });

  it("prefers a remembered answer over the sample", () => {
    const merged = mergeAnswers(CONTACT, { email: "ada@papaflow.dev" });
    expect(merged.email).toBe("ada@papaflow.dev");
  });

  it("samples a field the remembered set never had", () => {
    const merged = mergeAnswers(CONTACT, { email: "ada@papaflow.dev" });
    expect(merged.seats).toBe(sampleValueFor(CONTACT.fields.find((f) => f.name === "seats")!));
  });

  it("drops a remembered answer for a field the form no longer has", () => {
    const merged = mergeAnswers(CONTACT, { ghost_field: "leftover" });
    expect(merged).not.toHaveProperty("ghost_field");
  });
});

describe("missingRequiredFields", () => {
  it("flags a required field left blank", () => {
    const answers: FormAnswers = { ...sampleAnswers(CONTACT.fields), email: "" };
    expect(missingRequiredFields(CONTACT, answers)).toEqual(["email"]);
  });

  it("ignores an optional field left blank", () => {
    const answers: FormAnswers = { ...sampleAnswers(CONTACT.fields), company: "   " };
    expect(missingRequiredFields(CONTACT, answers)).toEqual([]);
  });

  it("passes once every required field has something", () => {
    expect(missingRequiredFields(CONTACT, sampleAnswers(CONTACT.fields))).toEqual([]);
  });
});

describe("answersToPayload", () => {
  it("matches the shape the forms route builds from a submission", () => {
    const answers: FormAnswers = {
      email: "ada@papaflow.dev",
      company: "Analytical Engines",
      seats: "12",
      plan: "Pro",
      notes: "",
    };

    // `notes` is blank and optional, so — like `present()` in the route — it is left out of
    // `values` rather than sent as `""`.
    expect(answersToPayload(CONTACT, answers, 1_700_000_000_000)).toEqual({
      values: {
        email: "ada@papaflow.dev",
        company: "Analytical Engines",
        seats: 12,
        plan: "Pro",
      },
      submittedAt: 1_700_000_000_000,
    });
  });

  it("required/optional: drops a blank optional field but keeps a filled one", () => {
    const filled = answersToPayload(CONTACT, { ...sampleAnswers(CONTACT.fields), company: "Acme" });
    expect(filled.values.company).toBe("Acme");

    const blank = answersToPayload(CONTACT, { ...sampleAnswers(CONTACT.fields), company: "" });
    expect(blank.values).not.toHaveProperty("company");
  });

  it("required/optional: still omits a blank required field rather than inventing a value", () => {
    // The dialog blocks "Run with these answers" on this via `missingRequiredFields`, but the
    // payload builder itself stays honest about what was actually typed.
    const { values } = answersToPayload(CONTACT, { ...sampleAnswers(CONTACT.fields), email: "" });
    expect(values).not.toHaveProperty("email");
  });

  it("select: passes the chosen option through unchanged", () => {
    const { values } = answersToPayload(CONTACT, { ...sampleAnswers(CONTACT.fields), plan: "Starter" });
    expect(values.plan).toBe("Starter");
  });

  it("number coercion: turns a typed number into an actual number, not a numeric string", () => {
    const { values } = answersToPayload(CONTACT, { ...sampleAnswers(CONTACT.fields), seats: "7" });
    expect(values.seats).toBe(7);
    expect(typeof values.seats).toBe("number");
  });

  it("defaults submittedAt to now when no clock is given", () => {
    const before = Date.now();
    const { submittedAt } = answersToPayload(CONTACT, sampleAnswers(CONTACT.fields));
    const after = Date.now();
    expect(submittedAt).toBeGreaterThanOrEqual(before);
    expect(submittedAt).toBeLessThanOrEqual(after);
  });
});
