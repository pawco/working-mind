import type { McpEnvVarDef, UserConfig } from '../config.js';
import type { McpRegistry } from '../mcp/registry.js';
import type { AgentInstance } from '../registry.js';
import type { AgentConfig } from '../types.js';
import type { ProviderErrorCategory } from './provider-error.js';

export interface HistoryEntry {
	id: number;
	role:
		| 'user'
		| 'assistant'
		| 'tool_call'
		| 'tool_result'
		| 'thinking'
		| 'error';
	content: string;
	name?: string;
	exitCode?: number;
	parentId?: number;
	streaming?: boolean;
	startTime?: number;
	endTime?: number;
	plainText?: boolean;
	costInfo?: { promptTokens: number; completionTokens: number; cost: number };
	errorCategory?: ProviderErrorCategory;
	errorSuggestion?: string;
	errorCanRetry?: boolean;
}

export interface CommandContext {
	args: string;
	agent: AgentInstance;
	config: AgentConfig;
	mcpRegistry?: McpRegistry;
	setHistory: (updater: (h: HistoryEntry[]) => HistoryEntry[]) => void;
	setInput: (input: string) => void;
	exit: () => void;
	activateSkill: (name: string) => string | null;
	deactivateSkill: (name: string) => void;
	setPersona?: (persona: string) => void;
	setCustomPrompt?: (promptText: string) => void;
	getUserConfig?: () => UserConfig | undefined;
	writeUserConfig?: (config: UserConfig) => void;
}

export type CommandResult =
	| { type: 'message'; content: string; plainText?: boolean }
	| { type: 'none' }
	| {
			type: 'reconnect-server';
			serverName: string;
			requiredEnvVars: McpEnvVarDef[];
	  }
	| { type: 'trigger-agent'; content: string; allowedTools?: string[] }
	| {
			type: 'reconnect-memory-store';
			storeName: string;
			deletedStore?: string;
			deletedEntityCount?: number;
			deletedObsCount?: number;
	  }
	| { type: 'open-memory-wizard' }
	| { type: 'add-pack-agent'; packName: string }
	| { type: 'confirm'; message: string; command: string; args: string };

export interface SlashCommand {
	name: string;
	description: string;
	usage?: string;
	allowedTools?: string[];
	requiresConfirmation?: boolean;
	handler: (ctx: CommandContext) => CommandResult | Promise<CommandResult>;
}
