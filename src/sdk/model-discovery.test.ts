import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
	clearDiscoveryCache,
	fetchRemoteModels,
	mergeModels,
	getMergedModels,
	type DiscoveredModel,
} from './model-discovery.js';
import type { ModelEntry, ProviderEntry } from './provider-registry.js';

const mockProvider: ProviderEntry = {
	id: 'test-provider',
	displayName: 'Test Provider',
	baseUrl: 'https://api.test.com/v1',
	apiFormat: 'openai',
	envVar: 'TEST_API_KEY',
	needsApiKey: true,
	canValidate: true,
	modelIdFormat: 'full',
	modelPrefixes: [],
	isPrimary: true,
	authStyle: 'bearer',
	website: 'https://test.com',
	models: [
		{
			id: 'test/model-a',
			displayName: 'Model A',
			contextWindow: 128000,
			inputPricePer1M: 1.0,
			outputPricePer1M: 5.0,
			supportsReasoning: false,
			supportsToolCalling: true,
			aliases: ['a'],
		},
		{
			id: 'test/model-b',
			displayName: 'Model B',
			contextWindow: 200000,
			inputPricePer1M: 2.0,
			outputPricePer1M: 10.0,
			supportsReasoning: true,
			supportsToolCalling: true,
		},
	],
};

describe('mergeModels', () => {
	it('returns curated models when no discovered models', () => {
		const result = mergeModels(mockProvider.models, []);
		expect(result).toEqual(mockProvider.models);
	});

	it('appends discovered models not in curated list', () => {
		const discovered: DiscoveredModel[] = [
			{ id: 'test/model-c', contextLength: 500000 },
			{ id: 'test/model-d' },
		];
		const result = mergeModels(mockProvider.models, discovered);
		expect(result).toHaveLength(4);
		expect(result[2].id).toBe('test/model-c');
		expect(result[2].contextWindow).toBe(500000);
		expect(result[3].id).toBe('test/model-d');
		expect(result[3].contextWindow).toBe(128000);
	});

	it('does not duplicate curated models', () => {
		const discovered: DiscoveredModel[] = [
			{ id: 'test/model-a' },
			{ id: 'test/model-b' },
		];
		const result = mergeModels(mockProvider.models, discovered);
		expect(result).toHaveLength(2);
		expect(result[0].displayName).toBe('Model A');
		expect(result[1].displayName).toBe('Model B');
	});

	it('does not duplicate models matching curated alias', () => {
		const discovered: DiscoveredModel[] = [{ id: 'a' }];
		const result = mergeModels(mockProvider.models, discovered);
		expect(result).toHaveLength(2);
	});

	it('extracts display name from id with slash', () => {
		const discovered: DiscoveredModel[] = [{ id: 'org/fancy-model-v2' }];
		const result = mergeModels(mockProvider.models, discovered);
		expect(result[2].displayName).toBe('fancy-model-v2');
	});

	it('uses discovered pricing when available', () => {
		const discovered: DiscoveredModel[] = [
			{ id: 'test/model-c', inputPricePer1M: 0.5, outputPricePer1M: 2.5 },
		];
		const result = mergeModels(mockProvider.models, discovered);
		expect(result[2].inputPricePer1M).toBe(0.5);
		expect(result[2].outputPricePer1M).toBe(2.5);
	});

	it('defaults tool calling to true for remote models', () => {
		const discovered: DiscoveredModel[] = [{ id: 'test/new-model' }];
		const result = mergeModels(mockProvider.models, discovered);
		expect(result[2].supportsToolCalling).toBe(true);
		expect(result[2].supportsReasoning).toBe(false);
	});
});

describe('fetchRemoteModels', () => {
	beforeEach(() => {
		clearDiscoveryCache();
	});

	it('returns empty for provider without canValidate', () => {
		const localProvider: ProviderEntry = {
			...mockProvider,
			canValidate: false,
		};
		const result = fetchRemoteModels(localProvider, 'test-key');
		expect(result).resolves.toEqual([]);
	});

	it('returns empty for provider without needsApiKey', () => {
		const localProvider: ProviderEntry = {
			...mockProvider,
			needsApiKey: false,
			canValidate: false,
		};
		const result = fetchRemoteModels(localProvider, 'test-key');
		expect(result).resolves.toEqual([]);
	});

	it('parses OpenAI-format response', async () => {
		const mockResponse = {
			object: 'list',
			data: [
				{ id: 'gpt-5', object: 'model', owned_by: 'openai' },
				{ id: 'gpt-5-mini', object: 'model', owned_by: 'openai' },
			],
		};
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(mockResponse),
		} as Response);

		const result = await fetchRemoteModels(mockProvider, 'test-key');
		expect(result).toHaveLength(2);
		expect(result[0].id).toBe('gpt-5');
		expect(result[1].id).toBe('gpt-5-mini');

		fetchSpy.mockRestore();
	});

	it('parses OpenRouter-format response with pricing', async () => {
		const mockResponse = {
			object: 'list',
			data: [
				{
					id: 'anthropic/claude-sonnet',
					object: 'model',
					owned_by: 'anthropic',
					context_length: 200000,
					pricing: { prompt: '0.000003', completion: '0.000015' },
				},
			],
		};
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(mockResponse),
		} as Response);

		const result = await fetchRemoteModels(mockProvider, 'test-key');
		expect(result).toHaveLength(1);
		expect(result[0].contextLength).toBe(200000);
		expect(result[0].inputPricePer1M).toBeCloseTo(3.0);
		expect(result[0].outputPricePer1M).toBeCloseTo(15.0);

		fetchSpy.mockRestore();
	});

	it('returns empty on non-ok response', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: false,
			status: 401,
		} as Response);

		const result = await fetchRemoteModels(mockProvider, 'test-key');
		expect(result).toEqual([]);

		fetchSpy.mockRestore();
	});

	it('returns empty on network error', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
			new Error('Network error'),
		);

		const result = await fetchRemoteModels(mockProvider, 'test-key');
		expect(result).toEqual([]);

		fetchSpy.mockRestore();
	});

	it('uses cache on second call', async () => {
		const mockResponse = {
			object: 'list',
			data: [{ id: 'cached-model', object: 'model' }],
		};
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(mockResponse),
		} as Response);

		await fetchRemoteModels(mockProvider, 'test-key');
		await fetchRemoteModels(mockProvider, 'test-key');
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		fetchSpy.mockRestore();
	});
});

describe('clearDiscoveryCache', () => {
	beforeEach(() => {
		clearDiscoveryCache();
	});

	it('clears specific provider cache', async () => {
		const mockResponse = {
			object: 'list',
			data: [{ id: 'model-x', object: 'model' }],
		};
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(mockResponse),
		} as Response);

		await fetchRemoteModels(mockProvider, 'test-key');
		clearDiscoveryCache('test-provider');
		await fetchRemoteModels(mockProvider, 'test-key');
		expect(fetchSpy).toHaveBeenCalledTimes(2);

		fetchSpy.mockRestore();
	});

	it('clears all cache', async () => {
		const mockResponse = {
			object: 'list',
			data: [{ id: 'model-x', object: 'model' }],
		};
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(mockResponse),
		} as Response);

		await fetchRemoteModels(mockProvider, 'test-key');
		clearDiscoveryCache();
		await fetchRemoteModels(mockProvider, 'test-key');
		expect(fetchSpy).toHaveBeenCalledTimes(2);

		fetchSpy.mockRestore();
	});
});
