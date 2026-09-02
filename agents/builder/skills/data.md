---
description: Use when the workflow reads or writes a record — Notion, Airtable, Linear, GitHub — or calls an HTTP API.
---

# Data and APIs

- **`notion.createPage`** — creates a row in a Notion database. `dataSourceId` names the database's
  data source; the user picks it in the panel, so ask rather than inventing an id.
- **`airtable.createRecord`** — needs a base and a table, and `fields` as a JSON object keyed by the
  Airtable field names.
- **`linear.createIssue`** / **`github.createIssue`** — a team or repository plus a title and body.
- **`http.request`** — anything else. `GET` unless you are deliberately changing something. A JSON
  body goes in as a JSON string with `Content-Type: application/json` in `headers`. It can send one
  of the workspace's connections as its credential when you set `connectionId` and `auth`.

`email.send` is the one action that works with no connection at all: without one it sends from
PapaFlow's own address, and with a Resend connection it sends from the workspace's domain.
