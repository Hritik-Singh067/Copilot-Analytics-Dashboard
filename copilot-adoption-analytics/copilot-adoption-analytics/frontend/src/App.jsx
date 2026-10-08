import React, { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArcElement, BarController, BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, LineController, LineElement, PointElement, Tooltip } from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import societeGeneraleLogo from './Societe-Generale-Logo.png';

ChartJS.register(ArcElement, BarController, BarElement, CategoryScale, Legend, LinearScale, LineController, LineElement, PointElement, Tooltip);

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function savedUser() {
  try {
    const user = JSON.parse(localStorage.getItem('copilot-user') || 'null');
    return user && Number.isInteger(Number(user.id)) ? user : null;
  } catch {
    return null;
  }
}

async function request(path, options) {
  const response = await fetch(`${API_BASE}/api${path}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    throw new Error(body.message || `Request failed (${response.status})`);
  }
  return body;
}

function TokenPieCard({ title, subtitle, consumed, limit, onClick }) {
  const used = Math.max(0, Number(consumed) || 0);
  const allocation = Math.max(0, Number(limit) || 0);
  const remaining = Math.max(0, allocation - used);
  const percent = allocation > 0 ? Math.round((used / allocation) * 100) : null;
  const data = {
    labels: ['Consumed', 'Remaining'],
    datasets: [{
      data: allocation > 0 ? [used, remaining] : [1],
      backgroundColor: allocation > 0 ? ['#c8102e', '#e7e7e7'] : ['#c8102e'],
      borderWidth: 0,
      hoverOffset: 4
    }]
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '76%',
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: { label: (context) => `${context.label}: ${Number(context.raw).toLocaleString()} tokens` }
      }
    }
  };

  return (
    <article
      className={`token-chart-card${onClick ? ' token-chart-card-clickable' : ''}`}
      onClick={onClick}
      onKeyDown={onClick ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick(); } } : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `${title}, open daily usage detail` : undefined}
    >
      <div className="token-chart-heading"><span className="eyebrow">MONTHLY ALLOCATION</span><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>
      <div className="token-chart-visual">
        <Doughnut data={data} options={options} aria-label={`${title}: ${used.toLocaleString()} consumed out of ${allocation.toLocaleString()} allocated tokens`} />
        <div className="token-chart-center"><strong>{percent === null ? 'N/A' : `${percent}%`}</strong><span>USED</span></div>
      </div>
      <div className="token-chart-values">
        <div><span><i className="legend-swatch used" />Consumed</span><strong>{used.toLocaleString()}</strong></div>
        <div><span><i className="legend-swatch remaining" />Limit</span><strong>{allocation.toLocaleString()}</strong></div>
      </div>
      {used > allocation && <div className="over-limit-note">Over allocation by {(used - allocation).toLocaleString()} tokens</div>}
      {onClick && <div className="chart-detail-link">OPEN DAILY DETAIL <span aria-hidden="true">↗</span></div>}
    </article>
  );
}

function DailyUsageChart({ series = [], limit, compact = false }) {
  const values = series.map((point) => Number(point.tokens) || 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  const cumulativeValues = values.map((value, index) => values.slice(0, index + 1).reduce((sum, dailyValue) => sum + dailyValue, 0));
  const firstDate = series[0]?.date;
  const monthName = series.length ? formatMonth(series[0].date) : 'Usage period';
  const selectedMonth = firstDate?.slice(0, 7);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const showForecast = selectedMonth === currentMonth;
  const monthStart = firstDate ? new Date(`${firstDate.slice(0, 7)}-01T00:00:00Z`) : new Date();
  const daysInMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate();
  const dailyAverage = series.length ? total / series.length : 0;
  const monthEndEstimate = showForecast ? dailyAverage * daysInMonth : total;
  const tokenLimit = Math.max(0, Number(limit) || 0);
  const actualCumulativeByDay = Array(daysInMonth + 1).fill(null);
  series.forEach((point, index) => {
    const dayOfMonth = new Date(`${point.date}T00:00:00Z`).getUTCDate();
    actualCumulativeByDay[dayOfMonth] = cumulativeValues[index];
  });
  const labels = Array.from({ length: daysInMonth + 1 }, (_, day) => day);
  const projectedCumulative = labels.map((day) => dailyAverage * day);
  const chartLimit = tokenLimit > 0 ? tokenLimit : Math.max(1, total, monthEndEstimate);
  const chartData = {
    labels,
    datasets: [
      {
        label: 'Actual cumulative usage',
        data: actualCumulativeByDay,
        borderColor: '#c8102e',
        backgroundColor: '#c8102e',
        pointBackgroundColor: '#c8102e',
        pointBorderColor: '#fff',
        pointBorderWidth: 1,
        pointRadius: 2.5,
        pointHoverRadius: 6,
        pointHitRadius: 10,
        borderWidth: 2.5,
        tension: 0.22,
        spanGaps: false
      },
      ...(showForecast ? [{
        label: 'Predicted cumulative usage',
        data: projectedCumulative,
        borderColor: '#2463eb',
        backgroundColor: '#2463eb',
        pointBackgroundColor: '#2463eb',
        pointBorderColor: '#fff',
        pointBorderWidth: 1,
        pointRadius: 2.5,
        pointHoverRadius: 6,
        pointHitRadius: 10,
        borderWidth: 2,
        borderDash: [5, 5],
        tension: 0,
      }] : [])
    ]
  };
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: { display: true, position: 'bottom', labels: { usePointStyle: true, boxWidth: 7, padding: 10, color: '#555', font: { size: 9 } } },
      tooltip: {
        filter: (context) => context.dataIndex > 0,
        callbacks: {
          title: (items) => `${monthName} · Day ${items[0]?.label}`,
          label: (context) => {
            const dayIndex = context.dataIndex - 1;
            const predictedValue = Math.round(Number(context.raw) || 0).toLocaleString();
            if (context.datasetIndex === 0) {
              return [
                `Daily consumption: ${values[dayIndex].toLocaleString()} tokens`,
                `Actual cumulative: ${cumulativeValues[dayIndex].toLocaleString()} tokens`
              ];
            }
            return `Predicted cumulative: ${predictedValue} tokens`;
          }
        }
      }
    },
    scales: {
      x: { title: { display: true, text: `Day of month · ${monthName}`, color: '#666', font: { size: compact ? 8 : 10 } }, grid: { display: false }, ticks: { color: '#777', maxTicksLimit: compact ? 7 : 16 } },
      y: { beginAtZero: true, min: 0, max: chartLimit, title: { display: true, text: 'Cumulative token count', color: '#666', font: { size: compact ? 8 : 10 } }, ticks: { color: '#777', callback: (value) => Number(value).toLocaleString() }, grid: { color: '#ededed' } }
    }
  };

  return (
    <section className={`daily-chart-panel${compact ? ' daily-chart-panel-compact' : ''}`}>
      <div className="daily-chart-header"><div><span className="eyebrow">{monthName.toUpperCase()} · CUMULATIVE CONSUMPTION</span>{!compact && <><h2>{showForecast ? 'Cumulative usage forecast' : 'Cumulative usage'}</h2>
      {/* <p>{showForecast ? 'Red line: actual cumulative usage · blue dotted line: average-pace projection to month-end.' : 'Red line: actual cumulative usage; projections are hidden for completed months.'} Hover a daily point for totals.</p> */}
      </>}
      </div></div>
      <div className="daily-chart-canvas"><Line data={chartData} options={chartOptions} /></div>
      <div className="daily-extremes forecast-summary">
        <div><span>{showForecast ? 'MONTH-END ESTIMATE' : 'MONTH TOTAL'}</span><strong>{Math.round(monthEndEstimate).toLocaleString()}</strong></div>
        <div><span>AVERAGE PER DAY</span><strong>{Math.round(dailyAverage).toLocaleString()}</strong></div>
      </div>
    </section>
  );
}

function AnalyticsCarousel({ items, selectedIndex, onSelect, itemLabel, children }) {
  const currentIndex = Math.min(selectedIndex, items.length - 1);
  return (
    <div className="analytics-carousel">
      <div className="project-switcher">
        <button className="project-nav-button" type="button" aria-label={`Previous ${itemLabel}`} disabled={currentIndex <= 0} onClick={() => onSelect(currentIndex - 1)}>←</button>
        <span>{String(currentIndex + 1).padStart(2, '0')} <i>/</i> {String(items.length).padStart(2, '0')}</span>
        <button className="project-nav-button" type="button" aria-label={`Next ${itemLabel}`} disabled={currentIndex >= items.length - 1} onClick={() => onSelect(currentIndex + 1)}>→</button>
      </div>
      {children(items[currentIndex], currentIndex)}
    </div>
  );
}

function TokenUsageTable({ title, category, period, rows, onOpen }) {
  const [sortBy, setSortBy] = useState('usage-desc');
  const sortedRows = [...rows].sort((left, right) => {
    const leftUsage = Number(left.consumed_tokens) || 0;
    const rightUsage = Number(right.consumed_tokens) || 0;
    const leftLimit = Number(left.token_limit) || 0;
    const rightLimit = Number(right.token_limit) || 0;
    if (sortBy === 'usage-asc') return leftUsage - rightUsage;
    if (sortBy === 'name-asc') return left.name.localeCompare(right.name);
    if (sortBy === 'utilization-desc') {
      return (rightLimit ? rightUsage / rightLimit : 0) - (leftLimit ? leftUsage / leftLimit : 0);
    }
    return rightUsage - leftUsage;
  });

  return (
    <section className="subordinate-usage-section">
      <div className="section-title">
        <div><span className="eyebrow">SUBORDINATE ALLOCATIONS · {period}</span><h2>{title}</h2></div>
        <div className="subordinate-table-controls">
          <span>{rows.length} {category.toUpperCase()}</span>
          <label>Sort
            <select className="form-select form-select-sm" aria-label={`Sort ${category} by`} value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              <option value="usage-desc">Most tokens</option>
              <option value="usage-asc">Fewest tokens</option>
              <option value="utilization-desc">Highest utilization</option>
              <option value="name-asc">Name A to Z</option>
            </select>
          </label>
        </div>
      </div>
      <div className="table-responsive token-usage-table-wrap">
        <table className="table token-usage-table align-middle mb-0">
          <thead><tr><th scope="col">{category}</th><th scope="col">Usage vs allocation</th><th scope="col" className="text-end">Consumed</th><th scope="col" className="text-end">Max allocation</th></tr></thead>
          <tbody>
            {sortedRows.map((row) => {
              const consumed = Math.max(0, Number(row.consumed_tokens) || 0);
              const allocation = Math.max(0, Number(row.token_limit) || 0);
              const percent = allocation ? consumed / allocation * 100 : 0;
              const cappedPercent = Math.min(100, percent);
              const overLimit = consumed > allocation;
              return (
                <tr
                  key={row.id}
                  className={onOpen ? 'token-usage-row-clickable' : undefined}
                  onClick={onOpen ? () => onOpen(row) : undefined}
                  onKeyDown={onOpen ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(row); } } : undefined}
                  role={onOpen ? 'link' : undefined}
                  tabIndex={onOpen ? 0 : undefined}
                >
                  <th scope="row">{row.name}</th>
                  <td>
                    <div className="usage-progress-cell">
                      <div className="progress usage-progress" role="progressbar" aria-label={`${row.name} token allocation`} aria-valuenow={Math.round(cappedPercent)} aria-valuemin="0" aria-valuemax="100">
                        <div className={`progress-bar ${overLimit ? 'usage-progress-over' : 'usage-progress-fill'}`} style={{ width: `${cappedPercent}%` }} />
                      </div>
                      <span className={overLimit ? 'usage-percent usage-percent-over' : 'usage-percent'}>{allocation ? `${Math.round(percent)}%` : 'No allocation'}</span>
                    </div>
                  </td>
                  <td className="text-end token-usage-number">{consumed.toLocaleString()}{overLimit && <span className="usage-over-badge">OVER</span>}</td>
                  <td className="text-end token-usage-number">{allocation.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ModelUsageChart({ rows = [] }) {
  if (!rows.length) return null;
  const period = formatMonth(rows[0].period_start);
  const chartData = {
    labels: rows.map((row) => row.model),
    datasets: [{
      label: 'Tokens consumed',
      data: rows.map((row) => Number(row.tokens) || 0),
      backgroundColor: ['#c8102e', '#176b5b', '#d68b00', '#2864b4', '#784e9b', '#487c32', '#c45b24', '#167c91'],
      borderWidth: 0,
      borderRadius: 2,
      maxBarThickness: 24
    }]
  };
  const options = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (context) => `${Number(context.raw).toLocaleString()} tokens consumed` } }
    },
    scales: {
      x: { beginAtZero: true, title: { display: true, text: 'Tokens consumed' }, ticks: { callback: (value) => Number(value).toLocaleString() }, grid: { color: '#ededed' } },
      y: { grid: { display: false }, ticks: { color: '#444' } }
    }
  };

  return (
    <section className="model-usage-section">
      <div className="section-title"><div><span className="eyebrow">{period.toUpperCase()} · ALL SCOPED REQUESTS</span><h2>Token usage by model</h2></div><span>{rows.length} MODELS</span></div>
      <div className="model-usage-chart-wrap"><Bar data={chartData} options={options} /></div>
    </section>
  );
}

function formatMonth(dateString) {
  if (!dateString) return 'Current month';
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${dateString}T00:00:00Z`));
}

function ExecutiveDepartmentCarousel({ analytics }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const departments = analytics.departments || [];

  return (
    <AnalyticsCarousel items={departments} selectedIndex={selectedIndex} onSelect={setSelectedIndex} itemLabel="department">
      {(department) => <>
        <TokenPieCard
          title={department.name}
          subtitle={`${analytics.period_start} to ${analytics.period_end}`}
          consumed={department.consumed_tokens}
          limit={department.token_limit}
        />
        <DailyUsageChart series={department.daily_usage} limit={department.token_limit} compact />
      </>}
    </AnalyticsCarousel>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (savedUser()) return <Navigate to="/data" replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    const normalizedEmail = email.trim();
    if (!EMAIL_RE.test(normalizedEmail)) {
      setError('Enter a valid work email address.');
      return;
    }

    setBusy(true);
    try {
      const result = await request('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail })
      });
      if (!result.user?.id) throw new Error('The login response did not include an employee ID.');
      localStorage.setItem('copilot-user', JSON.stringify(result.user));
      navigate('/data', { replace: true });
    } catch (requestError) {
      setError(requestError.message === 'Failed to fetch'
        ? 'Could not reach the API. Check that the backend is running on port 4000.'
        : requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-aside" aria-label="Product information">
        <Link className="brand-lockup" to="/" aria-label="Copilot Adoption home">
          <span className="brand-mark">C</span>
          <span>FIELDNOTES <i>/</i> COPILOT</span>
        </Link>
        <div className="aside-copy">
          <div className="eyebrow"><span className="status-dot" /> ADOPTION INTELLIGENCE</div>
          <h1>Make usage<br />visible.</h1>
          <p>A clear view of how your organization is putting Copilot to work.</p>
        </div>
        <div className="aside-index"><span>01</span><span>ACCESS PORTAL</span><span>2026</span></div>
      </section>

      <section className="auth-main">
        <div className="auth-topline"><span>WORKSPACE ACCESS</span><span>SECURE SIGN IN <b>↗</b></span></div>
        <div className="auth-form-wrap">
          <div className="auth-heading">
            <div className="eyebrow text-muted">YOUR WORKSPACE</div>
            <h2>{mode === 'signin' ? 'Welcome back.' : 'Get access.'}</h2>
            <p>{mode === 'signin'
              ? 'Sign in with your employee email to continue.'
              : 'Access is provisioned by your workspace administrator.'}</p>
          </div>

          <div className="auth-tabs" role="tablist" aria-label="Account access mode">
            <button className={mode === 'signin' ? 'active' : ''} onClick={() => { setMode('signin'); setError(''); }} role="tab" aria-selected={mode === 'signin'}>Sign in</button>
            <button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }} role="tab" aria-selected={mode === 'register'}>Register</button>
          </div>

          {mode === 'register' ? (
            <div className="register-note" role="status">
              <span className="note-mark">i</span>
              <div><strong>Registration isn’t enabled yet.</strong><p>This workspace currently accepts existing employee accounts only. Ask your administrator to add your work email, then sign in here.</p></div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              <label className="form-label" htmlFor="email">Work email</label>
              <div className="input-wrap">
                <span className="input-icon" aria-hidden="true">@</span>
                <input
                  id="email"
                  className={`form-control ${error ? 'is-invalid' : ''}`}
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(event) => { setEmail(event.target.value); setError(''); }}
                  aria-describedby={error ? 'email-error' : 'email-help'}
                  required
                />
              </div>
              {error
                ? <div className="form-error" id="email-error" role="alert">{error}</div>
                : <div className="form-text" id="email-help">Use the email address associated with your employee account.</div>}
              <button className="btn btn-access w-100" type="submit" disabled={busy}>
                {busy ? <><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />Checking access</> : <>Continue with email <span aria-hidden="true">→</span></>}
              </button>
            </form>
          )}
          {mode === 'register' && <button className="btn btn-access w-100" onClick={() => setMode('signin')}>Return to sign in <span aria-hidden="true">→</span></button>}
          <div className="auth-footnote"><span className="lock-icon" aria-hidden="true">▣</span> No password required for this prototype</div>
        </div>
        <footer className="auth-footer"><span>COPILOT ADOPTION ANALYTICS</span><span>INTERNAL USE</span></footer>
      </section>
    </main>
  );
}

function UsageDetailPage() {
  const { scope, targetId } = useParams();
  const [searchParams] = useSearchParams();
  const user = savedUser();
  const selectedMonth = searchParams.get('month') || '';
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const monthQuery = selectedMonth ? `&month=${encodeURIComponent(selectedMonth)}` : '';
    request(`/data?user_id=${encodeURIComponent(user.id)}${monthQuery}`, { signal: controller.signal })
      .then((result) => {
        const tokenAnalytics = result.token_analytics;
        const target = scope === 'employee'
          ? user.role === 'employee' && String(user.id) === targetId
            ? tokenAnalytics?.employee
            : user.role === 'project_manager'
              ? tokenAnalytics?.employees?.find((employee) => String(employee.id) === targetId)
              : null
          : scope === 'project'
            ? tokenAnalytics?.projects?.find((project) => String(project.id) === targetId)
            : scope === 'department' && user.role === 'exec'
              ? tokenAnalytics?.departments?.find((department) => String(department.id) === targetId)
              : null;
        if (!target) throw new Error('Usage details are not available for this account.');
        setAnalytics({ ...target, period_start: target.period_start || tokenAnalytics.period_start, period_end: target.period_end || tokenAnalytics.period_end, scope });
      })
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(requestError.message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [user?.id, user?.role, scope, targetId, selectedMonth]);

  if (!user) return <Navigate to="/" replace />;
  const allowedDetail = (scope === 'employee' && ['employee', 'project_manager'].includes(user.role))
    || (scope === 'project' && ['project_manager', 'dept_head'].includes(user.role))
    || (scope === 'department' && user.role === 'exec');
  if (!allowedDetail) return <Navigate to="/data" replace />;
  const displayUser = analytics?.scope === 'employee' && analytics.email
    ? { ...user, name: analytics.name, email: analytics.email, role: 'employee' }
    : user;

  return (
    <main className="data-shell">
      <header className="data-header">
        <Link className="brand-lockup data-brand" to="/data" aria-label="Copilot Usage Analytics Dashboard">
          <img className="brand-logo" src={societeGeneraleLogo} alt="Société Générale" />
        </Link>
        <div className="header-user"><div><strong>{displayUser.name}</strong></div><span className="role-tag">{displayUser.role.replaceAll('_', ' ')}</span></div>
      </header>
      <section className="data-content usage-detail-content">
        <Link className="back-link" to="/data"><span aria-hidden="true">←</span> Back to overview</Link>
        {loading && <div className="loading-state"><span className="spinner-border" aria-hidden="true" /><span>Loading daily usage</span></div>}
        {error && <div className="alert alert-danger" role="alert">{error}</div>}
        {analytics && <>
          <div className="data-heading detail-heading"><div><div className="eyebrow text-muted">{formatMonth(analytics.period_start)} · DAILY DETAIL</div><h1>{analytics.scope === 'employee' && String(user.id) === targetId ? 'Your usage.' : analytics.name}</h1><p>{analytics.scope === 'employee' ? 'Daily tokens consumed against this employee allocation.' : analytics.scope === 'department' ? 'Daily tokens consumed across this department.' : 'Combined daily tokens consumed by project employees.'}</p></div></div>
          <div className="usage-detail-grid">
            <TokenPieCard title={analytics.scope === 'employee' ? 'Employee allocation' : analytics.name} subtitle={`${analytics.period_start} to ${analytics.period_end}`} consumed={analytics.consumed_tokens} limit={analytics.token_limit} />
            <DailyUsageChart series={analytics.daily_usage} limit={analytics.token_limit} />
          </div>
        </>}
      </section>
      <footer className="data-footer"><span>COPILOT ADOPTION ANALYTICS</span><span>DAILY USAGE · {analytics ? formatMonth(analytics.period_start).toUpperCase() : ''}</span></footer>
    </main>
  );
}

function DataPage() {
  const navigate = useNavigate();
  const user = savedUser();
  const [response, setResponse] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [projectIndex, setProjectIndex] = useState(0);
  const [departmentProjectIndex, setDepartmentProjectIndex] = useState(0);
  const [selectedMonth, setSelectedMonth] = useState('');

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setResponse(null);
    const monthQuery = selectedMonth ? `&month=${encodeURIComponent(selectedMonth)}` : '';
    request(`/data?user_id=${encodeURIComponent(user.id)}${monthQuery}`, { signal: controller.signal })
      .then(setResponse)
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(requestError.message === 'Failed to fetch'
          ? 'Could not reach the API. Check that the backend is running on port 4000.'
          : requestError.message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [user?.id, selectedMonth]);

  if (!user) return <Navigate to="/" replace />;

  function signOut() {
    localStorage.removeItem('copilot-user');
    navigate('/', { replace: true });
  }

  const subordinateUsage = response?.role === 'exec'
    ? { title: 'Token usage by department', category: 'departments', scope: 'department', rows: response.token_analytics?.departments }
    : response?.role === 'dept_head'
      ? { title: 'Token usage by project', category: 'projects', scope: 'project', rows: response.token_analytics?.projects }
      : response?.role === 'project_manager'
        ? { title: 'Token usage by employee', category: 'employees', scope: 'employee', rows: response.token_analytics?.employees }
        : null;
  const monthOptions = [...new Set([
    ...(response?.available_months || []),
    response?.token_analytics?.period_start?.slice(0, 7),
    new Date().toISOString().slice(0, 7),
    selectedMonth
  ].filter(Boolean))].sort().reverse();

  return (
    <main className="data-shell">
      <header className="data-header">
        <Link className="brand-lockup data-brand" to="/">
          <img className="brand-logo" src={societeGeneraleLogo} alt="Société Générale" />
        </Link>
        <div className="header-user">
          <div><strong>{user.name}</strong></div>
          <span className="role-tag">{user.role.replaceAll('_', ' ')}</span>
          <button className="btn btn-signout" onClick={signOut}>Sign out <span aria-hidden="true">↗</span></button>
        </div>
      </header>

      <section className="data-content">
        <div className="data-heading">
          <div>
            <h1>Copilot Usage Analytics Dashboard</h1>
          </div>
          <div className="data-controls">
            {response && <label className="month-filter">Usage month
              <select className="form-select form-select-sm" value={selectedMonth || response.filters?.month || response.token_analytics?.period_start?.slice(0, 7) || ''} onChange={(event) => setSelectedMonth(event.target.value)}>
                {monthOptions.map((month) => <option key={month} value={month}>{formatMonth(`${month}-01`)}</option>)}
              </select>
            </label>}
          </div>
        </div>

        {loading && <div className="loading-state"><span className="spinner-border" aria-hidden="true" /><span>Loading your workspace data</span></div>}
        {error && <div className="alert alert-danger" role="alert"><strong>Couldn’t load workspace data.</strong><div>{error}</div><button className="btn btn-sm btn-outline-danger mt-3" onClick={() => window.location.reload()}>Try again</button></div>}

        {response && <>
          {response.role === 'exec' && response.token_analytics?.departments?.length > 0 && <section className="token-analytics-section executive-analytics-section">
            <div className="section-title"><div><span className="eyebrow">{formatMonth(response.token_analytics.period_start)}</span><h2>Department consumption</h2></div><span>{response.token_analytics.departments.length} DEPARTMENTS</span></div>
            <ExecutiveDepartmentCarousel analytics={response.token_analytics} />
          </section>}

          {response.token_analytics?.employee && <section className="token-analytics-section">
            <div className="section-title"><div><span className="eyebrow">{formatMonth(response.token_analytics.period_start)}</span><h2>Your token consumption</h2></div><span>LAST MONTH</span></div>
            <AnalyticsCarousel items={[response.token_analytics.employee]} selectedIndex={0} onSelect={() => {}} itemLabel="usage period">
              {(employee) => <>
              <TokenPieCard
                title="Employee allocation"
                subtitle={`${response.token_analytics.period_start} to ${response.token_analytics.period_end}`}
                consumed={employee.consumed_tokens}
                limit={employee.token_limit}
              />
              <DailyUsageChart series={employee.daily_usage} limit={employee.token_limit} compact />
              </>}
            </AnalyticsCarousel>
          </section>}

          {response.role === 'project_manager' && <section className="token-analytics-section">
            <div className="section-title"><div><span className="eyebrow">{formatMonth(response.token_analytics?.period_start)}</span><h2>Project consumption</h2></div><span>LAST MONTH · {response.token_analytics?.projects?.length || 0} PROJECTS</span></div>
            {response.token_analytics?.projects?.length ? (() => {
              const projects = response.token_analytics.projects;
              const selectedIndex = Math.min(projectIndex, projects.length - 1);
              const project = projects[selectedIndex];
              return <AnalyticsCarousel items={projects} selectedIndex={selectedIndex} onSelect={setProjectIndex} itemLabel="project">
                {(project) => <>
                <TokenPieCard title={project.name} subtitle="Combined usage for all project employees" consumed={project.consumed_tokens} limit={project.token_limit} onClick={() => navigate(`/usage/project/${project.id}?month=${encodeURIComponent(selectedMonth || response.token_analytics.period_start.slice(0, 7))}`)} />
                <DailyUsageChart series={project.daily_usage} limit={project.token_limit} />
                </>}
              </AnalyticsCarousel>;
            })() : <div className="analytics-empty">No projects are currently assigned to this manager.</div>}
          </section>}

          {response.role === 'dept_head' && response.token_analytics?.department && <section className="token-analytics-section">
            <div className="section-title"><div><span className="eyebrow">{formatMonth(response.token_analytics.period_start)}</span><h2>Department consumption</h2></div><span>LAST MONTH · {response.token_analytics.projects.length} PROJECTS</span></div>
            <div className="department-token-summary department-token-layout">
              <TokenPieCard
                title={response.token_analytics.department.name}
                subtitle="Department-wide usage, including project teams"
                consumed={response.token_analytics.department.consumed_tokens}
                limit={response.token_analytics.department.token_limit}
              />
              <DailyUsageChart series={response.token_analytics.department.daily_usage} limit={response.token_analytics.department.token_limit} />
            </div>
            <div className="section-title project-breakdown-title"><div><span className="eyebrow">PROJECT BREAKDOWN</span><h2>Consumption by project</h2></div></div>
            {response.token_analytics.projects.length ? (() => {
              const projects = response.token_analytics.projects;
              const selectedIndex = Math.min(departmentProjectIndex, projects.length - 1);
              const project = projects[selectedIndex];
              return <AnalyticsCarousel items={projects} selectedIndex={selectedIndex} onSelect={setDepartmentProjectIndex} itemLabel="department project">
                {(project) => <>
                <TokenPieCard title={project.name} subtitle="Project team usage" consumed={project.consumed_tokens} limit={project.token_limit} />
                <DailyUsageChart series={project.daily_usage} limit={project.token_limit} compact />
                </>}
              </AnalyticsCarousel>;
            })() : <div className="analytics-empty">No projects are currently assigned to this department.</div>}
          </section>}

          {subordinateUsage?.rows?.length > 0 && <TokenUsageTable
            title={subordinateUsage.title}
            category={subordinateUsage.category}
            period={formatMonth(response.token_analytics?.period_start)}
            rows={subordinateUsage.rows}
            onOpen={(row) => navigate(`/usage/${subordinateUsage.scope}/${row.id}?month=${encodeURIComponent(selectedMonth || response.token_analytics.period_start.slice(0, 7))}`)}
          />}

          <ModelUsageChart rows={response.token_analytics?.model_usage} />
        </>}
      </section>
      <footer className="data-footer"><span>COPILOT ADOPTION ANALYTICS</span><span>DATA IS SCOPED TO YOUR ROLE</span></footer>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/data" element={<DataPage />} />
      <Route path="/usage/:scope/:targetId" element={<UsageDetailPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}