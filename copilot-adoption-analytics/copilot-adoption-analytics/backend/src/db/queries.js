// All SQL lives here. Every function takes the db handle first (anything with
// an async query(text, params) method, i.e. a pg Pool) so it can be tested
// without a real Postgres.

const EMPLOYEE_COLS = 'id, name, github_username, email, role, mgr_id, project_id, min_limit, max_limit';

async function findEmployeeByEmail(db, email) {
  const { rows } = await db.query(
    `SELECT ${EMPLOYEE_COLS} FROM employees WHERE LOWER(email) = LOWER($1)`, [email]);
  return rows[0] || null;
}

async function findEmployeeById(db, id) {
  const { rows } = await db.query(`SELECT ${EMPLOYEE_COLS} FROM employees WHERE id = $1`, [id]);
  return rows[0] || null;
}

// Optional date filter, appended to a usage query. `params` already holds the
// positional params used so far; this pushes more and returns the SQL fragment.
function dateFilter(alias, { from, to }, params) {
  let sql = '';
  if (from) { params.push(from); sql += ` AND ${alias}.usage_date >= $${params.length}`; }
  if (to)   { params.push(to);   sql += ` AND ${alias}.usage_date <= $${params.length}`; }
  return sql;
}

async function usageForUser(db, githubUsername, range = {}) {
  const params = [githubUsername];
  const sql = `SELECT u.id, u.github_username, u.tokens_consumed, u.model_used, u.usage_date
               FROM copilot_usage u WHERE u.github_username = $1${dateFilter('u', range, params)}
               ORDER BY u.usage_date, u.id`;
  return (await db.query(sql, params)).rows;
}

async function usageForProject(db, projectId, range = {}) {
  const params = [projectId];
  const sql = `SELECT u.id, u.github_username, u.tokens_consumed, u.model_used, u.usage_date
               FROM copilot_usage u
               JOIN employees e ON e.github_username = u.github_username
               WHERE e.project_id = $1${dateFilter('u', range, params)}
               ORDER BY u.usage_date, u.id`;
  return (await db.query(sql, params)).rows;
}

async function allUsage(db, range = {}) {
  const params = [];
  const sql = `SELECT u.id, u.github_username, u.tokens_consumed, u.model_used, u.usage_date
               FROM copilot_usage u WHERE 1=1${dateFilter('u', range, params)}
               ORDER BY u.usage_date, u.id`;
  return (await db.query(sql, params)).rows;
}

async function availableUsageMonths(db) {
  return (await db.query(
    `SELECT DISTINCT to_char(usage_date, 'YYYY-MM') AS month
     FROM copilot_usage
     ORDER BY month`
  )).rows.map((row) => row.month);
}

async function monthlyModelUsage(db, scope, scopeValue, monthStart) {
  const scopeConditions = {
    employee: 'u.github_username = $1',
    project: 'e.project_id = $1',
    department: `EXISTS (
      SELECT 1 FROM departments d
      WHERE d.dept_head_employee_id = $1
        AND (e.id = d.dept_head_employee_id OR e.project_id IN (
          SELECT p.id FROM projects p WHERE p.dept_id = d.id
        ))
    )`,
    organization: 'TRUE'
  };
  if (!Object.hasOwn(scopeConditions, scope)) throw new Error(`Unsupported model usage scope: ${scope}`);

  const params = scope === 'organization' ? [monthStart] : [scopeValue, monthStart];
  const monthPlaceholder = scope === 'organization' ? '$1' : '$2';
  const periodStart = `COALESCE(${monthPlaceholder}::date, (date_trunc('month', CURRENT_DATE) - interval '1 month')::date)`;
  const { rows } = await db.query(
    `WITH period AS (
       SELECT ${periodStart} AS period_start,
              LEAST((${periodStart} + interval '1 month' - interval '1 day')::date, CURRENT_DATE) AS period_end
     ), model_usage AS (
       SELECT u.model_used, SUM(u.tokens_consumed)::BIGINT AS tokens
       FROM copilot_usage u
       JOIN employees e ON e.github_username = u.github_username
       CROSS JOIN period
       WHERE u.usage_date BETWEEN period.period_start AND period.period_end
         AND ${scopeConditions[scope]}
       GROUP BY u.model_used
     )
     SELECT b.model, COALESCE(model_usage.tokens, 0)::BIGINT AS tokens,
            b.per_token_cost,
            to_char(period.period_start, 'YYYY-MM-DD') AS period_start,
            to_char(period.period_end, 'YYYY-MM-DD') AS period_end
     FROM billing b
     CROSS JOIN period
     LEFT JOIN model_usage ON model_usage.model_used = b.model
     ORDER BY b.model`,
    params
  );
  return rows;
}

async function projectById(db, id) {
  const { rows } = await db.query(
    `SELECT id, name, dept_id, project_mgr_employee_id, min_limit, max_limit FROM projects WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function employeesOfProject(db, projectId) {
  const { rows } = await db.query(
    `SELECT ${EMPLOYEE_COLS} FROM employees WHERE project_id = $1 ORDER BY id`, [projectId]);
  return rows;
}

async function allBilling(db) {
  return (await db.query(`SELECT model, per_token_cost FROM billing ORDER BY model`)).rows;
}
async function allDepartments(db) {
  return (await db.query(
    `SELECT id, name, dept_head_employee_id, min_limit, max_limit FROM departments ORDER BY id`)).rows;
}
async function allProjects(db) {
  return (await db.query(
    `SELECT id, name, dept_id, project_mgr_employee_id, min_limit, max_limit FROM projects ORDER BY id`)).rows;
}
async function allEmployees(db) {
  return (await db.query(`SELECT ${EMPLOYEE_COLS} FROM employees ORDER BY id`)).rows;
}

async function monthlyUsageForAllDepartments(db, monthStart) {
  const { rows } = await db.query(
    `WITH period AS (
  SELECT COALESCE($1::date, (date_trunc('month', CURRENT_DATE) - interval '1 month')::date) AS period_start,
    LEAST((COALESCE($1::date, (date_trunc('month', CURRENT_DATE) - interval '1 month')::date) + interval '1 month' - interval '1 day')::date, CURRENT_DATE) AS period_end
     ), usage_events AS (
       SELECT d.id AS department_id, u.usage_date, u.tokens_consumed
       FROM departments d
       JOIN employees head ON head.id = d.dept_head_employee_id
       JOIN copilot_usage u ON u.github_username = head.github_username
       CROSS JOIN period
       WHERE u.usage_date BETWEEN period.period_start AND period.period_end
       UNION ALL
       SELECT p.dept_id AS department_id, u.usage_date, u.tokens_consumed
       FROM projects p
       JOIN employees e ON e.project_id = p.id
       JOIN copilot_usage u ON u.github_username = e.github_username
       CROSS JOIN period
       WHERE u.usage_date BETWEEN period.period_start AND period.period_end
     ), daily_usage AS (
       SELECT department_id, usage_date, SUM(tokens_consumed)::BIGINT AS tokens
       FROM usage_events
       GROUP BY department_id, usage_date
     ), department_totals AS (
       SELECT department_id, SUM(tokens)::BIGINT AS consumed_tokens
       FROM daily_usage
       GROUP BY department_id
     )
     SELECT d.id AS department_id, d.name AS department_name,
            d.max_limit AS token_limit,
            to_char(period.period_start, 'YYYY-MM-DD') AS period_start,
            to_char(period.period_end, 'YYYY-MM-DD') AS period_end,
            to_char(days.day, 'YYYY-MM-DD') AS usage_date,
            COALESCE(daily_usage.tokens, 0)::BIGINT AS tokens,
            COALESCE(department_totals.consumed_tokens, 0)::BIGINT AS consumed_tokens
     FROM departments d
     CROSS JOIN period
     CROSS JOIN LATERAL generate_series(period.period_start, period.period_end, interval '1 day') AS days(day)
     LEFT JOIN daily_usage ON daily_usage.department_id = d.id AND daily_usage.usage_date = days.day::date
     LEFT JOIN department_totals ON department_totals.department_id = d.id
      ORDER BY d.id, days.day`,
     [monthStart]
  );
  return rows;
}

async function monthlyUsageForEmployee(db, employee, monthStart) {
  const { rows } = await db.query(
    `WITH period AS (
  SELECT COALESCE($3::date, (date_trunc('month', CURRENT_DATE) - interval '1 month')::date) AS period_start,
    LEAST((COALESCE($3::date, (date_trunc('month', CURRENT_DATE) - interval '1 month')::date) + interval '1 month' - interval '1 day')::date, CURRENT_DATE) AS period_end
     ), daily AS (
       SELECT u.usage_date, SUM(u.tokens_consumed)::BIGINT AS tokens
       FROM copilot_usage u CROSS JOIN period
       WHERE u.github_username = $2
         AND u.usage_date BETWEEN period.period_start AND period.period_end
       GROUP BY u.usage_date
     )
     SELECT to_char(period.period_start, 'YYYY-MM-DD') AS period_start,
            to_char(period.period_end, 'YYYY-MM-DD') AS period_end,
            COALESCE(SUM(daily.tokens), 0)::BIGINT AS consumed_tokens,
            $1::BIGINT AS token_limit,
            COALESCE((
              SELECT json_agg(json_build_object(
                'date', to_char(days.day, 'YYYY-MM-DD'),
                'tokens', COALESCE(daily.tokens, 0)
              ) ORDER BY days.day)
              FROM period p
              CROSS JOIN LATERAL generate_series(p.period_start, p.period_end, interval '1 day') AS days(day)
              LEFT JOIN daily ON daily.usage_date = days.day::date
            ), '[]'::json) AS daily_usage
     FROM period
     LEFT JOIN daily ON TRUE
     GROUP BY period.period_start, period.period_end`,
    [employee.max_limit, employee.github_username, monthStart]
  );
  return rows[0];
}

async function monthlyProjectsForManager(db, managerId, monthStart) {
  const { rows } = await db.query(
    `WITH period AS (
  SELECT COALESCE($2::date, (date_trunc('month', CURRENT_DATE) - interval '1 month')::date) AS period_start,
    LEAST((COALESCE($2::date, (date_trunc('month', CURRENT_DATE) - interval '1 month')::date) + interval '1 month' - interval '1 day')::date, CURRENT_DATE) AS period_end
     ), daily AS (
       SELECT e.project_id, u.usage_date, SUM(u.tokens_consumed)::BIGINT AS tokens
       FROM projects scoped_project
       JOIN employees e ON e.project_id = scoped_project.id
       JOIN copilot_usage u ON u.github_username = e.github_username
       CROSS JOIN period
       WHERE scoped_project.project_mgr_employee_id = $1
         AND u.usage_date BETWEEN period.period_start AND period.period_end
       GROUP BY e.project_id, u.usage_date
     )
     SELECT p.id, p.name, p.max_limit AS token_limit,
            to_char(period.period_start, 'YYYY-MM-DD') AS period_start,
            to_char(period.period_end, 'YYYY-MM-DD') AS period_end,
            COALESCE(SUM(daily.tokens), 0)::BIGINT AS consumed_tokens,
            COALESCE((
              SELECT json_agg(json_build_object(
                'date', to_char(days.day, 'YYYY-MM-DD'),
                'tokens', COALESCE(project_daily.tokens, 0)
              ) ORDER BY days.day)
              FROM generate_series(period.period_start, period.period_end, interval '1 day') AS days(day)
              LEFT JOIN daily project_daily
                ON project_daily.project_id = p.id AND project_daily.usage_date = days.day::date
            ), '[]'::json) AS daily_usage
     FROM projects p
     CROSS JOIN period
     LEFT JOIN daily ON daily.project_id = p.id
     WHERE p.project_mgr_employee_id = $1
     GROUP BY p.id, p.name, p.max_limit, period.period_start, period.period_end
     ORDER BY p.id`,
    [managerId, monthStart]
  );
  return rows;
}

async function monthlyEmployeesForManager(db, managerId, monthStart) {
  const { rows } = await db.query(
    `WITH period AS (
  SELECT COALESCE($2::date, (date_trunc('month', CURRENT_DATE) - interval '1 month')::date) AS period_start,
    LEAST((COALESCE($2::date, (date_trunc('month', CURRENT_DATE) - interval '1 month')::date) + interval '1 month' - interval '1 day')::date, CURRENT_DATE) AS period_end
     ), target_project AS (
       SELECT project_id FROM employees WHERE id = $1
     ), daily_usage AS (
       SELECT u.github_username, u.usage_date, SUM(u.tokens_consumed)::BIGINT AS tokens
       FROM employees scoped_employee
       JOIN copilot_usage u ON u.github_username = scoped_employee.github_username
       CROSS JOIN period
       WHERE scoped_employee.project_id = (SELECT project_id FROM target_project)
         AND scoped_employee.role = 'employee'
         AND u.usage_date BETWEEN period.period_start AND period.period_end
       GROUP BY u.github_username, u.usage_date
     ), monthly_usage AS (
       SELECT github_username, SUM(tokens)::BIGINT AS consumed_tokens
       FROM daily_usage
       GROUP BY github_username
     )
     SELECT e.id, e.name, e.email, e.max_limit AS token_limit,
            COALESCE(monthly_usage.consumed_tokens, 0)::BIGINT AS consumed_tokens,
            to_char(period.period_start, 'YYYY-MM-DD') AS period_start,
            to_char(period.period_end, 'YYYY-MM-DD') AS period_end,
            COALESCE((
              SELECT json_agg(json_build_object(
                'date', to_char(days.day, 'YYYY-MM-DD'),
                'tokens', COALESCE(employee_daily.tokens, 0)
              ) ORDER BY days.day)
              FROM period p
              CROSS JOIN LATERAL generate_series(p.period_start, p.period_end, interval '1 day') AS days(day)
              LEFT JOIN daily_usage employee_daily
                ON employee_daily.github_username = e.github_username
               AND employee_daily.usage_date = days.day::date
            ), '[]'::json) AS daily_usage
     FROM target_project
     CROSS JOIN period
     JOIN employees e ON e.project_id = target_project.project_id
     LEFT JOIN monthly_usage ON monthly_usage.github_username = e.github_username
     WHERE e.role = 'employee'
     ORDER BY e.id`,
    [managerId, monthStart]
  );
  return rows;
}

async function monthlyAnalyticsForDepartmentHead(db, employeeId, monthStart) {
  const { rows } = await db.query(
    `WITH target_department AS (
       SELECT d.id, d.name, d.dept_head_employee_id, d.max_limit
       FROM departments d
       WHERE d.dept_head_employee_id = $1
     ), period AS (
      SELECT COALESCE($2::date, (date_trunc('month', CURRENT_DATE) - interval '1 month')::date) AS period_start,
        LEAST((COALESCE($2::date, (date_trunc('month', CURRENT_DATE) - interval '1 month')::date) + interval '1 month' - interval '1 day')::date, CURRENT_DATE) AS period_end
     ), daily AS (
       SELECT usage_rows.usage_date, SUM(usage_rows.tokens)::BIGINT AS tokens
       FROM (
         SELECT head_usage.usage_date, head_usage.tokens_consumed AS tokens
         FROM target_department d
         JOIN employees head ON head.id = d.dept_head_employee_id
         JOIN copilot_usage head_usage ON head_usage.github_username = head.github_username
         CROSS JOIN period
         WHERE head_usage.usage_date BETWEEN period.period_start AND period.period_end
         UNION ALL
         SELECT project_usage.usage_date, project_usage.tokens_consumed AS tokens
         FROM target_department d
         JOIN projects project ON project.dept_id = d.id
         JOIN employees project_employee ON project_employee.project_id = project.id
         JOIN copilot_usage project_usage ON project_usage.github_username = project_employee.github_username
         CROSS JOIN period
         WHERE project_usage.usage_date BETWEEN period.period_start AND period.period_end
       ) usage_rows
       GROUP BY usage_rows.usage_date
     )
     SELECT d.id, d.name, d.max_limit AS token_limit,
            to_char(period.period_start, 'YYYY-MM-DD') AS period_start,
            to_char(period.period_end, 'YYYY-MM-DD') AS period_end,
            COALESCE(SUM(daily.tokens), 0)::BIGINT AS consumed_tokens,
            COALESCE((
              SELECT json_agg(json_build_object(
                'date', to_char(days.day, 'YYYY-MM-DD'),
                'tokens', COALESCE(dept_daily.tokens, 0)
              ) ORDER BY days.day)
              FROM generate_series(period.period_start, period.period_end, interval '1 day') AS days(day)
              LEFT JOIN daily dept_daily ON dept_daily.usage_date = days.day::date
            ), '[]'::json) AS daily_usage
     FROM target_department d
     CROSS JOIN period
     LEFT JOIN daily ON TRUE
     GROUP BY d.id, d.name, d.max_limit, period.period_start, period.period_end`,
    [employeeId, monthStart]
  );
  if (!rows[0]) return null;

  const { rows: projects } = await db.query(
    `WITH period AS (
      SELECT COALESCE($2::date, (date_trunc('month', CURRENT_DATE) - interval '1 month')::date) AS period_start,
        LEAST((COALESCE($2::date, (date_trunc('month', CURRENT_DATE) - interval '1 month')::date) + interval '1 month' - interval '1 day')::date, CURRENT_DATE) AS period_end
     ), daily AS (
       SELECT e.project_id, u.usage_date, SUM(u.tokens_consumed)::BIGINT AS tokens
       FROM employees e
       JOIN copilot_usage u ON u.github_username = e.github_username
       CROSS JOIN period
       WHERE e.project_id IN (SELECT id FROM projects WHERE dept_id = $1)
         AND u.usage_date BETWEEN period.period_start AND period.period_end
       GROUP BY e.project_id, u.usage_date
     )
     SELECT p.id, p.name, p.max_limit AS token_limit,
            COALESCE(SUM(daily.tokens), 0)::BIGINT AS consumed_tokens,
            COALESCE((
              SELECT json_agg(json_build_object(
                'date', to_char(days.day, 'YYYY-MM-DD'),
                'tokens', COALESCE(project_daily.tokens, 0)
              ) ORDER BY days.day)
              FROM generate_series(period.period_start, period.period_end, interval '1 day') AS days(day)
              LEFT JOIN daily project_daily
                ON project_daily.project_id = p.id AND project_daily.usage_date = days.day::date
            ), '[]'::json) AS daily_usage
     FROM projects p
     CROSS JOIN period
     LEFT JOIN daily ON daily.project_id = p.id
     WHERE p.dept_id = $1
     GROUP BY p.id, p.name, p.max_limit, period.period_start, period.period_end
     ORDER BY p.id`,
    [rows[0].id, monthStart]
  );
  return { ...rows[0], projects };
}

module.exports = {
  findEmployeeByEmail, findEmployeeById,
  usageForUser, usageForProject, allUsage, availableUsageMonths, monthlyModelUsage,
  projectById, employeesOfProject,
  allBilling, allDepartments, allProjects, allEmployees,
  monthlyUsageForEmployee, monthlyProjectsForManager, monthlyEmployeesForManager, monthlyAnalyticsForDepartmentHead,
  monthlyUsageForAllDepartments
};
