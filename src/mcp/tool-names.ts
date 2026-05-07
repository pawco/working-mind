export const MCP_TOOL_NAMES: Record<string, Record<string, string>> = {
	'brave-search': {
		brave_web_search: 'mcp__brave-search__brave_web_search',
		brave_local_search: 'mcp__brave-search__brave_local_search',
		brave_image_search: 'mcp__brave-search__brave_image_search',
		brave_news_search: 'mcp__brave-search__brave_news_search',
		brave_video_search: 'mcp__brave-search__brave_video_search',
		brave_summarizer: 'mcp__brave-search__brave_summarizer',
	},
	firecrawl: {
		firecrawl_scrape: 'mcp__firecrawl__firecrawl_scrape',
		firecrawl_search: 'mcp__firecrawl__firecrawl_search',
		firecrawl_map: 'mcp__firecrawl__firecrawl_map',
		firecrawl_crawl: 'mcp__firecrawl__firecrawl_crawl',
		firecrawl_check_crawl_status: 'mcp__firecrawl__firecrawl_check_crawl_status',
		firecrawl_extract: 'mcp__firecrawl__firecrawl_extract',
	},
	arxiv: {
		search_papers: 'mcp__arxiv__search_papers',
	},
	filesystem: {
		read_file: 'mcp__filesystem__read_file',
		read_multiple_files: 'mcp__filesystem__read_multiple_files',
		write_file: 'mcp__filesystem__write_file',
		edit_file: 'mcp__filesystem__edit_file',
		create_directory: 'mcp__filesystem__create_directory',
		list_directory: 'mcp__filesystem__list_directory',
		list_directory_with_details: 'mcp__filesystem__list_directory_with_details',
		directory_tree: 'mcp__filesystem__directory_tree',
		move_file: 'mcp__filesystem__move_file',
		search_files: 'mcp__filesystem__search_files',
		get_file_info: 'mcp__filesystem__get_file_info',
		list_allowed_directories: 'mcp__filesystem__list_allowed_directories',
	},
	memory: {
		create_entities: 'mcp__memory__create_entities',
		create_relations: 'mcp__memory__create_relations',
		add_observations: 'mcp__memory__add_observations',
		delete_entities: 'mcp__memory__delete_entities',
		delete_observations: 'mcp__memory__delete_observations',
		delete_relations: 'mcp__memory__delete_relations',
		read_graph: 'mcp__memory__read_graph',
		search_nodes: 'mcp__memory__search_nodes',
		open_nodes: 'mcp__memory__open_nodes',
	},
	'sequential-thinking': {
		sequentialthinking: 'mcp__sequential-thinking__sequentialthinking',
	},
	github: {
		search_issues: 'mcp__github__search_issues',
		search_repositories: 'mcp__github__search_repositories',
		get_file_contents: 'mcp__github__get_file_contents',
		create_issue: 'mcp__github__create_issue',
		create_pull_request: 'mcp__github__create_pull_request',
		list_commits: 'mcp__github__list_commits',
	},
	devtools: {
		run: 'mcp__devtools__run',
		search: 'mcp__devtools__search',
	},
};

export function getNamespacedToolName(serverKey: string, toolName: string): string {
	return MCP_TOOL_NAMES[serverKey]?.[toolName] ?? `mcp__${serverKey}__${toolName}`;
}

export function validateToolReference(
	toolRef: string,
	connectedTools: string[],
): { valid: boolean; suggestion?: string } {
	if (connectedTools.includes(toolRef)) return { valid: true };

	if (toolRef.startsWith('mcp__') && toolRef.endsWith('*')) {
		const prefix = toolRef.slice(0, -1);
		const hasMatch = connectedTools.some((t) => t.startsWith(prefix));
		return {
			valid: hasMatch,
			suggestion: hasMatch ? undefined : 'no matching tools for wildcard',
		};
	}

	const parts = toolRef.split('__');
	if (parts.length !== 3 || parts[0] !== 'mcp') return { valid: false };

	const serverKey = parts[1];
	const bareToolName = parts[2];
	const knownServer = MCP_TOOL_NAMES[serverKey];
	if (!knownServer) return { valid: false };

	for (const [actualTool, namespaced] of Object.entries(knownServer)) {
		if (actualTool === bareToolName && namespaced === toolRef) {
			return { valid: false, suggestion: namespaced };
		}
	}

	for (const [actualTool, namespaced] of Object.entries(knownServer)) {
		if (
			bareToolName !== actualTool &&
			(bareToolName.includes(actualTool) || actualTool.includes(bareToolName))
		) {
			return { valid: false, suggestion: namespaced };
		}
	}

	return { valid: false };
}
