import { MODELS_PICKER, type PickerOption } from "../../../connectors/define";
import { CONNECTORS } from "../../../connectors/registry";
import { isTextGenerationModel } from "../../../lib/ai/model-list";
import { listOrgConnections, openOrgConnection } from "../../../lib/connections-engine";

import type { BuilderSession } from "./session";
import { viaEngine } from "./tool-result";

/**
 * The lists the canvas' dropdowns are filled from, for the agent that is filling the same fields
 * blind.
 *
 * This is the fix for the Airtable rows full of nothing: a model that cannot see a base's tables
 * writes `"Name"` and hopes, and Airtable's `typecast: true` cheerfully accepts a column that does
 * not exist. Asking the provider is the only way to be right.
 *
 * It is a re-implementation of `lib/connections-server.ts#pickConnectionOptions` rather than a call
 * to it, for the reason that shapes this whole directory: that module imports
 * `lib/engine-client.ts`, which imports `workflows/run-graph.ts` to make the workflow discoverable,
 * and eve compiles an agent by following its imports — the Builder's bundle has no business
 * carrying every step file and the whole `"use workflow"` orchestrator. The dependency list here is
 * the connector registry, the model filter, and `lib/connections-engine.ts` (CLAUDE.md rule 5).
 *
 * The behaviour is deliberately identical, including the two cases that are easy to miss:
 * `models` is answered from the stored `meta` without opening the credential at all (CLAUDE.md
 * rule 11 — every AI connector captured its provider's list at connect time), and a connector with
 * no `pick` at all is a refusal rather than an empty list.
 *
 * Nothing secret comes back. A `PickerOption` describes a remote object — an id, a label, and for
 * an enum-like column its type and choices — and the plaintext this opens is dropped on the next
 * line (CLAUDE.md rule 1).
 */

/** The model ids a connection captured at connect time, filtered and sorted like the dropdown. */
export function modelOptions(meta: Record<string, unknown> | undefined): PickerOption[] {
  if (!meta || !Array.isArray(meta.models)) return [];

  const seen = new Set<string>();
  const options: PickerOption[] = [];
  for (const entry of meta.models) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (id.length === 0 || seen.has(id) || !isTextGenerationModel(id)) continue;
    seen.add(id);
    options.push({ id, label: id });
  }
  return options.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The options one config field would offer, for a connection this organisation owns.
 *
 * @throws Error with a sentence the model can act on — a connection that is not this org's, a
 * provider with nothing to list, a picker the provider refused.
 */
export async function pickOptions(
  session: BuilderSession,
  args: { connectionId: string; kind: string },
): Promise<{ provider: string; kind: string; options: PickerOption[] }> {
  // The list is the ownership proof: `openOrgConnection` would refuse another org's row anyway
  // (the org is half the AAD), but this refuses it before any credential is opened, and with a
  // sentence rather than a decryption failure.
  const connections = await viaEngine(() => listOrgConnections(session.orgId));
  const connection = connections.find((entry) => entry.id === args.connectionId);
  if (!connection) {
    throw new Error(
      "That connection id does not belong to this workspace. Call list_connections for the ids.",
    );
  }

  const connector = CONNECTORS[connection.provider];
  if (!connector) {
    throw new Error(`PapaFlow has no connector called "${connection.provider}".`);
  }

  if (!connector.pick && args.kind !== MODELS_PICKER) {
    throw new Error(`${connector.name} connections have nothing to list.`);
  }

  // One open, used by both paths. `lib/connections-server.ts` answers the models picker without
  // opening anything because a browser triggers it every time a config panel opens; here the caller
  // is an agent asking once, and `meta` only ever comes back through the opened row. The plaintext
  // is dropped when this function returns (CLAUDE.md rule 1).
  const opened = await openOrgConnection(connection.id, session.orgId);

  if (args.kind === MODELS_PICKER) {
    const stored = modelOptions(opened.meta);
    if (stored.length > 0 || !connector.pick) {
      return { provider: connection.provider, kind: args.kind, options: stored };
    }
  }

  const pick = connector.pick;
  if (!pick) throw new Error(`${connector.name} connections have nothing to list.`);

  try {
    const options = await pick(args.kind, opened.secret as Record<string, string>, opened.meta ?? {});
    return { provider: connection.provider, kind: args.kind, options };
  } catch (cause) {
    // A provider's own words ("invalid_auth", "missing_scope") are safe but they are not an
    // instruction, so only the log gets them.
    console.error("builder/pickers: pick failed", { provider: connection.provider, kind: args.kind }, cause);
    throw new Error(
      `Could not load "${args.kind}" from ${connector.name}. Re-test the connection in Settings, ` +
        "then try again, or leave the field for the user to fill in.",
    );
  }
}
