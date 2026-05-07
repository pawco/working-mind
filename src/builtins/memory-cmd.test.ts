import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '../sdk/command.js';
import { memoryCmd } from './memory-cmd.js';

const TEST_DIR = join(homedir(), '.wmind');
const MEMORIES_DIR = join(TEST_DIR, 'memories');
const DEFAULT_MEMORY = join(TEST_DIR, 'memory.jsonl');

function makeCtx(
	args: string,
	overrides?: Partial<CommandContext>,
): CommandContext {
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
		config: {
			model: 'test',
			packs: [],
			userConfig: {},
		} as any,
		mcpRegistry: undefined,
		setHistory: () => {},
		setInput: () => {},
		exit: () => {},
		activateSkill: () => null,
		deactivateSkill: () => {},
		getUserConfig: () => ({ lastMemoryStore: 'default', providers: {} }),
		writeUserConfig: () => {},
		...overrides,
	};
}

function makeMockMcpRegistry(hasMemory = true) {
	return {
		getServerInfo: vi.fn(() =>
			hasMemory
				? {
						status: 'connected',
						name: 'memory',
						type: 'local',
						toolCount: 8,
						tools: [],
						enabled: true,
					}
				: undefined,
		),
		getTools: vi.fn(() => []),
		hasServer: vi.fn((name: string) => name === 'memory' && hasMemory),
	} as any;
}

function writeTestMemoryFile(
	path: string,
	entities: { name: string; type: string; observations?: string[] }[],
	relations?: { from: string; to: string; relationType: string }[],
) {
	const lines: string[] = [];
	for (const e of entities) {
		lines.push(
			JSON.stringify({
				type: 'entity',
				name: e.name,
				entityType: e.type,
				observations: e.observations || [],
			}),
		);
	}
	for (const r of relations || []) {
		lines.push(
			JSON.stringify({
				type: 'relation',
				from: r.from,
				to: r.to,
				relationType: r.relationType,
			}),
		);
	}
	const dir = join(path, '..');
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(path, `${lines.join('\n')}\n`, 'utf-8');
}

function cleanupTestFiles() {
	if (existsSync(DEFAULT_MEMORY)) {
		rmSync(DEFAULT_MEMORY, { force: true });
	}
	if (existsSync(MEMORIES_DIR)) {
		rmSync(MEMORIES_DIR, { recursive: true, force: true });
	}
	delete process.env.MEMORY_FILE_PATH;
}

describe('memoryCmd', () => {
	beforeEach(() => {
		cleanupTestFiles();
	});

	afterEach(() => {
		cleanupTestFiles();
	});

	describe('routing', () => {
		it('shows help when called with no args and no memory file', async () => {
			const result = await memoryCmd.handler(makeCtx(''));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('not connected');
			}
		});

		it('shows stats when called with "stats"', async () => {
			writeTestMemoryFile(DEFAULT_MEMORY, [
				{ name: 'Test', type: 'concept', observations: ['obs1'] },
			]);
			const result = await memoryCmd.handler(makeCtx('stats'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('1 entities');
			}
		});

		it('handles "save" without topic', async () => {
			const ctx = makeCtx('save', { mcpRegistry: makeMockMcpRegistry() });
			const result = await memoryCmd.handler(ctx);
			expect(result.type).toBe('trigger-agent');
		});

		it('handles "save" with topic', async () => {
			const ctx = makeCtx('save React migration', {
				mcpRegistry: makeMockMcpRegistry(),
			});
			const result = await memoryCmd.handler(ctx);
			expect(result.type).toBe('trigger-agent');
		});

		it('handles "save" with topic', async () => {
			const mockRegistry = {
				getServerInfo: vi.fn(() => ({ status: 'connected', name: 'memory' })),
				getTools: vi.fn(() => []),
			} as any;
			const ctx = makeCtx('save React migration', {
				mcpRegistry: mockRegistry,
			});
			const result = await memoryCmd.handler(ctx);
			expect(result.type).toBe('trigger-agent');
			if (result.type === 'trigger-agent') {
				expect(ctx.agent.currentTask).toContain('React migration');
			}
		});

		it('rejects save when memory not connected', async () => {
			const result = await memoryCmd.handler(makeCtx('save'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('not connected');
			}
		});

		it('handles "export" with mermaid', async () => {
			writeTestMemoryFile(DEFAULT_MEMORY, [{ name: 'Test', type: 'concept' }]);
			const result = await memoryCmd.handler(makeCtx('export mermaid'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('graph LR');
			}
		});

		it('handles "export" with dot', async () => {
			writeTestMemoryFile(DEFAULT_MEMORY, [{ name: 'Test', type: 'concept' }]);
			const result = await memoryCmd.handler(makeCtx('export dot'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('digraph');
			}
		});

		it('handles "graph" with default ascii mode', async () => {
			writeTestMemoryFile(
				DEFAULT_MEMORY,
				[
					{ name: 'A', type: 'x' },
					{ name: 'B', type: 'y' },
				],
				[{ from: 'A', to: 'B', relationType: 'rel' }],
			);
			const result = await memoryCmd.handler(makeCtx('graph'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('A --rel--> B');
			}
		});

		it('handles "graph tree"', async () => {
			writeTestMemoryFile(DEFAULT_MEMORY, [
				{ name: 'Test', type: 'concept', observations: ['obs'] },
			]);
			const result = await memoryCmd.handler(makeCtx('graph tree'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('concept');
			}
		});
	});

	describe('/memory list', () => {
		it('lists stores with default always present', async () => {
			const result = await memoryCmd.handler(makeCtx('list'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('default');
				expect(result.content).toContain('Active: default');
			}
		});

		it('lists named stores', async () => {
			if (!existsSync(MEMORIES_DIR))
				mkdirSync(MEMORIES_DIR, { recursive: true });
			writeTestMemoryFile(join(MEMORIES_DIR, 'kitchen.jsonl'), [
				{ name: 'Cabinets', type: 'item', observations: ['IKEA'] },
			]);
			const result = await memoryCmd.handler(makeCtx('list'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('kitchen');
				expect(result.content).toContain('1 entities');
			}
		});
	});

	describe('/memory use', () => {
		it('opens wizard when called without args', async () => {
			const result = await memoryCmd.handler(makeCtx('use'));
			expect(result.type).toBe('open-memory-wizard');
		});

		it('rejects invalid store names', async () => {
			const result = await memoryCmd.handler(makeCtx('use INVALID'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('lowercase');
			}
		});

		it('switches to default store with mcp registry', async () => {
			const result = await memoryCmd.handler(
				makeCtx('use default', { mcpRegistry: makeMockMcpRegistry() }),
			);
			expect(result.type).toBe('reconnect-memory-store');
			if (result.type === 'reconnect-memory-store') {
				expect(result.storeName).toBe('default');
			}
		});

		it('switches to default store without mcp registry', async () => {
			const result = await memoryCmd.handler(makeCtx('use default'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('Switched to memory store');
				expect(result.content).toContain('not connected');
			}
		});

		it('creates and switches to a new named store with mcp', async () => {
			const result = await memoryCmd.handler(
				makeCtx('use kitchen', { mcpRegistry: makeMockMcpRegistry() }),
			);
			expect(result.type).toBe('reconnect-memory-store');
			if (result.type === 'reconnect-memory-store') {
				expect(result.storeName).toBe('kitchen');
				expect(process.env.MEMORY_FILE_PATH).toContain('kitchen.jsonl');
			}
			expect(existsSync(join(MEMORIES_DIR, 'kitchen.jsonl'))).toBe(true);
		});

		it('creates and switches to a new named store without mcp', async () => {
			const result = await memoryCmd.handler(makeCtx('use kitchen'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain("Switched to memory store 'kitchen'");
				expect(result.content).toContain('not connected');
			}
			expect(existsSync(join(MEMORIES_DIR, 'kitchen.jsonl'))).toBe(true);
		});

		it('saves lastMemoryStore preference', async () => {
			const written: any[] = [];
			const ctx = makeCtx('use kitchen', {
				mcpRegistry: makeMockMcpRegistry(),
				getUserConfig: () => ({ lastMemoryStore: 'default', providers: {} }),
				writeUserConfig: (cfg: any) => {
					written.push(cfg);
				},
			});
			await memoryCmd.handler(ctx);
			expect(written.length).toBe(1);
			expect(written[0].lastMemoryStore).toBe('kitchen');
		});

		it('handles getUserConfig returning undefined', async () => {
			const ctx = makeCtx('use kitchen', {
				mcpRegistry: makeMockMcpRegistry(),
				getUserConfig: () => undefined,
				writeUserConfig: () => {},
			});
			const result = await memoryCmd.handler(ctx);
			expect(result.type).toBe('reconnect-memory-store');
		});
	});

	describe('/memory delete', () => {
		it('rejects deleting default store', async () => {
			const result = await memoryCmd.handler(makeCtx('delete default'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('Cannot delete the default store');
			}
		});

		it('shows usage when called without store name', async () => {
			const result = await memoryCmd.handler(makeCtx('delete'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('Usage');
			}
		});

		it('shows error when store does not exist', async () => {
			const result = await memoryCmd.handler(makeCtx('delete nonexistent'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('does not exist');
			}
		});

		it('deletes a named store', async () => {
			if (!existsSync(MEMORIES_DIR))
				mkdirSync(MEMORIES_DIR, { recursive: true });
			const storePath = join(MEMORIES_DIR, 'kitchen.jsonl');
			writeTestMemoryFile(storePath, [
				{ name: 'Cabinets', type: 'item', observations: ['IKEA'] },
			]);
			expect(existsSync(storePath)).toBe(true);

			const result = await memoryCmd.handler(makeCtx('delete kitchen'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('Deleted store');
				expect(result.content).toContain('kitchen');
				expect(result.content).toContain('1 entities');
			}
			expect(existsSync(storePath)).toBe(false);
		});

		it('deletes active store and reconnects to default with mcp', async () => {
			if (!existsSync(MEMORIES_DIR))
				mkdirSync(MEMORIES_DIR, { recursive: true });
			const storePath = join(MEMORIES_DIR, 'kitchen.jsonl');
			writeTestMemoryFile(storePath, [
				{ name: 'Cabinets', type: 'item', observations: ['IKEA', 'Sektion'] },
			]);

			const ctx = makeCtx('delete kitchen', {
				mcpRegistry: makeMockMcpRegistry(),
				config: {
					model: 'test',
					packs: [],
					userConfig: { lastMemoryStore: 'kitchen', providers: {} },
				} as any,
				getUserConfig: () => ({ lastMemoryStore: 'kitchen', providers: {} }),
				writeUserConfig: () => {},
			});

			const result = await memoryCmd.handler(ctx);
			expect(result.type).toBe('reconnect-memory-store');
			if (result.type === 'reconnect-memory-store') {
				expect(result.storeName).toBe('default');
				expect(result.deletedStore).toBe('kitchen');
				expect(result.deletedEntityCount).toBe(1);
				expect(result.deletedObsCount).toBe(2);
			}
			expect(existsSync(storePath)).toBe(false);
			expect(process.env.MEMORY_FILE_PATH).toContain('memory.jsonl');
		});

		it('deletes active store without mcp returns message', async () => {
			if (!existsSync(MEMORIES_DIR))
				mkdirSync(MEMORIES_DIR, { recursive: true });
			const storePath = join(MEMORIES_DIR, 'bathroom.jsonl');
			writeTestMemoryFile(storePath, [
				{ name: 'Tiles', type: 'item', observations: ['ceramic'] },
			]);

			const ctx = makeCtx('delete bathroom', {
				config: {
					model: 'test',
					packs: [],
					userConfig: { lastMemoryStore: 'bathroom', providers: {} },
				} as any,
				getUserConfig: () => ({ lastMemoryStore: 'bathroom', providers: {} }),
				writeUserConfig: () => {},
			});

			const result = await memoryCmd.handler(ctx);
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('Deleted store');
				expect(result.content).toContain('not connected');
			}
			expect(existsSync(storePath)).toBe(false);
		});

		it('handles delete with empty store', async () => {
			if (!existsSync(MEMORIES_DIR))
				mkdirSync(MEMORIES_DIR, { recursive: true });
			const storePath = join(MEMORIES_DIR, 'empty-store.jsonl');
			writeFileSync(storePath, '', 'utf-8');

			const result = await memoryCmd.handler(makeCtx('delete empty-store'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('Deleted store');
				expect(result.content).toContain('0 entities');
			}
			expect(existsSync(storePath)).toBe(false);
		});
	});

	describe('/memory rename', () => {
		it('shows usage without two args', async () => {
			const result = await memoryCmd.handler(makeCtx('rename kitchen'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('Usage');
			}
		});

		it('rejects invalid new name', async () => {
			const result = await memoryCmd.handler(makeCtx('rename kitchen INVALID'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('lowercase');
			}
		});

		it('shows error when old store does not exist', async () => {
			const result = await memoryCmd.handler(
				makeCtx('rename nonexistent newname'),
			);
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('does not exist');
			}
		});

		it('shows error when new name already exists', async () => {
			if (!existsSync(MEMORIES_DIR))
				mkdirSync(MEMORIES_DIR, { recursive: true });
			writeTestMemoryFile(join(MEMORIES_DIR, 'old.jsonl'), [
				{ name: 'A', type: 'x' },
			]);
			writeTestMemoryFile(join(MEMORIES_DIR, 'taken.jsonl'), [
				{ name: 'B', type: 'y' },
			]);

			const result = await memoryCmd.handler(makeCtx('rename old taken'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('already exists');
			}
		});

		it('renames a store', async () => {
			if (!existsSync(MEMORIES_DIR))
				mkdirSync(MEMORIES_DIR, { recursive: true });
			writeTestMemoryFile(join(MEMORIES_DIR, 'old.jsonl'), [
				{ name: 'A', type: 'x' },
			]);

			const result = await memoryCmd.handler(makeCtx('rename old new-name'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain("Renamed store 'old' to 'new-name'");
			}
			expect(existsSync(join(MEMORIES_DIR, 'old.jsonl'))).toBe(false);
			expect(existsSync(join(MEMORIES_DIR, 'new-name.jsonl'))).toBe(true);
		});

		it('renames the active store and reconnects with mcp', async () => {
			if (!existsSync(MEMORIES_DIR))
				mkdirSync(MEMORIES_DIR, { recursive: true });
			writeTestMemoryFile(join(MEMORIES_DIR, 'kitchen.jsonl'), [
				{ name: 'A', type: 'x' },
			]);

			const ctx = makeCtx('rename kitchen home-renovation', {
				mcpRegistry: makeMockMcpRegistry(),
				config: {
					model: 'test',
					packs: [],
					userConfig: { lastMemoryStore: 'kitchen', providers: {} },
				} as any,
				getUserConfig: () => ({ lastMemoryStore: 'kitchen', providers: {} }),
				writeUserConfig: () => {},
			});

			const result = await memoryCmd.handler(ctx);
			expect(result.type).toBe('reconnect-memory-store');
			if (result.type === 'reconnect-memory-store') {
				expect(result.storeName).toBe('home-renovation');
			}
		});

		it('renames the active store without mcp returns message', async () => {
			if (!existsSync(MEMORIES_DIR))
				mkdirSync(MEMORIES_DIR, { recursive: true });
			writeTestMemoryFile(join(MEMORIES_DIR, 'garage.jsonl'), [
				{ name: 'A', type: 'x' },
			]);

			const ctx = makeCtx('rename garage workshop', {
				config: {
					model: 'test',
					packs: [],
					userConfig: { lastMemoryStore: 'garage', providers: {} },
				} as any,
				getUserConfig: () => ({ lastMemoryStore: 'garage', providers: {} }),
				writeUserConfig: () => {},
			});

			const result = await memoryCmd.handler(ctx);
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('Renamed store');
				expect(result.content).toContain('not connected');
			}
		});
	});

	describe('/memory copy', () => {
		it('shows usage without two args', async () => {
			const result = await memoryCmd.handler(makeCtx('copy kitchen'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('Usage');
			}
		});

		it('shows error when source does not exist', async () => {
			const result = await memoryCmd.handler(
				makeCtx('copy nonexistent default'),
			);
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('does not exist');
			}
		});

		it('copies to a new store', async () => {
			if (!existsSync(MEMORIES_DIR))
				mkdirSync(MEMORIES_DIR, { recursive: true });
			writeTestMemoryFile(join(MEMORIES_DIR, 'source.jsonl'), [
				{ name: 'A', type: 'x', observations: ['obs1'] },
			]);

			const result = await memoryCmd.handler(makeCtx('copy source dest'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('Copied 1 entities');
				expect(result.content).toContain("'source' to 'dest'");
			}
			expect(existsSync(join(MEMORIES_DIR, 'dest.jsonl'))).toBe(true);
			const destContent = readFileSync(
				join(MEMORIES_DIR, 'dest.jsonl'),
				'utf-8',
			);
			expect(destContent).toContain('"A"');
		});

		it('merges into existing store skipping duplicates', async () => {
			if (!existsSync(MEMORIES_DIR))
				mkdirSync(MEMORIES_DIR, { recursive: true });
			writeTestMemoryFile(join(MEMORIES_DIR, 'from.jsonl'), [
				{ name: 'A', type: 'x' },
				{ name: 'B', type: 'y' },
			]);
			writeTestMemoryFile(join(MEMORIES_DIR, 'to.jsonl'), [
				{ name: 'A', type: 'x' },
			]);

			const result = await memoryCmd.handler(makeCtx('copy from to'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('Copied 1 entities');
				expect(result.content).toContain('1 already existed');
			}
		});

		it('copies from default store', async () => {
			writeTestMemoryFile(DEFAULT_MEMORY, [{ name: 'X', type: 'z' }]);
			const result = await memoryCmd.handler(makeCtx('copy default backup'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('Copied 1 entities');
			}
		});
	});

	describe('/memory search-all', () => {
		it('shows usage without query', async () => {
			const result = await memoryCmd.handler(makeCtx('search-all'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('Usage');
			}
		});

		it('searches across stores', async () => {
			writeTestMemoryFile(DEFAULT_MEMORY, [
				{ name: 'Svelte', type: 'technology', observations: ['compiler'] },
			]);
			if (!existsSync(MEMORIES_DIR))
				mkdirSync(MEMORIES_DIR, { recursive: true });
			writeTestMemoryFile(join(MEMORIES_DIR, 'work.jsonl'), [
				{
					name: 'Kubernetes',
					type: 'technology',
					observations: ['container orchestration'],
				},
			]);

			const result = await memoryCmd.handler(makeCtx('search-all Svelte'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('default: 1 match');
				expect(result.content).toContain('work: 0 matches');
			}
		});
	});

	describe('edge cases', () => {
		it('handles unknown subcommand', async () => {
			const result = await memoryCmd.handler(makeCtx('unknown'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('Usage');
			}
		});

		it('export shows empty message when no data', async () => {
			const result = await memoryCmd.handler(makeCtx('export mermaid'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('not connected');
			}
		});

		it('graph shows empty message when no data', async () => {
			const result = await memoryCmd.handler(makeCtx('graph'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('not connected');
			}
		});

		it('export writes to file with --file flag', async () => {
			writeTestMemoryFile(DEFAULT_MEMORY, [{ name: 'Test', type: 'concept' }]);
			const _exportDir = join(homedir(), '.wmind', 'exports');
			const result = await memoryCmd.handler(
				makeCtx('export mermaid --file test-graph.mmd'),
			);
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('Exported mermaid');
			}
		});

		it('graph filters by entity name', async () => {
			writeTestMemoryFile(
				DEFAULT_MEMORY,
				[
					{ name: 'Svelte', type: 'technology' },
					{ name: 'React', type: 'technology' },
				],
				[{ from: 'Svelte', to: 'React', relationType: 'competes_with' }],
			);
			const result = await memoryCmd.handler(makeCtx('graph Svelte'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('Svelte');
			}
		});

		it('use with hyphenated name works', async () => {
			const result = await memoryCmd.handler(
				makeCtx('use cloud-infra', { mcpRegistry: makeMockMcpRegistry() }),
			);
			expect(result.type).toBe('reconnect-memory-store');
			if (result.type === 'reconnect-memory-store') {
				expect(result.storeName).toBe('cloud-infra');
			}
		});

		it('use with underscored name works', async () => {
			const result = await memoryCmd.handler(
				makeCtx('use my_project', { mcpRegistry: makeMockMcpRegistry() }),
			);
			expect(result.type).toBe('reconnect-memory-store');
			if (result.type === 'reconnect-memory-store') {
				expect(result.storeName).toBe('my_project');
			}
		});

		it('use rejects names starting with digit', async () => {
			const result = await memoryCmd.handler(makeCtx('use 123abc'));
			expect(result.type).toBe('message');
			if (result.type === 'message') {
				expect(result.content).toContain('lowercase');
			}
		});

		it('use rejects empty string after trim', async () => {
			const result = await memoryCmd.handler(makeCtx('use '));
			expect(result.type).toBe('open-memory-wizard');
		});
	});
});
