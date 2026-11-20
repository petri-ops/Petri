// Petri 桌面版原生 shell — 应用入口
// 替代 Docusaurus 的 Root + Layout，纯 React Router

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ThemeProvider } from './themes/ThemeProvider';
import { ToastProvider } from './components/common/ToastProvider';
import './styles/global.css';
import './styles/watermark.css';
import { GlobalWatermark } from './components/common/GlobalWatermark';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <App />
          <GlobalWatermark />
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  </React.StrictMode>
);
