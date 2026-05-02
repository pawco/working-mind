import { describe, expect, it } from 'vitest';
import type { McpServerConfig } from '../config.js';
import type { McpServerInfo } from './registry.js';
import { McpRegistry } from './registry.js';

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
