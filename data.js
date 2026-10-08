const express = require('express');
const q = require('../db/queries');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    const { from, to } = req.query;
    if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) {
      return res.status(400).json({ success: false, message: 'from/to must be YYYY-MM-DD' });
    }
    const range = { from, to };

    try {
      const user = await q.findEmployeeById(db, userId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      let data;
      switch (user.role) {
        case 'employee': {
          data = {
            employee: user,
            copilot_usage: await q.usageForUser(db, user.github_username, range)
          };
          break;
        }
        case 'project_manager': {
          const [project, employees, copilot_usage, billing] = await Promise.all([
            user.project_id ? q.projectById(db, user.project_id) : null,
            user.project_id ? q.employeesOfProject(db, user.project_id) : [],
            user.project_id ? q.usageForProject(db, user.project_id, range) : [],
            q.allBilling(db)
          ]);
          data = { project, employees, copilot_usage, billing };
          break;
        }
        case 'dept_head':
        case 'exec': {
          const [departments, projects, employees, billing, copilot_usage] = await Promise.all([
            q.allDepartments(db), q.allProjects(db), q.allEmployees(db), q.allBilling(db), q.allUsage(db, range)
          ]);
          data = { departments, projects, employees, billing, copilot_usage };
          break;
        }
        default:
          return res.status(403).json({ success: false, message: `Unsupported role: ${user.role}` });
      }

      return res.status(200).json({
        success: true,
        role: user.role,
        user,
        filters: { from: from || null, to: to || null },
        counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v.length : (v ? 1 : 0)])),
        data
      });
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
