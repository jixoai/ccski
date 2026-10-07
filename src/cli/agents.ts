/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「CLI agent 检测默认全集（含 no-detection --yes 退化与
 * per-agent 部分成功收据，对齐批 0 fixture）」（批 5 tasks.md:45；design「默认投影
 * 全集语义」+ g0/parity-npm-skills-receipt.md 钉值）
 * 正交意图：
 *   [1] ccski CLI agent 注册表（npm:skills 1.7.1 语义镜像，g0 收据 §0 钉值）：
 *       skillsDir/globalSkillsDir/检测探针/showInUniversalList/showInUniversalPrompt
 *       字段语义逐项对齐；universal-class = skillsDir === ".agents/skills"（共享
 *       canonical 根 → projectEntity 收 entity-local 收据）
 *   [2] 目标集分支（receipt §0 钉值）：显式 --agent → 精确集合；--agent '*' → 全
 *       registry 键；有检测 → ensureUniversalAgents(detected)；无检测 + --yes → 全
 *       registry 键退化（registry-fallback）；无检测无 --yes → typed 拒绝（非交互
 *       不猜测）
 *   [3] 能力诚实面：无 global 安装能力（globalSkillsDir undefined）的 agent 在
 *       global scope 记 typed 失败条目而非静默跳过（receipt p1/p4 PromptScript 钉值）
 *   [4] SDK 正交：本模块是 CLI 层投影默认集，绝不进入 SDK API 面（SDK 恒显式 roots）
 * 妥协声明：ccski 注册表是 npm 1.7.1 语义的镜像而非逐键复制（79 键压缩为 ccski
 * 发现层真实的根形态：共享根 + 内建/动态 agent 根）；zcode 检测不含
 * /Applications/ZCode.app 探针（receipt p2 记录的检测泄漏源，hermetic 检测优先）；
 * 交互列表隐藏面（getVisibleUniversalPrompt）仅暴露不消费（headless CLI 无多选面）。
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export interface AgentRegistryEntry {
  /** registry 键（--agent 值；npm parity 命名） */
  id: string;
  label: string;
  /** project scope 的 skills 目录（workspace 相对 posix 路径） */
  skillsDir: string;
  /**
   * global scope 的 skills 根（home 相对段）；undefined = 无 global 安装能力
   * （receipt p1/p4：PromptScript 类 → typed 失败条目而非静默跳过）
   */
  globalSkillsDir?: readonly string[];
  /** 检测探针：home 相对存在性标记（any-of）；缺省 = 恒不检测 */
  detectHome?: readonly string[];
  /** 检测探针：cwd 相对存在性标记（any-of；receipt：replit 的 .replit 标记） */
  detectCwd?: readonly string[];
  /** false = 不进自动 universal 集（receipt：replit/universal 钉值） */
  showInUniversalList?: boolean;
  /** false = 交互 universal 列表隐藏（receipt §0 源码钉值；headless 不消费） */
  showInUniversalPrompt?: boolean;
}

/**
 * ccski CLI agent 注册表（冻结快照；npm 升级重跑 parity 时同步）。
 * universal-class（skillsDir === ".agents/skills"）：agents（共享根本体）、
 * replit（showInUniversalList:false）、promptscript（showInUniversalPrompt:false +
 * 无 global 能力）、universal（显式专用，showInUniversalList:false，恒不检测）。
 */
export const AGENT_REGISTRY: readonly AgentRegistryEntry[] = [
  // universal-class：共享 canonical 根（投影 = entity-local 收据）
  {
    id: "agents",
    label: "Shared agents root",
    skillsDir: ".agents/skills",
    globalSkillsDir: [".agents", "skills"],
    detectHome: [".agents"],
  },
  {
    id: "replit",
    label: "Replit",
    skillsDir: ".agents/skills",
    // receipt p3：universal-class 恒投影 canonical 共享根（此字段不生效、不创建
    // 独立目录，仅为 global 能力判定保留）；showInUniversalList:false = 不自动入集
    globalSkillsDir: [".config", "agents", "skills"],
    detectCwd: [".replit"],
    showInUniversalList: false,
  },
  {
    id: "promptscript",
    label: "PromptScript",
    skillsDir: ".agents/skills",
    // receipt p1/p4 钉值：无 global 安装能力 → global scope 失败条目
    detectCwd: [".promptscript", "promptscript.yaml"],
    showInUniversalPrompt: false,
  },
  {
    id: "universal",
    label: "Universal",
    skillsDir: ".agents/skills",
    globalSkillsDir: [".agents", "skills"],
    showInUniversalList: false,
    // receipt §0：detect 恒 false（仅显式 --agent universal）
  },
  // 独立根 agent：global = ~/.<dir>/skills，检测 = home 标记目录
  {
    id: "claude-code",
    label: "Claude Code",
    skillsDir: ".claude/skills",
    globalSkillsDir: [".claude", "skills"],
    detectHome: [".claude"],
  },
  {
    id: "zcode",
    label: "ZCode",
    skillsDir: ".zcode/skills",
    globalSkillsDir: [".zcode", "skills"],
    detectHome: [".zcode"],
  },
  {
    id: "codex",
    label: "Codex",
    skillsDir: ".codex/skills",
    globalSkillsDir: [".codex", "skills"],
    detectHome: [".codex"],
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    skillsDir: ".gemini/skills",
    globalSkillsDir: [".gemini", "skills"],
    detectHome: [".gemini"],
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    skillsDir: ".openclaw/skills",
    globalSkillsDir: [".openclaw", "skills"],
    detectHome: [".openclaw"],
  },
  {
    id: "cursor",
    label: "Cursor",
    skillsDir: ".cursor/skills",
    globalSkillsDir: [".cursor", "skills"],
    detectHome: [".cursor"],
  },
  {
    id: "windsurf",
    label: "Windsurf",
    skillsDir: ".windsurf/skills",
    globalSkillsDir: [".windsurf", "skills"],
    detectHome: [".windsurf"],
  },
  {
    id: "opencode",
    label: "OpenCode",
    skillsDir: ".config/opencode/skills",
    globalSkillsDir: [".config", "opencode", "skills"],
    detectHome: [".config/opencode"],
  },
  // receipt p1/p2b：eve 无 global 能力（第二失败条目钉值）
  {
    id: "eve",
    label: "Eve",
    skillsDir: ".eve/skills",
    detectHome: [".eve"],
  },
];

/** universal-class 判定（receipt：isUniversalAgent 只看 skillsDir） */
export function isUniversalClass(entry: AgentRegistryEntry): boolean {
  return entry.skillsDir === ".agents/skills";
}

/** 自动 universal 集（receipt：getUniversalAgents = skillsDir 命中 且 非 showInUniversalList:false） */
export function getUniversalAgents(): AgentRegistryEntry[] {
  return AGENT_REGISTRY.filter(
    (entry) => isUniversalClass(entry) && entry.showInUniversalList !== false
  );
}

/** 交互列表可见 universal 集（receipt：getVisibleUniversalAgents 再排除 showInUniversalPrompt:false） */
export function getVisibleUniversalAgents(): AgentRegistryEntry[] {
  return getUniversalAgents().filter((entry) => entry.showInUniversalPrompt !== false);
}

export interface DetectAgentsOptions {
  userDir?: string;
  cwd?: string;
}

/** 检测已安装 agent（home/cwd 探针；可注入目录保证 hermetic 测试） */
export function detectInstalledAgents(options: DetectAgentsOptions = {}): AgentRegistryEntry[] {
  const home = resolve(options.userDir ?? homedir());
  const cwd = resolve(options.cwd ?? process.cwd());
  return AGENT_REGISTRY.filter((entry) => {
    if (entry.id === "universal") return false; // receipt：恒 false（仅显式指定）
    const homeHit = entry.detectHome?.some((marker) => existsSync(join(home, marker))) ?? false;
    if (homeHit) return true;
    const cwdHit = entry.detectCwd?.some((marker) => existsSync(join(cwd, marker))) ?? false;
    return cwdHit;
  });
}

/** ensureUniversalAgents（receipt：detected ∪ getUniversalAgents()，registry 序去重） */
export function ensureUniversalAgents(
  detected: readonly AgentRegistryEntry[]
): AgentRegistryEntry[] {
  const merged: AgentRegistryEntry[] = [];
  const seen = new Set<string>();
  for (const entry of [...detected, ...getUniversalAgents()]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
  }
  return merged;
}

/** 目标集解析失败的 typed 词表 */
export type AgentTargetErrorCode = "AGENT_UNKNOWN" | "TARGET_SET_REQUIRED";

export interface AgentTarget {
  id: string;
  label: string;
  /** global scope = home 相对根的绝对路径；project scope = workspace 相对根 */
  root: string | null;
  /** false = 无 global 安装能力（global scope 下产生 typed 失败条目） */
  canInstallGlobal: boolean;
  universalClass: boolean;
}

export interface ResolvedAgentTargets {
  targets: AgentTarget[];
  detected: string[];
  /** 目标集分支收据（parity fixture 钉面） */
  branch: "explicit" | "registry-all" | "detected-plus-universal" | "registry-fallback";
}

export class AgentTargetError extends Error {
  constructor(
    public readonly code: AgentTargetErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AgentTargetError";
  }
}

export interface ResolveTargetsOptions {
  scope: "global" | "project";
  /** 显式 --agent 集合（可含 "*"）；缺省 = 检测分支 */
  agents?: readonly string[];
  /** 无检测时的 registry 全集退化闸（receipt：no-detection + --yes） */
  yes?: boolean;
  userDir?: string;
  cwd?: string;
  workspaceDir?: string;
}

function targetRootFor(
  entry: AgentRegistryEntry,
  scope: "global" | "project",
  dirs: { userDir: string; workspaceDir: string }
): string | null {
  if (scope === "project") {
    return join(dirs.workspaceDir, ...entry.skillsDir.split("/"));
  }
  // 无 global 安装能力优先于 universal-class（receipt p1/p4：promptscript 类 = 失败条目）
  if (entry.globalSkillsDir === undefined) return null;
  // receipt p3 钉值：universal-class（含 replit）恒投影 canonical 共享根——不产生
  // 独立目录（entry.globalSkillsDir 对 universal-class 不生效）
  if (isUniversalClass(entry)) {
    return join(dirs.userDir, ".agents", "skills");
  }
  return join(dirs.userDir, ...entry.globalSkillsDir);
}

function toTarget(
  entry: AgentRegistryEntry,
  scope: "global" | "project",
  dirs: { userDir: string; workspaceDir: string }
): AgentTarget {
  const root = targetRootFor(entry, scope, dirs);
  return {
    id: entry.id,
    label: entry.label,
    root,
    canInstallGlobal: entry.globalSkillsDir !== undefined,
    universalClass: isUniversalClass(entry),
  };
}

function dirsOf(options: ResolveTargetsOptions): { userDir: string; workspaceDir: string } {
  return {
    userDir: resolve(options.userDir ?? homedir()),
    workspaceDir: resolve(options.workspaceDir ?? process.cwd()),
  };
}

/**
 * CLI 默认投影全集解析（receipt §0 分支钉值）。显式 --agent → 精确集合（未知 id
 * typed 拒绝并列出合法集）；"--agent *" 或 无检测+--yes → 全 registry 键；有检测 →
 * ensureUniversalAgents(detected)；无检测无 --yes → typed 拒绝（TARGET_SET_REQUIRED，
 * 提示 --yes / --agent）。project scope 下全部 agent 可投影（无「global 能力」概念）。
 */
export function resolveAgentTargets(options: ResolveTargetsOptions): ResolvedAgentTargets {
  const dirs = dirsOf(options);
  const scope = options.scope;
  const explicit =
    options.agents?.map((value) => value.trim()).filter((value) => value.length > 0) ?? [];

  if (explicit.length > 0) {
    if (explicit.includes("*")) {
      return {
        targets: AGENT_REGISTRY.map((entry) => toTarget(entry, scope, dirs)),
        detected: detectInstalledAgents(options).map((entry) => entry.id),
        branch: "registry-all",
      };
    }
    const unknown = explicit.filter((id) => !AGENT_REGISTRY.some((entry) => entry.id === id));
    if (unknown.length > 0) {
      const valid = AGENT_REGISTRY.map((entry) => entry.id).join(", ");
      throw new AgentTargetError(
        "AGENT_UNKNOWN",
        `unknown agent target(s): ${unknown.join(", ")}. Valid agents: ${valid}`
      );
    }
    const seen = new Set<string>();
    const targets = explicit
      .filter((id) => (seen.has(id) ? false : (seen.add(id), true)))
      .map((id) => AGENT_REGISTRY.find((entry) => entry.id === id)!)
      .map((entry) => toTarget(entry, scope, dirs));
    return {
      targets,
      detected: detectInstalledAgents(options).map((entry) => entry.id),
      branch: "explicit",
    };
  }

  const detected = detectInstalledAgents(options);
  if (detected.length > 0) {
    return {
      targets: ensureUniversalAgents(detected).map((entry) => toTarget(entry, scope, dirs)),
      detected: detected.map((entry) => entry.id),
      branch: "detected-plus-universal",
    };
  }
  if (options.yes === true) {
    // receipt p2b：no-detection --yes = 全 registry 键退化（逐 agent 尝试 + 部分成功）
    return {
      targets: AGENT_REGISTRY.map((entry) => toTarget(entry, scope, dirs)),
      detected: [],
      branch: "registry-fallback",
    };
  }
  throw new AgentTargetError(
    "TARGET_SET_REQUIRED",
    "no agent detected in this environment; pass --yes to project to the full agent registry, or --agent <id> to choose targets explicitly"
  );
}

/** 注册表根的磁盘判定（migrate/repair CLI 注入显式 roots 用；只报告不创建） */
export function existingRegistryRoots(options: {
  scope: "global" | "project";
  userDir?: string;
  cwd?: string;
  workspaceDir?: string;
}): string[] {
  const dirs = dirsOf({
    scope: options.scope,
    ...(options.userDir !== undefined ? { userDir: options.userDir } : {}),
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.workspaceDir !== undefined ? { workspaceDir: options.workspaceDir } : {}),
  });
  return AGENT_REGISTRY.map((entry) => targetRootFor(entry, options.scope, dirs))
    .filter((root): root is string => root !== null && isAbsolute(root))
    .filter((root) => existsSync(root));
}
