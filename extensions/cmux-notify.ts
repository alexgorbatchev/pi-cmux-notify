import type { ExtensionAPI, ToolResultEvent } from "@mariozechner/pi-coding-agent";
import {
  SettingsManager,
  isBashToolResult,
  isEditToolResult,
  isFindToolResult,
  isGrepToolResult,
  isReadToolResult,
  isWriteToolResult,
} from "@mariozechner/pi-coding-agent";
import { basename } from "node:path";

const DEFAULT_THRESHOLD_MS = 15000;
const DEFAULT_DEBOUNCE_MS = 3000;
const NOTIFY_TIMEOUT_MS = 5000;
const DEFAULT_NOTIFY_LEVEL = "all";
const DEFAULT_NOTIFY_TITLE = "Pi";
const PACKAGE_SETTINGS_KEY = "@alexgorbatchev/pi-cmux-notify";

type NotifyLevel = "all" | "medium" | "low" | "disabled";

type RunState = {
  startedAt: number;
  readFiles: Set<string>;
  changedFiles: Set<string>;
  searchCount: number;
  bashCount: number;
  firstToolError: string | undefined;
};

type NotifySettings = {
  level: NotifyLevel;
  thresholdMs: number;
  debounceMs: number;
  title: string;
};

type AssistantMessageContent = {
  type?: string;
  text?: string;
};

type AssistantMessageLike = {
  role: "assistant";
  stopReason?: string;
  errorMessage?: string;
  content?: AssistantMessageContent[];
};

type TextAssistantMessageContent = {
  type: "text";
  text: string;
};

type SendNotificationResult = {
  ok: boolean;
  error?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getNotifyLevel(value: unknown): NotifyLevel | undefined {
  if (typeof value !== "string") return undefined;
  const normalizedValue = value.trim().toLowerCase();
  if (
    normalizedValue === "all" ||
    normalizedValue === "medium" ||
    normalizedValue === "low" ||
    normalizedValue === "disabled"
  ) {
    return normalizedValue;
  }
  return undefined;
}

function getNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : undefined;
  }
  if (typeof value !== "string") return undefined;
  const parsedValue = Number.parseInt(value, 10);
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : undefined;
}

function getNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function getPackageSettings(settings: unknown): Record<string, unknown> | undefined {
  if (!isRecord(settings)) return undefined;
  const packageSettings = settings[PACKAGE_SETTINGS_KEY];
  return isRecord(packageSettings) ? packageSettings : undefined;
}

function loadNotifySettings(cwd: string): NotifySettings {
  const settingsManager = SettingsManager.create(cwd);
  const globalSettings = getPackageSettings(settingsManager.getGlobalSettings());
  const projectSettings = getPackageSettings(settingsManager.getProjectSettings());

  return {
    level: getNotifyLevel(projectSettings?.level) ?? getNotifyLevel(globalSettings?.level) ?? DEFAULT_NOTIFY_LEVEL,
    thresholdMs:
      getNonNegativeInteger(projectSettings?.thresholdMs) ??
      getNonNegativeInteger(globalSettings?.thresholdMs) ??
      DEFAULT_THRESHOLD_MS,
    debounceMs:
      getNonNegativeInteger(projectSettings?.debounceMs) ??
      getNonNegativeInteger(globalSettings?.debounceMs) ??
      DEFAULT_DEBOUNCE_MS,
    title:
      getNonEmptyString(projectSettings?.title) ?? getNonEmptyString(globalSettings?.title) ?? DEFAULT_NOTIFY_TITLE,
  };
}

function pluralize(count: number, singular: string, plural: string = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

function getPathFromInput(event: ToolResultEvent): string | undefined {
  const path = event.input.path;
  return typeof path === "string" && path.length > 0 ? path : undefined;
}

function getFirstText(event: ToolResultEvent): string | undefined {
  const textPart = event.content.find((part) => part.type === "text");
  if (!textPart || textPart.type !== "text") return undefined;
  const text = textPart.text.trim();
  return text.length > 0 ? text : undefined;
}

function summarizeError(event: ToolResultEvent): string {
  const path = getPathFromInput(event);
  if (path) {
    return `${event.toolName} failed for ${basename(path)}`;
  }
  if (isBashToolResult(event)) {
    return "bash command failed";
  }
  const text = getFirstText(event);
  if (!text) {
    return `${event.toolName} failed`;
  }
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function summarizeSuccess(state: RunState, durationMs: number, thresholdMs: number): string {
  const changedCount = state.changedFiles.size;
  if (changedCount === 1) {
    const [file] = [...state.changedFiles];
    const summary = `Updated ${basename(file)}`;
    return durationMs >= thresholdMs ? `${summary} in ${formatDuration(durationMs)}` : summary;
  }
  if (changedCount > 1) {
    const summary = `Updated ${changedCount} ${pluralize(changedCount, "file")}`;
    return durationMs >= thresholdMs ? `${summary} in ${formatDuration(durationMs)}` : summary;
  }

  const readCount = state.readFiles.size;
  if (readCount === 1) {
    const [file] = [...state.readFiles];
    const summary = `Reviewed ${basename(file)}`;
    return durationMs >= thresholdMs ? `${summary} in ${formatDuration(durationMs)}` : summary;
  }
  if (readCount > 1) {
    const summary = `Reviewed ${readCount} ${pluralize(readCount, "file")}`;
    return durationMs >= thresholdMs ? `${summary} in ${formatDuration(durationMs)}` : summary;
  }

  if (state.searchCount > 0 && state.bashCount > 0) {
    const searchSummary = `${state.searchCount} ${pluralize(state.searchCount, "search")}`;
    const bashSummary = `${state.bashCount} ${pluralize(state.bashCount, "shell command")}`;
    const summary = `Ran ${searchSummary} and ${bashSummary}`;
    return durationMs >= thresholdMs ? `${summary} in ${formatDuration(durationMs)}` : summary;
  }
  if (state.searchCount > 0) {
    const summary = state.searchCount === 1 ? "Searched the codebase" : `Ran ${state.searchCount} searches`;
    return durationMs >= thresholdMs ? `${summary} in ${formatDuration(durationMs)}` : summary;
  }
  if (state.bashCount > 0) {
    const summary = `Ran ${state.bashCount} ${pluralize(state.bashCount, "shell command")}`;
    return durationMs >= thresholdMs ? `${summary} in ${formatDuration(durationMs)}` : summary;
  }
  return durationMs >= thresholdMs ? `Finished in ${formatDuration(durationMs)}` : "Finished and waiting for input";
}

function isAssistantMessage(message: unknown): message is AssistantMessageLike {
  return isRecord(message) && message.role === "assistant";
}

function getLastAssistantMessage(messages: readonly unknown[]): AssistantMessageLike | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isAssistantMessage(message)) return message;
  }
  return undefined;
}

function summarizeAssistantText(message: AssistantMessageLike): string | undefined {
  if (!Array.isArray(message.content)) return undefined;

  const text = message.content
    .filter(
      (part): part is TextAssistantMessageContent =>
        isRecord(part) && part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0,
    )
    .map((part) => part.text.trim())
    .join("\n")
    .trim();

  if (text.length === 0) return undefined;
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function summarizeRunError(messages: readonly unknown[], fallbackError?: string): string | undefined {
  const assistantMessage = getLastAssistantMessage(messages);
  if (!assistantMessage) return fallbackError;
  if (assistantMessage.stopReason !== "error" && assistantMessage.stopReason !== "aborted") {
    return undefined;
  }

  const summary =
    assistantMessage.errorMessage?.trim() ||
    summarizeAssistantText(assistantMessage) ||
    fallbackError ||
    "Agent run failed";
  return summary.length > 120 ? `${summary.slice(0, 117)}...` : summary;
}

function buildSubtitle(hasRunError: boolean, state: RunState, durationMs: number, thresholdMs: number): string {
  if (hasRunError) return "Error";
  if (state.changedFiles.size > 0 || durationMs >= thresholdMs) return "Task Complete";
  return "Waiting";
}

function shouldNotify(level: NotifyLevel, subtitle: string): boolean {
  if (level === "disabled") return false;
  if (level === "all") return true;
  if (level === "medium") return subtitle === "Task Complete" || subtitle === "Error";
  if (level === "low") return subtitle === "Error";
  return true;
}

function createEmptyRunState(): RunState {
  return {
    startedAt: Date.now(),
    readFiles: new Set<string>(),
    changedFiles: new Set<string>(),
    searchCount: 0,
    bashCount: 0,
    firstToolError: undefined,
  };
}

export default function cmuxNotifyExtension(pi: ExtensionAPI): void {
  let notifySettings: NotifySettings = {
    level: DEFAULT_NOTIFY_LEVEL,
    thresholdMs: DEFAULT_THRESHOLD_MS,
    debounceMs: DEFAULT_DEBOUNCE_MS,
    title: DEFAULT_NOTIFY_TITLE,
  };
  let runState = createEmptyRunState();
  let lastNotificationAt = 0;
  let lastNotificationKey = "";
  let cmuxUnavailable = false;

  const refreshNotifySettings = (cwd: string): void => {
    notifySettings = loadNotifySettings(cwd);
  };

  const sendNotification = async (subtitle: string, body: string): Promise<SendNotificationResult> => {
    if (cmuxUnavailable) {
      return { ok: false, error: "cmux notify is unavailable" };
    }

    const notificationKey = `${subtitle}\n${body}`;
    const now = Date.now();
    if (notificationKey === lastNotificationKey && now - lastNotificationAt < notifySettings.debounceMs) {
      return { ok: true };
    }

    const args = ["notify", "--title", notifySettings.title, "--subtitle", subtitle, "--body", body];
    const result = await pi.exec("cmux", args, { timeout: NOTIFY_TIMEOUT_MS });
    if (result.killed) {
      return { ok: false, error: "cmux notify timed out" };
    }
    if (result.code !== 0) {
      const error = result.stderr.trim() || result.stdout.trim() || `cmux exited with code ${result.code}`;
      if (error.includes("not found") || error.includes("ENOENT")) {
        cmuxUnavailable = true;
      }
      return { ok: false, error };
    }

    lastNotificationAt = now;
    lastNotificationKey = notificationKey;
    return { ok: true };
  };

  pi.on("session_start", async (_event, ctx) => {
    refreshNotifySettings(ctx.cwd);
  });

  pi.on("session_switch", async (_event, ctx) => {
    refreshNotifySettings(ctx.cwd);
  });

  pi.on("agent_start", async (_event, ctx) => {
    refreshNotifySettings(ctx.cwd);
    runState = createEmptyRunState();
  });

  pi.on("tool_result", async (event) => {
    if (event.isError && !runState.firstToolError) {
      runState.firstToolError = summarizeError(event);
    }

    if (isReadToolResult(event)) {
      const path = getPathFromInput(event);
      if (path) runState.readFiles.add(path);
      return;
    }

    if (isEditToolResult(event) || isWriteToolResult(event)) {
      const path = getPathFromInput(event);
      if (path && !event.isError) runState.changedFiles.add(path);
      return;
    }

    if (isGrepToolResult(event) || isFindToolResult(event)) {
      if (!event.isError) runState.searchCount += 1;
      return;
    }

    if (isBashToolResult(event) && !event.isError) {
      runState.bashCount += 1;
    }
  });

  pi.on("agent_end", async (event) => {
    const durationMs = Date.now() - runState.startedAt;
    const runError = summarizeRunError(event.messages, runState.firstToolError);
    const subtitle = buildSubtitle(Boolean(runError), runState, durationMs, notifySettings.thresholdMs);
    if (!shouldNotify(notifySettings.level, subtitle)) {
      return;
    }
    const body = runError || summarizeSuccess(runState, durationMs, notifySettings.thresholdMs);
    await sendNotification(subtitle, body);
  });
}
