import type { Order, PaymentMethod, PortalData, PortalUser, PosCategory, PosConfig, PosSession, Product, ProductCategory, RestaurantProfile } from "../types";

type JsonRpcResponse<T> = {
  result?: T;
  error?: { message: string; data?: { message?: string } };
};

export type AuthConfig = {
  login: string;
  password: string;
};

type AuthResult = {
  uid: number | false;
  name?: string;
  username?: string;
};

type SessionInfo = {
  uid?: number | false;
  db?: string;
  username?: string;
  name?: string;
};

const DEFAULT_DATABASE = "ecole-db";

export function buildNativePosUrl(configId: number): string {
  const configuredBase = String(import.meta.env.VITE_ODOO_BASE_URL || "").replace(/\/$/, "");
  const hostBase = `${window.location.protocol}//${window.location.hostname}:8071`;
  const baseUrl = configuredBase || hostBase;
  return `${baseUrl}/pos/ui?config_id=${encodeURIComponent(String(configId))}`;
}

async function jsonRpc<T>(url: string, params: unknown): Promise<T> {
  const response = await fetch(`/api${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params, id: Date.now() }),
  });
  const payload = (await response.json()) as JsonRpcResponse<T>;
  if (payload.error) {
    throw new Error(payload.error.data?.message || payload.error.message);
  }
  return payload.result as T;
}

async function authenticate(config: AuthConfig): Promise<AuthResult> {
  const result = await jsonRpc<AuthResult>("/web/session/authenticate", {
    db: DEFAULT_DATABASE,
    login: config.login,
    password: config.password,
  });
  if (!result.uid) {
    throw new Error("Identifiants incorrects.");
  }
  return result;
}

export async function getActiveSession(): Promise<SessionInfo | null> {
  const result = await jsonRpc<SessionInfo>("/web/session/get_session_info", {});
  return result.uid ? result : null;
}

export async function destroySession(): Promise<void> {
  await jsonRpc("/web/session/destroy", {});
}

async function searchRead<T>(model: string, domain: unknown[], fields: string[], limit = 80): Promise<T[]> {
  return callKw<T[]>(model, "search_read", [domain], { fields, limit, order: "id desc" });
}

async function callKw<T>(model: string, method: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}): Promise<T> {
  return jsonRpc(`/web/dataset/call_kw/${model}/${method}`, {
    model,
    method,
    args,
    kwargs,
  });
}

function restaurantExternalKey(row: Record<string, unknown>, restaurantMap: Map<number, string>) {
  return Array.isArray(row.restaurant_id) ? restaurantMap.get(Number(row.restaurant_id[0])) : undefined;
}

function mapProduct(row: Record<string, unknown>, restaurantMap: Map<number, string>): Product {
  const category = Array.isArray(row.categ_id) ? String(row.categ_id[1]) : "Sans categorie";
  const price = Number(row.list_price || 0);
  const cost = Number(row.standard_price || 0);
  return {
    id: Number(row.id),
    variantId: Array.isArray(row.product_variant_id) ? Number(row.product_variant_id[0]) : undefined,
    name: String(row.name || ""),
    code: String(row.default_code || ""),
    category,
    price,
    cost,
    margin: price ? Math.round(((price - cost) / price) * 100) : 0,
    stock: Number(row.qty_available || 0),
    tracking: row.detailed_type === "product" ? "tracked" : "not_tracked",
    pos: Boolean(row.available_in_pos),
    restaurantId: restaurantExternalKey(row, restaurantMap),
    image: row.image_128 ? `data:image/png;base64,${row.image_128}` : undefined,
  };
}

function mapProductCategory(row: Record<string, unknown>): ProductCategory {
  return {
    id: Number(row.id),
    name: String(row.name || ""),
    completeName: String(row.complete_name || row.name || ""),
  };
}

function mapPosCategory(row: Record<string, unknown>): PosCategory {
  return {
    id: Number(row.id),
    name: String(row.name || ""),
  };
}

function mapPosConfig(row: Record<string, unknown>, restaurantMap: Map<number, string>): PosConfig {
  return {
    id: Number(row.id),
    name: String(row.name || ""),
    currentSessionId: Array.isArray(row.current_session_id) ? Number(row.current_session_id[0]) : undefined,
    currentSessionState: String(row.current_session_state || ""),
    paymentMethodIds: Array.isArray(row.payment_method_ids) ? row.payment_method_ids.map(Number) : [],
    restaurantId: restaurantExternalKey(row, restaurantMap),
  };
}

function mapPosSession(row: Record<string, unknown>, restaurantMap: Map<number, string>): PosSession {
  const config = Array.isArray(row.config_id) ? String(row.config_id[1]) : "";
  return {
    id: Number(row.id),
    name: String(row.name || ""),
    config,
    state: String(row.state || ""),
    startAt: String(row.start_at || ""),
    restaurantId: restaurantExternalKey(row, restaurantMap),
  };
}

function mapPaymentMethod(row: Record<string, unknown>): PaymentMethod {
  return {
    id: Number(row.id),
    name: String(row.name || ""),
    isCash: Boolean(row.is_cash_count),
  };
}

function mapOrder(row: Record<string, unknown>, restaurantMap: Map<number, string>, sessionRestaurantMap: Map<number, string>, configRestaurantMap: Map<number, string>): Order {
  const user = Array.isArray(row.user_id) ? String(row.user_id[1]) : "Caisse";
  const partner = Array.isArray(row.partner_id) ? String(row.partner_id[1]) : "Client comptoir";
  const sessionId = Array.isArray(row.session_id) ? Number(row.session_id[0]) : undefined;
  const configId = Array.isArray(row.config_id) ? Number(row.config_id[0]) : undefined;
  return {
    id: Number(row.id),
    ref: String(row.name || ""),
    date: String(row.date_order || "").slice(0, 10),
    cashier: user,
    customer: partner,
    total: Number(row.amount_total || 0),
    status: String(row.state || "Paid") === "paid" ? "Paid" : "Open",
    payment: "POS",
    items: Array.isArray(row.lines) ? row.lines.length : 0,
    restaurantId: restaurantExternalKey(row, restaurantMap) || (sessionId ? sessionRestaurantMap.get(sessionId) : undefined) || (configId ? configRestaurantMap.get(configId) : undefined),
  };
}

export async function loadBusinessData(config?: AuthConfig): Promise<PortalData> {
  if (config) {
    await authenticate(config);
  } else {
    const session = await getActiveSession();
    if (!session) {
      throw new Error("Session expiree.");
    }
  }
  const backendRestaurants = await searchRead<Record<string, unknown>>("resto.restaurant", [], ["id", "external_key"], 200);
  const restaurantMap = new Map(backendRestaurants.map((restaurant) => [Number(restaurant.id), String(restaurant.external_key || "")]));
  const products = await searchRead<Record<string, unknown>>(
    "product.template",
    [],
    ["id", "name", "default_code", "product_variant_id", "categ_id", "list_price", "standard_price", "qty_available", "available_in_pos", "detailed_type", "image_128", "restaurant_id"],
    100,
  );
  const productCategories = await searchRead<Record<string, unknown>>("product.category", [], ["id", "name", "complete_name"], 100);
  const posCategories = await searchRead<Record<string, unknown>>("pos.category", [], ["id", "name"], 100);
  const posConfigs = await searchRead<Record<string, unknown>>("pos.config", [], ["id", "name", "current_session_id", "current_session_state", "payment_method_ids", "restaurant_id"], 50);
  const posSessions = await searchRead<Record<string, unknown>>("pos.session", [], ["id", "name", "config_id", "state", "start_at", "restaurant_id"], 25);
  const paymentMethods = await searchRead<Record<string, unknown>>("pos.payment.method", [], ["id", "name", "is_cash_count"], 50);
  const orders = await searchRead<Record<string, unknown>>(
    "pos.order",
    [],
    ["id", "name", "date_order", "amount_total", "state", "user_id", "partner_id", "lines", "restaurant_id", "session_id", "config_id"],
    50,
  );

  const mappedConfigs = posConfigs.map((config) => mapPosConfig(config, restaurantMap));
  const mappedSessions = posSessions.map((session) => mapPosSession(session, restaurantMap));
  const configRestaurantMap = new Map(mappedConfigs.filter((config) => config.restaurantId).map((config) => [config.id, config.restaurantId as string]));
  const sessionRestaurantMap = new Map(mappedSessions.filter((session) => session.restaurantId).map((session) => [session.id, session.restaurantId as string]));
  const mappedOrders = orders.map((order) => mapOrder(order, restaurantMap, sessionRestaurantMap, configRestaurantMap));
  const dayMap = new Map<string, { revenue: number; orders: number }>();
  mappedOrders.forEach((order) => {
    const current = dayMap.get(order.date) || { revenue: 0, orders: 0 };
    current.revenue += order.total;
    current.orders += 1;
    dayMap.set(order.date, current);
  });
  const sales = Array.from(dayMap.entries())
    .slice(0, 7)
    .reverse()
    .map(([label, value]) => ({ label: label.slice(5), revenue: value.revenue, orders: value.orders, margin: 39 }));

  return {
    products: products.map((product) => mapProduct(product, restaurantMap)),
    productCategories: productCategories.map(mapProductCategory),
    posCategories: posCategories.map(mapPosCategory),
    posConfigs: mappedConfigs,
    posSessions: mappedSessions,
    paymentMethods: paymentMethods.map(mapPaymentMethod),
    orders: mappedOrders,
    sales,
  };
}

export type CreateProductCategoryInput = {
  name: string;
  parentId?: number;
};

export type CreatePosCategoryInput = {
  name: string;
};

export type CreateProductInput = {
  name: string;
  code: string;
  price: number;
  cost: number;
  productCategoryId: number;
  posCategoryId?: number;
  availableInPos: boolean;
  detailedType: "consu" | "product";
  restaurantExternalKey?: string;
};

async function findBackendRestaurant(externalKey: string): Promise<number | undefined> {
  const rows = await searchRead<Record<string, unknown>>("resto.restaurant", [["external_key", "=", externalKey]], ["id"], 1);
  return rows[0]?.id ? Number(rows[0].id) : undefined;
}

async function findGroupId(xmlId: string): Promise<number | undefined> {
  const [module, name] = xmlId.split(".");
  const rows = await searchRead<Record<string, unknown>>(
    "ir.model.data",
    [
      ["module", "=", module],
      ["name", "=", name],
      ["model", "=", "res.groups"],
    ],
    ["res_id"],
    1,
  );
  return rows[0]?.res_id ? Number(rows[0].res_id) : undefined;
}

async function userGroupValues(role: PortalUser["role"]) {
  if (role !== "cashier") {
    return {};
  }
  const ids = (await Promise.all(["base.group_user", "point_of_sale.group_pos_user"].map(findGroupId))).filter((id): id is number => Boolean(id));
  return ids.length ? { groups_id: [[6, 0, ids]] } : {};
}

export async function syncBackendRestaurants(restaurants: RestaurantProfile[]): Promise<Record<string, number>> {
  const synced: Record<string, number> = {};
  for (const restaurant of restaurants) {
    const parentId = restaurant.parentId ? synced[restaurant.parentId] || await findBackendRestaurant(restaurant.parentId) : undefined;
    const values = {
      name: restaurant.name,
      external_key: restaurant.id,
      legal_name: restaurant.legalName,
      phone: restaurant.phone,
      email: restaurant.email,
      address: restaurant.address,
      city: restaurant.city,
      tax_id: restaurant.taxId,
      manager: restaurant.manager,
      active: restaurant.active,
      parent_id: parentId || false,
    };
    const existingId = await findBackendRestaurant(restaurant.id);
    if (existingId) {
      await callKw<boolean>("resto.restaurant", "write", [[existingId], values]);
      synced[restaurant.id] = existingId;
    } else {
      synced[restaurant.id] = await callKw<number>("resto.restaurant", "create", [values]);
    }
  }
  return synced;
}

export async function syncBackendUsers(users: PortalUser[]): Promise<void> {
  for (const user of users) {
    const existingUsers = await searchRead<Record<string, unknown>>("res.users", [["login", "=", user.login]], ["id"], 1);
    let userId = existingUsers[0]?.id ? Number(existingUsers[0].id) : 0;
    const groupValues = await userGroupValues(user.role);
    if (userId) {
      await callKw<boolean>("res.users", "write", [[userId], { name: user.name, active: user.active, ...groupValues }]);
    } else {
      const temporaryPassword = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
      userId = await callKw<number>("res.users", "create", [
        {
          name: user.name,
          login: user.login,
          password: temporaryPassword,
          active: user.active,
          ...groupValues,
        },
      ]);
    }

    const employees = await searchRead<Record<string, unknown>>("hr.employee", [["work_email", "=", user.login]], ["id"], 1);
    const employeeValues = {
      name: user.name,
      work_email: user.login,
      user_id: userId || false,
      active: user.active,
    };
    if (employees[0]?.id) {
      await callKw<boolean>("hr.employee", "write", [[Number(employees[0].id)], employeeValues]);
    } else {
      await callKw<number>("hr.employee", "create", [employeeValues]);
    }
  }
}

export async function assignBackendProductToRestaurant(productId: number, restaurantExternalKey: string): Promise<boolean> {
  const restaurantId = await findBackendRestaurant(restaurantExternalKey);
  if (!restaurantId) return false;
  return callKw<boolean>("product.template", "write", [[productId], { restaurant_id: restaurantId }]);
}

export async function assignBackendOrderToRestaurant(orderId: number, restaurantExternalKey: string): Promise<boolean> {
  const restaurantId = await findBackendRestaurant(restaurantExternalKey);
  if (!restaurantId) return false;
  return callKw<boolean>("pos.order", "write", [[orderId], { restaurant_id: restaurantId }]);
}

export async function assignBackendSessionToRestaurant(sessionId: number, restaurantExternalKey: string): Promise<boolean> {
  const restaurantId = await findBackendRestaurant(restaurantExternalKey);
  if (!restaurantId) return false;
  return callKw<boolean>("pos.session", "write", [[sessionId], { restaurant_id: restaurantId }]);
}

export async function assignBackendPosConfigToRestaurant(configId: number, restaurantExternalKey: string): Promise<boolean> {
  const restaurantId = await findBackendRestaurant(restaurantExternalKey);
  if (!restaurantId) return false;
  return callKw<boolean>("pos.config", "write", [[configId], { restaurant_id: restaurantId }]);
}

export async function createProductCategory(input: CreateProductCategoryInput): Promise<number> {
  return callKw<number>("product.category", "create", [
    {
      name: input.name,
      ...(input.parentId ? { parent_id: input.parentId } : {}),
    },
  ]);
}

export async function createPosCategory(input: CreatePosCategoryInput): Promise<number> {
  return callKw<number>("pos.category", "create", [{ name: input.name }]);
}

export async function createProduct(input: CreateProductInput): Promise<number> {
  const restaurantId = input.restaurantExternalKey ? await findBackendRestaurant(input.restaurantExternalKey) : undefined;
  return callKw<number>("product.template", "create", [
    {
      name: input.name,
      default_code: input.code,
      list_price: input.price,
      standard_price: input.cost,
      detailed_type: input.detailedType,
      categ_id: input.productCategoryId,
      available_in_pos: input.availableInPos,
      sale_ok: input.availableInPos,
      purchase_ok: true,
      ...(restaurantId ? { restaurant_id: restaurantId } : {}),
      ...(input.posCategoryId ? { pos_categ_ids: [[6, 0, [input.posCategoryId]]] } : {}),
    },
  ]);
}

export async function updateProduct(productId: number, values: { price?: number; availableInPos?: boolean }): Promise<boolean> {
  return callKw<boolean>("product.template", "write", [
    [productId],
    {
      ...(values.price !== undefined ? { list_price: values.price } : {}),
      ...(values.availableInPos !== undefined ? { available_in_pos: values.availableInPos, sale_ok: values.availableInPos } : {}),
    },
  ]);
}

export async function startPosSession(configId: number): Promise<number> {
  const config = await searchRead<Record<string, unknown>>(
    "pos.config",
    [["id", "=", configId]],
    ["id", "current_session_id", "current_session_state"],
    1,
  );
  const currentSession = config[0]?.current_session_id;
  if (Array.isArray(currentSession) && currentSession[0]) {
    return Number(currentSession[0]);
  }
  const sessionId = await callKw<number>("pos.session", "create", [{ config_id: configId }]);
  await callKw("pos.session", "action_pos_session_open", [[sessionId]]);
  return sessionId;
}

export async function closePosSession(sessionId: number, countedCash?: number): Promise<boolean> {
  if (countedCash !== undefined && !Number.isNaN(countedCash)) {
    await callKw<boolean>("pos.session", "write", [[sessionId], { cash_register_balance_end_real: countedCash }]);
  }
  await callKw("pos.session", "action_pos_session_closing_control", [[sessionId]]);
  await callKw("pos.session", "action_pos_session_validate", [[sessionId]]);
  return true;
}

export async function adjustProductStock(productVariantId: number, quantity: number): Promise<boolean> {
  const locations = await searchRead<Record<string, unknown>>("stock.location", [["usage", "=", "internal"]], ["id", "name"], 1);
  const locationId = Number(locations[0]?.id);
  if (!locationId) {
    throw new Error("Aucun emplacement interne trouve.");
  }

  const existing = await searchRead<Record<string, unknown>>(
    "stock.quant",
    [
      ["product_id", "=", productVariantId],
      ["location_id", "=", locationId],
    ],
    ["id"],
    1,
  );

  const values = { product_id: productVariantId, location_id: locationId, inventory_quantity: quantity };
  const context = { context: { inventory_mode: true } };
  const quantId = existing[0]?.id ? Number(existing[0].id) : await callKw<number>("stock.quant", "create", [values], context);
  if (existing[0]?.id) {
    await callKw<boolean>("stock.quant", "write", [[quantId], { inventory_quantity: quantity }], context);
  }
  await callKw("stock.quant", "action_apply_inventory", [[quantId]], context);
  return true;
}

export type SaleLineInput = {
  productId: number;
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
};

export type CreateSaleInput = {
  sessionId: number;
  configId: number;
  paymentMethodId: number;
  customerNote?: string;
  tableName?: string;
  lines: SaleLineInput[];
};

export type CreatedSale = {
  id: number;
  ref: string;
  date: string;
};

export async function createPaidSale(input: CreateSaleInput): Promise<CreatedSale> {
  if (!input.lines.length) {
    throw new Error("La commande est vide.");
  }
  const subtotal = input.lines.reduce((sum, line) => {
    const discounted = line.unitPrice * line.quantity * (1 - line.discount / 100);
    return sum + discounted;
  }, 0);
  const amountTotal = Math.max(0, Math.round(subtotal));
  const orderId = await callKw<number>("pos.order", "create", [
    {
      name: "/",
      session_id: input.sessionId,
      config_id: input.configId,
      amount_tax: 0,
      amount_total: amountTotal,
      amount_paid: amountTotal,
      amount_return: 0,
      state: "draft",
      note: [input.tableName, input.customerNote].filter(Boolean).join(" - "),
      lines: input.lines.map((line) => [
        0,
        0,
        {
          product_id: line.productId,
          name: line.name,
          full_product_name: line.name,
          qty: line.quantity,
          price_unit: line.unitPrice,
          discount: line.discount,
          price_subtotal: Math.round(line.unitPrice * line.quantity * (1 - line.discount / 100)),
          price_subtotal_incl: Math.round(line.unitPrice * line.quantity * (1 - line.discount / 100)),
        },
      ]),
      payment_ids: [
        [
          0,
          0,
          {
            amount: amountTotal,
            payment_method_id: input.paymentMethodId,
            session_id: input.sessionId,
          },
        ],
      ],
    },
  ]);
  try {
    await callKw("pos.order", "action_pos_order_paid", [[orderId]]);
  } catch {
    await callKw<boolean>("pos.order", "write", [[orderId], { state: "paid" }]);
  }
  const rows = await searchRead<Record<string, unknown>>("pos.order", [["id", "=", orderId]], ["id", "name", "date_order"], 1);
  return {
    id: orderId,
    ref: String(rows[0]?.name || `Ticket ${orderId}`),
    date: String(rows[0]?.date_order || new Date().toISOString()),
  };
}

export async function decrementStockForSale(lines: SaleLineInput[]): Promise<void> {
  const locations = await searchRead<Record<string, unknown>>("stock.location", [["usage", "=", "internal"]], ["id", "name"], 1);
  const locationId = Number(locations[0]?.id);
  if (!locationId) return;

  for (const line of lines) {
    const product = await searchRead<Record<string, unknown>>("product.product", [["id", "=", line.productId]], ["id", "type"], 1);
    if (product[0]?.type !== "product") continue;
    const existing = await searchRead<Record<string, unknown>>(
      "stock.quant",
      [
        ["product_id", "=", line.productId],
        ["location_id", "=", locationId],
      ],
      ["id", "quantity"],
      1,
    );
    const currentQty = Number(existing[0]?.quantity || 0);
    const nextQty = Math.max(0, currentQty - line.quantity);
    const context = { context: { inventory_mode: true } };
    const values = { product_id: line.productId, location_id: locationId, inventory_quantity: nextQty };
    const quantId = existing[0]?.id ? Number(existing[0].id) : await callKw<number>("stock.quant", "create", [values], context);
    if (existing[0]?.id) {
      await callKw<boolean>("stock.quant", "write", [[quantId], { inventory_quantity: nextQty }], context);
    }
    await callKw("stock.quant", "action_apply_inventory", [[quantId]], context);
  }
}
