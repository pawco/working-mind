import { describe, expect, it } from 'vitest';
import {
	findModel,
	findProvider,
	getAllModelsSorted,
	getProviderModels,
	PROVIDERS,
	resolveAlias,
} from './provider-registry.js';

describe('PROVIDERS catalog', () => {
	it('has 9 providers', () => {
		expect(PROVIDERS).toHaveLength(9);
	});

	it('each provider has required fields', () => {
		for (const p of PROVIDERS) {
			expect(p.id).toBeTruthy();
			expect(p.displayName).toBeTruthy();
			expect(p.baseUrl).toBeTruthy();
			expect(['openai', 'anthropic', 'ollama']).toContain(p.apiFormat);
			expect(p.models.length).toBeGreaterThan(0);
			expect(p.website).toBeTruthy();
		}
	});

	it('provider IDs are unique', () => {
		const ids = PROVIDERS.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	const expectedIds = [
		'openrouter',
		'openai',
		'anthropic',
		'together',
		'groq',
		'deepseek',
		'gemini',
		'local-fast',
		'ollama',
	];
	it.each(expectedIds)('includes provider %s', (id) => {
		expect(PROVIDERS.some((p) => p.id === id)).toBe(true);
	});

	it('openrouter has 16 models', () => {
		const or = PROVIDERS.find((p) => p.id === 'openrouter') as (typeof PROVIDERS)[number];
		expect(or.models.length).toBe(16);
	});

	it('ollama has no envVar', () => {
		const ollama = PROVIDERS.find((p) => p.id === 'ollama') as (typeof PROVIDERS)[number];
		expect(ollama.envVar).toBe('');
	});

	it('anthropic uses anthropic apiFormat', () => {
		const anthropic = PROVIDERS.find((p) => p.id === 'anthropic') as (typeof PROVIDERS)[number];
		expect(anthropic.apiFormat).toBe('anthropic');
	});

	it('all other providers use openai or ollama apiFormat', () => {
		const nonAnthropic = PROVIDERS.filter((p) => p.id !== 'anthropic');
		for (const p of nonAnthropic) {
			expect(['openai', 'ollama']).toContain(p.apiFormat);
		}
	});

	it('model aliases exist for popular models', () => {
		const sonnet = PROVIDERS.find((p) => p.id === 'anthropic')?.models.find(
			(m) => m.id === 'claude-sonnet-4-6',
		);
		expect(sonnet?.aliases).toContain('sonnet');
	});
});

describe('resolveAlias', () => {
	it('resolves tier aliases', () => {
		expect(resolveAlias('fast')).toContain('groq/');
		expect(resolveAlias('best')).toContain('anthropic/');
		expect(resolveAlias('cheap')).toContain('deepseek/');
		expect(resolveAlias('local')).toContain('ollama/');
		expect(resolveAlias('local-fast')).toContain('local-fast/');
		expect(resolveAlias('smart')).toContain('deepseek/');
	});

	it('resolves model aliases', () => {
		expect(resolveAlias('sonnet')).toBe('anthropic/claude-sonnet-4-6');
		expect(resolveAlias('opus')).toBe('anthropic/claude-opus-4-7');
		expect(resolveAlias('haiku')).toBe('anthropic/claude-haiku-4-5');
		expect(resolveAlias('gpt5')).toBe('openai/gpt-5.4');
		expect(resolveAlias('o3')).toBe('openai/o3');
		expect(resolveAlias('flash')).toBe('gemini/gemini-2.5-flash');
		expect(resolveAlias('ds4')).toBe('deepseek/deepseek-v4-flash');
	});

	it('returns spec unchanged if not an alias', () => {
		expect(resolveAlias('openai/gpt-5.4')).toBe('openai/gpt-5.4');
		expect(resolveAlias('custom-model')).toBe('custom-model');
	});
});

describe('findProvider', () => {
	it('finds existing provider', () => {
		expect(findProvider('openai')?.displayName).toBe('OpenAI');
		expect(findProvider('anthropic')?.displayName).toBe('Anthropic');
	});

	it('returns undefined for unknown provider', () => {
		expect(findProvider('nonexistent')).toBeUndefined();
	});
});

describe('findModel', () => {
	it('finds model by id', () => {
		const model = findModel('openai', 'gpt-5.4-mini');
		expect(model?.displayName).toBe('GPT-5.4 Mini');
	});

	it('finds model by alias', () => {
		const model = findModel('anthropic', 'sonnet');
		expect(model?.id).toBe('claude-sonnet-4-6');
	});

	it('returns undefined for unknown model', () => {
		expect(findModel('openai', 'nonexistent')).toBeUndefined();
	});
});

describe('getProviderModels', () => {
	it('returns models for a provider', () => {
		const models = getProviderModels('openai');
		expect(models.length).toBeGreaterThan(0);
	});

	it('returns empty for unknown provider', () => {
		expect(getProviderModels('nonexistent')).toHaveLength(0);
	});
});

describe('getAllModelsSorted', () => {
	it('returns all models sorted by output price', () => {
		const all = getAllModelsSorted();
		expect(all.length).toBeGreaterThan(0);
		for (let i = 1; i < all.length; i++) {
			expect(all[i].model.outputPricePer1M).toBeGreaterThanOrEqual(
				all[i - 1].model.outputPricePer1M,
			);
		}
	});

	it('includes ollama models with price 0', () => {
		const all = getAllModelsSorted();
		const ollamaModels = all.filter((e) => e.provider.id === 'ollama');
		expect(ollamaModels.length).toBeGreaterThan(0);
		for (const e of ollamaModels) {
			expect(e.model.outputPricePer1M).toBe(0);
		}
	});
});
