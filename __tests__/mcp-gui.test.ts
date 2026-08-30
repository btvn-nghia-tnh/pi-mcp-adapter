import { describe, expect, it, vi } from "vitest";
import {
	buildMcpGuiPayload,
	clearMcpGuiWidget,
	MCP_GUI_WIDGET_KEY,
	publishMcpGuiOverlay,
	type McpGuiUi,
} from "../mcp-gui.ts";
import type { McpStatusSnapshot } from "../types.ts";

function snapshot(overrides: Partial<McpStatusSnapshot> = {}): McpStatusSnapshot {
	return {
		version: 1 as const,
		servers: [],
		totalTools: 0,
		totalResources: 0,
		connectedCount: 0,
		disabledCount: 0,
		...overrides,
	} as McpStatusSnapshot;
}

function mockUi() {
	return {
		setWidget: vi.fn(),
		setWidgetData: vi.fn(),
	} satisfies McpGuiUi & Record<string, ReturnType<typeof vi.fn>>;
}

describe("buildMcpGuiPayload", () => {
	it("builds a pi-mcp-status payload with totals", () => {
		const snap = snapshot({
			servers: [
				{ name: "alpha", status: "connected", toolCount: 12, resourceCount: 3, disabled: false, listenState: "active" },
				{ name: "beta", status: "failed", toolCount: 0, disabled: false, failedAgoSeconds: 45, listenState: "disconnected" },
				{ name: "gamma", status: "disabled", toolCount: 0, disabled: true, listenState: "disconnected" },
			],
			totalTools: 12,
			totalResources: 3,
			connectedCount: 1,
			disabledCount: 1,
		});
		const { data, lines } = buildMcpGuiPayload(snap);

		expect(data.kind).toBe("pi-mcp-status");
		expect(data.version).toBe(1);
		expect(data.servers).toHaveLength(3);
		expect(data.servers[0]).toMatchObject({ name: "alpha", status: "connected", toolCount: 12, resourceCount: 3 });
		expect(data.servers[1]).toMatchObject({ status: "failed", failedAgoSeconds: 45 });
		expect(data.totals).toEqual({
			servers: 3,
			connected: 1,
			enabled: 2,
			disabled: 1,
			tools: 12,
			resources: 3,
		});

		expect(lines[0]).toBe("MCP 1/2 connected · 12 tools");
		expect(lines[1]).toBe("● alpha — 12 tools");
		expect(lines[2]).toContain("⚠ beta — failed 45s ago");
		expect(lines[3]).toContain("⊘ gamma — disabled");
	});

	it("formats long failure ages in minutes", () => {
		const snap = snapshot({
			servers: [
				{ name: "slow", status: "failed", toolCount: 0, disabled: false, failedAgoSeconds: 150, listenState: "disconnected" },
			],
		});
		const { lines } = buildMcpGuiPayload(snap);
		expect(lines[1]).toContain("failed 2m ago");
	});

	it("marks needs-auth and cached servers in the fallback lines", () => {
		const snap = snapshot({
			servers: [
				{ name: "authful", status: "needs-auth", toolCount: 0, disabled: false, listenState: "disconnected" },
				{ name: "cachedonly", status: "cached", toolCount: 5, disabled: false, listenState: "disconnected" },
			],
		});
		const { lines } = buildMcpGuiPayload(snap);
		expect(lines[1]).toContain("⚑ authful — needs auth");
		expect(lines[2]).toContain("◔ cachedonly — 5 tools — cached");
	});

	it("heading covers the all-disabled case", () => {
		const snap = snapshot({
			servers: [{ name: "off", status: "disabled", toolCount: 0, disabled: true, listenState: "disconnected" }],
			disabledCount: 1,
		});
		const { lines, data } = buildMcpGuiPayload(snap);
		expect(lines[0]).toBe("MCP — 1 servers disabled");
		expect(data.totals.enabled).toBe(0);
	});

	it("is JSON-serializable", () => {
		const snap = snapshot({
			servers: [
				{ name: "a", status: "connected", toolCount: 1, disabled: false, listenState: "active" },
			],
		});
		const { data } = buildMcpGuiPayload(snap);
		expect(() => JSON.stringify(data)).not.toThrow();
	});
});

describe("publishMcpGuiOverlay", () => {
	it("registers an overlay payload with display, title, and closeCommand", () => {
		const ui = mockUi();
		const snap = snapshot({
			servers: [{ name: "alpha", status: "connected", toolCount: 2, disabled: false, listenState: "active" }],
			connectedCount: 1,
		});
		publishMcpGuiOverlay(ui, snap, { title: "MCP servers", closeCommand: "/mcp" });

		expect(ui.setWidgetData).toHaveBeenCalledWith(
			MCP_GUI_WIDGET_KEY,
			expect.objectContaining({
				kind: "pi-mcp-status",
				display: "overlay",
				title: "MCP servers",
				closeCommand: "/mcp",
			}),
		);
	});

	it("does NOT dock lines — the overlay channel is setWidgetData only", () => {
		const ui = mockUi();
		const snap = snapshot({
			servers: [{ name: "alpha", status: "connected", toolCount: 1, disabled: false, listenState: "active" }],
		});
		publishMcpGuiOverlay(ui, snap, { title: "MCP", closeCommand: "/mcp" });
		expect(ui.setWidget).not.toHaveBeenCalled();
	});

	it("clears both channels when the snapshot has no servers", () => {
		const ui = mockUi();
		publishMcpGuiOverlay(ui, snapshot(), { title: "MCP", closeCommand: "/mcp" });
		expect(ui.setWidget).toHaveBeenCalledWith(MCP_GUI_WIDGET_KEY, undefined);
		expect(ui.setWidgetData).toHaveBeenCalledWith(MCP_GUI_WIDGET_KEY, undefined);
	});

	it("clears both channels when the snapshot is undefined", () => {
		const ui = mockUi();
		publishMcpGuiOverlay(ui, undefined, { title: "MCP", closeCommand: "/mcp" });
		expect(ui.setWidget).toHaveBeenCalledWith(MCP_GUI_WIDGET_KEY, undefined);
		expect(ui.setWidgetData).toHaveBeenCalledWith(MCP_GUI_WIDGET_KEY, undefined);
	});

	it("tolerates hosts without setWidgetData (older pi versions)", () => {
		const ui = mockUi();
		delete (ui as Partial<typeof ui>).setWidgetData;
		const snap = snapshot({
			servers: [{ name: "alpha", status: "connected", toolCount: 1, disabled: false, listenState: "active" }],
		});
		expect(() => publishMcpGuiOverlay(ui as McpGuiUi, snap, { title: "MCP", closeCommand: "/mcp" })).not.toThrow();
	});
});

describe("clearMcpGuiWidget", () => {
	it("removes the widget from every channel", () => {
		const ui = mockUi();
		clearMcpGuiWidget(ui);
		expect(ui.setWidget).toHaveBeenCalledWith(MCP_GUI_WIDGET_KEY, undefined);
		expect(ui.setWidgetData).toHaveBeenCalledWith(MCP_GUI_WIDGET_KEY, undefined);
	});
});
