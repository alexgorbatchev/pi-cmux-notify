# AGENTS.md

## Repo overview

This repository contains `@alexgorbatchev/pi-cmux-notify`, a small Pi package that adds cmux-backed notifications to Pi.

Current extensions:

- `extensions/cmux-notify.ts` — sends `cmux notify` alerts when Pi finishes, waits for input, or ends in an error/abort state
- `extensions/index.ts` — package entrypoint that loads `cmux-notify`

Other important files:

- `README.md` — user-facing package documentation
- `package.json` — package metadata for npm and Pi

## Commands

- Install: `bun install`
- Fix: `bun run fix`
- Check: `bun run check`
- Smoke test: `bun run test`

## How the repo works

- This repo uses Bun for dependency management and local validation commands.
- Extensions are loaded from `./extensions/index.ts` via the `pi.extensions` entry in `package.json`.
- The package is published to npm and installed in Pi via `pi install npm:@alexgorbatchev/pi-cmux-notify`.

## Editing guidelines

- Keep README examples and behavior descriptions aligned with the extension behavior.
- Prefer small, focused edits.
- Preserve the existing style: concise docs, simple utilities, minimal dependencies.

## Release / push checklist

Before pushing changes:

- run `bun run check && bun run test`
- if formatting or auto-fixes are needed first, run `bun run fix`
- bump the npm version
- make sure `README.md` matches the current behavior
- review the git diff for accidental changes

## Notes for future agents

- If you change publishable package metadata or release behavior, check `package.json` and `README.md` together.
- There is no installer entrypoint anymore; installation is through `pi install`.
