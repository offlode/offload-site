/* ═══════════════════════════════════════════════
   OFFLOAD USA — Main JavaScript
   Pricing engine, chatbot, animations, ordering
   ═══════════════════════════════════════════════ */

// ── Service-Type Pricing Multipliers ──
// Dry cleaning costs more, comforters cost more, mixed = blended rate
const SERVICE_MULTIPLIERS = {
  wash_fold:    1.0,
  dry_cleaning: 1.65,
  comforters:   1.40,
  mixed:        1.25,
};

const SERVICE_LABELS = {
  wash_fold:    'Wash & Fold',
  dry_cleaning: 'Dry Cleaning',
  comforters:   'Comforters & Bedding',
  mixed:        'Mix of Everything',
};

// ── Pricing Data (base = wash & fold prices) ──
const PRICING = {
  small:  { price: 24.99, maxWeight: 10, label: 'Small Bag', per: 'up to 10 lbs' },
  medium: { price: 44.99, maxWeight: 20, label: 'Medium Bag', per: 'up to 20 lbs' },
  large:  { price: 59.99, maxWeight: 30, label: 'Large Bag', per: 'up to 30 lbs' },
  xl:     { price: 89.99, maxWeight: 50, label: 'XL Bag', per: 'up to 50 lbs' },
};

const DELIVERY_FEES = {
  '48h':        { fee: 0,     label: 'Standard (48h)' },
  '24h':        { fee: 5.99,  label: 'Next Day (24h)' },
  'same_day':   { fee: 12.99, label: 'Same Day (12h)' },
};

const TAX_RATE = 0.08875; // NY sales tax

// ── Pricing Engine (with service-type adjustment) ──
// Local quick-estimate. Used as the instant-feedback path BEFORE the user has
// entered an address. After they have an address (with lat/lng), the dynamic
// engine below takes over and calls /api/quote/dynamic for live pricing.
function updatePricePreview() {
  // If we have address coords, prefer the live dynamic API path.
  if (typeof selectedPlace !== 'undefined' && selectedPlace && selectedPlace.lat && selectedPlace.lng) {
    requestDynamicQuote();
    return;
  }

  const bag = document.getElementById('bag-select').value;
  const speed = document.getElementById('speed-select').value;
  const service = document.getElementById('service-select').value;
  const preview = document.getElementById('price-preview');

  if (!bag) {
    preview.classList.remove('visible');
    return;
  }

  const bagData = PRICING[bag];
  const deliveryData = DELIVERY_FEES[speed] || DELIVERY_FEES['48h'];
  const serviceMultiplier = SERVICE_MULTIPLIERS[service] || 1.0;

  // Apply service multiplier to the base bag price
  const adjustedBagPrice = Math.round(bagData.price * serviceMultiplier * 100) / 100;

  // Local add-on estimate (so total reflects selected add-ons instantly,
  // even before we have an address that triggers the live API).
  const localAddOnsTotal = (typeof _availableAddOns !== 'undefined' && _availableAddOns.length)
    ? Array.from(_selectedAddOnIds).reduce((sum, id) => {
        const ao = _availableAddOns.find(a => a.id === id);
        return sum + (ao ? Number(ao.price || 0) : 0);
      }, 0)
    : 0;

  // Add a local estimate of logistics (handoff + window discount) so the price
  // doesn't appear to flicker when the live call eventually returns.
  const localLogistics = computeLocalLogistics();
  const subtotal = adjustedBagPrice + deliveryData.fee + localLogistics.net + localAddOnsTotal;
  const tax = Math.round(subtotal * TAX_RATE * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;

  document.getElementById('pp-bag').textContent = '$' + adjustedBagPrice.toFixed(2);
  document.getElementById('pp-delivery').textContent = deliveryData.fee === 0 ? 'Free' : '$' + deliveryData.fee.toFixed(2);
  document.getElementById('pp-tax').textContent = '$' + tax.toFixed(2);
  document.getElementById('pp-total').textContent = '$' + total.toFixed(2);

  // Build merged local lines: pickup adjustments + add-on chips so user sees what they tapped.
  const localLines = [...localLogistics.lines];
  if (localAddOnsTotal > 0) {
    for (const id of _selectedAddOnIds) {
      const ao = _availableAddOns.find(a => a.id === id);
      if (ao) localLines.push({ label: ao.displayName + ' x1', amount: Number(ao.price), type: 'addon' });
    }
  }
  renderLocalLogistics(localLines);

  // Show service type label if not wash & fold
  const serviceNote = document.getElementById('pp-service-note');
  if (serviceNote) {
    if (service && service !== 'wash_fold') {
      serviceNote.textContent = SERVICE_LABELS[service] + ' pricing';
      serviceNote.style.display = 'block';
    } else {
      serviceNote.style.display = 'none';
    }
  }

  // Estimate disclaimer (will become "Live" once dynamic call returns)
  const sourceEl = document.getElementById('pp-source');
  if (sourceEl) { sourceEl.textContent = 'Estimated price — enter address for live quote'; sourceEl.hidden = false; }

  preview.classList.add('visible');
}

// ───────────────────────────────────────────────────────────────────────────────
//  DYNAMIC LOGISTICS UI (Uber-style) — collects pickup details and shows live price
// ───────────────────────────────────────────────────────────────────────────────
const LOGISTICS_DEFAULTS = {
  floor: 1,
  hasElevator: 1,
  handoff: 'curbside',
  windowMinutes: 30,
  vendorChoice: 'auto',
};

function collectLogisticsState() {
  const floorEl    = document.getElementById('pickup-floor');
  const elevEl     = document.getElementById('pickup-elevator');
  const vendorEl   = document.getElementById('vendor-choice');
  const handoffPill = document.querySelector('.adv-pill.is-selected[data-handoff]');
  const windowPill  = document.querySelector('.adv-pill.is-selected[data-window]');
  return {
    pickupFloor: parseInt(floorEl?.value || '1', 10) || 1,
    pickupHasElevator: elevEl ? (elevEl.value === '1') : true,
    pickupHandoff: handoffPill?.dataset.handoff || LOGISTICS_DEFAULTS.handoff,
    pickupWindowMinutes: parseInt(windowPill?.dataset.window || '30', 10) || 30,
    vendorChoiceMode: vendorEl?.value || LOGISTICS_DEFAULTS.vendorChoice,
  };
}

// Compute a local, optimistic estimate of the logistics line so the UI feels snappy
// before /api/quote/dynamic returns. Uses the same constants as the backend config.
function computeLocalLogistics() {
  const s = collectLogisticsState();
  let floorFee = 0;
  if (!s.pickupHasElevator && s.pickupFloor > 3) {
    floorFee = Math.min(20, (s.pickupFloor - 3) * 2);
  }
  const handoffFee = s.pickupHandoff === 'door' ? 3 : 0;
  const base = floorFee + handoffFee;
  const windowRate = s.pickupWindowMinutes === 240 ? 0.10 : s.pickupWindowMinutes === 120 ? 0.05 : 0;
  const windowDiscount = Math.round(base * windowRate * 100) / 100;
  // ── Roll up all pickup adjustments into a single customer-friendly line. ──
  const net = Math.round((base - windowDiscount) * 100) / 100;
  const lines = [];
  if (net > 0) {
    lines.push({ label: 'Pickup adjustments', amount: net, type: 'logistics' });
  } else if (net < 0) {
    lines.push({ label: 'Pickup savings', amount: net, type: 'discount' });
  }
  // (we still expose `net` so the local subtotal stays accurate)
  return { net: Math.max(0, net), lines };
}

function renderLocalLogistics(lines) {
  const container = document.getElementById('pp-logistics');
  if (!container) return;
  container.innerHTML = '';
  for (const li of lines) {
    const row = document.createElement('div');
    row.className = 'price-row price-row--logistics' + (li.type === 'discount' ? ' price-row--discount' : '');
    const lbl = document.createElement('span'); lbl.textContent = li.label;
    const val = document.createElement('span'); val.className = 'price-value';
    val.textContent = (li.amount < 0 ? '−$' : '$') + Math.abs(li.amount).toFixed(2);
    row.appendChild(lbl); row.appendChild(val);
    container.appendChild(row);
  }
}

function renderApiBreakdown(b) {
  // Service price (after multiplier)
  const serviceEl = document.getElementById('pp-bag');
  if (serviceEl) serviceEl.textContent = '$' + (b.laundryServicePrice ?? 0).toFixed(2);
  // Delivery fee
  const deliveryEl = document.getElementById('pp-delivery');
  if (deliveryEl) deliveryEl.textContent = (b.deliveryFee || 0) === 0 ? 'Free' : '$' + b.deliveryFee.toFixed(2);
  // Tax + total
  const taxEl = document.getElementById('pp-tax');
  if (taxEl) taxEl.textContent = '$' + (b.taxAmount ?? 0).toFixed(2);
  const totalEl = document.getElementById('pp-total');
  if (totalEl) totalEl.textContent = '$' + (b.total ?? 0).toFixed(2);

  // ── Simplified customer rendering ──
  // The backend already collapsed logistics into a single "Pickup adjustments" line
  // for customer view. We only need to render the rolled-up rows the API gives us.
  const container = document.getElementById('pp-logistics');
  if (container) {
    container.innerHTML = '';
    const lines = Array.isArray(b.lineItems) ? b.lineItems : [];
    for (const li of lines) {
      // Skip rows already rendered elsewhere (service/delivery/tax) and skip promo (folded into total).
      if (['service', 'delivery', 'tax'].includes(li.type)) continue;
      if (li.type === 'discount' && typeof li.label === 'string' && li.label.startsWith('Promo discount')) continue;
      // Also skip add-on lines if we're rendering them in their own selector block;
      // keep them visible in the breakdown for now so users see what they added.
      const row = document.createElement('div');
      const isDiscount = li.amount < 0;
      row.className = 'price-row price-row--logistics' + (isDiscount ? ' price-row--discount' : '');
      const lbl = document.createElement('span'); lbl.textContent = li.label;
      const val = document.createElement('span'); val.className = 'price-value';
      val.textContent = (isDiscount ? '−$' : '$') + Math.abs(li.amount).toFixed(2);
      row.appendChild(lbl); row.appendChild(val);
      container.appendChild(row);
    }
  }

  // "Live price" caption — keep it short and friendly, no vendor name, no traffic chatter.
  const sourceEl = document.getElementById('pp-source');
  if (sourceEl) {
    sourceEl.textContent = 'Live price — final pickup adjustments included';
    sourceEl.hidden = false;
  }
}

function renderCheapestSlot(cs) {
  const banner = document.getElementById('cheapest-banner');
  const text   = document.getElementById('cheapest-banner-text');
  if (!banner || !text) return;
  if (!cs || !cs.scheduledPickup || cs.multiplier >= 1.05) {
    banner.hidden = true;
    return;
  }
  // Format the recommended local time
  let when = '';
  try {
    const d = new Date(cs.scheduledPickup);
    when = d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  } catch (_) { when = 'soon'; }
  text.textContent = `Cheapest pickup window starts ${when} — ${cs.trafficLevel} traffic`;
  banner.hidden = false;
}

let _dynQuoteTimer = null;
let _dynQuoteSeq = 0;
function requestDynamicQuote() {
  // Debounce: wait 250ms after the last input change before firing the request
  if (_dynQuoteTimer) clearTimeout(_dynQuoteTimer);
  _dynQuoteTimer = setTimeout(_fireDynamicQuote, 250);
}

async function _fireDynamicQuote() {
  const bag = document.getElementById('bag-select')?.value;
  if (!bag) return;
  const speed = document.getElementById('speed-select')?.value || '48h';
  const service = document.getElementById('service-select')?.value || 'wash_fold';
  const place = (typeof selectedPlace !== 'undefined') ? selectedPlace : null;
  const logistics = collectLogisticsState();
  const seq = ++_dynQuoteSeq;

  // Selected add-ons (hang-dry, eco detergent, etc.) — collected from the addon UI block
  const selectedAddOns = collectSelectedAddOns();

  const body = {
    tierName: bag,
    deliverySpeed: speed,
    serviceType: service,
    pickupAddress: place?.formatted || document.getElementById('address-input')?.value || '',
    pickupLat: place?.lat,
    pickupLng: place?.lng,
    pickupFloor: logistics.pickupFloor,
    pickupHasElevator: logistics.pickupHasElevator,
    pickupHandoff: logistics.pickupHandoff,
    pickupWindowMinutes: logistics.pickupWindowMinutes,
    vendorChoiceMode: logistics.vendorChoiceMode,
    addOns: selectedAddOns,
    recommendCheapestWindow: logistics.pickupWindowMinutes >= 120,
    view: 'customer',
  };

  try {
    const res = await fetch(API_BASE + '/api/quote/dynamic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return;  // swallow — keep showing the local estimate
    const data = await res.json();
    // Discard if a newer request has been fired in the meantime
    if (seq !== _dynQuoteSeq) return;
    if (data && data.breakdown) {
      renderApiBreakdown(data.breakdown);
      const preview = document.getElementById('price-preview');
      if (preview) preview.classList.add('visible');
    }
    renderCheapestSlot(data?.cheapestSlot);
  } catch (e) {
    // Network blip — keep the local estimate, no UI scare
    console.warn('[dynamic quote] failed:', e?.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ADD-ONS UI — hang-dry, eco detergent, fragrance-free, etc.
//  Fetched from /api/add-ons; rendered as toggle pills the customer can tap.
//  Selections feed straight into the dynamic quote so the price reflects them live.
// ─────────────────────────────────────────────────────────────────────────────
let _availableAddOns = [];
let _selectedAddOnIds = new Set();

function collectSelectedAddOns() {
  return Array.from(_selectedAddOnIds).map(id => ({ id: Number(id), qty: 1 }));
}

async function loadAddOns() {
  const container = document.getElementById('addons-grid');
  if (!container) return;
  try {
    const res = await fetch(API_BASE + '/api/add-ons');
    if (!res.ok) return;
    const data = await res.json();
    _availableAddOns = Array.isArray(data) ? data : (data?.addOns || []);
    renderAddOns();
  } catch (e) {
    console.warn('[loadAddOns] failed:', e?.message);
  }
}

// Add-ons whose name should NEVER appear in the add-on grid because they
// belong in the Delivery Speed selector at the top of the form.
const _SPEED_ADDONS = new Set(['same_day', 'sameday']);

function renderAddOns() {
  const container = document.getElementById('addons-grid');
  if (!container) return;
  container.innerHTML = '';
  // Show only the most useful ones to customers — hide internal/operational add-ons
  // and anything that is really a delivery speed (those live in the Delivery Speed dropdown).
  const visible = _availableAddOns
    .filter(a => a.isActive !== 0 && a.isActive !== false)
    .filter(a => !_SPEED_ADDONS.has(String(a.name || '').toLowerCase()))
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  for (const ao of visible) {
    const id = ao.id;
    const isSelected = _selectedAddOnIds.has(id);
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'addon-pill' + (isSelected ? ' is-selected' : '');
    pill.dataset.addonId = String(id);
    pill.setAttribute('role', 'checkbox');
    pill.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    pill.innerHTML =
      '<span class="addon-pill__title">' + escapeHtml(ao.displayName || ao.name) + '</span>' +
      '<span class="addon-pill__price">+$' + Number(ao.price || 0).toFixed(2) + '</span>';
    pill.addEventListener('click', () => {
      if (_selectedAddOnIds.has(id)) _selectedAddOnIds.delete(id);
      else _selectedAddOnIds.add(id);
      renderAddOns();        // re-render pill states
      updatePricePreview();  // refresh live quote
    });
    container.appendChild(pill);
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Wire up advanced-options toggle, pills, and inputs
function _initAdvancedControls() {
  const toggle = document.getElementById('adv-toggle');
  const panel  = document.getElementById('adv-options');
  if (toggle && panel) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      panel.hidden = open;
      if (!open) requestDynamicQuote();
    });
  }

  // Pills (handoff + window) — single-select per group
  document.querySelectorAll('.adv-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const group = pill.dataset.handoff != null ? '[data-handoff]' : '[data-window]';
      document.querySelectorAll(`.adv-pill${group}`).forEach(p => {
        p.classList.remove('is-selected');
        p.setAttribute('aria-checked', 'false');
      });
      pill.classList.add('is-selected');
      pill.setAttribute('aria-checked', 'true');
      updatePricePreview();
    });
  });

  // Floor + elevator inputs
  document.getElementById('pickup-floor')?.addEventListener('input', () => updatePricePreview());
  document.getElementById('pickup-elevator')?.addEventListener('change', () => updatePricePreview());
  document.getElementById('vendor-choice')?.addEventListener('change', () => updatePricePreview());
}

// Initialize once DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { _initAdvancedControls(); loadAddOns(); });
} else {
  _initAdvancedControls();
  loadAddOns();
}

// Listen to select changes
document.getElementById('bag-select').addEventListener('change', () => {
  updatePricePreview();
  saveFormState();
});
document.getElementById('speed-select').addEventListener('change', () => {
  updatePricePreview();
  saveFormState();
});
// Service type now also updates price
document.getElementById('service-select').addEventListener('change', () => {
  updatePricePreview();
  saveFormState();
});

// ── Form State Persistence (in-memory, no localStorage/sessionStorage) ──
let _formState = {};

function saveFormState() {
  _formState = {
    address: document.getElementById('address-input')?.value || '',
    service: document.getElementById('service-select')?.value || '',
    bag: document.getElementById('bag-select')?.value || '',
    speed: document.getElementById('speed-select')?.value || '',
  };
}

function restoreFormState() {
  // In-memory only — nothing to restore on fresh page load
}

function clearFormState() {
  _formState = {};
}

// Save state on address/service changes
document.getElementById('address-input')?.addEventListener('input', saveFormState);

// Restore on load
restoreFormState();

// ── Order Flow ──
let orderState = 'quote'; // quote | schedule | checkout | payment
let orderBtnLocked = false; // rapid-click protection

async function handleOrderClick() {
  // Rapid-click protection
  if (orderBtnLocked) return;

  const btn = document.getElementById('order-btn');
  orderBtnLocked = true;
  btn.disabled = true;
  setTimeout(() => {
    orderBtnLocked = false;
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
      selectedPlace = { formatted: address, manual: true };
    }
    if (!service) {
      shakeField('service-select');
      return;
    }
    if (!bag) {
      shakeField('bag-select');
      return;
    }

    // Show price
    updatePricePreview();
    
    // Transition to schedule step
    orderState = 'schedule';
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
    orderState = 'checkout';
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
    orderState = 'payment';
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

// ── Inline Field Error (red border + message + scroll) ──
function showFieldError(inputEl, message) {
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

// Auto-format phone number as user types
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

// Dynamic API base — matches the hostname the site is loaded from
const API_BASE = window.location.hostname === '127.0.0.1' 
  ? 'http://127.0.0.1:5000' 
  : (window.location.hostname === 'localhost' ? 'http://localhost:5000' : 'https://api.offloadusa.com');

// ── Stripe Payment Integration ──
let stripeInstance = null;
let stripeElements = null;
let cardElement = null;

function initStripe() {
  if (stripeInstance) return;
  if (typeof Stripe === 'undefined') {
    console.warn('[Stripe] Stripe.js not loaded');
    return;
  }
  stripeInstance = Stripe('pk_test_51TMiltKfiq0b5r3zXngAkvVa1KCRhnQGZPLZ4lQarShmk2JupWVhDjkN7LzFpANBTUw47iNFY4fXzfoaa1Lu9PU300Qs02jfiP');
}

function addPaymentField() {
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

async function processPaymentAndOrder() {
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
    errorBanner.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      <span>${err.message || 'Payment failed. Please check your card and try again.'}</span>
    `;
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

function resetOrder() {
  orderState = 'quote';
  clearFormState();
  location.reload();
}

function shakeField(id) {
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

// Add shake keyframe
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-6px); }
    75% { transform: translateX(6px); }
  }
  @keyframes pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(1.4); }
  }
  .pac-container {
    background: #1a1a1a !important;
    border: 1px solid rgba(255,255,255,0.12) !important;
    border-radius: 10px !important;
    margin-top: 4px !important;
    font-family: 'Inter', sans-serif !important;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4) !important;
    z-index: 10000 !important;
  }
  .pac-item {
    padding: 10px 14px !important;
    border-bottom: 1px solid rgba(255,255,255,0.06) !important;
    color: #e2e8f0 !important;
    cursor: pointer !important;
    font-size: 0.88rem !important;
  }
  .pac-item:hover, .pac-item-selected {
    background: rgba(91,75,196,0.15) !important;
  }
  .pac-item-query {
    color: #fff !important;
    font-weight: 600 !important;
  }
  .pac-icon { display: none !important; }
  .pac-item span { color: #94a3b8 !important; }
  .pac-item-query span { color: #fff !important; }
  .pac-logo::after { display: none !important; }
`;
document.head.appendChild(shakeStyle);


// ── Mobile Navigation ──
const hamburger = document.getElementById('hamburger');
const mobileNav = document.getElementById('mobile-nav');

hamburger?.addEventListener('click', () => {
  mobileNav.classList.toggle('active');
  // Animate hamburger
  const spans = hamburger.querySelectorAll('span');
  if (mobileNav.classList.contains('active')) {
    spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
    spans[1].style.opacity = '0';
    spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
  } else {
    spans[0].style.transform = '';
    spans[1].style.opacity = '';
    spans[2].style.transform = '';
  }
});

function closeMobile() {
  mobileNav?.classList.remove('active');
  const spans = hamburger?.querySelectorAll('span');
  if (spans) {
    spans[0].style.transform = '';
    spans[1].style.opacity = '';
    spans[2].style.transform = '';
  }
}

// ── Smooth scroll for anchor links ──
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      e.preventDefault();
      const offset = 80; // header height
      const y = target.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  });
});


// ── FAQ Accordion ──
function toggleFaq(button) {
  const item = button.parentElement;
  const answer = item.querySelector('.faq-answer');
  const isActive = item.classList.contains('active');

  // Close all
  document.querySelectorAll('.faq-item').forEach(el => {
    el.classList.remove('active');
    el.querySelector('.faq-answer').style.maxHeight = null;
    el.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
  });

  // Open clicked if not already open
  if (!isActive) {
    item.classList.add('active');
    answer.style.maxHeight = answer.scrollHeight + 'px';
    button.setAttribute('aria-expanded', 'true');
  }
}


// ── Chatbot ──
const chatbotTrigger = document.getElementById('chatbot-trigger');
const chatbotPanel = document.getElementById('chatbot-panel');
const chatbotClose = document.getElementById('chatbot-close');
const chatbotInput = document.getElementById('chatbot-input');
const chatbotMessages = document.getElementById('chatbot-messages');

chatbotTrigger?.addEventListener('click', () => {
  chatbotPanel.classList.toggle('active');
  if (chatbotPanel.classList.contains('active')) {
    chatbotInput.focus();
  }
});

chatbotClose?.addEventListener('click', () => {
  chatbotPanel.classList.remove('active');
});

// Chatbot response engine
const CHAT_RESPONSES = {
  pricing: {
    patterns: [/pric/i, /cost/i, /how much/i, /rate/i, /bag/i, /pound/i, /\$/i, /cheap/i, /expensive/i, /afford/i],
    response: "Our pricing is simple and transparent:\n\n**Wash & Fold (base prices):**\n• Small Bag (up to 10 lbs): $24.99\n• Medium Bag (up to 20 lbs): $44.99\n• Large Bag (up to 30 lbs): $59.99\n• XL Bag (up to 50 lbs): $89.99\n\n**Service adjustments:**\n• Dry Cleaning: +65% over base\n• Comforters & Bedding: +40% over base\n• Mix of Everything: +25% over base\n\nIf you go over the weight limit, it's just $2.50 per extra pound. Standard delivery (48h) is free. Would you like to place an order?"
  },
  delivery: {
    patterns: [/deliver/i, /speed/i, /fast/i, /how long/i, /turnaround/i, /when/i, /time/i, /quick/i, /express/i, /same.?day/i, /next.?day/i],
    response: "We offer 3 delivery speeds:\n\n• Standard: 48 hours (free delivery)\n• Next Day: 24 hours (+$5.99)\n• Same Day: 12 hours (+$12.99) — only when you schedule pickup for today\n\nWe track every order against these windows — if we miss your delivery time, reach out and we'll make it right."
  },
  tracking: {
    patterns: [/track/i, /where/i, /status/i, /driver/i, /gps/i, /location/i, /eta/i],
    response: "You can track your order in real-time! Once a driver is assigned, you'll see their live location on a GPS map. You get notifications at every step — driver en route, laundry picked up, washing started, out for delivery, and delivered. We also take GPS-stamped photos at pickup and delivery."
  },
  damage: {
    patterns: [/damage/i, /lost/i, /missing/i, /broken/i, /ruin/i, /stain/i, /claim/i, /protect/i, /guarantee/i, /insurance/i],
    response: "Every order is protected under our garment care policy. If something goes wrong, file a claim within 14 days and we'll work to resolve it quickly. We take photo proof at every handoff to protect both you and us."
  },
  services: {
    patterns: [/service/i, /offer/i, /dry clean/i, /comforter/i, /alteration/i, /bedding/i, /type/i],
    response: "We offer:\n\n• Wash & Fold — your everyday laundry\n• Dry Cleaning — professional garment care (1.65x base price)\n• Comforters & Bedding — bulky items handled with care (1.4x base price)\n• Alterations — hems, repairs, and more\n• Commercial — bulk orders for businesses\n\nPrices adjust automatically when you select a service in the order form!"
  },
  loyalty: {
    patterns: [/loyal/i, /reward/i, /point/i, /tier/i, /bronze/i, /silver/i, /gold/i, /platinum/i, /earn/i, /discount/i, /subscribe/i, /subscription/i, /plan/i, /member/i],
    response: "Our loyalty program rewards you on every order:\n\n• Bronze: Starting tier, 5% off first order\n• Silver (500 pts): 10% off + free delivery\n• Gold (2,000 pts): 15% off + priority matching\n• Platinum (5,000 pts): 20% off + dedicated support\n\nYou earn points on every order — the more you use Offload, the more you save."
  },
  cancel: {
    patterns: [/cancel/i, /refund/i, /reschedule/i, /change/i, /modify/i],
    response: "You can cancel or reschedule for free any time before the driver starts heading to your location. After pickup begins, cancellation fees may apply. You can manage everything through the app, website, or chat with me right here!"
  },
  account: {
    patterns: [/account/i, /sign.?up/i, /register/i, /login/i, /need.?account/i],
    response: "No account needed to get a price or schedule a pickup! You'll only need to provide your email, phone, and payment info when you're ready to confirm. If you want to save your preferences, track past orders, or use loyalty points, scroll down to the Sign Up section to create a free account."
  },
  hello: {
    patterns: [/^hi$/i, /^hello$/i, /^hey$/i, /good morning/i, /good evening/i, /^sup/i, /^yo$/i],
    response: "Hey there! Welcome to Offload. I can help you with:\n\n• Pricing and bag sizes\n• Delivery speeds\n• Order tracking\n• Service types\n• Loyalty rewards\n• Filing a claim\n\nWhat would you like to know?"
  },
  order: {
    patterns: [/order/i, /place/i, /book/i, /schedule/i, /pickup/i, /want.*laundry/i, /start/i],
    response: "Great! Placing an order is super easy — just use the order form at the top of the page. Enter your address, pick your service and bag size, and you'll see your price instantly. No account needed until you're ready to pay.\n\nWould you like me to walk you through the pricing options?"
  },
  partner: {
    patterns: [/partner/i, /laundromat/i, /join/i, /drive/i, /driver/i, /earn/i, /work/i],
    response: "Want to grow with Offload?\n\nLaundromat Partners: Get a steady stream of orders with smart order queuing and automated payouts. Email partners@offloadusa.com\n\nDrivers: Earn $8.50+ per trip plus tips on your own schedule. Email drivers@offloadusa.com\n\nBoth get access to our full logistics platform."
  }
};

function findResponse(message) {
  for (const [key, data] of Object.entries(CHAT_RESPONSES)) {
    for (const pattern of data.patterns) {
      if (pattern.test(message)) return data.response;
    }
  }
  return "I'd be happy to help! I can answer questions about pricing, delivery speeds, order tracking, our services, garment protection, loyalty rewards, and more. What would you like to know?";
}

function sendChat() {
  const input = chatbotInput;
  const message = input.value.trim();
  if (!message) return;

  // Add user message
  const userDiv = document.createElement('div');
  userDiv.className = 'chat-message chat-message--user';
  userDiv.textContent = message;
  chatbotMessages.appendChild(userDiv);

  input.value = '';

  // Scroll to bottom
  chatbotMessages.scrollTop = chatbotMessages.scrollHeight;

  // Typing indicator
  const typingDiv = document.createElement('div');
  typingDiv.className = 'chat-message chat-message--bot';
  typingDiv.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span>';
  chatbotMessages.appendChild(typingDiv);
  chatbotMessages.scrollTop = chatbotMessages.scrollHeight;

  // Simulate response delay
  setTimeout(() => {
    typingDiv.remove();
    const botDiv = document.createElement('div');
    botDiv.className = 'chat-message chat-message--bot';
    botDiv.style.whiteSpace = 'pre-line';
    botDiv.textContent = findResponse(message);
    chatbotMessages.appendChild(botDiv);
    chatbotMessages.scrollTop = chatbotMessages.scrollHeight;
  }, 600 + Math.random() * 400);
}


// ── Scroll Animations ──
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('.animate-in').forEach(el => observer.observe(el));


// ── Header scroll effect ──
let lastScroll = 0;
window.addEventListener('scroll', () => {
  const header = document.getElementById('header');
  const current = window.pageYOffset;
  
  if (current > 100) {
    header.style.background = 'rgba(10, 22, 40, 0.98)';
    header.style.boxShadow = '0 2px 20px rgba(0,0,0,0.2)';
  } else {
    header.style.background = 'rgba(10, 22, 40, 0.95)';
    header.style.boxShadow = 'none';
  }
  
  lastScroll = current;
}, { passive: true });


// ══════════════════════════════════════════════
//  ADDRESS AUTOCOMPLETE (Nominatim / OpenStreetMap)
// ══════════════════════════════════════════════

let selectedPlace = null;
let addressVerified = false;
let autocompleteTimeout = null;
let autocompleteDropdown = null;

(function initAddressAutocomplete() {
  const addressInput = document.getElementById('address-input');
  if (!addressInput) return;

  // Create dropdown container
  autocompleteDropdown = document.createElement('div');
  autocompleteDropdown.id = 'address-dropdown';
  autocompleteDropdown.style.cssText = 'position:absolute;top:100%;left:0;right:0;background:#1A1A1A;border:1px solid #2E2E2E;border-top:none;border-radius:0 0 10px 10px;max-height:220px;overflow-y:auto;z-index:1000;display:none;box-shadow:0 8px 24px rgba(0,0,0,0.4);';
  addressInput.parentElement.style.position = 'relative';
  addressInput.parentElement.appendChild(autocompleteDropdown);

  addressInput.addEventListener('input', () => {
    addressVerified = false;
    selectedPlace = null;
    clearTimeout(autocompleteTimeout);
    const q = addressInput.value.trim();
    if (q.length < 4) { autocompleteDropdown.style.display = 'none'; return; }

    autocompleteTimeout = setTimeout(() => {
      fetch('https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=us&limit=5&q=' + encodeURIComponent(q), {
        headers: { 'Accept-Language': 'en' }
      })
        .then(r => r.json())
        .then(results => {
          autocompleteDropdown.innerHTML = '';
          if (!results.length) { autocompleteDropdown.style.display = 'none'; return; }
          autocompleteDropdown.style.display = 'block';
          results.forEach(r => {
            const item = document.createElement('div');
            item.style.cssText = 'padding:10px 14px;cursor:pointer;font-size:0.88rem;color:#e0e0e0;border-bottom:1px solid #2E2E2E;transition:background 0.15s;';
            item.textContent = r.display_name;
            item.addEventListener('mouseenter', () => { item.style.background = 'rgba(91,75,196,0.15)'; });
            item.addEventListener('mouseleave', () => { item.style.background = ''; });
            item.addEventListener('mousedown', (e) => {
              e.preventDefault();
              addressInput.value = r.display_name;
              selectedPlace = {
                formatted: r.display_name,
                lat: parseFloat(r.lat),
                lng: parseFloat(r.lon),
                components: {
                  city: r.address?.city || r.address?.town || r.address?.village || '',
                  state: r.address?.state || '',
                  zip: r.address?.postcode || '',
                },
              };
              addressVerified = true;
              autocompleteDropdown.style.display = 'none';
              addressInput.style.borderColor = '#5B4BC4';
              setTimeout(() => { addressInput.style.borderColor = ''; }, 1500);
              saveFormState();
              try { updatePricePreview(); } catch (_) {}
            });
            autocompleteDropdown.appendChild(item);
          });
        })
        .catch(() => { autocompleteDropdown.style.display = 'none'; });
    }, 350);
  });

  // Hide dropdown on blur
  addressInput.addEventListener('blur', () => {
    setTimeout(() => { autocompleteDropdown.style.display = 'none'; }, 200);
  });

  // Hide dropdown on focus if empty
  addressInput.addEventListener('focus', () => {
    if (addressInput.value.trim().length >= 4 && autocompleteDropdown.children.length > 0) {
      autocompleteDropdown.style.display = 'block';
    }
  });
})();

// Keep global initAutocomplete for compatibility (no-op now)
window.initAutocomplete = function() {};

// ── Geolocation for address (fallback if no Google Places) ──
if ('geolocation' in navigator) {
  const addressInput = document.getElementById('address-input');
  // Add a subtle location hint
  const geoBtn = document.createElement('button');
  geoBtn.type = 'button';
  geoBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>';
  geoBtn.style.cssText = 'position:absolute; right:12px; top:50%; transform:translateY(-50%); background:none; border:none; cursor:pointer; color:var(--gray-300); padding:4px;';
  geoBtn.title = 'Use my location';
  geoBtn.onclick = () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Reverse geocode with Nominatim (free, no API key)
        fetch(`https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json&addressdetails=1`)
          .then(r => r.json())
          .then(data => {
            if (data.display_name) {
              // Build a clean address
              const a = data.address || {};
              const parts = [];
              if (a.house_number && a.road) parts.push(a.house_number + ' ' + a.road);
              else if (a.road) parts.push(a.road);
              if (a.city || a.town || a.village) parts.push(a.city || a.town || a.village);
              if (a.state) parts.push(a.state);
              if (a.postcode) parts.push(a.postcode);
              addressInput.value = parts.join(', ') || data.display_name;
            } else {
              addressInput.value = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
            }
            addressInput.style.borderColor = '#5B4BC4';
            setTimeout(() => addressInput.style.borderColor = '', 1500);
            // Capture coords for live dynamic pricing even on Nominatim path
            try {
              selectedPlace = {
                formatted: addressInput.value,
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                components: {
                  city: a.city || a.town || a.village || '',
                  state: a.state || '',
                  zip: a.postcode || '',
                },
              };
            } catch (_) {}
            saveFormState();
            addressVerified = true;
            try { updatePricePreview(); } catch (_) {}
          })
          .catch(() => {
            addressInput.value = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
            try {
              selectedPlace = {
                formatted: addressInput.value,
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                components: { city: '', state: 'NY', zip: '' },
              };
            } catch (_) {}
            saveFormState();
            addressVerified = true;
            try { updatePricePreview(); } catch (_) {}
          });
      },
      () => { /* silent fail */ }
    );
  };
  
  // Wrap the input in a relative container so the arrow centers on the input, not the label+input
  const inputWrapper = document.createElement('div');
  inputWrapper.style.position = 'relative';
  addressInput.parentElement.insertBefore(inputWrapper, addressInput);
  inputWrapper.appendChild(addressInput);
  inputWrapper.appendChild(geoBtn);
}


// ══════════════════════════════════════════════
//  GEO-LOCATION HERO — "Serving [City/State]"
// ══════════════════════════════════════════════

// Service areas we currently operate in
const SERVICE_AREAS = {
  // New York metro
  'New York': true, 'Brooklyn': true, 'Queens': true, 'Bronx': true, 
  'Staten Island': true, 'Manhattan': true, 'Jersey City': true,
  'Hoboken': true, 'Newark': true, 'Yonkers': true, 'White Plains': true,
  // State-level fallback
  'NY': true, 'NJ': true,
};

// Friendly display names for states
const STATE_NAMES = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
  'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
  'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
  'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
  'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
  'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
  'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
  'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
  'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
  'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
  'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
  'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
  'WI': 'Wisconsin', 'WY': 'Wyoming', 'DC': 'District of Columbia',
};

(function detectLocation() {
  const badge = document.getElementById('hero-location-badge');
  const textEl = document.getElementById('hero-location-text');
  if (!badge || !textEl) return;

  // Try IP-based geolocation (free, no API key, no permission prompt)
  fetch('https://ipapi.co/json/')
    .then(r => r.json())
    .then(data => {
      if (!data || !data.region_code) return;

      const city = data.city || '';
      const stateCode = data.region_code || '';
      const stateName = STATE_NAMES[stateCode] || stateCode;

      // Check if we serve this location
      const inServiceArea = SERVICE_AREAS[city] || SERVICE_AREAS[stateCode];

      if (inServiceArea) {
        // We serve them — show city name proudly
        textEl.textContent = `Serving ${city || stateName}`;
        badge.style.background = 'rgba(91,75,196,0.12)';
      } else if (city) {
        // We do not serve there yet — show expansion copy
        textEl.textContent = `Expanding to ${stateName}`;
        badge.style.background = 'rgba(255,165,0,0.12)';
        badge.querySelector('.hero__badge-dot').style.background = '#f59e0b';
      }
      // If no data, leave default "Serving New York City"
    })
    .catch(() => {
      // Silent fail — keep default text
    });
})();


// ══════════════════════════════════════════════
//  SIGN UP & LOGIN
// ══════════════════════════════════════════════

function handleSignup() {
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

function showLoginModal() {
  // Redirect to dedicated sign-in page
  window.location.href = 'sign-in.html';
}

function handleLogin() {
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
function showAppAvailability() {
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
window.showAppComingSoon = showAppAvailability;

// ── Pricing card → pre-select bag size ──
// Map pricing card "Select" buttons to bag sizes
document.querySelectorAll('.pricing-card').forEach(card => {
  const selectBtn = card.querySelector('.btn');
  if (!selectBtn) return;
  const nameEl = card.querySelector('.pricing-card__name');
  if (!nameEl) return;
  const cardName = nameEl.textContent.trim().toLowerCase();

  let bagKey = null;
  if (cardName.includes('small')) bagKey = 'small';
  else if (cardName.includes('medium')) bagKey = 'medium';
  else if (cardName.includes('large')) bagKey = 'large';
  else if (cardName.includes('xl')) bagKey = 'xl';

  if (!bagKey) return;

  selectBtn.addEventListener('click', (e) => {
    // Scroll to widget (href="#hero-widget" already handles this via anchor)
    // Set the bag select value
    const bagSelect = document.getElementById('bag-select');
    if (bagSelect) {
      bagSelect.value = bagKey;
      updatePricePreview();
      saveFormState();
    }
  });
});


// ── Console branding ──
console.log('%c🧺 Offload USA', 'font-size:24px; font-weight:bold; color:#5B4BC4;');
console.log('%cFresh clothes, zero hassle.', 'font-size:14px; color:#94a3b8;');
console.log('%chttps://offloadusa.com', 'font-size:12px; color:#64748b;');
