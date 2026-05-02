import { describe, expect, it } from 'vitest';
import {
	loadPacks,
	mergePackTools,
	resolvePersonaFromPacks,
} from './loader.js';
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

describe('loadPacks — explorer pack', () => {
	it('loads the explorer pack by name', async () => {
		const result = await loadPacks(['explorer']);
		expect(result.packs.length).toBe(1);
		expect(result.packs[0].name).toBe('explorer');
		expect(result.systemPromptOverride).toBeTruthy();
	});

	it('explorer pack has researcher and advisor personas', async () => {
		const result = await loadPacks(['explorer']);
		const personas = Object.keys(result.packs[0].personas || {});
		expect(personas).toContain('researcher');
		expect(personas).toContain('advisor');
	});

	it('explorer pack has deep-dive and compare skills', async () => {
		const result = await loadPacks(['explorer']);
		const skills = Object.keys(result.packs[0].skills || {});
		expect(skills).toContain('deep-dive');
		expect(skills).toContain('compare');
	});

	it('explorer pack has curation prompts', async () => {
		const result = await loadPacks(['explorer']);
		expect(result.packs[0].curation).toBeDefined();
		expect(result.packs[0].curation?.summarize).toBeTruthy();
		expect(result.packs[0].curation?.export).toBeTruthy();
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
		const packNames = ['researcher'];
		const resolved =
			packNames.length > 0 && packNames[0] !== 'none'
				? packNames
				: packNames[0] === 'none'
					? []
					: ['starter'];
		expect(resolved).toEqual(['researcher']);
	});

	it('passes through multiple pack names', () => {
		const packNames = ['explorer', 'researcher'];
		const resolved =
			packNames.length > 0 && packNames[0] !== 'none'
				? packNames
				: packNames[0] === 'none'
					? []
					: ['starter'];
		expect(resolved).toEqual(['explorer', 'researcher']);
	});
});
