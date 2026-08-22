"use client";

import Link from "next/link";
import {
  ArrowRight,
  Check,
  FileText,
  Shield,
  Users,
  Activity,
  Bell,
  Phone,
  Brain,
  Settings,
  Inbox,
  ClipboardList,
  Zap,
  Heart,
  Building,
  Laptop,
} from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen font-sans antialiased">
      {/* ───── Navigation ───── */}
      <nav className="fixed top-0 w-full z-50 bg-white/70 backdrop-blur-xl border-b border-slate-200/60"
        style={{ WebkitBackdropFilter: "blur(12px)" }}
      >
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2.5 cursor-pointer">
            <div className="h-6 w-6 rounded-[6px] bg-gradient-to-tr from-[#ff751f] to-[#b11fff] flex items-center justify-center shadow-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v20M2 12h20" />
              </svg>
            </div>
            <span className="text-base font-semibold tracking-tight text-slate-900">
              Swadhikaar
            </span>
          </div>

          {/* Center Nav */}
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-500">
            <a href="#features" className="hover:text-slate-900 transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-slate-900 transition-colors">How It Works</a>
            <a href="#compliance" className="hover:text-slate-900 transition-colors">Compliance</a>
            <a href="#use-cases" className="hover:text-slate-900 transition-colors">Use Cases</a>
          </div>

          {/* Right Nav */}
          <div className="flex items-center gap-4">
            <Link href="/login" className="hidden sm:block text-xs font-semibold text-slate-600 hover:text-slate-900">
              Sign In
            </Link>
            <Link
              href="/login"
              className="text-xs font-semibold bg-[#1a1a1a] text-white px-4 py-2 rounded-[10px] hover:bg-black transition-all shadow-[0_2px_10px_rgba(0,0,0,0.1)] hover:scale-[1.02]"
            >
              Start Integration
            </Link>
          </div>
        </div>
      </nav>

      {/* ───── Hero Section ───── */}
      <header className="relative pt-32 pb-20 overflow-hidden">
        {/* Subtle Grid Background */}
        <div
          className="absolute inset-0 -z-10"
          style={{
            backgroundImage:
              "linear-gradient(to right, #80808016 1px, transparent 1px), linear-gradient(to bottom, #80808016 1px, transparent 1px)",
            backgroundSize: "24px 24px",
            maskImage: "radial-gradient(ellipse 60% 50% at 50% 0%, #000 70%, transparent 100%)",
            WebkitMaskImage: "radial-gradient(ellipse 60% 50% at 50% 0%, #000 70%, transparent 100%)",
          }}
        />

        <div className="max-w-7xl mx-auto px-6 text-center relative z-10">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[8px] bg-white border border-slate-200 shadow-sm mb-8 hover:border-slate-300 transition-colors cursor-default">
            <span className="flex h-1.5 w-1.5 rounded-full bg-[#ff751f]" />
            <span className="text-xs font-medium text-slate-600">
              Indic Voice AI Patient Engagement v1.0
            </span>
          </div>

          {/* Headline */}
          <h1
            className="text-5xl md:text-7xl font-bold text-slate-900 tracking-tight mb-6 max-w-4xl mx-auto leading-[1.05]"
            style={{ letterSpacing: "-0.02em" }}
          >
            The Operating System for <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#ff751f] via-[#b11fff] to-[#b11fff]">
              Indic Patient Care.
            </span>
          </h1>

          {/* Subhead */}
          <p className="text-lg text-slate-500 max-w-2xl mx-auto mb-10 leading-relaxed font-normal">
            Launch multilingual voice follow-ups in days, not months. We handle
            the Indic speech pipeline, FHIR/ABDM compliance, and multi-layer
            triage escalation.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-16">
            <Link
              href="/login"
              className="px-6 py-3 rounded-[10px] bg-[#1a1a1a] text-white font-medium text-sm hover:bg-black transition-all shadow-[0_4px_14px_rgba(0,0,0,0.1)] hover:-translate-y-0.5"
            >
              Start Your Demo
            </Link>
            <a
              href="#how-it-works"
              className="px-6 py-3 rounded-[10px] bg-white border border-slate-200 text-slate-700 font-medium text-sm hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center gap-2 shadow-sm"
            >
              <FileText className="w-4 h-4 text-slate-500" />
              View API Docs
            </a>
          </div>

          {/* ───── Dashboard Mockup ───── */}
          <div className="relative max-w-5xl mx-auto">
            {/* Fade overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#fafafa] via-transparent to-transparent z-20 h-full w-full pointer-events-none" />

            <div className="rounded-xl border border-slate-200 bg-white shadow-[0_20px_50px_-12px_rgba(0,0,0,0.1)] overflow-hidden p-1">
              <div className="bg-slate-50/50 rounded-[10px] border border-slate-100 flex flex-col md:flex-row overflow-hidden h-[450px]">
                {/* Sidebar */}
                <div className="w-full md:w-64 bg-white border-r border-slate-200 flex-col p-4 hidden md:flex">
                  <div className="flex items-center gap-3 mb-8 px-2">
                    <div className="h-6 w-6 bg-slate-100 rounded-[6px]" />
                    <span className="text-sm font-semibold text-slate-900">
                      Aashrya Health Camp
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-3 px-3 py-2 bg-slate-100 text-slate-900 rounded-[8px] text-sm font-medium">
                      <Inbox className="w-4 h-4" />
                      Intake Queue
                      <span className="ml-auto text-xs bg-white px-1.5 py-0.5 rounded shadow-sm">
                        12
                      </span>
                    </div>
                    <div className="flex items-center gap-3 px-3 py-2 text-slate-500 hover:bg-slate-50 rounded-[8px] text-sm font-medium transition-colors">
                      <Users className="w-4 h-4" />
                      Patients
                    </div>
                    <div className="flex items-center gap-3 px-3 py-2 text-slate-500 hover:bg-slate-50 rounded-[8px] text-sm font-medium transition-colors">
                      <ClipboardList className="w-4 h-4" />
                      FHIR Records
                    </div>
                    <div className="flex items-center gap-3 px-3 py-2 text-slate-500 hover:bg-slate-50 rounded-[8px] text-sm font-medium transition-colors">
                      <Phone className="w-4 h-4" />
                      Voice Calls
                    </div>
                  </div>
                  <div className="mt-auto pt-4 border-t border-slate-100">
                    <div className="flex items-center gap-3 px-2">
                      <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600">
                        PS
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold text-slate-900">
                          Dr. Priya Sharma
                        </span>
                        <span className="text-[10px] text-slate-500">
                          Camp: Patna, Bihar
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Main Content */}
                <div className="flex-1 flex flex-col bg-white">
                  {/* Header */}
                  <div className="h-14 border-b border-slate-100 flex items-center justify-between px-6 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <span>Queue</span>
                      <span className="text-slate-300">/</span>
                      <span className="text-slate-900 font-medium">
                        Patient #2938-A
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-[6px] border border-slate-200 transition-colors">
                        Decline
                      </button>
                      <button className="px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-[6px] shadow-sm transition-colors">
                        Approve &amp; Sign
                      </button>
                    </div>
                  </div>

                  {/* Patient Data */}
                  <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30">
                    <div className="grid grid-cols-3 gap-6 mb-6">
                      <div className="col-span-2 space-y-4">
                        {/* Patient Info Card */}
                        <div className="bg-white p-5 rounded-[10px] border border-slate-200 shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
                          <div className="flex justify-between items-start mb-4">
                            <div className="flex gap-3">
                              <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-semibold text-sm">
                                RK
                              </div>
                              <div>
                                <h3 className="text-sm font-semibold text-slate-900">
                                  Ramesh Kumar
                                </h3>
                                <p className="text-xs text-slate-500">
                                  M &bull; 68 Years &bull; ABHA: 91-2341-8762-0011
                                </p>
                              </div>
                            </div>
                            <span className="px-2 py-1 rounded-[6px] bg-slate-100 text-slate-700 text-[10px] font-bold border border-slate-200 uppercase tracking-wide">
                              Consent Verified
                            </span>
                          </div>
                          <div className="grid grid-cols-3 gap-4 border-t border-slate-100 pt-4">
                            <div>
                              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">
                                Language
                              </p>
                              <p className="text-sm font-medium text-slate-900">
                                Hindi / Bhojpuri
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">
                                BP
                              </p>
                              <p className="text-sm font-medium text-slate-900">
                                139/85
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">
                                Risk Score
                              </p>
                              <p className="text-sm font-medium text-slate-900">
                                HIGH (62.9)
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Voice Transcript Card */}
                        <div className="bg-white p-5 rounded-[10px] border border-slate-200 shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
                          <h4 className="text-xs font-semibold text-slate-900 mb-3 flex items-center gap-2">
                            <Phone className="w-3.5 h-3.5 text-slate-400" />
                            AI Voice Transcript
                          </h4>
                          <div className="space-y-3">
                            <div className="p-3 bg-slate-50 rounded-[8px] border border-slate-100">
                              <p className="text-xs text-slate-500 mb-1">
                                AI Agent (Hindi):
                              </p>
                              <p className="text-sm font-medium text-slate-900">
                                &ldquo;Namaste, kya aapko dawai lene ke baad seene mein dard ho raha hai?&rdquo;
                              </p>
                            </div>
                            <div className="p-3 bg-slate-50 rounded-[8px] border border-slate-100">
                              <p className="text-xs text-slate-500 mb-1">
                                Patient Response:
                              </p>
                              <p className="text-sm font-medium text-slate-900">
                                &ldquo;Haan ji, kal raat se halka dard hai.&rdquo;
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="col-span-1 space-y-4">
                        {/* FHIR Extraction */}
                        <div className="bg-white p-5 rounded-[10px] border border-slate-200 shadow-[0_2px_4px_rgba(0,0,0,0.02)] relative overflow-hidden">
                          <div className="absolute top-0 right-0 w-16 h-16 bg-[#ff751f]/5 rounded-bl-full" />
                          <h4 className="text-xs font-semibold text-slate-900 mb-3">
                            FHIR Extraction
                          </h4>
                          <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-[8px] bg-slate-100 flex items-center justify-center">
                              <Activity className="w-5 h-5 text-slate-500" />
                            </div>
                            <div>
                              <p className="text-sm font-bold text-slate-900">
                                Angina Pectoris
                              </p>
                              <p className="text-xs text-slate-500">
                                SNOMED: 194828000
                              </p>
                            </div>
                          </div>
                          <div className="text-xs bg-slate-100 text-slate-700 px-3 py-2 rounded-[6px] border border-slate-200">
                            <span className="font-bold">Alert:</span> Escalate within 1hr
                          </div>
                        </div>

                        {/* Provider Notes */}
                        <div className="bg-white p-5 rounded-[10px] border border-slate-200 shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
                          <h4 className="text-xs font-semibold text-slate-900 mb-3">
                            Provider Notes
                          </h4>
                          <div className="w-full h-24 text-sm p-3 bg-white border border-slate-200 rounded-[8px] text-slate-300 italic">
                            Add clinical notes...
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ───── Value Proposition / Features ───── */}
      <section id="features" className="py-24 bg-white border-y border-slate-200">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-16 items-start">
            {/* Left: Why use Swadhikaar */}
            <div className="sticky top-24">
              <span className="text-xs font-bold text-[#b11fff] uppercase tracking-widest mb-4 block">
                Voice-First Infrastructure
              </span>
              <h2
                className="text-3xl md:text-4xl font-semibold text-slate-900 tracking-tight mb-6 leading-tight"
                style={{ letterSpacing: "-0.02em" }}
              >
                We did the heavy lifting so you don&apos;t have to.
              </h2>
              <p className="text-slate-500 mb-8 leading-relaxed">
                Building compliant Indic voice AI traditionally requires
                assembling STT models, FHIR mappers, consent frameworks, and
                triage engines. Swadhikaar bundles it all into a single
                platform.
              </p>

              <ul className="space-y-6">
                <li className="flex gap-4 group">
                  <div className="flex-shrink-0 w-10 h-10 rounded-[10px] bg-[#fafafa] border border-slate-200 flex items-center justify-center group-hover:border-[#b11fff] group-hover:text-[#b11fff] transition-colors text-slate-400">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 text-sm">
                      ABDM + DPDP Compliant
                    </h3>
                    <p className="text-sm text-slate-500 mt-1">
                      FHIR R4 bundles, SNOMED/LOINC coding, and Digital Personal
                      Data Protection Act 2023 consent flows built-in.
                    </p>
                  </div>
                </li>
                <li className="flex gap-4 group">
                  <div className="flex-shrink-0 w-10 h-10 rounded-[10px] bg-[#fafafa] border border-slate-200 flex items-center justify-center group-hover:border-[#b11fff] group-hover:text-[#b11fff] transition-colors text-slate-400">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 text-sm">
                      Care Coordinator-in-the-Loop
                    </h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Care coordinators review, approve, or correct AI extractions.
                      Human feedback improves accuracy over time.
                    </p>
                  </div>
                </li>
                <li className="flex gap-4 group">
                  <div className="flex-shrink-0 w-10 h-10 rounded-[10px] bg-[#fafafa] border border-slate-200 flex items-center justify-center group-hover:border-[#b11fff] group-hover:text-[#b11fff] transition-colors text-slate-400">
                    <Zap className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 text-sm">
                      Multi-Layer Triage
                    </h3>
                    <p className="text-sm text-slate-500 mt-1">
                      AI severity triggers 3-tier escalation. CRITICAL: &lt;5 min,
                      HIGH: &lt;1 hr, MODERATE: &lt;24 hr response.
                    </p>
                  </div>
                </li>
              </ul>
            </div>

            {/* Right: Step Cards */}
            <div className="space-y-6">
              {/* Card 1: Voice Pipeline */}
              <div className="group bg-slate-50/50 rounded-2xl p-8 border border-slate-200 hover:border-slate-300 transition-all hover:bg-white hover:shadow-lg hover:shadow-slate-200/50">
                <div className="flex justify-between items-start mb-6">
                  <div className="h-10 w-10 rounded-[10px] bg-[#ff751f] flex items-center justify-center text-white shadow-lg shadow-orange-200">
                    <Phone className="w-5 h-5" />
                  </div>
                  <span className="px-3 py-1 bg-white border border-slate-200 rounded-full text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                    Voice Engine
                  </span>
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">
                  1. Multilingual Voice Calls
                </h3>
                <p className="text-sm text-slate-500 mb-6">
                  Automated follow-up calls in Hindi, Bhojpuri, and Maithili over
                  a real telephony trunk. Handles code-switching naturally.
                </p>

                {/* Mock: Language selector */}
                <div className="bg-white rounded-[10px] border border-slate-200 p-4 space-y-3">
                  {[
                    { lang: "Hindi (हिन्दी)", status: "Active", checked: true },
                    { lang: "Bhojpuri (भोजपुरी)", status: "Active", checked: true },
                    { lang: "Maithili (मैथिली)", status: "Beta", checked: false },
                  ].map((l) => (
                    <div key={l.lang} className="flex items-center justify-between p-2 rounded hover:bg-slate-50 cursor-pointer">
                      <div className="flex items-center gap-3">
                        <div className={`w-4 h-4 rounded border flex items-center justify-center ${l.checked ? "bg-slate-900 border-slate-900" : "border-slate-300 bg-white"}`}>
                          {l.checked && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <span className={`text-sm font-medium ${l.checked ? "text-slate-700" : "text-slate-400"}`}>
                          {l.lang}
                        </span>
                      </div>
                      <span className="text-xs text-slate-400">{l.status}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Card 2: FHIR Mapping */}
              <div className="group bg-slate-50/50 rounded-2xl p-8 border border-slate-200 hover:border-slate-300 transition-all hover:bg-white hover:shadow-lg hover:shadow-slate-200/50">
                <div className="flex justify-between items-start mb-6">
                  <div className="h-10 w-10 rounded-[10px] bg-[#b11fff] flex items-center justify-center text-white shadow-lg shadow-purple-200">
                    <FileText className="w-5 h-5" />
                  </div>
                  <span className="px-3 py-1 bg-white border border-slate-200 rounded-full text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                    FHIR Engine
                  </span>
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">
                  2. Auto-Generate FHIR Bundles
                </h3>
                <p className="text-sm text-slate-500 mb-6">
                  Voice data is automatically extracted, coded with SNOMED CT /
                  LOINC, and mapped to ABDM R4 FHIR profiles.
                </p>

                {/* Mock Code */}
                <div className="bg-[#1a1a1a] rounded-[10px] p-4 font-mono text-xs text-slate-300 overflow-hidden relative">
                  <div className="absolute top-3 right-3 flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-slate-600" />
                    <div className="w-2.5 h-2.5 rounded-full bg-slate-600" />
                  </div>
                  <p className="text-purple-400">POST</p>
                  <p className="pl-4">
                    <span className="text-green-400">supabase.functions.invoke("export-abdm")</span>
                  </p>
                  <br />
                  <p className="text-purple-400">{"{"}</p>
                  <p className="pl-4">
                    <span className="text-blue-300">&quot;patient_id&quot;</span>:{" "}
                    <span className="text-green-400">&quot;abha-91-2341&quot;</span>,
                  </p>
                  <p className="pl-4">
                    <span className="text-blue-300">&quot;call_id&quot;</span>:{" "}
                    <span className="text-green-400">&quot;vc-2938-a&quot;</span>,
                  </p>
                  <p className="pl-4">
                    <span className="text-blue-300">&quot;profile&quot;</span>:{" "}
                    <span className="text-green-400">&quot;ABDM-R4&quot;</span>
                  </p>
                  <p className="text-purple-400">{"}"}</p>
                </div>
              </div>

              {/* Card 3: Triage Escalation */}
              <div className="group bg-slate-50/50 rounded-2xl p-8 border border-slate-200 hover:border-slate-300 transition-all hover:bg-white hover:shadow-lg hover:shadow-slate-200/50">
                <div className="flex justify-between items-start mb-6">
                  <div className="h-10 w-10 rounded-[10px] bg-slate-900 flex items-center justify-center text-white shadow-lg shadow-slate-300">
                    <Bell className="w-5 h-5" />
                  </div>
                  <span className="px-3 py-1 bg-white border border-slate-200 rounded-full text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                    Realtime Ops
                  </span>
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">
                  3. Auto-Escalation to Care Coordinators
                </h3>
                <p className="text-sm text-slate-500 mb-6">
                  Critical findings are auto-escalated via Supabase Realtime.
                  Multi-layer triage ensures right response time.
                </p>

                {/* Mock: Routing diagram */}
                <div className="relative h-28 bg-white rounded-[10px] border border-slate-200 overflow-hidden flex items-center justify-center">
                  <div
                    className="absolute inset-0 opacity-20"
                    style={{
                      backgroundImage: "radial-gradient(#cbd5e1 1px, transparent 1px)",
                      backgroundSize: "16px 16px",
                    }}
                  />
                  <div className="flex items-center gap-2 relative z-10">
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-300 flex items-center justify-center">
                        <Phone className="w-4 h-4 text-slate-400" />
                      </div>
                      <span className="text-[10px] font-bold mt-1 text-slate-500">
                        Voice AI
                      </span>
                    </div>
                    <div className="h-[1px] w-12 bg-slate-300 relative">
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-1 bg-slate-400 rounded-full" />
                    </div>
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center shadow-sm">
                        <Bell className="w-4 h-4 text-slate-600" />
                      </div>
                      <span className="text-[10px] font-bold mt-1 text-slate-600">
                        Triage
                      </span>
                    </div>
                    <div className="h-[1px] w-12 bg-slate-300 relative">
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-1 bg-slate-400 rounded-full" />
                    </div>
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center shadow-sm">
                        <Heart className="w-4 h-4 text-slate-600" />
                      </div>
                      <span className="text-[10px] font-bold mt-1 text-slate-600">
                        Coordinator
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───── Use Cases ───── */}
      <section id="use-cases" className="py-24 bg-[#fafafa]">
        <div className="max-w-7xl mx-auto px-6">
          <h2
            className="text-3xl font-semibold text-slate-900 tracking-tight mb-12"
            style={{ letterSpacing: "-0.02em" }}
          >
            Who Builds on Swadhikaar?
          </h2>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Case 1 */}
            <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col h-full hover:-translate-y-1 transition-transform duration-300">
              <div className="h-12 w-12 bg-slate-50 rounded-[10px] border border-slate-200 flex items-center justify-center mb-6">
                <Heart className="w-6 h-6 text-[#ff751f]" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">
                Health Camps &amp; NGOs
              </h3>
              <p className="text-sm text-slate-500 mb-6 flex-1">
                Run voice follow-ups for screened patients without building a
                call center. Reach rural communities in their own language.
              </p>
              <div className="pt-6 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                  Popular Stack
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="px-2.5 py-1 rounded-[6px] bg-slate-50 border border-slate-200 text-xs text-slate-600">
                    Voice Follow-up
                  </span>
                  <span className="px-2.5 py-1 rounded-[6px] bg-slate-50 border border-slate-200 text-xs text-slate-600">
                    Risk Screening
                  </span>
                </div>
              </div>
            </div>

            {/* Case 2 */}
            <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col h-full hover:-translate-y-1 transition-transform duration-300">
              <div className="h-12 w-12 bg-slate-50 rounded-[10px] border border-slate-200 flex items-center justify-center mb-6">
                <Building className="w-6 h-6 text-slate-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">
                Old Age Homes &amp; Clinics
              </h3>
              <p className="text-sm text-slate-500 mb-6 flex-1">
                Weekly automated check-ins for elderly patients. Medication
                adherence tracking and instant escalation to physicians.
              </p>
              <div className="pt-6 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                  Popular Stack
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="px-2.5 py-1 rounded-[6px] bg-slate-50 border border-slate-200 text-xs text-slate-600">
                    Elderly Care
                  </span>
                  <span className="px-2.5 py-1 rounded-[6px] bg-slate-50 border border-slate-200 text-xs text-slate-600">
                    Chronic Monitoring
                  </span>
                  <span className="px-2.5 py-1 rounded-[6px] bg-slate-50 border border-slate-200 text-xs text-slate-600">
                    Med Adherence
                  </span>
                </div>
              </div>
            </div>

            {/* Case 3 */}
            <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col h-full hover:-translate-y-1 transition-transform duration-300">
              <div className="h-12 w-12 bg-slate-50 rounded-[10px] border border-slate-200 flex items-center justify-center mb-6">
                <Laptop className="w-6 h-6 text-slate-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">
                Public Health Programs
              </h3>
              <p className="text-sm text-slate-500 mb-6 flex-1">
                Scale patient engagement across districts. ABDM-compliant data
                pipeline with full audit trails and consent management.
              </p>
              <div className="pt-6 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                  Popular Stack
                </p>
                <div className="flex flex-wrap gap-2">
                  <span className="px-2.5 py-1 rounded-[6px] bg-slate-50 border border-slate-200 text-xs text-slate-600">
                    ABDM Integration
                  </span>
                  <span className="px-2.5 py-1 rounded-[6px] bg-slate-50 border border-slate-200 text-xs text-slate-600">
                    DPDP Compliance
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───── Pricing ───── */}
      <section id="compliance" className="py-24 bg-white border-t border-slate-200">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2
            className="text-3xl font-semibold text-slate-900 mb-6"
            style={{ letterSpacing: "-0.02em" }}
          >
            Open-Source, Cost-Effective
          </h2>
          <p className="text-slate-500 mb-12">
            Built for Indian healthcare budgets. Free tier for NGOs and health
            camps.
          </p>

          <div className="bg-[#fafafa] rounded-2xl border border-slate-200 p-2 flex flex-col md:flex-row gap-2">
            {/* Free Tier */}
            <div className="flex-1 bg-white rounded-[12px] p-8 shadow-sm border border-slate-100 text-left relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-slate-200" />
              <h3 className="font-semibold text-slate-900 mb-2">Community</h3>
              <div className="flex items-baseline gap-1 mb-6">
                <span className="text-3xl font-bold text-slate-900">Free</span>
                <span className="text-sm text-slate-500">/ forever</span>
              </div>
              <ul className="space-y-3 mb-8">
                {[
                  "Up to 500 voice calls/month",
                  "Indic STT/TTS pipeline",
                  "Basic FHIR extraction",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm text-slate-600">
                    <Check className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                href="/login"
                className="block w-full py-2.5 rounded-[10px] bg-white border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 transition-colors text-center text-sm"
              >
                Start Building
              </Link>
            </div>

            {/* Scale Tier */}
            <div className="flex-1 bg-white rounded-[12px] p-8 shadow-md border border-slate-200 text-left relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#ff751f] to-[#b11fff]" />
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-semibold text-slate-900">Scale</h3>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold uppercase">
                  Most Popular
                </span>
              </div>
              <div className="flex items-baseline gap-1 mb-6">
                <span className="text-3xl font-bold text-slate-900">Custom</span>
                <span className="text-sm text-slate-500">/ per district</span>
              </div>
              <ul className="space-y-3 mb-8">
                {[
                  "Unlimited voice calls",
                  "Custom FHIR profiles + ABDM",
                  "Multi-layer triage + Realtime",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm text-slate-600">
                    <Check className="w-4 h-4 text-[#b11fff] flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                href="/login"
                className="block w-full py-2.5 rounded-[10px] bg-slate-900 text-white font-medium hover:bg-slate-800 transition-colors shadow-lg shadow-slate-200 text-center text-sm"
              >
                Contact Us
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ───── Footer ───── */}
      <footer className="bg-white border-t border-slate-200 pt-16 pb-8">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 mb-12">
            <div className="col-span-2 lg:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <div className="h-5 w-5 rounded-[4px] bg-gradient-to-tr from-[#ff751f] to-[#b11fff]" />
                <span className="text-sm font-bold text-slate-900">
                  Swadhikaar
                </span>
              </div>
              <p className="text-sm text-slate-500 max-w-xs">
                The infrastructure layer for Indic voice AI patient engagement.
                ABDM-compliant, scalable, and open-source.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-slate-900 text-sm mb-4">
                Platform
              </h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li><a href="#features" className="hover:text-[#ff751f] transition-colors">Voice AI Engine</a></li>
                <li><a href="#features" className="hover:text-[#ff751f] transition-colors">FHIR Mapping</a></li>
                <li><a href="#features" className="hover:text-[#ff751f] transition-colors">Triage System</a></li>
                <li><a href="#how-it-works" className="hover:text-[#ff751f] transition-colors">API Docs</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-slate-900 text-sm mb-4">
                Use Cases
              </h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li><a href="#use-cases" className="hover:text-[#ff751f] transition-colors">Health Camps</a></li>
                <li><a href="#use-cases" className="hover:text-[#ff751f] transition-colors">Old Age Homes</a></li>
                <li><a href="#use-cases" className="hover:text-[#ff751f] transition-colors">Chronic Care</a></li>
                <li><a href="#use-cases" className="hover:text-[#ff751f] transition-colors">Post-Discharge</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-slate-900 text-sm mb-4">
                Project
              </h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li><span>Indic Voice AI Care Platform</span></li>
                <li><span>Production-ready Healthcare Ops</span></li>
                <li><Link href="/login" className="hover:text-[#ff751f] transition-colors">Sign In</Link></li>
                <li><a href="https://github.com" className="hover:text-[#ff751f] transition-colors">GitHub</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-100 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-xs text-slate-400">
              &copy; 2026 Swadhikaar. All
              rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
