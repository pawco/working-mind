import { createElement as h } from 'react';

export const ACCENT_USER = '#61afef';
export const ACCENT_THINKING = '#c678dd';
export const ACCENT_TOOL_CALL = '#e5c07b';
export const ACCENT_TOOL_OK = '#98c379';
export const ACCENT_TOOL_ERR = '#e06c75';
export const ACCENT_ASSISTANT = '#56b6c2';

export const BG_USER = '#111827';
export const BG_ASSISTANT = '#0d1117';
export const BG_THINKING = '#0f0d17';
export const BG_TOOL_CALL = '#15130d';
export const BG_TOOL_OK = '#0d1510';
export const BG_TOOL_ERR = '#1a0d0d';

export function getAccentColor(role: string, exitCode?: number): string {
	if (role === 'user') return ACCENT_USER;
	if (role === 'thinking') return ACCENT_THINKING;
	if (role === 'tool_call') return ACCENT_TOOL_CALL;
	if (role === 'tool_result') return exitCode === 0 ? ACCENT_TOOL_OK : ACCENT_TOOL_ERR;
	if (role === 'assistant') return ACCENT_ASSISTANT;
	return '#555555';
}

export function getBackgroundColor(role: string, exitCode?: number): string {
	if (role === 'user') return BG_USER;
	if (role === 'thinking') return BG_THINKING;
	if (role === 'tool_call') return BG_TOOL_CALL;
	if (role === 'tool_result') return exitCode === 0 ? BG_TOOL_OK : BG_TOOL_ERR;
	if (role === 'assistant') return BG_ASSISTANT;
	return '#0d1117';
}

export interface MessageCardProps {
	accentColor: string;
	backgroundColor?: string;
	collapsed?: boolean;
	header: ReturnType<typeof h>;
	children?: ReturnType<typeof h>;
}

export function MessageCard({
	accentColor,
	backgroundColor,
	collapsed,
	header,
	children,
}: MessageCardProps) {
	return h(
		'box',
		{ flexDirection: 'row', backgroundColor: backgroundColor || '#0d1117' },
		h('box', { width: 1, backgroundColor: accentColor }, h('text', { content: ' ' })),
		h(
			'box',
			{ flexDirection: 'column', flexGrow: 1, paddingX: 1 },
			header,
			!collapsed && children,
		),
	);
}
