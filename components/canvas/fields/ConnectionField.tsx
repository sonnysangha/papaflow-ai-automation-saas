"use client";

import { ConnectionPicker } from "@/components/connections/ConnectionPicker";

export type ConnectionFieldProps = {
  id: string;
  /**
   * The node definition's `credential`: `"ai"` for any AI provider, `"any"` for any connection
   * holding a single token, otherwise a provider name (or a family like `discord`).
   */
  credential: string;
  value: unknown;
  onChange: (value: string | undefined) => void;
};

/**
 * The `connectionId` input, as the config panel renders it: a picker over the org's connections
 * of the kind this node needs, rather than the free-text box the generated form would otherwise
 * give a `z.string()`.
 *
 * What lands in `node.data.inputs.connectionId` is only ever an id — `runNode` opens the sealed
 * credential from it inside the step (CLAUDE.md rule 1).
 */
export function ConnectionField({ id, credential, value, onChange }: ConnectionFieldProps) {
  return (
    <ConnectionPicker
      id={id}
      credential={credential}
      value={typeof value === "string" && value.length > 0 ? value : undefined}
      onChange={onChange}
    />
  );
}
