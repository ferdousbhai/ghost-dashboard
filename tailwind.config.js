/** @type {import('tailwindcss').Config} */
export default {
	content: ["./src/mainview/**/*.{html,js,ts,jsx,tsx}"],
	theme: {
		extend: {
			fontFamily: {
				mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
			},
			colors: {
				surface: {
					DEFAULT: "#0a0a0f",
					raised: "#12121a",
				},
			},
		},
	},
	plugins: [],
};
