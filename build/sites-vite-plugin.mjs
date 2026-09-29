/**
 * Local stand-in for the Sites platform plugin, which is not in this source dump.
 * Provides the development sign-in the app and smoke tests expect.
 */
const COOKIE = "sites_session";
const USER_ID = "local_seedy";
const EMAIL = "seedy@local.test";
const FULL_NAME = "Local Seedy";

export function sites({ mockAuth = false } = {}) {
  return {
    name: "sites-local-auth",
    configureServer(server) {
      if (!mockAuth) return;
      const handle = (req, res, next) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");

        if (url.pathname === "/signin-with-chatgpt") {
          const returnTo = safeReturn(url.searchParams.get("return_to"));
          res.statusCode = 302;
          res.setHeader(
            "Set-Cookie",
            `${COOKIE}=${USER_ID}; Path=/; HttpOnly; SameSite=Lax`,
          );
          res.setHeader("Location", returnTo);
          res.end();
          return;
        }

        if (url.pathname === "/signout-with-chatgpt") {
          const returnTo = safeReturn(url.searchParams.get("return_to"));
          res.statusCode = 302;
          res.setHeader(
            "Set-Cookie",
            `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
          );
          res.setHeader("Location", returnTo);
          res.end();
          return;
        }

        // Identity headers only ever come from this mock, never the client.
        for (const name of Object.keys(req.headers)) {
          if (name.toLowerCase().startsWith("oai-")) delete req.headers[name];
        }
        for (let i = (req.rawHeaders?.length ?? 0) - 2; i >= 0; i -= 2) {
          if (String(req.rawHeaders[i]).toLowerCase().startsWith("oai-")) req.rawHeaders.splice(i, 2);
        }

        const cookie = String(req.headers.cookie || "");
        if (cookie.split(";").some((part) => part.trim() === `${COOKIE}=${USER_ID}`)) {
          req.headers["oai-authenticated-user-id"] = USER_ID;
          req.headers["oai-authenticated-user-email"] = EMAIL;
          req.headers["oai-authenticated-user-full-name"] = encodeURIComponent(FULL_NAME);
          req.headers["oai-authenticated-user-full-name-encoding"] = "percent-encoded-utf-8";
        }

        next();
      };
      return () => {
        server.middlewares.stack.unshift({ route: "", handle });
      };
    },
  };
}

function safeReturn(value) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}
