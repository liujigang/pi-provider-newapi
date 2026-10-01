# pi-newapi

[![CI](https://github.com/liujigang/pi-provider-newapi/actions/workflows/ci.yml/badge.svg)](https://github.com/liujigang/pi-provider-newapi/actions/workflows/ci.yml)
[![pi package catalog](https://img.shields.io/badge/pi-package%20catalog-5B5BD6.svg)](https://pi.dev/packages/pi-newapi)
[![npm](https://img.shields.io/npm/v/pi-newapi.svg)](https://www.npmjs.com/package/pi-newapi)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Community | Linux.do](https://img.shields.io/badge/community-Linux.do-blue.svg)](https://linux.do/)

Connect [pi](https://github.com/earendil-works/pi) to one or more self-hosted [NewAPI](https://github.com/QuantumNous/new-api) gateways. This extension requires Pi Coding Agent **v0.99.2 or later**.

Each gateway becomes a separate, named provider in pi. The extension:

- discovers available models dynamically from NewAPI;
- enriches known models with pi's built-in capability and compatibility metadata;
- selects a compatible API from the gateway's advertised endpoints, with optional regex overrides;
- calculates model costs from NewAPI's ratio configuration when it is available; and
- keeps the last successful model catalog available for offline use or temporary gateway failures.

Pi remains responsible for credentials. The extension never copies API keys into its configuration, model definitions, logs, or cached catalogs.

**[中文文档](https://github.com/liujigang/pi-provider-newapi/blob/main/README_cn.md)**

## Installation

Install from npm:

```bash
pi install npm:pi-newapi
```

Or install directly from GitHub:

```bash
pi install git:github.com/liujigang/pi-provider-newapi
```

## Quick start

Add a gateway using its root URL (without `/v1`):

```text
pi> /newapi-provider-add my_gateway
Base URL: https://ai.example.com
Provider "my_gateway" added. Run /login my_gateway to enter its API key; Pi will then discover its models.
```

The setup command performs a best-effort reachability check. A warning does not prevent the provider from being saved, since authenticated gateways often reject an anonymous probe.

Next, enter the API key through pi's standard login flow:

```text
pi> /login my_gateway
```

The provider is available in `/login` before its first model has been discovered. Once authenticated, open `/model` and choose a model such as `my_gateway/claude-sonnet-4-5`.

Pi stores the credential through its configured credential store, normally `<agentDir>/auth.json`. Do not add the key to `provider-newapi.json`.

## Commands

| Command | Description |
|---|---|
| `/newapi-provider-add [name]` | Add and immediately register a NewAPI gateway, then prompt for its root URL. |
| `/newapi-provider-remove [name]` | Unregister the provider and remove its extension configuration. Run `/logout <name>` first. |
| `/newapi-provider-list` | Show each configured provider's URL, authentication status, API override count, and active state. |
| `/newapi-generate-models-json` | Generate editable pi `modelOverrides` templates for discovered models that pi does not already know. |
| `/newapi-config-recover` | Recover settings from config backups and merge `models-generated.json` into Pi's `models.json`, then confirm cleanup and reload. |

Provider names cannot be empty, contain spaces or slashes, collide with a built-in pi provider, or duplicate an existing entry.

`/newapi-config-recover` is a prompt template: it expands into instructions for the agent instead of running extension code.

### Removing a provider

Pi does not expose credential deletion through the extension API. To remove both the credential and the provider configuration, run these commands in order:

```text
/logout my_gateway
/newapi-provider-remove my_gateway
```

The extension never edits `auth.json` directly, so this flow also works with custom pi credential stores.

## Model discovery and caching

Pi controls when dynamic provider catalogs are refreshed:

- Opening `/model` starts a background refresh. Use this after changing `modelApiOverrides` or pi's `models.json`.
- `pi update --models` forces an immediate refresh when you do not want to wait for the background update.
- After a successful refresh, pi stores the provider catalog in `<agentDir>/models-store.json`.
- When network access is disabled, the extension restores the last successful catalog without contacting NewAPI.
- A failed refresh keeps the last good catalog, and an empty `/v1/models` response is treated as a failed refresh when a catalog is already cached. `/api/ratio_config` is optional, but `/v1/models` must succeed to produce a fresh catalog.
- A `401` or `403` from `/v1/models` is reported as a credential problem. Run `/login <name>` again to correct the API key.

Requests allow 15 seconds for `/v1/models`, 10 seconds for optional ratio metadata, and 5 seconds for the add-provider reachability check. Pi's global HTTP dispatcher still provides proxy routing and idle-timeout handling underneath these local limits.

Catalog updates use pi's generation-checked publishing API, so an older, slower refresh cannot overwrite newer model data. API keys are never included in the catalog store.

## Cost calculation

Costs come from NewAPI's `/api/ratio_config`, which is fetched alongside the model catalog. Ratios are matched against the model ID by exact key, then case-insensitively, then by treating a key as a prefix of the model ID, so a `gpt-4o` key also covers `gpt-4o-2025-01-01`.

Cost per million tokens is `ratio x 2 USD`, because NewAPI counts 500,000 quota per USD:

| Cost field | Ratio used |
|---|---|
| Input | `model_ratio` |
| Output | `model_ratio x completion_ratio` |
| Cache read | `model_ratio x cache_ratio` |
| Cache write | `model_ratio x create_cache_ratio` |

Missing ratios fall back to `0` for `model_ratio`, `cache_ratio`, and `create_cache_ratio`, and to `1` for `completion_ratio`, so a gateway without ratio metadata reports zero cost rather than incorrect costs. Costs use a fixed group rate of `1.0`; per-group multipliers from `group_ratio` are not applied.

## Configuration

The add and remove commands manage `<agentDir>/extension-settings/provider-newapi.json`. The default `<agentDir>` is:

| OS | Path |
|---|---|
| Linux / macOS | `~/.pi/agent` |
| Windows | `%USERPROFILE%\.pi\agent` |

Edit this file directly only when you need API routing overrides:

```json
{
  "version": 1,
  "providers": {
    "my_gateway": {
      "baseUrl": "https://ai.example.com",
      "modelApiOverrides": {
        "^claude-": "anthropic-messages",
        "^gpt-": "openai-completions"
      }
    },
    "second_gateway": {
      "baseUrl": "https://gw2.example.com",
      "modelApiOverrides": {}
    }
  }
}
```

- **`version`** selects the configuration schema; `1` is current. A file declaring a newer schema is preserved and rejected until the extension is upgraded.
- **`providers`** contains one entry per NewAPI gateway. Each key becomes the provider ID shown by pi.
- **`baseUrl`** is the gateway root URL, without `/v1`. Trailing slashes are removed automatically.
- **`modelApiOverrides`** is optional; omitting it is equivalent to an empty object. When present, it maps JavaScript regular expressions to pi APIs. Rules are checked in JSON order, and the first match wins. Supported values are `anthropic-messages`, `openai-completions`, and `openai-responses`. Invalid regular expressions are ignored with a warning; unsupported API values fail schema validation and trigger the config backup described below.

### API routing

By default, the extension combines pi's metadata with each model's `supported_endpoint_types` from NewAPI. A matching `modelApiOverrides` rule takes precedence over both. When a gateway advertises several usable APIs, the extension prefers `anthropic-messages`, then `openai-responses`, then `openai-completions`.

| Model API | Base URL passed to pi |
|---|---|
| `openai-completions`, `openai-responses` | `{baseUrl}/v1` |
| `anthropic-messages` | `{baseUrl}` |

### Model metadata and compatibility

Pi owns model metadata and compatibility overrides. Put them in `<agentDir>/models.json` under the same provider ID:

```json
{
  "providers": {
    "my_gateway": {
      "compat": {
        "sendSessionAffinityHeaders": true
      },
      "modelOverrides": {
        "unknown-model-id": {
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 32768
        }
      }
    }
  }
}
```

Pi applies exact model-ID overrides after discovery. Provider-level `compat` affects every model on the gateway; place `compat` inside a model override when it should apply to only one model.

Models that pi already knows inherit its display name, capabilities, context window, and compatibility metadata. The lookup ignores provider prefixes and treats dots as dashes, so `openai/gpt-4o` matches `gpt-4o`. The first match across pi's built-in catalogs wins, covering deepseek, zai, google, anthropic, minimax, moonshotai, xiaomi, openai, and vercel-ai-gateway. Models pi does not know stay usable with conservative defaults: text-only input, no reasoning, a 128,000-token context window, and 32,768 maximum output tokens.

For models that are not in pi's built-in catalog, run:

```text
/newapi-generate-models-json
```

The command refreshes the available catalogs and writes templates to `<agentDir>/models-generated.json`. It does not modify pi's user-owned `models.json`: copy the relevant provider and model entries into that file and merge them with anything already there. If a provider has no available catalog yet, open `/model` first and then rerun the generator.

### Config backups and recovery

A configuration file that fails JSON parsing or schema validation is moved to `<agentDir>/extension-settings/provider-newapi.YYMMDD-HHMMSS.json.bak` and replaced with a valid empty configuration. Whenever this happens the warning says:

```text
Run /newapi-config-recover to recover settings from config backups.
```

The prompt examines the backups, merges recoverable extension settings and `models-generated.json` templates into pi's `models.json` without overwriting existing values, and preserves ambiguous fragments for manual review. It lists the recovered backups and asks for explicit confirmation before deleting those exact files and directing you to run `/reload`.

## Multiple gateways

Provider catalogs, credentials, and cached model lists stay separate. For example, the model picker can contain both:

```text
internal/claude-sonnet-4-5
personal/gpt-4o
```

## Development

There is no build step: pi loads the root `index.ts` entry directly. The implementation lives in focused modules under `src/`, with tests under `test/`.

```bash
pnpm install
pnpm run typecheck
pnpm test
```

The tests run on Node's strip-only TypeScript loader, so keep types erasable: no `enum`, parameter properties, or decorators. The same typecheck and test suites run in GitHub Actions on Node 24 for pushes and pull requests.

## License

MIT — see [LICENSE](LICENSE).
