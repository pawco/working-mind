import { describe, expect, it } from 'vitest';
import { type AgentInstance, AgentRegistry, type McpToolProvider } from './registry.js';
import type { ToolDef, ToolPack } from './sdk/tool.js';

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
		expect(agent.systemPrompt).toContain('Read-only mode');
		expect(agent.tools).toHaveLength(1);
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
		expect(agent.systemPrompt).toContain('Think only');
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

describe('replaceAvailableTools in createAgent', () => {
	it('replaces {{AVAILABLE_TOOLS}} in system prompt at creation time', () => {
		const registry = new AgentRegistry();
		registry.setPacks([mockPack]);
		const agent = registry.createAgent({
			name: 'ToolCheck',
			model: 'openai/gpt-4o',
			systemPromptOverride: 'My agent {{AVAILABLE_TOOLS}} end',
		});
		expect(agent.systemPrompt).not.toContain('{{AVAILABLE_TOOLS}}');
		expect(agent.systemPrompt).toContain('- read');
		expect(agent.systemPrompt).toContain('- write');
	});

	it('shows reasoning-only mode when no tools available and prompt has placeholder', () => {
		const registry = new AgentRegistry();
		registry.setPacks([
			{
				...mockPack,
				tools: [],
			},
		]);
		const agent = registry.createAgent({
			name: 'NoTools',
			model: 'openai/gpt-4o',
			systemPromptOverride: 'My agent with {{AVAILABLE_TOOLS}} here',
		});
		expect(agent.systemPrompt).not.toContain('{{AVAILABLE_TOOLS}}');
		expect(agent.systemPrompt).toContain('reasoning-only');
	});

	it('no placeholder means no tool list section in default prompt', () => {
		const registry = new AgentRegistry();
		const agent = registry.createAgent({
			name: 'NoPlace',
			model: 'openai/gpt-4o',
		});
		expect(agent.systemPrompt).not.toContain('{{AVAILABLE_TOOLS}}');
		expect(agent.systemPrompt).toContain('reasoning agent');
	});

	it('replaces tools in systemPromptOverride path', () => {
		const registry = new AgentRegistry();
		registry.setPacks([mockPack]);
		const agent = registry.createAgent({
			name: 'Override',
			model: 'openai/gpt-4o',
			systemPromptOverride: 'Custom prompt with {{AVAILABLE_TOOLS}} at end.',
		});
		expect(agent.systemPrompt).not.toContain('{{AVAILABLE_TOOLS}}');
		expect(agent.systemPrompt).toContain('- read');
		expect(agent.systemPrompt).toContain('- write');
	});
});

describe('packSystemPrompt on AgentInstance', () => {
	it('stores systemPromptOverride as packSystemPrompt', () => {
		const registry = new AgentRegistry();
		registry.setPacks([mockPack]);
		const agent = registry.createAgent({
			name: 'PackPrompt',
			model: 'openai/gpt-4o',
			systemPromptOverride: 'My pack prompt',
		});
		expect(agent.packSystemPrompt).toBe('My pack prompt');
	});

	it('packSystemPrompt is undefined when no override', () => {
		const registry = new AgentRegistry();
		registry.setPacks([mockPack]);
		const agent = registry.createAgent({
			name: 'NoOverride',
			model: 'openai/gpt-4o',
		});
		expect(agent.packSystemPrompt).toBeUndefined();
	});

	it('rebuildSystemPrompt uses packSystemPrompt instead of default fallback', () => {
		const registry = new AgentRegistry();
		registry.setPacks([mockPack]);
		const _agent = registry.createAgent({
			name: 'Rebuild',
			model: 'openai/gpt-4o',
			systemPromptOverride: 'My custom pack prompt {{AVAILABLE_TOOLS}}',
		});
		registry.setPersona('viewer');
		const after = registry.getActive() as AgentInstance;
		expect(after.systemPrompt).toContain('My custom pack prompt');
		expect(after.systemPrompt).not.toContain('{{AVAILABLE_TOOLS}}');
		expect(after.systemPrompt).toContain('- read');
	});
});

describe('replaceAvailableTools in setCustomPrompt', () => {
	it('replaces {{AVAILABLE_TOOLS}} after setting custom prompt', () => {
		const registry = new AgentRegistry();
		registry.setPacks([mockPack]);
		registry.createAgent({ name: 'Custom', model: 'openai/gpt-4o' });
		registry.setCustomPrompt('My custom prompt with {{AVAILABLE_TOOLS}}');
		const agent = registry.getActive() as AgentInstance;
		expect(agent.systemPrompt).not.toContain('{{AVAILABLE_TOOLS}}');
		expect(agent.systemPrompt).toContain('- read');
		expect(agent.systemPrompt).toContain('- write');
	});

	it('shows built-in tools in custom prompt when no pack tools', () => {
		const registry = new AgentRegistry();
		registry.createAgent({ name: 'CustomEmpty', model: 'openai/gpt-4o' });
		registry.setCustomPrompt('My prompt with {{AVAILABLE_TOOLS}} here');
		const agent = registry.getActive() as AgentInstance;
		expect(agent.systemPrompt).not.toContain('{{AVAILABLE_TOOLS}}');
		expect(agent.systemPrompt).toContain('reasoning-only');
	});
});

describe('replaceAvailableTools in rebuildSystemPrompt', () => {
	it('replaces {{AVAILABLE_TOOLS}} after persona change when pack prompt has placeholder', () => {
		const packWithPlaceholder: ToolPack = {
			...mockPack,
			personas: {
				viewer: {
					prompt: 'Viewer mode {{AVAILABLE_TOOLS}}',
					toolFilter: { preset: 'readonly' },
				},
			},
		};
		const registry = new AgentRegistry();
		registry.setPacks([packWithPlaceholder]);
		registry.createAgent({ name: 'Persona', model: 'openai/gpt-4o' });
		registry.setPersona('viewer');
		const agent = registry.getActive() as AgentInstance;
		expect(agent.systemPrompt).not.toContain('{{AVAILABLE_TOOLS}}');
		expect(agent.systemPrompt).toContain('- read');
	});

	it('no placeholder in persona prompt means no tool list injected', () => {
		const registry = new AgentRegistry();
		registry.setPacks([mockPack]);
		registry.createAgent({ name: 'NoPlace', model: 'openai/gpt-4o' });
		registry.setPersona('viewer');
		const agent = registry.getActive() as AgentInstance;
		expect(agent.systemPrompt).not.toContain('{{AVAILABLE_TOOLS}}');
		expect(agent.systemPrompt).toContain('Read-only mode');
	});

	it('replaces {{AVAILABLE_TOOLS}} after skill activation', () => {
		const registry = new AgentRegistry();
		registry.setPacks([mockPack]);
		registry.createAgent({ name: 'Skill', model: 'openai/gpt-4o' });
		const agent = registry.getActive() as AgentInstance;
		expect(agent.systemPrompt).not.toContain('{{AVAILABLE_TOOLS}}');
	});
});

describe('getFilteredMcpTools with mcpServers on ToolPack', () => {
	function makeMcpTool(serverName: string, toolName: string): ToolDef {
		return {
			name: `mcp__${serverName}__${toolName}`,
			description: `${toolName} from ${serverName}`,
			parameters: { type: 'object', properties: {} },
			execute: async () => ({}),
			origin: 'mcp',
			mcpServer: serverName,
		};
	}

	const memoryTools = [
		makeMcpTool('memory', 'search_nodes'),
		makeMcpTool('memory', 'create_entities'),
	];
	const braveTools = [makeMcpTool('brave-search', 'brave_web_search')];
	const firecrawlTools = [makeMcpTool('firecrawl', 'scrape')];
	const allMcpTools = [...memoryTools, ...braveTools, ...firecrawlTools];

	const mockMcpProvider: McpToolProvider = {
		getTools: () => allMcpTools,
	};

	const starterPack: ToolPack = {
		name: 'starter',
		version: '0.1.0',
		description: 'Starter',
		tools: [],
		mcpServers: {
			memory: {},
			'brave-search': {},
			firecrawl: {},
		},
	};

	it('includes all MCP tools from pack mcpServers when packName matches', () => {
		const registry = new AgentRegistry();
		registry.setPacks([starterPack]);
		registry.setMcpRegistry(mockMcpProvider);
		registry.createAgent({
			name: 'Starter',
			model: 'openai/gpt-4o',
			packName: 'starter',
			systemPromptOverride: 'Starter prompt {{AVAILABLE_TOOLS}}',
		});

		const agent = registry.getActive() as AgentInstance;
		expect(agent.tools).toHaveLength(4);
		expect(agent.tools.map((t) => t.name)).toContain('mcp__memory__search_nodes');
		expect(agent.tools.map((t) => t.name)).toContain('mcp__memory__create_entities');
		expect(agent.tools.map((t) => t.name)).toContain('mcp__brave-search__brave_web_search');
		expect(agent.tools.map((t) => t.name)).toContain('mcp__firecrawl__scrape');
	});

	it('system prompt lists all MCP tools from pack', () => {
		const registry = new AgentRegistry();
		registry.setPacks([starterPack]);
		registry.setMcpRegistry(mockMcpProvider);
		registry.createAgent({
			name: 'StarterPrompt',
			model: 'openai/gpt-4o',
			packName: 'starter',
			systemPromptOverride: 'Starter prompt {{AVAILABLE_TOOLS}}',
		});

		const agent = registry.getActive() as AgentInstance;
		expect(agent.systemPrompt).not.toContain('{{AVAILABLE_TOOLS}}');
		expect(agent.systemPrompt).toContain('- mcp__memory__search_nodes');
		expect(agent.systemPrompt).toContain('- mcp__brave-search__brave_web_search');
		expect(agent.systemPrompt).toContain('- mcp__firecrawl__scrape');
	});

	it('excludes MCP tools not in pack mcpServers', () => {
		const limitedPack: ToolPack = {
			name: 'limited',
			version: '0.1.0',
			description: 'Limited',
			tools: [],
			mcpServers: {
				memory: {},
			},
		};

		const registry = new AgentRegistry();
		registry.setPacks([limitedPack]);
		registry.setMcpRegistry(mockMcpProvider);
		registry.createAgent({
			name: 'Limited',
			model: 'openai/gpt-4o',
			packName: 'limited',
			systemPromptOverride: 'Limited prompt {{AVAILABLE_TOOLS}}',
		});

		const agent = registry.getActive() as AgentInstance;
		expect(agent.tools).toHaveLength(2);
		expect(agent.tools.every((t) => t.mcpServer === 'memory')).toBe(true);
		expect(agent.tools.map((t) => t.name)).not.toContain('mcp__brave-search__brave_web_search');
	});

	it('includes shared MCP tools from other packs via alwaysVisible', () => {
		const packA: ToolPack = {
			name: 'pack-a',
			version: '0.1.0',
			description: 'A',
			tools: [],
			mcpServers: { memory: {}, 'brave-search': {} },
		};
		const packB: ToolPack = {
			name: 'pack-b',
			version: '0.1.0',
			description: 'B',
			tools: [],
			mcpServers: { memory: {}, firecrawl: {} },
		};

		const registry = new AgentRegistry();
		registry.setPacks([packA, packB]);
		registry.setMcpRegistry(mockMcpProvider);
		registry.createAgent({
			name: 'AgentA',
			model: 'openai/gpt-4o',
			packName: 'pack-a',
			systemPromptOverride: 'A prompt {{AVAILABLE_TOOLS}}',
		});

		const agent = registry.getActive() as AgentInstance;
		expect(agent.tools.map((t) => t.name)).toContain('mcp__memory__search_nodes');
		expect(agent.tools.map((t) => t.name)).toContain('mcp__brave-search__brave_web_search');
		expect(agent.tools.map((t) => t.name)).not.toContain('mcp__firecrawl__scrape');
	});

	it('no packName returns all MCP tools unfiltered', () => {
		const registry = new AgentRegistry();
		registry.setPacks([starterPack]);
		registry.setMcpRegistry(mockMcpProvider);
		registry.createAgent({
			name: 'NoPack',
			model: 'openai/gpt-4o',
			systemPromptOverride: 'No pack {{AVAILABLE_TOOLS}}',
		});

		const agent = registry.getActive() as AgentInstance;
		expect(agent.tools).toHaveLength(4);
	});

	it('rebuildMcpTools updates tools and system prompt after MCP connection', () => {
		const emptyProvider: McpToolProvider = { getTools: () => [] };
		const registry = new AgentRegistry();
		registry.setPacks([starterPack]);
		registry.setMcpRegistry(emptyProvider);
		registry.createAgent({
			name: 'RebuildTest',
			model: 'openai/gpt-4o',
			packName: 'starter',
			systemPromptOverride: 'Starter {{AVAILABLE_TOOLS}} end',
		});

		let agent = registry.getActive() as AgentInstance;
		expect(agent.tools).toHaveLength(0);
		expect(agent.systemPrompt).toContain('reasoning-only');

		registry.setMcpRegistry(mockMcpProvider);
		registry.rebuildMcpTools();

		agent = registry.getActive() as AgentInstance;
		expect(agent.tools).toHaveLength(4);
		expect(agent.systemPrompt).toContain('- mcp__memory__search_nodes');
		expect(agent.systemPrompt).toContain('- mcp__brave-search__brave_web_search');
		expect(agent.systemPrompt).toContain('- mcp__firecrawl__scrape');
		expect(agent.systemPrompt).not.toContain('{{AVAILABLE_TOOLS}}');
	});

	it('pack without mcpServers field gets no MCP tools when packName is set', () => {
		const noMcpPack: ToolPack = {
			name: 'no-mcp',
			version: '0.1.0',
			description: 'No MCP',
			tools: [],
		};

		const registry = new AgentRegistry();
		registry.setPacks([noMcpPack]);
		registry.setMcpRegistry(mockMcpProvider);
		registry.createAgent({
			name: 'NoMcp',
			model: 'openai/gpt-4o',
			packName: 'no-mcp',
			systemPromptOverride: 'No MCP {{AVAILABLE_TOOLS}}',
		});

		const agent = registry.getActive() as AgentInstance;
		expect(agent.tools).toHaveLength(0);
		expect(agent.systemPrompt).toContain('reasoning-only');
	});
});
