import { loadProviders } from './provider-loader.js';

export interface ModelEntry {
	id: string;
	displayName: string;
	contextWindow: number;
	inputPricePer1M: number;
	outputPricePer1M: number;
	supportsReasoning: boolean;
	supportsToolCalling: boolean;
	aliases?: string[];
}

export interface ProviderEntry {
	id: string;
	displayName: string;
	baseUrl: string;
	apiFormat: 'openai' | 'anthropic' | 'ollama';
	envVar: string;
	envVarAliases?: string[];
	models: ModelEntry[];
	free?: boolean | string;
	website: string;
	needsApiKey: boolean;
	canValidate: boolean;
	modelIdFormat: 'full' | 'provider-prefix';
	modelPrefixes: string[];
	localProvider?: { probeUrl: string; preferredModels: string[] };
	isPrimary: boolean;
	authStyle: 'bearer' | 'x-api-key' | 'none';
}

const data = loadProviders();
export const PROVIDERS: ProviderEntry[] = data.providers;

const TIER_ALIASES: Record<string, string> = data.tierAliases;
const MODEL_ALIASES: Record<string, string> = data.modelAliases;

export function resolveAlias(spec: string): string {
	if (TIER_ALIASES[spec]) return TIER_ALIASES[spec];
	if (MODEL_ALIASES[spec]) return MODEL_ALIASES[spec];
	return spec;
}

export function findProvider(providerId: string): ProviderEntry | undefined {
	return PROVIDERS.find((p) => p.id === providerId);
}

export function findModel(
	providerId: string,
	modelId: string,
): ModelEntry | undefined {
	const provider = findProvider(providerId);
	if (!provider) return undefined;
	return provider.models.find(
		(m) => m.id === modelId || m.aliases?.includes(modelId),
	);
}

export function getProviderModels(providerId: string): ModelEntry[] {
	const provider = findProvider(providerId);
	return provider?.models ?? [];
}

export function getAllModelsSorted(): {
	provider: ProviderEntry;
	model: ModelEntry;
}[] {
	const result: { provider: ProviderEntry; model: ModelEntry }[] = [];
	for (const provider of PROVIDERS) {
		for (const model of provider.models) {
			result.push({ provider, model });
		}
	}
	return result.sort(
		(a, b) => a.model.outputPricePer1M - b.model.outputPricePer1M,
	);
}

export function getDefaultModel(): string {
	for (const p of PROVIDERS) {
		if (p.isPrimary && p.models.length > 0) {
			return `${p.id}/${p.models[0].id}`;
		}
	}
	return 'openrouter/anthropic/claude-sonnet-4.6';
}

export function getPrimaryProviders(): ProviderEntry[] {
	return PROVIDERS.filter((p) => p.isPrimary);
}

export function getOtherProviders(): ProviderEntry[] {
	return PROVIDERS.filter((p) => !p.isPrimary);
}
