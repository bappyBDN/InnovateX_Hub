import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import '@/styles/tailwind.css';
import { i18nReady } from '@/i18n';
import { Providers } from './providers';
import { router } from './router';
import { APP_NAME, applyTheme, getTheme } from './theme';

applyTheme(getTheme());
document.title = APP_NAME;

void i18nReady.then(() =>
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Providers>
        <RouterProvider router={router} />
      </Providers>
    </React.StrictMode>,
  ),
);
