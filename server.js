const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tls = require('tls');
const net = require('net');
const { URL } = require('url');

// ─── Load env file if present ───
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'db.json');

// Email config (optional — if not set, reports still save but emails won't send)
const SMTP_HOST = process.env.SMTP_HOST;        // e.g. smtp.gmail.com
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER;        // your gmail address
const SMTP_PASS = process.env.SMTP_PASS;        // gmail app password
const NOTIFY_TO = process.env.NOTIFY_TO || SMTP_USER;  // inbox to receive reports
const NOTIFY_FROM = process.env.NOTIFY_FROM || SMTP_USER;
const MAIL_ENABLED = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

[DATA_DIR, UPLOAD_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ─── Simple JSON DB ───
function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    const empty = { reports: [], evidence: [], contacts: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch {
    return { reports: [], evidence: [], contacts: [] };
  }
}
function writeDB(data) { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); }

function generateRef(prefix) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${prefix}-${date}-${rand}`;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// ─── SMTP client (plain Node.js, no deps) ───
async function sendMail({ to, subject, html, text, attachments }) {
  if (!MAIL_ENABLED) {
    console.log(`[mail] SMTP not configured — skipping email to ${to}`);
    return { ok: false, skipped: true };
  }

  return new Promise((resolve) => {
    const secure = SMTP_PORT === 465;
    let socket;
    let step = 0;
    let buffer = '';
    const fromAddr = NOTIFY_FROM;
    const altBoundary = '----STIalt' + crypto.randomBytes(8).toString('hex');
    const relBoundary = '----STIrel' + crypto.randomBytes(8).toString('hex');
    const mixedBoundary = '----STImix' + crypto.randomBytes(8).toString('hex');

    const authUser = Buffer.from(SMTP_USER).toString('base64');
    const authPass = Buffer.from(SMTP_PASS).toString('base64');

    const atts = attachments || [];
    const inlineImages = atts.filter(a => /^image\//i.test(a.mime_type || ''));
    const fileAttachments = atts.filter(a => !/^image\//i.test(a.mime_type || ''));
    const hasInline = inlineImages.length > 0;
    const hasFiles = fileAttachments.length > 0;

    // Inject each inline image's CID into the HTML (replaces {{cid:stored_name}} placeholders)
    let htmlWithCids = html;
    for (const img of inlineImages) {
      img.cid = `img-${img.stored_name}@sti`;
      htmlWithCids = htmlWithCids.split(`{{cid:${img.stored_name}}}`).join(`cid:${img.cid}`);
    }

    // text/plain + text/html alternative
    const altPart =
      `--${altBoundary}\r\n` +
      `Content-Type: text/plain; charset=UTF-8\r\n` +
      `Content-Transfer-Encoding: 7bit\r\n\r\n` +
      `${text || subject}\r\n` +
      `--${altBoundary}\r\n` +
      `Content-Type: text/html; charset=UTF-8\r\n` +
      `Content-Transfer-Encoding: 7bit\r\n\r\n` +
      `${htmlWithCids}\r\n` +
      `--${altBoundary}--\r\n`;

    function attachmentBlock(boundary, att, disposition) {
      try {
        const fileData = fs.readFileSync(path.join(UPLOAD_DIR, att.stored_name));
        const base64Data = fileData.toString('base64');
        const mime = att.mime_type || 'application/octet-stream';
        let block =
          `--${boundary}\r\n` +
          `Content-Type: ${mime}; name="${att.original_name}"\r\n` +
          `Content-Transfer-Encoding: base64\r\n`;
        if (disposition === 'inline' && att.cid) {
          block += `Content-ID: <${att.cid}>\r\n`;
          block += `Content-Disposition: inline; filename="${att.original_name}"\r\n\r\n`;
        } else {
          block += `Content-Disposition: attachment; filename="${att.original_name}"\r\n\r\n`;
        }
        for (let i = 0; i < base64Data.length; i += 76) {
          block += base64Data.slice(i, i + 76) + '\r\n';
        }
        return block;
      } catch (err) {
        console.error(`[mail] Could not attach file ${att.stored_name}:`, err.message);
        return '';
      }
    }

    // multipart/related wraps alternative + inline images (so HTML can reference cid:)
    const relatedPart = hasInline
      ? (
          `--${relBoundary}\r\n` +
          `Content-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n` +
          altPart +
          inlineImages.map(img => attachmentBlock(relBoundary, img, 'inline')).join('') +
          `--${relBoundary}--\r\n`
        )
      : null;

    let body;
    let topBoundary, topType;
    if (hasFiles) {
      topBoundary = mixedBoundary;
      topType = 'multipart/mixed';
      let parts = '';
      if (hasInline) {
        parts +=
          `--${mixedBoundary}\r\n` +
          `Content-Type: multipart/related; boundary="${relBoundary}"\r\n\r\n` +
          relatedPart;
      } else {
        parts +=
          `--${mixedBoundary}\r\n` +
          `Content-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n` +
          altPart;
      }
      for (const att of fileAttachments) {
        parts += attachmentBlock(mixedBoundary, att, 'attachment');
      }
      parts += `--${mixedBoundary}--\r\n`;
      body = parts;
    } else if (hasInline) {
      topBoundary = relBoundary;
      topType = 'multipart/related';
      body = relatedPart;
    } else {
      topBoundary = altBoundary;
      topType = 'multipart/alternative';
      body = altPart;
    }

    const message =
      `From: "S.Transparency Initiative" <${fromAddr}>\r\n` +
      `To: ${to}\r\n` +
      `Subject: ${subject}\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: ${topType}; boundary="${topBoundary}"\r\n\r\n` +
      body;

    const steps = [
      `EHLO stransparency.org\r\n`,
      `AUTH LOGIN\r\n`,
      `${authUser}\r\n`,
      `${authPass}\r\n`,
      `MAIL FROM:<${fromAddr}>\r\n`,
      `RCPT TO:<${to}>\r\n`,
      `DATA\r\n`,
      `${message}\r\n.\r\n`,
      `QUIT\r\n`
    ];

    const finish = (ok, err) => {
      try { socket && socket.end(); } catch {}
      if (!ok) console.error('[mail] failed:', err);
      resolve({ ok, error: err });
    };

    const connectOpts = { host: SMTP_HOST, port: SMTP_PORT, servername: SMTP_HOST };
    socket = secure ? tls.connect(connectOpts) : net.connect(connectOpts);

    const timer = setTimeout(() => finish(false, 'timeout'), 20000);

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      // responses end with \r\n after a non-continuation line (NNN space)
      const lines = buffer.split('\r\n');
      const last = lines[lines.length - 2] || '';
      if (!/^\d{3} /.test(last)) return;

      const code = parseInt(last.slice(0, 3), 10);
      buffer = '';

      if (code >= 400) {
        clearTimeout(timer);
        return finish(false, `SMTP ${code}: ${last}`);
      }

      if (step < steps.length) {
        socket.write(steps[step++]);
      } else {
        clearTimeout(timer);
        finish(true);
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      finish(false, err.message);
    });
  });
}

// ─── Email templates ───
function reportEmailHtml(type, data, reference, files) {
  const isChurch = type === 'church';
  const isTrucking = type === 'trucking';
  const isOther = type === 'other';
  const title = isChurch ? 'Church Corruption Report' :
                isTrucking ? 'Trucking Industry Report' :
                isOther ? 'Other Corruption Report' : 'New Report';

  const rows = [];
  const add = (label, val) => { if (val) rows.push([label, val]); };

  add('Reference', reference);
  add('Type', type.toUpperCase());
  add('Category', data.category);

  if (isChurch) {
    add('Institution / Location', data.location);
    add('Date of Incident', data.incident_date);
    add('People Involved', data.people_involved);
  }
  if (isTrucking) {
    add('Company / Carrier', data.company);
    add('MC / DOT', data.mc_dot);
    add('Role', data.role);
    add('Time Period', data.time_period);
    add('Financial Impact', data.amount);
  }
  if (isOther) {
    add('Subject / Organization', data.subject);
    add('Location', data.location);
    add('Time Period', data.time_period);
    add('People Involved', data.people_involved);
  }

  add('Description', data.description);
  add('Contact', data.contact_email);
  add('Submitted', new Date().toISOString());

  const rowHtml = rows.map(([k, v]) => `
    <tr>
      <td style="padding:10px 14px;font-weight:600;color:#555;vertical-align:top;border-bottom:1px solid #eee;width:180px;">${escapeHtml(k)}</td>
      <td style="padding:10px 14px;color:#222;vertical-align:top;border-bottom:1px solid #eee;white-space:pre-wrap;">${escapeHtml(v)}</td>
    </tr>
  `).join('');

  // Split attached files: images render inline, everything else is listed as a link
  const images = (files || []).filter(f => /^image\//i.test(f.mime_type || ''));
  const docs = (files || []).filter(f => !/^image\//i.test(f.mime_type || ''));

  const imagesHtml = images.length ? `
    <div style="padding:20px 28px;border-top:1px solid #eee;background:#fff;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#9a1f1f;margin-bottom:12px;">Attached Images</div>
      ${images.map(f => `
        <div style="margin-bottom:16px;">
          <img src="{{cid:${f.stored_name}}}" alt="${escapeHtml(f.original_name)}" style="max-width:100%;height:auto;border-radius:6px;border:1px solid #eee;display:block;">
          <div style="font-size:12px;color:#888;margin-top:6px;">${escapeHtml(f.original_name)} &middot; ${(f.size/1024).toFixed(1)} KB</div>
        </div>
      `).join('')}
    </div>` : '';

  const docsHtml = docs.length ? `
    <div style="padding:16px 28px;border-top:1px solid #eee;background:#fff;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#9a1f1f;margin-bottom:10px;">Attached Documents</div>
      <ul style="padding-left:18px;margin:0;">
        ${docs.map(f => `<li style="padding:3px 0;color:#222;">${escapeHtml(f.original_name)} <span style="color:#888;">(${(f.size/1024).toFixed(1)} KB)</span></li>`).join('')}
      </ul>
      <div style="font-size:12px;color:#888;margin-top:8px;">Documents are attached to this email.</div>
    </div>` : '';

  return `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#f5f5f5;margin:0;padding:24px;">
    <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      <div style="background:#9a1f1f;color:#fff;padding:24px 28px;">
        <div style="font-size:12px;letter-spacing:2px;opacity:0.8;text-transform:uppercase;">S.Transparency Initiative</div>
        <h1 style="margin:6px 0 0;font-size:22px;">${escapeHtml(title)}</h1>
      </div>
      <table style="width:100%;border-collapse:collapse;">${rowHtml}</table>
      ${imagesHtml}
      ${docsHtml}
      <div style="padding:16px 28px;background:#fafafa;color:#888;font-size:12px;border-top:1px solid #eee;">
        Reference <strong>${escapeHtml(reference)}</strong> &middot; Review at the admin dashboard.
      </div>
    </div>
  </body></html>`;
}

function contactEmailHtml(data) {
  return `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#f5f5f5;padding:24px;">
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      <div style="background:#1a1a1a;color:#fff;padding:24px 28px;">
        <div style="font-size:12px;letter-spacing:2px;opacity:0.7;text-transform:uppercase;">STI &mdash; Contact Form</div>
        <h1 style="margin:6px 0 0;font-size:20px;">${escapeHtml(data.subject)}</h1>
      </div>
      <div style="padding:24px 28px;">
        <p style="margin:0 0 12px;"><strong>From:</strong> ${escapeHtml(data.name)} &lt;${escapeHtml(data.email)}&gt;</p>
        <p style="margin:0 0 12px;"><strong>Subject:</strong> ${escapeHtml(data.subject)}</p>
        <div style="padding:16px;background:#f9f9f9;border-radius:6px;white-space:pre-wrap;line-height:1.6;">${escapeHtml(data.message)}</div>
      </div>
    </div>
  </body></html>`;
}

function evidenceEmailHtml(data, reference, files) {
  const fileList = files.length
    ? files.map(f => `<li style="padding:4px 0;">${escapeHtml(f.original_name)} <span style="color:#888;">(${(f.size/1024).toFixed(1)} KB)</span></li>`).join('')
    : '<li style="color:#888;">No files attached</li>';

  return `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#f5f5f5;padding:24px;">
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      <div style="background:#9a1f1f;color:#fff;padding:24px 28px;">
        <div style="font-size:12px;letter-spacing:2px;opacity:0.8;text-transform:uppercase;">STI &mdash; Evidence Received</div>
        <h1 style="margin:6px 0 0;font-size:20px;">New Evidence: ${escapeHtml(reference)}</h1>
      </div>
      <div style="padding:24px 28px;">
        ${data.case_ref ? `<p><strong>Linked to Report:</strong> ${escapeHtml(data.case_ref)}</p>` : ''}
        <p><strong>Category:</strong> ${escapeHtml(data.category)}</p>
        <p><strong>Description:</strong></p>
        <div style="padding:12px;background:#f9f9f9;border-radius:6px;white-space:pre-wrap;">${escapeHtml(data.description)}</div>
        <p style="margin-top:16px;"><strong>Files uploaded:</strong></p>
        <ul style="padding-left:20px;">${fileList}</ul>
        ${data.contact_email ? `<p style="color:#888;margin-top:16px;">Contact: ${escapeHtml(data.contact_email)}</p>` : ''}
      </div>
    </div>
  </body></html>`;
}

// ─── MIME types ───
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

// ─── Request helpers ───
function parseJSON(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const boundary = req.headers['content-type']?.match(/boundary=([^\s;]+)/)?.[1];
    if (!boundary) return resolve({ fields: {}, files: [] });
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const boundaryBuf = Buffer.from(`--${boundary}`);
      const fields = {};
      const files = [];

      const positions = [];
      let start = 0;
      while (true) {
        const idx = buffer.indexOf(boundaryBuf, start);
        if (idx === -1) break;
        positions.push(idx);
        start = idx + boundaryBuf.length;
      }

      for (let i = 0; i < positions.length - 1; i++) {
        const partStart = positions[i] + boundaryBuf.length + 2;
        const partEnd = positions[i + 1] - 2;
        const part = buffer.slice(partStart, partEnd);
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;

        const headerStr = part.slice(0, headerEnd).toString('utf-8');
        const body = part.slice(headerEnd + 4);
        const nameMatch = headerStr.match(/name="([^"]+)"/);
        const filenameMatch = headerStr.match(/filename="([^"]+)"/);

        if (filenameMatch && filenameMatch[1]) {
          const originalName = filenameMatch[1];
          const ext = path.extname(originalName).toLowerCase();
          const allowed = ['.pdf','.jpg','.jpeg','.png','.doc','.docx','.mp4','.mp3'];
          if (allowed.includes(ext) && body.length <= 10 * 1024 * 1024) {
            const storedName = crypto.randomBytes(16).toString('hex') + ext;
            try {
              if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
              fs.writeFileSync(path.join(UPLOAD_DIR, storedName), body);
            } catch (err) {
              console.error('[upload] Failed to save file:', err.message);
            }
            files.push({
              original_name: originalName,
              stored_name: storedName,
              size: body.length,
              mime_type: headerStr.match(/Content-Type:\s*(.+)/i)?.[1]?.trim() || 'application/octet-stream'
            });
          }
        } else if (nameMatch) {
          fields[nameMatch[1]] = body.toString('utf-8');
        }
      }
      resolve({ fields, files });
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function serveStatic(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, html) => {
        if (err2) { res.writeHead(404); res.end('Not Found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    res.end(data);
  });
}

// ─── Simple rate limiter (in-memory) ───
const rateLimits = new Map();
function rateLimit(ip, limit = 10, windowMs = 60000) {
  const now = Date.now();
  const entry = rateLimits.get(ip) || { count: 0, reset: now + windowMs };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs; }
  entry.count++;
  rateLimits.set(ip, entry);
  return entry.count <= limit;
}

// ─── Server ───
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const method = req.method;
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Rate limit API routes
  if (pathname.startsWith('/api/') && !rateLimit(ip)) {
    return sendJSON(res, 429, { error: 'Too many requests. Please slow down.' });
  }

  // ─── REPORTS (church + trucking) ───
  if (pathname === '/api/reports' && method === 'POST') {
    try {
      const { fields, files } = await parseMultipart(req);
      const type = fields.report_type || 'church';
      const { category, description } = fields;

      if (!category || !description) {
        return sendJSON(res, 400, { error: 'Please fill in all required fields.' });
      }
      if (type === 'church' && !fields.location) {
        return sendJSON(res, 400, { error: 'Please provide the institution or location.' });
      }
      if (type === 'trucking' && !fields.company) {
        return sendJSON(res, 400, { error: 'Please provide the company name.' });
      }
      if (type === 'other' && !fields.subject) {
        return sendJSON(res, 400, { error: 'Please provide the subject or organization.' });
      }

      const prefix = type === 'trucking' ? 'TRK' : type === 'other' ? 'OTH' : 'CHR';
      const reference = generateRef(prefix);
      const data = readDB();
      const record = {
        id: data.reports.length + 1,
        reference,
        type,
        ...fields,
        files: files.length ? files : [],
        status: 'pending',
        ip,
        created_at: new Date().toISOString()
      };
      delete record.report_type;
      data.reports.push(record);
      writeDB(data);

      // Fire-and-forget email
      const emailSubject = type === 'trucking'
        ? `[STI] New Trucking Report — ${reference}`
        : type === 'other'
          ? `[STI] New Other Report — ${reference}`
          : `[STI] New Church Report — ${reference}`;
      sendMail({
        to: NOTIFY_TO,
        subject: emailSubject,
        html: reportEmailHtml(type, fields, reference, files),
        text: `New ${type} report received. Reference: ${reference}` + (files.length ? ` (${files.length} file(s) attached)` : ''),
        attachments: files
      }).catch(() => {});

      return sendJSON(res, 200, { success: true, reference });
    } catch (err) {
      console.error('[reports] Error:', err);
      return sendJSON(res, 500, { error: 'Server error. Please try again.' });
    }
  }

  // ─── EVIDENCE ───
  if (pathname === '/api/evidence' && method === 'POST') {
    const { fields, files } = await parseMultipart(req);
    const { case_ref, category, description, contact_email } = fields;

    if (!category || !description) {
      return sendJSON(res, 400, { error: 'Please fill in all required fields.' });
    }

    const reference = generateRef('EVD');
    const data = readDB();
    data.evidence.push({
      id: data.evidence.length + 1,
      reference,
      case_ref: case_ref || null,
      category,
      description,
      contact_email: contact_email || null,
      files,
      status: 'pending',
      ip,
      created_at: new Date().toISOString()
    });
    writeDB(data);

    sendMail({
      to: NOTIFY_TO,
      subject: `[STI] New Evidence Submission — ${reference}`,
      html: evidenceEmailHtml(fields, reference, files),
      text: `New evidence received. Reference: ${reference}`,
      attachments: files
    }).catch(() => {});

    return sendJSON(res, 200, { success: true, reference });
  }

  // ─── CONTACT ───
  if (pathname === '/api/contact' && method === 'POST') {
    const body = await parseJSON(req);
    const { name, email, subject, message } = body;

    if (!email || !subject || !message) {
      return sendJSON(res, 400, { error: 'Please fill in all required fields.' });
    }

    const data = readDB();
    data.contacts.push({
      id: data.contacts.length + 1,
      name: name || 'Anonymous',
      email, subject, message,
      status: 'unread',
      ip,
      created_at: new Date().toISOString()
    });
    writeDB(data);

    sendMail({
      to: NOTIFY_TO,
      subject: `[STI] Contact: ${subject}`,
      html: contactEmailHtml({ name: name || 'Anonymous', email, subject, message }),
      text: `From ${name || 'Anonymous'} <${email}>\nSubject: ${subject}\n\n${message}`
    }).catch(() => {});

    return sendJSON(res, 200, { success: true, message: 'Message sent successfully.' });
  }

  // ─── Health check ───
  if (pathname === '/api/health') {
    return sendJSON(res, 200, { ok: true, mail_enabled: MAIL_ENABLED });
  }

  // ─── Static files ───
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  filePath = path.normalize(filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  serveStatic(res, filePath);
});

server.listen(PORT, () => {
  console.log(`\n  ╔════════════════════════════════════════╗`);
  console.log(`  ║  S.Transparency Initiative             ║`);
  console.log(`  ║  Running at http://localhost:${PORT}       ║`);
  console.log(`  ║  Email delivery: ${MAIL_ENABLED ? 'ENABLED ✓      ' : 'DISABLED ✗     '}    ║`);
  console.log(`  ╚════════════════════════════════════════╝\n`);
  if (!MAIL_ENABLED) {
    console.log(`  ⚠ To receive email notifications, create a .env file:`);
    console.log(`    SMTP_HOST=smtp.gmail.com`);
    console.log(`    SMTP_PORT=465`);
    console.log(`    SMTP_USER=your@gmail.com`);
    console.log(`    SMTP_PASS=your-16-char-app-password`);
    console.log(`    NOTIFY_TO=where-to-send-reports@email.com\n`);
  }
});
