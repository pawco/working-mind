import { execSync } from 'node:child_process';
import { Box, render, useApp, useInput, useWindowSize } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandRegistry } from './command-registry.js';
import type { McpEnvVarDef } from './config.js';
import { writeUserConfig } from './config.js';
import { ConnectWizard, type ConnectWizardHandle } from './connect-wizard.js';
import type { McpRegistry, McpServerInfo } from './mcp/registry.js';
import { Sidebar } from './mcp-sidebar.js';
import { McpWizard, type McpWizardHandle } from './mcp-wizard.js';
import { MemoryWizard, type MemoryWizardHandle } from './memory-wizard.js';
import { getStorePath } from './paths.js';
import { shouldConfirm } from './permissions.js';
import type { AgentRegistry } from './registry.js';
import type { CommandContext, HistoryEntry } from './sdk/command.js';
import { RequestCancelledError, runAgent } from './sdk/loop.js';
import { findProvider } from './sdk/provider-registry.js';
import { resolveApiKey } from './sdk/provider-resolve.js';
import { SessionWizard, type SessionWizardHandle } from './session-wizard.js';
import type { SkillRegistry } from './skill-registry.js';
import { useTerminalSetup } from './terminal-setup.js';
import type { AgentConfig } from './types.js';
import { AppShell } from './ui/app-shell.js';
import { ChatScroll, type ChatScrollHandle } from './ui/chat-scroll.js';
import { HelpOverlay } from './ui/help-overlay.js';
import { computeInputBarHeight, InputBar } from './ui/input-bar.js';

function MultiAgentApp({
	config,
	registry,
	commandRegistry,
	skillRegistry,
	mcpRegistry,
}: {
	config: AgentConfig;
	registry: AgentRegistry;
	commandRegistry: CommandRegistry;
	skillRegistry: SkillRegistry;
	mcpRegistry: McpRegistry;
}) {
	const { rows: termRows, columns: termCols } = useWindowSize();
	const [activeId, setActiveId] = useState<string>(
		registry.getActive()?.id || '',
	);
	const [_tick, setTick] = useState(0);
	const [input, setInput] = useState('');
	const [inputCursor, setInputCursor] = useState(0);
	const [inputHistory, setInputHistory] = useState<string[]>([]);
	const [inputHistoryIdx, setInputHistoryIdx] = useState(-1);
	const [history, setHistory] = useState<HistoryEntry[]>([]);
	const [isStreaming, setIsStreaming] = useState(false);
	const confirmationResolveRef = useRef<((approved: boolean) => void) | null>(
		null,
	);
	const [isExecuting, setIsExecuting] = useState(false);
	const [_currentTool, setCurrentTool] = useState<string | null>(null);
	const [waitingConfirmation, setWaitingConfirmation] = useState<{
		name: string;
		args: any;
	} | null>(null);
	const [msgCount, setMsgCount] = useState(0);
	const [charCount, setCharCount] = useState(0);
	const [sidebarWidth, setSidebarWidth] = useState(26);
	const [sessionStartTs] = useState(Date.now());
	const [tokenUsage, _setTokenUsage] = useState<{
		promptTokens: number;
		completionTokens: number;
	}>({ promptTokens: 0, completionTokens: 0 });
	const [mcpServers, setMcpServers] = useState<McpServerInfo[]>(
		mcpRegistry.listServers(),
	);
	const [focusTarget, setFocusTarget] = useState<'chat' | 'sidebar'>('chat');
	const [scrolledUp, setScrolledUp] = useState(false);
	const [rawMode, _setRawMode] = useState(false);
	const [expandAll, setExpandAll] = useState(false);
	const [showHelp, setShowHelp] = useState(false);
	const [turnCount, setTurnCount] = useState(0);
	const hasError = history.some((e) => e.role === 'error');
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
	const { exit } = useApp();

	useTerminalSetup();

	// Streaming refs: content accumulated here, flushed to history at 10fps
	const streamingEntryIdRef = useRef<number>(0);
	const thinkingEntryIdRef = useRef<number>(0);
	const streamContentRef = useRef('');
	const thinkingContentRef = useRef('');
	const currentTurnIdRef = useRef<number>(0);
	const lastToolCallTimeRef = useRef<number>(0);
	const flushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const abortControllerRef = useRef<AbortController | null>(null);
	const lastEscTimeRef = useRef(0);

	const active = registry.getActive() ?? registry.getAll()[0];
	const contentWidth = Math.max(20, termCols - sidebarWidth - 4);
	const inputBarHeight = computeInputBarHeight(
		input,
		isStreaming,
		!!waitingConfirmation,
	);
	const chatAvailableRows = Math.max(10, termRows - inputBarHeight - 1);

	const COMPACTION_THRESHOLD = 200;
	const COMPACTION_KEEP = 50;

	useEffect(() => {
		if (history.length > COMPACTION_THRESHOLD && !isStreaming) {
			const removed = history.length - COMPACTION_KEEP;
			setHistory((h) => {
				if (h.length <= COMPACTION_THRESHOLD) return h;
				const kept = h.slice(-COMPACTION_KEEP);
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
				setTick((t) => t + 1);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [mcpRegistry, registry]);

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

		setHistory((h) =>
			h.map((e) => {
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
			setHistory((h) => [
				...h,
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
					if (provider) {
						config.baseUrl = provider.baseUrl;
						const apiKey = resolveApiKey(provider, config.userConfig);
						if (apiKey) config.apiKey = apiKey;
					}
				}
				setTick((t) => t + 1);
			}
			if (message) {
				setHistory((h) => [
					...h,
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
					const totalChars = entries.reduce(
						(sum, e) => sum + e.content.length,
						0,
					);
					setCharCount(totalChars);
				} else {
					setHistory(
						message
							? [{ id: Date.now(), role: 'assistant', content: message }]
							: [],
					);
				}
			}
			setTick((t) => t + 1);
		},
		[registry],
	);

	const memoryWizardDone = useCallback((message: string) => {
		setMemoryWizardActive(false);
		if (message) {
			setHistory((h) => [
				...h,
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
					exit,
					activateSkill,
					deactivateSkill,
					mcpRegistry,
					setPersona: (persona: string) => registry.setPersona(persona),
					setCustomPrompt: (promptText: string) =>
						registry.setCustomPrompt(promptText),
					getUserConfig: () => config.userConfig,
					writeUserConfig: (uc: any) => writeUserConfig(uc),
				};

				if (resolved.command.name === 'help') {
					setHistory((h) => [
						...h,
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
					const newAgent = registry.createAgent({
						name,
						persona: resolved.args,
						model: config.model,
					});
					setActiveId(newAgent.id);
					setTick((t) => t + 1);
					setHistory((h) => [
						...h,
						{
							id: Date.now(),
							role: 'assistant',
							content: `Added agent: ${name}`,
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
					exit();
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

				const result = await resolved.command.handler(ctx);
				if (result.type === 'message') {
					setHistory((h) => [
						...h,
						{
							id: Date.now(),
							role: 'assistant',
							content: result.content,
							plainText: result.plainText,
						},
					]);
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
						if (result.deletedStore) {
							parts.push(
								`Deleted store '${result.deletedStore}' (${result.deletedEntityCount ?? 0} entities, ${result.deletedObsCount ?? 0} observations).`,
							);
						}
						parts.push(
							`Switched to memory store '${rStoreName}' (${reconnectResult.entityCount} entities)`,
						);
						setHistory((h) => [
							...h,
							{
								id: Date.now(),
								role: 'assistant',
								content: parts.join('\n'),
								plainText: true,
							},
						]);
					} else {
						setHistory((h) => [
							...h,
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
				} else if (result.type === 'trigger-agent') {
					const turnId = Date.now();
					currentTurnIdRef.current = turnId;
					setHistory((h) => [
						...h,
						{
							id: turnId,
							role: 'user',
							content: result.content,
							parentId: turnId,
						},
					]);
					setIsStreaming(true);
					streamingEntryIdRef.current = 0;
					thinkingEntryIdRef.current = 0;
					streamContentRef.current = '';
					thinkingContentRef.current = '';
					setTurnCount(0);
					agent.status = 'streaming';
					const abortController = new AbortController();
					abortControllerRef.current = abortController;
					try {
						const agentResult = await runAgent([...agent.messages], {
							model: agent.model,
							apiKey: config.apiKey || process.env.OPENEXPLORER_API_KEY || '',
							baseUrl: config.baseUrl,
							systemPrompt: agent.systemPrompt,
							tools: agent.tools,
							maxTurns: config.maxTurns || 10,
							userConfig: config.userConfig,
							signal: abortController.signal,
							onThinking: (t: string) => {
								if (!thinkingEntryIdRef.current) {
									if (streamingEntryIdRef.current) {
										const sId = streamingEntryIdRef.current;
										setHistory((h) =>
											h.map((e) =>
												e.id === sId ? { ...e, streaming: false } : e,
											),
										);
									}
									const id = Date.now();
									thinkingEntryIdRef.current = id;
									setHistory((h) => [
										...h,
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
									setHistory((h) =>
										h.map((e) =>
											e.id === tId ? { ...e, streaming: false, endTime } : e,
										),
									);
									thinkingEntryIdRef.current = 0;
								}
								if (!streamingEntryIdRef.current) {
									const id = Date.now();
									streamingEntryIdRef.current = id;
									setHistory((h) => [
										...h,
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
							onToolCall: async (name: string, _argsStr: string) => {
								setTurnCount((c) => c + 1);
								flushStreamingBuffers();
								if (flushTimerRef.current) {
									clearTimeout(flushTimerRef.current);
									flushTimerRef.current = undefined;
								}
								if (streamingEntryIdRef.current) {
									const sId = streamingEntryIdRef.current;
									setHistory((h) =>
										h.map((e) =>
											e.id === sId ? { ...e, streaming: false } : e,
										),
									);
									streamingEntryIdRef.current = 0;
								}
								if (thinkingEntryIdRef.current) {
									const tId = thinkingEntryIdRef.current;
									setHistory((h) =>
										h.map((e) =>
											e.id === tId ? { ...e, streaming: false } : e,
										),
									);
									thinkingEntryIdRef.current = 0;
								}
								const tool = agent.tools.find(
									(tool: any) => tool.name === name,
								);
								if (
									tool &&
									!config.autoApprove &&
									shouldConfirm(tool, config.userConfig)
								) {
									setWaitingConfirmation({ name, args: _argsStr });
									setCurrentTool(name);
									setHistory((h) => [
										...h,
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
								setHistory((h) => [
									...h,
									{
										id: toolCallTime,
										role: 'tool_call',
										content:
											_argsStr.length > 200
												? `${_argsStr.slice(0, 200)}...`
												: _argsStr,
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
								let output: string;
								if (typeof toolResult === 'string') {
									output = toolResult;
								} else if (toolResult?.content !== undefined) {
									output =
										typeof toolResult.content === 'string'
											? toolResult.content
											: (toolResult.content
													?.map?.((c: any) =>
														c.text ? c.text : JSON.stringify(c),
													)
													.join('\n') ?? JSON.stringify(toolResult.content));
								} else if (toolResult?.stdout) {
									output = toolResult.stdout;
								} else {
									output = JSON.stringify(toolResult, null, 2);
								}
								const capped =
									output.length > 8000
										? `${output.slice(0, 8000)}\n...truncated`
										: output;
								const toolEndTime = Date.now();
								setHistory((h) => [
									...h,
									{
										id: toolEndTime,
										role: 'tool_result',
										content: capped,
										name,
										exitCode:
											(toolResult?.exitCode ?? toolResult?.isError) ? 1 : 0,
										parentId: turnId,
										startTime: lastToolCallTimeRef.current || undefined,
										endTime: toolEndTime,
									},
								]);
							},
						});
						flushStreamingBuffers();
						if (flushTimerRef.current) {
							clearTimeout(flushTimerRef.current);
							flushTimerRef.current = undefined;
						}
						setHistory((h) =>
							h.map((e) => (e.streaming ? { ...e, streaming: false } : e)),
						);
						setHistory((h) => {
							const hasAssistant = h.some(
								(e) => e.role === 'assistant' && e.parentId === turnId,
							);
							if (hasAssistant) return h;
							return [
								...h,
								{
									id: Date.now(),
									role: 'assistant',
									content: agentResult,
									parentId: turnId,
								},
							];
						});
						agent.messages.push({
							role: 'assistant',
							content: agentResult,
						});
						setMsgCount((m) => m + 1);
						setCharCount((c) => c + agentResult.length);
					} catch (err: any) {
						setHistory((h) =>
							h.map((e) => (e.streaming ? { ...e, streaming: false } : e)),
						);
						if (err instanceof RequestCancelledError) {
							setHistory((h) => [
								...h,
								{
									id: Date.now(),
									role: 'assistant',
									content: 'Cancelled.',
									parentId: turnId,
								},
							]);
						} else {
							setHistory((h) => [
								...h,
								{
									id: Date.now(),
									role: 'error',
									content: err.message || String(err),
									parentId: turnId,
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
				return;
			}

			const autoSkill = skillRegistry.findAutoDiscoverable(text);
			if (autoSkill && !skillRegistry.isActive(autoSkill.name)) {
				registry.activateSkill(autoSkill.name);
				setHistory((h) => [
					...h,
					{
						id: Date.now(),
						role: 'assistant',
						content: `Auto-activated skill: ${autoSkill.name}`,
					},
				]);
			}

			const turnId = Date.now();
			currentTurnIdRef.current = turnId;

			setHistory((h) => [
				...h,
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

			agent.messages.push({ role: 'user', content: text });
			agent.status = 'streaming';

			const abortController = new AbortController();
			abortControllerRef.current = abortController;

			try {
				const result = await runAgent([...agent.messages], {
					model: agent.model,
					apiKey: config.apiKey || process.env.OPENEXPLORER_API_KEY || '',
					baseUrl: config.baseUrl,
					systemPrompt: agent.systemPrompt,
					tools: agent.tools,
					maxTurns: config.maxTurns || 10,
					userConfig: config.userConfig,
					signal: abortController.signal,
					onThinking: (t) => {
						if (!thinkingEntryIdRef.current) {
							if (streamingEntryIdRef.current) {
								const sId = streamingEntryIdRef.current;
								setHistory((h) =>
									h.map((e) => (e.id === sId ? { ...e, streaming: false } : e)),
								);
							}
							const id = Date.now();
							thinkingEntryIdRef.current = id;
							setHistory((h) => [
								...h,
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
					onText: (t) => {
						if (thinkingEntryIdRef.current) {
							const tId = thinkingEntryIdRef.current;
							const endTime = Date.now();
							setHistory((h) =>
								h.map((e) =>
									e.id === tId ? { ...e, streaming: false, endTime } : e,
								),
							);
							thinkingEntryIdRef.current = 0;
						}
						if (!streamingEntryIdRef.current) {
							const id = Date.now();
							streamingEntryIdRef.current = id;
							setHistory((h) => [
								...h,
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
					onToolCall: async (name, _argsStr) => {
						setTurnCount((c) => c + 1);
						// Flush buffers before adding tool call
						flushStreamingBuffers();
						if (flushTimerRef.current) {
							clearTimeout(flushTimerRef.current);
							flushTimerRef.current = undefined;
						}

						// Mark current streaming entries as done
						if (streamingEntryIdRef.current) {
							const sId = streamingEntryIdRef.current;
							setHistory((h) =>
								h.map((e) => (e.id === sId ? { ...e, streaming: false } : e)),
							);
							streamingEntryIdRef.current = 0;
						}
						if (thinkingEntryIdRef.current) {
							const tId = thinkingEntryIdRef.current;
							setHistory((h) =>
								h.map((e) => (e.id === tId ? { ...e, streaming: false } : e)),
							);
							thinkingEntryIdRef.current = 0;
						}

						const tool = agent.tools.find((tool) => tool.name === name);
						if (
							tool &&
							!config.autoApprove &&
							shouldConfirm(tool, config.userConfig)
						) {
							setWaitingConfirmation({ name, args: _argsStr });
							setCurrentTool(name);
							setHistory((h) => [
								...h,
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
						setHistory((h) => [
							...h,
							{
								id: toolCallTime,
								role: 'tool_call',
								content:
									_argsStr.length > 200
										? `${_argsStr.slice(0, 200)}…`
										: _argsStr,
								name,
								parentId: turnId,
								startTime: toolCallTime,
							},
						]);
						return true;
					},
					onToolResult: (name, result) => {
						setCurrentTool(null);
						setIsExecuting(false);
						agent.status = 'streaming';
						let output: string;
						if (typeof result === 'string') {
							output = result;
						} else if (result?.content !== undefined) {
							output =
								typeof result.content === 'string'
									? result.content
									: (result.content
											?.map?.((c: any) => c.text ?? JSON.stringify(c))
											.join('\n') ?? JSON.stringify(result.content));
						} else if (result?.stdout) {
							output = result.stdout;
						} else {
							output = JSON.stringify(result, null, 2);
						}
						const capped =
							output.length > 8000
								? `${output.slice(0, 8000)}\n…truncated`
								: output;
						const toolEndTime = Date.now();
						setHistory((h) => [
							...h,
							{
								id: toolEndTime,
								role: 'tool_result',
								content: capped,
								name,
								exitCode: (result?.exitCode ?? result?.isError) ? 1 : 0,
								parentId: turnId,
								startTime: lastToolCallTimeRef.current || undefined,
								endTime: toolEndTime,
							},
						]);
					},
				});

				// Flush remaining buffers
				flushStreamingBuffers();
				if (flushTimerRef.current) {
					clearTimeout(flushTimerRef.current);
					flushTimerRef.current = undefined;
				}

				// Mark streaming entries as complete
				setHistory((h) =>
					h.map((e) => (e.streaming ? { ...e, streaming: false } : e)),
				);

				// If onText never fired (edge case: no streaming text received),
				// add the final content as a completed entry. Use functional updater
				// to read CURRENT state — the closure `history` is stale after await.
				setHistory((h) => {
					const hasAssistant = h.some(
						(e) => e.role === 'assistant' && e.parentId === turnId,
					);
					if (hasAssistant) return h;
					return [
						...h,
						{
							id: Date.now(),
							role: 'assistant',
							content: result,
							parentId: turnId,
						},
					];
				});

				agent.messages.push({ role: 'assistant', content: result });
				setMsgCount((m) => m + 1);
				setCharCount((c) => c + result.length);
			} catch (err: any) {
				setHistory((h) =>
					h.map((e) => (e.streaming ? { ...e, streaming: false } : e)),
				);
				if (err instanceof RequestCancelledError) {
					setHistory((h) => [
						...h,
						{
							id: Date.now(),
							role: 'assistant',
							content: 'Cancelled.',
							parentId: turnId,
						},
					]);
				} else {
					setHistory((h) => [
						...h,
						{
							id: Date.now(),
							role: 'error',
							content: err.message || String(err),
							parentId: turnId,
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
		},
		[
			registry,
			config,
			commandRegistry,
			skillRegistry,
			mcpRegistry,
			exit,
			activateSkill,
			deactivateSkill,
			flushStreamingBuffers,
			scheduleFlush,
		],
	);

	useInput((inputChar, key) => {
		const SGR_MOUSE_RE = /^\[<(\d+);(\d+);(\d+)([Mm])$/;
		const sgrMatch = SGR_MOUSE_RE.exec(inputChar);
		if (sgrMatch) {
			const cb = Number(sgrMatch[1]);
			if ((cb & 64) !== 0) {
				const isUp = (cb & 1) === 0;
				chatScrollRef.current?.scrollBy(isUp ? -3 : 3);
			}
			return;
		}

		if (/^\[/.test(inputChar) && !key.return && !key.tab) {
			return;
		}

		if (sessionWizardActive && sessionWizardRef.current) {
			sessionWizardRef.current.handleKey(inputChar, key);
			return;
		}

		if (memoryWizardActive && memoryWizardRef.current) {
			memoryWizardRef.current.handleKey(inputChar, key);
			return;
		}

		if (connectWizardActive && connectWizardRef.current) {
			connectWizardRef.current.handleKey(inputChar, key);
			return;
		}

		if (wizardActive && wizardRef.current) {
			wizardRef.current.handleKey(inputChar, key);
			return;
		}

		if (waitingConfirmation) {
			if (inputChar === 'y' || inputChar === 'Y') {
				setWaitingConfirmation(null);
				confirmationResolveRef.current?.(true);
				confirmationResolveRef.current = null;
				return;
			}
			if (key.return || inputChar === 'n' || inputChar === 'N') {
				setWaitingConfirmation(null);
				setCurrentTool(null);
				confirmationResolveRef.current?.(false);
				confirmationResolveRef.current = null;
				return;
			}
			return;
		}

		if (showHelp) {
			setShowHelp(false);
			return;
		}

		if (key.ctrl && inputChar === 'c') {
			if (isStreaming && abortControllerRef.current) {
				abortControllerRef.current.abort();
				abortControllerRef.current = null;
				return;
			}
			registry.saveSessions();
			exit();
			return;
		}

		if (key.ctrl && inputChar === 'l') {
			setTick((t) => t + 1);
			return;
		}

		if (key.ctrl && inputChar === 's') {
			setSidebarWidth((w) => {
				const next = w === 0 ? 2 : w === 2 ? 26 : w === 26 ? 40 : 0;
				setFocusTarget(next > 0 ? 'sidebar' : 'chat');
				return next;
			});
			return;
		}

		if (key.ctrl && inputChar === 'u') {
			setInput('');
			setInputCursor(0);
			setInputHistoryIdx(-1);
			return;
		}

		if (key.ctrl && inputChar === 'y') {
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
					// clipboard not available
				}
			}
			return;
		}

		if (key.escape) {
			const now = Date.now();
			const doubleEsc = now - lastEscTimeRef.current < 500;
			lastEscTimeRef.current = now;

			if (focusTarget !== 'chat') {
				setFocusTarget('chat');
				return;
			}
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
				exit();
				return;
			}
			return;
		}

		if (key.tab) {
			const next = registry.switchNext();
			if (next) {
				setActiveId(next.id);
				setTick((t) => t + 1);
			}
			return;
		}

		if (key.ctrl && inputChar === 'e') {
			setExpandAll((p) => !p);
			return;
		}

		if (inputChar === 'r' && !input && !isStreaming && hasError) {
			const lastUser = [...history].reverse().find((e) => e.role === 'user');
			if (lastUser) {
				handleSubmit(lastUser.content);
			}
			return;
		}

		if (key.shift && key.return && !isStreaming) {
			setInput((p) => `${p.slice(0, inputCursor)}\n${p.slice(inputCursor)}`);
			setInputCursor((c) => c + 1);
			return;
		}

		if (key.return && input.trim() && !isStreaming) {
			setInputHistory((h) => [input, ...h.slice(0, 50)]);
			setInputHistoryIdx(-1);
			handleSubmit(input);
			setInput('');
			setInputCursor(0);
			return;
		}

		if (isStreaming) return;

		if (key.upArrow && !input && inputHistory.length > 0) {
			const nextIdx = Math.min(inputHistoryIdx + 1, inputHistory.length - 1);
			setInput(inputHistory[nextIdx]);
			setInputCursor(inputHistory[nextIdx].length);
			setInputHistoryIdx(nextIdx);
			return;
		}

		if (key.downArrow && inputHistoryIdx >= 0) {
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

		if (key.leftArrow) {
			setInputCursor((c) => Math.max(0, c - 1));
			return;
		}

		if (key.rightArrow) {
			setInputCursor((c) => Math.min(input.length, c + 1));
			return;
		}

		if (key.home) {
			setInputCursor(0);
			return;
		}

		if (key.end) {
			setInputCursor(input.length);
			return;
		}

		if (key.delete) {
			if (inputCursor < input.length) {
				setInput((p) => p.slice(0, inputCursor) + p.slice(inputCursor + 1));
			}
			return;
		}

		if (key.backspace) {
			if (inputCursor > 0) {
				setInput((p) => p.slice(0, inputCursor - 1) + p.slice(inputCursor));
				setInputCursor((c) => c - 1);
			}
			return;
		}

		if (!key.ctrl && !key.meta && !key.tab && inputChar) {
			const isPaste = inputChar.length > 1 && inputChar.includes('\n');
			if (isPaste) {
				const cleaned = inputChar.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
				setInput(
					(p) => p.slice(0, inputCursor) + cleaned + p.slice(inputCursor),
				);
				setInputCursor((c) => c + cleaned.length);
			} else {
				setInput(
					(p) => p.slice(0, inputCursor) + inputChar + p.slice(inputCursor),
				);
				setInputCursor((c) => c + 1);
			}
			setInputHistoryIdx(-1);
		}
	});

	const agents = registry.getAll();
	const approxTokens = Math.round(charCount / 4);

	return (
		<AppShell
			height={termRows}
			sidebar={
				<Sidebar
					servers={mcpServers}
					model={active.model || config.model}
					activeSkills={active.activeSkills}
					width={sidebarWidth}
					msgCount={msgCount}
					approxTokens={approxTokens}
					agents={agents.map((a) => ({
						id: a.id,
						name: a.name,
						persona: a.persona,
					}))}
					activeId={activeId}
					isStreaming={isStreaming}
					isThinking={history.some((e) => e.role === 'thinking' && e.streaming)}
					isExecuting={isExecuting}
					scrolledUp={scrolledUp}
					rawMode={rawMode}
					expandAll={expandAll}
					sessionStart={sessionStartTs}
					usage={tokenUsage.promptTokens > 0 ? tokenUsage : undefined}
					turnCount={turnCount}
					maxTurns={config.maxTurns}
					packName={config.packs.length > 0 ? config.packs[0].name : undefined}
					mcpSummary={
						mcpServers.length > 0
							? {
									connected: mcpServers.filter((s) => s.status === 'connected')
										.length,
									total: mcpServers.length,
								}
							: undefined
					}
				/>
			}
			inputBar={
				<InputBar
					input={input}
					cursorIndex={inputCursor}
					isStreaming={isStreaming}
					waitingConfirmation={!!waitingConfirmation}
					confirmationTool={waitingConfirmation?.name ?? ''}
					packName={config.packs.length > 0 ? config.packs[0].name : undefined}
					model={active.model || config.model}
					provider={
						(active.model || config.model).includes('/')
							? (active.model || config.model).split('/')[0]
							: undefined
					}
				/>
			}
		>
			{sessionWizardActive ? (
				<Box flexDirection="column" flexGrow={1} overflow="hidden">
					<SessionWizard
						ref={sessionWizardRef}
						registry={registry}
						onDone={sessionWizardDone}
					/>
				</Box>
			) : memoryWizardActive ? (
				<Box flexDirection="column" flexGrow={1} overflow="hidden">
					<MemoryWizard
						ref={memoryWizardRef}
						mcpRegistry={mcpRegistry}
						onDone={memoryWizardDone}
						getUserConfig={() => config.userConfig}
						writeUserConfigFn={(uc: any) => writeUserConfig(uc)}
					/>
				</Box>
			) : connectWizardActive ? (
				<Box flexDirection="column" flexGrow={1} overflow="hidden">
					<ConnectWizard
						ref={connectWizardRef}
						onDone={connectWizardDone}
						getUserConfig={() => config.userConfig}
					/>
				</Box>
			) : wizardActive ? (
				<Box flexDirection="column" flexGrow={1} overflow="hidden">
					<McpWizard
						ref={wizardRef}
						mcpRegistry={mcpRegistry}
						onDone={wizardDone}
						width={contentWidth}
						reconnectTarget={reconnectTarget}
					/>
				</Box>
			) : showHelp ? (
				<Box flexDirection="column" flexGrow={1} overflow="hidden">
					<HelpOverlay width={contentWidth} />
				</Box>
			) : (
				<ChatScroll
					ref={chatScrollRef}
					entries={history}
					agent={active}
					contentWidth={contentWidth}
					rawMode={rawMode}
					expandAll={expandAll}
					focused={focusTarget === 'chat'}
					onScrolledUp={setScrolledUp}
					availableRows={chatAvailableRows}
				/>
			)}
		</AppShell>
	);
}

export async function startAgentTUI(
	config: AgentConfig,
	registry: AgentRegistry,
	commandRegistry: CommandRegistry,
	skillRegistry: SkillRegistry,
	mcpRegistry: McpRegistry,
): Promise<void> {
	const { waitUntilExit } = render(
		<MultiAgentApp
			config={config}
			registry={registry}
			commandRegistry={commandRegistry}
			skillRegistry={skillRegistry}
			mcpRegistry={mcpRegistry}
		/>,
		{ alternateScreen: true, exitOnCtrlC: false },
	);
	await waitUntilExit();
}

export type { AgentConfig } from './types.js';
