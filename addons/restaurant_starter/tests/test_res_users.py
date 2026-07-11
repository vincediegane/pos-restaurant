from odoo.tests import TransactionCase, tagged


@tagged("post_install", "-at_install")
class TestRestoRoleGroups(TransactionCase):

    def _create_user(self, login, resto_role):
        return self.env["res.users"].create({
            "name": login,
            "login": login,
            "email": login,
            "resto_role": resto_role,
        })

    def test_create_sets_matching_role_group(self):
        user = self._create_user("test.cashier@example.com", "cashier")
        self.assertIn(self.env.ref("restaurant_starter.group_resto_cashier"), user.groups_id)
        self.assertNotIn(self.env.ref("restaurant_starter.group_resto_manager"), user.groups_id)
        self.assertNotIn(self.env.ref("restaurant_starter.group_resto_stock_manager"), user.groups_id)
        self.assertNotIn(self.env.ref("restaurant_starter.group_resto_super_admin"), user.groups_id)

    def test_role_change_moves_group_and_keeps_only_one(self):
        user = self._create_user("test.role.change@example.com", "cashier")
        user.write({"resto_role": "manager"})
        self.assertIn(self.env.ref("restaurant_starter.group_resto_manager"), user.groups_id)
        self.assertNotIn(self.env.ref("restaurant_starter.group_resto_cashier"), user.groups_id)

    def test_role_sync_does_not_leak_unrelated_admin_groups(self):
        # Regression test: res.users.create() without an explicit groups_id
        # used to pick up Odoo's default internal-user template, granting
        # "Administrator" on Sales/Purchase/Manufacturing/HR regardless of
        # resto_role. _sync_resto_role_groups must strip those.
        user = self._create_user("test.no.leak@example.com", "cashier")
        unrelated_admin_groups = [
            "sales_team.group_sale_manager",
            "purchase.group_purchase_manager",
            "mrp.group_mrp_manager",
            "hr.group_hr_manager",
            "account.group_account_manager",
        ]
        for xmlid in unrelated_admin_groups:
            group = self.env.ref(xmlid, raise_if_not_found=False)
            if group:
                self.assertNotIn(
                    group, user.groups_id,
                    f"cashier should not carry {xmlid} just from user creation",
                )

    def test_manager_keeps_pos_manager_and_stock_user(self):
        user = self._create_user("test.manager.groups@example.com", "manager")
        self.assertIn(self.env.ref("point_of_sale.group_pos_manager"), user.groups_id)
        self.assertIn(self.env.ref("stock.group_stock_user"), user.groups_id)
        self.assertNotIn(self.env.ref("stock.group_stock_manager"), user.groups_id)

    def test_super_admin_can_write_other_users(self):
        admin = self._create_user("test.super.admin@example.com", "super_admin")
        cashier = self._create_user("test.cashier.target@example.com", "cashier")
        self.assertTrue(
            self.env["res.users"].with_user(admin).check_access_rights("write", raise_exception=False)
        )
        cashier.with_user(admin).write({"resto_role": "stock_manager"})
        self.assertEqual(cashier.resto_role, "stock_manager")

    def test_role_change_logs_audit_entry(self):
        user = self._create_user("test.audit@example.com", "cashier")
        before = self.env["resto.audit.log"].search_count([
            ("event", "=", "user.role_changed"), ("payload", "like", user.login),
        ])
        user.write({"resto_role": "manager"})
        after = self.env["resto.audit.log"].search_count([
            ("event", "=", "user.role_changed"), ("payload", "like", user.login),
        ])
        self.assertEqual(after, before + 1)
