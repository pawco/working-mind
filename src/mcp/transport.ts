import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerConfig } from '../config.js';
import { VERSION } from '../version.js';

export interface McpTransportResult {
	client: Client;
	close: () => Promise<void>;
}

export async function createTransport(
	name: string,
	config: McpServerConfig,
): Promise<McpTransportResult> {
	if (config.type === 'local' || config.command) {
		return createStdioTransport(name, config);
	}
	return createRemoteTransport(name, config);
}

async function createStdioTransport(
	name: string,
	config: McpServerConfig,
): Promise<McpTransportResult> {
	const command = config.command?.[0] || 'npx';
	const args = config.command?.slice(1) || [];
	const env: Record<string, string> = {
		...(process.env as Record<string, string>),
		...expandEnvVars(config.env || {}),
	};

	const stderrChunks: string[] = [];

	const transport = new StdioClientTransport({
		command,
		args,
		env,
		stderr: 'pipe',
	});

	const stderr = (transport as any).stderr;
	if (stderr && typeof stderr.on === 'function') {
		stderr.on('data', (chunk: Buffer) => {
			stderrChunks.push(chunk.toString());
		});
	}

	const client = new Client({ name: `wmind-${name}`, version: VERSION });

	try {
		await client.connect(transport);
	} catch (err: any) {
		const stderrOutput = stderrChunks.join('').trim();
		if (stderrOutput) {
			const detail = stderrOutput.split('\n').slice(-5).join('\n');
			throw new Error(`${err.message}\n\nServer stderr:\n${detail}`);
		}
		throw err;
	}

	if (stderrChunks.length > 0) {
		const output = stderrChunks.join('').trim();
		if (output) {
			const lines = output.split('\n');
			const warnings = lines.filter((l) => /warn|deprecated/i.test(l));
			if (warnings.length > 0 && warnings.length <= 3) {
				// non-fatal warnings, ignore
			}
		}
	}

	return {
		client,
		close: async () => {
			try {
				await client.close();
			} catch {
				// ignore close errors
			}
		},
	};
}

async function createRemoteTransport(
	name: string,
	config: McpServerConfig,
): Promise<McpTransportResult> {
	const url = expandEnvInString(config.url || '');
	const headers = expandEnvVars(config.headers || {});
	const transport = new SSEClientTransport(new URL(url), {
		requestInit: { headers },
	});
	const client = new Client({ name: `wmind-${name}`, version: VERSION });
	await client.connect(transport);
	return {
		client,
		close: async () => {
			try {
				await client.close();
			} catch {
				// ignore close errors
			}
		},
	};
}

function expandEnvVars(obj: Record<string, string>): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(obj)) {
		result[key] = expandEnvInString(value);
	}
	return result;
}

function expandEnvInString(s: string): string {
	return s.replace(/\$\{([^}]+)\}/g, (_, expr) => {
		const [varName, defaultVal] = expr.split(':-');
		return process.env[varName] || defaultVal || '';
	});
}
