import ReactDOM from 'react-dom/client'
import '@fontsource/nunito/latin-400.css'
import '@fontsource/nunito/latin-500.css'
import '@fontsource/nunito/latin-600.css'
import '@fontsource/nunito/latin-700.css'
import '@fontsource/nunito/latin-800.css'
import App from './App.jsx'
import './global-font.css'
import './styles.css'
import './recruitment.css'
import { RouterProvider } from './router.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <RouterProvider><App /></RouterProvider>,
)
