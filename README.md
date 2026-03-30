# @alexgorbatchev/pi-cmux-notify

[pi](https://pi.dev) package for [cmux](https://cmux.com) notifications.

## Why

Pi already knows what happened during a run. `@alexgorbatchev/pi-cmux-notify` turns that into
terminal-native `cmux notify` alerts so you can notice when Pi is waiting, completed work, or ended
in error.

## Usage

Install with Pi:

```bash
pi install npm:@alexgorbatchev/pi-cmux-notify
```

If Pi is already running, reload extensions:

```text
/reload
```

## Included extension

- `cmux-notify` — sends `cmux notify` alerts when Pi finishes a run

## Notification behavior

All notifications use:
- title: `Pi` by default
- subtitle: current run state
- body: a short summary of what Pi just did

Current notification types:

- `Waiting`
  - sent when Pi finishes a short run and is waiting for input
  - typical bodies:
    - `Finished and waiting for input`
    - `Reviewed README.md`
    - `Reviewed 3 files`
    - `Searched the codebase`

- `Task Complete`
  - sent when the run changed files, or when the run took at least the configured threshold
  - typical bodies:
    - `Updated package.json`
    - `Updated 2 files`
    - `Finished in 42s`
    - `Updated 3 files in 1m 12s`

- `Error`
  - sent when the run itself ends in error or abort
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

## Settings

Configure notifications in Pi settings instead of environment variables.

Global settings live in `~/.pi/agent/settings.json`.
Project settings live in `.pi/settings.json` and override global settings.

Use this package-scoped key:

```json
{
  "@alexgorbatchev/pi-cmux-notify": {
    "level": "all",
    "thresholdMs": 15000,
    "debounceMs": 3000,
    "title": "Pi"
  }
}
```

Supported fields:
- `level` — `all`, `medium`, `low`, or `disabled` (default: `all`)
- `thresholdMs` — duration threshold before a run is labeled `Task Complete` instead of `Waiting` (default: `15000`)
- `debounceMs` — minimum delay between duplicate notifications (default: `3000`)
- `title` — notification title override (default: `Pi`)

`cmux` must be available in `PATH` for notifications to work. Pi uses the current
`CMUX_WORKSPACE_ID` / `CMUX_SURFACE_ID` automatically when cmux is running.
