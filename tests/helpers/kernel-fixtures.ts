/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「批 4 remove/update/toggle 内核化 + G4 组合矩阵——
 * 真磁盘 fixture，tmp 自清理，真信号崩溃构造」+「批 5 G5 门：dry-run 不变性收据
 * （dry-run 后磁盘与 state 字节零变化断言）」
 * 正交意图：
 *   [1] 批 4 内核测试共用沙箱（与批 3 entity-kernel.test.ts 同法）：真磁盘 tmp 沙箱
 *       + 真 symlink + 真 state 提交，不 mock fs；每用例自清理
 *   [2] state 直读/直写助手（收据断言与形态构造用；写侧仅测试构造 disabled/pinned
 *       等前置态，被测 API 恒走正规入口）
 *   [3] 批 5 字节级快照助手（snapshotDir/assertSnapshotEqual）：递归收集文件内容
 *       base64 + symlink 原文 + 目录集，dry-run 前后全等断言的不变性收据原料
 * 妥协声明：结果联合类型的窄化断言按各文件的 Result 形状就地书写，本文件只提供
 * 沙箱与磁盘/state 原料，不做结果语义假设。
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { computeSkillFolderHash } from "../../src/core/folder-hash.js";
import { CCSKI_STATE_FILENAME } from "../../src/core/state-store.js";

export interface Sandbox {
  home: string;
  workspace: string;
  scopeBase: string;
  entityRoot: string;
}

export function makeSandbox(prefix: string, scope: "global" | "project"): Sandbox {
  const home = mkdtempSync(join(tmpdir(), `ccski-g4-home-${prefix}-`));
  const workspace = mkdtempSync(join(tmpdir(), `ccski-g4-ws-${prefix}-`));
  const base = scope === "global" ? join(home, ".agents") : join(workspace, ".agents");
  return { home, workspace, scopeBase: base, entityRoot: join(base, "skills") };
}

export function makeSandboxPair(prefix: string): { global: Sandbox; project: Sandbox } {
  return {
    global: makeSandbox(`${prefix}-g`, "global"),
    project: makeSandbox(`${prefix}-p`, "project"),
  };
}

export function cleanupSandbox(sandbox: Sandbox): void {
  rmSync(sandbox.home, { recursive: true, force: true });
  rmSync(sandbox.workspace, { recursive: true, force: true });
}

export function real(path: string): string {
  return realpathSync(path);
}

let skillCounter = 0;

/** 写一个含 SKILL.md 的真实源目录（自增计数保证互不撞名/撞内容） */
export function writeSkillSource(
  parent: string,
  name: string,
  body = "Body\n",
  extraFile?: string
): string {
  skillCounter += 1;
  const dir = join(parent, `src-${skillCounter}-${name.replace(/[^a-z0-9]/gi, "-")}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: G4 fixture skill ${name}\n---\n${body}`
  );
  if (extraFile !== undefined) writeFileSync(join(dir, extraFile), "extra\n");
  return dir;
}

/** 覆写既有源目录的 SKILL.md 正文（保持 frontmatter name 不变） */
export function rewriteSkillBody(sourceDir: string, name: string, body: string): void {
  writeFileSync(
    join(sourceDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: G4 fixture skill ${name}\n---\n${body}`
  );
}

export interface RawState {
  schemaVersion: number;
  generation: number;
  entities: Record<string, Record<string, unknown>>;
  projections: Record<string, Record<string, unknown>>;
}

export function readState(scopeBase: string): RawState {
  return JSON.parse(readFileSync(join(scopeBase, CCSKI_STATE_FILENAME), "utf8")) as RawState;
}

export function writeState(scopeBase: string, state: RawState): void {
  writeFileSync(join(scopeBase, CCSKI_STATE_FILENAME), `${JSON.stringify(state, null, 2)}\n`);
}

export function scopeOpts(sandbox: Sandbox): { userDir: string; workspaceDir: string } {
  return { userDir: sandbox.home, workspaceDir: sandbox.workspace };
}

/** 读取实体目录内容 hash 的原文（供与 state revision 断言）——folder-hash 生产管线 */
export function hashOf(dir: string): Promise<string> {
  return computeSkillFolderHash(dir);
}

// ---------------------------------------------------------------------------
// G5 dry-run 不变性收据：字节级磁盘快照（含 state 文件与符号链接形态）
// ---------------------------------------------------------------------------

export interface DirSnapshot {
  /** 相对路径 → 内容 base64（regular files） */
  files: Map<string, string>;
  /** 相对路径 → 链接原文（symlinks） */
  links: Map<string, string>;
  /** 相对目录路径集合 */
  dirs: Set<string>;
}

export function snapshotDir(root: string, prefix = ""): DirSnapshot {
  const snap: DirSnapshot = { files: new Map(), links: new Map(), dirs: new Set() };
  walk(root, prefix, snap);
  return snap;
}

function walk(abs: string, rel: string, snap: DirSnapshot): void {
  let entries: Array<{
    name: string;
    isSymbolicLink(): boolean;
    isDirectory(): boolean;
    isFile(): boolean;
  }>;
  try {
    entries = readdirSync(abs, { withFileTypes: true }) as never;
  } catch {
    return;
  }
  for (const entry of entries) {
    const childAbs = join(abs, entry.name);
    const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      snap.links.set(childRel, readlinkSync(childAbs));
      continue;
    }
    if (entry.isDirectory()) {
      snap.dirs.add(childRel);
      walk(childAbs, childRel, snap);
      continue;
    }
    if (entry.isFile()) {
      snap.files.set(childRel, readFileSync(childAbs).toString("base64"));
    }
  }
}

export function assertSnapshotEqual(before: DirSnapshot, after: DirSnapshot): void {
  expect([...after.files.keys()].sort()).toEqual([...before.files.keys()].sort());
  expect([...after.links.keys()].sort()).toEqual([...before.links.keys()].sort());
  expect([...after.dirs].sort()).toEqual([...before.dirs].sort());
  for (const [key, value] of before.files) {
    expect(after.files.get(key)).toBe(value);
  }
  for (const [key, value] of before.links) {
    expect(after.links.get(key)).toBe(value);
  }
}
