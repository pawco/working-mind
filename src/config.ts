import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { z, ZodError } from 'zod';
import stripJsonComments from 'strip-json-comments';

import { getConfigDir as resolveConfigDir } from './paths.js';
import {
	type CustomProviderEntry,
	type McpEnvVarDef,
	type McpServerConfig,
	type UserConfig,
	type UserProviderConfig,
	formatZodError,
	partialUserConfigSchema,
} from './schemas.js';
import { loadProviders } from './sdk/provider-loader.js';

export type {
	UserConfig,
	UserProviderConfig,
	CustomProviderEntry,
	McpEnvVarDef,
	McpServerConfig,
};

const CONFIG_DIR = resolveConfigDir();
const CONFIG_FILE = join(CONFIG_DIR, 'config.jsonc');

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
		default: `You are Working Mind, a reasoning agent. Think carefully and provide thorough answers.
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
		const parsed = JSON.parse(json);
		const validated = partialUserConfigSchema.safeParse(parsed);
		if (!validated.success) {
			console.error(
				`Warning: ${formatZodError('Invalid config.jsonc', validated.error)}`,
			);
			console.error('Falling back to defaults for invalid fields.');
			return cloneConfig(DEFAULT_CONFIG);
		}
		return deepMerge(DEFAULT_CONFIG, validated.data);
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
	override: z.infer<typeof partialUserConfigSchema>,
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
