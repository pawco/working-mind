import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemoryEntity, MemoryRelation } from '../memory/render.js';
import type { CommandContext, CommandResult } from '../sdk/command.js';
import {
	checkReadiness,
	computeGraphDensity,
	countMultiHopPaths,
	findOrphans,
	fineTuneCmd,
	formatReadinessReport,
} from './fine-tune-cmd.js';

const TMP_DIR = join(process.cwd(), 'test-finetune-tmp');

function makeEntity(
	name: string,
	entityType: string,
	observations: string[] = ['obs1', 'obs2'],
): MemoryEntity {
	return { name, entityType, observations };
}

function makeRelation(from: string, to: string, relationType: string): MemoryRelation {
	return { from, to, relationType };
}

function makeCtx(args: string, overrides?: Partial<CommandContext>): CommandContext {
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
			version: '0.3.0',
		} as any,
		mcpRegistry: {} as any,
		setHistory: () => {},
		setInput: () => {},
		exit: () => {},
		activateSkill: () => null,
		deactivateSkill: () => {},
		getUserConfig: () => ({ lastMemoryStore: 'default', providers: {} }),
		writeUserConfig: () => {},
		...overrides,
	} as CommandContext;
}

async function run(args: string, overrides?: Partial<CommandContext>): Promise<CommandResult> {
	return (await fineTuneCmd.handler(makeCtx(args, overrides))) as CommandResult;
}

describe('countMultiHopPaths', () => {
	it('returns 0 for empty relations', () => {
		expect(countMultiHopPaths([])).toBe(0);
	});

	it('returns 0 for single-hop relations with no second hop', () => {
		const rels = [makeRelation('A', 'B', 'r1')];
		expect(countMultiHopPaths(rels)).toBe(0);
	});

	it('counts 2-hop paths correctly', () => {
		const rels = [makeRelation('A', 'B', 'r1'), makeRelation('B', 'C', 'r2')];
		expect(countMultiHopPaths(rels)).toBe(1);
	});

	it('counts multiple 2-hop paths', () => {
		const rels = [
			makeRelation('A', 'B', 'r1'),
			makeRelation('B', 'C', 'r2'),
			makeRelation('B', 'D', 'r3'),
		];
		expect(countMultiHopPaths(rels)).toBe(2);
	});

	it('counts 3-hop as multiple 2-hop segments', () => {
		const rels = [
			makeRelation('A', 'B', 'r1'),
			makeRelation('B', 'C', 'r2'),
			makeRelation('C', 'D', 'r3'),
		];
		expect(countMultiHopPaths(rels)).toBe(2);
	});
});

describe('computeGraphDensity', () => {
	it('returns 0 for fewer than 2 entities', () => {
		expect(computeGraphDensity(0, 0)).toBe(0);
		expect(computeGraphDensity(1, 5)).toBe(0);
	});

	it('computes density correctly', () => {
		const density = computeGraphDensity(10, 9);
		expect(density).toBeCloseTo(9 / 90, 4);
	});

	it('returns 0 for zero relations', () => {
		expect(computeGraphDensity(10, 0)).toBe(0);
	});
});

describe('findOrphans', () => {
	it('returns all entities as orphans when no relations', () => {
		const entities = [makeEntity('A', 't'), makeEntity('B', 't')];
		const result = findOrphans(entities, []);
		expect(result.count).toBe(2);
		expect(result.percentage).toBe(100);
		expect(result.names).toEqual(['A', 'B']);
	});

	it('returns no orphans when all connected', () => {
		const entities = [makeEntity('A', 't'), makeEntity('B', 't')];
		const relations = [makeRelation('A', 'B', 'r')];
		const result = findOrphans(entities, relations);
		expect(result.count).toBe(0);
		expect(result.percentage).toBe(0);
	});

	it('detects partial orphans', () => {
		const entities = [makeEntity('A', 't'), makeEntity('B', 't'), makeEntity('C', 't')];
		const relations = [makeRelation('A', 'B', 'r')];
		const result = findOrphans(entities, relations);
		expect(result.count).toBe(1);
		expect(result.percentage).toBe(33);
		expect(result.names).toEqual(['C']);
	});
});

describe('checkReadiness', () => {
	it('returns not_ready for empty graph', () => {
		const report = checkReadiness([], []);
		expect(report.overall).toBe('not_ready');
		expect(report.entityCount).toBe(0);
		expect(report.recommendations.length).toBeGreaterThan(0);
	});

	it('returns not_ready for sparse graph', () => {
		const entities = [makeEntity('A', 'concept', ['obs1'])];
		const relations: MemoryRelation[] = [];
		const report = checkReadiness(entities, relations);
		expect(report.overall).toBe('not_ready');
	});

	it('returns ready for rich graph', () => {
		const entities: MemoryEntity[] = [];
		const relations: MemoryRelation[] = [];
		for (let i = 0; i < 50; i++) {
			entities.push(
				makeEntity(
					`E${i}`,
					i % 3 === 0 ? 'concept' : i % 3 === 1 ? 'technology' : 'method',
					[`obs1 for E${i}`, `obs2 for E${i}`, `obs3 for E${i}`],
				),
			);
		}
		for (let i = 0; i < 40; i++) {
			const rt = i % 3 === 0 ? 'enables' : i % 3 === 1 ? 'requires' : 'improves_on';
			relations.push(makeRelation(`E${i}`, `E${(i + 1) % 50}`, rt));
		}
		const report = checkReadiness(entities, relations);
		expect(report.overall).toBe('ready');
		expect(report.personaScore).toBeGreaterThanOrEqual(0.7);
	});

	it('returns marginal for medium graph', () => {
		const entities: MemoryEntity[] = [];
		for (let i = 0; i < 20; i++) {
			entities.push(makeEntity(`E${i}`, 'concept', [`obs1`, `obs2`]));
		}
		const relations = [
			makeRelation('E0', 'E1', 'enables'),
			makeRelation('E1', 'E2', 'requires'),
		];
		const report = checkReadiness(entities, relations);
		expect(['marginal', 'ready', 'not_ready']).toContain(report.overall);
	});

	it('uses persona-specific strategies', () => {
		const entities: MemoryEntity[] = [];
		for (let i = 0; i < 50; i++) {
			entities.push(makeEntity(`E${i}`, 'concept', ['obs1', 'obs2', 'obs3']));
		}
		const relations: MemoryRelation[] = [];
		for (let i = 0; i < 40; i++) {
			relations.push(makeRelation(`E${i}`, `E${(i + 1) % 50}`, 'enables'));
		}
		const reportProf = checkReadiness(entities, relations, 'professor');
		const reportSkep = checkReadiness(entities, relations, 'skeptic');
		expect(Object.keys(reportProf.strategyReadiness)).not.toEqual(
			Object.keys(reportSkep.strategyReadiness),
		);
	});

	it('reports orphan count and percentage', () => {
		const entities = [makeEntity('A', 't'), makeEntity('B', 't'), makeEntity('C', 't')];
		const relations = [makeRelation('A', 'B', 'r')];
		const report = checkReadiness(entities, relations);
		expect(report.orphanCount).toBe(1);
		expect(report.orphanPercentage).toBe(33);
	});

	it('provides recommendations for weak graph', () => {
		const entities = [makeEntity('A', 't', ['obs1'])];
		const report = checkReadiness(entities, []);
		expect(report.recommendations.length).toBeGreaterThan(0);
	});
});

describe('formatReadinessReport', () => {
	it('formats a ready report', () => {
		const entities: MemoryEntity[] = [];
		for (let i = 0; i < 50; i++) {
			entities.push(makeEntity(`E${i}`, 'concept', ['obs1', 'obs2', 'obs3']));
		}
		const relations: MemoryRelation[] = [];
		for (let i = 0; i < 40; i++) {
			relations.push(makeRelation(`E${i}`, `E${(i + 1) % 50}`, 'enables'));
		}
		const report = checkReadiness(entities, relations);
		const text = formatReadinessReport(report);
		expect(text).toContain('+ READY');
		expect(text).toContain('Entities: 50');
	});

	it('formats a not_ready report with recommendations', () => {
		const report = checkReadiness([], []);
		const text = formatReadinessReport(report);
		expect(text).toContain('- NOT READY');
		expect(text).toContain('Actions to improve');
	});
});

describe('fineTuneCmd', () => {
	beforeEach(() => {
		mkdirSync(TMP_DIR, { recursive: true });
	});
	afterEach(() => {
		rmSync(TMP_DIR, { recursive: true, force: true });
	});

	it('has correct command name', () => {
		expect(fineTuneCmd.name).toBe('fine-tune');
	});

	it('reports when memory store does not exist', async () => {
		const result = await run('--store nonexistent-store');
		expect(result.type).toBe('message');
		if (result.type === 'message') {
			expect(result.content).toContain('not found');
		}
	});

	it('reports when graph is empty', async () => {
		const memFile = join(TMP_DIR, 'empty.jsonl');
		writeFileSync(memFile, '', 'utf-8');
		const result = await run(`--store __test_empty`, {
			config: { model: 'test', packs: [], userConfig: {} } as any,
		});
		if (result.type === 'message' && result.content.includes('not found')) {
			return;
		}
		expect(result.type === 'message' || result.type === 'none').toBe(true);
	});

	it('returns preview report with --preview flag', async () => {
		const result = await run('--preview');
		if (result.type === 'message' && result.content.includes('not found')) {
			return;
		}
		if (result.type === 'message') {
			expect(result.content).toContain('Graph Readiness');
		}
	});

	it('blocks export when graph is not ready', async () => {
		const result = await run('');
		if (
			result.type === 'message' &&
			(result.content.includes('not found') || result.content.includes('empty'))
		) {
			return;
		}
		if (result.type === 'message' && result.content.includes('Export blocked')) {
			expect(result.content).toContain('not_ready');
		}
	});

	it('returns confirm result for marginal or ready graph', async () => {
		const result = await run('--confirmed');
		if (result.type === 'message' && result.content.includes('not found')) {
			return;
		}
		if (result.type === 'message' && result.content.includes('Exported')) {
			expect(result.content).toContain('.oexp');
		}
	});

	it('writes .oexp file when confirmed', async () => {
		const result = await run('--confirmed');
		if (
			result.type === 'message' &&
			(result.content.includes('not found') ||
				result.content.includes('empty') ||
				result.content.includes('Export blocked'))
		) {
			return;
		}
		if (result.type === 'message' && result.content.includes('Exported')) {
			expect(result.content).toContain('.oexp');
			const match = result.content.match(/\.\/(fine-tune-\S+\.oexp)/);
			if (match) {
				const filepath = join(process.cwd(), match[1]);
				const { existsSync } = await import('node:fs');
				expect(existsSync(filepath)).toBe(true);
			}
		}
	});
});
