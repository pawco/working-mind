import type { UserConfig } from '../config.js';
import { compactMessages, shouldCompact } from './context.js';
import { resolveApiKeyAsync, resolveModelSpec } from './provider-resolve.js';
import type { ToolDef } from './tool.js';

export interface AgentRunConfig {
	model: string;
	systemPrompt: string;
	tools: ToolDef[];
	maxTurns: number;
	supportsReasoning?: boolean;
	onText?: (text: string) => void;
	onThinking?: (text: string) => void;
	onToolCall?: (name: string, args: any) => boolean | Promise<boolean>;
	onToolResult?: (name: string, result: any) => void;
	onUsage?: (promptTokens: number, completionTokens: number) => void;
	userConfig?: UserConfig;
	signal?: AbortSignal;
}

export class RequestCancelledError extends Error {
	constructor() {
		super('Request cancelled');
		this.name = 'RequestCancelledError';
	}
}

const TOOL_CALL_APPROVAL_TIMEOUT_MS = 30_000;

function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	fallback: T,
): Promise<T> {
	return new Promise<T>((resolve) => {
		const timer = setTimeout(() => resolve(fallback), ms);
		promise.then(
			(val) => {
				clearTimeout(timer);
				resolve(val);
			},
			(_err) => {
				clearTimeout(timer);
				resolve(fallback);
			},
		);
	});
}

function sanitizeMessages(messages: any[]): any[] {
	const toolCallIds = new Set<string>();
	for (const msg of messages) {
		if (Array.isArray(msg.tool_calls)) {
			for (const tc of msg.tool_calls) {
				if (tc.id) toolCallIds.add(tc.id);
			}
		}
	}
	return messages.filter((msg) => {
		if (msg.role === 'tool' && msg.tool_call_id) {
			return toolCallIds.has(msg.tool_call_id);
		}
		return true;
	});
}

function tryParseTextToolCall(
	text: string,
	toolNames: Set<string>,
): { name: string; arguments: string } | null {
	const jsonBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
	if (!jsonBlockMatch) return null;
	try {
		const parsed = JSON.parse(jsonBlockMatch[1]);
		if (parsed && typeof parsed === 'object') {
			const name = parsed.name || parsed.tool || parsed.function_name;
			const args =
				parsed.arguments || parsed.args || parsed.parameters || parsed.params;
			if (name && toolNames.has(name) && args) {
				return {
					name,
					arguments: typeof args === 'string' ? args : JSON.stringify(args),
				};
			}
		}
	} catch {}
	return null;
}

export async function runAgent(
	messages: any[],
	config: AgentRunConfig,
): Promise<string> {
	const resolved = resolveModelSpec(config.model, config.userConfig);
	const adapter = resolved.adapter;
	const toolMap = new Map(config.tools.map((t) => [t.name, t]));

	if (resolved.provider.needsApiKey && !resolved.apiKey) {
		const asyncKey = await resolveApiKeyAsync(
			resolved.provider,
			config.userConfig,
		);
		if (asyncKey) {
			resolved.apiKey = asyncKey;
		} else {
			throw new Error(
				`No API key configured for ${resolved.provider.displayName}. Use /connect to set one up.`,
			);
		}
	}

	const toolsUsed = new Set<string>();
	const supportsToolCalling = resolved.model?.supportsToolCalling !== false;
	const apiTools = supportsToolCalling ? adapter.formatTools(config.tools) : [];

	for (let turn = 0; turn < config.maxTurns; turn++) {
		if (config.signal?.aborted) throw new RequestCancelledError();

		if (shouldCompact(messages)) {
			const compacted = compactMessages(messages);
			messages.length = 0;
			messages.push(...compacted);
		}

		const sanitized = sanitizeMessages(messages);
		if (sanitized.length !== messages.length) {
			messages.length = 0;
			messages.push(...sanitized);
		}

		let assistantContent = '';
		const toolCalls: { id: string; name: string; arguments: string }[] = [];
		let turnPromptTokens = 0;
		let turnCompletionTokens = 0;

		const skipThinking = config.userConfig?.agents?.noThinking;
		const onThinking = skipThinking ? undefined : config.onThinking;
		const streamMessages = adapter.buildMessages(messages, config.systemPrompt);

		const maxTokens =
			config.userConfig?.agents?.maxTokens ?? adapter.getDefaultMaxTokens();
		const thinkingBudget =
			config.userConfig?.agents?.thinkingBudget ??
			adapter.getDefaultThinkingBudget();

		for await (const event of adapter.stream(streamMessages, apiTools, {
			apiKey: resolved.apiKey,
			baseUrl: resolved.baseUrl,
			model: resolved.model?.id || resolved.providerRelativeModelId,
			systemPrompt: config.systemPrompt,
			supportsReasoning:
				(config.supportsReasoning ?? resolved.model?.supportsReasoning) &&
				!config.userConfig?.agents?.noThinking,
			maxTokens,
			thinkingBudget,
			signal: config.signal,
		})) {
			if (config.signal?.aborted) throw new RequestCancelledError();
			if (event.type === 'thinking') {
				onThinking?.(event.content);
			}
			if (event.type === 'text') {
				assistantContent += event.content;
				config.onText?.(event.content);
			}
			if (event.type === 'usage') {
				turnPromptTokens = event.promptTokens;
				turnCompletionTokens = event.completionTokens;
			}
			if (event.type === 'tool_call') {
				toolCalls.push({
					id: event.id,
					name: event.name,
					arguments: event.arguments,
				});
			}
		}

		if (toolCalls.length === 0) {
			if (supportsToolCalling && assistantContent) {
				const parsed = tryParseTextToolCall(
					assistantContent,
					new Set(toolMap.keys()),
				);
				if (parsed) {
					toolCalls.push({
						id: `tc_text_${Date.now()}`,
						name: parsed.name,
						arguments: parsed.arguments,
					});
				}
			}

			if (toolCalls.length === 0) {
				const finalContent = assistantContent || '(No response from model)';
				messages.push({ role: 'assistant', content: finalContent });
				if (turnPromptTokens > 0 || turnCompletionTokens > 0) {
					config.onUsage?.(turnPromptTokens, turnCompletionTokens);
				}
				return finalContent;
			}
		}

		messages.push({
			role: 'assistant',
			content: assistantContent,
			tool_calls: toolCalls,
		});

		if (turnPromptTokens > 0 || turnCompletionTokens > 0) {
			config.onUsage?.(turnPromptTokens, turnCompletionTokens);
		}

		for (const tc of toolCalls) {
			toolsUsed.add(tc.name);
			if (config.signal?.aborted) throw new RequestCancelledError();
			const tool = toolMap.get(tc.name);
			if (!tool) {
				const resultStr = `Unknown tool: ${tc.name}`;
				messages.push(adapter.buildToolResult(tc.id, resultStr, true));
				config.onToolResult?.(tc.name, { error: resultStr, isError: true });
				continue;
			}

			let args: Record<string, any>;
			try {
				args = JSON.parse(tc.arguments);
			} catch {
				const resultStr = `Invalid JSON arguments for tool ${tc.name}: ${tc.arguments.slice(0, 200)}`;
				messages.push(adapter.buildToolResult(tc.id, resultStr, true));
				config.onToolResult?.(tc.name, { error: resultStr, isError: true });
				continue;
			}

			if (tool.argSchema) {
				const validation = tool.argSchema.safeParse(args);
				if (!validation.success) {
					const { formatZodError } = await import('../schemas.js');
					const msg = formatZodError(`Invalid arguments for ${tc.name}`, validation.error);
					messages.push(adapter.buildToolResult(tc.id, msg, true));
					config.onToolResult?.(tc.name, { error: msg, isError: true });
					continue;
				}
			}

			const approvalPromise = config.onToolCall
				? Promise.resolve(config.onToolCall(tc.name, args))
				: Promise.resolve(true as boolean);
			const approved = await withTimeout(
				approvalPromise,
				TOOL_CALL_APPROVAL_TIMEOUT_MS,
				false,
			);

			if (!approved) {
				const resultStr = 'Tool call denied by user.';
				messages.push(adapter.buildToolResult(tc.id, resultStr, true));
				config.onToolResult?.(tc.name, { error: resultStr, isError: true });
				continue;
			}

			let result: any;
			let toolError: string | null = null;
			try {
				result = await tool.execute(args);
			} catch (err: any) {
				toolError = err.message || String(err);
				result = { error: toolError, isError: true };
			}
			config.onToolResult?.(tc.name, result);

			const resultStr =
				toolError ??
				(typeof result === 'string' ? result : JSON.stringify(result));
			messages.push(adapter.buildToolResult(tc.id, resultStr, !!toolError));
		}
	}

	const toolList =
		toolsUsed.size > 0 ? ` Tools called: ${[...toolsUsed].join(', ')}.` : '';
	const maxTurnsMsg = `Max turns reached without completion.${toolList} Narrow the scope or increase the turn budget.`;
	messages.push({ role: 'assistant', content: maxTurnsMsg });
	return maxTurnsMsg;
}
