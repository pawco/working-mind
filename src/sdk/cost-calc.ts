import type { ModelEntry } from './provider-registry.js';

export interface TurnCost {
	promptTokens: number;
	completionTokens: number;
	inputCost: number;
	outputCost: number;
	totalCost: number;
}

export interface ResponseCost {
	turns: TurnCost[];
	totalPromptTokens: number;
	totalCompletionTokens: number;
	totalCost: number;
}

export function calculateTurnCost(
	model: ModelEntry | undefined,
	promptTokens: number,
	completionTokens: number,
): TurnCost {
	const inputPrice = model?.inputPricePer1M ?? 0;
	const outputPrice = model?.outputPricePer1M ?? 0;
	const inputCost = (promptTokens / 1_000_000) * inputPrice;
	const outputCost = (completionTokens / 1_000_000) * outputPrice;
	return {
		promptTokens,
		completionTokens,
		inputCost,
		outputCost,
		totalCost: inputCost + outputCost,
	};
}

export function calculateResponseCost(turns: TurnCost[]): ResponseCost {
	const totalPromptTokens = turns.reduce((s, t) => s + t.promptTokens, 0);
	const totalCompletionTokens = turns.reduce(
		(s, t) => s + t.completionTokens,
		0,
	);
	const totalCost = turns.reduce((s, t) => s + t.totalCost, 0);
	return { turns, totalPromptTokens, totalCompletionTokens, totalCost };
}

export function formatCost(cost: number): string {
	if (cost === 0) return '$0';
	if (cost < 0.001) return '<$0.001';
	if (cost < 0.01) return `$${cost.toFixed(4)}`;
	if (cost < 1) return `$${cost.toFixed(3)}`;
	return `$${cost.toFixed(2)}`;
}

export function formatPriceBadge(
	inputPricePer1M: number,
	outputPricePer1M: number,
	isLocal?: boolean,
): string {
	if (isLocal) return '[local]';
	if (inputPricePer1M === 0 && outputPricePer1M === 0) return '[free]';
	const fmtIn =
		inputPricePer1M < 1
			? inputPricePer1M.toFixed(2)
			: Number.isInteger(inputPricePer1M)
				? String(inputPricePer1M)
				: inputPricePer1M.toFixed(1);
	const fmtOut =
		outputPricePer1M < 1
			? outputPricePer1M.toFixed(2)
			: Number.isInteger(outputPricePer1M)
				? String(outputPricePer1M)
				: outputPricePer1M.toFixed(1);
	return `$${fmtIn}/$${fmtOut}`;
}
