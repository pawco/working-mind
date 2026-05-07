import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { UserConfig } from '../config.js';
import { getConfigDir } from '../paths.js';
import type { ModelEntry, ProviderEntry } from './provider-registry.js';
import { resolveApiKey } from './provider-resolve.js';

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

interface OllamaTagsResponse {
	models: Array<{
		name: string;
		modified_at?: string;
		size?: number;
	}>;
}

interface CacheEntry {
	models: DiscoveredModel[];
	fetchedAt: number;
}

interface DiskCacheData {
	[providerId: string]: CacheEntry;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const DISK_CACHE_TTL_MS = 60 * 60 * 1000;
const discoveryCache = new Map<string, CacheEntry>();

export function clearDiscoveryCache(providerId?: string): void {
	if (providerId) {
		discoveryCache.delete(providerId);
	} else {
		discoveryCache.clear();
	}
}

function getModelCachePath(): string {
	return join(getConfigDir(), 'model-cache.json');
}

function readDiskCache(providerId: string): CacheEntry | null {
	try {
		const raw = readFileSync(getModelCachePath(), 'utf-8');
		const data = JSON.parse(raw) as DiskCacheData;
		const entry = data[providerId];
		if (!entry) return null;
		if (Date.now() - entry.fetchedAt >= DISK_CACHE_TTL_MS) return null;
		return entry;
	} catch {
		return null;
	}
}

function atomicWriteJson(path: string, data: string): void {
	const tmp = `${path}.${Date.now()}.tmp`;
	writeFileSync(tmp, data, 'utf-8');
	renameSync(tmp, path);
}

function writeDiskCache(providerId: string, models: DiscoveredModel[]): void {
	const cachePath = getModelCachePath();
	let data: DiskCacheData = {};
	try {
		data = JSON.parse(readFileSync(cachePath, 'utf-8')) as DiskCacheData;
	} catch {}
	data[providerId] = { models, fetchedAt: Date.now() };
	try {
		mkdirSync(getConfigDir(), { recursive: true });
		atomicWriteJson(cachePath, JSON.stringify(data));
	} catch {}
}

export function clearDiskCache(providerId?: string): void {
	const cachePath = getModelCachePath();
	try {
		const raw = readFileSync(cachePath, 'utf-8');
		const data = JSON.parse(raw) as DiskCacheData;
		if (providerId) {
			delete data[providerId];
		} else {
			for (const key of Object.keys(data)) {
				delete data[key];
			}
		}
		mkdirSync(getConfigDir(), { recursive: true });
		atomicWriteJson(cachePath, JSON.stringify(data));
	} catch {}
}

function buildHeaders(provider: ProviderEntry, apiKey: string): Record<string, string> {
	if (provider.authStyle === 'none') return {};
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

export async function fetchOllamaModels(baseUrl: string): Promise<DiscoveredModel[]> {
	try {
		const res = await fetch(`${baseUrl}/api/tags`, {
			signal: AbortSignal.timeout(10000),
		});
		if (!res.ok) return [];
		const data = (await res.json()) as OllamaTagsResponse;
		if (!data.models || !Array.isArray(data.models)) return [];
		return data.models
			.map((m) => ({
				id: m.name.replace(/:latest$/, ''),
				ownedBy: 'ollama',
				inputPricePer1M: 0,
				outputPricePer1M: 0,
			}))
			.sort((a, b) => a.id.localeCompare(b.id));
	} catch {
		return [];
	}
}

export async function fetchRemoteModels(
	provider: ProviderEntry,
	apiKey: string,
): Promise<DiscoveredModel[]> {
	if (provider.apiFormat === 'ollama') {
		const cached = discoveryCache.get(provider.id);
		if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
			return cached.models;
		}
		const diskEntry = readDiskCache(provider.id);
		if (diskEntry) {
			discoveryCache.set(provider.id, {
				models: diskEntry.models,
				fetchedAt: diskEntry.fetchedAt,
			});
			return diskEntry.models;
		}
		const models = await fetchOllamaModels(provider.baseUrl);
		if (models.length > 0) {
			discoveryCache.set(provider.id, { models, fetchedAt: Date.now() });
			writeDiskCache(provider.id, models);
		}
		return models;
	}

	if (!provider.canValidate) return [];

	if (provider.authStyle === 'none' && !provider.needsApiKey) {
		const cached = discoveryCache.get(provider.id);
		if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
			return cached.models;
		}
		const diskEntry = readDiskCache(provider.id);
		if (diskEntry) {
			discoveryCache.set(provider.id, {
				models: diskEntry.models,
				fetchedAt: diskEntry.fetchedAt,
			});
			return diskEntry.models;
		}
		try {
			const res = await fetch(`${provider.baseUrl}/models`, {
				signal: AbortSignal.timeout(10000),
			});
			if (!res.ok) return [];
			const data = (await res.json()) as OpenAiModelsResponse;
			const models = parseResponse(data);
			discoveryCache.set(provider.id, { models, fetchedAt: Date.now() });
			writeDiskCache(provider.id, models);
			return models;
		} catch {
			return [];
		}
	}

	if (!provider.needsApiKey) return [];

	const cached = discoveryCache.get(provider.id);
	if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
		return cached.models;
	}

	const diskEntry = readDiskCache(provider.id);
	if (diskEntry) {
		discoveryCache.set(provider.id, {
			models: diskEntry.models,
			fetchedAt: diskEntry.fetchedAt,
		});
		return diskEntry.models;
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
		writeDiskCache(provider.id, models);
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
	if (provider.needsApiKey && !apiKey) return [];
	return fetchRemoteModels(provider, apiKey);
}

export function mergeModels(curated: ModelEntry[], discovered: DiscoveredModel[]): ModelEntry[] {
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
	if (provider.apiFormat === 'ollama') {
		const discovered = await fetchRemoteModels(provider, '');
		if (discovered.length === 0) return provider.models;
		return mergeModels(provider.models, discovered);
	}

	if (!provider.canValidate) {
		return provider.models;
	}

	if (!provider.needsApiKey && provider.authStyle !== 'none') {
		return provider.models;
	}

	if (provider.needsApiKey) {
		const apiKey = resolveApiKey(provider, config);
		if (!apiKey) return provider.models;
	}

	const apiKey = resolveApiKey(provider, config);
	const discovered = await fetchRemoteModels(provider, apiKey);
	if (discovered.length === 0) return provider.models;

	return mergeModels(provider.models, discovered);
}
