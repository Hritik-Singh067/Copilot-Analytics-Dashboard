# Copilot Adoption Analytics

## Database (5 tables)

| Table | Columns |
|---|---|
| `departments` | id, name, dept_head_employee_id, min_limit, max_limit |
| `projects` | id, name, dept_id, project_mgr_employee_id, min_limit, max_limit |
| `employees` | id, name, github_username, email, role, mgr_id, project_id, min_limit, max_limit |
| `billing` | model, per_token_cost (estimated blended USD per token) |
| `copilot_usage` | id, github_username, tokens_consumed, model_used, usage_date (one row per request) |

Roles: `exec` (5), `dept_head` (15), `project_manager` (135, one per project), `employee` (345).
Login is by email only for now (SSO later), so there is no credentials table.

### Limits (tokens per month)

- `min_limit` is the allocation at the start of the month; `max_limit` starts equal to it and is
  raised (in 500k-token steps) when consumption exceeds it.
- Raises propagate upward so that, for both min and max:
  `sum(employee limits in a project) < project limit` and
  `sum(project limits + dept head's own limit) < department limit`.
- Execs and dept heads have no project; execs sit outside the department hierarchy.
- The generator asserts all of this before writing any file.
- The limits snapshot reflects **September 2026** (last full month of data), where 125 of 500 employees
  (25%) exceeded their starting limit and had `max_limit` raised.

### Mock data

`node backend/db/generate_mock_data.js` (reproducible, seeded) writes `backend/db/seeds/`:
500 employees, 15 departments, 135 projects (2-7 members each), 8 models, ~251k requests
from 2026-04-01 to 2026-09-30 (usage ramps up month over month). Estimated API cost uses public
published standard model rates with an 80% input / 20% output mix because the mock usage stores
only total tokens. The `gpt-5-codex` estimate uses the published `gpt-5.3-codex` rate; Gemini 2.5
uses its last published standard rates. Cached-token discounts, plan discounts, and long-context
pricing are excluded, so this is an estimate, not an invoice amount. Pricing references:
[OpenAI](https://developers.openai.com/api/docs/pricing),
[Anthropic](https://platform.claude.com/docs/en/about-claude/pricing), and
[Google Gemini](https://ai.google.dev/gemini-api/docs/pricing). Change `END_DATE` in the script to move the window.
The existing `05_copilot_usage.sql` seed also includes mock requests for October 1-9, 2026, with
October request sizes about 10% higher than the initial sample.

## Load it (Docker)

```bash
# from the project root
docker run --name copilot-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=copilot_adoption \
  -p 5433:5432 -v "$(pwd)/backend/db:/db" -d postgres:16      # PowerShell: ${PWD}
docker exec -it -w /db       copilot-pg psql -U postgres -d copilot_adoption -f schema.sql
docker exec -it -w /db/seeds copilot-pg psql -U postgres -d copilot_adoption -f 00_run_all.sql
```
Loading ~251k usage rows takes roughly 10-30 seconds. If you already have a container, `docker rm -f copilot-pg` first.

## Backend API (Node + Express)

```bash
cd backend && cp .env.example .env && npm install && npm start   # http://localhost:4000
```

**`POST /api/auth/login`** with `{ "email": "..." }` returns `200 { success: true, user: { id, name, email, role } }`
if the email belongs to an employee (case-insensitive). `400` for a missing or malformed email, `401` if unknown.
No password or token for now.

**`GET /api/data?user_id=<id>[&from=YYYY-MM-DD&to=YYYY-MM-DD]`** looks up the user's role, then returns:

| role | `data` contains |
|---|---|
| `employee` | `employee` (own record), `copilot_usage` (own requests) |
| `project_manager` | `project`, `employees` (project members), `copilot_usage` (members' requests), `billing` |
| `dept_head`, `exec` | `departments`, `projects`, `employees`, `billing`, `copilot_usage` (everything) |

The response also carries `role`, `user`, `filters` and `counts`. `from`/`to` only narrow `copilot_usage`.
`400` for a bad `user_id` or dates, `404` for an unknown user.

Executive users can drill into a department and then its projects; executive, department-head, and project-manager
users can open their authorized project and see its employee allocations. The dashboard month selector applies
through each level of the hierarchy. These detail views use **`GET /api/data/departments/:departmentId`** and
**`GET /api/data/projects/:projectId`**, with `user_id` and optional `month=YYYY-MM` query parameters.

Notes: the full dept_head/exec response is ~30 MB (251k usage rows), so use `from`/`to` or add pagination
before putting it behind a UI. There is no token, so `user_id` is trusted as sent; add a session or SSO
before this is used beyond a local prototype.

## Frontend (React + Bootstrap)

```bash
cd frontend && npm install && npm run dev   # http://localhost:5173
```

The frontend calls the backend at `http://localhost:4000` by default. Set `VITE_API_BASE_URL` to a different
backend origin when needed. Sign in with an existing employee email; registration is not available through
the current backend API. After login, the app requests `/api/data?user_id=<employee id>` and displays the
response summary and full JSON payload.
