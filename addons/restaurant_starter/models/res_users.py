from odoo import api, fields, models

ROLE_GROUP_XMLIDS = {
    "super_admin": "restaurant_starter.group_resto_super_admin",
    "manager": "restaurant_starter.group_resto_manager",
    "cashier": "restaurant_starter.group_resto_cashier",
    "stock_manager": "restaurant_starter.group_resto_stock_manager",
}

# Groupes qu'Odoo ajoute par defaut a tout nouvel utilisateur interne (via le
# modele utilisateur par defaut) mais qui n'ont rien a voir avec un role
# restaurant. Sans ce nettoyage, un "Caissier" se retrouvait Administrateur
# Ventes/Achats/Fabrication/RH. On les retire puis on relie le groupe du role
# cible : les groupes POS/Stock legitimes reviennent automatiquement via les
# implied_ids de ce groupe (voir security/resto_groups.xml).
GROUPS_TO_RESET_XMLIDS = [
    "point_of_sale.group_pos_manager",
    "point_of_sale.group_pos_user",
    "stock.group_stock_manager",
    "stock.group_stock_user",
    "sales_team.group_sale_manager",
    "sales_team.group_sale_salesman",
    "sales_team.group_sale_salesman_all_leads",
    "purchase.group_purchase_manager",
    "purchase.group_purchase_user",
    "mrp.group_mrp_manager",
    "mrp.group_mrp_user",
    "hr.group_hr_manager",
    "hr.group_hr_user",
    "account.group_account_manager",
]


class ResUsers(models.Model):
    _inherit = "res.users"

    resto_role = fields.Selection(
        [
            ("super_admin", "Super admin"),
            ("manager", "Manager"),
            ("cashier", "Caissier"),
            ("stock_manager", "Responsable stock"),
        ],
        string="Role restaurant",
        default="cashier",
        help="Definit les permissions dans le module restaurant.",
    )

    @property
    def resto_is_super_admin(self):
        return self.resto_role == "super_admin"

    @property
    def resto_is_manager(self):
        return self.resto_role in ("super_admin", "manager")

    @property
    def resto_is_cashier(self):
        return self.resto_role == "cashier"

    @api.model_create_multi
    def create(self, vals_list):
        users = super().create(vals_list)
        users._sync_resto_role_groups()
        for user in users:
            self.env["resto.audit.log"].log(
                "user.created",
                {"login": user.login, "role": user.resto_role},
            )
        return users

    def write(self, vals):
        res = super().write(vals)
        if "resto_role" in vals:
            self._sync_resto_role_groups()
            for user in self:
                self.env["resto.audit.log"].log(
                    "user.role_changed",
                    {"login": user.login, "role": user.resto_role},
                )
        return res

    def _sync_resto_role_groups(self):
        role_groups = {
            role: self.env.ref(xmlid, raise_if_not_found=False)
            for role, xmlid in ROLE_GROUP_XMLIDS.items()
        }
        all_groups = [g for g in role_groups.values() if g]
        reset_groups = [
            group
            for group in (
                self.env.ref(xmlid, raise_if_not_found=False) for xmlid in GROUPS_TO_RESET_XMLIDS
            )
            if group
        ]
        for user in self:
            target = role_groups.get(user.resto_role)
            if not target:
                continue
            commands = [(3, g.id) for g in all_groups if g != target]
            commands += [(3, g.id) for g in reset_groups]
            commands.append((4, target.id))
            user.sudo().write({"groups_id": commands})
