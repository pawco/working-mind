import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import stripJsonComments from 'strip-json-comments';
import { getDataDir, getProvidersPath } from '../paths.js';
import {
	type ProviderEntry,
	type ProvidersData,
	providersDataSchema,
} from '../schemas.js';

export type { ProviderEntry, ProvidersData };

const USER_PROVIDERS_PATH = getProvidersPath();

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
		};
	});
}

let cached: ProvidersData | null = null;

export function loadProviders(): ProvidersData {
	if (cached) return cached;

	const rawBundled = loadJsonc(getBundledPath());
	const bundled = providersDataSchema.parse(rawBundled);

	if (!existsSync(USER_PROVIDERS_PATH)) {
		cached = bundled;
		return cached;
	}

	try {
		const rawUser = loadJsonc(USER_PROVIDERS_PATH);
		const user = providersDataSchema.partial().parse(rawUser);
		cached = {
			providers: user.providers
				? deepMergeProviders(
						bundled.providers,
						user.providers as Partial<ProviderEntry>[],
					)
				: bundled.providers,
			tierAliases: { ...bundled.tierAliases, ...user.tierAliases },
			modelAliases: { ...bundled.modelAliases, ...user.modelAliases },
		};
	} catch (err) {
		if (err instanceof Error) {
			console.error(`Warning: ${err.message}`);
		}
		cached = bundled;
	}

	return cached;
}

export function reloadProviders(): ProvidersData {
	cached = null;
	return loadProviders();
}
