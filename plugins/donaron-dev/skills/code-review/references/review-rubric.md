# Independent Code Review Rubric

1. **Scope & Spec Alignment:** Diff matches the approved Gate 01 specification with no unapproved scope creep.
2. **Correctness & Edge Cases:** Null/empty/boundary inputs and error paths fail closed.
3. **No Duplication:** Shared helpers extracted cleanly without over-engineering.
4. **Verification Evidence:** Typecheck, ESLint, Prettier, and >= 70% test coverage verified on current `codeHash`.
