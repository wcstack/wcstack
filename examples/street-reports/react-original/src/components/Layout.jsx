import { useId } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { ErrorBoundary } from './ErrorBoundary.jsx';
import { useStaff } from '../context/StaffContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useReportsStore } from '../context/ReportsStore.jsx';
import { APP_NAME } from '../lib/labels.js';

const NAV_ITEMS = [
  {
    to: '/reports',
    label: '通報一覧',
    isActive: (p) => p === '/reports' || (p.startsWith('/reports/') && p !== '/reports/new'),
  },
  { to: '/reports/new', label: '新規登録', isActive: (p) => p === '/reports/new' },
  { to: '/board', label: 'ボード', isActive: (p) => p === '/board' },
  { to: '/stats', label: '統計', isActive: (p) => p === '/stats' },
];

function StaffSelect() {
  const { staff, currentStaffId, setCurrentStaffId } = useStaff();
  const id = useId();
  return (
    <div className="header-field">
      <label htmlFor={id}>担当者</label>
      <select id={id} value={currentStaffId ?? ''} onChange={(event) => setCurrentStaffId(Number(event.target.value))}>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button type="button" className="theme-toggle" onClick={toggleTheme}>
      テーマ: {theme === 'dark' ? 'ダーク' : 'ライト'}
    </button>
  );
}

function NewBadge() {
  const { summary } = useReportsStore();
  if (!summary) return null;
  return <span className="badge">新規 {summary.new} 件</span>;
}

export function Layout() {
  const { pathname } = useLocation();
  return (
    <>
      <header className="app-header">
        <Link to="/reports" className="brand">
          {APP_NAME}
        </Link>
        <nav aria-label="メインメニュー">
          <ul>
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <Link to={item.to} aria-current={item.isActive(pathname) ? 'page' : undefined}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="header-tools">
          <NewBadge />
          <StaffSelect />
          <ThemeToggle />
        </div>
      </header>
      <main className="app-main">
        <ErrorBoundary resetKey={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </>
  );
}
