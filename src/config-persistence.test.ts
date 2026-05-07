import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { modelCmd } from './builtins/index.js';
import {
	getConfigPath,
	loadUserConfig,
	type UserConfig,
	writeUserConfig,
} from './config.js';
import type { CommandResult } from './sdk/command.js';
import { findProvider, resolveAlias } from './sdk/provider-registry.js';
import { clearApiKeyCache, resolveApiKey } from './sdk/provider-resolve.js';

const CONFIG_FILE = getConfigPath();

let savedConfig: string | undefined;

function backupRealConfig(): void {
	if (existsSync(CONFIG_FILE)) {
		savedConfig = readFileSync(CONFIG_FILE, 'utf-8');
	} else {
		savedConfig = undefined;
	}
	if (existsSync(CONFIG_FILE)) rmSync(CONFIG_FILE);
}

function restoreRealConfig(): void {
	if (existsSync(CONFIG_FILE)) rmSync(CONFIG_FILE);
	if (savedConfig !== undefined) {
		mkdirSync(join(homedir(), '.wmind'), { recursive: true });
		writeFileSync(CONFIG_FILE, savedConfig);
	}
	savedConfig = undefined;
}

function makeModelCtx(modelArg: string, overrides: any = {}) {
	let userConfig: UserConfig | undefined =
		overrides.userConfig || loadUserConfig();
	return {
		args: modelArg,
		agent: {
			messages: [] as any[],
			id: 'test',
			name: 'test',
			persona: '',
			systemPrompt: '',
			model: 'openrouter/anthropic/claude-sonnet-4-6',
			activeSkills: [],
			customPrompt: '',
		},
		config: {
			packs: [] as any[],
			model: 'openrouter/anthropic/claude-sonnet-4-6',
			apiKey: 'test-key',
			baseUrl: 'https://openrouter.ai/api/v1',
			userConfig,
			...overrides.config,
		},
		getUserConfig: () => userConfig,
		writeUserConfig: (uc: UserConfig) => {
			userConfig = uc;
			writeUserConfig(uc);
		},
		setHistory: () => {},
		setInput: () => {},
		exit: () => {},
		activateSkill: () => null as string | null,
		deactivateSkill: () => {},
	} as any;
}

describe('config persistence', () => {
	let origAnthropicKey: string | undefined;
	let origOpenrouterKey: string | undefined;
	beforeEach(() => {
		backupRealConfig();
		origAnthropicKey = process.env.ANTHROPIC_API_KEY;
		origOpenrouterKey = process.env.OPENROUTER_API_KEY;
		process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
		process.env.OPENROUTER_API_KEY = 'sk-or-test-key';
	});
	afterEach(() => {
		restoreRealConfig();
		if (origAnthropicKey !== undefined)
			process.env.ANTHROPIC_API_KEY = origAnthropicKey;
		else delete process.env.ANTHROPIC_API_KEY;
		if (origOpenrouterKey !== undefined)
			process.env.OPENROUTER_API_KEY = origOpenrouterKey;
		else delete process.env.OPENROUTER_API_KEY;
	});

	describe('loadUserConfig / writeUserConfig', () => {
		it('returns default when no config file exists', () => {
			const cfg = loadUserConfig();
			expect(cfg.agents?.maxTurns).toBe(20);
			expect(cfg.systemPrompts).toBeDefined();
			expect(cfg.providers).toBeDefined();
		});

		it('write then read round-trip preserves defaultModel', () => {
			const cfg: UserConfig = {
				defaultModel: 'openrouter/anthropic/claude-sonnet-4-6',
				providers: { openrouter: { apiKey: 'env:OPENROUTER_API_KEY' } },
				agents: { maxTurns: 20 },
			};
			writeUserConfig(cfg);
			const loaded = loadUserConfig();
			expect(loaded.defaultModel).toBe(
				'openrouter/anthropic/claude-sonnet-4-6',
			);
		});

		it('simulates restart: write model A, reload, write model B, reload', () => {
			writeUserConfig({
				defaultModel: 'ollama/llama3',
				providers: { ollama: {} },
				agents: { maxTurns: 15, autoApprove: true },
			});
			let reloaded = loadUserConfig();
			expect(reloaded.defaultModel).toBe('ollama/llama3');

			writeUserConfig({
				...reloaded,
				defaultModel: 'anthropic/claude-sonnet-4-6',
			});
			reloaded = loadUserConfig();
			expect(reloaded.defaultModel).toBe('anthropic/claude-sonnet-4-6');
			expect(reloaded.agents?.maxTurns).toBe(15);
		});

		it('deepMerge preserves existing config sections', () => {
			writeUserConfig({
				defaultModel: 'openrouter/test',
				providers: {
					openrouter: { apiKey: 'env:OPENROUTER_API_KEY' },
					ollama: {},
				},
				systemPrompts: { default: 'original' },
				agents: { maxTurns: 10 },
			});

			const loaded = loadUserConfig();
			expect(loaded.providers?.openrouter?.apiKey).toBe(
				'env:OPENROUTER_API_KEY',
			);
			expect(loaded.providers?.ollama).toBeDefined();
			expect(loaded.systemPrompts?.default).toBe('original');
			expect(loaded.agents?.maxTurns).toBe(10);
		});
	});

	describe('/model command persistence', () => {
		it('persists defaultModel to config when changing model', () => {
			const ctx = makeModelCtx('anthropic/claude-sonnet-4-6');
			modelCmd.handler(ctx);

			const loaded = loadUserConfig();
			expect(loaded.defaultModel).toBe('anthropic/claude-sonnet-4-6');
		});

		it('updates agent.model and config.model in memory', () => {
			const ctx = makeModelCtx('anthropic/claude-sonnet-4-6');
			modelCmd.handler(ctx);
			expect(ctx.agent.model).toBe('anthropic/claude-sonnet-4-6');
			expect(ctx.config.model).toBe('anthropic/claude-sonnet-4-6');
		});

		it('resolves provider model on switch', async () => {
			const ctx = makeModelCtx('anthropic/claude-sonnet-4-6');
			await modelCmd.handler(ctx);
			expect(ctx.agent.model).toBe('anthropic/claude-sonnet-4-6');
		});

		it('caches API key on switch', async () => {
			const ctx = makeModelCtx('anthropic/claude-sonnet-4-6');
			await modelCmd.handler(ctx);
			const provider = findProvider('anthropic');
			expect(provider && resolveApiKey(provider)).toBeTruthy();
		});

		it('resolves aliases before persisting', () => {
			const ctx = makeModelCtx('sonnet');
			modelCmd.handler(ctx);
			const resolved = resolveAlias('sonnet');
			expect(ctx.agent.model).toBe(resolved);
			const loaded = loadUserConfig();
			expect(loaded.defaultModel).toBe(resolved);
		});

		it('persistence survives simulated restart', () => {
			const ctx = makeModelCtx('anthropic/claude-sonnet-4-6');
			modelCmd.handler(ctx);

			const reloaded = loadUserConfig();
			expect(reloaded.defaultModel).toBe('anthropic/claude-sonnet-4-6');
		});

		it('gracefully handles missing getUserConfig/writeUserConfig', () => {
			const ctx = makeModelCtx('anthropic/claude-sonnet-4-6');
			delete ctx.getUserConfig;
			delete ctx.writeUserConfig;

			modelCmd.handler(ctx);
			expect(ctx.agent.model).toBe('anthropic/claude-sonnet-4-6');
			expect(ctx.config.model).toBe('anthropic/claude-sonnet-4-6');
		});

		it('rejects unknown provider', async () => {
			const ctx = makeModelCtx('fakeprovider/some-model');
			const result = (await modelCmd.handler(ctx)) as CommandResult & {
				content: string;
			};
			expect(result.content).toContain('Unknown provider');
			expect(ctx.agent.model).not.toBe('fakeprovider/some-model');
		});

		it('accepts any model for known provider (no catalog validation)', async () => {
			const ctx = makeModelCtx('anthropic/nonexistent-model-xyz');
			const result = (await modelCmd.handler(ctx)) as CommandResult & {
				content: string;
			};
			expect(result.content).toContain('Model changed to');
			expect(ctx.agent.model).toBe('anthropic/nonexistent-model-xyz');
		});

		it('rejects model with no API key', async () => {
			delete process.env.ANTHROPIC_API_KEY;
			clearApiKeyCache();
			const ctx = makeModelCtx('anthropic/claude-sonnet-4-6');
			const result = (await modelCmd.handler(ctx)) as CommandResult & {
				content: string;
			};
			expect(result.content).toContain('No API key');
			expect(ctx.agent.model).not.toBe('anthropic/claude-sonnet-4-6');
		});

		it('rejects bare unknown model without provider prefix', async () => {
			const ctx = makeModelCtx('totally-unknown-model-xyz');
			const result = (await modelCmd.handler(ctx)) as CommandResult & {
				content: string;
			};
			expect(result.content).toContain('Unknown model');
		});
	});

	describe('model persistence across multiple switches', () => {
		it('last /model call wins', () => {
			const ctx1 = makeModelCtx('anthropic/claude-sonnet-4-6');
			modelCmd.handler(ctx1);

			const ctx2 = makeModelCtx('ollama/llama3');
			modelCmd.handler(ctx2);

			const loaded = loadUserConfig();
			expect(loaded.defaultModel).toBe('ollama/llama3');
		});

		it('preserves other config fields when updating defaultModel', () => {
			writeUserConfig({
				defaultModel: 'openrouter/anthropic/claude-sonnet-4-6',
				providers: { openrouter: { apiKey: 'env:OPENROUTER_API_KEY' } },
				agents: { maxTurns: 30, autoApprove: false },
				systemPrompts: { default: 'Be helpful' },
			});

			const ctx = makeModelCtx('ollama/llama3', {
				userConfig: loadUserConfig(),
			});
			modelCmd.handler(ctx);

			const loaded = loadUserConfig();
			expect(loaded.defaultModel).toBe('ollama/llama3');
			expect(loaded.agents?.maxTurns).toBe(30);
			expect(loaded.systemPrompts?.default).toBe('Be helpful');
		});
	});

	describe('resolveApiKey for provider switching', () => {
		beforeEach(() => {
			clearApiKeyCache();
		});

		afterEach(() => {
			clearApiKeyCache();
		});

		it('resolves from env var for openrouter', () => {
			const orig = process.env.OPENROUTER_API_KEY;
			process.env.OPENROUTER_API_KEY = 'or-test-key';
			try {
				const provider = findProvider('openrouter');
				if (!provider) return;
				expect(resolveApiKey(provider, undefined)).toBe('or-test-key');
			} finally {
				if (orig !== undefined) process.env.OPENROUTER_API_KEY = orig;
				else delete process.env.OPENROUTER_API_KEY;
			}
		});

		it('returns empty string when no key available', () => {
			const orig1 = process.env.OPENROUTER_API_KEY;
			const orig2 = process.env.WMIND_API_KEY;
			delete process.env.OPENROUTER_API_KEY;
			delete process.env.WMIND_API_KEY;
			try {
				const provider = findProvider('openrouter');
				if (!provider) return;
				expect(resolveApiKey(provider, undefined)).toBe('');
			} finally {
				if (orig1 !== undefined) process.env.OPENROUTER_API_KEY = orig1;
				if (orig2 !== undefined) process.env.WMIND_API_KEY = orig2;
			}
		});

		it('resolves from config with env: prefix', () => {
			const orig = process.env.MY_CUSTOM_KEY;
			process.env.MY_CUSTOM_KEY = 'custom-key-value';
			try {
				const provider = findProvider('openrouter');
				if (!provider) return;
				const key = resolveApiKey(provider, {
					providers: { openrouter: { apiKey: 'env:MY_CUSTOM_KEY' } },
				});
				expect(key).toBe('custom-key-value');
			} finally {
				if (orig !== undefined) process.env.MY_CUSTOM_KEY = orig;
				else delete process.env.MY_CUSTOM_KEY;
			}
		});

		it('returns empty string for providers without API key requirement', () => {
			const provider = findProvider('ollama');
			if (!provider) return;
			expect(resolveApiKey(provider, undefined)).toBe('');
		});
	});
});
