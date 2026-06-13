import "dotenv/config";
import cors from "cors";
import express from "express";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const app = express();
const port = Number(process.env.PAYMENT_SERVER_PORT || 8787);
const storePath = new URL("./payment-store.json", import.meta.url);
const startedAt = new Date();
const metrics = {
  requests: 0,
  paymentInitiations: 0,
  paymentFailures: 0,
  webhookUpdates: 0,
  devConfirmations: 0,
};

app.use(cors({ origin: process.env.PORTAL_ORIGIN || "http://127.0.0.1:5173", credentials: true }));
app.use(express.json());
app.use((req, res, next) => {
  const started = Date.now();
  metrics.requests += 1;
  res.on("finish", () => {
    console.log(JSON.stringify({
      level: res.statusCode >= 500 ? "error" : "info",
      event: "http_request",
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - started,
    }));
  });
  next();
});

app.get(["/health", "/payments/health"], async (_req, res) => {
  try {
    const rows = await readStore();
    res.json({
      ok: true,
      service: "payments",
      uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
      transactions: rows.length,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Health check failed." });
  }
});

app.get(["/metrics", "/payments/metrics"], async (_req, res) => {
  const rows = await readStore();
  const byStatus = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});
  res.json({
    ...metrics,
    transactions: rows.length,
    pendingTransactions: byStatus.pending || 0,
    paidTransactions: byStatus.paid || 0,
    failedTransactions: byStatus.failed || 0,
  });
});

async function readStore() {
  try {
    return JSON.parse(await readFile(storePath, "utf-8"));
  } catch {
    return [];
  }
}

async function writeStore(rows) {
  await writeFile(storePath, JSON.stringify(rows, null, 2), "utf-8");
}

function publicTransaction(transaction) {
  return {
    id: transaction.id,
    provider: transaction.provider,
    amount: transaction.amount,
    currency: transaction.currency,
    status: transaction.status,
    reference: transaction.reference,
    checkoutUrl: transaction.checkoutUrl,
    providerReference: transaction.providerReference,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
  };
}

function providerConfig(provider) {
  if (provider === "wave") {
    return {
      apiKey: process.env.WAVE_API_KEY,
      baseUrl: process.env.WAVE_API_BASE_URL,
      merchantId: process.env.WAVE_MERCHANT_ID,
    };
  }
  if (provider === "orange_money") {
    return {
      clientId: process.env.ORANGE_CLIENT_ID,
      clientSecret: process.env.ORANGE_CLIENT_SECRET,
      merchantKey: process.env.ORANGE_MERCHANT_KEY,
      authUrl: process.env.ORANGE_AUTH_URL || "https://api.orange.com/oauth/v3/token",
      paymentUrl: process.env.ORANGE_PAYMENT_URL,
    };
  }
  return {};
}

async function createProviderPayment(input) {
  const config = providerConfig(input.provider);

  if (input.provider === "wave" && config.apiKey && config.baseUrl) {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: input.amount,
        currency: input.currency,
        phone: input.phone,
        reference: input.reference,
        merchant_id: config.merchantId,
        callback_url: process.env.PAYMENT_WEBHOOK_URL,
      }),
    });
    if (!response.ok) {
      throw new Error(`Wave payment failed: ${await response.text()}`);
    }
    const payload = await response.json();
    return {
      providerReference: payload.id || payload.reference || payload.transaction_id,
      checkoutUrl: payload.checkout_url || payload.payment_url || payload.url,
      raw: payload,
    };
  }

  if (input.provider === "orange_money" && config.clientId && config.clientSecret && config.paymentUrl) {
    const tokenResponse = await fetch(config.authUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
    });
    if (!tokenResponse.ok) {
      throw new Error(`Orange auth failed: ${await tokenResponse.text()}`);
    }
    const tokenPayload = await tokenResponse.json();
    const paymentResponse = await fetch(config.paymentUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenPayload.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        merchant_key: config.merchantKey,
        amount: input.amount,
        currency: input.currency,
        phone: input.phone,
        order_id: input.reference,
        notif_url: process.env.PAYMENT_WEBHOOK_URL,
        return_url: process.env.PAYMENT_RETURN_URL,
        cancel_url: process.env.PAYMENT_CANCEL_URL,
      }),
    });
    if (!paymentResponse.ok) {
      throw new Error(`Orange payment failed: ${await paymentResponse.text()}`);
    }
    const payload = await paymentResponse.json();
    return {
      providerReference: payload.pay_token || payload.payment_token || payload.id,
      checkoutUrl: payload.payment_url || payload.redirect_url || payload.url,
      raw: payload,
    };
  }

  return {
    providerReference: `local-${randomUUID()}`,
    checkoutUrl: undefined,
    raw: { mode: "local_pending", message: "Provider credentials are not configured." },
  };
}

app.post("/payments/initiate", async (req, res) => {
  try {
    const { provider, amount, currency = "XOF", phone, reference } = req.body;
    if (!["wave", "orange_money"].includes(provider)) {
      return res.status(400).json({ error: "Unsupported provider." });
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount." });
    }
    if (!phone) {
      return res.status(400).json({ error: "Customer phone is required." });
    }

    const providerPayment = await createProviderPayment({ provider, amount, currency, phone, reference });
    const transaction = {
      id: randomUUID(),
      provider,
      amount,
      currency,
      phone,
      reference,
      status: "pending",
      providerReference: providerPayment.providerReference,
      checkoutUrl: providerPayment.checkoutUrl,
      raw: providerPayment.raw,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const rows = await readStore();
    rows.push(transaction);
    await writeStore(rows);
    metrics.paymentInitiations += 1;
    res.json(publicTransaction(transaction));
  } catch (error) {
    metrics.paymentFailures += 1;
    console.error(JSON.stringify({
      level: "error",
      event: "payment_initiation_failed",
      message: error instanceof Error ? error.message : "Payment initiation failed.",
    }));
    res.status(500).json({ error: error instanceof Error ? error.message : "Payment initiation failed." });
  }
});

app.get("/payments/:id", async (req, res) => {
  const rows = await readStore();
  const transaction = rows.find((row) => row.id === req.params.id);
  if (!transaction) {
    return res.status(404).json({ error: "Transaction not found." });
  }
  res.json(publicTransaction(transaction));
});

app.post("/payments/webhook/:provider", async (req, res) => {
  const rows = await readStore();
  const providerReference = req.body.providerReference || req.body.transaction_id || req.body.pay_token || req.body.id;
  const status = req.body.status || req.body.payment_status;
  const row = rows.find((transaction) => transaction.providerReference === providerReference);
  if (row) {
    row.status = ["paid", "success", "successful", "completed"].includes(String(status).toLowerCase()) ? "paid" : "failed";
    row.updatedAt = new Date().toISOString();
    row.webhook = req.body;
    await writeStore(rows);
    metrics.webhookUpdates += 1;
  }
  res.json({ ok: true });
});

app.post("/payments/:id/dev-mark-paid", async (req, res) => {
  if (process.env.PAYMENT_ALLOW_DEV_CONFIRM !== "true") {
    return res.status(403).json({ error: "Dev confirmation disabled." });
  }
  const rows = await readStore();
  const transaction = rows.find((row) => row.id === req.params.id);
  if (!transaction) {
    return res.status(404).json({ error: "Transaction not found." });
  }
  transaction.status = "paid";
  transaction.updatedAt = new Date().toISOString();
  await writeStore(rows);
  metrics.devConfirmations += 1;
  res.json(publicTransaction(transaction));
});

app.listen(port, () => {
  console.log(`Payment service listening on http://127.0.0.1:${port}`);
});
