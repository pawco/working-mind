export type ProviderErrorCategory =
	| 'rate_limit'
	| 'auth'
	| 'context_length'
	| 'overloaded'
	| 'server_error'
	| 'connection'
	| 'not_found'
	| 'no_api_key'
	| 'unknown';

export interface ClassifiedError {
	category: ProviderErrorCategory;
	statusCode: number | null;
	providerMessage: string;
	suggestion: string;
	canRetry: boolean;
}

function tryParseJson(text: string): any {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function _extractAnthropicMessage(status: number, body: string): string {
	const parsed = tryParseJson(body);
	if (parsed?.error?.message) return parsed.error.message;
	if (parsed?.error?.type) return `${parsed.error.type} (HTTP ${status})`;
	return `HTTP ${status}: ${body.slice(0, 200)}`;
}

function _extractOllamaMessage(status: number, body: string): string {
	const parsed = tryParseJson(body);
	if (parsed?.error) return parsed.error;
	return `HTTP ${status}: ${body.slice(0, 200)}`;
}

export function classifyProviderError(err: any): ClassifiedError {
	const msg = err?.message || String(err);
	const status = err?.status ?? err?.statusCode ?? err?.response?.status ?? null;
	const errName = err?.constructor?.name ?? '';
	const errCode = err?.code ?? err?.error?.code ?? null;
	const errType = err?.errorType ?? err?.error?.type ?? err?.type ?? null;
	const msgLower = msg.toLowerCase();

	if (
		msgLower.includes('no api key configured') ||
		msgLower.includes('api key is required but not configured')
	) {
		return {
			category: 'no_api_key',
			statusCode: null,
			providerMessage: msg,
			suggestion: 'Run /connect to configure an API key.',
			canRetry: false,
		};
	}

	if (
		status === 429 ||
		errName === 'RateLimitError' ||
		errCode === 'rate_limit' ||
		errType === 'rate_limit_error'
	) {
		return {
			category: 'rate_limit',
			statusCode: 429,
			providerMessage: msg,
			suggestion: 'Wait a moment and retry. Rate limits reset automatically.',
			canRetry: true,
		};
	}

	if (
		status === 401 ||
		errName === 'AuthenticationError' ||
		errCode === 'invalid_api_key' ||
		errType === 'authentication_error'
	) {
		return {
			category: 'auth',
			statusCode: 401,
			providerMessage: msg,
			suggestion: 'API key is invalid or expired. Run /connect to update it.',
			canRetry: false,
		};
	}

	if (status === 403 || errName === 'PermissionDeniedError' || errType === 'permission_error') {
		return {
			category: 'auth',
			statusCode: 403,
			providerMessage: msg,
			suggestion: 'API key lacks permission for this model. Check your plan or run /connect.',
			canRetry: false,
		};
	}

	if (
		errCode === 'context_length_exceeded' ||
		errType === 'max_context_window_exceeded' ||
		msgLower.includes('maximum context length') ||
		msgLower.includes('context window') ||
		msgLower.includes('too many tokens')
	) {
		return {
			category: 'context_length',
			statusCode: status ?? 400,
			providerMessage: msg,
			suggestion: 'Context is too long. Use /compact to summarize, or start a fresh session.',
			canRetry: false,
		};
	}

	if (status === 529 || errType === 'overloaded_error' || msgLower.includes('overloaded')) {
		return {
			category: 'overloaded',
			statusCode: status ?? 529,
			providerMessage: msg,
			suggestion: 'Provider is temporarily overloaded. Wait a moment and retry.',
			canRetry: true,
		};
	}

	if (status === 404 || errName === 'NotFoundError' || errType === 'not_found_error') {
		const isOllama =
			errName === 'OllamaProviderError' ||
			msgLower.includes('model') ||
			msgLower.includes('ollama');
		return {
			category: 'not_found',
			statusCode: 404,
			providerMessage: msg,
			suggestion: isOllama
				? 'Model not found. Run: ollama pull <model> to download it.'
				: 'Model not found. Use /models to check available models, or /connect to change provider.',
			canRetry: false,
		};
	}

	if (status != null && status >= 500) {
		return {
			category: 'server_error',
			statusCode: status,
			providerMessage: msg,
			suggestion: 'Provider server error. Wait and retry, or try a different model.',
			canRetry: true,
		};
	}

	if (
		msgLower.includes('connection error') ||
		msgLower.includes('econnrefused') ||
		msgLower.includes('econnreset') ||
		msgLower.includes('etimedout') ||
		msgLower.includes('fetch failed') ||
		msgLower.includes('request timed out') ||
		msgLower.includes('network')
	) {
		return {
			category: 'connection',
			statusCode: null,
			providerMessage: msg,
			suggestion: 'Network error. Check your internet connection and retry.',
			canRetry: true,
		};
	}

	if (msg.startsWith('Anthropic error')) {
		const match = msg.match(/^Anthropic error (\d+): (.+)$/);
		if (match) {
			const s = parseInt(match[1], 10);
			const body = match[2];
			const parsed = tryParseJson(body);
			const aType = parsed?.error?.type;
			const aMsg = parsed?.error?.message || body.slice(0, 200);
			const sub = classifyProviderError({
				status: s,
				message: aMsg,
				error: { type: aType, message: aMsg },
			});
			return { ...sub, statusCode: s, providerMessage: aMsg };
		}
	}

	if (msg.startsWith('Ollama error')) {
		const match = msg.match(/^Ollama error (\d+): (.+)$/);
		if (match) {
			const s = parseInt(match[1], 10);
			const body = match[2];
			const parsed = tryParseJson(body);
			const oMsg = parsed?.error || body.slice(0, 200);
			if (s === 404) {
				return {
					category: 'not_found',
					statusCode: 404,
					providerMessage: oMsg,
					suggestion: 'Model not found. Run: ollama pull <model> to download it.',
					canRetry: false,
				};
			}
			return {
				category: s >= 500 ? 'server_error' : 'unknown',
				statusCode: s,
				providerMessage: oMsg,
				suggestion:
					s >= 500
						? 'Ollama server error. Check if Ollama is running.'
						: 'Check Ollama logs for details.',
				canRetry: s >= 500,
			};
		}
	}

	return {
		category: 'unknown',
		statusCode: status,
		providerMessage: msg,
		suggestion: 'An unexpected error occurred. Check the message above for details.',
		canRetry: true,
	};
}

export function formatErrorForDisplay(classified: ClassifiedError): string {
	const parts: string[] = [];

	parts.push(classified.providerMessage);

	if (classified.statusCode) {
		const idx =
			parts[0].includes(`HTTP ${classified.statusCode}`) ||
			parts[0].includes(String(classified.statusCode))
				? -1
				: 0;
		if (idx === 0) {
			parts[0] = `[${classified.statusCode}] ${parts[0]}`;
		}
	}

	return parts.join('\n');
}

export const ERROR_CATEGORY_LABELS: Record<ProviderErrorCategory, string> = {
	rate_limit: 'rate limit',
	auth: 'auth error',
	context_length: 'context too long',
	overloaded: 'provider overloaded',
	server_error: 'server error',
	connection: 'connection error',
	not_found: 'not found',
	no_api_key: 'no api key',
	unknown: 'error',
};
