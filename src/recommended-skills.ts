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
		packageSource: "git:https://github.com/badlogic/pi-skills",
		sourceKind: "git",
		publisher: "first-party",
		openUrl: "https://github.com/badlogic/pi-skills/tree/main/brave-search",
		setupHint: "Set BRAVE_API_KEY and run npm install in the skill folder before first use.",
	},
	{
		id: "browser-tools",
		name: "Browser Tools",
		skillName: "browser-tools",
		description: "Interactive browser automation via Chrome DevTools Protocol.",
		packageSource: "git:https://github.com/badlogic/pi-skills",
		sourceKind: "git",
		publisher: "first-party",
		openUrl: "https://github.com/badlogic/pi-skills/tree/main/browser-tools",
		setupHint: "Run npm install in the skill folder, then start Chrome with remote debugging when needed.",
	},
	{
		id: "youtube-transcript",
		name: "YouTube Transcript",
		skillName: "youtube-transcript",
		description: "Fetch transcripts from YouTube videos for summarization and analysis.",
		packageSource: "git:https://github.com/badlogic/pi-skills",
		sourceKind: "git",
		publisher: "first-party",
		openUrl: "https://github.com/badlogic/pi-skills/tree/main/youtube-transcript",
		setupHint: "Run npm install in the skill folder; video captions/transcript must be available.",
	},
];
