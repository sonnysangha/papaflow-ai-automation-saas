// Node definitions name their icon as a string (`nodes/define.ts` keeps `nodes/` free of React),
// so the canvas resolves that name at render time. The map is explicit rather than
// `import * as icons from "lucide-react"`: a namespace import of the barrel cannot be
// tree-shaken, which would ship lucide's whole icon set to the browser. Add a line here when a
// new node picks an icon that is not listed yet; anything unknown falls back to the box.
import { createElement } from "react";
import {
  BotIcon,
  BoxIcon,
  BracesIcon,
  ClockIcon,
  CodeIcon,
  DatabaseIcon,
  FilterIcon,
  GitBranchIcon,
  GlobeIcon,
  HandIcon,
  ImageIcon,
  MailIcon,
  MessageSquareIcon,
  MicIcon,
  PlayIcon,
  RepeatIcon,
  RouteIcon,
  ScanTextIcon,
  SendIcon,
  SparklesIcon,
  SplitIcon,
  TagsIcon,
  TimerIcon,
  WebhookIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  Bot: BotIcon,
  Box: BoxIcon,
  Braces: BracesIcon,
  Clock: ClockIcon,
  Code: CodeIcon,
  Database: DatabaseIcon,
  Filter: FilterIcon,
  GitBranch: GitBranchIcon,
  Globe: GlobeIcon,
  Hand: HandIcon,
  Image: ImageIcon,
  Mail: MailIcon,
  MessageSquare: MessageSquareIcon,
  Mic: MicIcon,
  Play: PlayIcon,
  Repeat: RepeatIcon,
  Route: RouteIcon,
  ScanText: ScanTextIcon,
  Send: SendIcon,
  Sparkles: SparklesIcon,
  Split: SplitIcon,
  Tags: TagsIcon,
  Timer: TimerIcon,
  Webhook: WebhookIcon,
  Zap: ZapIcon,
};

/** The lucide icon a node definition asked for, or a neutral box when the name is unknown. */
export function nodeIcon(name: string | undefined): LucideIcon {
  return (name ? ICONS[name] : undefined) ?? BoxIcon;
}

/**
 * Renders a node's icon. `createElement` instead of `<Icon />` on purpose: the component is
 * picked at runtime, which the React Compiler's static-components rule refuses to see as a
 * stable JSX tag.
 */
export function NodeIcon({ name, className }: { name?: string; className?: string }) {
  return createElement(nodeIcon(name), { className, "aria-hidden": true });
}
