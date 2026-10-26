import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import { RecordingProvider } from "./recording"
import "./index.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RecordingProvider>
      <App />
    </RecordingProvider>
  </React.StrictMode>,
)
