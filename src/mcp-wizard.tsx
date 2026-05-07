import {
	forwardRef,
	createElement as h,
	useCallback,
	useImperativeHandle,
	useState,
} from 'react';
import type { McpEnvVarDef, McpServerConfig } from './config.js';
import { loadUserConfig, writeUserConfig } from './config.js';
import type { McpRegistry, McpServerInfo } from './mcp/registry.js';

type WizardStep =
	| { id: 'mode'; cursor: number }
	| { id: 'catalog'; cursor: number }
	| { id: 'custom-type'; cursor: number }
	| { id: 'custom-name'; input: string; error: string }
	| { id: 'custom-local-command'; name: string; input: string; error: string }
	| { id: 'custom-remote-url'; name: string; input: string; error: string }
	| {
			id: 'env-prompt';
			serverName: string;
			envName: string;
			envLabel: string;
			sensitive: boolean;
			input: string;
			masked: string;
	  }
	| { id: 'filesystem-dirs'; input: string }
	| { id: 'connecting'; name: string }
	| { id: 'connected'; name: string; tools: string[] }
	| { id: 'error'; name: string; error: string }
	| { id: 'remove-select'; cursor: number }
	| { id: 'removed'; name: string };

import { KNOWN_SERVERS, type KnownServer } from './mcp-catalog.js';

const MASK_CHAR = '\u2022';

function maskInput(input: string): string {
	return MASK_CHAR.repeat(input.length);
}

export interface McpWizardHandle {
	handleKey: (inputChar: string, key: any) => void;
	handlePaste: (text: string) => void;
}

export interface ReconnectTarget {
	serverName: string;
	requiredEnvVars: McpEnvVarDef[];
}

export interface McpWizardProps {
	mcpRegistry: McpRegistry;
	onDone: (message: string) => void;
	width: number;
	reconnectTarget?: ReconnectTarget;
}

export const McpWizard = forwardRef<McpWizardHandle, McpWizardProps>(
	function McpWizard(
		{ mcpRegistry, onDone, width: _width, reconnectTarget },
		ref,
	) {
		const [step, setStep] = useState<WizardStep>(() => {
			if (reconnectTarget && reconnectTarget.requiredEnvVars.length > 0) {
				const first = reconnectTarget.requiredEnvVars[0];
				return {
					id: 'env-prompt',
					serverName: reconnectTarget.serverName,
					envName: first.name,
					envLabel: first.label,
					sensitive: first.sensitive ?? true,
					input: '',
					masked: '',
				};
			}
			return { id: 'mode', cursor: 0 };
		});
		const [envCollected, setEnvCollected] = useState<Record<string, string>>(
			{},
		);
		const [wizardServer, setWizardServer] = useState<KnownServer | null>(null);
		const [customType, setCustomType] = useState<'local' | 'remote'>('local');
		const [envQueue, setEnvQueue] = useState<
			{ name: string; label: string; required: boolean; sensitive?: boolean }[]
		>(() => {
			if (reconnectTarget && reconnectTarget.requiredEnvVars.length > 1) {
				return reconnectTarget.requiredEnvVars.slice(1);
			}
			return [];
		});
		const isReconnect =
			!!reconnectTarget && reconnectTarget.requiredEnvVars.length > 0;

		const persistConfig = useCallback(
			(name: string, mcpConfig: McpServerConfig) => {
				const config = loadUserConfig();
				if (!config.mcpServers) config.mcpServers = {};
				config.mcpServers[name] = mcpConfig;
				writeUserConfig(config);
			},
			[],
		);

		const doConnect = useCallback(
			(name: string, mcpConfig: McpServerConfig) => {
				mcpRegistry
					.addServer(name, mcpConfig)
					.then((info: McpServerInfo) => {
						if (info.status === 'error') {
							setStep({
								id: 'error',
								name,
								error: info.error || 'Unknown error',
							});
							return;
						}
						setStep({
							id: 'connected',
							name,
							tools: info.tools.map((t: string) =>
								t.replace(`mcp__${name}__`, ''),
							),
						});
						persistConfig(name, mcpConfig);
					})
					.catch((err: any) => {
						setStep({ id: 'error', name, error: err.message || String(err) });
					});
			},
			[mcpRegistry, persistConfig],
		);

		const advanceEnvOrConnect = useCallback(
			(
				name: string,
				server: KnownServer,
				envSoFar: Record<string, string>,
				queue: { name: string; label: string; required: boolean }[],
			) => {
				if (queue.length === 0) {
					const command =
						server.command ??
						(server.package ? ['npx', '-y', server.package] : undefined);
					if (!command) return;
					const mcpConfig: McpServerConfig = {
						type: 'local',
						command,
						env: Object.keys(envSoFar).length > 0 ? envSoFar : undefined,
						enabled: true,
					};
					setStep({ id: 'connecting', name });
					doConnect(name, mcpConfig);
					return;
				}
				const next = queue[0];
				if (!next) return;
				const existing = process.env[next.name];
				if (existing) {
					const newEnv = { ...envSoFar, [next.name]: existing };
					advanceEnvOrConnect(name, server, newEnv, queue.slice(1));
				} else {
					setEnvCollected(envSoFar);
					setEnvQueue(queue.slice(1));
					setStep({
						id: 'env-prompt',
						serverName: name,
						envName: next.name,
						envLabel: next.label,
						sensitive: true,
						input: '',
						masked: '',
					});
				}
			},
			[doConnect],
		);

		const reconnectAdvance = useCallback(
			(
				name: string,
				envSoFar: Record<string, string>,
				queue: {
					name: string;
					label: string;
					required: boolean;
					sensitive?: boolean;
				}[],
			) => {
				while (queue.length > 0 && process.env[queue[0].name]) {
					const val = process.env[queue[0].name];
					envSoFar = {
						...envSoFar,
						[queue[0].name]: val as string,
					};
					queue = queue.slice(1);
				}
				if (queue.length === 0) {
					const existing = mcpRegistry.getConfigs()[name];
					if (!existing) {
						onDone(`Server "${name}" not found in registry.`);
						return;
					}
					const mergedEnv = { ...(existing.env || {}), ...envSoFar };
					const existingEnvVars = existing.requiredEnvVars || [];
					const reconnectEnvVars = reconnectTarget?.requiredEnvVars || [];
					const allEnvVars = [...existingEnvVars];
					for (const rv of reconnectEnvVars) {
						if (!allEnvVars.some((e) => e.name === rv.name)) {
							allEnvVars.push(rv);
						}
					}
					const mcpConfig: McpServerConfig = {
						...existing,
						env: mergedEnv,
						enabled: true,
						requiredEnvVars: allEnvVars.length > 0 ? allEnvVars : undefined,
					};
					setStep({ id: 'connecting', name });
					mcpRegistry.removeServer(name).then(() => {
						doConnect(name, mcpConfig);
					});
					return;
				}
				const next = queue[0];
				setEnvCollected(envSoFar);
				setEnvQueue(queue.slice(1));
				setStep({
					id: 'env-prompt',
					serverName: name,
					envName: next.name,
					envLabel: next.label,
					sensitive: next.sensitive ?? true,
					input: '',
					masked: '',
				});
			},
			[doConnect, mcpRegistry, onDone, reconnectTarget?.requiredEnvVars],
		);

		const handleKey = useCallback(
			(inputChar: string, key: any) => {
				const s = step;

				if (s.id === 'mode') {
					if (key.upArrow) {
						setStep({ ...s, cursor: Math.max(0, s.cursor - 1) });
						return;
					}
					if (key.downArrow) {
						setStep({ ...s, cursor: Math.min(2, s.cursor + 1) });
						return;
					}
					if (key.escape) {
						onDone('');
						return;
					}
					const idx =
						inputChar === '1'
							? 0
							: inputChar === '2'
								? 1
								: inputChar === '3'
									? 2
									: -1;
					const target = idx >= 0 ? idx : key.return ? s.cursor : -1;
					if (target === 0) {
						setStep({ id: 'catalog', cursor: 0 });
						return;
					}
					if (target === 1) {
						setStep({ id: 'custom-type', cursor: 0 });
						return;
					}
					if (target === 2) {
						const servers = mcpRegistry.listServers();
						if (servers.length === 0) {
							onDone('No servers configured.');
							return;
						}
						setStep({ id: 'remove-select', cursor: 0 });
						return;
					}
					return;
				}

				if (s.id === 'catalog') {
					if (key.upArrow) {
						setStep({ ...s, cursor: Math.max(0, s.cursor - 1) });
						return;
					}
					if (key.downArrow) {
						setStep({
							...s,
							cursor: Math.min(KNOWN_SERVERS.length - 1, s.cursor + 1),
						});
						return;
					}
					if (key.escape) {
						setStep({ id: 'mode', cursor: 0 });
						return;
					}
					if (key.return) {
						const server = KNOWN_SERVERS[s.cursor];
						if (!server) return;
						if (mcpRegistry.hasServer(server.id)) {
							onDone(
								`"${server.name}" is already configured. Remove it first.`,
							);
							return;
						}
						setWizardServer(server);
						if (server.id === 'filesystem') {
							setStep({ id: 'filesystem-dirs', input: '' });
							return;
						}
						advanceEnvOrConnect(server.id, server, {}, server.envVars);
					}
					return;
				}

				if (s.id === 'custom-type') {
					if (key.upArrow) {
						setStep({ ...s, cursor: Math.max(0, s.cursor - 1) });
						return;
					}
					if (key.downArrow) {
						setStep({ ...s, cursor: Math.min(1, s.cursor + 1) });
						return;
					}
					if (key.escape) {
						setStep({ id: 'mode', cursor: 1 });
						return;
					}
					const idx = inputChar === '1' ? 0 : inputChar === '2' ? 1 : -1;
					const target = idx >= 0 ? idx : key.return ? s.cursor : -1;
					if (target === 0) {
						setCustomType('local');
						setStep({ id: 'custom-name', input: '', error: '' });
						return;
					}
					if (target === 1) {
						setCustomType('remote');
						setStep({ id: 'custom-name', input: '', error: '' });
						return;
					}
					return;
				}

				if (s.id === 'custom-name') {
					if (key.escape) {
						setStep({ id: 'custom-type', cursor: 0 });
						return;
					}
					if (key.return) {
						const n = s.input.trim();
						if (!n) {
							setStep({ ...s, error: 'Name is required' });
							return;
						}
						if (!/^[a-z0-9_-]+$/.test(n)) {
							setStep({ ...s, error: 'Lowercase, numbers, hyphens only' });
							return;
						}
						if (mcpRegistry.hasServer(n)) {
							setStep({ ...s, error: `"${n}" already exists` });
							return;
						}
						if (customType === 'local')
							setStep({
								id: 'custom-local-command',
								name: n,
								input: 'npx -y ',
								error: '',
							});
						else
							setStep({
								id: 'custom-remote-url',
								name: n,
								input: '',
								error: '',
							});
						return;
					}
					if (key.backspace) {
						setStep({ ...s, input: s.input.slice(0, -1), error: '' });
						return;
					}
					if (!key.ctrl && !key.meta && inputChar) {
						setStep({ ...s, input: s.input + inputChar, error: '' });
					}
					return;
				}

				if (s.id === 'custom-local-command') {
					if (key.escape) {
						setStep({ id: 'custom-name', input: s.name, error: '' });
						return;
					}
					if (key.return) {
						const cmd = s.input.trim();
						if (!cmd) {
							setStep({ ...s, error: 'Command is required' });
							return;
						}
						const command = cmd.split(/\s+/);
						const mcpConfig: McpServerConfig = {
							type: 'local',
							command,
							enabled: true,
						};
						setStep({ id: 'connecting', name: s.name });
						doConnect(s.name, mcpConfig);
						return;
					}
					if (key.backspace) {
						setStep({ ...s, input: s.input.slice(0, -1), error: '' });
						return;
					}
					if (!key.ctrl && !key.meta && inputChar) {
						setStep({ ...s, input: s.input + inputChar, error: '' });
					}
					return;
				}

				if (s.id === 'custom-remote-url') {
					if (key.escape) {
						setStep({ id: 'custom-name', input: s.name, error: '' });
						return;
					}
					if (key.return) {
						const url = s.input.trim();
						if (!url) {
							setStep({ ...s, error: 'URL is required' });
							return;
						}
						if (!url.startsWith('http://') && !url.startsWith('https://')) {
							setStep({ ...s, error: 'Must start with http(s)://' });
							return;
						}
						const mcpConfig: McpServerConfig = {
							type: 'remote',
							url,
							enabled: true,
						};
						setStep({ id: 'connecting', name: s.name });
						doConnect(s.name, mcpConfig);
						return;
					}
					if (key.backspace) {
						setStep({ ...s, input: s.input.slice(0, -1), error: '' });
						return;
					}
					if (!key.ctrl && !key.meta && inputChar) {
						setStep({ ...s, input: s.input + inputChar, error: '' });
					}
					return;
				}

				if (s.id === 'env-prompt') {
					if (key.escape) {
						onDone('Cancelled');
						return;
					}
					if (key.return) {
						const val = s.input.trim();
						if (isReconnect) {
							const envDef = reconnectTarget?.requiredEnvVars.find(
								(e) => e.name === s.envName,
							);
							if (!val && envDef?.required) return;
							const newEnv = { ...envCollected };
							if (val) {
								newEnv[s.envName] = val;
							}
							reconnectAdvance(s.serverName, newEnv, envQueue);
							return;
						}
						const sv = wizardServer;
						if (!sv) {
							onDone('Error');
							return;
						}
						const envVar = sv.envVars.find((e) => e.name === s.envName);
						if (!val && envVar?.required) return;
						const newEnv = { ...envCollected };
						if (val) {
							newEnv[s.envName] = val;
						}
						advanceEnvOrConnect(s.serverName, sv, newEnv, envQueue);
						return;
					}
					if (key.backspace) {
						const newInput = s.input.slice(0, -1);
						setStep({
							...s,
							input: newInput,
							masked: s.sensitive ? maskInput(newInput) : newInput,
						});
						return;
					}
					if (!key.ctrl && !key.meta && inputChar) {
						const newInput = s.input + inputChar;
						setStep({
							...s,
							input: newInput,
							masked: s.sensitive ? maskInput(newInput) : newInput,
						});
					}
					return;
				}

				if (s.id === 'filesystem-dirs') {
					if (key.escape) {
						onDone('Cancelled');
						return;
					}
					if (key.return) {
						const sv = KNOWN_SERVERS.find((x) => x.id === 'filesystem');
						if (!sv) return;
						const dirs = (s.input.trim() || process.cwd())
							.split(',')
							.map((d) => d.trim())
							.filter(Boolean);
						const command =
							sv.command ??
							(sv.package ? ['npx', '-y', sv.package, ...dirs] : undefined);
						if (!command) return;
						const mcpConfig: McpServerConfig = {
							type: 'local',
							command,
							enabled: true,
						};
						setStep({ id: 'connecting', name: 'filesystem' });
						doConnect('filesystem', mcpConfig);
						return;
					}
					if (key.backspace) {
						setStep({ ...s, input: s.input.slice(0, -1) });
						return;
					}
					if (!key.ctrl && !key.meta && inputChar) {
						setStep({ ...s, input: s.input + inputChar });
					}
					return;
				}

				if (s.id === 'connecting') {
					if (key.escape) {
						onDone('Connecting...');
						return;
					}
					return;
				}

				if (s.id === 'connected') {
					if (key.return || key.escape) {
						onDone(
							`Connected to "${s.name}" (${s.tools.length} tools): ${s.tools.slice(0, 8).join(', ')}${s.tools.length > 8 ? ` +${s.tools.length - 8} more` : ''}`,
						);
					}
					return;
				}

				if (s.id === 'error') {
					if (key.return || key.escape) {
						onDone(`Failed: ${s.error}`);
					}
					return;
				}

				if (s.id === 'removed') {
					if (key.return || key.escape) {
						onDone(`Removed "${s.name}".`);
					}
					return;
				}

				if (s.id === 'remove-select') {
					const servers = mcpRegistry.listServers();
					if (key.upArrow) {
						setStep({ ...s, cursor: Math.max(0, s.cursor - 1) });
						return;
					}
					if (key.downArrow) {
						setStep({
							...s,
							cursor: Math.min(servers.length - 1, s.cursor + 1),
						});
						return;
					}
					if (key.escape) {
						setStep({ id: 'mode', cursor: 2 });
						return;
					}
					if (key.return && servers[s.cursor]) {
						const name = servers[s.cursor].name;
						mcpRegistry.removeServer(name);
						const cfg = loadUserConfig();
						if (cfg.mcpServers?.[name]) {
							delete cfg.mcpServers[name];
							writeUserConfig(cfg);
						}
						setStep({ id: 'removed', name });
					}
					return;
				}
			},
			[
				step,
				envCollected,
				envQueue,
				wizardServer,
				customType,
				mcpRegistry,
				onDone,
				doConnect,
				advanceEnvOrConnect,
				isReconnect,
				reconnectAdvance,
				reconnectTarget,
			],
		);

		const handlePaste = useCallback(
			(text: string) => {
				const s = step;
				if (
					s.id === 'custom-name' ||
					s.id === 'custom-local-command' ||
					s.id === 'custom-remote-url' ||
					s.id === 'filesystem-dirs'
				) {
					setStep({
						...s,
						input: s.input + text,
						...(s.id !== 'filesystem-dirs' ? { error: '' } : {}),
					});
				}
				if (s.id === 'env-prompt') {
					const newInput = s.input + text;
					setStep({
						...s,
						input: newInput,
						masked: s.sensitive ? maskInput(newInput) : newInput,
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
			},
			renderStep(step, mcpRegistry),
			h(
				'box',
				{ marginTop: 1 },
				h('text', { dimColor: true, content: 'Esc = back · Enter = confirm' }),
			),
		);
	},
);

function renderStep(s: WizardStep, mcpRegistry: McpRegistry): React.ReactNode {
	if (s.id === 'mode') {
		const options = [
			'Add from catalog',
			'Add custom server',
			'Remove a server',
		];
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'cyan', content: 'MCP Server Setup' }),
			h('text', { dimColor: true, content: '────────────────────' }),
			h('text', {
				dimColor: true,
				content: '↑↓ navigate · Enter select · or press 1-3',
			}),
			h(
				'box',
				{ flexDirection: 'column', marginTop: 1 },
				options.map((label, i) =>
					h(
						'box',
						{ key: label },
						s.cursor === i
							? h('text', { fg: 'cyan', bold: true, content: '▸ ' })
							: h('text', { dimColor: true, content: '  ' }),
						h('text', { fg: 'green', content: `${i + 1} ` }),
						h('text', {
							bold: s.cursor === i,
							fg: s.cursor === i ? 'white' : 'gray',
							content: label,
						}),
					),
				),
			),
		);
	}

	if (s.id === 'catalog') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'cyan', content: 'Add MCP Server' }),
			h('text', { dimColor: true, content: '────────────────────' }),
			h('text', { dimColor: true, content: '↑↓ navigate · Enter select' }),
			h(
				'box',
				{ flexDirection: 'column', marginTop: 1 },
				KNOWN_SERVERS.map((srv, i) =>
					h(
						'box',
						{ key: srv.id },
						s.cursor === i
							? h('text', { fg: 'cyan', bold: true, content: '▸ ' })
							: h('text', { dimColor: true, content: '  ' }),
						h('text', {
							bold: s.cursor === i,
							fg: s.cursor === i ? 'white' : 'gray',
							content: srv.name,
						}),
						h('text', { dimColor: true, content: ` — ${srv.description}` }),
						srv.envVars.length > 0
							? h('text', { dimColor: true, fg: 'yellow', content: ' *' })
							: null,
					),
				),
			),
			h('text', { dimColor: true, content: '* requires API key' }),
		);
	}

	if (s.id === 'custom-type') {
		const options = [
			{ label: 'Local (runs via npx/command)', value: 'local' as const },
			{ label: 'Remote (SSE/HTTP URL)', value: 'remote' as const },
		];
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'cyan', content: 'Custom Server' }),
			h('text', { dimColor: true, content: '────────────────────' }),
			h('text', {
				dimColor: true,
				content: '↑↓ navigate · Enter select · or press 1-2',
			}),
			h(
				'box',
				{ flexDirection: 'column', marginTop: 1 },
				options.map((opt, i) =>
					h(
						'box',
						{ key: opt.value },
						s.cursor === i
							? h('text', { fg: 'cyan', bold: true, content: '▸ ' })
							: h('text', { dimColor: true, content: '  ' }),
						h('text', { fg: 'green', content: `${i + 1} ` }),
						h('text', {
							bold: s.cursor === i,
							fg: s.cursor === i ? 'white' : 'gray',
							content: opt.label,
						}),
					),
				),
			),
		);
	}

	if (s.id === 'custom-name') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'cyan', content: 'Custom Server — Name' }),
			h('text', { dimColor: true, content: '────────────────────' }),
			h(
				'box',
				{ marginTop: 1 },
				h('text', { fg: 'white', content: 'Name: ' }),
				h('text', { fg: 'cyan', content: s.input }),
				h('text', { dimColor: true, content: '▍' }),
			),
			s.error ? h('text', { fg: 'red', content: s.error }) : null,
			h('text', { dimColor: true, content: 'lowercase, numbers, hyphens' }),
		);
	}

	if (s.id === 'custom-local-command') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'cyan', content: 'Custom Local — Command' }),
			h('text', { dimColor: true, content: '────────────────────' }),
			h('text', { dimColor: true, content: `Server: ${s.name}` }),
			h(
				'box',
				{ marginTop: 1 },
				h('text', { fg: 'white', content: 'Command: ' }),
				h('text', { fg: 'cyan', content: s.input }),
				h('text', { dimColor: true, content: '▍' }),
			),
			s.error ? h('text', { fg: 'red', content: s.error }) : null,
			h('text', {
				dimColor: true,
				content: 'e.g. npx -y @modelcontextprotocol/server-foobar',
			}),
		);
	}

	if (s.id === 'custom-remote-url') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'cyan', content: 'Custom Remote — URL' }),
			h('text', { dimColor: true, content: '────────────────────' }),
			h('text', { dimColor: true, content: `Server: ${s.name}` }),
			h(
				'box',
				{ marginTop: 1 },
				h('text', { fg: 'white', content: 'URL: ' }),
				h('text', { fg: 'cyan', content: s.input }),
				h('text', { dimColor: true, content: '▍' }),
			),
			s.error ? h('text', { fg: 'red', content: s.error }) : null,
			h('text', {
				dimColor: true,
				content: 'e.g. https://mcp.example.com/sse',
			}),
		);
	}

	if (s.id === 'env-prompt') {
		const hasExisting = process.env[s.envName];
		const displayInput = s.sensitive ? s.masked : s.input;
		const header = s.sensitive ? 'API Key Required' : 'Configuration Required';
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'cyan', content: header }),
			h('text', {
				dimColor: true,
				content:
					'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500',
			}),
			h('text', { dimColor: true, content: `Server: ${s.serverName}` }),
			h(
				'box',
				{ marginTop: 1 },
				h('text', { fg: 'white', content: `${s.envLabel}: ` }),
				h('text', { fg: 'cyan', content: displayInput }),
				h('text', { dimColor: true, content: '\u258d' }),
			),
			hasExisting
				? h('text', {
						dimColor: true,
						fg: 'green',
						content: `Found ${s.envName} in env (will auto-use if blank)`,
					})
				: null,
			!s.sensitive
				? h('text', { dimColor: true, content: `e.g. ${process.cwd()}` })
				: null,
		);
	}

	if (s.id === 'filesystem-dirs') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', {
				bold: true,
				fg: 'cyan',
				content: 'Filesystem — Allowed Directories',
			}),
			h('text', { dimColor: true, content: '────────────────────' }),
			h(
				'box',
				{ marginTop: 1 },
				h('text', { fg: 'white', content: 'Dirs: ' }),
				h('text', { fg: 'cyan', content: s.input }),
				h('text', { dimColor: true, content: '▍' }),
			),
			h('text', {
				dimColor: true,
				content: `Comma-separated · blank = ${process.cwd()}`,
			}),
		);
	}

	if (s.id === 'connecting') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'cyan', content: 'Connecting...' }),
			h('text', { dimColor: true, content: '────────────────────' }),
			h('text', { fg: 'yellow', content: `⏳ Connecting to "${s.name}"...` }),
			h('text', {
				dimColor: true,
				content: 'First-time npx may take a moment',
			}),
		);
	}

	if (s.id === 'connected') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'green', content: 'Connected!' }),
			h('text', { dimColor: true, content: '────────────────────' }),
			h('text', {
				fg: 'green',
				content: `✓ "${s.name}" — ${s.tools.length} tools`,
			}),
			h(
				'box',
				{ flexDirection: 'column', paddingLeft: 2 },
				s.tools
					.slice(0, 10)
					.map((t) => h('text', { key: t, dimColor: true, content: `· ${t}` })),
				s.tools.length > 10
					? h('text', {
							dimColor: true,
							content: ` +${s.tools.length - 10} more`,
						})
					: null,
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
			h('text', { dimColor: true, content: '────────────────────' }),
			h('text', { fg: 'red', content: `✗ "${s.name}"` }),
			h('text', { fg: 'red', content: s.error }),
			h(
				'box',
				{ marginTop: 1 },
				h('text', { dimColor: true, content: 'Press Enter to continue' }),
			),
		);
	}

	if (s.id === 'remove-select') {
		const servers = mcpRegistry.listServers();
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'cyan', content: 'Remove MCP Server' }),
			h('text', { dimColor: true, content: '────────────────────' }),
			h('text', {
				dimColor: true,
				content: '↑↓ navigate · Enter remove · Esc cancel',
			}),
			h(
				'box',
				{ flexDirection: 'column', marginTop: 1 },
				servers.map((srv, i) =>
					h(
						'box',
						{ key: srv.name },
						s.cursor === i
							? h('text', { fg: 'red', bold: true, content: '▸ ' })
							: h('text', { dimColor: true, content: '  ' }),
						h('text', { bold: s.cursor === i, content: srv.name }),
						h('text', {
							dimColor: true,
							content: ` (${srv.type}, ${srv.status})`,
						}),
					),
				),
			),
		);
	}

	if (s.id === 'removed') {
		return h(
			'box',
			{ flexDirection: 'column' },
			h('text', { bold: true, fg: 'green', content: 'Removed' }),
			h('text', { dimColor: true, content: '────────────────────' }),
			h('text', { fg: 'green', content: `✓ "${s.name}" removed` }),
			h(
				'box',
				{ marginTop: 1 },
				h('text', { dimColor: true, content: 'Press Enter to continue' }),
			),
		);
	}

	return null;
}
