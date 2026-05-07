import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ToolDef } from '../sdk/tool.js';

const MCP_TOOL_TIMEOUT_MS = 60_000;
const RATE_LIMIT_RETRY_DELAY_MS = 2_000;
const MAX_RATE_LIMIT_RETRIES = 1;

class McpToolTimeoutError extends Error {
	constructor(toolName: string) {
		super(
			`MCP tool "${toolName}" timed out after ${MCP_TOOL_TIMEOUT_MS / 1000}s`,
		);
		this.name = 'McpToolTimeoutError';
	}
}

class McpRateLimitError extends Error {
	constructor(toolName: string) {
		super(`MCP tool "${toolName}" rate-limited (429)`);
		this.name = 'McpRateLimitError';
	}
}

function isRateLimitError(err: any): boolean {
	const msg = (err?.message || String(err)).toLowerCase();
	const status = err?.status ?? err?.statusCode ?? err?.response?.status;
	return (
		status === 429 ||
		msg.includes('429') ||
		msg.includes('rate limit') ||
		msg.includes('rate_limit') ||
		msg.includes('too many requests')
	);
}

function withTimeout<T>(promise: Promise<T>, toolName: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new McpToolTimeoutError(toolName)),
			MCP_TOOL_TIMEOUT_MS,
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

async function callToolWithRetry(
	client: Client,
	toolName: string,
	args: Record<string, any>,
): Promise<any> {
	let lastError: any;
	for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
		try {
			return await withTimeout(
				client.callTool({ name: toolName, arguments: args }),
				toolName,
			);
		} catch (err: any) {
			if (isRateLimitError(err) && attempt < MAX_RATE_LIMIT_RETRIES) {
				await new Promise((r) => setTimeout(r, RATE_LIMIT_RETRY_DELAY_MS));
				lastError = new McpRateLimitError(toolName);
				continue;
			}
			lastError = err;
			break;
		}
	}
	throw lastError;
}

import { jsonSchemaToZod } from '../schemas.js';

const FILESYSTEM_DESTRUCTIVE_TOOLS = new Set([
	'write_file',
	'edit_file',
	'create_directory',
	'move_file',
]);

export function mcpToolToToolDef(
	serverName: string,
	mcpTool: {
		name: string;
		description?: string;
		inputSchema: any;
		annotations?: {
			readOnlyHint?: boolean;
			destructiveHint?: boolean;
			idempotentHint?: boolean;
		};
	},
	client: Client,
): ToolDef {
	const namespacedName = `mcp__${serverName}__${mcpTool.name}`;
	const isReadOnly = mcpTool.annotations?.readOnlyHint === true;

	return {
		name: namespacedName,
		description: `[${serverName}] ${mcpTool.description || mcpTool.name}`,
		parameters: mcpTool.inputSchema || { type: 'object', properties: {} },
		argSchema: mcpTool.inputSchema
			? jsonSchemaToZod(mcpTool.inputSchema)
			: undefined,
		execute: async (args: Record<string, any>) => {
			const result = await callToolWithRetry(client, mcpTool.name, args);
			const content = extractContent(
				result.content,
				(result as any).structuredContent,
			);
			if (result.isError) {
				throw new Error(
					typeof content === 'string' ? content : JSON.stringify(content),
				);
			}
			return content;
		},
		destructive:
			serverName === 'filesystem' &&
			FILESYSTEM_DESTRUCTIVE_TOOLS.has(mcpTool.name),
		longRunning: !isReadOnly,
		origin: 'mcp',
		mcpServer: serverName,
	};
}

function extractContent(content: any, structuredContent?: any): any {
	if (!Array.isArray(content)) {
		if (structuredContent) return JSON.stringify(structuredContent);
		return content;
	}
	if (content.length === 1 && content[0].type === 'text')
		return content[0].text;
	if (content.length === 0) {
		if (structuredContent) return JSON.stringify(structuredContent);
		return '';
	}
	return content
		.map((c: any) => {
			if (c.type === 'text') return c.text;
			if (c.type === 'resource' && c.resource?.text) return c.resource.text;
			if (c.type === 'image') return `[image: ${c.mimeType}]`;
			if (c.type === 'audio') return `[audio: ${c.mimeType}]`;
			return JSON.stringify(c);
		})
		.join('\n');
}
