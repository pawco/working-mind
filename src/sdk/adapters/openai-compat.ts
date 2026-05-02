import OpenAI from 'openai';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';
import type { ProviderAdapter } from '../adapter.js';
import type { ProviderConfig, StreamEvent } from '../provider.js';
import { toolDefToOpenAIFormat } from '../tool.js';

export class OpenAICompatAdapter implements ProviderAdapter {
	format = 'openai' as const;

	constructor(protected config: ProviderConfig) {}

	private makeClient(opts: ProviderConfig): OpenAI {
		return new OpenAI({
			apiKey: opts.apiKey || this.config.apiKey || 'unused',
			baseURL: opts.baseUrl || this.config.baseUrl,
			maxRetries: 2,
			timeout: 600_000,
		});
	}

	async *stream(
		messages: any[],
		tools: any[],
		opts: ProviderConfig,
	): AsyncGenerator<StreamEvent> {
		const client = this.makeClient(opts);
		const params: ChatCompletionCreateParamsStreaming = {
			model: opts.model,
			messages,
			stream: true,
		};
		if (tools.length > 0) params.tools = tools;
		if (opts.supportsReasoning) {
			(params as any).reasoning = { effort: 'high' };
		}

		const stream = await client.chat.completions.create(params, {
			signal: opts.signal,
		});

		let currentToolCall: Partial<{
			id: string;
			name: string;
			arguments: string;
		}> | null = null;

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta;
			if (!delta) continue;

			if ((delta as any).reasoning_content) {
				yield {
					type: 'thinking',
					content: (delta as any).reasoning_content,
				};
			}
			if ((delta as any).reasoning_details) {
				for (const rd of (delta as any).reasoning_details) {
					if (rd.type === 'reasoning.text' && rd.text) {
						yield { type: 'thinking', content: rd.text };
					} else if (rd.type === 'reasoning.summary' && rd.summary) {
						yield { type: 'thinking', content: rd.summary };
					}
				}
			}
			if (delta.content) {
				yield { type: 'text', content: delta.content };
			}
			if (delta.tool_calls) {
				for (const tc of delta.tool_calls) {
					if (tc.id) {
						if (currentToolCall)
							yield { type: 'tool_call', ...currentToolCall } as StreamEvent;
						currentToolCall = {
							id: tc.id,
							name: tc.function?.name,
							arguments: tc.function?.arguments ?? '',
						};
					} else if (currentToolCall && tc.function?.arguments) {
						currentToolCall.arguments += tc.function.arguments;
					}
				}
			}
		}
		if (currentToolCall)
			yield { type: 'tool_call', ...currentToolCall } as StreamEvent;
	}

	formatTools(tools: any[]) {
		return tools.map(toolDefToOpenAIFormat);
	}

	buildMessages(messages: any[], systemPrompt: string): any[] {
		return [{ role: 'system', content: systemPrompt }, ...messages];
	}

	buildToolResult(toolCallId: string, result: string, _isError: boolean): any {
		return { role: 'tool', tool_call_id: toolCallId, content: result };
	}

	getDefaultMaxTokens(): number | undefined {
		return undefined;
	}

	getDefaultThinkingBudget(): number | undefined {
		return undefined;
	}

	getAuthHeaders(_apiKey: string): Record<string, string> {
		return {};
	}

	getApiEndpoint(baseUrl: string): string {
		return `${baseUrl}/chat/completions`;
	}
}
