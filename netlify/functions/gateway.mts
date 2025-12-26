const UPSTREAM_ORIGIN = "https://generativelanguage.googleapis.com";

// 去掉 Netlify 函数前缀：/.netlify/functions/gateway -> ""
function stripGatewayPrefix(pathname: string) {
  const prefix = "/.netlify/functions/gateway";
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
}

// 移除 hop-by-hop headers（避免代理相关问题）
function sanitizeRequestHeaders(inHeaders: Headers) {
  const h = new Headers(inHeaders);

  // 一些 hop-by-hop 头（按需增减）
  const hopByHop = [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
  ];
  for (const k of hopByHop) h.delete(k);

  return h;
}

export default async (req: Request) => {
  // ===== CORS（如果你只给 Python 用，也可以删掉这段）=====
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "access-control-allow-headers":
          req.headers.get("access-control-request-headers") ?? "*",
        "access-control-max-age": "86400",
      },
    });
  }

  // ===== 可选：代理门禁，防止别人把你当免费网关刷爆 =====
  const gateToken = process.env.PROXY_TOKEN;
  if (gateToken) {
    const got = req.headers.get("x-proxy-token");
    if (got !== gateToken) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // ===== 取 Gemini Key：优先客户端上传，其次服务端 env（可选）=====
  const keyFromHeader = req.headers.get("x-goog-api-key")?.trim() || "";
  const keyFromBearer =
    req.headers
      .get("authorization")
      ?.match(/^Bearer\s+(.+)$/i)?.[1]
      ?.trim() || "";

  const apiKey = keyFromHeader || keyFromBearer || (process.env.GEMINI_API_KEY?.trim() || "");

  if (!apiKey) {
    return new Response(
      "Missing API key. Provide x-goog-api-key header (or Authorization: Bearer), or set GEMINI_API_KEY in Netlify env.",
      { status: 400 }
    );
  }

  // ===== 拼接上游 URL =====
  const url = new URL(req.url);
  const upstreamPath = stripGatewayPrefix(url.pathname);
  const upstreamUrl = new URL(upstreamPath + url.search, UPSTREAM_ORIGIN);

  // 如果有人把 key 放在 query 里（?key=xxx），为了避免泄漏，转发前剔除
  upstreamUrl.searchParams.delete("key");

  // ===== 构造转发请求 =====
  const headers = sanitizeRequestHeaders(req.headers);
  headers.set("x-goog-api-key", apiKey);

  // 对于 GET/HEAD 不传 body
  const method = req.method.toUpperCase();
  const hasBody = !["GET", "HEAD"].includes(method);

  const upstreamResp = await fetch(upstreamUrl.toString(), {
    method,
    headers,
    body: hasBody ? req.body : undefined, // 直接透传（支持流式）
    redirect: "manual",
  });

  // ===== 透传响应 =====
  const outHeaders = new Headers(upstreamResp.headers);
  outHeaders.set("cache-control", "no-store");
  outHeaders.set("access-control-allow-origin", "*"); // 浏览器用；不需要可删

  return new Response(upstreamResp.body, {
    status: upstreamResp.status,
    headers: outHeaders,
  });
};
