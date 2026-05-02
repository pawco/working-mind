import { describe, expect, it } from 'vitest';
import { AgentRegistry } from './registry.js';
import type { ToolPack } from './sdk/tool.js';

const mockPack: ToolPack = {
	name: 'test-pack',
	version: '1.0.0',
	description: 'Test',
	tools: [
		{
			name: 'read',
			description: 'Read',
			parameters: { type: 'object', properties: {} },
			execute: async () => ({}),
		},
		{
			name: 'write',
			description: 'Write',
			parameters: { type: 'object', properties: {} },
			execute: async () => ({}),
			destructive: true,
		},
	],
	personas: {
		viewer: { prompt: 'Read-only mode', toolFilter: { preset: 'readonly' } },
		planner: { prompt: 'Think only', toolFilter: { preset: 'none' } },
	},
};

describe('AgentRegistry', () => {
	it('creates agents with tools from loaded packs', () => {
		const registry = new AgentRegistry();
		registry.setPacks([mockPack]);
		const agent = registry.createAgent({
			name: 'Test',
			model: 'openai/gpt-4o',
		});
		expect(agent.tools).toHaveLength(2);
		expect(agent.name).toBe('Test');
	});

	it('resolves persona from packs', () => {
		const registry = new AgentRegistry();
		registry.setPacks([mockPack]);
		const agent = registry.createAgent({
			name: 'Viewer',
			persona: 'viewer',
			model: 'openai/gpt-4o',
		});
		expect(agent.systemPrompt).toBe('Read-only mode');
		expect(agent.tools).toHaveLength(1); // readonly filter excludes destructive
		expect(agent.tools[0].name).toBe('read');
	});

	it('planner persona gets no tools', () => {
		const registry = new AgentRegistry();
		registry.setPacks([mockPack]);
		const agent = registry.createAgent({
			name: 'Planner',
			persona: 'planner',
			model: 'openai/gpt-4o',
		});
		expect(agent.systemPrompt).toBe('Think only');
		expect(agent.tools).toHaveLength(0);
	});

	it('switches between agents', () => {
		const registry = new AgentRegistry();
		registry.setPacks([mockPack]);
		registry.createAgent({ name: 'A1', model: 'openai/gpt-4o' });
		registry.createAgent({ name: 'A2', model: 'openai/gpt-4o' });
		const first = registry.getActive();
		expect(first?.name).toBe('A1');
		const next = registry.switchNext();
		expect(next?.name).toBe('A2');
		const back = registry.switchNext();
		expect(back?.name).toBe('A1');
	});

	it('switches to specific agent', () => {
		const registry = new AgentRegistry();
		registry.setPacks([mockPack]);
		registry.createAgent({ name: 'A1', model: 'openai/gpt-4o' });
		registry.createAgent({ name: 'A2', model: 'openai/gpt-4o' });
		const target = registry.switchTo('a2');
		expect(target?.name).toBe('A2');
		expect(registry.getActive()?.name).toBe('A2');
	});

	it('removes an agent', () => {
		const registry = new AgentRegistry();
		registry.setPacks([mockPack]);
		registry.createAgent({ name: 'A1', model: 'openai/gpt-4o' });
		expect(registry.getCount()).toBe(1);
		registry.remove('a1');
		expect(registry.getCount()).toBe(0);
	});

	it('no packs = no tools = reasoning-only mode', () => {
		const registry = new AgentRegistry();
		const agent = registry.createAgent({
			name: 'Thinker',
			model: 'openai/gpt-4o',
		});
		expect(agent.tools).toHaveLength(0);
		expect(agent.systemPrompt).toContain('reasoning agent');
	});
});
