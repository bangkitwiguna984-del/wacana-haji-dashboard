"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, Eye, EyeOff, Lock } from "lucide-react";
import "./login.css";

/**
 * Hasil Math.cos dan Math.sin tidak dijamin dibulatkan sama persis antar
 * implementasi JavaScript, sehingga runtime server dan peramban dapat berbeda
 * satu ULP. Selisih di digit ke-16 itu cukup membuat React melaporkan hydration
 * mismatch pada atribut SVG. Dua angka di belakang koma jauh melebihi kebutuhan
 * gambar ini dan membuat kedua sisi sepakat.
 */
const svgNumber = (value: number) => Math.round(value * 100) / 100;

/** Decorative illustration, not a representation of research observations. */
function TawafIllustration() {
  return <svg className="login-art" viewBox="0 0 600 430" fill="none" aria-hidden="true" focusable="false">
    <g transform="translate(300 215) rotate(-18)">
      {[0, 1, 2, 3, 4, 5, 6].map((ring) => <g key={ring}>
        <ellipse rx={95 + ring * 28} ry={62 + ring * 19} stroke="currentColor" strokeOpacity={svgNumber(0.28 - ring * 0.022)} />
        {Array.from({ length: 14 + ring * 5 }, (_, index) => {
          const angle = index * Math.PI * 2 / (14 + ring * 5) + ring * .43;
          return <circle key={index} cx={svgNumber(Math.cos(angle) * (95 + ring * 28))} cy={svgNumber(Math.sin(angle) * (62 + ring * 19))} r={index % 7 === 0 ? 2.8 : 1.25} fill={index % 7 === 0 ? "#eac274" : "currentColor"} opacity={index % 7 === 0 ? .95 : .42} />;
        })}
      </g>)}
    </g>
    <path d="M254 186 299 164 346 186 300 210Z" fill="#284764" stroke="#dcb56c" strokeWidth="1.2" />
    <path d="M254 186 300 210 300 267 254 243Z" fill="#132b44" stroke="#dcb56c" strokeWidth="1.2" />
    <path d="M300 210 346 186 346 243 300 267Z" fill="#1e3b57" stroke="#dcb56c" strokeWidth="1.2" />
    <path d="M255 198 300 222 345 198" stroke="#eac274" strokeWidth="5" />
    <path d="M51 216H102M498 216H549M300 12V40M300 390V418" stroke="currentColor" strokeOpacity=".25" />
  </svg>;
}

/**
 * Gerbang masuk dashboard.
 *
 * Perlu dicatat batasnya: pemeriksaan berjalan di peramban, sehingga gerbang ini
 * mengunci antarmuka, bukan berkas datanya. Berkas pada /data tetap dapat diambil
 * langsung oleh siapa pun yang mengetahui alamatnya. Untuk pembatasan yang
 * sesungguhnya, kuncilah di tingkat platform, misalnya Cloudflare Access.
 */
const CREDENTIALS = { username: "bpkh", password: "bpkh123" };

const SESSION_KEY = "wacana-haji:sesi";

const listeners = new Set<() => void>();

function readSession() {
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === "aktif";
  } catch {
    return false;
  }
}

function writeSession(active: boolean) {
  try {
    if (active) window.sessionStorage.setItem(SESSION_KEY, "aktif");
    else window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* penyimpanan dapat diblokir peramban; sesi cukup berlaku di memori */
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export const openSession = () => writeSession(true);
export const closeSession = () => writeSession(false);

/**
 * Sesi dibaca melalui useSyncExternalStore, bukan langsung di useState.
 *
 * Membacanya di useState membuat render server dan hidrasi klien berbeda:
 * server tidak punya sessionStorage sehingga merender layar masuk, sementara
 * klien yang sudah memegang sesi langsung merender dashboard. React melaporkan
 * selisih itu sebagai hydration mismatch. Snapshot server di bawah selalu
 * `false`, lalu React menyesuaikan setelah hidrasi selesai.
 */
export function useSession() {
  return useSyncExternalStore(subscribe, readSession, () => false);
}

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const usernameRef = useRef<HTMLInputElement>(null);

  // Halaman ini hanya berisi satu formulir, sehingga menaruh fokus di kolom
  // pertama tidak membingungkan. Dilakukan lewat ref, bukan atribut autoFocus,
  // agar tidak menyalakan aturan aksesibilitas yang menyasar penggunaan umum.
  useEffect(() => { usernameRef.current?.focus(); }, []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (username.trim() === CREDENTIALS.username && password === CREDENTIALS.password) {
      openSession();
      return;
    }
    setError("Nama pengguna atau kata sandi tidak cocok.");
  };

  return (
    <main className="login-screen login-redesign">
      <section className="login-brand">
        <div className="login-masthead"><span>WACANA HAJI / RISET</span><span>2021–2024</span></div>
        <div className="login-brand-copy">
          <span className="login-kicker">Dashboard riset</span>
          <h1>Wacana Haji</h1>
          <p className="login-period">Indonesia · 2021–2024</p>
          <p className="login-blurb">
            Kajian pembiayaan haji melalui media, pernyataan aktor, dan jaringan wacana.
          </p>
        </div>
        <TawafIllustration />
        <div className="login-brand-footer"><span>Discourse Network Analysis</span><span>Indonesia</span></div>
      </section>

      <section className="login-panel">
        <div className="login-logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bpkh-logo.png" alt="Badan Pengelola Keuangan Haji" />
          <span>Badan Pengelola<br />Keuangan Haji</span>
        </div>
        <form className="login-form" onSubmit={submit}>
          <p className="login-form-kicker"><Lock size={13} aria-hidden="true" />Akses dashboard</p>
          <h2>Masuk ke dashboard</h2>
          <p className="login-form-note">Gunakan akun Anda untuk mengakses hasil riset.</p>

          <label className="login-field" htmlFor="login-username">
            Nama pengguna
            <input
              ref={usernameRef}
              id="login-username" name="username" type="text" value={username}
              autoComplete="username" spellCheck={false}
              autoCapitalize="none" required placeholder="Nama pengguna Anda"
              aria-describedby={error ? "login-error" : undefined}
              aria-invalid={error ? true : undefined}
              onChange={(event) => { setUsername(event.target.value); setError(""); }}
            />
          </label>

          <label className="login-field" htmlFor="login-password">
            Kata sandi
            <span className="login-password">
              <input
                id="login-password" name="password" type={visible ? "text" : "password"} value={password}
                autoComplete="current-password"
                required placeholder="Masukkan kata sandi"
                aria-describedby={error ? "login-error" : undefined}
                aria-invalid={error ? true : undefined}
                onChange={(event) => { setPassword(event.target.value); setError(""); }}
              />
              <button type="button" onClick={() => setVisible((value) => !value)}
                aria-pressed={visible}
                aria-label={visible ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}>
                {visible ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
              </button>
            </span>
          </label>

          {/* Ruangnya dipesan agar tata letak tidak bergeser saat pesan muncul. */}
          <p id="login-error" className="login-error" role="alert">{error}</p>

          <button type="submit" className="login-submit">
            Buka dashboard<ArrowRight size={16} aria-hidden="true" />
          </button>
        </form>
        <p className="login-panel-footer">Korpus & waktu<span>·</span>Jaringan wacana<span>·</span>Bukti</p>
      </section>
    </main>
  );
}
