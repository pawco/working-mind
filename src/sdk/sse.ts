export async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<any> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const messages = buffer.split('\n\n');
			buffer = messages.pop() ?? '';
			for (const msg of messages) {
				for (const line of msg.split('\n')) {
					if (!line.startsWith('data: ')) continue;
					const data = line.slice(6);
					if (data === '[DONE]') return;
					try {
						yield JSON.parse(data);
					} catch {
						/* skip non-JSON */
					}
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}
