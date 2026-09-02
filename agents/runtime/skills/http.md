---
description: Use when the goal needs data from a public web API that no other tool covers.
---

# Calling an HTTP API

`http_request` performs one request and returns `{ status, headers, body }`. JSON bodies come back
parsed.

It sends **no credentials**. Anything behind a login, an API key or an OAuth token is out of reach —
that is what the connector tools are for. If the goal needs an authenticated API this workspace has
no connection for, say so rather than trying a URL and reporting the 401.

- Use `GET` unless the goal is explicitly asking you to create or change something.
- `body` is sent raw, so JSON goes in as a JSON string with `Content-Type: application/json` in
  `headers`.
- A 4xx is the request being wrong. Read the body, and do not send the same request again.
