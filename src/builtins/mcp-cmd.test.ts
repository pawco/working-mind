import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServerConfig } from '../config.js';
import type { McpRegistry, McpServerInfo } from '../mcp/registry.js';
import type { CommandContext } from '../sdk/command.js';
import { mcpConnectCmd } from './mcp-cmd.js';

function makeCtx(mcpRegistry: McpRegistry, args: string): CommandContext {
	return {
		args,
		agent: {
			id: 'test',
			name: 'test',
			persona: 'default',
			systemPrompt: '',
			tools: [],
			messages: [],
			status: 'idle',
			model: 'test',
			activeSkills: new Set(),
			currentTask: undefined,
			packSystemPrompt: undefined,
		},
		config: {} as any,
		mcpRegistry,
		setHistory: () => {},
		setInput: () => {},
		exit: () => {},
		activateSkill: () => null,
		deactivateSkill: () => {},
	};
}

function makeMockRegistry(
	servers: Record<
		string,
		{ info: Partial<McpServerInfo>; config: McpServerConfig }
	>,
): McpRegistry {
	return {
		getServerInfo: vi.fn((name: string) => {
			const entry = servers[name];
			if (!entry) return undefined;
			return {
				name,
				type: 'local',
				status: 'disconnected',
				toolCount: 0,
				tools: [],
				enabled: true,
				...entry.info,
			} as McpServerInfo;
		}),
		getConfigs: vi.fn(() => {
			const result: Record<string, McpServerConfig> = {};
			for (const [name, entry] of Object.entries(servers)) {
				result[name] = entry.config;
			}
			return result;
		}),
		connect: vi.fn(async () => {}),
		addServer: vi.fn(async (_name: string, _config: McpServerConfig) => {
			return {
				name: _name,
				type: 'local',
				status: 'connected',
				toolCount: 5,
				tools: ['tool1', 'tool2', 'tool3', 'tool4', 'tool5'],
				enabled: true,
			} as McpServerInfo;
		}),
		removeServer: vi.fn(async () => {}),
		listServers: vi.fn(() => []),
		hasServer: vi.fn((name: string) => name in servers),
	} as any;
}

describe('mcp-connect', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('returns error for missing name', async () => {
		const registry = makeMockRegistry({});
		const result = await mcpConnectCmd.handler(makeCtx(registry, ''));
		expect(result.type).toBe('message');
		if (result.type === 'message') {
			expect(result.content).toContain('Usage');
		}
	});

	it('returns not found for unknown server', async () => {
		const registry = makeMockRegistry({});
		const result = await mcpConnectCmd.handler(makeCtx(registry, 'unknown'));
		expect(result.type).toBe('message');
		if (result.type === 'message') {
			expect(result.content).toContain('not found');
		}
	});

	it('suggests /mcp-add for catalog server not yet configured', async () => {
		const registry = makeMockRegistry({});
		const result = await mcpConnectCmd.handler(
			makeCtx(registry, 'brave-search'),
		);
		expect(result.type).toBe('message');
		if (result.type === 'message') {
			expect(result.content).toContain('/mcp-add');
		}
	});

	it('returns already connected for connected server', async () => {
		const registry = makeMockRegistry({
			memory: {
				info: { status: 'connected', toolCount: 3 },
				config: {
					type: 'local',
					command: ['npx', '-y', 'memory'],
					enabled: true,
				},
			},
		});
		const result = await mcpConnectCmd.handler(makeCtx(registry, 'memory'));
		expect(result.type).toBe('message');
		if (result.type === 'message') {
			expect(result.content).toContain('already connected');
		}
	});

	it('returns reconnect-server for connected server with env vars', async () => {
		const registry = makeMockRegistry({
			'brave-search': {
				info: { status: 'connected', toolCount: 3 },
				config: {
					type: 'local',
					command: ['npx', '-y', '@brave/brave-search-mcp-server'],
					env: { BRAVE_API_KEY: 'old-key' },
					enabled: true,
					requiredEnvVars: [
						{
							name: 'BRAVE_API_KEY',
							label: 'Brave API Key',
							required: true,
							sensitive: true,
						},
					],
				},
			},
		});
		const result = await mcpConnectCmd.handler(
			makeCtx(registry, 'brave-search'),
		);
		expect(result.type).toBe('reconnect-server');
		if (result.type === 'reconnect-server') {
			expect(result.serverName).toBe('brave-search');
			expect(result.requiredEnvVars.length).toBe(1);
			expect(result.requiredEnvVars[0].name).toBe('BRAVE_API_KEY');
		}
	});

	it('returns reconnect-server for connected server with catalog env vars', async () => {
		const registry = makeMockRegistry({
			firecrawl: {
				info: { status: 'connected', toolCount: 5 },
				config: {
					type: 'local',
					command: ['npx', '-y', 'firecrawl-mcp'],
					env: { FIRECRAWL_API_KEY: 'old-key' },
					enabled: true,
				},
			},
		});
		const result = await mcpConnectCmd.handler(makeCtx(registry, 'firecrawl'));
		expect(result.type).toBe('reconnect-server');
		if (result.type === 'reconnect-server') {
			expect(result.serverName).toBe('firecrawl');
			expect(result.requiredEnvVars[0].name).toBe('FIRECRAWL_API_KEY');
		}
	});

	it('returns reconnect-server for disabled server with missing env vars', async () => {
		const registry = makeMockRegistry({
			'brave-search': {
				info: { status: 'disconnected', enabled: false },
				config: {
					type: 'local',
					command: ['npx', '-y', '@brave/brave-search-mcp-server'],
					enabled: false,
					requiredEnvVars: [
						{ name: 'BRAVE_API_KEY', label: 'Brave API Key', required: true },
					],
				},
			},
		});
		const result = await mcpConnectCmd.handler(
			makeCtx(registry, 'brave-search'),
		);
		expect(result.type).toBe('reconnect-server');
		if (result.type === 'reconnect-server') {
			expect(result.serverName).toBe('brave-search');
			expect(result.requiredEnvVars.length).toBe(1);
			expect(result.requiredEnvVars[0].name).toBe('BRAVE_API_KEY');
		}
	});

	it('re-enables server when env vars are now available', async () => {
		process.env.BRAVE_API_KEY = 'test-key';
		const registry = makeMockRegistry({
			'brave-search': {
				info: { status: 'disconnected', enabled: false },
				config: {
					type: 'local',
					command: ['npx', '-y', '@brave/brave-search-mcp-server'],
					enabled: false,
					requiredEnvVars: [
						{ name: 'BRAVE_API_KEY', label: 'Brave API Key', required: true },
					],
				},
			},
		});
		const result = await mcpConnectCmd.handler(
			makeCtx(registry, 'brave-search'),
		);
		expect(result.type).toBe('message');
		if (result.type === 'message') {
			expect(result.content).toContain('Connected');
			expect(result.content).toContain('5 tools');
		}
		expect(registry.removeServer).toHaveBeenCalledWith('brave-search');
		expect(registry.addServer).toHaveBeenCalled();
		delete process.env.BRAVE_API_KEY;
	});

	it('re-enables disabled server without requiredEnvVars', async () => {
		const registry = makeMockRegistry({
			custom: {
				info: { status: 'disconnected', enabled: false },
				config: {
					type: 'local',
					command: ['npx', '-y', 'custom-mcp'],
					enabled: false,
				},
			},
		});
		const result = await mcpConnectCmd.handler(makeCtx(registry, 'custom'));
		expect(result.type).toBe('message');
		if (result.type === 'message') {
			expect(result.content).toContain('Connected');
		}
		expect(registry.removeServer).toHaveBeenCalledWith('custom');
		expect(registry.addServer).toHaveBeenCalled();
	});

	it('connects normally for enabled disconnected server', async () => {
		const registry = makeMockRegistry({
			memory: {
				info: { status: 'disconnected', enabled: true },
				config: {
					type: 'local',
					command: ['npx', '-y', '@modelcontextprotocol/server-memory'],
					enabled: true,
				},
			},
		});
		const result = await mcpConnectCmd.handler(makeCtx(registry, 'memory'));
		expect(result.type).toBe('message');
		if (result.type === 'message') {
			expect(result.content).toContain('Connected');
		}
		expect(registry.connect).toHaveBeenCalledWith('memory');
	});

	it('returns reconnect-server for error-state server with missing catalog env vars', async () => {
		const registry = makeMockRegistry({
			'brave-search': {
				info: {
					status: 'error',
					enabled: true,
					error: 'MCP error -32000: API key required',
				},
				config: {
					type: 'local',
					command: ['npx', '-y', '@brave/brave-search-mcp-server'],
					env: {},
					enabled: true,
				},
			},
		});
		const result = await mcpConnectCmd.handler(
			makeCtx(registry, 'brave-search'),
		);
		expect(result.type).toBe('reconnect-server');
		if (result.type === 'reconnect-server') {
			expect(result.serverName).toBe('brave-search');
			expect(result.requiredEnvVars.length).toBe(1);
			expect(result.requiredEnvVars[0].name).toBe('BRAVE_API_KEY');
		}
	});

	it('returns reconnect-server for error-state server without requiredEnvVars using catalog', async () => {
		const registry = makeMockRegistry({
			firecrawl: {
				info: { status: 'error', enabled: true, error: 'Connection closed' },
				config: {
					type: 'local',
					command: ['npx', '-y', 'firecrawl-mcp'],
					env: {},
					enabled: true,
				},
			},
		});
		const result = await mcpConnectCmd.handler(makeCtx(registry, 'firecrawl'));
		expect(result.type).toBe('reconnect-server');
		if (result.type === 'reconnect-server') {
			expect(result.serverName).toBe('firecrawl');
			expect(result.requiredEnvVars[0].name).toBe('FIRECRAWL_API_KEY');
		}
	});

	it('retries connect for error-state server when env vars are present', async () => {
		process.env.BRAVE_API_KEY = 'test-key';
		let connectCalled = false;
		const registry = makeMockRegistry({
			'brave-search': {
				info: { status: 'error', enabled: true, error: 'MCP error -32000' },
				config: {
					type: 'local',
					command: ['npx', '-y', '@brave/brave-search-mcp-server'],
					env: {},
					enabled: true,
				},
			},
		});
		(registry.connect as any).mockImplementation(async () => {
			connectCalled = true;
		});
		(registry.getServerInfo as any).mockImplementation((name: string) => {
			if (name === 'brave-search' && connectCalled) {
				return {
					name,
					type: 'local',
					status: 'connected',
					toolCount: 5,
					tools: ['tool1'],
					enabled: true,
				} as McpServerInfo;
			}
			return {
				name,
				type: 'local',
				status: 'error',
				toolCount: 0,
				tools: [],
				enabled: true,
				error: 'MCP error -32000',
			} as McpServerInfo;
		});
		const result = await mcpConnectCmd.handler(
			makeCtx(registry, 'brave-search'),
		);
		expect(result.type).toBe('message');
		if (result.type === 'message') {
			expect(result.content).toContain('Connected');
		}
		expect(registry.connect).toHaveBeenCalledWith('brave-search');
		delete process.env.BRAVE_API_KEY;
	});

	it('returns reconnect-server for disabled server using catalog when config has no requiredEnvVars', async () => {
		const registry = makeMockRegistry({
			'brave-search': {
				info: { status: 'disconnected', enabled: false },
				config: {
					type: 'local',
					command: ['npx', '-y', '@brave/brave-search-mcp-server'],
					enabled: false,
				},
			},
		});
		const result = await mcpConnectCmd.handler(
			makeCtx(registry, 'brave-search'),
		);
		expect(result.type).toBe('reconnect-server');
		if (result.type === 'reconnect-server') {
			expect(result.serverName).toBe('brave-search');
			expect(result.requiredEnvVars[0].name).toBe('BRAVE_API_KEY');
		}
	});

	it('returns reconnect-server for pathPrompt server with INPUT_DIR in requiredEnvVars', async () => {
		const registry = makeMockRegistry({
			filesystem: {
				info: { status: 'disconnected', enabled: false },
				config: {
					type: 'local',
					command: ['npx', '-y', 'fs-mcp', '$INPUT_DIR'],
					enabled: false,
					pathPrompt: 'Which directory to scan?',
					requiredEnvVars: [
						{
							name: 'INPUT_DIR',
							label: 'Which directory to scan?',
							required: true,
							sensitive: false,
						},
					],
				},
			},
		});
		const result = await mcpConnectCmd.handler(makeCtx(registry, 'filesystem'));
		expect(result.type).toBe('reconnect-server');
		if (result.type === 'reconnect-server') {
			expect(result.serverName).toBe('filesystem');
			expect(result.requiredEnvVars.length).toBe(1);
			expect(result.requiredEnvVars[0].name).toBe('INPUT_DIR');
			expect(result.requiredEnvVars[0].label).toBe('Which directory to scan?');
			expect(result.requiredEnvVars[0].sensitive).toBe(false);
		}
	});

	it('re-enables pathPrompt server when INPUT_DIR is in config.env', async () => {
		const registry = makeMockRegistry({
			filesystem: {
				info: { status: 'disconnected', enabled: false },
				config: {
					type: 'local',
					command: ['npx', '-y', 'fs-mcp', '$INPUT_DIR'],
					enabled: false,
					pathPrompt: 'Which directory to scan?',
					env: { INPUT_DIR: '/tmp/codebase' },
					requiredEnvVars: [
						{
							name: 'INPUT_DIR',
							label: 'Which directory to scan?',
							required: true,
							sensitive: false,
						},
					],
				},
			},
		});
		const result = await mcpConnectCmd.handler(makeCtx(registry, 'filesystem'));
		expect(result.type).toBe('message');
		if (result.type === 'message') {
			expect(result.content).toContain('Connected');
		}
		expect(registry.removeServer).toHaveBeenCalledWith('filesystem');
		expect(registry.addServer).toHaveBeenCalled();
	});
});
