import type { ProviderAdapter } from '../adapter.js';
import type { ProviderConfig, StreamEvent } from '../provider.js';
import { parseSSE } from '../sse.js';
import { toolDefToAnthropicFormat } from '../tool.js';

const DEBUG = typeof process !== 'undefined' && process.env.WMIND_DEBUG === '1';

export class AnthropicProviderError extends Error {
	constructor(
		public status: number,
		public errorType: string | null,
		message: string,
	) {
		super(message);
		this.name = 'AnthropicProviderError';
		this.status = status;
		this.errorType = errorType;
	}
}

export class AnthropicAdapter implements ProviderAdapter {
	format = 'anthropic' as const;
	constructor(protected config: ProviderConfig) {}

	async *stream(
		messages: any[],
		tools: any[],
		opts: ProviderConfig,
	): AsyncGenerator<StreamEvent> {
		const bodyParams: Record<string, any> = {
			model: opts.model,
			max_tokens: opts.maxTokens || this.getDefaultMaxTokens(),
			messages,
			stream: true,
			...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
		};
		if (tools.length > 0) {
			bodyParams.tools = tools;
			bodyParams.tool_choice = { type: 'auto' };
		}
		if (opts.supportsReasoning) {
			bodyParams.thinking = {
				type: 'enabled',
				budget_tokens: opts.thinkingBudget || this.getDefaultThinkingBudget(),
			};
		}

		if (DEBUG) {
			console.error(
				'[anthropic] stream params:',
				JSON.stringify({
					model: opts.model,
					toolCount: tools.length,
					supportsReasoning: opts.supportsReasoning,
					messageCount: messages.length,
				}),
			);
		}

		const res = await fetch(
			opts.baseUrl || 'https://api.anthropic.com/v1/messages',
			{
				method: 'POST',
				headers: this.getAuthHeaders(opts.apiKey),
				body: JSON.stringify(bodyParams),
			},
		);
		if (!res.ok) {
			let errorType: string | null = null;
			let errorMessage = `HTTP ${res.status}`;
			try {
				const body = await res.text();
				const parsed = JSON.parse(body);
				errorType = parsed?.error?.type ?? null;
				errorMessage = parsed?.error?.message || errorMessage;
			} catch {}
			throw new AnthropicProviderError(res.status, errorType, errorMessage);
		}
		let currentToolId = '';
		let currentToolName = '';
		let currentToolArgs = '';
		let lastInputTokens = 0;
		let stopReason: string | null = null;
		let toolCallCount = 0;
		if (!res.body) throw new Error('No response body');
		for await (const event of parseSSE(res.body)) {
			if (
				event.type === 'message_start' &&
				event.message?.usage?.input_tokens
			) {
				lastInputTokens = event.message.usage.input_tokens;
			}
			if (event.type === 'message_delta') {
				if (event.usage?.output_tokens) {
					yield {
						type: 'usage',
						promptTokens: lastInputTokens,
						completionTokens: event.usage.output_tokens,
					};
				}
				if (event.delta?.stop_reason) {
					stopReason = event.delta.stop_reason;
				}
			}
			if (
				event.type === 'content_block_start' &&
				event.content_block?.type === 'thinking'
			) {
			}
			if (
				event.type === 'content_block_delta' &&
				event.delta?.type === 'thinking_delta'
			) {
				yield { type: 'thinking', content: event.delta.thinking };
			}
			if (
				event.type === 'content_block_start' &&
				event.content_block?.type === 'tool_use'
			) {
				currentToolId = event.content_block.id;
				currentToolName = event.content_block.name;
				currentToolArgs = '';
			}
			if (
				event.type === 'content_block_delta' &&
				event.delta?.type === 'input_json_delta'
			) {
				currentToolArgs += event.delta.partial_json;
			}
			if (
				event.type === 'content_block_delta' &&
				event.delta?.type === 'text_delta'
			) {
				yield { type: 'text', content: event.delta.text };
			}
			if (event.type === 'content_block_stop' && currentToolName) {
				yield {
					type: 'tool_call',
					id: currentToolId,
					name: currentToolName,
					arguments: currentToolArgs,
				};
				toolCallCount++;
				currentToolName = '';
			}
		}

		if (DEBUG) {
			console.error(
				'[anthropic] stream ended. stop_reason:',
				stopReason,
				'toolCallCount:',
				toolCallCount,
			);
		}
	}

	formatTools(tools: any[]) {
		return tools.map(toolDefToAnthropicFormat);
	}

	buildMessages(messages: any[], _systemPrompt: string): any[] {
		return messages;
	}

	buildToolResult(toolCallId: string, result: string, isError: boolean): any {
		return {
			role: 'user',
			content: [
				{
					type: 'tool_result',
					tool_use_id: toolCallId,
					content: result,
					is_error: isError,
				},
			],
		};
	}

	getDefaultMaxTokens(): number | undefined {
		return 16384;
	}

	getDefaultThinkingBudget(): number | undefined {
		return 10000;
	}

	getAuthHeaders(apiKey: string): Record<string, string> {
		return {
			'x-api-key': apiKey,
			'anthropic-version': '2023-06-01',
			'Content-Type': 'application/json',
		};
	}

	getApiEndpoint(baseUrl: string): string {
		return `${baseUrl}/messages`;
	}
}
