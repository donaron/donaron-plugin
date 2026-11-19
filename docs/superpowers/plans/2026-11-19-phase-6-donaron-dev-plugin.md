# DonAron-plugin Phase 6 — Flagship Personal Node + React Plugin (`plugins/donaron-dev`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author, validate, export, and smoke-test the flagship personal Node.js + React plugin bundle in `plugins/donaron-dev/` — including the universal v1 `plugin.json` manifest, 6 progressive skills (`SKILL.md` + `references/`), the full 15-agent `strict` workflow roster, compact `< 24,000`-byte guidance rules, and declarative `hooks/hooks.json` lifecycle bindings — verified by `donaron plugin validate`, dual `donaron export` (Antigravity + Claude Code), and live hook bridge smoke tests.

**Architecture:** `plugins/donaron-dev/` is a pure declarative source bundle (no TypeScript build step) validated by `@donaron/core`'s `loadPlugin`, exported cleanly by `@donaron/adapters` (`AntigravityAdapter` and `ClaudeCodeAdapter`), and verified via `tests/e2e/donaron-dev-plugin.test.ts` + CLI `plugin validate` / `export` invocations. Work executes on branch `phase-6/donaron-dev-plugin` cut from `phase-5/cli-and-hooks` (`e8002af`).

**Tech Stack:** Universal DonAron Plugin v1 Schema (`schemas/donaron-plugin.v1.schema.json`), Markdown + YAML frontmatter, `@donaron/core`, `@donaron/adapters`, `@donaron/cli`, Vitest.

**Spec:** [2026-11-19-donaron-plugin-design.md](../specs/2026-11-19-donaron-plugin-design.md) (§6.6, §7 Phase 6)

---

## Global Constraints

- **Repository root:** `C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin`; work on branch `phase-6/donaron-dev-plugin` branched from `phase-5/cli-and-hooks` (`e8002af`).
- **Schema & Parser Compliance:** Every skill (`skills/<name>/SKILL.md`), agent (`agents/<name>.md`), rule (`rules/<name>.md`), and hook binding (`hooks/hooks.json`) must pass `@donaron/core`'s strict parsers with **zero** unknown frontmatter keys or broken references.
- **Token-Efficient Rules (< 24,000 bytes):** Compiled `rules/AGENTS.md` (via `compileRulesPlainMarkdown`) must stay well under Antigravity's `24,000`-byte hard cap (target `< 8,000` bytes).
- **15-Agent Strict Roster:** Include all 15 specialized roles from §6.6 of the design spec:
  - Planning (4): `requirements-gatherer`, `intake-reviewer`, `solutions-architect`, `planner`
  - Research (3): `explore`, `researcher`, `ask`
  - Build (5): `developer`, `developer-tester`, `devops`, `worker`, `general-purpose`
  - Verify (3): `reviewer`, `code-reviewer`, `qa`
- **6 Progressive Skills:** `node-react-planning`, `node-react-implement`, `node-react-testing`, `security-review`, `code-review`, `debugging` — each with concise `SKILL.md` and progressive `references/*.md` files.
- **Phase 6 Green Bar:** `donaron plugin validate plugins/donaron-dev`, dual `donaron export` (Antigravity + Claude Code), live hook stdin/stdout smoke tests on the exported bundle, and `pnpm run clean && pnpm run check` exit `0` with ≥70% coverage across all metrics.

## Review Focus

1. **Zero schema/parser errors and safe asset resolution:** `loadPlugin('plugins/donaron-dev')` and `donaron plugin validate` must pass with 0 issues across all 6 skills (plus references), 15 agents, 4 rules, and 4 lifecycle hooks — pinned by Task 4 tests.
2. **Antigravity 24 KB rule limit & native layout:** Exporting `plugins/donaron-dev` via `AntigravityAdapter` must produce `<outDir>/plugin.json` (allowed fields only), `<outDir>/hooks.json` at root, and `<outDir>/rules/AGENTS.md` strictly `< 24,000` bytes with zero YAML frontmatter — pinned by Task 4 tests.
3. **Claude Code native layout & modelTier mapping:** Exporting `plugins/donaron-dev` via `ClaudeCodeAdapter` must produce `.claude-plugin/plugin.json`, `hooks/hooks.json`, `CLAUDE.md`, and all 15 agents mapped to `haiku`/`sonnet`/`opus` — pinned by Task 4 tests.
4. **Live exported hook bridge smoke check:** Running `apps/cli/dist/cli.js hook <antigravity|claude-code> <SessionStart|PreToolUse|Stop>` using the exported bundle's hook events must enforce Choice 1A and Choice 2A cleanly — pinned by Task 4 tests.

---

## File Structure

```text
C:\Users\USER\.gemini\antigravity\scratch\donaron-plugin\
├── plugins/donaron-dev/
│   ├── package.json
│   ├── README.md
│   ├── plugin.json
│   ├── hooks/
│   │   └── hooks.json
│   ├── rules/
│   │   ├── routing.md
│   │   ├── security.md
│   │   ├── development.md
│   │   └── writing.md
│   ├── skills/
│   │   ├── node-react-planning/{SKILL.md, references/planning-checklist.md}
│   │   ├── node-react-implement/{SKILL.md, references/node-react-patterns.md}
│   │   ├── node-react-testing/{SKILL.md, references/vitest-testing-guide.md}
│   │   ├── security-review/{SKILL.md, references/owasp-checklists.md}
│   │   ├── code-review/{SKILL.md, references/review-rubric.md}
│   │   └── debugging/{SKILL.md, references/systematic-debugging.md}
│   └── agents/
│       ├── requirements-gatherer.md
│       ├── intake-reviewer.md
│       ├── solutions-architect.md
│       ├── planner.md
│       ├── explore.md
│       ├── researcher.md
│       ├── ask.md
│       ├── developer.md
│       ├── developer-tester.md
│       ├── devops.md
│       ├── worker.md
│       ├── general-purpose.md
│       ├── reviewer.md
│       ├── code-reviewer.md
│       └── qa.md
├── tests/e2e/
│   └── donaron-dev-plugin.test.ts
├── docs/superpowers/plans/
│   └── 2026-11-19-phase-6-donaron-dev-plugin.md
└── README.md
```

---

### Task 1: Branch Setup, Manifest (`plugin.json`), Declarative Hooks (`hooks/hooks.json`), and Compact Guidance Rules (`rules/*.md`)

- [ ] **Step 1:** Create branch `phase-6/donaron-dev-plugin` from `phase-5/cli-and-hooks` (`e8002af`).
- [ ] **Step 2:** Author `plugins/donaron-dev/plugin.json` declaring `manifestVersion: "1"`, `id: "donaron-dev"`, `name: "donaron-dev"`, `version: "0.1.0"`, `permissions: ["fs:read", "fs:write", "cmd:exec"]`, and all 6 skills, 15 agents, 4 rules, and `hooks/hooks.json`.
- [ ] **Step 3:** Author `plugins/donaron-dev/hooks/hooks.json` binding `SessionStart` (`session-context`), `PreToolUse` (`policy-guard`, `fail_closed`), `PostToolUse` (`stale-tracker`), and `Stop` (`gate-stop-guard`, `fail_closed`).
- [ ] **Step 4:** Author `plugins/donaron-dev/rules/{routing,security,development,writing}.md` with valid frontmatter (`id`, `category`, `scope`, `priority`) keeping total compiled rules well below `24,000` bytes.
- [ ] **Step 5:** Commit Task 1 (`feat(plugin): add donaron-dev manifest, lifecycle hooks, and compact guidance rules`).

---

### Task 2: 6 Progressive Node.js + React Skills (`skills/*/SKILL.md` + `references/*.md`)

- [ ] **Step 1:** Author `node-react-planning`, `node-react-implement`, `node-react-testing`, `security-review`, `code-review`, and `debugging` skills with strict schema frontmatter (`name`, `description`, `purpose`, `activation`, `inputs`, `outputs`, `constraints`, `completionCriteria`, `references`, `version`) and progressive `references/*.md` guides.
- [ ] **Step 2:** Commit Task 2 (`feat(plugin): add 6 progressive Node.js + React workflow skills and reference guides`).

---

### Task 3: Full 15-Agent Strict Roster (`agents/*.md`)

- [ ] **Step 1:** Author all 15 agent markdown files (`requirements-gatherer`, `intake-reviewer`, `solutions-architect`, `planner`, `explore`, `researcher`, `ask`, `developer`, `developer-tester`, `devops`, `worker`, `general-purpose`, `reviewer`, `code-reviewer`, `qa`) with strict YAML frontmatter (`name`, `role`, `description`, `responsibilities`, `nonResponsibilities`, `skills`, `tools`, `permissionProfile`, `modelTier`, `inputContract`, `outputContract`, `handoffConditions`, `maxRetries`, `requiresHumanApproval`) and concise role prompts.
- [ ] **Step 2:** Commit Task 3 (`feat(plugin): add complete 15-agent strict workflow roster to donaron-dev`).

---

### Task 4: Validation, Dual Export, Live Hook Smoke Tests (`tests/e2e/donaron-dev-plugin.test.ts`), Docs & Clean Green Check

- [ ] **Step 1:** Write `tests/e2e/donaron-dev-plugin.test.ts` verifying:
  - `loadPlugin('plugins/donaron-dev')` succeeds with 6 skills, 15 agents, 4 rules, and 4 hooks.
  - `donaron plugin validate plugins/donaron-dev --json` exits `0`.
  - `donaron export plugins/donaron-dev --target antigravity` produces valid `plugin.json`, root `hooks.json`, `< 24,000`-byte `rules/AGENTS.md`, 6 skills (+ references), and 15 agents.
  - `donaron export plugins/donaron-dev --target claude-code` produces `.claude-plugin/plugin.json`, `hooks/hooks.json`, `CLAUDE.md`, 6 skills, and 15 agents with `haiku`/`sonnet`/`opus` aliases.
  - Live `apps/cli/dist/cli.js hook antigravity <SessionStart|PreToolUse|Stop>` smoke invocations pass Choice 1A/2A checks.
- [ ] **Step 2:** Update `plugins/donaron-dev/README.md`, `README.md` (mark Phase 6 **Implemented**), and copy this plan to `docs/superpowers/plans/2026-11-19-phase-6-donaron-dev-plugin.md`.
- [ ] **Step 3:** Run `pnpm run clean && pnpm run check` (`tsc --build`, `typecheck`, `eslint`, `prettier`, `vitest run --coverage`) and verify ≥70% coverage across all metrics.
- [ ] **Step 4:** Commit Task 4 (`test(plugin): validate donaron-dev bundle, dual harness exports, and live hook smoke suite`) and perform Phase 6 whole-branch review.
