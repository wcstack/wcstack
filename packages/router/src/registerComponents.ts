import { Route } from './components/Route';
import { Layout } from './components/Layout';
import { Outlet } from './components/Outlet';
import { Router } from './components/Router';
import { LayoutOutlet } from './components/LayoutOutlet';
import { Link } from './components/Link';
import { Head } from './components/Head';
import { config } from './config';

/**
 * Register this package's tags. Pass a scoped `CustomElementRegistry` to define
 * them for a single shadow tree -- scoped registries do not inherit the global
 * one, so a tree using one needs its own definitions.
 */
export function registerComponents(registry: CustomElementRegistry = customElements) {
  // Register custom element
  if (!registry.get(config.tagNames.layout)) {
    registry.define(config.tagNames.layout, Layout);
  }
  if (!registry.get(config.tagNames.layoutOutlet)) {
    registry.define(config.tagNames.layoutOutlet, LayoutOutlet);
  }
  if (!registry.get(config.tagNames.outlet)) {
    registry.define(config.tagNames.outlet, Outlet);
  }
  if (!registry.get(config.tagNames.route)) {
    registry.define(config.tagNames.route, Route);
  }
  if (!registry.get(config.tagNames.router)) {
    registry.define(config.tagNames.router, Router);
  }
  if (!registry.get(config.tagNames.link)) {
    registry.define(config.tagNames.link, Link);
  }
  if (!registry.get(config.tagNames.head)) {
    registry.define(config.tagNames.head, Head);
  }
}