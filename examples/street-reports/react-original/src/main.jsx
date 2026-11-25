import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { StaffProvider } from './context/StaffContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { ReportsStoreProvider } from './context/ReportsStore.jsx';
import { router } from './router.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <StaffProvider>
        <ToastProvider>
          <ReportsStoreProvider>
            <RouterProvider router={router} />
          </ReportsStoreProvider>
        </ToastProvider>
      </StaffProvider>
    </ThemeProvider>
  </StrictMode>,
);
