export interface KnownServer {
	id: string;
	name: string;
	description: string;
	package?: string;
	command?: string[];
	envVars: { name: string; label: string; required: boolean }[];
}

export const KNOWN_SERVERS: KnownServer[] = [
	{
		id: 'brave-search',
		name: 'Brave Search',
		description: 'Web, image, video, news search',
		package: '@brave/brave-search-mcp-server',
		envVars: [
			{ name: 'BRAVE_API_KEY', label: 'Brave API Key', required: true },
		],
	},
	{
		id: 'firecrawl',
		name: 'Firecrawl',
		description: 'Web scraping, crawling & extraction',
		package: 'firecrawl-mcp',
		envVars: [
			{ name: 'FIRECRAWL_API_KEY', label: 'Firecrawl API Key', required: true },
		],
	},
	{
		id: 'arxiv',
		name: 'arXiv',
		description: 'Search & read academic papers',
		package: 'arxiv-mcp-server',
		envVars: [],
	},
	{
		id: 'github',
		name: 'GitHub',
		description: 'Repos, issues, PRs (Docker)',
		command: [
			'docker',
			'run',
			'-i',
			'--rm',
			'-e',
			'GITHUB_PERSONAL_ACCESS_TOKEN',
			'ghcr.io/github/github-mcp-server',
		],
		envVars: [
			{
				name: 'GITHUB_PERSONAL_ACCESS_TOKEN',
				label: 'GitHub PAT',
				required: true,
			},
		],
	},
	{
		id: 'github-npm',
		name: 'GitHub (npm)',
		description: 'Repos, issues, PRs (no Docker)',
		package: '@modelcontextprotocol/server-github',
		envVars: [
			{
				name: 'GITHUB_PERSONAL_ACCESS_TOKEN',
				label: 'GitHub PAT',
				required: true,
			},
		],
	},
	{
		id: 'filesystem',
		name: 'Filesystem',
		description: 'Read/write local files',
		package: '@modelcontextprotocol/server-filesystem',
		envVars: [],
	},
	{
		id: 'postgres',
		name: 'PostgreSQL',
		description: 'Query databases',
		package: '@modelcontextprotocol/server-postgres',
		envVars: [
			{
				name: 'POSTGRES_CONNECTION_STRING',
				label: 'Connection String',
				required: true,
			},
		],
	},
	{
		id: 'sqlite',
		name: 'SQLite',
		description: 'Read/write SQLite',
		package: '@modelcontextprotocol/server-sqlite',
		envVars: [],
	},
	{
		id: 'google-maps',
		name: 'Google Maps',
		description: 'Geocoding & directions',
		package: '@modelcontextprotocol/server-google-maps',
		envVars: [
			{ name: 'GOOGLE_MAPS_API_KEY', label: 'Maps API Key', required: true },
		],
	},
	{
		id: 'puppeteer',
		name: 'Puppeteer',
		description: 'Browser automation',
		package: '@modelcontextprotocol/server-puppeteer',
		envVars: [],
	},
	{
		id: 'memory',
		name: 'Memory',
		description: 'Persistent knowledge graph',
		package: '@modelcontextprotocol/server-memory',
		envVars: [],
	},
	{
		id: 'sequential-thinking',
		name: 'Sequential Thinking',
		description: 'Step-by-step reasoning',
		package: '@modelcontextprotocol/server-sequential-thinking',
		envVars: [],
	},
	{
		id: 'context7',
		name: 'Context7',
		description: 'Library docs & code examples',
		package: '@upstash/context7-mcp',
		envVars: [],
	},
	{
		id: 'slack',
		name: 'Slack',
		description: 'Messaging & channels',
		package: '@modelcontextprotocol/server-slack',
		envVars: [
			{ name: 'SLACK_BOT_TOKEN', label: 'Slack Bot Token', required: true },
		],
	},
];
