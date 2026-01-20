import { Router } from '../src/components/Router';
import { Route } from '../src/components/Route';
import { Outlet } from '../src/components/Outlet';
import { Link } from '../src/components/Link';
import { Layout } from '../src/components/Layout';
import { LayoutOutlet } from '../src/components/LayoutOutlet';
import { Head } from '../src/components/Head';

// カスタム要素を一度だけ登録
if (!customElements.get('wcs-router')) {
  customElements.define('wcs-router', Router);
}
if (!customElements.get('wcs-route')) {
  customElements.define('wcs-route', Route);
}
if (!customElements.get('wcs-outlet')) {
  customElements.define('wcs-outlet', Outlet);
}
if (!customElements.get('wcs-link')) {
  customElements.define('wcs-link', Link);
}
if (!customElements.get('wcs-layout')) {
  customElements.define('wcs-layout', Layout);
}
if (!customElements.get('wcs-layout-outlet')) {
  customElements.define('wcs-layout-outlet', LayoutOutlet);
}
if (!customElements.get('wcs-head')) {
  customElements.define('wcs-head', Head);
}
