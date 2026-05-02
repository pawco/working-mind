import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { UserConfig } from './config.js';
import type { SkillDef } from './sdk/tool.js';

const RULES_FILE_CANDIDATES = ['OPENEXPLORER.md', 'LAB.md', 'AGENTS.md'];

export function assembleSystemPrompt(
	persona?: string,
	personaDef?: { prompt?: string },
	config?: UserConfig,
	activeSkills?: SkillDef[],
	maxTurns?: number,
	allSkills?: SkillDef[],
): string {
	const active = activeSkills ?? [];
	const mt = maxTurns ?? config?.agents?.maxTurns;
	if (personaDef?.prompt)
		return assembleWithSkills(personaDef.prompt, active, config, mt, allSkills);
	if (persona) {
		const fromConfig = config?.systemPrompts?.[persona];
		if (fromConfig)
			return assembleWithSkills(fromConfig, active, config, mt, allSkills);

		const asPath = resolve(persona);
		if (existsSync(asPath)) {
			const content = readFileSync(asPath, 'utf-8');
			return assembleWithSkills(content, active, config, mt, allSkills);
		}

		return assembleWithSkills(persona, active, config, mt, allSkills);
	}
	const basePrompt = config?.systemPrompts?.default || getDefaultPrompt();
	return assembleWithSkills(basePrompt, active, config, mt, allSkills);
}

function assembleWithSkills(
	basePrompt: string,
	activeSkills: SkillDef[],
	_config?: UserConfig,
	maxTurns?: number,
	allSkills?: SkillDef[],
): string {
	let prompt = basePrompt;

	if (maxTurns && maxTurns > 0) {
		prompt += `\n\nYou have a budget of ${maxTurns} tool-call turns for this conversation. Each tool call consumes one turn. If a tool fails, consider whether retrying is worth a turn or whether you should answer with available information. Prioritize high-value tool calls over speculative ones.`;
	}

	const activeNames = new Set(activeSkills.map((s) => s.name));
	const inactiveSkills = (allSkills ?? []).filter(
		(s) => !activeNames.has(s.name),
	);

	if (inactiveSkills.length > 0) {
		const index = inactiveSkills
			.map((s) => `- ${s.name}: ${s.description}`)
			.join('\n');
		prompt += `\n\n## Available Skills\nYou can activate these skills with /skill <name> or by mentioning the topic:\n${index}`;
	}

	if (activeSkills.length > 0) {
		const skillBlock = activeSkills
			.map((s) => {
				const tools = s.allowedTools
					? `\nAllowed tools: ${s.allowedTools.join(', ')}`
					: '';
				return `## Active Skill: ${s.name}${tools}\n${s.instructions}`;
			})
			.join('\n\n');
		prompt += `\n\n${skillBlock}`;
	}

	const rulesFile = findRulesFile();
	if (rulesFile) {
		prompt += `\n\n## Project Rules\n${rulesFile}`;
	}

	return prompt;
}

function getDefaultPrompt(): string {
	return `You are OpenExplorer, a reasoning agent. Think carefully and provide thorough answers.
When you use tools, explain what you're doing and why.
If a tool fails, analyze the error and suggest fixes.`;
}

function findRulesFile(): string | null {
	for (const name of RULES_FILE_CANDIDATES) {
		const p = resolve(name);
		if (existsSync(p)) return readFileSync(p, 'utf-8');
	}
	return null;
}

export function listSystemPrompts(
	config: UserConfig,
): { name: string; preview: string }[] {
	const prompts = config.systemPrompts || {};
	return Object.entries(prompts).map(([name, prompt]) => ({
		name,
		preview: prompt.length > 80 ? `${prompt.slice(0, 80)}...` : prompt,
	}));
}

export function saveSystemPrompt(
	name: string,
	prompt: string,
	config: UserConfig,
): void {
	if (!config.systemPrompts) config.systemPrompts = {};
	config.systemPrompts[name] = prompt;
}
