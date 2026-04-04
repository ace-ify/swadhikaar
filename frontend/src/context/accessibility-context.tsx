"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type Language = "en" | "hi";
type FontSize = "normal" | "large";

interface AccessibilityContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;
}

const AccessibilityContext = createContext<AccessibilityContextValue | undefined>(undefined);

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>("en");
  const [fontSize, setFontSize] = useState<FontSize>("normal");

  return (
    <AccessibilityContext.Provider
      value={{ language, setLanguage, fontSize, setFontSize }}
    >
      {children}
    </AccessibilityContext.Provider>
  );
}

export function useAccessibility() {
  const context = useContext(AccessibilityContext);
  if (!context) {
    throw new Error("useAccessibility must be used within an AccessibilityProvider");
  }
  return context;
}
