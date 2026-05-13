/* ═══════════════════════════════════════════════
   OFFLOAD USA — Stripe Payment Integration
   Stripe card element, payment processing,
   confirmation display, unserved-area lead capture
   ═══════════════════════════════════════════════ */

import {
  API_BASE,
  selectedPlace,
  orderState, setOrderState,
} from './state.js';
import {
  PRICING,
  collectLogisticsState,
  collectSelectedAddOns,
} from './pricing.js';

// ── Stripe Payment Integration ──
let stripeInstance = null;
let stripeElements = null;
let cardElement = null;

export function initStripe() {
  if (stripeInstance) return;
  if (typeof Stripe === 'undefined') {
    console.warn('[Stripe] Stripe.js not loaded');
    return;
  }
  stripeInstance = Stripe('pk_test_51TMile3mAtA14Z2dwuOn6dIMyzX68bjyMIcGzGZHJB6KgfVr53uMOlJzVM9639c6F2nHnLDCpjS8r7WeURqHCiTU00yNs7nkHg');
}

export function addPaymentField() {
  const form = document.getElementById('order-form');
  if (document.getElementById('payment-fields')) return;

  initStripe();

  const div = document.createElement('div');
  div.id = 'payment-fields';
  div.style.animation = 'fadeInUp 0.3s ease forwards';

  div.innerHTML = `
    <div class="widget__field" style="margin-bottom:12px;">
      <label class="widget__label">Credit or Debit Card</label>
      <div id="stripe-card-element" style="background:#fff; border:1.5px solid #e2e8f0; border-radius:8px; padding:12px 14px; font-size:0.95rem; transition:border-color 0.2s;"></div>
      <div id="card-errors" style="color:#ef4444; font-size:0.78rem; margin-top:4px; font-weight:500; display:none;"></div>
    </div>
    <div style="display:flex; align-items:center; gap:6px; margin-bottom:8px;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5B4BC4" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      <span style="font-size:0.75rem; color:var(--text-muted);">Secured by Stripe. Your card info never touches our servers.</span>
    </div>
  `;

  const pricePreview = document.getElementById('price-preview');
  form.insertBefore(div, pricePreview);

  // Mount Stripe card element
  if (stripeInstance) {
    stripeElements = stripeInstance.elements();
    cardElement = stripeElements.create('card', {
      style: {
        base: {
          fontSize: '16px',
          color: '#1a1a1a',
          fontFamily: 'Inter, system-ui, sans-serif',
          '::placeholder': { color: '#a0aec0' },
        },
        invalid: {
          color: '#ef4444',
          iconColor: '#ef4444',
        },
      },
    });
    cardElement.mount('#stripe-card-element');

    // Handle real-time card errors
    cardElement.on('change', (event) => {
      const errorEl = document.getElementById('card-errors');
      if (event.error) {
        errorEl.textContent = event.error.message;
        errorEl.style.display = 'block';
      } else {
        errorEl.style.display = 'none';
      }
    });

    // Style the container on focus/blur
    cardElement.on('focus', () => {
      document.getElementById('stripe-card-element').style.borderColor = '#5B4BC4';
      document.getElementById('stripe-card-element').style.boxShadow = '0 0 0 3px rgba(91,75,196,0.12)';
    });
    cardElement.on('blur', () => {
      document.getElementById('stripe-card-element').style.borderColor = '#e2e8f0';
      document.getElementById('stripe-card-element').style.boxShadow = 'none';
    });
  }
}

export async function processPaymentAndOrder() {
  const btn = document.getElementById('order-btn');
  const bag = document.getElementById('bag-select').value;
  const address = document.getElementById('address-input').value;
  const speed = document.getElementById('speed-select').value;
  const service = document.getElementById('service-select').value;
  const email = document.getElementById('contact-email')?.value || '';
  const phone = document.getElementById('contact-phone')?.value || '';
  const notes = document.getElementById('delivery-notes')?.value || '';
  const date = document.getElementById('pickup-date')?.value || '';
  const time = document.getElementById('pickup-time')?.value || '';

  try {
    // Step 1: Create quote on the server
    const speedMap = { '48h': '48h', '24h': '24h', 'same_day': 'same_day' };
    const deliverySpeed = speedMap[speed] || '48h';
    const idempotencyKey = 'web_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    // Collect logistics inputs from advanced controls (safe fallbacks if controls missing)
    let logisticsPayload = {};
    try {
      const ls = (typeof collectLogisticsState === 'function') ? collectLogisticsState() : null;
      if (ls) {
        logisticsPayload = {
          pickupFloor: ls.pickupFloor,
          pickupHasElevator: ls.pickupHasElevator,
          pickupHandoff: ls.pickupHandoff,
          pickupWindowMinutes: ls.pickupWindowMinutes,
          vendorChoiceMode: ls.vendorChoiceMode,
        };
      }
    } catch (_) {}

    // Combine date + time into ISO scheduledPickup
    let scheduledPickup = null;
    if (date && time) {
      try {
        const dt = new Date(`${date}T${time}:00`);
        if (!isNaN(dt.getTime())) scheduledPickup = dt.toISOString();
      } catch (_) {}
    }

    const quoteRes = await fetch(API_BASE + '/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickupAddress: address,
        pickupCity: selectedPlace?.components?.city || '',
        pickupState: selectedPlace?.components?.state || 'NY',
        pickupZip: selectedPlace?.components?.zip || '',
        pickupLat: selectedPlace?.lat,
        pickupLng: selectedPlace?.lng,
        serviceType: service || 'wash_fold',
        tierName: bag,
        deliverySpeed,
        idempotencyKey,
        addOns: collectSelectedAddOns(),
        ...logisticsPayload,
        ...(scheduledPickup ? { scheduledPickup } : {}),
      }),
    });

    if (!quoteRes.ok) {
      const err = await quoteRes.json().catch(() => ({ error: 'Server error' }));
      throw new Error(err.error || 'Failed to create quote');
    }

    const quote = await quoteRes.json();

    // Step 2: Create payment intent via the public checkout endpoint
    const intentRes = await fetch(API_BASE + '/api/public/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteId: quote.id,
        email,
        phone,
        notes,
        pickupDate: date,
        pickupTime: time,
      }),
    });

    if (!intentRes.ok) {
      const err = await intentRes.json().catch(() => ({ error: 'Payment setup failed' }));
      throw new Error(err.error || 'Payment setup failed');
    }

    const { clientSecret, orderId, orderNumber } = await intentRes.json();

    // Step 3: Confirm card payment with Stripe
    if (!stripeInstance || !cardElement) {
      throw new Error('Payment system not loaded. Please refresh and try again.');
    }

    const { error: stripeError, paymentIntent } = await stripeInstance.confirmCardPayment(clientSecret, {
      payment_method: {
        card: cardElement,
        billing_details: {
          email: email,
          phone: phone,
        },
      },
    });

    if (stripeError) {
      // Show card error
      const errorEl = document.getElementById('card-errors');
      if (errorEl) {
        errorEl.textContent = stripeError.message;
        errorEl.style.display = 'block';
      }
      throw new Error(stripeError.message);
    }

    if (paymentIntent.status === 'succeeded') {
      // Payment successful — show confirmation
      showPaymentConfirmation(quote, orderNumber, {
        address, email, phone, notes,
        pickupDate: date, pickupTime: time,
        bagLabel: PRICING[bag]?.label || bag,
      });
    }

  } catch (err) {
    console.error('Payment failed:', err);
    btn.disabled = false;
    btn.textContent = 'Place Order';
    btn.style.opacity = '1';

    // Show error inline
    const errorBanner = document.createElement('div');
    errorBanner.id = 'payment-error-banner';
    errorBanner.style.cssText = 'background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:12px 16px; border-radius:8px; font-size:0.88rem; margin-bottom:12px; display:flex; align-items:center; gap:8px;';
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '18'); svg.setAttribute('height', '18'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', '#ef4444'); svg.setAttribute('stroke-width', '2');
    var c = document.createElementNS(svgNS, 'circle'); c.setAttribute('cx','12'); c.setAttribute('cy','12'); c.setAttribute('r','10'); svg.appendChild(c);
    var l1 = document.createElementNS(svgNS, 'line'); l1.setAttribute('x1','15'); l1.setAttribute('y1','9'); l1.setAttribute('x2','9'); l1.setAttribute('y2','15'); svg.appendChild(l1);
    var l2 = document.createElementNS(svgNS, 'line'); l2.setAttribute('x1','9'); l2.setAttribute('y1','9'); l2.setAttribute('x2','15'); l2.setAttribute('y2','15'); svg.appendChild(l2);
    errorBanner.appendChild(svg);
    var span = document.createElement('span');
    span.textContent = err.message || 'Payment failed. Please check your card and try again.';
    errorBanner.appendChild(span);
    const existing = document.getElementById('payment-error-banner');
    if (existing) existing.remove();
    const form = document.getElementById('order-form');
    form.insertBefore(errorBanner, form.firstChild);
    errorBanner.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => errorBanner?.remove(), 8000);
  }
}

function showPaymentConfirmation(quote, orderNumber, details) {
  const widget = document.getElementById('hero-widget');
  const total = '$' + Number(quote.total).toFixed(2);

  widget.innerHTML = `
    <div style="text-align:center; padding:20px 0;">
      <div style="width:64px; height:64px; margin:0 auto 16px; background:rgba(91,75,196,0.15); border-radius:50%; display:flex; align-items:center; justify-content:center;">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#5B4BC4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
      </div>
      <h3 style="font-size:1.3rem; font-weight:700; margin-bottom:4px; font-family:var(--font-display);">Order Confirmed!</h3>
      <p style="color:var(--text-secondary); font-size:0.85rem; margin-bottom:4px;">Order #${orderNumber}</p>
      <p style="color:var(--text-muted); font-size:0.78rem; margin-bottom:20px;">Payment of ${total} processed successfully</p>

      <div style="background:var(--gray-50); border-radius:10px; padding:16px; text-align:left; font-size:0.88rem;">
        <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--gray-100);">
          <span style="color:var(--text-muted);">Address</span>
          <span style="font-weight:600; max-width:200px; text-align:right; font-size:0.85rem;">${details.address}</span>
        </div>
        <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--gray-100);">
          <span style="color:var(--text-muted);">Pickup</span>
          <span style="font-weight:600;">${details.pickupDate || 'Today'} ${details.pickupTime || ''}</span>
        </div>
        <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--gray-100);">
          <span style="color:var(--text-muted);">Total Paid</span>
          <span style="font-weight:700; color:#5B4BC4;">${total}</span>
        </div>
      </div>

      <p style="color:var(--text-muted); font-size:0.78rem; margin-top:16px;">
        Confirmation sent to <strong>${details.email}</strong><br>
        We'll text you at <strong>${details.phone}</strong> when your driver is on the way.
      </p>

      <button onclick="location.reload()" class="widget__btn" style="margin-top:16px; background:#5B4BC4; font-size:0.9rem; padding:12px 24px;">
        Place Another Order
      </button>
    </div>
  `;
}

// ── Toast helper (success / error) ──
export function showOffloadToast(message, type) {
  var existing = document.getElementById('offload-toast');
  if (existing) existing.remove();
  var toast = document.createElement('div');
  toast.id = 'offload-toast';
  var bg = type === 'success' ? '#22c55e' : '#ef4444';
  toast.style.cssText = [
    'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%) translateY(0)',
    'background:' + bg, 'color:#fff', 'padding:14px 24px', 'border-radius:10px',
    'font-size:0.9rem', 'font-weight:600', 'z-index:99999',
    'box-shadow:0 8px 32px rgba(0,0,0,0.35)', 'max-width:420px', 'text-align:center',
    'transition:opacity 0.4s ease', 'pointer-events:none'
  ].join(';');
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(function () {
    toast.style.opacity = '0';
    setTimeout(function () { if (toast.parentNode) toast.remove(); }, 400);
  }, 5000);
}

// ── Serviceability check ──
// Returns Promise<boolean>. Extracts zip from selectedPlace or raw address input.
export async function checkServiceability(zipOrAddress) {
  try {
    var zip = null;
    // Try to get zip from selectedPlace first
    if (typeof selectedPlace !== 'undefined' && selectedPlace && selectedPlace.components && selectedPlace.components.zip) {
      zip = selectedPlace.components.zip;
    }
    var body = zip
      ? { zip: zip, serviceType: (document.getElementById('service-select') || {}).value || 'wash_fold' }
      : { address: zipOrAddress, serviceType: (document.getElementById('service-select') || {}).value || 'wash_fold' };
    var res = await fetch(API_BASE + '/api/quotes/check-serviceability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return true; // on API error, default to servable so we don't block users
    var data = await res.json();
    return data.servable !== false;
  } catch (e) {
    return true; // network error → allow through
  }
}

// ── Unserved-area modal ──
export function showUnservedModal(prefillZip) {
  var existing = document.getElementById('unserved-modal-overlay');
  if (existing) { existing.style.display = 'flex'; return; }

  var overlay = document.createElement('div');
  overlay.id = 'unserved-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'unserved-modal-title');
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.72)',
    'z-index:99990', 'display:flex', 'align-items:center',
    'justify-content:center', 'padding:20px', 'overflow-y:auto'
  ].join(';');

  var US_STATES = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
    'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
    'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
    'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
  ];
  var stateOpts = US_STATES.map(function(s){
    return '<option value="' + s + '"' + (s === 'NY' ? ' selected' : '') + '>' + s + '</option>';
  }).join('');

  overlay.innerHTML = [
    '<div id="unserved-modal" style="background:#111827; border:1px solid rgba(91,75,196,0.25);',
      'border-radius:18px; padding:32px 28px 28px; max-width:520px; width:100%; position:relative;',
      'box-shadow:0 24px 64px rgba(0,0,0,0.6);">',

      '<button id="unserved-modal-close" type="button"',
        'aria-label="Close"',
        'style="position:absolute;top:16px;right:18px;background:none;border:none;',
        'color:#9ca3af;font-size:1.5rem;cursor:pointer;line-height:1;padding:4px;',
        'transition:color 0.2s;" onmouseover="this.style.color=\'#fff\'" onmouseout="this.style.color=\'#9ca3af\'">',
        '&times;',
      '</button>',

      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;">',
        '<div style="width:40px;height:40px;background:rgba(91,75,196,0.15);border-radius:10px;',
          'display:flex;align-items:center;justify-content:center;flex-shrink:0;">',
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5B4BC4" stroke-width="2" stroke-linecap="round">',
            '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/>',
          '</svg>',
        '</div>',
        '<div>',
          '<h2 id="unserved-modal-title" style="color:#fff;font-size:1.15rem;font-weight:700;',
            'margin-bottom:2px;font-family:\'Montserrat\',sans-serif;">',
            'We don&rsquo;t have laundromats available in your area yet.',
          '</h2>',
          '<p style="color:#9ca3af;font-size:0.83rem;margin:0;">',
            'Offload is coming soon to your area. Leave your details and we&rsquo;ll let you know.',
          '</p>',
        '</div>',
      '</div>',

      '<form id="unserved-lead-form" style="display:flex;flex-direction:column;gap:12px;">',

        '<!-- Full Name -->',
        '<div>',
          '<label for="ul-name" style="display:block;font-size:0.78rem;font-weight:600;',
            'color:#9ca3af;margin-bottom:4px;">Full Name <span style="color:#ef4444;">*</span></label>',
          '<input type="text" id="ul-name" name="name" required autocomplete="name"',
            'placeholder="Jane Doe"',
            'style="width:100%;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.12);',
            'border-radius:8px;padding:10px 14px;color:#fff;font-size:0.9rem;',
            'font-family:inherit;outline:none;transition:border-color 0.2s;"',
            'onfocus="this.style.borderColor=\'#5B4BC4\'" onblur="this.style.borderColor=\'rgba(255,255,255,0.12)\'" />',
        '</div>',

        '<!-- Email -->',
        '<div>',
          '<label for="ul-email" style="display:block;font-size:0.78rem;font-weight:600;',
            'color:#9ca3af;margin-bottom:4px;">Email <span style="color:#ef4444;">*</span></label>',
          '<input type="email" id="ul-email" name="email" required autocomplete="email"',
            'placeholder="jane@example.com"',
            'style="width:100%;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.12);',
            'border-radius:8px;padding:10px 14px;color:#fff;font-size:0.9rem;',
            'font-family:inherit;outline:none;transition:border-color 0.2s;"',
            'onfocus="this.style.borderColor=\'#5B4BC4\'" onblur="this.style.borderColor=\'rgba(255,255,255,0.12)\'" />',
        '</div>',

        '<!-- Phone -->',
        '<div>',
          '<label for="ul-phone" style="display:block;font-size:0.78rem;font-weight:600;',
            'color:#9ca3af;margin-bottom:4px;">Phone <span style="color:#ef4444;">*</span></label>',
          '<input type="tel" id="ul-phone" name="phone" required autocomplete="tel"',
            'placeholder="(555) 123-4567"',
            'style="width:100%;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.12);',
            'border-radius:8px;padding:10px 14px;color:#fff;font-size:0.9rem;',
            'font-family:inherit;outline:none;transition:border-color 0.2s;"',
            'onfocus="this.style.borderColor=\'#5B4BC4\'" onblur="this.style.borderColor=\'rgba(255,255,255,0.12)\'" />',
        '</div>',

        '<!-- Address row -->',
        '<div>',
          '<label for="ul-address" style="display:block;font-size:0.78rem;font-weight:600;',
            'color:#9ca3af;margin-bottom:4px;">Address <span style="color:#ef4444;">*</span></label>',
          '<input type="text" id="ul-address" name="address" required autocomplete="street-address"',
            'placeholder="123 Main St"',
            'style="width:100%;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.12);',
            'border-radius:8px;padding:10px 14px;color:#fff;font-size:0.9rem;',
            'font-family:inherit;outline:none;transition:border-color 0.2s;"',
            'onfocus="this.style.borderColor=\'#5B4BC4\'" onblur="this.style.borderColor=\'rgba(255,255,255,0.12)\'" />',
        '</div>',

        '<!-- City / State / ZIP row -->',
        '<div style="display:grid;grid-template-columns:1fr auto auto;gap:10px;">',
          '<div>',
            '<label for="ul-city" style="display:block;font-size:0.78rem;font-weight:600;',
              'color:#9ca3af;margin-bottom:4px;">City <span style="color:#ef4444;">*</span></label>',
            '<input type="text" id="ul-city" name="city" required autocomplete="address-level2"',
              'placeholder="New York"',
              'style="width:100%;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.12);',
              'border-radius:8px;padding:10px 14px;color:#fff;font-size:0.9rem;',
              'font-family:inherit;outline:none;transition:border-color 0.2s;"',
              'onfocus="this.style.borderColor=\'#5B4BC4\'" onblur="this.style.borderColor=\'rgba(255,255,255,0.12)\'" />',
          '</div>',
          '<div>',
            '<label for="ul-state" style="display:block;font-size:0.78rem;font-weight:600;',
              'color:#9ca3af;margin-bottom:4px;">State <span style="color:#ef4444;">*</span></label>',
            '<select id="ul-state" name="state" required autocomplete="address-level1"',
              'style="background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.12);',
              'border-radius:8px;padding:10px 14px;color:#fff;font-size:0.9rem;',
              'font-family:inherit;outline:none;min-width:80px;transition:border-color 0.2s;"',
              'onfocus="this.style.borderColor=\'#5B4BC4\'" onblur="this.style.borderColor=\'rgba(255,255,255,0.12)\'">',
              stateOpts,
            '</select>',
          '</div>',
          '<div>',
            '<label for="ul-zip" style="display:block;font-size:0.78rem;font-weight:600;',
              'color:#9ca3af;margin-bottom:4px;">ZIP <span style="color:#ef4444;">*</span></label>',
            '<input type="text" id="ul-zip" name="zip" required autocomplete="postal-code"',
              'placeholder="10001" maxlength="10"',
              'value="' + (prefillZip || '') + '"',
              'style="width:100%;background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.12);',
              'border-radius:8px;padding:10px 14px;color:#fff;font-size:0.9rem;',
              'font-family:inherit;outline:none;min-width:90px;transition:border-color 0.2s;"',
              'onfocus="this.style.borderColor=\'#5B4BC4\'" onblur="this.style.borderColor=\'rgba(255,255,255,0.12)\'" />',
          '</div>',
        '</div>',

        '<!-- Service type (optional) -->',
        '<div>',
          '<label style="display:block;font-size:0.78rem;font-weight:600;',
            'color:#9ca3af;margin-bottom:8px;">Service Interest <span style="color:#9ca3af;font-weight:400;">(optional)</span></label>',
          '<div id="ul-service-radios" role="radiogroup" aria-label="Requested service type"',
            'style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">',
            _buildServiceRadio('wash_fold', 'Wash &amp; Fold', true),
            _buildServiceRadio('dry_cleaning', 'Dry Cleaning', false),
            _buildServiceRadio('comforters', 'Comforters', false),
            _buildServiceRadio('mixed', 'Mixed', false),
          '</div>',
        '</div>',

        '<!-- Submit -->',
        '<div id="ul-error" role="alert" style="display:none;background:rgba(239,68,68,0.12);',
          'border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:10px 14px;',
          'color:#fca5a5;font-size:0.83rem;"></div>',

        '<button type="submit" id="ul-submit"',
          'style="width:100%;background:#5B4BC4;color:#fff;border:none;border-radius:10px;',
          'padding:14px;font-size:0.95rem;font-weight:700;cursor:pointer;',
          'font-family:inherit;transition:background 0.2s,opacity 0.2s;"',
          'onmouseover="if(!this.disabled)this.style.background=\'#4a3ba3\'"',
          'onmouseout="if(!this.disabled)this.style.background=\'#5B4BC4\'">',
          'Notify Me When Offload Arrives',
        '</button>',

        '<p style="text-align:center;font-size:0.75rem;color:#6b7280;margin-top:4px;">',
          'No spam. We\'ll only reach out when service launches in your area.',
        '</p>',

      '</form>',
    '</div>'
  ].join('');

  document.body.appendChild(overlay);

  // Pre-fill address + components from selectedPlace if available
  if (typeof selectedPlace !== 'undefined' && selectedPlace) {
    var addrEl = document.getElementById('ul-address');
    var cityEl = document.getElementById('ul-city');
    var stateEl = document.getElementById('ul-state');
    if (addrEl && selectedPlace.formatted) {
      // Use the raw typed address for the address field
      var rawAddr = (document.getElementById('address-input') || {}).value || selectedPlace.formatted;
      addrEl.value = rawAddr;
    }
    if (cityEl && selectedPlace.components && selectedPlace.components.city) {
      cityEl.value = selectedPlace.components.city;
    }
    if (stateEl && selectedPlace.components && selectedPlace.components.state) {
      stateEl.value = selectedPlace.components.state;
    }
  } else {
    // Try to prefill address field from the order widget
    var widgetAddr = document.getElementById('address-input');
    if (widgetAddr && widgetAddr.value) {
      var addrField = document.getElementById('ul-address');
      if (addrField) addrField.value = widgetAddr.value;
    }
  }

  // Also prefill service type from widget if set
  var widgetService = (document.getElementById('service-select') || {}).value;
  if (widgetService) {
    var radio = document.querySelector('#ul-service-radios input[value="' + widgetService + '"]');
    if (radio) {
      // Deselect all, select this one
      document.querySelectorAll('#ul-service-radios input[type=radio]').forEach(function(r) {
        r.checked = false;
        r.closest('label').style.borderColor = 'rgba(255,255,255,0.12)';
        r.closest('label').style.background = 'rgba(255,255,255,0.04)';
      });
      radio.checked = true;
      radio.closest('label').style.borderColor = '#5B4BC4';
      radio.closest('label').style.background = 'rgba(91,75,196,0.15)';
    }
  }

  // Close on overlay click
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeUnservedModal();
  });

  // Close button
  document.getElementById('unserved-modal-close').addEventListener('click', closeUnservedModal);

  // Close on Escape
  document.addEventListener('keydown', _unservedEscHandler);

  // Form submit
  document.getElementById('unserved-lead-form').addEventListener('submit', submitUnservedLead);

  // Phone auto-format in modal
  document.getElementById('ul-phone').addEventListener('input', function(e) {
    var v = e.target.value.replace(/\D/g, '');
    if (v.length > 10) v = v.substring(0, 10);
    if (v.length >= 7) e.target.value = '(' + v.substring(0,3) + ') ' + v.substring(3,6) + '-' + v.substring(6);
    else if (v.length >= 4) e.target.value = '(' + v.substring(0,3) + ') ' + v.substring(3);
    else if (v.length > 0) e.target.value = '(' + v;
  });

  // Focus first empty field
  var firstEl = document.getElementById('ul-name');
  if (firstEl) setTimeout(function() { firstEl.focus(); }, 50);
}

function _buildServiceRadio(value, label, checked) {
  return [
    '<label style="display:flex;align-items:center;gap:8px;padding:8px 12px;',
      'background:' + (checked ? 'rgba(91,75,196,0.15)' : 'rgba(255,255,255,0.04)') + ';',
      'border:1.5px solid ' + (checked ? '#5B4BC4' : 'rgba(255,255,255,0.12)') + ';',
      'border-radius:8px;cursor:pointer;font-size:0.85rem;color:#e5e7eb;',
      'transition:background 0.15s,border-color 0.15s;">',
      '<input type="radio" name="ul-service" value="' + value + '"' + (checked ? ' checked' : '') + '',
        'style="accent-color:#5B4BC4;" ',
        'onchange="_onServiceRadioChange(this)">',
      label,
    '</label>'
  ].join('');
}

export function _onServiceRadioChange(radio) {
  document.querySelectorAll('#ul-service-radios label').forEach(function(lbl) {
    lbl.style.borderColor = 'rgba(255,255,255,0.12)';
    lbl.style.background = 'rgba(255,255,255,0.04)';
  });
  radio.closest('label').style.borderColor = '#5B4BC4';
  radio.closest('label').style.background = 'rgba(91,75,196,0.15)';
}

function _unservedEscHandler(e) {
  if (e.key === 'Escape') closeUnservedModal();
}

export function closeUnservedModal() {
  var overlay = document.getElementById('unserved-modal-overlay');
  if (overlay) overlay.style.display = 'none';
  document.removeEventListener('keydown', _unservedEscHandler);
}

async function submitUnservedLead(e) {
  e.preventDefault();
  var form = e.target;
  var btn = document.getElementById('ul-submit');
  var errEl = document.getElementById('ul-error');

  // Clear previous error
  errEl.style.display = 'none';
  errEl.textContent = '';

  var name = (document.getElementById('ul-name').value || '').trim();
  var email = (document.getElementById('ul-email').value || '').trim();
  var phone = (document.getElementById('ul-phone').value || '').trim();
  var address = (document.getElementById('ul-address').value || '').trim();
  var city = (document.getElementById('ul-city').value || '').trim();
  var state = (document.getElementById('ul-state').value || '').trim();
  var zip = (document.getElementById('ul-zip').value || '').trim();
  var serviceRadio = form.querySelector('input[name="ul-service"]:checked');
  var requestedService = serviceRadio ? serviceRadio.value : null;

  // Basic validation
  if (!name) { _ulFieldError('ul-name', errEl, 'Please enter your full name.'); return; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    _ulFieldError('ul-email', errEl, 'Please enter a valid email address.'); return;
  }
  var digits = phone.replace(/\D/g, '');
  if (!phone || digits.length < 10) {
    _ulFieldError('ul-phone', errEl, 'Please enter a valid 10-digit US phone number.'); return;
  }
  if (!address) { _ulFieldError('ul-address', errEl, 'Please enter your street address.'); return; }
  if (!city) { _ulFieldError('ul-city', errEl, 'Please enter your city.'); return; }
  if (!state) { _ulFieldError('ul-state', errEl, 'Please select your state.'); return; }
  if (!zip) { _ulFieldError('ul-zip', errEl, 'Please enter your ZIP code.'); return; }

  // Coords from selectedPlace if available
  var lat = (typeof selectedPlace !== 'undefined' && selectedPlace && selectedPlace.lat) ? selectedPlace.lat : undefined;
  var lng = (typeof selectedPlace !== 'undefined' && selectedPlace && selectedPlace.lng) ? selectedPlace.lng : undefined;

  var payload = {
    name: name,
    email: email,
    phone: phone,
    address: address,
    city: city,
    state: state,
    zip: zip,
    source: 'website_unserved_zip',
  };
  if (lat !== undefined) payload.lat = lat;
  if (lng !== undefined) payload.lng = lng;
  if (requestedService) payload.requestedService = requestedService;

  btn.disabled = true;
  btn.textContent = 'Sending...';
  btn.style.opacity = '0.7';

  try {
    var res = await fetch(API_BASE + '/api/service-area-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      var errData = await res.json().catch(function() { return {}; });
      throw new Error(errData.error || errData.message || 'Submission failed (' + res.status + ')');
    }
    // Success
    closeUnservedModal();
    showOffloadToast('Thanks \u2014 we\u2019ll reach out when Offload launches in your area.', 'success');
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Notify Me When Offload Arrives';
    btn.style.opacity = '1';
    errEl.textContent = err.message || 'Something went wrong. Please try again.';
    errEl.style.display = 'block';
  }
}

function _ulFieldError(fieldId, errEl, message) {
  errEl.textContent = message;
  errEl.style.display = 'block';
  var field = document.getElementById(fieldId);
  if (field) {
    field.style.borderColor = '#ef4444';
    field.focus();
    field.addEventListener('input', function clearErr() {
      field.style.borderColor = 'rgba(255,255,255,0.12)';
      errEl.style.display = 'none';
      field.removeEventListener('input', clearErr);
    }, { once: true });
  }
}
