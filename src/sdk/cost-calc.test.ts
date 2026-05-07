import { describe, expect, it } from 'vitest';
import {
	calculateResponseCost,
	calculateTurnCost,
	formatCost,
	formatPriceBadge,
} from './cost-calc.js';
import type { ModelEntry } from './provider-registry.js';

const sonnet: ModelEntry = {
	id: 'anthropic/claude-sonnet-4.6',
	displayName: 'Claude Sonnet 4.6',
	contextWindow: 200000,
	inputPricePer1M: 3,
	outputPricePer1M: 15,
	supportsReasoning: true,
	supportsToolCalling: true,
};

const haiku: ModelEntry = {
	id: 'anthropic/claude-haiku-4-5',
	displayName: 'Claude Haiku 4.5',
	contextWindow: 200000,
	inputPricePer1M: 1,
	outputPricePer1M: 5,
	supportsReasoning: true,
	supportsToolCalling: true,
};

describe('calculateTurnCost', () => {
	it('calculates cost for a typical turn', () => {
		const result = calculateTurnCost(sonnet, 1000, 500);
		expect(result.promptTokens).toBe(1000);
		expect(result.completionTokens).toBe(500);
		expect(result.inputCost).toBeCloseTo(0.003, 6);
		expect(result.outputCost).toBeCloseTo(0.0075, 6);
		expect(result.totalCost).toBeCloseTo(0.0105, 6);
	});

	it('returns zero cost when model is undefined', () => {
		const result = calculateTurnCost(undefined, 1000, 500);
		expect(result.inputCost).toBe(0);
		expect(result.outputCost).toBe(0);
		expect(result.totalCost).toBe(0);
	});

	it('returns zero cost when tokens are zero', () => {
		const result = calculateTurnCost(sonnet, 0, 0);
		expect(result.totalCost).toBe(0);
	});

	it('handles large token counts', () => {
		const result = calculateTurnCost(sonnet, 1_000_000, 100_000);
		expect(result.inputCost).toBe(3);
		expect(result.outputCost).toBe(1.5);
		expect(result.totalCost).toBe(4.5);
	});
});

describe('calculateResponseCost', () => {
	it('sums multiple turns', () => {
		const turns = [
			calculateTurnCost(sonnet, 1000, 500),
			calculateTurnCost(haiku, 2000, 1000),
		];
		const result = calculateResponseCost(turns);
		expect(result.totalPromptTokens).toBe(3000);
		expect(result.totalCompletionTokens).toBe(1500);
		expect(result.totalCost).toBeCloseTo(0.0105 + 0.007, 6);
	});

	it('handles empty turns array', () => {
		const result = calculateResponseCost([]);
		expect(result.totalPromptTokens).toBe(0);
		expect(result.totalCompletionTokens).toBe(0);
		expect(result.totalCost).toBe(0);
	});

	it('handles single turn', () => {
		const turns = [calculateTurnCost(sonnet, 500, 200)];
		const result = calculateResponseCost(turns);
		expect(result.turns.length).toBe(1);
		expect(result.totalPromptTokens).toBe(500);
		expect(result.totalCompletionTokens).toBe(200);
	});
});

describe('formatCost', () => {
	it('formats zero cost', () => {
		expect(formatCost(0)).toBe('$0');
	});

	it('formats very small cost', () => {
		expect(formatCost(0.0001)).toBe('<$0.001');
	});

	it('formats sub-penny cost', () => {
		expect(formatCost(0.005)).toBe('$0.0050');
	});

	it('formats small cost', () => {
		expect(formatCost(0.05)).toBe('$0.050');
	});

	it('formats under-a-dollar cost', () => {
		expect(formatCost(0.5)).toBe('$0.500');
	});

	it('formats dollar cost', () => {
		expect(formatCost(4.5)).toBe('$4.50');
	});

	it('formats large cost', () => {
		expect(formatCost(123.456)).toBe('$123.46');
	});
});

describe('formatPriceBadge', () => {
	it('shows [local] for local models', () => {
		expect(formatPriceBadge(0, 0, true)).toBe('[local]');
	});

	it('shows [free] for zero-cost paid models', () => {
		expect(formatPriceBadge(0, 0, false)).toBe('[free]');
	});

	it('formats sub-dollar pricing with 2 decimals', () => {
		expect(formatPriceBadge(0.15, 0.6, false)).toBe('$0.15/$0.60');
	});

	it('formats integer pricing without decimals', () => {
		expect(formatPriceBadge(3, 15, false)).toBe('$3/$15');
	});

	it('formats mixed integer/decimal pricing', () => {
		expect(formatPriceBadge(2.5, 15, false)).toBe('$2.5/$15');
	});
});
