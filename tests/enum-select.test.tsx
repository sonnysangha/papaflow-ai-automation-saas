import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EnumSelect } from "@/components/canvas/fields/EnumSelect";
import { enumOptions } from "@/components/canvas/field-label";
import { NODES } from "@/nodes/registry";
import { toJsonSchema } from "@/nodes/schema";

/**
 * The one place the relabelling could still leak: a select whose trigger falls back to rendering
 * the *stored* value. The whole point of `.meta({ options })` is that "greaterThan" never reaches
 * the screen, so this renders the control the way the panel builds it and reads the markup back.
 *
 * `renderToStaticMarkup` because the unit project runs in plain node — enough for the trigger,
 * which is the only part that has to show the right words before anything is clicked.
 */
const render = (element: React.ReactElement) => renderToStaticMarkup(element);

/** The Condition node's operator field, exactly as `ConfigPanel` derives it. */
function operatorOptions() {
  const properties = toJsonSchema(NODES["logic.condition"].inputs).properties as Record<
    string,
    { enum?: unknown[]; options?: unknown }
  >;
  const values = (properties.operator.enum ?? []).filter(
    (entry): entry is string => typeof entry === "string",
  );
  return enumOptions(values, properties.operator);
}

describe("EnumSelect", () => {
  it("shows the chosen value's words, not the value the graph stores", () => {
    const html = render(
      <EnumSelect id="op" value="greaterThan" options={operatorOptions()} onChange={() => {}} />,
    );

    expect(html).toContain("is greater than");
    // The stored value only belongs in the option's `value`, never in the trigger's text.
    expect(html).not.toContain(">greaterThan<");
  });

  it("offers every comparison as a sentence", () => {
    const options = operatorOptions();
    expect(options).toContainEqual({ value: "equals", label: "is equal to" });
    expect(options).toContainEqual({ value: "notEquals", label: "is not equal to" });
    expect(options).toContainEqual({ value: "contains", label: "contains" });
    expect(options).toContainEqual({ value: "greaterThan", label: "is greater than" });
    expect(options).toContainEqual({ value: "lessThan", label: "is less than" });
    expect(options).toContainEqual({ value: "isEmpty", label: "is empty" });
    expect(options).toContainEqual({ value: "matchesRegex", label: "matches pattern (regex)" });
  });

  it("falls back to the placeholder when nothing is chosen", () => {
    const html = render(
      <EnumSelect id="op" value={undefined} options={operatorOptions()} onChange={() => {}} />,
    );
    expect(html).toContain("Choose…");
  });

  it("shows a value that is no longer an option as itself rather than as an empty box", () => {
    const html = render(
      <EnumSelect id="op" value="retired" options={operatorOptions()} onChange={() => {}} />,
    );
    expect(html).toContain("retired");
  });
});
