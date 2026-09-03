import { OPERATOR_LABELS, UNARY_OPERATORS } from "@/nodes/logic/condition";
import type { NodeCategory } from "@/nodes/define";

/**
 * The one line under a node's name on the canvas, and the tint of its icon tile.
 *
 * Pure on purpose: this is the only part of a node card that reads its saved configuration, so it
 * is the part worth testing. Everything here answers one question — "what does this node actually
 * do?" — from the same `inputs` object the config panel edits, without a registry lookup or a run.
 */

/**
 * One tint per category, so a glance across the canvas separates a trigger from an action before
 * any word is read. Deliberately low-saturation (`/15` fills over the card, foreground text at a
 * weight that survives both themes) — the status ring is the only loud colour a node card carries.
 */
export const CATEGORY_TINT: Record<NodeCategory, string> = {
  trigger: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  logic: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  ai: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  chat: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  data: "bg-pink-500/15 text-pink-600 dark:text-pink-300",
  action: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
};

/** The tint for a category, falling back to the neutral one for a node the registry does not have. */
export function categoryTint(category: NodeCategory | undefined): string {
  return (category && CATEGORY_TINT[category]) || CATEGORY_TINT.action;
}

/** How much of a URL, a template or a channel name fits on a 240px card. */
const MAX_SUMMARY_VALUE = 40;

function truncate(value: string, max = MAX_SUMMARY_VALUE): string {
  const text = value.trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** A trimmed string input, or undefined when it is missing, empty or the wrong type. */
function str(inputs: Inputs, name: string): string | undefined {
  const value = inputs[name];
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

function num(inputs: Inputs, name: string): number | undefined {
  const value = inputs[name];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function arr(inputs: Inputs, name: string): unknown[] | undefined {
  const value = inputs[name];
  return Array.isArray(value) ? value : undefined;
}

/** "3 cases" / "1 case" — a count is only ever read next to its noun. */
function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Seconds as the shortest thing that is still true: "45s", "5 min", "2 h". */
function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3_600) return `${Math.round(s / 60)} min`;
  const hours = s / 3_600;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}

type Inputs = Record<string, unknown>;

/** The model id an AI node will call, or the fact that it has not been picked yet. */
function modelSummary(inputs: Inputs): string {
  return truncate(str(inputs, "model") ?? "Model not set");
}

/**
 * The key thing this node is configured to do, in one line — `GET https://…`, `Every 5 min`,
 * `3 cases` — or null when there is nothing worth saying yet (an unconfigured node, or a type with
 * no single headline field). A null summary means the card shows only its name, which is the right
 * answer for a node nobody has opened.
 */
export function nodeSummary(nodeType: string, inputs: Inputs | undefined | null): string | null {
  const values: Inputs = inputs && typeof inputs === "object" ? inputs : {};

  switch (nodeType) {
    case "http.request": {
      const url = str(values, "url");
      if (!url) return null;
      const method = str(values, "method") ?? "GET";
      return `${method.toUpperCase()} ${truncate(url)}`;
    }

    case "schedule.trigger": {
      if (str(values, "mode") === "cron") {
        const cron = str(values, "cron");
        return cron ? `Cron ${truncate(cron)}` : null;
      }
      const minutes = num(values, "everyMinutes");
      return minutes === undefined ? null : `Every ${duration(minutes * 60)}`;
    }

    case "logic.condition": {
      const left = str(values, "left");
      if (!left) return null;
      const operator = (str(values, "operator") ?? "equals") as keyof typeof OPERATOR_LABELS;
      const label = OPERATOR_LABELS[operator] ?? operator;
      // "is empty" reads as a whole sentence on its own; the right-hand box is not even shown.
      if ((UNARY_OPERATORS as readonly string[]).includes(operator)) {
        return truncate(`${left} ${label}`, 52);
      }
      const right = str(values, "right");
      return truncate(right ? `${left} ${label} ${right}` : `${left} ${label}`, 52);
    }

    case "logic.switch": {
      const cases = arr(values, "cases");
      return cases && cases.length > 0 ? count(cases.length, "case") : null;
    }

    case "logic.loop": {
      const items = str(values, "items");
      return items ? `Over ${truncate(items, 34)}` : null;
    }

    case "logic.wait": {
      if (str(values, "mode") === "until") {
        const until = str(values, "until");
        return until ? `Until ${truncate(until, 32)}` : null;
      }
      const seconds = num(values, "seconds");
      return seconds === undefined ? null : `Pause ${duration(seconds)}`;
    }

    case "ai.llm":
    case "ai.classify":
    case "ai.extract":
    case "ai.agent":
      return modelSummary(values);

    case "email.send": {
      const to = str(values, "to");
      return to ? truncate(to) : null;
    }

    case "telegram.sendMessage": {
      const chat = str(values, "chatId");
      return chat ? truncate(chat) : null;
    }

    case "slack.postMessage": {
      const channel = str(values, "channel");
      return channel ? truncate(channel) : null;
    }

    case "discord.postMessage": {
      const channel = str(values, "channelId");
      return channel ? truncate(channel) : null;
    }

    case "form.trigger": {
      const fields = arr(values, "fields");
      return fields && fields.length > 0 ? count(fields.length, "field") : null;
    }

    case "logic.set": {
      const fields = arr(values, "fields");
      return fields && fields.length > 0 ? count(fields.length, "value") : null;
    }

    default:
      return null;
  }
}
