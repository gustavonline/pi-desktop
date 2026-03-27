export interface RecommendedSkillDefinition {
	id: string;
	name: string;
	skillName: string;
	description: string;
	packageSource: string;
	sourceKind: "npm" | "git" | "url" | "local";
	publisher: "first-party" | "community";
	openUrl?: string;
	setupHint?: string;
}

export const RECOMMENDED_SKILLS: RecommendedSkillDefinition[] = [
	{
		id: "creatorskill",
		name: "Creator Skill",
		skillName: "creatorskill",
		description: "Create or update prompt templates and Agent skills from a short user brief. Stages commands in chat; nothing runs automatically.",
		packageSource: "local:creatorskill",
		sourceKind: "local",
		publisher: "first-party",
	},
	{
		id: "brave-search",
		name: "Brave Search",
		skillName: "brave-search",
		description: "Web search and content extraction via Brave Search API.",
		packageSource: "npm:pi-skills",
		sourceKind: "npm",
		publisher: "first-party",
		openUrl: "https://github.com/badlogic/pi-skills/tree/main/skills/brave-search",
		setupHint: "Requires a Brave Search API key.",
	},
	{
		id: "browser-tools",
		name: "Browser Tools",
		skillName: "browser-tools",
		description: "Interactive browser automation via Chrome DevTools Protocol.",
		packageSource: "npm:pi-skills",
		sourceKind: "npm",
		publisher: "first-party",
		openUrl: "https://github.com/badlogic/pi-skills/tree/main/skills/browser-tools",
	},
	{
		id: "youtube-transcript",
		name: "YouTube Transcript",
		skillName: "youtube-transcript",
		description: "Fetch transcripts from YouTube videos for summarization and analysis.",
		packageSource: "npm:pi-skills",
		sourceKind: "npm",
		publisher: "first-party",
		openUrl: "https://github.com/badlogic/pi-skills/tree/main/skills/youtube-transcript",
	},
];
