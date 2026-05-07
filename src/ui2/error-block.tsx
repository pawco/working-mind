import { createElement as h } from 'react';
import type { HistoryEntry } from '../sdk/command.js';
import { ERROR_CATEGORY_LABELS, type ProviderErrorCategory } from '../sdk/provider-error.js';
import { sanitizeUntrusted } from '../ui/ansi-sanitize.js';
import { ACCENT_TOOL_ERR, BG_TOOL_ERR, MessageCard } from './message-card.js';

const CATEGORY_ICONS: Record<ProviderErrorCategory, string> = {
	rate_limit: 'rate-limit',
	auth: 'auth',
	context_length: 'context',
	overloaded: 'overload',
	server_error: 'server',
	connection: 'network',
	not_found: 'not-found',
	no_api_key: 'no-key',
	unknown: 'error',
};

export interface ErrorBlockProps {
	entry: HistoryEntry;
	expanded: boolean;
	collapsed?: boolean;
}

export function ErrorBlock({ entry, expanded, collapsed }: ErrorBlockProps) {
	const category = entry.errorCategory || 'unknown';
	const icon = CATEGORY_ICONS[category] || 'error';
	const label = ERROR_CATEGORY_LABELS[category] || 'error';

	if (collapsed) {
		return h(MessageCard, {
			accentColor: ACCENT_TOOL_ERR,
			backgroundColor: BG_TOOL_ERR,
			collapsed: true,
			header: h(
				'box',
				null,
				h('text', { content: `${icon} `, fg: ACCENT_TOOL_ERR }),
				h('text', { content: label, fg: 'red' }),
			),
		});
	}

	const content = sanitizeUntrusted(entry.content || 'Unknown error');
	const lines = content.split('\n');
	const previewLines = expanded ? lines : lines.slice(0, 3);
	const remaining = lines.length - previewLines.length;

	const suggestion = entry.errorSuggestion;

	return h(
		MessageCard,
		{
			accentColor: ACCENT_TOOL_ERR,
			backgroundColor: BG_TOOL_ERR,
			header: h(
				'box',
				null,
				h('text', { content: `${icon} `, fg: ACCENT_TOOL_ERR }),
				h('text', { content: label, fg: 'red' }),
			),
		},
		h(
			'box',
			{ paddingLeft: 1, flexDirection: 'column' },
			...previewLines.map((line, i) => h('text', { key: i, content: line, fg: 'red' })),
			remaining > 0 && h('text', { content: `+${remaining} lines [Ctrl+E]`, fg: '#555e70' }),
			suggestion && h('text', { content: `>> ${suggestion}`, fg: 'yellow' }),
		),
	);
}
