import { createRenderer, strip, themes } from 'markdansi';
import { highlightToAnsi } from './highlight-ansi.js';

let cachedWidth = 80;
let cachedRenderer = createRenderer({
	theme: themes.dim,
	width: cachedWidth,
	color: true,
	codeBox: true,
	codeWrap: true,
	codeGutter: false,
	tableBorder: 'unicode',
	tablePadding: 1,
	quotePrefix: '│ ',
	highlighter: highlightToAnsi,
});

export function renderMarkdown(text: string, width: number): string {
	if (width !== cachedWidth) {
		cachedWidth = width;
		cachedRenderer = createRenderer({
			theme: themes.dim,
			width,
			color: true,
			codeBox: true,
			codeWrap: true,
			codeGutter: false,
			tableBorder: 'unicode',
			tablePadding: 1,
			quotePrefix: '│ ',
			highlighter: highlightToAnsi,
		});
	}
	return cachedRenderer(text);
}

export function renderedLineCount(text: string, width: number): number {
	if (!text) return 0;
	const ansi = renderMarkdown(text, width);
	const plain = strip(ansi);
	return plain.split('\n').length;
}

export function isDiffContent(text: string): boolean {
	const lines = text.split('\n').slice(0, 20);
	let diffLines = 0;
	for (const line of lines) {
		const stripped = line.trimStart();
		if (
			stripped.startsWith('+++') ||
			stripped.startsWith('---') ||
			stripped.startsWith('@@') ||
			(stripped.startsWith('+') &&
				!stripped.startsWith('+-') &&
				stripped.length > 1 &&
				!stripped.startsWith('+ ')) ||
			(stripped.startsWith('-') &&
				!stripped.startsWith('--') &&
				stripped.length > 1 &&
				!stripped.startsWith('- '))
		) {
			diffLines++;
		}
	}
	return diffLines >= 3 && diffLines / lines.length > 0.3;
}

export function renderDiff(text: string): string {
	const lines = text.split('\n');
	const out: string[] = [];
	for (const line of lines) {
		if (line.startsWith('+++')) {
			out.push(`\x1b[1m\x1b[32m${line}\x1b[0m`);
		} else if (line.startsWith('---')) {
			out.push(`\x1b[1m\x1b[31m${line}\x1b[0m`);
		} else if (line.startsWith('@@')) {
			out.push(`\x1b[36m${line}\x1b[0m`);
		} else if (line.startsWith('+')) {
			out.push(`\x1b[32m${line}\x1b[0m`);
		} else if (line.startsWith('-')) {
			out.push(`\x1b[31m${line}\x1b[0m`);
		} else {
			out.push(line);
		}
	}
	return out.join('\n');
}
