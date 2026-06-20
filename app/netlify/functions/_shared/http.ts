// Minimal Response helpers for the Netlify (v2) function handlers.
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}
