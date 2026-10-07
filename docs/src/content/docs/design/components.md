---
title: Components
description: The badges, event cards, skeletons and other shared pieces of the web UI, and the tokens they use.
---

The web UI's shared pieces live in [`web/src/ui.ts`](https://github.com/timmo001/triage/blob/main/web/src/ui.ts) and take their sizes and colours from the [design tokens](/design). Icons come from [Material Design Icons](https://pictogrammers.com/library/mdi/).

## Badges

A badge is a pill with an icon, an optional label and its content, after Home Assistant's. Its icon takes the colour in `--badge-color`, which is `accent` unless a state or severity sets another.

| Variant | Height | Icon | Label | Content | Used for |
| --- | --- | --- | --- | --- | --- |
| Standard | 2.25rem | 1.15em | `xs` | `s` | Not used yet |
| `small` | 1.75rem | 1.15em | none | `s`, on one line | Issue states and filter counts |
| `dense` | 2rem | 1em | `2xs` | `xs` | Event details |

Each has a 1px `border` outline on `surface`, with the pill radius.

### Issue states

| State | Icon | Colour |
| --- | --- | --- |
| New | `star-four-points-outline` | `new` |
| Regressed | `alert-decagram-outline` | `regressed` |
| Ongoing | `progress-clock` | `ongoing` |
| Quiet | `sleep` | `quiet` |
| Resolved | `check-circle-outline` | `resolved` |
| Muted | `bell-off-outline` | `muted-state` |

### Filter counts

Each filter in the filter panel shows how many of its options are shown, such as 3/6, as a `small` badge with an `eye-outline` icon. The icon is `muted` by default, and `accent` when the filter is narrowed from its default.

## Event cards

Each event on an issue's page is a card on `surface` with a `border` outline and the `md` radius. From the top:

1. **Severity**, `s` and semibold, with its icon, both in the severity's colour.
2. **Message**, `l` and medium, in the body font.
3. **Time**, `s` and `muted`, with a `clock-outline` icon, such as "2 days ago". Hovering shows the full date and time.
4. **Details**, a row of `dense` badges. The row scrolls sideways, with a fade at each end that follows the scroll position, and can be dragged with a mouse.
5. **Dropdowns** for the stack trace and the lines logged before it, each showing a preview of its first frame or last line.

### Severities

| Severity | Icon | Colour |
| --- | --- | --- |
| emerg, alert, crit | `alert-octagon-outline` | `regressed` |
| err | `alert-circle-outline` | `regressed` |
| warning | `alert-outline` | `ongoing` |
| notice, info | `information-outline` | `new` |
| debug | `bug-outline` | `muted-state` |

### Details

Each detail shows only when the event has it:

| Label | Icon | Shows |
| --- | --- | --- |
| Host | `server` | The name the host was enrolled with |
| Source | `notebook-outline` | Where the event was read from |
| Program | `application-outline` | The program that logged it |
| Unit | `cog-outline` | The systemd unit, and whether it's a user or system one |
| Executable | `file-cog-outline` | For crashes, the program that crashed |
| Signal | `lightning-bolt` | For crashes, the signal that ended it |
| Result | `exit-to-app` | For failed units, how it failed |
| Killed | `skull-outline` | For out-of-memory kills, the process killed |
| Package | `package-variant-closed` | The package that owns the program, and its version |
| OS | `linux` | The operating system |
| Kernel | `chip` | The kernel version |
| Boot | `power` | The boot the event happened in |

## Lists

The issues list and an issue's events are virtual lists: only the rows near the screen are in the page, and more load as you scroll, 100 issues or 20 events at a time.

## Skeletons

While something loads, skeletons in `border` stand in for it, in the same shape, and pulse unless the system asks for reduced motion. The issues list fills the window with skeleton rows, and an issue's page shows its title, details and three event cards as skeletons. While the next page loads, a few more show at the end of the list.

## Buttons

Buttons are on `surface` with a `border` outline and the `sm` radius. A pressed button, such as an active label, takes `accent` for its outline and text.
