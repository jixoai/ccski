/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「folder-hash：按 G0 收据实现……测试 = F1-F7 七 fixture 全 digest 对账 + 字节序变体负例」
 * 正交意图：
 *   [1] 按收据 F1-F7 节的字面量逐字节重建 fixture 源树（批 1 实现的对账输入）
 *   [2] 单一构建源：pin 探针（pin-hash-probe.ts）与 vitest 测试共用，保证钉值与测试输入同树
 * 妥协声明：G0 实跑的原始 fixture 树未持久化；F1/F2 可按收据字面量+字节数逐字节重建，
 * F3-F7 的 SKILL.md 收据只给 frontmatter name 未给字节，description 按 F1/F2 的
 * 「F<N> ... fixture.」模式重建——其 digest 由 pin-hash-probe.ts 对真实 skills@1.7.1
 * 重跑重钉（F1/F2 与收据钉值一致即为字节级对账证据，见 tests/folder-hash.test.ts 头注）。
 */
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface FixtureSpec {
  /** 收据 §2 的 fixture 目录名（安装时的逻辑名 = 目录名） */
  readonly dirName: string;
  /** 构建函数：把 fixture 树写入给定父目录 */
  readonly build: (parentDir: string) => string;
}

function writeSkillMd(skillDir: string, name: string, description: string): void {
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
  );
}

function buildF1Baseline(parentDir: string): string {
  const dir = join(parentDir, "f1-baseline");
  mkdirSync(dir, { recursive: true });
  // 收据 F1：SKILL.md 逐字节给出（75B）
  writeSkillMd(dir, "f1-baseline", "F1 baseline fixture.");
  writeFileSync(join(dir, "README.md"), "root readme\n");
  mkdirSync(join(dir, "reference"), { recursive: true });
  writeFileSync(join(dir, "reference", "guide.md"), "# Guide\nsome text\n");
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "scripts", "run.sh"), "#!/bin/sh\necho f1\n");
  return dir;
}

function buildF2Unicode(parentDir: string): string {
  const dir = join(parentDir, "f2-unicode");
  mkdirSync(dir, { recursive: true });
  // 收据 F2：SKILL.md 72B + name f2-unicode → description 反推为
  // 「F2 unicode fixture.」（19 字符，总字节 4+17+33+4+1+13 = 72，与收据一致）
  writeSkillMd(dir, "f2-unicode", "F2 unicode fixture.");
  writeFileSync(join(dir, "alpha.md"), "more latin\n");
  writeFileSync(join(dir, "zeta.md"), "latin content\n");
  mkdirSync(join(dir, "中文目录"), { recursive: true });
  writeFileSync(join(dir, "中文目录", "说明.md"), "unicode content 文件内容\n");
  return dir;
}

function buildF3Case(parentDir: string): string {
  const dir = join(parentDir, "f3-case");
  mkdirSync(dir, { recursive: true });
  writeSkillMd(dir, "f3-case", "F3 case fixture.");
  writeFileSync(join(dir, "Mixed.TXT"), "mixed\n");
  mkdirSync(join(dir, "SUB-UP"), { recursive: true });
  writeFileSync(join(dir, "SUB-UP", "Readme.md"), "upper dir file\n");
  mkdirSync(join(dir, "sub-low"), { recursive: true });
  writeFileSync(join(dir, "sub-low", "readme.md"), "lower dir file\n");
  return dir;
}

function buildF4Symlink(parentDir: string): string {
  const dir = join(parentDir, "f4-symlink");
  mkdirSync(dir, { recursive: true });
  writeSkillMd(dir, "f4-symlink", "F4 symlink fixture.");
  mkdirSync(join(dir, "real-dir"), { recursive: true });
  writeFileSync(join(dir, "real-dir", "real.txt"), "real file content\n");
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "doc.md"), "doc\n");
  symlinkSync(join(dir, "real-dir", "real.txt"), join(dir, "link-to-file"), "file");
  symlinkSync(join(dir, "real-dir"), join(dir, "link-to-dir"), "dir");
  symlinkSync(join("..", "real-dir", "real.txt"), join(dir, "docs", "relative-link"), "file");
  return dir;
}

function buildF5EmptyDir(parentDir: string): string {
  const dir = join(parentDir, "f5-empty-dir");
  mkdirSync(dir, { recursive: true });
  writeSkillMd(dir, "f5-empty-dir", "F5 empty dir fixture.");
  writeFileSync(join(dir, "only.txt"), "only file\n");
  mkdirSync(join(dir, "empty-nested", "deeper"), { recursive: true });
  return dir;
}

function buildF6Excluded(parentDir: string): string {
  const dir = join(parentDir, "f6-excluded");
  mkdirSync(dir, { recursive: true });
  writeSkillMd(dir, "f6-excluded", "F6 excluded fixture.");
  writeFileSync(join(dir, "kept.txt"), "kept\n");
  mkdirSync(join(dir, ".git", "objects"), { recursive: true });
  writeFileSync(join(dir, ".git", "objects", "abc"), "git blob\n");
  mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "nm file\n");
  return dir;
}

function buildF7Combined(parentDir: string): string {
  const dir = join(parentDir, "f7-combined");
  mkdirSync(dir, { recursive: true });
  // 收据 F7：SKILL.md 82B（description 28 字符不可反推）→ 按模式重钉
  writeSkillMd(dir, "f7-combined", "F7 combined fixture.");
  writeFileSync(join(dir, "apple.txt"), "B\n");
  writeFileSync(join(dir, "Zebra.txt"), "A\n");
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "scripts", "run.sh"), "run\n");
  writeFileSync(join(dir, "scripts", "target.txt"), "target\n");
  mkdirSync(join(dir, "参考"), { recursive: true });
  writeFileSync(join(dir, "参考", "指南.md"), "zh\n");
  symlinkSync(join("scripts", "target.txt"), join(dir, "link-file"), "file");
  symlinkSync("scripts", join(dir, "link-dir"), "dir");
  mkdirSync(join(dir, "empty-dir"), { recursive: true });
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, ".git", "config"), "git\n");
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "x.js"), "nm\n");
  return dir;
}

/** 收据 §2 的七个 fixture，目录名即安装逻辑名 */
export const HASH_FIXTURES: readonly FixtureSpec[] = [
  { dirName: "f1-baseline", build: buildF1Baseline },
  { dirName: "f2-unicode", build: buildF2Unicode },
  { dirName: "f3-case", build: buildF3Case },
  { dirName: "f4-symlink", build: buildF4Symlink },
  { dirName: "f5-empty-dir", build: buildF5EmptyDir },
  { dirName: "f6-excluded", build: buildF6Excluded },
  { dirName: "f7-combined", build: buildF7Combined },
];

/** 在 parentDir 下构建全部 fixture，返回 { dirName -> skillDir } */
export function buildAllHashFixtures(parentDir: string): Map<string, string> {
  const built = new Map<string, string>();
  for (const spec of HASH_FIXTURES) {
    built.set(spec.dirName, spec.build(parentDir));
  }
  return built;
}
