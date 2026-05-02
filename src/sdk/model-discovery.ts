import type { ModelEntry, ProviderEntry } from './provider-registry.js';
import { resolveApiKey } from './provider-resolve.js';
import type { UserConfig } from '../config.js';

export interface DiscoveredModel {
	id: string;
	ownedBy?: string;
	contextLength?: number;
	inputPricePer1M?: number;
	outputPricePer1M?: number;
}

interface OpenAiModelsResponse {
	object: 'list';
	data: Array<{
		id: string;
		object: string;
		created?: number;
		owned_by?: string;
		context_length?: number;
		pricing?: {
			prompt?: string;
			completion?: string;
		};
	}>;
}

interface CacheEntry {
	models: DiscoveredModel[];
	fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const discoveryCache = new Map<string, CacheEntry>();

export function clearDiscoveryCache(providerId?: string): void {
	if (providerId) {
		discoveryCache.delete(providerId);
	} else {
		discoveryCache.clear();
	}
}

function buildHeaders(provider: ProviderEntry, apiKey: string): Record<string, string> {
	if (provider.authStyle === 'x-api-key') {
		return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
	}
	return { Authorization: `Bearer ${apiKey}` };
}

function parseResponse(data: OpenAiModelsResponse): DiscoveredModel[] {
	if (!data?.data || !Array.isArray(data.data)) return [];
	return data.data
		.filter((m) => m.object === 'model' || m.id)
		.map((m) => {
			const discovered: DiscoveredModel = { id: m.id, ownedBy: m.owned_by };
			if (typeof m.context_length === 'number' && m.context_length > 0) {
				discovered.contextLength = m.context_length;
			}
			if (m.pricing) {
				const prompt = Number.parseFloat(m.pricing.prompt ?? '');
				const completion = Number.parseFloat(m.pricing.completion ?? '');
				if (Number.isFinite(prompt) && prompt >= 0) {
					discovered.inputPricePer1M = prompt * 1_000_000;
				}
				if (Number.isFinite(completion) && completion >= 0) {
					discovered.outputPricePer1M = completion * 1_000_000;
				}
			}
			return discovered;
		})
		.sort((a, b) => a.id.localeCompare(b.id));
}

export async function fetchRemoteModels(
	provider: ProviderEntry,
	apiKey: string,
): Promise<DiscoveredModel[]> {
	if (!provider.canValidate || !provider.needsApiKey) return [];

	const cached = discoveryCache.get(provider.id);
	if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
		return cached.models;
	}

	const headers = buildHeaders(provider, apiKey);
	try {
		const res = await fetch(`${provider.baseUrl}/models`, {
			headers,
			signal: AbortSignal.timeout(10000),
		});
		if (!res.ok) return [];
		const data = (await res.json()) as OpenAiModelsResponse;
		const models = parseResponse(data);
		discoveryCache.set(provider.id, { models, fetchedAt: Date.now() });
		return models;
	} catch {
		return [];
	}
}

export async function fetchRemoteModelsForProvider(
	providerId: string,
	config?: UserConfig,
): Promise<DiscoveredModel[]> {
	const { findProvider } = await import('./provider-registry.js');
	const provider = findProvider(providerId);
	if (!provider) return [];
	const apiKey = resolveApiKey(provider, config);
	if (!apiKey) return [];
	return fetchRemoteModels(provider, apiKey);
}

export function mergeModels(
	curated: ModelEntry[],
	discovered: DiscoveredModel[],
): ModelEntry[] {
	const curatedIds = new Set(curated.map((m) => m.id));
	const curatedByAlias = new Map<string, ModelEntry>();
	for (const m of curated) {
		if (m.aliases) {
			for (const a of m.aliases) {
				curatedByAlias.set(a, m);
			}
		}
	}

	const result: ModelEntry[] = [...curated];

	for (const d of discovered) {
		if (curatedIds.has(d.id)) continue;

		const existing = curatedByAlias.get(d.id);
		if (existing) continue;

		result.push({
			id: d.id,
			displayName: d.id.split('/').pop() || d.id,
			contextWindow: d.contextLength ?? 128_000,
			inputPricePer1M: d.inputPricePer1M ?? 0,
			outputPricePer1M: d.outputPricePer1M ?? 0,
			supportsReasoning: false,
			supportsToolCalling: true,
		});
	}

	return result;
}

export async function getMergedModels(
	provider: ProviderEntry,
	config?: UserConfig,
): Promise<ModelEntry[]> {
	if (!provider.needsApiKey || !provider.canValidate) {
		return provider.models;
	}

	const apiKey = resolveApiKey(provider, config);
	if (!apiKey) return provider.models;

	const discovered = await fetchRemoteModels(provider, apiKey);
	if (discovered.length === 0) return provider.models;

	return mergeModels(provider.models, discovered);
}
