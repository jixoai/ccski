import { createColors, isColorSupported } from "colorette";
import stringWidth from "string-width";
import type { SkillProvider } from "../types/skill.js";
import { wrap } from "../word-wrap/index.js";

let colorEnabled = isColorSupported && process.env.FORCE_COLOR !== "0";
export let colors = createColors({ useColor: colorEnabled });

export function setColorEnabled(enabled: boolean): void {
  colorEnabled = enabled;
  colors = createColors({ useColor: colorEnabled });
}

type Colorizer = (text: string) => string;

const applyTone = (colorFn: Colorizer): Colorizer => (text) => (colorEnabled ? colorFn(text) : text);

export const tone = {
  primary: applyTone((text) => colors.blue(text)),
  accent: applyTone((text) => colors.magenta(text)),
  info: applyTone((text) => colors.cyan(text)),
  success: applyTone((text) => colors.green(text)),
  warning: applyTone((text) => colors.yellow(text)),
  danger: applyTone((text) => colors.red(text)),
  muted: applyTone((text) => colors.dim(text)),
  bold: applyTone((text) => colors.bold(text)),
  underline: applyTone((text) => colors.underline(text)),
} as const;

export function highlight(text: string, query: string): string {
  if (!colorEnabled) return text;
  const escaped = escapeRegExp(query);
  const regex = new RegExp(escaped, "gi");
  return text.replace(regex, (match) => tone.bold(tone.success(match)));
}

export function dim(text: string): string {
  return tone.muted(text);
}

export function success(text: string): string {
  return tone.success(text);
}

export function error(text: string): string {
  return tone.danger(text);
}

export function warn(text: string): string {
  return tone.warning(text);
}

export function info(text: string): string {
  return tone.info(text);
}

export function heading(text: string): string {
  return tone.underline(tone.bold(tone.accent(text)));
}

export function providerBadge(provider: SkillProvider): string {
  const label = `[${provider}]`;
  if (provider === "claude") return tone.success(label);
  if (provider === "codex") return tone.info(label);
  return dim(label);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = -1;
  do {
    size /= 1024;
    unitIndex += 1;
  } while (size >= 1024 && unitIndex < units.length - 1);
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

export interface ListItem {
  title: string;
  description?: string;
  meta?: string;
  badge?: string;
  color?: (text: string) => string;
}

export function renderList(items: ListItem[]): string {
  if (items.length === 0) return "";

  const titleWidth = Math.max(...items.map((item) => displayWidth(item.title)));

  return items
    .map((item) => {
      const title = padAnsi(item.title, titleWidth);
      const coloredTitle = item.color ? item.color(title) : tone.primary(title);
      const meta = item.meta ? `  ${dim(item.meta)}` : "";
      const badge = item.badge ? ` ${item.badge}` : "";
      const wrapWidth = Math.max(20, Math.min(process.stdout?.columns ?? 80, 120) - 4);
      const desc = item.description;
      const wrapped = desc
        ? wrap(desc, {
            width: wrapWidth,
            indent: "",
            newline: "\n",
            trim: true,
            cut: false,
          })
        : "";
      const description =
        wrapped && wrapped.length > 0 ? "\n    " + wrapped.replace(/\n/g, "\n    ") : "";
      return `- ${coloredTitle}${badge}${meta}${description}`;
    })
    .join("\n\n");
}

function padAnsi(value: string, width: number): string {
  const length = displayWidth(value);
  if (length >= width) return value;
  return value + " ".repeat(width - length);
}

function displayWidth(value: string): number {
  const stripped = value.replace(/\x1b\[[0-9;]*m/g, "");
  return stringWidth(stripped);
}
