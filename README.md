# POS Restaurant

Plateforme locale de gestion multi-restaurant construite autour d'Odoo 17, PostgreSQL 14, Flask et React.

Le portail centralise les restaurants et succursales, les utilisateurs, les roles, les produits, les stocks, les commandes et les indicateurs de vente. Les operations de caisse restent gerees par le POS natif d'Odoo afin de conserver son comportement standard pour les sessions, paiements, tickets et impressions.

## Fonctionnalites

- gestion d'un restaurant principal et de ses succursales ;
- roles: super administrateur, manager, caissier et responsable de stock ;
- isolation des produits, commandes et sessions par restaurant ;
- lancement du POS natif de la succursale courante ;
- suivi du chiffre d'affaires, des ventes et du stock ;
- filtres par date et exports Excel/PDF ;
- gestion des utilisateurs et synchronisation avec les employes Odoo ;
- paiements Wave et Orange Money simulables en local ;
- journal d'audit, logs techniques et endpoints de metriques.

## Architecture

| Composant | Technologie | Port |
|---|---|---:|
| ERP, POS et logique metier | Odoo 17 | `8071` |
| Base de donnees | PostgreSQL 14 | `5433` |
| Portail web | React, Vite, TypeScript, Tailwind CSS | `5173` |
| API du portail | Flask, Waitress, Psycopg 3 | `8788` |
| Service de paiement local | Node.js, Express | `8787` |

Le module Odoo personnalise se trouve dans `addons/restaurant_starter`. Il ajoute notamment le modele `resto.restaurant` et le champ `restaurant_id` sur les produits, configurations POS, sessions et commandes.

## Prerequis

- Docker Desktop avec Docker Compose ;
- Node.js 20 ou plus recent ;
- Python 3.11 ou plus recent ;
- Git.

## Installation

### 1. Configurer Docker

Copier le fichier d'environnement racine :

```powershell
Copy-Item .env.example .env
Copy-Item config/odoo.conf.example config/odoo.conf
```

Modifier ensuite `admin_passwd` dans `config/odoo.conf`. Ce mot de passe maitre protege la creation, la sauvegarde et la suppression des bases Odoo.

Valeurs locales par defaut :

```dotenv
ODOO_VERSION=17.0
ODOO_PORT=8071
POSTGRES_VERSION=14
POSTGRES_PORT=5433
POSTGRES_USER=odoo
POSTGRES_PASSWORD=odoo
```

### 2. Demarrer Odoo et PostgreSQL

```powershell
docker compose up -d
docker compose ps
```

Ouvrir [http://localhost:8071](http://localhost:8071), puis creer une base Odoo nommee `ecole-db` si elle n'existe pas encore.

Installer ou mettre a jour le module local :

```powershell
docker compose exec odoo odoo -d ecole-db -u restaurant_starter --stop-after-init --no-http
docker compose restart odoo
```

### 3. Installer le portail

```powershell
cd portal
npm install
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Verifier dans `portal/.env` la connexion PostgreSQL :

```dotenv
PORTAL_API_PORT=8788
PORTAL_DATABASE_URL=postgres://odoo:odoo@127.0.0.1:5433/postgres
```

### 4. Demarrer les services

Ouvrir trois terminaux dans `portal`.

Terminal 1, API Flask :

```powershell
npm run api
```

Terminal 2, service de paiement :

```powershell
npm run payments
```

Terminal 3, portail React :

```powershell
npm run dev
```

Ouvrir ensuite [http://localhost:5173](http://localhost:5173).

## Comptes et securite

La connexion au portail utilise d'abord un compte Odoo valide, puis verifie que le meme login est actif et autorise dans l'API du portail.

Lorsqu'un utilisateur est cree depuis le portail, un mot de passe aleatoire non affiche est utilise pour eviter tout identifiant par defaut connu. Un administrateur doit ensuite definir ou reinitialiser son mot de passe dans Odoo avant sa premiere connexion.

Les mots de passe, cles Wave et cles Orange Money doivent rester uniquement dans les fichiers `.env`, qui ne sont pas versionnes. Ne publiez jamais de sauvegarde PostgreSQL ou de filestore Odoo dans le depot.

## Paiements mobiles

Sans cles fournisseur, les paiements Wave et Orange Money peuvent etre simules localement :

```dotenv
PAYMENT_ALLOW_DEV_CONFIRM=true
```

Pour une integration reelle, renseigner les identifiants fournisseur dans `portal/.env` et configurer des URLs publiques pour les callbacks.

## Verification

Depuis `portal` :

```powershell
npm run lint
npm run test
python -m unittest server.test_api -v
npm run build
```

Endpoints utiles :

- API Flask : [http://127.0.0.1:8788/portal-api/health](http://127.0.0.1:8788/portal-api/health)
- Metriques API : [http://127.0.0.1:8788/portal-api/metrics](http://127.0.0.1:8788/portal-api/metrics)
- Paiements : [http://127.0.0.1:8787/payments/health](http://127.0.0.1:8787/payments/health)

## Structure

```text
addons/                  module Odoo personnalise
config/                  configuration Odoo
imports/                 fichiers d'import produits
portal/src/              application React
portal/server/api.py     API Flask du portail
portal/server/payments.js service de paiement local
scripts/                 scripts d'import et d'initialisation
docker-compose.yml       Odoo et PostgreSQL
```

## Limites avant production

- remplacer les mots de passe temporaires par un flux d'invitation/reinitialisation ;
- utiliser HTTPS et un gestionnaire de secrets ;
- ajouter des migrations SQL versionnees ;
- connecter les comptes marchands Wave et Orange Money reels ;
- ajouter sauvegardes automatisees, supervision et alertes ;
- executer Odoo, Flask et le portail derriere un reverse proxy.
