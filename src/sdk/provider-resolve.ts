import type { UserConfig } from '../config.js';
import type { ProviderAdapter } from './adapter.js';
import { createAdapter } from './adapters/index.js';
import type { ProviderConfig } from './provider.js';
import {
	findModel,
	findProvider,
	type ModelEntry,
	PROVIDERS,
	type ProviderEntry,
	resolveAlias,
} from './provider-registry.js';

export interface ResolvedProvider {
	provider: ProviderEntry;
	model: ModelEntry | undefined;
	apiKey: string;
	baseUrl: string;
	adapter: ProviderAdapter;
}

export function resolveModelSpec(
	spec: string,
	config?: UserConfig,
): ResolvedProvider {
	const resolved = resolveAlias(spec);
	const [providerId, ...modelParts] = resolved.includes('/')
		? resolved.split('/')
		: inferProvider(resolved);
	const modelId = modelParts.join('/');

	const provider = findProvider(providerId);
	if (!provider) {
		const fallback =
			PROVIDERS.find((p) => p.isPrimary && p.needsApiKey) ?? PROVIDERS[0];
		return buildResolved(fallback, resolved, config);
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
	if (!provider.needsApiKey) {
		baseUrl = baseUrl.replace(/\/v1\/?$/, '');
	}

	const providerConfig: ProviderConfig = {
		apiKey,
		baseUrl,
		model: model?.id || modelId,
	};

	const adapter = createAdapter(provider.apiFormat, providerConfig);

	return { provider, model, apiKey, baseUrl, adapter };
}

export function resolveApiKey(
	provider: ProviderEntry,
	config?: UserConfig,
): string {
	if (!provider.needsApiKey) return 'local';

	const configApiKey = config?.providers?.[provider.id]?.apiKey;
	if (configApiKey) {
		if (configApiKey.startsWith('env:')) {
			const envKey = configApiKey.slice(4);
			if (process.env[envKey]) return process.env[envKey]!;
		} else {
			return configApiKey;
		}
	}

	if (provider.envVar && process.env[provider.envVar])
		return process.env[provider.envVar]!;

	if (provider.envVarAliases) {
		for (const alias of provider.envVarAliases) {
			if (process.env[alias]) return process.env[alias]!;
		}
	}

	if (process.env.OPENEXPLORER_API_KEY) return process.env.OPENEXPLORER_API_KEY;

	return '';
}

export function detectAvailableProviders(config?: UserConfig): ProviderEntry[] {
	const available: ProviderEntry[] = [];
	for (const provider of PROVIDERS) {
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

function inferProvider(model: string): [string, string] {
	for (const provider of PROVIDERS) {
		if (provider.modelPrefixes?.length) {
			for (const prefix of provider.modelPrefixes) {
				if (model.startsWith(prefix)) {
					return [provider.id, model];
				}
			}
		}
	}
	for (const provider of PROVIDERS) {
		if (
			provider.models.some(
				(m) => m.id === model || m.aliases?.includes(model),
			)
		) {
			return [provider.id, model];
		}
	}
	for (const provider of PROVIDERS) {
		if (provider.localProvider?.preferredModels?.length) {
			for (const pref of provider.localProvider.preferredModels) {
				if (model.startsWith(pref)) {
					return [provider.id, model];
				}
			}
		}
	}
	const fallback =
		PROVIDERS.find((p) => p.isPrimary && p.needsApiKey) ?? PROVIDERS[0];
	return [fallback.id, model];
}
