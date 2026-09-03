"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Show, useAuth } from "@clerk/nextjs";
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
 * Nothing here writes to Convex. The canvas is redrawn by the agent's own writes arriving on the
 * `workflows.get` subscription the editor already holds.
 */

const PANEL = "flex w-96 shrink-0 flex-col border-l border-border bg-background";

/** What `POST /api/builder/session` answers before a chat may start. */
type OpenedSession = {
  builderSessionId: string;
  eveSessionId: string;
  workflow: { name: string; version: number; status: string };
};

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
 * Opens the app-side session before any chat exists, so the plan and the workflow's ownership are
 * proved once, on the server, rather than discovered when the first tool call fails.
 *
 * The chat is keyed by the row it belongs to: `agent`, `initialSession` and `resume` are read when
 * the hook creates its store, so switching sessions means remounting.
 */
function BuilderSession({ workflowId, onClose }: PanelProps) {
  const [session, setSession] = useState<OpenedSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch("/api/builder/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workflowId }),
        });
        const body: unknown = await response.json().catch(() => null);
        if (!live) return;

        if (!response.ok) {
          const { error: message } = (body ?? {}) as { error?: string };
          setError(message ?? "Could not open the builder.");
          return;
        }
        setSession(body as OpenedSession);
      } catch (cause) {
        console.error(cause);
        if (live) setError("Could not reach the builder.");
      }
    })();
    return () => {
      live = false;
    };
  }, [workflowId]);

  if (error) {
    return (
      <PanelShell onClose={onClose}>
        <p className="p-3 text-sm text-muted-foreground">{error}</p>
      </PanelShell>
    );
  }

  if (!session) {
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
      key={session.builderSessionId}
      workflowId={workflowId}
      session={session}
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
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <p className="whitespace-pre-wrap text-sm">{prompt}</p>
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
    <div className={cn("space-y-1.5", isUser && "pl-6")}>
      {message.parts.map((part, index) => {
        const key = `${message.id}-${index}`;

        if (part.type === "text" && part.text.trim().length > 0) {
          // The user's own words are shown exactly as typed; only the agent's are Markdown.
          return isUser ? (
            <p key={key} className="whitespace-pre-wrap rounded-lg bg-primary/10 px-3 py-2 text-sm">
              {part.text}
            </p>
          ) : (
            <MessageMarkdown key={key} className="rounded-lg bg-muted/40 px-3 py-2">
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
  onClose,
}: PanelProps & { session: OpenedSession }) {
  const { getToken } = useAuth();
  // Options are read once, when the hook creates its store, so the token resolver reaches the
  // latest `getToken` through a ref rather than through a closure captured on the first render.
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const reportedRef = useRef(session.eveSessionId);
  const [draft, setDraft] = useState("");

  const agent = useEveAgent({
    agent: "builder",
    auth: { bearer: async () => (await getTokenRef.current()) ?? "" },
    headers: { [BUILDER_WORKFLOW_HEADER]: workflowId },
    initialSession: session.eveSessionId ? { sessionId: session.eveSessionId, streamIndex: 0 } : undefined,
    resume: session.eveSessionId.length > 0,
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
        <ScrollArea viewportRef={viewportRef} className="min-h-0 flex-1">
          <div className="space-y-3 p-3">
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
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
              // Also the way out of a failed resume: an eve session id that no longer exists leaves
              // an error and no messages, and `reset()` starts a fresh durable session.
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
