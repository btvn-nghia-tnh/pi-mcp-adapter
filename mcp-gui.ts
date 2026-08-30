/**
 * mcp-gui.ts — GUI registration for non-TUI hosts (pi web, rpc integrations).
 *
 * The TUI renders MCP management through the interactive `/mcp` panel
 * (ctx.ui.custom overlay); every other host gets a text-only `showStatus`
 * dump. This module adds a third surface: a live status widget registered
 * through the additive `setWidgetData` channel — `kind: "pi-mcp-status"` —
 * that rich hosts render as an MCP status card, plus plain-text `setWidget`
 * lines as the universal fallback.
 *
 * The publisher is driven by MCP_STATUS_EVENT snapshots (see mcp-status.ts):
 * every connection change re-registers the widget, so the card is live.
 * `setWidgetData` is optional-chained so older pi hosts without the additive
 * method stay online; the lines alone remain a complete display.
 */

import type { McpStatusSnapshot, McpServerStatusSnapshot } from "./types.ts";

export const MCP_GUI_WIDGET_KEY = "pi-mcp-status";

/** Minimal UI surface this module needs; structurally compatible with
 * ExtensionUIContext across pi versions (setWidgetData is additive). */
export interface McpGuiUi {
	setWidget(
		key: string,
		content: string[] | undefined,
		options?: { placement?: "aboveEditor" | "belowEditor" },
	): void;
	setWidgetData?(key: string, data: Record<string, unknown> | undefined): void;
}

export interface McpGuiPayload {
	kind: "pi-mcp-status";
	version: 1;
	servers: Array<{
		name: string;
		status: McpServerStatusSnapshot["status"];
		toolCount: number;
		resourceCount?: number;
		disabled: boolean;
		failedAgoSeconds?: number;
	}>;
	totals: {
		servers: number;
		connected: number;
		enabled: number;
		disabled: number;
		tools: number;
		resources: number;
	};
}

/** Status glyphs for the plain-text fallback lines. */
const STATUS_GLYPH: Record<McpServerStatusSnapshot["status"], string> = {
	connected: "●",
	"needs-auth": "⚑",
	failed: "⚠",
	cached: "◔",
	disabled: "⊘",
	"not-connected": "○",
};

function formatFailedAgo(seconds: number): string {
	if (seconds < 60) return `${seconds}s ago`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
	return `${Math.floor(seconds / 3600)}h ago`;
}

/** Build the structured GUI payload plus plain-text fallback lines. */
export function buildMcpGuiPayload(snapshot: McpStatusSnapshot): {
	data: McpGuiPayload;
	lines: string[];
} {
	const servers = snapshot.servers.map((server) => ({
		name: server.name,
		status: server.status,
		toolCount: server.toolCount,
		...(server.resourceCount !== undefined ? { resourceCount: server.resourceCount } : {}),
		disabled: server.disabled,
		...(server.failedAgoSeconds !== undefined ? { failedAgoSeconds: server.failedAgoSeconds } : {}),
	}));

	const enabled = snapshot.servers.length - snapshot.disabledCount;
	const heading =
		enabled === 0
			? `MCP — ${snapshot.servers.length} servers disabled`
			: `MCP ${snapshot.connectedCount}/${enabled} connected · ${snapshot.totalTools} tools`;

	const lines: string[] = [heading];
	for (const server of snapshot.servers) {
		const glyph = STATUS_GLYPH[server.status] ?? "○";
		const parts: string[] = [server.name];
		if (server.toolCount > 0) parts.push(`${server.toolCount} tools`);
		if (server.status === "failed" && server.failedAgoSeconds !== undefined) {
			parts.push(`failed ${formatFailedAgo(server.failedAgoSeconds)}`);
		}
		if (server.status === "needs-auth") parts.push("needs auth");
		if (server.status === "disabled") parts.push("disabled");
		if (server.status === "cached") parts.push("cached");
		lines.push(`${glyph} ${parts.join(" — ")}`);
	}

	return {
		data: {
			kind: "pi-mcp-status",
			version: 1,
			servers,
			totals: {
				servers: snapshot.servers.length,
				connected: snapshot.connectedCount,
				enabled,
				disabled: snapshot.disabledCount,
				tools: snapshot.totalTools,
				resources: snapshot.totalResources,
			},
		},
		lines,
	};
}

/** Register the widget for a status snapshot; clears it when no servers exist. */
export function publishMcpGuiWidget(ui: McpGuiUi, snapshot: McpStatusSnapshot | undefined): void {
	if (!snapshot || snapshot.servers.length === 0) {
		clearMcpGuiWidget(ui);
		return;
	}
	const { data, lines } = buildMcpGuiPayload(snapshot);
	ui.setWidget(MCP_GUI_WIDGET_KEY, lines, { placement: "aboveEditor" });
	ui.setWidgetData?.(MCP_GUI_WIDGET_KEY, data as unknown as Record<string, unknown>);
}

/** Remove the widget from every channel. */
export function clearMcpGuiWidget(ui: McpGuiUi): void {
	ui.setWidget(MCP_GUI_WIDGET_KEY, undefined);
	ui.setWidgetData?.(MCP_GUI_WIDGET_KEY, undefined);
}
