# DonAron-plugin Architecture

This document defines the 5-module architecture approved in [2026-11-19-donaron-plugin-design.md](superpowers/specs/2026-11-19-donaron-plugin-design.md).

## 1. Dependency Graph (Acyclic)

```text
plugins/donaron-dev (source bundle — authored once in Phase 6)
        |
        v  validated, enforced, exported, and bridged by
   apps/cli (@donaron/cli)
     /    |    \
    v     v     v
@donaron/adapters   @donaron/gates
    \      |       /
     v     v      v
     @donaron/core  (zero internal or harness dependencies)
```

- **`@donaron/core`** must never depend on `@donaron/gates`, `@donaron/adapters`, `@donaron/cli`, or any harness-specific SDK.
- **`@donaron/gates`** depends only on `@donaron/core`.
- **`@donaron/adapters`** depends only on `@donaron/core` and `@donaron/gates`.
- **`@donaron/cli`** is a thin presentation and stdin/stdout hook bridge over `@donaron/core`, `@donaron/gates`, and `@donaron/adapters`.

## 2. Module Responsibilities

| Module                | Ownership                                                                                                                                                                                                                                                       | Token Cost Model        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `packages/core`       | Universal plugin manifest v1 JSON Schema (Ajv), path-safe loader, skill/agent/rule/hook parsers, fail-closed deterministic policy engine, secret-redacting logger.                                                                                              | 0 LLM tokens            |
| `packages/gates`      | Scoped content hashing (`planHash` + `codeHash`), immutable Evidence Store, Gates 01–05 evaluators (compile/lint, secret scan + dependency audit, Vitest per-package coverage parser ≥70%, independent review checks), `strict` default workflow state machine. | 0 LLM tokens for checks |
| `packages/adapters`   | Versioned `HarnessAdapter` contract, Antigravity native exporter + camelCase hook translator, Claude Code exporter + hook translator, honest capability matrix (`NATIVE` / `EMULATED` / `PARTIAL` / `UNSUPPORTED` / `UNVERIFIED`).                              | 0 LLM tokens            |
| `apps/cli`            | `donaron` terminal commands (`doctor`, `plugin`, `export`, `adapter`, `workflow`, `gate`) and live stdin/stdout hook entrypoint (`donaron hook <harness> <event>`).                                                                                             | 0 LLM tokens            |
| `plugins/donaron-dev` | Single-source personal Node + React plugin: progressive `SKILL.md` skills, full 15-agent strict roster, compact rules (`<24 KB`), and declarative hook bindings.                                                                                                | Progressive LLM loading |

## 3. Core Enforcement & Trust Boundaries

1. **Host-integrated enforcement:** Antigravity and Claude Code execute LLM turns and native subagents; DonAron's hooks and CLI own workflow state, deterministic checks, policies, and evidence.
2. **Scoped hashing (`planHash` + `codeHash`):** Planning docs hash independently from code/test files so implementing code does not invalidate Gate 01, while any code or test edit invalidates Gates 02–05 until re-verified.
3. **Hook + TTY trust boundary:** `PreToolUse` blocks agent edits to `.donaron/**` and agent invocations of `donaron gate override`; human overrides require interactive terminal confirmation (`process.stdin.isTTY`) and an auditable reason (disallowed on Gate 03 critical security findings).
4. **Non-workflow repo safety:** When globally enabled in a repo without an active `.donaron` workflow, `PreToolUse` enforces global hazard guards (`.env`/keys, destructive commands, out-of-workspace writes) while `Stop` remains non-blocking.
5. **Honest isolation disclosure:** Node.js is not an OS/container security sandbox; DonAron enforces policy guards at the hook/CLI boundary and never claims sandbox isolation unless implemented and verified.
