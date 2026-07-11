/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, xml } from "@odoo/owl";

// Enveloppe le controleur existant (/resto/dashboard) dans une action client
// Odoo afin qu'il s'affiche dans le back-office, menu de l'app conserve,
// au lieu de naviguer hors de l'application (cf. ir.actions.act_url d'origine).
export class RestoDashboardAction extends Component {
    static template = xml`
        <div class="o_resto_dashboard_action" style="height: 100%; display: flex; flex-direction: column;">
            <iframe src="/resto/dashboard"
                    title="Tableau de bord Restaurant"
                    style="flex: 1 1 auto; width: 100%; border: 0;"/>
        </div>
    `;
}

registry.category("actions").add("resto_dashboard_client_action", RestoDashboardAction);
