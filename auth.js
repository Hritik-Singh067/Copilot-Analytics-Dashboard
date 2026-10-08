const express = require('express');
const q = require('../db/queries');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/auth/login  { "email": "someone@novacode.io" }
// No password for now (SSO later): succeeds if the email belongs to an employee.
function loginHandler(db) {
  return async (req, res) => {
    const email = String((req.body && req.body.email) || '').trim();
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, message: 'A valid email is required' });
    }
    try {
      const emp = await q.findEmployeeByEmail(db, email);
      if (!emp) return res.status(401).json({ success: false, message: 'No employee found with this email' });
      return res.status(200).json({
        success: true,
        user: { id: emp.id, name: emp.name, email: emp.email, role: emp.role }
      });
    } catch (err) {
      console.error('login error', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  };
}

module.exports = (db) => {
  const router = express.Router();
  router.post('/login', loginHandler(db));
  return router;
};
module.exports.loginHandler = loginHandler;
