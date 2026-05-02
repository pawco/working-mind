import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import stripJsonComments from 'strip-json-comments';
import { getDataDir } from '../paths.js';
import type { ProviderEntry } from './provider-registry.js';

interface ProvidersData {
	providers: ProviderEntry[];
	tierAliases: Record<string, string>;
	modelAliases: Record<string, string>;
}

const USER_PROVIDERS_PATH = join(homedir(), '.openexplorer', 'providers.jsonc');

function getBundledPath(): string {
	return join(getDataDir(), 'providers.jsonc');
}

function loadJsonc(path: string): any {
	const raw = readFileSync(path, 'utf-8');
	return JSON.parse(stripJsonComments(raw));
}

function deepMergeProviders(
	base: ProviderEntry[],
	overrides: Partial<ProviderEntry>[],
): ProviderEntry[] {
	const overrideMap = new Map(overrides.map((o) => [o.id, o]));
	return base.map((p) => {
		const o = overrideMap.get(p.id);
		if (!o) return p;
		return {
			...p,
			...o,
			models: o.models ?? p.models,
			envVarAliases: o.envVarAliases ?? p.envVarAliases,
		} as ProviderEntry;
	});
}

let cached: ProvidersData | null = null;

export function loadProviders(): ProvidersData {
	if (cached) return cached;

	const bundled = loadJsonc(getBundledPath()) as ProvidersData;

	if (!existsSync(USER_PROVIDERS_PATH)) {
		cached = bundled;
		return cached;
	}

	try {
		const user = loadJsonc(USER_PROVIDERS_PATH) as Partial<ProvidersData>;
		cached = {
			providers: user.providers
				? deepMergeProviders(bundled.providers, user.providers)
				: bundled.providers,
			tierAliases: { ...bundled.tierAliases, ...user.tierAliases },
			modelAliases: { ...bundled.modelAliases, ...user.modelAliases },
		};
	} catch {
		cached = bundled;
	}

	return cached;
}

export function reloadProviders(): ProvidersData {
	cached = null;
	return loadProviders();
}
