import { describe, expect, it } from 'vitest';
import { AnthropicProviderError } from './adapters/anthropic.js';
import { OllamaProviderError } from './adapters/ollama.js';
import {
	classifyProviderError,
	ERROR_CATEGORY_LABELS,
	formatErrorForDisplay,
} from './provider-error.js';

describe('classifyProviderError', () => {
	it('classifies no API key errors', () => {
		const result = classifyProviderError(
			new Error('No API key configured for OpenAI. Use /connect to set one up.'),
		);
		expect(result.category).toBe('no_api_key');
		expect(result.canRetry).toBe(false);
		expect(result.suggestion).toContain('/connect');
	});

	it('classifies OpenAI SDK RateLimitError (429)', () => {
		const err = Object.assign(new Error('Rate limit reached for default-global'), {
			constructor: { name: 'RateLimitError' },
			status: 429,
		});
		const result = classifyProviderError(err);
		expect(result.category).toBe('rate_limit');
		expect(result.statusCode).toBe(429);
		expect(result.canRetry).toBe(true);
	});

	it('classifies OpenAI SDK AuthenticationError (401)', () => {
		const err = Object.assign(new Error('Incorrect API key provided'), {
			constructor: { name: 'AuthenticationError' },
			status: 401,
			code: 'invalid_api_key',
		});
		const result = classifyProviderError(err);
		expect(result.category).toBe('auth');
		expect(result.statusCode).toBe(401);
		expect(result.canRetry).toBe(false);
	});

	it('classifies context length exceeded', () => {
		const err = Object.assign(
			new Error(
				"This model's maximum context length is 128000 tokens. However, your messages resulted in 150000 tokens.",
			),
			{ code: 'context_length_exceeded', status: 400 },
		);
		const result = classifyProviderError(err);
		expect(result.category).toBe('context_length');
		expect(result.canRetry).toBe(false);
		expect(result.suggestion).toContain('/compact');
	});

	it('classifies AnthropicProviderError with rate_limit_error type', () => {
		const err = new AnthropicProviderError(
			429,
			'rate_limit_error',
			'This request would exceed the rate limit',
		);
		const result = classifyProviderError(err);
		expect(result.category).toBe('rate_limit');
		expect(result.statusCode).toBe(429);
		expect(result.providerMessage).toBe('This request would exceed the rate limit');
		expect(result.canRetry).toBe(true);
	});

	it('classifies AnthropicProviderError with authentication_error type', () => {
		const err = new AnthropicProviderError(401, 'authentication_error', 'invalid x-api-key');
		const result = classifyProviderError(err);
		expect(result.category).toBe('auth');
		expect(result.statusCode).toBe(401);
		expect(result.providerMessage).toBe('invalid x-api-key');
	});

	it('classifies AnthropicProviderError with overloaded_error type', () => {
		const err = new AnthropicProviderError(529, 'overloaded_error', 'Overloaded');
		const result = classifyProviderError(err);
		expect(result.category).toBe('overloaded');
		expect(result.canRetry).toBe(true);
	});

	it('classifies AnthropicProviderError with 500 status', () => {
		const err = new AnthropicProviderError(500, null, 'Internal server error');
		const result = classifyProviderError(err);
		expect(result.category).toBe('server_error');
		expect(result.statusCode).toBe(500);
	});

	it('classifies OllamaProviderError 404 as not_found with ollama pull hint', () => {
		const err = new OllamaProviderError(404, 'model "xyz" not found');
		const result = classifyProviderError(err);
		expect(result.category).toBe('not_found');
		expect(result.statusCode).toBe(404);
		expect(result.providerMessage).toBe('model "xyz" not found');
		expect(result.suggestion).toContain('ollama pull');
	});

	it('classifies OllamaProviderError 500 as server_error', () => {
		const err = new OllamaProviderError(500, 'internal server error');
		const result = classifyProviderError(err);
		expect(result.category).toBe('server_error');
		expect(result.canRetry).toBe(true);
	});

	it('classifies connection errors', () => {
		const result = classifyProviderError(new Error('Connection error.'));
		expect(result.category).toBe('connection');
		expect(result.canRetry).toBe(true);
	});

	it('classifies fetch failed as connection', () => {
		const result = classifyProviderError(new Error('fetch failed'));
		expect(result.category).toBe('connection');
	});

	it('classifies request timeout as connection', () => {
		const result = classifyProviderError(new Error('Request timed out.'));
		expect(result.category).toBe('connection');
	});

	it('falls back to unknown for unrecognized errors', () => {
		const result = classifyProviderError(new Error('Something unexpected happened'));
		expect(result.category).toBe('unknown');
		expect(result.canRetry).toBe(true);
	});

	it('classifies legacy "Anthropic error" string format', () => {
		const err = new Error(
			'Anthropic error 429: {"type":"error","error":{"type":"rate_limit_error","message":"Too many requests"}}',
		);
		const result = classifyProviderError(err);
		expect(result.category).toBe('rate_limit');
		expect(result.statusCode).toBe(429);
	});

	it('classifies legacy "Ollama error" string format', () => {
		const err = new Error('Ollama error 404: {"error":"model not found"}');
		const result = classifyProviderError(err);
		expect(result.category).toBe('not_found');
		expect(result.statusCode).toBe(404);
	});

	it('classifies 403 PermissionDeniedError', () => {
		const err = Object.assign(new Error('Insufficient permissions'), {
			constructor: { name: 'PermissionDeniedError' },
			status: 403,
		});
		const result = classifyProviderError(err);
		expect(result.category).toBe('auth');
		expect(result.statusCode).toBe(403);
	});
});

describe('formatErrorForDisplay', () => {
	it('includes status code when not already in message', () => {
		const result = formatErrorForDisplay({
			category: 'rate_limit',
			statusCode: 429,
			providerMessage: 'Rate limit reached',
			suggestion: 'Wait and retry',
			canRetry: true,
		});
		expect(result).toBe('[429] Rate limit reached');
	});

	it('does not duplicate status code when already in message', () => {
		const result = formatErrorForDisplay({
			category: 'auth',
			statusCode: 401,
			providerMessage: 'HTTP 401: invalid api key',
			suggestion: 'Run /connect',
			canRetry: false,
		});
		expect(result).toBe('HTTP 401: invalid api key');
	});

	it('handles null status code', () => {
		const result = formatErrorForDisplay({
			category: 'connection',
			statusCode: null,
			providerMessage: 'Connection error',
			suggestion: 'Check internet',
			canRetry: true,
		});
		expect(result).toBe('Connection error');
	});
});

describe('ERROR_CATEGORY_LABELS', () => {
	it('has a label for every category', () => {
		const categories: Array<keyof typeof ERROR_CATEGORY_LABELS> = [
			'rate_limit',
			'auth',
			'context_length',
			'overloaded',
			'server_error',
			'connection',
			'not_found',
			'no_api_key',
			'unknown',
		];
		for (const cat of categories) {
			expect(ERROR_CATEGORY_LABELS[cat]).toBeTruthy();
		}
	});
});
