import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import cmuxNotifyExtension from "./cmux-notify.ts";

export default function piCmuxExtensionBundle(pi: ExtensionAPI): void {
	cmuxNotifyExtension(pi);
}
