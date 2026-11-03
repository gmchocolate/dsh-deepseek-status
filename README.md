# DeepSeek Status Lamp for DeepSeek Harness

A DeepSeek Harness plugin bundle that puts a **glowing
live status lamp in the left sidebar footer** and reveals the full DeepSeek platform
status when you hover it. Data comes from the public status page at
<https://status.deepseek.com/>.

## What you get

- A **light-tube style lamp** in the sidebar footer: a glass bezel holding ten lit
  segments, with a soft coloured bloom and a faint spill of light below it — 63px long
  in the wide sidebar, 41px in the collapsed 56px rail.
- **Colour = state**: green operational · blue maintenance · amber degraded · red partial
  or full outage · grey status unavailable. Amber breathes slowly, red pulses faster,
  and `prefers-reduced-motion` stops both.
- **Hover (or keyboard-focus) the lamp** for a card with the overall state, every service
  component grouped by section with its own state, each active incident or maintenance
  window with its latest update, affected components and update time, plus the upstream
  source name.
- Text is localized (English and Chinese) through the host locale service, and every
  colour is a host theme token, so it follows the app's light/dark theme.

## How it gets the data

`status.deepseek.com` is a Next.js app-router page: live data arrives inside the served
HTML as a React flight payload, and the origin sends no CORS headers, so a browser cannot
read it directly. The bundle therefore has two halves:

```
status.deepseek.com ──fetch(HTML + flight payload)──▶ Host half
                                                       │ derive one normalized snapshot
                                                       ▼
                        GET /plugins/deepseek-status.json  (same origin)
                                                       │
                                                       ▼
                                                    Client half
```

- **Host half** (`index.js`) fetches the page every 90s, decodes the `initialData` prop
  (component catalog + active changes, whose `affected_components[].status` carries each
  component's current state) and normalizes it. If the payload cannot be parsed it falls
  back to the `history.rss` incident feed. It serves the result as same-origin JSON on an
  exact route, so it cannot shadow other routes or the SPA fallback.
- **Client half** (`client.js`) registers into the `sidebar.footer.action` slot, polls the
  Host route every 60s (and when the tab becomes visible again), and draws the lamp plus
  the hover card.

The browser never calls the status site directly.

## Install

The bundle is meant to be installed into a DeepSeek Harness profile with
`plugin_manager install_bundle` (the absolute package directory as `target`).

```bash
git clone https://github.com/gmchocolate/dsh-deepseek-status.git
```

Then, from a Harness session, install the checked-out directory:

```
plugin_manager(action: "install_bundle", target: "<absolute path>/dsh-deepseek-status")
```

Reload the Web page once after installation; the client bundle is served per page load.

## Development

```bash
npm test        # flight-payload parsing, normalization, client render (offline)
npm run test:live   # optional: parse the real status page right now
```

There are no dependencies and no build step: the Host half is a plain Cordis plugin and
the Client half is a plain lazy module (`window.__ModuleLoader__.load`). The tests use only
Node built-ins and a tiny React stand-in, so they run offline.

Runtime tunables live at the top of `index.js` (`REFRESH_MS`, `ROUTE_PATH`,
`FETCH_TIMEOUT_MS`) because a dependency-free bundle cannot declare a
`schemastery`-typed `Config`. The lamp geometry lives in `client.js` (`LAMP_CELLS` selects
the segment count; `.dss-cell` width/height set the tube's proportions).

## Files

| File | Role |
| --- | --- |
| `index.js` | Host half: upstream fetch, parse, normalize, poller, JSON route. |
| `client.js` | Client half: lazy module factory, slot registration, lamp and hover card, EN/ZH dictionaries. |
| `cordis.patch.yml` | Bundle patch that inserts the `deepseek-status` row. |
| `locale/*.json` | Plugin Manager display metadata. |
| `icon.svg` | Plugin icon (original artwork). |
| `test/*.mjs` | Offline tests plus an optional live smoke test. |

## Limits

- The JSON route answers any same-origin GET/HEAD without authentication. It carries only
  public status-page data and is bound to the Harness listener (loopback by default).
- The upstream payload shape belongs to the current Flashcat-hosted status page. A redesign
  there degrades to the RSS fallback, then to the grey "unavailable" lamp.
- The hover card is rendered with `position: fixed` from the slot's own measure step; a
  host layout that gives a sidebar ancestor a `transform` would offset it.

## 中文说明

左侧栏底部会亮起一根**发光灯管**：绿＝全部正常，蓝＝维护，琥珀＝性能下降，红＝部分或完全中断，灰＝取不到状态；
鼠标移上去（或键盘聚焦）即可展开完整状态卡片——整体状态、按分组列出的全部服务组件、进行中的事件/维护及其最新更新、影响范围与更新时间。

数据来源是公开的 <https://status.deepseek.com/>：Host 侧每 90 秒抓一次页面（解析 Next.js flight payload，失败时退回 RSS 事件流），
经同源 JSON 路由 `/plugins/deepseek-status.json` 提供；Client 侧每 60 秒刷新一次并负责渲染。安装后用一次页面刷新即可看到效果。

## License

[MIT](./LICENSE) © 2026 Nathan
