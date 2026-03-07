import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

const CMUX_TIMEOUT_MS = 5000;
const SPLIT_READY_ATTEMPTS = 20;
const SPLIT_READY_DELAY_MS = 150;
const SURFACE_BOOT_DELAY_MS = 250;

type SplitDirection = "right" | "down";
type ReviewMode = "general" | "bugs" | "refactor" | "tests" | "diff";

interface CmuxCallerInfo {
	workspace_ref?: string;
	surface_ref?: string;
}

interface CmuxIdentifyResponse {
	caller?: CmuxCallerInfo;
}

interface CmuxPaneInfo {
	ref?: string;
	selected_surface_ref?: string;
	surface_refs?: string[];
}

interface CmuxListPanesResponse {
	panes?: CmuxPaneInfo[];
}

interface CmuxExecResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	error?: string;
}

interface ReviewRequest {
	mode: ReviewMode;
	targetOrFocus?: string;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function parseJson<T>(text: string): T | undefined {
	try {
		return JSON.parse(text) as T;
	} catch {
		return undefined;
	}
}

function shellEscape(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function collectSurfaceRefs(panes: CmuxPaneInfo[]): Set<string> {
	const refs = new Set<string>();
	for (const pane of panes) {
		if (pane.selected_surface_ref) {
			refs.add(pane.selected_surface_ref);
		}
		for (const surfaceRef of pane.surface_refs ?? []) {
			refs.add(surfaceRef);
		}
	}
	return refs;
}

function getReviewUsage(commandName: string): string {
	return `Usage: /${commandName}  (defaults to --diff)  |  /${commandName} [--bugs|--refactor|--tests] <target>  |  /${commandName} --diff [focus]`;
}

function parseReviewArgs(args: string): { ok: true; request: ReviewRequest } | { ok: false; error: string } {
	const trimmed = args.trim();
	if (!trimmed) {
		return { ok: true, request: { mode: "diff" } };
	}

	const tokens = trimmed.split(/\s+/).filter((token) => token.length > 0);
	let mode: ReviewMode = "general";
	let modeWasExplicit = false;
	let index = 0;

	while (index < tokens.length && tokens[index].startsWith("--")) {
		const token = tokens[index];
		let nextMode: ReviewMode | undefined;
		if (token === "--bugs") nextMode = "bugs";
		if (token === "--refactor") nextMode = "refactor";
		if (token === "--tests") nextMode = "tests";
		if (token === "--diff") nextMode = "diff";
		if (!nextMode) {
			return { ok: false, error: `Unknown review flag: ${token}` };
		}
		if (modeWasExplicit) {
			return { ok: false, error: "Use only one review mode flag at a time" };
		}
		mode = nextMode;
		modeWasExplicit = true;
		index += 1;
	}

	const targetOrFocus = tokens.slice(index).join(" ").trim() || undefined;
	if (mode !== "diff" && !targetOrFocus) {
		return { ok: false, error: "Specify a file or directory to review" };
	}

	return { ok: true, request: { mode, targetOrFocus } };
}

function getGitHubPullRequestUrl(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	return /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:[/?#].*)?$/.test(trimmed) ? trimmed : undefined;
}

function buildReviewPrompt(request: ReviewRequest): string {
	const commonInstructions = [
		"Use the bundled code-review skill if it is available.",
		"Start with a concise summary ordered by severity.",
		"Then list concrete findings with suggested fixes and any missing tests.",
		"Do not edit files unless asked.",
	].join(" ");
	const pullRequestUrl = getGitHubPullRequestUrl(request.targetOrFocus);
	const modeInstruction =
		request.mode === "bugs"
			? "Focus on correctness issues, runtime failures, bad assumptions, and edge cases."
			: request.mode === "refactor"
				? "Focus on simplifications, structure, naming, duplication, and maintainability while preserving behavior."
				: request.mode === "tests"
					? "Focus on missing coverage, brittle assertions, and untested edge cases."
					: "Focus on correctness, readability, maintainability, and missing tests.";

	if (pullRequestUrl) {
		return `Review GitHub pull request ${pullRequestUrl}. Use the gh CLI to inspect it, including gh pr view ${pullRequestUrl} and gh pr diff ${pullRequestUrl}. ${modeInstruction} Prioritize the changed code, likely regressions, and missing tests before adding lower-priority notes. ${commonInstructions}`;
	}

	if (request.mode === "diff") {
		const focus = request.targetOrFocus ? ` Extra focus: ${request.targetOrFocus}.` : "";
		return `Review the current git diff in this repository.${focus} Prioritize regressions, correctness issues, risky edge cases, and missing tests. ${commonInstructions}`;
	}

	const target = request.targetOrFocus;
	return `Review ${target} from the current project. ${modeInstruction} If the target is a directory, review the most relevant files within that scope. ${commonInstructions}`;
}

function buildPiStartupCommand(cwd: string, prompt: string): string {
	return ["cd", shellEscape(cwd), "&&", "pi", shellEscape(prompt)].join(" ");
}

async function execCmux(pi: ExtensionAPI, args: string[]): Promise<CmuxExecResult> {
	const result = await pi.exec("cmux", args, { timeout: CMUX_TIMEOUT_MS });
	if (result.killed) {
		return {
			ok: false,
			stdout: result.stdout,
			stderr: result.stderr,
			error: "cmux command timed out",
		};
	}
	if (result.code !== 0) {
		return {
			ok: false,
			stdout: result.stdout,
			stderr: result.stderr,
			error: result.stderr.trim() || result.stdout.trim() || `cmux exited with code ${result.code}`,
		};
	}
	return {
		ok: true,
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

async function getCallerInfo(pi: ExtensionAPI): Promise<{ ok: true; caller: Required<CmuxCallerInfo> } | { ok: false; error: string }> {
	const result = await execCmux(pi, ["--json", "identify"]);
	if (!result.ok) {
		return { ok: false, error: result.error || "Failed to identify cmux caller" };
	}

	const parsed = parseJson<CmuxIdentifyResponse>(result.stdout);
	const workspaceRef = parsed?.caller?.workspace_ref;
	const surfaceRef = parsed?.caller?.surface_ref;
	if (!workspaceRef || !surfaceRef) {
		return { ok: false, error: "This command must be run from inside a cmux surface" };
	}

	return { ok: true, caller: { workspace_ref: workspaceRef, surface_ref: surfaceRef } };
}

async function listPanes(pi: ExtensionAPI, workspaceRef: string): Promise<{ ok: true; panes: CmuxPaneInfo[] } | { ok: false; error: string }> {
	const result = await execCmux(pi, ["--json", "list-panes", "--workspace", workspaceRef]);
	if (!result.ok) {
		return { ok: false, error: result.error || "Failed to list cmux panes" };
	}

	const parsed = parseJson<CmuxListPanesResponse>(result.stdout);
	return { ok: true, panes: parsed?.panes ?? [] };
}

async function waitForNewSurface(pi: ExtensionAPI, workspaceRef: string, previousPanes: CmuxPaneInfo[]): Promise<string | undefined> {
	const previousPaneRefs = new Set(previousPanes.map((pane) => pane.ref).filter((ref): ref is string => Boolean(ref)));
	const previousSurfaceRefs = collectSurfaceRefs(previousPanes);

	for (let attempt = 0; attempt < SPLIT_READY_ATTEMPTS; attempt += 1) {
		const panesResult = await listPanes(pi, workspaceRef);
		if (!panesResult.ok) {
			return undefined;
		}

		for (const pane of panesResult.panes) {
			if (pane.ref && !previousPaneRefs.has(pane.ref)) {
				if (pane.selected_surface_ref) {
					return pane.selected_surface_ref;
				}
				const firstSurfaceRef = pane.surface_refs?.find((ref) => !previousSurfaceRefs.has(ref));
				if (firstSurfaceRef) {
					return firstSurfaceRef;
				}
			}
		}

		for (const pane of panesResult.panes) {
			for (const surfaceRef of pane.surface_refs ?? []) {
				if (!previousSurfaceRefs.has(surfaceRef)) {
					return surfaceRef;
				}
			}
		}

		await delay(SPLIT_READY_DELAY_MS);
	}

	return undefined;
}

async function openReviewSplit(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	direction: SplitDirection,
	request: ReviewRequest,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const callerResult = await getCallerInfo(pi);
	if (!callerResult.ok) {
		return callerResult;
	}

	const { workspace_ref: workspaceRef, surface_ref: surfaceRef } = callerResult.caller;
	const beforePanesResult = await listPanes(pi, workspaceRef);
	if (!beforePanesResult.ok) {
		return beforePanesResult;
	}

	const splitResult = await execCmux(pi, [
		"new-split",
		direction,
		"--workspace",
		workspaceRef,
		"--surface",
		surfaceRef,
	]);
	if (!splitResult.ok) {
		return { ok: false, error: splitResult.error || "Failed to create cmux split" };
	}

	const newSurfaceRef = await waitForNewSurface(pi, workspaceRef, beforePanesResult.panes);
	if (!newSurfaceRef) {
		return { ok: false, error: "Created split, but could not find the new cmux surface" };
	}

	await delay(SURFACE_BOOT_DELAY_MS);

	const respawnResult = await execCmux(pi, [
		"respawn-pane",
		"--workspace",
		workspaceRef,
		"--surface",
		newSurfaceRef,
		"--command",
		buildPiStartupCommand(ctx.cwd, buildReviewPrompt(request)),
	]);
	if (!respawnResult.ok) {
		return { ok: false, error: respawnResult.error || "Failed to start pi in the review split" };
	}

	return { ok: true };
}

function registerReviewCommand(
	pi: ExtensionAPI,
	name: string,
	direction: SplitDirection,
	description: string,
	successMessage: string,
): void {
	pi.registerCommand(name, {
		description,
		handler: async (args, ctx) => {
			const parsed = parseReviewArgs(args);
			if (!parsed.ok) {
				ctx.ui.notify(`${parsed.error}. ${getReviewUsage(name)}`, "warning");
				return;
			}

			const result = await openReviewSplit(pi, ctx, direction, parsed.request);
			if (result.ok) {
				ctx.ui.notify(successMessage, "info");
			} else {
				ctx.ui.notify(`review split failed: ${result.error}`, "error");
			}
		},
	});
}

export default function cmuxReviewExtension(pi: ExtensionAPI) {
	registerReviewCommand(
		pi,
		"cmrv",
		"right",
		"Open a new right split and start a fresh pi code review session",
		"Opened a review split to the right",
	);
	registerReviewCommand(
		pi,
		"review-v",
		"right",
		"Alias for /cmrv",
		"Opened a review split to the right",
	);

	registerReviewCommand(
		pi,
		"cmrh",
		"down",
		"Open a new lower split and start a fresh pi code review session",
		"Opened a review split below",
	);
	registerReviewCommand(
		pi,
		"review-h",
		"down",
		"Alias for /cmrh",
		"Opened a review split below",
	);
}
