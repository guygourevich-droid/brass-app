// Cloudflare edge: the app is static files; this sends www to the bare domain and maps "/" to index.html
// (assets use html_handling "none" so ninja.html etc. are served as-is, with no redirects the service worker would trip on).
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www.tonebee.app") {
      url.hostname = "tonebee.app";
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === "/") {
      url.pathname = "/index.html";
      return env.ASSETS.fetch(new Request(url, request));
    }
    return env.ASSETS.fetch(request);
  }
};
