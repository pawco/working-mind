import { createElement as h } from 'react';

export interface HelpOverlayProps {
	width: number;
}

const SECTIONS: { title: string; bindings: [string, string][] }[] = [
	{
		title: 'Input',
		bindings: [
			['Enter', 'Send message'],
			['Shift+Enter', 'New line'],
			['Up/Down', 'History (when empty)'],
			['Left/Right', 'Move cursor'],
			['Home/End', 'Jump start/end'],
			['Ctrl+U', 'Clear input'],
			['Ctrl+Y', 'Copy last response'],
			['Esc', 'Clear input / Abort'],
			['Esc Esc', 'Quit app'],
		],
	},
	{
		title: 'Navigation',
		bindings: [
			['Ctrl+C', 'Cancel request / Exit'],
			['Ctrl+S', 'Toggle sidebar'],
			['Ctrl+E', 'Expand/collapse all'],
			['Ctrl+L', 'Redraw screen'],
			['Tab', 'Switch agent'],
		],
	},
	{
		title: 'Scroll',
		bindings: [
			['Shift+Up/Down', 'Scroll 3 lines'],
			['PageUp/PageDown', 'Scroll viewport'],
			['Ctrl+Up/Down', 'Jump top/bottom'],
		],
	},
	{
		title: 'Commands',
		bindings: [
			['/connect', 'Change provider/model'],
			['/session', 'Manage sessions'],
			['/model', 'Show current model'],
			['/compact', 'Compact history'],
			['/prompt', 'View/set system prompt'],
			['/help', 'Show help text'],
		],
	},
];

export function HelpOverlay({ width }: HelpOverlayProps) {
	const colW = Math.min(40, Math.floor((width - 4) / 2));
	const lines: string[] = [];

	lines.push('\x1b[1m\x1b[36mKeybindings\x1b[0m');
	lines.push('\x1b[2m──────────────────────\x1b[0m');

	for (const sec of SECTIONS) {
		lines.push('');
		lines.push(`\x1b[1m\x1b[37m${sec.title}\x1b[0m`);
		for (const [key, desc] of sec.bindings) {
			const paddedKey = key.padEnd(20).slice(0, 20);
			const truncatedDesc = desc.slice(0, colW - 22);
			lines.push(`\x1b[33m${paddedKey}\x1b[2m${truncatedDesc}\x1b[0m`);
		}
	}

	lines.push('');
	lines.push('\x1b[2mPress any key to close\x1b[0m');

	return h(
		'box',
		{ paddingX: 2, flexDirection: 'column' },
		h('text', { content: lines.join('\n') }),
	);
}
