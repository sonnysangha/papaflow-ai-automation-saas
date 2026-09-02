import { describe, expect, it, vi } from "vitest";

import { CONNECTORS } from "@/connectors/registry";
import {
  ConnectionRequestError,
  connectionErrorResponse,
  createConnectionFromInput,
} from "@/lib/connections-server";
import { featuresForPlan } from "@/lib/plans";

/**
 * Layer two of the plan gate (CLAUDE.md rule 3): the `has()` check inside `POST /api/connections`.
 *
 * The dimmed card in the picker is decoration and `runNode` only sees a connection that already
 * exists — this is the check that decides whether a Pro credential can be created at all, so it has
 * to refuse before the connector's `test()` runs and before anything is written.
 */

/** Clerk's `has`, standing in for an org entitled to exactly `features`. */
function hasFor(features: readonly string[]) {
  return ({ feature }: { feature: string }) => features.includes(feature.replace(/^org:/, ""));
}

const PRO_PROVIDERS = ["slack", "notion", "airtable", "linear"];

function input(provider: string, features: readonly string[]) {
  return {
    orgId: "org_1",
    userId: "user_1",
    provider,
    secret: { apiKey: "should-never-be-used" },
    has: hasFor(features),
  };
}

describe("POST /api/connections feature gate", () => {
  it("refuses every Pro connector for an org with no paid features", async () => {
    for (const provider of PRO_PROVIDERS) {
      const thrown = await createConnectionFromInput(input(provider, [])).catch(
        (error: unknown) => error,
      );

      expect(thrown).toBeInstanceOf(ConnectionRequestError);
      const { status, body } = connectionErrorResponse(thrown);

      // The shape the Add-connection dialog keys its upgrade link off.
      expect(status).toBe(403);
      expect(body.code).toBe("upgrade_required");
      expect(body.feature).toBe("pro_connectors");
      expect(body.error).toContain(CONNECTORS[provider].name);
    }
  });

  it("checks the `org:`-scoped feature slug, not the bare one", async () => {
    // An org entitled only at user scope must not pass an org-scoped check.
    const userScopedOnly = ({ feature }: { feature: string }) => feature === "pro_connectors";

    const thrown = await createConnectionFromInput({
      ...input("slack", []),
      has: userScopedOnly,
    }).catch((error: unknown) => error);

    expect(connectionErrorResponse(thrown).status).toBe(403);
  });

  it("refuses before the connector's test() call is made", async () => {
    // A refused create must not reach Slack with the pasted token, and must write nothing.
    const test = vi.spyOn(CONNECTORS.slack, "test");

    await createConnectionFromInput(input("slack", [])).catch(() => undefined);

    expect(test).not.toHaveBeenCalled();
    test.mockRestore();
  });

  it("lets a Pro org past the gate", async () => {
    // Past the gate it fails at `test()` instead — no network in tests — which is proof enough
    // that the plan wall is behind us.
    const test = vi
      .spyOn(CONNECTORS.slack, "test")
      .mockResolvedValue({ ok: false, error: "stopped after the gate" });

    const thrown = await createConnectionFromInput(
      input("slack", featuresForPlan("pro")),
    ).catch((error: unknown) => error);

    expect(test).toHaveBeenCalledOnce();
    expect(connectionErrorResponse(thrown)).toEqual({
      status: 400,
      body: { code: "test_failed", error: "stopped after the gate" },
    });
    test.mockRestore();
  });

  it("leaves an unknown provider a 400, not an upgrade prompt", async () => {
    const thrown = await createConnectionFromInput(input("not-a-provider", [])).catch(
      (error: unknown) => error,
    );

    expect(connectionErrorResponse(thrown)).toEqual({
      status: 400,
      body: { code: "unknown_provider", error: "Unknown provider: not-a-provider" },
    });
  });
});
