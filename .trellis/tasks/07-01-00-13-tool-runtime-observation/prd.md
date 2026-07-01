## 00-13 Tool Runtime: Observation 改造

### 目标
1. Observation 从 {content: string} 重构为富结构（ok/phase/modelText/userText/details/sideEffects）
2. 新增最小 Scheduler（全部串行）+ Sandbox（cwd 限制 + timeout）
3. 三个 executor 产出富 observation
4. handleToolIntent 在所有阶段失败时产结构化 observation

### 变更清单
1. contracts.ts — Observation/ToolPhase 类型重构
2. scheduler.ts — 新增串行调度器
3. sandbox.ts — 新增工作目录+timeout沙箱
4. tool-runtime.ts — 加 scheduler/sandbox，所有阶段统一产 observation
5. bash.ts / read-file.ts / edit-file.ts — 富 observation
6. agent-runtime.ts — 适配新 Observation 结构
7. 所有测试文件 — 适配
