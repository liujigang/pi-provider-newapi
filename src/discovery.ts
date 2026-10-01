/** Discovers NewAPI models and maintains Pi's provider-scoped catalog cache. */

import type { Api, Model, RefreshModelsContext } from "@earendil-works/pi-ai";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { readConfig } from "./config.ts";
import { RATIO_CONFIG_FETCH_TIMEOUT_MS } from "./constants.ts";
import { fetchWithTimeout, NewAPIError } from "./http.ts";
import { buildProviderModels, parseModelsResponse, parseRatioConfig } from "./models.ts";
import { EMPTY_RATIOS } from "./types.ts";

/** Refresh the provider catalog while retaining the last good cached result on failure. */
export async function refreshProviderModels(
	providerName: string,
	context: RefreshModelsContext,
): Promise<ProviderModelConfig[]> {
	const config = readConfig();
	const entry = config.providers[providerName];
	if (!entry) return [];

	const cachedModels = (context.stored?.models ?? []) as unknown as ProviderModelConfig[];
	// Offline startup and cancelled refreshes must never discard the last usable catalog.
	if (!context.allowNetwork || context.signal.aborted) return cachedModels;

	const credential = context.credential;
	const apiKey = credential?.type === "api_key" && credential.key ? credential.key : undefined;

	try {
		const baseUrl = entry.baseUrl.replace(/\/+$/, "");
		const headers: Record<string, string> = {};
		if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
		// Cost metadata is optional, so fetch it alongside the required model catalog.
		const ratiosPromise = fetchWithTimeout(`${baseUrl}/api/ratio_config`, {
			headers,
			signal: context.signal,
			timeoutMs: RATIO_CONFIG_FETCH_TIMEOUT_MS,
		})
			.then(async (response) => (response.ok ? parseRatioConfig(await response.json()) : EMPTY_RATIOS))
			.catch((err) => {
				if (err instanceof NewAPIError && err.code === "aborted") throw err;
				console.warn(
					`NewAPI [${providerName}]: /api/ratio_config unavailable — ${err instanceof Error ? err.message : String(err)}`,
				);
				return EMPTY_RATIOS;
			});
		const modelsPromise = fetchWithTimeout(`${baseUrl}/v1/models`, {
			headers,
			signal: context.signal,
		});
		const [ratios, modelsResponse] = await Promise.all([ratiosPromise, modelsPromise]);
		if (modelsResponse.status === 401 || modelsResponse.status === 403) {
			throw new NewAPIError(
				"auth",
				`GET /v1/models: ${modelsResponse.status} ${modelsResponse.statusText} — check the API key`,
			);
		}
		if (!modelsResponse.ok) {
			throw new NewAPIError("http", `GET /v1/models: ${modelsResponse.status} ${modelsResponse.statusText}`);
		}

		const models = buildProviderModels({
			providerName,
			baseUrl,
			apiModels: parseModelsResponse(await modelsResponse.json()),
			ratios,
			modelApiOverrides: entry.modelApiOverrides ?? {},
		});

		// Treat a transient empty response as a failed refresh when a prior catalog exists.
		if (models.length === 0 && cachedModels.length > 0) {
			console.warn(`NewAPI [${providerName}]: /v1/models returned zero models — keeping cached catalog.`);
			return cachedModels;
		}

		if (context.signal.aborted) return cachedModels;
		const published = await context.publish({
			persist: {
				models: models as unknown as Model<Api>[],
				checkedAt: Date.now(),
			},
		});
		return published ? models : cachedModels;
	} catch (err) {
		// Discovery failures are isolated to this refresh; Pi can continue with cached models.
		if (err instanceof NewAPIError && err.code === "aborted") return cachedModels;
		console.warn(
			`NewAPI [${providerName}]: refresh failed — ${err instanceof Error ? err.message : String(err)}` +
				(cachedModels.length > 0 ? " (serving cached catalog)" : ""),
		);
		return cachedModels;
	}
}
