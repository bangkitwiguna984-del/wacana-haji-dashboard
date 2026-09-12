"use client";

import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

/**
 * Pengganti `<select>` bawaan sistem operasi.
 *
 * Memakai Radix Select agar daftar pilihan dirender ke portal. Ini penting karena
 * beberapa panel filter berada di dalam kontainer `overflow: hidden`, sehingga
 * daftar yang diposisikan biasa akan terpotong. Radix juga sudah menangani
 * navigasi papan ketik, pengetikan cepat, dan atribut ARIA listbox.
 */

export type SelectOption = { value: string; label: string };

export function SelectField({ label, value, options, onValueChange, className, placeholder, srOnlyLabel }: {
  label: string;
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  /** Sembunyikan label secara visual ketika kontainer sudah memberi konteksnya. */
  srOnlyLabel?: boolean;
}) {
  return (
    <div className={className ? `field ${className}` : "field"}>
      <span className={srOnlyLabel ? "field-label sr-only" : "field-label"}>{label}</span>
      <RadixSelect.Root value={value} onValueChange={onValueChange}>
        <RadixSelect.Trigger className="field-control" aria-label={label}>
          <RadixSelect.Value placeholder={placeholder} />
          <RadixSelect.Icon className="field-chevron"><ChevronDown size={13} aria-hidden="true" /></RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content className="select-popover" position="popper" sideOffset={5} collisionPadding={12}>
            <RadixSelect.Viewport className="select-viewport">
              {options.map((option) => (
                <RadixSelect.Item key={option.value} value={option.value} className="select-option">
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator className="select-tick"><Check size={13} aria-hidden="true" /></RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  );
}
