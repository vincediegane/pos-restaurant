# Initialisation comptable et POS pour le restaurant.
# Usage (depuis la racine du projet) :
#   docker compose exec -T odoo odoo shell -d ecole-db --no-http < scripts/setup_pos.py
#
# Idempotent : peut etre relance sans dupliquer journaux ni moyens de paiement.

company = env.company

# 1. Pays et plan comptable SYSCOHADA (Senegal, devise XOF)
if not company.country_id:
    company.country_id = env.ref("base.sn")

if not company.chart_template:
    env["account.chart.template"].try_loading("sn", company=company, install_demo=False)
    print("Plan comptable SYSCOHADA (Senegal) installe")
else:
    print(f"Plan comptable deja installe: {company.chart_template}")

xof = env.ref("base.XOF")
if company.currency_id != xof:
    env.cr.execute("UPDATE res_company SET currency_id = %s WHERE id = %s", (xof.id, company.id))
    env.registry.clear_cache()
    print("Devise societe forcee en XOF")

configs = env["pos.config"].search([])
print("Configs POS:", configs.mapped("name"))

# 1bis. Comptes de vente/achat par defaut sur les categories de produits
# (sans compte de revenu, la cloture de session POS echoue).
income = env["account.account"].search(
    [("account_type", "=", "income"), ("code", "=like", "701%"), ("company_id", "=", company.id)],
    limit=1,
) or env["account.account"].search(
    [("account_type", "=", "income"), ("company_id", "=", company.id)], limit=1
)
expense = env["account.account"].search(
    [("account_type", "=", "expense"), ("code", "=like", "601%"), ("company_id", "=", company.id)],
    limit=1,
) or env["account.account"].search(
    [("account_type", "=", "expense"), ("company_id", "=", company.id)], limit=1
)
if income and expense:
    categories = env["product.category"].search([])
    categories.write(
        {
            "property_account_income_categ_id": income.id,
            "property_account_expense_categ_id": expense.id,
        }
    )
    print(f"Comptes {income.code}/{expense.code} appliques a {len(categories)} categories")


def get_or_create_bank_journal(name, code):
    journal = env["account.journal"].search(
        [("code", "=", code), ("company_id", "=", company.id)], limit=1
    )
    if not journal:
        journal = env["account.journal"].create(
            {"name": name, "type": "bank", "code": code, "company_id": company.id}
        )
    return journal


# 2. Moyens de paiement mobiles avec leurs journaux bancaires
mobile_methods = env["pos.payment.method"]
for name, code in [("Wave", "WAVE"), ("Orange Money", "ORMON")]:
    method = env["pos.payment.method"].search(
        [("name", "=", name), ("company_id", "=", company.id)], limit=1
    )
    if not method:
        method = env["pos.payment.method"].create(
            {
                "name": name,
                "journal_id": get_or_create_bank_journal(name, code).id,
                "company_id": company.id,
            }
        )
        print(f"Moyen de paiement {name} cree")
    elif not method.journal_id:
        method.journal_id = get_or_create_bank_journal(name, code)
        print(f"Journal cree pour {name}")
    mobile_methods |= method

# 3. Moyen de paiement especes
cash_method = env["pos.payment.method"].search(
    [("is_cash_count", "=", True), ("company_id", "=", company.id)], limit=1
)
if not cash_method:
    cash_journal = env["account.journal"].search(
        [("type", "=", "cash"), ("company_id", "=", company.id)], limit=1
    )
    if not cash_journal:
        cash_journal = env["account.journal"].create(
            {"name": "Especes", "type": "cash", "code": "CSH2", "company_id": company.id}
        )
    cash_method = env["pos.payment.method"].create(
        {"name": "Especes", "journal_id": cash_journal.id, "company_id": company.id}
    )
    print("Moyen de paiement Especes cree")

# 4. Configuration de chaque caisse
methods = cash_method | mobile_methods

pos_journal = env["account.journal"].search(
    [("type", "=", "general"), ("code", "=", "POSS"), ("company_id", "=", company.id)],
    limit=1,
)
sale_journal = env["account.journal"].search(
    [("type", "=", "sale"), ("company_id", "=", company.id)], limit=1
)

for config in configs:
    vals = {"payment_method_ids": [(6, 0, methods.ids)], "module_pos_hr": True}
    if not config.journal_id and pos_journal:
        vals["journal_id"] = pos_journal.id
    if not config.invoice_journal_id and sale_journal:
        vals["invoice_journal_id"] = sale_journal.id
    config.write(vals)
    print(f"Caisse '{config.name}': paiements={config.payment_method_ids.mapped('name')}, "
          f"journal={config.journal_id.name if config.journal_id else None}")

env.cr.commit()
print("Initialisation POS terminee.")
