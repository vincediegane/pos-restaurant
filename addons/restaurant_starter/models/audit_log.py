from odoo import api, fields, models


class RestoAuditLog(models.Model):
    _name = "resto.audit.log"
    _description = "Journal d audit restaurant"
    _order = "id desc"

    event = fields.Char(string="Evenement", required=True, index=True)
    payload = fields.Text(string="Donnees")
    actor_id = fields.Many2one("res.users", string="Acteur", index=True)
    actor_name = fields.Char(string="Nom acteur")
    actor_login = fields.Char(string="Login acteur")
    actor_role = fields.Char(string="Role acteur")
    created_at = fields.Datetime(string="Date", default=fields.Datetime.now, index=True)

    @api.model
    def log(self, event, payload=None):
        user = self.env.user
        # sudo: l'acteur n'a pas forcement de droits en ecriture sur le journal.
        return self.sudo().create(
            {
                "event": event,
                "payload": payload and str(payload),
                "actor_id": user.id,
                "actor_name": user.name,
                "actor_login": user.login,
                "actor_role": user.resto_role,
            }
        )
