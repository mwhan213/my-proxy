const express = require('express');

const AUTH_KEY = process.env.AUTH_KEY || "کلید-امنیتی-شما";

const SKIP_HEADERS = new Set([
  "host", "connection", "content-length", "transfer-encoding",
  "proxy-connection", "proxy-authorization", "priority", "te",
]);

const DEFAULT_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

const app = express();

// ---------- مدیریت صحیح JSON ورودی ----------
app.use(express.json({ limit: '50mb' })); // افزایش محدودیت حجم درخواست ورودی

// اگر JSON نادرست باشد، به‌جای HTML خطای JSON برگردانیم
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ e: "invalid json" });
  }
  next(err);
});

// ---------- مسیرها ----------
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Proxy</title></head>
    <body style="font-family:sans-serif;max-width:600px;margin:40px auto">
    <h1>Welcome</h1><p>Proxy is running.</p></body></html>`);
});

app.post('/', async (req, res) => {
  try {
    const body = req.body;
    if (body.k !== AUTH_KEY) {
      return res.status(401).json({ e: "unauthorized" });
    }

    if (Array.isArray(body.q)) {
      return await handleBatch(body.q, res);
    }
    return await handleSingle(body, res);
  } catch (err) {
    // گرفتن خطاهای ناخواسته و بازگرداندن JSON
    console.error("Unhandled POST error:", err);
    return res.status(500).json({ e: "internal error" });
  }
});

// ---------- درخواست تکی ----------
async function handleSingle(req, res) {
  if (!req.u || typeof req.u !== 'string' || !/^https?:\/\//i.test(req.u)) {
    return res.status(400).json({ e: "bad url" });
  }
  try {
    const opts = buildFetchOpts(req);
    const response = await fetch(req.u, opts);
    const result = await buildResult(response);
    return res.json(result);
  } catch (err) {
    console.error(`Single fetch error for ${req.u}:`, err.message);
    return res.status(502).json({ e: String(err.message || err) });
  }
}

// ---------- درخواست دسته‌ای ----------
async function handleBatch(items, res) {
  const results = new Array(items.length);
  const errors = {};

  for (let i = 0; i < items.length; i++) {
    if (!items[i].u || typeof items[i].u !== 'string' || !/^https?:\/\//i.test(items[i].u)) {
      errors[i] = "bad url";
    }
  }

  const CONCURRENCY = 25; // کاهش همزمانی برای پایداری بیشتر
  for (let start = 0; start < items.length; start += CONCURRENCY) {
    const chunk = items.slice(start, start + CONCURRENCY);
    const promises = chunk.map(async (item, idx) => {
      const globalIdx = start + idx;
      if (errors[globalIdx]) return { idx: globalIdx, result: { e: errors[globalIdx] } };
      try {
        const opts = buildFetchOpts(item);
        const resp = await fetch(item.u, opts);
        return { idx: globalIdx, result: await buildResult(resp) };
      } catch (err) {
        console.error(`Batch error for ${item.u}:`, err.message);
        return { idx: globalIdx, result: { e: String(err.message || err) } };
      }
    });
    const chunkResults = await Promise.all(promises);
    for (const { idx, result } of chunkResults) {
      results[idx] = result;
    }
  }

  return res.json({ q: results });
}

// ---------- ساخت آپشن‌های fetch ----------
function buildFetchOpts(req) {
  const opts = {
    method: (req.m || 'GET').toUpperCase(),
    redirect: typeof req.r === 'undefined' || req.r !== false ? 'follow' : 'manual',
    headers: { ...DEFAULT_HEADERS },
  };

  if (req.h && typeof req.h === 'object') {
    Object.entries(req.h).forEach(([k, v]) => {
      if (!SKIP_HEADERS.has(k.toLowerCase())) {
        opts.headers[k] = v;
      }
    });
  }

  if (req.b) {
    opts.body = Buffer.from(req.b, 'base64');
    if (req.ct) opts.headers['content-type'] = req.ct;
  }

  return opts;
}

// ---------- تبدیل پاسخ به JSON (با مدیریت حجم بالا) ----------
async function buildResult(response) {
  // دریافت کامل بدنه (حتی اگر حجیم باشد)
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const base64Body = buffer.toString('base64');

  // استخراج هدرها
  const headers = {};
  for (const [key, value] of response.headers.entries()) {
    headers[key] = value;
  }

  return {
    s: response.status,
    h: headers,
    b: base64Body,
  };
}

// ---------- مدیریت سراسری خطا (برای جلوگیری از ارسال HTML) ----------
app.use((err, req, res, next) => {
  console.error("Global error:", err);
  res.status(500).json({ e: "server error" });
});

// ---------- گرفتن خطاهای بحرانی (Uncaught Exceptions) ----------
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // سرور دوباره توسط Railway راه‌اندازی خواهد شد
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
