import { describe, expect, it } from 'vitest';
import {
	deleteKey,
	envVarSuggestion,
	retrieveKey,
	storeKey,
} from './keychain.js';

describe('keychain', () => {
	it('storeKey returns false when keytar unavailable', async () => {
		const result = await storeKey('test-provider', 'test-key');
		expect(result).toBe(false);
	});

	it('retrieveKey returns null when keytar unavailable', async () => {
		const result = await retrieveKey('test-provider');
		expect(result).toBeNull();
	});

	it('deleteKey returns false when keytar unavailable', async () => {
		const result = await deleteKey('test-provider');
		expect(result).toBe(false);
	});

	it('envVarSuggestion generates correct suggestion', () => {
		expect(envVarSuggestion('openai')).toBe(
			'export OPENAI_API_KEY=your-key-here',
		);
		expect(envVarSuggestion('anthropic')).toBe(
			'export ANTHROPIC_API_KEY=your-key-here',
		);
	});
});
