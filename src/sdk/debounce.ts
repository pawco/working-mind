export function debounce<T extends (...args: any[]) => void>(
	fn: T,
	delayMs: number,
): T & { cancel: () => void } {
	let timer: ReturnType<typeof setTimeout> | null = null;
	const debounced = ((...args: any[]) => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			fn(...args);
		}, delayMs);
	}) as T & { cancel: () => void };
	debounced.cancel = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	};
	return debounced;
}
