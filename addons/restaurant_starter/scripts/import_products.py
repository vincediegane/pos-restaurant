import base64
import json
from pathlib import Path


PAYLOAD_DIR = Path("/mnt/extra-addons/restaurant_starter/import_payload")
PRODUCTS_PATH = PAYLOAD_DIR / "products.json"


def get_or_create(model_name, domain, values):
    model = env[model_name].sudo()
    record = model.search(domain, limit=1)
    if record:
        return record
    return model.create(values)


products = json.loads(PRODUCTS_PATH.read_text(encoding="utf-8"))

created = 0
updated = 0

for item in products:
    product_category = get_or_create(
        "product.category",
        [("name", "=", item["category"])],
        {"name": item["category"]},
    )

    pos_category_ids = []
    if item["pos_category"]:
        pos_category = get_or_create(
            "pos.category",
            [("name", "=", item["pos_category"])],
            {"name": item["pos_category"]},
        )
        pos_category_ids = [(6, 0, [pos_category.id])]

    image_bytes = (PAYLOAD_DIR / item["image_file"]).read_bytes()
    values = {
        "name": item["name"],
        "default_code": item["default_code"],
        "barcode": item["barcode"],
        "categ_id": product_category.id,
        "list_price": item["sale_price"],
        "standard_price": item["cost"],
        "detailed_type": item["detailed_type"],
        "available_in_pos": item["available_in_pos"],
        "sale_ok": item["can_be_sold"],
        "purchase_ok": item["can_be_purchased"],
        "image_1920": base64.b64encode(image_bytes),
    }
    if pos_category_ids:
        values["pos_categ_ids"] = pos_category_ids

    product = env["product.template"].sudo().search(
        [("default_code", "=", item["default_code"])],
        limit=1,
    )
    if product:
        product.write(values)
        updated += 1
    else:
        env["product.template"].sudo().create(values)
        created += 1

env.cr.commit()
print(f"Imported restaurant products: created={created}, updated={updated}, total={len(products)}")
