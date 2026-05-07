import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
	CommandContext,
	CommandResult,
	SlashCommand,
} from '../sdk/command.js';

const MAX_FILE_SIZE = 50_000;
const CONFIRMED_FLAG = '--confirmed';

function isMemoryConnected(ctx: CommandContext): boolean {
	return ctx.mcpRegistry?.getServerInfo?.('memory')?.status === 'connected';
}

export function listMdFiles(): string[] {
	const cwd = process.cwd();
	try {
		return readdirSync(cwd).filter(
			(f) => f.endsWith('.md') && existsSync(join(cwd, f)),
		);
	} catch {
		return [];
	}
}

export const ingestCmd: SlashCommand = {
	name: 'ingest',
	description: 'Read a Markdown file from the current directory into memory',
	usage: '<filename.md> [--confirmed]',
	requiresConfirmation: true,
	allowedTools: [
		'mcp__memory__search_nodes',
		'mcp__memory__create_entities',
		'mcp__memory__add_observations',
		'mcp__memory__create_relations',
		'mcp__memory__read_graph',
		'mcp__memory__open_nodes',
	],
	handler: (ctx: CommandContext): CommandResult => {
		const raw = ctx.args.trim();
		const confirmed = raw.includes(CONFIRMED_FLAG);
		const filename = raw
			.replace(CONFIRMED_FLAG, '')
			.trim()
			.replace(/\s+/g, ' ');

		if (!filename) {
			const mdFiles = listMdFiles();
			if (mdFiles.length === 0) {
				return {
					type: 'message',
					content:
						'No .md files in current directory.\nUsage: /ingest <filename.md>',
				};
			}
			return {
				type: 'message',
				content:
					'Usage: /ingest <filename.md>\n\nAvailable files:\n' +
					mdFiles.map((f) => `  ${f}`).join('\n') +
					'\n\nRun /ingest <filename> to preview, then confirm to execute.',
			};
		}

		if (!isMemoryConnected(ctx)) {
			return {
				type: 'message',
				content:
					'Memory MCP server is not connected. Run /mcp-connect memory first.',
			};
		}

		if (filename.includes('/') || filename.includes('\\')) {
			return {
				type: 'message',
				content:
					'Only filenames in the current directory are allowed. No paths or subdirectories.\nRun wmind from the directory containing your documents.',
			};
		}

		const filepath = join(process.cwd(), filename);

		if (!existsSync(filepath)) {
			return {
				type: 'message',
				content: `File not found in current directory: ${filename}\nCurrent directory: ${process.cwd()}`,
			};
		}

		let content: string;
		try {
			content = readFileSync(filepath, 'utf-8');
		} catch (err: any) {
			return {
				type: 'message',
				content: `Error reading file: ${err.message}`,
			};
		}

		if (content.trim().length === 0) {
			return {
				type: 'message',
				content: `File is empty: ${filename}`,
			};
		}

		if (content.length > MAX_FILE_SIZE) {
			return {
				type: 'message',
				content: `File too large (${content.length} chars, max ${MAX_FILE_SIZE}). Split the document or use /summarize to condense first.`,
			};
		}

		if (!confirmed) {
			return {
				type: 'confirm',
				message:
					`This will ingest "${filename}" (${content.length} chars) into your knowledge graph.\n\n` +
					'WARNING: Document content will be sent to the LLM for entity extraction.\n' +
					'Malicious documents may contain prompt injection that could pollute\n' +
					'your knowledge graph with false or unwanted entities.\n\n' +
					'During extraction, the agent is restricted to memory tools only\n' +
					'(no file writes, no network, no code execution).',
				command: 'ingest',
				args: `${filename} ${CONFIRMED_FLAG}`,
			};
		}

		ctx.agent.currentTask =
			`Ingest the following document into your knowledge graph.\n\n` +
			`Document source: ${filename}\n\n` +
			`Follow these steps:\n` +
			`1. EXTRACT: Identify key entities (people, organizations, concepts, technologies, events). ` +
			`For each, determine a canonical name, entity type, and key facts.\n` +
			`2. INTEGRATE: Search the graph first (mcp__memory__search_nodes) to avoid duplicates. ` +
			`If entity exists, add observations. If new, create it.\n` +
			`3. CROSS-REFERENCE: Create relations between entities from this document.\n` +
			`4. Confirm: report entities created, updated, and relations added.\n` +
			`Always include the source filename "${filename}" in at least one observation per entity.`;

		return {
			type: 'trigger-agent',
			content: `Here is the document to ingest (${content.length} chars from ${filename}):\n\n${content}`,
		};
	},
};
