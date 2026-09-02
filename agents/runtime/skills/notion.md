---
description: Use when the goal is to log, record or file something as a row or page in Notion.
---

# Creating Notion pages

`notion_create_page` adds one page — a row — to a Notion database.

- `dataSourceId` names the database's data source. Use the id the goal gave you; there is no way to
  search for a database from here, so an absent id is a reason to stop, not to guess.
- `title` becomes the page's title, whatever that column is called in the database. The tool finds
  the title property itself.
- `properties` is a list of `{ key, value }` pairs written as text columns. A key naming the title
  column is ignored so it cannot overwrite the title.

Every value is written as plain text. A date, a select or a relation column will not accept it — put
that data in the title or the page body instead.
