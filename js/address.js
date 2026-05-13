/* ═══════════════════════════════════════════════
   OFFLOAD USA — Address Autocomplete & Geo
   Google Places autocomplete, Nominatim fallback,
   geolocation, hero location badge
   ═══════════════════════════════════════════════ */

import {
  selectedPlace, setSelectedPlace,
  addressVerified, setAddressVerified,
} from './state.js';
import { updatePricePreview } from './pricing.js';
import { saveFormState } from './order-flow.js';

// ══════════════════════════════════════════════
//  ADDRESS AUTOCOMPLETE (Google Places → Nominatim fallback)
// ══════════════════════════════════════════════

let autocompleteTimeout = null;
let autocompleteDropdown = null;
let googlePlacesReady = false;
let googleSessionToken = null;

window.__OFFLOAD_API_BASE__ = window.__OFFLOAD_API_BASE__ || 'https://offload-api.onrender.com';

export function loadGooglePlaces() {
  if (window.google && window.google.maps && window.google.maps.places) {
    googlePlacesReady = true;
    if (window.google.maps.places.AutocompleteSessionToken) {
      googleSessionToken = new window.google.maps.places.AutocompleteSessionToken();
    }
    return Promise.resolve(true);
  }
  return fetch(window.__OFFLOAD_API_BASE__ + '/api/public/maps-key')
    .then(function(r){ return r.json(); })
    .then(function(cfg){
      if (!cfg || !cfg.configured || !cfg.mapsKey) return false;
      return new Promise(function(resolve){
        var s = document.createElement('script');
        s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(cfg.mapsKey) + '&libraries=places&loading=async';
        s.async = true; s.defer = true;
        s.onload = function(){
          googlePlacesReady = !!(window.google && window.google.maps && window.google.maps.places);
          if (googlePlacesReady && window.google.maps.places.AutocompleteSessionToken) {
            googleSessionToken = new window.google.maps.places.AutocompleteSessionToken();
          }
          resolve(googlePlacesReady);
        };
        s.onerror = function(){ resolve(false); };
        document.head.appendChild(s);
      });
    })
    .catch(function(){ return false; });
}

function googleAutocomplete(q) {
  return new Promise(function(resolve){
    if (!googlePlacesReady) return resolve([]);
    try {
      var service = new window.google.maps.places.AutocompleteService();
      service.getPlacePredictions({
        input: q,
        componentRestrictions: { country: 'us' },
        sessionToken: googleSessionToken,
        types: ['address']
      }, function(preds, status){
        if (status !== window.google.maps.places.PlacesServiceStatus.OK || !preds) return resolve([]);
        resolve(preds);
      });
    } catch (_) { resolve([]); }
  });
}

function googlePlaceDetails(placeId) {
  return new Promise(function(resolve){
    if (!googlePlacesReady) return resolve(null);
    try {
      var div = document.createElement('div');
      var svc = new window.google.maps.places.PlacesService(div);
      svc.getDetails({
        placeId: placeId,
        fields: ['formatted_address', 'geometry', 'address_components'],
        sessionToken: googleSessionToken
      }, function(place, status){
        if (status !== window.google.maps.places.PlacesServiceStatus.OK || !place) return resolve(null);
        var comps = {};
        (place.address_components || []).forEach(function(c){
          if (c.types.indexOf('locality') !== -1) comps.city = c.long_name;
          else if (c.types.indexOf('postal_town') !== -1 && !comps.city) comps.city = c.long_name;
          else if (c.types.indexOf('administrative_area_level_1') !== -1) comps.state = c.short_name;
          else if (c.types.indexOf('postal_code') !== -1) comps.zip = c.long_name;
        });
        resolve({
          formatted: place.formatted_address,
          lat: place.geometry && place.geometry.location.lat(),
          lng: place.geometry && place.geometry.location.lng(),
          components: comps
        });
      });
    } catch (_) { resolve(null); }
  });
}

export function initAddressAutocomplete() {
  const addressInput = document.getElementById('address-input');
  if (!addressInput) return;

  // Kick off Google Places load (key fetched from public API endpoint)
  loadGooglePlaces();

  // Create dropdown container
  autocompleteDropdown = document.createElement('div');
  autocompleteDropdown.id = 'address-dropdown';
  autocompleteDropdown.style.cssText = 'position:absolute;top:100%;left:0;right:0;background:#1A1A1A;border:1px solid #2E2E2E;border-top:none;border-radius:0 0 10px 10px;max-height:220px;overflow-y:auto;z-index:1000;display:none;box-shadow:0 8px 24px rgba(0,0,0,0.4);';
  addressInput.parentElement.style.position = 'relative';
  addressInput.parentElement.appendChild(autocompleteDropdown);

  addressInput.addEventListener('input', () => {
    setAddressVerified(false);
    setSelectedPlace(null);
    clearTimeout(autocompleteTimeout);
    const q = addressInput.value.trim();
    if (q.length < 4) { autocompleteDropdown.style.display = 'none'; return; }

    autocompleteTimeout = setTimeout(async () => {
      // Prefer Google Places when available; fall back to Nominatim.
      if (googlePlacesReady) {
        const preds = await googleAutocomplete(q);
        if (preds && preds.length) {
          autocompleteDropdown.innerHTML = '';
          autocompleteDropdown.style.display = 'block';
          preds.forEach(p => {
            const item = document.createElement('div');
            item.style.cssText = 'padding:10px 14px;cursor:pointer;font-size:0.88rem;color:#e0e0e0;border-bottom:1px solid #2E2E2E;transition:background 0.15s;';
            item.textContent = p.description;
            item.addEventListener('mouseenter', () => { item.style.background = 'rgba(91,75,196,0.15)'; });
            item.addEventListener('mouseleave', () => { item.style.background = ''; });
            item.addEventListener('mousedown', async (e) => {
              e.preventDefault();
              const details = await googlePlaceDetails(p.place_id);
              if (details) {
                addressInput.value = details.formatted;
                setSelectedPlace(details);
                setAddressVerified(true);
                autocompleteDropdown.style.display = 'none';
                addressInput.style.borderColor = '#5B4BC4';
                setTimeout(() => { addressInput.style.borderColor = ''; }, 1500);
                try { saveFormState(); } catch (_) {}
                try { updatePricePreview(); } catch (_) {}
                if (window.google && window.google.maps.places.AutocompleteSessionToken) {
                  googleSessionToken = new window.google.maps.places.AutocompleteSessionToken();
                }
              }
            });
            autocompleteDropdown.appendChild(item);
          });
          return;
        }
      }
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
              setSelectedPlace({
                formatted: r.display_name,
                lat: parseFloat(r.lat),
                lng: parseFloat(r.lon),
                components: {
                  city: r.address?.city || r.address?.town || r.address?.village || '',
                  state: r.address?.state || '',
                  zip: r.address?.postcode || '',
                },
              });
              setAddressVerified(true);
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
}

// Keep global initAutocomplete for compatibility (no-op now)
window.initAutocomplete = function() {};

// ── Geolocation for address (fallback if no Google Places) ──
export function initGeolocation() {
  if (!('geolocation' in navigator)) return;

  const addressInput = document.getElementById('address-input');
  if (!addressInput) return;

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
              setSelectedPlace({
                formatted: addressInput.value,
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                components: {
                  city: a.city || a.town || a.village || '',
                  state: a.state || '',
                  zip: a.postcode || '',
                },
              });
            } catch (_) {}
            saveFormState();
            setAddressVerified(true);
            try { updatePricePreview(); } catch (_) {}
          })
          .catch(() => {
            addressInput.value = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
            try {
              setSelectedPlace({
                formatted: addressInput.value,
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                components: { city: '', state: 'NY', zip: '' },
              });
            } catch (_) {}
            saveFormState();
            setAddressVerified(true);
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

export function detectLocation() {
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
        // We do not serve there yet — show approved expansion copy
        textEl.textContent = 'Starting in New York City, with plans to expand across the U.S. over the next 6–12 months.';
        badge.style.background = 'rgba(255,165,0,0.12)';
        badge.querySelector('.hero__badge-dot').style.background = '#f59e0b';
      }
      // If no data, leave default "Serving New York City"
    })
    .catch(() => {
      // Silent fail — keep default text
    });
}
