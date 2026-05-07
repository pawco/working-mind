import { createElement as h, useEffect, useRef, useState } from 'react';
import {
	formatElapsed,
	INPUT_ACCENT,
	INPUT_BG,
	INPUT_CONFIRM_BG,
	INPUT_H,
	SEPARATOR_COLOR,
	SPINNER_FRAMES,
} from '../ui/utils.js';

export interface InputBarProps {
	input: string;
	cursorIndex: number;
	isStreaming: boolean;
	waitingConfirmation: boolean;
	confirmationTool: string;
	waitingCmdConfirmation: boolean;
	cmdConfirmationMessage: string;
	packName?: string;
	model?: string;
	provider?: string;
	renderer: any;
	onSubmit: (text: string) => void;
	onInput: (text: string, cursor: number) => void;
	onCancel: () => void;
}

function useSpinner(active: boolean, interval = 80) {
	const [idx, setIdx] = useState(0);
	const [start, setStart] = useState(0);
	const [now, setNow] = useState(0);

	useEffect(() => {
		if (!active) {
			setIdx(0);
			setStart(0);
			setNow(0);
			return;
		}
		const s = Date.now();
		setStart(s);
		setNow(s);
		const spinTimer = setInterval(
			() => setIdx((i) => (i + 1) % SPINNER_FRAMES.length),
			interval,
		);
		const elapsedTimer = setInterval(() => setNow(Date.now()), 1000);
		return () => {
			clearInterval(spinTimer);
			clearInterval(elapsedTimer);
		};
	}, [active, interval]);

	const elapsed = active && start ? formatElapsed(now - start) : '';
	return { frame: SPINNER_FRAMES[idx], elapsed };
}

const INFO_BAR_H = 1;
const SEPARATOR_H = 1;

function getVisibleLines(
	input: string,
	cursorIndex: number,
	maxRows: number,
): {
	lines: string[];
	cursorRow: number;
	cursorCol: number;
	scrollOffset: number;
} {
	if (!input) {
		return { lines: [''], cursorRow: 0, cursorCol: 0, scrollOffset: 0 };
	}
	const allLines = input.split('\n');
	let cursorRow = 0;
	let charsBeforeCursor = 0;
	for (let i = 0; i < allLines.length; i++) {
		if (charsBeforeCursor + allLines[i].length >= cursorIndex) {
			cursorRow = i;
			break;
		}
		charsBeforeCursor += allLines[i].length + 1;
		if (i === allLines.length - 1) cursorRow = i;
	}
	const cursorCol = cursorIndex - charsBeforeCursor;

	if (allLines.length <= maxRows) {
		return { lines: allLines, cursorRow, cursorCol, scrollOffset: 0 };
	}

	let scrollOffset = Math.max(0, cursorRow - maxRows + 1);
	if (scrollOffset > 0 && cursorRow < scrollOffset) {
		scrollOffset = cursorRow;
	}
	const visible = allLines.slice(scrollOffset, scrollOffset + maxRows);
	const visibleCursorRow = cursorRow - scrollOffset;
	return {
		lines: visible,
		cursorRow: visibleCursorRow,
		cursorCol,
		scrollOffset,
	};
}

export function computeInputBarHeight(
	_input: string,
	isStreaming: boolean,
	waitingConfirmation: boolean,
	waitingCmdConfirmation: boolean = false,
	cmdConfirmationMessage: string = '',
	_termWidth: number = 80,
): number {
	if (waitingCmdConfirmation) {
		const msgLines = cmdConfirmationMessage
			? cmdConfirmationMessage.split('\n').length
			: 0;
		return INPUT_H + msgLines + INFO_BAR_H + SEPARATOR_H;
	}
	if (isStreaming || waitingConfirmation) {
		return INPUT_H + INFO_BAR_H + SEPARATOR_H;
	}
	return INPUT_H + INFO_BAR_H + SEPARATOR_H;
}

export function InputBar({
	input,
	cursorIndex,
	isStreaming,
	waitingConfirmation,
	confirmationTool,
	waitingCmdConfirmation,
	cmdConfirmationMessage,
	packName,
	model,
	provider,
	renderer: _renderer,
	onSubmit: _onSubmit,
	onInput: _onInput,
	onCancel: _onCancel,
}: InputBarProps) {
	const { frame: spinnerFrame, elapsed } = useSpinner(isStreaming);
	const _inputRef = useRef<any>(null);

	const infoParts: string[] = [];
	if (packName) infoParts.push(packName);
	if (model) infoParts.push(model);
	if (provider) infoParts.push(provider);
	const infoLine = infoParts.length > 0 ? ` ${infoParts.join(' · ')}` : '';

	const infoBar = infoLine
		? h(
				'box',
				{
					height: INFO_BAR_H,
					flexShrink: 0,
					paddingX: 2,
					flexDirection: 'row',
				},
				h('text', { content: infoLine, fg: '#7982a9' }),
			)
		: null;

	const separator = h('box', {
		height: SEPARATOR_H,
		flexShrink: 0,
		backgroundColor: SEPARATOR_COLOR,
	});

	if (waitingCmdConfirmation) {
		return h(
			'box',
			{ flexDirection: 'column', flexShrink: 0 },
			h(
				'box',
				{
					flexDirection: 'row',
					flexShrink: 0,
				},
				h('box', { width: 1, backgroundColor: '#e5a00d' }),
				h(
					'box',
					{
						flexDirection: 'column',
						flexGrow: 1,
						backgroundColor: INPUT_CONFIRM_BG,
						paddingX: 2,
						paddingTop: 1,
						paddingBottom: 1,
					},
					h('text', {
						content: cmdConfirmationMessage,
						fg: '#c4a44a',
					}),
				),
			),
			h(
				'box',
				{ flexDirection: 'row', height: INPUT_H, flexShrink: 0 },
				h('box', { width: 1, backgroundColor: '#e5a00d' }),
				h(
					'box',
					{
						flexDirection: 'column',
						flexGrow: 1,
						backgroundColor: INPUT_CONFIRM_BG,
						justifyContent: 'center',
						paddingX: 2,
					},
					h('text', {
						content: '! proceed? [y/N]',
						bold: true,
					}),
				),
			),
			separator,
			infoBar,
		);
	}

	if (waitingConfirmation) {
		return h(
			'box',
			{ flexDirection: 'column', flexShrink: 0 },
			h(
				'box',
				{ flexDirection: 'row', height: INPUT_H, flexShrink: 0 },
				h('box', { width: 1, backgroundColor: '#e5a00d' }),
				h(
					'box',
					{
						flexDirection: 'column',
						flexGrow: 1,
						backgroundColor: INPUT_CONFIRM_BG,
						justifyContent: 'center',
						paddingX: 2,
						paddingTop: 1,
						paddingBottom: 1,
					},
					h('text', {
						content: `! ${confirmationTool} -- proceed? [y/N]`,
						bold: true,
					}),
				),
			),
			separator,
			infoBar,
		);
	}

	if (isStreaming) {
		return h(
			'box',
			{ flexDirection: 'column', flexShrink: 0 },
			h(
				'box',
				{ flexDirection: 'row', height: INPUT_H, flexShrink: 0 },
				h('box', { width: 1, backgroundColor: INPUT_ACCENT }),
				h(
					'box',
					{
						flexDirection: 'column',
						flexGrow: 1,
						backgroundColor: INPUT_BG,
						justifyContent: 'center',
						paddingX: 2,
					},
					h('text', {
						content: `${spinnerFrame} waiting${elapsed ? ` ${elapsed}` : ''}...`,
						fg: '#7982a9',
					}),
				),
			),
			separator,
			infoBar,
		);
	}

	const { lines, cursorRow, cursorCol } = getVisibleLines(
		input,
		cursorIndex,
		INPUT_H,
	);

	const allLines = input.split('\n');
	const totalLines = allLines.length;
	const scrollIndicator =
		totalLines > INPUT_H
			? ` ${Math.min(cursorRow + 1, totalLines)}/${totalLines}`
			: '';

	return h(
		'box',
		{ flexDirection: 'column', flexShrink: 0 },
		h(
			'box',
			{ flexDirection: 'row', height: INPUT_H, flexShrink: 0 },
			h('box', { width: 1, backgroundColor: INPUT_ACCENT }),
			h(
				'box',
				{
					flexDirection: 'column',
					flexGrow: 1,
					backgroundColor: INPUT_BG,
					paddingX: 2,
					paddingTop: 0,
				},
				...lines.map((line, i) => {
					if (!input) {
						return h('text', {
							key: i,
							content: '\u2588',
							fg: '#7982a9',
						});
					}
					if (i === cursorRow) {
						const before = line.slice(0, cursorCol);
						const cursorChar = line.charAt(cursorCol) || ' ';
						const after = line.slice(cursorCol + 1);
						return h('text', {
							key: i,
							content: `${before}\u2588${cursorChar}${after}`,
							fg: 'white',
						});
					}
					return h('text', { key: i, content: line, fg: 'white' });
				}),
			),
		),
		separator,
		h(
			'box',
			{
				height: INFO_BAR_H,
				flexShrink: 0,
				paddingX: 2,
				flexDirection: 'row',
			},
			!input &&
				h('text', {
					content: ' Ask anything...',
					fg: '#4a5568',
				}),
			input &&
				h('text', {
					content: scrollIndicator,
					fg: '#4a5568',
				}),
			infoLine &&
				h('text', {
					content: infoLine,
					fg: '#7982a9',
				}),
		),
	);
}
