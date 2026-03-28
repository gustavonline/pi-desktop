export type DesktopThemeMode = "dark" | "light" | "system";
export type DesktopThemeResolved = "dark" | "light";

export const DESKTOP_THEME_STORAGE_KEY = "pi-theme";
export const DESKTOP_THEME_CHANGED_EVENT = "pi-desktop:theme-changed";

let systemThemeListenerAttached = false;

function resolveSystemTheme(): DesktopThemeResolved {
	try {
		return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
	} catch {
		return "dark";
	}
}

function normalizeThemeMode(input: string | null | undefined): DesktopThemeMode {
	if (input === "light" || input === "dark" || input === "system") return input;
	return "dark";
}

function resolveThemeMode(mode: DesktopThemeMode): DesktopThemeResolved {
	return mode === "system" ? resolveSystemTheme() : mode;
}

export function getResolvedDesktopTheme(): DesktopThemeResolved {
	return document.documentElement.classList.contains("light") ? "light" : "dark";
}

function emitThemeChange(mode: DesktopThemeMode, resolved: DesktopThemeResolved): void {
	window.dispatchEvent(new CustomEvent(DESKTOP_THEME_CHANGED_EVENT, { detail: { mode, resolved } }));
}

function applyResolvedTheme(mode: DesktopThemeMode, resolved: DesktopThemeResolved, persist: boolean): DesktopThemeMode {
	const root = document.documentElement;
	const prevResolved = getResolvedDesktopTheme();
	const prevMode = normalizeThemeMode(root.dataset.themeMode);

	root.classList.remove("dark", "light");
	root.classList.add(resolved);
	root.dataset.theme = resolved;
	root.dataset.themeMode = mode;

	if (persist) {
		try {
			localStorage.setItem(DESKTOP_THEME_STORAGE_KEY, mode);
		} catch {
			// ignore
		}
	}

	if (prevResolved !== resolved || prevMode !== mode) {
		emitThemeChange(mode, resolved);
	}

	return mode;
}

function attachSystemThemeListener(): void {
	if (systemThemeListenerAttached) return;
	systemThemeListenerAttached = true;

	try {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const handleChange = () => {
			const mode = readStoredDesktopTheme();
			if (mode !== "system") return;
			const resolved = resolveThemeMode(mode);
			applyResolvedTheme(mode, resolved, false);
		};

		if (typeof media.addEventListener === "function") {
			media.addEventListener("change", handleChange);
		} else if (typeof media.addListener === "function") {
			media.addListener(handleChange);
		}
	} catch {
		// ignore
	}
}

export function readStoredDesktopTheme(): DesktopThemeMode {
	try {
		return normalizeThemeMode(localStorage.getItem(DESKTOP_THEME_STORAGE_KEY));
	} catch {
		return "dark";
	}
}

export function applyDesktopTheme(theme: DesktopThemeMode, options?: { persist?: boolean }): DesktopThemeMode {
	attachSystemThemeListener();
	const mode = normalizeThemeMode(theme);
	const resolved = resolveThemeMode(mode);
	return applyResolvedTheme(mode, resolved, options?.persist ?? true);
}

export function initializeDesktopTheme(): DesktopThemeMode {
	attachSystemThemeListener();
	const theme = readStoredDesktopTheme();
	return applyDesktopTheme(theme, { persist: false });
}

export function toggleDesktopTheme(): DesktopThemeMode {
	const current = readStoredDesktopTheme();
	const next: DesktopThemeMode = current === "dark" ? "light" : "dark";
	return applyDesktopTheme(next, { persist: true });
}
