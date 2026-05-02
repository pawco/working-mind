import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { splitFrontmatter } from './frontmatter.js';
import type {
	CommandContext,
	CommandResult,
	SlashCommand,
} from './sdk/command.js';

const CONFIG_DIR = join(homedir(), '.openexplorer');

export function loadCommandFiles(dirs?: string[]): SlashCommand[] {
	const searchDirs = dirs ?? [
		join(process.cwd(), '.openexplorer', 'commands'),
		join(CONFIG_DIR, 'commands'),
	];
	const commands: SlashCommand[] = [];
	for (const dir of searchDirs) {
		if (!existsSync(dir)) continue;
		const entries = readdirSync(dir).filter((e) => e.endsWith('.md'));
		for (const entry of entries) {
			try {
				const cmd = parseCommandMd(
					readFileSync(join(dir, entry), 'utf-8'),
					entry.replace(/\.md$/, ''),
				);
				commands.push(cmd);
			} catch {
				/* skip malformed */
			}
		}
	}
	return commands;
}

export function parseCommandMd(
	content: string,
	fallbackName: string,
): SlashCommand {
	const { frontmatter, body } = splitFrontmatter(content);
	const name = frontmatter.name || fallbackName;
	const description = frontmatter.description || body.slice(0, 80);
	const usage = frontmatter.usage;

	return {
		name,
		description,
		usage,
		handler: (ctx: CommandContext): CommandResult => {
			const prompt = substitutePlaceholders(body.trim(), ctx.args);
			return { type: 'message', content: prompt };
		},
	};
}

function substitutePlaceholders(template: string, args: string): string {
	const positional = args.split(/\s+/);
	let result = template;
	result = result.replace(/\$ARGUMENTS/g, args);
	result = result.replace(/\$@/g, args);
	for (let i = 0; i < positional.length; i++) {
		result = result.replace(new RegExp(`\\$${i + 1}`, 'g'), positional[i]);
	}
	return result;
}
