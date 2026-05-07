import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import {
	type CliRenderer,
	createCliRenderer,
	decodePasteBytes,
	type PasteEvent,
} from '@opentui/core';
import { createRoot, useKeyboard, useTerminalDimensions } from '@opentui/react';
import { createElement as h, useCallback, useEffect, useRef, useState } from 'react';
import { listMdFiles } from './builtins/ingest-cmd.js';
import type { CommandRegistry } from './command-registry.js';
import type { McpEnvVarDef } from './config.js';
import { writeUserConfig } from './config.js';
import { ConnectWizard, type ConnectWizardHandle } from './connect-wizard.js';
import type { McpRegistry, McpServerInfo } from './mcp/registry.js';
import { McpWizard, type McpWizardHandle } from './mcp-wizard.js';
import { findCrossLinks } from './memory/auto-link.js';
import { parseMemoryJsonl, writeKnowledgeIndex } from './memory/render.js';
import { MemoryWizard, type MemoryWizardHandle } from './memory-wizard.js';
import { getStorePath } from './paths.js';
import { shouldConfirm } from './permissions.js';
import type { AgentRegistry, SessionSummary } from './registry.js';
import type { CommandContext, HistoryEntry } from './sdk/command.js';
import { calculateTurnCost } from './sdk/cost-calc.js';
import { debounce } from './sdk/debounce.js';
import { RequestCancelledError, runAgent } from './sdk/loop.js';
import { classifyProviderError, formatErrorForDisplay } from './sdk/provider-error.js';
import { findProvider } from './sdk/provider-registry.js';
import {
	cacheApiKey,
	resolveApiKey,
	resolveApiKeyAsync,
	resolveModelSpec,
} from './sdk/provider-resolve.js';
import { SessionWizard, type SessionWizardHandle } from './session-wizard.js';
import type { SkillRegistry } from './skill-registry.js';
import { refreshKnowledgeIndex } from './system-prompt.js';
import type { AgentConfig } from './types.js';
import { AppShell } from './ui2/app-shell.js';
import { ChatScroll, type ChatScrollHandle } from './ui2/chat-scroll.js';
import { HelpOverlay } from './ui2/help-overlay.js';
import { computeInputBarHeight, InputBar } from './ui2/input-bar.js';
import { Sidebar } from './ui2/sidebar.js';

const COMPACTION_THRESHOLD = 200;
const COMPACTION_KEEP = 50;

function MultiAgentApp({
	config,
	registry,
	commandRegistry,
	skillRegistry,
	mcpRegistry,
	renderer,
}: {
	config: AgentConfig;
	registry: AgentRegistry;
	commandRegistry: CommandRegistry;
	skillRegistry: SkillRegistry;
	mcpRegistry: McpRegistry;
	renderer: CliRenderer;
}) {
	const dims = useTerminalDimensions();
	const termRows = dims.height || 40;
	const termCols = dims.width || 120;
	const [activeId, setActiveId] = useState<string>(registry.getActive()?.id || '');
	const [_tick, setTick] = useState(0);
	const [input, setInput] = useState('');
	const [inputCursor, setInputCursor] = useState(0);
	const [inputHistory, setInputHistory] = useState<string[]>([]);
	const [inputHistoryIdx, setInputHistoryIdx] = useState(-1);
	const [history, setHistory] = useState<HistoryEntry[]>([]);
	const [isStreaming, setIsStreaming] = useState(false);
	const confirmationResolveRef = useRef<((approved: boolean) => void) | null>(null);
	const [isExecuting, setIsExecuting] = useState(false);
	const [_currentTool, setCurrentTool] = useState<string | null>(null);
	const [waitingConfirmation, setWaitingConfirmation] = useState<{
		name: string;
		args: any;
	} | null>(null);
	const [waitingCmdConfirmation, setWaitingCmdConfirmation] = useState<{
		message: string;
		command: string;
		args: string;
	} | null>(null);
	const [msgCount, setMsgCount] = useState(0);
	const [charCount, setCharCount] = useState(0);
	const [sidebarWidth, setSidebarWidth] = useState(26);
	const [sessionStartTs] = useState(Date.now());
	const [_tokenUsage, setTokenUsage] = useState<{
		promptTokens: number;
		completionTokens: number;
	}>({ promptTokens: 0, completionTokens: 0 });
	const [sessionCost, setSessionCost] = useState(0);
	const [mcpServers, setMcpServers] = useState<McpServerInfo[]>(mcpRegistry.listServers());
	const [scrolledUp, setScrolledUp] = useState(false);
	const [rawMode, _setRawMode] = useState(false);
	const [expandAll, setExpandAll] = useState(false);
	const [showHelp, setShowHelp] = useState(false);
	const [turnCount, setTurnCount] = useState(0);
	const [projects, setProjects] = useState<SessionSummary[]>(registry.listSessions());
	const [cwdFiles, setCwdFiles] = useState<string[]>(listMdFiles());
	const [wizardActive, setWizardActive] = useState(false);
	const wizardRef = useRef<McpWizardHandle>(null);
	const [reconnectTarget, setReconnectTarget] = useState<
		{ serverName: string; requiredEnvVars: McpEnvVarDef[] } | undefined
	>(undefined);
	const [connectWizardActive, setConnectWizardActive] = useState(false);
	const connectWizardRef = useRef<ConnectWizardHandle>(null);
	const [sessionWizardActive, setSessionWizardActive] = useState(false);
	const sessionWizardRef = useRef<SessionWizardHandle>(null);
	const [memoryWizardActive, setMemoryWizardActive] = useState(false);
	const memoryWizardRef = useRef<MemoryWizardHandle>(null);
	const chatScrollRef = useRef<ChatScrollHandle>(null);
	const scrollboxRef = useRef<any>(null);

	const active = registry.getActive() ?? registry.getAll()[0];
	const contentWidth = Math.max(20, termCols - sidebarWidth - 4);
	const inputBarHeight = computeInputBarHeight(
		input,
		isStreaming,
		!!waitingConfirmation,
		!!waitingCmdConfirmation,
		waitingCmdConfirmation?.message ?? '',
		termCols,
	);
	const chatAvailableRows = Math.max(10, termRows - inputBarHeight - 1);

	const streamingEntryIdRef = useRef<number>(0);
	const thinkingEntryIdRef = useRef<number>(0);
	const streamContentRef = useRef('');
	const thinkingContentRef = useRef('');
	const currentTurnIdRef = useRef<number>(0);
	const lastToolCallTimeRef = useRef<number>(0);
	const flushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const abortControllerRef = useRef<AbortController | null>(null);
	const lastEscTimeRef = useRef(0);
	const runAgentTurnRef = useRef<(text: string, agent: any) => Promise<void>>(async () => {});
	const crossLinkBatchRef = useRef<{ from: string; to: string; relationType: string }[]>([]);
	const rebuildIndexRef = useRef(
		debounce(() => {
			const storeName = config.userConfig?.lastMemoryStore || 'default';
			const storePath = getStorePath(storeName);
			try {
				if (!existsSync(storePath)) return;
				const content = readFileSync(storePath, 'utf-8');
				const graph = parseMemoryJsonl(content);
				writeKnowledgeIndex(graph, storeName);

				const activeAgent = registry.getActive();
				if (activeAgent) {
					activeAgent.systemPrompt = refreshKnowledgeIndex(activeAgent.systemPrompt);
				}

				const crossLinks = findCrossLinks(graph);
				if (crossLinks.length > 0 && mcpRegistry) {
					const batch = crossLinks.slice(0, 20);
					const memTools = mcpRegistry.getTools();
					const createRels = memTools.find(
						(t: any) => t.name === 'mcp__memory__create_relations',
					);
					if (createRels) {
						crossLinkBatchRef.current = batch;
						createRels.execute({ relations: batch }).catch(() => {
							crossLinkBatchRef.current = [];
						});
					}
				}
			} catch {}
		}, 500),
	);

	useEffect(() => {
		if (history.length > COMPACTION_THRESHOLD && !isStreaming) {
			const removed = history.length - COMPACTION_KEEP;
			setHistory((prev) => {
				if (prev.length <= COMPACTION_THRESHOLD) return prev;
				const kept = prev.slice(-COMPACTION_KEEP);
				return [
					{
						id: Date.now(),
						role: 'assistant',
						content: `[Auto-compacted: ${removed} older messages removed. Use /compact for LLM-powered summary.]`,
						plainText: true,
					},
					...kept,
				];
			});
		}
	}, [history.length, isStreaming]);

	useEffect(() => {
		return mcpRegistry.onStatusChange((servers) => {
			setMcpServers([...servers]);
			registry.rebuildMcpTools();
			setTick((t) => t + 1);
		});
	}, [mcpRegistry, registry]);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const result = await mcpRegistry.connectAllParallel();
			if (cancelled) return;
			if (result.connected.length > 0 || result.failed.length > 0) {
				registry.rebuildMcpTools();
				mcpRegistry.persistMcpConfigs();
				setTick((t) => t + 1);
			}

			const allCommands = commandRegistry.getAll();
			const allowedToolsLists = allCommands
				.filter((cmd) => cmd.allowedTools && cmd.allowedTools.length > 0)
				.map((cmd) => ({
					source: `/${cmd.name}`,
					tools: cmd.allowedTools as string[],
				}));
			const warnings = mcpRegistry.validateToolReferences(allowedToolsLists);
			for (const w of warnings) {
				console.error(`[tool-validation] ${w}`);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [mcpRegistry, registry, commandRegistry.getAll]);

	const activateSkill = useCallback(
		(name: string): string | null => {
			const desc = registry.activateSkill(name);
			if (desc) setTick((t) => t + 1);
			return desc;
		},
		[registry],
	);

	const deactivateSkill = useCallback(
		(name: string): void => {
			registry.deactivateSkill(name);
			setTick((t) => t + 1);
		},
		[registry],
	);

	const flushStreamingBuffers = useCallback(() => {
		const thinkingContent = thinkingContentRef.current;
		const streamContent = streamContentRef.current;
		const thinkingId = thinkingEntryIdRef.current;
		const streamId = streamingEntryIdRef.current;
		if (!thinkingContent && !streamContent) return;
		setHistory((prev) =>
			prev.map((e) => {
				if (thinkingId && e.id === thinkingId && thinkingContent) {
					return { ...e, content: e.content + thinkingContent };
				}
				if (streamId && e.id === streamId && streamContent) {
					return { ...e, content: e.content + streamContent };
				}
				return e;
			}),
		);
		thinkingContentRef.current = '';
		streamContentRef.current = '';
	}, []);

	const scheduleFlush = useCallback(() => {
		if (flushTimerRef.current) return;
		flushTimerRef.current = setTimeout(() => {
			flushStreamingBuffers();
			flushTimerRef.current = undefined;
		}, 33);
	}, [flushStreamingBuffers]);

	const wizardDone = useCallback((message: string) => {
		setWizardActive(false);
		setReconnectTarget(undefined);
		if (message) {
			setHistory((prev) => [
				...prev,
				{ id: Date.now(), role: 'assistant', content: message },
			]);
		}
	}, []);

	const connectWizardDone = useCallback(
		(message: string, model?: string) => {
			setConnectWizardActive(false);
			if (model) {
				registry.switchModel(model);
				config.model = model;
				if (model.includes('/')) {
					const providerId = model.split('/')[0];
					const provider = findProvider(providerId);
					if (provider?.needsApiKey) {
						const apiKey = resolveApiKey(provider, config.userConfig);
						if (!apiKey) {
							resolveApiKeyAsync(provider, config.userConfig).then((key) => {
								if (key) {
									cacheApiKey(provider.id, key);
								} else {
									setHistory((prev) => [
										...prev,
										{
											id: Date.now(),
											role: 'assistant',
											content: `Warning: No API key found for ${provider.displayName}. Chat may fail. Use /connect to set one up.`,
										},
									]);
								}
								setTick((t) => t + 1);
							});
						} else {
							cacheApiKey(provider.id, apiKey);
						}
					}
				}
				setTick((t) => t + 1);
			}
			if (message) {
				setHistory((prev) => [
					...prev,
					{ id: Date.now(), role: 'assistant', content: message },
				]);
			}
		},
		[registry, config],
	);

	const sessionWizardDone = useCallback(
		(message: string) => {
			setSessionWizardActive(false);
			const agent = registry.getActive();
			if (agent) {
				setActiveId(agent.id);
				if (agent.messages.length > 0) {
					const entries: HistoryEntry[] = [];
					for (const msg of agent.messages) {
						if (msg.role === 'system') continue;
						if (msg.tool_calls) {
							for (const tc of msg.tool_calls) {
								entries.push({
									id: entries.length + 1,
									role: 'tool_call',
									content:
										typeof tc.arguments === 'string'
											? tc.arguments
											: JSON.stringify(tc.arguments),
									name: tc.name,
								});
							}
						} else if (msg.role === 'tool') {
							entries.push({
								id: entries.length + 1,
								role: 'tool_result',
								content:
									typeof msg.content === 'string'
										? msg.content
										: JSON.stringify(msg.content),
								name: msg.name,
							});
						} else {
							const role = msg.role as HistoryEntry['role'];
							entries.push({
								id: entries.length + 1,
								role,
								content:
									typeof msg.content === 'string'
										? msg.content
										: JSON.stringify(msg.content),
							});
						}
					}
					setHistory(entries);
					setMsgCount(entries.length);
					const totalChars = entries.reduce((sum, e) => sum + e.content.length, 0);
					setCharCount(totalChars);
				} else {
					setHistory(
						message ? [{ id: Date.now(), role: 'assistant', content: message }] : [],
					);
				}
			}
			setTick((t) => t + 1);
			setProjects(registry.listSessions());
			setCwdFiles(listMdFiles());
		},
		[registry],
	);

	const memoryWizardDone = useCallback((message: string) => {
		setMemoryWizardActive(false);
		if (message) {
			setHistory((prev) => [
				...prev,
				{
					id: Date.now(),
					role: 'assistant',
					content: message,
					plainText: true,
				},
			]);
		}
	}, []);

	const handleSubmit = useCallback(
		async (text: string) => {
			const agent = registry.getActive();
			if (!agent) return;
			setScrolledUp(false);
			const resolved = commandRegistry.resolve(text);
			if (resolved) {
				const ctx: CommandContext & { mcpRegistry: McpRegistry } = {
					args: resolved.args,
					agent,
					config,
					setHistory,
					setInput,
					exit: () => {
						renderer.destroy();
					},
					activateSkill,
					deactivateSkill,
					mcpRegistry,
					setPersona: (persona: string) => registry.setPersona(persona),
					setCustomPrompt: (promptText: string) => registry.setCustomPrompt(promptText),
					getUserConfig: () => config.userConfig,
					writeUserConfig: (uc: any) => writeUserConfig(uc),
				};

				if (resolved.command.name === 'help') {
					setHistory((prev) => [
						...prev,
						{
							id: Date.now(),
							role: 'assistant',
							content: commandRegistry.getHelpText(),
							plainText: true,
						},
					]);
					return;
				}
				if (resolved.command.name === 'add') {
					const name = resolved.args || `Agent-${registry.getCount() + 1}`;
					const pack = resolved.args
						? config.packs.find((p: any) => p.name === resolved.args)
						: null;
					const firstPersona = pack ? Object.keys(pack.personas || {})[0] : undefined;
					const newAgent = registry.createAgent({
						name,
						persona: firstPersona || undefined,
						model: config.model,
						packName: pack?.name,
						systemPromptOverride: pack?.systemPrompt,
					});
					setActiveId(newAgent.id);
					setTick((t) => t + 1);
					setHistory((prev) => [
						...prev,
						{
							id: Date.now(),
							role: 'assistant',
							content: pack
								? `Added agent from pack: ${pack.name}/${firstPersona || 'default'}`
								: `Added agent: ${name}`,
						},
					]);
					return;
				}
				if (
					resolved.command.name === 'q' ||
					resolved.command.name === 'quit' ||
					resolved.command.name === 'exit'
				) {
					registry.saveSessions();
					renderer.destroy();
					return;
				}
				if (resolved.command.name === 'mcp-add') {
					setWizardActive(true);
					return;
				}
				if (resolved.command.name === 'connect') {
					setConnectWizardActive(true);
					return;
				}
				if (resolved.command.name === 'session') {
					setSessionWizardActive(true);
					return;
				}

				if (resolved.command.name === 'ingest') {
					setCwdFiles(listMdFiles());
				}
				const result = await resolved.command.handler(ctx);
				if (result.type === 'message') {
					setHistory((prev) => [
						...prev,
						{
							id: Date.now(),
							role: 'assistant',
							content: result.content,
							plainText: result.plainText,
						},
					]);
				} else if (result.type === 'add-pack-agent') {
					const pack = config.packs.find((p: any) => p.name === result.packName);
					if (pack) {
						const firstPersona = Object.keys(pack.personas || {})[0];
						const newAgent = registry.createAgent({
							name: result.packName,
							persona: firstPersona,
							model: config.model,
							packName: result.packName,
							systemPromptOverride: pack?.systemPrompt,
						});
						setActiveId(newAgent.id);
						setTick((t) => t + 1);
						setHistory((prev) => [
							...prev,
							{
								id: Date.now(),
								role: 'assistant',
								content: `Added agent from pack: ${result.packName}/${firstPersona || 'default'}`,
							},
						]);
					}
				} else if (result.type === 'reconnect-server') {
					setReconnectTarget({
						serverName: result.serverName,
						requiredEnvVars: result.requiredEnvVars,
					});
					setWizardActive(true);
				} else if (result.type === 'reconnect-memory-store') {
					const rStoreName = result.storeName;
					const storePath = getStorePath(rStoreName);
					const reconnectResult = await mcpRegistry.reconnectMemoryStore(
						rStoreName,
						storePath,
					);
					if (reconnectResult.success) {
						const parts: string[] = [];
						if (result.deletedStore)
							parts.push(
								`Deleted store '${result.deletedStore}' (${result.deletedEntityCount ?? 0} entities, ${result.deletedObsCount ?? 0} observations).`,
							);
						parts.push(
							`Switched to memory store '${rStoreName}' (${reconnectResult.entityCount} entities)`,
						);
						setHistory((prev) => [
							...prev,
							{
								id: Date.now(),
								role: 'assistant',
								content: parts.join('\n'),
								plainText: true,
							},
						]);
					} else {
						setHistory((prev) => [
							...prev,
							{
								id: Date.now(),
								role: 'error',
								content: `Failed to reconnect memory store '${rStoreName}': ${reconnectResult.error}`,
							},
						]);
					}
					return;
				} else if (result.type === 'open-memory-wizard') {
					setMemoryWizardActive(true);
					return;
				} else if (result.type === 'confirm') {
					setWaitingCmdConfirmation({
						message: result.message,
						command: result.command,
						args: result.args,
					});
					setHistory((prev) => [
						...prev,
						{
							id: Date.now(),
							role: 'assistant',
							content: result.message,
							plainText: true,
						},
					]);
					return;
				} else if (result.type === 'trigger-agent') {
					const savedTools = agent.tools;
					const savedSystemPrompt = agent.systemPrompt;
					const savedCurrentTask = agent.currentTask;

					if (result.allowedTools && result.allowedTools.length > 0) {
						const filtered = agent.tools.filter((t: any) =>
							result.allowedTools?.includes(t.name),
						);
						if (filtered.length > 0) {
							agent.tools = filtered;
						} else {
							const availableNames = agent.tools.map((t: any) => t.name);
							const missingNames = result.allowedTools?.filter(
								(n: string) => !availableNames.includes(n),
							);
							if (agent.currentTask && missingNames.length > 0) {
								agent.currentTask += `\n\nNote: The following tools from this command are not currently connected: ${missingNames.join(', ')}. Proceed with available tools: ${availableNames.join(', ')}.`;
							}
						}
					}

					try {
						registry.rebuildForTask(agent, agent.tools);
					} catch {
						agent.systemPrompt = `${savedSystemPrompt}\n\n## Current Task\n${agent.currentTask || ''}`;
					}

					agent.messages.push({ role: 'user', content: result.content });

					await runAgentTurnRef.current(result.content, agent);

					agent.tools = savedTools;
					agent.systemPrompt = savedSystemPrompt;
					agent.currentTask = savedCurrentTask;
				}
				return;
			}

			const autoSkill = skillRegistry.findAutoDiscoverable(text);
			if (autoSkill && !skillRegistry.isActive(autoSkill.name)) {
				if (
					active.packName &&
					autoSkill.packName &&
					autoSkill.packName !== active.packName
				) {
					// skip skills from other packs
				} else {
					registry.activateSkill(autoSkill.name);
					setHistory((prev) => [
						...prev,
						{
							id: Date.now(),
							role: 'assistant',
							content: `Auto-activated skill: ${autoSkill.name}`,
						},
					]);
				}
			}

			agent.messages.push({ role: 'user', content: text });
			await runAgentTurnRef.current(text, agent);
		},
		[
			registry,
			config,
			commandRegistry,
			skillRegistry,
			mcpRegistry,
			activateSkill,
			deactivateSkill,
			renderer,
			active.packName,
		],
	);

	async function runAgentTurn(text: string, agent: any) {
		const turnId = Date.now();
		currentTurnIdRef.current = turnId;
		setHistory((prev) => [
			...prev,
			{ id: turnId, role: 'user', content: text, parentId: turnId },
		]);
		setMsgCount((m) => m + 1);
		setCharCount((c) => c + text.length);
		setIsStreaming(true);
		streamingEntryIdRef.current = 0;
		thinkingEntryIdRef.current = 0;
		streamContentRef.current = '';
		thinkingContentRef.current = '';
		setTurnCount(0);
		agent.status = 'streaming';
		const abortController = new AbortController();
		abortControllerRef.current = abortController;
		const responseCostRef = { promptTokens: 0, completionTokens: 0, cost: 0 };

		try {
			const result = await runAgent(agent.messages, {
				model: agent.model,
				systemPrompt: agent.systemPrompt,
				tools: agent.tools,
				maxTurns: config.maxTurns || 20,
				userConfig: config.userConfig,
				signal: abortController.signal,
				onThinking: (t: string) => {
					if (!thinkingEntryIdRef.current) {
						if (streamingEntryIdRef.current) {
							const sId = streamingEntryIdRef.current;
							setHistory((prev) =>
								prev.map((e) => (e.id === sId ? { ...e, streaming: false } : e)),
							);
						}
						const id = Date.now();
						thinkingEntryIdRef.current = id;
						setHistory((prev) => [
							...prev,
							{
								id,
								role: 'thinking',
								content: '',
								parentId: turnId,
								streaming: true,
								startTime: id,
							},
						]);
					}
					thinkingContentRef.current += t;
					scheduleFlush();
				},
				onText: (t: string) => {
					if (thinkingEntryIdRef.current) {
						const tId = thinkingEntryIdRef.current;
						const endTime = Date.now();
						setHistory((prev) =>
							prev.map((e) =>
								e.id === tId ? { ...e, streaming: false, endTime } : e,
							),
						);
						thinkingEntryIdRef.current = 0;
					}
					if (!streamingEntryIdRef.current) {
						const id = Date.now();
						streamingEntryIdRef.current = id;
						setHistory((prev) => [
							...prev,
							{
								id,
								role: 'assistant',
								content: '',
								parentId: turnId,
								streaming: true,
							},
						]);
					}
					streamContentRef.current += t;
					scheduleFlush();
				},
				onToolCall: async (name: string, args: any) => {
					const argsStr = typeof args === 'string' ? args : JSON.stringify(args);
					setTurnCount((c) => c + 1);
					flushStreamingBuffers();
					if (flushTimerRef.current) {
						clearTimeout(flushTimerRef.current);
						flushTimerRef.current = undefined;
					}
					if (streamingEntryIdRef.current) {
						const sId = streamingEntryIdRef.current;
						setHistory((prev) =>
							prev.map((e) => (e.id === sId ? { ...e, streaming: false } : e)),
						);
						streamingEntryIdRef.current = 0;
					}
					if (thinkingEntryIdRef.current) {
						const tId = thinkingEntryIdRef.current;
						setHistory((prev) =>
							prev.map((e) => (e.id === tId ? { ...e, streaming: false } : e)),
						);
						thinkingEntryIdRef.current = 0;
					}
					const tool = agent.tools.find((tool: any) => tool.name === name);
					if (tool && !config.autoApprove && shouldConfirm(tool, config.userConfig)) {
						setWaitingConfirmation({ name, args: argsStr });
						setCurrentTool(name);
						setHistory((prev) => [
							...prev,
							{
								id: Date.now(),
								role: 'tool_call',
								content: 'Confirmation needed',
								name,
								parentId: turnId,
							},
						]);
						return new Promise<boolean>((resolve) => {
							confirmationResolveRef.current = resolve;
						});
					}
					setCurrentTool(name);
					setIsExecuting(true);
					agent.status = 'executing';
					const toolCallTime = Date.now();
					lastToolCallTimeRef.current = toolCallTime;
					setHistory((prev) => [
						...prev,
						{
							id: toolCallTime,
							role: 'tool_call',
							content: argsStr.length > 200 ? `${argsStr.slice(0, 200)}...` : argsStr,
							name,
							parentId: turnId,
							startTime: toolCallTime,
						},
					]);
					return true;
				},
				onToolResult: (name: string, toolResult: any) => {
					setCurrentTool(null);
					setIsExecuting(false);
					agent.status = 'streaming';

					if (
						name.startsWith('mcp__memory__') &&
						(name.includes('create_entities') ||
							name.includes('add_observations') ||
							name.includes('create_relations'))
					) {
						const isCrossLinkBatch =
							crossLinkBatchRef.current.length > 0 &&
							name.includes('create_relations');
						if (isCrossLinkBatch) {
							crossLinkBatchRef.current = [];
						} else {
							rebuildIndexRef.current();
						}
					}

					let output: string;
					if (typeof toolResult === 'string') {
						output = toolResult;
					} else if (toolResult?.content !== undefined) {
						output =
							typeof toolResult.content === 'string'
								? toolResult.content
								: (toolResult.content
										?.map?.((c: any) => (c.text ? c.text : JSON.stringify(c)))
										.join('\n') ?? JSON.stringify(toolResult.content));
					} else if (toolResult?.stdout) {
						output = toolResult.stdout;
					} else if (toolResult?.isError && toolResult?.error) {
						output = String(toolResult.error);
					} else {
						output = JSON.stringify(toolResult, null, 2);
					}
					const capped =
						output.length > 8000 ? `${output.slice(0, 8000)}\n...truncated` : output;
					const toolEndTime = Date.now();
					setHistory((prev) => [
						...prev,
						{
							id: toolEndTime,
							role: 'tool_result',
							content: capped,
							name,
							exitCode: (toolResult?.exitCode ?? toolResult?.isError) ? 1 : 0,
							parentId: turnId,
							startTime: lastToolCallTimeRef.current || undefined,
							endTime: toolEndTime,
						},
					]);
				},
				onUsage: (promptTokens: number, completionTokens: number) => {
					responseCostRef.promptTokens += promptTokens;
					responseCostRef.completionTokens += completionTokens;
					setTokenUsage((prev) => ({
						promptTokens: prev.promptTokens + promptTokens,
						completionTokens: prev.completionTokens + completionTokens,
					}));
					try {
						const spec = resolveModelSpec(agent.model, config.userConfig);
						const turnCost = calculateTurnCost(
							spec.model,
							promptTokens,
							completionTokens,
						);
						responseCostRef.cost += turnCost.totalCost;
						setSessionCost((prev) => prev + turnCost.totalCost);
					} catch {}
				},
			});

			flushStreamingBuffers();
			if (flushTimerRef.current) {
				clearTimeout(flushTimerRef.current);
				flushTimerRef.current = undefined;
			}
			setHistory((prev) => prev.map((e) => (e.streaming ? { ...e, streaming: false } : e)));
			setHistory((prev) => {
				const hasAssistant = prev.some(
					(e) => e.role === 'assistant' && e.parentId === turnId,
				);
				if (hasAssistant) {
					return prev.map((e) =>
						e.role === 'assistant' &&
						e.parentId === turnId &&
						!e.costInfo &&
						responseCostRef.cost > 0
							? {
									...e,
									costInfo: {
										promptTokens: responseCostRef.promptTokens,
										completionTokens: responseCostRef.completionTokens,
										cost: responseCostRef.cost,
									},
								}
							: e,
					);
				}
				return [
					...prev,
					{
						id: Date.now(),
						role: 'assistant',
						content: result,
						parentId: turnId,
						...(responseCostRef.cost > 0
							? {
									costInfo: {
										promptTokens: responseCostRef.promptTokens,
										completionTokens: responseCostRef.completionTokens,
										cost: responseCostRef.cost,
									},
								}
							: {}),
					},
				];
			});
			setMsgCount((m) => m + 1);
			setCharCount((c) => c + result.length);
		} catch (err: any) {
			setHistory((prev) => prev.map((e) => (e.streaming ? { ...e, streaming: false } : e)));
			if (err instanceof RequestCancelledError) {
				agent.messages.push({ role: 'assistant', content: 'Cancelled.' });
				setHistory((prev) => [
					...prev,
					{
						id: Date.now(),
						role: 'assistant',
						content: 'Cancelled.',
						parentId: turnId,
					},
				]);
			} else {
				const classified = classifyProviderError(err);
				const displayMsg = formatErrorForDisplay(classified);
				agent.messages.push({ role: 'assistant', content: displayMsg });
				setHistory((prev) => [
					...prev,
					{
						id: Date.now(),
						role: 'error',
						content: displayMsg,
						parentId: turnId,
						errorCategory: classified.category,
						errorSuggestion: classified.suggestion,
						errorCanRetry: classified.canRetry,
					},
				]);
			}
		}
		setIsStreaming(false);
		setIsExecuting(false);
		streamingEntryIdRef.current = 0;
		thinkingEntryIdRef.current = 0;
		abortControllerRef.current = null;
		agent.status = 'idle';
		registry.saveSessions();
	}

	runAgentTurnRef.current = runAgentTurn;

	const handlePasteText = useCallback(
		(text: string) => {
			const ESC = String.fromCharCode(27);
			const ansiRe = new RegExp(`${ESC}\\[[0-9;]*[a-zA-Z]`, 'g');
			const sanitized = text.replace(/[\n\r]/g, ' ').replace(ansiRe, '');
			if (!sanitized) return;

			if (sessionWizardActive && sessionWizardRef.current) {
				sessionWizardRef.current.handlePaste?.(sanitized);
				return;
			}
			if (memoryWizardActive && memoryWizardRef.current) {
				memoryWizardRef.current.handlePaste?.(sanitized);
				return;
			}
			if (connectWizardActive && connectWizardRef.current) {
				connectWizardRef.current.handlePaste?.(sanitized);
				return;
			}
			if (wizardActive && wizardRef.current) {
				wizardRef.current.handlePaste?.(sanitized);
				return;
			}

			if (isStreaming) return;
			setInput((p) => p.slice(0, inputCursor) + sanitized + p.slice(inputCursor));
			setInputCursor((c) => c + sanitized.length);
			setInputHistoryIdx(-1);
		},
		[
			sessionWizardActive,
			memoryWizardActive,
			connectWizardActive,
			wizardActive,
			isStreaming,
			inputCursor,
		],
	);

	useEffect(() => {
		const handler = (event: PasteEvent) => {
			try {
				const text = decodePasteBytes(event.bytes);
				handlePasteText(text);
			} catch {
				/* ignore decode failures */
			}
		};
		renderer.keyInput.on('paste', handler);
		return () => {
			renderer.keyInput.off('paste', handler);
		};
	}, [renderer.keyInput, handlePasteText]);

	useKeyboard((event: any) => {
		const key = event.name || '';
		const ctrl = event.ctrl || false;
		const shift = event.shift || false;
		const meta = event.meta || false;
		const ch = event.sequence || '';

		const namedKeys = new Set([
			'return',
			'linefeed',
			'escape',
			'tab',
			'backspace',
			'delete',
			'up',
			'down',
			'left',
			'right',
			'home',
			'end',
			'pageup',
			'pagedown',
			'space',
		]);
		const inputChar = namedKeys.has(key) ? '' : ch;

		if (sessionWizardActive && sessionWizardRef.current) {
			sessionWizardRef.current.handleKey(inputChar, {
				ctrl,
				shift,
				meta,
				return: key === 'return',
				escape: key === 'escape',
				upArrow: key === 'up',
				downArrow: key === 'down',
				tab: key === 'tab',
				backspace: key === 'backspace',
				pageUp: key === 'pageup',
				pageDown: key === 'pagedown',
			});
			return;
		}
		if (memoryWizardActive && memoryWizardRef.current) {
			memoryWizardRef.current.handleKey(inputChar, {
				ctrl,
				shift,
				meta,
				return: key === 'return',
				escape: key === 'escape',
				upArrow: key === 'up',
				downArrow: key === 'down',
				tab: key === 'tab',
				backspace: key === 'backspace',
				pageUp: key === 'pageup',
				pageDown: key === 'pagedown',
			});
			return;
		}
		if (connectWizardActive && connectWizardRef.current) {
			connectWizardRef.current.handleKey(inputChar, {
				ctrl,
				shift,
				meta,
				return: key === 'return',
				escape: key === 'escape',
				upArrow: key === 'up',
				downArrow: key === 'down',
				tab: key === 'tab',
				backspace: key === 'backspace',
				pageUp: key === 'pageup',
				pageDown: key === 'pagedown',
			});
			return;
		}
		if (wizardActive && wizardRef.current) {
			wizardRef.current.handleKey(inputChar, {
				ctrl,
				shift,
				meta,
				return: key === 'return',
				escape: key === 'escape',
				upArrow: key === 'up',
				downArrow: key === 'down',
				tab: key === 'tab',
				backspace: key === 'backspace',
				pageUp: key === 'pageup',
				pageDown: key === 'pagedown',
			});
			return;
		}

		if (waitingConfirmation) {
			if (ch === 'y' || ch === 'Y') {
				setWaitingConfirmation(null);
				confirmationResolveRef.current?.(true);
				confirmationResolveRef.current = null;
				return;
			}
			if (key === 'return' || key === 'linefeed' || ch === 'n' || ch === 'N') {
				setWaitingConfirmation(null);
				setCurrentTool(null);
				confirmationResolveRef.current?.(false);
				confirmationResolveRef.current = null;
				return;
			}
			return;
		}

		if (waitingCmdConfirmation) {
			if (ch === 'y' || ch === 'Y') {
				const { command, args } = waitingCmdConfirmation;
				setWaitingCmdConfirmation(null);
				setInput(`/${command} ${args}`);
				setInputCursor(`/${command} ${args}`.length);
				return;
			}
			if (key === 'return' || key === 'linefeed' || ch === 'n' || ch === 'N') {
				setWaitingCmdConfirmation(null);
				setHistory((prev) => [
					...prev,
					{
						id: Date.now(),
						role: 'assistant',
						content: 'Cancelled.',
					},
				]);
				return;
			}
			return;
		}

		if (showHelp) {
			setShowHelp(false);
			return;
		}

		if (ctrl && key === 'c') {
			if (isStreaming && abortControllerRef.current) {
				abortControllerRef.current.abort();
				abortControllerRef.current = null;
				return;
			}
			registry.saveSessions();
			renderer.destroy();
			return;
		}

		if (ctrl && key === 'l') {
			setTick((t) => t + 1);
			return;
		}

		if (ctrl && key === 's') {
			setSidebarWidth((w) => {
				const next = w === 0 ? 2 : w === 2 ? 26 : w === 26 ? 40 : 0;
				return next;
			});
			return;
		}

		if (ctrl && key === 'u') {
			setInput('');
			setInputCursor(0);
			setInputHistoryIdx(-1);
			return;
		}

		if (ctrl && key === 'y') {
			const lastAssistant = [...history]
				.reverse()
				.find((e) => e.role === 'assistant' && !e.streaming);
			if (lastAssistant) {
				try {
					const text = lastAssistant.content;
					if (process.platform === 'darwin') {
						execSync('pbcopy', { input: text });
					} else {
						execSync('xclip -selection clipboard', { input: text });
					}
				} catch {
					/* clipboard not available */
				}
			}
			return;
		}

		if (key === 'escape') {
			const now = Date.now();
			const doubleEsc = now - lastEscTimeRef.current < 500;
			lastEscTimeRef.current = now;
			if (input) {
				setInput('');
				setInputCursor(0);
				return;
			}
			if ((isStreaming || isExecuting) && abortControllerRef.current) {
				abortControllerRef.current.abort();
				abortControllerRef.current = null;
				return;
			}
			if (doubleEsc) {
				registry.saveSessions();
				renderer.destroy();
				return;
			}
			return;
		}

		if (key === 'tab') {
			const next = registry.switchNext();
			if (next) {
				setActiveId(next.id);
				setTick((t) => t + 1);
			}
			return;
		}

		if (ctrl && key === 'e') {
			setExpandAll((p) => !p);
			return;
		}

		if (((key === 'return' && shift) || key === 'linefeed') && !isStreaming) {
			setInput((p) => `${p.slice(0, inputCursor)}\n${p.slice(inputCursor)}`);
			setInputCursor((c) => c + 1);
			return;
		}

		if ((key === 'return' || key === 'linefeed') && !shift && input.trim() && !isStreaming) {
			setInputHistory((prev) => [input, ...prev.slice(0, 50)]);
			setInputHistoryIdx(-1);
			handleSubmit(input);
			setInput('');
			setInputCursor(0);
			return;
		}

		if (isStreaming) return;

		if (key === 'up' && !input && inputHistory.length > 0) {
			const nextIdx = Math.min(inputHistoryIdx + 1, inputHistory.length - 1);
			setInput(inputHistory[nextIdx]);
			setInputCursor(inputHistory[nextIdx].length);
			setInputHistoryIdx(nextIdx);
			return;
		}

		if (key === 'down' && inputHistoryIdx >= 0) {
			const nextIdx = inputHistoryIdx - 1;
			if (nextIdx < 0) {
				setInput('');
				setInputCursor(0);
			} else {
				setInput(inputHistory[nextIdx]);
				setInputCursor(inputHistory[nextIdx].length);
			}
			setInputHistoryIdx(nextIdx);
			return;
		}

		if (key === 'left') {
			setInputCursor((c) => Math.max(0, c - 1));
			return;
		}
		if (key === 'right') {
			setInputCursor((c) => Math.min(input.length, c + 1));
			return;
		}
		if (key === 'home') {
			setInputCursor(0);
			return;
		}
		if (key === 'end') {
			setInputCursor(input.length);
			return;
		}
		if (key === 'delete') {
			if (inputCursor < input.length)
				setInput((p) => p.slice(0, inputCursor) + p.slice(inputCursor + 1));
			return;
		}
		if (key === 'backspace') {
			if (inputCursor > 0) {
				setInput((p) => p.slice(0, inputCursor - 1) + p.slice(inputCursor));
				setInputCursor((c) => c - 1);
			}
			return;
		}

		if (key === 'pageup') {
			chatScrollRef.current?.scrollBy(-chatAvailableRows);
			return;
		}
		if (key === 'pagedown') {
			chatScrollRef.current?.scrollBy(chatAvailableRows);
			return;
		}

		if (!ctrl && !meta && ch.length === 1) {
			setInput((p) => p.slice(0, inputCursor) + ch + p.slice(inputCursor));
			setInputCursor((c) => c + 1);
			setInputHistoryIdx(-1);
		}
	});

	const agents = registry.getAll();
	const approxTokens = Math.round(charCount / 4);

	return h(
		AppShell,
		{
			sidebar: h(Sidebar, {
				servers: mcpServers,
				model: active.model || config.model,
				activeSkills: active.activeSkills,
				width: sidebarWidth,
				msgCount,
				approxTokens,
				agents: agents.map((a) => ({
					id: a.id,
					name: a.name,
					persona: a.persona,
					packName: a.packName,
				})),
				activeId,
				isStreaming,
				isThinking: history.some((e) => e.role === 'thinking' && e.streaming),
				isExecuting,
				scrolledUp,
				rawMode,
				expandAll,
				sessionStart: sessionStartTs,
				sessionCost,
				turnCount,
				maxTurns: config.maxTurns,
				packName:
					active.packName || (config.packs.length > 0 ? config.packs[0].name : undefined),
				mcpSummary:
					mcpServers.length > 0
						? {
								connected: mcpServers.filter((s) => s.status === 'connected')
									.length,
								total: mcpServers.length,
							}
						: undefined,
				modelEntry: (() => {
					try {
						const spec = resolveModelSpec(
							active.model || config.model,
							config.userConfig,
						);
						return spec.model;
					} catch {
						return undefined;
					}
				})(),
				isLocal: (active.model || config.model).split('/')[0] === 'ollama',
				projects,
				activeSessionId: active.id,
				cwdFiles,
			}),
			inputBar: h(InputBar, {
				input,
				cursorIndex: inputCursor,
				isStreaming,
				waitingConfirmation: !!waitingConfirmation,
				confirmationTool: waitingConfirmation?.name ?? '',
				waitingCmdConfirmation: !!waitingCmdConfirmation,
				cmdConfirmationMessage: waitingCmdConfirmation?.message ?? '',
				packName:
					active.packName || (config.packs.length > 0 ? config.packs[0].name : undefined),
				model: active.model || config.model,
				provider: (active.model || config.model).includes('/')
					? (active.model || config.model).split('/')[0]
					: undefined,
				renderer,
				onSubmit: handleSubmit,
				onInput: (text: string, cursor: number) => {
					setInput(text);
					setInputCursor(cursor);
				},
				onCancel: () => {
					if (abortControllerRef.current) {
						abortControllerRef.current.abort();
						abortControllerRef.current = null;
					}
				},
			}),
		},
		sessionWizardActive
			? h(
					'box',
					{ flexDirection: 'column', flexGrow: 1, overflow: 'hidden' },
					h(SessionWizard, {
						ref: sessionWizardRef,
						registry,
						onDone: sessionWizardDone,
					}),
				)
			: memoryWizardActive
				? h(
						'box',
						{ flexDirection: 'column', flexGrow: 1, overflow: 'hidden' },
						h(MemoryWizard, {
							ref: memoryWizardRef,
							mcpRegistry,
							onDone: memoryWizardDone,
							getUserConfig: () => config.userConfig,
							writeUserConfigFn: (uc: any) => writeUserConfig(uc),
						}),
					)
				: connectWizardActive
					? h(
							'box',
							{ flexDirection: 'column', flexGrow: 1, overflow: 'hidden' },
							h(ConnectWizard, {
								ref: connectWizardRef,
								onDone: connectWizardDone,
								getUserConfig: () => config.userConfig,
							}),
						)
					: wizardActive
						? h(
								'box',
								{ flexDirection: 'column', flexGrow: 1, overflow: 'hidden' },
								h(McpWizard, {
									ref: wizardRef,
									mcpRegistry,
									onDone: wizardDone,
									width: contentWidth,
									reconnectTarget,
								}),
							)
						: showHelp
							? h(
									'box',
									{ flexDirection: 'column', flexGrow: 1, overflow: 'hidden' },
									h(HelpOverlay, { width: contentWidth }),
								)
							: h(ChatScroll, {
									ref: chatScrollRef,
									entries: history,
									agent: active,
									contentWidth,
									rawMode,
									expandAll,
									focused: true,
									isStreaming,
									onScrolledUp: setScrolledUp,
									availableRows: chatAvailableRows,
									scrollboxRef,
								}),
	);
}

export async function startAgentTUI(
	config: AgentConfig,
	registry: AgentRegistry,
	commandRegistry: CommandRegistry,
	skillRegistry: SkillRegistry,
	mcpRegistry: McpRegistry,
): Promise<void> {
	const renderer = await createCliRenderer({ exitOnCtrlC: false });
	const root = createRoot(renderer);
	root.render(
		h(MultiAgentApp, {
			config,
			registry,
			commandRegistry,
			skillRegistry,
			mcpRegistry,
			renderer,
		}),
	);
	await new Promise<void>((resolve) => {
		renderer.on('destroy', () => resolve());
	});
	process.exit(0);
}

export type { AgentConfig } from './types.js';
