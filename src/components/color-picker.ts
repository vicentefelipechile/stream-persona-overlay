// =========================================================================================================
// COLOR PICKER COMPONENT
// =========================================================================================================
// A synced color picker + hex text input pair.
// Wraps the native <input type="color"> with a text field and validation,
// and fires an onChange callback whenever the color changes.
//
// Usage:
//   import { createColorPicker } from "../components/color-picker";
//   const { el, getValue } = createColorPicker("#00FF00", (hex) => console.log(hex));
//   container.appendChild(el);
//   const currentColor = getValue();
// =========================================================================================================

// =========================================================================================================
// Types
// =========================================================================================================

export interface ColorPickerInstance {
  /** The root element to append to the DOM. */
  el: HTMLDivElement;
  /** Returns the current valid hex color string (e.g. "#00FF00"). */
  getValue: () => string;
  /** Programmatically update the displayed color. */
  setValue: (hex: string) => void;
}

/**
 * Creates a synced color picker + hex text field pair.
 *
 * @param initial  Initial hex color string, e.g. "#00FF00".
 * @param onChange Called whenever the user changes the color (valid hex only).
 */
export function createColorPicker(
  initial: string,
  onChange?: (hex: string) => void
): ColorPickerInstance {
  const root = document.createElement("div");
  root.className = "color-picker-widget";
  root.style.cssText = "display:flex; gap:8px; align-items:center;";

  // Native color swatch
  const swatch = document.createElement("input");
  swatch.type = "color";
  swatch.id = `color-picker-${Math.random().toString(36).slice(2, 7)}`;
  swatch.value = sanitize(initial);
  swatch.style.cssText = "width:44px; height:36px; flex-shrink:0; cursor:pointer; border:none; background:none; padding:0;";

  // Hex text field
  const textField = document.createElement("input");
  textField.type = "text";
  textField.value = sanitize(initial);
  textField.maxLength = 7;
  textField.placeholder = "#RRGGBB";
  textField.style.fontFamily = "var(--font-mono, monospace)";
  textField.setAttribute("aria-label", "Hex color value");

  // =========================================================================================================
  // Sync: Swatch -> Text
  // =========================================================================================================
  swatch.addEventListener("input", () => {
    textField.value = swatch.value.toUpperCase();
    onChange?.(swatch.value);
  });

  // =========================================================================================================
  // Sync: Text -> Swatch
  // =========================================================================================================
  textField.addEventListener("input", () => {
    const hex = textField.value.trim();
    if (isValidHex(hex)) {
      swatch.value = hex;
      onChange?.(hex);
      textField.style.borderColor = "";
    } else {
      textField.style.borderColor = "var(--color-danger, #ff4d4d)";
    }
  });

  textField.addEventListener("blur", () => {
    // On blur, reset to last valid value if input is invalid
    if (!isValidHex(textField.value)) {
      textField.value = swatch.value.toUpperCase();
      textField.style.borderColor = "";
    }
  });

  root.appendChild(swatch);
  root.appendChild(textField);

  return {
    el: root,
    getValue: () => swatch.value,
    setValue: (hex: string) => {
      const safe = sanitize(hex);
      swatch.value = safe;
      textField.value = safe.toUpperCase();
    },
  };
}

// =========================================================================================================
// Helpers
// =========================================================================================================
function isValidHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function sanitize(hex: string): string {
  return isValidHex(hex) ? hex : "#00FF00";
}
