import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import cmuxNotifyExtension from "./cmux-notify.js";

export default function piCmuxExtensionBundle(pi: ExtensionAPI): void {
  cmuxNotifyExtension(pi);
}
