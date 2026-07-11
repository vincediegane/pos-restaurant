from odoo.tests import TransactionCase, tagged


@tagged("post_install", "-at_install")
class TestRestoMenuAccess(TransactionCase):
    """Regression guard for the per-role menu separation: each Restaurant/*
    submenu declares its own `groups` (a parent's `groups` does not cascade
    to its children in Odoo), so this must be checked per role, not assumed.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.root = cls.env.ref("restaurant_starter.menu_resto_root")
        cls.users = {
            role: cls.env["res.users"].create({
                "name": f"Test Menu {role}",
                "login": f"test.menu.{role}@example.com",
                "email": f"test.menu.{role}@example.com",
                "resto_role": role,
            })
            for role in ("super_admin", "manager", "cashier", "stock_manager")
        }

    def _visible_menu_xmlids(self, user):
        menus = self.env["ir.ui.menu"].with_user(user).search([("id", "child_of", self.root.id)])
        xmlids = set()
        for id_list in menus._get_external_ids().values():
            for xmlid in id_list:
                xmlids.add(xmlid.split(".", 1)[1])
        return xmlids

    def test_cashier_only_sees_pos(self):
        visible = self._visible_menu_xmlids(self.users["cashier"])
        self.assertIn("menu_resto_pos", visible)
        for hidden in ("menu_resto_catalogue", "menu_resto_stock", "menu_resto_settings",
                       "menu_resto_dashboard", "menu_resto_users", "menu_resto_audit"):
            self.assertNotIn(hidden, visible, f"cashier should not see {hidden}")

    def test_stock_manager_sees_catalogue_and_stock_not_pos(self):
        visible = self._visible_menu_xmlids(self.users["stock_manager"])
        self.assertIn("menu_resto_catalogue", visible)
        self.assertIn("menu_resto_stock", visible)
        for hidden in ("menu_resto_pos", "menu_resto_dashboard", "menu_resto_settings"):
            self.assertNotIn(hidden, visible, f"stock manager should not see {hidden}")

    def test_manager_sees_operations_not_admin(self):
        visible = self._visible_menu_xmlids(self.users["manager"])
        for shown in ("menu_resto_dashboard", "menu_resto_pos", "menu_resto_catalogue",
                      "menu_resto_stock", "menu_resto_restaurants", "menu_resto_payment_methods"):
            self.assertIn(shown, visible, f"manager should see {shown}")
        for hidden in ("menu_resto_users", "menu_resto_audit"):
            self.assertNotIn(hidden, visible, f"manager should not see {hidden}")

    def test_super_admin_sees_everything(self):
        visible = self._visible_menu_xmlids(self.users["super_admin"])
        for shown in ("menu_resto_dashboard", "menu_resto_pos", "menu_resto_catalogue",
                      "menu_resto_stock", "menu_resto_restaurants", "menu_resto_payment_methods",
                      "menu_resto_users", "menu_resto_audit"):
            self.assertIn(shown, visible, f"super admin should see {shown}")
