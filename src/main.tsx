import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { bootstrapDesktop } from "./bootstrap.js";
import "./styles/app.css";

function DesktopHost() {
	const hostRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!hostRef.current) return;
		bootstrapDesktop(hostRef.current);
	}, []);

	return <div id="legacy-app-host" className="h-full w-full" ref={hostRef} />;
}

const rootEl = document.getElementById("app");
if (!rootEl) {
	throw new Error("Missing #app root element");
}

const root = createRoot(rootEl);
root.render(<DesktopHost />);
