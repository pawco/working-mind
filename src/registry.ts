import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { UserConfig } from './config.js';
import {
	mergePackTools,
	resolvePackPrompt,
	resolvePersonaFromPacks,
} from './loader.js';
import { replaceAvailableTools } from './pack-loader.js';
import { getSessionsDir } from './paths.js';
import { type SessionData, sessionDataSchema } from './schemas.js';
import type { ResolvedProvider } from './sdk/provider-resolve.js';
import {
	applyToolFilter,
	type ToolDef,
	type ToolFilter,
	type ToolPack,
} from './sdk/tool.js';
import { SkillRegistry } from './skill-registry.js';
import { assembleSystemPrompt } from './system-prompt.js';

export interface McpToolProvider {
	getTools(): ToolDef[];
}

export interface AgentInstance {
	id: string;
	name: string;
	persona: string;
	systemPrompt: string;
	tools: ToolDef[];
	messages: any[];
	status:
		| 'idle'
		| 'thinking'
		| 'streaming'
		| 'executing'
		| 'waiting_confirmation'
		| 'waiting_input';
	model: string;
	activeSkills: Set<string>;
	packName?: string;
	resolvedProvider?: ResolvedProvider;
	currentTask?: string;
	packSystemPrompt?: string;
}

export type { SessionData };

export interface SessionSummary {
	sessionId: string;
	name: string;
	model: string;
	updatedAt: string;
	messageCount: number;
}

interface ManifestData {
	activeSessionId: string | null;
	sessions: Record<string, SessionSummary>;
}

const SESSION_DIR = getSessionsDir();
const MANIFEST_PATH = join(SESSION_DIR, 'manifest.json');

export class AgentRegistry {
	private agents: Map<string, AgentInstance> = new Map();
	private activeId: string | null = null;
	private packs: ToolPack[] = [];
	private userConfig?: UserConfig;
	private skillRegistry: SkillRegistry = new SkillRegistry();
	private mcpRegistry: McpToolProvider | null = null;
	private createdAtMap: Map<string, string> = new Map();

	setPacks(packs: ToolPack[]) {
		this.packs = packs;
	}
	setUserConfig(config: UserConfig) {
		this.userConfig = config;
	}
	setSkillRegistry(sr: SkillRegistry) {
		this.skillRegistry = sr;
	}
	setMcpRegistry(mr: McpToolProvider) {
		this.mcpRegistry = mr;
	}

	createAgent(config: {
		name: string;
		persona?: string;
		model: string;
		messages?: any[];
		activeSkills?: string[];
		systemPromptOverride?: string;
		packName?: string;
	}): AgentInstance {
		const id = config.name
			.toLowerCase()
			.replace(/\s+/g, '-')
			.replace(/[^a-z0-9-]/g, '');
		const personaDef = config.persona
			? resolvePersonaFromPacks(config.persona, this.packs, config.packName)
			: null;
		const activeSkillDefs = this.skillRegistry.getActive();
		const allSkillDefs = this.skillRegistry.getAll();
		const effectiveOverride =
			config.systemPromptOverride ||
			resolvePackPrompt(this.packs, config.packName) ||
			undefined;
		let systemPrompt: string;
		if (effectiveOverride) {
			systemPrompt = effectiveOverride;
			if (activeSkillDefs.length > 0) {
				const skillBlock = activeSkillDefs
					.map((s) => {
						const tools = s.allowedTools
							? `\nAllowed tools: ${s.allowedTools.join(', ')}`
							: '';
						return `## Active Skill: ${s.name}${tools}\n${s.instructions}`;
					})
					.join('\n\n');
				systemPrompt += `\n\n${skillBlock}`;
			}
		} else {
			systemPrompt = assembleSystemPrompt(
				config.persona,
				personaDef ?? undefined,
				this.userConfig,
				activeSkillDefs,
				undefined,
				allSkillDefs,
				config.packName,
				undefined,
			);
		}
		const tools = mergePackTools(this.packs, personaDef?.toolFilter);
		const mcpTools = applyToolFilter(
			this.getFilteredMcpTools(config.packName),
			personaDef?.toolFilter,
		);
		const allTools = [...tools, ...mcpTools];
		systemPrompt = replaceAvailableTools(
			systemPrompt,
			allTools.map((t) => t.name),
		);

		if (config.activeSkills?.length) {
			for (const skillName of config.activeSkills) {
				this.skillRegistry.activate(skillName);
			}
		}

		const agent: AgentInstance = {
			id,
			name: config.name,
			persona: config.persona || 'default',
			systemPrompt,
			tools: allTools,
			messages: config.messages || [],
			status: 'idle',
			model: config.model,
			activeSkills: new Set(config.activeSkills || []),
			packName: config.packName,
			packSystemPrompt: effectiveOverride || undefined,
		};

		this.agents.set(id, agent);
		if (!this.activeId) this.activeId = id;
		return agent;
	}

	activateSkill(name: string): string | null {
		const skill = this.skillRegistry.activate(name);
		if (!skill) return null;
		const agent = this.getActive();
		if (agent) {
			if (
				agent.packName &&
				skill.packName &&
				skill.packName !== agent.packName
			) {
				this.skillRegistry.deactivate(name);
				return null;
			}
			agent.activeSkills.add(name);
			this.rebuildSystemPrompt(agent);
			if (skill.allowedTools) {
				const filtered = agent.tools.filter((t) =>
					skill.allowedTools?.includes(t.name),
				);
				if (filtered.length > 0) {
					agent.tools = filtered;
				}
			}
		}
		return skill.description;
	}

	deactivateSkill(name: string): void {
		if (name === '*') {
			const _activeNames = [
				...this.skillRegistry.getActive().map((s) => s.name),
			];
			this.skillRegistry.deactivateAll();
			const agent = this.getActive();
			if (agent) {
				agent.activeSkills.clear();
				this.rebuildSystemPrompt(agent);
				agent.tools = this.getAllTools(undefined, agent.packName);
			}
			return;
		}
		this.skillRegistry.deactivate(name);
		const agent = this.getActive();
		if (agent) {
			agent.activeSkills.delete(name);
			this.rebuildSystemPrompt(agent);
			agent.tools = this.getAllTools(undefined, agent.packName);
		}
	}

	setPersona(persona: string): void {
		const agent = this.getActive();
		if (!agent) return;
		agent.persona = persona;
		this.rebuildSystemPrompt(agent);
	}

	setCustomPrompt(promptText: string): void {
		const agent = this.getActive();
		if (!agent) return;
		agent.systemPrompt = assembleSystemPrompt(
			promptText,
			undefined,
			this.userConfig,
			this.skillRegistry.getActive(),
			undefined,
			this.skillRegistry.getAll(),
			agent.packName,
			agent.currentTask,
		);
		agent.systemPrompt = replaceAvailableTools(
			agent.systemPrompt,
			agent.tools.map((t) => t.name),
		);
	}

	private rebuildSystemPrompt(agent: AgentInstance): void {
		const personaDef =
			agent.persona !== 'default'
				? resolvePersonaFromPacks(agent.persona, this.packs, agent.packName)
				: null;
		const activeSkills = this.skillRegistry.getActive();
		const effectivePrompt =
			agent.packSystemPrompt || resolvePackPrompt(this.packs, agent.packName);

		if (effectivePrompt) {
			agent.systemPrompt = assembleSystemPrompt(
				agent.persona !== 'default' ? agent.persona : undefined,
				{ prompt: effectivePrompt },
				this.userConfig,
				activeSkills,
				undefined,
				this.skillRegistry.getAll(),
				agent.packName,
				agent.currentTask,
			);
			if (!agent.packSystemPrompt) {
				agent.packSystemPrompt = effectivePrompt;
			}
		} else {
			agent.systemPrompt = assembleSystemPrompt(
				agent.persona !== 'default' ? agent.persona : undefined,
				personaDef ?? undefined,
				this.userConfig,
				activeSkills,
				undefined,
				this.skillRegistry.getAll(),
				agent.packName,
				agent.currentTask,
			);
		}

		agent.systemPrompt = replaceAvailableTools(
			agent.systemPrompt,
			agent.tools.map((t) => t.name),
		);
	}

	private getAllTools(filter?: ToolFilter, packName?: string): ToolDef[] {
		const packTools = mergePackTools(this.packs, filter);
		const mcpTools = this.getFilteredMcpTools(packName);
		return [...packTools, ...mcpTools];
	}

	private getFilteredMcpTools(packName?: string): ToolDef[] {
		const allMcpTools = this.mcpRegistry?.getTools() || [];
		if (!packName) return allMcpTools;
		const pack = this.packs.find((p) => p.name === packName);
		if (!pack) return allMcpTools;
		const packMcpServers = new Set(Object.keys(pack.mcpServers || {}));
		const alwaysVisible = new Set<string>();
		const serverCounts = new Map<string, number>();
		for (const p of this.packs) {
			for (const s of Object.keys(p.mcpServers || {})) {
				serverCounts.set(s, (serverCounts.get(s) || 0) + 1);
			}
		}
		for (const [s, count] of serverCounts) {
			if (count >= 2) alwaysVisible.add(s);
		}
		const allowed = new Set([...packMcpServers, ...alwaysVisible]);
		return allMcpTools.filter((t) => {
			if (!t.mcpServer) return true;
			return allowed.has(t.mcpServer);
		});
	}

	rebuildMcpTools(): void {
		const agent = this.getActive();
		if (agent) {
			agent.tools = this.getAllTools(undefined, agent.packName);
			const allToolNames = agent.tools.map((t) => t.name);
			agent.systemPrompt = replaceAvailableTools(
				agent.systemPrompt,
				allToolNames,
			);
		}
	}

	rebuildForTask(agent: AgentInstance, tools: ToolDef[]): void {
		const personaDef =
			agent.persona !== 'default'
				? resolvePersonaFromPacks(agent.persona, this.packs, agent.packName)
				: null;
		const effectivePrompt =
			agent.packSystemPrompt || resolvePackPrompt(this.packs, agent.packName);

		if (effectivePrompt) {
			agent.systemPrompt = assembleSystemPrompt(
				agent.persona !== 'default' ? agent.persona : undefined,
				{ prompt: effectivePrompt },
				this.userConfig,
				this.skillRegistry.getActive(),
				undefined,
				this.skillRegistry.getAll(),
				agent.packName,
				agent.currentTask,
			);
			if (!agent.packSystemPrompt) {
				agent.packSystemPrompt = effectivePrompt;
			}
		} else {
			agent.systemPrompt = assembleSystemPrompt(
				agent.persona !== 'default' ? agent.persona : undefined,
				personaDef ?? undefined,
				this.userConfig,
				this.skillRegistry.getActive(),
				undefined,
				this.skillRegistry.getAll(),
				agent.packName,
				agent.currentTask,
			);
		}

		agent.systemPrompt = replaceAvailableTools(
			agent.systemPrompt,
			tools.map((t) => t.name),
		);
	}

	getActive(): AgentInstance | undefined {
		return this.activeId ? this.agents.get(this.activeId) : undefined;
	}

	switchTo(id: string): AgentInstance | undefined {
		if (this.agents.has(id)) {
			this.activeId = id;
			return this.agents.get(id)!;
		}
		return undefined;
	}

	switchNext(): AgentInstance | undefined {
		const ids = [...this.agents.keys()];
		if (ids.length === 0) return undefined;
		const idx = ids.indexOf(this.activeId || '');
		this.activeId = ids[(idx + 1) % ids.length];
		return this.agents.get(this.activeId!);
	}

	getAll(): AgentInstance[] {
		return [...this.agents.values()];
	}
	remove(id: string): boolean {
		return this.agents.delete(id);
	}
	getCount(): number {
		return this.agents.size;
	}

	clear(): void {
		this.agents.clear();
		this.activeId = null;
	}

	switchModel(model: string): AgentInstance | undefined {
		const prev = this.getActive();
		if (!prev) return undefined;
		prev.model = model;
		return prev;
	}

	setActiveId(id: string): void {
		if (this.agents.has(id)) {
			this.activeId = id;
		}
	}

	// ── Session persistence ─────────────────────────────────────────

	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	saveSessions() {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => this._saveSessionsNow(), 2000);
	}

	saveSessionsSync() {
		this._saveSessionsNow();
	}

	private _saveSessionsNow() {
		if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });
		const now = new Date().toISOString();
		for (const agent of this.agents.values()) {
			const createdAt = this.createdAtMap.get(agent.id) || now;
			this.createdAtMap.set(agent.id, createdAt);
			const data: SessionData = {
				sessionId: agent.id,
				name: agent.name,
				persona: agent.persona,
				model: agent.model,
				activeSkills: [...agent.activeSkills],
				messages: agent.messages,
				createdAt,
				updatedAt: now,
				packName: agent.packName,
				packSystemPrompt: agent.packSystemPrompt,
			};
			const path = join(SESSION_DIR, `${agent.id}.json`);
			writeFileSync(path, JSON.stringify(data, null, 2));
		}
		this._writeManifest();
	}

	private _writeManifest() {
		const manifest: ManifestData = {
			activeSessionId: this.activeId,
			sessions: {},
		};
		for (const agent of this.agents.values()) {
			manifest.sessions[agent.id] = {
				sessionId: agent.id,
				name: agent.name,
				model: agent.model,
				updatedAt: new Date().toISOString(),
				messageCount: agent.messages.length,
			};
		}
		if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });
		writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
	}

	listSessions(): SessionSummary[] {
		const summaries: SessionSummary[] = [];

		if (existsSync(MANIFEST_PATH)) {
			try {
				const manifest: ManifestData = JSON.parse(
					readFileSync(MANIFEST_PATH, 'utf-8'),
				);
				for (const summary of Object.values(manifest.sessions)) {
					summaries.push(summary);
				}
			} catch {
				// fall through to directory scan
			}
		}

		if (summaries.length === 0 && existsSync(SESSION_DIR)) {
			const files = readdirSync(SESSION_DIR).filter(
				(f) => f.endsWith('.json') && f !== 'manifest.json',
			);
			for (const file of files) {
				const sessionId = file.replace('.json', '');
				try {
					const data: SessionData = JSON.parse(
						readFileSync(join(SESSION_DIR, file), 'utf-8'),
					);
					summaries.push({
						sessionId,
						name: data.name || sessionId,
						model: data.model || '',
						updatedAt: data.updatedAt || '',
						messageCount: data.messages?.length ?? 0,
					});
				} catch {
					summaries.push({
						sessionId,
						name: sessionId,
						model: '',
						updatedAt: '',
						messageCount: 0,
					});
				}
			}
		}

		return summaries.sort(
			(a, b) =>
				new Date(b.updatedAt || 0).getTime() -
				new Date(a.updatedAt || 0).getTime(),
		);
	}

	loadSession(id: string): SessionData | null {
		const path = join(SESSION_DIR, `${id}.json`);
		if (!existsSync(path)) return null;
		try {
			const raw = JSON.parse(readFileSync(path, 'utf-8'));
			return sessionDataSchema.parse(raw) as SessionData;
		} catch {
			return null;
		}
	}

	resumeSession(id: string): AgentInstance | null {
		const data = this.loadSession(id);
		if (!data) return null;

		this.clear();
		if (data.createdAt) this.createdAtMap.set(data.sessionId, data.createdAt);
		const agent = this.createAgent({
			name: data.name || data.sessionId,
			persona: data.persona,
			model: data.model,
			messages: data.messages || [],
			activeSkills: data.activeSkills || [],
			packName: data.packName,
			systemPromptOverride: data.packSystemPrompt,
		});
		this.activeId = agent.id;
		return agent;
	}

	deleteSession(id: string): boolean {
		const path = join(SESSION_DIR, `${id}.json`);
		let deleted = false;
		if (existsSync(path)) {
			unlinkSync(path);
			deleted = true;
		}
		this._writeManifest();
		return deleted;
	}

	getActiveSessionId(): string | null {
		return this.activeId;
	}
}
