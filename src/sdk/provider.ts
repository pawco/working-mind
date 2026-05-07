export interface ProviderConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
	supportsReasoning?: boolean;
	maxTokens?: number;
	thinkingBudget?: number;
	systemPrompt?: string;
	signal?: AbortSignal;
}

export type StreamEvent =
	| { type: 'text'; content: string }
	| { type: 'tool_call'; id: string; name: string; arguments: string }
	| { type: 'thinking'; content: string }
	| { type: 'usage'; promptTokens: number; completionTokens: number };

export interface Provider {
	stream(
		messages: any[],
		tools: any[],
		config: ProviderConfig,
	): AsyncGenerator<StreamEvent>;
	format: 'openai' | 'anthropic';
}
