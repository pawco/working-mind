import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assembleSystemPrompt } from './system-prompt.js';

describe('assembleSystemPrompt', () => {
	it('returns default prompt with no args', () => {
		const prompt = assembleSystemPrompt();
		expect(prompt).toContain('OpenExplorer');
		expect(prompt).toContain('reasoning agent');
	});

	it('uses persona prompt from PersonaDef', () => {
		const prompt = assembleSystemPrompt(undefined, {
			prompt: 'You are a deploy agent.',
		});
		expect(prompt).toBe('You are a deploy agent.');
	});

	it('uses inline text when no file exists', () => {
		const prompt = assembleSystemPrompt('You are a helpful assistant.');
		expect(prompt).toBe('You are a helpful assistant.');
	});

	it('reads from file if path exists', () => {
		const tmpFile = join(tmpdir(), `oe-test-${Date.now()}.md`);
		writeFileSync(tmpFile, 'You are the file agent.');
		try {
			const prompt = assembleSystemPrompt(tmpFile);
			expect(prompt).toBe('You are the file agent.');
		} finally {
			rmSync(tmpFile);
		}
	});

	it('uses config system prompt when provided', () => {
		const prompt = assembleSystemPrompt(undefined, undefined, {
			systemPrompts: { default: 'Config prompt.' },
		});
		expect(prompt).toBe('Config prompt.');
	});

	it('uses named prompt from config', () => {
		const prompt = assembleSystemPrompt('code-review', undefined, {
			systemPrompts: { 'code-review': 'Review code.' },
		});
		expect(prompt).toBe('Review code.');
	});
});
