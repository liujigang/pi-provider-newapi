# pi-newapi

[![CI](https://github.com/liujigang/pi-provider-newapi/actions/workflows/ci.yml/badge.svg)](https://github.com/liujigang/pi-provider-newapi/actions/workflows/ci.yml)
[![pi package catalog](https://img.shields.io/badge/pi-package%20catalog-5B5BD6.svg)](https://pi.dev/packages/pi-newapi)
[![npm](https://img.shields.io/npm/v/pi-newapi.svg)](https://www.npmjs.com/package/pi-newapi)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![社区 | Linux.do](https://img.shields.io/badge/社区-Linux.do-blue.svg)](https://linux.do/)

将 [pi](https://github.com/earendil-works/pi) 连接到一个或多个自托管的 [NewAPI](https://github.com/QuantumNous/new-api) 网关。扩展要求 Pi Coding Agent 为 **v0.99.2 或更高版本**。

每个网关都会在 pi 中注册为独立的命名 provider。扩展可以：

- 从 NewAPI 动态发现可用模型；
- 使用 pi 内置的模型能力与兼容性元数据补全已知模型；
- 根据网关公布的端点自动选择兼容 API，并支持通过正则表达式覆盖；
- 在 NewAPI 提供 ratio 配置时计算模型费用；
- 在离线或网关暂时不可用时继续使用最近一次成功的模型目录。

凭据始终由 pi 管理。扩展不会把 API Key 写入自身配置、模型定义、日志或缓存目录。

**[English README](https://github.com/liujigang/pi-provider-newapi/blob/main/README.md)**

## 安装

从 npm 安装：

```bash
pi install npm:pi-newapi
```

也可以直接从 GitHub 安装：

```bash
pi install git:github.com/liujigang/pi-provider-newapi
```

## 快速上手

使用网关根地址添加 provider，不要包含 `/v1`：

```text
pi> /newapi-provider-add my_gateway
Base URL: https://ai.example.com
Provider "my_gateway" added. Run /login my_gateway to enter its API key; Pi will then discover its models.
```

添加时会尝试检查网关是否可以访问。即使出现警告，配置仍会保存，因为需要认证的网关通常会拒绝匿名探测。

接下来，通过 pi 的标准登录流程录入 API Key：

```text
pi> /login my_gateway
```

在首次发现模型之前，provider 就已经可以通过 `/login` 进行认证。完成登录后，打开 `/model`，选择如 `my_gateway/claude-sonnet-4-5` 这样的模型即可。

凭据由 pi 配置的 CredentialStore 保存，通常位于 `<agentDir>/auth.json`。请勿将 API Key 写入 `provider-newapi.json`。

## 命令

| 命令 | 说明 |
|---|---|
| `/newapi-provider-add [name]` | 添加并立即注册 NewAPI 网关，然后提示输入网关根地址。 |
| `/newapi-provider-remove [name]` | 注销 provider 并删除扩展配置；请先运行 `/logout <name>`。 |
| `/newapi-provider-list` | 显示各 provider 的地址、认证状态、API 覆盖数量和启用状态。 |
| `/newapi-generate-models-json` | 为已经发现但 pi 尚不认识的模型生成可编辑的 `modelOverrides` 模板。 |
| `/newapi-config-recover` | 从配置备份中恢复设置，并将 `models-generated.json` 合并到 pi 的 `models.json`，然后确认清理和重新加载。 |

provider 名称不能为空、不能包含空格或斜杠、不能与 pi 内置 provider 重名，也不能与已有条目重复。

`/newapi-config-recover` 是 prompt 模板：它会展开为给 agent 的指令，而不是执行扩展代码。

### 移除 provider

Pi 尚未通过扩展 API 提供凭据删除能力。若要同时移除凭据和 provider 配置，请按顺序运行：

```text
/logout my_gateway
/newapi-provider-remove my_gateway
```

扩展不会直接编辑 `auth.json`，因此这套流程同样兼容自定义 pi CredentialStore。

## 模型发现与缓存

动态 provider 的模型目录由 pi 负责触发刷新：

- 打开 `/model` 会在后台开始刷新。修改 `modelApiOverrides` 或 pi 的 `models.json` 后，也可用这种方式应用新配置。
- `pi update --models` 会立即强制刷新，无需等待后台更新。
- 刷新成功后，pi 会把各 provider 的模型目录存入 `<agentDir>/models-store.json`。
- 禁止网络访问时，扩展会直接恢复最近一次成功的目录，不会请求 NewAPI。
- 刷新失败时会保留上一次可用的目录；当已有缓存时，`/v1/models` 返回空列表同样按刷新失败处理。`/api/ratio_config` 是可选端点，但要生成新的模型目录，`/v1/models` 必须请求成功。
- `/v1/models` 返回 `401` 或 `403` 时会报告为凭据问题，请重新运行 `/login <name>` 修正 API Key。

`/v1/models` 请求超时为 15 秒，可选比例元数据请求超时为 10 秒，添加 provider 时的连通性检查超时为 5 秒。底层仍由 pi 的全局 HTTP dispatcher 负责代理路由与空闲超时处理。

目录更新使用 pi 带代次校验的发布 API，因此较早发起、较晚完成的刷新不会覆盖更新的数据。缓存中绝不会包含 API Key。

## 费用计算

费用来自 NewAPI 的 `/api/ratio_config`，该端点会与模型目录一起请求。ratio 与模型 ID 的匹配顺序为：精确键名、忽略大小写、把键名当作模型 ID 的前缀，因此 `gpt-4o` 键同样可以覆盖 `gpt-4o-2025-01-01`。

每百万 token 的费用为 `ratio x 2 USD`，因为 NewAPI 按每美元 500,000 quota 计算：

| 费用字段 | 使用的 ratio |
|---|---|
| 输入 | `model_ratio` |
| 输出 | `model_ratio x completion_ratio` |
| 缓存读取 | `model_ratio x cache_ratio` |
| 缓存写入 | `model_ratio x create_cache_ratio` |

缺失的 ratio 会回退为 `0`（`model_ratio`、`cache_ratio`、`create_cache_ratio`）或 `1`（`completion_ratio`），因此没有 ratio 元数据的网关会报告零费用，而不会报告错误费用。费用使用固定的分组倍率 `1.0`，不会应用 `group_ratio` 中的分组倍率。

## 配置

添加和移除命令会管理 `<agentDir>/extension-settings/provider-newapi.json`。`<agentDir>` 的默认位置为：

| 系统 | 路径 |
|---|---|
| Linux / macOS | `~/.pi/agent` |
| Windows | `%USERPROFILE%\.pi\agent` |

通常只有在需要覆盖 API 路由时，才需要直接编辑此文件：

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

- **`version`** 用于选择配置 schema，当前版本为 `1`。声明了更高 schema 版本的文件会原样保留并拒绝加载，直到扩展完成升级。
- **`providers`** 为每个 NewAPI 网关保存一个条目。键名就是 pi 中显示的 provider ID。
- **`baseUrl`** 是不含 `/v1` 的网关根地址；末尾的斜杠会自动移除。
- **`modelApiOverrides`** 为可选字段；省略它等同于使用空对象。存在时，它会将 JavaScript 正则表达式映射到 pi API。规则按 JSON 中的顺序匹配，首个命中项生效。可用值为 `anthropic-messages`、`openai-completions` 和 `openai-responses`。无效的正则会被忽略并输出警告；不支持的 API 值无法通过 schema 校验，并会触发下文所述的配置备份。

### API 路由

默认情况下，扩展会结合 pi 的内置元数据与 NewAPI 返回的 `supported_endpoint_types` 选择 API。命中的 `modelApiOverrides` 规则优先级高于这两者。当网关同时公布多个可用 API 时，扩展的偏好顺序为 `anthropic-messages`、`openai-responses`、`openai-completions`。

| 模型 API | 传给 pi 的 Base URL |
|---|---|
| `openai-completions`、`openai-responses` | `{baseUrl}/v1` |
| `anthropic-messages` | `{baseUrl}` |

### 模型元数据与兼容性

模型元数据和兼容性覆盖由 pi 管理。请使用相同的 provider ID，将配置写入 `<agentDir>/models.json`：

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

Pi 会在模型发现完成后，按精确模型 ID 应用这些覆盖。Provider 级 `compat` 会影响网关上的所有模型；如果只想影响一个模型，请将 `compat` 放入该模型的覆盖项中。

pi 已经认识的模型会继承其显示名称、能力、上下文窗口和兼容性元数据。查找时会忽略 provider 前缀并把点号视为连字符，因此 `openai/gpt-4o` 可以匹配 `gpt-4o`；在 pi 内置目录中首个匹配到的模型生效，覆盖 deepseek、zai、google、anthropic、minimax、moonshotai、xiaomi、openai 和 vercel-ai-gateway。pi 不认识的模型仍可正常使用，并采用保守默认值：仅文本输入、不支持推理、128,000 token 上下文窗口、32,768 最大输出 token。

对于 pi 内置目录中不存在的模型，可运行：

```text
/newapi-generate-models-json
```

该命令会刷新当前可用的目录，并将模板写入 `<agentDir>/models-generated.json`。它不会修改由用户维护的 `models.json`；请把需要的 provider 和模型条目复制到该文件中，并与已有内容合并。如果某个 provider 尚无可用目录，请先打开 `/model`，再重新运行生成命令。

### 配置备份与恢复

JSON 解析或 schema 校验失败的配置文件会被移动为 `<agentDir>/extension-settings/provider-newapi.YYMMDD-HHMMSS.json.bak`，并替换为有效的空配置。此时警告会输出：

```text
Run /newapi-config-recover to recover settings from config backups.
```

该 prompt 会检查这些备份，在不覆盖现有值的前提下，把可恢复的扩展设置和 `models-generated.json` 模板合并到 pi 的 `models.json`，并保留有歧义的片段供人工检查。它会列出已恢复的备份，并在删除这些明确列出的文件及提示运行 `/reload` 前请求用户明确确认。

## 多网关

不同 provider 的模型目录、凭据和缓存彼此独立。例如，模型选择器中可以同时出现：

```text
internal/claude-sonnet-4-5
personal/gpt-4o
```

## 开发

项目不需要构建：pi 会直接加载根目录的 `index.ts`。具体实现按功能拆分在 `src/` 下，测试位于 `test/`。

```bash
pnpm install
pnpm run typecheck
pnpm test
```

测试运行在 Node 的 strip-only TypeScript loader 上，因此类型必须可擦除：不要使用 `enum`、参数属性和装饰器。GitHub Actions 会在 Node 24 上对 push 和 pull request 运行同一套类型检查与测试。

## 许可证

MIT，详见 [LICENSE](LICENSE)。
