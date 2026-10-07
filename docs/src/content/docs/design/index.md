---
title: Tokens
description: The design tokens behind the web UI's type, spacing, shape and colours.
---

The web UI takes its type, spacing, shape and colours from one set of design tokens in [`web/src/design.css`](https://github.com/timmo001/triage/blob/main/web/src/design.css), modelled on Home Assistant's. Components use the tokens rather than raw values, so a change there applies everywhere.

Sizes are in rem, so the whole UI follows the browser's font size. Colours are in OKLCH; see [Colours](/design/colours). Badges and the other shared pieces are on [Components](/design/components).

Headings are bold with a 1.2 line height: `h1` is `3xl` and `h2` is `2xl`.

The values in the tables are generated from `design.css` by `mise run docs:gen`. The "Used for" columns are written by hand and kept when the tables are regenerated.

## Type

The body uses the system font and code uses the system monospace font:

<!-- generated:font-families -->

| Token | Value |
| --- | --- |
| `--triage-font-family-body` | `system-ui, -apple-system, "Segoe UI", sans-serif` |
| `--triage-font-family-code` | `ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", monospace` |

<!-- /generated:font-families -->

Font sizes are multiplied by `--triage-font-size-scale`, which is `1` by default:

<!-- generated:font-sizes -->

| Token | Size |
| --- | --- |
| `--triage-font-size-2xs` | 0.6875rem |
| `--triage-font-size-xs` | 0.75rem |
| `--triage-font-size-s` | 0.875rem |
| `--triage-font-size-m` | 1rem |
| `--triage-font-size-l` | 1.125rem |
| `--triage-font-size-xl` | 1.25rem |
| `--triage-font-size-2xl` | 1.5rem |
| `--triage-font-size-3xl` | 2rem |
| `--triage-font-size-4xl` | 2.5rem |

<!-- /generated:font-sizes -->

<!-- generated:font-weights -->

| Weight | Value | Line height | Value |
| --- | --- | --- | --- |
| `--triage-font-weight-normal` | 400 | `--triage-line-height-condensed` | 1.2 |
| `--triage-font-weight-medium` | 500 | `--triage-line-height-normal` | 1.5 |
| `--triage-font-weight-semibold` | 600 | `--triage-line-height-expanded` | 2 |
| `--triage-font-weight-bold` | 700 | | |

<!-- /generated:font-weights -->

## Spacing

Spacing goes up in quarter rem steps, like Home Assistant's 4px ones. The number is the size in quarter rems:

<!-- generated:spacing -->

| Token | Size |
| --- | --- |
| `--triage-space-0-5` | 0.125rem |
| `--triage-space-1` | 0.25rem |
| `--triage-space-1-5` | 0.375rem |
| `--triage-space-2` | 0.5rem |
| `--triage-space-3` | 0.75rem |
| `--triage-space-4` | 1rem |
| `--triage-space-5` | 1.25rem |
| `--triage-space-6` | 1.5rem |
| `--triage-space-8` | 2rem |
| `--triage-space-10` | 2.5rem |
| `--triage-space-12` | 3rem |

<!-- /generated:spacing -->

## Shape

<!-- generated:shape -->

| Token | Value | Used for |
| --- | --- | --- |
| `--triage-border-width` | 1px | Every border |
| `--triage-border-radius-xs` | 0.25rem | Small details |
| `--triage-border-radius-sm` | 0.375rem | Buttons, inputs, dropdowns and code blocks |
| `--triage-border-radius-md` | 0.5rem | Cards, tables, the issues list and menus |
| `--triage-border-radius-lg` | 0.75rem | The top corners of the filter sheet on narrow screens |
| `--triage-border-radius-pill` | 9999px | Badges and the filter count |

<!-- /generated:shape -->

## Motion

<!-- generated:motion -->

| Token | Value | Reduced motion |
| --- | --- | --- |
| `--triage-duration-fast` | 150ms | 1ms |
| `--triage-duration-normal` | 250ms | 1ms |

<!-- /generated:motion -->

## Elevation

<!-- generated:elevation -->

| Token | Value | Used for |
| --- | --- | --- |
| `--triage-scrim` | `oklch(0% 0 0 / 40%)` | Behind the filter sheet and menus |
| `--triage-shadow` | `0 0.5rem 1.5rem oklch(0% 0 0 / 40%)` | Under menus |

<!-- /generated:elevation -->
