import type { ModelPickerProviderGroup } from "./model-picker-provider-groups.js";

export interface ModelPickerProviderAuthActionState {
	action: "login" | "logout";
	label: "Login" | "Logout" | "Env";
	title: string;
	disabled: boolean;
	isBusy: boolean;
}

interface ResolveModelPickerProviderAuthActionStateParams {
	group: ModelPickerProviderGroup;
	authKey: string;
	runningProviderAuthActionKey: string | null;
	interactionLocked: boolean;
	settingModel: boolean;
}

export function resolveModelPickerProviderAuthActionState({
	group,
	authKey,
	runningProviderAuthActionKey,
	interactionLocked,
	settingModel,
}: ResolveModelPickerProviderAuthActionStateParams): ModelPickerProviderAuthActionState {
	const isBusy = runningProviderAuthActionKey === authKey;
	const canLogout = group.authConfigured && group.authSource !== "environment";
	const action: "login" | "logout" = canLogout ? "logout" : "login";
	const label: "Login" | "Logout" | "Env" = group.authConfigured
		? group.authSource === "environment"
			? "Env"
			: "Logout"
		: "Login";
	const disabled = interactionLocked || settingModel || isBusy || (group.authConfigured && group.authSource === "environment");
	const title = group.authConfigured
		? group.authSource === "environment"
			? "Configured from environment variable"
			: `Logout from ${group.providerLabel}`
		: group.isDefaultOAuthProvider
			? `Open terminal login for ${group.providerLabel} (starts /login automatically)`
			: `Set up ${group.providerLabel}`;
	return {
		action,
		label,
		title,
		disabled,
		isBusy,
	};
}

export function resolveModelPickerAuthHint(
	group: Pick<ModelPickerProviderGroup, "authConfigured" | "isDefaultOAuthProvider">,
	hasModels: boolean,
): string {
	if (group.authConfigured) {
		if (hasModels) return "";
		return group.isDefaultOAuthProvider
			? "Connected, but no models are available right now. Try /reload after login changes."
			: "Connected, but no models are loaded for this provider. Install/enable its package in Packages, then run /reload.";
	}
	return group.isDefaultOAuthProvider
		? "Not connected yet. Click Login to open terminal and start /login automatically."
		: "Not connected yet. Use Login to set up this provider.";
}
