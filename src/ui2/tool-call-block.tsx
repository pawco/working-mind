import { createElement as h } from 'react';
import type { HistoryEntry } from '../sdk/command.js';
import { sanitizeUntrusted } from '../ui/ansi-sanitize.js';
import { formatElapsed } from '../ui/utils.js';
import { ACCENT_TOOL_CALL, BG_TOOL_CALL, MessageCard } from './message-card.js';

export interface ToolCallBlockProps {
	entry: HistoryEntry;
	expanded?: boolean;
	collapsed?: boolean;
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	return formatElapsed(ms);
}

function truncateValue(val: string, maxLen: number): string {
	if (val.length <= maxLen) return val;
	return `${val.slice(0, maxLen - 3)}...`;
}

function formatValue(val: unknown, maxLen: number): string {
	if (val === null || val === undefined) return '';
	if (typeof val === 'string') return truncateValue(val, maxLen);
	if (typeof val === 'number' || typeof val === 'boolean') return String(val);
	const s = JSON.stringify(val);
	return truncateValue(s, maxLen);
}

interface ParsedArg {
	key: string;
	value: string;
	isPath: boolean;
}

function parseJsonArgs(text: string): ParsedArg[] | null {
	try {
		const parsed = JSON.parse(text);
		if (typeof parsed !== 'object' || parsed === null) return null;
		const pathKeys = new Set([
			'path',
			'file',
			'filename',
			'filepath',
			'filePath',
			'directory',
			'dir',
			'cwd',
			'root',
		]);
		return Object.entries(parsed).map(([k, v]) => ({
			key: k,
			value: formatValue(v, 120),
			isPath: pathKeys.has(k),
		}));
	} catch {
		return null;
	}
}

function extractPrimaryPath(name: string, text: string): string | null {
	const parsed = parseJsonArgs(text);
	if (parsed) {
		for (const arg of parsed) {
			if (arg.isPath) return arg.value;
		}
	}
	const patterns = [
		/(?:path|file|filename|filepath|filePath)\s*[:=]\s*["']([^"']+)["']/i,
		/(?:command|cmd)\s*[:=]\s*["'](?:cat|head|tail|less|more|diff)\s+([^\s"']+)/i,
	];
	for (const pat of patterns) {
		const m = text.match(pat);
		if (m) return m[1];
	}
	if (
		name.toLowerCase().includes('read') ||
		name.toLowerCase().includes('write') ||
		name.toLowerCase().includes('edit')
	) {
		return text.trim().slice(0, 60) || null;
	}
	return null;
}

function buildCollapsedSummary(args: ParsedArg[], maxLen: number): string {
	const parts: string[] = [];
	let len = 0;
	for (const arg of args) {
		const part = arg.isPath ? arg.value : `${arg.key}: ${truncateValue(arg.value, 40)}`;
		if (len + part.length + (parts.length > 0 ? 2 : 0) > maxLen) {
			const remaining = args.length - parts.length;
			if (remaining > 0) parts.push(`+${remaining}`);
			break;
		}
		parts.push(part);
		len += part.length + (parts.length > 1 ? 2 : 0);
	}
	return parts.join(' | ');
}

function buildExpandedLines(args: ParsedArg[]): string[] {
	return args.map((arg) => {
		if (arg.isPath) return arg.value;
		return `${arg.key}: ${arg.value}`;
	});
}

export function ToolCallBlock({ entry, expanded, collapsed }: ToolCallBlockProps) {
	if (collapsed) {
		return h(MessageCard, {
			accentColor: ACCENT_TOOL_CALL,
			backgroundColor: BG_TOOL_CALL,
			collapsed: true,
			header: h(
				'box',
				null,
				h('text', { content: '>', fg: ACCENT_TOOL_CALL }),
				h('text', { content: ` ${entry.name}`, fg: '#7982a9' }),
			),
		});
	}

	const safeContent = sanitizeUntrusted(entry.content);
	const filePath = extractPrimaryPath(entry.name || '', safeContent);
	const label = filePath || entry.name || 'tool';
	const duration =
		entry.startTime && entry.endTime ? formatDuration(entry.endTime - entry.startTime) : null;
	const parsed = parseJsonArgs(safeContent);

	let argsContent: ReturnType<typeof h> | null = null;

	if (parsed) {
		if (expanded) {
			const lines = buildExpandedLines(parsed);
			argsContent = h(
				'box',
				{ paddingLeft: 1, flexDirection: 'column' },
				...lines.map((line, i) => {
					const arg = parsed[i];
					if (arg.isPath) {
						return h('text', {
							key: i,
							content: line,
							fg: '#c9d1d9',
						});
					}
					const colonIdx = line.indexOf(': ');
					if (colonIdx >= 0) {
						return h('text', {
							key: i,
							content: line,
							fg: '#7982a9',
						});
					}
					return h('text', {
						key: i,
						content: line,
						fg: '#7982a9',
					});
				}),
			);
		} else {
			const summary = buildCollapsedSummary(parsed, 200);
			argsContent = h(
				'box',
				{ paddingLeft: 1 },
				h('text', { content: summary, fg: '#555e70' }),
			);
		}
	} else if (safeContent && safeContent !== 'Confirmation needed') {
		if (expanded) {
			argsContent = h(
				'box',
				{ paddingLeft: 1 },
				h('text', { content: safeContent, fg: '#7982a9' }),
			);
		} else {
			const truncated =
				safeContent.length > 200 ? `${safeContent.slice(0, 197)}...` : safeContent;
			argsContent = h(
				'box',
				{ paddingLeft: 1 },
				h('text', { content: truncated, fg: '#555e70' }),
			);
		}
	}

	return h(
		MessageCard,
		{
			accentColor: ACCENT_TOOL_CALL,
			backgroundColor: BG_TOOL_CALL,
			header: h(
				'box',
				null,
				h('text', { content: '>', fg: ACCENT_TOOL_CALL }),
				h('text', { content: ` ${label}`, bold: true }),
				duration && h('text', { content: ` ${duration}`, fg: '#7982a9' }),
				entry.streaming && h('text', { content: ' \u258d', fg: ACCENT_TOOL_CALL }),
			),
		},
		argsContent,
	);
}
