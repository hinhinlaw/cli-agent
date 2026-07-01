/**
 * M1 最小沙箱：工作目录限制 + 文件路径规范化。
 * 后续接系统级 sandbox 时保留此接口。
 */
export class Sandbox {
  readonly workspaceRoot: string;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot ?? process.cwd();
  }

  /** 校验路径在工作目录内，并返回规范化的绝对路径 */
  resolvePath(relativePath: string): string {
    const { join, resolve, sep } = require("node:path") as typeof import("node:path");

    // 将相对路径解析为绝对路径
    const absolute = resolve(this.workspaceRoot, relativePath);

    // 规范化、去除 ..
    const normalized = join(sep, absolute);
    const root = join(sep, resolve(this.workspaceRoot));

    if (!normalized.startsWith(root + sep) && normalized !== root) {
      throw new SandboxError(
        `Path "${relativePath}" escapes workspace root "${this.workspaceRoot}".`,
        "path_escape"
      );
    }

    return absolute;
  }

  /** 校验命令是否可在 sandbox 内执行 */
  validateCommand(_command: string): { ok: boolean; reason?: string } {
    // M1: 只做基本检查，禁止包含明显危险的模式
    // 后续接 shell 解析和命令 allowlist
    const blocked = ["sudo", "rm -rf /", ">/dev/sda"];
    for (const pattern of blocked) {
      if (_command.includes(pattern)) {
        return { ok: false, reason: `Command contains blocked pattern: "${pattern}".` };
      }
    }
    return { ok: true };
  }

  /** 获取沙箱内的环境变量 */
  getEnv(): Record<string, string> {
    // M1: 继承当前环境，后续在系统级沙箱中隔离
    return { ...process.env as Record<string, string> };
  }
}

export class SandboxError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "SandboxError";
    this.code = code;
  }
}
