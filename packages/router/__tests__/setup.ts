import { Router } from '../src/components/Router';
import { Route } from '../src/components/Route';
import { Outlet } from '../src/components/Outlet';
import { Link } from '../src/components/Link';
import { Layout } from '../src/components/Layout';
import { LayoutOutlet } from '../src/components/LayoutOutlet';

// カスタム要素を一度だけ登録
if (!customElements.get('wc-router')) {
  customElements.define('wc-router', Router);
}
if (!customElements.get('wc-route')) {
  customElements.define('wc-route', Route);
}
if (!customElements.get('wc-outlet')) {
  customElements.define('wc-outlet', Outlet);
}
if (!customElements.get('wc-link')) {
  customElements.define('wc-link', Link);
}
if (!customElements.get('wc-layout')) {
  customElements.define('wc-layout', Layout);
}
if (!customElements.get('wc-layout-outlet')) {
  customElements.define('wc-layout-outlet', LayoutOutlet);
}
