import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CustomProviderEntry, UserConfig } from '../config.js';
import type { ProviderAdapter } from './adapter.js';
import { createAdapter } from './adapters/index.js';
import type { ProviderConfig } from './provider.js';
import {
	findModel,
	type ModelEntry,
	PROVIDERS,
	type ProviderEntry,
	resolveAlias,
} from './provider-registry.js';

const memoryKeyCache: Record<string, string> = {};

function customToProviderEntry(
	id: string,
	custom: CustomProviderEntry,
): ProviderEntry {
	return {
		id,
		displayName: custom.displayName,
		baseUrl: custom.baseUrl,
		apiFormat: custom.apiFormat,
		envVar: custom.envVar || '',
		envVarAliases: [],
		models:
			custom.models?.map((m) => ({
				id: m.id,
				displayName: m.displayName || m.id,
				contextWindow: m.contextWindow ?? 128000,
				inputPricePer1M: 0,
				outputPricePer1M: 0,
				supportsReasoning: false,
				supportsToolCalling: true,
			})) ?? [],
		website: '',
		needsApiKey: !!custom.envVar,
		canValidate: false,
		modelIdFormat: 'full' as const,
		modelPrefixes: [],
		isPrimary: false,
		authStyle: 'bearer' as const,
	};
}

function getMergedProviders(config?: UserConfig): ProviderEntry[] {
	if (!config?.customProviders) return PROVIDERS;
	const custom = Object.entries(config.customProviders).map(([id, c]) =>
		customToProviderEntry(id, c),
	);
	const existingIds = new Set(PROVIDERS.map((p) => p.id));
	const newOnes = custom.filter((p) => !existingIds.has(p.id));
	return [...PROVIDERS, ...newOnes];
}

export function cacheApiKey(providerId: string, key: string): void {
	if (key) memoryKeyCache[providerId] = key;
}

export function hasCachedKey(providerId: string): boolean {
	return !!memoryKeyCache[providerId];
}

export function clearApiKeyCache(): void {
	for (const key of Object.keys(memoryKeyCache)) {
		delete memoryKeyCache[key];
	}
}

export interface ResolvedProvider {
	provider: ProviderEntry;
	model: ModelEntry | undefined;
	providerRelativeModelId: string;
	apiKey: string;
	baseUrl: string;
	adapter: ProviderAdapter;
}

export function resolveModelSpec(
	spec: string,
	config?: UserConfig,
): ResolvedProvider {
	const resolved = resolveAlias(spec);
	const merged = getMergedProviders(config);
	const [providerId, ...modelParts] = resolved.includes('/')
		? resolved.split('/')
		: inferProvider(resolved, merged);
	const modelId = modelParts.join('/');

	const provider = merged.find((p) => p.id === providerId);
	if (!provider) {
		throw new Error(
			`Unknown provider "${providerId}". Available: ${merged.map((p) => p.id).join(', ')}.`,
		);
	}

	return buildResolved(provider, modelId, config);
}

function buildResolved(
	provider: ProviderEntry,
	modelId: string,
	config?: UserConfig,
): ResolvedProvider {
	const model = findModel(provider.id, modelId);
	const apiKey = resolveApiKey(provider, config);
	let baseUrl = config?.providers?.[provider.id]?.baseUrl || provider.baseUrl;
	if (provider.apiFormat === 'ollama') {
		baseUrl = baseUrl.replace(/\/v1\/?$/, '');
	}

	const providerConfig: ProviderConfig = {
		apiKey,
		baseUrl,
		model: model?.id || modelId,
	};

	const adapter = createAdapter(provider.apiFormat, providerConfig);

	return {
		provider,
		model,
		providerRelativeModelId: modelId,
		apiKey,
		baseUrl,
		adapter,
	};
}

export function resolveApiKey(
	provider: ProviderEntry,
	config?: UserConfig,
): string {
	if (!provider.needsApiKey) return '';

	const cached = memoryKeyCache[provider.id];
	if (cached) return cached;

	const configApiKey = config?.providers?.[provider.id]?.apiKey;
	if (configApiKey) {
		if (configApiKey.startsWith('env:')) {
			const envKey = configApiKey.slice(4);
			const envVal = process.env[envKey];
			if (envVal) {
				memoryKeyCache[provider.id] = envVal;
				return envVal;
			}
		} else {
			memoryKeyCache[provider.id] = configApiKey;
			return configApiKey;
		}
	}

	if (provider.envVar) {
		const envVal = process.env[provider.envVar];
		if (envVal) {
			memoryKeyCache[provider.id] = envVal;
			return envVal;
		}
	}

	if (provider.envVarAliases) {
		for (const alias of provider.envVarAliases) {
			const envVal = process.env[alias];
			if (envVal) {
				memoryKeyCache[provider.id] = envVal;
				return envVal;
			}
		}
	}

	return '';
}

export async function resolveApiKeyAsync(
	provider: ProviderEntry,
	config?: UserConfig,
): Promise<string> {
	return resolveApiKey(provider, config);
}

export function detectAvailableProviders(config?: UserConfig): ProviderEntry[] {
	const merged = getMergedProviders(config);
	const available: ProviderEntry[] = [];
	for (const provider of merged) {
		const key = resolveApiKey(provider, config);
		if (key || !provider.needsApiKey) {
			available.push(provider);
		}
	}
	return available;
}

export interface OllamaModelInfo {
	name: string;
	size: number;
	family: string;
	parameterSize: string;
	quantization: string;
}

export interface LocalProviderProbeResult {
	running: boolean;
	models: OllamaModelInfo[];
}

export async function probeLocalProvider(
	provider: ProviderEntry,
): Promise<LocalProviderProbeResult> {
	const probeUrl = provider.localProvider?.probeUrl;
	if (!probeUrl) return { running: false, models: [] };
	return probeLocalUrl(probeUrl);
}

export async function probeOllama(): Promise<LocalProviderProbeResult> {
	return probeLocalUrl('http://localhost:11434/api/tags');
}

async function probeLocalUrl(url: string): Promise<LocalProviderProbeResult> {
	try {
		const res = await fetch(url, {
			signal: AbortSignal.timeout(2000),
		});
		if (!res.ok) return { running: false, models: [] };
		const data = (await res.json()) as {
			models?: {
				name: string;
				size?: number;
				details?: {
					family?: string;
					parameter_size?: string;
					quantization_level?: string;
				};
			}[];
		};
		const models: OllamaModelInfo[] = (data.models || []).map((m) => ({
			name: m.name,
			size: m.size ?? 0,
			family: m.details?.family ?? 'unknown',
			parameterSize: m.details?.parameter_size ?? '',
			quantization: m.details?.quantization_level ?? '',
		}));
		return { running: true, models };
	} catch {
		return { running: false, models: [] };
	}
}

export function isOllamaModelAvailable(
	modelId: string,
	ollamaModels: OllamaModelInfo[],
): boolean {
	if (ollamaModels.length === 0) return false;
	const stripped = modelId.replace(/:latest$/, '');
	return ollamaModels.some((m) => {
		const mStripped = m.name.replace(/:latest$/, '');
		return mStripped === stripped || m.name === modelId;
	});
}

export function suggestOllamaPull(modelId: string): string {
	return `ollama pull ${modelId}`;
}

export function matchOllamaLocalModel(
	modelId: string,
	ollamaModels: OllamaModelInfo[],
): OllamaModelInfo | undefined {
	const stripped = modelId.replace(/:latest$/, '');
	return ollamaModels.find((m) => {
		const mStripped = m.name.replace(/:latest$/, '');
		return mStripped === stripped || m.name === modelId;
	});
}

export function resolveOllamaModelName(
	requested: string,
	ollamaModels: OllamaModelInfo[],
): string {
	if (ollamaModels.length === 0) return requested;
	const match = matchOllamaLocalModel(requested, ollamaModels);
	if (match) return match.name;
	const base = requested.split(':')[0];
	const familyMatches = ollamaModels.filter(
		(m) => m.name.split(':')[0] === base || m.name.startsWith(`${base}:`),
	);
	if (familyMatches.length > 0) {
		const largest = familyMatches.reduce((a, b) => (a.size > b.size ? a : b));
		return largest.name;
	}
	return requested;
}

export interface LocalFastProbeResult {
	running: boolean;
	baseUrl: string;
	model: string;
	port: number;
	probed: boolean;
}

const WMIND_SERVE_CONFIG_PATH = join(homedir(), '.wmind-serve', 'config.json');

function readWmindServeConfig(): {
	port: number;
	baseUrl: string;
	activeModel: string | null;
} {
	if (!existsSync(WMIND_SERVE_CONFIG_PATH)) {
		return {
			port: 19421,
			baseUrl: 'http://127.0.0.1:19421/v1',
			activeModel: null,
		};
	}
	try {
		const raw = readFileSync(WMIND_SERVE_CONFIG_PATH, 'utf-8');
		const data = JSON.parse(raw);
		return {
			port: data.port ?? 19421,
			baseUrl: data.baseUrl ?? `http://127.0.0.1:${data.port ?? 19421}/v1`,
			activeModel: data.activeModel ?? null,
		};
	} catch {
		return {
			port: 19421,
			baseUrl: 'http://127.0.0.1:19421/v1',
			activeModel: null,
		};
	}
}

export async function probeLocalFast(): Promise<LocalFastProbeResult> {
	const serveConfig = readWmindServeConfig();
	const healthUrl = `http://127.0.0.1:${serveConfig.port}/health`;

	try {
		const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
		if (!res.ok)
			return {
				running: false,
				baseUrl: '',
				model: '',
				port: serveConfig.port,
				probed: true,
			};
		return {
			running: true,
			baseUrl: serveConfig.baseUrl,
			model: serveConfig.activeModel ?? '',
			port: serveConfig.port,
			probed: true,
		};
	} catch {
		return {
			running: false,
			baseUrl: '',
			model: '',
			port: serveConfig.port,
			probed: true,
		};
	}
}

function inferProvider(
	model: string,
	providers: ProviderEntry[] = PROVIDERS,
): [string, string] {
	for (const provider of providers) {
		if (provider.modelPrefixes?.length) {
			for (const prefix of provider.modelPrefixes) {
				if (model.startsWith(prefix)) {
					return [provider.id, model];
				}
			}
		}
	}
	for (const provider of providers) {
		if (
			provider.models.some((m) => m.id === model || m.aliases?.includes(model))
		) {
			return [provider.id, model];
		}
	}
	for (const provider of providers) {
		if (provider.localProvider?.preferredModels?.length) {
			for (const pref of provider.localProvider.preferredModels) {
				if (model.startsWith(pref)) {
					return [provider.id, model];
				}
			}
		}
	}
	const fallback =
		providers.find((p) => p.isPrimary && p.needsApiKey) ?? providers[0];
	return [fallback.id, model];
}
