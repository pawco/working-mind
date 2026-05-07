import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext, CommandResult } from '../sdk/command.js';
import { ingestCmd, listMdFiles } from './ingest-cmd.js';

const TMP_DIR = join(process.cwd(), 'test-ingest-tmp');

function makeCtx(args: string, overrides?: Partial<CommandContext>): CommandContext {
	return {
		args,
		agent: {
			id: 'test',
			name: 'test',
			persona: 'default',
			systemPrompt: '',
			tools: [],
			messages: [],
			status: 'idle',
			model: 'test',
			activeSkills: new Set(),
			currentTask: undefined,
			packSystemPrompt: undefined,
		},
		config: {
			model: 'test',
			packs: [],
			userConfig: {},
		} as any,
		mcpRegistry: {
			getServerInfo: (name: string) =>
				name === 'memory' ? { status: 'connected' } : undefined,
		} as any,
		setHistory: () => {},
		setInput: () => {},
		exit: () => {},
		activateSkill: () => null,
		deactivateSkill: () => {},
		getUserConfig: () => ({ lastMemoryStore: 'default', providers: {} }),
		writeUserConfig: () => {},
		...overrides,
	} as CommandContext;
}

function run(args: string, overrides?: Partial<CommandContext>): CommandResult {
	return ingestCmd.handler(makeCtx(args, overrides)) as CommandResult;
}

describe('ingestCmd', () => {
	beforeEach(() => {
		mkdirSync(TMP_DIR, { recursive: true });
	});
	afterEach(() => {
		rmSync(TMP_DIR, { recursive: true, force: true });
	});

	it('rejects filenames with path separators', () => {
		const r = run('../etc/passwd');
		expect(r.type).toBe('message');
		if (r.type === 'message') expect(r.content).toContain('Only filenames in the current directory');
	});

	it('rejects backslash path separators', () => {
		const r = run('sub\\file.md');
		expect(r.type).toBe('message');
		if (r.type === 'message') expect(r.content).toContain('Only filenames in the current directory');
	});

	it('reports file not found', () => {
		const r = run('nonexistent.md');
		expect(r.type).toBe('message');
		if (r.type === 'message') expect(r.content).toContain('File not found');
	});

	it('reports when memory MCP is not connected', () => {
		const r = run('test.md', {
			mcpRegistry: { getServerInfo: () => undefined } as any,
		});
		expect(r.type).toBe('message');
		if (r.type === 'message') expect(r.content).toContain('Memory MCP server is not connected');
	});

	it('reports empty file', () => {
		writeFileSync(join(TMP_DIR, 'empty.md'), '   \n\n  ', 'utf-8');
		const origCwd = process.cwd();
		try {
			process.chdir(TMP_DIR);
			const r = run('empty.md');
			expect(r.type).toBe('message');
			if (r.type === 'message') expect(r.content).toContain('File is empty');
		} finally {
			process.chdir(origCwd);
		}
	});

	it('reports file too large', () => {
		writeFileSync(join(TMP_DIR, 'big.md'), 'x'.repeat(50_001), 'utf-8');
		const origCwd = process.cwd();
		try {
			process.chdir(TMP_DIR);
			const r = run('big.md');
			expect(r.type).toBe('message');
			if (r.type === 'message') expect(r.content).toContain('File too large');
		} finally {
			process.chdir(origCwd);
		}
	});

	it('returns confirm result for unconfirmed ingestion', () => {
		writeFileSync(join(TMP_DIR, 'doc.md'), '# GDPR\nThe General Data Protection Regulation applies.', 'utf-8');
		const origCwd = process.cwd();
		try {
			process.chdir(TMP_DIR);
			const r = run('doc.md');
			expect(r.type).toBe('confirm');
			if (r.type === 'confirm') {
				expect(r.message).toContain('doc.md');
				expect(r.message).toContain('prompt injection');
				expect(r.command).toBe('ingest');
				expect(r.args).toContain('--confirmed');
				expect(r.args).toContain('doc.md');
			}
		} finally {
			process.chdir(origCwd);
		}
	});

	it('returns trigger-agent when confirmed', () => {
		writeFileSync(join(TMP_DIR, 'doc.md'), '# GDPR\nThe General Data Protection Regulation applies.', 'utf-8');
		const origCwd = process.cwd();
		try {
			process.chdir(TMP_DIR);
			const ctx = makeCtx('doc.md --confirmed');
			const r = ingestCmd.handler(ctx) as CommandResult;
			expect(r.type).toBe('trigger-agent');
			if (r.type === 'trigger-agent') {
				expect(r.content).toContain('GDPR');
				expect(r.content).toContain('doc.md');
			}
			expect(ctx.agent.currentTask).toContain('Ingest the following document');
			expect(ctx.agent.currentTask).toContain('doc.md');
		} finally {
			process.chdir(origCwd);
		}
	});

	it('sets allowedTools to memory tools only', () => {
		expect(ingestCmd.allowedTools).toEqual([
			'mcp__memory__search_nodes',
			'mcp__memory__create_entities',
			'mcp__memory__add_observations',
			'mcp__memory__create_relations',
			'mcp__memory__read_graph',
			'mcp__memory__open_nodes',
		]);
	});

	it('marks requiresConfirmation as true', () => {
		expect(ingestCmd.requiresConfirmation).toBe(true);
	});

	it('lists .md files when no filename given', () => {
		writeFileSync(join(TMP_DIR, 'readme.md'), '# Test', 'utf-8');
		const origCwd = process.cwd();
		try {
			process.chdir(TMP_DIR);
			const r = run('');
			expect(r.type).toBe('message');
			if (r.type === 'message') {
				expect(r.content).toContain('Available files');
				expect(r.content).toContain('readme.md');
			}
		} finally {
			process.chdir(origCwd);
		}
	});

	it('shows no files message when directory has no .md files', () => {
		const origCwd = process.cwd();
		try {
			process.chdir(TMP_DIR);
			const r = run('');
			expect(r.type).toBe('message');
			if (r.type === 'message') expect(r.content).toContain('No .md files');
		} finally {
			process.chdir(origCwd);
		}
	});

	it('confirm result includes file size info', () => {
		const content = '# Test\n' + 'x'.repeat(500);
		writeFileSync(join(TMP_DIR, 'doc.md'), content, 'utf-8');
		const origCwd = process.cwd();
		try {
			process.chdir(TMP_DIR);
			const r = run('doc.md');
			expect(r.type).toBe('confirm');
			if (r.type === 'confirm') expect(r.message).toContain(`${content.length} chars`);
		} finally {
			process.chdir(origCwd);
		}
	});

	it('confirmed ingestion sets extraction directive with filename', () => {
		writeFileSync(join(TMP_DIR, 'report.md'), '# Report\nSome content here.', 'utf-8');
		const origCwd = process.cwd();
		try {
			process.chdir(TMP_DIR);
			const ctx = makeCtx('report.md --confirmed');
			ingestCmd.handler(ctx) as CommandResult;
			expect(ctx.agent.currentTask).toContain('report.md');
			expect(ctx.agent.currentTask).toContain('EXTRACT');
			expect(ctx.agent.currentTask).toContain('INTEGRATE');
			expect(ctx.agent.currentTask).toContain('CROSS-REFERENCE');
		} finally {
			process.chdir(origCwd);
		}
	});

	it('handles confirmed flag in any position', () => {
		writeFileSync(join(TMP_DIR, 'doc.md'), '# Doc\nContent.', 'utf-8');
		const origCwd = process.cwd();
		try {
			process.chdir(TMP_DIR);
			const r = run('--confirmed doc.md');
			expect(r.type).toBe('trigger-agent');
		} finally {
			process.chdir(origCwd);
		}
	});

	describe('listMdFiles', () => {
		it('lists .md files in current directory', () => {
			writeFileSync(join(TMP_DIR, 'a.md'), 'content', 'utf-8');
			writeFileSync(join(TMP_DIR, 'b.md'), 'content', 'utf-8');
			writeFileSync(join(TMP_DIR, 'c.txt'), 'not md', 'utf-8');
			const origCwd = process.cwd();
			try {
				process.chdir(TMP_DIR);
				const files = listMdFiles();
				expect(files).toContain('a.md');
				expect(files).toContain('b.md');
				expect(files).not.toContain('c.txt');
			} finally {
				process.chdir(origCwd);
			}
		});

		it('returns empty array when no .md files', () => {
			writeFileSync(join(TMP_DIR, 'data.json'), '{}', 'utf-8');
			const origCwd = process.cwd();
			try {
				process.chdir(TMP_DIR);
				const files = listMdFiles();
				expect(files).toEqual([]);
			} finally {
				process.chdir(origCwd);
			}
		});

		it('returns empty array on unreadable directory', () => {
			const files = listMdFiles();
			expect(Array.isArray(files)).toBe(true);
		});
	});
});
