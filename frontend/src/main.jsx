import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import './recruitment.css'
import { RouterProvider } from './router.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <RouterProvider><App /></RouterProvider>,
)
