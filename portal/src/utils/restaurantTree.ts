export type RestaurantNode = {
  id: string;
  parentId: string;
};

export function isDescendant(restaurants: RestaurantNode[], possibleChildId: string, parentId: string): boolean {
  let current = restaurants.find((restaurant) => restaurant.id === possibleChildId);
  const visited = new Set<string>();

  while (current?.parentId) {
    if (visited.has(current.id)) return false;
    visited.add(current.id);
    if (current.parentId === parentId) return true;
    current = restaurants.find((restaurant) => restaurant.id === current?.parentId);
  }

  return false;
}

export function getEligibleParents<T extends RestaurantNode>(restaurants: T[], currentRestaurantId: string): T[] {
  return restaurants.filter((restaurant) => restaurant.id !== currentRestaurantId && !isDescendant(restaurants, restaurant.id, currentRestaurantId));
}

export function canDeleteBranch(restaurants: RestaurantNode[], restaurantId: string): { allowed: boolean; reason?: string } {
  const restaurant = restaurants.find((item) => item.id === restaurantId);
  if (!restaurant) return { allowed: false, reason: "Restaurant introuvable." };
  if (!restaurant.parentId) return { allowed: false, reason: "Un restaurant parent ne peut pas etre supprime depuis la liste des succursales." };
  if (restaurants.some((item) => item.parentId === restaurantId)) {
    return { allowed: false, reason: "Cette succursale a des restaurants rattaches. Supprime ou deplace-les d'abord." };
  }
  return { allowed: true };
}
