import { createElement as h } from 'react';
import type { HistoryEntry } from '../sdk/command.js';
import { sanitizeUntrusted } from '../ui/ansi-sanitize.js';
import { isDiffContent, renderDiff } from '../ui/markdown-renderer.js';
import { formatElapsed } from '../ui/utils.js';
import {
	ACCENT_TOOL_ERR,
	ACCENT_TOOL_OK,
	BG_TOOL_ERR,
	BG_TOOL_OK,
	MessageCard,
} from './message-card.js';

export interface ToolResultBlockProps {
	entry: HistoryEntry;
	expanded?: boolean;
	collapsed?: boolean;
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	return formatElapsed(ms);
}

const SUCCESS = 0;
const MAX_PREVIEW_LINES = 8;

type ContentType = 'json' | 'bash' | 'diff' | 'file-list' | 'search' | 'plain';

function classifyContent(text: string): ContentType {
	const trimmed = text.trim();
	if (!trimmed) return 'plain';

	if (isDiffContent(trimmed)) return 'diff';

	try {
		const parsed = JSON.parse(trimmed);
		if (typeof parsed === 'object' && parsed !== null) return 'json';
	} catch {}

	const lines = trimmed.split('\n');
	let filePathCount = 0;
	for (const line of lines) {
		const stripped = line.trim();
		if (
			stripped.match(/^\.?\//) ||
			stripped.match(/^[A-Za-z]:\\/) ||
			stripped.match(
				/\.(ts|js|tsx|jsx|py|rs|go|java|c|h|md|txt|json|yaml|yml|toml|css|html|sh|rb|php|sql)\s*$/,
			)
		) {
			filePathCount++;
		}
	}
	if (filePathCount >= 3 && filePathCount / lines.length > 0.5) return 'file-list';

	let matchCount = 0;
	for (const line of lines) {
		if (line.match(/:\d+[:;]/)) matchCount++;
	}
	if (matchCount >= 3 && matchCount / lines.length > 0.3) return 'search';

	if (lines.length > 1) {
		const nonEmpty = lines.filter((l) => l.trim().length > 0);
		if (nonEmpty.length >= 2) return 'bash';
	}

	return 'plain';
}

function excerptJson(text: string, maxPairs: number): string {
	try {
		const parsed = JSON.parse(text.trim());
		if (typeof parsed !== 'object' || parsed === null) return text.slice(0, 200);
		if (Array.isArray(parsed)) {
			if (parsed.length <= maxPairs) {
				return parsed
					.map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
					.join('\n');
			}
			const shown = parsed.slice(0, maxPairs);
			const lines = shown.map((item) =>
				typeof item === 'string' ? item : JSON.stringify(item),
			);
			lines.push(`...+${parsed.length - maxPairs} more`);
			return lines.join('\n');
		}
		const entries = Object.entries(parsed);
		const shown = entries.slice(0, maxPairs);
		const rest = entries.length - shown.length;
		const lines = shown.map(([k, v]) => {
			const val =
				typeof v === 'string'
					? v.length > 80
						? `${v.slice(0, 77)}...`
						: v
					: JSON.stringify(v);
			return `${k}: ${val}`;
		});
		if (rest > 0) lines.push(`+${rest} more keys`);
		return lines.join('\n');
	} catch {
		return text.slice(0, 200);
	}
}

function excerptBash(text: string, maxLines: number): string {
	const lines = text.split('\n').filter((l) => l.trim().length > 0);
	if (lines.length <= maxLines) return text;
	const shown = lines.slice(-maxLines);
	const remaining = lines.length - maxLines;
	return `[${remaining} lines above]\n${shown.join('\n')}`;
}

function excerptFileList(text: string, maxShow: number): string {
	const lines = text.split('\n').filter((l) => l.trim().length > 0);
	const total = lines.length;
	if (total <= maxShow) return text;
	const first = lines.slice(0, 3);
	const last = lines.slice(-2);
	return `${first.join('\n')}\n  ... ${total - 5} more files ...\n${last.join('\n')}`;
}

function excerptSearch(text: string, maxShow: number): string {
	const lines = text.split('\n').filter((l) => l.trim().length > 0);
	const total = lines.length;
	if (total <= maxShow) return text;
	const shown = lines.slice(0, maxShow);
	return `${shown.join('\n')}\n+${total - maxShow} more matches`;
}

function smartExcerpt(
	text: string,
	expanded: boolean,
): { display: string; contentType: ContentType } {
	const contentType = classifyContent(text);

	if (expanded) {
		if (contentType === 'diff') return { display: renderDiff(text), contentType };
		if (contentType === 'json') {
			try {
				return {
					display: JSON.stringify(JSON.parse(text.trim()), null, 2),
					contentType,
				};
			} catch {
				return { display: text, contentType };
			}
		}
		return { display: text, contentType };
	}

	switch (contentType) {
		case 'diff':
			return { display: renderDiff(text), contentType };
		case 'json':
			return { display: excerptJson(text, 5), contentType };
		case 'bash':
			return { display: excerptBash(text, 5), contentType };
		case 'file-list':
			return { display: excerptFileList(text, 5), contentType };
		case 'search':
			return { display: excerptSearch(text, 3), contentType };
		default: {
			const lines = text.split('\n');
			if (lines.length <= MAX_PREVIEW_LINES) return { display: text, contentType };
			return {
				display: lines.slice(0, MAX_PREVIEW_LINES).join('\n'),
				contentType,
			};
		}
	}
}

function extractFilePath(name: string, content: string): string | null {
	const patterns = [/(?:path|file|filename|filepath|filePath)\s*[:=]\s*["']([^"']+)["']/i];
	for (const pat of patterns) {
		const m = content.match(pat);
		if (m) return m[1];
	}
	if (
		name.toLowerCase().includes('read') ||
		name.toLowerCase().includes('write') ||
		name.toLowerCase().includes('edit')
	) {
		try {
			const parsed = JSON.parse(content);
			if (parsed.path || parsed.file_path || parsed.filename) {
				return parsed.path || parsed.file_path || parsed.filename;
			}
		} catch {}
	}
	return null;
}

export function ToolResultBlock({ entry, expanded, collapsed }: ToolResultBlockProps) {
	const isOk = entry.exitCode === SUCCESS;
	const accentColor = isOk ? ACCENT_TOOL_OK : ACCENT_TOOL_ERR;
	const bgColor = isOk ? BG_TOOL_OK : BG_TOOL_ERR;
	const icon = isOk ? '<' : '!';

	if (collapsed) {
		return h(MessageCard, {
			accentColor,
			backgroundColor: bgColor,
			collapsed: true,
			header: h(
				'box',
				null,
				h('text', { content: icon, fg: accentColor }),
				h('text', { content: ` ${entry.name}`, fg: '#7982a9' }),
			),
		});
	}

	const duration =
		entry.startTime && entry.endTime ? formatDuration(entry.endTime - entry.startTime) : null;

	const rawContent = sanitizeUntrusted(entry.content);
	const { display, contentType } = smartExcerpt(rawContent, !!expanded);
	const filePath = extractFilePath(entry.name || '', rawContent);

	const headerLabel = filePath || entry.name || 'result';
	const typeTag: Record<ContentType, string> = {
		json: 'json',
		bash: 'out',
		diff: 'diff',
		'file-list': 'files',
		search: 'hits',
		plain: '',
	};
	const tag = typeTag[contentType];

	const lines = display.split('\n');
	const totalLines = rawContent.split('\n').length;
	const isLong = !expanded && totalLines > MAX_PREVIEW_LINES;
	const remaining = totalLines - lines.length;

	return h(
		MessageCard,
		{
			accentColor,
			backgroundColor: bgColor,
			header: h(
				'box',
				null,
				h('text', { content: icon, fg: accentColor }),
				h('text', { content: ` ${headerLabel}`, bold: true }),
				tag && h('text', { content: ` [${tag}]`, fg: '#555e70' }),
				duration && h('text', { content: ` ${duration}`, fg: '#7982a9' }),
			),
		},
		h(
			'box',
			{ paddingLeft: 1, flexDirection: 'column' },
			...lines.map((line, i) => {
				const kvMatch = line.match(/^([^:]+):\s(.+)$/);
				if (kvMatch && contentType === 'json') {
					return h(
						'box',
						{ key: `${i}`, flexDirection: 'row' },
						h('text', { content: kvMatch[1], fg: '#555e70' }),
						h('text', { content: ': ', fg: '#555e70' }),
						h('text', { content: kvMatch[2], fg: '#7982a9' }),
					);
				}
				const moreMatch = line.match(/^\+\d+ more/);
				if (moreMatch) {
					return h('text', {
						key: `${i}`,
						content: line,
						fg: '#555e70',
					});
				}
				return h('text', {
					key: `${i}-${line.slice(0, 20)}`,
					content: line,
					fg: '#7982a9',
				});
			}),
		),
		isLong &&
			remaining > 0 &&
			h('text', { content: ` +${remaining} lines [Ctrl+E]`, fg: '#555e70' }),
	);
}
