import io
from datetime import datetime, time

import xlsxwriter

from odoo import fields, http
from odoo.http import request


def _parse_date(value):
    if not value:
        return None
    try:
        return fields.Date.from_string(value)
    except ValueError:
        return None


def _day_domain(date_from=None, date_to=None):
    domain = []
    if date_from:
        domain.append(("date_order", ">=", datetime.combine(date_from, time.min)))
    if date_to:
        domain.append(("date_order", "<=", datetime.combine(date_to, time.max)))
    return domain


def _build_dashboard_payload(date_from=None, date_to=None):
    """Shared aggregation used by the live JSON view and both exports, so
    all three always agree on the same numbers."""
    user = request.env.user
    domain = _day_domain(date_from, date_to)

    Order = request.env["pos.order"]
    totals = Order.read_group(domain, ["amount_total:sum"], [])
    num_orders = totals[0]["__count"] if totals else 0
    total_revenue = (totals and totals[0]["amount_total"]) or 0
    avg_ticket = round(total_revenue / num_orders) if num_orders else 0

    sales_by_day = [
        {
            "label": group["date_order:day"],
            "revenue": group["amount_total"] or 0,
            "orders": group["date_order_count"],
        }
        for group in Order.read_group(domain, ["amount_total:sum"], ["date_order:day"])
    ]

    Product = request.env["product.template"]
    total_products = Product.search_count([])
    pos_products_count = Product.search_count([("available_in_pos", "=", True)])

    category_distribution = sorted(
        (
            {
                "name": group["categ_id"][1] if group["categ_id"] else "Sans categorie",
                "value": group["categ_id_count"],
            }
            for group in Product.read_group([], ["categ_id"], ["categ_id"])
        ),
        key=lambda c: -c["value"],
    )

    stockables = Product.search([("detailed_type", "=", "product")])
    tracked_low_stock = sum(1 for p in stockables if p.qty_available < 25)

    top_margins = []
    for p in Product.search_read(
        [("available_in_pos", "=", True), ("list_price", ">", 0)],
        ["default_code", "name", "list_price", "standard_price"],
    ):
        price = p["list_price"]
        margin = round(((price - (p["standard_price"] or 0)) / price) * 100)
        top_margins.append({
            "code": p["default_code"] or str(p["id"]),
            "name": p["name"],
            "margin": margin,
        })
    top_margins.sort(key=lambda x: x["margin"], reverse=True)
    top_margins = top_margins[:6]

    today = fields.Date.context_today(user)
    today_totals = Order.read_group(_day_domain(today, today), ["amount_total:sum"], [])
    today_orders_count = today_totals[0]["__count"] if today_totals else 0
    today_revenue = (today_totals and today_totals[0]["amount_total"]) or 0

    sessions = request.env["pos.session"].search([("state", "=", "opened")], limit=10)

    return {
        "total_revenue": total_revenue,
        "num_orders": num_orders,
        "avg_ticket": avg_ticket,
        "pos_products_count": pos_products_count,
        "tracked_low_stock": tracked_low_stock,
        "total_products": total_products,
        "today_orders_count": today_orders_count,
        "today_revenue": today_revenue,
        "sales_by_day": sales_by_day,
        "category_distribution": category_distribution,
        "top_margins": top_margins,
        "open_sessions": [
            {"id": s.id, "name": s.name, "config": s.config_id.name}
            for s in sessions
        ],
        "user_role": user.resto_role,
        "user_name": user.name,
    }


def _period_label(date_from, date_to):
    if not date_from and not date_to:
        return "Toutes les ventes"
    return "Du %s au %s" % (date_from or "...", date_to or "...")


def _build_dashboard_xlsx(payload):
    output = io.BytesIO()
    workbook = xlsxwriter.Workbook(output, {"in_memory": True})
    title_fmt = workbook.add_format({"bold": True, "font_size": 13})
    label_fmt = workbook.add_format({"bold": True})
    header_fmt = workbook.add_format({"bold": True, "bg_color": "#EDEDED", "border": 1})
    money_fmt = workbook.add_format({"num_format": "#,##0"})

    sheet = workbook.add_worksheet("Tableau de bord")
    sheet.set_column(0, 0, 28)
    sheet.set_column(1, 1, 16)
    sheet.set_column(2, 2, 14)

    row = 0
    sheet.write(row, 0, "Tableau de bord Restaurant", title_fmt)
    row += 2

    kpis = [
        ("Chiffre d'affaires (F CFA)", payload["total_revenue"], money_fmt),
        ("Nombre de commandes", payload["num_orders"], None),
        ("Ticket moyen (F CFA)", payload["avg_ticket"], money_fmt),
        ("Produits actifs en caisse", payload["pos_products_count"], None),
        ("Alertes stock bas", payload["tracked_low_stock"], None),
    ]
    for label, value, fmt in kpis:
        sheet.write(row, 0, label, label_fmt)
        sheet.write(row, 1, value, fmt)
        row += 1
    row += 1

    sheet.write(row, 0, "Ventes par jour", title_fmt)
    row += 1
    for col, header in enumerate(["Date", "CA (F CFA)", "Commandes"]):
        sheet.write(row, col, header, header_fmt)
    row += 1
    for day in payload["sales_by_day"]:
        sheet.write(row, 0, day["label"])
        sheet.write(row, 1, day["revenue"], money_fmt)
        sheet.write(row, 2, day["orders"])
        row += 1
    row += 1

    sheet.write(row, 0, "Meilleures marges", title_fmt)
    row += 1
    for col, header in enumerate(["Code", "Produit", "Marge %"]):
        sheet.write(row, col, header, header_fmt)
    row += 1
    for margin in payload["top_margins"]:
        sheet.write(row, 0, margin["code"])
        sheet.write(row, 1, margin["name"])
        sheet.write(row, 2, margin["margin"])
        row += 1
    row += 1

    sheet.write(row, 0, "Repartition du catalogue", title_fmt)
    row += 1
    for col, header in enumerate(["Categorie", "Produits"]):
        sheet.write(row, col, header, header_fmt)
    row += 1
    for cat in payload["category_distribution"]:
        sheet.write(row, 0, cat["name"])
        sheet.write(row, 1, cat["value"])
        row += 1

    workbook.close()
    return output.getvalue()


class RestoDashboardController(http.Controller):

    @http.route("/resto/dashboard", type="http", auth="user", methods=["GET"])
    def dashboard(self, **kwargs):
        return request.render("restaurant_starter.resto_dashboard_page")

    @http.route("/resto/dashboard/data", type="json", auth="user", methods=["POST"])
    def dashboard_data(self, date_from=None, date_to=None, **kwargs):
        return _build_dashboard_payload(_parse_date(date_from), _parse_date(date_to))

    @http.route("/resto/dashboard/export.xlsx", type="http", auth="user", methods=["GET"])
    def dashboard_export_xlsx(self, date_from=None, date_to=None, **kwargs):
        payload = _build_dashboard_payload(_parse_date(date_from), _parse_date(date_to))
        xlsx_data = _build_dashboard_xlsx(payload)
        return request.make_response(
            xlsx_data,
            headers=[
                ("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
                ("Content-Disposition", "attachment; filename=tableau-de-bord.xlsx"),
            ],
        )

    @http.route("/resto/dashboard/export.pdf", type="http", auth="user", methods=["GET"])
    def dashboard_export_pdf(self, date_from=None, date_to=None, **kwargs):
        parsed_from = _parse_date(date_from)
        parsed_to = _parse_date(date_to)
        payload = _build_dashboard_payload(parsed_from, parsed_to)
        values = dict(payload, period_label=_period_label(parsed_from, parsed_to))
        html = request.env["ir.qweb"]._render("restaurant_starter.resto_dashboard_report", values)
        pdf_content = request.env["ir.actions.report"]._run_wkhtmltopdf([html])
        return request.make_response(
            pdf_content,
            headers=[
                ("Content-Type", "application/pdf"),
                ("Content-Disposition", "attachment; filename=tableau-de-bord.pdf"),
            ],
        )
