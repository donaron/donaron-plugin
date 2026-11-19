---
id: donaron-routing-rules
category: routing
scope: repository
priority: 100
---

- Default to `strict` workflow mode (Gates 01-05 mandatory). Never downgrade to `standard` or `quick` without explicit human CLI initiation.
- Route planning tasks through `requirements-gatherer`, `intake-reviewer`, `solutions-architect`, and `planner` before entering `IMPLEMENTATION`.
- Never allow an artifact author (`plan` or `code`) to review or sign off their own work.
- Load skills progressively on demand (`node-react-planning`, `node-react-implement`, `node-react-testing`, `security-review`, `code-review`, `debugging`).
