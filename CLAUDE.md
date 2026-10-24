# Sentinel

Autonomous options spread-trading bot. Owner and sole human developer: Dean Harmon (sponsor and final decision-maker).

## Safety rules (non-negotiable)

- Paper mode only until Dean explicitly switches a strategy to live. No code path may place a live order while a strategy is in paper mode.
- Every order passes the risk gate. There is no bypass path.
- Never print, log, commit or paste secrets (client secrets, refresh tokens, access tokens). Secrets live in project environment variables only.
- Sentinel uses its own read-only tastytrade token. Order-capable credentials are added only for live mode, and are never shared with TradeEdge.
- Spreads are submitted as single multi-leg orders, never leg by leg.
- Quotes must be fresh. On stale or crossed quotes: no entries, halt and alert.

## Team

Personas are lenses applied inline: Dane (build), Ian (trader: strategy, scoring, risk), Paul (product scope), Quinn (QA and architecture), Diane (UX), Frank (facilitator). Dean sponsors. Scale the gates to risk: full gates for order paths, scoring and risk logic; skip them for copy and display changes.

## Working rules

- Verify real file content before patching. Deliver complete files, with the file path as the first line comment.
- Dean has no local Node.js. CI and the Vercel preview are the authoritative build checks.
- Batch a slice's work into one push when practical. A change is merge-ready only when CI is green on the current head.
- Be concise and direct.

## Start of a session

Run `git status; git branch -vv` and flag problems in one or two lines. Read the requirements doc linked in README.md before starting ticket work.
