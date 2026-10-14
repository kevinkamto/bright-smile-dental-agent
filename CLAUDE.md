# CLAUDE.md

Working guide for AI agents and contributors in this repository.

## Project
**Bright Smile Dental AI Front Desk**: a KB-grounded patient chat assistant that captures appointment requests,
plus a staff dashboard that prioritizes callbacks. **[`SPEC.md`](SPEC.md) is the source of truth** for behavior,
data model, API contract, and quality bar. If you change behavior, update SPEC.md in the same PR.

## Repo map
```
context/        KB PDF (source of facts). conversation.md is private and git-ignored. Never commit it.
backend/        FastAPI (async) + LangGraph agent + Beanie/MongoDB. Python, managed with uv.
  src/bright_smile/
    config.py     pydantic-settings Settings (the only place env vars are read)
    kb.py         KB transcription, the only fact source for the bot
    agent/        graph, prompts, tools, guard
    api/          routers: chat, leads, auth, health
    documents.py  Beanie documents · schemas.py API DTOs · priority.py · sla.py
  tests/          unit/ · api/ · evals/ (marker `eval`, real API, manual)
frontend/       Next.js (App Router, TS strict) + shadcn/ui. Managed with pnpm.
.github/        CI (`ci-ok` is the required merge check), issue/PR templates
```

## Commands
Backend (run in `backend/`):
```bash
uv sync                                  # install (uv only, never pip)
uv run fastapi dev src/bright_smile/main.py
uv run ruff check . --fix && uv run ruff format .
uv run mypy src
uv run pytest                            # unit + API (needs MONGODB_URI; uses a throwaway DB)
uv run pytest -m eval                    # live evals (needs ANTHROPIC_API_KEY)
uv run python -m bright_smile.cli export-openapi   # writes ../frontend/openapi.json
uv run python -m bright_smile.cli hash-password    # STAFF_PASSWORD_HASH
```
Frontend (run in `frontend/`):
```bash
pnpm install
pnpm dev | pnpm lint | pnpm typecheck | pnpm format | pnpm build
pnpm gen:api                             # openapi.json → lib/api-types.ts
pnpm dlx shadcn@latest add <component>   # add UI components via the CLI only
```
Local MongoDB: the locally installed MongoDB service at `mongodb://localhost:27017` (no Docker for local dev).
Tests create and drop their own throwaway database (`bright_smile_test_<random>`), so they never touch the dev DB.

## Conventions
**Python**
- Python ≥ 3.12 with modern typing (`X | None`, builtin generics, `type` aliases). `mypy --strict` must pass. No `Any`
  or `# type: ignore` without a specific error code and a reason.
- Async-only I/O (FastAPI, PyMongo async / Beanie, `ChatAnthropic.ainvoke`/`astream`). No blocking calls in request paths.
- Pydantic v2 everywhere. API DTOs live in `schemas.py`. Never return Beanie documents directly.
- **Configuration only through `config.Settings` (pydantic-settings)**, accessed via `get_settings()` / FastAPI
  dependency. Secrets are `SecretStr`. Never read `os.environ` elsewhere. Add each new variable to `Settings`,
  `.env.example`, and SPEC §12.1.
- Business rules (priority, SLA, after-hours, guard) are deterministic, pure functions with unit tests. They are never delegated to the LLM.
- Errors use the shared shape `{"error": {code, message, details}}` (SPEC §7.3).
- Logging: structured, and **never log message content or PII**.

**TypeScript / Next.js**
- TS strict, server components by default, `"use client"` only where needed.
- Call the backend only through the same-origin `/api/*` proxy via `lib/api.ts`, using generated types. Regenerate types
  (`export-openapi` + `pnpm gen:api`) whenever backend schemas change. CI fails on drift.
- `components/ui/` is shadcn-generated. Compose in `components/chat` / `components/leads` instead of editing it.
- Accessibility is part of done: keyboard, focus, `aria-live` for chat, AA contrast (SPEC §8.4).

## Domain rules (do not violate)
- `kb.py` is the only source of facts. Never add prices, hours, insurers, or services that aren't in the KB.
- **Saturday hours conflict** (8–1 vs 9–2): never state either range as fact. Advise calling (SPEC §4.2).
- No medical, dental, or medication advice. Emergencies follow SPEC §4.4.
- Only the Invisalign consult is free. The implant consult is "consultation required", not free.

## Writing style
- **Never use em-dashes (U+2014)** anywhere: code, comments, docs, UI copy, bot prompts and replies, commit messages,
  PR and issue text. Use a colon, comma, parentheses, or a separate sentence instead.
- En-dashes (`–`) are fine only inside numeric ranges copied from the KB (e.g. `$1,100 – $1,500`, `8:00 AM – 5:00 PM`).
- Check before committing: `git grep -nP '\x{2014}'` must return nothing.

## Git & GitHub workflow
- Flow: **issue → branch `<type>/<issue#>-<slug>` → PR (`Closes #N`, template filled) → `ci-ok` green → squash-merge → delete branch.**
- Never commit directly to `main` (protected). Never force-push shared branches.
- Conventional Commits (`feat(backend): …`, `fix(frontend): …`, `test: …`, `docs: …`, `chore(ci): …`). Small, focused commits.
  Gates must pass locally before committing (pre-commit hooks).
- Never commit `.env`, secrets, or `context/conversation.md`.
- Ask the user before outward-facing actions: creating repos, pushing, changing branch protection, deploying.

## Docs & references
- Look up current library docs with Context7 (FastAPI, Beanie, PyMongo, LangGraph, langchain-anthropic, Next.js, shadcn).
- Use the `claude-api` skill before writing or changing Anthropic/Claude integration code.
