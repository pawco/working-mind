import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { UserConfig } from './config.js';
import { readKnowledgeIndex } from './memory/render.js';
import type { SkillDef } from './sdk/tool.js';

const RULES_FILE_CANDIDATES = ['WMIND.md', 'AGENTS.md'];

export function assembleSystemPrompt(
	persona?: string,
	personaDef?: { prompt?: string },
	config?: UserConfig,
	activeSkills?: SkillDef[],
	maxTurns?: number,
	allSkills?: SkillDef[],
	packName?: string,
	currentTask?: string,
): string {
	const active = activeSkills ?? [];
	const mt = maxTurns ?? config?.agents?.maxTurns;
	if (personaDef?.prompt)
		return assembleStructured({
			identity: personaDef.prompt,
			config,
			activeSkills: active,
			maxTurns: mt,
			allSkills,
			packName,
			currentTask,
		});
	if (persona) {
		const fromConfig = config?.systemPrompts?.[persona];
		if (fromConfig)
			return assembleStructured({
				identity: fromConfig,
				config,
				activeSkills: active,
				maxTurns: mt,
				allSkills,
				packName,
				currentTask,
			});

		const asPath = resolve(persona);
		if (existsSync(asPath)) {
			const content = readFileSync(asPath, 'utf-8');
			return assembleStructured({
				identity: content,
				config,
				activeSkills: active,
				maxTurns: mt,
				allSkills,
				packName,
				currentTask,
			});
		}

		return assembleStructured({
			identity: persona,
			config,
			activeSkills: active,
			maxTurns: mt,
			allSkills,
			packName,
			currentTask,
		});
	}
	const basePrompt = config?.systemPrompts?.default || getDefaultPrompt();
	return assembleStructured({
		identity: basePrompt,
		config,
		activeSkills: active,
		maxTurns: mt,
		allSkills,
		packName,
		currentTask,
	});
}

interface AssembleParts {
	identity: string;
	config?: UserConfig;
	activeSkills?: SkillDef[];
	maxTurns?: number;
	allSkills?: SkillDef[];
	packName?: string;
	currentTask?: string;
}

function assembleStructured(parts: AssembleParts): string {
	let prompt = '';

	prompt += parts.identity;

	if (parts.currentTask) {
		prompt += `\n\n## Current Task\n${parts.currentTask}\n\nExecute this task by calling tools immediately. Do not describe the steps -- call the tools now. If a tool is unavailable, skip that step and continue with available tools.`;
	}

	const activeNames = new Set((parts.activeSkills ?? []).map((s) => s.name));
	const filtered = parts.packName
		? (parts.allSkills ?? []).filter((s) => !s.packName || s.packName === parts.packName)
		: (parts.allSkills ?? []);
	const inactiveSkills = filtered.filter((s) => !activeNames.has(s.name));

	if (inactiveSkills.length > 0) {
		const index = inactiveSkills.map((s) => `- ${s.name}: ${s.description}`).join('\n');
		prompt += `\n\n## Available Skills\nYou can activate these skills with /skill <name> or by mentioning the topic:\n${index}`;
	}

	if ((parts.activeSkills ?? []).length > 0) {
		const skillBlock = (parts.activeSkills ?? [])
			.map((s) => {
				const tools = s.allowedTools ? `\nAllowed tools: ${s.allowedTools.join(', ')}` : '';
				return `## Active Skill: ${s.name}${tools}\n${s.instructions}`;
			})
			.join('\n\n');
		prompt += `\n\n${skillBlock}`;
	}

	if (parts.maxTurns && parts.maxTurns > 0) {
		prompt += `\n\nYou have a budget of ${parts.maxTurns} tool-call turns for this conversation. Each tool call consumes one turn. If a tool fails, consider whether retrying is worth a turn or whether you should answer with available information. Prioritize high-value tool calls over speculative ones.`;
	}

	const knowledgeIndex = readKnowledgeIndex();
	if (knowledgeIndex) {
		const truncated =
			knowledgeIndex.length > 3000
				? `${knowledgeIndex.slice(0, 3000)}\n...(index truncated)`
				: knowledgeIndex;
		prompt += `\n\n## Knowledge Index\nThe following entities exist in your knowledge graph. Reference this when deciding whether to create new entities or update existing ones:\n${truncated}`;
	}

	const rulesFile = findRulesFile();
	if (rulesFile) {
		prompt += `\n\n## Project Rules\n${rulesFile}`;
	}

	return prompt;
}

function getDefaultPrompt(): string {
	return `You are Working Mind, a reasoning agent. Think carefully and provide thorough answers.
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

export function listSystemPrompts(config: UserConfig): { name: string; preview: string }[] {
	const prompts = config.systemPrompts || {};
	return Object.entries(prompts).map(([name, prompt]) => ({
		name,
		preview: prompt.length > 80 ? `${prompt.slice(0, 80)}...` : prompt,
	}));
}

export function saveSystemPrompt(name: string, prompt: string, config: UserConfig): void {
	if (!config.systemPrompts) config.systemPrompts = {};
	config.systemPrompts[name] = prompt;
}

const KNOWLEDGE_INDEX_HEADER = '## Knowledge Index';

export function refreshKnowledgeIndex(currentPrompt: string): string {
	const knowledgeIndex = readKnowledgeIndex();
	if (!knowledgeIndex) {
		const marker = `\n\n${KNOWLEDGE_INDEX_HEADER}`;
		const idx = currentPrompt.indexOf(marker);
		if (idx !== -1) {
			const nextSection = currentPrompt.indexOf('\n\n## ', idx + marker.length);
			return nextSection !== -1
				? currentPrompt.slice(0, idx) + currentPrompt.slice(nextSection)
				: currentPrompt.slice(0, idx);
		}
		return currentPrompt;
	}

	const truncated =
		knowledgeIndex.length > 3000
			? `${knowledgeIndex.slice(0, 3000)}\n...(index truncated)`
			: knowledgeIndex;
	const newIndexBlock = `\n\n${KNOWLEDGE_INDEX_HEADER}\nThe following entities exist in your knowledge graph. Reference this when deciding whether to create new entities or update existing ones:\n${truncated}`;

	const marker = `\n\n${KNOWLEDGE_INDEX_HEADER}`;
	const idx = currentPrompt.indexOf(marker);
	if (idx !== -1) {
		const nextSection = currentPrompt.indexOf('\n\n## ', idx + marker.length);
		if (nextSection !== -1) {
			return currentPrompt.slice(0, idx) + newIndexBlock + currentPrompt.slice(nextSection);
		}
		return currentPrompt.slice(0, idx) + newIndexBlock;
	}

	return currentPrompt + newIndexBlock;
}
