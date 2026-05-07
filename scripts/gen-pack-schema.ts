import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toJsonSchema } from 'zod/v4/core';
import { packManifestSchema } from '../src/schemas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '..', 'src', 'pack-schema.json');

const jsonSchema = toJsonSchema(packManifestSchema, {
	unrepresentable: 'any',
});

const output = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	title: 'Working Mind Pack Manifest',
	description: 'Declarative pack format for Working Mind — zero code, configuration + instructions only',
	...jsonSchema,
};

writeFileSync(outPath, JSON.stringify(output, null, '\t') + '\n');
console.log(`Generated ${outPath}`);
