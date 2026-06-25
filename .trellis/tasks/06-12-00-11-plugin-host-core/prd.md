# 00-11 Plugin Host：让外部能力按规则进入 Core

## Goal

将当前 M0 中直接硬编码在 `main.ts` 和 `AgentRuntime` 里的 provider/tools/hooks，重构为通过 Plugin Host 以 contribution 形式进入系统。core 不再直接认识具体能力，只认识稳定的 contract。

## 文章核心命题

> 外部能力如何进入 core，同时不把 core 变成能力垃圾桶？

```
M0 core 可以直接内置 provider、tool、hook
→ 能力一多，core 会被具体模型、具体工具、具体策略污染
→ 污染后的 core 很难测试、很难替换、很难治理
→ 需要让外部能力以插件形式进入系统
→ 插件不能直接改 core，只能声明能力和生命周期
→ Plugin Host 负责加载、校验、注册、启动、停止插件
→ Registry 把外部能力转成内部统一 contract
→ Hook Kernel 把扩展点变成受控阻断点
→ 插件贡献能力，后续执行仍然进入 00-10 的运行时管线
```

解决思路：**插件只提交 contribution（候选能力），不拿执行权。Host 负责把 contribution 注册进系统。**

## 当前状态（M0 膨胀点）

| 膨胀点 | 现在在哪 | 问题 |
|---|---|---|
| Provider 选择 | `main.ts` 里 `loadProviderConfig()` → `new OpenAIProvider()` | 换模型要碰 core 入口 |
| 工具定义 | `main.ts` 里 `realM0Tools` 数组 | 加工具要改 core 文件 |
| 权限函数 | `main.ts` 里 `cliApprover()` | 改策略要碰 core |
| Hook 逻辑 | 无 | 想加 preToolUse 检查无从插入 |

## 五个核心部件

| 部件 | 文章章节 | 一句话职责 |
|---|---|---|
| **Manifest** | 第五章 | 插件必须先声明自己是谁、想贡献什么 |
| **Loader** | 第六章 | 加载不是 require 一下，要校验、检查、记录来源 |
| **Registry** | 第七章 | 把外部能力变成统一的内部 contract |
| **Lifecycle** | 第八章 | 插件不是静态配置，是活的，有状态机 (loaded → ready → failed) |
| **Hook Kernel** | 第九章 | 不是事件监听，是结构化的阻断 gate |

关系：**Manifest 让插件自我说明 → Loader 读出来判断资格 → Lifecycle 管理启停 → Registry 转成统一对象 → Hook Kernel 把扩展点变成受控阻断点。**

## 三个核心设计原则

### 1. 插件只提交 contribution，不拿执行权

```typescript
// ❌ 禁止
plugin.activate(core);

// ✅ 正确
type Plugin = {
  manifest: PluginManifest;
  setup(ctx: PluginSetupContext): Promise<PluginContribution>;
};
type PluginContribution = {
  providers?: ProviderContribution[];
  tools?: ToolContribution[];
  hooks?: HookContribution[];
};
```

### 2. 三个"不等于"

```text
registered  ≠  visible       (注册了不一定要给模型看)
visible     ≠  executable    (可见不一定要能执行，还要过审批)
executable  ≠  可绕过审计   (执行了必须进 event log)
```

### 3. Manifest 是声明，setup 是受限初始化，execution 归 Tool Runtime

```text
manifest    →  静态声明（声明前不能运行代码）
setup       →  受限初始化（只能读配置、建立连接，不能执行工具、不能改 session）
execution   →  仍然走 00-10 的五阶段管线（validate → approve → execute → observe）
```

## 三类 Contribution 转成内部 Contract

**Provider Contribution**：进入 registry 后变成 `LlmProvider`。
**Tool Contribution**：进入 registry 后变成 `ToolDefinition` + `ToolExecutor`。
**Hook Contribution**：进入 HookKernel，返回结构化 `HookDecision`。

```typescript
type HookDecision =
  | { type: "allow"; reason?: string }
  | { type: "deny"; reason: string }
  | { type: "ask"; question: string; risk: RiskLevel }
  // amend 类型 M1 不做，文章明确延后
```

## Decisions（ADR-lite）

### D1: AgentRuntime 依赖注入方式

**Decision**: 传入 `registry` + `hookKernel` 两个独立对象，不传整个 `PluginHost`。

**Rationale**: PluginHost 的职责是"加载"（一次性），Registry + HookKernel 的职责是"查询"（持续使用）。AgentRuntime 只需要仓库，不需要知道能力是怎么加载进来的。与文章伪代码一致。

```typescript
// main.ts 装配
const registry = new CapabilityRegistry();
const hookKernel = new HookKernel();
const host = new PluginHost(registry, hookKernel);

await host.load(builtinOpenAI);
await host.load(builtinLocalTools);
await host.load(builtinPolicy);

const runtime = new AgentRuntime({ registry, hookKernel, model, systemPrompt });
```

### D2: 文件结构按文章重建

```text
src/
  core/              ← 重组织现有 runtime 代码
    contracts.ts
    runtime.ts        ← 现有 agent-runtime.ts
    events.ts         ← 现有 event-bus.ts
    registry.ts       ← 新增
  plugins/            ← 新增
    host.ts           ← PluginHost
    manifest.ts       ← 校验
    lifecycle.ts      ← 状态管理
    hook-kernel.ts    ← HookKernel
    builtin/
      provider-openai.ts
      local-tools.ts
      policy.ts
  cli/
    main.ts           ← 桥接层
  providers/          ← 保留，openai.ts 不变
```

### D3: 测试策略 — 关键路径优先

- MVP 写：贯穿测试（fake plugin 端到端）+ manifest 校验测试
- 后续补：registry 隔离、hook gate、事件日志测试

## Requirements

1. **Contracts** — PluginManifest、PluginContribution、ProviderContribution、ToolContribution、HookContribution、HookDecision、PluginSource 等类型定义
2. **Manifest 校验** — 缺 id 失败、非法 version 失败、声明未知 hook point 失败、声明危险权限但策略不允许时 disabled
3. **Registry** — 登记 provider/tool/hook，记录来源插件（source plugin），处理同名冲突（完整 id 不冲突），禁用插件后能力不可见
4. **PluginHost.load()** — manifest 校验 → createSetupContext → plugin.setup(ctx) → 遍历 contribution 注册到 registry/hookKernel → 记录 plugin.loaded / plugin.ready 事件
5. **HookKernel.runPreToolUse()** — 按 order 排序 hooks → 超时处理 → 遇到 deny/ask 停止 → 默认 allow
6. **Lifecycle** — 简化状态机：loaded → ready → failed，记录 plugin.loaded / plugin.ready / plugin.failed 事件
7. **错误隔离** — setup 失败 → plugin.failed，不注册 contribution；注册中途失败 → 撤销已注册 contribution；单个工具失败不杀 loop
8. **Builtin 插件** — 三个 builtin 插件搬家：provider-openai (OpenAIProvider)、local-tools (bash/read_file/edit_file)、policy (cliApprover → preToolUse hook)
9. **main.ts 桥接层** — 装配 PluginHost + 加载 builtin 插件 → 创建 AgentRuntime → 运行 loop

## Acceptance Criteria

- [ ] 现有功能（`--loop "请帮我运行 npm run test:sum并修复报错"`）通过插件架构仍然正常工作
- [ ] 贯穿测试：fake provider 提出 intent → fake policy hook allow → fake tool 执行 → observation 回到下一轮 → 完成
- [ ] manifest 校验：缺 id 失败、非法 version 失败、未知 hook point 失败
- [ ] preToolUse hook gate：allow 时 tool runtime 继续执行、deny 时 execution 不发生、ask 时暂停等待确认
- [ ] 插件加载事件写入 EventBus（plugin.loaded / plugin.ready / plugin.failed）

## Definition of Done

- TypeScript 编译通过
- 现有测试通过
- 贯穿测试 + manifest 校验测试通过

## Implementation Order

```
① Contracts 类型定义（所有代码的骨架）
  └─→ ② Manifest 校验（独立，只依赖 contracts）
       └─→ ③ Registry（独立，只依赖 contracts）
            └─→ ④ HookKernel（独立，只依赖 contracts）
                 └─→ ⑤ PluginHost.load()（依赖 ②③④）
                      └─→ ⑥ Builtin 插件（依赖 ①，搬家现有代码）
                           └─→ ⑦ main.ts 桥接层（依赖 ⑤⑥，串联验证）
                                └─→ ⑧ 贯穿测试
```

## Out of Scope（文章明确延后）

| 延后事项 | 文章位置 |
|---|---|
| `amend` 类型的 hook decision | 第九章、第十七节 |
| project/user/enterprise 插件（只做 builtin + test fake） | 第六章 |
| Context Policy / Capability Discovery | 第十四节，留给第 17 篇 |
| 完整 8 状态 lifecycle（MVP 用 loaded/ready/failed 三个状态） | 第八章 |
| postToolUse observer hook | 第十一节 |
| 插件签名 / sandbox / allowlist | 第六章 |
| contextProject hook | 第十一节 |

## Technical Notes

- 当前代码入口：`src/cli/main.ts`、`src/runtime/agent-runtime.ts`、`src/providers/openai.ts`
- 现有测试：`src/runtime/agent-runtime.test.ts`、`src/providers/openai.test.ts`、`src/cli/main.test.ts`
- 参考博客：`/Applications/study/ai/learn-agent/src/content/blog/zh/AI/build-harness/00-11-plugin-host-core-extension.md`
- 文章伪代码：第十五节 `PluginHost.load()` + `HookKernel.runPreToolUse()`
- 前序文档：`.trellis/tasks/06-11-00-10-intent-execution/research/code-flow-trace-sum-fix.md`（代码流追踪）
