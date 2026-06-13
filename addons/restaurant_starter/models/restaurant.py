from odoo import api, fields, models
from odoo.osv.expression import AND


class RestoRestaurant(models.Model):
    _name = "resto.restaurant"
    _description = "Restaurant"
    _parent_name = "parent_id"
    _order = "parent_id, name"

    name = fields.Char(required=True)
    external_key = fields.Char(required=True, index=True)
    legal_name = fields.Char()
    phone = fields.Char()
    email = fields.Char()
    address = fields.Char()
    city = fields.Char()
    tax_id = fields.Char()
    manager = fields.Char()
    active = fields.Boolean(default=True)
    parent_id = fields.Many2one("resto.restaurant", string="Restaurant parent", index=True, ondelete="restrict")
    child_ids = fields.One2many("resto.restaurant", "parent_id", string="Succursales")

    _sql_constraints = [
        ("external_key_unique", "unique(external_key)", "La cle externe du restaurant doit etre unique."),
    ]


class ProductTemplate(models.Model):
    _inherit = "product.template"

    restaurant_id = fields.Many2one("resto.restaurant", string="Restaurant", index=True, ondelete="set null")


class PosConfig(models.Model):
    _inherit = "pos.config"

    restaurant_id = fields.Many2one("resto.restaurant", string="Restaurant", index=True, ondelete="set null")
    resto_lock_cashier_to_user = fields.Boolean(
        string="Verrouiller le caissier connecte",
        default=True,
        help="Si active, un caissier non manager ne voit que son propre employe dans le POS.",
    )

    def _employee_domain(self, user_id):
        domain = super()._employee_domain(user_id)
        if not self.resto_lock_cashier_to_user:
            return domain
        user = self.env["res.users"].browse(user_id)
        if self.group_pos_manager_id in user.groups_id:
            return domain
        return AND([
            self._check_company_domain(self.company_id),
            [("user_id", "=", user_id)],
        ])


class PosSession(models.Model):
    _inherit = "pos.session"

    restaurant_id = fields.Many2one("resto.restaurant", string="Restaurant", index=True, ondelete="set null")

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if not vals.get("restaurant_id") and vals.get("config_id"):
                config = self.env["pos.config"].browse(vals["config_id"])
                vals["restaurant_id"] = config.restaurant_id.id
        return super().create(vals_list)


class PosOrder(models.Model):
    _inherit = "pos.order"

    restaurant_id = fields.Many2one("resto.restaurant", string="Restaurant", index=True, ondelete="set null")

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get("restaurant_id"):
                continue
            if vals.get("session_id"):
                session = self.env["pos.session"].browse(vals["session_id"])
                vals["restaurant_id"] = session.restaurant_id.id
            if not vals.get("restaurant_id") and vals.get("config_id"):
                config = self.env["pos.config"].browse(vals["config_id"])
                vals["restaurant_id"] = config.restaurant_id.id
        return super().create(vals_list)
