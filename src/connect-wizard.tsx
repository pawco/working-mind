import { Box, Text } from 'ink';
import { forwardRef, useCallback, useImperativeHandle, useState } from 'react';
import { loadUserConfig, type UserConfig, writeUserConfig } from './config.js';
import { storeKey } from './keychain.js';
import { getMergedModels } from './sdk/model-discovery.js';
import {
	getOtherProviders,
	getPrimaryProviders,
	type ModelEntry,
	type ProviderEntry,
} from './sdk/provider-registry.js';
import {
	type OllamaModelInfo,
	probeOllama,
	resolveApiKey,
} from './sdk/provider-resolve.js';

type ConnectStep =
	| { id: 'provider-select'; cursor: number; showMore: boolean }
	| {
			id: 'model-select';
			provider: ProviderEntry;
			cursor: number;
			ollamaModels: OllamaModelInfo[];
			mergedModels: ModelEntry[];
			discovering: boolean;
	  }
	| {
			id: 'api-key';
			provider: ProviderEntry;
			modelId: string;
			input: string;
			masked: string;
			error: string;
	  }
	| { id: 'validating'; provider: ProviderEntry; modelId: string }
	| {
			id: 'connected';
			provider: ProviderEntry;
			modelId: string;
			keySaved: boolean;
	  }
	| { id: 'error'; provider: ProviderEntry; error: string };

export interface ConnectWizardHandle {
	handleKey: (inputChar: string, key: any) => void;
}

export interface ConnectWizardProps {
	onDone: (message: string, model?: string) => void;
	getUserConfig?: () => any;
}

const MASK_CHAR = '•';

function maskInput(input: string): string {
	return MASK_CHAR.repeat(input.length);
}

function formatContextWindow(ctx: number): string {
	if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(1)}M`;
	return `${(ctx / 1000).toFixed(0)}K`;
}

function formatPrice(m: ModelEntry): string {
	if (m.inputPricePer1M === 0) return 'Free (local)';
	return `$${m.inputPricePer1M}/$${m.outputPricePer1M} per 1M`;
}

function formatFeatures(m: ModelEntry): string {
	const parts: string[] = [];
	if (m.supportsReasoning) parts.push('thinking');
	if (m.supportsToolCalling) parts.push('tools');
	return parts.join(', ') || 'chat only';
}

function buildProviderList(_userConfig: UserConfig): ProviderEntry[] {
	const primary = getPrimaryProviders();
	const other = getOtherProviders();
	return [...primary, ...other];
}

function providerHint(
	p: ProviderEntry,
	userConfig: UserConfig,
	ollamaRunning: boolean,
): { suffix: string; hint: string } {
	const hasKey = !p.needsApiKey
		? ollamaRunning
		: !!resolveApiKey(p, userConfig);
	const suffix = hasKey ? ' ✓ key detected' : '';
	let hint: string;
	if (!p.needsApiKey) {
		hint = ollamaRunning ? `${p.models.length} models curated` : 'Not running';
	} else if (p.free === true) {
		hint = 'Free';
	} else if (p.free === 'limited') {
		hint = 'Free tier';
	} else {
		hint = 'Paid';
	}
	return { suffix, hint };
}

export const ConnectWizard = forwardRef<
	ConnectWizardHandle,
	ConnectWizardProps
>(function ConnectWizard({ onDone, getUserConfig }, ref) {
	const [step, setStep] = useState<ConnectStep>({
		id: 'provider-select',
		cursor: 0,
		showMore: false,
	});
	const [ollamaState, setOllamaState] = useState<{
		running: boolean;
		models: OllamaModelInfo[];
		probed: boolean;
	}>({ running: false, models: [], probed: false });
	const [userConfig] = useState<UserConfig>(() => loadUserConfig());

	if (!ollamaState.probed) {
		setOllamaState((prev) => ({ ...prev, probed: true }));
		probeOllama().then((result) => {
			setOllamaState({ ...result, probed: true });
		});
	}

	const finishConnect = useCallback(
		(provider: ProviderEntry, modelId: string, apiKey: string) => {
			const cfg = getUserConfig
				? JSON.parse(JSON.stringify(getUserConfig()))
				: loadUserConfig();
			if (!cfg.providers) cfg.providers = {};
			if (provider.needsApiKey && apiKey) {
				cfg.providers[provider.id] = {
					apiKey: `env:${provider.envVar}`,
					baseUrl: provider.baseUrl,
				};
			} else if (!provider.needsApiKey) {
				cfg.providers[provider.id] = {
					baseUrl: ollamaState.running
						? 'http://localhost:11434/v1'
						: provider.baseUrl,
				};
			}
			const fullModelId =
				provider.modelIdFormat === 'provider-prefix'
					? `${provider.id}/${modelId}`
					: modelId;
			cfg.defaultModel = fullModelId;
			writeUserConfig(cfg);

			storeKey(provider.id, apiKey).then((ok) => {
				setStep({ id: 'connected', provider, modelId, keySaved: ok });
			});
		},
		[ollamaState.running, getUserConfig],
	);

	const doValidate = useCallback(
		(provider: ProviderEntry, apiKey: string, modelId: string) => {
			setStep({ id: 'validating', provider, modelId });
			const headers: Record<string, string> =
				provider.authStyle === 'x-api-key'
					? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
					: { Authorization: `Bearer ${apiKey}` };
			fetch(`${provider.baseUrl}/models`, {
				headers,
				signal: AbortSignal.timeout(8000),
			})
				.then((res) => {
					if (res.ok) {
						finishConnect(provider, modelId, apiKey);
					} else {
						setStep({
							id: 'error',
							provider,
							error: `${res.status} ${res.statusText} — key may still work for chat`,
						});
					}
				})
				.catch((err) => {
					setStep({
						id: 'error',
						provider,
						error: `Network error: ${err.message}`,
					});
				});
		},
		[finishConnect],
	);

	const handleKey = useCallback(
		(inputChar: string, key: any) => {
			const s = step;

			if (s.id === 'provider-select') {
				const providers = buildProviderList(userConfig);
				const primaryCount = getPrimaryProviders().length;
				const visibleCount = s.showMore ? providers.length : primaryCount;

				if (key.upArrow) {
					setStep({ ...s, cursor: Math.max(0, s.cursor - 1) });
					return;
				}
				if (key.downArrow) {
					const max = visibleCount;
					setStep({ ...s, cursor: Math.min(max, s.cursor + 1) });
					return;
				}
				if (key.escape) {
					onDone('');
					return;
				}
				if (key.return) {
					if (s.cursor === primaryCount && !s.showMore) {
						setStep({ ...s, showMore: true, cursor: primaryCount });
						return;
					}
					const idx = s.showMore
						? s.cursor
						: Math.min(s.cursor, primaryCount - 1);
					const provider = providers[idx];
					if (!provider) return;

					if (!provider.needsApiKey) {
						const initModels = [...provider.models];
						setStep({
							id: 'model-select',
							provider,
							cursor: 0,
							ollamaModels: ollamaState.running ? ollamaState.models : [],
							mergedModels: initModels,
							discovering: false,
						});
					} else {
						const existingKey = resolveApiKey(provider, userConfig);
						const initModels = [...provider.models];
						if (existingKey && provider.canValidate) {
							setStep({
								id: 'model-select',
								provider,
								cursor: 0,
								ollamaModels: [],
								mergedModels: initModels,
								discovering: true,
							});
							getMergedModels(provider, userConfig).then((merged) => {
								setStep((prev) =>
									prev.id === 'model-select' && prev.provider.id === provider.id
										? { ...prev, mergedModels: merged, discovering: false }
										: prev,
								);
							});
						} else if (existingKey) {
							setStep({
								id: 'model-select',
								provider,
								cursor: 0,
								ollamaModels: [],
								mergedModels: initModels,
								discovering: false,
							});
						} else {
							const firstModel = provider.models[0];
							setStep({
								id: 'api-key',
								provider,
								modelId: firstModel?.id || '',
								input: '',
								masked: '',
								error: '',
							});
						}
					}
				}
				return;
			}

			if (s.id === 'model-select') {
				const models = buildModelList(
					s.provider,
					s.ollamaModels,
					s.mergedModels,
				);
				if (key.upArrow) {
					setStep({ ...s, cursor: Math.max(0, s.cursor - 1) });
					return;
				}
				if (key.downArrow) {
					setStep({ ...s, cursor: Math.min(models.length - 1, s.cursor + 1) });
					return;
				}
				if (key.escape) {
					setStep({ id: 'provider-select', cursor: 0, showMore: false });
					return;
				}
				if (key.return) {
					const entry = models[s.cursor];
					if (!entry) return;
					if (entry.type === 'separator') return;

					const modelId = entry.modelId;
					if (s.provider.needsApiKey) {
						const existingKey = resolveApiKey(s.provider, userConfig);
						if (existingKey) {
							if (s.provider.canValidate) {
								doValidate(s.provider, existingKey, modelId);
							} else {
								finishConnect(s.provider, modelId, existingKey);
							}
						} else {
							setStep({
								id: 'api-key',
								provider: s.provider,
								modelId,
								input: '',
								masked: '',
								error: '',
							});
						}
					} else {
						finishConnect(s.provider, modelId, '');
					}
				}
				return;
			}

			if (s.id === 'api-key') {
				if (key.escape) {
					setStep({
						id: 'model-select',
						provider: s.provider,
						cursor: 0,
						ollamaModels: ollamaState.models,
						mergedModels: [...s.provider.models],
						discovering: false,
					});
					return;
				}
				if (key.return) {
					const apiKey = s.input.trim();
					if (!apiKey) {
						setStep({ ...s, error: 'API key is required' });
						return;
					}
					if (s.provider.canValidate) {
						doValidate(s.provider, apiKey, s.modelId);
					} else {
						finishConnect(s.provider, s.modelId, apiKey);
					}
					return;
				}
				if (key.backspace) {
					const newInput = s.input.slice(0, -1);
					setStep({
						...s,
						input: newInput,
						masked: maskInput(newInput),
						error: '',
					});
					return;
				}
				if (!key.ctrl && !key.meta && inputChar) {
					const newInput = s.input + inputChar;
					setStep({
						...s,
						input: newInput,
						masked: maskInput(newInput),
						error: '',
					});
				}
				return;
			}

			if (s.id === 'validating') {
				if (key.escape) {
					onDone('Validation in progress...');
				}
				return;
			}

			if (s.id === 'connected') {
				if (key.return || key.escape) {
					const fullModelId =
						s.provider.modelIdFormat === 'provider-prefix'
							? `${s.provider.id}/${s.modelId}`
							: s.modelId;
					const keyMsg = s.keySaved
						? 'API key saved to OS keychain'
						: `Set ${s.provider.envVar} in your shell profile`;
					onDone(
						`Connected to ${s.provider.displayName}. Model: ${fullModelId}. ${keyMsg}.`,
						fullModelId,
					);
				}
				return;
			}

			if (s.id === 'error') {
				if (key.return || key.escape) {
					onDone(`Connection failed: ${s.error}`);
				}
				return;
			}
		},
		[step, userConfig, ollamaState, onDone, doValidate, finishConnect],
	);

	useImperativeHandle(ref, () => ({ handleKey }), [handleKey]);

	return (
		<Box
			flexDirection="column"
			flexGrow={1}
			backgroundColor="#0a0a1a"
			paddingX={2}
			paddingY={1}
			overflow="hidden"
		>
			{renderStep(step, userConfig, ollamaState)}
			<Box marginTop={1}>
				<Text dimColor>Esc = back · Enter = confirm</Text>
			</Box>
		</Box>
	);
});

interface ModelListEntry {
	type: 'model' | 'separator' | 'pull-hint';
	modelId: string;
	label: string;
	hint: string;
}

function buildModelList(
	provider: ProviderEntry,
	ollamaModels: OllamaModelInfo[],
	mergedModels?: ModelEntry[],
): ModelListEntry[] {
	if (!provider.needsApiKey && ollamaModels.length > 0) {
		const localEntries: ModelListEntry[] = ollamaModels
			.sort((a, b) => b.size - a.size)
			.map((m) => ({
				type: 'model' as const,
				modelId: m.name,
				label: m.name,
				hint: `${m.parameterSize || '?'} · ${(m.size / 1e9).toFixed(1)}GB · ${m.family}`,
			}));

		const curatedNotLocal = provider.models.filter((cm) => {
			const base = cm.id.split(':')[0];
			return !ollamaModels.some(
				(lm) => lm.name === cm.id || lm.name.startsWith(base),
			);
		});

		if (curatedNotLocal.length > 0) {
			localEntries.push({
				type: 'separator',
				modelId: '',
				label: '── Also available to pull ──',
				hint: '',
			});
			for (const m of curatedNotLocal) {
				localEntries.push({
					type: 'pull-hint',
					modelId: m.id,
					label: `${m.displayName} (not pulled)`,
					hint: `ollama pull ${m.id}`,
				});
			}
		}
		return localEntries;
	}

	const models = mergedModels ?? provider.models;
	const curatedIds = new Set(provider.models.map((m) => m.id));

	return models.slice(0, 50).map((m) => {
		const isRemote = !curatedIds.has(m.id);
		return {
			type: 'model' as const,
			modelId: m.id,
			label: `${m.displayName}${isRemote ? ' [remote]' : ''}`,
			hint: `${formatPrice(m)} · ${formatContextWindow(m.contextWindow)} ctx · ${formatFeatures(m)}`,
		};
	});
}

function renderStep(
	s: ConnectStep,
	userConfig: UserConfig,
	ollamaState: { running: boolean; models: OllamaModelInfo[]; probed: boolean },
): React.ReactNode {
	if (s.id === 'provider-select') {
		const providers = buildProviderList(userConfig);
		const primaryCount = getPrimaryProviders().length;
		const visibleProviders = s.showMore
			? providers
			: providers.slice(0, primaryCount);

		return (
			<Box flexDirection="column">
				<Text bold color="cyan">
					Connect a Provider
				</Text>
				<Text dimColor>────────────────────</Text>
				<Text dimColor>↑↓ navigate · Enter select</Text>
				<Box flexDirection="column" marginTop={1}>
					{visibleProviders.map((p, i) => {
						const { suffix, hint } = providerHint(
							p,
							userConfig,
							ollamaState.running,
						);
						const selected = s.cursor === i;
						return (
							<Box key={p.id}>
								{selected ? (
									<Text color="cyan" bold>
										{'▸ '}
									</Text>
								) : (
									<Text dimColor>{'  '}</Text>
								)}
								<Text bold={selected} color={selected ? 'white' : 'gray'}>
									{p.displayName}
									{suffix && <Text color="green">{suffix}</Text>}
								</Text>
								<Text dimColor> {hint}</Text>
							</Box>
						);
					})}
					{!s.showMore && (
						<Box>
							{s.cursor === primaryCount ? (
								<Text color="cyan" bold>
									{'▸ '}
								</Text>
							) : (
								<Text dimColor>{'  '}</Text>
							)}
							<Text dimColor>More providers...</Text>
							<Text dimColor> {getOtherProviders().length} more</Text>
						</Box>
					)}
				</Box>
			</Box>
		);
	}

	if (s.id === 'model-select') {
		const models = buildModelList(s.provider, s.ollamaModels, s.mergedModels);
		return (
			<Box flexDirection="column">
				<Text bold color="cyan">
					Pick a Model ({s.provider.displayName})
				</Text>
				<Text dimColor>────────────────────</Text>
				<Text dimColor>↑↓ navigate · Enter select · Esc back</Text>
				{s.discovering && (
					<Text color="yellow">⏳ Discovering remote models...</Text>
				)}
				<Box flexDirection="column" marginTop={1}>
					{models.map((entry, i) => {
						if (entry.type === 'separator') {
							return (
								<Box key={`sep-${entry.label}`}>
									<Text dimColor>{entry.label}</Text>
								</Box>
							);
						}
						const selected = s.cursor === i;
						return (
							<Box key={entry.modelId}>
								{selected ? (
									<Text color="cyan" bold>
										{'▸ '}
									</Text>
								) : (
									<Text dimColor>{'  '}</Text>
								)}
								<Text bold={selected} color={selected ? 'white' : 'gray'}>
									{entry.label}
								</Text>
								<Text dimColor> {entry.hint}</Text>
							</Box>
						);
					})}
				</Box>
			</Box>
		);
	}

	if (s.id === 'api-key') {
		return (
			<Box flexDirection="column">
				<Text bold color="cyan">
					Enter API Key
				</Text>
				<Text dimColor>────────────────────</Text>
				<Text dimColor>Provider: {s.provider.displayName}</Text>
				<Text dimColor>Model: {s.modelId}</Text>
				<Box marginTop={1}>
					<Text color="white">{s.provider.envVar}: </Text>
					<Text color="cyan">{s.masked}</Text>
					<Text dimColor>▍</Text>
				</Box>
				{s.error && <Text color="red">{s.error}</Text>}
				<Text dimColor>Key will be saved to OS keychain</Text>
			</Box>
		);
	}

	if (s.id === 'validating') {
		return (
			<Box flexDirection="column">
				<Text bold color="cyan">
					Validating Connection
				</Text>
				<Text dimColor>────────────────────</Text>
				<Text color="yellow">⏳ Connecting to {s.provider.displayName}...</Text>
				<Text dimColor>Checking {s.provider.baseUrl}/models</Text>
			</Box>
		);
	}

	if (s.id === 'connected') {
		return (
			<Box flexDirection="column">
				<Text bold color="green">
					Connected!
				</Text>
				<Text dimColor>────────────────────</Text>
				<Text color="green">✓ {s.provider.displayName}</Text>
				<Box flexDirection="column" paddingLeft={2}>
					<Text>
						Model:{' '}
						<Text color="cyan">
							{s.provider.modelIdFormat === 'provider-prefix'
								? `${s.provider.id}/${s.modelId}`
								: s.modelId}
						</Text>
					</Text>
					<Text>
						Key:{' '}
						{s.keySaved ? (
							<Text color="green">saved to OS keychain</Text>
						) : (
							<Text color="yellow">set {s.provider.envVar} in shell</Text>
						)}
					</Text>
				</Box>
				<Box marginTop={1}>
					<Text dimColor>Press Enter to continue</Text>
				</Box>
			</Box>
		);
	}

	if (s.id === 'error') {
		return (
			<Box flexDirection="column">
				<Text bold color="red">
					Connection Failed
				</Text>
				<Text dimColor>────────────────────</Text>
				<Text color="red">✗ {s.provider.displayName}</Text>
				<Text color="red">{s.error}</Text>
				<Box marginTop={1}>
					<Text dimColor>Press Enter to continue</Text>
				</Box>
			</Box>
		);
	}

	return null;
}
