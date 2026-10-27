import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Optional privacy-friendly analytics. Set VITE_GOATCOUNTER to your GoatCounter
// site code (e.g. "wireroom" for wireroom.goatcounter.com). Does nothing if unset.
const gc = import.meta.env.VITE_GOATCOUNTER
if (gc) {
  const el = document.createElement('script')
  el.async = true
  el.src = 'https://gc.zgo.at/count.js'
  el.dataset.goatcounter = `https://${gc}.goatcounter.com/count`
  document.head.appendChild(el)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
