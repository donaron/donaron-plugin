---
name: node-react-planning
description: Create Gate 01-ready planning documents for any tech stack (frontend, backend, CLI, or full-stack).
purpose: Produce clear, reviewable architecture and task plans satisfying all mandatory Gate 01 sections.
activation: When starting a new feature, refactor, or bugfix under strict workflow mode.
inputs:
  - User feature request and repository context
outputs:
  - Planning markdown document with Requirements, Specification, Architecture, Task Plan, and Acceptance Criteria
constraints:
  - Never enter IMPLEMENTATION before Gate 01 passes
  - Register planning author IDs to prevent self-approval
completionCriteria:
  - All 5 Gate 01 headings are non-empty and approved by intake-reviewer and solutions-architect (or human)
references:
  - references/planning-checklist.md
version: '0.2.0'
---

# Feature & Architecture Planning (Multi-Stack)

If the target **frontend**, **backend**, or **database** tech stack is not already specified or detected in the repo, ask the user via `ask_question` before designing the architecture. Draft a concise plan containing `## Requirements`, `## Specification`, `## Architecture`, `## Task Plan`, and `## Acceptance Criteria`. Follow [the planning checklist](references/planning-checklist.md) before requesting Gate 01 review.
