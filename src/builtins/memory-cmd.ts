import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MemoryGraph } from '../schemas.js';
import { parseMemoryGraph } from '../schemas.js';
import {
	ensureMemoriesDir,
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
} from '../memory/render.js';
import { getExportsDir, getStorePath } from '../paths.js';
import type {
	CommandContext,
	CommandResult,
	SlashCommand,
} from '../sdk/command.js';

async function getMemoryGraph(
	ctx: CommandContext,
): Promise<MemoryGraph | null> {
	const mcpRegistry = ctx.mcpRegistry;
	if (mcpRegistry) {
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
	return readMemoryFile();
}

function readMemoryFile(): MemoryGraph | null {
	const filePath = findMemoryFile();
	if (!filePath) return null;
	try {
		const content = readFileSync(filePath, 'utf-8');
		return parseMemoryJsonl(content);
	} catch {
		return null;
	}
}

function findMemoryFile(): string | null {
	if (process.env.MEMORY_FILE_PATH) return process.env.MEMORY_FILE_PATH;
	const homePath = join(homedir(), '.wmind', 'memory.jsonl');
	if (existsSync(homePath)) return homePath;
	const cwdPath = join(process.cwd(), 'memory.jsonl');
	if (existsSync(cwdPath)) return cwdPath;
	return null;
}

function isMemoryConnected(ctx: CommandContext): boolean {
	return ctx.mcpRegistry?.getServerInfo('memory')?.status === 'connected';
}

function emptyGraphMessage(ctx: CommandContext): string {
	const connected = isMemoryConnected(ctx);
	if (connected) {
		return (
			'Knowledge graph is empty. The memory server is connected but no ' +
			'entities have been saved yet.\n\n' +
			'Tip: Ask a research question, then use /memory save to extract ' +
			'key entities from the conversation.'
		);
	}
	const hasFile = findMemoryFile() !== null;
	if (hasFile) {
		return 'Found memory.jsonl but it contains no entities.';
	}
	return (
		'Memory MCP server is not connected and no memory.jsonl found.\n\n' +
		'Tip: The starter pack includes memory as a default MCP server. ' +
		'Run /mcp-connect memory if it is not connected.'
	);
}

function parseArgs(raw: string): {
	flags: Record<string, string>;
	rest: string[];
} {
	const flags: Record<string, string> = {};
	const rest: string[] = [];
	const parts = raw.split(/\s+/).filter(Boolean);
	for (let i = 0; i < parts.length; i++) {
		if (parts[i].startsWith('--')) {
			const key = parts[i].slice(2);
			const value =
				parts[i + 1] && !parts[i + 1].startsWith('--') ? parts[i + 1] : 'true';
			flags[key] = value;
			if (value !== 'true') i++;
		} else {
			rest.push(parts[i]);
		}
	}
	return { flags, rest };
}

function ensureExportsDir(): string {
	const dir = getExportsDir();
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

async function handleExport(
	ctx: CommandContext,
	rawArgs: string,
): Promise<CommandResult> {
	const { flags, rest } = parseArgs(rawArgs);
	const format = rest[0] === 'dot' ? 'dot' : 'mermaid';
	const filePath = flags.file || rest[1];

	const graph = await getMemoryGraph(ctx);
	if (!graph || graph.entities.length === 0) {
		return { type: 'message', content: emptyGraphMessage(ctx) };
	}

	const filtered = filterGraph(
		graph,
		flags.filter,
		Number(flags.depth) || undefined,
	);
	const content = format === 'dot' ? toDot(filtered) : toMermaid(filtered);

	if (filePath) {
		const resolved = filePath.startsWith('~')
			? join(homedir(), filePath.slice(1))
			: filePath.startsWith('/')
				? filePath
				: join(ensureExportsDir(), filePath);
		const dir = join(resolved, '..');
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		try {
			writeFileSync(resolved, content, 'utf-8');
			return {
				type: 'message',
				content: `Exported ${format} to ${resolved} (${content.length} chars, ${filtered.entities.length} entities)`,
				plainText: true,
			};
		} catch (err: any) {
			return {
				type: 'message',
				content: `Error writing file: ${err.message}`,
			};
		}
	}

	return {
		type: 'message',
		content: content,
		plainText: true,
	};
}

async function handleGraph(
	ctx: CommandContext,
	rawArgs: string,
): Promise<CommandResult> {
	const { flags, rest } = parseArgs(rawArgs);
	const mode = rest[0] === 'tree' ? 'tree' : 'ascii';
	const filterQuery =
		flags.filter || (rest[0] && rest[0] !== 'tree' ? rest[0] : undefined);
	const depth = Number(flags.depth) || (filterQuery ? 2 : undefined);

	const graph = await getMemoryGraph(ctx);
	if (!graph || graph.entities.length === 0) {
		return { type: 'message', content: emptyGraphMessage(ctx) };
	}

	const filtered = filterGraph(graph, filterQuery, depth);
	if (filtered.entities.length === 0) {
		return {
			type: 'message',
			content: `No entities matching "${filterQuery}". Use /memory stats to see what's stored.`,
		};
	}

	const content =
		mode === 'tree' ? toTreeView(filtered) : toAsciiGraph(filtered);

	return {
		type: 'message',
		content,
		plainText: true,
	};
}

function handleSave(ctx: CommandContext, topic: string): CommandResult {
	const connected = isMemoryConnected(ctx);
	if (!connected) {
		return {
			type: 'message',
			content:
				'Memory MCP server is not connected. Run /mcp-connect memory first.',
		};
	}

	const topicLabel = topic || 'the conversation';
	ctx.agent.currentTask = `Extract key entities, relations, and observations from ${topicLabel} and save them using your memory tools. Call mcp__memory__create_entities for key concepts/people/technologies/projects, mcp__memory__add_observations for facts about existing entities, and mcp__memory__create_relations for how entities connect. Use concise entity names and atomic observation facts. Do NOT re-research -- only save what you already know from the conversation.`;

	return {
		type: 'trigger-agent',
		content: 'Saving to memory...',
	};
}

function getActiveStore(ctx: CommandContext): string {
	return getActiveStoreName(ctx.config?.userConfig);
}

function saveStorePreference(ctx: CommandContext, storeName: string): void {
	const cfg = ctx.getUserConfig?.();
	if (cfg) {
		cfg.lastMemoryStore = storeName;
		ctx.writeUserConfig?.(cfg);
	}
}

function handleList(ctx: CommandContext): CommandResult {
	const activeName = getActiveStore(ctx);
	const stores = listMemoryStores();
	return {
		type: 'message',
		content: formatStoreList(stores, activeName),
		plainText: true,
	};
}

function handleUse(ctx: CommandContext, storeName: string): CommandResult {
	if (!storeName) {
		return { type: 'open-memory-wizard' };
	}

	if (!/^[a-z][a-z0-9_-]{0,49}$/.test(storeName)) {
		return {
			type: 'message',
			content:
				'Store name must be lowercase, start with a letter, up to 50 chars, letters/digits/hyphens/underscores.',
		};
	}

	if (storeName !== 'default') {
		ensureMemoriesDir();
	}
	return switchToStore(ctx, storeName);
}

function switchToStore(ctx: CommandContext, storeName: string): CommandResult {
	const storePath = getStorePath(storeName);

	if (!existsSync(storePath)) {
		const dir = join(storePath, '..');
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(storePath, '', 'utf-8');
	}

	process.env.MEMORY_FILE_PATH = storePath;
	saveStorePreference(ctx, storeName);

	if (ctx.mcpRegistry?.hasServer('memory')) {
		return { type: 'reconnect-memory-store', storeName };
	}

	return {
		type: 'message',
		content: `Switched to memory store '${storeName}'. Memory MCP server is not connected -- run /mcp-connect memory to reconnect with the new store.`,
		plainText: true,
	};
}

function handleDelete(ctx: CommandContext, storeName: string): CommandResult {
	if (!storeName) {
		return { type: 'message', content: 'Usage: /memory delete <store-name>' };
	}
	if (storeName === 'default') {
		return { type: 'message', content: 'Cannot delete the default store.' };
	}

	const storePath = getStorePath(storeName);
	if (!existsSync(storePath)) {
		return { type: 'message', content: `Store '${storeName}' does not exist.` };
	}

	const content = readFileSync(storePath, 'utf-8');
	const graph = parseMemoryJsonl(content);
	const obs = graph.entities.reduce((sum, e) => sum + e.observations.length, 0);

	unlinkSync(storePath);

	const activeName = getActiveStore(ctx);
	if (activeName === storeName) {
		process.env.MEMORY_FILE_PATH = getStorePath('default');
		saveStorePreference(ctx, 'default');
		if (ctx.mcpRegistry?.hasServer('memory')) {
			return {
				type: 'reconnect-memory-store',
				storeName: 'default',
				deletedStore: storeName,
				deletedEntityCount: graph.entities.length,
				deletedObsCount: obs,
			};
		}
		return {
			type: 'message',
			content: `Deleted store '${storeName}' (${graph.entities.length} entities, ${obs} observations). Switched preference to default store. Memory MCP server not connected -- run /mcp-connect memory.`,
			plainText: true,
		};
	}

	return {
		type: 'message',
		content: `Deleted store '${storeName}' (${graph.entities.length} entities, ${obs} observations).`,
	};
}

function handleRename(ctx: CommandContext, args: string): CommandResult {
	const parts = args.split(/\s+/).filter(Boolean);
	if (parts.length < 2) {
		return {
			type: 'message',
			content: 'Usage: /memory rename <old-name> <new-name>',
		};
	}
	const [oldName, newName] = parts;

	if (!/^[a-z][a-z0-9_-]{0,49}$/.test(newName)) {
		return {
			type: 'message',
			content:
				'New name must be lowercase, start with a letter, up to 50 chars, letters/digits/hyphens/underscores.',
		};
	}

	const oldPath = getStorePath(oldName);
	if (!existsSync(oldPath)) {
		return { type: 'message', content: `Store '${oldName}' does not exist.` };
	}

	const newPath = getStorePath(newName);
	if (existsSync(newPath)) {
		return { type: 'message', content: `Store '${newName}' already exists.` };
	}

	renameSync(oldPath, newPath);

	const activeName = getActiveStore(ctx);
	if (activeName === oldName) {
		process.env.MEMORY_FILE_PATH = newPath;
		saveStorePreference(ctx, newName);
		if (ctx.mcpRegistry?.hasServer('memory')) {
			return { type: 'reconnect-memory-store', storeName: newName };
		}
		return {
			type: 'message',
			content: `Renamed store '${oldName}' to '${newName}'. Memory MCP server not connected -- run /mcp-connect memory.`,
			plainText: true,
		};
	}

	return {
		type: 'message',
		content: `Renamed store '${oldName}' to '${newName}'.`,
		plainText: true,
	};
}

function handleCopy(_ctx: CommandContext, args: string): CommandResult {
	const parts = args.split(/\s+/).filter(Boolean);
	if (parts.length < 2) {
		return {
			type: 'message',
			content: 'Usage: /memory copy <from-store> <to-store>',
		};
	}
	const [fromName, toName] = parts;

	const fromPath = getStorePath(fromName);
	if (!existsSync(fromPath)) {
		return {
			type: 'message',
			content: `Source store '${fromName}' does not exist.`,
		};
	}

	const toPath = getStorePath(toName);
	ensureMemoriesDir();

	if (existsSync(toPath)) {
		const toContent = readFileSync(toPath, 'utf-8');
		const toGraph = parseMemoryJsonl(toContent);
		const existingNames = new Set(toGraph.entities.map((e) => e.name));

		const fromContent = readFileSync(fromPath, 'utf-8');
		const fromGraph = parseMemoryJsonl(fromContent);
		const newEntities = fromGraph.entities.filter(
			(e) => !existingNames.has(e.name),
		);
		const newRelations = fromGraph.relations.filter(
			(r) =>
				!existingNames.has(r.from) &&
				!toGraph.relations.some(
					(tr) =>
						tr.from === r.from &&
						tr.to === r.to &&
						tr.relationType === r.relationType,
				),
		);

		const appendLines: string[] = [];
		for (const e of newEntities) {
			appendLines.push(JSON.stringify({ type: 'entity', ...e }));
		}
		for (const r of newRelations) {
			appendLines.push(JSON.stringify({ type: 'relation', ...r }));
		}

		if (appendLines.length > 0) {
			const existing = toContent.trimEnd();
			writeFileSync(
				toPath,
				`${existing}\n${appendLines.join('\n')}\n`,
				'utf-8',
			);
		}

		const alreadyExisted = fromGraph.entities.length - newEntities.length;
		return {
			type: 'message',
			content: `Copied ${newEntities.length} entities from '${fromName}' to '${toName}' (${alreadyExisted} already existed).`,
			plainText: true,
		};
	}

	copyFileSync(fromPath, toPath);
	const fromContent = readFileSync(fromPath, 'utf-8');
	const fromGraph = parseMemoryJsonl(fromContent);
	return {
		type: 'message',
		content: `Copied ${fromGraph.entities.length} entities from '${fromName}' to '${toName}'.`,
		plainText: true,
	};
}

function handleSearchAll(query: string): CommandResult {
	if (!query) {
		return { type: 'message', content: 'Usage: /memory search-all <query>' };
	}

	const results = searchAcrossStores(query);
	const parts = results.map(
		(r) => `${r.store}: ${r.matches} match${r.matches !== 1 ? 'es' : ''}`,
	);
	return {
		type: 'message',
		content: parts.join(' | '),
		plainText: true,
	};
}

const HELP_TEXT = [
	'Subcommands:',
	'  /memory stats                           Show statistics',
	'  /memory save [topic]                    Extract entities from conversation',
	'  /memory export [mermaid|dot] [--file f]  Export graph format',
	'  /memory graph [ascii|tree] [filter]     Visualize in terminal',
	'  /memory list                            List all memory stores',
	'  /memory use [name]                      Switch store (wizard if no name)',
	'  /memory copy <from> <to>                Copy entities between stores',
	'  /memory rename <old> <new>              Rename a store',
	'  /memory delete <name>                   Delete a store',
	'  /memory search-all <query>              Search across all stores',
	'',
	'Examples:',
	'  /memory save',
	'  /memory save React migration',
	'  /memory use kitchen',
	'  /memory use                    (opens wizard)',
	'  /memory list',
	'  /memory copy kitchen default',
	'  /memory search-all Svelte',
	'  /memory export mermaid --file graph.mmd',
	'  /memory graph tree Svelte',
].join('\n');

function stripPrefix(args: string, prefix: string): string {
	if (args === prefix) return '';
	if (args.startsWith(`${prefix} `))
		return args.slice(prefix.length + 1).trim();
	return args;
}

export const memoryCmd: SlashCommand = {
	name: 'memory',
	description: 'View, save, visualize, and export the knowledge graph',
	usage:
		'[stats | save | export | graph | list | use | copy | rename | delete | search-all] [options]',
	handler: async (ctx: CommandContext): Promise<CommandResult> => {
		const args = ctx.args.trim();

		if (!args || args === 'stats') {
			const graph = await getMemoryGraph(ctx);
			if (!graph || graph.entities.length === 0) {
				return { type: 'message', content: emptyGraphMessage(ctx) };
			}
			const stats = toStats(graph);
			if (args === 'stats') {
				return { type: 'message', content: stats, plainText: true };
			}
			return {
				type: 'message',
				content: `${stats}\n\n${HELP_TEXT}`,
				plainText: true,
			};
		}

		if (args === 'save' || args.startsWith('save ')) {
			return handleSave(ctx, stripPrefix(args, 'save'));
		}

		if (args === 'export' || args.startsWith('export ')) {
			return handleExport(ctx, stripPrefix(args, 'export'));
		}

		if (args === 'graph' || args.startsWith('graph ')) {
			return handleGraph(ctx, stripPrefix(args, 'graph'));
		}

		if (args === 'list') {
			return handleList(ctx);
		}

		if (args === 'use' || args.startsWith('use ')) {
			return handleUse(ctx, stripPrefix(args, 'use'));
		}

		if (args.startsWith('copy ')) {
			return handleCopy(ctx, stripPrefix(args, 'copy'));
		}

		if (args.startsWith('rename ')) {
			return handleRename(ctx, stripPrefix(args, 'rename'));
		}

		if (args.startsWith('delete ')) {
			return handleDelete(ctx, stripPrefix(args, 'delete'));
		}

		if (args === 'search-all' || args.startsWith('search-all ')) {
			return handleSearchAll(stripPrefix(args, 'search-all'));
		}

		return {
			type: 'message',
			content: `Usage: /memory [stats | save | export | graph | list | use | copy | rename | delete | search-all] [options]\n\nType /memory for full help.`,
		};
	},
};
