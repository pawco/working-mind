import { describe, expect, it } from 'vitest';
import type { McpServerConfig } from '../config.js';
import type { McpServerInfo } from './registry.js';
import {
	enrichMcpError,
	McpRegistry,
	stripSensitiveEnvVars,
	substituteCommandVars,
} from './registry.js';

describe('McpRegistry', () => {
	it('starts empty', () => {
		const reg = new McpRegistry();
		expect(reg.listServers()).toEqual([]);
		expect(reg.getTools()).toEqual([]);
	});

	it('loadFromConfig adds servers as disconnected', () => {
		const reg = new McpRegistry();
		reg.loadFromConfig({
			mcpServers: {
				'brave-search': {
					type: 'remote',
					url: 'https://mcp.brave.com/mcp',
					enabled: true,
				},
				github: {
					type: 'local',
					command: ['npx', '-y', '@modelcontextprotocol/server-github'],
					enabled: false,
				},
			},
		});
		const servers = reg.listServers();
		expect(servers).toHaveLength(2);
		expect(servers[0].name).toBe('brave-search');
		expect(servers[0].status).toBe('disconnected');
		expect(servers[0].enabled).toBe(true);
		expect(servers[1].name).toBe('github');
		expect(servers[1].enabled).toBe(false);
	});

	it('hasServer checks existence', () => {
		const reg = new McpRegistry();
		reg.loadFromConfig({
			mcpServers: { test: { type: 'remote', url: 'https://example.com/mcp' } },
		});
		expect(reg.hasServer('test')).toBe(true);
		expect(reg.hasServer('nope')).toBe(false);
	});

	it('getServerInfo returns info for existing server', () => {
		const reg = new McpRegistry();
		reg.loadFromConfig({
			mcpServers: { test: { type: 'remote', url: 'https://example.com/mcp' } },
		});
		const info = reg.getServerInfo('test');
		expect(info).not.toBeNull();
		expect(info?.name).toBe('test');
		expect(info?.type).toBe('remote');
	});

	it('getServerInfo returns undefined for missing server', () => {
		const reg = new McpRegistry();
		expect(reg.getServerInfo('nope')).toBeUndefined();
	});

	it('getConfigs returns server configs', () => {
		const reg = new McpRegistry();
		const config: McpServerConfig = {
			type: 'remote',
			url: 'https://example.com/mcp',
			enabled: true,
		};
		reg.loadFromConfig({ mcpServers: { test: config } });
		const configs = reg.getConfigs();
		expect(configs.test).toEqual(config);
	});

	it('removeServer disconnects and removes', async () => {
		const reg = new McpRegistry();
		reg.loadFromConfig({
			mcpServers: { test: { type: 'remote', url: 'https://example.com/mcp' } },
		});
		await reg.removeServer('test');
		expect(reg.hasServer('test')).toBe(false);
		expect(reg.listServers()).toHaveLength(0);
	});

	it('status listener is called on connect/disconnect', () => {
		const reg = new McpRegistry();
		const events: McpServerInfo[][] = [];
		reg.onStatusChange((servers) => events.push([...servers]));
		reg.loadFromConfig({
			mcpServers: { test: { type: 'remote', url: 'https://example.com/mcp' } },
		});
		expect(events.length).toBe(0);
	});

	it('getTools returns empty when no servers connected', () => {
		const reg = new McpRegistry();
		reg.loadFromConfig({
			mcpServers: { test: { type: 'remote', url: 'https://example.com/mcp' } },
		});
		expect(reg.getTools()).toEqual([]);
	});
});

describe('substituteCommandVars', () => {
	const baseConfig: McpServerConfig = {
		type: 'local',
		command: [],
		env: {},
	};

	it('resolves $CWD to process.cwd()', () => {
		const result = substituteCommandVars(
			['npx', '-y', 'server', '$CWD'],
			baseConfig,
		);
		expect(result.args).toEqual(['npx', '-y', 'server', process.cwd()]);
		expect(result.unresolvedVars).toEqual([]);
	});

	it('resolves $HOME to homedir()', () => {
		const result = substituteCommandVars(
			['npx', '-y', 'server', '$HOME'],
			baseConfig,
		);
		expect(result.args[3]).not.toBe('$HOME');
		expect(result.unresolvedVars).toEqual([]);
	});

	it('resolves $INPUT_DIR from env', () => {
		const result = substituteCommandVars(
			['npx', '-y', 'server', '$INPUT_DIR'],
			{ ...baseConfig, env: { INPUT_DIR: '/tmp/scan' } },
		);
		expect(result.args).toEqual(['npx', '-y', 'server', '/tmp/scan']);
		expect(result.unresolvedVars).toEqual([]);
	});

	it('reports unresolved $INPUT_DIR when env is missing', () => {
		const result = substituteCommandVars(
			['npx', '-y', 'server', '$INPUT_DIR'],
			baseConfig,
		);
		expect(result.args[3]).toBe('$INPUT_DIR');
		expect(result.unresolvedVars).toEqual(['$INPUT_DIR']);
	});

	it('resolves $PACK_DIR from config', () => {
		const result = substituteCommandVars(['npx', '-y', 'server', '$PACK_DIR'], {
			...baseConfig,
			packDir: '/packs/explorer',
		});
		expect(result.args).toEqual(['npx', '-y', 'server', '/packs/explorer']);
		expect(result.unresolvedVars).toEqual([]);
	});

	it('leaves $PACK_DIR unresolved when no packDir', () => {
		const result = substituteCommandVars(
			['npx', '-y', 'server', '$PACK_DIR'],
			baseConfig,
		);
		expect(result.args[3]).toBe('$PACK_DIR');
		expect(result.unresolvedVars).toEqual([]);
	});

	it('resolves embedded vars like --root=$CWD', () => {
		const result = substituteCommandVars(
			['npx', '-y', 'server', '--root=$CWD'],
			baseConfig,
		);
		expect(result.args[3]).toBe(`--root=${process.cwd()}`);
	});
});

describe('enrichMcpError', () => {
	it('detects unknown npm package on -32000', () => {
		const msg = enrichMcpError('MCP error -32000: Connection closed', [
			'npx',
			'-y',
			'fs-mcp',
		]);
		expect(msg).toContain('not a known MCP server');
		expect(msg).toContain('fs-mcp');
	});

	it('detects unknown custom package', () => {
		const msg = enrichMcpError('MCP error -32000: Connection closed', [
			'npx',
			'-y',
			'custom-mcp',
		]);
		expect(msg).toContain('not a known MCP server');
		expect(msg).toContain('custom-mcp');
	});

	it('does not flag known packages', () => {
		const msg = enrichMcpError('MCP error -32000: Connection closed', [
			'npx',
			'-y',
			'@modelcontextprotocol/server-memory',
		]);
		expect(msg).not.toContain('not a known MCP server');
		expect(msg).toContain('missing API key');
	});

	it('detects Python dependency issue', () => {
		const msg = enrichMcpError(
			'MCP error -32000: Python 3.11 or 3.12 not found',
			['npx', '-y', 'arxiv-mcp-server'],
		);
		expect(msg).toContain('requires Python');
	});

	it('passes through non-32000 errors', () => {
		const msg = enrichMcpError('Some other error');
		expect(msg).toBe('Some other error');
	});

	it('truncates very long messages', () => {
		const long = 'x'.repeat(300);
		const msg = enrichMcpError(long);
		expect(msg.length).toBeLessThan(long.length);
	});
});

describe('stripSensitiveEnvVars', () => {
	it('strips env vars marked as sensitive in requiredEnvVars', () => {
		const configs: Record<string, McpServerConfig> = {
			search: {
				type: 'local',
				command: ['npx', 'search'],
				env: { BRAVE_API_KEY: 'real-key-abc', OTHER_VAR: 'keep-me' },
				enabled: true,
				requiredEnvVars: [
					{
						name: 'BRAVE_API_KEY',
						label: 'API Key',
						required: false,
						sensitive: true,
					},
					{ name: 'OTHER_VAR', label: 'Other', required: false },
				],
			},
		};
		const result = stripSensitiveEnvVars(configs);
		expect(result.search.env?.BRAVE_API_KEY).toBeUndefined();
		expect(result.search.env?.OTHER_VAR).toBe('keep-me');
	});

	it('keeps all env vars when no requiredEnvVars', () => {
		const configs: Record<string, McpServerConfig> = {
			search: {
				type: 'local',
				command: ['npx', 'search'],
				env: { API_KEY: 'key123' },
				enabled: true,
			},
		};
		const result = stripSensitiveEnvVars(configs);
		expect(result.search.env?.API_KEY).toBe('key123');
	});

	it('keeps non-sensitive env vars', () => {
		const configs: Record<string, McpServerConfig> = {
			search: {
				type: 'local',
				command: ['npx', 'search'],
				env: { MEMORY_FILE_PATH: '/tmp/mem.jsonl', API_KEY: 'secret' },
				enabled: true,
				requiredEnvVars: [
					{ name: 'API_KEY', label: 'Key', required: false, sensitive: true },
				],
			},
		};
		const result = stripSensitiveEnvVars(configs);
		expect(result.search.env?.MEMORY_FILE_PATH).toBe('/tmp/mem.jsonl');
		expect(result.search.env?.API_KEY).toBeUndefined();
	});
});
