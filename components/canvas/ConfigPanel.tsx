"use client";

import { useCallback, useMemo, useState } from "react";
import type { Edge } from "@xyflow/react";
import { XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { Id } from "@/convex/_generated/dataModel";
import { categoryLabel } from "@/nodes/categories";
import type { AnyNodeDef } from "@/nodes/define";
import { NODES } from "@/nodes/registry";
import { toJsonSchema, type JsonSchema } from "@/nodes/schema";
import { renameKeyInTemplates } from "@/nodes/templates";

import { conditionPreview } from "./condition-preview";
import { enumOptions, fieldLabel, fieldVisible } from "./field-label";
import { BooleanSwitch } from "./fields/BooleanSwitch";
import { ConnectionField } from "./fields/ConnectionField";
import { EnumSelect } from "./fields/EnumSelect";
import { JsonField } from "./fields/JsonField";
import { KeyValueList, type KeyPicker, type KeyValuePair } from "./fields/KeyValueList";
import { NumberInput } from "./fields/NumberInput";
import { PickerField } from "./fields/PickerField";
import { ResumeUrlPattern } from "./fields/ResumeUrl";
import { TagList } from "./fields/TagList";
import { TemplateInput } from "./fields/TemplateInput";
import { FormUrl } from "./fields/FormUrl";
import { TriggerUrl } from "./fields/TriggerUrl";
import {
  handleDisplays,
  NODE_KEY_PATTERN,
  type WorkflowNodeData,
  type WorkflowNodeType,
} from "./graph-io";
import { lastRunFor, type LastRunStep, type RunStepRow } from "./last-run";
import { LastRunSection } from "./LastRunSection";
import { NodeGuide } from "./NodeGuide";
import { NodeIcon } from "./node-icon";
import { missingHint, resolvePickerKind } from "./picker-kind";
import { ScheduleConfig } from "./ScheduleConfig";
import { buildVariableGroups, type VariableGroup } from "./variables";

/** Property names that are prose rather than a value, and get a textarea. */
const MULTILINE_NAMES = new Set(["text", "body", "prompt", "instructions", "sample"]);
/** …and the escape hatch for everything else: `.describe("… multi-line …")`. */
const MULTILINE_HINT = /multi-line/i;

const KEY_HELP = "Lower-case letters, digits and underscores, starting with a letter.";

/** The input a node with a `credential` stores its chosen connection in. */
const CONNECTION_INPUT = "connectionId";

/**
 * The fields that answer "which account, and which of its models" rather than "what should this
 * node do". They are always declared first on a node, and a rule separates them from the rest so
 * the panel reads as *pick an account, then say what to do with it* — one decision per group.
 */
const ACCOUNT_INPUTS = new Set([CONNECTION_INPUT, "model"]);

/** The trigger whose configuration is not inputs at all, but the URL the workflow listens on. */
const WEBHOOK_TRIGGER = "webhook.trigger";
const FORM_TRIGGER = "form.trigger";

/** …and the node whose configuration is the URL that resumes one paused run of this workflow. */
const WAIT_FOR_WEBHOOK = "logic.waitForWebhook";

/** …and the one whose last run is a sentence: "score is greater than 10 → yes". */
const CONDITION = "logic.condition";

/** …and the one whose fields are only half the story: the rest is a sleeping scheduler run. */
const SCHEDULE_TRIGGER = "schedule.trigger";

type FieldKind =
  | "text"
  | "textarea"
  | "number"
  | "integer"
  | "boolean"
  | "enum"
  | "tags"
  | "pairs"
  | "json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `properties` and `items` are `boolean | JSONSchema` in draft 2020-12; only objects matter. */
function asSchema(value: unknown): JsonSchema | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonSchema)
    : null;
}

/** `["string","null"]` for a nullable field, `[]` for `z.any()` — which the JSON field takes. */
function typesOf(schema: JsonSchema): string[] {
  if (typeof schema.type === "string") return [schema.type];
  if (Array.isArray(schema.type)) return schema.type.filter((entry) => entry !== "null");
  return [];
}

/** The Set node's `fields`: an array of exactly `{ key, value }` objects. */
function isKeyValueItems(items: JsonSchema | null): boolean {
  if (!items || !isRecord(items.properties)) return false;
  const names = Object.keys(items.properties);
  return names.length === 2 && names.includes("key") && names.includes("value");
}

function fieldKind(name: string, schema: JsonSchema): FieldKind {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return "enum";

  const [type] = typesOf(schema);
  if (type === "string") {
    const description = typeof schema.description === "string" ? schema.description : "";
    return MULTILINE_NAMES.has(name) || MULTILINE_HINT.test(description) ? "textarea" : "text";
  }
  if (type === "integer") return "integer";
  if (type === "number") return "number";
  if (type === "boolean") return "boolean";
  if (type === "array") {
    const items = Array.isArray(schema.items) ? null : asSchema(schema.items);
    if (items && typesOf(items)[0] === "string") return "tags";
    if (isKeyValueItems(items)) return "pairs";
    return "json";
  }
  // Objects, records (`additionalProperties`, no `properties`), unions and `z.any()` (`{}`).
  return "json";
}

/**
 * The list a connector can fill this field from: `z.string().meta({ picker: "channels" })` on a
 * node input survives `z.toJSONSchema` as an extra `picker` key, which is how a node asks for a
 * dropdown without `nodes/` knowing that React exists.
 */
function pickerKind(schema: JsonSchema): string | null {
  const picker = (schema as { picker?: unknown }).picker;
  return typeof picker === "string" && picker.length > 0 ? picker : null;
}

/**
 * The same thing one level down: `.meta({ keyPicker: "fields:{baseId}:{tableId}" })` on an array of
 * `{ key, value }` rows says the *key* half of every row is a column of a remote table, not free
 * text. It rides on the array's own schema, so the rows themselves stay `{ key, value }` strings.
 */
function keyPickerKind(schema: JsonSchema): string | null {
  const picker = (schema as { keyPicker?: unknown }).keyPicker;
  return typeof picker === "string" && picker.length > 0 ? picker : null;
}

/** `keyPicker`, resolved against the node's other inputs — or nothing to ask with, or nothing to ask. */
function pairsKeyPicker(
  schema: JsonSchema,
  inputs: Record<string, unknown>,
  connectionId: string | undefined,
): KeyPicker | undefined {
  const declared = keyPickerKind(schema);
  if (!declared || !connectionId) return undefined;
  const { kind, missing } = resolvePickerKind(declared, inputs);
  return { kind, connectionId, missing };
}

/** A template may stand where the schema wants a number or a boolean — show it, don't eat it. */
function isTemplate(value: unknown): value is string {
  return typeof value === "string" && value.includes("{{");
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  return value === undefined || value === null ? "" : String(value);
}

function asPairs(value: unknown): KeyValuePair[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry) => ({
    key: asText(entry.key),
    value: asText(entry.value),
  }));
}

/** The choices of a `z.enum()` field, paired with the words `.meta({ options })` shows them as. */
function choicesOf(schema: JsonSchema) {
  const values = (schema.enum ?? []).filter((entry): entry is string => typeof entry === "string");
  return enumOptions(values, schema as { options?: unknown });
}

/**
 * The values a node's form is effectively configured with: the schema's defaults, overwritten by
 * whatever is actually stored.
 *
 * `showWhen` compares against these rather than against `data.inputs`, because a field the user has
 * never touched still *ran* with its default — a Wait node dropped a second ago has no `mode` in
 * its inputs, and `{ mode: "duration" }` is exactly the configuration it would run.
 */
function effectiveInputs(
  properties: Record<string, JsonSchema>,
  inputs: Record<string, unknown>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [name, property] of Object.entries(properties)) {
    if (property.default !== undefined) values[name] = property.default;
  }
  return { ...values, ...inputs };
}

/** The Condition node's "Last time:" line — the one node whose branch is worth reading back. */
function ConditionLastTime({ run }: { run: LastRunStep | null }) {
  const preview = conditionPreview(run);
  if (!preview) return null;

  return (
    <p className="text-xs break-words text-muted-foreground">
      Last time:{" "}
      <span className="font-mono text-foreground">{preview.left}</span> {preview.operator}
      {preview.right === null ? null : (
        <>
          {" "}
          <span className="font-mono text-foreground">{preview.right}</span>
        </>
      )}{" "}
      → <span className="font-medium text-foreground">{preview.result ? "yes" : "no"}</span>
    </p>
  );
}

/** `z.toJSONSchema` throws on schemas it cannot express; an odd node must not blank the panel. */
function inputsSchema(definition: AnyNodeDef | undefined): JsonSchema | null {
  if (!definition) return null;
  try {
    return toJsonSchema(definition.inputs);
  } catch {
    return null;
  }
}

/** One generated control. The label, the description and the required marker live in the parent. */
function NodeField({
  id,
  name,
  schema,
  value,
  inputs,
  groups,
  credential,
  connectionId,
  onChange,
}: {
  id: string;
  name: string;
  schema: JsonSchema;
  value: unknown;
  /** Every input of this node: a picker kind may name a sibling (`tables:{baseId}`). */
  inputs: Record<string, unknown>;
  groups: VariableGroup[];
  /** The node definition's `credential`, so `connectionId` becomes a picker instead of a text box. */
  credential: string | null;
  /** The connection this node is currently pointed at — what a remote list has to be read with. */
  connectionId: string | undefined;
  onChange: (value: unknown) => void;
}) {
  const kind = fieldKind(name, schema);
  const fallback = typeof schema.default === "string" ? schema.default : undefined;

  // A node that needs a connection stores its id here; the schema only says `z.string()`, so the
  // picker has to be chosen by name rather than by shape.
  if (credential && name === CONNECTION_INPUT) {
    return <ConnectionField id={id} credential={credential} value={value} onChange={onChange} />;
  }

  // A field the connector can list for us (`picker: "channels"`). Without a connection there is
  // nothing to ask, so it stays the text box the schema would otherwise have produced.
  const picker = kind === "text" || kind === "textarea" ? pickerKind(schema) : null;
  if (picker && connectionId) {
    // A kind may be relative to another input (`tables:{baseId}`): the list cannot be asked for
    // until that sibling has a value, so the field waits, named after the one it is waiting on.
    const { kind: resolved, missing } = resolvePickerKind(picker, inputs);
    return (
      <PickerField
        id={id}
        kind={resolved}
        connectionId={connectionId}
        value={asText(value)}
        groups={groups}
        disabled={missing.length > 0}
        hint={missingHint(missing)}
        onChange={(next) => onChange(next.length === 0 ? undefined : next)}
      />
    );
  }

  // Anything holding a template is edited as text, whatever the schema says it should become.
  if (isTemplate(value) && kind !== "json") {
    return (
      <TemplateInput
        id={id}
        value={value}
        groups={groups}
        multiline={kind === "textarea"}
        onChange={(next) => onChange(next.length === 0 ? undefined : next)}
      />
    );
  }

  switch (kind) {
    case "text":
    case "textarea":
      return (
        <TemplateInput
          id={id}
          value={asText(value)}
          groups={groups}
          multiline={kind === "textarea"}
          placeholder={fallback}
          onChange={(next) => onChange(next.length === 0 ? undefined : next)}
        />
      );
    case "number":
    case "integer":
      return (
        <NumberInput
          id={id}
          value={typeof value === "number" ? value : undefined}
          integer={kind === "integer"}
          placeholder={schema.default === undefined ? undefined : String(schema.default)}
          onChange={onChange}
        />
      );
    case "boolean":
      return (
        <BooleanSwitch
          id={id}
          checked={typeof value === "boolean" ? value : schema.default === true}
          onChange={onChange}
        />
      );
    case "enum":
      return (
        <EnumSelect
          id={id}
          value={typeof value === "string" ? value : fallback}
          options={choicesOf(schema)}
          onChange={onChange}
        />
      );
    case "tags":
      return (
        <TagList
          id={id}
          value={Array.isArray(value) ? value.map(asText) : []}
          addLabel={`Add ${name === "cases" ? "case" : "item"}`}
          onChange={onChange}
        />
      );
    case "pairs": {
      // The key half may be a remote list too (`keyPicker`), and like `picker` its kind can name a
      // sibling — an Airtable column list only exists inside one base and one table. Without a
      // connection there is nothing to ask, so the rows stay the pair of text boxes they were.
      const keyPicker = pairsKeyPicker(schema, inputs, connectionId);
      return (
        <KeyValueList
          id={id}
          value={asPairs(value)}
          groups={groups}
          keyPicker={keyPicker}
          onChange={onChange}
        />
      );
    }
    default:
      return <JsonField id={id} value={value} groups={groups} onChange={onChange} />;
  }
}

/** One labelled row of the generated form: the label, the control, and the field's own help text. */
function NodeFieldRow({
  nodeId,
  name,
  schema,
  required,
  value,
  inputs,
  groups,
  credential,
  connectionId,
  onChange,
}: {
  nodeId: string;
  name: string;
  schema: JsonSchema;
  /** The node's `required` list, straight from the generated JSON Schema. */
  required: readonly string[];
  value: unknown;
  inputs: Record<string, unknown>;
  groups: VariableGroup[];
  credential: string | null;
  connectionId: string | undefined;
  onChange: (value: unknown) => void;
}) {
  const fieldId = `${nodeId}-${name}`;
  const description = typeof schema.description === "string" ? schema.description : null;
  // `.default()` fields come back in `required` (the parsed output always has them), so only a
  // field with no default is one the user actually has to fill in.
  const mandatory = required.includes(name) && schema.default === undefined;

  return (
    // `min-w-0` all the way down: a field's value can be a 400-character URL, and without it a
    // flex or grid child sizes to its content and stretches the whole 360px panel.
    <div className="min-w-0 space-y-1.5">
      {/* The property name is still the truth — it is what a Builder tool call and the stored
          graph use — so it stays reachable on hover without shouting from the form. */}
      <Label htmlFor={fieldId} className="min-w-0 gap-1" title={name}>
        {fieldLabel(name, schema as { label?: unknown })}
        {mandatory ? (
          <span aria-label="required" className="text-destructive">
            *
          </span>
        ) : null}
      </Label>
      <NodeField
        id={fieldId}
        name={name}
        schema={schema}
        value={value}
        inputs={inputs}
        groups={groups}
        credential={credential}
        connectionId={connectionId}
        onChange={onChange}
      />
      {description ? (
        <p className="text-xs break-words text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

export type ConfigPanelProps = {
  node: WorkflowNodeType;
  nodes: WorkflowNodeType[];
  edges: Edge[];
  /** The workflow being edited: the Webhook trigger's URL is built from these two. */
  workflowId: Id<"workflows">;
  webhookSecret: string;
  /** The workflow's publish state — a draft form renders but its submissions start nothing. */
  workflowStatus: "draft" | "active" | "paused";
  /** The latest run's step rows: the Last run section, and the observed half of the picker. */
  steps: readonly RunStepRow[];
  setNodes: (updater: (nodes: WorkflowNodeType[]) => WorkflowNodeType[]) => void;
  onClose: () => void;
};

/**
 * The selected node's settings, as a column beside the canvas rather than a modal sheet — you
 * keep dragging edges and watching statuses while you configure. The form is generated from the
 * node's zod `inputs`, so a new connector gets a config UI the moment it is registered, and every
 * edit goes through `setNodes`, which the canvas, which marks the workflow unsaved until you press Save already watches.
 */
export function ConfigPanel({
  node,
  nodes,
  edges,
  workflowId,
  webhookSecret,
  workflowStatus,
  steps,
  setNodes,
  onClose,
}: ConfigPanelProps) {
  const definition = NODES[node.data.nodeType];
  const [keyDraft, setKeyDraft] = useState(node.data.key);

  const schema = useMemo(() => inputsSchema(definition), [definition]);
  // The last run, twice over: the roots this node can reference (with the values they held) and
  // this node's own step, which the Last run section shows at the top of the panel.
  const lastRun = useMemo(
    () => lastRunFor({ nodeId: node.id, nodes, edges, steps }),
    [edges, node.id, nodes, steps],
  );
  const groups = useMemo(
    () => buildVariableGroups({ nodeId: node.id, nodes, edges, sources: lastRun.sources }),
    [edges, lastRun.sources, node.id, nodes],
  );
  const takenKeys = useMemo(
    () => new Set(nodes.filter((entry) => entry.id !== node.id).map((entry) => entry.data.key)),
    [node.id, nodes],
  );

  const patchData = useCallback(
    (update: (data: WorkflowNodeData) => WorkflowNodeData) => {
      setNodes((current) =>
        current.map((entry) =>
          entry.id === node.id ? { ...entry, data: update(entry.data) } : entry,
        ),
      );
    },
    [node.id, setNodes],
  );

  const setInput = useCallback(
    (name: string, value: unknown) => {
      patchData((data) => {
        const inputs = { ...data.inputs };
        // Clearing a field removes it, so the schema's default applies again at run time.
        if (value === undefined) delete inputs[name];
        else inputs[name] = value;
        return { ...data, inputs };
      });
    },
    [patchData],
  );

  const trimmedKey = keyDraft.trim();
  const keyError =
    trimmedKey === node.data.key
      ? null
      : !NODE_KEY_PATTERN.test(trimmedKey)
        ? KEY_HELP
        : takenKeys.has(trimmedKey)
          ? "Another node already uses this key."
          : null;

  /**
   * Renaming rewrites `{{ oldKey… }}` in every other node in the same `setNodes`, so the graph is
   * never saved in a state where a template points at a key that no longer exists.
   */
  const commitKey = useCallback(() => {
    const next = keyDraft.trim();
    const previous = node.data.key;
    if (next === previous) return;
    if (!NODE_KEY_PATTERN.test(next) || takenKeys.has(next)) {
      setKeyDraft(previous);
      return;
    }

    setNodes((current) =>
      current.map((entry) => {
        if (entry.id === node.id) return { ...entry, data: { ...entry.data, key: next } };
        const renamed = renameKeyInTemplates(entry.data.inputs, previous, next);
        if (!isRecord(renamed) || JSON.stringify(renamed) === JSON.stringify(entry.data.inputs)) {
          return entry;
        }
        return { ...entry, data: { ...entry.data, inputs: renamed } };
      }),
    );
    setKeyDraft(next);
  }, [keyDraft, node.data.key, node.id, setNodes, takenKeys]);

  const properties = isRecord(schema?.properties) ? schema.properties : {};
  const required = Array.isArray(schema?.required) ? schema.required : [];

  // Declaration order is the node's own, so this keeps it and only cuts the list in two.
  const declared = Object.entries(properties).flatMap(([name, raw]) => {
    const property = asSchema(raw);
    return property ? [[name, property] as const] : [];
  });
  // A field the current configuration has no use for is not asked about: the Wait node's "Seconds"
  // and "Date and time" are the same question twice, and showing both is most of what makes it
  // confusing. `.meta({ showWhen })` on the node is what opts a field into this.
  const effective = effectiveInputs(Object.fromEntries(declared), node.data.inputs);
  const fields = declared.filter(([, property]) =>
    fieldVisible(property as { showWhen?: unknown }, effective),
  );
  const accountFields = fields.filter(([name]) => ACCOUNT_INPUTS.has(name));
  const settingFields = fields.filter(([name]) => !ACCOUNT_INPUTS.has(name));
  // The Webhook trigger has no inputs — its URL is the configuration — so the panel must not
  // follow it with "This node has no settings."
  const showsUrl = node.data.nodeType === WEBHOOK_TRIGGER;
  const showsFormUrl = node.data.nodeType === FORM_TRIGGER;
  const showsResumeUrl = node.data.nodeType === WAIT_FOR_WEBHOOK;
  // The Schedule trigger's fields describe the repeat; whether it is *running* is a separate piece
  // of state (a `schedules` row plus a durable run), so it gets a panel of its own below them.
  const showsSchedule = node.data.nodeType === SCHEDULE_TRIGGER;
  // …and the one whose branch is worth reading back: which way it actually went, last run.
  const showsCondition = node.data.nodeType === CONDITION;
  const handles = handleDisplays(node.data.nodeType, node.data.inputs);
  const guide = definition?.guide;
  // Read here rather than inside `NodeField`: every picker field on this node reads the same
  // input, and choosing a different connection has to re-load all of them at once.
  const chosenConnection = node.data.inputs[CONNECTION_INPUT];
  const connectionId = typeof chosenConnection === "string" && chosenConnection ? chosenConnection : undefined;

  return (
    <aside
      aria-label="Node settings"
      className="flex w-[360px] shrink-0 flex-col border-l border-border bg-card"
    >
      <div className="flex items-start gap-2 border-b border-border p-3">
        <NodeIcon name={definition?.icon} className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-medium">
              {definition?.name ?? node.data.nodeType}
            </h2>
            <Badge variant="outline" className="shrink-0">
              {definition ? categoryLabel(definition.category) : "Unknown"}
            </Badge>
          </div>
          <p className="mt-1 text-xs break-words text-muted-foreground">
            {definition?.description ?? `${node.data.nodeType} is not in the node registry.`}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Close settings" onClick={onClose}>
          <XIcon />
        </Button>
      </div>

      <ScrollArea className="min-h-0 min-w-0 flex-1">
        <div className="min-w-0 space-y-4 p-3">
          {/* What the node *is*, before what it last did and what it will do next. A branching
              node is unreadable until you know what its arrows mean, so that comes first. */}
          {guide ? <NodeGuide guide={guide} handles={handles} /> : null}

          {/* What this node last ran with, before the form that changes what it runs with next. */}
          <LastRunSection
            nodeId={node.id}
            run={lastRun.self}
            // A trigger's only "source" is itself, and its own payload does not exist yet when it
            // runs — so it gets no hint about inserting variables.
            hasSources={lastRun.sources.some((source) => source.nodeId !== node.id)}
          />

          <div className="space-y-1.5">
            <Label htmlFor={`${node.id}-label`}>Name</Label>
            <Input
              id={`${node.id}-label`}
              value={node.data.label}
              onChange={(event) => patchData((data) => ({ ...data, label: event.target.value }))}
              onBlur={() =>
                patchData((data) =>
                  data.label.trim().length > 0
                    ? data
                    : { ...data, label: definition?.name ?? data.nodeType },
                )
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${node.id}-key`}>Key</Label>
            <Input
              id={`${node.id}-key`}
              value={keyDraft}
              spellCheck={false}
              aria-invalid={keyError !== null || undefined}
              className="font-mono text-xs"
              onChange={(event) => setKeyDraft(event.target.value)}
              onBlur={commitKey}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                else if (event.key === "Escape") setKeyDraft(node.data.key);
              }}
            />
            <p
              className={
                keyError
                  ? "text-xs break-all text-destructive"
                  : "text-xs break-all text-muted-foreground"
              }
            >
              {keyError ?? `Referenced in templates as {{ ${node.data.key}.… }}`}
            </p>
          </div>

          <Separator />

          {showsUrl && (
            <div className="space-y-1.5">
              <Label htmlFor={`${node.id}-webhook-url`}>Webhook URL</Label>
              <TriggerUrl
                id={`${node.id}-webhook-url`}
                workflowId={workflowId}
                webhookSecret={webhookSecret}
              />
            </div>
          )}

          {showsFormUrl && (
            <div className="space-y-1.5">
              <Label htmlFor={`${node.id}-form-url`}>Form link</Label>
              <FormUrl
                id={`${node.id}-form-url`}
                workflowId={workflowId}
                published={workflowStatus === "active"}
              />
            </div>
          )}

          {showsResumeUrl && (
            <div className="space-y-1.5">
              {/* The node is called "Wait for a callback", so the field is the callback's address. */}
              <Label htmlFor={`${node.id}-resume-url`}>Callback URL</Label>
              <ResumeUrlPattern id={`${node.id}-resume-url`} nodeId={node.id} />
            </div>
          )}

          {schema === null ? (
            <p className="text-sm text-muted-foreground">
              This node type is not installed, so there is nothing to configure.
            </p>
          ) : fields.length === 0 && !showsUrl && !showsResumeUrl ? (
            <p className="text-sm text-muted-foreground">This node has no settings.</p>
          ) : (
            <>
              {accountFields.map(([name, property]) => (
                <NodeFieldRow
                  key={name}
                  nodeId={node.id}
                  name={name}
                  schema={property}
                  required={required}
                  value={node.data.inputs[name]}
                  inputs={node.data.inputs}
                  groups={groups}
                  credential={definition?.credential ?? null}
                  connectionId={connectionId}
                  onChange={(value) => setInput(name, value)}
                />
              ))}

              {/* Which account, above the line; what to do with it, below. */}
              {accountFields.length > 0 && settingFields.length > 0 ? <Separator /> : null}

              {settingFields.map(([name, property]) => (
                <NodeFieldRow
                  key={name}
                  nodeId={node.id}
                  name={name}
                  schema={property}
                  required={required}
                  value={node.data.inputs[name]}
                  inputs={node.data.inputs}
                  groups={groups}
                  credential={definition?.credential ?? null}
                  connectionId={connectionId}
                  onChange={(value) => setInput(name, value)}
                />
              ))}

              {/* Under the fields it explains: the same three values, as the run resolved them. */}
              {showsCondition ? <ConditionLastTime run={lastRun.self} /> : null}
            </>
          )}

          {showsSchedule && <ScheduleConfig workflowId={workflowId} inputs={node.data.inputs} />}

          {/* The guide above already draws the ways out in the words the canvas uses; this is the
              fallback for a branching node that never wrote one. */}
          {!guide && handles.length > 1 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium">Branches</p>
              <div className="flex flex-wrap gap-1.5">
                {handles.map(({ handle, label }) => (
                  <Badge key={handle} variant="secondary" className="font-mono" title={handle}>
                    {label}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                One output handle per branch, top to bottom on the node.
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
