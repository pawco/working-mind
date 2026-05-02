import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CommandRegistry } from './command-registry.js';
import type { UserConfig } from './config.js';
import type { McpRegistry } from './mcp/registry.js';
import {
	findPackDir,
	type LoadedPack,
	loadPack as loadDeclarativePack,
} from './pack-loader.js';
import {
	applyToolFilter,
	type ToolDef,
	type ToolFilter,
	type ToolPack,
} from './sdk/tool.js';
import type { SkillRegistry } from './skill-registry.js';

const PACK_CACHE_DIR = join(homedir(), '.openexplorer', 'packs');

const IMPERATIVE_PACKS: Record<string, () => Promise<ToolPack>> = {};

const DECLARATIVE_PACKS = new Set(['starter', 'researcher', 'explorer']);

const FORCE_IMPERATIVE = new Set<string>();

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
			const isDeclarative =
				!FORCE_IMPERATIVE.has(name) &&
				(DECLARATIVE_PACKS.has(name) || isDeclarativePackDir(name));

			if (isDeclarative) {
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
				}
			} else {
				const pack = await loadImperativePack(name);
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
			}
		} catch (err: any) {
			console.error(`Failed to load pack "${name}": ${err.message}`);
		}
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

async function loadDeclarativePackByName(
	name: string,
	userConfig?: UserConfig,
	skillRegistry?: SkillRegistry,
	mcpRegistry?: McpRegistry,
): Promise<LoadedPack | null> {
	const packDir = findPackDir(name);
	if (!packDir) {
		console.error(
			`Pack "${name}" not found (checked builtin and ~/.openexplorer/packs/)`,
		);
		return null;
	}

	const config = userConfig || ({} as UserConfig);
	const loaded = loadDeclarativePack(packDir, config, skillRegistry);

	if (mcpRegistry && Object.keys(loaded.mcpServerConfigs).length > 0) {
		for (const [serverName, serverConfig] of Object.entries(
			loaded.mcpServerConfigs,
		)) {
			mcpRegistry.registerServer(serverName, serverConfig);
		}
	}

	return loaded;
}

async function loadImperativePack(name: string): Promise<ToolPack | null> {
	if (
		name.startsWith('./') ||
		name.startsWith('/') ||
		name.endsWith('.ts') ||
		name.endsWith('.js')
	) {
		if (existsSync(name)) {
			const mod = await import(pathToFileURL(join(process.cwd(), name)).href);
			return mod.default as ToolPack;
		}
	}

	if (IMPERATIVE_PACKS[name]) return IMPERATIVE_PACKS[name]();

	const installedDir = join(PACK_CACHE_DIR, name);
	if (existsSync(join(installedDir, 'pack.json'))) {
		return null;
	}

	const npmDir = join(PACK_CACHE_DIR, 'node_modules', name);
	if (!existsSync(npmDir)) {
		if (!isValidPackName(name)) {
			console.error(
				`Unknown pack: "${name}". Use "openexplorer pack list" to see installed packs, or "openexplorer pack install <url>" to add one.`,
			);
			return null;
		}
		console.log(`Installing pack: ${name}...`);
		execSync(`npm install ${name} --prefix "${PACK_CACHE_DIR}"`, {
			stdio: 'inherit',
		});
	}
	const mod = await import(pathToFileURL(join(npmDir, 'index.js')).href);
	return mod.default as ToolPack;
}

function isValidPackName(name: string): boolean {
	return /^[a-z][a-z0-9-]*(?:@[a-z0-9.-]+)?$/.test(name) && name.length > 1;
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

export function resolvePersonaFromPacks(persona: string, packs: ToolPack[]) {
	for (const pack of packs) {
		if (pack.personas?.[persona]) return pack.personas[persona];
	}
	return null;
}
