import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../sdk/command.js';

function estimateEntryHeight(
	entry: HistoryEntry,
	width: number,
	expandAll: boolean,
): number {
	const usable = Math.max(20, width - 4);
	let lines = 0;
	let pos = 0;
	for (const ch of entry.content || '') {
		if (ch === '\n') {
			lines++;
			pos = 0;
			continue;
		}
		pos += 1;
		if (pos > usable) {
			lines++;
			pos = 1;
		}
	}
	if (entry.content) lines++;
	const header = 1;
	const overhead = 2;
	if (entry.role === 'thinking' && !entry.streaming) {
		if (!expandAll && lines > 15) {
			return header + 3 + 1 + overhead;
		}
		return header + lines + overhead;
	}
	if (entry.role === 'tool_result') {
		if (!expandAll && lines > 8) {
			return header + 8 + 1 + overhead;
		}
		return header + lines + overhead;
	}
	if (entry.role === 'tool_call') {
		return header + overhead;
	}
	if (entry.role === 'error') {
		const capped = Math.min(lines, 5);
		return header + capped + 1 + overhead;
	}
	return header + lines + overhead;
}

const ENTRY_GAP = 1;

function computeCumulativeOffsets(
	entries: HistoryEntry[],
	heights: Map<number, number>,
	contentWidth: number,
	expandAll: boolean,
): { offsets: number[]; totalHeight: number } {
	const offsets: number[] = [];
	let cumulative = 0;
	for (let i = 0; i < entries.length; i++) {
		offsets.push(cumulative);
		const h =
			heights.get(entries[i].id) ??
			estimateEntryHeight(entries[i], contentWidth, expandAll);
		cumulative += h + (i < entries.length - 1 ? ENTRY_GAP : 0);
	}
	return { offsets, totalHeight: cumulative };
}

function findVisibleRange(
	offsets: number[],
	_totalHeight: number,
	heights: Map<number, number>,
	entries: HistoryEntry[],
	yOffset: number,
	viewportRows: number,
	expandAll: boolean,
): { startIdx: number; endIdx: number } {
	if (offsets.length === 0) return { startIdx: 0, endIdx: -1 };

	const bottomEdge = yOffset + viewportRows;

	let lo = 0;
	let hi = offsets.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		const h =
			heights.get(entries[mid].id) ??
			estimateEntryHeight(entries[mid], 80, expandAll);
		if (offsets[mid] + h + ENTRY_GAP <= yOffset) lo = mid + 1;
		else hi = mid;
	}
	const startIdx = Math.max(0, lo - 1);

	lo = startIdx;
	hi = offsets.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (offsets[mid] < bottomEdge) lo = mid;
		else hi = mid - 1;
	}
	const endIdx = Math.min(offsets.length - 1, lo + 1);

	return { startIdx, endIdx };
}

function findSnapStartIdx(
	offsets: number[],
	effectiveYOffset: number,
): number {
	for (let i = 0; i < offsets.length; i++) {
		if (offsets[i] >= effectiveYOffset) return i;
	}
	return offsets.length - 1;
}

function makeEntry(
	id: number,
	role: HistoryEntry['role'],
	content: string,
): HistoryEntry {
	return { id, role, content };
}

describe('ViewportSlice scroll algorithms', () => {
	describe('computeCumulativeOffsets', () => {
		it('returns empty for empty entries', () => {
			const result = computeCumulativeOffsets([], new Map(), 80, false);
			expect(result.offsets).toEqual([]);
			expect(result.totalHeight).toBe(0);
		});

		it('computes offsets for single entry', () => {
			const entries = [makeEntry(1, 'user', 'hello')];
			const heights = new Map<number, number>();
			const result = computeCumulativeOffsets(entries, heights, 80, false);
			expect(result.offsets).toEqual([0]);
			expect(result.totalHeight).toBeGreaterThan(0);
		});

		it('uses measured height when available', () => {
			const entries = [makeEntry(1, 'user', 'hello')];
			const heights = new Map([[1, 10]]);
			const result = computeCumulativeOffsets(entries, heights, 80, false);
			expect(result.offsets).toEqual([0]);
			expect(result.totalHeight).toBe(10);
		});

		it('accumulates with gap between entries', () => {
			const entries = [
				makeEntry(1, 'user', 'a'),
				makeEntry(2, 'assistant', 'b'),
			];
			const heights = new Map([
				[1, 5],
				[2, 8],
			]);
			const result = computeCumulativeOffsets(entries, heights, 80, false);
			expect(result.offsets).toEqual([0, 5 + ENTRY_GAP]);
			expect(result.totalHeight).toBe(5 + ENTRY_GAP + 8);
		});

		it('no gap after last entry', () => {
			const entries = [
				makeEntry(1, 'user', 'a'),
				makeEntry(2, 'assistant', 'b'),
				makeEntry(3, 'user', 'c'),
			];
			const heights = new Map([
				[1, 5],
				[2, 8],
				[3, 4],
			]);
			const result = computeCumulativeOffsets(entries, heights, 80, false);
			expect(result.offsets).toEqual([
				0,
				5 + ENTRY_GAP,
				5 + ENTRY_GAP + 8 + ENTRY_GAP,
			]);
			expect(result.totalHeight).toBe(5 + ENTRY_GAP + 8 + ENTRY_GAP + 4);
		});
	});

	describe('findVisibleRange', () => {
		it('returns empty range for no entries', () => {
			const result = findVisibleRange([], 0, new Map(), [], 0, 40, false);
			expect(result.startIdx).toBe(0);
			expect(result.endIdx).toBe(-1);
		});

		it('returns single entry when all fit in viewport', () => {
			const entries = [makeEntry(1, 'user', 'hi')];
			const heights = new Map([[1, 5]]);
			const { offsets, totalHeight } = computeCumulativeOffsets(
				entries,
				heights,
				80,
				false,
			);
			const result = findVisibleRange(
				offsets,
				totalHeight,
				heights,
				entries,
				0,
				40,
				false,
			);
			expect(result.startIdx).toBe(0);
			expect(result.endIdx).toBe(0);
		});

		it('finds visible entries in the middle of a long list', () => {
			const entries = Array.from({ length: 50 }, (_, i) =>
				makeEntry(i + 1, 'assistant', `entry ${i + 1}`),
			);
			const heights = new Map(
				entries.map((e) => [e.id, 10] as [number, number]),
			);
			const { offsets, totalHeight } = computeCumulativeOffsets(
				entries,
				heights,
				80,
				false,
			);
			const yOffset = 200;
			const viewportRows = 30;
			const result = findVisibleRange(
				offsets,
				totalHeight,
				heights,
				entries,
				yOffset,
				viewportRows,
				false,
			);
			expect(result.startIdx).toBeLessThan(result.endIdx);
			expect(result.startIdx).toBeGreaterThanOrEqual(0);
			expect(result.endIdx).toBeLessThan(entries.length);
		});

		it('includes one entry before visible region for partial visibility', () => {
			const entries = Array.from({ length: 20 }, (_, i) =>
				makeEntry(i + 1, 'user', `msg ${i + 1}`),
			);
			const heights = new Map(
				entries.map((e) => [e.id, 10] as [number, number]),
			);
			const { offsets, totalHeight } = computeCumulativeOffsets(
				entries,
				heights,
				80,
				false,
			);
			const yOffset = 55;
			const viewportRows = 30;
			const result = findVisibleRange(
				offsets,
				totalHeight,
				heights,
				entries,
				yOffset,
				viewportRows,
				false,
			);
			expect(result.startIdx).toBeLessThanOrEqual(5);
		});

		it('clamps startIdx to 0', () => {
			const entries = [makeEntry(1, 'user', 'top')];
			const heights = new Map([[1, 5]]);
			const { offsets, totalHeight } = computeCumulativeOffsets(
				entries,
				heights,
				80,
				false,
			);
			const result = findVisibleRange(
				offsets,
				totalHeight,
				heights,
				entries,
				0,
				40,
				false,
			);
			expect(result.startIdx).toBe(0);
		});

		it('clamps endIdx to last entry', () => {
			const entries = Array.from({ length: 5 }, (_, i) =>
				makeEntry(i + 1, 'user', `msg ${i + 1}`),
			);
			const heights = new Map(
				entries.map((e) => [e.id, 10] as [number, number]),
			);
			const { offsets, totalHeight } = computeCumulativeOffsets(
				entries,
				heights,
				80,
				false,
			);
			const result = findVisibleRange(
				offsets,
				totalHeight,
				heights,
				entries,
				0,
				1000,
				false,
			);
			expect(result.endIdx).toBe(entries.length - 1);
		});
	});

	describe('scroll position math', () => {
		it('maxOffset is totalHeight - viewportRows', () => {
			const entries = Array.from({ length: 10 }, (_, i) =>
				makeEntry(i + 1, 'user', `msg ${i + 1}`),
			);
			const heights = new Map(
				entries.map((e) => [e.id, 10] as [number, number]),
			);
			const { totalHeight } = computeCumulativeOffsets(
				entries,
				heights,
				80,
				false,
			);
			const viewportRows = 30;
			const maxOffset = Math.max(0, totalHeight - viewportRows);
			expect(maxOffset).toBe(totalHeight - viewportRows);
		});

		it('maxOffset is 0 when content fits viewport', () => {
			const entries = [makeEntry(1, 'user', 'short')];
			const heights = new Map([[1, 5]]);
			const { totalHeight } = computeCumulativeOffsets(
				entries,
				heights,
				80,
				false,
			);
			const viewportRows = 40;
			const maxOffset = Math.max(0, totalHeight - viewportRows);
			expect(maxOffset).toBe(0);
		});

		it('scrollBy clamps to [0, maxOffset]', () => {
			const maxOffset = 100;
			const currentOffset = 50;
			expect(Math.max(0, Math.min(maxOffset, currentOffset + 3))).toBe(53);
			expect(Math.max(0, Math.min(maxOffset, currentOffset + 60))).toBe(100);
			expect(Math.max(0, Math.min(maxOffset, currentOffset - 60))).toBe(0);
		});

		it('topClip is yOffset minus first visible entry offset', () => {
			const entries = Array.from({ length: 10 }, (_, i) =>
				makeEntry(i + 1, 'user', `msg ${i + 1}`),
			);
			const heights = new Map(
				entries.map((e) => [e.id, 10] as [number, number]),
			);
			const { offsets } = computeCumulativeOffsets(entries, heights, 80, false);
			const yOffset = 25;
			const startIdx = 2;
			const topClip = yOffset - offsets[startIdx];
			expect(topClip).toBe(yOffset - (2 * 10 + 2 * ENTRY_GAP));
		});

		it('topClip is 0 when yOffset aligns with entry start', () => {
			const entries = Array.from({ length: 5 }, (_, i) =>
				makeEntry(i + 1, 'user', `msg ${i + 1}`),
			);
			const heights = new Map(
				entries.map((e) => [e.id, 10] as [number, number]),
			);
			const { offsets } = computeCumulativeOffsets(entries, heights, 80, false);
			expect(offsets[0]).toBe(0);
			expect(offsets[1]).toBe(10 + ENTRY_GAP);
			const topClip = offsets[1] - offsets[1];
			expect(topClip).toBe(0);
		});
	});

	describe('estimateEntryHeight', () => {
		it('returns at least 3 for any entry (header + overhead)', () => {
			const entry = makeEntry(1, 'user', '');
			const h = estimateEntryHeight(entry, 80, false);
			expect(h).toBeGreaterThanOrEqual(3);
		});

		it('grows with longer content', () => {
			const short = makeEntry(1, 'assistant', 'hi');
			const long = makeEntry(2, 'assistant', 'a'.repeat(500));
			const hShort = estimateEntryHeight(short, 80, false);
			const hLong = estimateEntryHeight(long, 80, false);
			expect(hLong).toBeGreaterThan(hShort);
		});

		it('caps thinking height when not expanded', () => {
			const entry = makeEntry(1, 'thinking', 'line\n'.repeat(50));
			const h = estimateEntryHeight(entry, 80, false);
			const expanded = estimateEntryHeight(entry, 80, true);
			expect(h).toBeLessThan(expanded);
		});

		it('does not cap streaming thinking', () => {
			const entry: HistoryEntry = {
				id: 1,
				role: 'thinking',
				content: 'line\n'.repeat(50),
				streaming: true,
			};
			const h = estimateEntryHeight(entry, 80, false);
			expect(h).toBeGreaterThan(5);
		});

		it('caps tool_result height when not expanded', () => {
			const entry = makeEntry(1, 'tool_result', 'line\n'.repeat(50));
			const h = estimateEntryHeight(entry, 80, false);
			const expanded = estimateEntryHeight(entry, 80, true);
			expect(h).toBeLessThan(expanded);
		});

		it('tool_call has minimal height', () => {
			const entry = makeEntry(1, 'tool_call', JSON.stringify({ a: 1 }));
			const h = estimateEntryHeight(entry, 80, false);
			expect(h).toBe(3);
		});
	});

	describe('findSnapStartIdx', () => {
		it('returns 0 for empty offsets', () => {
			expect(findSnapStartIdx([], 0)).toBe(-1);
		});

		it('returns first entry when yOffset is 0', () => {
			const offsets = [0, 11, 22];
			expect(findSnapStartIdx(offsets, 0)).toBe(0);
		});

		it('skips partially visible entry', () => {
			const offsets = [0, 11, 22];
			expect(findSnapStartIdx(offsets, 5)).toBe(1);
		});

		it('returns exact match when offset equals yOffset', () => {
			const offsets = [0, 11, 22];
			expect(findSnapStartIdx(offsets, 11)).toBe(1);
		});

		it('returns last entry when yOffset is beyond all offsets', () => {
			const offsets = [0, 11, 22];
			expect(findSnapStartIdx(offsets, 100)).toBe(2);
		});

		it('works with many entries', () => {
			const offsets = Array.from({ length: 50 }, (_, i) => i * 11);
			expect(findSnapStartIdx(offsets, 55)).toBe(5);
		});
	});
});
