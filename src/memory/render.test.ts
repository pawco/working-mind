import { describe, expect, it } from 'vitest';
import {
	filterGraph,
	formatStoreList,
	getActiveStoreName,
	listMemoryStores,
	parseMemoryJsonl,
	searchAcrossStores,
	toAsciiGraph,
	toDot,
	toMermaid,
	toStats,
	toTreeView,
	type MemoryStoreInfo,
} from './render.js';
import type { MemoryGraph } from './render.js';

const sampleJsonl = [
	'{"type":"entity","name":"Svelte","entityType":"technology","observations":["compiler-based","runes in v5"]}',
	'{"type":"entity","name":"React","entityType":"technology","observations":["current stack","virtual DOM"]}',
	'{"type":"entity","name":"Vue","entityType":"technology","observations":["composition API"]}',
	'{"type":"entity","name":"Alex","entityType":"person","observations":["prefers TypeScript"]}',
	'{"type":"relation","from":"Svelte","to":"React","relationType":"competes_with"}',
	'{"type":"relation","from":"Alex","to":"React","relationType":"maintains"}',
].join('\n');

const sampleGraph: MemoryGraph = {
	entities: [
		{
			name: 'Svelte',
			entityType: 'technology',
			observations: ['compiler-based', 'runes in v5'],
		},
		{
			name: 'React',
			entityType: 'technology',
			observations: ['current stack', 'virtual DOM'],
		},
		{
			name: 'Vue',
			entityType: 'technology',
			observations: ['composition API'],
		},
		{ name: 'Alex', entityType: 'person', observations: ['prefers TypeScript'] },
	],
	relations: [
		{ from: 'Svelte', to: 'React', relationType: 'competes_with' },
		{ from: 'Alex', to: 'React', relationType: 'maintains' },
	],
};

describe('parseMemoryJsonl', () => {
	it('parses valid JSONL', () => {
		const graph = parseMemoryJsonl(sampleJsonl);
		expect(graph.entities).toHaveLength(4);
		expect(graph.relations).toHaveLength(2);
		expect(graph.entities[0].name).toBe('Svelte');
		expect(graph.entities[0].observations).toEqual([
			'compiler-based',
			'runes in v5',
		]);
		expect(graph.relations[0].relationType).toBe('competes_with');
	});

	it('skips malformed lines', () => {
		const input = sampleJsonl + '\nnot-json\n{"type":"entity"';
		const graph = parseMemoryJsonl(input);
		expect(graph.entities).toHaveLength(4);
		expect(graph.relations).toHaveLength(2);
	});

	it('handles empty input', () => {
		const graph = parseMemoryJsonl('');
		expect(graph.entities).toHaveLength(0);
		expect(graph.relations).toHaveLength(0);
	});
});

describe('filterGraph', () => {
	it('returns full graph with no query', () => {
		const result = filterGraph(sampleGraph);
		expect(result.entities).toHaveLength(4);
	});

	it('filters by entity name', () => {
		const result = filterGraph(sampleGraph, 'Svelte', 1);
		expect(result.entities.length).toBeGreaterThanOrEqual(1);
		const names = result.entities.map((e) => e.name);
		expect(names).toContain('Svelte');
		expect(names).toContain('React');
	});

	it('filters by entity type', () => {
		const result = filterGraph(sampleGraph, 'person', 1);
		const names = result.entities.map((e) => e.name);
		expect(names).toContain('Alex');
		expect(names).toContain('React');
	});

	it('returns empty for no match', () => {
		const result = filterGraph(sampleGraph, 'nonexistent');
		expect(result.entities).toHaveLength(0);
	});

	it('respects depth=0 (seed only)', () => {
		const result = filterGraph(sampleGraph, 'Svelte', 0);
		expect(result.entities).toHaveLength(1);
		expect(result.entities[0].name).toBe('Svelte');
	});

	it('expands with depth=2', () => {
		const result = filterGraph(sampleGraph, 'Alex', 2);
		const names = result.entities.map((e) => e.name);
		expect(names).toContain('Alex');
		expect(names).toContain('React');
		expect(names).toContain('Svelte');
	});
});

describe('toMermaid', () => {
	it('produces valid mermaid syntax', () => {
		const result = toMermaid(sampleGraph);
		expect(result).toContain('graph LR');
		expect(result).toContain('Svelte');
		expect(result).toContain('competes_with');
	});

	it('handles empty graph', () => {
		const result = toMermaid({ entities: [], relations: [] });
		expect(result).toContain('empty');
	});

	it('sanitizes entity names with special chars', () => {
		const graph: MemoryGraph = {
			entities: [
				{ name: 'my-project', entityType: 'project', observations: [] },
			],
			relations: [],
		};
		const result = toMermaid(graph);
		expect(result).toContain('my_project');
	});
});

describe('toDot', () => {
	it('produces valid DOT syntax', () => {
		const result = toDot(sampleGraph);
		expect(result).toContain('digraph knowledge_graph');
		expect(result).toContain('"Svelte"');
		expect(result).toContain('competes_with');
	});

	it('handles empty graph', () => {
		const result = toDot({ entities: [], relations: [] });
		expect(result).toContain('empty');
	});

	it('escapes double quotes in names', () => {
		const graph: MemoryGraph = {
			entities: [
				{ name: 'say "hello"', entityType: 'phrase', observations: [] },
			],
			relations: [],
		};
		const result = toDot(graph);
		expect(result).not.toMatch(/(?<!\\)"hello"/);
	});
});

describe('toAsciiGraph', () => {
	it('renders relations and isolated entities', () => {
		const result = toAsciiGraph(sampleGraph);
		expect(result).toContain('Svelte --competes_with--> React');
		expect(result).toContain('Vue [technology]');
	});

	it('handles empty graph', () => {
		const result = toAsciiGraph({ entities: [], relations: [] });
		expect(result).toContain('Empty');
	});
});

describe('toTreeView', () => {
	it('groups by entity type', () => {
		const result = toTreeView(sampleGraph);
		expect(result).toContain('technology');
		expect(result).toContain('person');
		expect(result).toContain('Svelte');
		expect(result).toContain('Alex');
	});

	it('shows observations', () => {
		const result = toTreeView(sampleGraph);
		expect(result).toContain('compiler-based');
		expect(result).toContain('prefers TypeScript');
	});

	it('shows relations', () => {
		const result = toTreeView(sampleGraph);
		expect(result).toContain('competes_with');
		expect(result).toContain('React');
		expect(result).toContain('maintains');
	});

	it('handles empty graph', () => {
		const result = toTreeView({ entities: [], relations: [] });
		expect(result).toContain('Empty');
	});

	it('shows no-details for entities without info', () => {
		const graph: MemoryGraph = {
			entities: [{ name: 'X', entityType: 'thing', observations: [] }],
			relations: [],
		};
		const result = toTreeView(graph);
		expect(result).toContain('no details');
	});
});

describe('toStats', () => {
	it('reports counts', () => {
		const result = toStats(sampleGraph);
		expect(result).toContain('4 entities');
		expect(result).toContain('2 relations');
		expect(result).toContain('6 observations');
		expect(result).toContain('technology: 3');
		expect(result).toContain('person: 1');
	})

	it('reports isolated entities', () => {
		const result = toStats(sampleGraph);
		expect(result).toContain('1 isolated');
	})

	it('handles empty graph', () => {
		const result = toStats({ entities: [], relations: [] });
		expect(result).toContain('empty');
	})
})

describe('getActiveStoreName', () => {
	it('returns "default" when no config provided', () => {
		expect(getActiveStoreName()).toBe('default');
	})

	it('returns "default" when config has no lastMemoryStore', () => {
		expect(getActiveStoreName({})).toBe('default');
	})

	it('returns the configured store name', () => {
		expect(getActiveStoreName({ lastMemoryStore: 'kitchen' })).toBe('kitchen');
	})
})

describe('searchAcrossStores', () => {
	it('returns zero matches for stores with no entities', () => {
		const results = searchAcrossStores('nonexistent-xyz');
		for (const r of results) {
			expect(r.matches).toBe(0);
		}
	})
})

describe('formatStoreList', () => {
	it('formats stores with active marker', () => {
		const stores: MemoryStoreInfo[] = [
			{ name: 'default', path: '/tmp/default.jsonl', entityCount: 12, relationCount: 5, observationCount: 32, exists: true },
			{ name: 'kitchen', path: '/tmp/kitchen.jsonl', entityCount: 0, relationCount: 0, observationCount: 0, exists: false },
		];
		const result = formatStoreList(stores, 'default');
		expect(result).toContain('Memory Stores:');
		expect(result).toContain('● default');
		expect(result).toContain('○ kitchen');
		expect(result).toContain('12 entities');
		expect(result).toContain('Active: default');
	})

	it('formats empty stores', () => {
		const stores: MemoryStoreInfo[] = [
			{ name: 'default', path: '/tmp/default.jsonl', entityCount: 0, relationCount: 0, observationCount: 0, exists: true },
		];
		const result = formatStoreList(stores, 'default');
		expect(result).toContain('(empty)');
	})
})

describe('listMemoryStores', () => {
	it('always includes the default store', () => {
		const stores = listMemoryStores();
		const defaultStore = stores.find((s) => s.name === 'default');
		expect(defaultStore).toBeDefined();
	})
})
