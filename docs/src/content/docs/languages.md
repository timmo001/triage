---
title: Languages
description: The languages triage's web UI and Home Assistant app come in, and how to help translate them.
---

The web UI and the [Home Assistant app](/install#home-assistant)'s options come in these languages:

| Code | Language |
| --- | --- |
| `en` | English |
| `de` | Deutsch (German) |
| `es` | Español (Spanish) |
| `fr` | Français (French) |
| `it` | Italiano (Italian) |
| `ja` | 日本語 (Japanese) |
| `nl` | Nederlands (Dutch) |
| `pl` | Polski (Polish) |
| `pt-BR` | Português (Brasil) (Brazilian Portuguese) |
| `zh-Hans` | 简体中文 (Simplified Chinese) |

The command line, the docs and the [MCP server](/agents) are in English only.

## Choose a language

The web UI is in English unless an admin picks another language for the server. Everyone using that server sees the same one.

- On the server, set [`TRIAGE_LANGUAGE`](/configuration#server), or pass `--language` to `triage serve`.
- In the Home Assistant app, set the **language** option. Home Assistant shows the app's options in your own Home Assistant language, if triage has it.

The server won't start with a language it doesn't have, and says which ones it does.

## Help translate

The translations are AI-generated, so some may read oddly or use the wrong word. Corrections and new languages are very welcome, from a single word to a whole file.

The translations are in two places:

- `web/translations/<code>.jsonc` for the web UI. `en.jsonc` is the source, and its comments explain where each message appears and what its placeholders hold.
- `home-assistant/app/translations/<code>.yaml` for the Home Assistant app's options.

Keep the placeholders in braces, such as `{count}`, exactly as they are, though they can move within the sentence. Messages that depend on a number have plural forms, and each language needs `other` plus the forms it uses, such as `one`, `few` and `many`.

To add a language, copy both English files to the new language's code, translate them, and add the code to the **language** option's `list(...)` in `home-assistant/app/config.yaml`.

Then check your changes with:

```bash
mise run translations:check
```

It checks every translation has English's messages, placeholders and the plural forms its language needs, and that the web UI and the app have the same languages. When you change the English messages themselves, run `mise run translations:gen` too.
