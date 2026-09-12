# General ERP — Antigravity Agent Starter

This starter repository contains the persistent instructions and product specification needed for an AI coding agent to build the General ERP incrementally.

## Files

- `GEMINI.md` — persistent agent constitution; keep it at repository root.
- `docs/PRODUCT_REQUIREMENTS_SPECIFICATION.md` — product requirements and architecture source of truth.
- `docs/AGENT_DEVELOPMENT_GUIDE.md` — detailed engineering workflow and standards.
- `docs/DECISIONS.md` — architecture decision record.
- `docs/IMPLEMENTATION_STATUS.md` — actual implementation checklist.
- `prompts/MASTER_AGENT_PROMPT.md` — initial/master prompt to give the agent.
- `prompts/` — place future task-specific prompts here.

## How to use in Antigravity

1. Open this folder as the project/workspace.
2. Keep `GEMINI.md` at the repository root so the agent has persistent project instructions.
3. Give the contents of `prompts/MASTER_AGENT_PROMPT.md` as the initial project/bootstrap prompt.
4. Ask the agent to work one milestone/task at a time.
5. Require it to update `docs/IMPLEMENTATION_STATUS.md` after meaningful milestones.
6. Require architecture decisions to be recorded in `docs/DECISIONS.md`.

## Recommended first prompt

After opening the project, use the master prompt and then ask:

> Read the project constitution, PRS, agent development guide, decisions, and implementation status. Inspect the repository. Do not implement business modules yet. First propose the Phase 0 engineering foundation architecture, repository structure, module boundaries, database strategy, API conventions, authentication/authorization foundation, audit foundation, testing strategy, and development sequence. Identify any material ambiguities that require my decision. Do not make code changes until the plan is agreed.

Once the plan is approved, implementation should proceed incrementally.
