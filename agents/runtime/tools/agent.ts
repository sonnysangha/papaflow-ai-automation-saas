import { disableTool } from "eve/tools";

// A workflow-automation agent running a customer's prompt has no business with a shell, a
// filesystem, arbitrary URL fetches or subagents of its own: its whole surface is the org's
// connectors. eve ships `agent` on by default, and the file slug is what disables it.
// `ask_question` and `load_skill` are deliberately left on — the first is how a parked HITL
// request surfaces to the Agent node, the second is how `skills/` reaches the model.
export default disableTool();
