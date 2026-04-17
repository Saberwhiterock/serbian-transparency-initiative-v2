// ─── MOBILE NAV ───
const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('navLinks');

hamburger.addEventListener('click', () => {
  navLinks.classList.toggle('open');
});

navLinks.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => navLinks.classList.remove('open'));
});

// ─── MODAL SYSTEM ───
document.querySelectorAll('[data-modal]').forEach(trigger => {
  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    const modalId = trigger.getAttribute('data-modal');
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
      // Reset form if previously submitted
      const form = modal.querySelector('form');
      const success = modal.querySelector('.success-message');
      if (form && success && success.style.display === 'block') {
        form.style.display = 'block';
        form.reset();
        success.style.display = 'none';
      }
    }
  });
});

document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', closeAllModals);
});

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeAllModals();
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAllModals();
});

function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  document.body.style.overflow = '';
}

// ─── TOAST ───
function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast' + (isError ? ' error' : '');
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 4000);
}

// ─── FILE UPLOAD ───
document.querySelectorAll('input[type="file"]').forEach(input => {
  const namesEl = input.parentElement.querySelector('.file-names');
  if (namesEl) {
    input.addEventListener('change', () => {
      const names = Array.from(input.files).map(f => f.name).join(', ');
      namesEl.textContent = names || '';
    });
  }
});

// ─── REPORT FORMS (church + trucking share logic) ───
async function submitReport(form, endpoint, type) {
  const submitBtn = form.querySelector('.btn-submit');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';

  const formData = new FormData(form);
  formData.append('report_type', type);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      body: formData
    });
    const result = await res.json();

    if (res.ok) {
      form.style.display = 'none';
      const success = form.parentElement.querySelector('.success-message');
      success.style.display = 'block';
      success.querySelector('.ref-number').textContent = result.reference;
    } else {
      showToast(result.error || 'Submission failed. Please try again.', true);
    }
  } catch (err) {
    showToast('Network error. Please try again.', true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

const churchForm = document.getElementById('churchForm');
if (churchForm) {
  churchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitReport(churchForm, '/api/reports', 'church');
  });
}

const truckingForm = document.getElementById('truckingForm');
if (truckingForm) {
  truckingForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitReport(truckingForm, '/api/reports', 'trucking');
  });
}

const otherForm = document.getElementById('otherForm');
if (otherForm) {
  otherForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitReport(otherForm, '/api/reports', 'other');
  });
}

// ─── EVIDENCE FORM ───
const evidenceForm = document.getElementById('evidenceForm');
if (evidenceForm) {
  evidenceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = evidenceForm.querySelector('.btn-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Uploading...';

    const formData = new FormData(evidenceForm);
    try {
      const res = await fetch('/api/evidence', { method: 'POST', body: formData });
      const result = await res.json();
      if (res.ok) {
        evidenceForm.style.display = 'none';
        const success = evidenceForm.parentElement.querySelector('.success-message');
        success.style.display = 'block';
        success.querySelector('.ref-number').textContent = result.reference;
      } else {
        showToast(result.error || 'Submission failed.', true);
      }
    } catch (err) {
      showToast('Network error. Please try again.', true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Evidence';
    }
  });
}

// ─── CONTACT FORM ───
const contactForm = document.getElementById('contactForm');
if (contactForm) {
  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = contactForm.querySelector('.btn-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    const data = Object.fromEntries(new FormData(contactForm));
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await res.json();
      if (res.ok) {
        contactForm.style.display = 'none';
        contactForm.parentElement.querySelector('.success-message').style.display = 'block';
      } else {
        showToast(result.error || 'Failed to send.', true);
      }
    } catch (err) {
      showToast('Network error. Please try again.', true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Message';
    }
  });
}

// ─── SMOOTH SCROLL ───
document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener('click', (e) => {
    const href = link.getAttribute('href');
    if (href.length > 1 && !link.hasAttribute('data-modal')) {
      e.preventDefault();
      const target = document.querySelector(href);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});
