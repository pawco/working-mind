import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import pc from 'picocolors';
import { ZodError } from 'zod';
import { parseCommandMd } from './command-loader.js';
import type { McpServerConfig, UserConfig } from './config.js';
import type { McpRegistry } from './mcp/registry.js';
import { getBuiltinPacksDir, getPacksDir, getStorePath } from './paths.js';
import {
	type CurationDef,
	formatZodError,
	type McpEnvVarDef,
	type PackManifest,
	packManifestSchema,
} from './schemas.js';
import type { PersonaDef, SkillDef, SlashCommand, ToolPack } from './sdk/tool.js';
import { parseSkillMd } from './skill-loader.js';
import type { SkillRegistry } from './skill-registry.js';

const BUILTIN_PACKS_DIR = getBuiltinPacksDir();

export type { CurationDef, PackManifest };

export interface LoadedPack {
	manifest: PackManifest;
	packDir: string;
	systemPrompt: string;
	personas: Record<string, PersonaDef>;
	skills: SkillDef[];
	commands: SlashCommand[];
	mcpServerConfigs: Record<string, McpServerConfig>;
	curation: { summarize?: string; export?: string };
	asToolPack: ToolPack;
}

const USER_PACKS_DIR = getPacksDir();

export function findPackDir(name: string): string | null {
	const builtin = join(BUILTIN_PACKS_DIR, name);
	if (existsSync(builtin) && existsSync(join(builtin, 'pack.json'))) return builtin;

	const user = join(USER_PACKS_DIR, name);
	if (existsSync(user) && existsSync(join(user, 'pack.json'))) return user;

	if (name.startsWith('./') || name.startsWith('/') || name.endsWith('.json')) {
		const resolved = name.endsWith('.json') ? dirname(name) : name;
		if (existsSync(join(resolved, 'pack.json'))) return resolved;
	}

	try {
		const manifestPath = join(USER_PACKS_DIR, 'manifest.json');
		if (existsSync(manifestPath)) {
			const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
			const entry = manifest[name];
			if (entry && !entry.linked && existsSync(join(USER_PACKS_DIR, name, 'pack.json'))) {
				return join(USER_PACKS_DIR, name);
			}
		}
	} catch {}

	return null;
}

export function readPackManifest(packDir: string): PackManifest {
	const manifestPath = join(packDir, 'pack.json');
	const raw = readFileSync(manifestPath, 'utf-8');

	let manifest: PackManifest;
	try {
		manifest = packManifestSchema.parse(JSON.parse(raw));
	} catch (err) {
		if (err instanceof ZodError) {
			throw new Error(formatZodError(`Invalid pack.json (${packDir})`, err));
		}
		throw new Error(
			`Failed to parse pack.json in ${packDir}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	if (!existsSync(join(packDir, manifest.prompt))) {
		throw new Error(
			`pack.json references prompt file "${manifest.prompt}" which does not exist`,
		);
	}

	validateCuration(manifest, packDir);

	return manifest;
}

export function validateNoRequiredMcp(_manifest: PackManifest): void {}

export function validateNoRequiredSettings(_manifest: PackManifest): void {}

export function readPromptFile(packDir: string, promptPath: string): string {
	const fullPath = join(packDir, promptPath);
	const content = readFileSync(fullPath, 'utf-8');
	if (content.length > 10_000) {
		throw new Error(
			`Prompt file "${promptPath}" exceeds 10,000 character limit (${content.length} chars)`,
		);
	}
	return content;
}

export function readPersonas(
	packDir: string,
	personaDefs: PackManifest['personas'],
): Record<string, PersonaDef> {
	const result: Record<string, PersonaDef> = {};
	if (!personaDefs) return result;

	for (const [name, def] of Object.entries(personaDefs)) {
		const promptPath = join(packDir, def.prompt);
		if (!existsSync(promptPath)) {
			throw new Error(
				`Persona "${name}" references file "${def.prompt}" which does not exist`,
			);
		}
		const prompt = readFileSync(promptPath, 'utf-8');
		result[name] = {
			prompt,
			toolFilter: def.toolFilter,
		};
	}

	return result;
}

export function readSkills(packDir: string): SkillDef[] {
	const skillsDir = join(packDir, 'skills');
	if (!existsSync(skillsDir)) return [];

	const skills: SkillDef[] = [];
	const entries = readdirSync(skillsDir).filter((e) =>
		statSync(join(skillsDir, e)).isDirectory(),
	);

	for (const entry of entries) {
		const skillFile = join(skillsDir, entry, 'SKILL.md');
		if (existsSync(skillFile)) {
			try {
				const content = readFileSync(skillFile, 'utf-8');
				const skill = parseSkillMd(content, entry);
				skills.push(skill);
			} catch {
				/* skip malformed */
			}
		}
	}

	return skills;
}

export function readCommands(packDir: string, manifest: PackManifest): SlashCommand[] {
	const commands: SlashCommand[] = [];
	if (!manifest.commands) return commands;

	for (const [name, filePath] of Object.entries(manifest.commands)) {
		const fullPath = join(packDir, filePath);
		if (!existsSync(fullPath)) {
			throw new Error(`Command "${name}" references file "${filePath}" which does not exist`);
		}
		try {
			const content = readFileSync(fullPath, 'utf-8');
			const cmd = parseCommandMd(content, name, manifest.name);
			if (cmd.name !== name) {
				throw new Error(
					`Command file "${filePath}" has name="${cmd.name}" but pack.json declares it as "${name}"`,
				);
			}
			if (!/^[a-z][a-z0-9-]{1,29}$/.test(name)) {
				throw new Error(`Command name "${name}" must match ^[a-z][a-z0-9-]{1,29}$`);
			}
			commands.push(cmd);
		} catch (err: any) {
			throw new Error(`Failed to load command "${name}": ${err.message}`);
		}
	}

	return commands;
}

export async function buildMcpConfigs(
	manifest: PackManifest,
	userConfig: UserConfig,
	packDir?: string,
): Promise<Record<string, McpServerConfig>> {
	const result: Record<string, McpServerConfig> = {};

	for (const [name, server] of Object.entries(manifest.mcpServers || {})) {
		const command = server.command
			? server.command
			: server.package
				? ['npx', '-y', server.package]
				: null;

		if (!command) continue;

		const saved = userConfig.mcpServers?.[name];
		const env: Record<string, string> = {};
		const requiredEnvVars: McpEnvVarDef[] = [];
		let missingRequired = false;
		for (const [envName, envDef] of Object.entries(server.env || {})) {
			const isRequired = envDef.required === true;
			if (isRequired) {
				requiredEnvVars.push({
					name: envName,
					label: envDef.label || envName,
					required: true,
					sensitive: envDef.sensitive,
					hint: envDef.hint,
				});
			}
			const envValue = process.env[envName];
			if (envValue) {
				env[envName] = envValue;
			} else {
				const savedEnvVal = saved?.env?.[envName];
				if (savedEnvVal) {
					env[envName] = savedEnvVal;
				} else if (isRequired) {
					missingRequired = true;
				}
			}
		}

		const hasInputDirArg = command.some((a) => a === '$INPUT_DIR' || a.includes('$INPUT_DIR'));
		if (hasInputDirArg && server.pathPrompt) {
			const inputDirValue = process.env.INPUT_DIR;
			if (inputDirValue) {
				env.INPUT_DIR = inputDirValue;
			} else {
				requiredEnvVars.push({
					name: 'INPUT_DIR',
					label: server.pathPrompt,
					required: true,
					sensitive: false,
				});
				missingRequired = true;
			}
		}

		if (name === 'memory' && !env.MEMORY_FILE_PATH) {
			const activeStore = userConfig.lastMemoryStore || 'default';
			env.MEMORY_FILE_PATH = getStorePath(activeStore);
		}

		const packDefault: McpServerConfig = {
			type: 'local',
			command,
			env,
			enabled: !missingRequired,
			requiredEnvVars: requiredEnvVars.length > 0 ? requiredEnvVars : undefined,
			packDir,
			pathPrompt: server.pathPrompt,
		};

		if (saved) {
			result[name] = {
				...packDefault,
				...saved,
				command: saved.command || packDefault.command,
				env: { ...(saved.env || {}), ...packDefault.env },
				requiredEnvVars: packDefault.requiredEnvVars,
				packDir,
				pathPrompt: server.pathPrompt,
			};
		} else {
			result[name] = packDefault;
		}
	}

	return result;
}

const TOOLS_MARKER_START = '<!-- AVAILABLE_TOOLS -->';
const TOOLS_MARKER_END = '<!-- /AVAILABLE_TOOLS -->';

export function replaceAvailableTools(prompt: string, availableTools: string[]): string {
	const toolList =
		availableTools.length > 0
			? availableTools.map((t) => `- ${t}`).join('\n')
			: '- (none -- reasoning-only mode)';

	const block = `${TOOLS_MARKER_START}\n${toolList}\n${TOOLS_MARKER_END}`;

	if (prompt.includes('{{AVAILABLE_TOOLS}}')) {
		return prompt.replace('{{AVAILABLE_TOOLS}}', block);
	}

	const startIdx = prompt.indexOf(TOOLS_MARKER_START);
	if (startIdx !== -1) {
		const endIdx = prompt.indexOf(TOOLS_MARKER_END, startIdx);
		if (endIdx !== -1) {
			return (
				prompt.slice(0, startIdx) + block + prompt.slice(endIdx + TOOLS_MARKER_END.length)
			);
		}
	}

	return prompt;
}

export function validateCuration(manifest: PackManifest, packDir: string): void {
	if (!manifest.curation) return;
	const { summarize, export: exportPath } = manifest.curation;
	if (summarize && !existsSync(join(packDir, summarize))) {
		throw new Error(`Curation summarize file "${summarize}" does not exist`);
	}
	if (exportPath && !existsSync(join(packDir, exportPath))) {
		throw new Error(`Curation export file "${exportPath}" does not exist`);
	}
}

export function readCurationPrompts(
	packDir: string,
	curation?: CurationDef,
): { summarize?: string; export?: string } {
	if (!curation) return {};
	const result: { summarize?: string; export?: string } = {};
	if (curation.summarize) {
		const content = readFileSync(join(packDir, curation.summarize), 'utf-8');
		if (content.length > 10_000) {
			throw new Error(
				`Curation summarize file exceeds 10,000 character limit (${content.length} chars)`,
			);
		}
		result.summarize = content;
	}
	if (curation.export) {
		const content = readFileSync(join(packDir, curation.export), 'utf-8');
		if (content.length > 10_000) {
			throw new Error(
				`Curation export file exceeds 10,000 character limit (${content.length} chars)`,
			);
		}
		result.export = content;
	}
	return result;
}

export function replaceCurationPlaceholders(
	prompt: string,
	extras?: { date?: string; sourceCount?: number },
): string {
	let result = prompt;
	if (result.includes('{{DATE}}')) {
		result = result.replace(
			/\{\{DATE}}/g,
			extras?.date || new Date().toISOString().split('T')[0],
		);
	}
	if (result.includes('{{SOURCE_COUNT}}')) {
		result = result.replace(/\{\{SOURCE_COUNT}}/g, String(extras?.sourceCount ?? 0));
	}
	return result;
}

export async function loadPack(
	packDir: string,
	userConfig: UserConfig,
	skillRegistry?: SkillRegistry,
): Promise<LoadedPack> {
	const manifest = readPackManifest(packDir);
	const systemPrompt = manifest.prompt ? readPromptFile(packDir, manifest.prompt) : '';
	const personas = readPersonas(packDir, manifest.personas);
	const skills = readSkills(packDir);
	const commands = readCommands(packDir, manifest);
	const mcpServerConfigs = await buildMcpConfigs(manifest, userConfig, packDir);
	const curation = readCurationPrompts(packDir, manifest.curation);

	if (skillRegistry) {
		for (const skill of skills) {
			skill.packName = manifest.name;
			skillRegistry.register(skill);
		}
	}

	const toolPack: ToolPack = {
		name: manifest.name,
		version: manifest.version,
		description: manifest.description,
		tools: [],
		personas,
		skills: Object.fromEntries(skills.map((s) => [s.name, s])),
		commands,
		curation,
		mcpServers: manifest.mcpServers || undefined,
		systemPrompt: systemPrompt || undefined,
	};

	return {
		manifest,
		packDir,
		systemPrompt,
		personas,
		skills,
		commands,
		mcpServerConfigs,
		curation,
		asToolPack: toolPack,
	};
}

export async function connectPackMcpServers(
	mcpConfigs: Record<string, McpServerConfig>,
	mcpRegistry: McpRegistry,
): Promise<{ connected: string[]; skipped: string[]; failed: string[] }> {
	const connected: string[] = [];
	const skipped: string[] = [];
	const failed: string[] = [];

	for (const [name, config] of Object.entries(mcpConfigs)) {
		if (config.enabled === false) {
			mcpRegistry.addServer(name, config);
			skipped.push(name);
			continue;
		}

		console.error(pc.dim(`  Connecting: ${name}...`));

		try {
			await mcpRegistry.addServer(name, config);
			const info = mcpRegistry.getServerInfo(name);
			if (info?.status === 'connected') {
				const toolCount = info.tools.length;
				console.error(
					pc.dim(`  Connected: ${name} (${toolCount} tool${toolCount !== 1 ? 's' : ''})`),
				);
				connected.push(name);
			} else {
				const errMsg = info?.error || 'unknown error';
				console.error(pc.red(`  Failed: ${name} -- ${shortenError(errMsg)}`));
				failed.push(name);
			}
		} catch (err: any) {
			console.error(pc.red(`  Failed: ${name} -- ${shortenError(err.message)}`));
			failed.push(name);
		}
	}

	return { connected, skipped, failed };
}

function shortenError(msg: string): string {
	if (msg.includes('ECONNREFUSED')) return 'connection refused (is the server running?)';
	if (msg.length > 200) return `${msg.slice(0, 200)}...`;
	return msg;
}

export function getAvailableToolNames(mcpRegistry: McpRegistry): string[] {
	return mcpRegistry.getTools().map((t) => t.name);
}
