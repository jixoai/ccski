import { createColors, isColorSupported } from "colorette";

let colorEnabled = isColorSupported && process.env.FORCE_COLOR !== "0";
export let colors = createColors({ useColor: colorEnabled });

export function setColorEnabled(enabled: boolean): void {
  colorEnabled = enabled;
  colors = createColors({ useColor: colorEnabled });
}

export function highlight(text: string, query: string): string {
  if (!colorEnabled) return text;
  const escaped = escapeRegExp(query);
  const regex = new RegExp(escaped, "gi");
  return text.replace(regex, (match) => colors.bold(colors.green(match)));
}

export function dim(text: string): string {
  return colorEnabled ? colors.dim(text) : text;
}

export function success(text: string): string {
  return colorEnabled ? colors.green(text) : text;
}

export function error(text: string): string {
  return colorEnabled ? colors.red(text) : text;
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
}

export function renderList(items: ListItem[]): string {
  if (items.length === 0) return "";

  const titleWidth = Math.max(...items.map((item) => visibleLength(item.title)));

  return items
    .map((item) => {
      const title = padAnsi(item.title, titleWidth);
      const meta = item.meta ? `  ${dim(item.meta)}` : "";
      const description = item.description ? `\n    ${item.description}` : "";
      return `- ${colors.blue(title)}${meta}${description}`;
    })
    .join("\n\n");
}

function padAnsi(value: string, width: number): string {
  const length = visibleLength(value);
  if (length >= width) return value;
  return value + " ".repeat(width - length);
}

function visibleLength(value: string): number {
  return value.replace(/\x1b\[[0-9;]*m/g, "").length;
}
