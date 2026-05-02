import type { UserConfig } from '../config.js';
import { resolveModelSpec } from './provider-resolve.js';
import type { ToolDef } from './tool.js';

export interface AgentRunConfig {
	model: string;
	apiKey: string;
	baseUrl?: string;
	systemPrompt: string;
	tools: ToolDef[];
	maxTurns: number;
	supportsReasoning?: boolean;
	onText?: (text: string) => void;
	onThinking?: (text: string) => void;
	onToolCall?: (name: string, args: any) => boolean | Promise<boolean>;
	onToolResult?: (name: string, result: any) => void;
	userConfig?: UserConfig;
	signal?: AbortSignal;
}

export class RequestCancelledError extends Error {
	constructor() {
		super('Request cancelled');
		this.name = 'RequestCancelledError';
	}
}

export async function runAgent(
	messages: any[],
	config: AgentRunConfig,
): Promise<string> {
	const resolved = resolveModelSpec(config.model, config.userConfig);
	const adapter = resolved.adapter;
	const toolMap = new Map(config.tools.map((t) => [t.name, t]));

	for (let turn = 0; turn < config.maxTurns; turn++) {
		if (config.signal?.aborted) throw new RequestCancelledError();

		const apiTools = adapter.formatTools(config.tools);
		let assistantContent = '';
		const toolCalls: { id: string; name: string; arguments: string }[] = [];

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
			model: resolved.model?.id || config.model,
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
			if (event.type === 'tool_call') {
				toolCalls.push({
					id: event.id,
					name: event.name,
					arguments: event.arguments,
				});
			}
		}

		if (toolCalls.length === 0) {
			messages.push({ role: 'assistant', content: assistantContent });
			return assistantContent;
		}

		messages.push({
			role: 'assistant',
			content: assistantContent,
			tool_calls: toolCalls,
		});

		for (const tc of toolCalls) {
			if (config.signal?.aborted) throw new RequestCancelledError();
			const tool = toolMap.get(tc.name);
			if (!tool) continue;

			let args: Record<string, any>;
			try {
				args = JSON.parse(tc.arguments);
			} catch {
				args = {};
			}

			const approved = config.onToolCall
				? await config.onToolCall(tc.name, tc.arguments)
				: true;

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

	return 'Max turns reached without completion.';
}
