import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
	MemoryEntity,
	MemoryGraph,
	MemoryRelation,
} from '../schemas.js';
import { parseMemoryGraph } from '../schemas.js';
import { getActiveStoreName, parseMemoryJsonl } from '../memory/render.js';
import { getStorePath } from '../paths.js';
import type {
	CommandContext,
	CommandResult,
	SlashCommand,
} from '../sdk/command.js';

const CONFIRMED_FLAG = '--confirmed';
const PREVIEW_FLAG = '--preview';

interface StrategyThreshold {
	minEntities: number;
	minEntitiesWithObs: number;
	minRelations: number;
	minRelationTypes: number;
	minMultiHopPaths: number;
	minGraphDensity: number;
	impactWeight: number;
}

const STRATEGY_THRESHOLDS: Record<string, StrategyThreshold> = {
	qa: {
		minEntities: 15,
		minEntitiesWithObs: 15,
		minRelations: 0,
		minRelationTypes: 0,
		minMultiHopPaths: 0,
		minGraphDensity: 0,
		impactWeight: 1.0,
	},
	relation: {
		minEntities: 0,
		minEntitiesWithObs: 0,
		minRelations: 20,
		minRelationTypes: 3,
		minMultiHopPaths: 0,
		minGraphDensity: 0,
		impactWeight: 1.0,
	},
	multihop: {
		minEntities: 30,
		minEntitiesWithObs: 0,
		minRelations: 40,
		minRelationTypes: 0,
		minMultiHopPaths: 5,
		minGraphDensity: 0.01,
		impactWeight: 1.5,
	},
	summary: {
		minEntities: 15,
		minEntitiesWithObs: 15,
		minRelations: 0,
		minRelationTypes: 0,
		minMultiHopPaths: 0,
		minGraphDensity: 0,
		impactWeight: 0.7,
	},
	classify: {
		minEntities: 30,
		minEntitiesWithObs: 0,
		minRelations: 0,
		minRelationTypes: 0,
		minMultiHopPaths: 0,
		minGraphDensity: 0,
		impactWeight: 0.7,
	},
	triple: {
		minEntities: 0,
		minEntitiesWithObs: 0,
		minRelations: 20,
		minRelationTypes: 3,
		minMultiHopPaths: 0,
		minGraphDensity: 0,
		impactWeight: 1.0,
	},
	vocab: {
		minEntities: 15,
		minEntitiesWithObs: 15,
		minRelations: 0,
		minRelationTypes: 0,
		minMultiHopPaths: 0,
		minGraphDensity: 0,
		impactWeight: 0.7,
	},
	adversarial: {
		minEntities: 20,
		minEntitiesWithObs: 20,
		minRelations: 0,
		minRelationTypes: 0,
		minMultiHopPaths: 0,
		minGraphDensity: 0,
		impactWeight: 1.2,
	},
	cot: {
		minEntities: 20,
		minEntitiesWithObs: 20,
		minRelations: 15,
		minRelationTypes: 0,
		minMultiHopPaths: 0,
		minGraphDensity: 0,
		impactWeight: 1.5,
	},
};

const PERSONA_STRATEGIES: Record<string, string[]> = {
	professor: ['qa', 'cot', 'summary', 'triple'],
	skeptic: ['relation', 'adversarial', 'classify', 'triple'],
	student: ['qa', 'relation', 'vocab', 'summary'],
	synthesist: ['qa', 'relation', 'multihop', 'triple', 'cot'],
	pragmatist: ['qa', 'summary', 'classify', 'vocab'],
};

function getDefaultStrategies(): string[] {
	return [
		'qa',
		'relation',
		'multihop',
		'triple',
		'summary',
		'classify',
		'vocab',
	];
}

function resolveMemoryPath(storeName?: string): string {
	if (process.env.MEMORY_FILE_PATH) return process.env.MEMORY_FILE_PATH;
	if (storeName && storeName !== 'default') {
		return getStorePath(storeName);
	}
	return getStorePath('default');
}

async function getMemoryGraph(
	ctx: CommandContext,
	storeName: string,
): Promise<MemoryGraph | null> {
	const mcpRegistry = ctx.mcpRegistry;
	if (mcpRegistry && typeof mcpRegistry.getTools === 'function') {
		const tools = mcpRegistry.getTools();
		const readGraph = tools.find((t) => t.name === 'mcp__memory__read_graph');
		if (readGraph) {
			try {
				const result = await readGraph.execute({});
				return parseMemoryGraph(result);
			} catch {
				// fall through to file
			}
		}
	}

	const memoryPath = resolveMemoryPath(storeName);
	if (!existsSync(memoryPath)) return null;
	try {
		const content = readFileSync(memoryPath, 'utf-8');
		return parseMemoryJsonl(content);
	} catch {
		return null;
	}
}

export function countMultiHopPaths(relations: MemoryRelation[]): number {
	const adj = new Map<string, Set<string>>();
	for (const r of relations) {
		if (!adj.has(r.from)) adj.set(r.from, new Set());
		adj.get(r.from)?.add(r.to);
	}
	let count = 0;
	for (const [, neighbors] of adj) {
		for (const mid of neighbors) {
			const secondHop = adj.get(mid);
			if (secondHop) {
				count += secondHop.size;
			}
		}
	}
	return count;
}

export function computeGraphDensity(
	entityCount: number,
	relationCount: number,
): number {
	if (entityCount < 2) return 0;
	return relationCount / (entityCount * (entityCount - 1));
}

export function findOrphans(
	entities: MemoryEntity[],
	relations: MemoryRelation[],
): { count: number; percentage: number; names: string[] } {
	const connected = new Set([
		...relations.map((r) => r.from),
		...relations.map((r) => r.to),
	]);
	const orphans = entities.filter((e) => !connected.has(e.name));
	const pct = entities.length > 0 ? orphans.length / entities.length : 0;
	return {
		count: orphans.length,
		percentage: Math.round(pct * 100),
		names: orphans.map((e) => e.name),
	};
}

export interface StrategyReadiness {
	status: 'ready' | 'marginal' | 'not_ready';
	estimatedPairs: [number, number];
	details: string;
}

export interface ReadinessReport {
	overall: 'ready' | 'marginal' | 'not_ready';
	personaScore: number;
	entityCount: number;
	relationCount: number;
	observationCount: number;
	graphDensity: number;
	orphanCount: number;
	orphanPercentage: number;
	strategyReadiness: Record<string, StrategyReadiness>;
	recommendations: string[];
}

export function checkReadiness(
	entities: MemoryEntity[],
	relations: MemoryRelation[],
	personaName?: string,
): ReadinessReport {
	const strategies =
		personaName && PERSONA_STRATEGIES[personaName]
			? PERSONA_STRATEGIES[personaName]
			: getDefaultStrategies();

	const entitiesWithObs = entities.filter((e) => e.observations.length >= 2);
	const obsCount = entities.reduce((s, e) => s + e.observations.length, 0);
	const relationTypes = [...new Set(relations.map((r) => r.relationType))];
	const multiHopPaths = countMultiHopPaths(relations);
	const density = computeGraphDensity(entities.length, relations.length);
	const orphans = findOrphans(entities, relations);

	const strategyReadiness: Record<string, StrategyReadiness> = {};
	let totalWeight = 0;
	let totalScore = 0;

	for (const strat of strategies) {
		const t = STRATEGY_THRESHOLDS[strat];
		if (!t) continue;

		const entityOk = entities.length >= t.minEntities;
		const obsOk = entitiesWithObs.length >= t.minEntitiesWithObs;
		const relOk = relations.length >= t.minRelations;
		const relTypeOk = relationTypes.length >= t.minRelationTypes;
		const hopOk = multiHopPaths >= t.minMultiHopPaths;
		const densityOk = density >= t.minGraphDensity;

		const checks = [entityOk, obsOk, relOk, relTypeOk, hopOk, densityOk];
		const passed = checks.filter(Boolean).length;
		const total = checks.length;

		let status: 'ready' | 'marginal' | 'not_ready';
		let score: number;
		if (passed === total) {
			status = 'ready';
			score = 1.0;
		} else if (passed >= total / 2) {
			status = 'marginal';
			score = 0.5;
		} else {
			status = 'not_ready';
			score = 0.0;
		}

		const minPairs = entitiesWithObs.length * 2;
		const maxPairs = entitiesWithObs.length * 4 + relations.length;
		const estMin =
			status === 'not_ready' ? Math.floor(minPairs * 0.3) : minPairs;
		const estMax =
			status === 'not_ready' ? Math.floor(maxPairs * 0.3) : maxPairs;

		const details: string[] = [];
		if (!entityOk && t.minEntities > 0)
			details.push(`${entities.length} entities (need ${t.minEntities})`);
		if (!obsOk && t.minEntitiesWithObs > 0)
			details.push(
				`${entitiesWithObs.length} with 2+ obs (need ${t.minEntitiesWithObs})`,
			);
		if (!relOk && t.minRelations > 0)
			details.push(`${relations.length} relations (need ${t.minRelations})`);
		if (!relTypeOk && t.minRelationTypes > 0)
			details.push(
				`${relationTypes.length} types (need ${t.minRelationTypes})`,
			);
		if (!hopOk && t.minMultiHopPaths > 0)
			details.push(`${multiHopPaths} 2-hop paths (need ${t.minMultiHopPaths})`);
		if (!densityOk && t.minGraphDensity > 0)
			details.push(`density ${density.toFixed(4)} (need ${t.minGraphDensity})`);

		strategyReadiness[strat] = {
			status,
			estimatedPairs: [estMin, estMax],
			details: details.join(', '),
		};

		totalWeight += t.impactWeight;
		totalScore += t.impactWeight * score;
	}

	const personaScore = totalWeight > 0 ? totalScore / totalWeight : 0;

	const overall: 'ready' | 'marginal' | 'not_ready' =
		personaScore >= 0.7
			? 'ready'
			: personaScore >= 0.4
				? 'marginal'
				: 'not_ready';

	const recommendations: string[] = [];
	if (entitiesWithObs.length < 15) {
		recommendations.push(
			'Ingest more documents with /ingest to build entity depth (need 15+ with 2+ observations)',
		);
	}
	if (relations.length < 20) {
		recommendations.push(
			'Ask the agent to connect related entities to add more relations (need 20+)',
		);
	}
	if (relationTypes.length < 3) {
		recommendations.push(
			'Ingest documents from a different angle to add relation type diversity (need 3+ types)',
		);
	}
	if (orphans.percentage > 30) {
		recommendations.push(
			`${orphans.count} orphan entities (${orphans.percentage}%) -- link them with /memory open "Entity Name"`,
		);
	}
	if (multiHopPaths < 5 && strategies.includes('multihop')) {
		recommendations.push(
			'Too few multi-hop paths. Connect clusters by bridging relations between entity groups.',
		);
	}

	return {
		overall,
		personaScore: Math.round(personaScore * 100) / 100,
		entityCount: entities.length,
		relationCount: relations.length,
		observationCount: obsCount,
		graphDensity: Math.round(density * 10000) / 10000,
		orphanCount: orphans.count,
		orphanPercentage: orphans.percentage,
		strategyReadiness,
		recommendations,
	};
}

export function formatReadinessReport(report: ReadinessReport): string {
	const icon =
		report.overall === 'ready'
			? '+'
			: report.overall === 'marginal'
				? '~'
				: '-';
	const label =
		report.overall === 'ready'
			? 'READY'
			: report.overall === 'marginal'
				? 'MARGINAL'
				: 'NOT READY';

	const lines: string[] = [
		`Graph Readiness: ${icon} ${label}`,
		'',
		`Entities: ${report.entityCount} | Relations: ${report.relationCount} | Observations: ${report.observationCount} | Density: ${report.graphDensity}`,
		`Orphans: ${report.orphanCount} (${report.orphanPercentage}% of entities have no relations)`,
		'',
		'Strategy Readiness:',
	];

	for (const [strat, r] of Object.entries(report.strategyReadiness)) {
		const si = r.status === 'ready' ? '+' : r.status === 'marginal' ? '~' : '-';
		const sl =
			r.status === 'ready'
				? 'READY'
				: r.status === 'marginal'
					? 'MARGINAL'
					: 'NOT READY';
		const est = `Est. ${r.estimatedPairs[0]}-${r.estimatedPairs[1]} pairs`;
		const detail = r.details ? `  ${r.details}` : '';
		lines.push(`  ${si} ${strat.padEnd(12)} ${est.padEnd(24)} ${sl}${detail}`);
	}

	lines.push('');
	lines.push(`Persona score: ${report.personaScore} / 1.0`);

	const totalMin = Object.values(report.strategyReadiness).reduce(
		(s, r) => s + r.estimatedPairs[0],
		0,
	);
	const totalMax = Object.values(report.strategyReadiness).reduce(
		(s, r) => s + r.estimatedPairs[1],
		0,
	);
	lines.push(`Estimated total pairs: ${totalMin}-${totalMax}`);

	if (report.recommendations.length > 0) {
		lines.push('');
		lines.push('Actions to improve:');
		for (const [i, rec] of report.recommendations.entries()) {
			lines.push(`${i + 1}. ${rec}`);
		}
	}

	return lines.join('\n');
}

interface OexpExport {
	version: '1.0';
	meta: {
		exportedAt: string;
		openExplorerVersion: string;
		pack: string | null;
		personas: string[];
		storeName: string;
		sourceDocuments: string[];
		domainHint: string | null;
	};
	taxonomy: {
		entityTypes: string[];
		relationTypes: string[];
		entityTypeCounts: Record<string, number>;
		relationTypeCounts: Record<string, number>;
	};
	graph: {
		entities: MemoryEntity[];
		relations: MemoryRelation[];
	};
	stats: {
		entityCount: number;
		relationCount: number;
		observationCount: number;
		orphanCount: number;
		avgObservationsPerEntity: number;
		avgRelationsPerEntity: number;
		graphDensity: number;
	};
	readiness: ReadinessReport;
}

function buildExport(
	entities: MemoryEntity[],
	relations: MemoryRelation[],
	personaNames: string[],
	packName: string | null,
	storeName: string,
	readiness: ReadinessReport,
	version: string,
): OexpExport {
	const entityTypeCounts: Record<string, number> = {};
	for (const e of entities) {
		entityTypeCounts[e.entityType] = (entityTypeCounts[e.entityType] || 0) + 1;
	}
	const relationTypeCounts: Record<string, number> = {};
	for (const r of relations) {
		relationTypeCounts[r.relationType] =
			(relationTypeCounts[r.relationType] || 0) + 1;
	}

	const sortedEntityTypes = Object.entries(entityTypeCounts)
		.sort((a, b) => b[1] - a[1])
		.map(([t]) => t);
	const sortedRelationTypes = Object.entries(relationTypeCounts)
		.sort((a, b) => b[1] - a[1])
		.map(([t]) => t);

	const connected = new Set([
		...relations.map((r) => r.from),
		...relations.map((r) => r.to),
	]);
	const avgObs =
		entities.length > 0
			? Math.round(
					(entities.reduce((s, e) => s + e.observations.length, 0) /
						entities.length) *
						10,
				) / 10
			: 0;
	const avgRel =
		entities.length > 0
			? Math.round((connected.size / entities.length) * 10) / 10
			: 0;

	const sourceDocs = [
		...new Set(
			entities
				.flatMap((e) => e.observations)
				.filter((o) => o.includes('.md') || o.includes('source:'))
				.map((o) => {
					const m = o.match(/source:\s*(\S+\.md)/i) || o.match(/(\S+\.md)/);
					return m ? m[1] : '';
				})
				.filter(Boolean),
		),
	];

	return {
		version: '1.0',
		meta: {
			exportedAt: new Date().toISOString(),
			openExplorerVersion: version,
			pack: packName,
			personas: personaNames,
			storeName,
			sourceDocuments: sourceDocs,
			domainHint: null,
		},
		taxonomy: {
			entityTypes: sortedEntityTypes,
			relationTypes: sortedRelationTypes,
			entityTypeCounts,
			relationTypeCounts,
		},
		graph: { entities, relations },
		stats: {
			entityCount: entities.length,
			relationCount: relations.length,
			observationCount: entities.reduce((s, e) => s + e.observations.length, 0),
			orphanCount: readiness.orphanCount,
			avgObservationsPerEntity: avgObs,
			avgRelationsPerEntity: avgRel,
			graphDensity: readiness.graphDensity,
		},
		readiness,
	};
}

export const fineTuneCmd: SlashCommand = {
	name: 'fine-tune',
	description: 'Export knowledge graph for fine-tuning dataset creation',
	usage: '[--persona <name>] [--store <name>] [--preview] [--confirmed]',
	handler: async (ctx: CommandContext): Promise<CommandResult> => {
		const raw = ctx.args.trim();
		const isPreview = raw.includes(PREVIEW_FLAG);
		const isConfirmed = raw.includes(CONFIRMED_FLAG);

		const personaMatch = raw.match(/--persona\s+(\S+)/);
		const personaName = personaMatch ? personaMatch[1] : undefined;

		const storeMatch = raw.match(/--store\s+(\S+)/);
		const storeName = storeMatch
			? storeMatch[1]
			: getActiveStoreName(ctx.config?.userConfig);

		const graph = await getMemoryGraph(ctx, storeName);

		if (!graph) {
			const memoryPath = resolveMemoryPath(storeName);
			return {
				type: 'message',
				content: `Memory store "${storeName}" not found at ${memoryPath}.\nUse /memory to manage stores, or /ingest to add documents first.`,
			};
		}

		if (graph.entities.length === 0) {
			return {
				type: 'message',
				content:
					'Knowledge graph is empty. Ingest documents first with /ingest, then try /fine-tune again.',
			};
		}

		const readiness = checkReadiness(
			graph.entities,
			graph.relations,
			personaName,
		);

		const report = formatReadinessReport(readiness);

		if (isPreview) {
			return {
				type: 'message',
				content: report,
			};
		}

		if (readiness.overall === 'not_ready') {
			return {
				type: 'message',
				content: `${report}\n\nExport blocked. Improve your graph and try again.`,
			};
		}

		if (!isConfirmed) {
			const personaList = personaName || 'all';
			const warning =
				readiness.overall === 'marginal'
					? '\n\nWARNING: Graph is marginal. Dataset will be small. Consider improving the graph first.'
					: '';
			return {
				type: 'confirm',
				message:
					`This will export the knowledge graph for fine-tuning.\n\n` +
					`Readiness: ${readiness.overall === 'ready' ? '+ READY' : '~ MARGINAL'}\n` +
					`Entities: ${readiness.entityCount} | Relations: ${readiness.relationCount} | Observations: ${readiness.observationCount}\n` +
					`Persona: ${personaList}\n` +
					`Store: ${storeName}${warning}`,
				command: 'fine-tune',
				args: [
					personaName ? `--persona ${personaName}` : '',
					storeName !== 'default' ? `--store ${storeName}` : '',
					CONFIRMED_FLAG,
				]
					.filter(Boolean)
					.join(' '),
			};
		}

		const packName = ctx.agent.packName || null;
		const version = '0.3.0';
		const personaNames = personaName
			? [personaName]
			: Object.keys(PERSONA_STRATEGIES);

		const oexp = buildExport(
			graph.entities,
			graph.relations,
			personaNames,
			packName,
			storeName,
			readiness,
			version,
		);

		const date = new Date().toISOString().slice(0, 10);
		const slug = (personaName || 'all').replace(/[^a-z0-9]/gi, '-');
		const filename = `fine-tune-${slug}-${date}.oexp`;
		const filepath = join(process.cwd(), filename);

		try {
			writeFileSync(filepath, JSON.stringify(oexp, null, 2), 'utf-8');
		} catch (err: any) {
			return {
				type: 'message',
				content: `Error writing export file: ${err.message}`,
			};
		}

		const sizeKb = Math.round(JSON.stringify(oexp).length / 1024);

		return {
			type: 'message',
			content:
				`Exported: ${filename}\n` +
				`Entities: ${readiness.entityCount} | Relations: ${readiness.relationCount} | Observations: ${readiness.observationCount}\n` +
				`Personas: ${personaNames.join(', ')}\n` +
				`Readiness: ${readiness.overall === 'ready' ? '+ READY' : '~ MARGINAL'}\n` +
				`File: ./${filename} (${sizeKb} KB)\n\n` +
				'Upload to ai-curator.cloud to generate fine-tuning datasets.',
		};
	},
};
