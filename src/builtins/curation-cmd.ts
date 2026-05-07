import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getResearchDir } from '../paths.js';
import type {
	CommandContext,
	CommandResult,
	SlashCommand,
} from '../sdk/command.js';

const RESEARCH_DIR = getResearchDir();

function getActiveCuration(
	ctx: CommandContext,
): { summarize?: string; export?: string } | undefined {
	const packs = ctx.config.packs;
	if (!packs || packs.length === 0) return undefined;
	return packs[0].curation;
}

function extractUserMessages(ctx: CommandContext): string[] {
	return ctx.agent.messages
		.filter((m: any) => m.role === 'user')
		.map((m: any) =>
			typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
		);
}

function extractAssistantMessages(ctx: CommandContext): string[] {
	return ctx.agent.messages
		.filter((m: any) => m.role === 'assistant')
		.map((m: any) =>
			typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
		);
}

function extractToolResults(
	ctx: CommandContext,
): { name: string; content: string }[] {
	return ctx.agent.messages
		.filter((m: any) => m.role === 'tool_result')
		.map((m: any) => ({
			name: m.name || 'tool',
			content:
				typeof m.content === 'string'
					? m.content.slice(0, 500)
					: JSON.stringify(m.content).slice(0, 500),
		}));
}

function buildSummary(ctx: CommandContext): string {
	const curation = getActiveCuration(ctx);
	const userMsgs = extractUserMessages(ctx);
	const assistantMsgs = extractAssistantMessages(ctx);
	const toolResults = extractToolResults(ctx);

	if (userMsgs.length === 0) return '(No conversation to summarize.)';

	const topicGuess = userMsgs[0]?.slice(0, 80) || 'Research session';
	const sources = toolResults.map((t) => t.name);
	const uniqueSources = [...new Set(sources)];

	const packLabel = curation?.summarize
		? ''
		: '\n(No pack curation template -- using generic format)';

	const lines: string[] = ['## Topic', topicGuess, '', '## Key Findings'];

	for (const [i, msg] of assistantMsgs.entries()) {
		const snippet = msg.slice(0, 300).replace(/\n+/g, ' ').trim();
		if (snippet) lines.push(`- ${snippet}${msg.length > 300 ? '...' : ''}`);
		if (i >= 9) {
			lines.push(`- ... and ${assistantMsgs.length - 10} more responses`);
			break;
		}
	}

	lines.push('', '## Open Questions');
	const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
	if (lastAssistant) {
		lines.push('(Review the conversation above for unresolved questions.)');
	} else {
		lines.push('(No assistant responses yet.)');
	}

	if (uniqueSources.length > 0) {
		lines.push('', '## Sources Used');
		for (const src of uniqueSources) {
			lines.push(`- ${src}`);
		}
	}

	lines.push('', '## Conversation Excerpts');
	for (const [i, msg] of userMsgs.entries()) {
		const snippet = msg.slice(0, 200).replace(/\n+/g, ' ').trim();
		lines.push(`**Q${i + 1}**: ${snippet}${msg.length > 200 ? '...' : ''}`);
	}

	if (packLabel) lines.push(packLabel);

	return lines.join('\n');
}

function buildExportDoc(ctx: CommandContext): string {
	const _curation = getActiveCuration(ctx);
	const userMsgs = extractUserMessages(ctx);
	const assistantMsgs = extractAssistantMessages(ctx);
	const toolResults = extractToolResults(ctx);

	if (userMsgs.length === 0) return '(No conversation to export.)';

	const topicGuess = userMsgs[0]?.slice(0, 60) || 'Research';
	const date = new Date().toISOString().split('T')[0];
	const sourceCount = toolResults.length;
	const sources = toolResults.map((t) => t.name);
	const uniqueSources = [...new Set(sources)];

	const lines: string[] = [`# ${topicGuess}`, '', '## Executive Summary'];

	if (assistantMsgs.length > 0) {
		const last = assistantMsgs[assistantMsgs.length - 1];
		const summary = last.slice(0, 500).replace(/\n+/g, ' ').trim();
		lines.push(summary);
	} else {
		lines.push('(No assistant responses yet.)');
	}

	lines.push('', '## Findings');
	for (const [i, msg] of assistantMsgs.entries()) {
		lines.push(`### Response ${i + 1}`, '');
		lines.push(msg);
		lines.push('');
		if (i >= 19) {
			lines.push(
				`... and ${assistantMsgs.length - 20} more responses omitted for brevity.`,
			);
			break;
		}
	}

	lines.push('## Gaps & Limitations');
	lines.push(
		'(Review the conversation for unresolved questions and unknowns.)',
	);

	if (uniqueSources.length > 0) {
		lines.push('', '## Sources & Methodology');
		lines.push(
			`${sourceCount} tool calls across ${uniqueSources.length} tools: ${uniqueSources.join(', ')}`,
		);
		lines.push(`Date of research: ${date}`);
	}

	lines.push(
		'',
		'---',
		`Produced by Working Mind on ${date}. ${sourceCount} sources consulted.`,
	);

	return lines.join('\n');
}

function sanitizeFilename(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 60);
}

function getTopicSlug(ctx: CommandContext): string {
	const first = ctx.agent.messages.find((m: any) => m.role === 'user');
	if (first) {
		const content = typeof first.content === 'string' ? first.content : '';
		const words = content.split(/\s+/).slice(0, 5).join(' ');
		return sanitizeFilename(words);
	}
	return 'research';
}

function ensureResearchDir(packName: string): string {
	const dir = join(RESEARCH_DIR, sanitizeFilename(packName));
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

export const summarizeCmd: SlashCommand = {
	name: 'summarize',
	description: 'Condense current research into a structured summary',
	handler: (ctx: CommandContext): CommandResult => {
		const summary = buildSummary(ctx);
		if (summary === '(No conversation to summarize.)') {
			return { type: 'message', content: summary };
		}

		const userMsgs = extractUserMessages(ctx);
		const topicGuess = userMsgs[0]?.slice(0, 60) || 'Research session';
		const date = new Date().toISOString().split('T')[0];
		const entityName = `synthesis-${sanitizeFilename(topicGuess)}-${date}`;
		const entityObs = [
			`Summary of: ${topicGuess}`,
			`Date: ${date}`,
			`Pack: ${ctx.config.packs.length > 0 ? ctx.config.packs[0].name : 'default'}`,
			summary.slice(0, 2000),
		];

		ctx.agent.currentTask = `Auto-persist this synthesis to memory as a synthesis entity. Use the mcp__memory__create_entities tool to create an entity with name="${entityName}", entityType="synthesis", observations=${JSON.stringify(entityObs)}. Then use mcp__memory__search_nodes to find entities whose names appear in the observations and create relation edges to them using mcp__memory__create_relations.`;

		return {
			type: 'trigger-agent',
			content: `Saving synthesis to memory...`,
		};
	},
};

export const exportCmd: SlashCommand = {
	name: 'export',
	description: 'Produce a curated research document and save to disk',
	usage: '[filename]',
	handler: (ctx: CommandContext): CommandResult => {
		const doc = buildExportDoc(ctx);
		if (doc === '(No conversation to export.)') {
			return { type: 'message', content: doc };
		}

		const packName =
			ctx.config.packs.length > 0 ? ctx.config.packs[0].name : 'default';
		const slug = ctx.args ? sanitizeFilename(ctx.args) : getTopicSlug(ctx);
		const date = new Date().toISOString().split('T')[0];
		const filename = `${date}-${slug}.md`;
		const dir = ensureResearchDir(packName);
		const filepath = join(dir, filename);

		try {
			writeFileSync(filepath, doc, 'utf-8');
		} catch (err: any) {
			return {
				type: 'message',
				content: `Error writing file: ${err.message}`,
			};
		}

		return {
			type: 'message',
			content: `Exported to ${filepath} (${doc.length} chars, ${extractToolResults(ctx).length} sources)`,
			plainText: true,
		};
	},
};

export const importCmd: SlashCommand = {
	name: 'import',
	description: 'Load a previous research document as context',
	usage: '<path>',
	handler: (ctx: CommandContext): CommandResult => {
		const raw = ctx.args.trim();
		if (!raw) {
			return {
				type: 'message',
				content:
					'Usage: /import <path>\nUse /research list to see saved documents.',
			};
		}

		let filepath: string;
		if (raw.startsWith('/') || raw.startsWith('~') || raw.startsWith('./')) {
			filepath = raw.startsWith('~') ? join(homedir(), raw.slice(1)) : raw;
		} else {
			const packs = ctx.config.packs;
			const packName = packs.length > 0 ? packs[0].name : 'default';
			filepath = join(RESEARCH_DIR, sanitizeFilename(packName), raw);
			if (!filepath.endsWith('.md')) filepath += '.md';
		}

		if (!existsSync(filepath)) {
			return {
				type: 'message',
				content: `File not found: ${filepath}`,
			};
		}

		try {
			const content = readFileSync(filepath, 'utf-8');
			if (content.length > 50_000) {
				return {
					type: 'message',
					content: `File too large (${content.length} chars, max 50,000). Use /summarize to condense it first.`,
				};
			}

			const prevBlock = `\n\n## Previous Research (loaded from ${filepath})\n${content}`;
			ctx.agent.systemPrompt += prevBlock;

			return {
				type: 'message',
				content: `Loaded research from ${filepath} (${content.length} chars). The agent now has this as context for follow-up questions.`,
			};
		} catch (err: any) {
			return {
				type: 'message',
				content: `Error reading file: ${err.message}`,
			};
		}
	},
};

export const researchCmd: SlashCommand = {
	name: 'research',
	description: 'List or show previously exported research documents',
	usage: '[list | show <name>]',
	handler: (ctx: CommandContext): CommandResult => {
		const sub = ctx.args.trim();

		if (!sub || sub === 'list') {
			if (!existsSync(RESEARCH_DIR)) {
				return {
					type: 'message',
					content:
						'No saved research. Use /export to save your first document.',
				};
			}

			const entries: string[] = [];
			const dirs = readdirSync(RESEARCH_DIR, { withFileTypes: true }).filter(
				(d) => d.isDirectory(),
			);

			for (const dir of dirs) {
				const packDir = join(RESEARCH_DIR, dir.name);
				const files = readdirSync(packDir)
					.filter((f) => f.endsWith('.md'))
					.sort()
					.reverse();

				for (const file of files.slice(0, 20)) {
					entries.push(`  ${dir.name}/${file}`);
				}
			}

			if (entries.length === 0) {
				return {
					type: 'message',
					content:
						'No saved research. Use /export to save your first document.',
				};
			}

			return {
				type: 'message',
				content: `Saved research (${entries.length} documents):\n${entries.join('\n')}\n\nUse /import <path> to load a document.`,
				plainText: true,
			};
		}

		if (sub.startsWith('show ')) {
			const name = sub.slice(5).trim();
			let filepath: string;

			if (name.startsWith('/') || name.startsWith('~')) {
				filepath = name.startsWith('~') ? join(homedir(), name.slice(1)) : name;
			} else {
				const packs = ctx.config.packs;
				const packName = packs.length > 0 ? packs[0].name : 'default';
				filepath = join(RESEARCH_DIR, sanitizeFilename(packName), name);
				if (!filepath.endsWith('.md')) filepath += '.md';
			}

			if (!existsSync(filepath)) {
				return {
					type: 'message',
					content: `File not found: ${filepath}`,
				};
			}

			try {
				const content = readFileSync(filepath, 'utf-8');
				const truncated = content.slice(0, 800);
				const suffix = `...(full document: ${content.length} chars -- use /import to load)`;
				const preview =
					content.length > 800 ? `${truncated}\n\n${suffix}` : content;
				return { type: 'message', content: preview, plainText: true };
			} catch (err: any) {
				return {
					type: 'message',
					content: `Error reading file: ${err.message}`,
				};
			}
		}

		return {
			type: 'message',
			content: 'Usage: /research [list | show <name>]',
		};
	},
};
