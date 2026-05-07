import type { ProviderAdapter } from '../adapter.js';
import type { ProviderConfig, StreamEvent } from '../provider.js';
import { toolDefToOpenAIFormat } from '../tool.js';

const DEBUG = typeof process !== 'undefined' && process.env.WMIND_DEBUG === '1';

export class OllamaProviderError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
		this.name = 'OllamaProviderError';
	}
}

export class OllamaAdapter implements ProviderAdapter {
	format = 'openai' as const;
	constructor(protected config: ProviderConfig) {}

	async *stream(
		messages: any[],
		tools: any[],
		opts: ProviderConfig,
	): AsyncGenerator<StreamEvent> {
		const body: Record<string, any> = {
			model: opts.model,
			messages,
			stream: true,
		};
		if (opts.systemPrompt) body.system = opts.systemPrompt;
		if (opts.supportsReasoning) body.think = true;
		if (tools && tools.length > 0) {
			body.tools = tools.map((t: any) => ({
				type: 'function',
				function: t.function,
			}));
		}

		if (DEBUG) {
			console.error(
				'[ollama] stream params:',
				JSON.stringify({
					model: opts.model,
					toolCount: tools?.length ?? 0,
					supportsReasoning: opts.supportsReasoning,
					messageCount: messages.length,
				}),
			);
		}

		const res = await fetch(`${opts.baseUrl}/api/chat`, {
			method: 'POST',
			headers: this.getAuthHeaders(''),
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			let errorMessage = `HTTP ${res.status}`;
			try {
				const body = await res.text();
				const parsed = JSON.parse(body);
				errorMessage = parsed?.error || errorMessage;
			} catch {}
			throw new OllamaProviderError(res.status, errorMessage);
		}
		if (!res.body) throw new Error('No response body');

		const decoder = new TextDecoder();
		const reader = res.body.getReader();
		let buf = '';
		let toolCallCount = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			const lines = buf.split('\n');
			buf = lines.pop() || '';
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				try {
					const chunk = JSON.parse(trimmed);
					const promptEval = chunk.prompt_eval_count;
					const evalCount = chunk.eval_count;
					if (chunk.done && typeof promptEval === 'number') {
						yield {
							type: 'usage',
							promptTokens: promptEval,
							completionTokens: typeof evalCount === 'number' ? evalCount : 0,
						};
					}
					const msg = chunk.message;
					if (!msg) continue;
					if (msg.thinking) {
						yield { type: 'thinking', content: msg.thinking };
					}
					if (msg.content) {
						yield { type: 'text', content: msg.content };
					}
					if (msg.tool_calls) {
						for (const tc of msg.tool_calls) {
							toolCallCount++;
							yield {
								type: 'tool_call',
								id: tc.id || `tc_${Date.now()}`,
								name: tc.function?.name,
								arguments: JSON.stringify(tc.function?.arguments ?? {}),
							};
						}
					}
				} catch {}
			}
		}

		if (DEBUG) {
			console.error('[ollama] stream ended. toolCallCount:', toolCallCount);
		}
	}

	formatTools(tools: any[]) {
		return tools.map(toolDefToOpenAIFormat);
	}

	buildMessages(messages: any[], _systemPrompt: string): any[] {
		return messages.filter((m: any) => m.role !== 'system');
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

	getAuthHeaders(_apiKey: string): Record<string, string> {
		return { 'Content-Type': 'application/json' };
	}

	getApiEndpoint(baseUrl: string): string {
		return `${baseUrl}/api/chat`;
	}
}
