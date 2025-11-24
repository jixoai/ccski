import { describe, expect, it } from "vitest";
import { parseGitUrl } from "./git-url-parser";

describe("parseGitUrl - Git URL 嗅探器测试", () => {
  // =================================================================
  // 1. GitHub 风格 (Standard / Gitea / Localhost)
  // =================================================================
  describe("GitHub Style (Standard & Proxy)", () => {
    it("应解析标准的 GitHub 文件链接 (Blob)", () => {
      const url = "https://github.com/wshobson/agents/blob/main/.claude-plugin/marketplace.json";
      const result = parseGitUrl(url);

      expect(result).toEqual({
        repo: "https://github.com/wshobson/agents.git",
        branch: "main",
        path: ".claude-plugin/marketplace.json",
        type: "blob",
      });
    });

    it("应解析标准的 GitHub 目录链接 (Tree)", () => {
      const url = "https://github.com/facebook/react/tree/main/packages/react-dom";
      const result = parseGitUrl(url);

      expect(result).toEqual({
        repo: "https://github.com/facebook/react.git",
        branch: "main",
        path: "packages/react-dom",
        type: "tree",
      });
    });

    it("应解析 Localhost 代理下的 GitHub 风格链接", () => {
      // 你的特定需求场景
      const url = "https://localhost:23456/wshobson/agents/blob/main/readme.md";
      const result = parseGitUrl(url);

      expect(result).toEqual({
        repo: "https://localhost:23456/wshobson/agents.git",
        branch: "main",
        path: "readme.md",
        type: "blob",
      });
    });

    it("应解析仓库根目录 (无分支/路径)", () => {
      const url = "https://github.com/microsoft/TypeScript";
      const result = parseGitUrl(url);

      expect(result).toEqual({
        repo: "https://github.com/microsoft/TypeScript.git",
        branch: undefined,
        path: undefined,
        type: "tree",
      });
    });

    it("即使输入带有 .git 后缀，repo 字段也不应重复添加", () => {
      const url = "https://github.com/microsoft/TypeScript.git";
      const result = parseGitUrl(url);

      expect(result).toEqual({
        repo: "https://github.com/microsoft/TypeScript.git",
        branch: undefined,
        path: undefined,
        type: "tree",
      });
    });
  });

  // =================================================================
  // 2. GitLab 风格 (Feature: /-/ separator)
  // =================================================================
  describe("GitLab Style (With /-/ anchor)", () => {
    it("应利用 /-/ 精确区分仓库路径和文件路径", () => {
      const url = "https://gitlab.com/gitlab-org/gitlab/-/blob/master/.gitignore";
      const result = parseGitUrl(url);

      expect(result).toEqual({
        repo: "https://gitlab.com/gitlab-org/gitlab.git",
        branch: "master",
        path: ".gitignore",
        type: "blob",
      });
    });

    it("应处理多级深层嵌套的私有部署 GitLab (代理场景)", () => {
      // 这里的重点是：仓库路径很长，但 /-/ 能准确定位
      const url = "https://git.internal.corp/dept/group/subgroup/project/-/tree/dev/src/config";
      const result = parseGitUrl(url);

      expect(result).toEqual({
        repo: "https://git.internal.corp/dept/group/subgroup/project.git",
        branch: "dev",
        path: "src/config",
        type: "tree",
      });
    });
  });

  // =================================================================
  // 3. Bitbucket 风格 (Feature: /src/)
  // =================================================================
  describe("Bitbucket Style", () => {
    it("应识别 /src/ 关键字", () => {
      const url = "https://bitbucket.org/atlassian/jira/src/master/package.json";
      const result = parseGitUrl(url);

      expect(result).toEqual({
        repo: "https://bitbucket.org/atlassian/jira.git",
        branch: "master",
        path: "package.json",
        type: "blob",
      });
    });
  });

  // =================================================================
  // 4. 鲁棒性与脏数据清洗 (Dirty Inputs)
  // =================================================================
  describe("Robustness & Sanitization", () => {
    it("应自动去除首尾空格", () => {
      const url = "  https://github.com/user/repo/blob/main/file  ";
      const result = parseGitUrl(url);
      expect(result?.repo).toBe("https://github.com/user/repo.git");
      expect(result?.branch).toBe("main");
    });

    it("应处理多重斜杠 (Double Slashes)", () => {
      // 用户手误输入了 //blob//
      const url = "https://github.com/user/repo///blob//main//src/file.ts";
      const result = parseGitUrl(url);

      expect(result).toEqual({
        repo: "https://github.com/user/repo.git",
        branch: "main",
        path: "src/file.ts", // 路径中的空段也应该被 filter 掉
        type: "blob",
      });
    });

    it("应正确解码 URL 编码字符 (中文/空格)", () => {
      // %E6%96%87%E6%A1%A3 = 文档, %20 = 空格
      const url = "https://github.com/user/repo/blob/main/%E6%96%87%E6%A1%A3/My%20File.txt";
      const result = parseGitUrl(url);

      expect(result?.path).toBe("文档/My File.txt");
    });
  });

  // =================================================================
  // 5. 边缘情况与已知限制 (Edge Cases)
  // =================================================================
  describe("Edge Cases", () => {
    it("只有 /blob/ 关键字但没有后续内容，应降级为 Tree 模式", () => {
      const url = "https://github.com/user/repo/blob/";
      const result = parseGitUrl(url);

      // 这种情况下，虽然有 blob，但无法提取 branch，视为查看仓库根
      expect(result).toEqual({
        repo: "https://github.com/user/repo.git",
        branch: undefined,
        path: undefined,
        type: "tree",
      });
    });

    it("路径中包含类似关键字的文件夹名 (歧义处理)", () => {
      // 路径里也有一个 blob 文件夹：/blob/main/src/blob/file.ts
      // 代码应匹配第一个 /blob/
      const url = "https://github.com/user/repo/blob/main/src/blob/file.ts";
      const result = parseGitUrl(url);

      expect(result).toEqual({
        repo: "https://github.com/user/repo.git",
        branch: "main",
        path: "src/blob/file.ts",
        type: "blob",
      });
    });

    it("分支名包含斜杠 (已知限制: 默认取第一段)", () => {
      // 实际分支: feature/login, 路径: src/ui
      const url = "https://github.com/user/repo/blob/feature/login/src/ui";
      const result = parseGitUrl(url);

      // 静态解析无法得知分支包含斜杠，这是预期行为
      expect(result).toEqual({
        repo: "https://github.com/user/repo.git",
        branch: "feature", // 被截断
        path: "login/src/ui", // 剩余部分
        type: "blob",
      });
    });
  });

  // =================================================================
  // 6. 无效输入处理 (Negative Testing)
  // =================================================================
  describe("Invalid Inputs", () => {
    it("非 URL 字符串应返回 null", () => {
      expect(parseGitUrl("not-a-url")).toBeNull();
    });

    it("不支持的协议 (ftp/file) 应返回 null", () => {
      expect(parseGitUrl("ftp://github.com/user/repo")).toBeNull();
      expect(parseGitUrl("file:///Users/me/repo")).toBeNull();
    });

    it("只有域名没有路径应返回 null", () => {
      expect(parseGitUrl("https://github.com")).toBeNull();
      expect(parseGitUrl("https://github.com/")).toBeNull();
    });

    it("空值应返回 null", () => {
      expect(parseGitUrl("")).toBeNull();
      // @ts-ignore 测试 JS 调用场景
      expect(parseGitUrl(null)).toBeNull();
      // @ts-ignore
      expect(parseGitUrl(undefined)).toBeNull();
    });
  });
});
