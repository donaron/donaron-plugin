---
name: sample-skill
description: Sample skill used to verify progressive bundle loading and reference resolution.
purpose: Demonstrate a valid DonAron skill definition with external documentation references.
activation: When verifying plugin discovery and bundle loading behavior.
inputs:
  - Task requirement brief
outputs:
  - Verified implementation checklist
constraints:
  - Never execute unapproved scripts during plugin discovery
completionCriteria:
  - All referenced files exist safely inside the plugin root
references:
  - references/guide.md
version: '1.0.0'
---

# Sample Skill

Follow the steps in [the reference guide](references/guide.md) before reporting completion.
