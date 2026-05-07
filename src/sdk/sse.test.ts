import { describe, expect, it } from 'vitest';
import { parseSSE } from './sse.js';

describe('parseSSE', () => {
	async function* _fromLines(lines: string[]) {
		const encoder = new TextEncoder();
		const text = lines.join('\n\n');
		yield encoder.encode(text);
	}

	it('parses data lines into JSON objects', async () => {
		const stream = new ReadableStream({
			async start(controller) {
				const encoder = new TextEncoder();
				controller.enqueue(encoder.encode('data: {"type":"text","content":"hello"}\n\n'));
				controller.enqueue(encoder.encode('data: {"type":"text","content":"world"}\n\n'));
				controller.close();
			},
		});

		const events: any[] = [];
		for await (const event of parseSSE(stream)) {
			events.push(event);
		}
		expect(events).toEqual([
			{ type: 'text', content: 'hello' },
			{ type: 'text', content: 'world' },
		]);
	});

	it('stops on [DONE]', async () => {
		const stream = new ReadableStream({
			async start(controller) {
				const encoder = new TextEncoder();
				controller.enqueue(
					encoder.encode('data: {"type":"text","content":"hi"}\n\ndata: [DONE]\n\n'),
				);
				controller.close();
			},
		});

		const events: any[] = [];
		for await (const event of parseSSE(stream)) {
			events.push(event);
		}
		expect(events).toEqual([{ type: 'text', content: 'hi' }]);
	});

	it('skips non-JSON data lines', async () => {
		const stream = new ReadableStream({
			async start(controller) {
				const encoder = new TextEncoder();
				controller.enqueue(encoder.encode('data: not-json\n\ndata: {"ok":true}\n\n'));
				controller.close();
			},
		});

		const events: any[] = [];
		for await (const event of parseSSE(stream)) {
			events.push(event);
		}
		expect(events).toEqual([{ ok: true }]);
	});

	it('handles chunked input across boundaries', async () => {
		const stream = new ReadableStream({
			async start(controller) {
				const encoder = new TextEncoder();
				controller.enqueue(encoder.encode('data: {"a":1}\n\nda'));
				controller.enqueue(encoder.encode('ta: {"b":2}\n\n'));
				controller.close();
			},
		});

		const events: any[] = [];
		for await (const event of parseSSE(stream)) {
			events.push(event);
		}
		expect(events).toEqual([{ a: 1 }, { b: 2 }]);
	});
});
