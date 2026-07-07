export type Product = {
  id: number;
  variantId?: number;
  name: string;
  code: string;
  category: string;
  price: number;
  cost: number;
  margin: number;
  stock: number;
  tracking: "tracked" | "not_tracked";
  pos: boolean;
  restaurantId?: string;
  image?: string;
};

export type ProductCategory = {
  id: number;
  name: string;
  completeName: string;
};

export type PosCategory = {
  id: number;
  name: string;
};

export type PosConfig = {
  id: number;
  name: string;
  currentSessionId?: number;
  currentSessionState?: string;
  paymentMethodIds: number[];
  restaurantId?: string;
};

export type PosSession = {
  id: number;
  name: string;
  config: string;
  state: string;
  startAt?: string;
  restaurantId?: string;
};

export type PaymentMethod = {
  id: number;
  name: string;
  isCash: boolean;
};

export type Order = {
  id: number;
  ref: string;
  date: string;
  cashier: string;
  customer: string;
  total: number;
  status: "Paid" | "Open" | "Invoiced" | "Cancelled";
  payment: string;
  items: number;
  restaurantId?: string;
};

export type KpiPoint = {
  label: string;
  revenue: number;
  orders: number;
  margin: number;
};

export type PortalData = {
  products: Product[];
  productCategories: ProductCategory[];
  posCategories: PosCategory[];
  posConfigs: PosConfig[];
  posSessions: PosSession[];
  paymentMethods: PaymentMethod[];
  orders: Order[];
  sales: KpiPoint[];
};

export type RestaurantProfile = {
  id: string;
  name: string;
  legalName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  taxId: string;
  parentId: string;
  manager: string;
  active: boolean;
};

export type UserRole = "super_admin" | "manager_parent" | "manager_branch" | "cashier" | "stock_manager";

export type PortalUser = {
  id: string;
  name: string;
  login: string;
  role: UserRole;
  restaurantIds: string[];
  active: boolean;
};
