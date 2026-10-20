// Tag definitions first: a static import of each package's /auto at the entry, so every tag is
// defined before the first render (docs/framework-adapter-integration.md §1).
import "@wcstack/fetch/auto";
import "@wcstack/sse/auto";
import "@wcstack/storage/auto";
import "@wcstack/upload/auto";
import "@wcstack/broadcast/auto";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import "../style.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
