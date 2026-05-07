import OpenAI from 'openai';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';
import type { ProviderAdapter } from '../adapter.js';
import type { ProviderConfig, StreamEvent } from '../provider.js';
import { toolDefToOpenAIFormat } from '../tool.js';

const DEBUG = typeof process !== 'undefined' && process.env.WMIND_DEBUG === '1';

export class OpenAICompatAdapter implements ProviderAdapter {
	format = 'openai' as const;

	constructor(protected config: ProviderConfig) {}

	private makeClient(opts: ProviderConfig): OpenAI {
		const apiKey = opts.apiKey || this.config.apiKey || 'not-needed';
		return new OpenAI({
			apiKey,
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
			stream_options: { include_usage: true },
		};
		if (tools.length > 0) {
			params.tools = tools;
			params.tool_choice = 'auto';
		}
		if (opts.supportsReasoning) {
			(params as any).reasoning = { effort: 'high' };
		}

		if (DEBUG) {
			console.error(
				'[openai-compat] stream params:',
				JSON.stringify({
					model: opts.model,
					toolCount: tools.length,
					supportsReasoning: opts.supportsReasoning,
					messageCount: messages.length,
				}),
			);
		}

		const stream = await client.chat.completions.create(params, {
			signal: opts.signal,
		});

		let currentToolCall: Partial<{
			id: string;
			name: string;
			arguments: string;
		}> | null = null;
		let lastFinishReason: string | null = null;

		for await (const chunk of stream) {
			if (chunk.usage) {
				yield {
					type: 'usage',
					promptTokens: chunk.usage.prompt_tokens ?? 0,
					completionTokens: chunk.usage.completion_tokens ?? 0,
				};
			}

			const choice = chunk.choices?.[0];
			if (choice?.finish_reason) {
				lastFinishReason = choice.finish_reason;
			}

			const delta = choice?.delta;
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
		if (currentToolCall) yield { type: 'tool_call', ...currentToolCall } as StreamEvent;

		if (DEBUG) {
			console.error(
				'[openai-compat] stream ended. finish_reason:',
				lastFinishReason,
				'toolCallAccumulated:',
				!!currentToolCall,
			);
		}
	}

	formatTools(tools: any[]) {
		return tools.map(toolDefToOpenAIFormat);
	}

	buildMessages(messages: any[], systemPrompt: string): any[] {
		return [{ role: 'system', content: systemPrompt }, ...messages];
	}

	buildToolResult(toolCallId: string, result: string, isError: boolean): any {
		const content = isError ? `[Tool Error] ${result}` : result;
		return { role: 'tool', tool_call_id: toolCallId, content };
	}

	getDefaultMaxTokens(): number | undefined {
		return undefined;
	}

	getDefaultThinkingBudget(): number | undefined {
		return undefined;
	}

	getAuthHeaders(apiKey: string): Record<string, string> {
		if (!apiKey || apiKey === 'not-needed') return {};
		return { Authorization: `Bearer ${apiKey}` };
	}

	getApiEndpoint(baseUrl: string): string {
		return `${baseUrl}/chat/completions`;
	}
}
