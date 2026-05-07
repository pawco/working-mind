import { describe, expect, it } from 'vitest';
import { AnthropicAdapter } from './anthropic.js';
import { OllamaAdapter } from './ollama.js';
import { OpenAICompatAdapter } from './openai-compat.js';

const baseConfig = {
	apiKey: 'unused',
	baseUrl: 'http://localhost',
	model: 'test',
};

describe('OpenAICompatAdapter.getAuthHeaders', () => {
	it('returns Bearer authorization header', () => {
		const adapter = new OpenAICompatAdapter(baseConfig);
		const headers = adapter.getAuthHeaders('sk-test-key');
		expect(headers).toEqual({ Authorization: 'Bearer sk-test-key' });
	});
});

describe('AnthropicAdapter.getAuthHeaders', () => {
	it('returns x-api-key header', () => {
		const adapter = new AnthropicAdapter(baseConfig);
		const headers = adapter.getAuthHeaders('sk-ant-test');
		expect(headers['x-api-key']).toBe('sk-ant-test');
		expect(headers['anthropic-version']).toBeDefined();
	});
});

describe('OllamaAdapter.getAuthHeaders', () => {
	it('returns Content-Type header without auth', () => {
		const adapter = new OllamaAdapter({
			...baseConfig,
			baseUrl: 'http://localhost:11434',
		});
		const headers = adapter.getAuthHeaders('local');
		expect(headers['Content-Type']).toBe('application/json');
		expect(headers.Authorization).toBeUndefined();
	});
});
