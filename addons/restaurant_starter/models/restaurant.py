from odoo import fields, models
from odoo.osv.expression import AND


class RestoRestaurant(models.Model):
    _name = "resto.restaurant"
    _description = "Restaurant"
    _order = "name"

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

    # Miroir de res.company.logo : c'est le seul logo reellement utilise
    # (tickets de caisse, rapports PDF, en-tete des exports). Ce champ
    # n'existait auparavant nulle part dans l'app Restaurant : la seule
    # facon de le modifier etait de passer par Reglages > Societes, un
    # ecran technique qu'un manager ne pense pas a aller chercher.
    logo = fields.Binary(
        string="Logo",
        compute="_compute_logo",
        inverse="_inverse_logo",
        help="Logo affiche sur les tickets de caisse et les rapports (identique au logo de la societe).",
    )

    def _compute_logo(self):
        logo = self.env.company.logo
        for record in self:
            record.logo = logo

    def _inverse_logo(self):
        for record in self:
            self.env.company.write({"logo": record.logo})

    session_count = fields.Integer(compute="_compute_counts", string="Sessions")
    order_count = fields.Integer(compute="_compute_counts", string="Commandes")
    product_count = fields.Integer(compute="_compute_counts", string="Produits")

    _sql_constraints = [
        ("external_key_unique", "unique(external_key)", "La cle externe du restaurant doit etre unique."),
    ]

    def _compute_counts(self):
        session_count = self.env["pos.session"].search_count([])
        order_count = self.env["pos.order"].search_count([])
        product_count = self.env["product.template"].search_count([])
        for r in self:
            r.session_count = session_count
            r.order_count = order_count
            r.product_count = product_count

    def write(self, vals):
        res = super().write(vals)
        self.env["resto.audit.log"].log(
            "restaurant.updated",
            {"ids": self.ids, "fields": sorted(vals)},
        )
        return res


class PosConfig(models.Model):
    _inherit = "pos.config"

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
