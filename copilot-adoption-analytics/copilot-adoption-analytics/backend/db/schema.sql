-- ============================================================
-- Copilot Adoption Analytics - simplified 5-table schema
--
--   departments   (Dept)
--   projects      (Project)
--   employees     (Employee)
--   billing       (Billing: per-token cost for each model)
--   copilot_usage (Copilot Usage: one row per request)
--
-- All limits are in TOKENS per month.
-- Limit rule: min_limit = allocation at the start of the month;
-- max_limit starts equal to min_limit and is raised whenever
-- consumption exceeds it. Raises propagate upward so that
--   sum(employee limits in a project)           <  project limit
--   sum(project limits + dept head's own limit) <  department limit
-- holds for BOTH min_limit and max_limit.
-- Executives sit outside the hierarchy (no project/department).
-- Login is by email only for now (SSO later), so there is no
-- credentials table.
-- ============================================================

DROP TABLE IF EXISTS copilot_usage CASCADE;
DROP TABLE IF EXISTS billing CASCADE;
DROP TABLE IF EXISTS employees CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS departments CASCADE;

CREATE TABLE departments (
    id                      SERIAL PRIMARY KEY,
    name                    VARCHAR(100) NOT NULL UNIQUE,
    dept_head_employee_id   INTEGER,                 -- FK added below (circular with employees)
    min_limit               BIGINT NOT NULL,
    max_limit               BIGINT NOT NULL,
    CHECK (max_limit >= min_limit)
);

CREATE TABLE projects (
    id                       SERIAL PRIMARY KEY,
    name                     VARCHAR(200) NOT NULL UNIQUE,
    dept_id                  INTEGER NOT NULL REFERENCES departments(id),
    project_mgr_employee_id  INTEGER,                -- FK added below (circular with employees)
    min_limit                BIGINT NOT NULL,
    max_limit                BIGINT NOT NULL,
    CHECK (max_limit >= min_limit)
);

CREATE TABLE employees (
    id               SERIAL PRIMARY KEY,
    name             VARCHAR(150) NOT NULL,
    github_username  VARCHAR(100) NOT NULL UNIQUE,
    email            VARCHAR(150) NOT NULL UNIQUE,   -- used for login
    role             VARCHAR(20)  NOT NULL
                     CHECK (role IN ('exec', 'dept_head', 'project_manager', 'employee')),
    mgr_id           INTEGER REFERENCES employees(id),
    project_id       INTEGER REFERENCES projects(id), -- NULL for execs and dept heads
    min_limit        BIGINT NOT NULL,
    max_limit        BIGINT NOT NULL,
    CHECK (max_limit >= min_limit)
);

ALTER TABLE departments
    ADD CONSTRAINT fk_dept_head FOREIGN KEY (dept_head_employee_id) REFERENCES employees(id);
ALTER TABLE projects
    ADD CONSTRAINT fk_project_mgr FOREIGN KEY (project_mgr_employee_id) REFERENCES employees(id);

CREATE TABLE billing (
    model           VARCHAR(60) PRIMARY KEY,
    per_token_cost  NUMERIC(14,10) NOT NULL          -- USD per token (blended, illustrative)
);

CREATE TABLE copilot_usage (
    id               BIGSERIAL PRIMARY KEY,           -- one row per request
    github_username  VARCHAR(100) NOT NULL REFERENCES employees(github_username),
    tokens_consumed  INTEGER NOT NULL CHECK (tokens_consumed > 0),
    model_used       VARCHAR(60) NOT NULL REFERENCES billing(model),
    usage_date       DATE NOT NULL
);

CREATE INDEX idx_employees_project  ON employees(project_id);
CREATE INDEX idx_employees_mgr      ON employees(mgr_id);
CREATE INDEX idx_projects_dept      ON projects(dept_id);
CREATE INDEX idx_usage_user_date    ON copilot_usage(github_username, usage_date);
CREATE INDEX idx_usage_date         ON copilot_usage(usage_date);
CREATE INDEX idx_usage_model        ON copilot_usage(model_used);
