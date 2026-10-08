/**
 * generate_mock_data.js
 *
 * Populates the 5-table schema (departments, projects, employees, billing,
 * copilot_usage) with reproducible mock data:
 *   - 500 employees (5 execs, 15 dept heads, one PM per project, rest ICs)
 *   - 15 departments, 135 projects
 *   - 8 models in `billing`
 *   - one copilot_usage row per request, Apr 1 - Sep 30 2026 (6 full months)
 *
 * Limits (tokens/month), computed bottom-up:
 *   1. each employee gets a starting limit (min = max)
 *   2. usage is generated; if the LAST month's consumption exceeds an
 *      employee's limit, max_limit is raised in 500k steps until covered
 *   3. project.min = sum(member min) * buffer ; project.max grows only if
 *      sum(member max) outgrows it (propagating the raises upward)
 *   4. dept.min / dept.max follow the same rule over projects + dept head
 * Invariants are asserted before any file is written.
 *
 * Run: node generate_mock_data.js   (from backend/db)
 */

const fs = require('fs');
const path = require('path');

const SEEDS_DIR = path.join(__dirname, 'seeds');
if (!fs.existsSync(SEEDS_DIR)) fs.mkdirSync(SEEDS_DIR, { recursive: true });

// ---------------- config ----------------
const TOTAL_EMPLOYEES = 500;
const NUM_DEPTS = 15;
const NUM_PROJECTS = 135;
const COMPANY_DOMAIN = 'novacode.io';
const START_DATE = new Date('2026-04-01T00:00:00Z');
const END_DATE = new Date('2026-09-30T00:00:00Z');   // limits snapshot = September 2026
const LIMIT_STEP = 500000;                            // max_limit rises in 500k-token steps
const MAX_DAILY_TOKENS = 450000;                      // per-user daily ceiling (realism guard)
const MONTH_GROWTH = [0.55, 0.65, 0.75, 0.85, 0.93, 1.0]; // Apr..Sep adoption ramp

// ---------------- rng + helpers ----------------
let seed = 20261008;
function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
const randInt = (a, b) => Math.floor(rand() * (b - a + 1)) + a;
const randFloat = (a, b) => a + rand() * (b - a);
const pick = (arr) => arr[randInt(0, arr.length - 1)];
function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = randInt(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function weighted(items) {
  const total = items.reduce((s, i) => s + i.w, 0); let r = rand() * total;
  for (const it of items) { if (r < it.w) return it.v; r -= it.w; }
  return items[items.length - 1].v;
}
function randNormal() { return Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand()); }
const roundUp = (n, step) => Math.ceil(n / step) * step;
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const dstr = (d) => d.toISOString().slice(0, 10);
const q = (v) => (v === null || v === undefined) ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";

// ---------------- names ----------------
const POOLS = {
  western: { f: ['James','Michael','Robert','John','David','William','Thomas','Daniel','Matthew','Emma','Olivia','Ava','Sophia','Mia','Charlotte','Amelia','Jessica','Sarah','Ryan','Kevin','Jason','Andrew','Nathan','Ethan','Lucas','Henry','Grace','Chloe','Zoe','Samuel'], l: ['Smith','Johnson','Williams','Brown','Jones','Miller','Davis','Wilson','Anderson','Taylor','Moore','Jackson','Martin','Thompson','White','Harris','Clark','Lewis','Walker','Young','Allen','King','Wright','Scott','Hill','Green','Baker','Nelson','Carter','Mitchell'] },
  hispanic: { f: ['Carlos','Juan','Luis','Miguel','Jose','Diego','Alejandro','Fernando','Maria','Ana','Sofia','Camila','Valentina','Lucia','Gabriela','Daniela','Paula','Rodrigo','Thiago','Renata'], l: ['Gonzalez','Rodriguez','Hernandez','Lopez','Gomez','Diaz','Perez','Sanchez','Ramirez','Torres','Flores','Ortiz','Silva','Souza','Oliveira','Santos','Costa','Ferreira','Pereira','Ribeiro'] },
  indian: { f: ['Aarav','Vivaan','Aditya','Arjun','Krishna','Ishaan','Rohan','Karan','Ananya','Diya','Priya','Kavya','Aditi','Ishita','Neha','Pooja','Sneha','Riya','Ravi','Sanjay','Amit','Deepak','Rajesh','Vikram','Meera','Divya','Nisha','Shreya','Arnav','Kiran'], l: ['Sharma','Verma','Gupta','Patel','Kumar','Singh','Reddy','Rao','Nair','Iyer','Menon','Mehta','Shah','Joshi','Agarwal','Bansal','Malhotra','Chatterjee','Bose','Desai','Kapoor','Krishnan','Pillai'] },
  eastAsian: { f: ['Wei','Jun','Fang','Min','Lei','Yan','Hao','Jing','Mei','Ling','Haruto','Yuto','Sota','Ren','Yui','Hina','Aoi','Minjun','Jiwoo','Haeun'], l: ['Wang','Li','Zhang','Liu','Chen','Yang','Huang','Zhao','Wu','Zhou','Sato','Suzuki','Takahashi','Tanaka','Watanabe','Kim','Lee','Park','Choi','Jung'] },
  mena: { f: ['Ahmed','Mohammed','Ali','Omar','Youssef','Khalid','Hassan','Ibrahim','Sara','Fatima','Layla','Mariam','Noor','Rania','Yasmin','Huda'], l: ['Al-Farsi','Al-Amin','Khan','Malik','Hussain','Abdullah','Rahman','Saleh','Farouk','Nasser','Qureshi','Siddiqui'] },
  african: { f: ['Chidi','Emeka','Ngozi','Amara','Kwame','Kofi','Ama','Abena','Tunde','Femi','Zainab','Aisha','Wale','Chinwe','Ifeoma','Adaeze'], l: ['Okafor','Okonkwo','Adeyemi','Balogun','Mensah','Owusu','Eze','Nwosu','Chukwu','Diallo','Traore','Abara'] },
  european: { f: ['Piotr','Jan','Tomasz','Katarzyna','Anna','Magdalena','Dmitri','Ivan','Olga','Elena','Lukas','Felix','Jonas','Lena','Julia','Louis','Hugo','Camille','Manon','Lea'], l: ['Kowalski','Nowak','Wojcik','Kaminski','Petrov','Ivanov','Sokolov','Muller','Schmidt','Schneider','Fischer','Weber','Meyer','Dubois','Bernard','Petit','Durand','Moreau'] }
};
const POOL_KEYS = Object.keys(POOLS);
const POOL_WEIGHTS = [{ v: 'western', w: 28 }, { v: 'indian', w: 24 }, { v: 'eastAsian', w: 14 }, { v: 'hispanic', w: 12 }, { v: 'european', w: 10 }, { v: 'mena', w: 7 }, { v: 'african', w: 5 }];

// ---------------- departments ----------------
// tech = engineering-style (more code-model usage, higher limits); share = rough project weight
const DEPT_DEFS = [
  { name: 'Core Engineering', tech: true, share: 14 },
  { name: 'Platform & Infrastructure', tech: true, share: 11 },
  { name: 'Mobile Engineering', tech: true, share: 8 },
  { name: 'Data Science & ML', tech: true, share: 10 },
  { name: 'Quality Engineering', tech: true, share: 7 },
  { name: 'Security Engineering', tech: true, share: 6 },
  { name: 'IT Operations', tech: true, share: 6 },
  { name: 'Product Management', tech: false, share: 7 },
  { name: 'Design', tech: false, share: 5 },
  { name: 'Sales', tech: false, share: 7 },
  { name: 'Marketing', tech: false, share: 5 },
  { name: 'Customer Success', tech: false, share: 6 },
  { name: 'Finance', tech: false, share: 4 },
  { name: 'Human Resources', tech: false, share: 3 },
  { name: 'Legal & Compliance', tech: false, share: 3 }
].slice(0, NUM_DEPTS);

const DESCRIPTORS = {
  'Core Engineering': ['Checkout Service', 'Billing Engine', 'Search Relevance', 'Notifications Hub', 'Order Pipeline', 'Account Service', 'Pricing API', 'Catalog Revamp', 'Realtime Sync', 'Partner Integrations'],
  'Platform & Infrastructure': ['Kubernetes Upgrade', 'Observability Stack', 'CI/CD Overhaul', 'Multi-Region Failover', 'Service Mesh', 'Cost Optimization', 'Secrets Management', 'Edge Caching'],
  'Mobile Engineering': ['iOS Redesign', 'Android Offline Mode', 'Push Reliability', 'Mobile SDK', 'Payments Wallet', 'App Performance'],
  'Data Science & ML': ['Churn Model', 'Recommendation Engine', 'Fraud Detection', 'Forecasting Platform', 'Feature Store', 'LLM Assistant', 'Experimentation Suite', 'Anomaly Alerts'],
  'Quality Engineering': ['Test Automation', 'Flaky Test Reduction', 'Load Testing', 'Contract Testing', 'Release Gating'],
  'Security Engineering': ['Zero Trust Rollout', 'Vulnerability Triage', 'Secrets Scanning', 'Threat Modeling', 'SOC Automation'],
  'IT Operations': ['Helpdesk Chatbot', 'Device Management', 'Identity Lifecycle', 'Network Refresh', 'Asset Tracking'],
  'Product Management': ['Self-Serve Onboarding', 'Pricing & Packaging', 'Roadmap Tooling', 'Customer Research', 'Growth Experiments'],
  'Design': ['Design System 2.0', 'Accessibility Audit', 'Onboarding Flows', 'Brand Guidelines'],
  'Sales': ['Enterprise Expansion', 'SMB Funnel', 'Renewal Automation', 'Partner Channel', 'Sales Playbooks'],
  'Marketing': ['Brand Refresh', 'ABM Campaigns', 'Content Engine', 'Event Programs', 'SEO Overhaul'],
  'Customer Success': ['Ticket Automation', 'Health Scoring', 'Onboarding Program', 'Knowledge Base', 'Escalation Playbooks'],
  'Finance': ['FP&A Automation', 'Close Streamlining', 'Procurement Workflow', 'Revenue Recognition'],
  'Human Resources': ['Talent Pipeline', 'Internal Mobility', 'Onboarding Experience'],
  'Legal & Compliance': ['Contract Review', 'Compliance Audit Prep', 'Policy Library']
};
const CODE_ADJ = ['Azure','Crimson','Golden','Silver','Amber','Cobalt','Onyx','Jade','Ivory','Scarlet','Violet','Teal'];
const CODE_NOUN = ['Falcon','Orion','Atlas','Phoenix','Nova','Titan','Aurora','Comet','Raven','Lynx','Pegasus','Vega'];

// ---------------- models + billing ----------------
// Estimated USD per token using public standard API rates and an 80% input /
// 20% output mix. This is a blended estimate; usage records do not split token types.
const MODELS = [
  { model: 'claude-haiku-5.5',  cost: 0.00000018, big: false },
  { model: 'claude-sonnet-5.5', cost: 0.00000360, big: false },
  { model: 'claude-opus-5.5',   cost: 0.00000720, big: true },
  { model: 'gpt-5',             cost: 0.00000300, big: false },
  { model: 'gpt-5-codex',       cost: 0.00000420, big: false },
  { model: 'gpt-5-mini',        cost: 0.00000060, big: false },
  { model: 'gemini-2.5-pro',    cost: 0.00000300, big: false },
  { model: 'gemini-2.5-flash',  cost: 0.00000074, big: false }
];
const MODEL_W_TECH = { 'claude-sonnet-5.5': 28, 'gpt-5-codex': 20, 'gpt-5': 13, 'claude-opus-5.5': 8, 'claude-haiku-5.5': 9, 'gemini-2.5-pro': 8, 'gpt-5-mini': 7, 'gemini-2.5-flash': 7 };
const MODEL_W_BIZ  = { 'gpt-5': 24, 'claude-sonnet-5.5': 24, 'claude-haiku-5.5': 18, 'gpt-5-mini': 12, 'gemini-2.5-flash': 10, 'gemini-2.5-pro': 8, 'claude-opus-5.5': 3, 'gpt-5-codex': 1 };

// ---------------- build org structure ----------------
// project counts per dept via largest-remainder on share weights
const shareTotal = DEPT_DEFS.reduce((s, d) => s + d.share, 0);
DEPT_DEFS.forEach((d) => { const exact = (d.share / shareTotal) * NUM_PROJECTS; d.nProj = Math.floor(exact); d.rem = exact - d.nProj; });
let left = NUM_PROJECTS - DEPT_DEFS.reduce((s, d) => s + d.nProj, 0);
[...DEPT_DEFS].sort((a, b) => b.rem - a.rem).slice(0, left).forEach((d) => d.nProj++);

const departments = DEPT_DEFS.map((d, i) => ({ id: i + 1, name: d.name, tech: d.tech, nProj: d.nProj, head: null, min_limit: 0, max_limit: 0 }));

const codenames = shuffle(CODE_ADJ.flatMap((a) => CODE_NOUN.map((n) => `${a} ${n}`)));
const projects = [];
departments.forEach((dept) => {
  const descs = shuffle(DESCRIPTORS[dept.name]);
  for (let i = 0; i < dept.nProj; i++) {
    const desc = descs[i % descs.length];
    projects.push({ id: projects.length + 1, name: `${codenames[projects.length]} - ${desc}`, dept_id: dept.id, pm: null, members: [], min_limit: 0, max_limit: 0 });
  }
});
if (projects.length !== NUM_PROJECTS) throw new Error('project count mismatch');

// ---------------- employees ----------------
const employees = [];
const usedEmail = new Set(), usedHandle = new Set();
function newPerson() {
  const pool = POOLS[weighted(POOL_WEIGHTS)];
  const first = pick(pool.f), last = pick(pool.l);
  let base = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, ''), email = `${base}@${COMPANY_DOMAIN}`, n = 1;
  while (usedEmail.has(email)) { n++; email = `${base}${n}@${COMPANY_DOMAIN}`; }
  usedEmail.add(email);
  let hb = `${first[0]}${last}`.toLowerCase().replace(/[^a-z]/g, ''), h = hb; n = 1;
  while (usedHandle.has(h)) { n++; h = `${hb}${n}`; }
  usedHandle.add(h);
  return { name: `${first} ${last}`, github_username: h, email };
}
function addEmp(role, tech, mgr_id, project_id) {
  const e = { id: employees.length + 1, ...newPerson(), role, tech, mgr_id, project_id, min_limit: 0, max_limit: 0 };
  employees.push(e);
  return e;
}
// starting monthly limit (tokens), by role and department type
function startLimit(role, tech) {
  const m = 100000;
  if (role === 'exec') return pick([1500000, 2000000]);
  if (role === 'dept_head') return pick([2000000, 2500000, 3000000]);
  if (role === 'project_manager') return tech ? pick([2500000, 3000000, 3500000]) : pick([1500000, 2000000, 2500000]);
  return tech ? weighted([{ v: 2000000, w: 3 }, { v: 3000000, w: 4 }, { v: 4000000, w: 3 }]) : weighted([{ v: 1000000, w: 3 }, { v: 1500000, w: 4 }, { v: 2000000, w: 3 }]) + 0 * m;
}

// 5 execs
const EXEC_TITLES = ['CEO', 'CTO', 'CFO', 'COO', 'CHRO'];
const execs = EXEC_TITLES.map((t, i) => { const e = addEmp('exec', false, i === 0 ? null : 1, null); e.title = t; return e; });
const execFor = (dept) => dept.tech ? execs[1] : ['Finance', 'Legal & Compliance'].includes(dept.name) ? execs[2] : dept.name === 'Human Resources' ? execs[4] : execs[3];

// 15 dept heads
departments.forEach((dept) => { const h = addEmp('dept_head', dept.tech, execFor(dept).id, null); dept.head = h; });
// 135 project managers (one per project)
projects.forEach((p) => { const dept = departments[p.dept_id - 1]; const pm = addEmp('project_manager', dept.tech, dept.head.id, p.id); p.pm = pm; p.members.push(pm); });
// ICs: at least 1 per project, remainder weighted toward projects of larger depts
const icCount = TOTAL_EMPLOYEES - employees.length - NUM_PROJECTS; // PMs already added; ICs = 500 - 5 - 15 - 135
const icTotal = TOTAL_EMPLOYEES - employees.length;
const icPlan = projects.map(() => 1);
for (let i = 0; i < icTotal - NUM_PROJECTS; i++) icPlan[randInt(0, NUM_PROJECTS - 1)]++;
projects.forEach((p, i) => { const dept = departments[p.dept_id - 1]; for (let k = 0; k < icPlan[i]; k++) { const e = addEmp('employee', dept.tech, p.pm.id, p.id); p.members.push(e); } });
if (employees.length !== TOTAL_EMPLOYEES) throw new Error(`employee count ${employees.length} != ${TOTAL_EMPLOYEES}`);

// starting limits (min = max)
employees.forEach((e) => { e.min_limit = startLimit(e.role, e.tech); e.max_limit = e.min_limit; });

// ---------------- usage generation ----------------
const PERSONAS = [
  { v: 'dormant', w: 8,  frac: [0.02, 0.15], wd: 0.10 },
  { v: 'light',   w: 25, frac: [0.20, 0.50], wd: 0.35 },
  { v: 'regular', w: 40, frac: [0.50, 0.95], wd: 0.70 },
  { v: 'heavy',   w: 20, frac: [0.95, 1.30], wd: 0.88 },
  { v: 'extreme', w: 7,  frac: [1.30, 2.20], wd: 0.95 }
];
const PERSONA_BY = Object.fromEntries(PERSONAS.map((p) => [p.v, p]));

const usage = [];            // { u, t, m, d }
const lastMonthTotal = {};   // username -> tokens in the final month
const months = [];
for (let i = 0; i < 6; i++) { const s = new Date(Date.UTC(2026, 3 + i, 1)); const e = new Date(Date.UTC(2026, 4 + i, 0)); months.push({ start: s, end: e }); }

employees.forEach((emp) => {
  const persona = PERSONA_BY[weighted(PERSONAS.map((p) => ({ v: p.v, w: p.w })))];
  const baseTarget = randFloat(persona.frac[0], persona.frac[1]) * emp.min_limit;  // last-month target
  const modelW = Object.entries(emp.tech ? MODEL_W_TECH : MODEL_W_BIZ).map(([m, w]) => ({ v: m, w: w * randFloat(0.4, 1.6) })); // per-user preference
  lastMonthTotal[emp.github_username] = 0;

  months.forEach((mo, mi) => {
    const target = baseTarget * MONTH_GROWTH[mi] * randFloat(0.9, 1.1);
    // pick active days (weekday-heavy)
    const days = [];
    for (let d = new Date(mo.start); d <= mo.end; d = addDays(d, 1)) {
      const wknd = d.getUTCDay() === 0 || d.getUTCDay() === 6;
      if (rand() < persona.wd * (wknd ? 0.12 : 1)) days.push({ d: new Date(d), w: randFloat(0.5, 1.5) });
    }
    // pad days so the target can't pile onto a handful of days
    const needed = Math.ceil(target / MAX_DAILY_TOKENS);
    if (days.length < needed) {
      const have = new Set(days.map((x) => dstr(x.d)));
      const pool = [];
      for (let d = new Date(mo.start); d <= mo.end; d = addDays(d, 1)) if (!have.has(dstr(d))) pool.push(new Date(d));
      shuffle(pool).slice(0, needed - days.length).forEach((d) => days.push({ d, w: randFloat(0.3, 0.8) }));
    }
    if (days.length === 0) return;
    const wsum = days.reduce((s, x) => s + x.w, 0);
    const capped = Math.min(target, days.length * MAX_DAILY_TOKENS);

    days.forEach(({ d, w }) => {
      const dayTokens = Math.max(200, Math.round(capped * (w / wsum)));
      // split the day into requests of roughly 5k-80k tokens each (log-normal-ish)
      const avgReq = Math.exp(Math.log(22000) + 0.7 * randNormal());
      const n = Math.max(1, Math.min(60, Math.round(dayTokens / Math.max(1500, avgReq))));
      const ws = Array.from({ length: n }, () => Math.exp(0.8 * randNormal()));
      const wTot = ws.reduce((s, x) => s + x, 0);
      let sizes = ws.map((x) => Math.max(100, Math.round(dayTokens * x / wTot)));
      const drift = dayTokens - sizes.reduce((s, x) => s + x, 0);
      sizes[sizes.indexOf(Math.max(...sizes))] = Math.max(100, sizes[sizes.indexOf(Math.max(...sizes))] + drift);
      const ds = dstr(d);
      sizes.forEach((tok) => {
        // bigger requests lean toward the heavier model if the user has it in their mix
        let model = weighted(modelW);
        if (tok < 3000 && rand() < 0.5) model = weighted(modelW.filter((x) => ['claude-haiku-5.5', 'gpt-5-mini', 'gemini-2.5-flash'].includes(x.v)));
        usage.push({ u: emp.github_username, t: tok, m: model, d: ds });
        if (mi === months.length - 1) lastMonthTotal[emp.github_username] += tok;
      });
    });
  });
});

// ---------------- limits: raise employee max, then roll up ----------------
employees.forEach((e) => {
  const c = lastMonthTotal[e.github_username];
  if (c > e.max_limit) e.max_limit = e.min_limit + Math.ceil((c - e.min_limit) / LIMIT_STEP) * LIMIT_STEP;
});

// project: min = members' min * buffer, strictly above; max grows only if members' max outgrows it
projects.forEach((p) => {
  const sumMin = p.members.reduce((s, e) => s + e.min_limit, 0);
  const sumMax = p.members.reduce((s, e) => s + e.max_limit, 0);
  p.min_limit = roundUp(sumMin * randFloat(1.06, 1.18), 100000);
  p.max_limit = sumMax < p.min_limit ? p.min_limit : roundUp(sumMax * 1.05, 100000);
});
// department: min = (projects' min + head's min) * buffer; max grows only if needed
departments.forEach((d) => {
  const ps = projects.filter((p) => p.dept_id === d.id);
  const sumMin = ps.reduce((s, p) => s + p.min_limit, 0) + d.head.min_limit;
  const sumMax = ps.reduce((s, p) => s + p.max_limit, 0) + d.head.max_limit;
  d.min_limit = roundUp(sumMin * randFloat(1.05, 1.12), 500000);
  d.max_limit = sumMax < d.min_limit ? d.min_limit : roundUp(sumMax * 1.05, 500000);
});

// ---------------- invariants ----------------
(function verify() {
  const errs = [];
  projects.forEach((p) => {
    const sMin = p.members.reduce((s, e) => s + e.min_limit, 0), sMax = p.members.reduce((s, e) => s + e.max_limit, 0);
    if (!(p.min_limit > sMin)) errs.push(`project ${p.id}: min ${p.min_limit} <= sum(emp min) ${sMin}`);
    if (!(p.max_limit > sMax)) errs.push(`project ${p.id}: max ${p.max_limit} <= sum(emp max) ${sMax}`);
    if (p.max_limit < p.min_limit) errs.push(`project ${p.id}: max < min`);
  });
  departments.forEach((d) => {
    const ps = projects.filter((p) => p.dept_id === d.id);
    const sMin = ps.reduce((s, p) => s + p.min_limit, 0) + d.head.min_limit, sMax = ps.reduce((s, p) => s + p.max_limit, 0) + d.head.max_limit;
    if (!(d.min_limit > sMin)) errs.push(`dept ${d.id}: min ${d.min_limit} <= sum(projects+head min) ${sMin}`);
    if (!(d.max_limit > sMax)) errs.push(`dept ${d.id}: max ${d.max_limit} <= sum(projects+head max) ${sMax}`);
  });
  employees.forEach((e) => { if (e.max_limit < e.min_limit) errs.push(`emp ${e.id}: max < min`); });
  // every employee's September usage must fit under their max_limit
  employees.forEach((e) => { if (lastMonthTotal[e.github_username] > e.max_limit) errs.push(`emp ${e.id}: usage ${lastMonthTotal[e.github_username]} > max ${e.max_limit}`); });
  if (errs.length) { console.error(errs.slice(0, 20).join('\n')); throw new Error(`${errs.length} invariant violations`); }
  console.log('Invariants OK: dept > projects > employees (min and max), usage within max_limit');
})();

// ---------------- write SQL ----------------
function write(file, header, stmts) { fs.writeFileSync(path.join(SEEDS_DIR, file), `-- Auto-generated by generate_mock_data.js\n-- ${header}\n\n${stmts.join('\n')}\n`); console.log(`wrote ${file} (${stmts.length} statements)`); }
function batch(table, cols, rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES\n${rows.slice(i, i + size).map((r) => '(' + r.map(q).join(', ') + ')').join(',\n')};`);
  return out;
}

write('01_billing.sql', `${MODELS.length} models (estimated USD per token; 80% input / 20% output public API rates)`,
  batch('billing', ['model', 'per_token_cost'], MODELS.map((m) => [m.model, m.cost]), 100));

write('02_departments.sql', `${departments.length} departments (dept_head_employee_id is linked in 06_link_heads.sql)`,
  batch('departments', ['id', 'name', 'dept_head_employee_id', 'min_limit', 'max_limit'], departments.map((d) => [d.id, d.name, null, d.min_limit, d.max_limit]), 100)
    .concat([`SELECT setval('departments_id_seq', (SELECT MAX(id) FROM departments));`]));

write('03_projects.sql', `${projects.length} projects (project_mgr_employee_id is linked in 06_link_heads.sql)`,
  batch('projects', ['id', 'name', 'dept_id', 'project_mgr_employee_id', 'min_limit', 'max_limit'], projects.map((p) => [p.id, p.name, p.dept_id, null, p.min_limit, p.max_limit]), 100)
    .concat([`SELECT setval('projects_id_seq', (SELECT MAX(id) FROM projects));`]));

// employees are ordered so every manager appears before their reports (ids ascend by hierarchy level)
write('04_employees.sql', `${employees.length} employees (execs, dept heads, project managers, then ICs)`,
  batch('employees', ['id', 'name', 'github_username', 'email', 'role', 'mgr_id', 'project_id', 'min_limit', 'max_limit'],
    employees.map((e) => [e.id, e.name, e.github_username, e.email, e.role, e.mgr_id, e.project_id, e.min_limit, e.max_limit]), 250)
    .concat([`SELECT setval('employees_id_seq', (SELECT MAX(id) FROM employees));`]));

write('05_copilot_usage.sql', `${usage.length} requests, ${dstr(START_DATE)} to ${dstr(END_DATE)}`,
  batch('copilot_usage', ['github_username', 'tokens_consumed', 'model_used', 'usage_date'], usage.map((r) => [r.u, r.t, r.m, r.d]), 1000));

write('06_link_heads.sql', 'Circular references: set dept heads and project managers now that employees exist',
  departments.map((d) => `UPDATE departments SET dept_head_employee_id = ${d.head.id} WHERE id = ${d.id};`)
    .concat(projects.map((p) => `UPDATE projects SET project_mgr_employee_id = ${p.pm.id} WHERE id = ${p.id};`)));

fs.writeFileSync(path.join(SEEDS_DIR, '00_run_all.sql'),
  '-- Run from the seeds directory:  psql -d copilot_adoption -f 00_run_all.sql\n' +
  ['01_billing.sql', '02_departments.sql', '03_projects.sql', '04_employees.sql', '05_copilot_usage.sql', '06_link_heads.sql'].map((f) => `\\i ${f}`).join('\n') + '\n');

// ---------------- summary ----------------
const tokensTotal = usage.reduce((s, r) => s + r.t, 0);
const raised = employees.filter((e) => e.max_limit > e.min_limit).length;
const cost = usage.reduce((s, r) => s + r.t * MODELS.find((m) => m.model === r.m).cost, 0);
console.log(`\nemployees: ${employees.length} | depts: ${departments.length} | projects: ${projects.length}`);
console.log(`roles:`, employees.reduce((a, e) => (a[e.role] = (a[e.role] || 0) + 1, a), {}));
console.log(`usage rows: ${usage.length} | total tokens: ${(tokensTotal / 1e9).toFixed(2)}B | est. cost: $${Math.round(cost).toLocaleString()}`);
console.log(`employees with raised max_limit: ${raised} (${((raised / employees.length) * 100).toFixed(1)}%)`);
console.log(`projects with raised max: ${projects.filter((p) => p.max_limit > p.min_limit).length}/${projects.length} | depts: ${departments.filter((d) => d.max_limit > d.min_limit).length}/${departments.length}`);
console.log(`project sizes: min ${Math.min(...projects.map((p) => p.members.length))}, max ${Math.max(...projects.map((p) => p.members.length))}`);
