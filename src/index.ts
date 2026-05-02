#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';
import { startAgentTUI } from './app.js';
import { getBuiltInCommands } from './builtins/index.js';
import { loadCommandFiles } from './command-loader.js';
import { CommandRegistry } from './command-registry.js';
import { loadUserConfig, writeUserConfig } from './config.js';
import { loadPacks } from './loader.js';
import { McpRegistry } from './mcp/registry.js';
import { runNonInteractive } from './non-interactive.js';
import {
	installPackFromGit,
	linkPackFromLocal,
	listInstalledPacks,
	removePack,
	updatePack,
} from './pack-install.js';
import { AgentRegistry } from './registry.js';
import { getDefaultModel, PROVIDERS } from './sdk/provider-registry.js';
import {
	isOllamaModelAvailable,
	probeOllama,
	resolveApiKey,
	resolveModelSpec,
	resolveOllamaModelName,
} from './sdk/provider-resolve.js';
import { loadSkillFiles } from './skill-loader.js';
import { SkillRegistry } from './skill-registry.js';
import { listSystemPrompts, saveSystemPrompt } from './system-prompt.js';
import type { AgentConfig } from './types.js';
import { VERSION } from './version.js';
import { listModels, listProviders, runWizard } from './wizard.js';

function collect(value: string, previous: string[]): string[] {
	return previous.concat([value]);
}

const program = new Command()
	.name('openexplorer')
	.aliases(['openExplorer'])
	.description(
		'Open-source terminal AI agent -- write a prompt, load tools, explore',
	)
	.version(VERSION)
	.argument(
		'[prompt]',
		'Initial prompt (starts non-interactive mode if provided)',
	)
	.option(
		'-m, --model <spec>',
		'AI model (provider/model, alias, or tier)',
		process.env.OPENEXPLORER_MODEL || '',
	)
	.option(
		'-p, --prompt <spec>',
		'System prompt: named, file path, or inline text',
	)
	.option('--pack <name>', 'Tool pack to load (repeatable)', collect, [])
	.option(
		'--add-agent <persona>',
		'Additional agent tab (repeatable)',
		collect,
		[],
	)
	.option('--api-key <key>', 'API key (or auto-detect from env vars)')
	.option('--base-url <url>', 'Custom API base URL')
	.option('--non-interactive', 'No TUI -- for CI/scripts')
	.option('--auto-approve', 'Auto-approve destructive tool calls')
	.option('--max-turns <n>', 'Max tool-call turns', '20')
	.option('--no-thinking', 'Hide reasoning/thinking blocks')
	.option('--configure', 'Run first-run / re-configuration wizard')
	.option('--list-providers', 'Show all curated providers + detected API keys')
	.option(
		'--list-models [provider]',
		'Show models for a provider (or all with keys)',
	)
	.option('--list-prompts', 'Show saved system prompts')
	.option('--list-packs', 'Show installed tool packs')
	.option(
		'--save-prompt <name>',
		'Save current system prompt to config library',
	)
	.action(async (prompt, opts) => {
		if (opts.listProviders) {
			await listProviders();
			return;
		}

		if (opts.listModels !== undefined) {
			await listModels(
				typeof opts.listModels === 'string' ? opts.listModels : undefined,
			);
			return;
		}

		if (opts.configure) {
			await runWizard();
			return;
		}

		if (opts.listPacks) {
			const packs = listInstalledPacks();
			if (packs.length === 0) {
				console.log(
					pc.dim(
						'No packs installed. Use "openexplorer pack install <url>" to add one.',
					),
				);
			} else {
				console.log(pc.bold('\nInstalled Packs:\n'));
				for (const p of packs) {
					const source = p.linked ? pc.cyan('(linked)') : pc.dim(p.source);
					console.log(`  ${pc.bold(p.name)}@${p.version}  ${source}`);
				}
				console.log('');
			}
			return;
		}

		const userConfig = loadUserConfig();

		if (opts.listPrompts) {
			const prompts = listSystemPrompts(userConfig);
			if (prompts.length === 0) {
				console.log(pc.dim('No saved system prompts.'));
				return;
			}
			console.log(pc.bold('\nSaved System Prompts:\n'));
			for (const p of prompts) {
				console.log(`  ${pc.cyan(p.name.padEnd(20))} ${pc.dim(p.preview)}`);
			}
			console.log('');
			return;
		}

		if (opts.savePrompt) {
			const name = opts.savePrompt;
			const promptText =
				opts.prompt || 'You are OpenExplorer, a reasoning agent.';
			saveSystemPrompt(name, promptText, userConfig);
			writeUserConfig(userConfig);
			console.log(pc.green(`Saved system prompt "${name}"`));
			return;
		}

		const skillRegistry = new SkillRegistry();
		const commandRegistry = new CommandRegistry();
		const mcpRegistry = new McpRegistry();

		commandRegistry.registerAll(getBuiltInCommands());
		skillRegistry.registerAll(loadSkillFiles());
		commandRegistry.registerAll(loadCommandFiles());

		console.error(pc.cyan(`OpenExplorer v${VERSION}`));
		console.error(pc.dim('  Initializing...'));

		const ollama = await probeOllama();

		let ollamaDefault = '';
		if (ollama.running && ollama.models.length > 0) {
			const ollamaProvider = PROVIDERS.find((p) => !p.needsApiKey);
			const prefs = ollamaProvider?.localProvider?.preferredModels ?? [];
			const preferred =
				prefs
					.map((prefix) => ollama.models.find((m) => m.name.startsWith(prefix)))
					.find(Boolean) ?? ollama.models[0];
			if (preferred) ollamaDefault = `ollama/${preferred.name}`;
		}

		const modelSpec =
			opts.model ||
			userConfig.defaultModel ||
			ollamaDefault ||
			getDefaultModel();
		const resolved = resolveModelSpec(modelSpec, userConfig);

		let apiKey = opts.apiKey || '';
		if (!apiKey) {
			apiKey = resolveApiKey(resolved.provider, userConfig);
		}

		const needsKey = resolved.provider.needsApiKey;

		if (needsKey && !apiKey) {
			if (!ollama.running) {
				console.error(pc.red('Error: No API key detected.'));
				console.error(pc.dim('  Run: openexplorer --configure'));
				const envVars = PROVIDERS.filter((p) => p.needsApiKey && p.envVar)
					.map((p) => p.envVar)
					.slice(0, 4)
					.join(', ');
				console.error(pc.dim(`  Or set env vars: ${envVars}, etc.`));
				process.exit(1);
			}
		}

		let modelId = resolved.model?.id || modelSpec;

		if (resolved.provider.id === 'ollama' && ollama.running) {
			const ollamaModel = modelId.includes('/')
				? modelId.split('/').slice(1).join('/')
				: modelId;
			const resolvedName = resolveOllamaModelName(ollamaModel, ollama.models);
			if (resolvedName !== ollamaModel) {
				console.error(pc.dim(`  Resolved: ${ollamaModel} -> ${resolvedName}`));
			}
			modelId = resolvedName;

			if (!isOllamaModelAvailable(resolvedName, ollama.models)) {
				console.error(
					pc.yellow(`Warning: Model "${resolvedName}" not found locally.`),
				);
				console.error(
					pc.dim(
						`  Available models: ${ollama.models
							.slice(0, 5)
							.map((m) => m.name)
							.join(', ')}${ollama.models.length > 5 ? '...' : ''}`,
					),
				);
				console.error(pc.dim(`  Pull it first: ollama pull ${resolvedName}`));
				process.exit(1);
			}
		}

		const baseUrl = opts.baseUrl || resolved.baseUrl;

		const config: AgentConfig = {
			model: modelId,
			persona: opts.prompt,
			apiKey,
			baseUrl,
			nonInteractive: !!prompt,
			initialPrompt: prompt,
			maxTurns: parseInt(opts.maxTurns, 10),
			autoApprove: opts.autoApprove,
			noThinking: opts.noThinking,
			packs: [],
			userConfig,
		};

		const providerLabel = resolved.provider.displayName;
		const modelLabel = resolved.model?.displayName || config.model;
		const priceLabel =
			resolved.model && resolved.model.inputPricePer1M > 0
				? ` ($${resolved.model.inputPricePer1M}/$${resolved.model.outputPricePer1M})`
				: resolved.model?.inputPricePer1M === 0
					? ' (free)'
					: '';
		console.error(
			pc.dim(`  Model: ${providerLabel} / ${modelLabel}${priceLabel}`),
		);

		const packResult = await loadPacks(
			opts.pack.length > 0 && opts.pack[0] !== 'none'
				? opts.pack
				: opts.pack[0] === 'none'
					? []
					: ['starter'],
			skillRegistry,
			commandRegistry,
			userConfig,
			mcpRegistry,
		);
		config.packs = packResult.packs;
		if (packResult.systemPromptOverride) {
			config.systemPrompt = packResult.systemPromptOverride;
		}

		if (packResult.packs.length > 0) {
			console.error(
				pc.dim(
					`  Packs: ${packResult.packs.map((p) => `${p.name}@${p.version} (${Object.keys(p.skills || {}).length} skills)`).join(', ')}`,
				),
			);
		} else {
			console.error(pc.dim('  No packs loaded -- reasoning-only mode'));
		}

		const skillCount = skillRegistry.getAll().length;
		const cmdCount = commandRegistry.getAll().length;
		if (skillCount > 0)
			console.error(pc.dim(`  Skills: ${skillCount} available`));
		if (cmdCount > 0 && cmdCount > 14)
			console.error(pc.dim(`  Commands: ${cmdCount} registered`));

		mcpRegistry.loadFromConfig(userConfig);

		const mcpServers = mcpRegistry.listServers();
		const enabledCount = mcpServers.filter((s) => s.enabled).length;
		const skippedCount = mcpServers.filter((s) => !s.enabled).length;
		if (enabledCount > 0) {
			console.error(
				pc.dim(`  MCP: ${enabledCount} server(s) connecting in background...`),
			);
		}
		if (skippedCount > 0) {
			const skipped = mcpServers.filter((s) => !s.enabled).map((s) => s.name);
			console.error(
				pc.yellow(
					`  MCP: ${skippedCount} skipped (set API keys to enable): ${skipped.join(', ')}`,
				),
			);
		}

		const registry = new AgentRegistry();
		registry.setPacks(packResult.packs);
		registry.setUserConfig(userConfig);
		registry.setSkillRegistry(skillRegistry);
		registry.setMcpRegistry(mcpRegistry);

		const defaultName =
			opts.prompt ||
			(packResult.packs.length > 0 ? packResult.packs[0].name : 'Agent');
		registry.createAgent({
			name: defaultName,
			persona: opts.prompt,
			model: config.model,
			systemPromptOverride: config.systemPrompt,
		});

		for (const persona of opts.addAgent || []) {
			registry.createAgent({ name: persona, persona, model: config.model });
		}

		console.error(
			pc.dim(
				`  Agents: ${registry.getCount()} (${registry
					.getAll()
					.map((a) => a.name)
					.join(', ')})`,
			),
		);
		console.error('');

		if (config.nonInteractive && prompt) {
			const result = await mcpRegistry.connectAllParallel();
			console.error(
				pc.dim(
					`  MCP: ${result.connected.length} connected (${result.failed.length} failed)`,
				),
			);
			registry.rebuildMcpTools();
			await runNonInteractive(prompt, config, registry, mcpRegistry);
		} else {
			try {
				await startAgentTUI(
					config,
					registry,
					commandRegistry,
					skillRegistry,
					mcpRegistry,
				);
			} catch (err: any) {
				if (err.message !== 'exit') throw err;
			}
			registry.saveSessions();
			await mcpRegistry.disconnectAll();
			const mcpConfigs = mcpRegistry.getConfigs();
			if (Object.keys(mcpConfigs).length > 0) {
				userConfig.mcpServers = mcpConfigs;
				writeUserConfig(userConfig);
			}
		}
	});

program
	.command('pack')
	.description('Manage packs -- install, list, update, remove')
	.addCommand(
		new Command('install')
			.description('Install a pack from a git URL')
			.argument('<url>', 'Git repository URL')
			.option('--tag <tag>', 'Git tag to checkout')
			.action(async (url: string, opts: any) => {
				const result = installPackFromGit(url, opts.tag);
				if (result.errors.length > 0) {
					console.error(pc.red('Install failed:'));
					for (const e of result.errors) console.error(pc.dim(`  ${e}`));
					process.exit(1);
				}
				console.log(pc.green(`Installed pack "${result.name}"`));
			}),
	)
	.addCommand(
		new Command('link')
			.description('Link a local pack directory (for development)')
			.argument('<path>', 'Local directory containing pack.json')
			.action((localPath: string) => {
				const result = linkPackFromLocal(localPath);
				if (result.errors.length > 0) {
					console.error(pc.red('Link failed:'));
					for (const e of result.errors) console.error(pc.dim(`  ${e}`));
					process.exit(1);
				}
				console.log(pc.green(`Linked pack "${result.name}"`));
			}),
	)
	.addCommand(
		new Command('list').description('List installed packs').action(() => {
			const packs = listInstalledPacks();
			if (packs.length === 0) {
				console.log(pc.dim('No packs installed.'));
				return;
			}
			for (const p of packs) {
				const source = p.linked ? pc.cyan('(linked)') : pc.dim(p.source);
				console.log(`  ${pc.bold(p.name)}@${p.version}  ${source}`);
			}
		}),
	)
	.addCommand(
		new Command('update')
			.description('Update an installed pack')
			.argument('<name>', 'Pack name')
			.action((name: string) => {
				const result = updatePack(name);
				if (!result.success) {
					console.error(pc.red(result.error || 'Update failed'));
					process.exit(1);
				}
				console.log(pc.green(`Updated pack "${name}"`));
			}),
	)
	.addCommand(
		new Command('remove')
			.description('Remove an installed pack')
			.argument('<name>', 'Pack name')
			.action((name: string) => {
				const result = removePack(name);
				if (!result.success) {
					console.error(pc.red(result.error || 'Remove failed'));
					process.exit(1);
				}
				console.log(pc.green(`Removed pack "${name}"`));
			}),
	);

program.parse();
