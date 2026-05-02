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

	const resolved = filter.preset ? (presets[filter.preset] ?? filter) : filter;
	let result = tools;
	if (resolved.include)
		result = result.filter((t) => resolved.include?.includes(t.name));
	if (resolved.exclude)
		result = result.filter((t) => !resolved.exclude?.includes(t.name));
	return result;
}
