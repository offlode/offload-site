/* ═══════════════════════════════════════════════
   OFFLOAD USA — Pricing Engine
   Pricing calculator, service type configs,
   dynamic quote, add-ons, logistics UI
   ═══════════════════════════════════════════════ */

import {
  API_BASE,
  selectedPlace,
  _availableAddOns, _selectedAddOnIds, setAvailableAddOns,
} from './state.js';

// ── Service-Type Pricing Multipliers ──
// Dry cleaning costs more, comforters cost more, mixed = blended rate
export const SERVICE_MULTIPLIERS = {
  wash_fold:    1.0,
  dry_cleaning: 1.65,
  comforters:   1.40,
  mixed:        1.25,
};

export const SERVICE_LABELS = {
  wash_fold:    'Wash & Fold',
  dry_cleaning: 'Dry Cleaning',
  comforters:   'Comforters & Bedding',
  mixed:        'Mix of Everything',
};

// ── Pricing Data (base = wash & fold prices) ──
export const PRICING = {
  small:  { price: 24.99, maxWeight: 10, label: 'Small Bag', per: 'up to 10 lbs' },
  medium: { price: 44.99, maxWeight: 20, label: 'Medium Bag', per: 'up to 20 lbs' },
  large:  { price: 59.99, maxWeight: 30, label: 'Large Bag', per: 'up to 30 lbs' },
  xl:     { price: 89.99, maxWeight: 50, label: 'XL Bag', per: 'up to 50 lbs' },
};

export const DELIVERY_FEES = {
  '48h':        { fee: 0,     label: 'Standard (48h)' },
  '24h':        { fee: 5.99,  label: 'Next Day (24h)' },
  'same_day':   { fee: 12.99, label: 'Same Day (12h)' },
};

export const TAX_RATE = 0.08875; // NY sales tax

// ── Pricing Engine (with service-type adjustment) ──
// Local quick-estimate. Used as the instant-feedback path BEFORE the user has
// entered an address. After they have an address (with lat/lng), the dynamic
// engine below takes over and calls /api/quote/dynamic for live pricing.
export function updatePricePreview() {
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

export function collectLogisticsState() {
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
export function requestDynamicQuote() {
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

export function collectSelectedAddOns() {
  return Array.from(_selectedAddOnIds).map(id => ({ id: Number(id), qty: 1 }));
}

export async function loadAddOns() {
  const container = document.getElementById('addons-grid');
  if (!container) return;
  try {
    const res = await fetch(API_BASE + '/api/add-ons');
    if (!res.ok) return;
    const data = await res.json();
    setAvailableAddOns(Array.isArray(data) ? data : (data?.addOns || []));
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

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Wire up advanced-options toggle, pills, and inputs
export function initAdvancedControls() {
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
