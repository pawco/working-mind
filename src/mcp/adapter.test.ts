import { describe, expect, it } from 'vitest';
import { mcpToolToToolDef } from './adapter.js';

describe('mcpToolToToolDef', () => {
	it('namespaces tool name with server prefix', () => {
		const tool = mcpToolToToolDef(
			'brave-search',
			{
				name: 'brave_web_search',
				description: 'Search the web',
				inputSchema: {
					type: 'object',
					properties: { query: { type: 'string' } },
				},
			},
			null as any,
		);

		expect(tool.name).toBe('mcp__brave-search__brave_web_search');
		expect(tool.description).toBe('[brave-search] Search the web');
		expect(tool.origin).toBe('mcp');
		expect(tool.mcpServer).toBe('brave-search');
		expect(tool.longRunning).toBe(true);
	});

	it('uses tool name as fallback description', () => {
		const tool = mcpToolToToolDef(
			'test',
			{
				name: 'my_tool',
				description: '',
				inputSchema: { type: 'object' },
			},
			null as any,
		);

		expect(tool.description).toBe('[test] my_tool');
	});

	it('preserves input schema', () => {
		const schema = {
			type: 'object',
			properties: { q: { type: 'string' } },
			required: ['q'],
		};
		const tool = mcpToolToToolDef(
			'test',
			{
				name: 'tool1',
				description: 'desc',
				inputSchema: schema,
			},
			null as any,
		);

		expect(tool.parameters).toEqual(schema);
	});

	it('defaults to empty schema when no inputSchema', () => {
		const tool = mcpToolToToolDef(
			'test',
			{
				name: 'tool1',
				description: 'desc',
				inputSchema: undefined as any,
			},
			null as any,
		);

		expect(tool.parameters).toEqual({ type: 'object', properties: {} });
	});
});
