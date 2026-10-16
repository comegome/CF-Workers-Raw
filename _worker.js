// CF-Workers-Raw —— 通过 Cloudflare Workers 访问 GitHub 私有仓库的 raw 文件
//
// 设计取舍（本 fork）：
//   * 只保留一个服务器端令牌 GH_TOKEN。调用方不需要、也无法提供任何令牌，
//     也不存在"路径专用令牌"这类配置。端点因此是公开的 —— 请用
//     「不公开的地址 + 最小权限令牌 + GH_NAME/GH_REPO 钉死仓库」来收敛风险；
//     需要真正的访问控制时，在 Worker 前面挂 Cloudflare Access，而不是在代码里手搓令牌。
//   * 令牌只存在于 env 中：不写进 URL、不回给调用方、不进日志。
//
// 历史缺陷：此前的版本把令牌存在模块作用域的变量里跨请求复用，导致匿名请求
// 读到上一个请求残留的服务器令牌（鉴权绕过）。现在每请求直接读 env.GH_TOKEN，
// 不存在任何跨请求可变状态。
//
// 其它要点：
//   1. 全流程 try/catch，意外错误不把内部细节吐给调用方。
//   2. 只接受 GET / HEAD；其它方法 405。HEAD 会原样传给上游，不会白下载整个文件。
//   3. 转发 Range / If-None-Match / If-Modified-Since，支持断点续传与条件请求。
//   4. 路径穿越防护：URL 解析器先归一化点段；代码再多轮解开 %XX 转义，拦住
//      残留与嵌套编码的分隔符（只用单字节转义正则解，不用 decodeURIComponent ——
//      后者会被畸形编码掩护过去，见 hasNestedTraversal）。
//   5. 304 / 204 / 205 等无正文状态用 null 作为 body 透传，否则 Response 构造会抛 TypeError。
//   6. 3xx 原样透传（保住 Location），不当成错误。
//   7. 配了 GH_NAME 就严格钉死仓库，完整 raw URL 形态无法绕过。
//   8. 首页伪装分支不转发调用方的请求头，且 HEAD 不会白下载整个伪装页。
//   9. 不再用 `URL` 作为变量名，避免遮蔽全局 WHATWG URL 构造器。

const GITHUB_RAW = 'https://raw.githubusercontent.com';

// 只转发这几个与"取文件"相关、无副作用的请求头
const FORWARD_REQUEST_HEADERS = ['range', 'if-none-match', 'if-modified-since'];

// Response 不允许携带正文的状态码（传了 body 会抛 TypeError）
const NULL_BODY_STATUS = new Set([204, 205, 304]);

// 只做取文件这一件事
const ALLOWED_METHODS = new Set(['GET', 'HEAD']);

const NGINX_PAGE = `
	<!DOCTYPE html>
	<html>
	<head>
	<title>Welcome to nginx!</title>
	<style>
		body {
			width: 35em;
			margin: 0 auto;
			font-family: Tahoma, Verdana, Arial, sans-serif;
		}
	</style>
	</head>
	<body>
	<h1>Welcome to nginx!</h1>
	<p>If you see this page, the nginx web server is successfully installed and
	working. Further configuration is required.</p>

	<p>For online documentation and support please refer to
	<a href="http://nginx.org/">nginx.org</a>.<br/>
	Commercial support is available at
	<a href="http://nginx.com/">nginx.com</a>.</p>

	<p><em>Thank you for using nginx.</em></p>
	</body>
	</html>
	`;

export default {
	async fetch(request, env) {
		try {
			return await handleRequest(request, env);
		} catch (err) {
			// 内部错误细节不回给调用方，只写日志
			console.error('cf-workers-raw:', (err && err.stack) || err);
			// 只暴露错误类型名（不含堆栈或内部数据），方便用 curl -I 一眼看出是哪类异常
			const errName = (err && err.name) || 'Error';
			return new Response('服务器内部错误', { status: 500, headers: { 'x-raw-error': errName } });
		}
	}
};

async function handleRequest(request, env) {
	// 这个 Worker 只做一件事：取文件。其它方法不给用。
	if (!ALLOWED_METHODS.has(request.method)) {
		return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
	}

	const url = new URL(request.url);

	// 首页：伪装页 / 跳转
	if (url.pathname === '/') return await serveHome(request, env);

	if (!env.GH_TOKEN) return new Response('服务器GitHub TOKEN配置错误', { status: 500 });

	if (hasNestedTraversal(url.pathname)) return new Response('非法路径', { status: 400 });

	const headers = new Headers();
	for (const name of FORWARD_REQUEST_HEADERS) {
		const value = request.headers.get(name);
		if (value) headers.set(name, value);
	}
	// 唯一的凭据来源：Worker 的环境变量
	headers.set('Authorization', `token ${String(env.GH_TOKEN).trim()}`);

	// HEAD 原样传上去，让上游只回头部，不白下载整个文件
	const response = await fetch(buildUpstreamUrl(url, env), { method: request.method, headers });

	// 304 / 204 / 205 这类「无正文状态」必须用 null 作为 body，否则 Response 构造会抛
	// TypeError（再被上面的 catch 变成 500）。浏览器带 If-None-Match / If-Modified-Since
	// 做条件请求时上游就会回 304 —— 原样转给客户端，让它继续用本地缓存。
	if (NULL_BODY_STATUS.has(response.status)) {
		return new Response(null, { status: response.status, headers: response.headers });
	}

	// 3xx：原样透传。关键是保住 Location —— 当成错误处理会把跳转变成一个没有目标的空状态码。
	// 说明：fetch 默认 redirect: 'follow'，301/302/303/307/308 会在 Worker 内部被跟随掉，
	// 能落到这里的只有 300/305/306，以及 Location 缺失或不合法的 3xx（规范规定原样返回）。
	if (response.status >= 300 && response.status < 400) {
		return new Response(null, { status: response.status, headers: response.headers });
	}

	if (!response.ok) {
		return new Response(env.ERROR || '无法获取文件，检查路径或TOKEN是否正确。', { status: response.status });
	}
	return new Response(response.body, { status: response.status, headers: response.headers });
}

/**
 * 组装上游 URL。目标主机恒为 raw.githubusercontent.com，不会成为开放代理。
 */
function buildUpstreamUrl(url, env) {
	const ghName = cleanSegment(env.GH_NAME);
	const ghRepo = cleanSegment(env.GH_REPO);
	const ghBranch = cleanSegment(env.GH_BRANCH);

	// 配了 GH_NAME 就严格钉死，绝不给「完整 raw URL」形态绕过的机会。
	// 否则攻击者只要访问
	//   https://<你的域名>/https://raw.githubusercontent.com/<你账号下别的私有库>/main/...
	// 就能用你的令牌读走它有权访问的所有仓库 —— 钉死形同虚设。
	// 这种请求现在会被当成钉死前缀下的普通路径，由上游返回 404（失败即关闭）。
	if (ghName) {
		let target = GITHUB_RAW + '/' + ghName;
		if (ghRepo) {
			target += '/' + ghRepo;
			if (ghBranch) target += '/' + ghBranch;
		}
		return target + url.pathname;
	}

	// 没有钉死时才兼容完整 URL 形态。
	// 用 indexOf 而不是 new RegExp(GITHUB_RAW, 'i')：后者里的 `.` 会匹配任意字符。
	const index = url.pathname.toLowerCase().indexOf(GITHUB_RAW);
	if (index !== -1) return GITHUB_RAW + url.pathname.slice(index + GITHUB_RAW.length);

	return GITHUB_RAW + url.pathname;
}

/**
 * 路径穿越防护：判断路径里是否藏了「解码之后才会露出来」的 `.` / `/` / `\`。
 *
 * URL 解析器已在**解析阶段**把 `.` / `..` / `%2e%2e` 这类"点段"归一化掉，所以它们到不了这里；
 * 要挡的是**残留的编码分隔符**（%2e / %2f / %5c），包括嵌套编码（%252e 解一次才变 %2e）。
 *
 * 为什么用正则逐个解 %XX，而不是 decodeURIComponent：
 *   我们关心的 `%2e` / `%2f` / `%5c` / `%25` 全是**单字节 ASCII** 转义，根本不需要校验多字节
 *   UTF-8。而 decodeURIComponent 是整串解码，串里只要有一段畸形编码（如 %E0%A4%A）就整串抛
 *   URIError —— catch 后放行，攻击者把它和二重编码拼在同一段里就能掩护过去（实测绕过）；
 *   catch 后拦截，又会误杀 100%25.txt 这种"解到头"的合法路径。
 *   逐个替换合法的 %XX 互不干扰：畸形字节藏不住旁边的 %252e，而 100%.txt 里的 %.t 只是
 *   自然停止解码（next === current），零误杀且 fail-closed。
 */
function hasNestedTraversal(pathname, maxRounds = 4) {
	let current = pathname;
	for (let round = 0; round < maxRounds; round++) {
		if (/%2e|%2f|%5c/i.test(current)) return true;
		// 只解单字节转义，解不动的（畸形/残缺）原样留着
		const next = current.replace(/%[0-9a-f]{2}/gi, (match) =>
			String.fromCharCode(parseInt(match.slice(1), 16))
		);
		if (next === current) return false;
		current = next;
	}
	// 解满 maxRounds 轮仍在变化：套娃层数异常深，fail-closed
	return true;
}

/** 环境变量是在 Dashboard 里手填的，容忍首尾空白和多余的斜杠。 */
function cleanSegment(segment) {
	if (segment === undefined || segment === null) return '';
	return String(segment).trim().replace(/^\/+|\/+$/g, '');
}

async function serveHome(request, env) {
	const envKey = env.URL302 ? 'URL302' : (env.URL ? 'URL' : null);
	if (envKey) {
		// 刻意不转发调用方的请求头：旧实现用 new Request(picked, request)，会把
		// Authorization / Cookie 一并送给你在 URL 变量里配置的第三方地址。
		// 伪装页并不需要这些头。method 照传，HEAD 探测就不用把整页下载一遍。
		const candidates = splitList(env[envKey]);
		if (!candidates.length) return new Response('服务器内部错误', { status: 500 });
		const picked = candidates[Math.floor(Math.random() * candidates.length)];
		return envKey === 'URL302'
			? Response.redirect(picked, 302)
			: await fetch(picked, { method: request.method });
	}
	// 首页伪装页
	return new Response(NGINX_PAGE, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
}

/**
 * 把一串配置拆成数组。
 * 分隔符：空白（空格 / 制表 / 换行）、竖线、单双引号。
 * 注意：竖线会被当作分隔符，因此 URL 列表里不要出现 `|`。
 */
function splitList(raw) {
	if (typeof raw !== 'string') return [];
	const normalized = raw
		.replace(/[\s|"']+/g, ',') // 空白、竖线、引号 → 逗号
		.replace(/,+/g, ',')       // 折叠连续逗号
		.replace(/^,|,$/g, '');    // 去掉首尾逗号
	return normalized ? normalized.split(',').filter((item) => item !== '') : [];
}
