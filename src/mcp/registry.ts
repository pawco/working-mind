import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import stripJsonComments from 'strip-json-comments';
import type { McpServerConfig, UserConfig } from '../config.js';
import type { ToolDef } from '../sdk/tool.js';
import { mcpToolToToolDef } from './adapter.js';
import { createTransport, type McpTransportResult } from './transport.js';

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
			join(process.cwd(), '.openexplorer', 'mcp.json'),
		];
		for (const path of candidates) {
			if (existsSync(path)) {
				try {
					const raw = readFileSync(path, 'utf-8');
					const parsed = JSON.parse(stripJsonComments(raw));
					return parsed.mcpServers || {};
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

		return this.getServerInfo(name)!;
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

	async connect(name: string): Promise<void> {
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

		try {
			const transport = await createTransport(name, conn.config);
			const toolsResult = await transport.client.listTools();
			const mcpTools = toolsResult.tools || [];

			conn.tools = mcpTools.map((t) =>
				mcpToolToToolDef(name, t, transport.client),
			);
			conn.transport = transport;
			conn.status = 'connected';
		} catch (err: any) {
			conn.status = 'error';
			conn.error = err.message || String(err);
			conn.tools = [];
		}

		this.notify();
	}

	async connectWithTimeout(name: string, timeoutMs?: number): Promise<void> {
		const ms = timeoutMs ?? this.CONNECTION_TIMEOUT_MS;
		const result = await Promise.race([
			this.connect(name),
			new Promise<'timeout'>((resolve) =>
				setTimeout(() => resolve('timeout'), ms),
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
}
