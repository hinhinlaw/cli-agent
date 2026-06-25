import type { PluginManifest } from "../core/contracts.js";

const VALID_HOOK_POINTS = ["preToolUse"];

export interface ManifestValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * 校验插件的 manifest 声明。
 * 规则：
 * - 缺少 id → 失败
 * - 缺少 version / 非法 version（非 semver 简单检查）→ 失败
 * - 声明未知 hook point → 失败
 * - 声明危险权限 → 警告（后续由策略层决定是否禁用）
 */
export function validateManifest(manifest: unknown): ManifestValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(manifest)) {
    return { ok: false, errors: ["Manifest must be an object."], warnings: [] };
  }

  // id — 必填
  const id = manifest.id;
  if (typeof id !== "string" || id.trim().length === 0) {
    errors.push("Manifest must have a non-empty 'id' field.");
  }

  // name — 必填
  const name = manifest.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    errors.push("Manifest must have a non-empty 'name' field.");
  }

  // version — 必填，简单 semver 检查
  const version = manifest.version;
  if (typeof version !== "string" || !isSemverLike(version)) {
    errors.push(`Manifest 'version' must be a valid semver string, got: ${JSON.stringify(version)}.`);
  }

  // contributes.hooks — 检查是否声明了未知 hook point
  const contributes = manifest.contributes;
  if (isRecord(contributes)) {
    const hooks = contributes.hooks;
    if (Array.isArray(hooks)) {
      for (const hook of hooks) {
        if (typeof hook === "string" && !VALID_HOOK_POINTS.includes(hook)) {
          errors.push(`Unknown hook point "${hook}". Valid hook points: ${VALID_HOOK_POINTS.join(", ")}.`);
        }
      }
    }
  }

  // permissions — 检查危险权限声明
  const permissions = manifest.permissions;
  if (Array.isArray(permissions)) {
    for (const perm of permissions) {
      if (isRecord(perm) && typeof perm.capability === "string") {
        if (["shell", "network"].includes(perm.capability)) {
          warnings.push(
            `Plugin "${id ?? "(unknown)"}" declares potentially dangerous permission: "${perm.capability}".`
          );
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 简单 semver 检查：x.y.z 格式，允许 pre-release 后缀
 */
function isSemverLike(version: string): boolean {
  // 至少匹配 "1.0.0" 格式，允许 pre-release 如 "0.1.0-beta"
  return /^\d+\.\d+\.\d+([-+].+)?$/.test(version);
}
