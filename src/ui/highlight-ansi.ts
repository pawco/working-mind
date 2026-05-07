import { Chalk } from 'chalk';
import hljs from 'highlight.js';

const chalk = new Chalk({ level: 3 });

const HLJS_CLASS_COLORS: Record<string, (t: string) => string> = {
	'hljs-keyword': chalk.bold.yellow,
	'hljs-built_in': chalk.cyan,
	'hljs-type': chalk.green,
	'hljs-literal': chalk.magenta,
	'hljs-number': chalk.cyan,
	'hljs-string': chalk.green,
	'hljs-regexp': chalk.red,
	'hljs-symbol': chalk.cyan,
	'hljs-bullet': chalk.cyan,
	'hljs-link': chalk.blue.underline,
	'hljs-addition': chalk.green,
	'hljs-deletion': chalk.red,
	'hljs-comment': chalk.dim,
	'hljs-doctag': chalk.yellow,
	'hljs-meta': chalk.dim,
	'hljs-meta-keyword': chalk.dim.yellow,
	'hljs-meta-string': chalk.dim.green,
	'hljs-attr': chalk.yellow,
	'hljs-attribute': chalk.yellow,
	'hljs-name': chalk.blue,
	'hljs-tag': chalk.blue,
	'hljs-title': chalk.blue,
	'hljs-title.class_': chalk.bold.blue,
	'hljs-title.function_': chalk.bold.blue,
	'hljs-section': chalk.bold.cyan,
	'hljs-selector-tag': chalk.bold.yellow,
	'hljs-selector-id': chalk.blue,
	'hljs-selector-class': chalk.yellow,
	'hljs-selector-attr': chalk.magenta,
	'hljs-selector-pseudo': chalk.cyan,
	'hljs-variable': chalk.red,
	'hljs-variable.language_': chalk.magenta,
	'hljs-variable.constant_': chalk.cyan,
	'hljs-params': chalk.white,
	'hljs-property': chalk.cyan,
	'hljs-subst': chalk.white,
	'hljs-template-tag': chalk.magenta,
	'hljs-template-variable': chalk.red,
	'hljs-class': chalk.green,
	'hljs-function': chalk.blue,
};

const HTML_ENTITIES: Record<string, string> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#39;': "'",
	'&#x27;': "'",
};

export function highlightToAnsi(code: string, lang?: string): string {
	if (!lang) return code;
	const safeLang = lang.replace(/[^a-zA-Z0-9+_.-]/g, '').slice(0, 20);
	if (!safeLang) return code;

	let html: string;
	try {
		if (hljs.getLanguage(safeLang)) {
			const result = hljs.highlight(code, {
				language: safeLang,
				ignoreIllegals: true,
			});
			html = result.value;
		} else {
			const auto = hljs.highlightAuto(code);
			html = auto.value;
		}
	} catch {
		return code;
	}

	const classStack: string[] = [];
	let out = '';

	let i = 0;
	while (i < html.length) {
		if (html.startsWith('<span class="', i)) {
			const endQuote = html.indexOf('">', i + 13);
			if (endQuote !== -1) {
				const className = html.slice(i + 13, endQuote);
				classStack.push(className);
				i = endQuote + 2;
				continue;
			}
		}
		if (html.startsWith('</span>', i)) {
			classStack.pop();
			i += 7;
			continue;
		}
		if (html[i] === '<' && html.startsWith('<br', i)) {
			out += '\n';
			const closeBr = html.indexOf('>', i);
			i = closeBr !== -1 ? closeBr + 1 : i + 1;
			continue;
		}
		if (html[i] === '&') {
			const semi = html.indexOf(';', i);
			if (semi !== -1 && semi - i < 8) {
				const entity = html.slice(i, semi + 1);
				const decoded = HTML_ENTITIES[entity];
				if (decoded) {
					out += decoded;
					i = semi + 1;
					continue;
				}
			}
		}

		const textStart = i;
		while (i < html.length && html[i] !== '<' && html[i] !== '&') {
			i++;
		}
		if (i > textStart) {
			const raw = html.slice(textStart, i);
			const activeClass =
				classStack.length > 0 ? classStack[classStack.length - 1] : null;
			if (activeClass) {
				const colorFn = HLJS_CLASS_COLORS[activeClass];
				if (colorFn) {
					out += colorFn(raw);
				} else {
					const parts = activeClass.split(' ');
					let styled = false;
					for (const part of parts) {
						if (HLJS_CLASS_COLORS[part]) {
							out += HLJS_CLASS_COLORS[part](raw);
							styled = true;
							break;
						}
					}
					if (!styled) out += raw;
				}
			} else {
				out += raw;
			}
		}
	}

	return out;
}
