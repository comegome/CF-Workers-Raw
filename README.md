# 🚀 CF-Workers-Raw：轻松访问 GitHub 私有仓库

> [!WARNING]
> **这个 Worker 没有任何客户端鉴权。** 任何拿到地址的人，都能读取你限定的那个仓库里的内容。
>
> 它**强制要求**配置 `GH_NAME` + `GH_REPO`（缺任一个直接返回 500），所以它从设计上就不会变成一个面向 `raw.githubusercontent.com` 的公开代理。
> 除了这两条，你还需要：**令牌用最小权限（Fine-grained，仅 `Contents: Read`）**、**不要把地址公开**。

🔐 用 Cloudflare Workers 做中间层，令牌只存在 Worker 的环境变量里，调用方全程不需要接触它。

- 📁 你有存放在 GitHub 私有仓库里的文件
- 🔗 你想直接用 URL 取到它们的原始内容（配置文件、数据文件等）
- 🛡️ 你不想把令牌暴露在 URL 里，也不想让每个访问者各自拿着令牌
- 🎯 你希望部署和用法都尽量简单

> [!TIP]
> **还有 [EdgeOne Pages 版本](https://github.com/cmliu/CF-Workers-Raw/tree/EdgeOne)**

## 📖 如何使用？

先配好 `GH_TOKEN`、`GH_NAME`（用户名）、`GH_REPO`（仓库名）。以 `GH_NAME=cmliu`、`GH_REPO=CF-Workers-Raw` 为例：

```url
https://raw.090227.xyz/main/_worker.js
```

它在上游实际请求的是 `https://raw.githubusercontent.com/cmliu/CF-Workers-Raw/main/_worker.js`。

再设置 `GH_BRANCH=main` 之后，连分支名也可以从地址里省掉：

```url
https://raw.090227.xyz/_worker.js
```

**拼接规则**：`https://<你的域名>/<分支>/<仓库内路径>` →
`https://raw.githubusercontent.com/<GH_NAME>/<GH_REPO>/<GH_BRANCH 或地址里的分支>/<仓库内路径>`。

**不支持也永远不会支持「完整 raw URL」形态**（形如 `https://你的域名/https://raw.githubusercontent.com/...`）：它会被当成仓库内的一个普通路径。这曾经是绕过仓库限定的口子，现在从代码里彻底删掉了。

## ⚙️ 配置

在 Cloudflare Workers 面板里：**设置 → 环境变量**。

| 变量 | 必填 | 示例 | 说明 |
|--|--|--|--|
| `GH_TOKEN` | ✅ | `github_pat_xxxxxx` | 你的 GitHub 令牌。建议 Fine-grained、只对该仓库授予 `Contents: Read`，不要用 classic 的 `repo` 全权令牌 |
| `GH_NAME` | ✅ | `cmliu` | GitHub 用户名 |
| `GH_REPO` | ✅ | `CF-Workers-Raw` | GitHub 仓库名 |
| `GH_BRANCH` | ❌ | `main` | 分支名。设置后，地址里就可以省掉分支段 |
| `URL302` | ❌ | `https://t.me/CMLiussss` | 首页 302 跳转到该地址；设了它就优先于 `URL` |
| `URL` | ❌ | `https://example.com/` | 首页返回该地址的内容（伪装） |
| `ERROR` | ❌ | `文件不存在` | 替换「取不到文件」那条提示文案 |

**`GH_TOKEN` / `GH_NAME` / `GH_REPO` 缺任一个，Worker 都会直接返回 500** —— 故意的，见下面的安全说明。

几点补充：

- `GH_NAME` / `GH_REPO` / `GH_BRANCH` 的值会**自动去掉首尾空白和多余的斜杠**（只填了空白的值等同于没填，会触发 500）。
- `URL` / `URL302` 支持填多个地址（用空白、换行或逗号分隔，会随机取一个）。注意 `|` 也会被当成分隔符，别把它写进 URL。
- `URL` 和 `URL302` 都不设时，首页返回一个伪装成 nginx 的静态页。
- 用 `URL` 做首页伪装时，**不会把你的请求头（`Cookie` / `Authorization` 等）转给你配置的第三方地址**。
- 令牌在 GitHub → Settings → Developer settings → Personal access tokens 生成。

## ⚠️ 安全说明（务必阅读）

**这个 Worker 没有客户端鉴权，端点本质上是公开的。** 四条各自挡住什么：

| 措施 | 挡住的是什么 |
|--|--|
| **代码强制限定仓库** | `GH_NAME` + `GH_REPO` 缺失时直接 500。它不可能退化成「谁都能借它读任意仓库」的公开代理，也不存在用完整 URL 绕过限定的形态 |
| **令牌用最小权限** | 即使地址泄漏，能读到的也只有那一个仓库（Fine-grained + 仅 `Contents: Read`） |
| **不公开地址** | 抬高被撞见的门槛。**注意**：如果这份配置放在**公开仓库**里，`wrangler.toml` 里的 Worker 名字也是公开的，这一层只能算降低可见度 |
| **能吊销** | 怀疑泄漏时立刻在 GitHub 吊销并更换令牌 |
| **要真正的访问控制** | 用 [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/) 在 Worker 前面加一层，而不是在代码里手搓令牌 |

## 📌 注意事项：raw 上游有 CDN 缓存

`raw.githubusercontent.com` 自己前面有一层 CDN，响应带 `cache-control: max-age=300`（本 Worker 会把上游响应头原样透传）。所以：

- 分支被删除、文件被改动之后，**最多约 5 分钟内仍可能取到旧副本**
- 这是**上游 CDN 的陈旧副本**，不是本 Worker 缓存了内容，也不是安全漏洞
- **加 `?cb=时间戳` 之类的 query 参数无法绕过**：raw 的缓存键是 `vary: Authorization, Accept-Encoding`，query string 不参与其中
- 要确认某个 ref 是否真的还存在，请查 `github.com` 的页面或 `api.github.com/repos/<owner>/<repo>/branches`，**不要拿 raw 的可取性当判据**

## ❌ 错误处理

| 消息 | 状态码 | 触发条件 |
|--|--|--|
| `服务器GitHub TOKEN配置错误` | 500 | 没有配置 `GH_TOKEN` |
| `服务器未配置 GH_NAME 或 GH_REPO` | 500 | 没有（或没填有效值）配置 `GH_NAME` / `GH_REPO` |
| `无法获取文件，检查路径或TOKEN是否正确。` | 上游返回的状态码 | 路径错误，或令牌无权访问该文件。可用 `ERROR` 覆盖文案 |
| `非法路径` | 400 | 路径中残留了被编码的 `.` / `/` / `\`（`%2e` `%2f` `%5c`，含嵌套编码） |
| `Method Not Allowed` | 405 | 只支持 `GET` / `HEAD` |
| `服务器内部错误` | 500 | 未预期的错误，细节只写进 Worker 日志；响应头 `x-raw-error` 会带上错误类型名（不含堆栈） |

## 🔀 与上游的差异

本 fork 相对 [cmliu/CF-Workers-Raw](https://github.com/cmliu/CF-Workers-Raw) 的**行为不兼容**之处：

- **删除了所有客户端鉴权**：不再支持 `?token=` 参数、`TOKEN`、`TOKEN_PATH`。端点公开，靠仓库限定 + 最小权限令牌 + 不公开地址收敛。
- **`GH_NAME` + `GH_REPO` 变成必填**：上游不配置也能跑（会变成一个公开代理），本 fork 缺任一个直接 500。
- **不再支持「完整 raw URL」形态**：上游可用它绕过仓库限定，本 fork 已删除这条分支。
- 修复了上游模块级 `let token` 造成的**跨请求令牌泄漏**；转发 `Range` / `If-None-Match` / `If-Modified-Since`；只允许 `GET` / `HEAD`。

# 🙏 感谢
我自己的脑洞、ChatGPT
