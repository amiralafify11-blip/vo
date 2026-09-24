const express = require('express');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// GitHub Configuration
// ============================================
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const GITHUB_OWNER  = process.env.GITHUB_OWNER  || 'amiralafify11-blip';
const GITHUB_REPO   = process.env.GITHUB_REPO   || 'vo';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

// ============================================
// In-memory cache (cleared on each write so
// data is always fresh after mutations)
// ============================================
const cache = {
  links: null, linksSha: null,
  surveys: null, surveysSha: null,
  settings: null, settingsSha: null
};

// ============================================
// Default Settings
// ============================================
const defaultSettings = {
  store_name:    'أمير العفيفي للهواتف',
  branch_name:   'فرع الشارقة 🇦🇪',
  meta_title:    'استبيان رضا العملاء - أمير العفيفي للهواتف',
  meta_desc:     'استبيان رضا العملاء - أمير العفيفي للهواتف (فرع الشارقة) - شاركنا رأيك واحصل على كوبون خصم 20% على الإكسسوارات',
  welcome_desc:  'شاركنا رأيك في تجربة شرائك واحصل على كوبون خصم 20% فوراً!',
  discount_text: 'خصم 20%',
  coupon_desc:   'على جميع الاكسسوارات لدى أمير العفيفي للهواتف (فرع الشارقة) في زيارتك القادمة',
  maps_url:      'https://maps.app.goo.gl/1UkyYkVRMNbsEvah6',
  branches:      JSON.stringify([{ name: 'فرع الشارقة 🇦🇪', maps_url: 'https://maps.app.goo.gl/1UkyYkVRMNbsEvah6' }])
};

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ============================================
// GitHub API Helpers
// ============================================
function githubRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path: apiPath,
      method: method,
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'User-Agent': 'customer-survey-app/1.0',
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(responseData) });
        } catch (e) {
          resolve({ status: res.statusCode, data: responseData });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function readJsonFromGitHub(filePath) {
  const res = await githubRequest('GET',
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`);
  if (res.status === 404) return { data: null, sha: null };
  if (res.status !== 200) throw new Error(`GitHub read error: ${res.status}`);
  const raw = Buffer.from(res.data.content.replace(/\n/g, ''), 'base64').toString('utf8');
  return { data: JSON.parse(raw), sha: res.data.sha };
}

async function writeJsonToGitHub(filePath, data, sha, message) {
  const content = Buffer.from(JSON.stringify(data, null, 2), 'utf8').toString('base64');
  const body = { message: message || `Update ${filePath}`, content, branch: GITHUB_BRANCH };
  if (sha) body.sha = sha;

  const res = await githubRequest('PUT',
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`, body);
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`GitHub write error ${res.status}: ${JSON.stringify(res.data?.message)}`);
  }
  return res.data.content?.sha;
}

async function writeBinaryToGitHub(filePath, buffer, sha, message) {
  const content = buffer.toString('base64');
  const body = { message: message || `Upload ${filePath}`, content, branch: GITHUB_BRANCH };
  if (sha) body.sha = sha;

  const res = await githubRequest('PUT',
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`, body);
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`GitHub write error ${res.status}`);
  }
  return res.data.content?.sha;
}

async function readBinaryFromGitHub(filePath) {
  const res = await githubRequest('GET',
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`GitHub read error: ${res.status}`);
  const buffer = Buffer.from(res.data.content.replace(/\n/g, ''), 'base64');
  return { buffer, sha: res.data.sha };
}

async function deleteFromGitHub(filePath, sha, message) {
  const body = { message: message || `Delete ${filePath}`, sha, branch: GITHUB_BRANCH };
  const res = await githubRequest('DELETE',
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`, body);
  return res.status === 200;
}

// ============================================
// Cached Data Access
// ============================================
async function getLinks(forceRefresh) {
  if (forceRefresh || cache.links === null) {
    const { data, sha } = await readJsonFromGitHub('data/links.json');
    cache.links = data || [];
    cache.linksSha = sha;
  }
  return { links: cache.links, sha: cache.linksSha };
}

async function persistLinks(links, sha) {
  const newSha = await writeJsonToGitHub('data/links.json', links, sha, 'Update customer links');
  cache.links = links;
  cache.linksSha = newSha || sha;
}

async function getSurveys(forceRefresh) {
  if (forceRefresh || cache.surveys === null) {
    const { data, sha } = await readJsonFromGitHub('data/surveys.json');
    cache.surveys = data || [];
    cache.surveysSha = sha;
  }
  return { surveys: cache.surveys, sha: cache.surveysSha };
}

async function persistSurveys(surveys, sha) {
  const newSha = await writeJsonToGitHub('data/surveys.json', surveys, sha, 'Update surveys');
  cache.surveys = surveys;
  cache.surveysSha = newSha || sha;
}

async function getSettings(forceRefresh) {
  if (forceRefresh || cache.settings === null) {
    const { data, sha } = await readJsonFromGitHub('data/settings.json');
    cache.settings = data ? { ...defaultSettings, ...data } : { ...defaultSettings };
    cache.settingsSha = sha;
  }
  return { settings: cache.settings, sha: cache.settingsSha };
}

async function persistSettings(settings, sha) {
  const newSha = await writeJsonToGitHub('data/settings.json', settings, sha, 'Update settings');
  cache.settings = settings;
  cache.settingsSha = newSha || sha;
}

// ============================================
// Multer-free file upload (multipart parser)
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

  let start = indexOf(buffer, boundaryBuffer, 0);
  if (start === -1) return parts;

  while (true) {
    start = start + boundaryBuffer.length + 2;
    const end = indexOf(buffer, boundaryBuffer, start);
    if (end === -1) break;

    const partData = buffer.slice(start, end - 2);
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
// API: Get Settings
// ============================================
app.get('/api/settings', async (req, res) => {
  try {
    const refresh = !!req.query.refresh;
    const { settings } = await getSettings(refresh);
    res.json({ success: true, data: settings });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ في جلب الإعدادات' });
  }
});

// ============================================
// API: Save Settings
// ============================================
app.post('/api/settings', async (req, res) => {
  try {
    const { settings, sha } = await getSettings(true);
    const updated = { ...settings };
    for (const [key, val] of Object.entries(req.body)) {
      if (typeof val === 'string') updated[key] = val;
    }
    await persistSettings(updated, sha);
    res.json({ success: true, message: 'تم حفظ الإعدادات بنجاح!' });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء حفظ الإعدادات' });
  }
});

// ============================================
// API: Create customer link (from admin)
// ============================================
app.post('/api/links', multerFree, async (req, res) => {
  try {
    const { customer_name, phone } = req.body;

    if (!customer_name) {
      return res.status(400).json({ success: false, message: 'اسم العميل مطلوب' });
    }

    const token = crypto.randomBytes(8).toString('hex');
    let invoiceFilename = null;
    let invoiceOriginalName = null;
    let hasInvoice = false;

    if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (ext !== '.pdf') {
        return res.status(400).json({ success: false, message: 'عذراً، يجب رفع الفاتورة بصيغة PDF فقط' });
      }
      invoiceFilename = `invoice_${token}.pdf`;
      invoiceOriginalName = req.file.originalname;
      hasInvoice = true;

      // Upload PDF to GitHub
      await writeBinaryToGitHub(
        `data/invoices/${invoiceFilename}`,
        req.file.buffer,
        null,
        `Upload invoice for ${customer_name}`
      );
    }

    const newLink = {
      id: Date.now(),
      token,
      customer_name,
      phone: phone || '',
      has_invoice: hasInvoice,
      invoice_filename: invoiceFilename,
      invoice_original_name: invoiceOriginalName,
      is_completed: false,
      created_at: new Date().toISOString()
    };

    // Re-read fresh from GitHub before writing to avoid SHA conflict
    const { links, sha } = await getLinks(true);
    links.unshift(newLink);
    await persistLinks(links, sha);

    res.json({
      success: true,
      token,
      link: `/?t=${token}`,
      has_invoice: hasInvoice
    });
  } catch (error) {
    console.error('Error creating link:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ في إنشاء الرابط' });
  }
});

// ============================================
// API: Get link info (for survey page)
// ============================================
app.get('/api/links/:token', async (req, res) => {
  try {
    const { links } = await getLinks();
    const link = links.find(l => l.token === req.params.token);

    if (!link) {
      return res.status(404).json({ success: false, message: 'رابط غير صالح' });
    }

    res.json({
      success: true,
      data: {
        customer_name: link.customer_name,
        phone: link.phone,
        has_invoice: link.has_invoice,
        is_completed: link.is_completed
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
app.get('/api/links', async (req, res) => {
  try {
    const refresh = !!req.query.refresh;
    const { links } = await getLinks(refresh);
    res.json({ success: true, data: links });
  } catch (error) {
    console.error('Error fetching links:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ' });
  }
});

// ============================================
// API: Delete a customer link (admin)
// ============================================
app.delete('/api/links/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { links, sha } = await getLinks(true);
    const linkIndex = links.findIndex(l => l.id === id);

    if (linkIndex === -1) {
      return res.status(404).json({ success: false, message: 'الرابط غير موجود' });
    }

    const link = links[linkIndex];

    // Delete invoice PDF from GitHub if exists
    if (link.has_invoice && link.invoice_filename) {
      try {
        const inv = await readBinaryFromGitHub(`data/invoices/${link.invoice_filename}`);
        if (inv) {
          await deleteFromGitHub(
            `data/invoices/${link.invoice_filename}`,
            inv.sha,
            `Delete invoice for ${link.customer_name}`
          );
        }
      } catch (e) {
        console.error('Could not delete invoice file:', e.message);
      }
    }

    links.splice(linkIndex, 1);
    await persistLinks(links, sha);

    res.json({ success: true, message: 'تم حذف الرابط والملفات المرتبطة بنجاح' });
  } catch (error) {
    console.error('Error deleting link:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء حذف الرابط' });
  }
});

// ============================================
// API: Download invoice (only after survey completion)
// ============================================
app.get('/api/invoice/:token', async (req, res) => {
  try {
    const { links } = await getLinks();
    const link = links.find(l => l.token === req.params.token);

    if (!link) return res.status(404).json({ success: false, message: 'رابط غير صالح' });
    if (!link.has_invoice) return res.status(404).json({ success: false, message: 'لا توجد فاتورة مرفقة' });
    if (!link.is_completed) return res.status(403).json({ success: false, message: 'يجب إكمال الاستبيان أولاً لتحميل الفاتورة' });
    if (!link.invoice_filename) return res.status(404).json({ success: false, message: 'ملف الفاتورة غير موجود' });

    // Redirect directly to GitHub raw content URL (bypasses Netlify binary proxy corruption)
    const rawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/data/invoices/${link.invoice_filename}`;
    res.redirect(302, rawUrl);
  } catch (error) {
    console.error('Error downloading invoice:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ في تحميل الفاتورة' });
  }
});

// ============================================
// API: Submit survey
// ============================================
app.post('/api/survey', async (req, res) => {
  try {
    const { name, phone, purchase_date, source, purchased, emirate, experience, rating, token, branch } = req.body;

    if (!name || !phone || !purchase_date || !source || !purchased || !emirate || !rating) {
      return res.status(400).json({ success: false, message: 'جميع الحقول المطلوبة يجب ملؤها' });
    }
    if (!experience && !req.body.has_audio) {
      return res.status(400).json({ success: false, message: 'يرجى كتابة تجربتك أو تسجيل ملاحظة صوتية' });
    }

    const couponCode = 'ACC20-' + crypto.randomBytes(3).toString('hex').toUpperCase();

    const newSurvey = {
      id: Date.now(),
      name, phone, purchase_date, source, purchased, emirate,
      branch: branch || null,
      experience: experience || '',
      audio_filename: null,
      rating: parseInt(rating),
      token: token || null,
      coupon_code: couponCode,
      created_at: new Date().toISOString()
    };

    const { surveys, sha: surveysSha } = await getSurveys(true);
    surveys.unshift(newSurvey);
    await persistSurveys(surveys, surveysSha);

    // Mark link as completed if token exists
    let hasInvoice = false;
    if (token) {
      const { links, sha: linksSha } = await getLinks(true);
      const linkIndex = links.findIndex(l => l.token === token);
      if (linkIndex !== -1) {
        links[linkIndex].is_completed = true;
        hasInvoice = links[linkIndex].has_invoice;
        await persistLinks(links, linksSha);
      }
    }

    res.json({
      success: true,
      message: 'تم إرسال الاستبيان بنجاح!',
      id: newSurvey.id,
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
// API: Upload audio recording for a survey
// ============================================
app.post('/api/recordings/:surveyId', multerFree, async (req, res) => {
  try {
    const surveyId = parseInt(req.params.surveyId);
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'لا يوجد ملف صوتي' });
    }

    const audioFilename = `rec_${surveyId}.webm`;
    await writeBinaryToGitHub(
      `data/recordings/${audioFilename}`,
      req.file.buffer,
      null,
      `Upload audio recording for survey ${surveyId}`
    );

    // Update survey record with audio_filename
    const { surveys, sha } = await getSurveys(true);
    const idx = surveys.findIndex(s => s.id === surveyId);
    if (idx !== -1) {
      surveys[idx].audio_filename = audioFilename;
      await persistSurveys(surveys, sha);
    }

    res.json({ success: true, filename: audioFilename });
  } catch (error) {
    console.error('Error uploading recording:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ في رفع التسجيل' });
  }
});

// ============================================
// API: Get audio recording
// ============================================
app.get('/api/recordings/:surveyId', async (req, res) => {
  try {
    const surveyId = req.params.surveyId;
    const audioFilename = `rec_${surveyId}.webm`;
    const audioData = await readBinaryFromGitHub(`data/recordings/${audioFilename}`);
    if (!audioData) {
      return res.status(404).json({ success: false, message: 'التسجيل غير موجود' });
    }
    res.setHeader('Content-Type', 'audio/webm');
    res.setHeader('Content-Disposition', `inline; filename="${audioFilename}"`);
    res.send(audioData.buffer);
  } catch (error) {
    console.error('Error fetching recording:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ في جلب التسجيل' });
  }
});

// ============================================
// API: Search by coupon code
// ============================================
app.get('/api/coupon/:code', async (req, res) => {
  try {
    const code = req.params.code.trim().toUpperCase();
    const { surveys } = await getSurveys();
    const result = surveys.find(s => s.coupon_code && s.coupon_code.toUpperCase() === code);

    if (!result) {
      return res.status(404).json({ success: false, message: 'الكوبون غير موجود أو غير صالح' });
    }

    const { links } = await getLinks();
    const link = result.token ? links.find(l => l.token === result.token) : null;

    res.json({
      success: true,
      data: {
        name: result.name,
        phone: result.phone,
        coupon_code: result.coupon_code,
        rating: result.rating,
        experience: result.experience,
        purchase_date: result.purchase_date,
        has_invoice: link ? link.has_invoice : false,
        invoice_filename: link ? link.invoice_filename : null,
        invoice_original_name: link ? link.invoice_original_name : null,
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
// API: Get all surveys (admin)
// ============================================
app.get('/api/surveys', async (req, res) => {
  try {
    const refresh = !!req.query.refresh;
    const { surveys } = await getSurveys(refresh);
    res.json({ success: true, data: surveys, total: surveys.length });
  } catch (error) {
    console.error('Error fetching surveys:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ في جلب البيانات' });
  }
});

// ============================================
// API: Delete a survey response (admin)
// ============================================
app.delete('/api/surveys/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { surveys, sha } = await getSurveys(true);
    const idx = surveys.findIndex(s => s.id === id);

    if (idx === -1) {
      return res.status(404).json({ success: false, message: 'الرد غير موجود' });
    }

    surveys.splice(idx, 1);
    await persistSurveys(surveys, sha);
    res.json({ success: true, message: 'تم حذف الرد بنجاح' });
  } catch (error) {
    console.error('Error deleting survey:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء حذف الرد' });
  }
});

// ============================================
// API: Get survey stats
// ============================================
app.get('/api/stats', async (req, res) => {
  try {
    const { surveys } = await getSurveys();
    const total = surveys.length;
    const avgRating = total > 0
      ? surveys.reduce((sum, s) => sum + (s.rating || 0), 0) / total
      : 0;

    const sourceMap = {}, emirateMap = {}, purchasedMap = {};
    surveys.forEach(s => {
      sourceMap[s.source]     = (sourceMap[s.source]     || 0) + 1;
      emirateMap[s.emirate]   = (emirateMap[s.emirate]   || 0) + 1;
      purchasedMap[s.purchased] = (purchasedMap[s.purchased] || 0) + 1;
    });

    res.json({
      success: true,
      stats: {
        totalResponses: total,
        averageRating: avgRating ? avgRating.toFixed(1) : 0,
        bySource:   Object.entries(sourceMap).map(([source, count])     => ({ source, count })),
        byEmirate:  Object.entries(emirateMap).map(([emirate, count])   => ({ emirate, count })),
        purchased:  Object.entries(purchasedMap).map(([purchased, count]) => ({ purchased, count }))
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, message: 'حدث خطأ في جلب الإحصائيات' });
  }
});

// ============================================
// Serve pages
// ============================================
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get(['/', '/survey'], (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ============================================
// Start server
// ============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 السيرفر يعمل الآن بنجاح!`);
  console.log(`📋 رابط صفحة الاستبيان:    http://localhost:${PORT}`);
  console.log(`📊 لوحة تحكم الإدارة:      http://localhost:${PORT}/admin`);
  console.log(`💾 التخزين: GitHub API → ${GITHUB_OWNER}/${GITHUB_REPO} (${GITHUB_BRANCH})\n`);
});
