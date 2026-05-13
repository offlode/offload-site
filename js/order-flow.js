/* ═══════════════════════════════════════════════
   OFFLOAD USA — Order Flow / Checkout Logic
   Order state machine, form fields, validation,
   signup/login, form state persistence
   ═══════════════════════════════════════════════ */

import {
  API_BASE,
  selectedPlace, setSelectedPlace,
  addressVerified,
  orderState, setOrderState,
  orderBtnLocked, setOrderBtnLocked,
  _formState, setFormState,
} from './state.js';
import { updatePricePreview } from './pricing.js';
import {
  addPaymentField,
  processPaymentAndOrder,
  checkServiceability,
  showUnservedModal,
} from './stripe-pay.js';

// ── Inline Field Error (red border + message + scroll) ──
export function showFieldError(inputEl, message) {
  // Remove any existing error for this field
  const existingError = inputEl.parentElement.querySelector('.field-error-msg');
  if (existingError) existingError.remove();

  // Apply invalid styling
  inputEl.classList.add('invalid');
  inputEl.style.borderColor = '#ef4444';
  inputEl.style.boxShadow = '0 0 0 3px rgba(239,68,68,0.15)';

  // Create error message element
  const errorMsg = document.createElement('span');
  errorMsg.className = 'field-error-msg';
  errorMsg.textContent = message;
  errorMsg.style.cssText = 'display:block; color:#ef4444; font-size:0.78rem; margin-top:4px; font-weight:500;';
  inputEl.parentElement.appendChild(errorMsg);

  // Scroll to field
  inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  inputEl.focus();

  // Remove error styling on input
  inputEl.addEventListener('input', function clearError() {
    inputEl.classList.remove('invalid');
    inputEl.style.borderColor = '';
    inputEl.style.boxShadow = '';
    const msg = inputEl.parentElement.querySelector('.field-error-msg');
    if (msg) msg.remove();
    inputEl.removeEventListener('input', clearError);
  }, { once: true });
}

// ── Order Flow ──
async function _handleOrderClickInner() {
  // Rapid-click protection
  if (orderBtnLocked) return;

  const btn = document.getElementById('order-btn');
  setOrderBtnLocked(true);
  btn.disabled = true;
  setTimeout(() => {
    setOrderBtnLocked(false);
    btn.disabled = false;
  }, 1000);

  const address = document.getElementById('address-input').value.trim();
  const service = document.getElementById('service-select').value;
  const bag = document.getElementById('bag-select').value;

  if (orderState === 'quote') {
    // Validate. Autocomplete is an enhancement; typed addresses can continue.
    if (!address) {
      const addressInput = document.getElementById('address-input');
      showFieldError(addressInput, 'Please enter your pickup address');
      return;
    }
    if (!addressVerified) {
      setSelectedPlace({ formatted: address, manual: true });
    }
    if (!service) {
      showFieldError(document.getElementById('service-select'), 'Please select a service type');
      return;
    }
    if (!bag) {
      showFieldError(document.getElementById('bag-select'), 'Please select a bag size');
      return;
    }

    // Show price
    updatePricePreview();

    // Transition to schedule step
    setOrderState('schedule');
    btn.textContent = 'Schedule Pickup';
    btn.style.background = '#5B4BC4';

    // Add schedule field
    addScheduleField();
    return;
  }

  if (orderState === 'schedule') {
    const date = document.getElementById('pickup-date');
    const time = document.getElementById('pickup-time');

    if (date && !date.value) {
      shakeField('pickup-date');
      return;
    }

    // Transition to checkout
    setOrderState('checkout');
    btn.textContent = 'Continue to Payment';

    // Add contact fields
    addContactFields();
    return;
  }

  if (orderState === 'checkout') {
    const email = document.getElementById('contact-email');
    const phone = document.getElementById('contact-phone');

    // Email validation — inline red + scroll
    if (email) {
      if (!email.value) {
        showFieldError(email, 'Please enter your email address');
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.value.trim())) {
        showFieldError(email, 'Please enter a valid email address');
        return;
      }
    }
    // Phone validation
    if (phone) {
      if (!phone.value) {
        showFieldError(phone, 'Please enter your phone number');
        return;
      }
      const digits = phone.value.replace(/\D/g, '');
      if (digits.length < 10) {
        showFieldError(phone, 'Please enter a valid 10-digit phone number');
        return;
      }
    }

    // Transition to payment
    setOrderState('payment');
    btn.textContent = 'Place Order';
    btn.style.background = '#5B4BC4';

    // Show Stripe card element
    addPaymentField();
    return;
  }

  if (orderState === 'payment') {
    // Process payment and submit order
    btn.disabled = true;
    btn.textContent = 'Processing Payment...';
    btn.style.opacity = '0.7';
    await processPaymentAndOrder();
  }
}

// ── Override handleOrderClick to gate on serviceability ──
// We wrap the existing handleOrderClick so that on the first
// click (quote state), we run the serviceability check first.
export async function handleOrderClick() {
  // Only intercept at the quote step (first click)
  if (orderState !== 'quote') {
    return _handleOrderClickInner();
  }

  var address = (document.getElementById('address-input') || {}).value || '';
  var addressTrimmed = address.trim();

  // If no address yet, let the existing validation handle it
  if (!addressTrimmed) {
    return _handleOrderClickInner();
  }

  // Show loading state on button
  var btn = document.getElementById('order-btn');
  var origText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Checking availability...';
  }

  var servable = await checkServiceability(addressTrimmed);

  if (btn) {
    btn.disabled = false;
    btn.textContent = origText;
  }

  if (!servable) {
    // Extract prefill zip
    var prefillZip = '';
    if (typeof selectedPlace !== 'undefined' && selectedPlace && selectedPlace.components && selectedPlace.components.zip) {
      prefillZip = selectedPlace.components.zip;
    } else {
      // Try to parse a 5-digit zip from the address string
      var zipMatch = addressTrimmed.match(/\b(\d{5})(?:-\d{4})?\b/);
      if (zipMatch) prefillZip = zipMatch[1];
    }
    showUnservedModal(prefillZip);
    return; // do NOT advance the order flow
  }

  // Servable — continue as normal
  return _handleOrderClickInner();
}

function addScheduleField() {
  const form = document.getElementById('order-form');
  const btnContainer = document.getElementById('order-btn').parentElement || form;

  // Check if already added
  if (document.getElementById('schedule-fields')) return;

  const div = document.createElement('div');
  div.id = 'schedule-fields';
  div.className = 'widget__field';
  div.style.animation = 'fadeInUp 0.3s ease forwards';

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = today.toISOString().split('T')[0];

  div.innerHTML = `
    <label class="widget__label">Pickup Date & Time</label>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
      <input type="date" class="widget__input" id="pickup-date" min="${minDate}" value="${minDate}">
      <select class="widget__select" id="pickup-time">
        <option value="8-10am">8:00 - 10:00 AM</option>
        <option value="10-12pm">10:00 AM - 12:00 PM</option>
        <option value="12-2pm" selected>12:00 - 2:00 PM</option>
        <option value="2-4pm">2:00 - 4:00 PM</option>
        <option value="4-6pm">4:00 - 6:00 PM</option>
        <option value="6-8pm">6:00 - 8:00 PM</option>
      </select>
    </div>
  `;

  // Insert before price preview
  const pricePreview = document.getElementById('price-preview');
  form.insertBefore(div, pricePreview);

  // Re-evaluate Same-Day delivery eligibility whenever pickup date changes.
  const dateEl = div.querySelector('#pickup-date');
  dateEl?.addEventListener('change', () => {
    refreshSameDayEligibility();
    updatePricePreview();
  });
  // Run once now to gate Same-Day correctly on first render.
  refreshSameDayEligibility();
}

// Same-Day delivery is only valid when pickup is scheduled for TODAY.
// If the customer picks a future day, disable the Same-Day option in the
// Delivery Speed dropdown and bump them back to Standard.
function refreshSameDayEligibility() {
  const speedSel = document.getElementById('speed-select');
  const dateEl   = document.getElementById('pickup-date');
  if (!speedSel) return;
  const sameDayOpt = speedSel.querySelector('option[value="same_day"]');
  if (!sameDayOpt) return;

  const todayStr = new Date().toISOString().split('T')[0];
  const pickupStr = dateEl ? (dateEl.value || todayStr) : todayStr;
  const isToday = pickupStr === todayStr;

  if (isToday) {
    sameDayOpt.disabled = false;
    sameDayOpt.hidden = false;
    sameDayOpt.textContent = 'Same Day — 12 hours (+$12.99)';
  } else {
    // Not today — same-day delivery isn't possible. Hide it AND if it was selected, fall back.
    sameDayOpt.disabled = true;
    sameDayOpt.hidden = true;
    sameDayOpt.textContent = 'Same Day — pick today\'s date to enable';
    if (speedSel.value === 'same_day') {
      speedSel.value = '48h';
      speedSel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
}

function addContactFields() {
  const form = document.getElementById('order-form');

  if (document.getElementById('contact-fields')) return;

  const div = document.createElement('div');
  div.id = 'contact-fields';
  div.style.animation = 'fadeInUp 0.3s ease forwards';

  div.innerHTML = `
    <div class="widget__field" style="margin-bottom:12px;">
      <label class="widget__label">Email</label>
      <input type="email" class="widget__input" id="contact-email" placeholder="your@email.com" autocomplete="email">
    </div>
    <div class="widget__field" style="margin-bottom:12px;">
      <label class="widget__label">Phone</label>
      <input type="tel" class="widget__input" id="contact-phone" placeholder="(555) 123-4567" autocomplete="tel">
    </div>
    <div class="widget__field">
      <label class="widget__label">Delivery Notes (optional)</label>
      <input type="text" class="widget__input" id="delivery-notes" placeholder="Leave at door, buzzer code, etc.">
    </div>
  `;

  const pricePreview = document.getElementById('price-preview');
  form.insertBefore(div, pricePreview);
}

export function resetOrder() {
  setOrderState('quote');
  clearFormState();
  location.reload();
}

export function shakeField(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.borderColor = '#ef4444';
  el.style.animation = 'shake 0.3s ease';
  setTimeout(() => {
    el.style.animation = '';
    el.style.borderColor = '';
  }, 600);
  el.focus();
}

// ── Form State Persistence (in-memory, no localStorage/sessionStorage) ──

export function saveFormState() {
  setFormState({
    address: document.getElementById('address-input')?.value || '',
    service: document.getElementById('service-select')?.value || '',
    bag: document.getElementById('bag-select')?.value || '',
    speed: document.getElementById('speed-select')?.value || '',
  });
}

export function restoreFormState() {
  // In-memory only — nothing to restore on fresh page load
}

export function clearFormState() {
  setFormState({});
}

// ── Auto-format phone number as user types ──
export function initPhoneFormatter() {
  document.addEventListener('input', (e) => {
    if (e.target.id === 'contact-phone') {
      let val = e.target.value.replace(/\D/g, '');
      if (val.length > 10) val = val.substring(0, 10);
      if (val.length >= 7) {
        e.target.value = '(' + val.substring(0, 3) + ') ' + val.substring(3, 6) + '-' + val.substring(6);
      } else if (val.length >= 4) {
        e.target.value = '(' + val.substring(0, 3) + ') ' + val.substring(3);
      } else if (val.length > 0) {
        e.target.value = '(' + val;
      }
    }
  });
}

// ══════════════════════════════════════════════
//  SIGN UP & LOGIN
// ══════════════════════════════════════════════

export function handleSignup() {
  const first = document.getElementById('signup-first');
  const last = document.getElementById('signup-last');
  const email = document.getElementById('signup-email');
  const phone = document.getElementById('signup-phone');
  const password = document.getElementById('signup-password');
  const msgEl = document.getElementById('signup-msg');
  const btn = document.getElementById('signup-btn');

  // Clear previous messages
  msgEl.textContent = '';
  msgEl.style.color = '';

  // Validate fields with inline red highlighting
  if (!first.value.trim()) {
    showFieldError(first, 'First name is required');
    return;
  }
  if (!last.value.trim()) {
    showFieldError(last, 'Last name is required');
    return;
  }
  if (!email.value.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
    showFieldError(email, 'Please enter a valid email address');
    return;
  }
  if (!phone.value.trim()) {
    showFieldError(phone, 'Phone number is required');
    return;
  }
  if (!password.value || password.value.length < 8) {
    showFieldError(password, 'Password must be at least 8 characters');
    return;
  }

  // Submit to API
  btn.disabled = true;
  btn.textContent = 'Creating Account...';
  btn.style.opacity = '0.7';

  fetch(API_BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: first.value.trim() + ' ' + last.value.trim(),
      email: email.value.trim(),
      phone: phone.value.trim(),
      password: password.value,
    }),
  })
    .then(r => {
      if (!r.ok) return r.json().then(d => { throw new Error(d.error || 'Registration failed'); });
      return r.json();
    })
    .then(data => {
      msgEl.style.color = '#22c55e';
      msgEl.textContent = 'Account created successfully! You can now track orders and earn loyalty rewards.';
      btn.textContent = 'Account Created';
      btn.style.background = '#22c55e';
      // Clear form
      first.value = '';
      last.value = '';
      email.value = '';
      phone.value = '';
      password.value = '';
    })
    .catch(err => {
      msgEl.style.color = '#ef4444';
      msgEl.textContent = err.message || 'Something went wrong. Please try again.';
      btn.disabled = false;
      btn.textContent = 'Create Account';
      btn.style.opacity = '1';
    });
}

export function showLoginModal() {
  // Redirect to dedicated sign-in page
  window.location.href = 'sign-in.html';
}

export function handleLogin() {
  const email = document.getElementById('login-email');
  const password = document.getElementById('login-password');
  const msgEl = document.getElementById('login-msg');

  if (!email.value.trim()) {
    showFieldError(email, 'Email is required');
    return;
  }
  if (!password.value) {
    showFieldError(password, 'Password is required');
    return;
  }

  msgEl.textContent = 'Logging in...';
  msgEl.style.color = '#94a3b8';

  fetch(API_BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: email.value.trim(),
      password: password.value,
    }),
  })
    .then(r => {
      if (!r.ok) return r.json().then(d => { throw new Error(d.error || 'Login failed'); });
      return r.json();
    })
    .then(data => {
      msgEl.style.color = '#22c55e';
      msgEl.textContent = 'Logged in successfully! Redirecting...';
      // In production, redirect to the app dashboard
      setTimeout(() => {
        window.location.href = API_BASE;
      }, 1000);
    })
    .catch(err => {
      msgEl.style.color = '#ef4444';
      msgEl.textContent = err.message || 'Invalid email or password.';
    });
}

// ── App availability modal ──
export function showAppAvailability() {
  const existing = document.getElementById('app-availability-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'app-availability-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML = `
    <div style="background:#111;border:1px solid #333;border-radius:18px;padding:28px;max-width:420px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <button onclick="document.getElementById('app-availability-modal').remove()" style="float:right;background:none;border:none;color:#888;font-size:24px;cursor:pointer;line-height:1;">&times;</button>
      <h3 style="color:#fff;font-size:1.2rem;font-weight:800;margin-bottom:8px;font-family:Inter,system-ui,sans-serif;">Mobile app availability</h3>
      <p style="color:#a0a0a0;font-size:0.9rem;line-height:1.6;margin-bottom:24px;font-family:Inter,system-ui,sans-serif;">Join the Offload update list for iOS launch details and Android availability updates.</p>
      <a href="#signup-section" style="display:inline-block;background:#5B4BC4;color:#fff;padding:12px 28px;border-radius:10px;font-weight:700;font-size:0.9rem;text-decoration:none;font-family:Inter,system-ui,sans-serif;transition:background 0.2s;" onmouseover="this.style.background='#4a3bb3'" onmouseout="this.style.background='#5B4BC4'">Get launch updates</a>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}
