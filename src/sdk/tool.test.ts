import { describe, expect, it } from 'vitest';
import { applyToolFilter, type ToolDef, type ToolPack } from './tool.js';

const mockTool = (name: string, opts?: Partial<ToolDef>): ToolDef => ({
	name,
	description: `${name} tool`,
	parameters: { type: 'object', properties: {} },
	execute: async () => ({ ok: true }),
	...opts,
});

describe('applyToolFilter', () => {
	const tools: ToolDef[] = [
		mockTool('read', { destructive: false, longRunning: false }),
		mockTool('deploy', { destructive: false, longRunning: true }),
		mockTool('destroy', { destructive: true, longRunning: false }),
	];

	it('returns all tools with no filter', () => {
		expect(applyToolFilter(tools)).toHaveLength(3);
	});

	it('returns all tools with "all" preset', () => {
		expect(applyToolFilter(tools, { preset: 'all' })).toHaveLength(3);
	});

	it('excludes destructive and longRunning with "readonly" preset', () => {
		const result = applyToolFilter(tools, { preset: 'readonly' });
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe('read');
	});

	it('returns nothing with "none" preset', () => {
		expect(applyToolFilter(tools, { preset: 'none' })).toHaveLength(0);
	});

	it('filters by include list', () => {
		const result = applyToolFilter(tools, { include: ['read', 'deploy'] });
		expect(result).toHaveLength(2);
		expect(result.map((t) => t.name)).toEqual(['read', 'deploy']);
	});

	it('filters by exclude list', () => {
		const result = applyToolFilter(tools, { exclude: ['destroy'] });
		expect(result).toHaveLength(2);
		expect(result.map((t) => t.name)).toEqual(['read', 'deploy']);
	});

	it('merges readonly preset with include override', () => {
		const result = applyToolFilter(tools, {
			preset: 'readonly',
			include: ['read', 'deploy'],
		});
		expect(result.map((t) => t.name)).toEqual(['read', 'deploy']);
	});

	it('merges readonly preset with include wildcard override', () => {
		const allTools: ToolDef[] = [
			mockTool('mcp__memory__search_nodes', {
				destructive: false,
				longRunning: false,
			}),
			mockTool('mcp__memory__create_entities', {
				destructive: true,
				longRunning: false,
			}),
			mockTool('mcp__memory__add_observations', {
				destructive: true,
				longRunning: false,
			}),
			mockTool('mcp__brave__search', {
				destructive: false,
				longRunning: false,
			}),
			mockTool('read', { destructive: false, longRunning: false }),
			mockTool('destroy', { destructive: true, longRunning: false }),
		];
		const result = applyToolFilter(allTools, {
			preset: 'readonly',
			include: ['mcp__memory__*'],
		});
		const names = result.map((t) => t.name);
		expect(names).toContain('mcp__memory__search_nodes');
		expect(names).toContain('mcp__memory__create_entities');
		expect(names).toContain('mcp__memory__add_observations');
		expect(names).toContain('mcp__brave__search');
		expect(names).toContain('read');
		expect(names).not.toContain('destroy');
	});

	it('merges none preset with include override (include wins)', () => {
		const result = applyToolFilter(tools, {
			preset: 'none',
			include: ['read'],
		});
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe('read');
	});

	it('merges readonly preset with exclude override (union of excludes)', () => {
		const result = applyToolFilter(tools, {
			preset: 'readonly',
			exclude: ['read'],
		});
		expect(result).toHaveLength(0);
	});
});

describe('ToolPack interface', () => {
	it('a minimal pack satisfies the interface', () => {
		const pack: ToolPack = {
			name: 'test-pack',
			version: '1.0.0',
			description: 'A test pack',
			tools: [mockTool('greet')],
		};
		expect(pack.name).toBe('test-pack');
		expect(pack.tools).toHaveLength(1);
	});

	it('a pack with personas satisfies the interface', () => {
		const pack: ToolPack = {
			name: 'test-pack',
			version: '1.0.0',
			description: 'A test pack',
			tools: [mockTool('greet')],
			personas: {
				friendly: { prompt: 'Be friendly', toolFilter: { preset: 'all' } },
			},
		};
		expect(pack.personas?.friendly.prompt).toBe('Be friendly');
	});
});

describe('toolDefToOpenAIFormat / toolDefToAnthropicFormat', () => {
	it('converts to OpenAI function calling format', async () => {
		const { toolDefToOpenAIFormat } = await import('./tool.js');
		const tool = mockTool('greet');
		const fmt = toolDefToOpenAIFormat(tool);
		expect(fmt).toEqual({
			type: 'function',
			function: {
				name: 'greet',
				description: 'greet tool',
				parameters: { type: 'object', properties: {} },
			},
		});
	});

	it('converts to Anthropic tool format', async () => {
		const { toolDefToAnthropicFormat } = await import('./tool.js');
		const tool = mockTool('greet');
		const fmt = toolDefToAnthropicFormat(tool);
		expect(fmt).toEqual({
			name: 'greet',
			description: 'greet tool',
			input_schema: { type: 'object', properties: {} },
		});
	});
});
