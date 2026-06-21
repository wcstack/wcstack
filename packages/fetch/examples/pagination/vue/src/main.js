import { createApp } from "vue";
import "@wcstack/fetch/auto"; // registers <wcs-fetch> (headless data node)
import App from "./App.vue";
import "../../shared/style.css";

createApp(App).mount("#app");
