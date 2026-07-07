import type { PortalUser, RestaurantProfile } from "../types";

export const defaultRestaurants: RestaurantProfile[] = [
  {
    id: "main-restaurant",
    name: "Restaurant Principal",
    legalName: "Restaurant Principal SARL",
    phone: "",
    email: "",
    address: "",
    city: "Dakar",
    taxId: "",
    parentId: "",
    manager: "Super admin",
    active: true,
  },
];

export type RestaurantSettings = {
  restaurants: RestaurantProfile[];
  currentRestaurantId: string;
  assignments: PortalAssignments;
  users: PortalUser[];
  currentUser: PortalUser;
};

export type PortalAssignments = {
  products: Record<string, string>;
  orders: Record<string, string>;
  sessions: Record<string, string>;
};

export type AuditRow = {
  event: string;
  payload: Record<string, unknown>;
  actor?: {
    id: string;
    name: string;
    login: string;
    role: string;
  };
  restaurantId?: string;
  at: string;
};

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/portal-api${url}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "API portail indisponible.");
  }
  return payload as T;
}

export async function loadRestaurantSettings(): Promise<RestaurantSettings> {
  return api<RestaurantSettings>("/restaurants");
}

export async function saveRestaurantSettings(restaurants: RestaurantProfile[]): Promise<RestaurantSettings> {
  return api<RestaurantSettings>("/restaurants", {
    method: "PUT",
    body: JSON.stringify({ restaurants }),
  });
}

export async function selectCurrentRestaurant(id: string): Promise<RestaurantSettings> {
  return api<RestaurantSettings>("/restaurants/current", {
    method: "PUT",
    body: JSON.stringify({ id }),
  });
}

export async function activatePortalUser(login: string): Promise<RestaurantSettings> {
  return api<RestaurantSettings>("/auth/current-user", {
    method: "POST",
    body: JSON.stringify({ login }),
  });
}

export async function assignProductToRestaurant(productId: number, restaurantId: string): Promise<RestaurantSettings> {
  return api<RestaurantSettings>("/assignments/product", {
    method: "PUT",
    body: JSON.stringify({ productId, restaurantId }),
  });
}

export async function assignOrderToRestaurant(orderId: number, restaurantId: string): Promise<RestaurantSettings> {
  return api<RestaurantSettings>("/assignments/order", {
    method: "PUT",
    body: JSON.stringify({ orderId, restaurantId }),
  });
}

export async function assignSessionToRestaurant(sessionId: number, restaurantId: string): Promise<RestaurantSettings> {
  return api<RestaurantSettings>("/assignments/session", {
    method: "PUT",
    body: JSON.stringify({ sessionId, restaurantId }),
  });
}

export async function savePortalUsers(users: PortalUser[]): Promise<RestaurantSettings> {
  return api<RestaurantSettings>("/users", {
    method: "PUT",
    body: JSON.stringify({ users }),
  });
}

export async function loadAuditRows(): Promise<AuditRow[]> {
  const result = await api<{ rows: AuditRow[] }>("/audit");
  return result.rows;
}
