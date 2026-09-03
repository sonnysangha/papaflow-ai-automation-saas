"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Show, useAuth } from "@clerk/nextjs";
import { Client, ClientError, type MessageStreamEvent } from "eve/client";
import { useEveAgent, type EveMessage, type EveMessagePart } from "eve/react";
import {
  ArrowDownIcon,
  CheckIcon,
  LoaderIcon,
  SparklesIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";

import { UpgradeCard } from "@/components/billing/UpgradeCard";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  BUILDER_FEATURE,
  BUILDER_WORKFLOW_HEADER,
  CANCEL_OPTION_ID,
  pendingConnectionRequests,
  REQUEST_CONNECTION_TOOL,
  toolCallLabel,
} from "@/lib/builder-protocol";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

import { CredentialWidget } from "./CredentialWidget";
import { MessageMarkdown } from "./MessageMarkdown";
import { isNearBottom, transcriptSignature } from "./scroll-follow";
import { hasOpenTurn } from "./session-catchup";

/**
 * "Build with AI": a chat beside the canvas whose tool calls draw on it.
 *
 * The panel talks to the eve Builder agent directly — `useEveAgent({ agent: "builder" })` targets
 * the same-origin routes `withEve({ agents })` mounts at `/eve/agents/builder/eve/v1/*`, so there
 * is no CORS boundary and no route of ours in the middle. Two things ride on every request:
 *
 * - the user's **Clerk session token** as a bearer, which `agents/builder/channels/eve.ts` verifies
 *   and turns into `orgId`/`userId` attributes. `auth.bearer` is a function, so it is re-resolved
 *   before each request and a token expiring mid-conversation refreshes itself;
 * - the **workflow id** as a header, which the same `AuthFn` projects into the session's attributes.
 *   eve's `clientContext` reaches the model, not the tools (see `lib/builder-protocol.ts`), so this
 *   is how a tool knows which canvas it is drawing on.
 *
 * Reopening a chat that already exists reads its transcript here, with one bounded non-following
 * stream, rather than handing the job to `useEveAgent({ resume: true })` — see `BuilderSession`.
 *
 * Nothing here writes to Convex. The canvas is redrawn by the agent's own writes arriving on the
 * `workflows.get` subscription the editor already holds.
 */

const PANEL = "flex w-96 shrink-0 flex-col border-l border-border bg-background";

/** The eve agent this panel talks to; `useEveAgent({ agent })` resolves the same `/eve/agents/…`. */
const BUILDER_AGENT = "builder";
const BUILDER_HOST = `/eve/agents/${BUILDER_AGENT}`;

/**
 * How long the panel will spend reading an existing transcript before handing the rest to the
 * store. Generous on purpose: this is one bounded read against a service that may be cold (0.8s
 * warm against production), not a poll, and the fallback below is only slower, never wrong.
 */
const CATCHUP_TIMEOUT_MS = 20_000;

/**
 * A session eve no longer has answers 404, and eve's default policy reads that as the propagation
 * window of a just-created one: twelve attempts with backoff, measured at 46s before it gives up.
 * A stale `builderSessions` row is not worth 46s, so 404 comes out of the retryable set and every
 * genuinely transient status keeps the default ladder.
 */
const CATCHUP_RETRYABLE_STATUSES = [409, 425, 500, 502, 503, 504];

/** What `POST /api/builder/session` answers before a chat may start. */
type OpenedSession = {
  builderSessionId: string;
  eveSessionId: string;
  workflow: { name: string; version: number; status: string };
};

/**
 * The chat that already exists, as the panel knows it before the store is created: the prefix of
 * the durable stream to draw immediately, and whether anything is still moving.
 */
type Transcript = {
  /** The eve session to attach to, or `""` to open a fresh one with the next message. */
  readonly sessionId: string;
  readonly events: readonly MessageStreamEvent[];
  /** Follow the live stream on mount: a turn is in flight, or this read was cut short. */
  readonly follow: boolean;
};

/** No chat yet — or the row pointed at one eve has forgotten. */
const NEW_CHAT: Transcript = { sessionId: "", events: [], follow: false };

/**
 * Reads an existing chat's transcript: `follow: false` bounds the read at the durable tail, so it
 * returns as soon as it has everything instead of waiting on a stream that will never speak.
 *
 * A 404 means the row outlived its eve session — a redeploy that dropped it, a retired session —
 * so the panel forgets the id and lets the next message open a new one; `onSessionChange` writes
 * the new id back over the dead one through the PATCH that was already there.
 */
async function readTranscript(
  sessionId: string,
  client: Client,
  signal: AbortSignal,
): Promise<Transcript> {
  const deadline = AbortSignal.timeout(CATCHUP_TIMEOUT_MS);
  const events: MessageStreamEvent[] = [];

  try {
    const session = client.sessions.attach(sessionId, { streamIndex: 0 });
    for await (const event of session.stream({
      follow: false,
      startIndex: 0,
      signal: AbortSignal.any([signal, deadline]),
      streamReconnectPolicy: { retryableErrorStatuses: CATCHUP_RETRYABLE_STATUSES },
    })) {
      events.push(event);
    }
  } catch (cause) {
    if (cause instanceof ClientError && cause.status === 404) return NEW_CHAT;
    throw cause;
  }

  // A read the deadline cut short still leaves an ordered prefix from index 0, which is exactly
  // what the store's own catch-up knows how to finish — so hand it the rest rather than guessing.
  return { sessionId, events, follow: deadline.aborted || hasOpenTurn(events) };
}

type PanelProps = { workflowId: Id<"workflows">; onClose: () => void };

function PanelShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <aside className={PANEL} aria-label="Build with AI">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <SparklesIcon className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium">Build with AI</span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={onClose}
          aria-label="Close the builder panel"
        >
          <XIcon />
        </Button>
      </div>
      {children}
    </aside>
  );
}

/**
 * The panel, gated three ways over (CLAUDE.md rule 3). `<Show>` is the decoration; the refusals
 * that matter are `has()` in `POST /api/builder/session` and `requireBuilder` inside every tool.
 */
export function BuilderPanel({ workflowId, onClose }: PanelProps) {
  return (
    <Show
      when={{ feature: `org:${BUILDER_FEATURE}` }}
      fallback={
        <PanelShell onClose={onClose}>
          <div className="p-3">
            <UpgradeCard feature={BUILDER_FEATURE} compact />
          </div>
        </PanelShell>
      }
    >
      <BuilderSession workflowId={workflowId} onClose={onClose} />
    </Show>
  );
}

/**
 * Opens the app-side session before any chat exists — so the plan and the workflow's ownership are
 * proved once, on the server, rather than discovered when the first tool call fails — and then
 * reads the transcript of the chat that is already there.
 *
 * Reading it here is what makes reopening an old chat instant. `useEveAgent({ resume: true })`
 * replays the durable session and then *follows* it, and eve keeps following a session whose tail
 * is `session.waiting` — where every finished chat parks. Nothing arrives, so the follow ends only
 * at the client's 15s read-idle timeout, and `status` stays `resuming` ("Catching up…", composer
 * disabled) for all of it. Measured against production: a 0.46s bounded read of a nine-event chat,
 * then 15.3s of silence; against the dev server, 0.05s then 15.0s. The same transcript read with
 * `follow: false` costs 0.78s and returns everything, so the panel takes that and resumes only
 * when `hasOpenTurn` says a turn is genuinely in flight.
 *
 * The chat is keyed by the row it belongs to: `agent`, `initialEvents`, `initialSession` and
 * `resume` are read when the hook creates its store, so switching sessions means remounting — and
 * the transcript has to be in hand before `BuilderChat` mounts at all.
 */
function BuilderSession({ workflowId, onClose }: PanelProps) {
  const { getToken } = useAuth();
  const [opened, setOpened] = useState<{ session: OpenedSession; transcript: Transcript } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // Read through a ref so a refreshed Clerk identity cannot re-run the effect and reopen the chat.
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/builder/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workflowId }),
          signal: abort.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        if (abort.signal.aborted) return;

        if (!response.ok) {
          const { error: message } = (body ?? {}) as { error?: string };
          setError(message ?? "Could not open the builder.");
          return;
        }

        const session = body as OpenedSession;
        let transcript = NEW_CHAT;

        if (session.eveSessionId.length > 0) {
          // The same target the hook resolves, with the same bearer and the same workflow header:
          // `agents/builder/channels/eve.ts` authenticates this read exactly as it does the chat.
          const client = new Client({
            host: BUILDER_HOST,
            auth: { bearer: async () => (await getTokenRef.current()) ?? "" },
            headers: { [BUILDER_WORKFLOW_HEADER]: workflowId },
          });
          try {
            transcript = await readTranscript(session.eveSessionId, client, abort.signal);
          } catch (cause) {
            // Not fatal, and not a reason to lose the conversation: the store's own catch-up
            // recovers the same transcript from index 0. It is only slower.
            console.error("builder: could not read the transcript", cause);
            transcript = { sessionId: session.eveSessionId, events: [], follow: true };
          }
        }

        if (abort.signal.aborted) return;
        setOpened({ session, transcript });
      } catch (cause) {
        if (abort.signal.aborted) return;
        console.error(cause);
        setError("Could not reach the builder.");
      }
    })();
    return () => abort.abort();
  }, [workflowId]);

  if (error) {
    return (
      <PanelShell onClose={onClose}>
        <p className="p-3 text-sm text-muted-foreground">{error}</p>
      </PanelShell>
    );
  }

  if (!opened) {
    return (
      <PanelShell onClose={onClose}>
        <div className="space-y-2 p-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </div>
      </PanelShell>
    );
  }

  return (
    <BuilderChat
      key={opened.session.builderSessionId}
      workflowId={workflowId}
      session={opened.session}
      transcript={opened.transcript}
      onClose={onClose}
    />
  );
}

/** One tool call, as a chip: what the agent did, and whether it worked. */
function ToolChip({ part }: { part: Extract<EveMessagePart, { type: "dynamic-tool" }> }) {
  const failed = part.state === "output-error" || part.state === "output-denied";
  const done = part.state === "output-available";
  const Icon = failed ? XIcon : done ? CheckIcon : part.state === "approval-requested" ? WrenchIcon : LoaderIcon;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs",
        failed ? "text-destructive" : "text-muted-foreground",
      )}
      title={failed ? part.errorText : undefined}
    >
      <Icon className={cn("size-3 shrink-0", !failed && !done && "animate-spin")} aria-hidden />
      <span className="truncate">{toolCallLabel(part.toolName, part.input)}</span>
    </div>
  );
}

/** A pending question that is not `request_connection`: a `remove_node` approval, or `ask_question`. */
function AskBlock({
  prompt,
  options,
  allowFreeform,
  disabled,
  onOption,
  onText,
}: {
  prompt: string;
  options: readonly { id: string; label: string; style?: string }[];
  allowFreeform: boolean;
  disabled: boolean;
  onOption: (optionId: string) => void;
  onText: (text: string) => void;
}) {
  const [text, setText] = useState("");

  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted/40 p-3">
      <p className="text-sm break-words whitespace-pre-wrap">{prompt}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option.id}
            size="sm"
            variant={option.style === "danger" ? "destructive" : option.style === "primary" ? "default" : "outline"}
            disabled={disabled}
            onClick={() => onOption(option.id)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {allowFreeform ? (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const answer = text.trim();
            if (answer.length > 0) onText(answer);
          }}
        >
          <Textarea
            rows={1}
            value={text}
            disabled={disabled}
            aria-label="Answer"
            className="max-h-24 min-h-8 resize-none px-2 py-1.5 text-sm"
            onChange={(event) => setText(event.target.value)}
          />
          <Button size="sm" type="submit" disabled={disabled || text.trim().length === 0}>
            Send
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function MessageBubble({ message }: { message: EveMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("min-w-0 space-y-1.5", isUser && "pl-6")}>
      {message.parts.map((part, index) => {
        const key = `${message.id}-${index}`;

        if (part.type === "text" && part.text.trim().length > 0) {
          // The user's own words are shown exactly as typed; only the agent's are Markdown.
          return isUser ? (
            <p
              key={key}
              className="rounded-lg bg-primary/10 px-3 py-2 text-sm break-words whitespace-pre-wrap"
            >
              {part.text}
            </p>
          ) : (
            <MessageMarkdown key={key} className="min-w-0 rounded-lg bg-muted/40 px-3 py-2">
              {part.text}
            </MessageMarkdown>
          );
        }

        // A pending `request_connection` is rendered by the panel, not here, so the widget stays
        // beneath the whole transcript where the user cannot miss it.
        if (part.type === "dynamic-tool") {
          if (part.state === "approval-requested" && part.toolName === REQUEST_CONNECTION_TOOL) {
            return null;
          }
          return <ToolChip key={key} part={part} />;
        }

        return null;
      })}
    </div>
  );
}

function BuilderChat({
  workflowId,
  session,
  transcript,
  onClose,
}: PanelProps & { session: OpenedSession; transcript: Transcript }) {
  const { getToken } = useAuth();
  // Options are read once, when the hook creates its store, so the token resolver reaches the
  // latest `getToken` through a ref rather than through a closure captured on the first render.
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  // The id the row already holds. Empty after a stale session, so the first message's new id is
  // reported and the row is repaired.
  const reportedRef = useRef(transcript.sessionId);
  const [draft, setDraft] = useState("");

  const agent = useEveAgent({
    agent: BUILDER_AGENT,
    auth: { bearer: async () => (await getTokenRef.current()) ?? "" },
    headers: { [BUILDER_WORKFLOW_HEADER]: workflowId },
    // The transcript is already read, so the store starts with it drawn and its cursor at the
    // tail: a later `send`/`respond` streams only the new turn, with no replay.
    initialEvents: transcript.events,
    initialSession: transcript.sessionId
      ? { sessionId: transcript.sessionId, streamIndex: transcript.events.length }
      : undefined,
    // Only when something is actually moving. `resuming` is this panel's "Catching up…", and on an
    // idle chat eve's own resume would hold it there for 15s (see `BuilderSession`).
    resume: transcript.sessionId.length > 0 && transcript.follow,
    onSessionChange: (cursor) => {
      // Recorded once per session id: a reload reopens the same durable conversation.
      if (!cursor?.sessionId || cursor.sessionId === reportedRef.current) return;
      reportedRef.current = cursor.sessionId;
      void fetch("/api/builder/session", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          builderSessionId: session.builderSessionId,
          eveSessionId: cursor.sessionId,
        }),
      }).catch((cause: unknown) => console.error("builder: could not record the session id", cause));
    },
  });

  const busy = agent.status === "submitted" || agent.status === "streaming";
  const resuming = agent.status === "resuming";
  const locked = busy || resuming;

  const messages = agent.data.messages;
  const connectionRequests = pendingConnectionRequests(messages);

  // Every other pending question: the `remove_node` approval, or eve's own `ask_question`.
  const questions = messages
    .flatMap((message) => message.parts)
    .flatMap((part) => {
      if (part.type !== "dynamic-tool" || part.state !== "approval-requested") return [];
      if (part.toolName === REQUEST_CONNECTION_TOOL) return [];
      const request = part.toolMetadata?.eve?.inputRequest;
      return request ? [request] : [];
    });

  // ---------------------------------------------------------------------------------------------
  // Following the conversation.
  //
  // The transcript rides to the bottom as the agent writes, but only while the reader is already
  // there. Scroll up to re-read what it did three tools ago and it stays put; a pill offers the way
  // back. `pinnedRef` is what the scroll effect reads (an effect must not depend on a state value
  // it would have to be re-run to see), and `pinned` is the same answer for rendering.
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  // A smooth scroll passes through positions nowhere near the bottom and fires a scroll event at
  // each of them; without a settling window the "Jump to latest" animation would un-pin the
  // transcript and put the pill straight back. A timestamp rather than a timer: nothing to clean up.
  const settledAtRef = useRef(0);

  const jump = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // Read at click time, not at render: no server/client mismatch, and it follows the OS setting
    // if it changes mid-session. Reduced motion turns the glide into a jump.
    const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
    pinnedRef.current = true;
    setPinned(true);
    settledAtRef.current = behavior === "smooth" ? performance.now() + 600 : 0;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onScroll = () => {
      const next = isNearBottom(viewport);
      if (!next && performance.now() < settledAtRef.current) return;
      if (next === pinnedRef.current) return;
      pinnedRef.current = next;
      setPinned(next);
    };

    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", onScroll);
  }, []);

  // Keyed on what the transcript draws — plus the status, which moves the bottom when the pending
  // question blocks and the "Working"/"Ready" line change — rather than on the snapshot identity,
  // which is new on every stream event. Instant, not smooth: a reply arrives a token at a time and
  // re-starting an animation on each one lags behind the text and fights the listener above. Smooth
  // is for the pill, where one deliberate click deserves one deliberate glide.
  const signature = `${transcriptSignature(messages)}#${agent.status}`;
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !pinnedRef.current) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "auto" });
  }, [signature]);

  const send = useCallback(() => {
    const message = draft.trim();
    if (message.length === 0 || locked) return;
    setDraft("");
    void agent.send(message).catch((cause: unknown) => console.error(cause));
  }, [agent, draft, locked]);

  const answer = useCallback(
    (requestId: string, response: { optionId?: string; text?: string }) => {
      const promise = response.text
        ? agent.respond([{ requestId, text: response.text }])
        : agent.respond([{ requestId, optionId: response.optionId ?? CANCEL_OPTION_ID }]);
      void promise.catch((cause: unknown) => console.error(cause));
    },
    [agent],
  );

  return (
    <PanelShell onClose={onClose}>
      {/* `relative` so the pill can hang over the bottom of the transcript; the flex column keeps
          the scroll area's height resolving exactly as it did before the wrapper existed. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ScrollArea viewportRef={viewportRef} className="min-h-0 min-w-0 flex-1">
          {/* `min-w-0` so a long token in a reply scrolls inside its own code block rather than
              widening the 384px panel and pushing the canvas over. */}
          <div className="min-w-0 space-y-3 p-3">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Describe the workflow you want and I will build it on the canvas — one node at a time,
                so you can watch it take shape. I will ask before connecting anything.
              </p>
            ) : (
              messages.map((message) => <MessageBubble key={message.id} message={message} />)
            )}

            {questions.map((request) => (
              <AskBlock
                key={request.requestId}
                prompt={request.prompt}
                options={request.options ?? []}
                allowFreeform={request.allowFreeform ?? false}
                disabled={locked}
                onOption={(optionId) => answer(request.requestId, { optionId })}
                onText={(text) => answer(request.requestId, { text })}
              />
            ))}

            {connectionRequests.map((request) => (
              <CredentialWidget
                key={request.requestId}
                request={request}
                disabled={locked}
                onConnected={(connectionId) => answer(request.requestId, { text: connectionId })}
                onCancel={() => answer(request.requestId, { optionId: CANCEL_OPTION_ID })}
              />
            ))}

            {agent.error ? (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm break-words text-destructive">
                {agent.error.message}
              </p>
            ) : null}
          </div>
        </ScrollArea>

        {pinned ? null : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="absolute inset-x-0 bottom-3 mx-auto w-fit rounded-full border border-border shadow-md"
            onClick={jump}
          >
            <ArrowDownIcon />
            Jump to latest
          </Button>
        )}
      </div>

      <form
        className="shrink-0 border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <Textarea
          rows={3}
          value={draft}
          disabled={resuming}
          aria-label="Describe the workflow you want"
          placeholder="When a form is submitted, summarise it and post it to Slack…"
          className="resize-none text-sm"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div className="mt-2 flex items-center gap-2">
          <Button type="submit" size="sm" disabled={locked || draft.trim().length === 0}>
            {busy ? "Building…" : "Send"}
          </Button>
          {busy ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void agent.cancel().catch((cause: unknown) => console.error(cause))}
            >
              Stop
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              // Also the way out of a resume that failed on something `readTranscript` could not
              // rule out (a 404 is already handled there): `reset()` starts a fresh durable session.
              disabled={resuming || (messages.length === 0 && agent.error === undefined)}
              onClick={() => agent.reset()}
            >
              New chat
            </Button>
          )}
          <span role="status" className="ml-auto text-xs text-muted-foreground">
            {resuming ? "Catching up…" : busy ? "Working" : "Ready"}
          </span>
        </div>
      </form>
    </PanelShell>
  );
}
