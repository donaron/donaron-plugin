---
name: code-review
description: Perform independent pre-test (Gate 02) and final sign-off (Gate 05) code reviews.
purpose: Catch correctness, maintainability, boundary, and security defects without self-approval.
activation: During PRE_TEST_REVIEW (Gate 02) or FINAL_REVIEW (Gate 05).
inputs:
  - Code diff, build/lint output, and Gate 01-04 evidence state
outputs:
  - Independent AgentReviewRecord bound to current codeHash
constraints:
  - Reviewer ID must never match a registered plan or code author ID
  - Fail closed on any unresolved critical or high finding
completionCriteria:
  - Fresh approved review bound to current codeHash recorded in EvidenceStore
references:
  - references/review-rubric.md
version: '0.1.0'
---

# Independent Code Review (Gates 02 & 05)

Verify correctness, edge-case handling, boundary safety, and zero self-approval using [the review rubric](references/review-rubric.md).
