/* ═══════════════════════════════════════════════
   OFFLOAD USA — Shared State
   Mutable state shared across ES modules
   ═══════════════════════════════════════════════ */

// Dynamic API base — matches the hostname the site is loaded from
export const API_BASE = window.location.hostname === '127.0.0.1'
  ? 'http://127.0.0.1:5000'
  : (window.location.hostname === 'localhost' ? 'http://localhost:5000' : 'https://offload-api-sandbox.onrender.com');

// Address state
export let selectedPlace = null;
export let addressVerified = false;

export function setSelectedPlace(val) { selectedPlace = val; }
export function setAddressVerified(val) { addressVerified = val; }

// Add-on state
export let _availableAddOns = [];
export let _selectedAddOnIds = new Set();

export function setAvailableAddOns(val) { _availableAddOns = val; }

// Order flow state
export let orderState = 'quote'; // quote | schedule | checkout | payment
export let orderBtnLocked = false;

export function setOrderState(val) { orderState = val; }
export function setOrderBtnLocked(val) { orderBtnLocked = val; }

// Form state persistence (in-memory)
export let _formState = {};

export function setFormState(val) { _formState = val; }
