"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth, type UserRole } from "@/context/auth-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Stethoscope,
  User,
  ShieldAlert,
  HeartHandshake,
  Laptop,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";

const ROLE_HOME: Record<UserRole, string> = {
  patient: "/patient/sos",
  doctor: "/doctor/dashboard",
  admin: "/admin/dashboard",
  asha: "/asha/dashboard",
  facility_staff: "/facility/inbox",
  fleet_operator: "/fleet",
};

/**
 * Supabase error strings are for developers. An ASHA holding a phone in a village
 * needs to know whether to retype the password or call someone — "Legacy API keys
 * are disabled" (a real error seen after a key rotation, caused by a stale cached
 * bundle) tells her neither, and looks like the app is broken.
 */
function humanError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "Email or password is wrong. Please check and try again.";
  }
  if (m.includes("email not confirmed")) {
    return "This account is not confirmed yet. Ask your administrator to confirm it.";
  }
  if (m.includes("legacy api key") || m.includes("api key") || m.includes("apikey")) {
    return "This page is out of date. Close the tab and open it again — if it keeps happening, reload with Ctrl+Shift+R.";
  }
  if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("load failed")) {
    return "No internet connection. Check your network and try again.";
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  return `Could not sign in: ${raw}`;
}

export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const result = await signIn(email, password);
    setLoading(false);
    if (result.error) {
      setError(humanError(result.error));
      return;
    }
    router.push(ROLE_HOME[result.role ?? "patient"]);
  }

  async function handleQuickDemoLogin(demoEmail: string) {
    setLoading(true);
    setError("");
    setEmail(demoEmail);
    setPassword("DemoPassword123!");
    const result = await signIn(demoEmail, "DemoPassword123!");
    setLoading(false);
    if (result.error) {
      setError(humanError(result.error));
      return;
    }
    router.push(ROLE_HOME[result.role ?? "patient"]);
  }

  return (
    <main className="min-h-screen bg-slate-50/70 dark:bg-slate-950 flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Header Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-2">
            <div className="w-8 h-8 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg flex items-center justify-center font-bold text-sm shadow-xs">
              S
            </div>
            <span className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
              Swadhikaar
            </span>
          </Link>
          <p className="text-xs text-slate-500 max-w-xs mx-auto">
            Clinical Operating System • Role-Based Authentication
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-6">
          <form onSubmit={handleEmailLogin} className="space-y-4">
            {error && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
                {error}
              </div>
            )}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Email Address
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@hospital.gov.in"
                required
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Password
              </label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                className="h-9 text-xs"
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs h-9 shadow-xs"
            >
              {loading ? "Verifying Credentials..." : "Sign In to Portal"}
            </Button>
          </form>

          {/* Quick Demo Access Roles */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono font-medium text-slate-500 uppercase tracking-wider">
                1-Click Role Presets
              </span>
              <span className="text-[10px] text-slate-400">Demo Environment</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={loading}
                onClick={() => handleQuickDemoLogin("acecodes21@gmail.com")}
                className="flex items-start gap-2.5 p-3 h-auto text-left border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 transition-colors"
              >
                <div className="p-1.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0">
                  <Stethoscope className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">Doctor OPD</div>
                  <div className="text-[10px] text-slate-500">Queue &amp; Triage</div>
                </div>
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={loading}
                onClick={() => handleQuickDemoLogin("yashmonarch21@gmail.com")}
                className="flex items-start gap-2.5 p-3 h-auto text-left border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 transition-colors"
              >
                <div className="p-1.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0">
                  <User className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">Patient</div>
                  <div className="text-[10px] text-slate-500">Records &amp; ABHA</div>
                </div>
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={loading}
                onClick={() => handleQuickDemoLogin("demoshow@swadhikaar.local")}
                className="flex items-start gap-2.5 p-3 h-auto text-left border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 transition-colors"
              >
                <div className="p-1.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0">
                  <ShieldAlert className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">Admin / Fleet</div>
                  <div className="text-[10px] text-slate-500">Surveillance &amp; Ops</div>
                </div>
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={loading}
                onClick={() => handleQuickDemoLogin("21ace.ns21@gmail.com")}
                className="flex items-start gap-2.5 p-3 h-auto text-left border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 transition-colors"
              >
                <div className="p-1.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0">
                  <HeartHandshake className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">ASHA Worker</div>
                  <div className="text-[10px] text-slate-500">Rural Tablet</div>
                </div>
              </Button>
            </div>

            {/* Direct MediKiosk Button */}
            <div className="pt-2">
              <Link href="/kiosk" className="block">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-900 dark:text-white text-xs font-medium h-9 gap-2 shadow-2xs"
                >
                  <Laptop className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
                  <span>Open Public MediKiosk (No Auth Required)</span>
                  <ArrowRight className="w-3.5 h-3.5 ml-auto text-slate-400" />
                </Button>
              </Link>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 text-center mt-6">
          DPDP Act 2023 Compliant • ABDM NRCES Encrypted Session
        </p>
      </div>
    </main>
  );
}
