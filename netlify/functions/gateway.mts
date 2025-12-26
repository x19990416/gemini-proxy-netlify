import type { Context } from "@netlify/functions";

const UPSTREAM = "https://generativelanguage.googleapis.com";

function stripGatewayPrefix(pathname: string) {
  // /.netlify/functions/gateway/xxxx -> /xxxx
  const prefix = "/.netlify/functions/gateway";
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
}

export default async (req: Request, _context: Context) => {
  // （可选）给浏览器用的话，处理一下预检
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "access-control-allow-headers": req.headers.get("access-control-request-headers") ?? "*",
      },
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return new Response("Missing GEMINI_API_KEY", { status: 500 });

  // （可选）简单鉴权：避免你的网站被别人当免费代理刷爆
  const token = process.env.PROXY_TOKEN;
  if (token) {
    const got = req.headers.get("x-proxy-token");
    if (got !== token) return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const upstreamPath = stripGatewayPrefix(url.pathname);
  const upstreamUrl = new URL(upstreamPath + url.search, UPSTREAM);

  const headers = new Headers(req.headers);
  headers.set("x-goog-api-key", apiKey);
  headers.delete("host");
  // 可选：避免压缩带来的麻烦（一般不需要）
  // headers.delete("accept-encoding");

  const upstreamResp = await fetch(upstreamUrl, {
    method: req.method,
    headers,
    body: req.body, // 直接透传（流式）
    redirect: "manual",
  });

  const outHeaders = new Headers(upstreamResp.headers);

  // （可选）如果你要给浏览器用，加 CORS
  outHeaders.set("access-control-allow-origin", "*");

  return new Response(upstreamResp.body, {
    status: upstreamResp.status,
    headers: outHeaders,
  });
};
