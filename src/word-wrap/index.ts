import stringWidth from "string-width";

export interface WrapOptions {
  width?: number;
  indent?: string;
  newline?: string;
  escape?: (str: string) => string;
  trim?: boolean;
  cut?: boolean;
}

const defaultIndent = "  ";
const defaultWidth = 50;

const graphemeSegmenter = typeof Intl !== "undefined" && typeof (Intl as any).Segmenter !== "undefined" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

function splitGraphemes(input: string): string[] {
  if (!input) return [];
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(input), (s) => s.segment);
  }
  return Array.from(input);
}

function sliceByWidth(text: string, maxWidth: number): { chunk: string; rest: string } {
  if (maxWidth <= 0) return { chunk: "", rest: text };
  const graphemes = splitGraphemes(text);
  let used = 0;
  let end = 0;

  while (end < graphemes.length) {
    const next = graphemes[end]!;
    const nextWidth = stringWidth(next);
    if (used + nextWidth > maxWidth) break;
    used += nextWidth;
    end += 1;
  }

  return { chunk: graphemes.slice(0, end).join(""), rest: graphemes.slice(end).join("") };
}

function trimTrailingWhitespace(line: string): string {
  return line.replace(/[ \t]+$/u, "");
}

function identity(str: string): string {
  return str;
}

const breakableRegex = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}]/u;

function isBreakable(token: string): boolean {
  return breakableRegex.test(token);
}

export function wrap(str: string | null | undefined, options: WrapOptions = {}): string | null | undefined {
  if (str == null) return str;

  const width = options.width ?? defaultWidth;
  const indent = options.indent ?? defaultIndent;
  const newline = options.newline ?? `\n${indent}`;
  const escape = options.escape ?? identity;
  const cut = options.cut ?? false;
  const trim = options.trim ?? true;

  let current = "";
  let currentWidth = 0;
  const lines: string[] = [];

  const pushLine = (): void => {
    lines.push(current);
    current = "";
    currentWidth = 0;
  };

  const processSegment = (segment: string): void => {
    const tokens = segment.split(/(\s+)/u);

    for (const token of tokens) {
      if (token === "") continue;

      const tokenWidth = stringWidth(token);

      // whitespace token
      if (/^\s+$/u.test(token)) {
        if (currentWidth === 0) continue; // avoid leading whitespace on new line
        if (currentWidth + tokenWidth <= width) {
          current += token;
          currentWidth += tokenWidth;
        } else {
          pushLine();
        }
        continue;
      }

      // word or text token
      if (currentWidth + tokenWidth <= width) {
        current += token;
        currentWidth += tokenWidth;
        continue;
      }

      if (!cut) {
        if (currentWidth > 0) pushLine();
        if (tokenWidth > width && isBreakable(token)) {
          let remaining = token;
          while (remaining.length > 0) {
            const { chunk, rest } = sliceByWidth(remaining, width);
            current = chunk;
            currentWidth = stringWidth(chunk);
            pushLine();
            remaining = rest;
          }
          continue;
        }
        if (tokenWidth > width) {
          current = token;
          currentWidth = tokenWidth;
          pushLine();
          continue;
        }
        current = token;
        currentWidth = tokenWidth;
        continue;
      }

      // cut long token respecting display width
      let remaining = token;
      while (remaining.length > 0) {
        const spaceLeft = Math.max(width - currentWidth, 0);
        if (spaceLeft === 0) {
          pushLine();
          continue;
        }
        const { chunk, rest } = sliceByWidth(remaining, spaceLeft);
        if (chunk === "" && rest === remaining) {
          // safeguard to avoid infinite loop when width < smallest grapheme width
          current += remaining;
          currentWidth += stringWidth(remaining);
          remaining = "";
          break;
        }
        current += chunk;
        currentWidth += stringWidth(chunk);
        remaining = rest;
        if (remaining.length > 0) {
          pushLine();
        }
      }
    }
  };

  const segments = str.split("\n");
  segments.forEach((segment) => {
    processSegment(segment);
    pushLine();
  });

  while (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  if (lines.length === 0) lines.push("");

  const escaped = lines.map((line) => escape(trim ? trimTrailingWhitespace(line) : line));
  return indent + escaped.join(newline);
}

export default wrap;
