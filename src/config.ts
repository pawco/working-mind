import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import stripJsonComments from 'strip-json-comments';

import { loadProviders } from './sdk/provider-loader.js';

const CONFIG_DIR = join(homedir(), '.openexplorer');
const CONFIG_FILE = join(CONFIG_DIR, 'config.jsonc');

export interface UserProviderConfig {
	apiKey?: string;
	baseUrl?: string;
}

export interface CustomProviderEntry {
	displayName: string;
	baseUrl: string;
	apiFormat: 'openai' | 'anthropic';
	envVar?: string;
	models?: { id: string; displayName?: string; contextWindow?: number }[];
}

export interface McpEnvVarDef {
	name: string;
	label: string;
	required: boolean;
	sensitive?: boolean;
	hint?: string;
}

export interface McpServerConfig {
	type: 'local' | 'remote';
	url?: string;
	command?: string[];
	env?: Record<string, string>;
	headers?: Record<string, string>;
	enabled?: boolean;
	requiredEnvVars?: McpEnvVarDef[];
}

export interface UserConfig {
	defaultModel?: string;
	providers?: Record<string, UserProviderConfig>;
	systemPrompts?: Record<string, string>;
	agents?: {
		maxTurns?: number;
		autoApprove?: boolean;
		noThinking?: boolean;
		maxTokens?: number;
		thinkingBudget?: number;
		permissions?: {
			destructive?: 'allow' | 'deny' | 'ask';
			longRunning?: 'allow' | 'deny' | 'ask';
			normal?: 'allow' | 'deny' | 'ask';
		};
	};
	customProviders?: Record<string, CustomProviderEntry>;
	mcpServers?: Record<string, McpServerConfig>;
	lastMemoryStore?: string;
}

function buildDefaultProviders(): Record<string, UserProviderConfig> {
	const providers: Record<string, UserProviderConfig> = {};
	const data = loadProviders();
	for (const p of data.providers) {
		if (p.needsApiKey && p.envVar) {
			providers[p.id] = { apiKey: `env:${p.envVar}` };
		} else {
			providers[p.id] = {};
		}
	}
	return providers;
}

const DEFAULT_CONFIG: UserConfig = {
	defaultModel: undefined,
	providers: buildDefaultProviders(),
	systemPrompts: {
		default: `You are OpenExplorer, a reasoning agent. Think carefully and provide thorough answers.
When you use tools, explain what you're doing and why.
If a tool fails, analyze the error and suggest fixes.`,
	},
	agents: {
		maxTurns: 20,
		autoApprove: false,
		noThinking: false,
	},
};

export function getConfigDir(): string {
	return CONFIG_DIR;
}

export function getConfigPath(): string {
	return CONFIG_FILE;
}

export function loadUserConfig(): UserConfig {
	if (!existsSync(CONFIG_FILE)) return cloneConfig(DEFAULT_CONFIG);
	try {
		const raw = readFileSync(CONFIG_FILE, 'utf-8');
		const json = stripJsonComments(raw);
		const parsed = JSON.parse(json) as Partial<UserConfig>;
		return deepMerge(DEFAULT_CONFIG, parsed);
	} catch {
		return cloneConfig(DEFAULT_CONFIG);
	}
}

export function writeUserConfig(config: UserConfig): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true });
	}
	const json = JSON.stringify(config, null, 2);
	writeFileSync(CONFIG_FILE, json);
	try {
		chmodSync(CONFIG_FILE, 0o600);
	} catch {
		// chmod may fail on some platforms, not critical
	}
}

function deepMerge(
	base: UserConfig,
	override: Partial<UserConfig>,
): UserConfig {
	const result: UserConfig = cloneConfig(base);
	if (override.defaultModel !== undefined)
		result.defaultModel = override.defaultModel;
	if (override.providers) {
		result.providers = Object.fromEntries(
			Object.entries({ ...base.providers, ...override.providers }).map(
				([k, v]) => [k, { ...(base.providers?.[k] ?? {}), ...v }],
			),
		);
	}
	if (override.systemPrompts) {
		result.systemPrompts = { ...base.systemPrompts, ...override.systemPrompts };
	}
	if (override.agents) {
		result.agents = { ...base.agents, ...override.agents };
	}
	if (override.customProviders) {
		result.customProviders = {
			...base.customProviders,
			...override.customProviders,
		};
	}
	if (override.mcpServers) {
		result.mcpServers = { ...(base.mcpServers || {}), ...override.mcpServers };
	}
	if (override.lastMemoryStore !== undefined) {
		result.lastMemoryStore = override.lastMemoryStore;
	}
	return result;
}

function cloneConfig(cfg: UserConfig): UserConfig {
	return JSON.parse(JSON.stringify(cfg));
}
