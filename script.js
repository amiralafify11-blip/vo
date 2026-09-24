// ========================================
// Survey Form Logic
// ========================================

let currentToken = null;
let audioBlob = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let recordingTimerInterval = null;
let recordingSeconds = 0;

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  initForm();
  initStarRating();
  initProgressTracker();
  initDatePresets();
  setMaxDate();
  checkForToken();
});

// ========================================
// 🔊 Text-to-Speech
// ========================================
function speakText(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ar-AE';
  utterance.rate = 0.85;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

// ========================================
// 🎤 Voice Recording
// ========================================
async function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    mediaRecorder = new MediaRecorder(stream, { mimeType });
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const url = URL.createObjectURL(audioBlob);
      const audio = document.getElementById('playback-audio');
      audio.src = url;
      audio.style.display = 'block';

      const statusEl = document.getElementById('record-status');
      statusEl.className = 'record-status done';
      statusEl.textContent = '✅ تم التسجيل - اضغط للاستماع أو أعد التسجيل';

      const btn = document.getElementById('record-btn');
      btn.className = 'record-btn';
      btn.innerHTML = '🔄 إعادة التسجيل';
    };

    mediaRecorder.start(100);
    isRecording = true;

    const btn = document.getElementById('record-btn');
    btn.className = 'record-btn recording';
    btn.innerHTML = '⏹️ إيقاف التسجيل';

    const statusEl = document.getElementById('record-status');
    statusEl.className = 'record-status active';
    statusEl.textContent = '🔴 جاري التسجيل...';

    // Timer
    recordingSeconds = 0;
    const timerEl = document.getElementById('recording-timer');
    timerEl.style.display = 'inline';
    recordingTimerInterval = setInterval(() => {
      recordingSeconds++;
      const m = Math.floor(recordingSeconds / 60).toString().padStart(2, '0');
      const s = (recordingSeconds % 60).toString().padStart(2, '0');
      timerEl.textContent = `${m}:${s}`;
      if (recordingSeconds >= 120) stopRecording(); // max 2 min
    }, 1000);

  } catch (err) {
    console.error('Microphone error:', err);
    const statusEl = document.getElementById('record-status');
    statusEl.className = 'record-status';
    statusEl.textContent = '❌ تعذر الوصول للميكروفون - اكتب يدوياً';
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
  }
  clearInterval(recordingTimerInterval);
  document.getElementById('recording-timer').style.display = 'none';
  isRecording = false;
}

// ========================================
// Dynamic Settings Loader
// ========================================
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (!data.success || !data.data) return;
    const s = data.data;

    if (s.meta_title) {
      document.title = s.meta_title;
      const ogTitle = document.getElementById('og-title');
      if (ogTitle) ogTitle.setAttribute('content', s.meta_title);
    }
    if (s.meta_desc) {
      const metaDesc = document.getElementById('meta-description');
      if (metaDesc) metaDesc.setAttribute('content', s.meta_desc);
      const ogDesc = document.getElementById('og-description');
      if (ogDesc) ogDesc.setAttribute('content', s.meta_desc);
    }
    if (s.store_name) {
      const el = document.getElementById('header-store-name');
      if (el) el.textContent = s.store_name;
    }
    if (s.branch_name) {
      const el = document.getElementById('header-branch-name');
      if (el) el.textContent = s.branch_name;
    }
    if (s.welcome_desc) {
      const el = document.getElementById('header-welcome-desc');
      if (el) el.textContent = s.welcome_desc;
    }
    if (s.discount_text) {
      const el = document.getElementById('coupon-discount-text');
      if (el) el.textContent = s.discount_text;
    }
    if (s.coupon_desc) {
      const el = document.getElementById('coupon-desc-text');
      if (el) el.textContent = s.coupon_desc;
    }
    if (s.maps_url) {
      defaultMapsUrl = s.maps_url;
      const el = document.getElementById('maps-link');
      if (el) el.href = defaultMapsUrl;
    }
    // Load branches
    if (s.branches) {
      try {
        const branches = JSON.parse(s.branches);
        renderBranches(branches);
      } catch (e) {}
    }
  } catch (e) {
    console.error('Error loading settings:', e);
  }
}

let defaultMapsUrl = 'https://maps.app.goo.gl/1UkyYkVRMNbsEvah6';

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function updateMapsLink(branchName, branchMapsUrl) {
  const mapsLink = document.getElementById('maps-link');
  if (!mapsLink) return;

  const targetUrl = (branchMapsUrl && branchMapsUrl.trim()) ? branchMapsUrl.trim() : defaultMapsUrl;
  mapsLink.href = targetUrl;

  if (branchName && branchName.trim()) {
    mapsLink.textContent = `📍 فتح خرائط جوجل وتقييم ${branchName.trim()}`;
  } else {
    mapsLink.textContent = '📍 فتح خرائط جوجل وتقييم المتجر';
  }
}

// ========================================
// Render Branch Options
// ========================================
function renderBranches(branches) {
  const container = document.getElementById('branch-options');
  const section = document.getElementById('branch-section');
  if (!branches || branches.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';

  container.innerHTML = branches.map(branch => {
    const name = typeof branch === 'string' ? branch : (branch.name || '');
    const maps = typeof branch === 'object' ? (branch.maps_url || '') : '';
    return `
      <label class="option-card">
        <input type="radio" name="branch" value="${escapeHtml(name)}" data-maps-url="${escapeHtml(maps)}">
        <span class="option-label">
          <span class="option-icon">🏪</span>
          ${escapeHtml(name)}
        </span>
      </label>
    `;
  }).join('');

  // Attach listener to update maps link when branch is chosen
  container.querySelectorAll('input[type=radio]').forEach(r => {
    r.addEventListener('change', () => {
      updateMapsLink(r.value, r.getAttribute('data-maps-url'));
      updateProgressExternal();
    });
  });
}

let updateProgressExternal = () => {};

// ========================================
// Token Detection & Link Info
// ========================================
async function checkForToken() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('t');
  if (!token) return;

  currentToken = token;

  try {
    const res = await fetch(`/api/links/${token}`);
    const data = await res.json();
    if (!data.success) return;

    const info = data.data;

    if (info.is_completed) {
      document.getElementById('survey-form').style.display = 'none';
      document.getElementById('progress-container').style.display = 'none';
      const successScreen = document.getElementById('success-screen');
      successScreen.classList.add('show');
      document.querySelector('.success-title').textContent = 'تم إكمال الاستبيان مسبقاً';
      document.querySelector('.success-subtitle').textContent = 'شكراً لك! يمكنك تحميل فاتورتك من الأسفل';

      if (info.has_invoice) {
        document.getElementById('invoice-card').style.display = 'block';
        document.getElementById('invoice-download-btn').href = `/api/invoice/${token}`;
      }
      return;
    }

    if (info.customer_name) document.getElementById('name').value = info.customer_name;
    if (info.phone) document.getElementById('phone').value = info.phone;

    if (info.has_invoice) {
      const header = document.getElementById('survey-header');
      const notice = document.createElement('div');
      notice.style.cssText = 'margin-top: 12px; padding: 10px 16px; background: linear-gradient(135deg, #d1fae5, #a7f3d0); border-radius: 10px; font-size: 0.85rem; color: #065f46; font-weight: 600;';
      notice.textContent = '🧾 فاتورتك جاهزة! أكمل الاستبيان لتتمكن من تحميلها';
      header.appendChild(notice);
    }
  } catch (e) {
    console.error('Error checking token:', e);
  }
}

// Set max date to today
function setMaxDate() {
  const dateInput = document.getElementById('purchase-date');
  if (dateInput) {
    dateInput.setAttribute('max', new Date().toISOString().split('T')[0]);
  }
}

// ========================================
// Date Presets Handler
// ========================================
function initDatePresets() {
  const presets = document.querySelectorAll('input[name="date_preset"]');
  const customDateContainer = document.getElementById('custom-date-container');
  const customDateInput = document.getElementById('purchase-date');

  presets.forEach(preset => {
    preset.addEventListener('change', () => {
      if (preset.value === 'custom') {
        customDateContainer.style.display = 'block';
        customDateInput.setAttribute('required', 'true');
      } else {
        customDateContainer.style.display = 'none';
        customDateInput.removeAttribute('required');
        customDateInput.value = '';
      }
    });
  });
}

// ========================================
// Progress Tracker
// ========================================
function initProgressTracker() {
  const textFields = ['name', 'phone'];
  const radioGroups = ['purchased', 'source', 'rating'];
  const select = document.getElementById('emirate');

  function updateProgress() {
    let filled = 0;
    let total = 7; // base fields

    textFields.forEach(id => {
      if (document.getElementById(id).value.trim()) filled++;
    });

    const datePresetChecked = document.querySelector('input[name="date_preset"]:checked');
    if (datePresetChecked) {
      if (datePresetChecked.value === 'custom') {
        if (document.getElementById('purchase-date').value) filled++;
      } else {
        filled++;
      }
    }

    radioGroups.forEach(name => {
      if (document.querySelector(`input[name="${name}"]:checked`)) filled++;
    });

    if (select.value) filled++;

    // Experience: text or audio
    const hasText = document.getElementById('experience').value.trim();
    const hasAudio = !!audioBlob;
    if (hasText || hasAudio) filled++;

    // Branch (if visible)
    const branchSection = document.getElementById('branch-section');
    if (branchSection.style.display !== 'none') {
      total++;
      if (document.querySelector('input[name="branch"]:checked')) filled++;
    }

    const percent = Math.round((filled / total) * 100);
    document.getElementById('progress-fill').style.width = percent + '%';
    document.getElementById('progress-label').textContent = percent + '% مكتمل';
    const step = Math.min(filled + 1, total);
    document.getElementById('progress-step').textContent = `الخطوة ${step} من ${total}`;
  }

  updateProgressExternal = updateProgress;

  textFields.forEach(id => {
    document.getElementById(id).addEventListener('input', updateProgress);
  });
  document.getElementById('experience').addEventListener('input', updateProgress);
  document.querySelectorAll('input[name="date_preset"]').forEach(r => r.addEventListener('change', updateProgress));
  document.getElementById('purchase-date').addEventListener('change', updateProgress);
  radioGroups.forEach(name => {
    document.querySelectorAll(`input[name="${name}"]`).forEach(r => r.addEventListener('change', updateProgress));
  });
  select.addEventListener('change', updateProgress);

  // Watch audio blob changes
  const origToggle = window.toggleRecording;
  window.toggleRecording = async function() {
    await origToggle ? origToggle() : toggleRecording();
    setTimeout(updateProgress, 500);
  };
}

// ========================================
// Star Rating
// ========================================
function initStarRating() {
  const ratingTexts = { 1: '😞 ضعيف', 2: '😐 مقبول', 3: '🙂 جيد', 4: '😊 جيد جداً', 5: '🤩 ممتاز!' };
  document.querySelectorAll('.star-rating input').forEach(input => {
    input.addEventListener('change', () => {
      const value = parseInt(input.value);
      document.getElementById('rating-text').textContent = ratingTexts[value] || '';
      document.getElementById('rating-text').style.color = '#f59e0b';
    });
  });
}

// ========================================
// Form Submission
// ========================================
function initForm() {
  const form = document.getElementById('survey-form');
  const submitBtn = document.getElementById('submit-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    if (!validateForm()) return;

    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    const data = {
      name: document.getElementById('name').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      purchase_date: getSelectedDate(),
      source: document.querySelector('input[name="source"]:checked').value,
      purchased: document.querySelector('input[name="purchased"]:checked').value,
      emirate: document.getElementById('emirate').value,
      experience: document.getElementById('experience').value.trim(),
      rating: parseInt(document.querySelector('input[name="rating"]:checked').value),
      token: currentToken,
      has_audio: !!audioBlob
    };

    const branchChecked = document.querySelector('input[name="branch"]:checked');
    if (branchChecked) data.branch = branchChecked.value;

    try {
      const response = await fetch('/api/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await response.json();

      if (result.success) {
        // Upload audio if recorded
        if (audioBlob && result.id) {
          try {
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.webm');
            await fetch(`/api/recordings/${result.id}`, { method: 'POST', body: formData });
          } catch (audioErr) {
            console.error('Audio upload failed:', audioErr);
          }
        }
        showSuccess(result.coupon, result.has_invoice, result.token);
      } else {
        showToast(result.message || 'حدث خطأ، يرجى المحاولة مرة أخرى', 'error');
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
      }
    } catch (error) {
      showToast('خطأ في الاتصال بالخادم', 'error');
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
    }
  });
}

function getSelectedDate() {
  const preset = document.querySelector('input[name="date_preset"]:checked');
  if (!preset) return '';
  const today = new Date();
  if (preset.value === 'today') return today.toISOString().split('T')[0];
  if (preset.value === 'yesterday') {
    const y = new Date(today);
    y.setDate(today.getDate() - 1);
    return y.toISOString().split('T')[0];
  }
  return document.getElementById('purchase-date').value;
}

// ========================================
// Validation
// ========================================
function validateForm() {
  let isValid = true;

  const name = document.getElementById('name');
  if (!name.value.trim()) { showError('name', 'name-error'); isValid = false; }

  const phone = document.getElementById('phone');
  if (!phone.value.trim() || !/^[\d\s\+\-()]{7,15}$/.test(phone.value.trim())) {
    showError('phone', 'phone-error'); isValid = false;
  }

  // Date
  const datePresetChecked = document.querySelector('input[name="date_preset"]:checked');
  if (!datePresetChecked) {
    document.getElementById('date-error').classList.add('show'); isValid = false;
  } else if (datePresetChecked.value === 'custom' && !document.getElementById('purchase-date').value) {
    showError('purchase-date', 'date-error'); isValid = false;
  }

  // Branch (if visible)
  const branchSection = document.getElementById('branch-section');
  if (branchSection.style.display !== 'none') {
    if (!document.querySelector('input[name="branch"]:checked')) {
      document.getElementById('branch-error').classList.add('show'); isValid = false;
    }
  }

  if (!document.querySelector('input[name="purchased"]:checked')) {
    document.getElementById('purchased-error').classList.add('show'); isValid = false;
  }
  if (!document.querySelector('input[name="source"]:checked')) {
    document.getElementById('source-error').classList.add('show'); isValid = false;
  }
  if (!document.getElementById('emirate').value) {
    showError('emirate', 'emirate-error'); isValid = false;
  }

  // Experience: text OR audio
  const hasText = document.getElementById('experience').value.trim();
  const hasAudio = !!audioBlob;
  if (!hasText && !hasAudio) {
    showError('experience', 'experience-error'); isValid = false;
  }

  if (!document.querySelector('input[name="rating"]:checked')) {
    document.getElementById('rating-error').classList.add('show'); isValid = false;
  }

  if (!isValid) {
    showToast('يرجى ملء جميع الحقول المطلوبة', 'error');
    const firstError = document.querySelector('.form-input.error, .error-message.show');
    if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return isValid;
}

function showError(inputId, errorId) {
  const inp = document.getElementById(inputId);
  if (inp) inp.classList.add('error');
  const err = document.getElementById(errorId);
  if (err) err.classList.add('show');
}

function clearErrors() {
  document.querySelectorAll('.form-input.error').forEach(el => el.classList.remove('error'));
  document.querySelectorAll('.error-message.show').forEach(el => el.classList.remove('show'));
}

// ========================================
// Success Screen
// ========================================
function showSuccess(couponCode, hasInvoice, token) {
  document.getElementById('survey-form').style.display = 'none';
  document.getElementById('progress-container').style.display = 'none';
  document.getElementById('coupon-value').textContent = couponCode;

  if (hasInvoice && token) {
    document.getElementById('invoice-card').style.display = 'block';
    document.getElementById('invoice-download-btn').href = `/api/invoice/${token}`;
  }

  // Update maps button based on chosen branch
  const selectedBranchRadio = document.querySelector('input[name="branch"]:checked');
  if (selectedBranchRadio) {
    updateMapsLink(selectedBranchRadio.value, selectedBranchRadio.getAttribute('data-maps-url'));
  }

  document.getElementById('success-screen').classList.add('show');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  launchConfetti();
}

// ========================================
// Copy Coupon
// ========================================
function copyCoupon() {
  const code = document.getElementById('coupon-value').textContent;
  navigator.clipboard.writeText(code).then(() => {
    document.getElementById('copy-tooltip').classList.add('show');
    setTimeout(() => document.getElementById('copy-tooltip').classList.remove('show'), 2000);
    showToast('تم نسخ كود الخصم! 📋', 'success');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = code;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('تم نسخ كود الخصم! 📋', 'success');
  });
}

// ========================================
// Toast
// ========================================
function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast ' + type;
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => toast.classList.remove('show'), 3500);
}

// ========================================
// Confetti
// ========================================
function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles = [];
  const colors = ['#f59e0b', '#8b5cf6', '#3b82f6', '#10b981', '#f43f5e', '#06b6d4'];

  for (let i = 0; i < 120; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      size: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      speedX: (Math.random() - 0.5) * 4,
      speedY: Math.random() * 3 + 2,
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 10,
      opacity: 1
    });
  }

  let animationFrame;
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let active = 0;
    particles.forEach(p => {
      if (p.opacity <= 0) return;
      active++;
      p.x += p.speedX; p.y += p.speedY;
      p.rotation += p.rotationSpeed; p.speedY += 0.05;
      if (p.y > canvas.height * 0.7) p.opacity -= 0.02;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    });
    if (active > 0) animationFrame = requestAnimationFrame(animate);
    else { ctx.clearRect(0, 0, canvas.width, canvas.height); cancelAnimationFrame(animationFrame); }
  }
  animate();
  window.addEventListener('resize', () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; });
}

document.querySelectorAll('.form-input').forEach(input => {
  if (input.tagName !== 'TEXTAREA') {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
  }
});
