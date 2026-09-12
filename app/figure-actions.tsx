"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Check, Copy, Download } from "lucide-react";

/**
 * Menyalin dan mengunduh gambar dari setiap visualisasi.
 *
 * Penangkapan dilakukan terhadap elemen yang dirender, bukan melalui API tiap
 * pustaka, sehingga satu jalur yang sama melayani ECharts dengan renderer canvas,
 * ECharts dengan renderer SVG, dan kanvas force graph. Hasilnya juga persis seperti
 * yang terlihat di layar.
 */

const BACKGROUND = "#fffdf7";
const SCALE = 2;

function paint(width: number, height: number, scale: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.scale(scale, scale);
  // Kanvas force graph dan sebagian bagan berlatar transparan; tanpa isian ini
  // gambar yang ditempel ke dokumen lain akan berlatar hitam.
  context.fillStyle = BACKGROUND;
  context.fillRect(0, 0, width, height);
  return { canvas, context };
}

function toBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
}

async function fromCanvas(source: HTMLCanvasElement) {
  const width = source.clientWidth || source.width;
  const height = source.clientHeight || source.height;
  const target = paint(width, height, SCALE);
  if (!target) return null;
  target.context.drawImage(source, 0, 0, width, height);
  return toBlob(target.canvas);
}

async function fromSvg(source: SVGElement) {
  const rect = source.getBoundingClientRect();
  const clone = source.cloneNode(true) as SVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(rect.width));
  clone.setAttribute("height", String(rect.height));
  const markup = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("SVG gagal dirasterisasi"));
      element.src = url;
    });
    const target = paint(rect.width, rect.height, SCALE);
    if (!target) return null;
    target.context.drawImage(image, 0, 0, rect.width, rect.height);
    return toBlob(target.canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function area(element: Element) {
  const rect = element.getBoundingClientRect();
  return rect.width * rect.height;
}

/**
 * Memilih elemen visual terbesar di dalam figure, dan mengabaikan apa pun yang
 * berada di dalam tombol. Tanpa ini ikon SVG pada tombol Salin sendiri yang
 * terambil, karena ia lebih dulu ditemui dalam urutan dokumen.
 */
function pickVisual(root: HTMLElement) {
  const candidates = Array.from(root.querySelectorAll("canvas, svg"))
    .filter((element) => !element.closest(".figure-export") && !element.closest("button"));
  return candidates.sort((left, right) => area(right) - area(left))[0] || null;
}

export async function captureFigure(root: HTMLElement | null): Promise<Blob | null> {
  const visual = root ? pickVisual(root) : null;
  if (!visual) return null;
  if (visual instanceof HTMLCanvasElement) return fromCanvas(visual);
  return fromSvg(visual as SVGElement);
}

function slug(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "visualisasi";
}

type Status = "idle" | "copied" | "unsupported" | "failed";

export function FigureActions({ targetRef, name }: {
  targetRef: React.RefObject<HTMLElement | null>;
  name: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<number | undefined>(undefined);

  const flash = (next: Status) => {
    setStatus(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus("idle"), 2200);
  };

  const copy = async () => {
    try {
      const blob = await captureFigure(targetRef.current);
      if (!blob) return flash("failed");
      // Penulisan gambar ke papan klip perlu konteks aman dan dukungan ClipboardItem.
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return flash("unsupported");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      flash("copied");
    } catch {
      flash("failed");
    }
  };

  const download = async () => {
    try {
      const blob = await captureFigure(targetRef.current);
      if (!blob) return flash("failed");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `wacana-haji-${slug(name)}-${new Date().toISOString().slice(0, 10)}.png`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      flash("failed");
    }
  };

  const failed = status === "unsupported" || status === "failed";
  const hint = status === "unsupported" ? "Peramban tidak mendukung salin gambar"
    : status === "failed" ? "Gagal menyalin gambar" : `Salin gambar ${name}`;

  return (
    <div className="figure-export">
      <button type="button" className={failed ? "ghost-button is-failed" : "ghost-button"} onClick={copy} title={hint}>
        {status === "copied" ? <Check size={13} aria-hidden="true" />
          : failed ? <AlertTriangle size={13} aria-hidden="true" />
          : <Copy size={13} aria-hidden="true" />}
        Salin
        {/* Hasilnya tetap diumumkan ke pembaca layar tanpa menggeser tata letak. */}
        <span className="sr-only" role="status">{status === "copied" ? "Gambar tersalin" : failed ? hint : ""}</span>
      </button>
      <button type="button" className="ghost-button" onClick={download} title={`Unduh gambar ${name}`}>
        <Download size={13} aria-hidden="true" />Unduh
      </button>
    </div>
  );
}
