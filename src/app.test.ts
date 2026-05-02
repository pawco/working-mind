import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from './sdk/command.js';
import { computeInputBarHeight } from './ui/input-bar.js';

describe('parseSlashCommand', () => {
	function parseSlashCommand(
		input: string,
	): { command: string; arg?: string } | null {
		const trimmed = input.trim();
		if (!trimmed.startsWith('/')) return null;
		const parts = trimmed.slice(1).split(/\s+/);
		return {
			command: parts[0]?.toLowerCase() || '',
			arg: parts.slice(1).join(' ') || undefined,
		};
	}

	it('parses /q', () => {
		const result = parseSlashCommand('/q');
		expect(result).toEqual({ command: 'q' });
	});

	it('parses /quit', () => {
		const result = parseSlashCommand('/quit');
		expect(result).toEqual({ command: 'quit' });
	});

	it('parses /add with name', () => {
		const result = parseSlashCommand('/add debug');
		expect(result).toEqual({ command: 'add', arg: 'debug' });
	});

	it('parses /add with multi-word name', () => {
		const result = parseSlashCommand('/add My Debug Agent');
		expect(result).toEqual({ command: 'add', arg: 'My Debug Agent' });
	});

	it('parses /help', () => {
		const result = parseSlashCommand('/help');
		expect(result).toEqual({ command: 'help' });
	});

	it('returns null for non-slash input', () => {
		expect(parseSlashCommand('hello world')).toBeNull();
	});

	it('returns null for empty input', () => {
		expect(parseSlashCommand('')).toBeNull();
	});

	it('handles leading/trailing whitespace', () => {
		const result = parseSlashCommand('  /add debug  ');
		expect(result).toEqual({ command: 'add', arg: 'debug' });
	});

	it('handles bare slash', () => {
		const result = parseSlashCommand('/');
		expect(result).toEqual({ command: '' });
	});
});

describe('compaction guard', () => {
	const THRESHOLD = 200;
	const KEEP = 50;

	function applyCompaction(
		history: HistoryEntry[],
		isStreaming: boolean,
	): HistoryEntry[] {
		if (history.length <= THRESHOLD || isStreaming) return history;
		const removed = history.length - KEEP;
		const kept = history.slice(-KEEP);
		return [
			{
				id: Date.now(),
				role: 'assistant',
				content: `[Auto-compacted: ${removed} older messages removed. Use /compact for LLM-powered summary.]`,
				plainText: true,
			},
			...kept,
		];
	}

	it('does nothing when below threshold', () => {
		const history = Array.from({ length: 100 }, (_, i) => ({
			id: i,
			role: 'user' as const,
			content: `msg ${i}`,
		}));
		const result = applyCompaction(history, false);
		expect(result.length).toBe(100);
	});

	it('does nothing when at threshold', () => {
		const history = Array.from({ length: THRESHOLD }, (_, i) => ({
			id: i,
			role: 'user' as const,
			content: `msg ${i}`,
		}));
		const result = applyCompaction(history, false);
		expect(result.length).toBe(THRESHOLD);
	});

	it('compacts when above threshold and not streaming', () => {
		const history = Array.from({ length: 250 }, (_, i) => ({
			id: i,
			role: 'user' as const,
			content: `msg ${i}`,
		}));
		const result = applyCompaction(history, false);
		expect(result.length).toBe(KEEP + 1);
		expect(result[0].content).toContain('Auto-compacted');
		expect(result[1].id).toBe(250 - KEEP);
	});

	it('does not compact while streaming', () => {
		const history = Array.from({ length: 250 }, (_, i) => ({
			id: i,
			role: 'user' as const,
			content: `msg ${i}`,
		}));
		const result = applyCompaction(history, true);
		expect(result.length).toBe(250);
	});

	it('keeps most recent entries', () => {
		const history = Array.from({ length: 250 }, (_, i) => ({
			id: i,
			role: 'user' as const,
			content: `msg ${i}`,
		}));
		const result = applyCompaction(history, false);
		const lastEntry = result[result.length - 1];
		expect(lastEntry.id).toBe(249);
	});
});

describe('computeInputBarHeight', () => {
	it('returns 3 when streaming', () => {
		expect(computeInputBarHeight('anything', true, false)).toBe(3);
	});

	it('returns 3 when waiting confirmation', () => {
		expect(computeInputBarHeight('anything', false, true)).toBe(3);
	});

	it('returns 4 for single-line input in idle state (3 + 1 margin)', () => {
		expect(computeInputBarHeight('hello', false, false)).toBe(4);
	});

	it('returns 5 for two-line input in idle state (4 + 1 margin)', () => {
		expect(computeInputBarHeight('line1\nline2', false, false)).toBe(5);
	});

	it('returns 6 for three-line input in idle state (5 + 1 margin)', () => {
		expect(computeInputBarHeight('a\nb\nc', false, false)).toBe(6);
	});

	it('returns 7 for four-line input (6 + 1 margin)', () => {
		expect(computeInputBarHeight('a\nb\nc\nd', false, false)).toBe(7);
	});

	it('caps at 7 even for very long input', () => {
		const long = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
		expect(computeInputBarHeight(long, false, false)).toBe(7);
	});

	it('empty input returns 4 in idle state', () => {
		expect(computeInputBarHeight('', false, false)).toBe(4);
	});
});
