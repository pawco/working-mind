import { describe, expect, it } from 'vitest';
import {
	compactMessages,
	estimateMessageTokens,
	shouldCompact,
} from './context.js';

describe('estimateMessageTokens', () => {
	it('estimates tokens from message content', () => {
		const msgs = [{ role: 'user', content: 'Hello world' }];
		expect(estimateMessageTokens(msgs)).toBe(3);
	});

	it('counts tool_calls in estimation', () => {
		const msgs = [
			{
				role: 'assistant',
				content: '',
				tool_calls: [
					{ name: 'mcp__memory__search_nodes', arguments: '{"query":"test"}' },
				],
			},
		];
		const tokens = estimateMessageTokens(msgs);
		expect(tokens).toBeGreaterThan(0);
	});

	it('handles empty messages array', () => {
		expect(estimateMessageTokens([])).toBe(0);
	});
});

describe('shouldCompact', () => {
	it('returns false for small message arrays', () => {
		const msgs = [{ role: 'user', content: 'Hello' }];
		expect(shouldCompact(msgs)).toBe(false);
	});

	it('returns true when total chars exceed threshold', () => {
		const msgs = [{ role: 'user', content: 'A'.repeat(101_000) }];
		expect(shouldCompact(msgs)).toBe(true);
	});
});

describe('compactMessages', () => {
	it('does not compact small message arrays', () => {
		const msgs = [
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi there' },
		];
		const result = compactMessages(msgs);
		expect(result).toEqual(msgs);
	});

	it('compacts when over threshold', () => {
		const msgs = [
			{ role: 'user', content: 'A'.repeat(25_000) },
			{ role: 'assistant', content: 'B'.repeat(25_000) },
			{ role: 'user', content: 'C'.repeat(25_000) },
			{ role: 'assistant', content: 'D'.repeat(25_000) },
			{ role: 'user', content: 'E'.repeat(25_000) },
			{ role: 'assistant', content: 'F'.repeat(25_000) },
			{ role: 'user', content: 'Recent question' },
			{ role: 'assistant', content: 'Recent answer' },
		];
		const result = compactMessages(msgs);
		expect(result.length).toBeLessThan(msgs.length);
		expect(result[0].role).toBe('user');
		expect(result[0].content).toContain('compacted');
		expect(result[1].role).toBe('assistant');
		expect(result.some((m: any) => m.content === 'Recent question')).toBe(true);
	});

	it('preserves tool_call / tool_result pairs', () => {
		const msgs = [
			{ role: 'user', content: 'A'.repeat(40_000) },
			{
				role: 'assistant',
				content: '',
				tool_calls: [{ id: 'tc1', name: 'search', arguments: '{}' }],
			},
			{ role: 'tool', tool_call_id: 'tc1', content: 'result' },
			{ role: 'assistant', content: 'answer' },
			{ role: 'user', content: 'Recent' },
			{ role: 'assistant', content: 'Recent answer' },
		];
		const result = compactMessages(msgs);
		const toolCallIds = new Set(
			result
				.filter((m: any) => m.tool_calls)
				.flatMap((m: any) => m.tool_calls.map((tc: any) => tc.id)),
		);
		const toolResultIds = new Set(
			result.filter((m: any) => m.tool_call_id).map((m: any) => m.tool_call_id),
		);
		for (const id of toolCallIds) {
			expect(toolResultIds.has(id)).toBe(true);
		}
	});

	it('cuts at user message boundary', () => {
		const msgs = [
			{ role: 'user', content: 'A'.repeat(50_000) },
			{
				role: 'assistant',
				content: '',
				tool_calls: [{ id: 'tc1', name: 'search', arguments: '{}' }],
			},
			{ role: 'tool', tool_call_id: 'tc1', content: 'R'.repeat(20_000) },
			{ role: 'user', content: 'B'.repeat(50_000) },
			{ role: 'assistant', content: 'answer' },
		];
		const result = compactMessages(msgs);
		for (const msg of result) {
			if (msg.role === 'tool') {
				expect(msg.tool_call_id).toBeDefined();
			}
		}
	});

	it('returns original if cutIndex is 0', () => {
		const msgs = [{ role: 'user', content: 'A'.repeat(120_000) }];
		const result = compactMessages(msgs);
		expect(result).toEqual(msgs);
	});

	it('returns original if all messages are recent', () => {
		const msgs = [
			{ role: 'user', content: 'Short' },
			{ role: 'assistant', content: 'Reply' },
		];
		const result = compactMessages(msgs);
		expect(result).toEqual(msgs);
	});

	it('preserves assistant+tool_calls when tool result is in keep zone', () => {
		const msgs = [
			{ role: 'user', content: 'A'.repeat(40_000) },
			{
				role: 'assistant',
				content: '',
				tool_calls: [{ id: 'tc-cross', name: 'search', arguments: '{}' }],
			},
			{ role: 'user', content: 'B'.repeat(40_000) },
			{ role: 'tool', tool_call_id: 'tc-cross', content: 'R'.repeat(20_000) },
			{ role: 'user', content: 'Recent' },
			{ role: 'assistant', content: 'Answer' },
		];
		const result = compactMessages(msgs);
		const toolCallIds = new Set(
			result
				.filter((m: any) => m.tool_calls)
				.flatMap((m: any) => m.tool_calls.map((tc: any) => tc.id)),
		);
		const toolResultIds = new Set(
			result.filter((m: any) => m.tool_call_id).map((m: any) => m.tool_call_id),
		);
		expect(toolCallIds.has('tc-cross')).toBe(true);
		expect(toolResultIds.has('tc-cross')).toBe(true);
	});

	it('preserves tool result when assistant with tool_calls is in keep zone', () => {
		const msgs = [
			{ role: 'user', content: 'A'.repeat(60_000) },
			{
				role: 'assistant',
				content: '',
				tool_calls: [{ id: 'tc-keep', name: 'search', arguments: '{}' }],
			},
			{ role: 'tool', tool_call_id: 'tc-keep', content: 'result data' },
			{ role: 'assistant', content: 'C'.repeat(30_000) },
			{ role: 'user', content: 'Recent Q' },
			{ role: 'assistant', content: 'Recent A' },
		];
		const result = compactMessages(msgs);
		const toolCallIds = new Set(
			result
				.filter((m: any) => m.tool_calls)
				.flatMap((m: any) => m.tool_calls.map((tc: any) => tc.id)),
		);
		const toolResultIds = new Set(
			result.filter((m: any) => m.tool_call_id).map((m: any) => m.tool_call_id),
		);
		expect(toolCallIds.has('tc-keep')).toBe(true);
		expect(toolResultIds.has('tc-keep')).toBe(true);
	});
});
