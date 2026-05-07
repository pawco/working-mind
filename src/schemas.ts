import { z } from 'zod';

const packNameRegex = /^[a-z][a-z0-9-]{2,29}$/;
const semverRegex = /^\d+\.\d+\.\d+/;

const toolFilterSchema = z.object({
	preset: z.enum(['all', 'readonly', 'none']).optional(),
	include: z.array(z.string()).optional(),
	exclude: z.array(z.string()).optional(),
});

const personaDefSchema = z.object({
	prompt: z.string({ error: 'Persona must reference a prompt file' }),
	toolFilter: toolFilterSchema.optional(),
});

const mcpEnvDefSchema = z.object({
	setting: z.string(),
	sensitive: z.boolean().optional(),
	required: z
		.boolean()
		.refine((v) => v !== true, {
			error:
				'All MCP env settings must be optional (required: false or omitted)',
		})
		.optional(),
	label: z.string().optional(),
	hint: z.string().optional(),
});

const mcpServerManifestSchema = z.object({
	package: z.string().optional(),
	command: z.array(z.string()).optional(),
	required: z
		.boolean()
		.refine((v) => v !== true, {
			error: 'All MCP servers must be optional (required: false or omitted)',
		})
		.optional(),
	capability: z.string().optional(),
	pathPrompt: z.string().optional(),
	env: z.record(z.string(), mcpEnvDefSchema).optional(),
});

const packSettingSchema = z.object({
	name: z.string(),
	description: z.string(),
	envVar: z.string(),
	sensitive: z.boolean().optional(),
	required: z
		.boolean()
		.refine((v) => v !== true, {
			error: 'All pack settings must be optional',
		})
		.optional(),
});

const curationDefSchema = z.object({
	summarize: z.string().optional(),
	export: z.string().optional(),
});

export const packManifestSchema = z
	.object({
		name: z.string().regex(packNameRegex, {
			error:
				'Pack name must be lowercase, start with a letter, 3-30 chars, hyphens allowed',
		}),
		version: z.string().regex(semverRegex, {
			error: 'Version must be semver (e.g. 1.0.0)',
		}),
		description: z.string().min(1).max(200),
		prompt: z.string({ error: 'pack.json requires a "prompt" field' }),
		author: z.string().optional(),
		license: z.string().optional(),
		private: z.boolean().optional(),
		wmindMinVersion: z.string().optional(),
		personas: z.record(z.string(), personaDefSchema).optional(),
		commands: z.record(z.string(), z.string()).optional(),
		mcpServers: z.record(z.string(), mcpServerManifestSchema).optional(),
		settings: z.array(packSettingSchema).optional(),
		curation: curationDefSchema.optional(),
	})
	.strict();

export type PackManifest = z.infer<typeof packManifestSchema>;
export type CurationDef = z.infer<typeof curationDefSchema>;
export type PersonaDef = z.infer<typeof personaDefSchema>;
export type ToolFilter = z.infer<typeof toolFilterSchema>;

const permissionLevelSchema = z.enum(['allow', 'deny', 'ask']);

const userProviderConfigSchema = z.object({
	apiKey: z.string().optional(),
	baseUrl: z.string().optional(),
});

const customModelSchema = z.object({
	id: z.string(),
	displayName: z.string().optional(),
	contextWindow: z.number().positive().optional(),
});

const customProviderEntrySchema = z.object({
	displayName: z.string({ error: 'Custom provider requires displayName' }),
	baseUrl: z.string({ error: 'Custom provider requires baseUrl' }),
	apiFormat: z.enum(['openai', 'anthropic'], {
		error: 'apiFormat must be "openai" or "anthropic"',
	}),
	envVar: z.string().optional(),
	models: z.array(customModelSchema).optional(),
});

const mcpEnvVarDefSchema = z.object({
	name: z.string(),
	label: z.string(),
	required: z.boolean(),
	sensitive: z.boolean().optional(),
	hint: z.string().optional(),
});

const mcpServerConfigSchema = z.object({
	type: z.enum(['local', 'remote']),
	url: z.string().optional(),
	command: z.array(z.string()).optional(),
	env: z.record(z.string(), z.string()).optional(),
	headers: z.record(z.string(), z.string()).optional(),
	enabled: z.boolean().optional(),
	requiredEnvVars: z.array(mcpEnvVarDefSchema).optional(),
	packDir: z.string().optional(),
	pathPrompt: z.string().optional(),
});

const userConfigSchema = z.object({
	defaultModel: z.string().optional(),
	providers: z.record(z.string(), userProviderConfigSchema).optional(),
	systemPrompts: z.record(z.string(), z.string()).optional(),
	agents: z
		.object({
			maxTurns: z.number().int().positive().optional(),
			autoApprove: z.boolean().optional(),
			noThinking: z.boolean().optional(),
			maxTokens: z.number().int().positive().optional(),
			thinkingBudget: z.number().int().positive().optional(),
			permissions: z
				.object({
					destructive: permissionLevelSchema.optional(),
					longRunning: permissionLevelSchema.optional(),
					normal: permissionLevelSchema.optional(),
				})
				.optional(),
		})
		.optional(),
	customProviders: z.record(z.string(), customProviderEntrySchema).optional(),
	mcpServers: z.record(z.string(), mcpServerConfigSchema).optional(),
	lastMemoryStore: z.string().optional(),
});

export const partialUserConfigSchema = userConfigSchema.partial();
export type UserConfig = z.infer<typeof userConfigSchema>;
export type UserProviderConfig = z.infer<typeof userProviderConfigSchema>;
export type CustomProviderEntry = z.infer<typeof customProviderEntrySchema>;
export type McpEnvVarDef = z.infer<typeof mcpEnvVarDefSchema>;
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;

const modelEntrySchema = z.object({
	id: z.string(),
	displayName: z.string(),
	contextWindow: z.number().positive(),
	inputPricePer1M: z.number().nonnegative(),
	outputPricePer1M: z.number().nonnegative(),
	supportsReasoning: z.boolean(),
	supportsToolCalling: z.boolean(),
	aliases: z.array(z.string()).optional(),
});

const providerEntrySchema = z.object({
	id: z.string(),
	displayName: z.string(),
	baseUrl: z.string(),
	apiFormat: z.enum(['openai', 'anthropic', 'ollama']),
	envVar: z.string(),
	envVarAliases: z.array(z.string()).optional(),
	models: z.array(modelEntrySchema),
	free: z.union([z.boolean(), z.string()]).optional(),
	website: z.string(),
	needsApiKey: z.boolean(),
	canValidate: z.boolean(),
	modelIdFormat: z.enum(['full', 'provider-prefix']),
	modelPrefixes: z.array(z.string()),
	localProvider: z
		.object({
			probeUrl: z.string(),
			preferredModels: z.array(z.string()),
		})
		.optional(),
	isPrimary: z.boolean(),
	authStyle: z.enum(['bearer', 'x-api-key', 'none']),
});

const providersDataSchema = z.object({
	providers: z.array(providerEntrySchema),
	tierAliases: z.record(z.string(), z.string()),
	modelAliases: z.record(z.string(), z.string()),
});

export const partialProvidersDataSchema = providersDataSchema.partial();
export type ProviderEntry = z.infer<typeof providerEntrySchema>;
export type ModelEntry = z.infer<typeof modelEntrySchema>;
export type ProvidersData = z.infer<typeof providersDataSchema>;

const sessionDataSchema = z.object({
	sessionId: z.string(),
	name: z.string(),
	persona: z.string(),
	model: z.string(),
	activeSkills: z.array(z.string()),
	messages: z.array(z.any()),
	createdAt: z.string(),
	updatedAt: z.string(),
	packName: z.string().optional(),
	packSystemPrompt: z.string().optional(),
});

export type SessionData = z.infer<typeof sessionDataSchema>;

const mcpProjectConfigSchema = z
	.object({
		mcpServers: z.record(z.string(), mcpServerConfigSchema),
	})
	.passthrough();

export function parseMcpProjectConfig(
	raw: unknown,
): Record<string, McpServerConfig> {
	const result = mcpProjectConfigSchema.safeParse(raw);
	if (!result.success) return {};
	return result.data.mcpServers;
}

const memoryEntitySchema = z.object({
	name: z.string(),
	entityType: z.string(),
	observations: z.array(z.string()),
});

const memoryRelationSchema = z.object({
	from: z.string(),
	to: z.string(),
	relationType: z.string(),
});

const memoryGraphSchema = z.object({
	entities: z.array(memoryEntitySchema),
	relations: z.array(memoryRelationSchema),
});

export type MemoryGraph = z.infer<typeof memoryGraphSchema>;
export type MemoryEntity = z.infer<typeof memoryEntitySchema>;
export type MemoryRelation = z.infer<typeof memoryRelationSchema>;

export function parseMemoryGraph(raw: unknown): MemoryGraph {
	if (typeof raw === 'string') {
		return memoryGraphSchema.parse(JSON.parse(raw));
	}
	return memoryGraphSchema.parse(raw);
}

export function safeParseMemoryGraph(raw: unknown): MemoryGraph | null {
	try {
		return parseMemoryGraph(raw);
	} catch {
		return null;
	}
}

export {
	mcpServerConfigSchema,
	memoryGraphSchema,
	modelEntrySchema,
	permissionLevelSchema,
	providerEntrySchema,
	providersDataSchema,
	sessionDataSchema,
};

export function formatZodError(context: string, error: z.ZodError): string {
	const issues = error.issues
		.map((i) => `  ${i.path.join('.')}: ${i.message}`)
		.join('\n');
	return `${context}:\n${issues}`;
}

const schemaCache = new WeakMap<Record<string, any>, z.ZodTypeAny>();

export function jsonSchemaToZod(schema: Record<string, any>): z.ZodTypeAny {
	const cached = schemaCache.get(schema);
	if (cached) return cached;

	let result: z.ZodTypeAny;

	if (!schema || schema.type !== 'object') {
		result = z.record(z.string(), z.any());
	} else {
		const shape: Record<string, z.ZodTypeAny> = {};
		const required = new Set(schema.required || []);
		for (const [key, prop] of Object.entries(schema.properties || {})) {
			const p = prop as Record<string, any>;
			let field: z.ZodTypeAny;
			switch (p.type) {
				case 'string':
					field = z.string();
					break;
				case 'number':
				case 'integer':
					field = z.number();
					break;
				case 'boolean':
					field = z.boolean();
					break;
				case 'array':
					field = z.array(z.any());
					break;
				case 'object':
					field = z.record(z.string(), z.any());
					break;
				default:
					field = z.any();
			}
			if (!required.has(key)) field = field.optional();
			shape[key] = field;
		}
		result = z.object(shape).passthrough();
	}

	schemaCache.set(schema, result);
	return result;
}
