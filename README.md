# pi-cmux

Pi package with cmux-powered terminal integrations.

## Why

Pi works well in the terminal, but terminal-native actions like workspace notifications, editor launching, and pane orchestration are better handled by cmux. This package collects pi extensions that use the cmux API instead of baking those workflows into pi itself.

It currently includes:
- `cmux-notify` for workspace notifications when pi finishes, waits for input, or ends in an error state
- `cmux-split` for opening new cmux split panels and starting fresh pi sessions in the same project
- `cmux-zoxide` for opening a new split from a zoxide match and starting pi in the target directory
- `cmux-review` for opening focused review sessions in a new split, backed by bundled review prompts and a reusable review skill

## Usage

Install with pi:

```bash
pi install npm:pi-cmux
```

Or with the installer:

```bash
npx pi-cmux
```

If pi is already running, use:

```text
/reload
```

### Included extensions

- `cmux-notify` - sends `cmux notify` alerts for pi completion and error states
- `cmux-split` - opens new cmux split panels and starts fresh pi sessions in the same project
- `cmux-zoxide` - opens a new split from a zoxide match and starts pi in the target directory
- `cmux-review` - opens a new split for a focused review session and starts pi with a bundled review prompt

### cmux-notify notifications

All notifications use:
- title: `Pi` by default
- subtitle: current run state
- body: a short summary of what pi just did

Current notification types:

- `Waiting`
  - sent when pi finishes a normal run and is waiting for input
  - typical bodies:
    - `Finished and waiting for input`
    - `Reviewed README.md`
    - `Reviewed 3 files`
    - `Searched the codebase`

- `Task Complete`
  - sent when pi finishes a longer run, or when the run changed files
  - typical bodies:
    - `Updated package.json`
    - `Updated 2 files`
    - `Finished in 42s`
    - `Updated 3 files in 1m 12s`

- `Error`
  - sent when the run itself ends in an error or is aborted
  - typical bodies:
    - `read failed for config.json`
    - `edit failed for README.md`
    - `bash command failed`

Notification bodies are summarized from the run itself:
- changed files from `edit` and `write`
- reviewed files from `read`
- searches from `grep` and `find`
- shell activity from `bash`
- the final agent error, with the first tool failure used as a fallback summary when needed

### cmux split commands

- `/cmv`
  - opens a new split to the right
  - starts a fresh `pi` session in the same `cwd`

- `/cmh`
  - opens a new split below
  - starts a fresh `pi` session in the same `cwd`

Legacy aliases still available for now:
- `/cmux-v` → `/cmv`
- `/cmux-h` → `/cmh`

Both commands also accept optional initial prompt text. Example:

```text
/cmv Review the auth flow in this repo
```

That launches the new split and starts:

```bash
pi 'Review the auth flow in this repo'
```

in the same project directory.

### cmux zoxide jump

- `/cmz <query>`
  - resolves the query with `zoxide query`
  - opens a new split to the right
  - starts a fresh pi session in the matched directory

- `/cmzh <query>`
  - resolves the query with `zoxide query`
  - opens a new split below
  - starts a fresh pi session in the matched directory

Legacy aliases still available for now:
- `/z` → `/cmz`
- `/zh` → `/cmzh`

Example:

```text
/cmz mono
```

If the argument is already a valid directory path, `/cmz` and `/cmzh` use it directly instead of querying zoxide.

### Review helpers

`pi-cmux` also bundles a reusable `code-review` skill plus prompt templates for in-place review:

- `/review <target>`
  - prompt template for reviewing a file, directory, or GitHub pull request URL in the current pane
- `/review-diff [focus-or-pr-url]`
  - prompt template for reviewing the current git diff in the current pane, or a GitHub pull request URL via `gh`
- `code-review`
  - skill used for structured code review of files, directories, and diffs
  - also available directly as `/skill:code-review`

Split review commands:

- `/cmrv`
  - with no arguments, reviews the current git diff in a new right split
- `/cmrh`
  - with no arguments, reviews the current git diff in a new lower split
- `/cmrv [--bugs|--refactor|--tests] <target>` or `/cmrv --diff [focus]`
  - opens a new split to the right
  - starts a fresh pi review session in the same `cwd`
- `/cmrh [--bugs|--refactor|--tests] <target>` or `/cmrh --diff [focus]`
  - opens a new split below
  - starts a fresh pi review session in the same `cwd`

`--diff` is the default, so `/cmrv` and `/cmrh` usually do not need the flag.

Legacy aliases still available for now:
- `/review-v` → `/cmrv`
- `/review-h` → `/cmrh`

Examples:

```text
/cmrv
/cmrh
/cmrv src/auth.ts
/cmrv --bugs src/auth.ts
/cmrh --refactor src/auth/
/cmrv --diff
/cmrh --diff focus on token refresh and retries
/cmrv https://github.com/owner/repo/pull/123
```

If the target is a GitHub pull request URL, the review workflow switches to PR review and instructs pi to inspect the pull request with `gh pr view` and `gh pr diff`.

The split review commands start a fresh pi session with a focused bootstrap prompt and instruct pi to use the bundled `code-review` skill when available.

### Environment variables

- `PI_CMUX_NOTIFY_THRESHOLD_MS` - duration threshold before a run is labeled `Task Complete` instead of `Waiting` (default: `15000`)
- `PI_CMUX_NOTIFY_DEBOUNCE_MS` - minimum delay between duplicate notifications (default: `3000`)
- `PI_CMUX_NOTIFY_TITLE` - notification title override (default: `Pi`)

cmux uses the current `CMUX_WORKSPACE_ID` / `CMUX_SURFACE_ID` automatically, or you can provide those in your environment yourself.

## Publish

```bash
cd ~/pi-cmux
NODE_AUTH_TOKEN=YOUR_TOKEN npm publish
```
