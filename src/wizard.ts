import * as clack from '@clack/prompts';
import pc from 'picocolors';
import { loadUserConfig, type UserConfig, writeUserConfig } from './config.js';
import { storeKey } from './keychain.js';
import { getMergedModels } from './sdk/model-discovery.js';
import {
	getOtherProviders,
	getPrimaryProviders,
	PROVIDERS,
	type ProviderEntry,
} from './sdk/provider-registry.js';
import {
	type OllamaModelInfo,
	probeOllama,
	resolveApiKey,
	resolveOllamaModelName,
} from './sdk/provider-resolve.js';

export async function runWizard(): Promise<UserConfig | null> {
	const config = loadUserConfig();

	clack.intro(pc.bgCyan(pc.black(' OpenExplorer — First Run Setup ')));

	const ollama = await probeOllama();

	const primaryProviders = getPrimaryProviders();
	const otherProviders = getOtherProviders();

	const providerOptions: { value: string; label: string; hint: string }[] = [];

	for (const p of primaryProviders) {
		const hasKey = !p.needsApiKey ? ollama.running : !!resolveApiKey(p);
		const suffix = hasKey ? pc.green(' ✓ key detected') : '';
		const hint = !p.needsApiKey
			? ollama.running
				? `${ollama.models.length} models pulled`
				: 'Not running'
			: p.free === true
				? 'Free'
				: p.free === 'limited'
					? 'Free tier'
					: 'Paid';
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
			const hasKey = !!resolveApiKey(p);
			const suffix = hasKey ? pc.green(' ✓ key detected') : '';
			const hint =
				p.free === true ? 'Free' : p.free === 'limited' ? 'Free tier' : 'Paid';
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

	if (!provider.needsApiKey && ollama.running) {
		const ollamaResult = await selectOllamaModel(ollama.models, provider);
		if (!ollamaResult) return null;
		selectedModelId = ollamaResult;
	} else {
		const modelOptions = provider.models.slice(0, 15).map((m) => {
			const price =
				m.inputPricePer1M === 0
					? 'Free (local)'
					: `$${m.inputPricePer1M}/$${m.outputPricePer1M} per 1M`;
			const ctx =
				m.contextWindow >= 1000000
					? `${(m.contextWindow / 1000000).toFixed(1)}M`
					: `${(m.contextWindow / 1000).toFixed(0)}K`;
			const features =
				[
					m.supportsReasoning ? 'thinking' : '',
					m.supportsToolCalling ? 'tools' : '',
				]
					.filter(Boolean)
					.join(', ') || 'chat only';
			return {
				value: m.id,
				label: m.displayName,
				hint: `${price} · ${ctx} ctx · ${features}`,
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
				mask: '•',
			});
			if (clack.isCancel(keyInput)) {
				clack.cancel('Setup cancelled');
				return null;
			}
			apiKey = keyInput as string;
		}

		const keytarOk = await storeKey(provider.id, apiKey);
		if (keytarOk) {
			clack.log.success('API key saved to OS keychain');
		} else {
			const envVar = provider.envVar;
			clack.log.step(
				`Add to your shell profile: ${pc.cyan(`export ${envVar}=***`)}`,
			);
		}
	}

	const fullModelId = !provider.needsApiKey
		? `${provider.id}/${selectedModelId}`
		: provider.models.some((m) => m.id === selectedModelId) &&
				provider.modelIdFormat === 'provider-prefix'
			? `${provider.id}/${selectedModelId}`
			: selectedModelId;

	config.defaultModel = fullModelId;

	if (!config.providers) config.providers = {};
	if (provider.needsApiKey && apiKey) {
		config.providers[provider.id] = {
			apiKey: `env:${provider.envVar}`,
			baseUrl: provider.baseUrl,
		};
	} else if (!provider.needsApiKey) {
		config.providers[provider.id] = {
			baseUrl: ollama.running ? 'http://localhost:11434/v1' : provider.baseUrl,
		};
	}

	writeUserConfig(config);
	clack.log.success(
		`Config written to ${pc.dim('~/.openexplorer/config.jsonc')}`,
	);

	if (!provider.needsApiKey) {
		const resolved = resolveOllamaModelName(selectedModelId, ollama.models);
		if (resolved !== selectedModelId) {
			clack.log.step(`Resolved model: ${selectedModelId} → ${resolved}`);
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
				s.stop(
					`Could not validate — ${testRes.status} (key may still work for chat)`,
				);
			}
		} catch {
			s.stop('Could not reach provider (network issue?)');
		}
	}

	clack.outro(
		pc.bgGreen(pc.black(` You're all set! `)) +
			`\n\n  ${pc.cyan('openexplorer')}                          → Start interactive session\n  ${pc.cyan('openexplorer --pack elgap')}             → With ElGap tools\n`,
	);

	return config;
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
				hint: `${params} · ${sizeGB}GB · ${m.family} · ${quant}`,
			};
		});

	const curatedNotLocal = curated.filter((cm) => {
		const base = cm.id.split(':')[0];
		return !localModels.some(
			(lm) => lm.name === cm.id || lm.name.startsWith(base),
		);
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
						label: pc.dim('── Also available to pull ──'),
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
	const ollama = await probeOllama();

	console.log(pc.bold('\nAvailable Providers:\n'));

	for (const provider of PROVIDERS) {
		const hasKey = !provider.needsApiKey
			? ollama.running
			: !!resolveApiKey(provider, config);
		const icon = hasKey ? pc.green('✓') : pc.red('✗');
		const freeLabel =
			provider.free === true
				? ' [FREE]'
				: provider.free === 'limited'
					? ' [Free tier]'
					: '';
		const localLabel =
			!provider.needsApiKey && ollama.running
				? pc.dim(` (running, ${ollama.models.length} models pulled)`)
				: '';
		console.log(
			`  ${icon} ${pc.bold(provider.displayName)}${freeLabel}${localLabel}`,
		);
		console.log(`    ${pc.dim(`Base: ${provider.baseUrl}`)}`);
		console.log(`    ${pc.dim(`Env:  ${provider.envVar || 'none'}`)}`);
		console.log(`    ${pc.dim(`${provider.models.length} models`)}\n`);
	}
}

export async function listModels(providerId?: string): Promise<void> {
	const config = loadUserConfig();
	const ollama = await probeOllama();

	if (providerId) {
		const provider = PROVIDERS.find((p) => p.id === providerId);
		if (!provider) {
			console.error(pc.red(`Unknown provider: ${providerId}`));
			return;
		}
		if (!provider.needsApiKey) {
			printLocalModels(ollama, provider);
		} else {
			await printProviderModels(provider, config);
		}
		return;
	}

	const available = PROVIDERS.filter((p) =>
		!p.needsApiKey ? ollama.running : !!resolveApiKey(p, config),
	);
	if (available.length === 0) {
		console.log(
			pc.dim('No providers configured. Run: openexplorer --configure'),
		);
		return;
	}

	for (const provider of available) {
		if (!provider.needsApiKey) {
			printLocalModels(ollama, provider);
		} else {
			await printProviderModels(provider, config);
		}
	}
}

function printLocalModels(
	ollama: { running: boolean; models: OllamaModelInfo[] },
	provider: ProviderEntry,
): void {
	console.log(pc.bold(`\n${provider.displayName}:\n`));

	if (!ollama.running) {
		console.log(
			pc.dim('  Not running. Start it with the appropriate command.'),
		);
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
		return !ollama.models.some(
			(lm) => lm.name === cm.id || lm.name.startsWith(base),
		);
	});

	if (curatedNotLocal.length > 0) {
		console.log(pc.dim(`\n  ── Available to pull ──`));
		for (const m of curatedNotLocal) {
			console.log(
				`  ${pc.dim(m.id.padEnd(35))} ${pc.dim(`ollama pull ${m.id}`)}`,
			);
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
			m.inputPricePer1M === 0
				? 'Free'
				: `$${m.inputPricePer1M}/$${m.outputPricePer1M}`;
		const ctx =
			m.contextWindow >= 1000000
				? `${(m.contextWindow / 1000000).toFixed(1)}M`
				: `${(m.contextWindow / 1000).toFixed(0)}K`;
		const badges = [
			m.supportsReasoning ? pc.cyan('think') : '',
			m.supportsToolCalling ? pc.green('tools') : '',
		]
			.filter(Boolean)
			.join(' ');
		const aliases = m.aliases?.length
			? pc.dim(` [${m.aliases.join(', ')}]`)
			: '';
		const remote = !curatedIds.has(m.id) ? pc.dim(' [remote]') : '';
		console.log(
			`  ${pc.bold(m.id.padEnd(40))} ${price.padEnd(18)} ${ctx.padEnd(8)} ${badges}${aliases}${remote}`,
		);
	}
}
