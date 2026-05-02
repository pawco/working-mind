import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDefaultMemoryPath, getMemoriesDir } from '../paths.js';

export interface MemoryEntity {
	name: string;
	entityType: string;
	observations: string[];
}

export interface MemoryRelation {
	from: string;
	to: string;
	relationType: string;
}

export interface MemoryGraph {
	entities: MemoryEntity[];
	relations: MemoryRelation[];
}

export interface MemoryStoreInfo {
	name: string;
	path: string;
	entityCount: number;
	relationCount: number;
	observationCount: number;
	exists: boolean;
}

export function parseMemoryJsonl(content: string): MemoryGraph {
	const entities: MemoryEntity[] = [];
	const relations: MemoryRelation[] = [];
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const obj = JSON.parse(trimmed);
			if (obj.type === 'entity') {
				entities.push({
					name: obj.name,
					entityType: obj.entityType,
					observations: obj.observations || [],
				});
			} else if (obj.type === 'relation') {
				relations.push({
					from: obj.from,
					to: obj.to,
					relationType: obj.relationType,
				});
			}
		} catch {
			// skip malformed lines
		}
	}
	return { entities, relations };
}

export function filterGraph(
	graph: MemoryGraph,
	query?: string,
	depth?: number,
): MemoryGraph {
	if (!query) return graph;
	const lower = query.toLowerCase();
	const seedNames = new Set(
		graph.entities
			.filter(
				(e) =>
					e.name.toLowerCase().includes(lower) ||
					e.entityType.toLowerCase().includes(lower),
			)
			.map((e) => e.name),
	);
	if (seedNames.size === 0) return { entities: [], relations: [] };
	const expanded = expandWithDepth(graph, seedNames, depth ?? 1);
	const filteredEntities = graph.entities.filter((e) => expanded.has(e.name));
	const filteredRelations = graph.relations.filter(
		(r) => expanded.has(r.from) && expanded.has(r.to),
	);
	return { entities: filteredEntities, relations: filteredRelations };
}

function expandWithDepth(
	graph: MemoryGraph,
	seeds: Set<string>,
	depth: number,
): Set<string> {
	let current = new Set(seeds);
	for (let i = 0; i < depth; i++) {
		const next = new Set(current);
		for (const r of graph.relations) {
			if (current.has(r.from)) next.add(r.to);
			if (current.has(r.to)) next.add(r.from);
		}
		if (next.size === current.size) break;
		current = next;
	}
	return current;
}

function sanitizeMermaidId(name: string): string {
	return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

function escapeDot(s: string): string {
	return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function toMermaid(graph: MemoryGraph): string {
	if (graph.entities.length === 0)
		return 'graph LR\n  empty[(No entities in memory)]';
	const lines: string[] = ['graph LR'];
	const ids = new Map<string, string>();
	for (const e of graph.entities) {
		const id = sanitizeMermaidId(e.name);
		ids.set(e.name, id);
		const obsLabel =
			e.observations.length > 0 ? ` (${e.observations.length} obs)` : '';
		const label = `${e.name}\\n${e.entityType}${obsLabel}`;
		lines.push(`  ${id}["${label}"]`);
	}
	for (const r of graph.relations) {
		const fromId = ids.get(r.from) || sanitizeMermaidId(r.from);
		const toId = ids.get(r.to) || sanitizeMermaidId(r.to);
		lines.push(`  ${fromId} -->|${r.relationType}| ${toId}`);
	}
	return lines.join('\n');
}

export function toDot(graph: MemoryGraph): string {
	if (graph.entities.length === 0)
		return 'digraph knowledge_graph {\n  empty [label="No entities in memory"];\n}';
	const lines: string[] = [
		'digraph knowledge_graph {',
		'  node [shape=box style=rounded fontname="sans-serif"];',
	];
	for (const e of graph.entities) {
		const tooltip = escapeDot(e.observations.join('\\n'));
		const label = escapeDot(`${e.name}\\n${e.entityType}`);
		lines.push(
			`  "${escapeDot(e.name)}" [label="${label}" tooltip="${tooltip}"];`,
		);
	}
	for (const r of graph.relations) {
		lines.push(
			`  "${escapeDot(r.from)}" -> "${escapeDot(r.to)}" [label="${escapeDot(r.relationType)}"];`,
		);
	}
	lines.push('}');
	return lines.join('\n');
}

export function toAsciiGraph(graph: MemoryGraph): string {
	if (graph.entities.length === 0) return '(Empty knowledge graph)';
	const connected = new Set<string>();
	for (const r of graph.relations) {
		connected.add(r.from);
		connected.add(r.to);
	}
	const isolated = graph.entities.filter((e) => !connected.has(e.name));
	const lines: string[] = [];
	if (graph.relations.length > 0) {
		lines.push('Relations:');
		for (const r of graph.relations) {
			lines.push(`  ${r.from} --${r.relationType}--> ${r.to}`);
		}
	}
	if (isolated.length > 0) {
		if (lines.length > 0) lines.push('');
		lines.push('Isolated entities:');
		for (const e of isolated) {
			const obs =
				e.observations.length > 0 ? ` (${e.observations.length} obs)` : '';
			lines.push(`  ${e.name} [${e.entityType}]${obs}`);
		}
	}
	return lines.join('\n');
}

export function toTreeView(graph: MemoryGraph): string {
	if (graph.entities.length === 0) return '(Empty knowledge graph)';
	const byType = new Map<string, MemoryEntity[]>();
	for (const e of graph.entities) {
		const list = byType.get(e.entityType) || [];
		list.push(e);
		byType.set(e.entityType, list);
	}
	const outgoing = new Map<string, MemoryRelation[]>();
	const incoming = new Map<string, MemoryRelation[]>();
	for (const r of graph.relations) {
		const outList = outgoing.get(r.from) || [];
		outList.push(r);
		outgoing.set(r.from, outList);
		const inList = incoming.get(r.to) || [];
		inList.push(r);
		incoming.set(r.to, inList);
	}
	const lines: string[] = [];
	const sortedTypes = [...byType.keys()].sort();
	for (const type of sortedTypes) {
		const entities = byType.get(type) || [];
		lines.push(`${type} (${entities.length})`);
		for (let i = 0; i < entities.length; i++) {
			const e = entities[i];
			const isLast = i === entities.length - 1;
			const branch = isLast ? '\u2514\u2500\u2500 ' : '\u251c\u2500\u2500 ';
			const pipe = isLast ? '    ' : '\u2502   ';
			const obsCount =
				e.observations.length > 0 ? ` (${e.observations.length} obs)` : '';
			lines.push(`${branch}${e.name}${obsCount}`);
			for (const obs of e.observations) {
				lines.push(`${pipe}\u251c\u2500\u2500 ${obs}`);
			}
			const outRels = outgoing.get(e.name) || [];
			for (const r of outRels) {
				lines.push(`${pipe}\u2500\u2500\u2500> ${r.relationType} --> ${r.to}`);
			}
			const inRels = incoming.get(e.name) || [];
			for (const r of inRels) {
				lines.push(
					`${pipe}<\u2500\u2500\u2500 ${r.relationType} <-- ${r.from}`,
				);
			}
			if (
				e.observations.length === 0 &&
				outRels.length === 0 &&
				inRels.length === 0
			) {
				lines.push(`${pipe}(no details)`);
			}
		}
		if (sortedTypes.length > 1) lines.push('');
	}
	return lines.join('\n').trimEnd();
}

export function toStats(graph: MemoryGraph): string {
	if (graph.entities.length === 0) return 'Knowledge graph is empty.';
	const byType = new Map<string, number>();
	let totalObs = 0;
	for (const e of graph.entities) {
		byType.set(e.entityType, (byType.get(e.entityType) || 0) + 1);
		totalObs += e.observations.length;
	}
	const lines: string[] = [
		`Knowledge Graph: ${graph.entities.length} entities, ${graph.relations.length} relations, ${totalObs} observations`,
	];
	const sorted = [...byType.entries()].sort((a, b) => b[1] - a[1]);
	for (const [type, count] of sorted) {
		lines.push(`  ${type}: ${count}`);
	}
	const connected = new Set<string>();
	for (const r of graph.relations) {
		connected.add(r.from);
		connected.add(r.to);
	}
	const isolated = graph.entities.length - connected.size;
	if (isolated > 0) {
		lines.push(`  ${isolated} isolated (no relations)`);
	}
	return lines.join('\n');
}

export function getActiveStoreName(config?: {
	lastMemoryStore?: string;
}): string {
	return config?.lastMemoryStore || 'default';
}

export function listMemoryStores(): MemoryStoreInfo[] {
	const dirs = [{ name: 'default', path: getDefaultMemoryPath() }];
	const memoriesDir = getMemoriesDir();
	if (existsSync(memoriesDir)) {
		const entries = readdirSync(memoriesDir);
		for (const entry of entries) {
			if (entry.endsWith('.jsonl')) {
				const name = entry.slice(0, -6);
				if (name !== 'default') {
					dirs.push({ name, path: join(memoriesDir, entry) });
				}
			}
		}
	}
	return dirs
		.map(({ name, path }) => {
			if (!existsSync(path)) {
				return {
					name,
					path,
					entityCount: 0,
					relationCount: 0,
					observationCount: 0,
					exists: false,
				};
			}
			try {
				const content = readFileSync(path, 'utf-8');
				const graph = parseMemoryJsonl(content);
				const obs = graph.entities.reduce(
					(sum, e) => sum + e.observations.length,
					0,
				);
				return {
					name,
					path,
					entityCount: graph.entities.length,
					relationCount: graph.relations.length,
					observationCount: obs,
					exists: true,
				};
			} catch {
				return {
					name,
					path,
					entityCount: 0,
					relationCount: 0,
					observationCount: 0,
					exists: true,
				};
			}
		})
		.sort((a, b) => {
			if (a.name === 'default') return -1;
			if (b.name === 'default') return 1;
			return a.name.localeCompare(b.name);
		});
}

export function ensureMemoriesDir(): string {
	const dir = getMemoriesDir();
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

export function searchAcrossStores(
	query: string,
): { store: string; matches: number }[] {
	const stores = listMemoryStores();
	const lower = query.toLowerCase();
	const results: { store: string; matches: number }[] = [];
	for (const store of stores) {
		if (!store.exists || store.entityCount === 0) {
			results.push({ store: store.name, matches: 0 });
			continue;
		}
		try {
			const content = readFileSync(store.path, 'utf-8');
			const graph = parseMemoryJsonl(content);
			const matches = graph.entities.filter(
				(e) =>
					e.name.toLowerCase().includes(lower) ||
					e.entityType.toLowerCase().includes(lower) ||
					e.observations.some((o) => o.toLowerCase().includes(lower)),
			).length;
			results.push({ store: store.name, matches });
		} catch {
			results.push({ store: store.name, matches: 0 });
		}
	}
	return results;
}

export function formatStoreList(
	stores: MemoryStoreInfo[],
	activeName: string,
): string {
	const lines: string[] = ['Memory Stores:'];
	for (const s of stores) {
		const marker = s.name === activeName ? '●' : '○';
		if (s.exists && s.entityCount > 0) {
			lines.push(
				`  ${marker} ${s.name.padEnd(16)} ${s.entityCount} entities, ${s.relationCount} relations, ${s.observationCount} observations`,
			);
		} else if (s.exists) {
			lines.push(`  ${marker} ${s.name.padEnd(16)} (empty)`);
		} else {
			lines.push(`  ${marker} ${s.name.padEnd(16)} (new -- not created yet)`);
		}
	}
	lines.push(`\nActive: ${activeName}`);
	return lines.join('\n');
}
