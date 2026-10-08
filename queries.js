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

module.exports = {
  findEmployeeByEmail, findEmployeeById,
  usageForUser, usageForProject, allUsage,
  projectById, employeesOfProject,
  allBilling, allDepartments, allProjects, allEmployees
};
