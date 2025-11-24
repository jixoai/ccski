import {
  Separator,
  ValidationError,
  createPrompt,
  isDownKey,
  isEnterKey,
  isNumberKey,
  isSpaceKey,
  isUpKey,
  makeTheme,
  useKeypress,
  useMemo,
  useEffect,
  usePagination,
  usePrefix,
  useState,
} from "@inquirer/core";
import figures from "@inquirer/figures";
import { tone } from "../../utils/format.js";
import { wrap } from "../../word-wrap/index.js";

// Shared interactive picker so install/enable/disable stay visually consistent.

export interface Choice {
  value: string;
  label: string;
  description?: string;
  checked?: boolean;
}

type NormalizedChoice = {
  value: string;
  name: string;
  short: string;
  checkedName: string;
  description?: string;
  checked?: boolean;
  disabled?: boolean;
};

export interface MultiSelectOptions {
  message: string;
  choices: Choice[];
  defaultChecked?: boolean;
  pageSize?: number;
  showActiveDescription?: boolean;
  instructions?: boolean | string;
  loop?: boolean;
  required?: boolean;
  validate?: (selection: NormalizedChoice[]) => boolean | string | Promise<boolean | string>;
  shortcuts?: { all?: string; invert?: string };
  theme?: unknown;
  command?: {
    base: string;
    staticArgs?: string[];
    label?: string;
  };
}

const checkboxTheme = {
  icon: {
    checked: tone.success(figures.circleFilled),
    unchecked: figures.circle,
    cursor: figures.pointer,
  },
  style: {
    disabledChoice: (text: string) => tone.muted(`- ${text}`),
    renderSelectedChoices: (selectedChoices: Array<{ short: string }>) =>
      selectedChoices.map((choice) => choice.short).join(", "),
    description: (text: string) => tone.info(text),
    keysHelpTip: (keys: Array<[string, string]>) =>
      keys
        .map(([key, action]) => `${tone.bold(key)} ${tone.muted(action)}`)
        .join(tone.muted(" • ")),
  },
  helpMode: "always" as const,
  keybindings: [] as Array<"vim" | "emacs">,
};

const isSelectable = (item: NormalizedChoice): boolean =>
  !Separator.isSeparator(item) && !item.disabled;
const isChecked = (item: NormalizedChoice): boolean => isSelectable(item) && item.checked === true;

function normalizeChoices(choices: Choice[], defaultChecked: boolean): NormalizedChoice[] {
  return choices.map((choice) => {
    const desc = choice.description;
    return {
      value: choice.value,
      name: choice.label,
      short: choice.label,
      checkedName: choice.label,
      ...(desc ? { description: desc } : {}),
      checked: choice.checked ?? defaultChecked,
      disabled: false,
    };
  });
}

function buildPreview(
  command: MultiSelectOptions["command"],
  selected: string[]
): string | undefined {
  if (!command) return undefined;
  const label = command.label ?? "Command";
  const base = command.base.trim();
  const staticArgs = command.staticArgs?.filter(Boolean) ?? [];

  const renderedArgs = [...staticArgs, ...selected].map((arg) => tone.primary(arg)).join(" ");
  const renderedBase = tone.bold(tone.accent(base));
  const suffix = renderedArgs.length ? ` ${renderedArgs}` : tone.muted(" <none>");

  return `${tone.info(`${label}:`)} ${renderedBase}${suffix}`;
}

const promptImpl = createPrompt<string[], MultiSelectOptions & { shortcuts?: { all?: string; invert?: string } }>((config, done) => {
  const {
    instructions,
    pageSize,
    loop = false,
    required,
    validate = () => true,
    defaultChecked = false,
    command,
  } = config;

  const shortcuts = { all: "a", invert: "i", ...config.shortcuts };
  const theme = makeTheme(checkboxTheme, config.theme as any);
  const keybindings = theme.keybindings as ReadonlyArray<"vim" | "emacs">;

  const [status, setStatus] = useState("idle");
  const prefix = usePrefix({ status, theme });
  const [items, setItems] = useState(normalizeChoices(config.choices, defaultChecked));
  const [termSize, setTermSize] = useState(() => ({
    rows: process.stdout?.rows ?? 24,
    cols: process.stdout?.columns ?? 80,
  }));

  useEffect(() => {
    const stdout = process.stdout;
    if (!stdout?.on || !stdout?.off) return;
    const handleResize = (): void => {
      const rows = stdout.rows ?? termSize.rows;
      const cols = stdout.columns ?? termSize.cols;
      setTermSize({ rows, cols });
    };
    stdout.on("resize", handleResize);
    return () => {
      stdout.off("resize", handleResize);
    };
  }, []);

  const bounds = useMemo(() => {
    const first = items.findIndex(isSelectable);
    let last = -1;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (isSelectable(items[i]!)) {
        last = i;
        break;
      }
    }
    if (first === -1) {
      throw new ValidationError(
        "[checkbox prompt] No selectable choices. All choices are disabled."
      );
    }
    return { first, last };
  }, [items]);

  const [active, setActive] = useState(bounds.first);
  const [errorMsg, setError] = useState<string | undefined>();

  useKeypress(async (key) => {
    if (key.name === shortcuts.all) {
      const selectAll = items.some((choice) => isSelectable(choice) && !choice.checked);
      setItems(
        items.map((choice) => (isSelectable(choice) ? { ...choice, checked: selectAll } : choice))
      );
      setError(undefined);
      return;
    }

    if (key.name === shortcuts.invert) {
      setItems(
        items.map((choice) =>
          isSelectable(choice) ? { ...choice, checked: !choice.checked } : choice
        )
      );
      setError(undefined);
      return;
    }

    if (isSpaceKey(key)) {
      setItems(
        items.map((choice, idx) =>
          idx === active ? { ...choice, checked: !choice.checked } : choice
        )
      );
      setError(undefined);
      return;
    }

    if (isEnterKey(key)) {
      const selection = items.filter(isChecked);
      const isValid = await validate([...selection]);
      if (required && !selection.length) {
        setError("At least one choice must be selected");
      } else if (isValid === true) {
        setStatus("done");
        done(selection.map((choice) => choice.value));
      } else {
        setError(typeof isValid === "string" ? isValid : "You must select a valid value");
      }
      return;
    }

    if (isUpKey(key, keybindings) || isDownKey(key, keybindings)) {
      if (
        loop ||
        (isUpKey(key, keybindings) && active !== bounds.first) ||
        (isDownKey(key, keybindings) && active !== bounds.last)
      ) {
        const offset = isUpKey(key, keybindings) ? -1 : 1;
        let next = active;
        do {
          next = (next + offset + items.length) % items.length;
        } while (!isSelectable(items[next]));
        setActive(next);
      }
      return;
    }

    if (isNumberKey(key)) {
      const selectedIndex = Number(key.name) - 1;
      let selectableIndex = -1;
      const position = items.findIndex((item) => {
        if (Separator.isSeparator(item)) return false;
        selectableIndex += 1;
        return selectableIndex === selectedIndex;
      });
      const selectedItem = items[position];
      if (selectedItem && isSelectable(selectedItem)) {
        setActive(position);
        setItems(
          items.map((choice, i) =>
            i === position ? { ...choice, checked: !choice.checked } : choice
          )
        );
      }
    }
  });

  const message = theme.style.message(config.message, status);
  const preview = buildPreview(
    command,
    items.filter(isChecked).map((c) => c.value)
  );

  const termRows = termSize.rows;
  const usableRows = Math.max(1, termRows);
  const termCols = Math.max(40, termSize.cols - 4);
  const activeDescriptionRaw =
    config.showActiveDescription && items[active]?.description ? items[active]?.description : undefined;
  const wrappedDescription =
    activeDescriptionRaw && activeDescriptionRaw.length > 0
      ? wrap(activeDescriptionRaw, { width: termCols, cut: false, trim: true })
      : undefined;
  const descriptionLineCount = wrappedDescription ? wrappedDescription.split("\n").length : 0;

  const wrappedPreview =
    preview && preview.length > 0 ? wrap(preview, { width: termCols, cut: false, trim: true }) : undefined;
  const previewLineCount = wrappedPreview ? wrappedPreview.split("\n").length : 0;

  const helpLinesReserved = instructions === false ? 0 : 1;
  const errorLinesReserved = errorMsg ? 1 : 0;
  const leadingLines = 0;
  const reservedLines =
    1 + // message
    1 + // spacer
    previewLineCount +
    descriptionLineCount +
    errorLinesReserved +
    helpLinesReserved;
  // Let Inquirer paginate by lines: give it all available lines (not item count).
  const maxPageSize = Math.max(1, usableRows - reservedLines - leadingLines);
  const basePageSize = pageSize ?? maxPageSize;
  const finalPageSize = Math.max(1, Math.min(basePageSize, maxPageSize));

  let description: string | undefined;
  const page = usePagination({
    items,
    active,
    renderItem({ item, isActive }) {
      if (Separator.isSeparator(item)) {
        return ` ${item.separator}`;
      }
      if (item.disabled) {
        const disabledLabel = typeof item.disabled === "string" ? item.disabled : "(disabled)";
        return theme.style.disabledChoice(`${item.name} ${disabledLabel}`);
      }
      if (isActive && config.showActiveDescription) description = wrappedDescription ?? item.description;

      const checkbox = item.checked ? theme.icon.checked : theme.icon.unchecked;
      const name = item.checked ? item.checkedName : item.name;
      const color = isActive ? theme.style.highlight : (x: string) => x;
      const cursor = isActive ? theme.icon.cursor : " ";
      return color(`${cursor}${checkbox} ${name}`);
    },
    pageSize: finalPageSize,
    loop,
  });

  if (status === "done") {
    const selection = items.filter(isChecked);
    const answer = theme.style.answer(theme.style.renderSelectedChoices(selection));
    return [prefix, message, answer].filter(Boolean).join(" ");
  }

  let helpLine: string | undefined;
  if (instructions !== false) {
    if (typeof instructions === "string") {
      helpLine = instructions;
    } else {
      const keys: Array<[string, string]> = [
        ["↑↓", "navigate"],
        ["space", "select"],
      ];

      if (shortcuts.all) keys.push([shortcuts.all, "all"]);
      if (shortcuts.invert) keys.push([shortcuts.invert, "invert"]);
      keys.push(["⏎", "submit"]);
      helpLine = theme.style.keysHelpTip(keys);
    }
  }

  const lines = [
    [prefix, message].filter(Boolean).join(" "),
    page,
    " ",
    wrappedPreview ?? preview,
    description ? theme.style.description(description) : "",
    errorMsg ? theme.style.error(errorMsg) : "",
    helpLine,
  ]
    .filter(Boolean)
    .join("\n");

  const renderedLines = lines.replace(/\n+$/, "").split("\n");
  if (process.env.CCSKI_PROMPT_DEBUG === "1") {
    console.error(
      [
        "[prompt-debug]",
        `rows=${termRows}`,
        `usable=${usableRows}`,
        `leading=${leadingLines}`,
        `reserved=${reservedLines}`,
        `preview=${previewLineCount}`,
        `desc=${descriptionLineCount}`,
        `pageSize=${finalPageSize}`,
        `items=${items.length}`,
        `rendered=${renderedLines.length}`,
      ].join(" ")
    );
  }

  // Top padding to avoid first line being clipped in some terminals.
  renderedLines.unshift("");

  const padding = Math.max(0, usableRows - renderedLines.length);
  if (padding > 0) renderedLines.push(...Array(padding).fill(""));

  return renderedLines.join("\n");
});

export function promptMultiSelect(options: MultiSelectOptions): Promise<string[]> {
  return promptImpl(options);
}
