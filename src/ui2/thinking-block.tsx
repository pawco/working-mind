import { createElement as h } from 'react';
import type { HistoryEntry } from '../sdk/command.js';
import { sanitizeUntrusted } from '../ui/ansi-sanitize.js';
import { formatElapsed, THINKING_COLLAPSE_THRESHOLD, THINKING_PREVIEW_LINES } from '../ui/utils.js';
import { ACCENT_THINKING, BG_THINKING, MessageCard } from './message-card.js';

export interface ThinkingBlockProps {
	entry: HistoryEntry;
	expanded: boolean;
	collapsed?: boolean;
}

export function ThinkingBlock({ entry, expanded, collapsed }: ThinkingBlockProps) {
	if (collapsed) {
		return h(MessageCard, {
			accentColor: ACCENT_THINKING,
			backgroundColor: BG_THINKING,
			collapsed: true,
			header: h(
				'box',
				null,
				h('text', { content: '*', fg: ACCENT_THINKING }),
				h('text', { content: ' thinking', fg: '#7982a9' }),
			),
		});
	}

	const duration =
		entry.startTime && entry.endTime ? formatElapsed(entry.endTime - entry.startTime) : null;

	if (entry.streaming && !expanded) {
		const lines = sanitizeUntrusted(entry.content).split('\n');
		const tail = lines.slice(-5);
		return h(
			MessageCard,
			{
				accentColor: ACCENT_THINKING,
				backgroundColor: BG_THINKING,
				header: h(
					'box',
					null,
					h('text', { content: '*', fg: ACCENT_THINKING }),
					h('text', { content: ' thinking ...', fg: '#7982a9' }),
					duration && h('text', { content: ` ${duration}`, fg: '#7982a9' }),
				),
			},
			tail.length > 0 &&
				tail.some((l) => l.trim()) &&
				h(
					'box',
					{ paddingLeft: 1, flexDirection: 'column' },
					lines.length > 5 &&
						h('text', {
							content: `  ... +${lines.length - 5} lines above`,
							fg: '#555e70',
						}),
					...tail.map((line, i) =>
						h('text', {
							key: `s-${i}`,
							content: line,
							fg: '#7982a9',
							italic: true,
						}),
					),
				),
		);
	}

	const lines = sanitizeUntrusted(entry.content).split('\n');
	const totalLines = lines.length;
	const isLong = !entry.streaming && totalLines > THINKING_COLLAPSE_THRESHOLD;
	const shown = isLong && !expanded ? lines.slice(0, THINKING_PREVIEW_LINES) : lines;
	const remaining = totalLines - THINKING_PREVIEW_LINES;

	return h(
		MessageCard,
		{
			accentColor: ACCENT_THINKING,
			backgroundColor: BG_THINKING,
			header: h(
				'box',
				null,
				h('text', { content: '*', fg: ACCENT_THINKING }),
				h('text', { content: ' thinking', fg: '#7982a9' }),
				duration && h('text', { content: ` ${duration}`, fg: '#7982a9' }),
				isLong && h('text', { content: ` (${totalLines} lines)`, fg: '#555e70' }),
			),
		},
		h(
			'box',
			{ paddingLeft: 1, flexDirection: 'column' },
			...shown.map((line, i) =>
				h('text', {
					key: i,
					content: line,
					fg: '#7982a9',
					italic: true,
				}),
			),
		),
		isLong &&
			!expanded &&
			remaining > 0 &&
			h('text', {
				content: `+${remaining} lines [Ctrl+E]`,
				fg: '#555e70',
			}),
	);
}
