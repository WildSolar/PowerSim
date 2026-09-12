/**
 * One color/icon/label per consumption category, shared by every chart and
 * breakdown across the app so the same device always reads the same way
 * wherever it appears. The order and hex values were chosen with the dataviz
 * skill's palette validator (adjacent-pair CVD separation, chroma floor, contrast
 * vs. the panel's light surface) — see the "Daily energy" feature's commit for the
 * search that produced this specific ordering; reordering or recoloring should be
 * re-validated the same way rather than edited by eye.
 */

import type { CategoryEnergyKWh } from "../sim/energy";

export type DeviceCategoryKey = keyof CategoryEnergyKWh;

export interface DeviceCategoryInfo {
  key: DeviceCategoryKey;
  label: string;
  icon: string;
  color: string;
}

export const DEVICE_CATEGORIES: DeviceCategoryInfo[] = [
  { key: "fridge", label: "Fridge", icon: "🧊", color: "#2a78d6" },
  { key: "lighting", label: "Lighting", icon: "💡", color: "#eb6834" },
  { key: "plugLoad", label: "Other plug loads", icon: "🔌", color: "#4a3aa7" },
  { key: "cooking", label: "Cooking", icon: "🍳", color: "#e34948" },
  { key: "ev", label: "EV charging", icon: "🚗", color: "#1baf7a" },
  { key: "laundry", label: "Washer/dryer", icon: "🧺", color: "#a56b2c" },
  { key: "ac", label: "Air conditioning", icon: "❄️", color: "#e87ba4" },
  { key: "heatPump", label: "Space heating", icon: "🌡️", color: "#008300" },
  { key: "commercial", label: "Commercial/business use", icon: "🏢", color: "#2f9e8f" },
  { key: "solar", label: "Solar generation", icon: "☀️", color: "#eda100" },
  { key: "waterHeating", label: "Water heating", icon: "🚿", color: "#0f8fc0" },
];
