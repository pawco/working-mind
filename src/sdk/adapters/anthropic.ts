import type { ProviderAdapter } from '../adapter.js';
import type { ProviderConfig, StreamEvent } from '../provider.js';
import { parseSSE } from '../sse.js';
import { toolDefToAnthropicFormat } from '../tool.js';

export class AnthropicAdapter implements ProviderAdapter {
	format = 'anthropic' as const;
	constructor(protected config: ProviderConfig) {}

	async *stream(
		messages: any[],
		tools: any[],
		opts: ProviderConfig,
	): AsyncGenerator<StreamEvent> {
		const res = await fetch(
			opts.baseUrl || 'https://api.anthropic.com/v1/messages',
			{
				method: 'POST',
				headers: this.getAuthHeaders(opts.apiKey),
				body: JSON.stringify({
					model: opts.model,
					max_tokens: opts.maxTokens || this.getDefaultMaxTokens(),
					messages,
					tools,
					stream: true,
					...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
					thinking: {
						type: 'enabled',
						budget_tokens:
							opts.thinkingBudget || this.getDefaultThinkingBudget(),
					},
				}),
			},
		);
		if (!res.ok)
			throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
		let currentToolId = '';
		let currentToolName = '';
		let currentToolArgs = '';
		if (!res.body) throw new Error('No response body');
		for await (const event of parseSSE(res.body)) {
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
				currentToolName = '';
			}
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
