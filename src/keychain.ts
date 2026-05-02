export async function storeKey(
	providerId: string,
	key: string,
): Promise<boolean> {
	try {
		const keytar = await import('keytar' as string);
		await keytar.setPassword('openexplorer', providerId, key);
		return true;
	} catch {
		return false;
	}
}

export async function retrieveKey(providerId: string): Promise<string | null> {
	try {
		const keytar = await import('keytar' as string);
		return await keytar.getPassword('openexplorer', providerId);
	} catch {
		return null;
	}
}

export async function deleteKey(providerId: string): Promise<boolean> {
	try {
		const keytar = await import('keytar' as string);
		return await keytar.deletePassword('openexplorer', providerId);
	} catch {
		return false;
	}
}

export function envVarSuggestion(providerId: string): string {
	const key = `${providerId.toUpperCase()}_API_KEY`;
	return `export ${key}=your-key-here`;
}
