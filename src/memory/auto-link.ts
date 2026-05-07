import type { MemoryGraph } from './render.js';

export function findMentionedEntities(
	text: string,
	graph: MemoryGraph,
	excludeNames?: Set<string>,
): { from: string; to: string; relationType: string }[] {
	if (!text || graph.entities.length === 0) return [];

	const entityNames = new Map<string, string>();
	for (const e of graph.entities) {
		const lower = e.name.toLowerCase();
		if (excludeNames?.has(lower)) continue;
		entityNames.set(lower, e.name);
	}

	const lower = text.toLowerCase();
	const found: string[] = [];
	for (const [key, original] of entityNames) {
		if (key.length < 3) continue;
		if (lower.includes(key)) {
			found.push(original);
		}
	}

	if (found.length === 0) return [];

	const existing = new Set(graph.relations.map((r) => `${r.from}|${r.to}|${r.relationType}`));

	const newRelations: { from: string; to: string; relationType: string }[] = [];
	for (const entityName of found) {
		const key = `__source__|${entityName}|mentioned_in`;
		if (!existing.has(key)) {
			newRelations.push({
				from: '__source__',
				to: entityName,
				relationType: 'mentioned_in',
			});
		}
	}

	return newRelations;
}

export function findCrossLinks(
	graph: MemoryGraph,
): { from: string; to: string; relationType: string }[] {
	if (graph.entities.length < 2) return [];

	const existing = new Set(graph.relations.map((r) => `${r.from}|${r.to}|${r.relationType}`));

	const newRelations: { from: string; to: string; relationType: string }[] = [];

	for (const entity of graph.entities) {
		const entityNames = new Map(
			graph.entities
				.filter((e) => e.name !== entity.name)
				.map((e) => [e.name.toLowerCase(), e.name]),
		);

		for (const obs of entity.observations) {
			const lower = obs.toLowerCase();
			for (const [key, original] of entityNames) {
				if (key.length < 3) continue;
				if (!lower.includes(key)) continue;
				const fwdKey = `${entity.name}|${original}|mentions`;
				const revKey = `${original}|${entity.name}|mentions`;
				if (!existing.has(fwdKey) && !existing.has(revKey)) {
					existing.add(fwdKey);
					newRelations.push({
						from: entity.name,
						to: original,
						relationType: 'mentions',
					});
				}
			}
		}
	}

	return newRelations;
}

export function findOrphanEntities(graph: MemoryGraph): string[] {
	const connected = new Set<string>();
	for (const r of graph.relations) {
		connected.add(r.from);
		connected.add(r.to);
	}
	return graph.entities.filter((e) => !connected.has(e.name)).map((e) => e.name);
}

export function findMentionedButUndefined(graph: MemoryGraph): string[] {
	const mentioned = new Map<string, number>();

	for (const entity of graph.entities) {
		for (const other of graph.entities) {
			if (other.name === entity.name) continue;
			const lower = other.name.toLowerCase();
			if (lower.length < 3) continue;
			for (const obs of entity.observations) {
				if (obs.toLowerCase().includes(lower)) {
					mentioned.set(other.name, (mentioned.get(other.name) || 0) + 1);
				}
			}
		}
	}

	const candidates: string[] = [];
	for (const entity of graph.entities) {
		if (entity.observations.length === 0 && !mentioned.has(entity.name)) {
			candidates.push(entity.name);
		}
	}

	return candidates;
}

export function generateIndexMarkdown(graph: MemoryGraph): string {
	if (graph.entities.length === 0) return '# Knowledge Index\n\n(No entities)\n';

	const byType = new Map<string, MemoryGraph['entities']>();
	for (const e of graph.entities) {
		const list = byType.get(e.entityType) || [];
		list.push(e);
		byType.set(e.entityType, list);
	}

	const lines: string[] = [
		'# Knowledge Index',
		``,
		`Last updated: ${new Date().toISOString().split('T')[0]}`,
		`Entities: ${graph.entities.length} | Relations: ${graph.relations.length}`,
		``,
	];

	const sortedTypes = [...byType.keys()].sort();
	for (const type of sortedTypes) {
		const entities = byType.get(type) || [];
		lines.push(`## ${type} (${entities.length})`);
		for (const e of entities) {
			const summary =
				e.observations.length > 0 ? e.observations[0].slice(0, 80) : '(no observations)';
			const relCount = graph.relations.filter(
				(r) => r.from === e.name || r.to === e.name,
			).length;
			const relBadge = relCount > 0 ? ` [${relCount} rel]` : '';
			lines.push(`- **${e.name}**${relBadge}: ${summary}`);
		}
		lines.push('');
	}

	return lines.join('\n');
}
