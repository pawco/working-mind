import type { PackManifest } from '../pack-loader.js';
import type { CommandContext, CommandResult, SlashCommand } from '../sdk/command.js';
import { clearDiscoveryCache, clearDiskCache, getMergedModels } from '../sdk/model-discovery.js';
import { findProvider, resolveAlias } from '../sdk/provider-registry.js';
import {
	cacheApiKey,
	detectAvailableProviders,
	resolveApiKey,
	resolveApiKeyAsync,
	resolveModelSpec,
} from '../sdk/provider-resolve.js';
import { listSystemPrompts, saveSystemPrompt } from '../system-prompt.js';
import { exportCmd, importCmd, researchCmd, summarizeCmd } from './curation-cmd.js';
import { ingestCmd } from './ingest-cmd.js';
import { lintCmd } from './lint-cmd.js';
import { getMcpCommands } from './mcp-cmd.js';
import { memoryCmd } from './memory-cmd.js';

export const clearCmd: SlashCommand = {
	name: 'clear',
	description: 'Clear history and deactivate skills',
	handler: (ctx: CommandContext): CommandResult => {
		ctx.setHistory(() => []);
		ctx.setInput('');
		ctx.deactivateSkill('*');
		ctx.agent.messages = [];
		return { type: 'message', content: 'Cleared. Fresh start.' };
	},
};

export const compactCmd: SlashCommand = {
	name: 'compact',
	description: 'Summarize conversation to reduce context',
	usage: '[instructions]',
	handler: (ctx: CommandContext): CommandResult => {
		const instruction =
			ctx.args ||
			'Summarize the conversation so far in a concise way, preserving key facts, decisions, and code changes. Output only the summary, nothing else.';
		ctx.agent.currentTask = instruction;
		return {
			type: 'trigger-agent',
			content: 'Compacting...',
		};
	},
};

export const modelCmd: SlashCommand = {
	name: 'model',
	description: 'Show current model',
	usage: '[new-model-spec]',
	handler: async (ctx: CommandContext): Promise<CommandResult> => {
		if (!ctx.args) {
			return { type: 'message', content: `Current model: ${ctx.agent.model}` };
		}

		let resolved: Awaited<ReturnType<typeof resolveModelSpec>> | undefined;
		try {
			resolved = resolveModelSpec(ctx.args, ctx.config.userConfig);
		} catch (err: any) {
			return { type: 'message', content: err.message };
		}

		if (!resolved.model && !ctx.args.includes('/')) {
			return {
				type: 'message',
				content: `Unknown model "${ctx.args}". Use /models to see available models, or specify provider/model (e.g. openrouter/anthropic/claude-sonnet-4.6).`,
			};
		}

		const provider = resolved.provider;

		if (provider.needsApiKey) {
			const apiKey = resolveApiKey(provider, ctx.config.userConfig);
			if (!apiKey) {
				const asyncKey = await resolveApiKeyAsync(provider, ctx.config.userConfig);
				if (!asyncKey) {
					return {
						type: 'message',
						content: `No API key for ${provider.displayName}. Run /connect to set one up.`,
					};
				}
				cacheApiKey(provider.id, asyncKey);
			}
		}

		const fullModelId = ctx.args.includes('/')
			? ctx.args
			: `${provider.id}/${resolved.model?.id || resolved.providerRelativeModelId}`;

		ctx.agent.model = fullModelId;
		ctx.config.model = fullModelId;

		if (ctx.getUserConfig && ctx.writeUserConfig) {
			const uc = ctx.getUserConfig();
			if (uc) {
				uc.defaultModel = fullModelId;
				ctx.writeUserConfig(uc);
			}
		}

		return { type: 'message', content: `Model changed to: ${fullModelId}` };
	},
};

export const skillsCmd: SlashCommand = {
	name: 'skills',
	description: 'List available skills or activate one',
	usage: '[name]',
	handler: (ctx: CommandContext): CommandResult => {
		if (!ctx.args) {
			return {
				type: 'message',
				content:
					'Use /skill <name> to activate a skill. Skills are loaded from packs and ~/.wmind/skills/.',
			};
		}
		return { type: 'none' };
	},
};

export const skillCmd: SlashCommand = {
	name: 'skill',
	description: 'Activate or deactivate a skill',
	usage: '<name> | off <name> | off-all',
	handler: (ctx: CommandContext): CommandResult => {
		if (ctx.args === 'off-all' || ctx.args === 'off') {
			ctx.deactivateSkill('*');
			return { type: 'message', content: 'All skills deactivated.' };
		}
		if (ctx.args.startsWith('off ')) {
			const name = ctx.args.slice(4).trim();
			ctx.deactivateSkill(name);
			return { type: 'message', content: `Skill "${name}" deactivated.` };
		}
		const result = ctx.activateSkill(ctx.args);
		if (!result) {
			return {
				type: 'message',
				content: `Skill "${ctx.args}" not found. Available: check pack docs or ~/.wmind/skills/`,
			};
		}
		return {
			type: 'message',
			content: `Skill "${ctx.args}" activated. ${result}`,
		};
	},
};

export const undoCmd: SlashCommand = {
	name: 'undo',
	description: 'Remove last user/assistant exchange',
	handler: (ctx: CommandContext): CommandResult => {
		const msgs = ctx.agent.messages;
		if (msgs.length >= 2) {
			const last = msgs[msgs.length - 1];
			const prev = msgs[msgs.length - 2];
			if (last.role === 'assistant' && prev.role === 'user') {
				msgs.splice(msgs.length - 2, 2);
				return { type: 'message', content: 'Removed last exchange.' };
			}
		}
		if (msgs.length >= 1) {
			msgs.pop();
			return { type: 'message', content: 'Removed last message.' };
		}
		return { type: 'message', content: 'Nothing to undo.' };
	},
};

export const quitCmd: SlashCommand = {
	name: 'q',
	description: 'Quit Working Mind',
	handler: (ctx: CommandContext): CommandResult => {
		ctx.exit();
		return { type: 'none' };
	},
};

export const quitAliasCmd: SlashCommand = {
	name: 'quit',
	description: 'Quit Working Mind',
	handler: (ctx: CommandContext): CommandResult => {
		ctx.exit();
		return { type: 'none' };
	},
};

export const exitCmd: SlashCommand = {
	name: 'exit',
	description: 'Quit Working Mind',
	handler: (ctx: CommandContext): CommandResult => {
		ctx.exit();
		return { type: 'none' };
	},
};

export const addCmd: SlashCommand = {
	name: 'add',
	description: 'Add a new agent tab (optionally from a pack)',
	usage: '[pack-name | name]',
	handler: (ctx: CommandContext): CommandResult => {
		if (ctx.args) {
			const pack = ctx.config.packs.find((p: any) => p.name === ctx.args);
			if (pack) {
				return { type: 'add-pack-agent', packName: ctx.args };
			}
			return {
				type: 'message',
				content: `Pack "${ctx.args}" not loaded. Available: ${ctx.config.packs.map((p: any) => p.name).join(', ') || 'none'}. Use --pack to load at startup.`,
			};
		}
		return {
			type: 'message',
			content: 'Press Ctrl+A or type /add <name> in the input to add a tab.',
		};
	},
};

export const tabCmd: SlashCommand = {
	name: 'tab',
	description: 'Switch to next agent',
	handler: (_ctx: CommandContext): CommandResult => {
		return { type: 'message', content: 'Press Tab to switch agents.' };
	},
};

export const helpCmd: SlashCommand = {
	name: 'help',
	description: 'Show help',
	handler: (_ctx: CommandContext): CommandResult => {
		return {
			type: 'message',
			content:
				'Type / to see available commands. Press Ctrl+E to expand output. Press Tab to switch agents.',
		};
	},
};

export const costCmd: SlashCommand = {
	name: 'cost',
	description: 'Show estimated token usage',
	handler: (ctx: CommandContext): CommandResult => {
		const msgCount = ctx.agent.messages.length;
		const chars = ctx.agent.messages.reduce(
			(sum: number, m: any) => sum + (typeof m.content === 'string' ? m.content.length : 0),
			0,
		);
		const approxTokens = Math.round(chars / 4);
		return {
			type: 'message',
			content: `Messages: ${msgCount} | ~${approxTokens} tokens (${chars} chars) in context`,
		};
	},
};

export const packCmd: SlashCommand = {
	name: 'pack',
	description: 'Show pack info or list loaded packs',
	usage: '[pack-name]',
	handler: (ctx: CommandContext): CommandResult => {
		const packs = ctx.config.packs;
		if (!ctx.args) {
			if (packs.length === 0) {
				return {
					type: 'message',
					content: 'No packs loaded. Start with: wmind --pack starter',
				};
			}
			const lines = packs.map((p: any) => {
				const skills = Object.keys(p.skills || {}).length;
				const personas = Object.keys(p.personas || {}).length;
				return `${p.name}@${p.version} -- ${p.description} (${p.tools.length} tools, ${skills} skills, ${personas} personas)`;
			});
			return { type: 'message', content: lines.join('\n'), plainText: true };
		}
		const pack = packs.find((p: any) => p.name === ctx.args);
		if (pack) {
			const skillList = Object.keys(pack.skills || {})
				.map((n: string) => `  - ${n}`)
				.join('\n');
			const personaList = Object.keys(pack.personas || {})
				.map((n: string) => `  - ${n}`)
				.join('\n');
			return {
				type: 'message',
				content: [
					`${pack.name}@${pack.version}`,
					pack.description,
					`Tools: ${pack.tools.length}`,
					skillList ? `Skills:\n${skillList}` : '',
					personaList ? `Personas:\n${personaList}` : '',
				]
					.filter(Boolean)
					.join('\n'),
				plainText: true,
			};
		}
		return {
			type: 'message',
			content: `Pack "${ctx.args}" not loaded. Available: ${packs.map((p: any) => p.name).join(', ') || 'none'}. Use --pack to load at startup.`,
		};
	},
};

export const modelsCmd: SlashCommand = {
	name: 'models',
	description: 'List available models (optionally from a specific provider)',
	usage: '[provider-id]',
	handler: async (ctx: CommandContext): Promise<CommandResult> => {
		const arg = ctx.args.trim();

		if (arg === 'refresh') {
			clearDiscoveryCache();
			clearDiskCache();
			const available = detectAvailableProviders(ctx.config.userConfig);
			const lines: string[] = [];
			for (const provider of available) {
				const models = await getMergedModels(provider, ctx.config.userConfig);
				lines.push(`${provider.displayName}: ${models.length} models`);
			}
			return {
				type: 'message',
				content: `Refreshed model list:\n${lines.join('\n')}`,
				plainText: true,
			};
		}

		if (arg.startsWith('refresh ')) {
			const providerId = arg.slice(8).trim();
			const provider = findProvider(providerId);
			if (!provider) {
				return { type: 'message', content: `Unknown provider: ${providerId}` };
			}
			clearDiscoveryCache(providerId);
			clearDiskCache(providerId);
			const models = await getMergedModels(provider, ctx.config.userConfig);
			return {
				type: 'message',
				content: `${provider.displayName}: ${models.length} models refreshed`,
				plainText: true,
			};
		}

		if (arg) {
			const resolved = resolveAlias(arg);
			const providerId = resolved.includes('/') ? resolved.split('/')[0] : resolved;
			const provider = findProvider(providerId);
			if (!provider) {
				return { type: 'message', content: `Unknown provider: ${providerId}` };
			}
			const models = await getMergedModels(provider, ctx.config.userConfig);
			if (models.length === 0) {
				return {
					type: 'message',
					content: `No models found for ${provider.displayName}`,
				};
			}
			const lines = models.map((m) => {
				const price =
					m.inputPricePer1M === 0
						? 'Free'
						: `$${m.inputPricePer1M}/$${m.outputPricePer1M}`;
				const ctx2 =
					m.contextWindow >= 1_000_000
						? `${(m.contextWindow / 1_000_000).toFixed(1)}M`
						: `${(m.contextWindow / 1000).toFixed(0)}K`;
				const badges = [
					m.supportsReasoning ? 'think' : '',
					m.supportsToolCalling ? 'tools' : '',
				]
					.filter(Boolean)
					.join(',');
				const curated = provider.models.some((c) => c.id === m.id) ? '' : ' [remote]';
				return `${m.id.padEnd(42)} ${price.padEnd(18)} ${ctx2.padEnd(8)} ${badges}${curated}`;
			});
			return {
				type: 'message',
				content: `${provider.displayName} models (${models.length}):\n${lines.join('\n')}`,
				plainText: true,
			};
		}

		const available = detectAvailableProviders(ctx.config.userConfig);
		if (available.length === 0) {
			return {
				type: 'message',
				content: 'No providers configured. Use /connect to set one up.',
			};
		}

		const lines: string[] = [];
		for (const provider of available) {
			const models = await getMergedModels(provider, ctx.config.userConfig);
			const curated = provider.models.length;
			const remote = models.length - curated;
			const remoteLabel = remote > 0 ? ` +${remote} remote` : '';
			lines.push(`${provider.displayName}: ${models.length} models${remoteLabel}`);
		}
		return {
			type: 'message',
			content: `Providers with models:\n${lines.join('\n')}\n\nUse /models <provider> for details.`,
			plainText: true,
		};
	},
};

export const connectCmd: SlashCommand = {
	name: 'connect',
	description: 'Connect or change provider/model (interactive wizard)',
	handler: (_ctx: CommandContext): CommandResult => {
		return { type: 'message', content: '__connect_wizard__' };
	},
};

export const sessionCmd: SlashCommand = {
	name: 'session',
	description: 'Manage sessions -- resume, create, or delete',
	handler: (_ctx: CommandContext): CommandResult => {
		return { type: 'message', content: '__session_wizard__' };
	},
};

export const promptCmd: SlashCommand = {
	name: 'prompt',
	description: 'View, set, or save system prompt',
	usage: '[set <text> | save <name> | list]',
	handler: (ctx: CommandContext): CommandResult => {
		const sub = ctx.args.trim();
		if (!sub) {
			const preview =
				ctx.agent.systemPrompt.length > 300
					? `${ctx.agent.systemPrompt.slice(0, 300)}...`
					: ctx.agent.systemPrompt;
			return {
				type: 'message',
				content: `Current prompt:\n${preview}`,
				plainText: true,
			};
		}
		if (sub === 'list') {
			const uc = ctx.getUserConfig?.();
			if (!uc) return { type: 'message', content: 'Config not available.' };
			const prompts = listSystemPrompts(uc);
			if (prompts.length === 0) return { type: 'message', content: 'No saved prompts.' };
			return {
				type: 'message',
				content: prompts.map((p) => `  ${p.name.padEnd(20)} ${p.preview}`).join('\n'),
				plainText: true,
			};
		}
		if (sub.startsWith('save ')) {
			const name = sub.slice(5).trim();
			if (!name) return { type: 'message', content: 'Usage: /prompt save <name>' };
			const uc = ctx.getUserConfig?.();
			if (!uc) return { type: 'message', content: 'Config not available.' };
			saveSystemPrompt(name, ctx.agent.systemPrompt, uc);
			ctx.writeUserConfig?.(uc);
			return { type: 'message', content: `Saved current prompt as "${name}".` };
		}
		if (sub.startsWith('set ')) {
			const promptText = sub.slice(4).trim();
			if (!promptText) return { type: 'message', content: 'Usage: /prompt set <text>' };
			ctx.setCustomPrompt?.(promptText);
			return { type: 'message', content: 'System prompt updated.' };
		}
		const uc = ctx.getUserConfig?.();
		if (uc) {
			const fromConfig = uc.systemPrompts?.[sub];
			if (fromConfig) {
				ctx.setPersona?.(sub);
				return { type: 'message', content: `Switched to prompt "${sub}".` };
			}
		}
		return {
			type: 'message',
			content: `Unknown prompt "${sub}". Use /prompt list to see saved prompts.`,
		};
	},
};

export function getBuiltInCommands(): SlashCommand[] {
	return [
		clearCmd,
		compactCmd,
		modelCmd,
		modelsCmd,
		skillsCmd,
		skillCmd,
		undoCmd,
		quitCmd,
		quitAliasCmd,
		exitCmd,
		addCmd,
		tabCmd,
		helpCmd,
		costCmd,
		packCmd,
		connectCmd,
		sessionCmd,
		promptCmd,
		ingestCmd,
		memoryCmd,
		lintCmd,
		...getMcpCommands(),
	];
}

export function getPackProvidedCommands(manifest: PackManifest): SlashCommand[] {
	const commands: SlashCommand[] = [];
	const declared = new Set(Object.keys(manifest.commands || {}));

	if (manifest.curation) {
		if (!declared.has('summarize')) commands.push(summarizeCmd);
		if (!declared.has('export')) commands.push(exportCmd);
		if (!declared.has('import')) commands.push(importCmd);
		if (!declared.has('research')) commands.push(researchCmd);
	}

	return commands;
}
