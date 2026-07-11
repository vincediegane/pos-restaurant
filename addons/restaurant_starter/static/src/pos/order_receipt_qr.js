/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { Order } from "@point_of_sale/app/store/models";
import { qrCodeSrc } from "@point_of_sale/utils";

// Ajoute un QR code resumant la commande (reference, date, total) sur le
// ticket imprime, en reutilisant le generateur de QR/code-barres natif
// d'Odoo (/report/barcode/QR/...) -- pas de service tiers, fonctionne meme
// sans acces internet puisque c'est notre propre serveur qui le genere.
patch(Order.prototype, {
    export_for_printing() {
        const result = super.export_for_printing(...arguments);
        const total = Math.round(result.amount_total);
        const orderInfo = `Commande: ${result.name}\nDate: ${result.date}\nTotal: ${total} F CFA`;
        result.resto_qr_code = qrCodeSrc(orderInfo, { size: 150 });
        return result;
    },
});
