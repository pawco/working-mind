export function splitFrontmatter(content: string): {
	frontmatter: Record<string, string>;
	body: string;
} {
	const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
	if (!match) return { frontmatter: {}, body: content };
	const raw = match[1];
	const body = match[2];
	const fm: Record<string, string> = {};
	let currentArrayKey = '';
	const arrayItems: string[] = [];
	for (const line of raw.split('\n')) {
		const arrayMatch = line.match(/^\s+-\s+(.+)$/);
		if (arrayMatch) {
			if (currentArrayKey) {
				arrayItems.push(arrayMatch[1].trim().replace(/^["']|["']$/g, ''));
			}
			continue;
		}
		if (currentArrayKey && arrayItems.length > 0) {
			fm[currentArrayKey] = arrayItems.join(' ');
			currentArrayKey = '';
			arrayItems.length = 0;
		}
		const idx = line.indexOf(':');
		if (idx > 0) {
			const key = line.slice(0, idx).trim();
			const val = line.slice(idx + 1).trim();
			if (key) {
				if (val) {
					fm[key] = val.replace(/^["']|["']$/g, '');
				} else {
					currentArrayKey = key;
				}
			}
		}
	}
	if (currentArrayKey && arrayItems.length > 0) {
		fm[currentArrayKey] = arrayItems.join(' ');
	}
	return { frontmatter: fm, body };
}
