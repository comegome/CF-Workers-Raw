# 🚀 CF-Workers-Raw：轻松访问GitHub私有仓库

> [!WARNING]
> **这个 Worker 没有任何客户端鉴权。** 任何拿到 Worker 地址的人，都能读取 `GH_TOKEN` 有权访问的内容。
>
> 部署前请务必做到这三条：
> 1. **设置 `GH_NAME` + `GH_REPO`** —— 把 Worker 钉死在你自己的一个仓库上。不设置时它就是一个面向 `raw.githubusercontent.com` 的公开代理。
> 2. **令牌用最小权限** —— Fine-grained token，只对该仓库授予 `Contents: Read`。
> 3. **不要把 Worker 地址公开** —— 地址就是事实上的密钥。
>
> 需要真正的访问控制，请在 Worker 前面挂 [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/)，而不是在代码里手搓令牌。
> 每条措施挡住的是什么，详见下面的「安全说明」。

🔐 这个项目允许你通过 Cloudflare Workers 安全地访问 GitHub 私有仓库中的原始文件，调用方全程无需接触你的 GitHub 令牌。

- 📁 你有一些存储在 GitHub 私有仓库中的重要文件
- 🔗 你想直接通过 URL 访问这些文件的原始内容（比如配置文件、数据文件等）
- 🛡️ 但是，你不想把 GitHub 令牌暴露在 URL 里，也不想让每个访问者各自拿着令牌
- 🎯 你希望部署和用法都足够简单

💡 方案：用 Cloudflare Workers 做中间层。令牌只存在 Worker 的环境变量里，由它替你完成对 GitHub 的认证。

> [!TIP]
> **还有 [EdgeOne Pages 版本](https://github.com/cmliu/CF-Workers-Raw/tree/EdgeOne)**

## 📖 如何使用？

假设你的 Cloudflare Workers 项目部署在 `raw.090227.xyz`，而你要访问的私有文件是 `https://raw.githubusercontent.com/cmliu/CF-Workers-Raw/main/_worker.js`。

在 Workers 里配置好 `GH_TOKEN` 之后，直接访问即可：

```url
https://raw.090227.xyz/cmliu/CF-Workers-Raw/main/_worker.js
```

或者，如果你喜欢完整的原始 URL：

```url
https://raw.090227.xyz/https://raw.githubusercontent.com/cmliu/CF-Workers-Raw/main/_worker.js
```

## 🔍 隐藏 GitHub 路径信息

为了更高的隐私性，你可以设置变量来隐藏真实的 GitHub 路径：

- 🧑‍💻 `GH_NAME`：你的 GitHub 用户名（例如 **cmliu**）

```url
https://raw.090227.xyz/CF-Workers-Raw/main/_worker.js
```

- 📦 `GH_REPO`：你的 GitHub 仓库名（例如 **CF-Workers-Raw**，必须设置 `GH_NAME` 变量为前提）

```url
https://raw.090227.xyz/main/_worker.js
```

- 🌿 `GH_BRANCH`：你的 GitHub 分支名（例如 **main**，必须设置 `GH_NAME` 和 `GH_REPO` 变量为前提）

```url
https://raw.090227.xyz/_worker.js
```

⚠️ **注意**：**配置了 `GH_NAME` 之后，完整原始 URL 形态不再可用** —— 它会被当作钉死前缀下的普通路径，由上游返回 404。这是为了让 `GH_NAME`/`GH_REPO` 的仓库锁定**真的锁得住**：否则只要访问 `https://你的域名/https://raw.githubusercontent.com/你账号下别的私有库/main/...`，就能用你的令牌读走它有权访问的所有仓库。未配置 `GH_NAME` 时，完整 URL 形态照旧可用。

```url
https://raw.090227.xyz/https://raw.githubusercontent.com/cmliu/CF-Workers-Raw/main/_worker.js
```

## ⚙️ 如何设置这些变量？

在你的 Cloudflare Workers 管理面板中：

1. 🏠 进入你的 Workers 项目
2. ⚙️ 点击**设置**标签
3. 📋 滚动到**环境变量**部分
4. ➕ 添加以下变量：
   - 🔑 变量：`GH_TOKEN`，值：你的 GitHub 个人访问令牌（**必填**）
   - 🔍 变量：`GH_NAME`、`GH_REPO`、`GH_BRANCH`（可选，用于隐藏真实的仓库路径）
   - 🏠 变量：`URL`、`URL302`、`ERROR`（可选）

💡 GitHub 个人访问令牌可以在 GitHub 设置的 "Developer settings" > "Personal access tokens" 页面生成。
**强烈建议使用 Fine-grained token，只对该仓库授予 `Contents: Read`**，不要用 classic 的 `repo` 全权令牌。

## ⚠️ 安全说明（务必阅读）

上面的警告不再重复。下面说明**每条措施挡住的具体是什么**：

| 措施 | 作用 |
|--|--|
| **务必设置 `GH_NAME` + `GH_REPO`** | 把 Worker 钉死在你自己的一个仓库上（配置后完整 raw URL 形态会被拒，锁得住）。**不设置时，它就是一个面向 `raw.githubusercontent.com` 的公开代理**：任何人都能借它读取任意公开仓库，甚至拿它转发流量 |
| **令牌用最小权限** | Fine-grained token，只对该仓库授予 `Contents: Read`。这样即使 Worker 地址泄漏，能读到的也只有这一个仓库 |
| **不要公开 Worker 地址** | 地址就是事实上的密钥。不要贴到公开场合，并注意 `Referer` 泄漏 |
| **保证令牌可吊销** | 一旦怀疑泄漏，立刻在 GitHub 上吊销并更换 |
| **需要真正的访问控制** | 请用 [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/) 在 Worker 前面加一层，而不是在代码里手搓令牌 |

## 📌 注意事项

### raw 上游有 CDN 缓存：删除或改动后，最多约 5 分钟内仍可能取到旧内容

本 Worker 出站请求的是 `raw.githubusercontent.com`，它自己前面有一层 CDN，并返回 `cache-control: max-age=300`（本 Worker 会把上游响应头原样透传）。因此：

- 分支被删除、文件被改动之后，通过本 Worker **仍可能取到约 5 分钟内的旧副本**
- 这是**上游 CDN 的陈旧副本**，不是本 Worker 缓存了内容，也不是安全漏洞
- **加 `?cb=时间戳` 之类的 query 参数无法绕过**：raw 的缓存键是 `vary: Authorization, Accept-Encoding`，query string 不参与其中
- 要确认某个 ref 是否真的还存在，请查 `github.com` 的页面或 `https://api.github.com/repos/<owner>/<repo>/branches`（这些是动态的、不进这个缓存），**不要拿 raw 的可取性当判据**

## ❌ 错误处理

如果出现问题，你会看到以下错误消息之一：

- 🔧 **服务器GitHub TOKEN配置错误**：Worker 没有配置 `GH_TOKEN`
- 📂 **无法获取文件，检查路径或TOKEN是否正确**：文件路径错误，或令牌无权访问该文件
- 🚫 **非法路径**：路径中残留（含嵌套编码）了被编码的 `.` / `/` / `\`（`%2e` `%2f` `%5c`），已被拒绝
- 🚫 **Method Not Allowed**：只支持 `GET` / `HEAD`，其它方法返回 405
- ⚠️ **服务器内部错误**：发生了未预期的错误，细节只写在 Worker 日志里

# 📊 变量说明

| 变量名 | 示例 | 必填 | 备注 |
|--|--|--|--|
| GH_TOKEN| `ghp_xxxxxxxxxxxxxxxxxxxx` | ✅| 你的 GitHub 令牌 **token**，建议 Fine-grained、仅授予 `Contents: Read` |
| GH_NAME| `cmliu` | ❌| 你的 GitHub 用户名 |
| GH_REPO| `CF-Workers-Raw` | ❌| 你的 GitHub 仓库(必须设置 `GH_NAME` 变量为前提) |
| GH_BRANCH| `main` | ❌| 你的 GitHub 分支(必须设置 `GH_NAME` 和 `GH_REPO` 变量为前提) |
| URL302 | `https://t.me/CMLiussss` |❌| 主页302跳转 |
| URL | `https://github.com/cmliu/CF-Workers-Raw/blob/main/README.md` |❌| 主页伪装 |
| ERROR | `无法获取文件，检查路径或TOKEN是否正确。` |❌| 自定义错误提示 |

# 🙏 感谢
我自己的脑洞、ChatGPT
