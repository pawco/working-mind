import { createElement as h } from 'react';
import type { HistoryEntry } from '../sdk/command.js';
import { sanitizeUntrusted } from '../ui/ansi-sanitize.js';
import { ACCENT_USER, BG_USER, MessageCard } from './message-card.js';

export interface UserMessageProps {
	entry: HistoryEntry;
	collapsed?: boolean;
}

export function UserMessage({ entry, collapsed }: UserMessageProps) {
	return h(
		MessageCard,
		{
			accentColor: ACCENT_USER,
			backgroundColor: BG_USER,
			collapsed,
			header: h(
				'box',
				null,
				h('text', { content: '>', fg: ACCENT_USER }),
				h('text', { content: ' You', bold: true }),
			),
		},
		h(
			'box',
			{ paddingLeft: 1 },
			h('text', { content: sanitizeUntrusted(entry.content) }),
		),
	);
}
