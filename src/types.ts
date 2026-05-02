import type { UserConfig } from './config.js';
import type { McpRegistry } from './mcp/registry.js';
import type { ToolPack } from './sdk/tool.js';

export interface AgentConfig {
	model: string;
	apiKey?: string;
	baseUrl?: string;
	nonInteractive?: boolean;
	initialPrompt?: string;
	maxTurns?: number;
	autoApprove?: boolean;
	persona?: string;
	noThinking?: boolean;
	packs: ToolPack[];
	userConfig?: UserConfig;
	mcpRegistry?: McpRegistry;
	systemPrompt?: string;
}
