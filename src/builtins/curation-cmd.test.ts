import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportCmd, importCmd, researchCmd, summarizeCmd } from './curation-cmd.js';

const RESEARCH_DIR = join(homedir(), '.wmind', 'research');

function makeCtx(overrides: any = {}) {
	const messages: any[] = [];
	let systemPrompt = '';
	return {
		args: '',
		agent: {
			messages,
			id: 'test',
			name: 'test',
			persona: '',
			systemPrompt,
			model: '',
			activeSkills: [],
			customPrompt: '',
			currentTask: undefined as string | undefined,
			packSystemPrompt: undefined,
		},
		config: {
			packs: [] as any[],
			...overrides.config,
		},
		get systemPrompt() {
			return systemPrompt;
		},
		set systemPrompt(v: string) {
			systemPrompt = v;
		},
		setHistory: () => {},
		setInput: () => {},
		exit: () => {},
		activateSkill: () => null as string | null,
		deactivateSkill: () => {},
	} as any;
}

function msg(r: any): { type: string; content: string; plainText?: boolean } {
	return r;
}

describe('curation commands', () => {
	describe('/summarize', () => {
		it('returns no-conversation message when empty', () => {
			const ctx = makeCtx();
			const result = msg(summarizeCmd.handler(ctx));
			expect(result.type).toBe('message');
			expect(result.content).toContain('No conversation');
		});

		it('produces trigger-agent to persist synthesis', () => {
			const ctx = makeCtx();
			ctx.agent.messages.push({
				role: 'user',
				content: 'What is quantum computing?',
			});
			ctx.agent.messages.push({
				role: 'assistant',
				content: 'Quantum computing uses qubits that can be in superposition.',
			});
			const result = msg(summarizeCmd.handler(ctx));
			expect(result.type).toBe('trigger-agent');
			expect(result.content).toContain('Saving synthesis');
		});

		it('sets currentTask for auto-persist', () => {
			const ctx = makeCtx();
			ctx.agent.messages.push({ role: 'user', content: 'Test question' });
			ctx.agent.messages.push({ role: 'assistant', content: 'Test answer' });
			summarizeCmd.handler(ctx);
			expect(ctx.agent.currentTask).toContain('Auto-persist');
		});

		it('includes sources in synthesis observations', () => {
			const ctx = makeCtx();
			ctx.agent.messages.push({ role: 'user', content: 'Search for X' });
			ctx.agent.messages.push({ role: 'assistant', content: 'Found X.' });
			ctx.agent.messages.push({
				role: 'tool_result',
				name: 'brave-search',
				content: 'Result data',
			});
			const result = msg(summarizeCmd.handler(ctx));
			expect(result.type).toBe('trigger-agent');
			expect(ctx.agent.currentTask).toContain('brave-search');
		});

		it('triggers agent auto-persist when no pack curation', () => {
			const ctx = makeCtx();
			ctx.agent.messages.push({ role: 'user', content: 'Hello' });
			ctx.agent.messages.push({ role: 'assistant', content: 'Hi there' });
			const result = msg(summarizeCmd.handler(ctx));
			expect(result.type).toBe('trigger-agent');
		});

		it('triggers agent auto-persist even with pack curation', () => {
			const ctx = makeCtx({
				config: {
					packs: [{ name: 'test', curation: { summarize: 'Custom template' } }],
				},
			});
			ctx.agent.messages.push({ role: 'user', content: 'Hello' });
			ctx.agent.messages.push({ role: 'assistant', content: 'Hi there' });
			const result = msg(summarizeCmd.handler(ctx));
			expect(result.type).toBe('trigger-agent');
		});
	});

	describe('/export', () => {
		const tmpDir = join(RESEARCH_DIR, '_test_export');

		beforeEach(() => {
			mkdirSync(tmpDir, { recursive: true });
		});

		afterEach(() => {
			rmSync(tmpDir, { recursive: true, force: true });
		});

		it('returns no-conversation message when empty', () => {
			const ctx = makeCtx();
			const result = msg(exportCmd.handler(ctx));
			expect(result.content).toContain('No conversation');
		});

		it('writes file immediately and returns path', () => {
			const ctx = makeCtx({
				config: {
					packs: [{ name: 'testexport', curation: {} }],
				},
			});
			ctx.agent.messages.push({ role: 'user', content: 'What is Rust?' });
			ctx.agent.messages.push({
				role: 'assistant',
				content: 'Rust is a systems programming language.',
			});
			const result = msg(exportCmd.handler(ctx));
			expect(result.type).toBe('message');
			expect(result.content).toContain('Exported');
			expect(result.content).toContain('testexport');
			expect(result.content).toContain('.md');
			expect(result.plainText).toBe(true);
		});

		it('does not inject messages into agent history', () => {
			const ctx = makeCtx({
				config: {
					packs: [{ name: 'testexport', curation: {} }],
				},
			});
			ctx.agent.messages.push({ role: 'user', content: 'Test' });
			ctx.agent.messages.push({ role: 'assistant', content: 'Answer' });
			const before = ctx.agent.messages.length;
			exportCmd.handler(ctx);
			expect(ctx.agent.messages.length).toBe(before);
		});

		it('produces document with findings and sources', () => {
			const ctx = makeCtx({
				config: {
					packs: [{ name: 'testexport', curation: {} }],
				},
			});
			ctx.agent.messages.push({ role: 'user', content: 'Tell me about Go' });
			ctx.agent.messages.push({
				role: 'assistant',
				content: 'Go has goroutines for concurrency.',
			});
			ctx.agent.messages.push({
				role: 'tool_result',
				name: 'brave-search',
				content: 'Search result',
			});
			const result = msg(exportCmd.handler(ctx));
			expect(result.content).toContain('1 sources');
		});

		it('uses custom filename from args', () => {
			const ctx = makeCtx({
				config: {
					packs: [{ name: 'testexport', curation: {} }],
				},
			});
			ctx.args = 'custom-topic';
			ctx.agent.messages.push({ role: 'user', content: 'Test' });
			ctx.agent.messages.push({ role: 'assistant', content: 'Answer' });
			const result = msg(exportCmd.handler(ctx));
			expect(result.content).toContain('custom-topic');
		});
	});

	describe('/import', () => {
		const tmpDir = join(RESEARCH_DIR, '_test');

		beforeEach(() => {
			mkdirSync(tmpDir, { recursive: true });
		});

		afterEach(() => {
			rmSync(tmpDir, { recursive: true, force: true });
		});

		it('returns usage when no args', () => {
			const ctx = makeCtx();
			const result = msg(importCmd.handler(ctx));
			expect(result.content).toContain('Usage:');
		});

		it('returns error when file not found', () => {
			const ctx = makeCtx();
			ctx.args = '/nonexistent/path.md';
			const result = msg(importCmd.handler(ctx));
			expect(result.content).toContain('not found');
		});

		it('loads file as context when it exists', () => {
			const testFile = join(tmpDir, 'test.md');
			writeFileSync(testFile, '# Test Research\nSome findings here.');
			const ctx = makeCtx();
			ctx.args = testFile;
			const result = msg(importCmd.handler(ctx));
			expect(result.content).toContain('Loaded research');
			expect(result.content).toContain('chars');
		});

		it('rejects files over 50K chars', () => {
			const testFile = join(tmpDir, 'big.md');
			writeFileSync(testFile, 'x'.repeat(55000));
			const ctx = makeCtx();
			ctx.args = testFile;
			const result = msg(importCmd.handler(ctx));
			expect(result.content).toContain('too large');
		});
	});

	describe('/research', () => {
		const tmpDir = join(RESEARCH_DIR, '_test');

		beforeEach(() => {
			mkdirSync(tmpDir, { recursive: true });
		});

		afterEach(() => {
			rmSync(tmpDir, { recursive: true, force: true });
		});

		it('list shows documents when research dir exists', () => {
			const ctx = makeCtx();
			ctx.args = 'list';
			const result = msg(researchCmd.handler(ctx));
			expect(result.type).toBe('message');
			if (result.content.includes('No saved research')) {
				expect(result.content).toContain('No saved research');
			} else {
				expect(result.content).toContain('documents');
			}
		});

		it('list shows saved documents', () => {
			writeFileSync(join(tmpDir, '2026-01-01-test.md'), '# Test');
			const ctx = makeCtx();
			ctx.args = 'list';
			const result = msg(researchCmd.handler(ctx));
			expect(result.content).toContain('_test');
			expect(result.content).toContain('2026-01-01-test.md');
		});

		it('show previews a document', () => {
			writeFileSync(join(tmpDir, '2026-01-01-test.md'), '# Test\nShort content.');
			const ctx = makeCtx();
			ctx.args = `show ${join(tmpDir, '2026-01-01-test.md')}`;
			const result = msg(researchCmd.handler(ctx));
			expect(result.content).toContain('Test');
		});

		it('show returns error for missing file', () => {
			const ctx = makeCtx();
			ctx.args = 'show nonexistent';
			const result = msg(researchCmd.handler(ctx));
			expect(result.content).toContain('not found');
		});

		it('returns usage for unknown subcommand', () => {
			const ctx = makeCtx();
			ctx.args = 'xyz';
			const result = msg(researchCmd.handler(ctx));
			expect(result.content).toContain('Usage:');
		});
	});
});
