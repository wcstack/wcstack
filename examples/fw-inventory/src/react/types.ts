export interface Product { id: number; name: string; sku: string; stock: number; price: number }
export interface ProductPage { items: Product[]; total: number }
export interface Photo { id: number; url: string }
export interface ProductDetail extends Product { photos: Photo[] }
export type Sort = "name" | "stock" | "-stock";
