import type { WeatherCondition } from "../sim/weather";

export const CONDITION_ICON: Record<WeatherCondition, string> = {
  clear: "☀️",
  "partly-cloudy": "🌤️",
  cloudy: "☁️",
  overcast: "🌥️",
  rain: "🌧️",
  snow: "🌨️",
};

export const CONDITION_LABEL: Record<WeatherCondition, string> = {
  clear: "Clear",
  "partly-cloudy": "Partly cloudy",
  cloudy: "Cloudy",
  overcast: "Overcast",
  rain: "Rain",
  snow: "Snow",
};
