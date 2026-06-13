import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from flask import Flask, g, jsonify, request
from flask_cors import CORS
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from waitress import serve


load_dotenv()

app = Flask(__name__)
CORS(
    app,
    origins=[os.getenv("PORTAL_ORIGIN", "http://127.0.0.1:5173")],
    supports_credentials=True,
)

PORT = int(os.getenv("PORTAL_API_PORT", "8788"))
DATABASE_URL = os.getenv(
    "PORTAL_DATABASE_URL",
    "postgres://odoo:odoo@127.0.0.1:5433/postgres",
)
STORE_PATH = Path(__file__).with_name("portal-store.json")
STARTED_AT = time.monotonic()

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("portal-api")

METRICS = {
    "requests": 0,
    "restaurantReads": 0,
    "restaurantWrites": 0,
    "currentRestaurantChanges": 0,
    "assignmentWrites": 0,
    "userWrites": 0,
    "forbiddenRequests": 0,
    "validationErrors": 0,
}

DEFAULT_RESTAURANTS = [
    {
        "id": "main-restaurant",
        "name": "Restaurant Principal",
        "legalName": "Restaurant Principal SARL",
        "phone": "",
        "email": "",
        "address": "",
        "city": "Dakar",
        "taxId": "",
        "parentId": "",
        "manager": "Super admin",
        "active": True,
    }
]

ROLE_PERMISSIONS = {
    "super_admin": ["register", "dashboard", "products", "orders", "stock", "actions", "settings"],
    "manager_parent": ["dashboard", "products", "orders", "stock"],
    "manager_branch": ["dashboard", "products", "orders", "stock"],
    "cashier": ["register"],
    "stock_manager": ["products", "stock", "actions"],
}

DEFAULT_USERS = [
    {
        "id": "user-super-admin",
        "name": "Super admin",
        "login": "admin",
        "role": "super_admin",
        "restaurantIds": ["main-restaurant"],
        "active": True,
    }
]


def db_connection():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row, connect_timeout=5)


@app.before_request
def before_request():
    g.request_started = time.monotonic()
    METRICS["requests"] += 1


@app.after_request
def after_request(response):
    logger.info(
        json.dumps(
            {
                "level": "error" if response.status_code >= 500 else "info",
                "event": "portal_api_request",
                "method": request.method,
                "path": request.path,
                "status": response.status_code,
                "durationMs": round((time.monotonic() - g.request_started) * 1000),
            }
        )
    )
    return response


@app.errorhandler(Exception)
def handle_unexpected_error(error):
    logger.exception("portal_api_error")
    return jsonify(error="Erreur interne de l'API portail."), 500


def default_store():
    return {
        "restaurants": DEFAULT_RESTAURANTS,
        "currentRestaurantId": DEFAULT_RESTAURANTS[0]["id"],
        "assignments": {"products": {}, "orders": {}, "sessions": {}},
        "users": DEFAULT_USERS,
        "currentUserId": DEFAULT_USERS[0]["id"],
        "audit": [],
    }


def initial_store():
    try:
        parsed = json.loads(STORE_PATH.read_text(encoding="utf-8"))
        restaurants = parsed.get("restaurants")
        if isinstance(restaurants, list) and restaurants:
            assignments = parsed.get("assignments") or {}
            users = parsed.get("users")
            return {
                "restaurants": restaurants,
                "currentRestaurantId": parsed.get("currentRestaurantId") or restaurants[0]["id"],
                "assignments": {
                    "products": assignments.get("products") or {},
                    "orders": assignments.get("orders") or {},
                    "sessions": assignments.get("sessions") or {},
                },
                "users": users if isinstance(users, list) and users else DEFAULT_USERS,
                "currentUserId": parsed.get("currentUserId") or DEFAULT_USERS[0]["id"],
                "audit": parsed.get("audit") if isinstance(parsed.get("audit"), list) else [],
            }
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return default_store()


def init_db():
    with db_connection() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS portal_state (
              key text PRIMARY KEY,
              value text NOT NULL
            );

            CREATE TABLE IF NOT EXISTS restaurants (
              id text PRIMARY KEY,
              name text NOT NULL,
              legal_name text NOT NULL DEFAULT '',
              phone text NOT NULL DEFAULT '',
              email text NOT NULL DEFAULT '',
              address text NOT NULL DEFAULT '',
              city text NOT NULL DEFAULT '',
              tax_id text NOT NULL DEFAULT '',
              parent_id text REFERENCES restaurants(id) ON DELETE SET NULL,
              manager text NOT NULL DEFAULT '',
              active boolean NOT NULL DEFAULT true,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now()
            );

            CREATE TABLE IF NOT EXISTS portal_users (
              id text PRIMARY KEY,
              name text NOT NULL,
              login text NOT NULL UNIQUE,
              role text NOT NULL,
              active boolean NOT NULL DEFAULT true,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now()
            );

            CREATE TABLE IF NOT EXISTS user_restaurants (
              user_id text NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
              restaurant_id text NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
              PRIMARY KEY (user_id, restaurant_id)
            );

            CREATE TABLE IF NOT EXISTS entity_assignments (
              kind text NOT NULL,
              entity_id text NOT NULL,
              restaurant_id text NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              PRIMARY KEY (kind, entity_id)
            );

            CREATE TABLE IF NOT EXISTS audit_logs (
              id bigserial PRIMARY KEY,
              event text NOT NULL,
              payload jsonb NOT NULL DEFAULT '{}'::jsonb,
              actor jsonb,
              restaurant_id text,
              created_at timestamptz NOT NULL DEFAULT now()
            );
            """
        )
        cursor.execute("SELECT count(*)::int AS count FROM restaurants")
        count = cursor.fetchone()["count"]
    if count == 0:
        write_store(initial_store())


def row_to_restaurant(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "legalName": row["legal_name"],
        "phone": row["phone"],
        "email": row["email"],
        "address": row["address"],
        "city": row["city"],
        "taxId": row["tax_id"],
        "parentId": row["parent_id"] or "",
        "manager": row["manager"],
        "active": row["active"],
    }


def read_store():
    with db_connection() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT * FROM restaurants ORDER BY created_at, id")
        restaurant_rows = cursor.fetchall()
        cursor.execute("SELECT * FROM portal_users ORDER BY created_at, id")
        user_rows = cursor.fetchall()
        cursor.execute("SELECT * FROM user_restaurants")
        link_rows = cursor.fetchall()
        cursor.execute("SELECT * FROM entity_assignments")
        assignment_rows = cursor.fetchall()
        cursor.execute("SELECT key, value FROM portal_state")
        state_rows = cursor.fetchall()
        cursor.execute(
            "SELECT event, payload, actor, restaurant_id, created_at "
            "FROM audit_logs ORDER BY id DESC LIMIT 200"
        )
        audit_rows = cursor.fetchall()

    restaurant_ids_by_user = {}
    for row in link_rows:
        restaurant_ids_by_user.setdefault(row["user_id"], []).append(row["restaurant_id"])

    state = {row["key"]: row["value"] for row in state_rows}
    assignments = {"products": {}, "orders": {}, "sessions": {}}
    for row in assignment_rows:
        assignments.setdefault(row["kind"], {})[row["entity_id"]] = row["restaurant_id"]

    restaurants = [row_to_restaurant(row) for row in restaurant_rows]
    users = [
        {
            "id": row["id"],
            "name": row["name"],
            "login": row["login"],
            "role": row["role"],
            "restaurantIds": restaurant_ids_by_user.get(row["id"], []),
            "active": row["active"],
        }
        for row in user_rows
    ]
    audit = [
        {
            "event": row["event"],
            "payload": row["payload"] or {},
            **({"actor": row["actor"]} if row["actor"] else {}),
            **({"restaurantId": row["restaurant_id"]} if row["restaurant_id"] else {}),
            "at": row["created_at"].isoformat(),
        }
        for row in reversed(audit_rows)
    ]

    return {
        "restaurants": restaurants or DEFAULT_RESTAURANTS,
        "currentRestaurantId": state.get("currentRestaurantId")
        or (restaurants[0]["id"] if restaurants else DEFAULT_RESTAURANTS[0]["id"]),
        "assignments": assignments,
        "users": users or DEFAULT_USERS,
        "currentUserId": state.get("currentUserId")
        or (users[0]["id"] if users else DEFAULT_USERS[0]["id"]),
        "audit": audit,
    }


def write_store(store):
    restaurant_ids = {restaurant["id"] for restaurant in store["restaurants"]}
    with db_connection() as connection, connection.cursor() as cursor:
        cursor.execute("DELETE FROM user_restaurants")
        cursor.execute("DELETE FROM entity_assignments")
        cursor.execute("DELETE FROM audit_logs")
        cursor.execute("DELETE FROM portal_users")
        cursor.execute("DELETE FROM restaurants")

        for restaurant in store["restaurants"]:
            cursor.execute(
                """
                INSERT INTO restaurants
                  (id, name, legal_name, phone, email, address, city, tax_id, parent_id, manager, active, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,NULL,%s,%s,now())
                """,
                (
                    restaurant["id"],
                    restaurant["name"],
                    restaurant.get("legalName", ""),
                    restaurant.get("phone", ""),
                    restaurant.get("email", ""),
                    restaurant.get("address", ""),
                    restaurant.get("city", ""),
                    restaurant.get("taxId", ""),
                    restaurant.get("manager", ""),
                    restaurant.get("active", True),
                ),
            )

        for restaurant in store["restaurants"]:
            parent_id = restaurant.get("parentId")
            if parent_id and parent_id in restaurant_ids:
                cursor.execute(
                    "UPDATE restaurants SET parent_id = %s WHERE id = %s",
                    (parent_id, restaurant["id"]),
                )

        for user in store["users"]:
            cursor.execute(
                """
                INSERT INTO portal_users (id, name, login, role, active, updated_at)
                VALUES (%s,%s,%s,%s,%s,now())
                """,
                (user["id"], user["name"], user["login"], user["role"], user.get("active", True)),
            )
            for restaurant_id in user.get("restaurantIds", []):
                if restaurant_id in restaurant_ids:
                    cursor.execute(
                        """
                        INSERT INTO user_restaurants (user_id, restaurant_id)
                        VALUES (%s,%s) ON CONFLICT DO NOTHING
                        """,
                        (user["id"], restaurant_id),
                    )

        for kind, rows in (store.get("assignments") or {}).items():
            for entity_id, restaurant_id in (rows or {}).items():
                if restaurant_id in restaurant_ids:
                    cursor.execute(
                        """
                        INSERT INTO entity_assignments (kind, entity_id, restaurant_id, updated_at)
                        VALUES (%s,%s,%s,now())
                        """,
                        (kind, entity_id, restaurant_id),
                    )

        cursor.execute(
            "DELETE FROM portal_state WHERE key IN ('currentRestaurantId', 'currentUserId')"
        )
        cursor.executemany(
            "INSERT INTO portal_state (key, value) VALUES (%s,%s)",
            [
                ("currentRestaurantId", store["currentRestaurantId"]),
                ("currentUserId", store["currentUserId"]),
            ],
        )

        for row in (store.get("audit") or [])[-200:]:
            created_at = row.get("at") or datetime.now(timezone.utc).isoformat()
            cursor.execute(
                """
                INSERT INTO audit_logs (event, payload, actor, restaurant_id, created_at)
                VALUES (%s,%s,%s,%s,%s)
                """,
                (
                    row["event"],
                    Jsonb(row.get("payload") or {}),
                    Jsonb(row["actor"]) if row.get("actor") else None,
                    row.get("restaurantId"),
                    created_at,
                ),
            )


def is_descendant(restaurants, possible_child_id, parent_id):
    current = next((item for item in restaurants if item["id"] == possible_child_id), None)
    visited = set()
    while current and current.get("parentId"):
        if current["id"] in visited:
            return False
        visited.add(current["id"])
        if current["parentId"] == parent_id:
            return True
        current = next(
            (item for item in restaurants if item["id"] == current["parentId"]),
            None,
        )
    return False


def validate_restaurants(restaurants):
    if not isinstance(restaurants, list) or not restaurants:
        return "Au moins un restaurant est requis."
    ids = set()
    for restaurant in restaurants:
        if not restaurant.get("id") or not restaurant.get("name"):
            return "Chaque restaurant doit avoir un identifiant et un nom."
        if restaurant["id"] in ids:
            return f"Identifiant duplique: {restaurant['id']}."
        ids.add(restaurant["id"])
    for restaurant in restaurants:
        parent_id = restaurant.get("parentId")
        if parent_id:
            if parent_id not in ids:
                return f"Parent introuvable pour {restaurant['name']}."
            if parent_id == restaurant["id"]:
                return f"{restaurant['name']} ne peut pas etre son propre parent."
            if is_descendant(restaurants, parent_id, restaurant["id"]):
                return f"Cycle detecte dans la hierarchie de {restaurant['name']}."
    return ""


def current_user(store):
    return next(
        (user for user in store["users"] if user["id"] == store["currentUserId"]),
        store["users"][0] if store["users"] else DEFAULT_USERS[0],
    )


def user_scope(store, user):
    if user["role"] == "super_admin":
        return {restaurant["id"] for restaurant in store["restaurants"]}
    scope = set(user.get("restaurantIds") or [])
    changed = True
    while changed:
        changed = False
        for restaurant in store["restaurants"]:
            if restaurant.get("parentId") in scope and restaurant["id"] not in scope:
                scope.add(restaurant["id"])
                changed = True
    return scope


def public_settings(store):
    user = current_user(store)
    scope = user_scope(store, user)
    current_exists = any(
        restaurant["id"] == store["currentRestaurantId"]
        for restaurant in store["restaurants"]
    ) and store["currentRestaurantId"] in scope
    fallback_id = next(iter(scope), store["restaurants"][0]["id"])
    return {
        "restaurants": store["restaurants"],
        "currentRestaurantId": store["currentRestaurantId"] if current_exists else fallback_id,
        "assignments": store.get("assignments") or {"products": {}, "orders": {}, "sessions": {}},
        "users": store["users"],
        "currentUser": user,
    }


def add_audit(store, event, payload):
    actor = current_user(store)
    store["audit"] = (
        (store.get("audit") or [])
        + [
            {
                "event": event,
                "payload": payload,
                "actor": {
                    "id": actor["id"],
                    "name": actor["name"],
                    "login": actor["login"],
                    "role": actor["role"],
                },
                "restaurantId": store["currentRestaurantId"],
                "at": datetime.now(timezone.utc).isoformat(),
            }
        ]
    )[-200:]


def has_permission(user, permission):
    return permission in ROLE_PERMISSIONS.get(user["role"], [])


def require_permission(store, permission):
    user = current_user(store)
    if not user.get("active") or not has_permission(user, permission):
        METRICS["forbiddenRequests"] += 1
        return None, (jsonify(error="Action non autorisee pour ce role."), 403)
    return user, None


def validate_users(users, restaurants):
    if not isinstance(users, list) or not users:
        return "Au moins un utilisateur est requis."
    ids = set()
    restaurant_ids = {restaurant["id"] for restaurant in restaurants}
    for user in users:
        if not user.get("id") or not user.get("name") or not user.get("login"):
            return "Chaque utilisateur doit avoir un nom, un login et un identifiant."
        if user.get("role") not in ROLE_PERMISSIONS:
            return f"Role invalide pour {user['name']}."
        if user["id"] in ids:
            return f"Identifiant utilisateur duplique: {user['id']}."
        ids.add(user["id"])
        assigned = user.get("restaurantIds")
        if user["role"] != "super_admin" and (not isinstance(assigned, list) or not assigned):
            return f"{user['name']} doit etre rattache a au moins un restaurant."
        for restaurant_id in assigned or []:
            if restaurant_id not in restaurant_ids:
                return f"Restaurant introuvable pour {user['name']}."
    if not any(user["role"] == "super_admin" and user.get("active") for user in users):
        return "Au moins un super admin actif est requis."
    return ""


def assign_entity(store, kind, entity_id, restaurant_id):
    if not any(item["id"] == restaurant_id for item in store["restaurants"]):
        return "Restaurant introuvable."
    entity_id = str(entity_id or "")
    if not entity_id:
        return "Identifiant introuvable."
    store.setdefault("assignments", {"products": {}, "orders": {}, "sessions": {}})
    store["assignments"].setdefault(kind, {})[entity_id] = restaurant_id
    add_audit(store, f"{kind}.assigned", {"id": entity_id, "restaurantId": restaurant_id})
    return ""


@app.get("/health")
@app.get("/portal-api/health")
def health():
    store = read_store()
    return jsonify(
        ok=True,
        service="portal-api",
        framework="flask",
        storage="postgres",
        uptimeSeconds=round(time.monotonic() - STARTED_AT),
        restaurants=len(store["restaurants"]),
    )


@app.get("/metrics")
@app.get("/portal-api/metrics")
def metrics():
    store = read_store()
    assignments = store.get("assignments") or {}
    return jsonify(
        **METRICS,
        restaurants=len(store["restaurants"]),
        activeRestaurants=sum(item.get("active", False) for item in store["restaurants"]),
        parentRestaurants=sum(not item.get("parentId") for item in store["restaurants"]),
        branches=sum(bool(item.get("parentId")) for item in store["restaurants"]),
        assignedProducts=len(assignments.get("products") or {}),
        assignedOrders=len(assignments.get("orders") or {}),
        assignedSessions=len(assignments.get("sessions") or {}),
        users=len(store["users"]),
        activeUsers=sum(user.get("active", False) for user in store["users"]),
    )


@app.get("/restaurants")
@app.get("/portal-api/restaurants")
def get_restaurants():
    METRICS["restaurantReads"] += 1
    return jsonify(public_settings(read_store()))


@app.put("/restaurants")
@app.put("/portal-api/restaurants")
def put_restaurants():
    store = read_store()
    _, error_response = require_permission(store, "settings")
    if error_response:
        return error_response
    restaurants = (request.get_json(silent=True) or {}).get("restaurants")
    validation_error = validate_restaurants(restaurants)
    if validation_error:
        METRICS["validationErrors"] += 1
        return jsonify(error=validation_error), 400
    store["restaurants"] = restaurants
    if not any(item["id"] == store["currentRestaurantId"] for item in restaurants):
        store["currentRestaurantId"] = restaurants[0]["id"]
    add_audit(store, "restaurants.updated", {"count": len(restaurants)})
    write_store(store)
    METRICS["restaurantWrites"] += 1
    return jsonify(public_settings(store))


@app.put("/restaurants/current")
@app.put("/portal-api/restaurants/current")
def put_current_restaurant():
    store = read_store()
    user = current_user(store)
    restaurant_id = str((request.get_json(silent=True) or {}).get("id") or "")
    if not any(item["id"] == restaurant_id for item in store["restaurants"]):
        METRICS["validationErrors"] += 1
        return jsonify(error="Restaurant introuvable."), 404
    if restaurant_id not in user_scope(store, user):
        METRICS["forbiddenRequests"] += 1
        return jsonify(error="Ce restaurant est hors du perimetre de cet utilisateur."), 403
    store["currentRestaurantId"] = restaurant_id
    add_audit(store, "restaurants.current_changed", {"id": restaurant_id})
    write_store(store)
    METRICS["currentRestaurantChanges"] += 1
    return jsonify(public_settings(store))


@app.post("/auth/current-user")
@app.post("/portal-api/auth/current-user")
def post_current_user():
    store = read_store()
    login = str((request.get_json(silent=True) or {}).get("login") or "").strip().lower()
    user = next((item for item in store["users"] if item["login"].lower() == login), None)
    if not user or not user.get("active"):
        METRICS["forbiddenRequests"] += 1
        return jsonify(error="Utilisateur portail non configure ou inactif."), 403
    store["currentUserId"] = user["id"]
    scope = user_scope(store, user)
    if store["currentRestaurantId"] not in scope:
        store["currentRestaurantId"] = next(iter(scope), store["restaurants"][0]["id"])
    add_audit(store, "auth.current_user_changed", {"userId": user["id"], "login": user["login"]})
    write_store(store)
    return jsonify(public_settings(store))


def assignment_response(kind, entity_key, required_permission=None):
    store = read_store()
    user = current_user(store)
    if required_permission:
        user, error_response = require_permission(store, required_permission)
        if error_response:
            return error_response
    elif not user.get("active") or not (
        has_permission(user, "register") or has_permission(user, "actions")
    ):
        METRICS["forbiddenRequests"] += 1
        return jsonify(error="Action non autorisee pour ce role."), 403
    body = request.get_json(silent=True) or {}
    restaurant_id = body.get("restaurantId")
    if restaurant_id not in user_scope(store, user):
        METRICS["forbiddenRequests"] += 1
        return jsonify(error="Ce restaurant est hors du perimetre de cet utilisateur."), 403
    validation_error = assign_entity(store, kind, body.get(entity_key), restaurant_id)
    if validation_error:
        METRICS["validationErrors"] += 1
        return jsonify(error=validation_error), 400
    write_store(store)
    METRICS["assignmentWrites"] += 1
    return jsonify(public_settings(store))


@app.put("/assignments/product")
@app.put("/portal-api/assignments/product")
def put_product_assignment():
    return assignment_response("products", "productId", "actions")


@app.put("/assignments/order")
@app.put("/portal-api/assignments/order")
def put_order_assignment():
    return assignment_response("orders", "orderId", "register")


@app.put("/assignments/session")
@app.put("/portal-api/assignments/session")
def put_session_assignment():
    return assignment_response("sessions", "sessionId")


@app.put("/users")
@app.put("/portal-api/users")
def put_users():
    store = read_store()
    _, error_response = require_permission(store, "settings")
    if error_response:
        return error_response
    users = (request.get_json(silent=True) or {}).get("users")
    validation_error = validate_users(users, store["restaurants"])
    if validation_error:
        METRICS["validationErrors"] += 1
        return jsonify(error=validation_error), 400
    store["users"] = users
    if not any(
        user["id"] == store["currentUserId"] and user.get("active") for user in users
    ):
        store["currentUserId"] = next(
            (
                user["id"]
                for user in users
                if user["role"] == "super_admin" and user.get("active")
            ),
            users[0]["id"],
        )
    add_audit(store, "users.updated", {"count": len(users)})
    write_store(store)
    METRICS["userWrites"] += 1
    return jsonify(public_settings(store))


@app.get("/audit")
@app.get("/portal-api/audit")
def get_audit():
    return jsonify(rows=read_store().get("audit") or [])


if __name__ == "__main__":
    init_db()
    logger.info(f"Portal API Flask listening on http://127.0.0.1:{PORT} using PostgreSQL")
    serve(app, host="127.0.0.1", port=PORT, threads=8)
