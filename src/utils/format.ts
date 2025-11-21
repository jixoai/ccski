let colorEnabled = process.env.FORCE_COLOR !== "0" && process.stdout.isTTY;

export function setColorEnabled(enabled: boolean): void {
  colorEnabled = enabled;
}

const colors = {
  bold: (value: string): string => (colorEnabled ? `\x1b[1m${value}\x1b[22m` : value),
  red: (value: string): string => (colorEnabled ? `\x1b[31m${value}\x1b[39m` : value),
  gray: (value: string): string => (colorEnabled ? `\x1b[90m${value}\x1b[39m` : value),
  green: (value: string): string => (colorEnabled ? `\x1b[32m${value}\x1b[39m` : value),
};

export type TableRow = string[];

export function renderTable(headers: string[], rows: TableRow[]): string {
  const widths = headers.map((header, columnIndex) => {
    const values = rows.map((row) => row[columnIndex] ?? "");
    return Math.max(header.length, ...values.map((v) => visualLength(v)));
  });

  const renderRow = (cells: string[]): string =>
    `| ${cells.map((cell, index) => pad(cell, widths[index] ?? 0)).join(" | ")} |`;

  const separator = `|-` + widths.map((w) => "-".repeat(w)).join("-|-") + "-|";

  const lines = [
    renderRow(headers.map(colors.bold)),
    separator,
    ...rows.map((row) => renderRow(row)),
  ];

  return lines.join("\n");
}

function pad(value: string, width: number): string {
  const length = visualLength(value);
  if (length >= width) return value;
  return value + " ".repeat(width - length);
}

function visualLength(value: string): number {
  // Strip ANSI sequences for width calculation
  return value.replace(/\x1b\[[0-9;]*m/g, "").length;
}

export function highlight(text: string, query: string): string {
  if (!colorEnabled) return text;
  const escaped = escapeRegExp(query);
  const regex = new RegExp(escaped, "gi");
  return text.replace(regex, (match) => colors.bold(colors.green(match)));
}

export function dim(text: string): string {
  return colors.gray(text);
}

export function success(text: string): string {
  return colors.green(text);
}

export function error(text: string): string {
  return colors.red(text);
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
