import type { McpEnvVarDef } from '../config.js';
import { loadUserConfig, writeUserConfig } from '../config.js';
import type { McpServerInfo } from '../mcp/registry.js';
import { KNOWN_SERVERS } from '../mcp-catalog.js';
import type {
	CommandContext,
	CommandResult,
	SlashCommand,
} from '../sdk/command.js';

function catalogEnvVarsForServer(name: string): McpEnvVarDef[] {
	const catalog = KNOWN_SERVERS.find(
		(s) =>
			s.id === name ||
			s.id === name.toLowerCase() ||
			s.name.toLowerCase() === name.toLowerCase(),
	);
	if (!catalog) return [];
	return catalog.envVars
		.filter((e) => e.required)
		.map((e) => ({
			name: e.name,
			label: e.label,
			required: e.required,
			sensitive: true,
		}));
}

function findMissingEnvVars(
	configEnvVars: McpEnvVarDef[] | undefined,
	catalogEnvVars: McpEnvVarDef[],
	configEnv?: Record<string, string>,
): McpEnvVarDef[] {
	const all = [...(configEnvVars || [])];
	for (const cv of catalogEnvVars) {
		if (!all.some((e) => e.name === cv.name)) {
			all.push(cv);
		}
	}
	return all.filter((e) => !process.env[e.name] && !configEnv?.[e.name]);
}

function allEnvVarsForServer(
	name: string,
	configEnvVars: McpEnvVarDef[] | undefined,
): McpEnvVarDef[] {
	const all = [...(configEnvVars || [])];
	const catalogVars = catalogEnvVarsForServer(name);
	for (const cv of catalogVars) {
		if (!all.some((e) => e.name === cv.name)) {
			all.push(cv);
		}
	}
	return all;
}

export const mcpListCmd: SlashCommand = {
	name: 'mcp-list',
	description: 'List MCP servers and their status',
	handler: (ctx: CommandContext): CommandResult => {
		const mcpRegistry = ctx.mcpRegistry;
		if (!mcpRegistry)
			return { type: 'message', content: 'MCP not initialized.' };
		const servers = mcpRegistry.listServers();
		if (servers.length === 0)
			return {
				type: 'message',
				content: 'No MCP servers configured. Use /mcp-add to add one.',
			};
		const lines = servers.map((s: McpServerInfo) => {
			const icon =
				s.status === 'connected'
					? '●'
					: s.status === 'connecting'
						? '◐'
						: s.status === 'error'
							? '✗'
							: '○';
			return `${icon} ${s.name} (${s.type}, ${s.toolCount} tools)${s.error ? ` -- ${s.error}` : ''}`;
		});
		return {
			type: 'message',
			content: `MCP Servers:\n${lines.join('\n')}`,
			plainText: true,
		};
	},
};

export const mcpAddCmd: SlashCommand = {
	name: 'mcp-add',
	description: 'Add an MCP server (interactive wizard)',
	handler: async (ctx: CommandContext): Promise<CommandResult> => {
		const mcpRegistry = ctx.mcpRegistry;
		if (!mcpRegistry)
			return { type: 'message', content: 'MCP not initialized.' };

		return { type: 'message', content: 'Opening MCP wizard...' };
	},
};

export const mcpRemoveCmd: SlashCommand = {
	name: 'mcp-remove',
	description: 'Remove an MCP server',
	usage: '<name>',
	handler: async (ctx: CommandContext): Promise<CommandResult> => {
		const mcpRegistry = ctx.mcpRegistry;
		if (!mcpRegistry)
			return { type: 'message', content: 'MCP not initialized.' };
		const name = ctx.args.trim();
		if (!name) return { type: 'message', content: 'Usage: /mcp-remove <name>' };
		if (!mcpRegistry.hasServer(name))
			return { type: 'message', content: `Server "${name}" not found.` };

		await mcpRegistry.removeServer(name);

		const config = loadUserConfig();
		if (config.mcpServers?.[name]) {
			delete config.mcpServers[name];
			writeUserConfig(config);
		}

		return { type: 'message', content: `Removed MCP server "${name}".` };
	},
};

export const mcpConnectCmd: SlashCommand = {
	name: 'mcp-connect',
	description: 'Connect or reconfigure an MCP server',
	usage: '<name>',
	handler: async (ctx: CommandContext): Promise<CommandResult> => {
		const mcpRegistry = ctx.mcpRegistry;
		if (!mcpRegistry)
			return { type: 'message', content: 'MCP not initialized.' };
		const name = ctx.args.trim();
		if (!name)
			return { type: 'message', content: 'Usage: /mcp-connect <name>' };

		const info = mcpRegistry.getServerInfo(name);
		if (!info) {
			const catalog = KNOWN_SERVERS.find(
				(s) =>
					s.id === name ||
					s.id === name.toLowerCase() ||
					s.name.toLowerCase() === name.toLowerCase(),
			);
			if (catalog) {
				return {
					type: 'message',
					content: `Server "${name}" is not configured yet. Use /mcp-add to add it first.`,
				};
			}
			return {
				type: 'message',
				content: `Server "${name}" not found. Use /mcp-add to add one.`,
			};
		}

		if (info.status === 'connected') {
			const config = mcpRegistry.getConfigs()[name];
			const envVars = allEnvVarsForServer(name, config?.requiredEnvVars);
			if (envVars.length > 0) {
				return {
					type: 'reconnect-server',
					serverName: name,
					requiredEnvVars: envVars,
				};
			}
			return {
				type: 'message',
				content: `"${name}" is already connected (${info.toolCount} tools).`,
			};
		}

		const config = mcpRegistry.getConfigs()[name];

		const configEnvVars = config?.requiredEnvVars || [];
		const catalogVars = catalogEnvVarsForServer(name);
		const missing = findMissingEnvVars(configEnvVars, catalogVars, config?.env);

		if (config?.enabled === false) {
			if (missing.length > 0) {
				return {
					type: 'reconnect-server',
					serverName: name,
					requiredEnvVars: missing,
				};
			}
			const env = { ...(config.env || {}) };
			for (const e of configEnvVars) {
				const val = process.env[e.name];
				if (val) {
					env[e.name] = val;
				}
			}
			await mcpRegistry.removeServer(name);
			const mcpConfig = { ...config, env, enabled: true as const };
			const newInfo = await mcpRegistry.addServer(name, mcpConfig);
			if (newInfo.status === 'error') {
				return {
					type: 'message',
					content: `Failed to connect to "${name}": ${newInfo.error || 'unknown error'}`,
				};
			}
			const uc = loadUserConfig();
			if (!uc.mcpServers) uc.mcpServers = {};
			uc.mcpServers[name] = mcpConfig;
			writeUserConfig(uc);
			return {
				type: 'message',
				content: `Connected to "${name}" (${newInfo.toolCount} tools)`,
			};
		}

		if (info.status === 'error' && missing.length > 0) {
			return {
				type: 'reconnect-server',
				serverName: name,
				requiredEnvVars: missing,
			};
		}

		try {
			await mcpRegistry.connect(name);
			const updatedInfo = mcpRegistry.getServerInfo(name);
			if (updatedInfo?.status === 'error') {
				return {
					type: 'message',
					content: `Failed to connect to "${name}": ${updatedInfo.error || 'unknown error'}`,
				};
			}
			return {
				type: 'message',
				content: `Connected to "${name}" (${updatedInfo?.toolCount || 0} tools)`,
			};
		} catch (err: any) {
			return {
				type: 'message',
				content: `Error connecting to "${name}": ${err.message}`,
			};
		}
	},
};

export const mcpDisconnectCmd: SlashCommand = {
	name: 'mcp-disconnect',
	description: 'Disconnect an MCP server without removing it',
	usage: '<name>',
	handler: async (ctx: CommandContext): Promise<CommandResult> => {
		const mcpRegistry = ctx.mcpRegistry;
		if (!mcpRegistry)
			return { type: 'message', content: 'MCP not initialized.' };
		const name = ctx.args.trim();
		if (!name)
			return { type: 'message', content: 'Usage: /mcp-disconnect <name>' };
		await mcpRegistry.disconnect(name);
		return { type: 'message', content: `Disconnected "${name}".` };
	},
};

export const mcpCmd: SlashCommand = {
	name: 'mcp',
	description: 'Show MCP server status',
	handler: (ctx: CommandContext): CommandResult => {
		return mcpListCmd.handler(ctx) as CommandResult;
	},
};

export function getMcpCommands(): SlashCommand[] {
	return [
		mcpCmd,
		mcpListCmd,
		mcpAddCmd,
		mcpRemoveCmd,
		mcpConnectCmd,
		mcpDisconnectCmd,
	];
}
