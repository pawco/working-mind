import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { splitFrontmatter } from './frontmatter.js';
import type { SkillDef } from './sdk/tool.js';

const CONFIG_DIR = join(homedir(), '.openexplorer');

export function loadSkillFiles(dirs?: string[]): SkillDef[] {
	const searchDirs = dirs ?? [
		join(process.cwd(), '.openexplorer', 'skills'),
		join(process.cwd(), '.agents', 'skills'),
		join(CONFIG_DIR, 'skills'),
	];
	const skills: SkillDef[] = [];
	for (const dir of searchDirs) {
		if (!existsSync(dir)) continue;
		const entries = readdirSync(dir).filter((e) =>
			statSync(join(dir, e)).isDirectory(),
		);
		for (const entry of entries) {
			const skillFile = join(dir, entry, 'SKILL.md');
			if (existsSync(skillFile)) {
				try {
					const skill = parseSkillMd(readFileSync(skillFile, 'utf-8'), entry);
					skills.push(skill);
				} catch {
					/* skip malformed */
				}
			}
		}
	}
	return skills;
}

export function parseSkillMd(content: string, fallbackName: string): SkillDef {
	const { frontmatter, body } = splitFrontmatter(content);
	const name = frontmatter.name || fallbackName;
	return {
		name,
		description: frontmatter.description || '',
		instructions: body.trim(),
		allowedTools: frontmatter.allowedTools
			? String(frontmatter.allowedTools).split(/\s+/).filter(Boolean)
			: undefined,
		model: frontmatter.model || undefined,
		argumentHint: frontmatter.argumentHint || undefined,
		autoDiscover: frontmatter.autoDiscover !== 'false',
	};
}

export { splitFrontmatter as parseFrontmatter };
