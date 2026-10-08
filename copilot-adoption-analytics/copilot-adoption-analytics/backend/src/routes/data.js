const express = require('express');
const q = require('../db/queries');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// GET /api/data?user_id=7[&from=2026-09-01&to=2026-09-30]
// Looks up the user's role first, then returns the slice of data that role gets:
//   employee         -> own employee record + own copilot usage
//   project_manager  -> their project, its employees, usage of those employees, billing
//   dept_head / exec -> every table (departments, projects, employees, billing, copilot_usage)
// Optional from/to (YYYY-MM-DD) narrow copilot_usage only; the full table is ~250k rows.
function dataHandler(db) {
  return async (req, res) => {
    const userId = Number(req.query.user_id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ success: false, message: 'user_id (positive integer) is required' });
    }
    const { from, to, month } = req.query;
    if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) {
      return res.status(400).json({ success: false, message: 'from/to must be YYYY-MM-DD' });
    }
    if (month && !MONTH_RE.test(month)) {
      return res.status(400).json({ success: false, message: 'month must be YYYY-MM' });
    }
    const currentDate = new Date().toISOString().slice(0, 10);
    const currentMonth = currentDate.slice(0, 7);
    const previousMonthDate = new Date(`${currentMonth}-01T00:00:00Z`);
    previousMonthDate.setUTCMonth(previousMonthDate.getUTCMonth() - 1);
    const selectedMonth = month || previousMonthDate.toISOString().slice(0, 7);
    if (selectedMonth > currentMonth) {
      return res.status(400).json({ success: false, message: 'month cannot be in the future' });
    }
    const monthStart = `${selectedMonth}-01`;
    const monthEndDay = new Date(Date.UTC(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5, 7)), 0)).getUTCDate();
    const monthEnd = selectedMonth === currentMonth ? currentDate : `${selectedMonth}-${String(monthEndDay).padStart(2, '0')}`;
    const range = month || (!from && !to) ? { from: monthStart, to: monthEnd } : { from, to };

    try {
      const user = await q.findEmployeeById(db, userId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      let data;
      let token_analytics = null;
      let available_months = [];
      switch (user.role) {
        case 'employee': {
          const [copilot_usage, employeeAnalytics, model_usage, availableMonths] = await Promise.all([
            q.usageForUser(db, user.github_username, range),
            q.monthlyUsageForEmployee(db, user, monthStart),
            q.monthlyModelUsage(db, 'employee', user.github_username, monthStart),
            q.availableUsageMonths(db)
          ]);
          data = {
            employee: user,
            copilot_usage
          };
          available_months = availableMonths;
          token_analytics = { period_start: employeeAnalytics.period_start, period_end: employeeAnalytics.period_end, employee: employeeAnalytics, model_usage };
          break;
        }
        case 'project_manager': {
          const [project, employees, copilot_usage, billing, projects, employeeUsage, model_usage, availableMonths] = await Promise.all([
            user.project_id ? q.projectById(db, user.project_id) : null,
            user.project_id ? q.employeesOfProject(db, user.project_id) : [],
            user.project_id ? q.usageForProject(db, user.project_id, range) : [],
            q.allBilling(db),
            q.monthlyProjectsForManager(db, user.id, monthStart),
            q.monthlyEmployeesForManager(db, user.id, monthStart),
            user.project_id ? q.monthlyModelUsage(db, 'project', user.project_id, monthStart) : [],
            q.availableUsageMonths(db)
          ]);
          data = { project, employees, copilot_usage, billing };
          available_months = availableMonths;
          token_analytics = {
            period_start: projects[0]?.period_start || null,
            period_end: projects[0]?.period_end || null,
            projects,
            employees: employeeUsage,
            model_usage
          };
          break;
        }
        case 'dept_head':
        case 'exec': {
          const [departments, projects, employees, billing, copilot_usage, departmentAnalytics, executiveUsageRows, model_usage, availableMonths] = await Promise.all([
            q.allDepartments(db), q.allProjects(db), q.allEmployees(db), q.allBilling(db), q.allUsage(db, range),
            user.role === 'dept_head' ? q.monthlyAnalyticsForDepartmentHead(db, user.id, monthStart) : null,
            user.role === 'exec' ? q.monthlyUsageForAllDepartments(db, monthStart) : null,
            user.role === 'dept_head'
              ? q.monthlyModelUsage(db, 'department', user.id, monthStart)
              : q.monthlyModelUsage(db, 'organization', null, monthStart),
            q.availableUsageMonths(db)
          ]);
          data = { departments, projects, employees, billing, copilot_usage };
          available_months = availableMonths;
          if (departmentAnalytics) {
            token_analytics = {
              period_start: departmentAnalytics.period_start,
              period_end: departmentAnalytics.period_end,
              department: {
                id: departmentAnalytics.id,
                name: departmentAnalytics.name,
                token_limit: departmentAnalytics.token_limit,
                consumed_tokens: departmentAnalytics.consumed_tokens,
                daily_usage: departmentAnalytics.daily_usage
              },
              projects: departmentAnalytics.projects,
              model_usage
            };
          } else if (executiveUsageRows) {
            const departmentsById = new Map();
            executiveUsageRows.forEach((row) => {
              if (!departmentsById.has(row.department_id)) {
                departmentsById.set(row.department_id, {
                  id: row.department_id,
                  name: row.department_name,
                  token_limit: row.token_limit,
                  consumed_tokens: row.consumed_tokens,
                  daily_usage: []
                });
              }
              departmentsById.get(row.department_id).daily_usage.push({ date: row.usage_date, tokens: row.tokens });
            });
            token_analytics = {
              period_start: executiveUsageRows[0]?.period_start || null,
              period_end: executiveUsageRows[0]?.period_end || null,
              departments: [...departmentsById.values()],
              model_usage
            };
          }
          break;
        }
        default:
          return res.status(403).json({ success: false, message: `Unsupported role: ${user.role}` });
      }

      const response = {
        success: true,
        role: user.role,
        user,
        token_analytics,
        filters: { from: from || null, to: to || null, month: selectedMonth },
        available_months,
        counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v.length : (v ? 1 : 0)])),
        data
      };
      console.log('GET /api/data response:', JSON.stringify(response));
      return res.status(200).json(response);
    } catch (err) {
      console.error('data error', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  };
}

module.exports = (db) => {
  const router = express.Router();
  router.get('/', dataHandler(db));
  return router;
};
module.exports.dataHandler = dataHandler;
