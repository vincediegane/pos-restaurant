from odoo.tests import TransactionCase, tagged


@tagged("post_install", "-at_install")
class TestRestoRestaurant(TransactionCase):

    def test_write_logs_audit_entry(self):
        restaurant = self.env["resto.restaurant"].create({
            "name": "Test Resto",
            "external_key": "TEST-RESTO-001",
        })
        before = self.env["resto.audit.log"].search_count([("event", "=", "restaurant.updated")])
        restaurant.write({"phone": "+221 77 000 00 00"})
        after = self.env["resto.audit.log"].search_count([("event", "=", "restaurant.updated")])
        self.assertEqual(after, before + 1)


@tagged("post_install", "-at_install")
class TestPosConfigCashierLock(TransactionCase):

    def setUp(self):
        super().setUp()
        self.config = self.env["pos.config"].create({
            "name": "Test Config Cashier Lock",
            "resto_lock_cashier_to_user": True,
        })
        self.manager = self.env["res.users"].create({
            "name": "Test Lock Manager",
            "login": "test.lock.manager@example.com",
            "email": "test.lock.manager@example.com",
            "resto_role": "manager",
        })
        self.cashier = self.env["res.users"].create({
            "name": "Test Lock Cashier",
            "login": "test.lock.cashier@example.com",
            "email": "test.lock.cashier@example.com",
            "resto_role": "cashier",
        })
        self.env["hr.employee"].create({"name": "Test Lock Manager", "user_id": self.manager.id})
        self.env["hr.employee"].create({"name": "Test Lock Cashier", "user_id": self.cashier.id})

    def test_cashier_is_locked_to_self(self):
        domain = self.config._employee_domain(self.cashier.id)
        self.assertIn(("user_id", "=", self.cashier.id), domain)

    def test_manager_is_not_locked(self):
        domain = self.config._employee_domain(self.manager.id)
        self.assertNotIn(("user_id", "=", self.manager.id), domain)

    def test_lock_disabled_removes_restriction(self):
        self.config.resto_lock_cashier_to_user = False
        domain = self.config._employee_domain(self.cashier.id)
        self.assertNotIn(("user_id", "=", self.cashier.id), domain)
