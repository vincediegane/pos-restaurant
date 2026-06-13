# Resto Pilot Portal

Portail React/Vite/Tailwind pour piloter la caisse, les produits, les commandes, le stock, les analyses et les parametres multi-restaurants.

## Commandes

```powershell
npm install
python -m pip install -r requirements.txt
npm run dev
npm run api
npm run payments
```

Qualite:

```powershell
npm run lint
npm run test
npm run test:e2e
npm run build
npm run check
```

## Tests

- `src/utils/restaurantTree.test.ts` couvre la logique restaurant parent, succursales et suppression.
- `tests/e2e/login.spec.ts` verifie que l'ecran de connexion apparait quand aucune session n'est active.

## Paiements

Le service local `server/payments.js` supporte:

- simulation locale Wave/Orange Money sans cles API,
- confirmation locale si `PAYMENT_ALLOW_DEV_CONFIRM=true`,
- webhooks,
- logs JSON par requete,
- endpoint sante: `http://127.0.0.1:8787/payments/health`,
- endpoint metriques: `http://127.0.0.1:8787/payments/metrics`.

## Notes production

Une API backend Flask existe dans `server/api.py`. Elle persiste les donnees dans PostgreSQL, valide la hierarchie parent/succursales et expose:

- `http://127.0.0.1:8788/portal-api/health`
- `http://127.0.0.1:8788/portal-api/metrics`
- `http://127.0.0.1:8788/portal-api/restaurants`

Elle persiste maintenant ses donnees dans PostgreSQL via `PORTAL_DATABASE_URL`. Au premier demarrage, si la base est vide, elle migre automatiquement l'ancien `server/portal-store.json` puis travaille en base.

Dependances backend: Flask, Flask-CORS, Psycopg 3, Waitress et python-dotenv. Le serveur de paiements reste en Node.js.

Tables creees:

- `restaurants`
- `portal_users`
- `user_restaurants`
- `entity_assignments`
- `audit_logs`
- `portal_state`

Elle conserve aussi l'affectation des produits, ventes et sessions par restaurant. Les nouvelles ventes, nouveaux produits et nouvelles sessions crees depuis le portail sont automatiquement rattaches au restaurant courant.

Elle gere aussi une premiere couche roles et permissions:

- super admin: tout le portail,
- manager parent: analyses, produits, commandes et stock sur son perimetre,
- manager succursale: analyses, produits, commandes et stock sur sa succursale,
- caissier: caisse uniquement,
- responsable stock: produits, stock et gestion.

Apres connexion, le portail active l'utilisateur dont le `login` correspond a l'identifiant saisi. Si aucun utilisateur portail actif ne correspond, l'acces portail est refuse.

Avant une mise en production, il faut encore ajouter de vraies migrations versionnees, renforcer les tests API et pousser l'isolation multi-restaurant jusque dans le backend metier.

## Isolation backend metier

Le module local `restaurant_starter` ajoute maintenant dans Odoo:

- le modele `resto.restaurant`,
- `restaurant_id` sur les produits,
- `restaurant_id` sur les points de vente,
- `restaurant_id` sur les sessions,
- `restaurant_id` sur les commandes POS.

Le portail synchronise les restaurants vers Odoo et renseigne ces champs natifs quand il cree un produit, une session ou une commande.
