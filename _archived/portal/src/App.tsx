import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BadgeDollarSign,
  Boxes,
  ChefHat,
  ClipboardList,
  CreditCard,
  CheckCircle2,
  ExternalLink,
  FileDown,
  AlertCircle,
  LayoutDashboard,
  LogIn,
  LogOut,
  PackageSearch,
  PlayCircle,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Settings,
  ShoppingBag,
  Store,
  Trash2,
  Utensils,
} from "lucide-react";
import clsx from "clsx";
import {
  adjustProductStock,
  assignBackendPosConfigToRestaurant,
  assignBackendProductToRestaurant,
  assignBackendSessionToRestaurant,
  buildNativePosUrl,
  closePosSession,
  createPosCategory,
  createProduct,
  createProductCategory,
  destroySession,
  getActiveSession,
  loadBusinessData,
  startPosSession,
  syncBackendRestaurants,
  syncBackendUsers,
  updateProduct,
  type AuthConfig,
} from "./services/backend";
import type { Order, PortalData, PortalUser, Product, RestaurantProfile, UserRole } from "./types";
import { exportExcel, exportPdf } from "./utils/exporters";
import { canDeleteBranch, getEligibleParents } from "./utils/restaurantTree";
import { activatePortalUser, assignProductToRestaurant, assignSessionToRestaurant, defaultRestaurants, loadAuditRows, savePortalUsers, saveRestaurantSettings, selectCurrentRestaurant, type AuditRow, type PortalAssignments } from "./services/platform";

type Page = "register" | "dashboard" | "products" | "orders" | "stock" | "actions" | "settings";
type Toast = { id: number; type: "success" | "error" | "info"; message: string };
const money = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "XOF",
  maximumFractionDigits: 0,
});

const navItems = [
  { id: "register" as const, label: "Caisse", icon: Utensils },
  { id: "dashboard" as const, label: "Tableau de bord", icon: LayoutDashboard },
  { id: "products" as const, label: "Produits", icon: ShoppingBag },
  { id: "orders" as const, label: "Commandes", icon: ClipboardList },
  { id: "stock" as const, label: "Stock", icon: Boxes },
  { id: "actions" as const, label: "Gestion", icon: Plus },
  { id: "settings" as const, label: "Paramètres", icon: Settings },
];

const roleLabels: Record<UserRole, string> = {
  super_admin: "Super admin",
  manager_parent: "Manager parent",
  manager_branch: "Manager succursale",
  cashier: "Caissier",
  stock_manager: "Responsable stock",
};

const rolePages: Record<UserRole, Page[]> = {
  super_admin: ["register", "dashboard", "products", "orders", "stock", "actions", "settings"],
  manager_parent: ["dashboard", "products", "orders", "stock"],
  manager_branch: ["dashboard", "products", "orders", "stock"],
  cashier: ["register"],
  stock_manager: ["products", "stock", "actions"],
};

const defaultUsers: PortalUser[] = [
  {
    id: "user-super-admin",
    name: "Super admin",
    login: "admin",
    role: "super_admin",
    restaurantIds: ["main-restaurant"],
    active: true,
  },
];

function canAccessPage(user: PortalUser | null, page: Page) {
  if (!user || !user.active) return false;
  return rolePages[user.role]?.includes(page) || false;
}

function createLocalId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function collectRestaurantScope(restaurants: RestaurantProfile[], restaurantId: string) {
  const ids = new Set([restaurantId]);
  let changed = true;
  while (changed) {
    changed = false;
    restaurants.forEach((restaurant) => {
      if (restaurant.parentId && ids.has(restaurant.parentId) && !ids.has(restaurant.id)) {
        ids.add(restaurant.id);
        changed = true;
      }
    });
  }
  return ids;
}

function restaurantForEntity(assignments: Record<string, string>, id: number) {
  return assignments[String(id)] || defaultRestaurants[0].id;
}

function filterPortalDataByRestaurant(data: PortalData, restaurants: RestaurantProfile[], currentRestaurantId: string, assignments: PortalAssignments): PortalData {
  const scope = collectRestaurantScope(restaurants, currentRestaurantId);
  return {
    ...data,
    products: data.products.filter((product) => scope.has(product.restaurantId || restaurantForEntity(assignments.products, product.id))),
    orders: data.orders.filter((order) => scope.has(order.restaurantId || restaurantForEntity(assignments.orders, order.id))),
    posSessions: data.posSessions.filter((session) => scope.has(session.restaurantId || restaurantForEntity(assignments.sessions, session.id))),
  };
}

function ToastStack({ toasts, onClose }: { toasts: Toast[]; onClose: (id: number) => void }) {
  return (
    <div className="fixed right-4 top-4 z-50 grid w-[min(360px,calc(100vw-2rem))] gap-3">
      {toasts.map((toast) => {
        const Icon = toast.type === "error" ? AlertCircle : CheckCircle2;
        return (
          <div
            key={toast.id}
            className={clsx(
              "flex items-start gap-3 rounded-lg border bg-white p-4 text-sm shadow-soft",
              toast.type === "error" ? "border-rose-200 text-rose-800" : toast.type === "success" ? "border-emerald-200 text-emerald-800" : "border-line text-ink",
            )}
          >
            <Icon className="mt-0.5 shrink-0" size={18} />
            <p className="flex-1 font-medium">{toast.message}</p>
            <button className="text-slate-400 hover:text-slate-700" onClick={() => onClose(toast.id)}>x</button>
          </div>
        );
      })}
    </div>
  );
}

function LoadingOverlay({ show, label }: { show: boolean; label: string }) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-white/45 backdrop-blur-sm">
      <div className="flex items-center gap-3 rounded-lg border border-line bg-white px-5 py-4 text-sm font-semibold text-ink shadow-soft">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-sage" />
        {label}
      </div>
    </div>
  );
}

function ButtonSpinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white" />;
}

function StatCard({ label, value, detail, icon: Icon, tone }: { label: string; value: string; detail: string; icon: typeof BadgeDollarSign; tone: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-ink">{value}</p>
        </div>
        <div className={clsx("flex h-11 w-11 items-center justify-center rounded-md text-white", tone)}>
          <Icon size={22} />
        </div>
      </div>
      <p className="mt-4 text-sm text-slate-500">{detail}</p>
    </div>
  );
}

function StatusPill({ status }: { status: Order["status"] }) {
  const styles = {
    Paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
    Open: "bg-amber-50 text-amber-700 border-amber-200",
    Invoiced: "bg-sky-50 text-sky-700 border-sky-200",
    Cancelled: "bg-rose-50 text-rose-700 border-rose-200",
  };
  return <span className={clsx("rounded-full border px-2.5 py-1 text-xs font-semibold", styles[status])}>{status}</span>;
}

function Dashboard({ data }: { data: PortalData }) {
  const today = new Date().toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const filteredOrders = data.orders.filter((order) => {
    if (dateFrom && order.date < dateFrom) return false;
    if (dateTo && order.date > dateTo) return false;
    return true;
  });
  const salesByDay = Array.from(
    filteredOrders.reduce<Map<string, { label: string; revenue: number; orders: number; margin: number }>>((acc, order) => {
      const current = acc.get(order.date) || { label: order.date, revenue: 0, orders: 0, margin: 0 };
      current.revenue += order.total;
      current.orders += 1;
      acc.set(order.date, current);
      return acc;
    }, new Map()).values(),
  ).sort((a, b) => a.label.localeCompare(b.label));
  const totalRevenue = filteredOrders.reduce((sum, order) => sum + order.total, 0);
  const avgTicket = filteredOrders.length ? totalRevenue / filteredOrders.length : 0;
  const trackedProducts = data.products.filter((product) => product.tracking === "tracked");
  const lowTrackedStock = trackedProducts.filter((product) => product.stock < 25).length;
  const topProducts = [...data.products].sort((a, b) => b.margin - a.margin).slice(0, 6);
  const pieData = Object.entries(
    data.products.reduce<Record<string, number>>((acc, product) => {
      acc[product.category] = (acc[product.category] || 0) + 1;
      return acc;
    }, {}),
  ).map(([name, value]) => ({ name, value }));
  const pieColors = ["#4f7c6a", "#d79b2b", "#c95d4f", "#3d6272", "#7c6f64"];
  const analysisRows = [
    { metric: "Date debut", value: dateFrom || "Toutes" },
    { metric: "Date fin", value: dateTo || "Toutes" },
    { metric: "Nombre de ventes", value: filteredOrders.length },
    { metric: "Chiffre d'affaires", value: totalRevenue },
    { metric: "Ticket moyen", value: Math.round(avgTicket) },
    { metric: "Produits caisse", value: data.products.filter((p) => p.pos).length },
    { metric: "Alertes stock suivi", value: lowTrackedStock },
    { metric: "Produits catalogue", value: data.products.length },
  ];
  const analysisColumns = [
    { header: "Indicateur", value: (row: { metric: string; value: number | string }) => row.metric },
    { header: "Valeur", value: (row: { metric: string; value: number | string }) => row.value },
  ];
  const dayColumns = [
    { header: "Date", value: (row: { label: string; revenue: number; orders: number }) => row.label },
    { header: "Nombre de ventes", value: (row: { label: string; revenue: number; orders: number }) => row.orders },
    { header: "Chiffre d'affaires", value: (row: { label: string; revenue: number; orders: number }) => row.revenue },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">Analyse des ventes</h2>
            <p className="text-sm text-slate-500">Filtre par jour ou par plage de dates</p>
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <input className={inputClass()} type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            <input className={inputClass()} type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            <button className="h-10 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => { setDateFrom(""); setDateTo(""); }}>
              Tout
            </button>
            <button className="h-10 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => { setDateFrom(today); setDateTo(today); }}>
              Aujourd'hui
            </button>
            <ExportButtons
              onExcel={() => {
                exportExcel("analyse-dashboard", analysisRows, analysisColumns);
                exportExcel("ca-par-jour", salesByDay, dayColumns);
              }}
              onPdf={() => exportPdf("analyse-dashboard", "Analyse du dashboard", [...analysisRows, ...salesByDay.map((row) => ({ metric: `CA ${row.label} (${row.orders} ventes)`, value: row.revenue }))], analysisColumns)}
            />
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {analysisRows.slice(2, 5).map((row) => (
            <div className="rounded-md border border-line bg-slate-50 p-4" key={row.metric}>
              <p className="text-sm text-slate-500">{row.metric}</p>
              <p className="mt-1 text-xl font-semibold text-ink">{row.metric.includes("Chiffre") || row.metric.includes("Ticket") ? money.format(Number(row.value)) : row.value}</p>
            </div>
          ))}
        </div>
      </section>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Chiffre d'affaires" value={money.format(totalRevenue)} detail={`${filteredOrders.length} ventes sur la periode`} icon={BadgeDollarSign} tone="bg-sage" />
        <StatCard label="Ticket moyen" value={money.format(avgTicket)} detail="Moyenne par commande" icon={CreditCard} tone="bg-steel" />
        <StatCard label="Produits POS" value={String(data.products.filter((p) => p.pos).length)} detail="Disponibles a la caisse" icon={Utensils} tone="bg-saffron" />
        <StatCard label="Alertes stock" value={String(lowTrackedStock)} detail="Produits suivis sous 25 unites" icon={PackageSearch} tone="bg-coral" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink">Ventes recentes</h2>
            <span className="text-sm text-slate-500">CA et volume</span>
          </div>
          <div className="h-80">
            {salesByDay.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={salesByDay}>
                  <defs>
                    <linearGradient id="revenue" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="5%" stopColor="#4f7c6a" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#4f7c6a" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => `${Number(value) / 1000}k`} />
                  <Tooltip formatter={(value) => money.format(Number(value))} />
                  <Area type="monotone" dataKey="revenue" stroke="#4f7c6a" fill="url(#revenue)" strokeWidth={3} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
            <EmptyState title="Aucune vente" text="Aucune commande trouvee sur cette periode." />
            )}
          </div>
        </section>

        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h2 className="text-lg font-semibold text-ink">Catalogue</h2>
          <div className="mt-4 h-72">
            {pieData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={96} paddingAngle={3}>
                    {pieData.map((_, index) => (
                      <Cell key={index} fill={pieColors[index % pieColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState title="Catalogue vide" text="Aucun produit n'a ete retourne par le serveur." />
            )}
          </div>
          <div className="space-y-2">
            {pieData.slice(0, 5).map((item, index) => (
              <div className="flex items-center justify-between text-sm" key={item.name}>
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: pieColors[index % pieColors.length] }} />
                  {item.name}
                </span>
                <span className="font-semibold">{item.value}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Meilleures marges</h2>
          <span className="text-sm text-slate-500">Top produits</span>
        </div>
        <div className="h-72">
          {topProducts.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topProducts}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="code" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => `${value}%`} />
                <Bar dataKey="margin" fill="#d79b2b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="Pas de produits" text="Connecte un utilisateur qui a acces au catalogue produits." />
          )}
        </div>
      </section>
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center rounded-md border border-dashed border-line bg-slate-50 px-6 text-center">
      <p className="font-semibold text-ink">{title}</p>
      <p className="mt-2 max-w-md text-sm text-slate-500">{text}</p>
    </div>
  );
}

function ExportButtons({ onExcel, onPdf }: { onExcel: () => void; onPdf: () => void }) {
  return (
    <div className="flex gap-2">
      <button className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={onExcel}>
        <FileDown size={17} />
        Excel
      </button>
      <button className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={onPdf}>
        <FileDown size={17} />
        PDF
      </button>
    </div>
  );
}

function ProductsPage({ products }: { products: Product[] }) {
  const [query, setQuery] = useState("");
  const filtered = products.filter((product) => `${product.name} ${product.code} ${product.category}`.toLowerCase().includes(query.toLowerCase()));
  const columns = [
    { header: "Reference", value: (product: Product) => product.code },
    { header: "Nom", value: (product: Product) => product.name },
    { header: "Categorie", value: (product: Product) => product.category },
    { header: "Prix", value: (product: Product) => product.price },
    { header: "Cout", value: (product: Product) => product.cost },
    { header: "Marge", value: (product: Product) => `${product.margin}%` },
    { header: "Stock", value: (product: Product) => product.stock },
    { header: "Caisse", value: (product: Product) => (product.pos ? "Oui" : "Non") },
  ];
  return (
    <section className="rounded-lg border border-line bg-white shadow-soft">
      <div className="flex flex-col gap-4 border-b border-line p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">Produits</h2>
          <p className="text-sm text-slate-500">{filtered.length} produits affiches</p>
        </div>
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
          <input className="h-10 w-full rounded-md border border-line bg-white pl-10 pr-3 outline-none focus:border-sage" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher" />
        </div>
        <ExportButtons onExcel={() => exportExcel("produits", filtered, columns)} onPdf={() => exportPdf("produits", "Produits", filtered, columns)} />
      </div>
      <div className="overflow-x-auto">
        {filtered.length ? (
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">Produit</th>
              <th className="px-5 py-3">Categorie</th>
              <th className="px-5 py-3">Prix</th>
              <th className="px-5 py-3">Cout</th>
              <th className="px-5 py-3">Marge</th>
              <th className="px-5 py-3">Stock</th>
              <th className="px-5 py-3">POS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filtered.map((product) => (
              <tr className="hover:bg-slate-50" key={product.id}>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-md bg-paper text-sage">
                      {product.image ? <img src={product.image} alt="" className="h-full w-full object-cover" /> : <ChefHat size={20} />}
                    </div>
                    <div>
                      <p className="font-semibold text-ink">{product.name}</p>
                      <p className="text-xs text-slate-500">{product.code || "Sans reference"}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3">{product.category}</td>
                <td className="px-5 py-3 font-semibold">{money.format(product.price)}</td>
                <td className="px-5 py-3">{money.format(product.cost)}</td>
                <td className="px-5 py-3">{product.margin}%</td>
                <td className="px-5 py-3">{product.stock}</td>
                <td className="px-5 py-3">{product.pos ? "Oui" : "Non"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        ) : (
          <div className="p-6">
            <EmptyState title="Aucun produit" text="Le serveur n'a retourne aucun produit pour cette recherche." />
          </div>
        )}
      </div>
    </section>
  );
}

function OrdersPage({ orders }: { orders: Order[] }) {
  const columns = [
    { header: "Reference", value: (order: Order) => order.ref },
    { header: "Date", value: (order: Order) => order.date },
    { header: "Client", value: (order: Order) => order.customer },
    { header: "Caissier", value: (order: Order) => order.cashier },
    { header: "Paiement", value: (order: Order) => order.payment },
    { header: "Total", value: (order: Order) => order.total },
    { header: "Statut", value: (order: Order) => order.status },
  ];
  return (
    <section className="rounded-lg border border-line bg-white shadow-soft">
      <div className="flex flex-col gap-4 border-b border-line p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">Commandes</h2>
          <p className="text-sm text-slate-500">Suivi des tickets et paiements</p>
        </div>
        <ExportButtons onExcel={() => exportExcel("commandes", orders, columns)} onPdf={() => exportPdf("commandes", "Commandes", orders, columns)} />
      </div>
      <div className="overflow-x-auto">
        {orders.length ? (
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">Reference</th>
              <th className="px-5 py-3">Date</th>
              <th className="px-5 py-3">Client</th>
              <th className="px-5 py-3">Caissier</th>
              <th className="px-5 py-3">Paiement</th>
              <th className="px-5 py-3">Total</th>
              <th className="px-5 py-3">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {orders.map((order) => (
              <tr className="hover:bg-slate-50" key={order.id}>
                <td className="px-5 py-3 font-semibold">{order.ref}</td>
                <td className="px-5 py-3">{order.date}</td>
                <td className="px-5 py-3">{order.customer}</td>
                <td className="px-5 py-3">{order.cashier}</td>
                <td className="px-5 py-3">{order.payment}</td>
                <td className="px-5 py-3 font-semibold">{money.format(order.total)}</td>
                <td className="px-5 py-3">
                  <StatusPill status={order.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        ) : (
          <div className="p-6">
            <EmptyState title="Aucune commande" text="Les commandes apparaitront ici apres les premieres ventes." />
          </div>
        )}
      </div>
    </section>
  );
}

function StockPage({ products }: { products: Product[] }) {
  const stockRows = [...products].sort((a, b) => a.stock - b.stock).slice(0, 18);
  const columns = [
    { header: "Reference", value: (product: Product) => product.code },
    { header: "Produit", value: (product: Product) => product.name },
    { header: "Categorie", value: (product: Product) => product.category },
    { header: "Stock", value: (product: Product) => product.stock },
    { header: "Prix", value: (product: Product) => product.price },
  ];
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">Niveaux de stock</h2>
            <p className="text-sm text-slate-500">Seuls les produits stockables sont réellement décrémentés.</p>
          </div>
          <ExportButtons onExcel={() => exportExcel("stock", products, columns)} onPdf={() => exportPdf("stock", "Stock", products, columns)} />
        </div>
        <div className="mt-5 h-96">
          {stockRows.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stockRows} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" tickLine={false} axisLine={false} />
                <YAxis dataKey="code" type="category" tickLine={false} axisLine={false} width={86} />
                <Tooltip />
                <Bar dataKey="stock" fill="#3d6272" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="Aucun stock" text="Aucun produit n'a ete charge depuis le serveur." />
          )}
        </div>
      </section>
      <section className="rounded-lg border border-line bg-white shadow-soft">
        <div className="border-b border-line p-5">
          <h2 className="text-lg font-semibold text-ink">Produits a surveiller</h2>
          <p className="text-sm text-slate-500">Priorite aux stocks les plus bas</p>
        </div>
        <div className="divide-y divide-line">
          {stockRows.map((product) => (
            <div className="flex items-center justify-between gap-4 p-4" key={product.id}>
              <div>
                <p className="font-semibold">{product.name}</p>
                <p className="text-sm text-slate-500">{product.code} · {product.category} · {product.tracking === "tracked" ? "suivi" : "non suivi"}</p>
              </div>
              <span className={clsx("rounded-md px-3 py-1 text-sm font-semibold", product.stock < 25 ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-700")}>{product.stock}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function RegisterPage({
  data,
  currentRestaurantId,
  onReload,
  onSessionCreated,
  notify,
}: {
  data: PortalData;
  currentRestaurantId: string;
  onReload: () => Promise<void>;
  onSessionCreated: (sessionId: number) => Promise<void>;
  notify: (type: Toast["type"], message: string) => void;
}) {
  const branchConfigs = useMemo(() => data.posConfigs.filter((config) => config.restaurantId === currentRestaurantId), [currentRestaurantId, data.posConfigs]);
  const availableConfigs = useMemo(() => (branchConfigs.length ? branchConfigs : data.posConfigs), [branchConfigs, data.posConfigs]);
  const [configId, setConfigId] = useState(String(availableConfigs[0]?.id || ""));
  const [sessionId, setSessionId] = useState(String(availableConfigs[0]?.currentSessionId || ""));
  const [countedCash, setCountedCash] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedConfig = availableConfigs.find((config) => config.id === Number(configId)) || availableConfigs[0];
  const activeSessionId = sessionId || String(selectedConfig?.currentSessionId || "");
  const hasSession = Boolean(activeSessionId);
  const today = new Date().toISOString().slice(0, 10);
  const todayOrders = data.orders.filter((order) => order.date === today);
  const todayRevenue = todayOrders.reduce((sum, order) => sum + order.total, 0);
  const currentSession = data.posSessions.find((session) => session.id === Number(activeSessionId));

  async function ensureSession() {
    const activeConfigId = Number(configId || selectedConfig?.id);
    if (!activeConfigId) {
      throw new Error("Aucune caisse n'est configuree pour cette succursale.");
    }
    if (activeSessionId) {
      return Number(activeSessionId);
    }
    await assignBackendPosConfigToRestaurant(activeConfigId, currentRestaurantId);
    const nextSessionId = await startPosSession(activeConfigId);
    await onSessionCreated(nextSessionId);
    setSessionId(String(nextSessionId));
    return nextSessionId;
  }

  async function openNativePos() {
    setBusy(true);
    setStatus("");
    try {
      const activeConfigId = Number(configId || selectedConfig?.id);
      if (!activeConfigId) {
        throw new Error("Aucune caisse n'est configuree pour cette succursale.");
      }
      const nextSessionId = await ensureSession();
      await onReload();
      window.open(buildNativePosUrl(activeConfigId), "_blank", "noopener,noreferrer");
      setStatus(`POS natif ouvert pour la session ${nextSessionId}.`);
      notify("success", "POS natif ouvert dans un nouvel onglet.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Impossible d'ouvrir le POS natif.";
      setStatus(message);
      notify("error", message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshSession() {
    setBusy(true);
    setStatus("");
    try {
      await onReload();
      setStatus("Statut de caisse actualise.");
      notify("success", "Statut de caisse actualise.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Actualisation impossible.";
      setStatus(message);
      notify("error", message);
    } finally {
      setBusy(false);
    }
  }

  async function closeSession() {
    setBusy(true);
    setStatus("");
    try {
      if (!activeSessionId) {
        throw new Error("Aucune session ouverte a fermer.");
      }
      const confirmed = window.confirm("Confirmer la fermeture de la session de caisse ? Cette action cloture la caisse dans le backend.");
      if (!confirmed) return;
      await closePosSession(Number(activeSessionId), countedCash === "" ? undefined : Number(countedCash));
      setSessionId("");
      setCountedCash("");
      await onReload();
      setStatus("Session fermee avec succes.");
      notify("success", "Session fermee avec succes.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Impossible de fermer la session.";
      setStatus(message);
      notify("error", message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-sage/30 bg-emerald-50 p-5 shadow-soft">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-wide text-sage">POS natif</p>
            <h2 className="mt-1 text-2xl font-semibold text-ink">Caisse de la succursale</h2>
            <p className="mt-2 text-sm text-slate-600">
              Les ventes, paiements, tickets, tables et impressions se font maintenant dans le POS natif. Le portail sert de poste de pilotage et ouvre la bonne caisse pour la succursale selectionnee.
            </p>
          </div>
          <button
            className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-sage px-5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
            disabled={busy || !availableConfigs.length}
            onClick={openNativePos}
          >
            {busy ? <ButtonSpinner /> : <ExternalLink size={19} />}
            Ouvrir le POS
          </button>
        </div>
        {!branchConfigs.length && availableConfigs.length ? (
          <p className="mt-4 rounded-md bg-white/70 px-3 py-2 text-sm text-amber-700">
            Aucune caisse n'est encore rattachee directement a cette succursale. Le portail utilise la premiere caisse disponible.
          </p>
        ) : null}
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Session" value={hasSession ? "Ouverte" : "Fermee"} detail={currentSession?.name || selectedConfig?.name || "Aucune caisse selectionnee"} icon={PlayCircle} tone={hasSession ? "bg-sage" : "bg-saffron"} />
        <StatCard label="Ventes du jour" value={String(todayOrders.length)} detail="Tickets enregistres aujourd'hui" icon={ShoppingBag} tone="bg-steel" />
        <StatCard label="CA du jour" value={money.format(todayRevenue)} detail="Total des commandes du jour" icon={BadgeDollarSign} tone="bg-coral" />
      </div>

      <section className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Configuration de caisse</h2>
              <p className="text-sm text-slate-500">Choisis la caisse de la succursale puis ouvre le POS natif.</p>
            </div>
            <span className={clsx("rounded-full px-3 py-1 text-xs font-semibold", hasSession ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>{hasSession ? "Session ouverte" : "Session fermee"}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <select
              className={selectClass()}
              value={selectedConfig ? String(selectedConfig.id) : ""}
              onChange={(event) => {
                const nextConfig = availableConfigs.find((config) => config.id === Number(event.target.value));
                setConfigId(event.target.value);
                setSessionId(String(nextConfig?.currentSessionId || ""));
              }}
            >
              {availableConfigs.map((config) => (
                <option value={config.id} key={config.id}>
                  {config.name}
                </option>
              ))}
            </select>
            <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60" disabled={busy} onClick={refreshSession}>
              <RefreshCcw size={17} />
              Actualiser
            </button>
            <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60" disabled={busy || !availableConfigs.length} onClick={openNativePos}>
              {busy ? <ButtonSpinner /> : <ExternalLink size={17} />}
              Ouvrir
            </button>
          </div>
          {status ? <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm font-medium text-ink">{status}</p> : null}
        </div>

        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h2 className="text-lg font-semibold text-ink">Fermeture de session</h2>
          <p className="mt-1 text-sm text-slate-500">La fermeture reste disponible ici, mais la cloture complete peut aussi se faire depuis le POS natif.</p>
          <div className="mt-4 grid gap-3">
            <input className={inputClass()} type="number" value={countedCash} onChange={(event) => setCountedCash(event.target.value)} placeholder="Fond reel compte a la fermeture" />
            <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60" disabled={busy || !activeSessionId} onClick={closeSession}>
              {busy ? <ButtonSpinner /> : <LogOut size={17} />}
              Fermer la session
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white shadow-soft">
        <div className="border-b border-line p-5">
          <h2 className="text-lg font-semibold text-ink">Dernieres ventes de la succursale</h2>
          <p className="text-sm text-slate-500">Les tickets sont crees par le POS natif et remontent ici pour le suivi.</p>
        </div>
        <div className="divide-y divide-line">
          {data.orders.slice(0, 8).map((order) => (
            <div className="grid gap-2 p-4 text-sm md:grid-cols-[1fr_1fr_auto] md:items-center" key={order.id}>
              <div>
                <p className="font-semibold text-ink">{order.ref}</p>
                <p className="text-slate-500">{order.date} · {order.cashier}</p>
              </div>
              <p className="text-slate-600">{order.customer}</p>
              <p className="font-semibold text-sage">{money.format(order.total)}</p>
            </div>
          ))}
          {!data.orders.length ? <EmptyState title="Aucune vente" text="Les ventes apparaitront ici apres utilisation du POS natif." /> : null}
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2 text-sm font-medium text-ink">
      {label}
      {children}
    </label>
  );
}

function inputClass() {
  return "h-10 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-sage";
}

function selectClass() {
  return "h-10 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-sage";
}

function ActionsPage({
  data,
  currentRestaurantId,
  onReload,
  onSessionCreated,
  onProductCreated,
  notify,
}: {
  data: PortalData;
  onReload: () => Promise<void>;
  currentRestaurantId: string;
  onSessionCreated: (sessionId: number) => Promise<void>;
  onProductCreated: (productId: number) => Promise<void>;
  notify: (type: Toast["type"], message: string) => void;
}) {
  const [busyAction, setBusyAction] = useState("");
  const [message, setMessage] = useState("");
  const [productCategoryName, setProductCategoryName] = useState("");
  const [posCategoryName, setPosCategoryName] = useState("");
  const [sessionConfigId, setSessionConfigId] = useState(String(data.posConfigs[0]?.id || ""));
  const [newProduct, setNewProduct] = useState({
    name: "",
    code: "",
    price: "0",
    cost: "0",
    productCategoryId: String(data.productCategories[0]?.id || ""),
    posCategoryId: String(data.posCategories[0]?.id || ""),
    availableInPos: true,
    detailedType: "consu" as "consu" | "product",
  });
  const [editProduct, setEditProduct] = useState({
    productId: String(data.products[0]?.id || ""),
    price: "",
    availableInPos: true,
  });
  const [stockAdjust, setStockAdjust] = useState({
    productId: String(data.products[0]?.id || ""),
    quantity: "0",
  });

  async function run(label: string, action: () => Promise<void>) {
    setBusyAction(label);
    setMessage("");
    try {
      await action();
      await onReload();
      setMessage(`${label}: action terminee.`);
      notify("success", `${label}: action terminee.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Action impossible.";
      setMessage(message);
      notify("error", message);
    } finally {
      setBusyAction("");
    }
  }

  const selectedStockProduct = data.products.find((product) => product.id === Number(stockAdjust.productId));

  return (
    <div className="space-y-6">
      {message ? <div className="rounded-md border border-line bg-white px-4 py-3 text-sm font-medium text-ink shadow-soft">{message}</div> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="mb-5 flex items-center gap-3">
            <PlayCircle className="text-sage" size={22} />
            <h2 className="text-lg font-semibold text-ink">Session POS</h2>
          </div>
          <div className="grid gap-4">
            <Field label="Point de vente">
              <select className={selectClass()} value={sessionConfigId} onChange={(event) => setSessionConfigId(event.target.value)}>
                {data.posConfigs.map((config) => (
                  <option value={config.id} key={config.id}>
                    {config.name} {config.currentSessionState ? `- ${config.currentSessionState}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
              disabled={!sessionConfigId || busyAction !== ""}
              onClick={() =>
                run("Demarrer session POS", async () => {
                  const sessionId = await startPosSession(Number(sessionConfigId));
                  await onSessionCreated(sessionId);
                })
              }
            >
              <PlayCircle size={17} />
              Demarrer une session
            </button>
          </div>
          <div className="mt-5 divide-y divide-line rounded-md border border-line">
            {data.posSessions.slice(0, 5).map((session) => (
              <div className="flex items-center justify-between gap-4 p-3 text-sm" key={session.id}>
                <div>
                  <p className="font-semibold">{session.name}</p>
                  <p className="text-slate-500">{session.config}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{session.state}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="mb-5 flex items-center gap-3">
            <Boxes className="text-sage" size={22} />
            <h2 className="text-lg font-semibold text-ink">Categories</h2>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="grid gap-3">
              <Field label="Categorie produit">
                <input className={inputClass()} value={productCategoryName} onChange={(event) => setProductCategoryName(event.target.value)} placeholder="Ex: Restaurant / Sauces" />
              </Field>
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-sage px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                disabled={!productCategoryName.trim() || busyAction !== ""}
                onClick={() =>
                  run("Creer categorie produit", async () => {
                    await createProductCategory({ name: productCategoryName.trim() });
                    setProductCategoryName("");
                  })
                }
              >
                <Plus size={17} />
                Ajouter
              </button>
            </div>
            <div className="grid gap-3">
              <Field label="Categorie POS">
                <input className={inputClass()} value={posCategoryName} onChange={(event) => setPosCategoryName(event.target.value)} placeholder="Ex: Grillades" />
              </Field>
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-steel px-4 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
                disabled={!posCategoryName.trim() || busyAction !== ""}
                onClick={() =>
                  run("Creer categorie POS", async () => {
                    await createPosCategory({ name: posCategoryName.trim() });
                    setPosCategoryName("");
                  })
                }
              >
                <Plus size={17} />
                Ajouter
              </button>
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
        <div className="mb-5 flex items-center gap-3">
          <ShoppingBag className="text-sage" size={22} />
          <h2 className="text-lg font-semibold text-ink">Ajouter un produit</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Nom">
            <input className={inputClass()} value={newProduct.name} onChange={(event) => setNewProduct({ ...newProduct, name: event.target.value })} />
          </Field>
          <Field label="Reference">
            <input className={inputClass()} value={newProduct.code} onChange={(event) => setNewProduct({ ...newProduct, code: event.target.value })} />
          </Field>
          <Field label="Prix de vente">
            <input className={inputClass()} type="number" value={newProduct.price} onChange={(event) => setNewProduct({ ...newProduct, price: event.target.value })} />
          </Field>
          <Field label="Cout">
            <input className={inputClass()} type="number" value={newProduct.cost} onChange={(event) => setNewProduct({ ...newProduct, cost: event.target.value })} />
          </Field>
          <Field label="Categorie produit">
            <select className={selectClass()} value={newProduct.productCategoryId} onChange={(event) => setNewProduct({ ...newProduct, productCategoryId: event.target.value })}>
              {data.productCategories.map((category) => (
                <option value={category.id} key={category.id}>
                  {category.completeName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Categorie POS">
            <select className={selectClass()} value={newProduct.posCategoryId} onChange={(event) => setNewProduct({ ...newProduct, posCategoryId: event.target.value })}>
              <option value="">Aucune</option>
              {data.posCategories.map((category) => (
                <option value={category.id} key={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select className={selectClass()} value={newProduct.detailedType} onChange={(event) => setNewProduct({ ...newProduct, detailedType: event.target.value as "consu" | "product" })}>
              <option value="consu">Consommable</option>
              <option value="product">Stockable</option>
            </select>
          </Field>
          <label className="flex items-center gap-3 self-end rounded-md border border-line px-3 py-2 text-sm font-medium">
            <input type="checkbox" checked={newProduct.availableInPos} onChange={(event) => setNewProduct({ ...newProduct, availableInPos: event.target.checked })} />
            Disponible POS
          </label>
        </div>
        <button
          className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
          disabled={!newProduct.name.trim() || !newProduct.productCategoryId || busyAction !== ""}
          onClick={() =>
            run("Creer produit", async () => {
              const productId = await createProduct({
                name: newProduct.name.trim(),
                code: newProduct.code.trim(),
                price: Number(newProduct.price),
                cost: Number(newProduct.cost),
                productCategoryId: Number(newProduct.productCategoryId),
                posCategoryId: newProduct.posCategoryId ? Number(newProduct.posCategoryId) : undefined,
                availableInPos: newProduct.availableInPos,
                detailedType: newProduct.detailedType,
                restaurantExternalKey: currentRestaurantId,
              });
              await onProductCreated(productId);
              setNewProduct({ ...newProduct, name: "", code: "", price: "0", cost: "0" });
            })
          }
        >
          <Save size={17} />
          Enregistrer le produit
        </button>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h2 className="text-lg font-semibold text-ink">Modifier un produit</h2>
          <div className="mt-5 grid gap-4">
            <Field label="Produit">
              <select className={selectClass()} value={editProduct.productId} onChange={(event) => setEditProduct({ ...editProduct, productId: event.target.value })}>
                {data.products.map((product) => (
                  <option value={product.id} key={product.id}>
                    {product.code} - {product.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Nouveau prix">
              <input className={inputClass()} type="number" value={editProduct.price} onChange={(event) => setEditProduct({ ...editProduct, price: event.target.value })} />
            </Field>
            <label className="flex items-center gap-3 rounded-md border border-line px-3 py-2 text-sm font-medium">
              <input type="checkbox" checked={editProduct.availableInPos} onChange={(event) => setEditProduct({ ...editProduct, availableInPos: event.target.checked })} />
              Visible au POS
            </label>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
              disabled={!editProduct.productId || busyAction !== ""}
              onClick={() =>
                run("Modifier produit", async () => {
                  await updateProduct(Number(editProduct.productId), {
                    price: editProduct.price === "" ? undefined : Number(editProduct.price),
                    availableInPos: editProduct.availableInPos,
                  });
                })
              }
            >
              <Save size={17} />
              Appliquer
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <h2 className="text-lg font-semibold text-ink">Ajuster le stock</h2>
          <div className="mt-5 grid gap-4">
            <Field label="Produit">
              <select className={selectClass()} value={stockAdjust.productId} onChange={(event) => setStockAdjust({ ...stockAdjust, productId: event.target.value })}>
                {data.products.map((product) => (
                  <option value={product.id} key={product.id}>
                    {product.code} - {product.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quantite reelle">
              <input className={inputClass()} type="number" value={stockAdjust.quantity} onChange={(event) => setStockAdjust({ ...stockAdjust, quantity: event.target.value })} />
            </Field>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              disabled={!selectedStockProduct?.variantId || busyAction !== ""}
              onClick={() =>
                run("Ajuster stock", async () => {
                  if (!selectedStockProduct?.variantId) {
                    throw new Error("Produit sans variante stockable.");
                  }
                  await adjustProductStock(selectedStockProduct.variantId, Number(stockAdjust.quantity));
                })
              }
            >
              <Save size={17} />
              Valider le stock
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function SettingsPage({
  restaurants,
  users,
  currentUser,
  currentRestaurantId,
  onSave,
  onSaveUsers,
  onSelect,
  notify,
}: {
  restaurants: RestaurantProfile[];
  users: PortalUser[];
  currentUser: PortalUser;
  currentRestaurantId: string;
  onSave: (restaurants: RestaurantProfile[]) => Promise<void>;
  onSaveUsers: (users: PortalUser[]) => Promise<void>;
  onSelect: (id: string) => Promise<void>;
  notify: (type: Toast["type"], message: string) => void;
}) {
  const current = restaurants.find((restaurant) => restaurant.id === currentRestaurantId) || restaurants[0];
  const [draft, setDraft] = useState<RestaurantProfile>(current);
  const [userDrafts, setUserDrafts] = useState<PortalUser[]>(users);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);

  async function refreshAudit() {
    try {
      const rows = await loadAuditRows();
      setAuditRows(rows.slice(-8).reverse());
    } catch {
      setAuditRows([]);
    }
  }

  function updateDraft(values: Partial<RestaurantProfile>) {
    setDraft((previous) => ({ ...previous, ...values }));
  }

  async function saveCurrent() {
    const next = restaurants.map((restaurant) => (restaurant.id === draft.id ? draft : restaurant));
    await onSave(next);
    await refreshAudit();
    notify("success", "Informations du restaurant mises a jour.");
  }

  async function addRestaurant(parentId = "") {
    const nextRestaurant: RestaurantProfile = {
      id: createLocalId("restaurant"),
      name: parentId ? "Nouvelle succursale" : "Nouveau restaurant",
      legalName: "",
      phone: "",
      email: "",
      address: "",
      city: "",
      taxId: "",
      parentId,
      manager: "",
      active: true,
    };
    const next = [...restaurants, nextRestaurant];
    await onSave(next);
    await onSelect(nextRestaurant.id);
    await refreshAudit();
    notify("success", parentId ? "Succursale ajoutee." : "Restaurant ajoute.");
  }

  async function toggleRestaurant(id: string) {
    const next = restaurants.map((restaurant) => (restaurant.id === id ? { ...restaurant, active: !restaurant.active } : restaurant));
    await onSave(next);
    await refreshAudit();
    notify("success", "Statut du restaurant mis a jour.");
  }

  async function deleteRestaurant(id: string) {
    const restaurant = restaurants.find((item) => item.id === id);
    if (!restaurant) return;
    const deleteCheck = canDeleteBranch(restaurants, id);
    if (!deleteCheck.allowed) {
      notify("error", deleteCheck.reason || "Suppression impossible.");
      return;
    }
    const confirmed = window.confirm(`Supprimer ${restaurant.name} ?`);
    if (!confirmed) return;

    const fallbackId = restaurant.parentId || restaurants.find((item) => item.id !== id)?.id || defaultRestaurants[0].id;
    await onSave(restaurants.filter((item) => item.id !== id));
    await onSelect(fallbackId);
    await refreshAudit();
    notify("success", "Succursale supprimee.");
  }

  const children = restaurants.filter((restaurant) => restaurant.parentId === draft.id);
  const parents = getEligibleParents(restaurants, draft.id);

  function updateUser(id: string, values: Partial<PortalUser>) {
    setUserDrafts((currentUsers) => currentUsers.map((user) => (user.id === id ? { ...user, ...values } : user)));
  }

  function toggleUserRestaurant(id: string, restaurantId: string) {
    setUserDrafts((currentUsers) =>
      currentUsers.map((user) => {
        if (user.id !== id) return user;
        const exists = user.restaurantIds.includes(restaurantId);
        return {
          ...user,
          restaurantIds: exists ? user.restaurantIds.filter((item) => item !== restaurantId) : [...user.restaurantIds, restaurantId],
        };
      }),
    );
  }

  async function addUser() {
    const nextUser: PortalUser = {
      id: createLocalId("user"),
      name: "Nouvel utilisateur",
      login: "",
      role: "cashier",
      restaurantIds: [currentRestaurantId],
      active: true,
    };
    const next = [...userDrafts, nextUser];
    setUserDrafts(next);
    await onSaveUsers(next);
    await refreshAudit();
    notify("success", "Utilisateur ajoute.");
  }

  async function saveUsers() {
    await onSaveUsers(userDrafts);
    await refreshAudit();
    notify("success", "Utilisateurs et acces mis a jour.");
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[0.9fr_1.4fr]">
      <section className="rounded-lg border border-line bg-white shadow-soft">
        <div className="border-b border-line p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Restaurants</h2>
              <p className="text-sm text-slate-500">Vue super admin multi-sites</p>
            </div>
            <button className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-slate-700" onClick={() => addRestaurant()}>
              <Plus size={17} />
              Ajouter
            </button>
          </div>
        </div>
        <div className="divide-y divide-line">
          {restaurants.map((restaurant) => {
            const parent = restaurants.find((item) => item.id === restaurant.parentId);
            return (
              <div
                key={restaurant.id}
                className={clsx("flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-slate-50", restaurant.id === currentRestaurantId && "bg-emerald-50")}
              >
                <button className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => onSelect(restaurant.id)}>
                  <div className="mt-1 flex h-9 w-9 items-center justify-center rounded-md bg-paper text-sage">
                    <Store size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{restaurant.name}</p>
                    <p className="text-sm text-slate-500">{parent ? `Parent: ${parent.name}` : "Restaurant parent"}</p>
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={clsx("rounded-full px-2.5 py-1 text-xs font-semibold", restaurant.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                    {restaurant.active ? "Actif" : "Inactif"}
                  </span>
                  {restaurant.parentId ? (
                    <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-rose-200 px-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-50" onClick={() => deleteRestaurant(restaurant.id)}>
                      <Trash2 size={14} />
                      Supprimer
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-6">
        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-ink">Informations du restaurant</h2>
              <p className="text-sm text-slate-500">Nom, contact, adresse, statut et rattachement</p>
            </div>
            <button className="inline-flex h-10 items-center gap-2 rounded-md bg-sage px-4 text-sm font-semibold text-white hover:bg-emerald-800" onClick={saveCurrent}>
              <Save size={17} />
              Enregistrer
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nom commercial">
              <input className={inputClass()} value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} />
            </Field>
            <Field label="Raison sociale">
              <input className={inputClass()} value={draft.legalName} onChange={(event) => updateDraft({ legalName: event.target.value })} />
            </Field>
            <Field label="Telephone">
              <input className={inputClass()} value={draft.phone} onChange={(event) => updateDraft({ phone: event.target.value })} />
            </Field>
            <Field label="Email">
              <input className={inputClass()} type="email" value={draft.email} onChange={(event) => updateDraft({ email: event.target.value })} />
            </Field>
            <Field label="Ville">
              <input className={inputClass()} value={draft.city} onChange={(event) => updateDraft({ city: event.target.value })} />
            </Field>
            <Field label="Identifiant fiscal">
              <input className={inputClass()} value={draft.taxId} onChange={(event) => updateDraft({ taxId: event.target.value })} />
            </Field>
            <Field label="Responsable">
              <input className={inputClass()} value={draft.manager} onChange={(event) => updateDraft({ manager: event.target.value })} />
            </Field>
            <Field label="Restaurant parent">
              <select className={selectClass()} value={draft.parentId} onChange={(event) => updateDraft({ parentId: event.target.value })}>
                <option value="">Aucun parent</option>
                {parents.map((restaurant) => (
                  <option key={restaurant.id} value={restaurant.id}>
                    {restaurant.name}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-3 rounded-md border border-line px-3 py-2 text-sm font-medium">
              <input type="checkbox" checked={draft.active} onChange={(event) => updateDraft({ active: event.target.checked })} />
              Restaurant actif
            </label>
            <Field label="Adresse">
              <input className={inputClass()} value={draft.address} onChange={(event) => updateDraft({ address: event.target.value })} />
            </Field>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Restaurants rattaches</h2>
              <p className="text-sm text-slate-500">Succursales ou petits restaurants geres par ce parent</p>
            </div>
            <button className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => addRestaurant(draft.id)}>
              <Plus size={17} />
              Succursale
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {children.length ? (
              children.map((child) => (
                <div className="rounded-md border border-line p-4" key={child.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{child.name}</p>
                      <p className="text-sm text-slate-500">{child.city || "Ville non renseignee"}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button className="rounded-md border border-line px-3 py-1 text-xs font-semibold text-slate-700" onClick={() => toggleRestaurant(child.id)}>
                        {child.active ? "Desactiver" : "Activer"}
                      </button>
                      <button className="inline-flex h-8 items-center gap-1.5 rounded-md border border-rose-200 px-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-50" onClick={() => deleteRestaurant(child.id)}>
                        <Trash2 size={15} />
                        Supprimer
                      </button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState title="Aucune succursale" text="Ajoute un restaurant rattache pour gerer un reseau dans la ville." />
            )}
          </div>
        </div>

        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Utilisateurs et acces</h2>
              <p className="text-sm text-slate-500">Utilisateur courant: {currentUser.name} - {roleLabels[currentUser.role]}</p>
            </div>
            <div className="flex gap-2">
              <button className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={addUser}>
                <Plus size={17} />
                Utilisateur
              </button>
              <button className="inline-flex h-10 items-center gap-2 rounded-md bg-sage px-4 text-sm font-semibold text-white hover:bg-emerald-800" onClick={saveUsers}>
                <Save size={17} />
                Enregistrer
              </button>
            </div>
          </div>
          <div className="grid gap-3">
            {userDrafts.map((user) => (
              <div className="grid gap-3 rounded-md border border-line p-4 md:grid-cols-[1fr_1fr_1fr_auto]" key={user.id}>
                <input className={inputClass()} value={user.name} onChange={(event) => updateUser(user.id, { name: event.target.value })} placeholder="Nom" />
                <input className={inputClass()} value={user.login} onChange={(event) => updateUser(user.id, { login: event.target.value })} placeholder="Login" />
                <select className={selectClass()} value={user.role} onChange={(event) => updateUser(user.id, { role: event.target.value as UserRole })}>
                  {Object.entries(roleLabels).map(([role, label]) => (
                    <option key={role} value={role}>{label}</option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={user.active} onChange={(event) => updateUser(user.id, { active: event.target.checked })} />
                  Actif
                </label>
                <div className="grid gap-2 rounded-md bg-paper p-3 md:col-span-4">
                  <p className="text-xs font-semibold uppercase text-slate-500">Restaurants autorises</p>
                  <div className="grid gap-2 md:grid-cols-2">
                    {restaurants.map((restaurant) => (
                      <label className={clsx("flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm", user.role === "super_admin" && "opacity-60")} key={restaurant.id}>
                        <input type="checkbox" checked={user.role === "super_admin" || user.restaurantIds.includes(restaurant.id)} disabled={user.role === "super_admin"} onChange={() => toggleUserRestaurant(user.id, restaurant.id)} />
                        {restaurant.name}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-line bg-white p-5 shadow-soft">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Journal d'audit</h2>
              <p className="text-sm text-slate-500">Qui a fait quoi, ou et quand</p>
            </div>
            <button className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={refreshAudit}>
              <RefreshCcw size={17} />
              Actualiser
            </button>
          </div>
          <div className="divide-y divide-line rounded-md border border-line">
            {auditRows.length ? (
              auditRows.map((row, index) => {
                const restaurant = restaurants.find((item) => item.id === row.restaurantId);
                return (
                  <div className="grid gap-1 p-3 text-sm md:grid-cols-[1fr_1fr_1fr]" key={`${row.at}-${index}`}>
                    <p className="font-semibold text-ink">{row.event}</p>
                    <p className="text-slate-600">{row.actor?.name || "Systeme"} - {restaurant?.name || row.restaurantId || "Restaurant"}</p>
                    <p className="text-slate-500">{new Date(row.at).toLocaleString("fr-FR")}</p>
                  </div>
                );
              })
            ) : (
              <EmptyState title="Aucun audit charge" text="Clique sur Actualiser pour consulter les derniers evenements." />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function LoginPage({ onLoad, loading, error }: { onLoad: (config: AuthConfig) => void; loading: boolean; error: string }) {
  const [config, setConfig] = useState<AuthConfig>({ login: "admin", password: "" });
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper p-4">
    <section className="w-full max-w-md rounded-lg border border-line bg-white p-6 shadow-soft">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-sage text-white">
          <LogIn size={22} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-ink">Resto Pilot</h1>
          <p className="text-sm text-slate-500">Connexion obligatoire</p>
        </div>
      </div>
      <div className="grid gap-4">
        <label className="grid gap-2 text-sm font-medium">
          Identifiant
          <input className="h-11 rounded-md border border-line px-3 outline-none focus:border-sage" value={config.login} onChange={(e) => setConfig({ ...config, login: e.target.value })} />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Mot de passe
          <input className="h-11 rounded-md border border-line px-3 outline-none focus:border-sage" type="password" value={config.password} onChange={(e) => setConfig({ ...config, password: e.target.value })} />
        </label>
      </div>
      {error ? <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      <button className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-4 font-semibold text-white hover:bg-slate-700 disabled:opacity-60" disabled={loading} onClick={() => onLoad(config)}>
        {loading ? <ButtonSpinner /> : <RefreshCcw size={18} />}
        {loading ? "Connexion..." : "Se connecter"}
      </button>
    </section>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>("register");
  const [data, setData] = useState<PortalData | null>(null);
  const [restaurants, setRestaurants] = useState<RestaurantProfile[]>(defaultRestaurants);
  const [currentRestaurantId, setCurrentRestaurantId] = useState(defaultRestaurants[0].id);
  const [assignments, setAssignments] = useState<PortalAssignments>({ products: {}, orders: {}, sessions: {} });
  const [users, setUsers] = useState<PortalUser[]>(defaultUsers);
  const [currentUser, setCurrentUser] = useState<PortalUser>(defaultUsers[0]);
  const [userLabel, setUserLabel] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const activePage = canAccessPage(currentUser, page) ? page : rolePages[currentUser.role]?.[0] || "dashboard";
  const title = useMemo(() => navItems.find((item) => item.id === activePage)?.label || "Portail", [activePage]);
  const currentRestaurant = useMemo(() => restaurants.find((restaurant) => restaurant.id === currentRestaurantId) || restaurants[0], [currentRestaurantId, restaurants]);

  const notify = useCallback((type: Toast["type"], message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, type, message }].slice(-4));
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4500);
  }, []);

  const activateAndLoadPortalSettings = useCallback(async (login: string) => {
    const settings = await activatePortalUser(login);
    await syncBackendRestaurants(settings.restaurants);
    setRestaurants(settings.restaurants);
    setCurrentRestaurantId(settings.currentRestaurantId);
    setAssignments(settings.assignments);
    setUsers(settings.users);
    setCurrentUser(settings.currentUser);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      try {
        const session = await getActiveSession();
        if (!session || cancelled) return;
        const nextData = await loadBusinessData();
        if (cancelled) return;
        await activateAndLoadPortalSettings(session.username || session.name || "admin");
        if (cancelled) return;
        setData(nextData);
        setUserLabel(session.name || session.username || "Utilisateur");
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setCheckingSession(false);
      }
    }
    restoreSession();
    return () => {
      cancelled = true;
    };
  }, [activateAndLoadPortalSettings]);

  async function handleLoad(config: AuthConfig) {
    setLoading(true);
    setError("");
    try {
      const nextData = await loadBusinessData(config);
      await activateAndLoadPortalSettings(config.login);
      setData(nextData);
      setUserLabel(config.login);
      setPage("register");
      notify("success", "Connexion reussie.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connexion impossible";
      setError(message);
      notify("error", message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await destroySession();
    } catch {
      // The local UI still clears its state even if the server session is already gone.
    }
    setData(null);
    setUserLabel("");
    setError("");
    setPage("register");
    notify("info", "Session fermee.");
  }

  async function handleSaveRestaurants(nextRestaurants: RestaurantProfile[]) {
    const cleanRestaurants = nextRestaurants.length ? nextRestaurants : defaultRestaurants;
    try {
      const settings = await saveRestaurantSettings(cleanRestaurants);
      await syncBackendRestaurants(settings.restaurants);
      setRestaurants(settings.restaurants);
      setCurrentRestaurantId(settings.currentRestaurantId);
      setAssignments(settings.assignments);
      setUsers(settings.users);
      setCurrentUser(settings.currentUser);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sauvegarde restaurant impossible.";
      notify("error", message);
      throw err;
    }

  }

  async function handleSelectRestaurant(id: string) {
    try {
      const settings = await selectCurrentRestaurant(id);
      setRestaurants(settings.restaurants);
      setCurrentRestaurantId(settings.currentRestaurantId);
      setAssignments(settings.assignments);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Selection restaurant impossible.";
      notify("error", message);
    }
  }

  async function reloadCurrentData() {
    setLoading(true);
    try {
      const nextData = await loadBusinessData();
      setData(nextData);
      notify("success", "Donnees actualisees.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Actualisation impossible.";
      notify("error", message);
    } finally {
      setLoading(false);
    }
  }

  async function recordProductRestaurant(productId: number) {
    await assignBackendProductToRestaurant(productId, currentRestaurantId);
    const settings = await assignProductToRestaurant(productId, currentRestaurantId);
    setAssignments(settings.assignments);
  }

  async function recordSessionRestaurant(sessionId: number) {
    await assignBackendSessionToRestaurant(sessionId, currentRestaurantId);
    const settings = await assignSessionToRestaurant(sessionId, currentRestaurantId);
    setAssignments(settings.assignments);
  }

  async function handleSaveUsers(nextUsers: PortalUser[]) {
    const settings = await savePortalUsers(nextUsers);
    await syncBackendUsers(settings.users);
    setUsers(settings.users);
    setCurrentUser(settings.currentUser);
  }

  const scopedData = data ? filterPortalDataByRestaurant(data, restaurants, currentRestaurantId, assignments) : null;
  const visibleNavItems = navItems.filter((item) => canAccessPage(currentUser, item.id));

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper p-4">
        <div className="rounded-lg border border-line bg-white px-5 py-4 text-sm font-semibold text-ink shadow-soft">Verification de la session...</div>
      </div>
    );
  }

  if (!data || !scopedData) {
    return (
      <>
        <ToastStack toasts={toasts} onClose={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
        <LoadingOverlay show={loading} label="Connexion en cours..." />
        <LoginPage onLoad={handleLoad} loading={loading} error={error} />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-paper">
      <ToastStack toasts={toasts} onClose={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
      <LoadingOverlay show={loading} label="Traitement en cours..." />
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-line bg-white px-4 py-5 lg:block">
        <div className="flex items-center gap-3 px-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-md bg-ink text-white">
            <ChefHat size={24} />
          </div>
          <div>
            <p className="font-semibold text-ink">Resto Pilot</p>
            <p className="text-xs text-slate-500">Restaurant</p>
          </div>
        </div>
        <nav className="mt-8 space-y-1">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} onClick={() => setPage(item.id)} className={clsx("flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-semibold", activePage === item.id ? "bg-ink text-white" : "text-slate-600 hover:bg-slate-100")}>
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="lg:pl-72">
        <header className="sticky top-0 z-10 border-b border-line bg-paper/95 px-4 py-4 backdrop-blur md:px-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-sage">Connecte · {userLabel} · {roleLabels[currentUser.role]}{currentRestaurant ? ` · ${currentRestaurant.name}` : ""}</p>
              <h1 className="text-2xl font-semibold text-ink">{title}</h1>
            </div>
            <div className="hidden gap-2 md:flex">
              <button className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50" disabled={loading} onClick={reloadCurrentData}>
                <RefreshCcw size={17} />
                Actualiser
              </button>
              <button className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-slate-700" onClick={handleLogout}>
                <LogOut size={17} />
                Quitter
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto lg:hidden">
              {visibleNavItems.map((item) => (
                <button key={item.id} onClick={() => setPage(item.id)} className={clsx("h-10 shrink-0 rounded-md px-3 text-sm font-semibold", activePage === item.id ? "bg-ink text-white" : "bg-white text-slate-600")}>{item.label}</button>
              ))}
            </div>
          </div>
        </header>
        <div className="p-4 md:p-8">
          {activePage === "dashboard" && <Dashboard data={scopedData} />}
          {activePage === "register" && <RegisterPage data={scopedData} currentRestaurantId={currentRestaurantId} onReload={reloadCurrentData} onSessionCreated={recordSessionRestaurant} notify={notify} />}
          {activePage === "products" && <ProductsPage products={scopedData.products} />}
          {activePage === "orders" && <OrdersPage orders={scopedData.orders} />}
          {activePage === "stock" && <StockPage products={scopedData.products} />}
          {activePage === "actions" && <ActionsPage data={scopedData} currentRestaurantId={currentRestaurantId} onReload={reloadCurrentData} onSessionCreated={recordSessionRestaurant} onProductCreated={recordProductRestaurant} notify={notify} />}
          {activePage === "settings" && <SettingsPage key={currentRestaurant?.id || "settings"} restaurants={restaurants} users={users} currentUser={currentUser} currentRestaurantId={currentRestaurant?.id || ""} onSave={handleSaveRestaurants} onSaveUsers={handleSaveUsers} onSelect={handleSelectRestaurant} notify={notify} />}
        </div>
      </main>
    </div>
  );
}
