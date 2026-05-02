import type { ProviderAdapter } from '../adapter.js';
import type { ProviderConfig } from '../provider.js';
import { AnthropicAdapter } from './anthropic.js';
import { OllamaAdapter } from './ollama.js';
import { OpenAICompatAdapter } from './openai-compat.js';

export { AnthropicAdapter } from './anthropic.js';
export { OllamaAdapter } from './ollama.js';
export { OpenAICompatAdapter } from './openai-compat.js';

export function createAdapter(
	apiFormat: string,
	config: ProviderConfig,
): ProviderAdapter {
	switch (apiFormat) {
		case 'anthropic':
			return new AnthropicAdapter(config);
		case 'ollama':
			return new OllamaAdapter(config);
		default:
			return new OpenAICompatAdapter(config);
	}
}
