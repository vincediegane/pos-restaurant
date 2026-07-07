import unittest

from server.api import DEFAULT_RESTAURANTS, validate_restaurants, validate_users


class PortalApiValidationTests(unittest.TestCase):
    def test_valid_parent_branch_hierarchy(self):
        restaurants = [
            {**DEFAULT_RESTAURANTS[0]},
            {
                **DEFAULT_RESTAURANTS[0],
                "id": "branch-a",
                "name": "Succursale A",
                "parentId": "main-restaurant",
            },
        ]
        self.assertEqual(validate_restaurants(restaurants), "")

    def test_rejects_restaurant_cycle(self):
        restaurants = [
            {**DEFAULT_RESTAURANTS[0], "parentId": "branch-a"},
            {
                **DEFAULT_RESTAURANTS[0],
                "id": "branch-a",
                "name": "Succursale A",
                "parentId": "main-restaurant",
            },
        ]
        self.assertIn("Cycle detecte", validate_restaurants(restaurants))

    def test_non_admin_requires_restaurant(self):
        users = [
            {
                "id": "super-admin",
                "name": "Admin",
                "login": "admin",
                "role": "super_admin",
                "restaurantIds": ["main-restaurant"],
                "active": True,
            },
            {
                "id": "cashier",
                "name": "Caissier",
                "login": "cashier@example.com",
                "role": "cashier",
                "restaurantIds": [],
                "active": True,
            },
        ]
        self.assertIn("au moins un restaurant", validate_users(users, DEFAULT_RESTAURANTS))

    def test_requires_active_super_admin(self):
        users = [
            {
                "id": "super-admin",
                "name": "Admin",
                "login": "admin",
                "role": "super_admin",
                "restaurantIds": ["main-restaurant"],
                "active": False,
            }
        ]
        self.assertIn("super admin actif", validate_users(users, DEFAULT_RESTAURANTS))


if __name__ == "__main__":
    unittest.main()
