import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getPackProvidedCommands } from './builtins/index.js';
import type { CommandRegistry } from './command-registry.js';
import type { UserConfig } from './config.js';
import type { McpRegistry } from './mcp/registry.js';
import {
	findPackDir,
	type LoadedPack,
	loadPack as loadDeclarativePack,
} from './pack-loader.js';
import { getStorePath } from './paths.js';
import {
	applyToolFilter,
	type ToolDef,
	type ToolFilter,
	type ToolPack,
} from './sdk/tool.js';
import type { SkillRegistry } from './skill-registry.js';

export interface PackLoadResult {
	packs: ToolPack[];
	loadedPacks: LoadedPack[];
	systemPromptOverride?: string;
}

export async function loadPacks(
	packNames: string[],
	skillRegistry?: SkillRegistry,
	commandRegistry?: CommandRegistry,
	userConfig?: UserConfig,
	mcpRegistry?: McpRegistry,
): Promise<PackLoadResult> {
	const packs: ToolPack[] = [];
	const loadedPacks: LoadedPack[] = [];
	let systemPromptOverride: string | undefined;

	for (const name of packNames) {
		try {
			if (isDeclarativePackDir(name) || findPackDir(name)) {
				const result = await loadDeclarativePackByName(
					name,
					userConfig,
					skillRegistry,
					mcpRegistry,
				);
				if (result) {
					packs.push(result.asToolPack);
					loadedPacks.push(result);
					if (!systemPromptOverride && result.systemPrompt) {
						systemPromptOverride = result.systemPrompt;
					}

					if (commandRegistry && result.commands.length > 0) {
						for (const cmd of result.commands) {
							const existing = commandRegistry.resolve(`/${cmd.name}`);
							if (existing) {
								console.error(
									`  Warning: /${cmd.name} already registered (builtin wins). Use /${result.manifest.name}:${cmd.name} for pack version.`,
								);
							}
							commandRegistry.register(cmd, result.manifest.name);
						}
					}

					if (commandRegistry) {
						const packCommands = getPackProvidedCommands(result.manifest);
						for (const cmd of packCommands) {
							commandRegistry.register(cmd, result.manifest.name);
						}
					}
				}
			} else if (isFilePathPack(name)) {
				const pack = await loadFilePathPack(name);
				if (pack) {
					await pack.init?.();
					packs.push(pack);
					if (skillRegistry && pack.skills) {
						for (const skill of Object.values(pack.skills)) {
							skillRegistry.register(skill);
						}
					}
					if (commandRegistry && pack.commands) {
						commandRegistry.registerAll(pack.commands);
					}
				}
			} else {
				console.error(
					`Pack "${name}" not found (checked builtin and ~/.wmind/packs/)`,
				);
			}
		} catch (err: any) {
			console.error(`Failed to load pack "${name}": ${err.message}`);
		}
	}

	if (mcpRegistry && !mcpRegistry.hasServer('memory')) {
		const activeStore = userConfig?.lastMemoryStore || 'default';
		mcpRegistry.registerServer('memory', {
			type: 'local',
			command: ['npx', '-y', '@modelcontextprotocol/server-memory'],
			env: { MEMORY_FILE_PATH: getStorePath(activeStore) },
			enabled: true,
		});
	}

	return { packs, loadedPacks, systemPromptOverride };
}

function isDeclarativePackDir(name: string): boolean {
	if (name.startsWith('./') || name.startsWith('/')) {
		return existsSync(join(name, 'pack.json'));
	}
	if (name.endsWith('.json')) {
		const dir = dirname(name);
		return existsSync(join(dir, 'pack.json'));
	}
	return false;
}

function isFilePathPack(name: string): boolean {
	return (
		name.startsWith('./') ||
		name.startsWith('/') ||
		name.endsWith('.ts') ||
		name.endsWith('.js')
	);
}

async function loadFilePathPack(name: string): Promise<ToolPack | null> {
	if (!existsSync(name)) return null;
	const mod = await import(pathToFileURL(join(process.cwd(), name)).href);
	return mod.default as ToolPack;
}

async function loadDeclarativePackByName(
	name: string,
	userConfig?: UserConfig,
	skillRegistry?: SkillRegistry,
	mcpRegistry?: McpRegistry,
): Promise<LoadedPack | null> {
	const packDir = findPackDir(name);
	if (!packDir) return null;

	const config = userConfig || ({} as UserConfig);
	const loaded = await loadDeclarativePack(packDir, config, skillRegistry);

	if (mcpRegistry && Object.keys(loaded.mcpServerConfigs).length > 0) {
		for (const [serverName, serverConfig] of Object.entries(
			loaded.mcpServerConfigs,
		)) {
			mcpRegistry.registerServer(serverName, serverConfig);
		}
	}

	return loaded;
}

export function mergePackTools(
	packs: ToolPack[],
	filter?: ToolFilter,
): ToolDef[] {
	const toolMap = new Map<string, ToolDef>();
	for (const pack of packs) {
		for (const tool of pack.tools) {
			toolMap.set(tool.name, tool);
		}
	}
	return applyToolFilter([...toolMap.values()], filter);
}

export function resolvePersonaFromPacks(
	persona: string,
	packs: ToolPack[],
	packName?: string,
) {
	for (const pack of packs) {
		if (packName && pack.name !== packName) continue;
		if (pack.personas?.[persona]) return pack.personas[persona];
	}
	return null;
}

export function resolvePackPrompt(
	packs: ToolPack[],
	packName?: string,
): string | null {
	if (!packName) {
		if (packs.length > 0) return packs[0].systemPrompt || null;
		return null;
	}
	const pack = packs.find((p) => p.name === packName);
	if (pack?.systemPrompt) return pack.systemPrompt;
	if (packs.length > 0) return packs[0].systemPrompt || null;
	return null;
}
