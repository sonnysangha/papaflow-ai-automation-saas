import { disableTool } from "eve/tools";

// The Builder's whole surface is one workflow document in Convex. It has no business with a shell,
// a filesystem, arbitrary URL fetches or subagents of its own, and eve ships all of those on by
// default — the file slug is what disables one. `ask_question` and `load_skill` are deliberately
// left on: the first is eve's own HITL widget, the second is how `skills/` reaches the model.
export default disableTool();
