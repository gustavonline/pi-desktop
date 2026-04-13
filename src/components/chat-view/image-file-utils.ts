export function isImageName(name: string): boolean {
	return /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i.test(name.toLowerCase());
}

export function mimeFromFileName(name: string): string {
	const lower = name.toLowerCase();
	if (lower.endsWith(".png")) return "image/png";
	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
	if (lower.endsWith(".gif")) return "image/gif";
	if (lower.endsWith(".webp")) return "image/webp";
	if (lower.endsWith(".bmp")) return "image/bmp";
	if (lower.endsWith(".svg")) return "image/svg+xml";
	if (lower.endsWith(".avif")) return "image/avif";
	if (lower.endsWith(".heic")) return "image/heic";
	if (lower.endsWith(".heif")) return "image/heif";
	return "image/png";
}

export function toBase64Bytes(bytes: Uint8Array): string {
	let binary = "";
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.subarray(i, i + chunkSize);
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary);
}

export function isImageFile(file: File): boolean {
	if (file.type.startsWith("image/")) return true;
	return isImageName(file.name || "");
}

export function fileNameFromPath(path: string): string {
	const normalized = path.replace(/\\/g, "/").trim();
	const parts = normalized.split("/");
	return parts[parts.length - 1] || normalized;
}

export function createDropSignature(names: string[]): string {
	return names
		.map((name) => name.trim().toLowerCase())
		.filter(Boolean)
		.sort()
		.join("|");
}

export function extractFilePathsFromDropPayload(raw: string): string[] {
	const lines = raw
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"));
	const paths: string[] = [];
	for (const line of lines) {
		if (line.startsWith("file://")) {
			try {
				const url = new URL(line);
				let path = decodeURIComponent(url.pathname || "");
				if (/^\/[A-Za-z]:\//.test(path)) {
					path = path.slice(1);
				}
				if (path) paths.push(path);
				continue;
			} catch {
				// ignore invalid url
			}
		}
		if (line.startsWith("/") || /^[A-Za-z]:[\\/]/.test(line)) {
			paths.push(line);
		}
	}
	return paths;
}
