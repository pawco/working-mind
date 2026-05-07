import {
	forwardRef,
	createElement as h,
	useCallback,
	useEffect,
	useImperativeHandle,
	useState,
} from 'react';
import { loadUserConfig, type UserConfig, writeUserConfig } from './config.js';
import { getMergedModels } from './sdk/model-discovery.js';
import {
	getOtherProviders,
	getPrimaryProviders,
	type ModelEntry,
	type ProviderEntry,
} from './sdk/provider-registry.js';
import {
	cacheApiKey,
	type LocalFastProbeResult,
	probeLocalFast,
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
			localFastModels: ModelEntry[];
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
	  }
	| { id: 'error'; provider: ProviderEntry; modelId: string; error: string };

export interface ConnectWizardHandle {
	handleKey: (inputChar: string, key: any) => void;
	handlePaste: (text: string) => void;
}

export interface ConnectWizardProps {
	onDone: (message: string, model?: string) => void;
	getUserConfig?: () => any;
}

const MASK_CHAR = '\u2022';

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
	localFastState: LocalFastProbeResult,
	ollamaRunning: boolean,
): { suffix: string; hint: string } {
	const isLocalFast = p.id === 'local-fast';
	const isOllama = p.id === 'ollama';

	let hasKey: boolean;
	if (isLocalFast) {
		hasKey = localFastState.running;
	} else if (isOllama) {
		hasKey = ollamaRunning;
	} else {
		hasKey = !!resolveApiKey(p, userConfig);
	}

	const suffix = hasKey ? ' \u2713 available' : '';
	let hint: string;
	if (isLocalFast) {
		hint = localFastState.running ? `Running (port ${localFastState.port})` : 'Not running';
	} else if (isOllama) {
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
	const [localFastState, setLocalFastState] = useState<LocalFastProbeResult>({
		running: false,
		baseUrl: '',
		model: '',
		port: 19421,
		probed: false,
	} as LocalFastProbeResult & { probed: boolean });
	const [userConfig] = useState<UserConfig>(() => loadUserConfig());

	useEffect(() => {
		Promise.all([probeOllama(), probeLocalFast()]).then(
			([ollama, localFast]) => {
				setOllamaState({ ...ollama, probed: true });
				setLocalFastState({ ...localFast, probed: true });
			},
		);
	}, []);

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
			} else if (provider.id === 'local-fast') {
				cfg.providers[provider.id] = {
					baseUrl: localFastState.running
						? localFastState.baseUrl
						: provider.baseUrl,
				};
			} else if (provider.id === 'ollama') {
				cfg.providers[provider.id] = {
					baseUrl: ollamaState.running
						? 'http://localhost:11434/v1'
						: provider.baseUrl,
				};
			}
			const fullModelId = `${provider.id}/${modelId}`;
			cfg.defaultModel = fullModelId;
			writeUserConfig(cfg);

			if (apiKey) cacheApiKey(provider.id, apiKey);

			setStep({ id: 'connected', provider, modelId });
		},
		[ollamaState.running, localFastState, getUserConfig],
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
							modelId,
							error: `${res.status} ${res.statusText} \u2014 key may still work for chat`,
						});
					}
				})
				.catch((err) => {
					setStep({
						id: 'error',
						provider,
						modelId,
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

					if (provider.id === 'local-fast') {
						if (localFastState.running && localFastState.model) {
							finishConnect(provider, localFastState.model, '');
						} else {
							setStep({
								id: 'error',
								provider,
								modelId: '',
								error: 'Local Fast is not running. Start it with: wmind-serve start',
							});
						}
					} else if (!provider.needsApiKey) {
						const initModels = [...provider.models];
						setStep({
							id: 'model-select',
							provider,
							cursor: 0,
							ollamaModels: ollamaState.running ? ollamaState.models : [],
							localFastModels: [],
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
								localFastModels: [],
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
								localFastModels: [],
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
					s.localFastModels,
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
						localFastModels: [],
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
					const fullModelId = `${s.provider.id}/${s.modelId}`;
					const keyMsg = s.provider.envVar
						? `Set ${s.provider.envVar} in your shell profile`
						: 'Key active for this session';
					onDone(
						`Connected to ${s.provider.displayName}. Model: ${fullModelId}. ${keyMsg}.`,
						fullModelId,
					);
				}
				return;
			}

			if (s.id === 'error') {
				if (key.return) {
					setStep({
						id: 'api-key',
						provider: s.provider,
						modelId: s.modelId,
						input: '',
						masked: '',
						error: '',
					});
					return;
				}
				if (key.escape) {
					onDone(`Connection failed: ${s.error}`);
				}
				return;
			}
		},
		[step, userConfig, ollamaState, localFastState, onDone, doValidate, finishConnect],
	);

	const handlePaste = useCallback(
		(text: string) => {
			const s = step;
			if (s.id === 'api-key') {
				const newInput = s.input + text;
				setStep({
					...s,
					input: newInput,
					masked: maskInput(newInput),
					error: '',
				});
			}
		},
		[step],
	);

	useImperativeHandle(ref, () => ({ handleKey, handlePaste }), [
		handleKey,
		handlePaste,
	]);

	return h(
		'box',
		{
			flexDirection: 'column',
			flexGrow: 1,
			backgroundColor: '#0a0a1a',
			paddingX: 2,
			paddingY: 1,
			overflow: 'hidden',
		},
		renderStep(step, userConfig, ollamaState, localFastState),
		h(
			'box',
			{ marginTop: 1 },
			h('text', { dimColor: true, content: 'Esc = back \u00b7 Enter = confirm' }),
		),
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
	localFastModels: ModelEntry[],
	mergedModels?: ModelEntry[],
): ModelListEntry[] {
	if (provider.id === 'local-fast') {
		const models = localFastModels.length > 0 ? localFastModels : provider.models;
		return models.map((m) => ({
			type: 'model' as const,
			modelId: m.id,
			label: m.displayName,
			hint: `${formatPrice(m)} \u00b7 ${formatContextWindow(m.contextWindow)} ctx \u00b7 ${formatFeatures(m)}`,
		}));
	}

	if (provider.id === 'ollama' && ollamaModels.length > 0) {
		const localEntries: ModelListEntry[] = ollamaModels
			.sort((a, b) => b.size - a.size)
			.map((m) => ({
				type: 'model' as const,
				modelId: m.name,
				label: m.name,
				hint: `${m.parameterSize || '?'} \u00b7 ${(m.size / 1e9).toFixed(1)}GB \u00b7 ${m.family}`,
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
				label: '\u2500\u2500 Also available to pull \u2500\u2500',
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
			hint: `${formatPrice(m)} \u00b7 ${formatContextWindow(m.contextWindow)} ctx \u00b7 ${formatFeatures(m)}`,
		};
	});
}

function renderStep(
	s: ConnectStep,
	userConfig: UserConfig,
	ollamaState: { running: boolean; models: OllamaModelInfo[]; probed: boolean },
	localFastState: LocalFastProbeResult & { probed: boolean },
): React.ReactNode {
	if (s.id === 'provider-select') {
		const providers = buildProviderList(userConfig);
		const primaryCount = getPrimaryProviders().length;
		const visibleProviders = s.showMore
			? providers
			: providers.slice(0, primaryCount);

		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'cyan', content: 'Connect a Provider' }),
			h('text', { dimColor: true, content: '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' }),
			h('text', { dimColor: true, content: '\u2191\u2193 navigate \u00b7 Enter select' }),
			h(
				'box',
				{ flexDirection: 'column', marginTop: 1 },
				...visibleProviders.map((p, i) => {
					const { suffix, hint } = providerHint(
						p,
						userConfig,
						localFastState,
						ollamaState.running,
					);
					const selected = s.cursor === i;
					return h(
						'box',
						{ key: p.id },
						selected
							? h('text', { fg: 'cyan', bold: true, content: '\u25b8 ' })
							: h('text', { dimColor: true, content: '  ' }),
						h(
							'box',
							null,
							h('text', {
								bold: selected,
								fg: selected ? 'white' : 'gray',
								content: p.displayName,
							}),
							suffix ? h('text', { fg: 'green', content: suffix }) : null,
						),
						h('text', { dimColor: true, content: ` ${hint}` }),
					);
				}),
				!s.showMore
					? h(
							'box',
							null,
							s.cursor === primaryCount
								? h('text', { fg: 'cyan', bold: true, content: '\u25b8 ' })
								: h('text', { dimColor: true, content: '  ' }),
							h('text', { dimColor: true, content: 'More providers...' }),
							h('text', {
								dimColor: true,
								content: ` ${getOtherProviders().length} more`,
							}),
						)
					: null,
			),
		);
	}

	if (s.id === 'model-select') {
		const models = buildModelList(s.provider, s.ollamaModels, s.localFastModels, s.mergedModels);
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', {
				bold: true,
				fg: 'cyan',
				content: `Pick a Model (${s.provider.displayName})`,
			}),
			h('text', { dimColor: true, content: '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' }),
			h('text', {
				dimColor: true,
				content: '\u2191\u2193 navigate \u00b7 Enter select \u00b7 Esc back',
			}),
			s.discovering
				? h('text', {
						fg: 'yellow',
						content: '\u23f3 Discovering models...',
					})
				: null,
			h(
				'box',
				{ flexDirection: 'column', marginTop: 1 },
				...models.map((entry, i) => {
					if (entry.type === 'separator') {
						return h(
							'box',
							{ key: `sep-${entry.label}` },
							h('text', { dimColor: true, content: entry.label }),
						);
					}
					const selected = s.cursor === i;
					return h(
						'box',
						{ key: entry.modelId },
						selected
							? h('text', { fg: 'cyan', bold: true, content: '\u25b8 ' })
							: h('text', { dimColor: true, content: '  ' }),
						h('text', {
							bold: selected,
							fg: selected ? 'white' : 'gray',
							content: entry.label,
						}),
						h('text', { dimColor: true, content: ` ${entry.hint}` }),
					);
				}),
			),
		);
	}

	if (s.id === 'api-key') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'cyan', content: 'Enter API Key' }),
			h('text', { dimColor: true, content: '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' }),
			h('text', {
				dimColor: true,
				content: `Provider: ${s.provider.displayName}`,
			}),
			h('text', { dimColor: true, content: `Model: ${s.modelId}` }),
			h(
				'box',
				{ marginTop: 1 },
				h('text', { fg: 'white', content: `${s.provider.envVar}: ` }),
				h('text', { fg: 'cyan', content: s.masked }),
				h('text', { dimColor: true, content: '\u258d' }),
			),
			s.error ? h('text', { fg: 'red', content: s.error }) : null,
			h('text', {
				dimColor: true,
				content: s.provider.envVar
					? `Key works this session. Set ${s.provider.envVar} for persistence.`
					: 'Key works for this session',
			}),
		);
	}

	if (s.id === 'validating') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'cyan', content: 'Validating Connection' }),
			h('text', { dimColor: true, content: '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' }),
			h('text', {
				fg: 'yellow',
				content: `\u23f3 Connecting to ${s.provider.displayName}...`,
			}),
			h('text', {
				dimColor: true,
				content: `Checking ${s.provider.baseUrl}/models`,
			}),
		);
	}

	if (s.id === 'connected') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'green', content: 'Connected!' }),
			h('text', { dimColor: true, content: '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' }),
			h('text', { fg: 'green', content: `\u2713 ${s.provider.displayName}` }),
			h(
				'box',
				{ flexDirection: 'column', paddingLeft: 2 },
				h(
					'box',
					null,
					h('text', { content: 'Model: ' }),
					h('text', { fg: 'cyan', content: `${s.provider.id}/${s.modelId}` }),
				),
				h(
					'box',
					null,
					h('text', { content: 'Key: ' }),
					h('text', {
						fg: 'yellow',
						content: s.provider.envVar
							? `set ${s.provider.envVar} in shell`
							: 'active this session',
					}),
				),
			),
			h(
				'box',
				{ marginTop: 1 },
				h('text', { dimColor: true, content: 'Press Enter to continue' }),
			),
		);
	}

	if (s.id === 'error') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'red', content: 'Connection Failed' }),
			h('text', { dimColor: true, content: '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500' }),
			h('text', { fg: 'red', content: `\u2717 ${s.provider.displayName}` }),
			h('text', { fg: 'red', content: s.error }),
			h(
				'box',
				{ marginTop: 1 },
				h('text', { dimColor: true, content: 'Press Enter to re-enter key, Esc to cancel' }),
			),
		);
	}

	return null;
}
