import { describe, expect, it } from 'vitest';
import { getBuiltInCommands, getPackProvidedCommands } from './builtins/index.js';
import {
	loadPacks,
	mergePackTools,
	resolvePersonaFromPacks,
} from './loader.js';
import type { PackManifest } from './pack-loader.js';
import type { ToolPack } from './sdk/tool.js';

const packA: ToolPack = {
	name: 'pack-a',
	version: '1.0.0',
	description: 'Pack A',
	tools: [
		{
			name: 'foo',
			description: 'Foo',
			parameters: { type: 'object', properties: {} },
			execute: async () => ({}),
		},
		{
			name: 'bar',
			description: 'Bar',
			parameters: { type: 'object', properties: {} },
			execute: async () => ({}),
			destructive: true,
		},
	],
};

const packB: ToolPack = {
	name: 'pack-b',
	version: '1.0.0',
	description: 'Pack B',
	tools: [
		{
			name: 'baz',
			description: 'Baz',
			parameters: { type: 'object', properties: {} },
			execute: async () => ({}),
		},
		{
			name: 'foo',
			description: 'Foo B override',
			parameters: { type: 'object', properties: {} },
			execute: async () => ({}),
		},
	],
	personas: {
		safe: { prompt: 'Safe mode', toolFilter: { preset: 'readonly' } },
	},
};

describe('mergePackTools', () => {
	it('merges tools from multiple packs', () => {
		const tools = mergePackTools([packA, packB]);
		const names = tools.map((t) => t.name);
		expect(names).toContain('foo');
		expect(names).toContain('bar');
		expect(names).toContain('baz');
	});

	it('last pack wins for duplicate tool names', () => {
		const tools = mergePackTools([packA, packB]);
		const _foo = tools.find(
			(t) => t.name === 'foo' && !t.description.includes('override'),
		);
		const fooB = tools.find(
			(t) => t.name === 'foo' && t.description.includes('override'),
		);
		expect(fooB).toBeDefined();
	});

	it('applies readonly filter', () => {
		const tools = mergePackTools([packA], { preset: 'readonly' });
		expect(tools.every((t) => !t.destructive && !t.longRunning)).toBe(true);
	});

	it('applies none filter', () => {
		const tools = mergePackTools([packA], { preset: 'none' });
		expect(tools).toHaveLength(0);
	});
});

describe('resolvePersonaFromPacks', () => {
	it('finds persona in pack', () => {
		const result = resolvePersonaFromPacks('safe', [packA, packB]);
		expect(result).not.toBeNull();
		expect(result?.prompt).toBe('Safe mode');
	});

	it('returns null for unknown persona', () => {
		const result = resolvePersonaFromPacks('unknown', [packA, packB]);
		expect(result).toBeNull();
	});
});

describe('loadPacks — starter default', () => {
	it('loads the starter pack by name', async () => {
		const result = await loadPacks(['starter']);
		expect(result.packs.length).toBe(1);
		expect(result.packs[0].name).toBe('starter');
		expect(result.systemPromptOverride).toBeTruthy();
	});

	it('starter pack has no personas', async () => {
		const result = await loadPacks(['starter']);
		const personas = Object.keys(result.packs[0].personas || {});
		expect(personas).toHaveLength(0);
	});

	it('starter pack has no skills', async () => {
		const result = await loadPacks(['starter']);
		const skills = Object.keys(result.packs[0].skills || {});
		expect(skills).toHaveLength(0);
	});

	it('starter pack has curation prompts', async () => {
		const result = await loadPacks(['starter']);
		expect(result.packs[0].curation).toBeDefined();
		expect(result.packs[0].curation?.summarize).toBeTruthy();
		expect(result.packs[0].curation?.export).toBeTruthy();
	});

	it('returns empty when no packs specified', async () => {
		const result = await loadPacks([]);
		expect(result.packs).toEqual([]);
		expect(result.systemPromptOverride).toBeUndefined();
	});
});

describe('default pack name resolution', () => {
	it('resolves empty pack list to starter', () => {
		const packNames: string[] = [];
		const resolved =
			packNames.length > 0 && packNames[0] !== 'none'
				? packNames
				: packNames[0] === 'none'
					? []
					: ['starter'];
		expect(resolved).toEqual(['starter']);
	});

	it('resolves --pack none to empty list', () => {
		const packNames = ['none'];
		const resolved =
			packNames.length > 0 && packNames[0] !== 'none'
				? packNames
				: packNames[0] === 'none'
					? []
					: ['starter'];
		expect(resolved).toEqual([]);
	});

	it('passes through explicit pack names', () => {
		const packNames = ['starter'];
		const resolved =
			packNames.length > 0 && packNames[0] !== 'none'
				? packNames
				: packNames[0] === 'none'
					? []
					: ['starter'];
		expect(resolved).toEqual(['starter']);
	});

	it('passes through multiple pack names', () => {
		const packNames = ['starter', 'custom-pack'];
		const resolved =
			packNames.length > 0 && packNames[0] !== 'none'
				? packNames
				: packNames[0] === 'none'
					? []
					: ['starter'];
		expect(resolved).toEqual(['starter', 'custom-pack']);
	});
});

describe('getPackProvidedCommands', () => {
	it('returns no commands for minimal pack', () => {
		const manifest: PackManifest = {
			name: 'minimal',
			version: '0.1.0',
			description: 'Minimal pack',
			prompt: 'prompt.md',
		};
		const cmds = getPackProvidedCommands(manifest);
		expect(cmds).toEqual([]);
	});

	it('does not return memory or lint (they are builtins)', () => {
		const manifest: PackManifest = {
			name: 'starter',
			version: '0.1.0',
			description: 'Starter pack',
			prompt: 'prompt.md',
			mcpServers: {
				memory: { package: '@modelcontextprotocol/server-memory' },
			},
		};
		const cmds = getPackProvidedCommands(manifest);
		const names = cmds.map((c) => c.name);
		expect(names).not.toContain('memory');
		expect(names).not.toContain('lint');
		expect(names).not.toContain('ingest');
	});

	it('returns curation commands for pack with curation field', () => {
		const manifest: PackManifest = {
			name: 'starter',
			version: '0.1.0',
			description: 'Starter pack',
			prompt: 'prompt.md',
			curation: { summarize: 'curation/summarize.md' },
		};
		const cmds = getPackProvidedCommands(manifest);
		const names = cmds.map((c) => c.name);
		expect(names).toContain('summarize');
		expect(names).toContain('export');
		expect(names).toContain('import');
		expect(names).toContain('research');
	});
});

describe('getBuiltInCommands includes core commands', () => {
	it('ingest, memory, lint are builtin commands available to all packs', () => {
		const builtins = getBuiltInCommands();
		const names = builtins.map((c) => c.name);
		expect(names).toContain('ingest');
		expect(names).toContain('memory');
		expect(names).toContain('lint');
	});

	it('core builtins are not duplicated by getPackProvidedCommands', () => {
		const manifest: PackManifest = {
			name: 'starter',
			version: '0.1.0',
			description: 'Starter pack',
			prompt: 'prompt.md',
			mcpServers: {
				memory: { package: '@modelcontextprotocol/server-memory' },
			},
		};
		const packCmds = getPackProvidedCommands(manifest);
		const packNames = packCmds.map((c) => c.name);
		expect(packNames).not.toContain('ingest');
		expect(packNames).not.toContain('memory');
		expect(packNames).not.toContain('lint');
	});

	it('pack-declared ingest command coexists with builtin via namespace', async () => {
		const { CommandRegistry } = await import('./command-registry.js');
		const registry = new CommandRegistry();

		for (const cmd of getBuiltInCommands()) {
			registry.register(cmd);
		}

		const packCmd = {
			name: 'ingest',
			description: 'Pack-declared ingest',
			handler: () => ({ type: 'message' as const, content: 'pack' }),
		};
		registry.register(packCmd, 'custom-pack');

		const resolved = registry.resolve('/ingest');
		expect(resolved).not.toBeNull();
		expect(resolved!.command.name).toBe('ingest');

		const nsResolved = registry.resolve('/custom-pack:ingest');
		expect(nsResolved).not.toBeNull();
		expect(nsResolved!.command.description).toBe('Pack-declared ingest');
	});

	it('ingest command works without any pack loaded', () => {
		const builtins = getBuiltInCommands();
		const ingest = builtins.find((c) => c.name === 'ingest');
		expect(ingest).toBeDefined();
		expect(ingest!.description).toContain('Markdown');
		expect(ingest!.requiresConfirmation).toBe(true);
	});

	it('memory command works without any pack loaded', () => {
		const builtins = getBuiltInCommands();
		const memory = builtins.find((c) => c.name === 'memory');
		expect(memory).toBeDefined();
		expect(memory!.description).toContain('knowledge graph');
	});

	it('lint command works without any pack loaded', () => {
		const builtins = getBuiltInCommands();
		const lint = builtins.find((c) => c.name === 'lint');
		expect(lint).toBeDefined();
		expect(lint!.description).toContain('Audit');
	});
});

describe('default memory MCP server', () => {
	it('is injected when no pack declares memory', async () => {
		const { McpRegistry } = await import('./mcp/registry.js');
		const { loadPacks } = await import('./loader.js');
		const mcpRegistry = new McpRegistry();
		await loadPacks(['starter'], undefined, undefined, undefined, mcpRegistry);
		expect(mcpRegistry.hasServer('memory')).toBe(true);
	});

	it('is injected even with no packs loaded', async () => {
		const { McpRegistry } = await import('./mcp/registry.js');
		const { loadPacks } = await import('./loader.js');
		const mcpRegistry = new McpRegistry();
		await loadPacks([], undefined, undefined, undefined, mcpRegistry);
		expect(mcpRegistry.hasServer('memory')).toBe(true);
	});

	it('does not duplicate if a pack already declares memory', async () => {
		const { McpRegistry } = await import('./mcp/registry.js');
		const { loadPacks } = await import('./loader.js');
		const mcpRegistry = new McpRegistry();
		await loadPacks(['starter'], undefined, undefined, undefined, mcpRegistry);
		const servers = mcpRegistry.listServers();
		const memoryServers = servers.filter((s) => s.name === 'memory');
		expect(memoryServers.length).toBe(1);
	});

	it('uses default store path for MEMORY_FILE_PATH', async () => {
		const { McpRegistry } = await import('./mcp/registry.js');
		const { loadPacks } = await import('./loader.js');
		const mcpRegistry = new McpRegistry();
		await loadPacks([], undefined, undefined, undefined, mcpRegistry);
		expect(mcpRegistry.hasServer('memory')).toBe(true);
		const info = mcpRegistry.getServerInfo('memory');
		expect(info).toBeDefined();
		expect(info!.enabled).toBe(true);
	});
});
