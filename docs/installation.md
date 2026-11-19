# Installation, Upgrade, and Uninstall Guide

This guide explains how to build `donaron-plugin`, validate and install `plugins/donaron-dev`, and manage installations for **Google Antigravity** and **Anthropic Claude Code**.

---

## 1. Prerequisites

- **Node.js:** `>= 24.0.0`
- **pnpm:** `10.x`
- **Git:** `>= 2.40`

---

## 2. Build the Monorepo

```bash
pnpm install
pnpm run build
```

Verify the environment and CLI:

```bash
node apps/cli/dist/cli.js doctor
node apps/cli/dist/cli.js plugin validate plugins/donaron-dev
```

---

## 3. Install `donaron-dev`

### Option A: Install into Antigravity Only

```bash
node apps/cli/dist/cli.js plugin install plugins/donaron-dev --target antigravity --yes
```

- Deploys the native Antigravity bundle to `~/.gemini/config/plugins/donaron-dev/` (`plugin.json`, root `hooks.json`, `< 24,000`-byte `rules/AGENTS.md`, 6 `skills/`, and 15 `agents/`).
- **Zero config tampering:** `donaron` never hand-edits `~/.gemini/config/config.json`; Antigravity auto-discovers valid plugin folders in `~/.gemini/config/plugins/`.

### Option B: Install into Both Antigravity and Claude Code

```bash
node apps/cli/dist/cli.js plugin install plugins/donaron-dev --target all --yes
```

- Installs to `~/.gemini/config/plugins/donaron-dev/` and `~/.claude/plugins/donaron-dev/` (`.claude-plugin/plugin.json`, `hooks/hooks.json`, `CLAUDE.md`, `skills/`, and `agents/`).
- Records installation provenance, SHA-256 bundle digest, and requested permissions (`fs:read`, `fs:write`, `cmd:exec`) in `~/.donaron/registry.json`.

> **Note on Permission Confirmation:** If you omit `--yes` when installing a plugin that declares permissions, `donaron plugin install` fails closed with `INSTALL_CONFIRMATION_REQUIRED`.

---

## 4. Export a Portable Bundle (Without Installing)

```bash
node apps/cli/dist/cli.js export plugins/donaron-dev --target antigravity --out ./dist-agy --overwrite
node apps/cli/dist/cli.js export plugins/donaron-dev --target claude-code --out ./dist-claude --overwrite
```

---

## 5. List, Upgrade, and Uninstall

- **List installed plugins:**
  ```bash
  node apps/cli/dist/cli.js plugin list
  ```
- **Upgrade an existing installation:** Re-run `donaron plugin install plugins/donaron-dev --target <antigravity|claude-code|all> --yes`. Receipts in `~/.donaron/registry.json` update idempotently.
- **Uninstall:**
  ```bash
  node apps/cli/dist/cli.js plugin uninstall donaron-dev --target antigravity
  ```
  Validates the plugin name against path traversal, verifies the recorded directory basename matches `donaron-dev`, removes the deployed folder, and removes the receipt from `~/.donaron/registry.json`.
