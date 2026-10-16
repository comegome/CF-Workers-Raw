# 🚀 CF-Workers-Raw：轻松访问 GitHub 私有仓库

> [!WARNING]
> **这个 Worker 没有任何客户端鉴权。** 任何拿到地址的人，都能读取 `GH_TOKEN` 有权访问的内容。
>
> 部署前请务必做到三条：**设置 `GH_NAME` + `GH_REPO` 把范围钉死在一个仓库**、**令牌用最小权限（Fine-grained，仅 `Contents: Read`）**、**不要把地址公开**。
> 每条措施具体挡住什么，见下面的[安全说明](#-安全说明务必阅读)。

🔐 用 Cloudflare Workers 做中间层，令牌只存在 Worker 的环境变量里，调用方全程不需要接触它。

- 📁 你有存放在 GitHub 私有仓库里的文件
- 🔗 你想直接用 URL 取到它们的原始内容（配置文件、数据文件等）
- 🛡️ 你不想把令牌暴露在 URL 里，也不想让每个访问者各自拿着令牌
- 🎯 你希望部署和用法都尽量简单

> [!TIP]
> **还有 [EdgeOne Pages 版本](https://github.com/cmliu/CF-Workers-Raw/tree/EdgeOne)**

## 📖 如何使用？

假设你的 Worker 部署在 `raw.090227.xyz`，要访问的私有文件是 `https://raw.githubusercontent.com/cmliu/CF-Workers-Raw/main/_worker.js`。

配置好 `GH_TOKEN` 之后直接访问：

```url
https://raw.090227.xyz/cmliu/CF-Workers-Raw/main/_worker.js
```

也支持完整原始 URL 形态（**仅在未配置 `GH_NAME` 时可用**，原因见下一节）：

```url
https://raw.090227.xyz/https://raw.githubusercontent.com/cmliu/CF-Workers-Raw/main/_worker.js
```

## 🔍 隐藏 GitHub 路径信息

设置下面这些变量可以把真实的 GitHub 路径藏起来。**必须按顺序**：`GH_REPO` 依赖 `GH_NAME`，`GH_BRANCH` 依赖前两个。

| 已设置的变量 | 你访问的地址 | 最终请求到的 raw 路径 |
|--|--|--|
| `GH_NAME=cmliu` | `https://raw.090227.xyz/CF-Workers-Raw/main/_worker.js` | `cmliu/CF-Workers-Raw/main/_worker.js` |
| 再加 `GH_REPO=CF-Workers-Raw` | `https://raw.090227.xyz/main/_worker.js` | 同上 |
| 再加 `GH_BRANCH=main` | `https://raw.090227.xyz/_worker.js` | 同上 |

⚠️ **配置了 `GH_NAME` 之后，完整原始 URL 形态不再可用** —— 它会被当成钉死前缀下的普通路径（上游通常返回 404）。这是让仓库锁定**真的锁得住**的代价：否则访问 `https://你的域名/https://raw.githubusercontent.com/你账号下别的私有库/main/...`，就能用你的令牌读走它有权访问的所有仓库。未配置 `GH_NAME` 时，完整 URL 形态照旧可用。

## ⚙️ 配置

在 Cloudflare Workers 面板里：**设置 → 环境变量**。

- **代码层面只有 `GH_TOKEN` 是必填的** —— 缺了它，Worker 对任何取文件请求都直接返回 500。
- **安全层面 `GH_NAME` + `GH_REPO` 必须设置** —— 不设时这个 Worker 就是一个面向 `raw.githubusercontent.com` 的公开代理，任何人都能借它读取任意公开仓库（见下面的[安全说明](#-安全说明务必阅读)）。
- `GH_BRANCH`、`URL`、`URL302`、`ERROR` 是纯粹的可选项。

| 变量 | 示例 | 说明 |
|--|--|--|
| `GH_TOKEN` | `github_pat_xxxxxx` | **必填**。你的 GitHub 令牌。建议 Fine-grained、只对该仓库授予 `Contents: Read`，不要用 classic 的 `repo` 全权令牌 |
| `GH_NAME` | `cmliu` | **安全上必填**。钉死 GitHub 用户名 |
| `GH_REPO` | `CF-Workers-Raw` | **安全上必填**。钉死仓库名；**没设 `GH_NAME` 时它会被忽略** |
| `GH_BRANCH` | `main` | 钉死分支名；**没设 `GH_NAME` + `GH_REPO` 时它会被忽略** |
| `URL302` | `https://t.me/CMLiussss` | 首页则 302 跳转到该地址；设了它就优先于 `URL` |
| `URL` | `https://example.com/` | 首页返回该地址的内容（伪装） |
| `ERROR` | `文件不存在` | 替换「取不到文件」那条提示文案 |

几点补充：

- `GH_NAME` / `GH_REPO` / `GH_BRANCH` 的值会**自动去掉首尾空白和多余的斜杠**，但在面板里手填时仍建议核对一遍。
- `URL` / `URL302` 支持填多个地址（用空白、换行或逗号分隔，会随机取一个）。注意 `|` 也会被当成分隔符，别把它写进 URL。
- `URL` 和 `URL302` 都不设时，首页返回一个伪装成 nginx 的静态页。
- 用 `URL` 做首页伪装时，**不会把你的请求头（`Cookie` / `Authorization` 等）转给你配置的第三方地址**。
- 令牌在 GitHub → Settings → Developer settings → Personal access tokens 生成。

## ⚠️ 安全说明（务必阅读）

**这个 Worker 没有客户端鉴权，端点本质上是公开的。** 三条必做措施各自挡住什么：

| 措施 | 挡住的是什么 |
|--|--|
| **设置 `GH_NAME` + `GH_REPO`** | 把可读范围钉死在一个仓库。**不设置时，它就是一个面向 `raw.githubusercontent.com` 的公开代理** —— 任何人都能借它读取任意公开仓库，甚至拿它转发流量 |
| **令牌用最小权限** | 即使地址泄漏，能读到的也只有那一个仓库 |
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
| `服务器GitHub TOKEN配置错误` | 500 | Worker 没有配置 `GH_TOKEN` |
| `无法获取文件，检查路径或TOKEN是否正确。` | 上游返回的状态码 | 路径错误，或令牌无权访问该文件。可用 `ERROR` 覆盖文案 |
| `非法路径` | 400 | 路径中残留了被编码的 `.` / `/` / `\`（`%2e` `%2f` `%5c`，含嵌套编码） |
| `Method Not Allowed` | 405 | 只支持 `GET` / `HEAD` |
| `服务器内部错误` | 500 | 未预期的错误，细节只写进 Worker 日志；响应头 `x-raw-error` 会带上错误类型名（不含堆栈） |

# 🙏 感谢
我自己的脑洞、ChatGPT
