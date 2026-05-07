import { describe, it, expect, vi } from 'vitest';
import { debounce } from './debounce.js';

describe('debounce', () => {
	it('delays function execution', async () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 50);

		debounced();
		debounced();
		debounced();

		expect(fn).not.toHaveBeenCalled();

		await new Promise((r) => setTimeout(r, 100));
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('passes latest arguments', async () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 50);

		debounced('a');
		debounced('b');
		debounced('c');

		await new Promise((r) => setTimeout(r, 100));
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith('c');
	});

	it('cancel prevents execution', async () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 50);

		debounced('a');
		debounced.cancel();

		await new Promise((r) => setTimeout(r, 100));
		expect(fn).not.toHaveBeenCalled();
	});
});
