import { describe, expect, it } from "vitest";
import { canDeleteBranch, getEligibleParents, isDescendant, type RestaurantNode } from "./restaurantTree";

const restaurants: RestaurantNode[] = [
  { id: "parent", parentId: "" },
  { id: "branch-a", parentId: "parent" },
  { id: "branch-b", parentId: "parent" },
  { id: "kiosk-a1", parentId: "branch-a" },
];

describe("restaurantTree", () => {
  it("detecte les descendants directs et indirects", () => {
    expect(isDescendant(restaurants, "branch-a", "parent")).toBe(true);
    expect(isDescendant(restaurants, "kiosk-a1", "parent")).toBe(true);
    expect(isDescendant(restaurants, "branch-b", "branch-a")).toBe(false);
  });

  it("exclut le restaurant courant et ses enfants des parents possibles", () => {
    const parents = getEligibleParents(restaurants, "branch-a").map((restaurant) => restaurant.id);

    expect(parents).toEqual(["parent", "branch-b"]);
  });

  it("refuse la suppression d'un parent", () => {
    expect(canDeleteBranch(restaurants, "parent")).toMatchObject({ allowed: false });
  });

  it("refuse la suppression d'une succursale qui possede encore des enfants", () => {
    expect(canDeleteBranch(restaurants, "branch-a")).toMatchObject({ allowed: false });
  });

  it("autorise la suppression d'une succursale sans enfant", () => {
    expect(canDeleteBranch(restaurants, "branch-b")).toEqual({ allowed: true });
  });
});
