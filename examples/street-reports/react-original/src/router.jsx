import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { Layout } from './components/Layout.jsx';
import ReportListPage from './pages/ReportListPage.jsx';
import ReportDetailPage from './pages/ReportDetailPage.jsx';
import NewReportPage from './pages/NewReportPage.jsx';
import BoardPage from './pages/BoardPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

const StatsPage = lazy(() => import('./pages/StatsPage.jsx'));

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/reports" replace /> },
      { path: 'reports', element: <ReportListPage /> },
      { path: 'reports/new', element: <NewReportPage /> },
      { path: 'reports/:id', element: <ReportDetailPage /> },
      { path: 'board', element: <BoardPage /> },
      {
        path: 'stats',
        element: (
          <Suspense fallback={<p className="loading">読み込み中…</p>}>
            <StatsPage />
          </Suspense>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
