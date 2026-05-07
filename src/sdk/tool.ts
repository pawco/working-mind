import type { z } from 'zod';

export interface ToolDef {
	name: string;
	description: string;
	parameters: Record<string, any>;
	execute: (
		args: Record<string, any>,
		onOutput?: (chunk: string) => void,
	) => Promise<any>;
	destructive?: boolean;
	longRunning?: boolean;
	origin?: 'builtin' | 'pack' | 'mcp';
	mcpServer?: string;
	argSchema?: z.ZodTypeAny;
}

export type ToolSetPreset = 'all' | 'readonly' | 'none';

export interface ToolFilter {
	include?: string[];
	exclude?: string[];
	preset?: ToolSetPreset;
}

export interface PersonaDef {
	prompt: string;
	toolFilter?: ToolFilter;
}

export interface SkillDef {
	name: string;
	description: string;
	instructions: string;
	allowedTools?: string[];
	model?: string;
	argumentHint?: string;
	autoDiscover?: boolean;
	packName?: string;
}

import type { SlashCommand } from './command.js';

export type { SlashCommand };

export interface ToolPack {
	name: string;
	version: string;
	description: string;
	tools: ToolDef[];
	personas?: Record<string, PersonaDef>;
	skills?: Record<string, SkillDef>;
	commands?: SlashCommand[];
	curation?: { summarize?: string; export?: string };
	init?: () => Promise<void>;
	mcpServers?: Record<string, unknown>;
	systemPrompt?: string;
}

export function toolDefToOpenAIFormat(tool: ToolDef) {
	return {
		type: 'function' as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		},
	};
}

export function toolDefToAnthropicFormat(tool: ToolDef) {
	return {
		name: tool.name,
		description: tool.description,
		input_schema: tool.parameters,
	};
}

function matchesToolPattern(pattern: string, toolName: string): boolean {
	if (pattern === toolName) return true;
	if (pattern.endsWith('*')) {
		const prefix = pattern.slice(0, -1);
		return toolName.startsWith(prefix);
	}
	return false;
}

function filterByPatterns(tools: ToolDef[], patterns: string[]): ToolDef[] {
	return tools.filter((t) =>
		patterns.some((p) => matchesToolPattern(p, t.name)),
	);
}

export function applyToolFilter(
	tools: ToolDef[],
	filter?: ToolFilter,
): ToolDef[] {
	if (!filter) return tools;

	const presets: Record<string, ToolFilter> = {
		all: {},
		readonly: {
			exclude: tools
				.filter((t) => t.destructive || t.longRunning)
				.map((t) => t.name),
		},
		none: { include: [] },
	};

	let resolved: ToolFilter;
	if (filter.preset) {
		const preset = presets[filter.preset] ?? {};
		const mergedExclude = [
			...(preset.exclude ?? []),
			...(filter.exclude ?? []),
		];
		resolved = {
			include: filter.include ?? preset.include,
			exclude: mergedExclude.length > 0 ? mergedExclude : undefined,
		};
	} else {
		resolved = filter;
	}

	if (resolved.include && resolved.exclude) {
		const included = filterByPatterns(tools, resolved.include);
		const nonExcluded = tools.filter(
			(t) => !resolved.exclude?.some((p) => matchesToolPattern(p, t.name)),
		);
		const includedNames = new Set(included.map((t) => t.name));
		const extras = nonExcluded.filter((t) => !includedNames.has(t.name));
		return [...included, ...extras];
	}

	let result = tools;
	if (resolved.include) result = filterByPatterns(result, resolved.include);
	if (resolved.exclude)
		result = result.filter(
			(t) => !resolved.exclude?.some((p) => matchesToolPattern(p, t.name)),
		);
	return result;
}
