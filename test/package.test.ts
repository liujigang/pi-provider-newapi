/** Verifies package resources that Pi discovers outside the extension entry point. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("package delegates Pi-supplied packages to the host", () => {
	const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
		peerDependencies?: Record<string, string>;
		dependencies?: Record<string, string>;
	};

	for (const name of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "typebox"]) {
		assert.equal(packageJson.peerDependencies?.[name], "*", `${name} must be a wildcard peer dependency`);
		assert.equal(packageJson.dependencies?.[name], undefined, `${name} must not be bundled as a runtime dependency`);
	}
});

test("package exposes the NewAPI config recovery prompt", () => {
	const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
		pi?: { prompts?: string[] };
	};
	assert.deepEqual(packageJson.pi?.prompts, ["./prompts"]);

	const prompt = readFileSync(new URL("../prompts/newapi-config-recover.md", import.meta.url), "utf-8");
	assert.match(prompt, /This prompt is self-contained/);
	assert.match(prompt, /"version": 1/);
	assert.match(prompt, /anthropic-messages.*openai-completions.*openai-responses/s);
	assert.match(prompt, /malformed or truncated JSON/);
	assert.match(prompt, /models-generated\.json.*lowest to highest/s);
	assert.match(prompt, /fill only missing fields and preserve all existing values/);
	assert.match(prompt, /explicitly ask the user to confirm removal/);
	assert.match(prompt, /instruct the user to enter `\/reload`/);
});
