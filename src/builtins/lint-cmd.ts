import type {
	CommandContext,
	CommandResult,
	SlashCommand,
} from '../sdk/command.js';

export const lintCmd: SlashCommand = {
	name: 'lint',
	description: 'Audit knowledge graph for orphans, gaps, and issues',
	handler: (ctx: CommandContext): CommandResult => {
		ctx.agent.currentTask = `Run a knowledge graph lint. Use the mcp__memory__read_graph tool to read the full graph, then analyze it for:
1. ORPHANS: Entities with no relations to/from them. These are disconnected knowledge.
2. EMPTY ENTITIES: Entities with zero observations. These are stubs with no content.
3. DUPLICATES: Entities with very similar names that might be the same thing (e.g., "React" vs "ReactJS").
4. DANGLING RELATIONS: Relations that reference entity names that don't exist in the graph.
5. CONTRADICTIONS: Observations on the same entity that make conflicting claims.
6. MISSING ENTITIES: Concepts mentioned in observations that don't have their own entity yet.

Report findings as a structured list with counts. For each issue, suggest a fix. If the graph is empty, say so.`;

		return {
			type: 'trigger-agent',
			content: 'Running knowledge graph lint...',
		};
	},
};
