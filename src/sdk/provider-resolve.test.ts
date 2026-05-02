import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UserConfig } from '../config.js';
import { PROVIDERS } from './provider-registry.js';
import {
	detectAvailableProviders,
	isOllamaModelAvailable,
	matchOllamaLocalModel,
	type OllamaModelInfo,
	probeOllama,
	resolveApiKey,
	resolveModelSpec,
	resolveOllamaModelName,
} from './provider-resolve.js';

describe('resolveModelSpec', () => {
	it('resolves provider/model format', () => {
		const result = resolveModelSpec('openai/gpt-5.4-mini');
		expect(result.provider.id).toBe('openai');
		expect(result.model?.id).toBe('gpt-5.4-mini');
	});

	it('resolves alias to full provider/model', () => {
		const result = resolveModelSpec('sonnet');
		expect(result.provider.id).toBe('anthropic');
		expect(result.model?.id).toBe('claude-sonnet-4-6');
	});

	it('resolves tier alias', () => {
		const result = resolveModelSpec('fast');
		expect(result.provider.id).toBe('groq');
	});

	it('resolves bare model name by inference', () => {
		const result = resolveModelSpec('claude-opus-4-7');
		expect(result.provider.id).toBe('anthropic');
	});

	it('resolves openrouter multi-slash model', () => {
		const result = resolveModelSpec('openrouter/anthropic/claude-sonnet-4.6');
		expect(result.provider.id).toBe('openrouter');
		expect(result.model?.id).toBe('anthropic/claude-sonnet-4.6');
	});

	it('returns adapter with correct format', () => {
		const openaiResult = resolveModelSpec('openai/gpt-5.4');
		expect(openaiResult.adapter.format).toBe('openai');

		const anthropicResult = resolveModelSpec('anthropic/claude-sonnet-4-6');
		expect(anthropicResult.adapter.format).toBe('anthropic');
	});

	it('ollama gets apiKey "local"', () => {
		const result = resolveModelSpec('ollama/qwen3-coder');
		expect(result.apiKey).toBe('local');
	});

	it('unknown provider falls back to openrouter', () => {
		const result = resolveModelSpec('unknown/some-model');
		expect(result.provider.id).toBe('openrouter');
	});

	it('resolves bare ollama model name by model ID lookup', () => {
		const result = resolveModelSpec('gemma4:e4b');
		expect(result.provider.id).toBe('ollama');
		expect(result.model?.id).toBe('gemma4:e4b');
	});

	it('resolves bare ollama model alias by model alias lookup', () => {
		const result = resolveModelSpec('gemma4');
		expect(result.provider.id).toBe('ollama');
	});
});

describe('resolveApiKey', () => {
	const origEnv = process.env;

	beforeEach(() => {
		process.env = { ...origEnv };
	});

	afterEach(() => {
		process.env = origEnv;
	});

	it('returns "local" for providers without api key need', () => {
		const local = {
			id: 'ollama',
			envVar: '',
			envVarAliases: [],
			needsApiKey: false,
		} as any;
		expect(resolveApiKey(local)).toBe('local');
	});

	it('reads from provider env var', () => {
		process.env.OPENAI_API_KEY = 'sk-test-123';
		const openai = {
			id: 'openai',
			envVar: 'OPENAI_API_KEY',
			envVarAliases: [],
			needsApiKey: true,
		} as any;
		expect(resolveApiKey(openai)).toBe('sk-test-123');
	});

	it('reads from env var alias', () => {
		process.env.OPENEXPLORER_GROQ_KEY = 'gq-test-456';
		const groq = {
			id: 'groq',
			envVar: 'GROQ_API_KEY',
			envVarAliases: ['OPENEXPLORER_GROQ_KEY'],
			needsApiKey: true,
		} as any;
		expect(resolveApiKey(groq)).toBe('gq-test-456');
	});

	it('falls back to OPENEXPLORER_API_KEY', () => {
		process.env.OPENEXPLORER_API_KEY = 'oe-test-789';
		const provider = {
			id: 'some-provider',
			envVar: 'SOME_API_KEY',
			envVarAliases: [],
			needsApiKey: true,
		} as any;
		expect(resolveApiKey(provider)).toBe('oe-test-789');
	});

	it('reads from config env: reference', () => {
		process.env.MY_CUSTOM_KEY = 'custom-key';
		const config: UserConfig = {
			providers: {
				'some-provider': { apiKey: 'env:MY_CUSTOM_KEY' },
			},
		};
		const provider = {
			id: 'some-provider',
			envVar: 'SOME_API_KEY',
			envVarAliases: [],
			needsApiKey: true,
		} as any;
		expect(resolveApiKey(provider, config)).toBe('custom-key');
	});

	it('returns empty string when no key found', () => {
		delete process.env.OPENAI_API_KEY;
		delete process.env.OPENEXPLORER_API_KEY;
		const openai = {
			id: 'openai',
			envVar: 'OPENAI_API_KEY',
			envVarAliases: [],
			needsApiKey: true,
		} as any;
		expect(resolveApiKey(openai)).toBe('');
	});
});

describe('detectAvailableProviders', () => {
	const origEnv = process.env;

	beforeEach(() => {
		process.env = { ...origEnv };
	});

	afterEach(() => {
		process.env = origEnv;
	});

	it('detects providers with API keys', () => {
		process.env.OPENAI_API_KEY = 'sk-test';
		process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
		const available = detectAvailableProviders();
		const ids = available.map((p) => p.id);
		expect(ids).toContain('openai');
		expect(ids).toContain('anthropic');
	});

	it('always includes providers without api key need', () => {
		const available = detectAvailableProviders();
		const ids = available.map((p) => p.id);
		const localProviders = PROVIDERS.filter((p) => !p.needsApiKey);
		for (const lp of localProviders) {
			expect(ids).toContain(lp.id);
		}
	});

	it('excludes providers without keys', () => {
		delete process.env.OPENAI_API_KEY;
		delete process.env.ANTHROPIC_API_KEY;
		delete process.env.OPENROUTER_API_KEY;
		delete process.env.TOGETHER_API_KEY;
		delete process.env.GROQ_API_KEY;
		delete process.env.DEEPSEEK_API_KEY;
		delete process.env.GEMINI_API_KEY;
		delete process.env.OPENEXPLORER_API_KEY;
		const available = detectAvailableProviders();
		const ids = available.map((p) => p.id);
		const expectedLocal = PROVIDERS.filter((p) => !p.needsApiKey).map(
			(p) => p.id,
		);
		expect(ids).toEqual(expectedLocal);
	});
});

describe('probeOllama', () => {
	it('returns not running when ollama is down', async () => {
		// This test just checks the shape; real Ollama may or may not be running
		const result = await probeOllama();
		expect(result).toHaveProperty('running');
		expect(result).toHaveProperty('models');
		expect(Array.isArray(result.models)).toBe(true);
	});
});

describe('isOllamaModelAvailable', () => {
	const localModels: OllamaModelInfo[] = [
		{
			name: 'gemma3:latest',
			size: 1e9,
			family: 'gemma',
			parameterSize: '4B',
			quantization: 'Q4_K_M',
		},
		{
			name: 'qwen3-coder:30b',
			size: 18e9,
			family: 'qwen2',
			parameterSize: '30B',
			quantization: 'Q4_K_M',
		},
		{
			name: 'deepseek-r1:8b',
			size: 5e9,
			family: 'qwen2',
			parameterSize: '8B',
			quantization: 'Q4_K_M',
		},
	];

	it('matches exact model name', () => {
		expect(isOllamaModelAvailable('gemma3:latest', localModels)).toBe(true);
	});

	it('matches without :latest suffix', () => {
		expect(isOllamaModelAvailable('gemma3', localModels)).toBe(true);
	});

	it('does not match family prefix — only exact or :latest', () => {
		expect(isOllamaModelAvailable('gemma3:4b', localModels)).toBe(false);
		expect(isOllamaModelAvailable('gemma3:27b', localModels)).toBe(false);
	});

	it('rejects completely different model', () => {
		expect(isOllamaModelAvailable('llama3:70b', localModels)).toBe(false);
	});

	it('returns false when no local models probed (Ollama not running)', () => {
		expect(isOllamaModelAvailable('anything', [])).toBe(false);
	});
});

describe('matchOllamaLocalModel', () => {
	const localModels: OllamaModelInfo[] = [
		{
			name: 'gemma3:latest',
			size: 1e9,
			family: 'gemma',
			parameterSize: '4B',
			quantization: 'Q4_K_M',
		},
		{
			name: 'qwen3-coder:30b',
			size: 18e9,
			family: 'qwen2',
			parameterSize: '30B',
			quantization: 'Q4_K_M',
		},
	];

	it('matches exact name', () => {
		const match = matchOllamaLocalModel('gemma3:latest', localModels);
		expect(match?.name).toBe('gemma3:latest');
	});

	it('matches without :latest', () => {
		const match = matchOllamaLocalModel('gemma3', localModels);
		expect(match?.name).toBe('gemma3:latest');
	});

	it('returns undefined for missing model', () => {
		const match = matchOllamaLocalModel('nonexistent', localModels);
		expect(match).toBeUndefined();
	});
});

describe('resolveOllamaModelName', () => {
	const localModels: OllamaModelInfo[] = [
		{
			name: 'gemma3:latest',
			size: 1e9,
			family: 'gemma',
			parameterSize: '4B',
			quantization: 'Q4_K_M',
		},
		{
			name: 'qwen3-coder:30b',
			size: 18e9,
			family: 'qwen2',
			parameterSize: '30B',
			quantization: 'Q4_K_M',
		},
		{
			name: 'deepseek-r1:8b',
			size: 5e9,
			family: 'qwen2',
			parameterSize: '8B',
			quantization: 'Q4_K_M',
		},
	];

	it('resolves to exact local model name', () => {
		expect(resolveOllamaModelName('gemma3:latest', localModels)).toBe(
			'gemma3:latest',
		);
	});

	it('resolves without :latest to local :latest', () => {
		expect(resolveOllamaModelName('gemma3', localModels)).toBe('gemma3:latest');
	});

	it('resolves curated name to largest local family match', () => {
		expect(resolveOllamaModelName('gemma3:27b', localModels)).toBe(
			'gemma3:latest',
		);
	});

	it('resolves curated qwen3-coder to local variant', () => {
		expect(resolveOllamaModelName('qwen3-coder', localModels)).toBe(
			'qwen3-coder:30b',
		);
	});

	it('resolves deepseek-r1 to local variant', () => {
		expect(resolveOllamaModelName('deepseek-r1', localModels)).toBe(
			'deepseek-r1:8b',
		);
	});

	it('returns original if no match at all', () => {
		expect(resolveOllamaModelName('nonexistent:model', localModels)).toBe(
			'nonexistent:model',
		);
	});

	it('returns original when no local models', () => {
		expect(resolveOllamaModelName('gemma3:27b', [])).toBe('gemma3:27b');
	});
});
