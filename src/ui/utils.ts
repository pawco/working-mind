import { useEffect, useState } from 'react';

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const INPUT_H = 2;
export const INPUT_MAX_H = 2;
export const TOOL_PREVIEW_LINES = 5;
export const TOOL_COLLAPSE_THRESHOLD = 20;
export const THINKING_PREVIEW_LINES = 12;
export const THINKING_COLLAPSE_THRESHOLD = 30;
export const INPUT_BG = '#131820';
export const INPUT_ACCENT = '#56b6c2';
export const INPUT_CONFIRM_BG = '#4a2800';
export const SEPARATOR_COLOR = '#30363d';

export function useSpinner(active: boolean, interval = 80): { frame: string; elapsed: string } {
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

export function formatElapsed(ms: number): string {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	return `${m}m${s % 60}s`;
}

export function charWidth(ch: string): number {
	const cp = ch.codePointAt(0) ?? 0;
	if (
		cp >= 0x1100 &&
		(cp <= 0x115f ||
			(cp >= 0x2e80 && cp <= 0x303e) ||
			(cp >= 0x3040 && cp <= 0xa4cf) ||
			(cp >= 0xac00 && cp <= 0xd7a3) ||
			(cp >= 0xf900 && cp <= 0xfaff) ||
			(cp >= 0xfe10 && cp <= 0xfe19) ||
			(cp >= 0xfe30 && cp <= 0xfe6f) ||
			(cp >= 0xff01 && cp <= 0xff60) ||
			(cp >= 0xffe0 && cp <= 0xffe6) ||
			(cp >= 0x1f300 && cp <= 0x1f9ff))
	)
		return 2;
	return 1;
}

export function plainLineCount(text: string, width: number): number {
	if (!text) return 0;
	let lines = 0;
	let pos = 0;
	for (const ch of text) {
		if (ch === '\n') {
			lines++;
			pos = 0;
			continue;
		}
		pos += charWidth(ch);
		if (pos > width) {
			lines++;
			pos = charWidth(ch);
		}
	}
	return lines + 1;
}
