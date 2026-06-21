import { createRoot } from "react-dom/client";
import "@wcstack/fetch/auto"; // registers <wcs-fetch> (headless data node)
import { App } from "./App";
import "../../shared/style.css";

createRoot(document.getElementById("root")!).render(<App />);
