/**
 * @file git-url-parser.ts
 * @description 用于解析各种 Git 托管服务（GitHub, GitLab, Bitbucket 等）的 Web 链接，
 *              提取仓库地址、分支名称和文件路径。
 */

/**
 * 解析结果接口
 */
export interface GitUrlParseResult {
  /**
   * 归一化的仓库 Clone 地址
   * 格式: protocol://host/path/to/repo.git
   */
  repo: string;

  /**
   * 分支名称 (Commit Hash 或 Tag)
   * 注意：对于静态解析，默认取锚点后的第一段路径
   */
  branch?: string;

  /**
   * 文件或目录在仓库中的相对路径
   */
  path?: string;

  /**
   * 资源类型
   * 'blob': 具体文件
   * 'tree': 目录（仓库根目录也被视为 tree）
   */
  type: "blob" | "tree";
}

/**
 * 内部辅助函数：标准化仓库 URL
 * 1. 去除尾部斜杠
 * 2. 确保以 .git 结尾
 */
function normalizeRepoUrl(origin: string, path: string): string {
  // 去除路径末尾的斜杠
  let cleanPath = path.replace(/\/+$/, "");

  // 防止重复添加 .git (例如原路径已经是 repo.git)
  if (cleanPath.endsWith(".git")) {
    cleanPath = cleanPath.slice(0, -4);
  }

  return `${origin}${cleanPath}.git`;
}

/**
 * Git URL 嗅探与解析器
 *
 * @param inputUrl 用户输入的任意 URL 字符串
 * @returns 解析结果对象，如果 URL 无效则返回 null
 */
export function parseGitUrl(inputUrl: string | null | undefined): GitUrlParseResult | null {
  // --- 1. 基础防呆检查 ---
  if (!inputUrl || typeof inputUrl !== "string" || !inputUrl.trim()) {
    return null;
  }

  try {
    const url = new URL(inputUrl.trim());

    // 只处理 HTTP/HTTPS 协议
    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    // --- 2. 路径归一化 (关键步骤) ---
    // 将连续的斜杠替换为单斜杠，解决用户输入如 "//user//repo" 造成的解析错误
    const normalizedPath = url.pathname.replace(/\/+/g, "/");

    // 如果只有域名没有路径，视为无效
    if (normalizedPath === "/" || normalizedPath === "") {
      return null;
    }

    // --- 3. 定义解析策略 ---
    // pattern: URL 中的分割关键字
    // type: 对应的资源类型
    const strategies = [
      { pattern: "/-/blob/", type: "blob" as const }, // GitLab Specific
      { pattern: "/-/tree/", type: "tree" as const }, // GitLab Specific
      { pattern: "/src/", type: "blob" as const }, // Bitbucket
      { pattern: "/blob/", type: "blob" as const }, // GitHub / General
      { pattern: "/tree/", type: "tree" as const }, // GitHub / General
    ];

    // --- 4. 寻找最左锚点 (Leftmost Anchor) ---
    // 我们必须找到在 URL 中 *最早出现* 的关键字。
    // 这能避免 "/blob/main/src/code.ts" 被错误地在 /src/ 处切分。

    let bestStrategy = null;
    let minIndex = Infinity;

    for (const strategy of strategies) {
      const index = normalizedPath.indexOf(strategy.pattern);
      if (index !== -1 && index < minIndex) {
        minIndex = index;
        bestStrategy = strategy;
      }
    }

    // --- 5. 切分仓库与路径 ---
    let repoPathPart = "";
    let remainingPart = "";
    let type: "blob" | "tree" = "tree"; // 默认为目录模式

    if (bestStrategy && minIndex !== Infinity) {
      // 命中策略：切分 Repo 和 File Path
      type = bestStrategy.type;
      repoPathPart = normalizedPath.substring(0, minIndex);
      remainingPart = normalizedPath.substring(minIndex + bestStrategy.pattern.length);
    } else {
      // 未命中策略：视为仓库根目录
      repoPathPart = normalizedPath;
      type = "tree";
    }

    // 二次检查：如果切割后的 repo 部分为空，说明 URL 结构异常
    if (!repoPathPart || repoPathPart === "/") {
      return null;
    }

    const result: GitUrlParseResult = {
      repo: normalizeRepoUrl(url.origin, repoPathPart),
      type: type,
    };

    // --- 6. 提取分支与文件路径 ---
    if (remainingPart) {
      // 分割路径，解码 URI 字符 (如 %20)，并过滤空段
      const segments = remainingPart
        .split("/")
        .map((s) => {
          try {
            return decodeURIComponent(s);
          } catch {
            return s;
          }
        })
        .filter(Boolean);

      if (segments.length > 0) {
        // 约定：锚点后的第一段为分支名
        // (静态解析无法处理 "feature/login" 这种含斜杠的分支，只能取 "feature")
        result.branch = segments[0];

        // 剩余部分重新组合为文件路径
        if (segments.length > 1) {
          result.path = segments.slice(1).join("/");
        }
      } else {
        // 边界情况：URL 包含 /blob/ 但后面没有内容 (e.g. ".../blob/")
        // 这种情况下，降级为 tree 模式，且不设置 branch
        result.type = "tree";
      }
    } else if (bestStrategy) {
      // 命中了策略关键字，但后面完全是空字符串
      result.type = "tree";
    }

    return result;
  } catch (error) {
    // 捕获 new URL() 可能抛出的异常 (针对极端的非 URL 字符串)
    return null;
  }
}
