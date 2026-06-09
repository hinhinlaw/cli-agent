# Sum Negative Branch Bug Fixture

This fixture is intentionally broken for Agent Loop testing.

It mirrors the article example:

```text
expected 4, received 3
```

## Commands

From the repository root:

```bash
npx tsc -p .trellis/tasks/06-09-build-harness-00-08-minimal-agent-loop/research/fixtures/sum-negative-branch-bug/tsconfig.json
node --test .trellis/tasks/06-09-build-harness-00-08-minimal-agent-loop/research/fixtures/sum-negative-branch-bug/dist/sum.test.js
```

## Expected Failure

The failing case is:

```ts
sum(-1, 5)
```

The correct result is `4`, but the broken negative branch returns `3`.

## Intended Fix

In `src/sum.ts`, remove the special negative branch or make it return `a + b`.
