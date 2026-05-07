import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSkillFiles } from './skill-loader.js';

const TMP = join(tmpdir(), `oe-skill-test-${Date.now()}`);

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe('loadSkillFiles', () => {
	it('returns empty array when no skill directories exist', () => {
		const skills = loadSkillFiles([TMP]);
		expect(skills).toEqual([]);
	});

	it('loads a SKILL.md with frontmatter', () => {
		const skillDir = join(TMP, 'deploy');
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, 'SKILL.md'),
			`---
name: deploy
description: Deploy to cloud
allowedTools:
  - bash
  - write
---

# Deploy Skill

Deploy the application to the cloud provider.`,
		);

		const skills = loadSkillFiles([TMP]);
		expect(skills).toHaveLength(1);
		expect(skills[0].name).toBe('deploy');
		expect(skills[0].description).toBe('Deploy to cloud');
		expect(skills[0].allowedTools).toEqual(['bash', 'write']);
		expect(skills[0].instructions).toContain('Deploy the application');
	});

	it('loads a SKILL.md without frontmatter using directory name', () => {
		const skillDir = join(TMP, 'review');
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(join(skillDir, 'SKILL.md'), 'Review code for quality and bugs.');

		const skills = loadSkillFiles([TMP]);
		expect(skills).toHaveLength(1);
		expect(skills[0].name).toBe('review');
		expect(skills[0].instructions).toBe('Review code for quality and bugs.');
	});

	it('loads multiple skills', () => {
		for (const name of ['deploy', 'debug', 'test']) {
			const dir = join(TMP, name);
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, 'SKILL.md'),
				`---\nname: ${name}\ndescription: ${name} skill\n---\n${name} instructions`,
			);
		}

		const skills = loadSkillFiles([TMP]);
		expect(skills).toHaveLength(3);
		expect(skills.map((s) => s.name).sort()).toEqual(['debug', 'deploy', 'test']);
	});

	it('handles autoDiscover frontmatter field', () => {
		const skillDir = join(TMP, 'auto');
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, 'SKILL.md'),
			`---\nname: auto\ndescription: auto skill\nautoDiscover: false\n---\nInstructions`,
		);

		const skills = loadSkillFiles([TMP]);
		expect(skills[0].autoDiscover).toBe(false);
	});
});
