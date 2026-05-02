import { Box, Text } from 'ink';

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

	return (
		<Box flexDirection="column" paddingX={2}>
			<Text bold color="cyan">
				Keybindings
			</Text>
			<Text dimColor>──────────────────────</Text>
			{SECTIONS.map((sec) => (
				<Box flexDirection="column" key={sec.title} marginTop={1}>
					<Text bold color="white">
						{sec.title}
					</Text>
					{sec.bindings.map(([key, desc]) => (
						<Box key={key}>
							<Text color="yellow">{key.padEnd(20).slice(0, 20)}</Text>
							<Text dimColor>{desc.slice(0, colW - 22)}</Text>
						</Box>
					))}
				</Box>
			))}
			<Box marginTop={1}>
				<Text dimColor>Press any key to close</Text>
			</Box>
		</Box>
	);
}
