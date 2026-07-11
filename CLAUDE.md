# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Restaurant Pilot: a single-restaurant POS/backoffice built entirely as a custom Odoo 17 module (`addons/restaurant_starter`). There is no separate frontend or API server — a legacy React/Flask portal was archived to `_archived/portal` and nothing depends on it anymore. All backoffice features (dashboard, catalog, stock, users, audit log) live inside Odoo; POS checkout itself uses Odoo's native `point_of_sale`/`pos_restaurant` apps.

Stack: Odoo 17 + PostgreSQL 14, run via Docker Compose. Config is French (UI strings, docstrings, commit messages) — match that convention when editing the module.

## Common commands

Setup (first time):
```powershell
Copy-Item .env.example .env
Copy-Item config/odoo.conf.example config/odoo.conf
# edit admin_passwd in config/odoo.conf
docker compose up -d
```
Open http://localhost:8071 and create a database (local convention: `ecole-db`).

Install/upgrade the module after changing Python/XML/data files:
```powershell
docker compose exec -T odoo odoo -d ecole-db -u restaurant_starter --stop-after-init --no-http --log-level=warn
docker compose restart odoo
```

Bootstrap accounting + POS payment methods (required once per fresh DB, before the first POS session — idempotent, safe to re-run):
```powershell
docker compose exec -T odoo odoo shell -d ecole-db --no-http < scripts/setup_pos.py
docker compose restart odoo
```
This installs the Senegal SYSCOHADA chart of accounts, forces currency to XOF, and creates Especes/Wave/Orange Money payment methods with their journals.

Import demo catalog (100 products from `addons/restaurant_starter/import_payload/`):
```powershell
docker compose exec -T odoo odoo shell -d ecole-db --no-http < addons/restaurant_starter/scripts/import_products.py
```
(`scripts/generate_restaurant_products.py` is the offline generator that produced `import_payload/products.json` + images; it doesn't touch the running instance.)

Verify server-side logic without an admin password (HTTP auth isn't available since the password is set at DB creation): pipe Python into `odoo shell` rather than curling the web UI.
```powershell
docker compose exec -T odoo odoo shell -d ecole-db --no-http --log-level=error
```

Run the module's automated tests (they run inside a rolled-back transaction, so it's safe to run against `ecole-db` — no need for a throwaway database):
```powershell
docker compose exec -T odoo odoo -d ecole-db -u restaurant_starter --test-enable --stop-after-init --log-level=test
```
Coverage is a starting point, not exhaustive: role→group sync (`tests/test_res_users.py`), the per-role menu visibility (`tests/test_menu_access.py`), `resto.restaurant`/cashier-lock behavior (`tests/test_restaurant.py`), and the dashboard export logic/template (`tests/test_dashboard.py`). Nothing exercises the dashboard's JS itself. `HttpCase` tests that `self.authenticate()` then immediately `self.url_open()` an `auth="user"` route were flaky in this environment (server treated the request as anonymous despite a successful login) — prefer testing controller helper functions/QWeb templates directly from a `TransactionCase` where the code allows it, and verify the real route manually if needed (`odoo shell` to mint a session, `curl --cookie "session_id=..."` against the running container) rather than fighting the test harness.

## Architecture

Everything of substance is in `addons/restaurant_starter/`:

- `models/restaurant.py` — `resto.restaurant` (the single restaurant record) and a `pos.config` extension (`resto_lock_cashier_to_user`) that restricts the POS cashier-selection dropdown to the logged-in user unless they're a POS manager.
- `models/res_users.py` — adds `resto_role` (`super_admin` / `manager` / `cashier` / `stock_manager`) to `res.users`. Writing `resto_role` (or creating a user) triggers `_sync_resto_role_groups`, which reconciles the user's `groups_id` against the four `ROLE_GROUP_XMLIDS` role groups so Odoo's native POS/stock security groups always match the selected role — role and security-group membership must never be edited independently of each other. It also strips the `GROUPS_TO_RESET_XMLIDS` list (Sales/Purchase/Manufacturing/HR/Accounting "Administrator" groups, plus POS/Stock) before re-linking the target role group, because Odoo's own default-user template otherwise grants every new internal user broad admin rights on those apps regardless of `resto_role`; the legitimate POS/Stock groups come back automatically via the target group's `implied_ids`.
- `views/menu_views.xml` — every `Restaurant/*` submenu declares its own `groups` (Odoo does not cascade a parent menu's `groups` to its children — see gotcha below), scoped to whichever `group_resto_*` roles should see it: Caisse (cashier+), Catalogue/Stock (manager + stock_manager), Tableau de bord/Paramètres-Restaurant/Moyens de paiement (manager+), Utilisateurs/Audit (super_admin only).
- `models/audit_log.py` — `resto.audit.log`, a lightweight append-only log. Call `self.env["resto.audit.log"].log(event, payload)` (it runs `sudo()` internally) whenever a model gains a new mutating method that should be traceable; `restaurant.py` and `res_users.py` already do this on `write`/`create`.
- `controllers/dashboard.py` — one QWeb page (`/resto/dashboard`) plus one JSON-RPC endpoint (`/resto/dashboard/data`, POST) that aggregates POS KPIs (revenue, avg ticket, sales by day, category mix, low-stock count, top margins) from `pos.order`/`product.template` via `read_group`/`search_read`. The frontend is plain JS/Bootstrap inside `views/dashboard_templates.xml` (no build step, no framework) — it fetches `/resto/dashboard/data` and renders charts with Chart.js loaded from Odoo's own static libs. The `/resto/dashboard` page itself is never navigated to directly: `menu_resto_dashboard` points at `action_resto_dashboard_client` (`ir.actions.client`, tag `resto_dashboard_client_action`), a tiny OWL component in `static/src/js/dashboard_action.js` that embeds the page in an iframe so the page stays inside the backend shell (see gotcha below). `_build_dashboard_payload()` is the single source of truth for the numbers and is shared by the live JSON view and both exports: `/resto/dashboard/export.xlsx` (built in-memory with `xlsxwriter`) and `/resto/dashboard/export.pdf` (a separate print-only QWeb template, `resto_dashboard_report`, rendered to PDF via `ir.actions.report._run_wkhtmltopdf` — the live page's Chart.js canvases aren't reliably capturable by wkhtmltopdf, so the PDF re-renders the same data as plain HTML tables instead).
- `security/resto_groups.xml` — defines the four `group_resto_*` groups, each implying the matching native Odoo group (`point_of_sale.group_pos_manager/user`, `stock.group_stock_manager/user`). `group_resto_super_admin` additionally implies `base.group_erp_manager` (needed for write access to `res.users` — see gotcha below), but deliberately not `base.group_system`, to avoid exposing Odoo's full technical Settings app. `models/res_users.py` keeps `res.users.groups_id` in sync with these at runtime; this file only defines what the groups imply.
- `security/ir.model.access.csv` — access rules gate `resto.restaurant` and `resto.audit.log`; most other models rely on stock Odoo/POS/stock module ACLs.
- `migrations/17.0.3.0.0/post-migration.py` — data migration collapsing a since-removed multi-branch role model (`manager_parent`/`manager_branch`) into the current single `manager` role. Follow this pattern (module-version-named folder, `migrate(cr, version)`) for future data migrations rather than one-off SQL scripts.
- `data/` — demo data loaded on install (restaurants, product categories, products); `import_payload/` + `scripts/import_products.py` is a separate, larger bulk-import path used post-install, not part of module data.

`docker-compose.yml` keeps the Compose project name `salut-je-veux-g-rer-mon` (a pre-rename artifact) so existing local Docker volumes stay attached across the repo's rename to `pos-restaurant` — do not "fix" this without also migrating volumes.

## Odoo 17 gotchas hit in this codebase

- Chart-template loading (`account.chart.template.try_loading`) purges any `pos.payment.method` records that lack a journal — always create payment methods via `scripts/setup_pos.py` (or after the chart is loaded), never from module data XML.
- `%(xmlid)d` references in view archs must point to records defined earlier in the same file (or another file loaded earlier in the manifest `data` list).
- `base.user_groups_view` dynamically injects `groups_id` widgets into the users form — anchor custom xpaths on `//page[@name='access_rights']` instead of trying to extend `groups_id` directly.
- `web.report_assets_common` does not ship jQuery or Chart.js; load them from `/web/static/lib/...` if a QWeb template needs them (see `dashboard_templates.xml`).
- If a POS/self-order module gets uninstalled while old view data still references its fields, `ir.model.data` can leave orphan records that break `get_views` with an opaque OwlError — diagnose by replaying `Model.get_views(...)` in `odoo shell` and cross-checking every `<field>` in the arch against the returned `models` map; fix with `env['ir.model.data']._module_data_uninstall(['<module>'])`.
- `ir.actions.act_url` with `target="self"` does a real browser navigation and leaves the backend SPA entirely (no app menu, only the browser Back button gets you out) — this bit the dashboard menu item, since a parent app menu with no action of its own (`menu_resto_root`) auto-navigates to its first child's action when clicked. Prefer `ir.actions.client` (a small OWL component, optionally just an iframe wrapper around an existing controller page, as in `static/src/js/dashboard_action.js`) for anything that should stay inside the backend shell.
- `res.users` write access is gated by `base.group_erp_manager` specifically (see `base/security/ir.model.access.csv`), not by any of the POS/stock groups — a role can look like an "admin" via its own `group_resto_*` group while still being unable to edit other users unless it also implies `base.group_erp_manager`.
- Odoo refuses to change an existing xmlid's model on `-u` upgrade (`ParseError: ... found record of different model`) — e.g. turning an `ir.actions.act_url` into an `ir.actions.client` under the same `id` fails. Give the new record a fresh xmlid instead; the orphaned old record is cleaned up automatically at the end of the module update since it's no longer declared in the module's data.
- A `<menuitem>`'s `groups` attribute does not cascade to its children — each child with its own `action` needs its own `groups` too, otherwise it stays reachable (and visible in the menu tree) for anyone who can access its action's underlying model, even when the parent is hidden for them. `res.users` and `resto.restaurant` both grant base read access to every internal user, so unguarded child menus pointing at them leak into every role's menu.
- `type="json"` HTTP routes always wrap the return value in a JSON-RPC envelope (`{"jsonrpc": "2.0", "id": ..., "result": {...}}`) per `JsonRPCDispatcher._response` in `odoo/http.py` — a raw `$.ajax` call against one must read `response.result`, not `response`, or every field silently becomes `undefined` (and anything piped through `Intl.NumberFormat` renders as the string "NaN").
- `_sync_resto_role_groups`-style group syncing only fires from `res.users.write()`/`create()` — changing which native groups a role should carry (e.g. editing `GROUPS_TO_RESET_XMLIDS`) does not retroactively touch existing users on module upgrade; re-run `env["res.users"].search([...])._sync_resto_role_groups()` in `odoo shell` after such a change.
