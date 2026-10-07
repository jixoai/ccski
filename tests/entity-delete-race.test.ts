/**
 * 文件意图（2026-10-07）
 * 用户原始需求 [2026-10-07]：「宿主 revision 检查与内核删除之间存在数据丢失竞态……
 * 增加调用前注入改写的确定性竞态测试」（Codex 宿主迁移终审 P0-3）
 * 正交意图：
 *   [1] 调用前注入改写的确定性竞态（deleteEntity 与末投影 GC 两路径）：宿主语义
 *       调用方先读 revision（校验时刻）→ 实体内容被并发改写/换体 → 再调删除 →
 *       typed GUARD_ENTITY（deleteEntity）/ GC 拒绝销毁（GC 路径）；实体、改写
 *       内容、state 记录、（deleteEntity 路径）generation 全部原样
 *   [2] 销毁窗口第二道守卫（entity-disk-guard）单元收据：SKILL.md rename 换体
 *       （目录 inode 不变）/ SKILL.md 原位改写（inode 不变、字节变）/ 实体目录换
 *       inode / 路径消失 / symlink 换体 五形态的 pin-verify 判定
 * 妥协声明：「重算 revision → 物理销毁」窗口内的注入无确定性 seam（commitTransform
 * 无钩子），由 [2] 的守卫单元收据 + destroyGuardedEntity 代码路径（verify → rehash
 * → rm）核对覆盖；全部真磁盘 fixture（真 rename/writeFileSync/rm 构造），不 mock fs。
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { openEntityDiskGuard } from "../src/api/entity-disk-guard.js";
import {
  deleteEntity,
  ensureEntity,
  projectEntity,
  removeEntityProjections,
} from "../src/api/index.js";
import {
  cleanupSandbox,
  makeSandbox,
  readState,
  scopeOpts,
  writeSkillSource,
  type Sandbox,
} from "./helpers/kernel-fixtures.js";

async function setupEntity(
  sandbox: Sandbox,
  name: string
): Promise<{ entityPath: string; revision: string }> {
  const source = writeSkillSource(sandbox.workspace, name, "v1\n");
  const created = await ensureEntity({
    scope: "project",
    source: { dir: source },
    ...scopeOpts(sandbox),
  });
  expect(created.kind).toBe("ok");
  if (created.kind !== "ok") throw new Error(`setup failed: ${created.kind}`);
  return { entityPath: join(sandbox.entityRoot, name), revision: created.entity.revision };
}

describe("P0-3 确定性竞态：删除内核绑定磁盘实体 revision", () => {
  describe("deleteEntity 路径（调用前注入改写）", () => {
    it("宿主校验后 SKILL.md 被原位改写 → GUARD_ENTITY；实体/改写内容/state 记录/generation 原样", async () => {
      const sandbox = makeSandbox("p03-del-rewrite", "project");
      const { entityPath, revision } = await setupEntity(sandbox, "alpha");
      const before = readState(sandbox.scopeBase);

      // 宿主语义：先读 revision（校验时刻）→ 实体内容被并发改写 → 再调真实删除
      const skillPath = join(entityPath, "SKILL.md");
      writeFileSync(skillPath, `${readFileSync(skillPath, "utf8")}\nhijacked\n`);

      const result = await deleteEntity({
        scope: "project",
        name: "alpha",
        expectedRevision: revision,
        ...scopeOpts(sandbox),
      });
      expect(result).toMatchObject({ kind: "error", code: "GUARD_ENTITY" });
      if (result.kind === "error") {
        expect(result.message).toContain("on-disk entity revision");
      }

      // 零磁盘副作用：被改写的实体内容未销毁；state 记录与 generation 原样
      expect(readFileSync(skillPath, "utf8")).toContain("hijacked");
      const after = readState(sandbox.scopeBase);
      expect(after.entities["alpha"]).toEqual(before.entities["alpha"]);
      expect(after.projections).toEqual(before.projections);
      expect(after.generation).toBe(before.generation);
      cleanupSandbox(sandbox);
    });

    it("实体目录被换体（新 inode、不同内容）→ GUARD_ENTITY；新目录不动", async () => {
      const sandbox = makeSandbox("p03-del-swapdir", "project");
      const { entityPath, revision } = await setupEntity(sandbox, "alpha");

      rmSync(entityPath, { recursive: true });
      mkdirSync(entityPath, { recursive: true });
      writeFileSync(join(entityPath, "SKILL.md"), "---\nname: alpha\n---\nreplacement body\n");
      writeFileSync(join(entityPath, "precious.txt"), "not mine to delete\n");

      const result = await deleteEntity({
        scope: "project",
        name: "alpha",
        expectedRevision: revision,
        ...scopeOpts(sandbox),
      });
      expect(result).toMatchObject({ kind: "error", code: "GUARD_ENTITY" });
      expect(readFileSync(join(entityPath, "precious.txt"), "utf8")).toBe("not mine to delete\n");
      expect(readState(sandbox.scopeBase).entities["alpha"]).toBeDefined();
      cleanupSandbox(sandbox);
    });

    it("实体路径被换成 symlink → GUARD_ENTITY；链与目标不动", async () => {
      const sandbox = makeSandbox("p03-del-symlink", "project");
      const { entityPath, revision } = await setupEntity(sandbox, "alpha");
      rmSync(entityPath, { recursive: true });
      const victim = join(sandbox.workspace, "victim");
      mkdirSync(victim, { recursive: true });
      writeFileSync(join(victim, "keep.md"), "keep\n");
      symlinkSync(victim, entityPath);

      const result = await deleteEntity({
        scope: "project",
        name: "alpha",
        expectedRevision: revision,
        ...scopeOpts(sandbox),
      });
      expect(result).toMatchObject({ kind: "error", code: "GUARD_ENTITY" });
      expect(lstatSync(entityPath).isSymbolicLink()).toBe(true);
      expect(readFileSync(join(victim, "keep.md"), "utf8")).toBe("keep\n");
      cleanupSandbox(sandbox);
    });

    it("无竞态基线：磁盘与记录一致 → 删除照常成功（守卫不误伤）", async () => {
      const sandbox = makeSandbox("p03-del-clean", "project");
      const { entityPath, revision } = await setupEntity(sandbox, "alpha");
      const ok = await deleteEntity({
        scope: "project",
        name: "alpha",
        expectedRevision: revision,
        ...scopeOpts(sandbox),
      });
      expect(ok).toMatchObject({ kind: "ok", directoryDeleted: true });
      expect(existsSync(entityPath)).toBe(false);
      expect(readState(sandbox.scopeBase).entities["alpha"]).toBeUndefined();
      cleanupSandbox(sandbox);
    });
  });

  describe("末投影 GC 路径（调用前注入改写）", () => {
    it("宿主校验后实体内容被改写 → 投影正常移除；GC 拒绝销毁实体（GC_ENTITY_DISK_GUARD warning）；实体/记录原样", async () => {
      const sandbox = makeSandbox("p03-gc-rewrite", "project");
      const { entityPath, revision } = await setupEntity(sandbox, "alpha");
      const rootA = join(sandbox.workspace, "agents-a", "skills");
      const projected = await projectEntity({
        scope: "project",
        name: "alpha",
        roots: [rootA],
        ...scopeOpts(sandbox),
      });
      expect(projected.kind).toBe("ok");
      const before = readState(sandbox.scopeBase);

      // 宿主语义：校验（读 revision）→ 改写实体 → 调 remove（末投影 → GC 评估）
      expect(revision.length).toBeGreaterThan(0);
      const skillPath = join(entityPath, "SKILL.md");
      writeFileSync(skillPath, `${readFileSync(skillPath, "utf8")}\nhijacked\n`);

      const ok = await removeEntityProjections({
        scope: "project",
        name: "alpha",
        roots: [rootA],
        ...scopeOpts(sandbox),
      });
      expect(ok.kind).toBe("ok");
      if (ok.kind !== "ok") throw new Error(`unexpected: ${ok.kind}`);

      // 投影 remove 本身成功（链摘除 + 记录退役）
      expect(ok.results[0]).toMatchObject({
        status: "removed",
        mode: "link",
        targetKind: "projection",
      });
      expect(existsSync(join(rootA, "alpha"))).toBe(false);
      // GC 拒绝销毁：实体内容/记录原样，warning 如实
      expect(ok.entityRemoved).toBe(false);
      expect(ok.gc.attempted).toBe(true);
      expect(ok.gc.entityDeleted).toBe(false);
      expect(ok.gc.warnings.join("\n")).toContain("GC_ENTITY_DISK_GUARD");
      expect(readFileSync(join(entityPath, "SKILL.md"), "utf8")).toContain("hijacked");
      const after = readState(sandbox.scopeBase);
      expect(after.entities["alpha"]).toEqual(before.entities["alpha"]);
      expect(after.projections).toEqual({});
      cleanupSandbox(sandbox);
    });

    it("实体目录被换体（新 inode）→ GC 同样拒绝销毁；新目录不动", async () => {
      const sandbox = makeSandbox("p03-gc-swapdir", "project");
      const { entityPath } = await setupEntity(sandbox, "alpha");
      const rootA = join(sandbox.workspace, "agents-a", "skills");
      const projected = await projectEntity({
        scope: "project",
        name: "alpha",
        roots: [rootA],
        ...scopeOpts(sandbox),
      });
      expect(projected.kind).toBe("ok");

      rmSync(entityPath, { recursive: true });
      mkdirSync(entityPath, { recursive: true });
      writeFileSync(join(entityPath, "SKILL.md"), "---\nname: alpha\n---\nreplacement\n");

      const ok = await removeEntityProjections({
        scope: "project",
        name: "alpha",
        roots: [rootA],
        ...scopeOpts(sandbox),
      });
      expect(ok.kind).toBe("ok");
      if (ok.kind !== "ok") throw new Error(`unexpected: ${ok.kind}`);
      expect(ok.entityRemoved).toBe(false);
      expect(ok.gc.entityDeleted).toBe(false);
      expect(ok.gc.warnings.join("\n")).toContain("GC_ENTITY_DISK_GUARD");
      expect(readFileSync(join(entityPath, "SKILL.md"), "utf8")).toContain("replacement");
      expect(readState(sandbox.scopeBase).entities["alpha"]).toBeDefined();
      cleanupSandbox(sandbox);
    });

    it("无竞态基线：末投影移除 GC 照常销毁实体（守卫不误伤）", async () => {
      const sandbox = makeSandbox("p03-gc-clean", "project");
      const { entityPath } = await setupEntity(sandbox, "alpha");
      const rootA = join(sandbox.workspace, "agents-a", "skills");
      const projected = await projectEntity({
        scope: "project",
        name: "alpha",
        roots: [rootA],
        ...scopeOpts(sandbox),
      });
      expect(projected.kind).toBe("ok");
      const ok = await removeEntityProjections({
        scope: "project",
        name: "alpha",
        roots: [rootA],
        ...scopeOpts(sandbox),
      });
      expect(ok.kind).toBe("ok");
      if (ok.kind !== "ok") throw new Error(`unexpected: ${ok.kind}`);
      expect(ok.entityRemoved).toBe(true);
      expect(ok.gc.entityDeleted).toBe(true);
      expect(existsSync(entityPath)).toBe(false);
      expect(readState(sandbox.scopeBase).entities["alpha"]).toBeUndefined();
      cleanupSandbox(sandbox);
    });
  });

  describe("entity-disk-guard 身份守卫单元（销毁窗口第二道判据）", () => {
    function makeEntityDir(parent: string): string {
      const dir = join(parent, "guard-entity");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), "---\nname: alpha\n---\nbody\n");
      return dir;
    }

    it("SKILL.md rename 换体（目录 inode 不变、路径 inode 变）→ verify 拒绝", () => {
      const sandbox = makeSandbox("p03-guard-rename", "project");
      const dir = makeEntityDir(sandbox.workspace);
      const opened = openEntityDiskGuard(dir);
      expect(opened.kind).toBe("pinned");
      if (opened.kind !== "pinned") throw new Error("unreachable");
      const swap = join(dir, "SKILL.md.next");
      writeFileSync(swap, "---\nname: alpha\n---\nswapped\n");
      renameSync(swap, join(dir, "SKILL.md"));
      const verdict = opened.handle.verify(dir);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toContain("identity file");
      opened.handle.close();
      cleanupSandbox(sandbox);
    });

    it("SKILL.md 原位改写（inode 不变、字节变）→ verify 拒绝（fd digest 判据）", () => {
      const sandbox = makeSandbox("p03-guard-inplace", "project");
      const dir = makeEntityDir(sandbox.workspace);
      const opened = openEntityDiskGuard(dir);
      expect(opened.kind).toBe("pinned");
      if (opened.kind !== "pinned") throw new Error("unreachable");
      const skillPath = join(dir, "SKILL.md");
      const identityIno = lstatSync(skillPath).ino;
      writeFileSync(skillPath, `${readFileSync(skillPath, "utf8")}\nin-place edit\n`);
      expect(lstatSync(skillPath).ino).toBe(identityIno); // 构造自证：inode 未变
      const verdict = opened.handle.verify(dir);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toContain("content changed");
      opened.handle.close();
      cleanupSandbox(sandbox);
    });

    it("实体目录换 inode（rm + 同名重建）→ verify 拒绝；目录消失 → present:false 不拒", () => {
      const sandbox = makeSandbox("p03-guard-dirino", "project");
      const dir = makeEntityDir(sandbox.workspace);
      const opened = openEntityDiskGuard(dir);
      expect(opened.kind).toBe("pinned");
      if (opened.kind !== "pinned") throw new Error("unreachable");
      const original = opened.handle.identity;
      rmSync(dir, { recursive: true });
      const vanished = opened.handle.verify(dir);
      expect(vanished).toMatchObject({ ok: true, present: false });
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), "---\nname: alpha\n---\nbody\n");
      const rebuilt = opened.handle.verify(dir);
      expect(rebuilt.ok).toBe(false);
      if (!rebuilt.ok) expect(rebuilt.reason).toContain("entity directory was replaced");
      expect(original.dir.ino).toBeGreaterThan(0); // 构造自证：身份判据非退化
      opened.handle.close();
      cleanupSandbox(sandbox);
    });

    it("干净路径 verify 通过；symlink/非目录/缺 SKILL.md → open refused；缺席 → absent", () => {
      const sandbox = makeSandbox("p03-guard-open", "project");
      const dir = makeEntityDir(sandbox.workspace);
      const opened = openEntityDiskGuard(dir);
      expect(opened.kind).toBe("pinned");
      if (opened.kind !== "pinned") throw new Error("unreachable");
      expect(opened.handle.verify(dir)).toMatchObject({ ok: true, present: true });
      opened.handle.close();

      // 缺席 → absent（dangling：无内容可守卫）
      expect(openEntityDiskGuard(join(sandbox.workspace, "nope"))).toMatchObject({
        kind: "absent",
      });

      // symlink 换体 → refused
      const linked = join(sandbox.workspace, "linked-entity");
      symlinkSync(dir, linked);
      expect(openEntityDiskGuard(linked).kind).toBe("refused");

      // 缺身份源 → refused
      const noSkill = join(sandbox.workspace, "no-skill-md");
      mkdirSync(noSkill, { recursive: true });
      expect(openEntityDiskGuard(noSkill).kind).toBe("refused");
      cleanupSandbox(sandbox);
    });
  });
});
