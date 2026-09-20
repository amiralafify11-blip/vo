const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Initialize SQLite Database (supports both better-sqlite3 and Node built-in node:sqlite)
let db;
try {
  const Database = require('better-sqlite3');
  db = new Database(path.join(__dirname, 'survey.db'));
  db.pragma('journal_mode = WAL');
} catch (e) {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(path.join(__dirname, 'survey.db'));
  db.exec('PRAGMA journal_mode = WAL');
}

// Create surveys table
db.exec(`
  CREATE TABLE IF NOT EXISTS surveys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    purchase_date TEXT NOT NULL,
    source TEXT NOT NULL,
    purchased TEXT NOT NULL,
    emirate TEXT NOT NULL,
    experience TEXT,
    rating INTEGER NOT NULL,
    token TEXT,
    coupon_code TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Create customer_links table
db.exec(`
  CREATE TABLE IF NOT EXISTS customer_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    phone TEXT,
    has_invoice INTEGER DEFAULT 0,
    invoice_filename TEXT,
    invoice_original_name TEXT,
    is_completed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Add token column to surveys if not exists
try {
  db.exec(`ALTER TABLE surveys ADD COLUMN token TEXT`);
} catch (e) {
  // Column already exists, ignore
}

// Add coupon_code column to surveys if not exists
try {
  db.exec(`ALTER TABLE surveys ADD COLUMN coupon_code TEXT`);
} catch (e) {
  // Column already exists, ignore
}

// ============================================
// Multer-free file upload using raw body parsing
// ============================================
const multerFree = (req, res, next) => {
  if (req.headers['content-type'] && req.headers['content-type'].startsWith('multipart/form-data')) {
    const boundary = req.headers['content-type'].split('boundary=')[1];
    if (!boundary) return next();

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const parts = parseMultipart(buffer, boundary);
      req.body = {};
      req.file = null;

      parts.forEach(part => {
        if (part.filename) {
          req.file = {
            fieldname: part.name,
            originalname: part.filename,
            buffer: part.data,
            mimetype: part.contentType || 'application/octet-stream'
          };
        } else {
          req.body[part.name] = part.data.toString('utf8');
        }
      });
      next();
    });
  } else {
    next();
  }
};

function parseMultipart(buffer, boundary) {
  const parts = [];
  const boundaryBuffer = Buffer.from('--' + boundary);
  const endBuffer = Buffer.from('--' + boundary + '--');

  let start = indexOf(buffer, boundaryBuffer, 0);
  if (start === -1) return parts;

  while (true) {
    start = start + boundaryBuffer.length + 2; // skip \r\n after boundary
    const end = indexOf(buffer, boundaryBuffer, start);
    if (end === -1) break;

    const partData = buffer.slice(start, end - 2); // -2 for \r\n before boundary
    const headerEnd = indexOf(partData, Buffer.from('\r\n\r\n'), 0);
    if (headerEnd === -1) { start = end; continue; }

    const headerStr = partData.slice(0, headerEnd).toString('utf8');
    const body = partData.slice(headerEnd + 4);

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    const contentTypeMatch = headerStr.match(/Content-Type:\s*(.+)/i);

    if (nameMatch) {
      parts.push({
        name: nameMatch[1],
        filename: filenameMatch ? filenameMatch[1] : null,
        contentType: contentTypeMatch ? contentTypeMatch[1].trim() : null,
        data: body
      });
    }
    start = end;
  }
  return parts;
}

function indexOf(buf, search, offset) {
  for (let i = offset; i <= buf.length - search.length; i++) {
    let found = true;
    for (let j = 0; j < search.length; j++) {
      if (buf[i + j] !== search[j]) { found = false; break; }
    }
    if (found) return i;
  }
  return -1;
}

// ============================================
// API: Create customer link (from admin)
// ============================================
app.post('/api/links', multerFree, (req, res) => {
  try {
    const { customer_name, phone } = req.body;

    if (!customer_name) {
      return res.status(400).json({ success: false, message: 'اسم العميل مطلوب' });
    }

    const token = crypto.randomBytes(8).toString('hex');
    let invoiceFilename = null;
    let invoiceOriginalName = null;
    let hasInvoice = 0;

    if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (ext !== '.pdf') {
        return res.status(400).json({ success: false, message: 'عذراً، يجب رفع الفاتورة بصيغة PDF فقط' });
      }
      invoiceFilename = `invoice_${token}${ext}`;
      invoiceOriginalName = req.file.originalname;
      hasInvoice = 1;

      const filePath = path.join(uploadsDir, invoiceFilename);
      fs.writeFileSync(filePath, req.file.buffer);
    }

    const stmt = db.prepare(`
      INSERT INTO customer_links (token, customer_name, phone, has_invoice, invoice_filename, invoice_original_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(token, customer_name, phone || '', hasInvoice, invoiceFilename, invoiceOriginalName);

    res.json({
      success: true,
      token,
      link: `/?t=${token}`,
      has_invoice: hasInvoice === 1
    });
  } catch (error) {
    console.error('Error creating link:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ في إنشاء الرابط' });
  }
});

// ============================================
// API: Get link info (for survey page)
// ============================================
app.get('/api/links/:token', (req, res) => {
  try {
    const link = db.prepare('SELECT * FROM customer_links WHERE token = ?').get(req.params.token);

    if (!link) {
      return res.status(404).json({ success: false, message: 'رابط غير صالح' });
    }

    res.json({
      success: true,
      data: {
        customer_name: link.customer_name,
        phone: link.phone,
        has_invoice: link.has_invoice === 1,
        is_completed: link.is_completed === 1
      }
    });
  } catch (error) {
    console.error('Error fetching link:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ' });
  }
});

// ============================================
// API: Get all links (admin)
// ============================================
app.get('/api/links', (req, res) => {
  try {
    const links = db.prepare('SELECT * FROM customer_links ORDER BY created_at DESC').all();
    res.json({ success: true, data: links });
  } catch (error) {
    console.error('Error fetching links:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ' });
  }
});

// ============================================
// API: Delete a customer link (admin)
// ============================================
app.delete('/api/links/:id', (req, res) => {
  try {
    const { id } = req.params;
    
    // First, find the link to get the invoice filename if exists
    const link = db.prepare('SELECT * FROM customer_links WHERE id = ?').get(id);
    if (!link) {
      return res.status(404).json({ success: false, message: 'الرابط غير موجود' });
    }
    
    // Delete invoice file from uploads folder if exists
    if (link.has_invoice && link.invoice_filename) {
      const filePath = path.join(uploadsDir, link.invoice_filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    
    // Delete from DB
    db.prepare('DELETE FROM customer_links WHERE id = ?').run(id);
    
    res.json({ success: true, message: 'تم حذف الرابط والملفات المرتبطة بنجاح' });
  } catch (error) {
    console.error('Error deleting link:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء حذف الرابط' });
  }
});

// ============================================
// API: Download invoice (only after survey completion)
// ============================================
app.get('/api/invoice/:token', (req, res) => {
  try {
    const link = db.prepare('SELECT * FROM customer_links WHERE token = ?').get(req.params.token);

    if (!link) {
      return res.status(404).json({ success: false, message: 'رابط غير صالح' });
    }

    if (!link.has_invoice) {
      return res.status(404).json({ success: false, message: 'لا توجد فاتورة مرفقة' });
    }

    if (!link.is_completed) {
      return res.status(403).json({ success: false, message: 'يجب إكمال الاستبيان أولاً لتحميل الفاتورة' });
    }

    const filePath = path.join(uploadsDir, link.invoice_filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'ملف الفاتورة غير موجود' });
    }

    res.download(filePath, link.invoice_original_name || link.invoice_filename);
  } catch (error) {
    console.error('Error downloading invoice:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ في تحميل الفاتورة' });
  }
});

// ============================================
// API: Submit survey
// ============================================
app.post('/api/survey', (req, res) => {
  try {
    const { name, phone, purchase_date, source, purchased, emirate, experience, rating, token } = req.body;

    // Validate required fields
    if (!name || !phone || !purchase_date || !source || !purchased || !emirate || !experience || !rating) {
      return res.status(400).json({ success: false, message: 'جميع الحقول المطلوبة يجب ملؤها بما فيها حقل التجربة' });
    }

    const couponCode = 'ACC20-' + crypto.randomBytes(3).toString('hex').toUpperCase();

    const stmt = db.prepare(`
      INSERT INTO surveys (name, phone, purchase_date, source, purchased, emirate, experience, rating, token, coupon_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(name, phone, purchase_date, source, purchased, emirate, experience || '', rating, token || null, couponCode);

    // Mark link as completed if token exists
    let hasInvoice = false;
    if (token) {
      db.prepare('UPDATE customer_links SET is_completed = 1 WHERE token = ?').run(token);
      const link = db.prepare('SELECT has_invoice FROM customer_links WHERE token = ?').get(token);
      if (link) hasInvoice = link.has_invoice === 1;
    }

    res.json({
      success: true,
      message: 'تم إرسال الاستبيان بنجاح!',
      id: result.lastInsertRowid,
      coupon: couponCode,
      has_invoice: hasInvoice,
      token: token || null
    });
  } catch (error) {
    console.error('Error saving survey:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ في حفظ البيانات' });
  }
});

// ============================================
// API: Search survey / customer by coupon code
// ============================================
app.get('/api/coupon/:code', (req, res) => {
  try {
    const code = req.params.code.trim().toUpperCase();
    const query = `
      SELECT s.*, l.invoice_filename, l.invoice_original_name, l.has_invoice
      FROM surveys s
      LEFT JOIN customer_links l ON s.token = l.token
      WHERE UPPER(s.coupon_code) = ?
    `;
    const result = db.prepare(query).get(code);

    if (!result) {
      return res.status(404).json({ success: false, message: 'الكوبون غير موجود أو غير صالح' });
    }

    res.json({
      success: true,
      data: {
        name: result.name,
        phone: result.phone,
        coupon_code: result.coupon_code,
        rating: result.rating,
        experience: result.experience,
        purchase_date: result.purchase_date,
        has_invoice: result.has_invoice === 1,
        invoice_filename: result.invoice_filename,
        invoice_original_name: result.invoice_original_name,
        token: result.token,
        created_at: result.created_at
      }
    });
  } catch (error) {
    console.error('Error searching coupon:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء البحث عن الكوبون' });
  }
});

// ============================================
// API: Get all surveys (admin endpoint)
// ============================================
app.get('/api/surveys', (req, res) => {
  try {
    const surveys = db.prepare('SELECT * FROM surveys ORDER BY created_at DESC').all();
    res.json({ success: true, data: surveys, total: surveys.length });
  } catch (error) {
    console.error('Error fetching surveys:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ في جلب البيانات' });
  }
});

// ============================================
// API: Delete a survey response (admin)
// ============================================
app.delete('/api/surveys/:id', (req, res) => {
  try {
    const { id } = req.params;
    
    // Delete from DB
    const result = db.prepare('DELETE FROM surveys WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'الرد غير موجود' });
    }
    
    res.json({ success: true, message: 'تم حذف الرد بنجاح' });
  } catch (error) {
    console.error('Error deleting survey:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء حذف الرد' });
  }
});

// ============================================
// API: Get survey stats
// ============================================
app.get('/api/stats', (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM surveys').get();
    const avgRating = db.prepare('SELECT AVG(rating) as avg FROM surveys').get();
    const bySource = db.prepare('SELECT source, COUNT(*) as count FROM surveys GROUP BY source').all();
    const byEmirate = db.prepare('SELECT emirate, COUNT(*) as count FROM surveys GROUP BY emirate').all();
    const purchased = db.prepare("SELECT purchased, COUNT(*) as count FROM surveys GROUP BY purchased").all();

    res.json({
      success: true,
      stats: {
        totalResponses: total.count,
        averageRating: avgRating.avg ? avgRating.avg.toFixed(1) : 0,
        bySource,
        byEmirate,
        purchased
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ في جلب الإحصائيات' });
  }
});

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Serve customer survey page at root '/' and '/survey'
app.get(['/', '/survey'], (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Function to automatically start ngrok tunnel and log public URL
function startNgrokTunnel(port) {
  try {
    const { spawn } = require('child_process');
    const ngrokBin = path.join(__dirname, 'node_modules', 'ngrok', 'bin', 'ngrok.exe');
    const isBinAvailable = fs.existsSync(ngrokBin);
    const spawnCmd = isBinAvailable ? ngrokBin : 'npx';
    const spawnArgs = isBinAvailable ? ['http', port, '--log=stdout'] : ['ngrok', 'http', port, '--log=stdout'];

    const tunnel = spawn(spawnCmd, spawnArgs, { shell: !isBinAvailable });

    tunnel.stdout.on('data', (data) => {
      const msg = data.toString();
      const match = msg.match(/url=(https:\/\/[^\s]+)/);
      if (match) {
        console.log('\n===============================================================');
        console.log('🌐 تم تشغيل ngrok بنجاح! موقعك متاح الآن للجميع خارج الشبكة المحلية:');
        console.log(`📋 رابط موقع الاستبيان:          ${match[1]}`);
        console.log(`📊 لوحة تحكم الإدارة:           ${match[1]}/admin`);
        console.log('===============================================================\n');
      }
    });
  } catch (e) {
    console.log(`💡 للتشغيل عبر ngrok يدوياً: npx ngrok http ${port}`);
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 السيرفر يعمل الآن بنجاح!`);
  console.log(`📋 رابط صفحة الاستبيان:    http://localhost:${PORT}`);
  console.log(`📊 لوحة تحكم الإدارة:      http://localhost:${PORT}/admin\n`);
  
  startNgrokTunnel(PORT);
});
