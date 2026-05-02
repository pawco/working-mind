import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import pc from 'picocolors';
import type { McpEnvVarDef, McpServerConfig, UserConfig } from './config.js';
import type { McpRegistry } from './mcp/registry.js';
import { getBuiltinPacksDir, getStorePath } from './paths.js';
import type { PersonaDef, SkillDef, ToolPack } from './sdk/tool.js';
import { parseSkillMd } from './skill-loader.js';
import type { SkillRegistry } from './skill-registry.js';

const BUILTIN_PACKS_DIR = getBuiltinPacksDir();

export interface CurationDef {
	summarize?: string;
	export?: string;
}

export interface PackManifest {
	name: string;
	version: string;
	description: string;
	author?: string;
	license?: string;
	private?: boolean;
	openexplorerMinVersion?: string;
	prompt: string;
	personas?: Record<string, { prompt: string; toolFilter?: any }>;
	mcpServers?: Record<
		string,
		{
			package?: string;
			command?: string[];
			required?: boolean;
			capability?: string;
			env?: Record<
				string,
				{
					setting: string;
					sensitive?: boolean;
					required?: boolean;
					label?: string;
					hint?: string;
				}
			>;
		}
	>;
	settings?: {
		name: string;
		description: string;
		envVar: string;
		sensitive?: boolean;
		required?: boolean;
	}[];
	curation?: CurationDef;
}

export interface LoadedPack {
	manifest: PackManifest;
	packDir: string;
	systemPrompt: string;
	personas: Record<string, PersonaDef>;
	skills: SkillDef[];
	mcpServerConfigs: Record<string, McpServerConfig>;
	curation: { summarize?: string; export?: string };
	asToolPack: ToolPack;
}

const USER_PACKS_DIR = join(
	process.env.HOME || '/tmp',
	'.openexplorer',
	'packs',
);

export function findPackDir(name: string): string | null {
	const builtin = join(BUILTIN_PACKS_DIR, name);
	if (existsSync(builtin) && existsSync(join(builtin, 'pack.json')))
		return builtin;

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
			if (
				entry &&
				!entry.linked &&
				existsSync(join(USER_PACKS_DIR, name, 'pack.json'))
			) {
				return join(USER_PACKS_DIR, name);
			}
		}
	} catch {}

	return null;
}

export function readPackManifest(packDir: string): PackManifest {
	const manifestPath = join(packDir, 'pack.json');
	const raw = readFileSync(manifestPath, 'utf-8');
	const manifest: PackManifest = JSON.parse(raw);

	if (!manifest.name || !manifest.version || !manifest.description) {
		throw new Error(
			`pack.json missing required fields: name, version, description`,
		);
	}

	if (manifest.prompt && !existsSync(join(packDir, manifest.prompt))) {
		throw new Error(
			`pack.json references prompt file "${manifest.prompt}" which does not exist`,
		);
	}

	validateNoRequiredMcp(manifest);
	validateNoRequiredSettings(manifest);
	validateName(manifest.name);
	validateCuration(manifest, packDir);

	return manifest;
}

function validateName(name: string): void {
	if (!/^[a-z][a-z0-9-]{2,29}$/.test(name)) {
		throw new Error(
			`Pack name "${name}" must be lowercase, start with a letter, 3-30 chars, hyphens allowed`,
		);
	}
}

export function validateNoRequiredMcp(manifest: PackManifest): void {
	for (const [serverName, server] of Object.entries(
		manifest.mcpServers || {},
	)) {
		if (server.required === true) {
			throw new Error(
				`MCP server "${serverName}" has required: true. All MCP servers must be optional (required: false or omitted).`,
			);
		}
	}
}

export function validateNoRequiredSettings(manifest: PackManifest): void {
	for (const setting of manifest.settings || []) {
		if (setting.required === true) {
			throw new Error(
				`Setting "${setting.name}" has required: true. All pack settings must be optional.`,
			);
		}
	}
}

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

export function buildMcpConfigs(
	manifest: PackManifest,
	userConfig: UserConfig,
): Record<string, McpServerConfig> {
	const result: Record<string, McpServerConfig> = {};

	for (const [name, server] of Object.entries(manifest.mcpServers || {})) {
		if (userConfig.mcpServers?.[name]) continue;

		const command = server.command
			? server.command
			: server.package
				? ['npx', '-y', server.package]
				: null;

		if (!command) continue;

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
			} else if (isRequired) {
				missingRequired = true;
			}
		}

		if (missingRequired) {
			result[name] = {
				type: 'local',
				command,
				env,
				enabled: false,
				requiredEnvVars:
					requiredEnvVars.length > 0 ? requiredEnvVars : undefined,
			};
			continue;
		}

		if (name === 'memory' && !env.MEMORY_FILE_PATH) {
			const activeStore = userConfig.lastMemoryStore || 'default';
			env.MEMORY_FILE_PATH = getStorePath(activeStore);
		}

		result[name] = {
			type: 'local',
			command,
			env,
			enabled: true,
			requiredEnvVars: requiredEnvVars.length > 0 ? requiredEnvVars : undefined,
		};
	}

	return result;
}

const TOOLS_MARKER_START = '<!-- AVAILABLE_TOOLS -->';
const TOOLS_MARKER_END = '<!-- /AVAILABLE_TOOLS -->';

export function replaceAvailableTools(
	prompt: string,
	availableTools: string[],
): string {
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
				prompt.slice(0, startIdx) +
				block +
				prompt.slice(endIdx + TOOLS_MARKER_END.length)
			);
		}
	}

	return prompt;
}

export function validateCuration(
	manifest: PackManifest,
	packDir: string,
): void {
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
		result = result.replace(
			/\{\{SOURCE_COUNT}}/g,
			String(extras?.sourceCount ?? 0),
		);
	}
	return result;
}

export function loadPack(
	packDir: string,
	userConfig: UserConfig,
	skillRegistry?: SkillRegistry,
): LoadedPack {
	const manifest = readPackManifest(packDir);
	const systemPrompt = manifest.prompt
		? readPromptFile(packDir, manifest.prompt)
		: '';
	const personas = readPersonas(packDir, manifest.personas);
	const skills = readSkills(packDir);
	const mcpServerConfigs = buildMcpConfigs(manifest, userConfig);
	const curation = readCurationPrompts(packDir, manifest.curation);

	if (skillRegistry) {
		for (const skill of skills) {
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
		curation,
	};

	return {
		manifest,
		packDir,
		systemPrompt,
		personas,
		skills,
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
					pc.dim(
						`  Connected: ${name} (${toolCount} tool${toolCount !== 1 ? 's' : ''})`,
					),
				);
				connected.push(name);
			} else {
				const errMsg = info?.error || 'unknown error';
				console.error(pc.red(`  Failed: ${name} -- ${shortenError(errMsg)}`));
				failed.push(name);
			}
		} catch (err: any) {
			console.error(
				pc.red(`  Failed: ${name} -- ${shortenError(err.message)}`),
			);
			failed.push(name);
		}
	}

	return { connected, skipped, failed };
}

function shortenError(msg: string): string {
	if (msg.includes('Connection closed') || msg.includes('-32000'))
		return 'server exited unexpectedly (missing API key or dependency?)';
	if (msg.includes('ECONNREFUSED'))
		return 'connection refused (is the server running?)';
	if (msg.length > 120) return `${msg.slice(0, 120)}...`;
	return msg;
}

export function getAvailableToolNames(mcpRegistry: McpRegistry): string[] {
	return mcpRegistry.getTools().map((t) => t.name);
}
