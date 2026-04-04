"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  IndianRupee,
  TrendingUp,
  Calculator,
  PiggyBank,
  BarChart3,
  ArrowRight,
  Target,
} from "lucide-react";
import {
  usePatients,
  useCallLogs,
  type VoiceCall,
} from "@/hooks/use-supabase";

// ---------------------------------------------------------------------------
// Cost model constants
// ---------------------------------------------------------------------------
const COST_PER_AI_CALL = 3.86; // INR — Gemini Flash + LiveKit audio minutes
const COST_PER_HUMAN_CALL = 15.0; // INR — average telecaller cost per call
const HUMAN_CALLS_PER_DAY = 40; // typical telecaller daily capacity
const AI_CALLS_PER_DAY = 500; // AI capacity (concurrent rooms)

// Use case labels
const USE_CASE_LABELS: Record<string, string> = {
  screening_to_opd: "Screening \u2192 OPD",
  opd_to_ipd: "OPD \u2192 IPD",
  recovery_protocol: "Recovery",
  chronic_management: "Chronic",
  follow_up: "Follow-up",
  newborn_vaccination: "Vaccination",
  elderly_checkin: "Elderly Check-in",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isLast30Days(dateStr: string): boolean {
  return Date.now() - new Date(dateStr).getTime() < 30 * 24 * 60 * 60 * 1000;
}

function isLast7Days(dateStr: string): boolean {
  return Date.now() - new Date(dateStr).getTime() < 7 * 24 * 60 * 60 * 1000;
}

function formatINR(amount: number): string {
  if (amount >= 100000) return `\u20b9${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `\u20b9${(amount / 1000).toFixed(1)}K`;
  return `\u20b9${Math.round(amount)}`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function AdminFinancePage() {
  const { data: patients, loading: pLoad } = usePatients();
  const { data: calls, loading: cLoad } = useCallLogs();

  const loading = pLoad || cLoad;

  // Total costs
  const totalAICost = calls.length * COST_PER_AI_CALL;
  const equivalentHumanCost = calls.length * COST_PER_HUMAN_CALL;
  const totalSavings = equivalentHumanCost - totalAICost;
  const savingsPercent =
    equivalentHumanCost > 0
      ? Math.round((totalSavings / equivalentHumanCost) * 100)
      : 0;

  // Monthly (30d) costs
  const monthCalls = calls.filter((c) => isLast30Days(c.created_at));
  const monthAICost = monthCalls.length * COST_PER_AI_CALL;
  const monthHumanCost = monthCalls.length * COST_PER_HUMAN_CALL;
  const monthSavings = monthHumanCost - monthAICost;

  // Weekly costs
  const weekCalls = calls.filter((c) => isLast7Days(c.created_at));
  const weekAICost = weekCalls.length * COST_PER_AI_CALL;

  // Cost per use case
  const useCaseCosts = (() => {
    const map: Record<string, { count: number; completed: number; avgDuration: number }> = {};
    for (const call of calls) {
      const type = call.call_type || call.use_case || "follow_up";
      if (!map[type]) map[type] = { count: 0, completed: 0, avgDuration: 0 };
      map[type].count++;
      if (call.status === "completed") map[type].completed++;
      if (call.duration_seconds > 0) {
        // Running average
        const prev = map[type].avgDuration;
        const n = map[type].completed;
        map[type].avgDuration = n > 1 ? prev + (call.duration_seconds - prev) / n : call.duration_seconds;
      }
    }
    return Object.entries(map)
      .map(([type, data]) => ({
        type,
        label: USE_CASE_LABELS[type] || type.replace(/_/g, " "),
        totalCalls: data.count,
        completedCalls: data.completed,
        successRate: data.count > 0 ? Math.round((data.completed / data.count) * 100) : 0,
        aiCost: Math.round(data.count * COST_PER_AI_CALL),
        humanCost: Math.round(data.count * COST_PER_HUMAN_CALL),
        savings: Math.round(data.count * (COST_PER_HUMAN_CALL - COST_PER_AI_CALL)),
        avgDuration: Math.round(data.avgDuration),
      }))
      .sort((a, b) => b.totalCalls - a.totalCalls);
  })();

  // Scale projection
  const projections = [
    { scale: "Current", patients: patients.length, callsMonth: monthCalls.length },
    { scale: "District (5K)", patients: 5000, callsMonth: Math.round((monthCalls.length / Math.max(patients.length, 1)) * 5000) },
    { scale: "State (50K)", patients: 50000, callsMonth: Math.round((monthCalls.length / Math.max(patients.length, 1)) * 50000) },
    { scale: "National (500K)", patients: 500000, callsMonth: Math.round((monthCalls.length / Math.max(patients.length, 1)) * 500000) },
  ].map((p) => ({
    ...p,
    aiCost: p.callsMonth * COST_PER_AI_CALL,
    humanCost: p.callsMonth * COST_PER_HUMAN_CALL,
    savings: p.callsMonth * (COST_PER_HUMAN_CALL - COST_PER_AI_CALL),
    telecallersNeeded: Math.ceil(p.callsMonth / (HUMAN_CALLS_PER_DAY * 30)),
  }));

  // Budget utilization — cost over time (weekly buckets for last 4 weeks)
  const weeklyBuckets = Array.from({ length: 4 }, (_, i) => {
    const weekEnd = Date.now() - i * 7 * 24 * 60 * 60 * 1000;
    const weekStart = weekEnd - 7 * 24 * 60 * 60 * 1000;
    const weekLabel = `W-${i}`;
    const bucketCalls = calls.filter((c) => {
      const t = new Date(c.created_at).getTime();
      return t >= weekStart && t < weekEnd;
    });
    return {
      label: i === 0 ? "This Week" : i === 1 ? "Last Week" : `${i} Weeks Ago`,
      calls: bucketCalls.length,
      cost: Math.round(bucketCalls.length * COST_PER_AI_CALL),
      humanEquiv: Math.round(bucketCalls.length * COST_PER_HUMAN_CALL),
    };
  }).reverse();

  const maxWeeklyCost = Math.max(...weeklyBuckets.map((w) => w.humanEquiv), 1);

  return (
    <div className="space-y-6 pb-12">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
          Financial Controls
        </h1>
        <p className="text-sm text-slate-500 font-medium mt-1">
          Cost dashboards, budget controls, program ROI, and scale projections.
        </p>
      </div>

      {/* KPI Cards */}
      {loading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-3 w-20 mb-2" />
                <Skeleton className="h-8 w-16" />
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="bg-slate-900 border-slate-800 shadow-md relative overflow-hidden group">
            <div className="absolute right-0 top-0 w-32 h-32 bg-white/5 rounded-bl-full blur-2xl group-hover:bg-white/10 transition-colors" />
            <CardHeader className="flex flex-row items-center justify-between pb-2 relative z-10">
              <CardTitle className="text-sm font-semibold text-slate-400">
                Total Savings
              </CardTitle>
              <PiggyBank className="h-5 w-5 text-slate-300" />
            </CardHeader>
            <CardContent className="relative z-10">
              <div className="text-4xl font-black text-white tracking-tight">
                {formatINR(totalSavings)}
              </div>
              <p className="text-[11px] text-slate-400 font-medium mt-2">
                {savingsPercent}% less than human telecallers
              </p>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-semibold text-slate-600">
                AI Spend (30d)
              </CardTitle>
              <IndianRupee className="h-5 w-5 text-slate-400" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-black text-slate-900 tracking-tight">
                {formatINR(monthAICost)}
              </div>
              <p className="text-xs text-slate-500 font-medium mt-2">
                {monthCalls.length} calls @ {"\u20b9"}{COST_PER_AI_CALL}/call
              </p>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-semibold text-slate-600">
                Human Equivalent
              </CardTitle>
              <Calculator className="h-5 w-5 text-slate-400" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-black text-slate-900 tracking-tight">
                {formatINR(monthHumanCost)}
              </div>
              <p className="text-xs text-slate-500 font-medium mt-2">
                Would cost with telecaller staff
              </p>
            </CardContent>
          </Card>

          <Card className="bg-white border-slate-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-semibold text-slate-600">
                Cost Per Patient
              </CardTitle>
              <Target className="h-5 w-5 text-slate-400" />
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-black text-slate-900 tracking-tight">
                {"\u20b9"}{patients.length > 0 ? Math.round(totalAICost / patients.length) : 0}
              </div>
              <p className="text-xs text-slate-500 font-medium mt-2">
                Lifetime AI cost per enrolled patient
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Row 2: Cost by Use Case + Weekly Trend */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* Cost by Use Case */}
        <Card className="md:col-span-2 border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-4">
            <CardTitle className="flex items-center gap-2 text-base text-slate-800">
              <BarChart3 className="w-4 h-4 text-slate-500" />
              Cost Breakdown by Use Case
            </CardTitle>
            <CardDescription className="font-medium text-slate-500">
              Per-pathway cost analysis, success rates, and savings
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-white">
                <TableRow>
                  <TableHead className="pl-6 h-9 text-xs font-bold uppercase text-slate-400">
                    Use Case
                  </TableHead>
                  <TableHead className="h-9 text-xs font-bold uppercase text-slate-400">
                    Calls
                  </TableHead>
                  <TableHead className="h-9 text-xs font-bold uppercase text-slate-400">
                    Success
                  </TableHead>
                  <TableHead className="h-9 text-xs font-bold uppercase text-slate-400">
                    AI Cost
                  </TableHead>
                  <TableHead className="h-9 text-xs font-bold uppercase text-slate-400">
                    Human Equiv
                  </TableHead>
                  <TableHead className="pr-6 h-9 text-xs font-bold uppercase text-slate-400">
                    Saved
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {useCaseCosts.map((uc) => (
                  <TableRow key={uc.type} className="hover:bg-slate-50 border-slate-100">
                    <TableCell className="pl-6 py-3">
                      <span className="font-semibold text-sm text-slate-900">{uc.label}</span>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-slate-700">{uc.totalCalls}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-10 bg-slate-100 rounded-full h-1.5">
                          <div
                            className="bg-slate-600 h-1.5 rounded-full"
                            style={{ width: `${uc.successRate}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono text-slate-600">{uc.successRate}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-slate-700">
                      {"\u20b9"}{uc.aiCost}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-slate-400 line-through">
                      {"\u20b9"}{uc.humanCost}
                    </TableCell>
                    <TableCell className="pr-6 font-mono text-sm font-semibold text-slate-900">
                      {"\u20b9"}{uc.savings}
                    </TableCell>
                  </TableRow>
                ))}
                {/* Total row */}
                <TableRow className="bg-slate-50/80 border-t-2 border-slate-200">
                  <TableCell className="pl-6 py-3 font-bold text-sm text-slate-900">Total</TableCell>
                  <TableCell className="font-mono text-sm font-bold text-slate-900">{calls.length}</TableCell>
                  <TableCell />
                  <TableCell className="font-mono text-sm font-bold text-slate-900">
                    {"\u20b9"}{Math.round(totalAICost)}
                  </TableCell>
                  <TableCell className="font-mono text-sm font-bold text-slate-400 line-through">
                    {"\u20b9"}{Math.round(equivalentHumanCost)}
                  </TableCell>
                  <TableCell className="pr-6 font-mono text-sm font-black text-slate-900">
                    {"\u20b9"}{Math.round(totalSavings)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Weekly Cost Trend */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base text-slate-800">
              <TrendingUp className="w-4 h-4 text-slate-500" />
              Weekly Spend
            </CardTitle>
            <CardDescription className="font-medium text-slate-500">
              AI vs Human cost trend
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {weeklyBuckets.map((w) => (
                <div key={w.label}>
                  <div className="flex justify-between text-xs font-semibold text-slate-600 mb-1.5">
                    <span>{w.label}</span>
                    <span className="font-mono">{w.calls} calls</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 w-8 font-bold">AI</span>
                      <div className="flex-1 bg-slate-100 rounded-full h-2">
                        <div
                          className="bg-slate-800 h-2 rounded-full transition-all"
                          style={{
                            width: `${(w.cost / maxWeeklyCost) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-slate-600 w-12 text-right">
                        {"\u20b9"}{w.cost}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 w-8 font-bold">TEL</span>
                      <div className="flex-1 bg-slate-100 rounded-full h-2">
                        <div
                          className="bg-slate-300 h-2 rounded-full transition-all"
                          style={{
                            width: `${(w.humanEquiv / maxWeeklyCost) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-slate-400 w-12 text-right">
                        {"\u20b9"}{w.humanEquiv}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Scale Projection */}
      <Card className="border-slate-200 shadow-sm overflow-hidden">
        <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg text-slate-800">
                <TrendingUp className="w-5 h-5 text-slate-500" />
                Scale Projection — ROI at Scale
              </CardTitle>
              <CardDescription className="font-medium mt-1 text-slate-500">
                Projected savings and staffing impact at district, state, and national scale
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className="bg-white border-slate-200 text-slate-600 font-bold uppercase tracking-widest text-[10px]"
            >
              Projection Model
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-white">
              <TableRow>
                <TableHead className="pl-6 h-10 text-xs font-bold uppercase text-slate-400">
                  Scale
                </TableHead>
                <TableHead className="h-10 text-xs font-bold uppercase text-slate-400">
                  Patients
                </TableHead>
                <TableHead className="h-10 text-xs font-bold uppercase text-slate-400">
                  Calls/Month
                </TableHead>
                <TableHead className="h-10 text-xs font-bold uppercase text-slate-400">
                  AI Cost/Month
                </TableHead>
                <TableHead className="h-10 text-xs font-bold uppercase text-slate-400">
                  Human Cost/Month
                </TableHead>
                <TableHead className="h-10 text-xs font-bold uppercase text-slate-400">
                  Monthly Savings
                </TableHead>
                <TableHead className="pr-6 h-10 text-xs font-bold uppercase text-slate-400">
                  Telecallers Replaced
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projections.map((p, i) => (
                <TableRow
                  key={p.scale}
                  className={`hover:bg-slate-50 border-slate-100 ${i === 0 ? "bg-slate-50/50" : ""}`}
                >
                  <TableCell className="pl-6 py-4">
                    <span className="font-bold text-sm text-slate-900">{p.scale}</span>
                    {i === 0 && (
                      <Badge variant="secondary" className="ml-2 text-[9px] font-bold uppercase tracking-widest">
                        Live
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-slate-700">
                    {p.patients.toLocaleString("en-IN")}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-slate-700">
                    {p.callsMonth.toLocaleString("en-IN")}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-slate-700">
                    {formatINR(p.aiCost)}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-slate-400 line-through">
                    {formatINR(p.humanCost)}
                  </TableCell>
                  <TableCell className="font-mono text-sm font-bold text-slate-900">
                    {formatINR(p.savings)}
                  </TableCell>
                  <TableCell className="pr-6">
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-sm font-semibold text-slate-700">
                        {p.telecallersNeeded}
                      </span>
                      <span className="text-[10px] text-slate-400">FTEs</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
