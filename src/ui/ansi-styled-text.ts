import { ansi256IndexToRgb, RGBA, StyledText } from '@opentui/core';

const ANSI_FG_16: Record<number, string> = {
	30: '#000000',
	31: '#800000',
	32: '#008000',
	33: '#808000',
	34: '#000080',
	35: '#800080',
	36: '#008080',
	37: '#c0c0c0',
	90: '#808080',
	91: '#ff0000',
	92: '#00ff00',
	93: '#ffff00',
	94: '#0000ff',
	95: '#ff00ff',
	96: '#00ffff',
	97: '#ffffff',
};

const ANSI_BG_16: Record<number, string> = {
	40: '#000000',
	41: '#800000',
	42: '#008000',
	43: '#808000',
	44: '#000080',
	45: '#800080',
	46: '#008080',
	47: '#c0c0c0',
	100: '#808080',
	101: '#ff0000',
	102: '#00ff00',
	103: '#ffff00',
	104: '#0000ff',
	105: '#ff00ff',
	106: '#00ffff',
	107: '#ffffff',
};

const ATTR_BOLD = 1;
const ATTR_DIM = 2;
const ATTR_ITALIC = 4;
const ATTR_UNDERLINE = 8;
const ATTR_BLINK = 16;
const ATTR_INVERSE = 32;
const ATTR_HIDDEN = 64;
const ATTR_STRIKETHROUGH = 128;

const ESC = '\x1b';
const CSI_RE = new RegExp(`${ESC}\\[([0-9;]*)m`, 'g');

interface StyleState {
	fg: string | null;
	bg: string | null;
	attributes: number;
}

function parseParams(params: string): number[] {
	if (!params) return [0];
	return params.split(';').map((p) => (p === '' ? 0 : Number.parseInt(p, 10)));
}

function rgbToHex(r: number, g: number, b: number): string {
	const hex = (v: number) => v.toString(16).padStart(2, '0');
	return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function consume256Color(
	params: number[],
	offset: number,
): { color: string; next: number } | null {
	if (params[offset] === 5 && offset + 1 < params.length) {
		const idx = params[offset + 1];
		if (idx >= 0 && idx < 256) {
			const [r, g, b] = ansi256IndexToRgb(idx);
			return { color: rgbToHex(r, g, b), next: offset + 2 };
		}
		return { color: '#ffffff', next: offset + 2 };
	}
	if (params[offset] === 2 && offset + 3 < params.length) {
		const r = Math.min(255, Math.max(0, params[offset + 1]));
		const g = Math.min(255, Math.max(0, params[offset + 2]));
		const b = Math.min(255, Math.max(0, params[offset + 3]));
		return { color: rgbToHex(r, g, b), next: offset + 4 };
	}
	return null;
}

function applySgr(params: number[], state: StyleState): void {
	let i = 0;
	while (i < params.length) {
		const code = params[i];
		switch (code) {
			case 0:
				state.fg = null;
				state.bg = null;
				state.attributes = 0;
				break;
			case 1:
				state.attributes |= ATTR_BOLD;
				break;
			case 2:
				state.attributes |= ATTR_DIM;
				break;
			case 3:
				state.attributes |= ATTR_ITALIC;
				break;
			case 4:
				state.attributes |= ATTR_UNDERLINE;
				break;
			case 5:
				state.attributes |= ATTR_BLINK;
				break;
			case 7:
				state.attributes |= ATTR_INVERSE;
				break;
			case 8:
				state.attributes |= ATTR_HIDDEN;
				break;
			case 9:
				state.attributes |= ATTR_STRIKETHROUGH;
				break;
			case 22:
				state.attributes &= ~(ATTR_BOLD | ATTR_DIM);
				break;
			case 23:
				state.attributes &= ~ATTR_ITALIC;
				break;
			case 24:
				state.attributes &= ~ATTR_UNDERLINE;
				break;
			case 25:
				state.attributes &= ~ATTR_BLINK;
				break;
			case 27:
				state.attributes &= ~ATTR_INVERSE;
				break;
			case 28:
				state.attributes &= ~ATTR_HIDDEN;
				break;
			case 29:
				state.attributes &= ~ATTR_STRIKETHROUGH;
				break;
			case 39:
				state.fg = null;
				break;
			case 49:
				state.bg = null;
				break;
			default: {
				if (ANSI_FG_16[code]) {
					state.fg = ANSI_FG_16[code];
					break;
				}
				if (ANSI_BG_16[code]) {
					state.bg = ANSI_BG_16[code];
					break;
				}
				if (code === 38) {
					const result = consume256Color(params, i + 1);
					if (result) {
						state.fg = result.color;
						i = result.next - 1;
					}
					break;
				}
				if (code === 48) {
					const result = consume256Color(params, i + 1);
					if (result) {
						state.bg = result.color;
						i = result.next - 1;
					}
					break;
				}
				break;
			}
		}
		i++;
	}
}

function hexToRgb(hex: string): [number, number, number] {
	const m = hex.replace('#', '').match(/.{2}/g);
	if (!m) return [255, 255, 255];
	return m.map((hx) => Number.parseInt(hx, 16)) as [number, number, number];
}

function makeChunk(text: string, state: StyleState) {
	const chunk: {
		__isChunk: true;
		text: string;
		fg?: RGBA;
		bg?: RGBA;
		attributes?: number;
	} = { __isChunk: true, text };
	if (state.fg) {
		const [r, g, b] = hexToRgb(state.fg);
		chunk.fg = RGBA.fromValues(r, g, b);
	}
	if (state.bg) {
		const [r, g, b] = hexToRgb(state.bg);
		chunk.bg = RGBA.fromValues(r, g, b);
	}
	if (state.attributes) {
		chunk.attributes = state.attributes;
	}
	return chunk;
}

function execCsi(re: RegExp, input: string): RegExpExecArray | null {
	return re.exec(input);
}

export function ansiToStyledText(input: string): StyledText {
	const state: StyleState = { fg: null, bg: null, attributes: 0 };
	const chunks: ReturnType<typeof makeChunk>[] = [];
	let lastIdx = 0;

	CSI_RE.lastIndex = 0;
	let match = execCsi(CSI_RE, input);
	while (match !== null) {
		if (match.index > lastIdx) {
			const text = input.slice(lastIdx, match.index);
			if (text.length > 0) {
				chunks.push(makeChunk(text, state));
			}
		}
		const params = parseParams(match[1]);
		applySgr(params, state);
		lastIdx = CSI_RE.lastIndex;
		match = execCsi(CSI_RE, input);
	}
	if (lastIdx < input.length) {
		chunks.push(makeChunk(input.slice(lastIdx), state));
	}
	if (chunks.length === 0) {
		chunks.push(makeChunk('', state));
	}
	return new StyledText(chunks);
}
