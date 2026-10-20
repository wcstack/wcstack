import { Routes, Route, Link } from "react-router";
import { ProductList } from "./ProductList";
import { ProductPage } from "./ProductPage";
import { PickedProvider, PickedPanel } from "./Picked";

export function App() {
  return (
    <PickedProvider>
      <header>
        <strong>Inventory</strong>
        <Link to="/">Products</Link>
        <a href="/warehouse.html">Warehouse (Vue)</a>
      </header>
      <Routes>
        <Route path="/" element={<ProductList />} />
        <Route path="/products/:id" element={<ProductPage />} />
      </Routes>
      <PickedPanel />
    </PickedProvider>
  );
}
