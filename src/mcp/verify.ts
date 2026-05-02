import type { McpServerConfig } from '../config.js';
import { createTransport } from './transport.js';

export interface McpVerifyResult {
	ok: boolean;
	tools: { name: string; description: string; inputSchema: any }[];
	error?: string;
}

export async function verifyConnection(
	config: McpServerConfig,
	name = 'verify',
): Promise<McpVerifyResult> {
	const timeout = config.type === 'local' ? 30000 : 10000;

	try {
		const result = await withTimeout(createTransport(name, config), timeout);
		const toolsResult = await withTimeout(result.client.listTools(), 10000);
		const tools = (toolsResult.tools || []).map((t) => ({
			name: t.name,
			description: t.description || '',
			inputSchema: t.inputSchema,
		}));
		await result.close();
		return { ok: true, tools };
	} catch (err: any) {
		return { ok: false, tools: [], error: err.message || String(err) };
	}
}

export async function verifyUrl(
	url: string,
	headers?: Record<string, string>,
): Promise<McpVerifyResult> {
	const config: McpServerConfig = { type: 'remote', url, headers };
	return verifyConnection(config, 'verify-test');
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`Timeout after ${ms}ms`)),
			ms,
		);
		promise.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(e) => {
				clearTimeout(timer);
				reject(e);
			},
		);
	});
}
