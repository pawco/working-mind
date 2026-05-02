import type { ProviderConfig, StreamEvent } from './provider.js';
import type { ToolDef } from './tool.js';

export interface ProviderAdapter {
	format: 'openai' | 'anthropic' | 'ollama';
	stream(
		messages: any[],
		tools: any[],
		config: ProviderConfig,
	): AsyncGenerator<StreamEvent>;
	formatTools(tools: ToolDef[]): any[];
	buildMessages(messages: any[], systemPrompt: string): any[];
	buildToolResult(toolCallId: string, result: string, isError: boolean): any;
	getDefaultMaxTokens(): number | undefined;
	getDefaultThinkingBudget(): number | undefined;
	getAuthHeaders(apiKey: string): Record<string, string>;
	getApiEndpoint(baseUrl: string): string;
}
