# Restaurant Pilot

Plateforme de gestion multi-restaurant entierement integree dans **Odoo 17**. Plus de portail React ni d'API Flask separee : tout le backoffice (tableau de bord, produits, commandes, stock, utilisateurs, audit) tourne directement dans Odoo, avec une interface simplifiee.

Les operations de caisse restent gerees par le POS natif d'Odoo (sessions, paiements, tickets, impressions).

## Fonctionnalites

- gestion d'un restaurant unique (fiche etablissement : coordonnees, informations legales) ;
- roles simplifies : Super admin, Manager, Caissier, Responsable stock — chaque role est automatiquement synchronise avec les groupes de securite Odoo (POS, stock) ;
- tableau de bord avec KPIs, graphiques de ventes, repartition catalogue et marges ;
- lancement du POS natif d'Odoo ;
- suivi du chiffre d'affaires, des ventes et du stock ;
- gestion des utilisateurs avec roles ;
- journal d'audit integre (creation d'utilisateurs, changements de role, modification de la fiche restaurant).

## Architecture

| Composant | Technologie | Port |
|---|---|---|
| ERP, POS et backoffice | Odoo 17 | `8071` |
| Base de donnees | PostgreSQL 14 | `5433` |

Le module Odoo personnalise se trouve dans `addons/restaurant_starter`. Il contient tous les models, vues, controleurs et securite necessaires.

## Prerequis

- Docker Desktop avec Docker Compose ;
- Git.

## Installation

### 1. Configurer Docker

```powershell
Copy-Item .env.example .env
Copy-Item config/odoo.conf.example config/odoo.conf
```

Modifier ensuite `admin_passwd` dans `config/odoo.conf`.

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

Ouvrir [http://localhost:8071](http://localhost:8071), puis creer une base Odoo (ex: `ecole-db`).

### 3. Installer le module

```powershell
docker compose exec odoo odoo -d ecole-db -u restaurant_starter --stop-after-init --no-http
docker compose restart odoo
```

Une fois redemarre, le menu **Restaurant** apparait dans Odoo avec les sous-menus : Tableau de bord, Caisse, Catalogue, Stock, Parametres.

### 4. Initialiser la comptabilite et la caisse

Obligatoire avant la premiere session POS (plan comptable SYSCOHADA Senegal, devise XOF, journaux, moyens de paiement Especes/Wave/Orange Money) :

```powershell
docker compose exec -T odoo odoo shell -d ecole-db --no-http < scripts/setup_pos.py
docker compose restart odoo
```

Le script est idempotent : il peut etre relance sans dupliquer les donnees.

## Comptes et securite

- Compte admin par defaut : `admin` (mot de passe defini lors de la creation de la base).
- Les roles restaurant se configurent dans Parametres > Utilisateurs.
- Les mots de passe doivent rester uniquement dans les fichiers `.env`.

## Structure

```text
addons/                  module Odoo personnalise
  restaurant_starter/
    models/              models Odoo (restaurant, utilisateurs, audit)
    views/               vues Odoo XML (formulaires, listes, dashboard)
    controllers/         controleurs HTTP (dashboard)
    security/            groupes et droits d'acces
    data/                donnees de demonstration
config/                  configuration Odoo
scripts/                 scripts d'import et d'initialisation
docker-compose.yml       Odoo et PostgreSQL
```

## Limites avant production

- remplacer les mots de passe temporaires par un flux d'invitation/reinitialisation ;
- utiliser HTTPS et un gestionnaire de secrets ;
- passer `list_db = False` dans `config/odoo.conf` (le gestionnaire de bases ne doit pas etre expose) ;
- connecter les prestataires de paiement reels directement au POS si necessaire ;
- ajouter sauvegardes automatisees, supervision et alertes ;
- ajouter des tests automatises (tests Odoo du module).
