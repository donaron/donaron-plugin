# Systematic Debugging Protocol

1. **Reproduce:** Capture exact command, inputs, and error output.
2. **Isolate:** Trace the failing boundary (schema, path containment, hash scope, hook payload, or React state).
3. **Regression Test First:** Add a failing unit/integration test locking down the bug.
4. **Minimal Fix & Re-Verify:** Apply the fix and re-run `tsc`, `eslint`, and `vitest`.
