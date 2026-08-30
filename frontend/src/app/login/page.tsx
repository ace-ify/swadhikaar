"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth, type UserRole } from "@/context/auth-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
  // Unrecognised: show it rather than swallow it, but say what it is.
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
    // signIn resolves the role from user_roles, the same table RLS consults.
    // This used to guess from substrings in the email address, which sent every
    // address without "admin" or "coordinator" in it to the patient portal
    // regardless of its actual role.
    router.push(ROLE_HOME[result.role ?? "patient"]);
  }

  return (
    <main className="min-h-screen bg-white flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center shadow-sm">
              <span className="text-white font-bold text-lg">S</span>
            </div>
            <span className="text-2xl font-bold text-slate-900 tracking-tight">Swadhikaar</span>
          </Link>
          <p className="text-sm text-slate-500 mt-2">
            Indic Voice AI Patient Engagement Platform
          </p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleEmailLogin} className="space-y-4">
          {error && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter email"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              required
            />
          </div>
          <Button
            type="submit"
            disabled={loading}
            className="w-full"
          >
            {loading ? "Signing in..." : "Sign In"}
          </Button>
        </form>

        {/* slate-400 on white is 2.63:1 at 12px — below the 4.5:1 WCAG AA floor.
            slate-600 clears it, and this app is read outdoors in sunlight. */}
        <p className="text-xs text-slate-600 text-center mt-6">
          Secure access for Swadhikaar care operations
        </p>
      </div>
    </main>
  );
}
