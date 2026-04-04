"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useWorkflows,
  useCallLogs,
  createWorkflow,
  updateWorkflowActive,
  createAuditLog,
} from "@/hooks/use-supabase";
import { toast } from "sonner";

export default function AdminWorkflowsPage() {
  const { data: supabaseWorkflows, loading, error, refetch } = useWorkflows();
  const { data: allCalls } = useCallLogs();

  // Count calls per call_type in the last 7 days
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const recentCalls = allCalls.filter((c) => now - new Date(c.created_at).getTime() < weekMs);
  const callsByType: Record<string, number> = {};
  for (const c of recentCalls) {
    const ct = c.call_type || c.use_case || "follow_up";
    callsByType[ct] = (callsByType[ct] || 0) + 1;
  }
  const completedByType: Record<string, number> = {};
  for (const c of allCalls.filter((c) => c.status === "completed")) {
    const ct = c.call_type || c.use_case || "follow_up";
    completedByType[ct] = (completedByType[ct] || 0) + 1;
  }
  const totalByType: Record<string, number> = {};
  for (const c of allCalls) {
    const ct = c.call_type || c.use_case || "follow_up";
    totalByType[ct] = (totalByType[ct] || 0) + 1;
  }

  const workflows = supabaseWorkflows.map((w) => {
          // Derive which call_type this workflow maps to from its actions
          const actionTypes = (w.actions ?? []).map((a: Record<string, unknown>) => String(a.template || a.call_type || "")).filter(Boolean);
          const matchedType = actionTypes[0] || "";
          const weekCalls = matchedType ? (callsByType[matchedType] || 0) : 0;
          const total = matchedType ? (totalByType[matchedType] || 0) : 0;
          const completed = matchedType ? (completedByType[matchedType] || 0) : 0;
          const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;
          return ({
          id: w.id,
          name: w.name,
          description: w.description,
          trigger: w.trigger_type,
          config: JSON.stringify(w.trigger_config ?? {})
            .replace(/[{}"]/g, "")
            .replace(/,/g, " · ")
            .replace(/:/g, ": "),
          actions: (w.actions ?? [])
            .map((a) => JSON.stringify(a).replace(/[{}"]/g, "").replace(/:/g, ": "))
            .join(" → "),
          campScope: w.camp_type ? [w.camp_type] : ["All camps"],
          callsThisWeek: weekCalls,
          successRate,
          active: w.is_active,
  });
  });

  const [activeState, setActiveState] = useState<Record<string, boolean>>({});

  const resolvedActiveState: Record<string, boolean> = Object.fromEntries(
    workflows.map((w) => [w.id, w.id in activeState ? activeState[w.id] : w.active])
  );

  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTriggerType, setNewTriggerType] = useState("time_based");
  const [newDescription, setNewDescription] = useState("");
  const [savingNewWorkflow, setSavingNewWorkflow] = useState(false);

  async function toggleWorkflow(id: string) {
    const nextActive = !resolvedActiveState[id];
    setActiveState((p) => ({ ...p, [id]: nextActive }));

    const { error: toggleError } = await updateWorkflowActive(id, nextActive);
    if (toggleError) {
      setActiveState((p) => ({ ...p, [id]: !nextActive }));
      toast.error(toggleError);
      return;
    }
    await createAuditLog({
      user_role: "admin",
      action: nextActive ? "workflow_enabled" : "workflow_disabled",
      resource_type: "workflow",
      resource_id: id,
    });
    refetch();
    toast.success(nextActive ? "Workflow enabled" : "Workflow disabled");
  }

  async function handleCreateWorkflow() {
    const name = newName.trim();
    const description = newDescription.trim();
    if (!name || !description || savingNewWorkflow) return;

    setSavingNewWorkflow(true);

    const { data, error: createError } = await createWorkflow({
      name,
      description,
      trigger_type: newTriggerType,
      trigger_config: { created_from: "admin_ui" },
      actions: [{ type: "voice_call", template: "follow_up" }],
      conditions: {},
      camp_type: null,
      is_active: true,
    });

    if (!createError) {
      await createAuditLog({
        user_role: "admin",
        action: "workflow_created",
        resource_type: "workflow",
        resource_id: data?.id,
        details: { name, trigger_type: newTriggerType },
      });
      setNewName("");
      setNewDescription("");
      setNewTriggerType("time_based");
      setShowNewForm(false);
      refetch();
      toast.success("Workflow created");
    } else {
      toast.error(createError);
    }

    setSavingNewWorkflow(false);
  }

  const triggerLabel: Record<string, string> = {
    risk_based: "Risk-Based Trigger",
    time_based: "Time-Based Trigger",
    event_based: "Event-Based Trigger",
    scheduled: "Scheduled Trigger",
    risk_threshold: "Risk Threshold",
  };

  const triggerColor: Record<string, string> = {
    risk_based: "text-slate-700 border-slate-300 bg-slate-50",
    time_based: "text-slate-700 border-slate-300 bg-slate-50",
    event_based: "text-slate-700 border-slate-300 bg-slate-50",
    scheduled: "text-slate-700 border-slate-300 bg-slate-50",
    risk_threshold: "text-slate-700 border-slate-300 bg-slate-50",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Workflow Management</h1>
          <p className="text-sm text-slate-500">
            Configure automated voice call workflows for patient follow-up
          </p>
        </div>
        <Button onClick={() => setShowNewForm((p) => !p)}>
          {showNewForm ? "Cancel" : "Create New Workflow"}
        </Button>
      </div>

      {/* New Workflow Placeholder Form */}
      {showNewForm && (
        <Card className="border-slate-200 bg-slate-50">
          <CardHeader>
            <CardTitle className="text-base">New Workflow</CardTitle>
            <CardDescription>Define trigger conditions and call actions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Workflow Name</label>
                <Input
                  placeholder="e.g. Slum Quarterly Check-in"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Trigger Type</label>
                <select
                  className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                  value={newTriggerType}
                  onChange={(e) => setNewTriggerType(e.target.value)}
                >
                  <option>time_based</option>
                  <option>risk_based</option>
                  <option>event_based</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Description</label>
              <Textarea
                rows={2}
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>
            <Button size="sm" onClick={handleCreateWorkflow} disabled={savingNewWorkflow}>
              {savingNewWorkflow ? "Saving..." : "Save Workflow"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-1">
            <CardDescription className="text-xs">Active Workflows</CardDescription>
            <CardTitle className="text-2xl text-slate-900">
              {workflows.filter((w) => resolvedActiveState[w.id]).length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription className="text-xs">Calls This Week</CardDescription>
            <CardTitle className="text-2xl">
              {workflows.reduce((acc, w) => acc + w.callsThisWeek, 0)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardDescription className="text-xs">Avg Success Rate</CardDescription>
            <CardTitle className="text-2xl text-slate-900">
              {Math.round(
                workflows.reduce((acc, w) => acc + w.successRate, 0) / workflows.length
              )}%
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Workflow Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {workflows.map((wf) => {
          const isActive = resolvedActiveState[wf.id];
          return (
            <Card
              key={wf.id}
              className={`${isActive ? "" : "opacity-70"} transition-opacity`}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold">{wf.name}</CardTitle>
                    <CardDescription className="text-xs mt-1">
                      {wf.description}
                    </CardDescription>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      isActive
                        ? "text-slate-800 border-slate-300 bg-slate-100 flex-shrink-0 ml-2"
                        : "text-slate-400 border-slate-200 flex-shrink-0 ml-2"
                    }
                  >
                    {isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`text-xs ${triggerColor[wf.trigger]}`}
                  >
                    {triggerLabel[wf.trigger]}
                  </Badge>
                  <span className="text-xs text-slate-500">{wf.config}</span>
                </div>

                <div>
                  <p className="text-xs text-slate-400 mb-1">Actions</p>
                  <p className="text-xs text-slate-600 font-mono bg-slate-50 p-2 rounded">
                    {wf.actions}
                  </p>
                </div>

                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>Scope: {wf.campScope.join(", ")}</span>
                  <span className="text-slate-300">|</span>
                  <span>{wf.callsThisWeek} calls/week</span>
                  <span className="text-slate-300">|</span>
                  <span className="text-slate-600">{wf.successRate}% success</span>
                </div>

                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline">
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={isActive ? "text-red-500" : "text-slate-600"}
                    onClick={() => toggleWorkflow(wf.id)}
                  >
                    {isActive ? "Disable" : "Enable"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
