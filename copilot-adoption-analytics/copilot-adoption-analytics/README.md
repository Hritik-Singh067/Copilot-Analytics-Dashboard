# Copilot Adoption Analytics

Copilot Adoption Analytics is a prototype dashboard for understanding GitHub Copilot usage, monthly token allocations, and estimated model costs across employees, projects, and departments. It combines role-scoped analytics with AI-generated explanations and PDF reporting to help teams make informed usage and allocation decisions.

## Problem Statement

Organizations adopting GitHub Copilot need to understand how usage and token allocations vary across teams, projects, employees, and AI models. Usage records, allocation limits, and estimated model costs can be difficult to compare in one place, making it harder to identify where capacity is underused or where consumption may exceed an allocation.

The current challenge is turning those metrics into timely, actionable decisions. Managers need a consistent view of usage at the level they oversee, while leadership needs a broader picture of adoption and estimated cost. Without that visibility, teams may spend time gathering and reconciling data manually, miss opportunities to reallocate capacity, or make decisions without a clear evidence trail.

This project is a local prototype using mock usage data. It is intended to demonstrate the reporting workflow, not to provide audited billing or production identity management.

## Proposed Solution

Provide a role-aware analytics dashboard that brings usage, allocation, and estimated model costs into one view. Users can explore monthly data through employee, project, and department views, ask Gemini questions about the displayed analytics, and generate a PDF report with an AI-written summary and evidence-based recommendations.

### Problem solved

- Reduces the effort needed to collect and compare usage and allocation data.
- Makes potential over-allocation and unused capacity easier to spot.
- Gives teams a consistent way to review usage and share findings.
- Helps frame possible token reallocation and cost-saving actions using the available metrics.

### Target users

- **Executives:** review department-level adoption and allocation.
- **Department heads:** review their departments and projects.
- **Project managers:** review project and employee usage.
- **Employees:** review their own allocation and usage.

### Expected business value

The dashboard is designed to support better-informed allocation decisions, reduce manual reporting effort, and make usage trends easier to discuss across teams. Any savings or time reduction should be measured against an organization's own baseline; this prototype does not claim realized financial results.

### Key differentiators

- Role-scoped views with drill-down from departments to projects and employees.
- Monthly token usage and allocation comparisons with model-level estimated costs.
- Gemini analysis grounded in the selected analytics context rather than raw usage-event access.
- PDF reporting that includes all carousel slides and AI-generated insights while excluding the interactive chatbot.
- Mock data and a reproducible seed generator for local evaluation.

### Expected impact

When connected to validated organizational data and identity controls, the solution can help teams identify allocation imbalances earlier, standardize periodic usage reviews, and make adoption and cost discussions more actionable. The current mock-data prototype demonstrates these workflows; business outcomes need to be validated in a production pilot.

## Key Features

- **Role-based analytics:** executive, department-head, project-manager, and employee views.
- **Usage drill-down:** explore department, project, and employee allocations and monthly consumption.
- **Monthly analytics:** select a reporting month and view token usage against the available allocation.
- **Model usage and estimated credits:** compare usage across models and view costs estimated from blended per-token rates.
- **Forecast and balance indicators:** review projected token balances or additional allocation needs where available.
- **AI analysis:** ask questions about the selected analytics using Google's Gemini API.
- **AI-powered PDF report:** generate an AI summary and evidence-based reallocation/cost-reduction recommendations, then print or save all dashboard carousel slides as PDF.
- **Mock-data generation:** reproduce the included seeded datasets for local development.

## Technology Stack

| Area | Technology |
|---|---|
| Frontend | React 19, Vite, React Router, Bootstrap 5, Chart.js, react-chartjs-2 |
| Backend | Node.js 18+, Express 4, `pg` PostgreSQL client |
| Database | PostgreSQL 18; schema and SQL mock-data seeds |
| AI/ML | Google Gemini API through the `@google/genai` SDK; model selected by `GEMINI_MODEL` |
| APIs and integrations | REST endpoints for authentication, analytics, and Gemini analysis; browser print-to-PDF |
| Local infrastructure | Docker Compose for PostgreSQL; frontend and backend run as Node development processes |
| Deployment | No production deployment configuration is included. Configure and deploy the frontend, API, and PostgreSQL using your organization's infrastructure and security practices. |

Model-cost values are estimates based on blended per-model rates. The mock usage records store total tokens, not the separate input, output, or cached-token quantities required to calculate an exact invoice. Estimates therefore do not include plan-specific discounts, cached-token discounts, or long-context pricing.

## Solution Architecture

The browser-based React dashboard calls the Node.js/Express API for role-scoped analytics and AI analysis. The API reads application data from PostgreSQL and sends only sanitized, aggregated analytics context to Google Gemini when AI assistance is requested. PDF creation uses the browser’s print-to-PDF flow. See the [solution architecture diagram](docs/architecture/solution-architecture.md) for the components, data flows, and prototype boundaries.

## Setup and Execution

The submission layout has `README.md` and `docker-compose.yaml` at the Git repository root, with the application folders at `src/backend` and `src/frontend`. Run repository-level Docker commands from the Git root.

### Prerequisites

- Git
- Docker Desktop with Docker Compose
- Node.js 18 or newer and npm
- PowerShell (commands below use PowerShell syntax)
- Optional: a Google AI Studio API key to enable Gemini analysis and AI report generation

### 1. Start PostgreSQL with Docker

Run Docker Compose from the **repository root**, the directory containing `docker-compose.yaml`:

```powershell
docker compose up -d postgres
docker compose ps
```

The database is exposed on `localhost:5433` and persists in the `postgres_data` Docker volume.

### 2. Create the schema and load the seed data

Still from the repository root, copy the database scripts into the PostgreSQL container and run the schema and ordered seed script:

```powershell
docker cp .\src\backend\db copilot-adoption-postgres:/db
docker exec -it -w /db copilot-adoption-postgres psql -U postgres -d copilot_adoption -f schema.sql
docker exec -it -w /db/seeds copilot-adoption-postgres psql -U postgres -d copilot_adoption -f 00_run_all.sql
```

The seed loader includes departments, projects, employees, billing rates, and Copilot usage records. The usage seed includes mock requests for October 1–9, 2026. Loading the large usage seed may take a few minutes.

The schema and seeds are intended for a fresh database. To discard the local database and start over, remove the Compose volume **(this permanently deletes its database data)**, then recreate the database and reload the scripts:

```powershell
docker compose down -v
docker compose up -d postgres
```

After PostgreSQL starts again, repeat the `docker cp`, schema, and seed commands above.

### 3. Configure and start the backend

Open a new PowerShell terminal and navigate from the repository root to the backend:

```powershell
Set-Location .\src\backend
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Edit `src/backend/.env` locally. Use the same database settings as the Compose service:

```env
DB_HOST=localhost
DB_PORT=5433
DB_NAME=copilot_adoption
DB_USER=postgres
DB_PASSWORD=postgres
PORT=4000

# Optional; required for AI analysis and AI-powered report summaries.
GEMINI_API_KEY=your-google-ai-studio-api-key
GEMINI_MODEL=gemini-3.5-flash
```

Keep `.env` local. Do not commit API keys, database passwords, or other secrets, and do not put the Gemini API key in a frontend environment file. The backend also supports `DATABASE_URL` instead of the individual `DB_*` settings.

Install dependencies and start the API:

```powershell
npm install
npm start
```

The API listens at `http://localhost:4000`. Check it with:

```powershell
Invoke-RestMethod http://localhost:4000/api/health
```

### 4. Configure and start the frontend

Open another PowerShell terminal and navigate from the repository root to the frontend:

```powershell
Set-Location .\src\frontend
npm install
npm run dev
```

Vite serves the dashboard at `http://localhost:5173`. By default, the frontend sends API requests to `http://localhost:4000`. To use a different backend origin, create `src/frontend/.env.local` with:

```env
VITE_API_BASE_URL=http://localhost:4000
```

Restart the Vite server after changing frontend environment settings.

### 5. Sign in and use the dashboard

Sign in with an email present in the seeded employee data. Registration is not currently supported. AI analysis and AI-generated report summaries require a valid backend `GEMINI_API_KEY`; the dashboard and non-AI analytics can run without it.

Run backend tests from the `src/backend` directory:

```powershell
npm test
```

Build the frontend for production from the `src/frontend` directory:

```powershell
npm run build
```

### API overview

The backend mounts its endpoints under `/api`:

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | API health check |
| `POST /api/auth/login` | Email-only prototype login |
| `GET /api/data?user_id=<id>` | Role-scoped monthly analytics |
| `GET /api/data/departments/:departmentId?user_id=<id>&month=YYYY-MM` | Authorized department detail |
| `GET /api/data/projects/:projectId?user_id=<id>&month=YYYY-MM` | Authorized project detail |
| `POST /api/ai/analyze` | Gemini analysis of supplied analytics context |

The frontend and API defaults allow local development origins on ports 5173 and 4173. Set backend `FRONTEND_ORIGINS` to a comma-separated list of allowed origins if the frontend is hosted elsewhere.

## Business Impact

The following are expected benefits to validate in a pilot; they are not measured outcomes from the mock-data prototype.

- **Time saved:** centralizes recurring usage and allocation views, which can reduce manual data gathering and report preparation.
- **Cost reduction:** surfaces usage and estimated model costs that can inform model selection and token reallocation. Any savings depend on actual pricing, policy, and realized usage.
- **Risk reduction:** makes potential allocation overruns more visible and encourages earlier review. Production use still requires proper authentication, authorization, monitoring, and data governance.
- **Better user experience:** gives each role a focused dashboard, provides drill-down to relevant details, and makes findings easier to share in a PDF.
- **Process standardization:** provides a repeatable monthly review format and consistent metrics across employees, projects, and departments.
- **Scalability:** the role hierarchy and aggregate analytics provide a foundation for broader teams. Production scaling will require deployment, database, performance, and access-control validation with real workloads.

## Data, Pricing, and Security Notes

The included datasets are mock data generated by `node src/backend/db/generate_mock_data.js`. Generation is reproducible and writes seed files under `src/backend/db/seeds/`. The main generated sample spans April 1 through September 30, 2026; the existing usage seed also includes mock requests for October 1–9, 2026.

Model API costs use published standard rates and an assumed 80% input / 20% output token mix because the sample usage stores total tokens only. The estimates exclude cached-token discounts, plan discounts, and long-context pricing; they are not invoice values. Published pricing can change; review provider pricing before using estimates for decisions.

This is a prototype. Login currently uses email only, and APIs accept a client-supplied user ID rather than an authenticated session. Do not expose it to untrusted networks or use it for production access decisions without adding authentication (such as SSO), server-enforced role authorization, request limits, and appropriate data protections. Analytics sent for AI analysis are passed to Google Gemini; do not submit sensitive information unless that use is approved by your organization.
