const express = require('express');

const AUTH_KEY = process.env.AUTH_KEY || "5ecde94e179c4ebfa0248b865391aca6a4b6e27cc7ee4fb0";

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
app.use(express.json({ limit: '2mb' }));

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>My App</title></head>
    <body style="font-family:sans-serif;max-width:600px;margin:40px auto">
    <h1>Welcome</h1><p>This application is running normally.</p>
    </body></html>`);
});

app.post('/', async (req, res) => {
  try {
    const body = req.body;
    if (body.k !== AUTH_KEY) {
      return res.status(401).json({ e: "unauthorized" });
    }

    if (Array.isArray(body.q)) {
      return handleBatch(body.q, res);
    }
    return handleSingle(body, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ e: String(err) });
  }
});

async function handleSingle(req, res) {
  if (!req.u || typeof req.u !== 'string' || !/^https?:\/\//i.test(req.u)) {
    return res.status(400).json({ e: "bad url" });
  }
  try {
    const opts = buildFetchOpts(req);
    const response = await fetch(req.u, opts);
    const result = await buildResult(response);
    res.json(result);
  } catch (err) {
    console.error(`Single fetch error: ${req.u}`, err.message);
    res.status(502).json({ e: String(err) });
  }
}

async function handleBatch(items, res) {
  const results = new Array(items.length);
  const errors = {};

  for (let i = 0; i < items.length; i++) {
    if (!items[i].u || typeof items[i].u !== 'string' || !/^https?:\/\//i.test(items[i].u)) {
      errors[i] = "bad url";
    }
  }

  const CONCURRENCY = 50;
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
        console.error(`Batch error: ${item.u}`, err.message);
        return { idx: globalIdx, result: { e: String(err) } };
      }
    });
    const chunkResults = await Promise.all(promises);
    for (const { idx, result } of chunkResults) {
      results[idx] = result;
    }
  }

  res.json({ q: results });
}

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

async function buildResult(response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  const base64Body = buffer.toString('base64');

  return {
    s: response.status,
    h: headers,
    b: base64Body,
  };
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
