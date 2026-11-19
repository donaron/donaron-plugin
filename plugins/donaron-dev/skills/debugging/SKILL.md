---
name: debugging
description: Root-cause-first systematic debugging for Node.js, React, and TypeScript failures.
purpose: Diagnose failures from observed evidence before applying minimal regression-tested fixes.
activation: Whenever a test, build, hook, or runtime check fails unexpectedly.
inputs:
  - Failing command output, stack trace, or reproduction case
outputs:
  - Identified root cause, failing regression test, and verified minimal fix
constraints:
  - Never guess fixes without reproducing the root cause first
  - Re-verify affected gates after applying a fix
completionCriteria:
  - Root cause confirmed, regression test passes, and full verification suite is green
references:
  - references/systematic-debugging.md
version: '0.1.0'
---

# Systematic Debugging

Reproduce the failure deterministically, isolate the root cause, write a failing regression test, apply the minimal fix, and re-run verification per [the debugging guide](references/systematic-debugging.md).
