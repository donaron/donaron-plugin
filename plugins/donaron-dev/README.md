# `donaron-dev` — Personal Node.js + React Strict Workflow Plugin

Flagship personal plugin bundle for **Google Antigravity** and **Anthropic Claude Code** enforcing DonAron's 5-gate `strict` workflow, progressive skill loading, and Choice 1A / 2A security boundaries.

## Contents

- **`plugin.json`:** Universal DonAron v1 manifest (`id: "donaron-dev"`, `permissions: ["fs:read", "fs:write", "cmd:exec"]`).
- **6 Progressive Skills (`skills/`):** `node-react-planning`, `node-react-implement`, `node-react-testing`, `security-review`, `code-review`, `debugging` (each with `SKILL.md` + `references/*.md`).
- **15-Agent Strict Roster (`agents/`):**
  - Planning: `requirements-gatherer`, `intake-reviewer`, `solutions-architect`, `planner`
  - Research: `explore`, `researcher`, `ask`
  - Build: `developer`, `developer-tester`, `devops`, `worker`, `general-purpose`
  - Verify: `reviewer`, `code-reviewer`, `qa`
- **4 Compact Rules (`rules/`, compiled `< 24,000` bytes):** `routing.md`, `security.md`, `development.md`, `writing.md`.
- **Lifecycle Hooks (`hooks/hooks.json`):** Declarative bindings to `session-context` (`SessionStart`), `policy-guard` (`PreToolUse`), `stale-tracker` (`PostToolUse`), and `gate-stop-guard` (`Stop`).
