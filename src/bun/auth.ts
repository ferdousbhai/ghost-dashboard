// Browser-based OAuth login flow
// Opens browser to summonghost.com, receives token via local HTTP callback

import { setToken, getBaseUrl } from "./config";

const LOGIN_TIMEOUT = 300_000; // 5 minutes

export async function loginViaBrowser(): Promise<void> {
	const state = crypto.randomUUID();
	const baseUrl = getBaseUrl();

	// Start local HTTP server on random port
	const { resolve, reject, promise } = Promise.withResolvers<void>();
	let server: ReturnType<typeof Bun.serve> | null = null;

	const timeout = setTimeout(() => {
		server?.stop();
		reject(new Error("Login timed out after 5 minutes"));
	}, LOGIN_TIMEOUT);

	server = Bun.serve({
		port: 0, // Random available port
		async fetch(req) {
			const url = new URL(req.url);

			if (url.pathname !== "/callback") {
				return new Response("Not found", { status: 404 });
			}

			const returnedState = url.searchParams.get("state");
			const token = url.searchParams.get("token");

			if (returnedState !== state) {
				return new Response(errorPage("State mismatch — possible CSRF attack"), {
					status: 400,
					headers: { "Content-Type": "text/html" },
				});
			}

			if (!token || (!token.startsWith("sg_local_") && !token.startsWith("sg_cli_"))) {
				return new Response(errorPage("Invalid token received"), {
					status: 400,
					headers: { "Content-Type": "text/html" },
				});
			}

			setToken(token);
			clearTimeout(timeout);

			// Give the response time to send before shutting down
			setTimeout(() => {
				server?.stop();
				resolve();
			}, 500);

			return new Response(successPage(), {
				headers: { "Content-Type": "text/html" },
			});
		},
	});

	const port = server.port;
	const authUrl = `${baseUrl}/local/auth?port=${port}&state=${state}`;

	console.log(`[auth] Opening browser to ${authUrl}`);
	console.log(`[auth] Listening on http://localhost:${port}/callback`);

	// Open browser
	const openCmd =
		process.platform === "darwin"
			? "open"
			: process.platform === "win32"
				? "start"
				: "xdg-open";

	try {
		Bun.spawn([openCmd, authUrl], { stdout: "ignore", stderr: "ignore" });
	} catch {
		console.error(`[auth] Could not open browser. Visit: ${authUrl}`);
	}

	return promise;
}

function successPage(): string {
	return `<!DOCTYPE html>
<html><head><title>Ghost Dashboard</title>
<style>
body{font-family:system-ui;display:flex;align-items:center;justify-content:center;
min-height:100vh;margin:0;background:#0a0a0a;color:#fff}
.card{text-align:center;padding:3rem;border-radius:1rem;background:#111;border:1px solid #333}
h1{color:#4ade80;margin:0 0 .5rem}
p{color:#999;margin:0}
</style></head>
<body><div class="card">
<h1>Logged in!</h1>
<p>You can close this tab and return to Ghost Dashboard.</p>
</div></body></html>`;
}

function errorPage(message: string): string {
	return `<!DOCTYPE html>
<html><head><title>Ghost Dashboard</title>
<style>
body{font-family:system-ui;display:flex;align-items:center;justify-content:center;
min-height:100vh;margin:0;background:#0a0a0a;color:#fff}
.card{text-align:center;padding:3rem;border-radius:1rem;background:#111;border:1px solid #333}
h1{color:#f87171;margin:0 0 .5rem}
p{color:#999;margin:0}
</style></head>
<body><div class="card">
<h1>Login Failed</h1>
<p>${message}</p>
</div></body></html>`;
}
