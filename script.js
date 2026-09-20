// ========================================
// Survey Form Logic
// ========================================

// Global token variable
let currentToken = null;

document.addEventListener('DOMContentLoaded', () => {
  initForm();
  initStarRating();
  initProgressTracker();
  initDatePresets();
  setMaxDate();
  checkForToken();
});

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

    // If survey already completed for this token, show success directly
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

    // Pre-fill name and phone
    if (info.customer_name) {
      document.getElementById('name').value = info.customer_name;
    }
    if (info.phone) {
      document.getElementById('phone').value = info.phone;
    }

    // Show notice if invoice is attached
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
    const today = new Date().toISOString().split('T')[0];
    dateInput.setAttribute('max', today);
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
        customDateInput.value = ''; // Reset custom date value
      }
    });
  });
}

// ========================================
// Progress Tracker
// ========================================
function initProgressTracker() {
  const fields = ['name', 'phone', 'experience'];
  const radioGroups = ['purchased', 'source', 'rating'];
  const select = document.getElementById('emirate');

  function updateProgress() {
    let filled = 0;
    const total = 8; // Total required fields

    // Text inputs
    fields.forEach(id => {
      if (document.getElementById(id).value.trim()) filled++;
    });

    // Date Preset check
    const datePresetChecked = document.querySelector('input[name="date_preset"]:checked');
    if (datePresetChecked) {
      if (datePresetChecked.value === 'custom') {
        if (document.getElementById('purchase-date').value) filled++;
      } else {
        filled++;
      }
    }

    // Radio groups
    radioGroups.forEach(name => {
      if (document.querySelector(`input[name="${name}"]:checked`)) filled++;
    });

    // Select
    if (select.value) filled++;

    const percent = Math.round((filled / total) * 100);
    document.getElementById('progress-fill').style.width = percent + '%';
    document.getElementById('progress-label').textContent = percent + '% مكتمل';

    const step = Math.min(filled + 1, total);
    document.getElementById('progress-step').textContent = `الخطوة ${step} من ${total}`;
  }

  // Attach listeners
  fields.forEach(id => {
    document.getElementById(id).addEventListener('input', updateProgress);
  });

  document.querySelectorAll('input[name="date_preset"]').forEach(radio => {
    radio.addEventListener('change', updateProgress);
  });
  document.getElementById('purchase-date').addEventListener('change', updateProgress);

  radioGroups.forEach(name => {
    document.querySelectorAll(`input[name="${name}"]`).forEach(radio => {
      radio.addEventListener('change', updateProgress);
    });
  });

  select.addEventListener('change', updateProgress);
}

// ========================================
// Star Rating
// ========================================
function initStarRating() {
  const ratingTexts = {
    1: '😞 ضعيف',
    2: '😐 مقبول',
    3: '🙂 جيد',
    4: '😊 جيد جداً',
    5: '🤩 ممتاز!'
  };

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

    // Clear previous errors
    clearErrors();

    // Validate
    if (!validateForm()) return;

    // Show loading
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    // Collect data
    const data = {
      name: document.getElementById('name').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      purchase_date: getSelectedDate(),
      source: document.querySelector('input[name="source"]:checked').value,
      purchased: document.querySelector('input[name="purchased"]:checked').value,
      emirate: document.getElementById('emirate').value,
      experience: document.getElementById('experience').value.trim(),
      rating: parseInt(document.querySelector('input[name="rating"]:checked').value),
      token: currentToken
    };

    try {
      const response = await fetch('/api/survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      const result = await response.json();

      if (result.success) {
        showSuccess(result.coupon, result.has_invoice, result.token);
      } else {
        showToast(result.message || 'حدث خطأ، يرجى المحاولة مرة أخرى', 'error');
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
      }
    } catch (error) {
      showToast('خطأ في الاتصال بالخادم، تأكد من اتصالك بالإنترنت', 'error');
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
    }
  });
}

function getSelectedDate() {
  const preset = document.querySelector('input[name="date_preset"]:checked');
  if (!preset) return '';

  const today = new Date();
  if (preset.value === 'today') {
    return today.toISOString().split('T')[0];
  } else if (preset.value === 'yesterday') {
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    return yesterday.toISOString().split('T')[0];
  } else if (preset.value === 'custom') {
    return document.getElementById('purchase-date').value;
  }
  return '';
}

// ========================================
// Validation
// ========================================
function validateForm() {
  let isValid = true;

  // Name
  const name = document.getElementById('name');
  if (!name.value.trim()) {
    showError('name', 'name-error');
    isValid = false;
  }

  // Phone
  const phone = document.getElementById('phone');
  const phoneRegex = /^[\d\s\+\-()]{7,15}$/;
  if (!phone.value.trim() || !phoneRegex.test(phone.value.trim())) {
    showError('phone', 'phone-error');
    isValid = false;
  }

  // Date
  const datePresetChecked = document.querySelector('input[name="date_preset"]:checked');
  if (!datePresetChecked) {
    document.getElementById('date-error').classList.add('show');
    isValid = false;
  } else if (datePresetChecked.value === 'custom') {
    const dateInput = document.getElementById('purchase-date');
    if (!dateInput.value) {
      showError('purchase-date', 'date-error');
      isValid = false;
    }
  }

  // Purchased
  if (!document.querySelector('input[name="purchased"]:checked')) {
    document.getElementById('purchased-error').classList.add('show');
    isValid = false;
  }

  // Source
  if (!document.querySelector('input[name="source"]:checked')) {
    document.getElementById('source-error').classList.add('show');
    isValid = false;
  }

  // Emirate
  const emirate = document.getElementById('emirate');
  if (!emirate.value) {
    showError('emirate', 'emirate-error');
    isValid = false;
  }

  // Experience
  const experience = document.getElementById('experience');
  if (!experience.value.trim()) {
    showError('experience', 'experience-error');
    isValid = false;
  }

  // Rating
  if (!document.querySelector('input[name="rating"]:checked')) {
    document.getElementById('rating-error').classList.add('show');
    isValid = false;
  }

  if (!isValid) {
    showToast('يرجى ملء جميع الحقول المطلوبة', 'error');
    // Scroll to first error
    const firstError = document.querySelector('.form-input.error, .error-message.show');
    if (firstError) {
      firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  return isValid;
}

function showError(inputId, errorId) {
  document.getElementById(inputId).classList.add('error');
  document.getElementById(errorId).classList.add('show');
}

function clearErrors() {
  document.querySelectorAll('.form-input.error').forEach(el => el.classList.remove('error'));
  document.querySelectorAll('.error-message.show').forEach(el => el.classList.remove('show'));
}

// ========================================
// Success Screen
// ========================================
function showSuccess(couponCode, hasInvoice, token) {
  // Hide form and progress
  document.getElementById('survey-form').style.display = 'none';
  document.getElementById('progress-container').style.display = 'none';

  // Update coupon code
  document.getElementById('coupon-value').textContent = couponCode;

  // Show invoice download if available
  if (hasInvoice && token) {
    document.getElementById('invoice-card').style.display = 'block';
    document.getElementById('invoice-download-btn').href = `/api/invoice/${token}`;
  }

  // Show success
  const successScreen = document.getElementById('success-screen');
  successScreen.classList.add('show');

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Launch confetti
  launchConfetti();
}

// ========================================
// Copy Coupon
// ========================================
function copyCoupon() {
  const code = document.getElementById('coupon-value').textContent;
  navigator.clipboard.writeText(code).then(() => {
    const tooltip = document.getElementById('copy-tooltip');
    tooltip.classList.add('show');
    setTimeout(() => tooltip.classList.remove('show'), 2000);
    showToast('تم نسخ كود الخصم! 📋', 'success');
  }).catch(() => {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = code;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('تم نسخ كود الخصم! 📋', 'success');
  });
}

// ========================================
// Toast Notification
// ========================================
function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast ' + type;

  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

// ========================================
// Confetti Animation
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
    let activeParticles = 0;

    particles.forEach(p => {
      if (p.opacity <= 0) return;
      activeParticles++;

      p.x += p.speedX;
      p.y += p.speedY;
      p.rotation += p.rotationSpeed;
      p.speedY += 0.05;

      if (p.y > canvas.height * 0.7) {
        p.opacity -= 0.02;
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    });

    if (activeParticles > 0) {
      animationFrame = requestAnimationFrame(animate);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      cancelAnimationFrame(animationFrame);
    }
  }

  animate();

  // Resize handler
  window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  });
}

// Remove focus from inputs on Enter
document.querySelectorAll('.form-input').forEach(input => {
  if (input.tagName !== 'TEXTAREA') {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
    });
  }
});
