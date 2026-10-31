import pkg from '../package.json' with { type: 'json' };
import { Route } from './components/Route';
import { Layout } from './components/Layout';
import { Outlet } from './components/Outlet';
import { Router } from './components/Router';
import { LayoutOutlet } from './components/LayoutOutlet';
import { Link } from './components/Link';
import { Head } from './components/Head';
import { config } from './config';
import { defineElements } from './protocol/defineElement';

/**
 * Register this package's tags. Pass a scoped `CustomElementRegistry` to define
 * them for a single shadow tree -- scoped registries do not inherit the global
 * one, so a tree using one needs its own definitions.
 */
export function registerComponents(registry: CustomElementRegistry = customElements) {
  // Register custom element
  defineElements(registry, `${pkg.name}@${pkg.version}`, [
    [config.tagNames.layout, Layout],
    [config.tagNames.layoutOutlet, LayoutOutlet],
    [config.tagNames.outlet, Outlet],
    [config.tagNames.route, Route],
    [config.tagNames.router, Router],
    [config.tagNames.link, Link],
    [config.tagNames.head, Head],
  ]);
}