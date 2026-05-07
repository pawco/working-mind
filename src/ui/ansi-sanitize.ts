import stripAnsi from 'strip-ansi';

export function sanitizeUntrusted(input: string): string {
	return stripAnsi(input);
}
