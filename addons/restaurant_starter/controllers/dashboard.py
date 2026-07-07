from datetime import datetime, time

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


class RestoDashboardController(http.Controller):

    @http.route("/resto/dashboard", type="http", auth="user", methods=["GET"])
    def dashboard(self, **kwargs):
        return request.render("restaurant_starter.resto_dashboard_page")

    @http.route("/resto/dashboard/data", type="json", auth="user", methods=["POST"])
    def dashboard_data(self, date_from=None, date_to=None, **kwargs):
        user = request.env.user
        domain = _day_domain(_parse_date(date_from), _parse_date(date_to))

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
