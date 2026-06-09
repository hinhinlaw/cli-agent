# 00-06 研究笔记：手写 Agent 的意义

## 核心结论

框架解决的是常见路径的效率问题。手写解决的是隐藏边界的理解问题。

手写 Agent 不是为了替代框架，而是为了知道框架抽象到哪里为止、自己的 Harness 应该从哪里开始。

## 为什么手写

如果没有手写过最小机制，就很难判断框架帮你省掉的是重复劳动，还是替你隐藏了关键边界。

手写不是目标，判断力才是目标。

## 框架解决什么

框架通常能解决大量重复劳动：

- 包装模型 API。
- 维护 messages。
- 实现 loop。
- 定义工具 schema。
- 解析 tool call。
- 执行工具。
- 回填工具结果。
- 处理流式输出。
- 处理错误重试。
- 记录状态。
- 限制最大轮次。
- 请求用户确认。

这些能力有价值，但不等于框架自动替你完成边界选择。

## 顺风 demo 和真实任务之间的四个坑

### 工具失控

模型把“能调用”理解成“应该调用”。需要工具可见性、风险分类和权限策略。

### 上下文爆炸

工具结果比推理更快填满窗口。需要 Context Builder 和结果截断/摘要策略。

### 权限审批

多问用户不等于更安全。审批需要风险建模，不是机械弹窗。

### 评估回归

最终答案对了，不代表 Harness 没坏。Eval 要看 trajectory，判断是否用了危险工具、是否缺少验证、是否丢失关键 observation。

## 手写最小 Agent 的边界

手写最小 Agent 不是手写完整框架。

目标是只摸承重点，不做大平台：

- `Model output -> Intent`
- `Loop -> State transition`
- `Tools -> Protocol boundary`
- `Messages -> Context projection`
- `Eval -> Trajectory attribution`

这些点用于显影框架隐藏的默认值。

## 最小手写路线图

文章给出的后续路线：

1. Provider 只是模型适配层。
2. Loop 只处理 final 和 tool intent。
3. Tool Runtime 只接三个工具。
4. State 先从 event log 折叠出来。
5. Context Builder 不等于 messages。
6. Permission 先做三档。
7. Verification Gate 禁止模型空口宣布完成。

这条路线直接约束后续实现顺序。

## 后续代码落点

本章只确定后续章节会逐步长出的文件：

- `protocol.ts`
- `message.ts`
- `model.ts`
- `mockModel.ts`
- `loop.ts`
- `tools.ts`
- `sessionStore.ts`

这些文件不追求完整，而是让读者看到框架平时隐藏的决定：消息怎么建模、tool intent 怎么回填、错误是不是 observation、session 从哪里恢复。

## 下一篇边界

下一篇正式进入代码侧第一步：

```text
LLM Provider 接入：让 CLI 完成第一次模型调用
```

Provider 的第一条边界是：只负责模型调用，不负责执行工具，不负责管理任务世界。
