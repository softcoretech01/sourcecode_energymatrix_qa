import React from "react";
import { cn } from "@/lib/utils";

type StatusSliderProps = {
  status: number | string;
  onToggle: () => void;
  disabled?: boolean;
};

export function StatusSlider({ status, onToggle, disabled }: StatusSliderProps) {
  const isActive = Number(status) === 1;

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-label={isActive ? "Set inactive" : "Set active"}
      className={cn(
        "relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
        disabled ? "cursor-not-allowed opacity-70" : "",
        isActive ? "bg-emerald-500 hover:bg-emerald-600" : "bg-red-500 hover:bg-red-600"
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out",
          isActive ? "translate-x-4" : "translate-x-0"
        )}
      />
    </button>
  );
}
