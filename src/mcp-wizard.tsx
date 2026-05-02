import { Box, Text } from 'ink';
import { forwardRef, useCallback, useImperativeHandle, useState } from 'react';
import type { McpEnvVarDef, McpServerConfig } from './config.js';
import { loadUserConfig, writeUserConfig } from './config.js';
import { storeKey } from './keychain.js';
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
			input: string;
	  }
	| { id: 'filesystem-dirs'; input: string }
	| { id: 'connecting'; name: string }
	| { id: 'connected'; name: string; tools: string[] }
	| { id: 'error'; name: string; error: string }
	| { id: 'remove-select'; cursor: number }
	| { id: 'removed'; name: string };

import { KNOWN_SERVERS, type KnownServer } from './mcp-catalog.js';

export interface McpWizardHandle {
	handleKey: (inputChar: string, key: any) => void;
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
					input: '',
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
			{ name: string; label: string; required: boolean }[]
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
						input: '',
					});
				}
			},
			[doConnect],
		);

		const reconnectAdvance = useCallback(
			(
				name: string,
				envSoFar: Record<string, string>,
				queue: { name: string; label: string; required: boolean }[],
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
					input: '',
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
								storeKey(`mcp-${s.serverName}-${s.envName}`, val).catch(
									() => {},
								);
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
							storeKey(`mcp-${s.serverName}-${s.envName}`, val).catch(() => {});
						}
						advanceEnvOrConnect(s.serverName, sv, newEnv, envQueue);
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

		useImperativeHandle(ref, () => ({ handleKey }), [handleKey]);

		return (
			<Box
				flexDirection="column"
				flexGrow={1}
				backgroundColor="#0a0a1a"
				paddingX={2}
				paddingY={1}
			>
				{renderStep(step, mcpRegistry)}
				<Box marginTop={1}>
					<Text dimColor>Esc = back · Enter = confirm</Text>
				</Box>
			</Box>
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
		return (
			<Box flexDirection="column">
				<Text bold color="cyan">
					MCP Server Setup
				</Text>
				<Text dimColor>────────────────────</Text>
				<Text dimColor>↑↓ navigate · Enter select · or press 1-3</Text>
				<Box flexDirection="column" marginTop={1}>
					{options.map((label, i) => (
						<Box key={label}>
							{s.cursor === i ? (
								<Text color="cyan" bold>
									{'▸ '}
								</Text>
							) : (
								<Text dimColor>{'  '}</Text>
							)}
							<Text color="green">{i + 1} </Text>
							<Text
								bold={s.cursor === i}
								color={s.cursor === i ? 'white' : 'gray'}
							>
								{label}
							</Text>
						</Box>
					))}
				</Box>
			</Box>
		);
	}

	if (s.id === 'catalog') {
		return (
			<Box flexDirection="column">
				<Text bold color="cyan">
					Add MCP Server
				</Text>
				<Text dimColor>────────────────────</Text>
				<Text dimColor>↑↓ navigate · Enter select</Text>
				<Box flexDirection="column" marginTop={1}>
					{KNOWN_SERVERS.map((srv, i) => (
						<Box key={srv.id}>
							{s.cursor === i ? (
								<Text color="cyan" bold>
									{'▸ '}
								</Text>
							) : (
								<Text dimColor>{'  '}</Text>
							)}
							<Text
								bold={s.cursor === i}
								color={s.cursor === i ? 'white' : 'gray'}
							>
								{srv.name}
							</Text>
							<Text dimColor> — {srv.description}</Text>
							{srv.envVars.length > 0 && (
								<Text dimColor color="yellow">
									{' '}
									*
								</Text>
							)}
						</Box>
					))}
				</Box>
				<Text dimColor>* requires API key</Text>
			</Box>
		);
	}

	if (s.id === 'custom-type') {
		const options = [
			{ label: 'Local (runs via npx/command)', value: 'local' as const },
			{ label: 'Remote (SSE/HTTP URL)', value: 'remote' as const },
		];
		return (
			<Box flexDirection="column">
				<Text bold color="cyan">
					Custom Server
				</Text>
				<Text dimColor>────────────────────</Text>
				<Text dimColor>↑↓ navigate · Enter select · or press 1-2</Text>
				<Box flexDirection="column" marginTop={1}>
					{options.map((opt, i) => (
						<Box key={opt.value}>
							{s.cursor === i ? (
								<Text color="cyan" bold>
									{'▸ '}
								</Text>
							) : (
								<Text dimColor>{'  '}</Text>
							)}
							<Text color="green">{i + 1} </Text>
							<Text
								bold={s.cursor === i}
								color={s.cursor === i ? 'white' : 'gray'}
							>
								{opt.label}
							</Text>
						</Box>
					))}
				</Box>
			</Box>
		);
	}

	if (s.id === 'custom-name') {
		return (
			<Box flexDirection="column">
				<Text bold color="cyan">
					Custom Server — Name
				</Text>
				<Text dimColor>────────────────────</Text>
				<Box marginTop={1}>
					<Text color="white">Name: </Text>
					<Text color="cyan">{s.input}</Text>
					<Text dimColor>▍</Text>
				</Box>
				{s.error && <Text color="red">{s.error}</Text>}
				<Text dimColor>lowercase, numbers, hyphens</Text>
			</Box>
		);
	}

	if (s.id === 'custom-local-command') {
		return (
			<Box flexDirection="column">
				<Text bold color="cyan">
					Custom Local — Command
				</Text>
				<Text dimColor>────────────────────</Text>
				<Text dimColor>Server: {s.name}</Text>
				<Box marginTop={1}>
					<Text color="white">Command: </Text>
					<Text color="cyan">{s.input}</Text>
					<Text dimColor>▍</Text>
				</Box>
				{s.error && <Text color="red">{s.error}</Text>}
				<Text dimColor>e.g. npx -y @modelcontextprotocol/server-foobar</Text>
			</Box>
		);
	}

	if (s.id === 'custom-remote-url') {
		return (
			<Box flexDirection="column">
				<Text bold color="cyan">
					Custom Remote — URL
				</Text>
				<Text dimColor>────────────────────</Text>
				<Text dimColor>Server: {s.name}</Text>
				<Box marginTop={1}>
					<Text color="white">URL: </Text>
					<Text color="cyan">{s.input}</Text>
					<Text dimColor>▍</Text>
				</Box>
				{s.error && <Text color="red">{s.error}</Text>}
				<Text dimColor>e.g. https://mcp.example.com/sse</Text>
			</Box>
		);
	}

	if (s.id === 'env-prompt') {
		const hasExisting = process.env[s.envName];
		return (
			<Box flexDirection="column">
				<Text bold color="cyan">
					API Key Required
				</Text>
				<Text dimColor>────────────────────</Text>
				<Text dimColor>Server: {s.serverName}</Text>
				<Box marginTop={1}>
					<Text color="white">{s.envLabel}: </Text>
					<Text color="cyan">{s.input}</Text>
					<Text dimColor>▍</Text>
				</Box>
				{hasExisting && (
					<Text dimColor color="green">
						Found {s.envName} in env (will auto-use if blank)
					</Text>
				)}
			</Box>
		);
	}

	if (s.id === 'filesystem-dirs') {
		return (
			<Box flexDirection="column">
				<Text bold color="cyan">
					Filesystem — Allowed Directories
				</Text>
				<Text dimColor>────────────────────</Text>
				<Box marginTop={1}>
					<Text color="white">Dirs: </Text>
					<Text color="cyan">{s.input}</Text>
					<Text dimColor>▍</Text>
				</Box>
				<Text dimColor>Comma-separated · blank = {process.cwd()}</Text>
			</Box>
		);
	}

	if (s.id === 'connecting') {
		return (
			<Box flexDirection="column">
				<Text bold color="cyan">
					Connecting...
				</Text>
				<Text dimColor>────────────────────</Text>
				<Text color="yellow">⏳ Connecting to "{s.name}"...</Text>
				<Text dimColor>First-time npx may take a moment</Text>
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
				<Text color="green">
					✓ "{s.name}" — {s.tools.length} tools
				</Text>
				<Box flexDirection="column" paddingLeft={2}>
					{s.tools.slice(0, 10).map((t) => (
						<Text key={t} dimColor>
							· {t}
						</Text>
					))}
					{s.tools.length > 10 && (
						<Text dimColor> +{s.tools.length - 10} more</Text>
					)}
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
				<Text color="red">✗ "{s.name}"</Text>
				<Text color="red">{s.error}</Text>
				<Box marginTop={1}>
					<Text dimColor>Press Enter to continue</Text>
				</Box>
			</Box>
		);
	}

	if (s.id === 'remove-select') {
		const servers = mcpRegistry.listServers();
		return (
			<Box flexDirection="column">
				<Text bold color="cyan">
					Remove MCP Server
				</Text>
				<Text dimColor>────────────────────</Text>
				<Text dimColor>↑↓ navigate · Enter remove · Esc cancel</Text>
				<Box flexDirection="column" marginTop={1}>
					{servers.map((srv, i) => (
						<Box key={srv.name}>
							{s.cursor === i ? (
								<Text color="red" bold>
									{'▸ '}
								</Text>
							) : (
								<Text dimColor>{'  '}</Text>
							)}
							<Text bold={s.cursor === i}>{srv.name}</Text>
							<Text dimColor>
								{' '}
								({srv.type}, {srv.status})
							</Text>
						</Box>
					))}
				</Box>
			</Box>
		);
	}

	if (s.id === 'removed') {
		return (
			<Box flexDirection="column">
				<Text bold color="green">
					Removed
				</Text>
				<Text dimColor>────────────────────</Text>
				<Text color="green">✓ "{s.name}" removed</Text>
				<Box marginTop={1}>
					<Text dimColor>Press Enter to continue</Text>
				</Box>
			</Box>
		);
	}

	return null;
}
