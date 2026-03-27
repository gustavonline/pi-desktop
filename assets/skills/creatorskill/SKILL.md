---
name: creatorskill
description: Create or update Pi prompt templates and Agent skills from a short user brief. Produces minimal, well-structured SKILL.md or prompt files that follow Agent Skills best practices.
metadata:
  short-description: Create or update a skill or prompt from a brief
---

# creatorskill

Purpose

This skill creates a lightweight, production-ready Pi resource (prompt template or Agent skill) from a short user brief. It favors concise, actionable files that follow the Agent Skills conventions and progressive disclosure: only the minimal metadata is kept in immediate context and larger references are stored separately.

When to use

- You want a new prompt template or skill scaffolded quickly from a short description.
- You want a small, standards-compliant SKILL.md written for immediate use by Pi or other Agent Skill runtimes.
- You prefer a single, reviewable change staged in chat (nothing is executed automatically).

Input contract

The skill expects a JSON payload (appended to the command) or equivalent user message with these fields:
- kind: "auto" | "prompt" | "skill"        # preferred resource type or "auto" to infer
- scope: "global" | "project"               # target location (global preferred)
- brief: string                                # one-paragraph description of what the resource should do
- name: string?                                # optional slug hint (will be normalized)

Behavior

1. Validate the brief. If essential details are missing, ask one concise clarification question.
2. If kind == "auto", infer whether a prompt template or skill fits the brief.
3. Determine a safe slug:
   - Prefer an explicit `name` if provided after normalization.
   - Otherwise derive a short, verb-led slug from the brief (lowercase, letters/numbers/hyphens, ≤64 chars).
4. Create the resource under the chosen scope using Pi conventions:
   - Prompt template: ~/.pi/agent/prompts/<slug>.md
   - Skill: ~/.pi/agent/skills/<slug>/SKILL.md
5. SKILL.md structure for skills:
   - YAML frontmatter with `name` and `description` (these are the trigger fields)
   - Body: short Purpose, Setup (one-time steps), Workflow (ordered steps), Examples (if helpful)
   - Keep body concise; move large examples or references to `references/` files.
6. For prompt templates:
   - Create a markdown file with frontmatter `description` and a short reusable prompt body and usage notes.
7. Never execute external commands or run the created scripts—always stage the operation and summarize the created files for user review.

Naming rules

- 1–64 chars, lowercase a-z, digits, hyphens only
- No leading/trailing hyphens, no consecutive hyphens
- Must match parent directory for SKILL.md (skill folder name)

Examples

Prepare a skill in chat (staged command):

/skill:creatorskill {"kind":"skill","scope":"global","brief":"Create a skill that reviews staged git changes for security issues and outputs a short remediation plan."}

Prepare a prompt template in chat (staged command):

/skill:creatorskill {"kind":"prompt","scope":"global","brief":"Template for reviewing staged git changes with a strict security checklist."}

Sample SKILL.md created for a security-review skill:

```markdown
---
name: security-review
description: Review staged git changes for security issues and suggest concise remediation steps. Use when you want an automated checklist and file-level recommendations for changed files.
---

# Security Review

## Purpose
Quickly identify security-relevant changes in staged files and provide prioritized remediation suggestions.

## Setup
No one-time setup required. (If helper scripts are included, document how to run them.)

## Workflow
1. List staged files and their diffs.
2. For each file, check for secrets, insecure patterns, and risky configuration changes.
3. Produce a short summary and per-file remediation steps.

## Examples
- `./scripts/check_secrets.sh` (run locally after review)
```

Validation & Best Practices

- Keep SKILL.md focused: put large references under `references/` and link from SKILL.md.
- Frontmatter MUST contain `name` and `description` (description should include trigger contexts).
- Prefer short, imperative language and examples instead of long prose.
- Ask at most one clarifying question if input is ambiguous.

Notes

- This skill only prepares and writes files under the chosen scope. It does not run or install anything.
- On successful creation, summarize exactly which files were written and their absolute paths so the user can review and run them manually.
