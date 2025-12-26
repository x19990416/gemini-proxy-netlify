const UPSTREAM_ORIGIN = "https://generativelanguage.googleapis.com";

function stripGatewayPrefix(pathname: string) {
  const prefix = "/.netlify/functions/gateway";
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
}

function sanitizeRequestHeaders(inHeaders: Headers) {
  const h = new Headers(inHeaders);
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
  // CORS（只给 Python 用可删）
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

  // 可选门禁
  const gateToken = process.env.PROXY_TOKEN;
  if (gateToken) {
    const got = req.headers.get("x-proxy-token");
    if (got !== gateToken) return new Response("Unauthorized", { status: 401 });
  }

  // Key：客户端优先，其次 env
  const keyFromHeader = req.headers.get("x-goog-api-key")?.trim() || "";
  const keyFromBearer =
    req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ||
    "";
  const apiKey =
    keyFromHeader || keyFromBearer || (process.env.GEMINI_API_KEY?.trim() || "");

  if (!apiKey) {
    return new Response(
      "Missing API key. Provide x-goog-api-key (or Authorization: Bearer), or set GEMINI_API_KEY.",
      { status: 400 }
    );
  }

  // 上游 URL
  const url = new URL(req.url);
  const upstreamPath = stripGatewayPrefix(url.pathname);
  const upstreamUrl = new URL(upstreamPath + url.search, UPSTREAM_ORIGIN);
  upstreamUrl.searchParams.delete("key"); // 防止有人把 key 放 query 泄漏

  const headers = sanitizeRequestHeaders(req.headers);
  headers.set("x-goog-api-key", apiKey);

  const method = req.method.toUpperCase();
  const hasBody = !["GET", "HEAD"].includes(method);

  const upstreamResp = await fetch(upstreamUrl.toString(), {
    method,
    headers,
    body: hasBody ? req.body : undefined,
    duplex: "half" as any, // ✅ 关键修复
    redirect: "manual",
  });

  const outHeaders = new Headers(upstreamResp.headers);
  outHeaders.set("cache-control", "no-store");
  outHeaders.set("access-control-allow-origin", "*");

  return new Response(upstreamResp.body, {
    status: upstreamResp.status,
    headers: outHeaders,
  });
};
