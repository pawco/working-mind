import * as clack from '@clack/prompts';
import pc from 'picocolors';
import { loadUserConfig, type UserConfig, writeUserConfig } from './config.js';
import { getConfigDir } from './paths.js';
import { getMergedModels } from './sdk/model-discovery.js';
import {
	getOtherProviders,
	getPrimaryProviders,
	PROVIDERS,
	type ProviderEntry,
} from './sdk/provider-registry.js';
import {
	cacheApiKey,
	type LocalFastProbeResult,
	type OllamaModelInfo,
	probeLocalFast,
	probeOllama,
	resolveApiKey,
	resolveOllamaModelName,
} from './sdk/provider-resolve.js';

export async function runWizard(): Promise<UserConfig | null> {
	const config = loadUserConfig();

	clack.intro(pc.bgCyan(pc.black(' Working Mind -- First Run Setup ')));

	const [ollama, localFast] = await Promise.all([probeOllama(), probeLocalFast()]);

	const primaryProviders = getPrimaryProviders();
	const otherProviders = getOtherProviders();

	const providerOptions: { value: string; label: string; hint: string }[] = [];

	for (const p of primaryProviders) {
		const isLocalFast = p.id === 'local-fast';
		const isOllama = p.id === 'ollama';

		let hasKey: boolean;
		if (isLocalFast) {
			hasKey = localFast.running;
		} else if (isOllama) {
			hasKey = ollama.running;
		} else {
			hasKey = !!resolveApiKey(p, config);
		}

		const suffix = hasKey ? pc.green(' \u2713 available') : '';

		let hint: string;
		if (isLocalFast) {
			hint = localFast.running ? `Running (port ${localFast.port})` : 'Not running';
		} else if (isOllama) {
			hint = ollama.running ? `${ollama.models.length} models pulled` : 'Not running';
		} else if (p.free === true) {
			hint = 'Free';
		} else if (p.free === 'limited') {
			hint = 'Free tier';
		} else {
			hint = 'Paid';
		}

		providerOptions.push({ value: p.id, label: p.displayName + suffix, hint });
	}

	providerOptions.push({
		value: '__more',
		label: pc.dim('More providers...'),
		hint: `${otherProviders.length} more`,
	});

	const providerChoice = await clack.select({
		message: 'Which provider do you want to use?',
		options: providerOptions,
	});

	if (clack.isCancel(providerChoice)) {
		clack.cancel('Setup cancelled');
		return null;
	}

	let selectedProviderId = providerChoice as string;

	if (selectedProviderId === '__more') {
		const moreOptions = otherProviders.map((p) => {
			const hasKey = !!resolveApiKey(p, config);
			const suffix = hasKey ? pc.green(' \u2713 key detected') : '';
			const hint = p.free === true ? 'Free' : p.free === 'limited' ? 'Free tier' : 'Paid';
			return { value: p.id, label: p.displayName + suffix, hint };
		});
		const moreChoice = await clack.select({
			message: 'Select a provider',
			options: moreOptions,
		});
		if (clack.isCancel(moreChoice)) {
			clack.cancel('Setup cancelled');
			return null;
		}
		selectedProviderId = moreChoice as string;
	}

	const provider = PROVIDERS.find((p) => p.id === selectedProviderId);
	if (!provider) {
		clack.cancel('Unknown provider');
		return null;
	}

	let selectedModelId: string;

	if (provider.id === 'local-fast') {
		const models = localFast.running
			? await discoverLocalFastModels(localFast, provider)
			: provider.models;
		const modelOptions = models.slice(0, 15).map((m) => ({
			value: m.id,
			label: m.displayName,
			hint: `Free (local) \u00b7 ${formatCtx(m.contextWindow)} ctx`,
		}));
		const modelChoice = await clack.select({
			message: `Pick a model (${provider.displayName}):`,
			options: modelOptions,
		});
		if (clack.isCancel(modelChoice)) {
			clack.cancel('Setup cancelled');
			return null;
		}
		selectedModelId = modelChoice as string;
	} else if (!provider.needsApiKey && ollama.running) {
		const ollamaResult = await selectOllamaModel(ollama.models, provider);
		if (!ollamaResult) return null;
		selectedModelId = ollamaResult;
	} else {
		const modelOptions = provider.models.slice(0, 15).map((m) => {
			const price =
				m.inputPricePer1M === 0
					? 'Free (local)'
					: `$${m.inputPricePer1M}/$${m.outputPricePer1M} per 1M`;
			const ctx = formatCtx(m.contextWindow);
			const features =
				[m.supportsReasoning ? 'thinking' : '', m.supportsToolCalling ? 'tools' : '']
					.filter(Boolean)
					.join(', ') || 'chat only';
			return {
				value: m.id,
				label: m.displayName,
				hint: `${price} \u00b7 ${ctx} ctx \u00b7 ${features}`,
			};
		});

		const modelChoice = await clack.select({
			message: `Pick a model (${provider.displayName}):`,
			options: modelOptions,
		});

		if (clack.isCancel(modelChoice)) {
			clack.cancel('Setup cancelled');
			return null;
		}

		selectedModelId = modelChoice as string;
	}

	let apiKey = '';

	if (provider.needsApiKey) {
		const existingKey = resolveApiKey(provider);
		if (existingKey) {
			const useExisting = await clack.confirm({
				message: `API key found for ${provider.displayName}. Use it?`,
				initialValue: true,
			});
			if (clack.isCancel(useExisting)) {
				clack.cancel('Setup cancelled');
				return null;
			}
			if (useExisting) {
				apiKey = existingKey;
			}
		}

		if (!apiKey) {
			const keyInput = await clack.password({
				message: `Enter your ${provider.displayName} API key:`,
				mask: '\u2022',
			});
			if (clack.isCancel(keyInput)) {
				clack.cancel('Setup cancelled');
				return null;
			}
			apiKey = keyInput as string;
		}

		if (apiKey) cacheApiKey(provider.id, apiKey);
		if (provider.envVar) {
			clack.log.step(
				`Add to your shell profile: ${pc.cyan(`export ${provider.envVar}=***`)}`,
			);
		}
	}

	const fullModelId = `${provider.id}/${selectedModelId}`;

	config.defaultModel = fullModelId;

	if (!config.providers) config.providers = {};
	if (provider.needsApiKey && apiKey) {
		config.providers[provider.id] = {
			apiKey: `env:${provider.envVar}`,
			baseUrl: provider.baseUrl,
		};
	} else if (provider.id === 'local-fast') {
		config.providers[provider.id] = {
			baseUrl: localFast.running ? localFast.baseUrl : provider.baseUrl,
		};
	} else if (provider.id === 'ollama') {
		config.providers[provider.id] = {
			baseUrl: ollama.running ? 'http://localhost:11434/v1' : provider.baseUrl,
		};
	}

	writeUserConfig(config);
	clack.log.success(`Config written to ${pc.dim(`${getConfigDir()}/config.jsonc`)}`);

	if (provider.id === 'local-fast') {
		if (localFast.running) {
			clack.log.success(
				`Using Local Fast: ${pc.cyan(selectedModelId)} on port ${localFast.port}`,
			);
		} else {
			clack.log.warn('Local Fast not running. Start it: wmind-serve start');
		}
	} else if (!provider.needsApiKey) {
		const resolved = resolveOllamaModelName(selectedModelId, ollama.models);
		if (resolved !== selectedModelId) {
			clack.log.step(`Resolved model: ${selectedModelId} \u2192 ${resolved}`);
		}
		clack.log.success(`Using local model: ${pc.cyan(resolved)}`);
	} else if (provider.canValidate) {
		const s = clack.spinner();
		s.start('Validating connection...');
		try {
			const headers: Record<string, string> =
				provider.authStyle === 'x-api-key'
					? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
					: { Authorization: `Bearer ${apiKey}` };
			const testRes = await fetch(`${provider.baseUrl}/models`, {
				headers,
				signal: AbortSignal.timeout(5000),
			});
			if (testRes.ok) {
				s.stop('Connection validated');
			} else {
				s.stop(`Could not validate \u2014 ${testRes.status} (key may still work for chat)`);
			}
		} catch {
			s.stop('Could not reach provider (network issue?)');
		}
	}

	clack.outro(
		pc.bgGreen(pc.black(` You're all set! `)) +
			`\n\n  ${pc.cyan('wmind')}                              \u2192 Start interactive session\n  ${pc.cyan('wmind --pack starter')}               \u2192 With starter tools\n`,
	);

	return config;
}

async function discoverLocalFastModels(
	localFast: LocalFastProbeResult,
	provider: ProviderEntry,
): Promise<{ id: string; displayName: string; contextWindow: number }[]> {
	try {
		const res = await fetch(`${localFast.baseUrl}/models`, {
			signal: AbortSignal.timeout(3000),
		});
		if (!res.ok) return provider.models;
		const data = await res.json();
		const remoteIds: string[] = data?.data?.map((m: any) => m.id) ?? [];
		const curated = provider.models;
		const extra = remoteIds
			.filter((id) => !curated.some((m) => m.id === id))
			.map((id) => ({
				id,
				displayName: id,
				contextWindow: 131000,
			}));
		return [...curated, ...extra];
	} catch {
		return provider.models;
	}
}

function formatCtx(ctx: number): string {
	if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(1)}M`;
	return `${(ctx / 1000).toFixed(0)}K`;
}

async function selectOllamaModel(
	localModels: OllamaModelInfo[],
	provider: ProviderEntry,
): Promise<string | null> {
	const curated = provider.models;

	const localOptions = localModels
		.sort((a, b) => b.size - a.size)
		.map((m) => {
			const sizeGB = (m.size / 1e9).toFixed(1);
			const params = m.parameterSize || '?';
			const quant = m.quantization || '';
			return {
				value: m.name,
				label: m.name,
				hint: `${params} \u00b7 ${sizeGB}GB \u00b7 ${m.family} \u00b7 ${quant}`,
			};
		});

	const curatedNotLocal = curated.filter((cm) => {
		const base = cm.id.split(':')[0];
		return !localModels.some((lm) => lm.name === cm.id || lm.name.startsWith(base));
	});

	const curatedOptions = curatedNotLocal.map((m) => ({
		value: m.id,
		label: pc.dim(`${m.displayName} (not pulled)`),
		hint: `ollama pull ${m.id}`,
	}));

	const allOptions = [
		...localOptions,
		...(curatedOptions.length > 0
			? [
					{
						value: '__sep',
						label: pc.dim('\u2500\u2500 Also available to pull \u2500\u2500'),
						hint: '',
					},
					...curatedOptions,
				]
			: []),
	];

	const modelChoice = await clack.select({
		message: 'Pick a local model (Ollama):',
		options: allOptions,
	});

	if (clack.isCancel(modelChoice)) {
		clack.cancel('Setup cancelled');
		return null;
	}

	if (modelChoice === '__sep') {
		return selectOllamaModel(localModels, provider);
	}

	return modelChoice as string;
}

export async function listProviders(): Promise<void> {
	const config = loadUserConfig();
	const [ollama, localFast] = await Promise.all([probeOllama(), probeLocalFast()]);

	console.log(pc.bold('\nAvailable Providers:\n'));

	for (const provider of PROVIDERS) {
		const isLocalFast = provider.id === 'local-fast';
		const isOllama = provider.id === 'ollama';

		let hasKey: boolean;
		let statusLabel: string;

		if (isLocalFast) {
			hasKey = localFast.running;
			statusLabel = localFast.running
				? pc.dim(` (running, port ${localFast.port})`)
				: pc.dim(' (not running)');
		} else if (isOllama) {
			hasKey = ollama.running;
			statusLabel =
				!provider.needsApiKey && ollama.running
					? pc.dim(` (running, ${ollama.models.length} models pulled)`)
					: '';
		} else {
			hasKey = !!resolveApiKey(provider, config);
			statusLabel = '';
		}

		const icon = hasKey ? pc.green('\u2713') : pc.red('\u2717');
		const freeLabel =
			provider.free === true ? ' [FREE]' : provider.free === 'limited' ? ' [Free tier]' : '';
		console.log(`  ${icon} ${pc.bold(provider.displayName)}${freeLabel}${statusLabel}`);
		console.log(`    ${pc.dim(`Base: ${provider.baseUrl}`)}`);
		console.log(`    ${pc.dim(`Env:  ${provider.envVar || 'none'}`)}`);
		console.log(`    ${pc.dim(`${provider.models.length} models`)}\n`);
	}
}

export async function listModels(providerId?: string): Promise<void> {
	const config = loadUserConfig();
	const [ollama, localFast] = await Promise.all([probeOllama(), probeLocalFast()]);

	if (providerId) {
		const provider = PROVIDERS.find((p) => p.id === providerId);
		if (!provider) {
			console.error(pc.red(`Unknown provider: ${providerId}`));
			return;
		}
		if (provider.id === 'local-fast') {
			printLocalFastModels(localFast, provider);
		} else if (!provider.needsApiKey) {
			printLocalModels(ollama, provider);
		} else {
			await printProviderModels(provider, config);
		}
		return;
	}

	const available = PROVIDERS.filter((p) =>
		p.id === 'local-fast'
			? localFast.running
			: !p.needsApiKey
				? ollama.running
				: !!resolveApiKey(p, config),
	);
	if (available.length === 0) {
		console.log(pc.dim('No providers configured. Run: wmind --configure'));
		return;
	}

	for (const provider of available) {
		if (provider.id === 'local-fast') {
			printLocalFastModels(localFast, provider);
		} else if (!provider.needsApiKey) {
			printLocalModels(ollama, provider);
		} else {
			await printProviderModels(provider, config);
		}
	}
}

function printLocalFastModels(localFast: LocalFastProbeResult, provider: ProviderEntry): void {
	console.log(pc.bold(`\n${provider.displayName}:\n`));

	if (!localFast.running) {
		console.log(pc.dim('  Not running. Start it: wmind-serve start'));
		return;
	}

	for (const m of provider.models) {
		const ctx = formatCtx(m.contextWindow);
		const features = [
			m.supportsReasoning ? pc.cyan('think') : '',
			m.supportsToolCalling ? pc.green('tools') : '',
		]
			.filter(Boolean)
			.join(' ');
		console.log(`  ${pc.bold(m.id.padEnd(40))} Free (local)  ${ctx.padEnd(8)} ${features}`);
	}
}

function printLocalModels(
	ollama: { running: boolean; models: OllamaModelInfo[] },
	provider: ProviderEntry,
): void {
	console.log(pc.bold(`\n${provider.displayName}:\n`));

	if (!ollama.running) {
		console.log(pc.dim('  Not running. Start it with the appropriate command.'));
		return;
	}

	if (ollama.models.length === 0) {
		console.log(pc.dim('  No models pulled yet.'));
		return;
	}

	for (const m of ollama.models.sort((a, b) => b.size - a.size)) {
		const sizeGB = (m.size / 1e9).toFixed(1);
		const params = m.parameterSize || '';
		const quant = m.quantization || '';
		console.log(
			`  ${pc.bold(m.name.padEnd(35))} ${params.padEnd(12)} ${sizeGB.padEnd(8)}GB ${quant}`,
		);
	}

	const curated = provider.models;
	const curatedNotLocal = curated.filter((cm) => {
		const base = cm.id.split(':')[0];
		return !ollama.models.some((lm) => lm.name === cm.id || lm.name.startsWith(base));
	});

	if (curatedNotLocal.length > 0) {
		console.log(pc.dim(`\n  \u2500\u2500 Available to pull \u2500\u2500`));
		for (const m of curatedNotLocal) {
			console.log(`  ${pc.dim(m.id.padEnd(35))} ${pc.dim(`ollama pull ${m.id}`)}`);
		}
	}
}

async function printProviderModels(provider: ProviderEntry, config?: UserConfig): Promise<void> {
	console.log(pc.bold(`\n${provider.displayName}:\n`));
	const curatedIds = new Set(provider.models.map((m) => m.id));
	const models = await getMergedModels(provider, config);
	const remoteCount = models.length - curatedIds.size;
	if (remoteCount > 0) {
		console.log(pc.dim(`  (${models.length} models, ${remoteCount} discovered remotely)`));
	}
	for (const m of models) {
		const price =
			m.inputPricePer1M === 0 ? 'Free' : `$${m.inputPricePer1M}/$${m.outputPricePer1M}`;
		const ctx = formatCtx(m.contextWindow);
		const badges = [
			m.supportsReasoning ? pc.cyan('think') : '',
			m.supportsToolCalling ? pc.green('tools') : '',
		]
			.filter(Boolean)
			.join(' ');
		const aliases = m.aliases?.length ? pc.dim(` [${m.aliases.join(', ')}]`) : '';
		const remote = !curatedIds.has(m.id) ? pc.dim(' [remote]') : '';
		console.log(
			`  ${pc.bold(m.id.padEnd(40))} ${price.padEnd(18)} ${ctx.padEnd(8)} ${badges}${aliases}${remote}`,
		);
	}
}
