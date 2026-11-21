# Multi-Stack Gate Configuration (`.donaron/config.json`)

`donaron` auto-detects the stack from marker files or reads `.donaron/config.json`:

- **Node.js / React:** `package.json` → `pnpm run typecheck`, `pnpm run lint`, `vitest` (`coverage/test-results.json`), `istanbul-summary` (`coverage/coverage-summary.json`)
- **Python:** `pyproject.toml` / `requirements.txt` → `mypy .`, `ruff check .`, `junit` (`coverage/junit.xml`), `lcov` (`coverage/lcov.info`)
- **Go:** `go.mod` → `go vet ./...`, `golangci-lint run`, `junit`, `lcov`
- **Rust:** `Cargo.toml` → `cargo check --all-targets`, `cargo clippy --all-targets -- -D warnings`, `junit`, `lcov`
- **Flutter / Dart:** `pubspec.yaml` → `dart analyze`, `dart format --output=none --set-exit-if-changed .`, `junit`, `lcov`
