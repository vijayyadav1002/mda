import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

type DarkModeContextValue = {
  darkMode: boolean;
  setDarkMode: Dispatch<SetStateAction<boolean>>;
};

const DarkModeContext = createContext<DarkModeContextValue | null>(null);

export function DarkModeProvider({ children }: { children: ReactNode }) {
  const [darkMode, setDarkMode] = useState(true);
  const persist = useRef(false);

  useEffect(() => {
    const stored = localStorage.getItem("darkMode");
    setDarkMode(stored !== null ? stored === "true" : true);
  }, []);

  useEffect(() => {
    if (!persist.current) {
      persist.current = true;
      return;
    }
    localStorage.setItem("darkMode", darkMode.toString());
  }, [darkMode]);

  return (
    <DarkModeContext.Provider value={{ darkMode, setDarkMode }}>
      {children}
    </DarkModeContext.Provider>
  );
}

export function useDarkMode() {
  const ctx = useContext(DarkModeContext);
  if (!ctx) {
    throw new Error("useDarkMode must be used within DarkModeProvider");
  }
  return ctx;
}
