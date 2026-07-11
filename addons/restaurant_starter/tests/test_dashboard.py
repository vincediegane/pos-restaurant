from odoo.tests import HttpCase, TransactionCase, tagged

from odoo.addons.restaurant_starter.controllers.dashboard import _build_dashboard_xlsx


@tagged("post_install", "-at_install")
class TestDashboardExportLogic(TransactionCase):
    """Test the export logic directly against a synthetic payload:
    _build_dashboard_payload() needs a live HTTP `request` (it reads
    request.env), so it can't be called from a plain TransactionCase -- this
    covers the part that can be, without depending on HTTP session plumbing.
    """

    def _sample_payload(self):
        return {
            "total_revenue": 149419.0,
            "num_orders": 2,
            "avg_ticket": 74710,
            "pos_products_count": 84,
            "tracked_low_stock": 12,
            "sales_by_day": [
                {"label": "10 juil. 2026", "revenue": 116526.0, "orders": 1},
                {"label": "11 juil. 2026", "revenue": 32893.0, "orders": 1},
            ],
            "top_margins": [
                {"code": "RESTO-031", "name": "Bissap Classique", "margin": 62},
            ],
            "category_distribution": [
                {"name": "Boissons", "value": 20},
                {"name": "Plats", "value": 18},
            ],
        }

    def test_xlsx_export_produces_a_real_workbook(self):
        data = _build_dashboard_xlsx(self._sample_payload())
        self.assertTrue(data.startswith(b"PK"), "an .xlsx file is a zip archive")
        self.assertGreater(len(data), 1000)

    def test_xlsx_export_handles_empty_data(self):
        payload = self._sample_payload()
        payload.update(sales_by_day=[], top_margins=[], category_distribution=[])
        data = _build_dashboard_xlsx(payload)
        self.assertTrue(data.startswith(b"PK"))

    def test_pdf_report_template_renders(self):
        html = self.env["ir.qweb"]._render(
            "restaurant_starter.resto_dashboard_report",
            dict(self._sample_payload(), period_label="Du 2026-07-10 au 2026-07-11"),
        )
        self.assertIn("Bissap Classique", html)
        self.assertIn("Boissons", html)


@tagged("post_install", "-at_install")
class TestDashboardExportRoutes(HttpCase):

    def test_export_requires_login(self):
        response = self.url_open("/resto/dashboard/export.xlsx")
        self.assertNotEqual(
            response.headers.get("Content-Type"),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
