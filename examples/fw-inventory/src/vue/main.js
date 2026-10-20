// Tag definitions first: a static import of each package's /auto at the entry, so every tag is
// defined before the app mounts (docs/framework-adapter-integration.md §1).
import "@wcstack/worker/auto";
import "@wcstack/fetch/auto";
import "@wcstack/broadcast/auto";
import { createApp } from "vue";
import Warehouse from "./Warehouse.vue";
import "../style.css";

createApp(Warehouse).mount("#app");
