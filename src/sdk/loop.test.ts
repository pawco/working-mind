import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderAdapter } from './adapter.js';
import type { StreamEvent } from './provider.js';
import type { ToolDef } from './tool.js';

function mockTool(name: string, opts?: Partial<ToolDef>): ToolDef {
	return {
		name,
		description: `${name} tool`,
		parameters: { type: 'object', properties: {} },
		execute: opts?.execute ?? (async () => `${name} result`),
		...opts,
	};
}

let mockAdapter: ProviderAdapter | null = null;

vi.mock('./provider-resolve.js', () => ({
	resolveModelSpec: () => ({
		provider: { id: 'test', name: 'Test', baseUrl: 'http://test' },
		model: { id: 'test-model', name: 'Test Model' },
		providerRelativeModelId: 'test-model',
		apiKey: 'test-key',
		baseUrl: 'http://test',
		adapter: mockAdapter,
	}),
	resolveApiKeyAsync: async () => '',
	cacheApiKey: () => {},
	hasCachedKey: () => false,
	clearApiKeyCache: () => {},
}));

function makeMockAdapter(turns: StreamEvent[][]): ProviderAdapter {
	let turnIdx = 0;
	return {
		format: 'openai' as const,
		async *stream(): AsyncGenerator<StreamEvent> {
			const events = turns[turnIdx] ?? [];
			for (const event of events) yield event;
			turnIdx++;
		},
		formatTools: () => [],
		buildMessages: (msgs: any[]) => msgs,
		buildToolResult(toolCallId: string, result: string, isError: boolean) {
			return {
				role: 'tool',
				tool_call_id: toolCallId,
				content: isError ? `[Tool Error] ${result}` : result,
			};
		},
		getDefaultMaxTokens: () => undefined,
		getDefaultThinkingBudget: () => undefined,
		getAuthHeaders: () => ({}),
		getApiEndpoint: () => '',
	};
}

function setup(turns: StreamEvent[][]): void {
	mockAdapter = makeMockAdapter(turns);
}

async function run(
	messages: any[],
	turns: StreamEvent[][],
	tools: ToolDef[] = [],
	extra?: Record<string, any>,
): Promise<{ text: string; messages: any[] }> {
	setup(turns);
	const { runAgent } = await import('./loop.js');
	const text = await runAgent(messages, {
		model: 'test-model',
		systemPrompt: 'test',
		tools,
		maxTurns: 5,
		...extra,
	});
	return { text, messages };
}

describe('runAgent - tool dispatch', () => {
	beforeEach(() => {
		mockAdapter = null;
	});

	it('unknown tool returns error tool result', async () => {
		const { text, messages: finalMsgs } = await run(
			[{ role: 'user', content: 'test' }],
			[
				[
					{
						type: 'tool_call',
						id: 'tc-1',
						name: 'nonexistent_tool',
						arguments: '{}',
					},
				],
				[{ type: 'text', content: 'Done' }],
			],
		);

		const toolResult = finalMsgs.find(
			(m: any) => m.role === 'tool' && m.tool_call_id === 'tc-1',
		);
		expect(toolResult).toBeDefined();
		expect(toolResult.content).toContain('Unknown tool');
		expect(text).toBe('Done');
	});

	it('invalid JSON arguments return error tool result', async () => {
		const { text, messages: finalMsgs } = await run(
			[{ role: 'user', content: 'test' }],
			[
				[
					{
						type: 'tool_call',
						id: 'tc-2',
						name: 'my_tool',
						arguments: 'not-valid-json{',
					},
				],
				[{ type: 'text', content: 'Ok' }],
			],
			[mockTool('my_tool')],
		);

		const toolResult = finalMsgs.find(
			(m: any) => m.role === 'tool' && m.tool_call_id === 'tc-2',
		);
		expect(toolResult).toBeDefined();
		expect(toolResult.content).toContain('Invalid JSON arguments');
		expect(text).toBe('Ok');
	});

	it('tool denial returns error tool result', async () => {
		const { text, messages: finalMsgs } = await run(
			[{ role: 'user', content: 'test' }],
			[
				[
					{
						type: 'tool_call',
						id: 'tc-3',
						name: 'denied_tool',
						arguments: '{"x":1}',
					},
				],
				[{ type: 'text', content: 'Noted' }],
			],
			[mockTool('denied_tool')],
			{ onToolCall: async () => false },
		);

		const toolResult = finalMsgs.find(
			(m: any) => m.role === 'tool' && m.tool_call_id === 'tc-3',
		);
		expect(toolResult).toBeDefined();
		expect(toolResult.content).toContain('denied by user');
		expect(text).toBe('Noted');
	});

	it('tool execution error returns error tool result', async () => {
		const { text, messages: finalMsgs } = await run(
			[{ role: 'user', content: 'test' }],
			[
				[
					{
						type: 'tool_call',
						id: 'tc-4',
						name: 'failing_tool',
						arguments: '{}',
					},
				],
				[{ type: 'text', content: 'Handled' }],
			],
			[
				mockTool('failing_tool', {
					execute: async () => {
						throw new Error('something broke');
					},
				}),
			],
		);

		const toolResult = finalMsgs.find(
			(m: any) => m.role === 'tool' && m.tool_call_id === 'tc-4',
		);
		expect(toolResult).toBeDefined();
		expect(toolResult.content).toContain('something broke');
		expect(text).toBe('Handled');
	});

	it('successful tool execution returns result', async () => {
		const { text, messages: finalMsgs } = await run(
			[{ role: 'user', content: 'test' }],
			[
				[
					{
						type: 'tool_call',
						id: 'tc-5',
						name: 'good_tool',
						arguments: '{"input":"hello"}',
					},
				],
				[{ type: 'text', content: 'Done' }],
			],
			[
				mockTool('good_tool', {
					execute: async (args: any) => `Echo: ${args.input}`,
				}),
			],
		);

		const toolResult = finalMsgs.find(
			(m: any) => m.role === 'tool' && m.tool_call_id === 'tc-5',
		);
		expect(toolResult).toBeDefined();
		expect(toolResult.content).toContain('Echo: hello');
		expect(text).toBe('Done');
	});

	it('max turns pushes final assistant message', async () => {
		const { text, messages: finalMsgs } = await run(
			[{ role: 'user', content: 'test' }],
			[
				[
					{
						type: 'tool_call',
						id: 'tc-loop',
						name: 'loop_tool',
						arguments: '{}',
					},
				],
			],
			[mockTool('loop_tool')],
			{ maxTurns: 1 },
		);

		expect(text).toContain('Max turns reached');
		const lastMsg = finalMsgs[finalMsgs.length - 1];
		expect(lastMsg.role).toBe('assistant');
		expect(lastMsg.content).toContain('Max turns reached');
	});

	it('onToolCall receives parsed args object not raw string', async () => {
		let receivedArgs: any = null;
		await run(
			[{ role: 'user', content: 'test' }],
			[
				[
					{
						type: 'tool_call',
						id: 'tc-6',
						name: 'inspect_args',
						arguments: '{"key":"value","num":42}',
					},
				],
				[{ type: 'text', content: 'Checked' }],
			],
			[mockTool('inspect_args')],
			{
				onToolCall: async (_name: string, args: any) => {
					receivedArgs = args;
					return true;
				},
			},
		);

		expect(receivedArgs).toEqual({ key: 'value', num: 42 });
		expect(typeof receivedArgs).toBe('object');
		expect(typeof receivedArgs).not.toBe('string');
	});

	it('cancellation throws RequestCancelledError', async () => {
		const controller = new AbortController();
		controller.abort();
		setup([[{ type: 'text', content: 'hi' }]]);
		const { runAgent, RequestCancelledError } = await import('./loop.js');
		await expect(
			runAgent([{ role: 'user', content: 'test' }], {
				model: 'test-model',
				systemPrompt: 'test',
				tools: [],
				maxTurns: 5,
				signal: controller.signal,
			}),
		).rejects.toThrow(RequestCancelledError);
	});

	it('intermediate tool messages are preserved in messages array', async () => {
		const { messages: finalMsgs } = await run(
			[{ role: 'user', content: 'test' }],
			[
				[{ type: 'tool_call', id: 'tc-7', name: 'my_tool', arguments: '{}' }],
				[{ type: 'text', content: 'Final answer' }],
			],
			[mockTool('my_tool', { execute: async () => 'tool output' })],
		);

		const roles = finalMsgs.map((m: any) => m.role);
		expect(roles).toContain('tool');
		const assistantWithToolCalls = finalMsgs.find(
			(m: any) => m.role === 'assistant' && m.tool_calls,
		);
		expect(assistantWithToolCalls).toBeDefined();
	});
});

describe('runAgent - simple text response', () => {
	beforeEach(() => {
		mockAdapter = null;
	});

	it('returns text content and pushes assistant message', async () => {
		const { text, messages: finalMsgs } = await run(
			[{ role: 'user', content: 'hi' }],
			[[{ type: 'text', content: 'Hello world' }]],
		);

		expect(text).toBe('Hello world');
		const last = finalMsgs[finalMsgs.length - 1];
		expect(last.role).toBe('assistant');
		expect(last.content).toBe('Hello world');
	});

	it('emits usage events', async () => {
		let usagePrompt = 0;
		let usageCompletion = 0;
		await run(
			[{ role: 'user', content: 'hi' }],
			[
				[
					{ type: 'text', content: 'Hi' },
					{ type: 'usage', promptTokens: 10, completionTokens: 5 },
				],
			],
			[],
			{
				onUsage: (p: number, c: number) => {
					usagePrompt = p;
					usageCompletion = c;
				},
			},
		);

		expect(usagePrompt).toBe(10);
		expect(usageCompletion).toBe(5);
	});

	it('emits thinking events', async () => {
		let thinking = '';
		await run(
			[{ role: 'user', content: 'think' }],
			[
				[
					{ type: 'thinking', content: 'hmm' },
					{ type: 'text', content: 'Answer' },
				],
			],
			[],
			{
				onThinking: (t: string) => {
					thinking += t;
				},
			},
		);

		expect(thinking).toBe('hmm');
	});

	it('onToolResult receives isError for denied tools', async () => {
		const results: any[] = [];
		await run(
			[{ role: 'user', content: 'test' }],
			[
				[{ type: 'tool_call', id: 'tc-d', name: 'den_tool', arguments: '{}' }],
				[{ type: 'text', content: 'Ok' }],
			],
			[mockTool('den_tool')],
			{
				onToolCall: async () => false,
				onToolResult: (_name: string, result: any) => {
					results.push(result);
				},
			},
		);

		const deniedResult = results.find((r) => r.error?.includes('denied'));
		expect(deniedResult).toBeDefined();
		expect(deniedResult.isError).toBe(true);
	});

	it('onToolResult receives isError for unknown tools', async () => {
		const results: any[] = [];
		await run(
			[{ role: 'user', content: 'test' }],
			[
				[
					{
						type: 'tool_call',
						id: 'tc-u',
						name: 'no_such_tool',
						arguments: '{}',
					},
				],
				[{ type: 'text', content: 'Ok' }],
			],
			[],
			{
				onToolResult: (_name: string, result: any) => {
					results.push(result);
				},
			},
		);

		const unknownResult = results.find((r) => r.error?.includes('Unknown tool'));
		expect(unknownResult).toBeDefined();
		expect(unknownResult.isError).toBe(true);
	});

	it('passes providerRelativeModelId to adapter stream opts', async () => {
		const capturedOpts: any[] = [];
		let turnIdx = 0;
		mockAdapter = {
			format: 'openai' as const,
			async *stream(_msgs: any[], _tools: any, opts: any): AsyncGenerator<StreamEvent> {
				capturedOpts.push(opts);
				if (turnIdx === 0) {
					turnIdx++;
					yield { type: 'text', content: 'Done' };
				}
			},
			formatTools: () => [],
			buildMessages: (msgs: any[]) => msgs,
			buildToolResult(toolCallId: string, result: string, isError: boolean) {
				return {
					role: 'tool',
					tool_call_id: toolCallId,
					content: isError ? `[Tool Error] ${result}` : result,
				};
			},
			getDefaultMaxTokens: () => undefined,
			getDefaultThinkingBudget: () => undefined,
			getAuthHeaders: () => ({}),
			getApiEndpoint: () => '',
		};

		const { runAgent } = await import('./loop.js');
		await runAgent([{ role: 'user', content: 'test' }], {
			model: 'test/test-model',
			systemPrompt: 'test',
			tools: [],
			maxTurns: 5,
		});

		expect(capturedOpts.length).toBeGreaterThan(0);
		expect(capturedOpts[0].model).toBe('test-model');
		expect(capturedOpts[0].model).not.toBe('test/test-model');
	});

	it('onToolCall timeout denies tool call', async () => {
		const { text, messages: finalMsgs } = await run(
			[{ role: 'user', content: 'test' }],
			[
				[
					{
						type: 'tool_call',
						id: 'tc-timeout',
						name: 'hung_tool',
						arguments: '{"x":1}',
					},
				],
				[{ type: 'text', content: 'Continued' }],
			],
			[mockTool('hung_tool')],
			{
				onToolCall: async () => new Promise<boolean>(() => {}),
			},
		);

		const toolResult = finalMsgs.find(
			(m: any) => m.role === 'tool' && m.tool_call_id === 'tc-timeout',
		);
		expect(toolResult).toBeDefined();
		expect(toolResult.content).toContain('denied by user');
		expect(text).toBe('Continued');
	}, 60_000);

	it('removes orphaned tool results via sanitizeMessages', async () => {
		const { messages: finalMsgs } = await run(
			[
				{ role: 'user', content: 'test' },
				{ role: 'tool', tool_call_id: 'orphan-tc', content: 'orphan result' },
			],
			[[{ type: 'text', content: 'Done' }]],
		);

		const orphanResult = finalMsgs.find(
			(m: any) => m.role === 'tool' && m.tool_call_id === 'orphan-tc',
		);
		expect(orphanResult).toBeUndefined();
	});

	it('detects text-based tool call from reasoning model output', async () => {
		const { text, messages: finalMsgs } = await run(
			[{ role: 'user', content: 'search for X' }],
			[
				[
					{
						type: 'text',
						content:
							'I will search for that.\n```json\n{"name": "search_nodes", "arguments": {"query": "X"}}\n```',
					},
				],
				[{ type: 'text', content: 'Found results' }],
			],
			[mockTool('search_nodes', { execute: async () => 'search results' })],
		);

		const toolResult = finalMsgs.find(
			(m: any) => m.role === 'tool' && m.tool_call_id?.startsWith('tc_text_'),
		);
		expect(toolResult).toBeDefined();
		expect(text).toBe('Found results');
	});
});
