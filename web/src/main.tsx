import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './i18n'
import App from './App'
import { ToastProvider } from './components/toast'
import { PlatformConfigProvider } from './components/platform-config/PlatformConfigContext'
import './styles.css'
import './styles/monitoring.css'
import './styles/admin-details.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><BrowserRouter><PlatformConfigProvider><ToastProvider><App /></ToastProvider></PlatformConfigProvider></BrowserRouter></React.StrictMode>,
)
