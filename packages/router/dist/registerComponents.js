import { Route } from './components/Route';
import { Layout } from './components/Layout';
import { Outlet } from './components/Outlet';
import { Router } from './components/Router';
import { LayoutOutlet } from './components/LayoutOutlet';
import { Link } from './components/Link';
import { config } from './config';
export function registerComponents() {
    // Register custom element
    if (!customElements.get(config.tagNames.layout)) {
        customElements.define(config.tagNames.layout, Layout);
    }
    if (!customElements.get(config.tagNames.layoutOutlet)) {
        customElements.define(config.tagNames.layoutOutlet, LayoutOutlet);
    }
    if (!customElements.get(config.tagNames.outlet)) {
        customElements.define(config.tagNames.outlet, Outlet);
    }
    if (!customElements.get(config.tagNames.route)) {
        customElements.define(config.tagNames.route, Route);
    }
    if (!customElements.get(config.tagNames.router)) {
        customElements.define(config.tagNames.router, Router);
    }
    if (!customElements.get(config.tagNames.link)) {
        customElements.define(config.tagNames.link, Link);
    }
}
//# sourceMappingURL=registerComponents.js.map