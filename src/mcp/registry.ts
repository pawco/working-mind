import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import stripJsonComments from 'strip-json-comments';
import type { McpServerConfig, UserConfig } from '../config.js';
import { loadUserConfig, writeUserConfig } from '../config.js';
import { parseMcpProjectConfig } from '../schemas.js';
import type { ToolDef } from '../sdk/tool.js';
import { mcpToolToToolDef } from './adapter.js';
import { validateToolReference } from './tool-names.js';
import { createTransport, type McpTransportResult } from './transport.js';

export function stripSensitiveEnvVars(
	configs: Record<string, McpServerConfig>,
): Record<string, McpServerConfig> {
	const result: Record<string, McpServerConfig> = {};
	for (const [name, config] of Object.entries(configs)) {
		const sensitive = new Set(
			(config.requiredEnvVars || [])
				.filter((v) => v.sensitive)
				.map((v) => v.name),
		);
		if (sensitive.size === 0 || !config.env) {
			result[name] = config;
			continue;
		}
		const env: Record<string, string> = {};
		for (const [key, value] of Object.entries(config.env)) {
			if (!sensitive.has(key)) {
				env[key] = value;
			}
		}
		result[name] = { ...config, env };
	}
	return result;
}

export function enrichMcpError(rawMsg: string, command?: string[]): string {
	const KNOWN_PACKAGES = new Set([
		'@modelcontextprotocol/server-filesystem',
		'@modelcontextprotocol/server-memory',
		'@modelcontextprotocol/server-github',
		'@modelcontextprotocol/server-postgres',
		'@modelcontextprotocol/server-sqlite',
		'@modelcontextprotocol/server-google-maps',
		'@modelcontextprotocol/server-puppeteer',
		'@modelcontextprotocol/server-slack',
		'@modelcontextprotocol/server-sequential-thinking',
		'@brave/brave-search-mcp-server',
		'firecrawl-mcp',
		'arxiv-mcp-server',
		'@upstash/context7-mcp',
	]);

	if (!rawMsg.includes('-32000') && !rawMsg.includes('Connection closed')) {
		if (rawMsg.length > 200) return `${rawMsg.slice(0, 200)}...`;
		return rawMsg;
	}

	const hints: string[] = [];

	if (command && command[0] === 'npx' && command[1] === '-y') {
		const pkg = command[2];
		if (pkg && !KNOWN_PACKAGES.has(pkg)) {
			hints.push(
				`Package "${pkg}" is not a known MCP server. Check the package name or remove this server from config.`,
			);
		}
	}

	if (rawMsg.includes('Python 3') || rawMsg.includes('python')) {
		hints.push(
			'This server requires Python. Install Python 3.11+ or remove the server.',
		);
	}

	if (
		rawMsg.includes('E404') ||
		rawMsg.includes('Not Found') ||
		rawMsg.includes('not found')
	) {
		hints.push(
			'The npm package was not found. Check the package name in your config.',
		);
	}

	if (
		rawMsg.includes('allowed directory') ||
		rawMsg.includes('Allowed directories')
	) {
		hints.push(
			'The filesystem server needs valid directory paths. Check $INPUT_DIR or $CWD in the command.',
		);
	}

	if (hints.length === 0) {
		hints.push(
			'Server exited unexpectedly. This usually means a missing API key, dependency, or wrong package name.',
		);
	}

	const shortMsg = rawMsg.includes('-32000')
		? 'MCP error -32000'
		: 'Connection closed';
	return `${shortMsg} -- ${hints.join(' ')}`;
}

export function substituteCommandVars(
	command: string[],
	config: McpServerConfig,
): { args: string[]; unresolvedVars: string[] } {
	const unresolved: string[] = [];
	const args = command.map((arg) => {
		if (arg === '$CWD') return process.cwd();
		if (arg === '$HOME') return homedir();
		if (arg === '$PACK_DIR' && config.packDir) return config.packDir;
		if (arg === '$INPUT_DIR') {
			if (config.env?.INPUT_DIR) return config.env.INPUT_DIR;
			unresolved.push('$INPUT_DIR');
			return arg;
		}
		if (arg.includes('$CWD')) return arg.replace(/\$CWD/g, process.cwd());
		if (arg.includes('$HOME')) return arg.replace(/\$HOME/g, homedir());
		if (arg.includes('$PACK_DIR') && config.packDir)
			return arg.replace(/\$PACK_DIR/g, config.packDir);
		if (arg.includes('$INPUT_DIR')) {
			if (config.env?.INPUT_DIR)
				return arg.replace(/\$INPUT_DIR/g, config.env.INPUT_DIR);
			unresolved.push('$INPUT_DIR');
			return arg;
		}
		return arg;
	});
	return { args, unresolvedVars: unresolved };
}

export interface McpServerInfo {
	name: string;
	type: 'local' | 'remote';
	status: 'disconnected' | 'connecting' | 'connected' | 'error';
	toolCount: number;
	tools: string[];
	error?: string;
	enabled: boolean;
}

interface McpConnection {
	name: string;
	config: McpServerConfig;
	status: 'disconnected' | 'connecting' | 'connected' | 'error';
	transport: McpTransportResult | null;
	tools: ToolDef[];
	error?: string;
}

type StatusListener = (servers: McpServerInfo[]) => void;

export class McpRegistry {
	private connections: Map<string, McpConnection> = new Map();
	private listeners: Set<StatusListener> = new Set();

	onStatusChange(fn: StatusListener) {
		this.listeners.add(fn);
		return () => {
			this.listeners.delete(fn);
		};
	}

	private notify() {
		const info = this.listServers();
		for (const fn of this.listeners) fn(info);
	}

	loadFromConfig(userConfig: UserConfig): void {
		const servers = userConfig.mcpServers || {};
		for (const [name, config] of Object.entries(servers)) {
			if (!this.connections.has(name)) {
				this.connections.set(name, {
					name,
					config,
					status: 'disconnected',
					transport: null,
					tools: [],
				});
			}
		}

		const projectServers = this.loadProjectMcpJson();
		for (const [name, config] of Object.entries(projectServers)) {
			if (!this.connections.has(name)) {
				this.connections.set(name, {
					name,
					config,
					status: 'disconnected',
					transport: null,
					tools: [],
				});
			}
		}
	}

	private loadProjectMcpJson(): Record<string, McpServerConfig> {
		const candidates = [
			join(process.cwd(), '.mcp.json'),
			join(process.cwd(), '.wmind', 'mcp.json'),
		];
		for (const path of candidates) {
			if (existsSync(path)) {
				try {
					const raw = readFileSync(path, 'utf-8');
					const parsed = JSON.parse(stripJsonComments(raw));
					return parseMcpProjectConfig(parsed);
				} catch {
					/* skip malformed */
				}
			}
		}
		return {};
	}

	private readonly CONNECTION_TIMEOUT_MS = 15_000;

	async addServer(
		name: string,
		config: McpServerConfig,
	): Promise<McpServerInfo> {
		this.connections.set(name, {
			name,
			config,
			status: 'disconnected',
			transport: null,
			tools: [],
		});

		if (config.enabled !== false) {
			await this.connect(name);
		}

		return this.getServerInfo(name) as McpServerInfo;
	}

	registerServer(name: string, config: McpServerConfig): void {
		this.connections.set(name, {
			name,
			config,
			status: config.enabled === false ? 'disconnected' : 'disconnected',
			transport: null,
			tools: [],
		});
	}

	async connectAllParallel(
		names?: string[],
	): Promise<{ connected: string[]; skipped: string[]; failed: string[] }> {
		const targets = names ?? [...this.connections.keys()];
		const eligible = targets.filter((n) => {
			const conn = this.connections.get(n);
			return (
				conn && conn.config.enabled !== false && conn.status === 'disconnected'
			);
		});
		const skipped = targets.filter((n) => {
			const conn = this.connections.get(n);
			return conn && conn.config.enabled === false;
		});

		const results = await Promise.allSettled(
			eligible.map((name) => this.connectWithTimeout(name)),
		);

		const connected: string[] = [];
		const failed: string[] = [];
		for (let i = 0; i < results.length; i++) {
			const r = results[i];
			const name = eligible[i];
			if (
				r.status === 'fulfilled' &&
				this.getServerInfo(name)?.status === 'connected'
			) {
				connected.push(name);
			} else {
				failed.push(name);
			}
		}

		return { connected, skipped, failed };
	}

	async removeServer(name: string): Promise<void> {
		await this.disconnect(name);
		this.connections.delete(name);
		this.notify();
	}

	async connect(name: string, signal?: AbortSignal): Promise<void> {
		const conn = this.connections.get(name);
		if (!conn) throw new Error(`MCP server "${name}" not found`);
		if (conn.status === 'connected') return;
		if (conn.config.enabled === false) {
			const hasRequired =
				conn.config.requiredEnvVars && conn.config.requiredEnvVars.length > 0;
			throw new Error(
				hasRequired
					? `MCP server "${name}" is disabled (missing required env vars). Use /mcp-connect to provide them.`
					: `MCP server "${name}" is disabled. Use /mcp-connect to re-enable it.`,
			);
		}

		conn.status = 'connecting';
		conn.error = undefined;
		this.notify();

		const resolvedConfig = { ...conn.config };
		try {
			if (resolvedConfig.command) {
				const subbed = substituteCommandVars(
					resolvedConfig.command,
					resolvedConfig,
				);
				resolvedConfig.command = subbed.args;
				if (subbed.unresolvedVars.length > 0) {
					conn.status = 'error';
					conn.error = `Unresolved variable(s) in command: ${subbed.unresolvedVars.join(', ')}. Use /mcp-connect to provide required values.`;
					conn.tools = [];
					this.notify();
					return;
				}
			}
			const transport = await createTransport(name, resolvedConfig);
			if (signal?.aborted) {
				await transport.close();
				conn.status = 'error';
				conn.error = `Connection timed out after ${this.CONNECTION_TIMEOUT_MS / 1000}s`;
				conn.tools = [];
				this.notify();
				return;
			}
			const toolsResult = await transport.client.listTools();
			const mcpTools = toolsResult.tools || [];

			if (signal?.aborted) {
				await transport.close();
				conn.status = 'error';
				conn.error = `Connection timed out after ${this.CONNECTION_TIMEOUT_MS / 1000}s`;
				conn.tools = [];
				this.notify();
				return;
			}

			conn.tools = mcpTools.map((t) =>
				mcpToolToToolDef(name, t, transport.client),
			);
			conn.transport = transport;
			conn.status = 'connected';

			transport.client.onclose = () => {
				if (conn.status === 'connected') {
					conn.status = 'error';
					conn.error = 'Connection closed unexpectedly';
					conn.tools = [];
					conn.transport = null;
					this.notify();
				}
			};
		} catch (err: any) {
			if (signal?.aborted) {
				conn.status = 'error';
				conn.error = `Connection timed out after ${this.CONNECTION_TIMEOUT_MS / 1000}s`;
				conn.tools = [];
			} else {
				conn.status = 'error';
				conn.error = enrichMcpError(
					err.message || String(err),
					resolvedConfig.command,
				);
				conn.tools = [];
			}
		}

		this.notify();
	}

	async connectWithTimeout(name: string, timeoutMs?: number): Promise<void> {
		const ms = timeoutMs ?? this.CONNECTION_TIMEOUT_MS;
		const controller = new AbortController();
		const result = await Promise.race([
			this.connect(name, controller.signal),
			new Promise<'timeout'>((resolve) =>
				setTimeout(() => {
					controller.abort();
					resolve('timeout');
				}, ms),
			),
		]);
		if (result === 'timeout') {
			const conn = this.connections.get(name);
			if (conn && conn.status === 'connecting') {
				conn.status = 'error';
				conn.error = `Connection timed out after ${ms / 1000}s`;
				conn.tools = [];
				this.notify();
			}
		}
	}

	async disconnect(name: string): Promise<void> {
		const conn = this.connections.get(name);
		if (!conn || conn.status === 'disconnected') return;

		try {
			await conn.transport?.close();
		} catch {
			/* ignore close errors */
		}

		conn.transport = null;
		conn.tools = [];
		conn.status = 'disconnected';
		conn.error = undefined;
		this.notify();
	}

	async disconnectAll(): Promise<void> {
		const names = [...this.connections.keys()];
		await Promise.all(names.map((n) => this.disconnect(n)));
	}

	getTools(): ToolDef[] {
		const tools: ToolDef[] = [];
		for (const conn of this.connections.values()) {
			if (conn.status === 'connected') {
				tools.push(...conn.tools);
			}
		}
		return tools;
	}

	listServers(): McpServerInfo[] {
		return [...this.connections.values()].map((conn) => ({
			name: conn.name,
			type: conn.config.type || (conn.config.command ? 'local' : 'remote'),
			status: conn.status,
			toolCount: conn.tools.length,
			tools: conn.tools.map((t) => t.name),
			error: conn.error,
			enabled: conn.config.enabled !== false,
		}));
	}

	getServerInfo(name: string): McpServerInfo | undefined {
		const conn = this.connections.get(name);
		if (!conn) return undefined;
		return {
			name: conn.name,
			type: conn.config.type || (conn.config.command ? 'local' : 'remote'),
			status: conn.status,
			toolCount: conn.tools.length,
			tools: conn.tools.map((t) => t.name),
			error: conn.error,
			enabled: conn.config.enabled !== false,
		};
	}

	hasServer(name: string): boolean {
		return this.connections.has(name);
	}

	getConfigs(): Record<string, McpServerConfig> {
		const result: Record<string, McpServerConfig> = {};
		for (const [name, conn] of this.connections) {
			result[name] = conn.config;
		}
		return result;
	}

	persistMcpConfigs(): void {
		const configs = this.getConfigs();
		if (Object.keys(configs).length === 0) return;
		const uc = loadUserConfig();
		uc.mcpServers = stripSensitiveEnvVars(configs);
		writeUserConfig(uc);
	}

	async reconnectMemoryStore(
		_storeName: string,
		storePath: string,
	): Promise<{ success: boolean; entityCount: number; error?: string }> {
		const conn = this.connections.get('memory');
		if (!conn) {
			return {
				success: false,
				entityCount: 0,
				error: 'Memory server not found in registry',
			};
		}

		await this.disconnect('memory');

		conn.config.env = { ...conn.config.env, MEMORY_FILE_PATH: storePath };
		conn.status = 'disconnected';
		conn.error = undefined;

		try {
			await this.connect('memory');
			const info = this.getServerInfo('memory');
			if (info?.status === 'connected') {
				const readGraph = conn.tools.find(
					(t) => t.name === 'mcp__memory__read_graph',
				);
				let entityCount = 0;
				if (readGraph) {
					try {
						const result = await readGraph.execute({});
						const graph =
							typeof result === 'string' ? JSON.parse(result) : result;
						entityCount = graph?.entities?.length ?? 0;
					} catch {
						// empty store, that's fine
					}
				}
				return { success: true, entityCount };
			}
			return {
				success: false,
				entityCount: 0,
				error: info?.error || 'Reconnect failed',
			};
		} catch (err: any) {
			return {
				success: false,
				entityCount: 0,
				error: err.message || String(err),
			};
		}
	}

	validateToolReferences(
		allowedToolsLists: Array<{ source: string; tools: string[] }>,
	): string[] {
		const connectedTools = this.getTools().map((t) => t.name);
		const warnings: string[] = [];

		for (const { source, tools } of allowedToolsLists) {
			for (const toolRef of tools) {
				if (toolRef.endsWith('*')) continue;
				const result = validateToolReference(toolRef, connectedTools);
				if (!result.valid) {
					const hint = result.suggestion
						? ` (did you mean ${result.suggestion}?)`
						: '';
					warnings.push(`${source}: unknown tool "${toolRef}"${hint}`);
				}
			}
		}

		return warnings;
	}
}
